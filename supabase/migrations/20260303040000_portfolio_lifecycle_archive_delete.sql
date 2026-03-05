-- ============================================================
-- Portfolio Lifecycle: Archive + Hard Delete
-- ============================================================

-- 1. Add archived_at timestamp to portfolios
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_portfolios_archived ON portfolios(organization_id, archived_at)
  WHERE archived_at IS NOT NULL;

-- 2. RPC: archive_portfolio
--    Sets archived_at + archived_by. Only org admins can call.
CREATE OR REPLACE FUNCTION archive_portfolio(p_portfolio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Get portfolio org
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
    RAISE EXCEPTION 'Only Org Admins can archive portfolios' USING ERRCODE = 'P0003';
  END IF;

  -- Already archived?
  IF EXISTS (SELECT 1 FROM portfolios WHERE id = p_portfolio_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Portfolio is already archived' USING ERRCODE = 'P0004';
  END IF;

  UPDATE portfolios
  SET archived_at = now(),
      archived_by = auth.uid(),
      is_active = false,
      updated_at = now()
  WHERE id = p_portfolio_id;
END;
$$;

-- 3. RPC: unarchive_portfolio
CREATE OR REPLACE FUNCTION unarchive_portfolio(p_portfolio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT COALESCE(organization_id, (SELECT organization_id FROM teams WHERE id = portfolios.team_id))
    INTO v_org_id
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

  IF NOT EXISTS (SELECT 1 FROM portfolios WHERE id = p_portfolio_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Portfolio is not archived' USING ERRCODE = 'P0004';
  END IF;

  UPDATE portfolios
  SET archived_at = NULL,
      archived_by = NULL,
      is_active = true,
      updated_at = now()
  WHERE id = p_portfolio_id;
END;
$$;

-- 4. RPC: delete_portfolio_if_empty
--    Hard delete only if portfolio has no members, holdings, or linked objects.
CREATE OR REPLACE FUNCTION delete_portfolio_if_empty(p_portfolio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_member_count int;
  v_holding_count int;
  v_trade_lab_count int;
  v_variant_count int;
  v_trade_sheet_count int;
  v_team_link_count int;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  -- Get portfolio org
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
    RAISE EXCEPTION 'Only Org Admins can delete portfolios' USING ERRCODE = 'P0003';
  END IF;

  -- Check dependencies
  SELECT count(*) INTO v_member_count FROM portfolio_team WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_holding_count FROM portfolio_holdings WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_trade_lab_count FROM trade_labs WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_variant_count FROM lab_variants WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_trade_sheet_count FROM trade_sheets WHERE portfolio_id = p_portfolio_id;
  SELECT count(*) INTO v_team_link_count FROM portfolio_team_links WHERE portfolio_id = p_portfolio_id;

  -- Build blockers array
  IF v_member_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'members', 'count', v_member_count, 'label', v_member_count || ' team member(s)');
  END IF;
  IF v_holding_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'holdings', 'count', v_holding_count, 'label', v_holding_count || ' holding(s)');
  END IF;
  IF v_trade_lab_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'trade_labs', 'count', v_trade_lab_count, 'label', v_trade_lab_count || ' trade lab(s)');
  END IF;
  IF v_variant_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'variants', 'count', v_variant_count, 'label', v_variant_count || ' trade variant(s)');
  END IF;
  IF v_trade_sheet_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'trade_sheets', 'count', v_trade_sheet_count, 'label', v_trade_sheet_count || ' trade sheet(s)');
  END IF;
  IF v_team_link_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('type', 'team_links', 'count', v_team_link_count, 'label', v_team_link_count || ' linked team(s)');
  END IF;

  -- If any blockers, return them instead of deleting
  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('deleted', false, 'blockers', v_blockers);
  END IF;

  -- Safe to delete
  DELETE FROM portfolios WHERE id = p_portfolio_id;

  RETURN jsonb_build_object('deleted', true, 'blockers', '[]'::jsonb);
END;
$$;

-- 5. Grant execute to authenticated
GRANT EXECUTE ON FUNCTION archive_portfolio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION unarchive_portfolio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_portfolio_if_empty(uuid) TO authenticated;

-- 6. Tighten DELETE policy — only org admins (enforced via RPC for dependency checks)
DROP POLICY IF EXISTS "Org members can delete portfolios in current org" ON portfolios;

CREATE POLICY "Org admins can delete portfolios via rpc"
  ON portfolios FOR DELETE
  USING (
    (
      (organization_id = current_org_id())
      OR (team_id IN (SELECT id FROM teams WHERE organization_id = current_org_id()))
    )
    AND is_active_org_admin_of_current_org()
  );

-- 7. Block portfolio_team writes on archived portfolios
CREATE OR REPLACE FUNCTION enforce_portfolio_not_archived()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM portfolios
    WHERE id = NEW.portfolio_id AND archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot modify members of an archived portfolio'
      USING ERRCODE = 'P0005';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_portfolio_not_archived ON portfolio_team;
CREATE TRIGGER trg_enforce_portfolio_not_archived
  BEFORE INSERT OR UPDATE ON portfolio_team
  FOR EACH ROW EXECUTE FUNCTION enforce_portfolio_not_archived();
