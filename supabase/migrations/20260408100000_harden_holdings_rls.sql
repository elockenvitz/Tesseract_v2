-- ============================================================
-- Harden Holdings RLS — Org-Scoped Data Isolation
-- ============================================================
--
-- PROBLEM: portfolio_holdings_snapshots and portfolio_holdings_positions
-- have completely permissive RLS policies (USING (true)) that allow any
-- authenticated user to read/write ALL holdings across ALL organizations.
--
-- FIX: Add organization_id columns, backfill from portfolios, drop
-- permissive policies, and create org-scoped policies using current_org_id().
-- ============================================================

-- ============================================================
-- 1. Add organization_id to portfolio_holdings_snapshots
-- ============================================================

ALTER TABLE portfolio_holdings_snapshots
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill from portfolios.organization_id
UPDATE portfolio_holdings_snapshots s
SET organization_id = p.organization_id
FROM portfolios p
WHERE s.portfolio_id = p.id
  AND s.organization_id IS NULL;

-- Make NOT NULL after backfill
ALTER TABLE portfolio_holdings_snapshots
  ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 2. Add organization_id to portfolio_holdings_positions
-- ============================================================

ALTER TABLE portfolio_holdings_positions
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill from snapshot → portfolio
UPDATE portfolio_holdings_positions pos
SET organization_id = s.organization_id
FROM portfolio_holdings_snapshots s
WHERE pos.snapshot_id = s.id
  AND pos.organization_id IS NULL;

-- Make NOT NULL after backfill
ALTER TABLE portfolio_holdings_positions
  ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 3. Drop all existing permissive policies
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read holdings snapshots" ON portfolio_holdings_snapshots;
DROP POLICY IF EXISTS "Authenticated users can insert holdings snapshots" ON portfolio_holdings_snapshots;
DROP POLICY IF EXISTS "Authenticated users can update holdings snapshots" ON portfolio_holdings_snapshots;

DROP POLICY IF EXISTS "Authenticated users can read holdings positions" ON portfolio_holdings_positions;
DROP POLICY IF EXISTS "Authenticated users can insert holdings positions" ON portfolio_holdings_positions;

-- ============================================================
-- 4. Create org-scoped policies for snapshots
-- ============================================================

CREATE POLICY "Holdings snapshots: org members can read"
  ON portfolio_holdings_snapshots FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "Holdings snapshots: org members can insert"
  ON portfolio_holdings_snapshots FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY "Holdings snapshots: org members can update"
  ON portfolio_holdings_snapshots FOR UPDATE TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "Holdings snapshots: org admins can delete"
  ON portfolio_holdings_snapshots FOR DELETE TO authenticated
  USING (
    organization_id = current_org_id()
    AND (is_active_org_admin_of_current_org() OR (SELECT coverage_admin FROM users WHERE id = auth.uid()))
  );

-- ============================================================
-- 5. Create org-scoped policies for positions
-- ============================================================

CREATE POLICY "Holdings positions: org members can read"
  ON portfolio_holdings_positions FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "Holdings positions: org members can insert"
  ON portfolio_holdings_positions FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY "Holdings positions: org members can update"
  ON portfolio_holdings_positions FOR UPDATE TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "Holdings positions: org admins can delete"
  ON portfolio_holdings_positions FOR DELETE TO authenticated
  USING (
    organization_id = current_org_id()
    AND (is_active_org_admin_of_current_org() OR (SELECT coverage_admin FROM users WHERE id = auth.uid()))
  );

-- ============================================================
-- 6. Add indexes for org-scoped queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_holdings_snapshots_org
  ON portfolio_holdings_snapshots(organization_id, portfolio_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_holdings_positions_org
  ON portfolio_holdings_positions(organization_id);

-- ============================================================
-- 7. Fix carry_forward_holdings() — add search_path safety
-- ============================================================

CREATE OR REPLACE FUNCTION carry_forward_holdings(p_target_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_prev_date DATE;
  v_portfolio RECORD;
  v_new_snapshot_id UUID;
BEGIN
  -- Find the most recent business day before target
  v_prev_date := p_target_date - INTERVAL '1 day';

  -- Loop through portfolios that have a snapshot on prev_date but NOT on target_date
  FOR v_portfolio IN
    SELECT DISTINCT prev.portfolio_id, prev.id AS prev_snapshot_id,
           prev.total_market_value, prev.total_positions, prev.organization_id
    FROM portfolio_holdings_snapshots prev
    WHERE prev.snapshot_date = v_prev_date
      AND NOT EXISTS (
        SELECT 1 FROM portfolio_holdings_snapshots cur
        WHERE cur.portfolio_id = prev.portfolio_id
          AND cur.snapshot_date = p_target_date
      )
  LOOP
    -- Create carry-forward snapshot (preserving org_id)
    INSERT INTO portfolio_holdings_snapshots
      (portfolio_id, snapshot_date, source, total_market_value, total_positions, organization_id)
    VALUES
      (v_portfolio.portfolio_id, p_target_date, 'carry_forward',
       v_portfolio.total_market_value, v_portfolio.total_positions, v_portfolio.organization_id)
    RETURNING id INTO v_new_snapshot_id;

    -- Copy positions from previous snapshot (preserving org_id)
    INSERT INTO portfolio_holdings_positions
      (snapshot_id, portfolio_id, asset_id, symbol, shares, price, market_value,
       cost_basis, weight_pct, sector, asset_class, organization_id)
    SELECT v_new_snapshot_id, portfolio_id, asset_id, symbol, shares, price, market_value,
           cost_basis, weight_pct, sector, asset_class, organization_id
    FROM portfolio_holdings_positions
    WHERE snapshot_id = v_portfolio.prev_snapshot_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 8. User-facing carry-forward (org-scoped, non-SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION carry_forward_holdings_for_portfolio(
  p_portfolio_id UUID,
  p_target_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id UUID;
  v_prev_snapshot RECORD;
  v_new_snapshot_id UUID;
BEGIN
  -- Verify caller's org matches portfolio's org
  SELECT organization_id INTO v_org_id FROM portfolios WHERE id = p_portfolio_id;
  IF v_org_id IS NULL OR v_org_id != current_org_id() THEN
    RAISE EXCEPTION 'Access denied: portfolio not in current organization';
  END IF;

  -- Find the most recent snapshot for this portfolio before target date
  SELECT id, total_market_value, total_positions, organization_id
  INTO v_prev_snapshot
  FROM portfolio_holdings_snapshots
  WHERE portfolio_id = p_portfolio_id
    AND snapshot_date < p_target_date
  ORDER BY snapshot_date DESC
  LIMIT 1;

  IF v_prev_snapshot IS NULL THEN
    RAISE EXCEPTION 'No previous snapshot found for portfolio %', p_portfolio_id;
  END IF;

  -- Check no snapshot exists for target date
  IF EXISTS (
    SELECT 1 FROM portfolio_holdings_snapshots
    WHERE portfolio_id = p_portfolio_id AND snapshot_date = p_target_date
  ) THEN
    RAISE EXCEPTION 'Snapshot already exists for % on %', p_portfolio_id, p_target_date;
  END IF;

  -- Create carry-forward snapshot
  INSERT INTO portfolio_holdings_snapshots
    (portfolio_id, snapshot_date, source, total_market_value, total_positions, organization_id)
  VALUES
    (p_portfolio_id, p_target_date, 'carry_forward',
     v_prev_snapshot.total_market_value, v_prev_snapshot.total_positions, v_prev_snapshot.organization_id)
  RETURNING id INTO v_new_snapshot_id;

  -- Copy positions
  INSERT INTO portfolio_holdings_positions
    (snapshot_id, portfolio_id, asset_id, symbol, shares, price, market_value,
     cost_basis, weight_pct, sector, asset_class, organization_id)
  SELECT v_new_snapshot_id, portfolio_id, asset_id, symbol, shares, price, market_value,
         cost_basis, weight_pct, sector, asset_class, organization_id
  FROM portfolio_holdings_positions
  WHERE snapshot_id = v_prev_snapshot.id;

  RETURN v_new_snapshot_id;
END;
$$;
