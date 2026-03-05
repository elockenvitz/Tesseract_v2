-- ============================================================
-- Portfolio 3-State Lifecycle: Active / Archived / Discarded
-- ============================================================

-- 1a. Add status column + discard metadata
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS discarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS discarded_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS lifecycle_reason text;

ALTER TABLE portfolios
  ADD CONSTRAINT chk_portfolio_status CHECK (status IN ('active', 'archived', 'discarded'));

-- 1b. Backfill existing rows from archived_at / is_active
UPDATE portfolios SET status = 'archived' WHERE archived_at IS NOT NULL AND status = 'active';
UPDATE portfolios SET status = 'archived', archived_at = COALESCE(archived_at, now())
  WHERE is_active = false AND status = 'active';

-- 1c. Index on status; drop old archived-only index
CREATE INDEX IF NOT EXISTS idx_portfolios_status ON portfolios(organization_id, status);
DROP INDEX IF EXISTS idx_portfolios_archived;

-- ────────────────────────────────────────────────────────────
-- 1d. RLS: Hide discarded portfolios from non-admins
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Org members can view portfolios in current org" ON portfolios;

CREATE POLICY "Org members can view portfolios in current org"
  ON portfolios FOR SELECT
  USING (
    (
      (organization_id = current_org_id())
      OR (team_id IN (SELECT id FROM teams WHERE organization_id = current_org_id()))
      OR (team_id IS NULL AND organization_id IS NULL AND EXISTS (
        SELECT 1 FROM organization_memberships
        WHERE organization_id = current_org_id()
          AND user_id = auth.uid()
          AND status = 'active'
      ))
    )
    AND (
      status != 'discarded'
      OR is_active_org_admin_of_current_org()
    )
  );

-- ────────────────────────────────────────────────────────────
-- 1e. New RPCs
-- ────────────────────────────────────────────────────────────

-- can_discard_portfolio: check for meaningful-history blockers (read-only)
CREATE OR REPLACE FUNCTION can_discard_portfolio(p_portfolio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_holding_count int;
  v_trade_sheet_count int;
  v_variant_count int;
  v_trade_plan_count int;
  v_note_count int;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  -- Resolve org
  SELECT COALESCE(organization_id, (SELECT organization_id FROM teams WHERE id = portfolios.team_id))
    INTO v_org_id
    FROM portfolios WHERE id = p_portfolio_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Portfolio not found' USING ERRCODE = 'P0002';
  END IF;

  -- Verify caller is org admin
  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = v_org_id
      AND user_id = auth.uid()
      AND is_org_admin = true
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only Org Admins can discard portfolios' USING ERRCODE = 'P0003';
  END IF;

  -- Check meaningful-history tables
  SELECT count(*) INTO v_holding_count FROM portfolio_holdings WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_trade_sheet_count FROM trade_sheets WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_variant_count FROM lab_variants WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_trade_plan_count FROM trade_plans WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_note_count FROM portfolio_notes WHERE portfolio_id = p_portfolio_id AND is_deleted = false;

  IF v_holding_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'holdings', 'count', v_holding_count, 'label', v_holding_count || ' holding(s)');
  END IF;
  IF v_trade_sheet_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'trade_sheets', 'count', v_trade_sheet_count, 'label', v_trade_sheet_count || ' trade sheet(s)');
  END IF;
  IF v_variant_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'variants', 'count', v_variant_count, 'label', v_variant_count || ' trade variant(s)');
  END IF;
  IF v_trade_plan_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'trade_plans', 'count', v_trade_plan_count, 'label', v_trade_plan_count || ' trade plan(s)');
  END IF;
  IF v_note_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'notes', 'count', v_note_count, 'label', v_note_count || ' note(s)');
  END IF;

  RETURN jsonb_build_object('can_discard', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers);
END;
$$;

-- discard_portfolio: soft-remove (calls can_discard_portfolio internally)
CREATE OR REPLACE FUNCTION discard_portfolio(p_portfolio_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check jsonb;
BEGIN
  v_check := can_discard_portfolio(p_portfolio_id);

  IF NOT (v_check->>'can_discard')::boolean THEN
    RETURN jsonb_build_object('discarded', false, 'blockers', v_check->'blockers');
  END IF;

  UPDATE portfolios
  SET status = 'discarded',
      discarded_at = now(),
      discarded_by = auth.uid(),
      lifecycle_reason = p_reason,
      is_active = false,
      updated_at = now()
  WHERE id = p_portfolio_id;

  RETURN jsonb_build_object('discarded', true, 'blockers', '[]'::jsonb);
END;
$$;

-- restore_portfolio: discarded → active
CREATE OR REPLACE FUNCTION restore_portfolio(p_portfolio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_status text;
BEGIN
  SELECT COALESCE(organization_id, (SELECT organization_id FROM teams WHERE id = portfolios.team_id)),
         status
    INTO v_org_id, v_status
    FROM portfolios WHERE id = p_portfolio_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Portfolio not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = v_org_id
      AND user_id = auth.uid()
      AND is_org_admin = true
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only Org Admins can restore portfolios' USING ERRCODE = 'P0003';
  END IF;

  IF v_status != 'discarded' THEN
    RAISE EXCEPTION 'Portfolio is not discarded' USING ERRCODE = 'P0004';
  END IF;

  UPDATE portfolios
  SET status = 'active',
      discarded_at = NULL,
      discarded_by = NULL,
      lifecycle_reason = NULL,
      archived_at = NULL,
      archived_by = NULL,
      is_active = true,
      updated_at = now()
  WHERE id = p_portfolio_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 1f. Update existing archive / unarchive RPCs to use status column
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION archive_portfolio(p_portfolio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_status text;
BEGIN
  SELECT COALESCE(organization_id, (SELECT organization_id FROM teams WHERE id = portfolios.team_id)),
         status
    INTO v_org_id, v_status
    FROM portfolios WHERE id = p_portfolio_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Portfolio not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = v_org_id
      AND user_id = auth.uid()
      AND is_org_admin = true
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only Org Admins can archive portfolios' USING ERRCODE = 'P0003';
  END IF;

  IF v_status != 'active' THEN
    RAISE EXCEPTION 'Only active portfolios can be archived' USING ERRCODE = 'P0004';
  END IF;

  UPDATE portfolios
  SET status = 'archived',
      archived_at = now(),
      archived_by = auth.uid(),
      is_active = false,
      updated_at = now()
  WHERE id = p_portfolio_id;
END;
$$;

CREATE OR REPLACE FUNCTION unarchive_portfolio(p_portfolio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_status text;
BEGIN
  SELECT COALESCE(organization_id, (SELECT organization_id FROM teams WHERE id = portfolios.team_id)),
         status
    INTO v_org_id, v_status
    FROM portfolios WHERE id = p_portfolio_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Portfolio not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE organization_id = v_org_id
      AND user_id = auth.uid()
      AND is_org_admin = true
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only Org Admins can unarchive portfolios' USING ERRCODE = 'P0003';
  END IF;

  IF v_status != 'archived' THEN
    RAISE EXCEPTION 'Portfolio is not archived' USING ERRCODE = 'P0004';
  END IF;

  UPDATE portfolios
  SET status = 'active',
      archived_at = NULL,
      archived_by = NULL,
      is_active = true,
      updated_at = now()
  WHERE id = p_portfolio_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 1g. Update trigger to block writes on archived AND discarded
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_portfolio_not_archived()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM portfolios
    WHERE id = NEW.portfolio_id AND status != 'active'
  ) THEN
    RAISE EXCEPTION 'Cannot modify members of a non-active portfolio'
      USING ERRCODE = 'P0005';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop hard-delete function (replaced by discard)
DROP FUNCTION IF EXISTS delete_portfolio_if_empty(uuid);

-- Drop DELETE policy (no more hard deletes)
DROP POLICY IF EXISTS "Org admins can delete portfolios via rpc" ON portfolios;

-- Grant execute on new RPCs
GRANT EXECUTE ON FUNCTION can_discard_portfolio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION discard_portfolio(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_portfolio(uuid) TO authenticated;
