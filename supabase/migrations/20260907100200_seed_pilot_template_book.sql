-- ============================================================
-- seed_pilot_template_portfolio: write a book, not an accumulation
-- ============================================================
--
-- Two changes, both forced by the working-book contract.
--
-- 1. ON CONFLICT (portfolio_id, asset_id, date) names a constraint that no
--    longer exists. Left alone this function raises on its next call, which
--    is every new pilot organisation.
--
-- 2. It only ever inserted. Re-seeding a portfolio whose template had
--    dropped a name left that name in the book forever — the same
--    never-remove defect the onboarding wizard and every ingestion path had.
--    It now deletes what the template does not contain and stamps the book,
--    which is what makes a seeded book a complete book.
--
-- Everything else is byte-identical to the deployed definition. The two
-- conflict targets were replaced programmatically rather than retyped.
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_pilot_template_portfolio(p_org_id uuid, p_name text, p_benchmark text, p_positions jsonb, p_sample_ideas jsonb DEFAULT '[]'::jsonb, p_pm_user_id uuid DEFAULT NULL::uuid, p_cash_pct numeric DEFAULT 1.0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_portfolio_id uuid;
  v_snapshot_id uuid;
  v_snapshot_date date := CURRENT_DATE;
  v_position_mv numeric;
  v_cash_value numeric;
  v_total_mv numeric;
  v_position_count int;
  v_pm_user_id uuid := COALESCE(p_pm_user_id, auth.uid());
  v_cash_asset_id uuid;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can seed template portfolios';
  END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  IF jsonb_typeof(p_positions) <> 'array' OR jsonb_array_length(p_positions) = 0 THEN
    RAISE EXCEPTION 'p_positions must be a non-empty jsonb array';
  END IF;

  v_position_count := jsonb_array_length(p_positions);

  SELECT COALESCE(SUM((pos->>'shares')::numeric * (pos->>'price')::numeric), 0)
    INTO v_position_mv
    FROM jsonb_array_elements(p_positions) pos;

  IF p_cash_pct IS NULL OR p_cash_pct <= 0 THEN
    v_cash_value := 0;
  ELSIF p_cash_pct >= 99 THEN
    v_cash_value := v_position_mv * 99 / 1;
  ELSE
    v_cash_value := v_position_mv * p_cash_pct / (100 - p_cash_pct);
  END IF;

  v_total_mv := v_position_mv + v_cash_value;

  SELECT id INTO v_cash_asset_id FROM assets WHERE symbol = 'CASH_USD' LIMIT 1;

  INSERT INTO portfolios (organization_id, name, benchmark, is_active, status)
  VALUES (p_org_id, p_name, p_benchmark, true, 'active')
  RETURNING id INTO v_portfolio_id;

  IF v_pm_user_id IS NOT NULL THEN
    INSERT INTO portfolio_memberships (portfolio_id, user_id)
    VALUES (v_portfolio_id, v_pm_user_id)
    ON CONFLICT DO NOTHING;
    INSERT INTO portfolio_team (portfolio_id, user_id, role)
    VALUES (v_portfolio_id, v_pm_user_id, 'pm')
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO portfolio_holdings_snapshots (
    portfolio_id, organization_id, snapshot_date, source,
    total_market_value, total_positions, uploaded_by, notes
  ) VALUES (
    v_portfolio_id, p_org_id, v_snapshot_date, 'manual_upload',
    v_total_mv,
    v_position_count + (CASE WHEN v_cash_value > 0 THEN 1 ELSE 0 END),
    v_pm_user_id,
    'Seeded from template: ' || p_name
  )
  RETURNING id INTO v_snapshot_id;

  INSERT INTO portfolio_holdings_positions (
    snapshot_id, portfolio_id, organization_id,
    asset_id, symbol, shares, price, market_value, weight_pct, sector
  )
  SELECT
    v_snapshot_id, v_portfolio_id, p_org_id,
    (SELECT id FROM assets WHERE symbol = (pos->>'symbol') LIMIT 1),
    pos->>'symbol',
    (pos->>'shares')::numeric,
    (pos->>'price')::numeric,
    (pos->>'shares')::numeric * (pos->>'price')::numeric,
    CASE WHEN v_total_mv > 0
         THEN ((pos->>'shares')::numeric * (pos->>'price')::numeric) / v_total_mv * 100
         ELSE (pos->>'weight_pct')::numeric END,
    pos->>'sector'
  FROM jsonb_array_elements(p_positions) pos;

  IF v_cash_value > 0 AND v_cash_asset_id IS NOT NULL THEN
    INSERT INTO portfolio_holdings_positions (
      snapshot_id, portfolio_id, organization_id,
      asset_id, symbol, shares, price, market_value, weight_pct, sector
    ) VALUES (
      v_snapshot_id, v_portfolio_id, p_org_id,
      v_cash_asset_id, 'CASH_USD',
      v_cash_value, 1.0, v_cash_value,
      CASE WHEN v_total_mv > 0 THEN v_cash_value / v_total_mv * 100 ELSE 0 END,
      'Cash'
    );
  END IF;

  INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
  SELECT v_portfolio_id, a.id,
         (pos->>'shares')::numeric,
         (pos->>'price')::numeric,
         (pos->>'price')::numeric,
         v_snapshot_date
  FROM jsonb_array_elements(p_positions) pos
  JOIN assets a ON a.symbol = pos->>'symbol'
  ON CONFLICT (portfolio_id, asset_id) DO UPDATE
    SET shares = EXCLUDED.shares, price = EXCLUDED.price, cost = EXCLUDED.cost;

  IF v_cash_value > 0 AND v_cash_asset_id IS NOT NULL THEN
    INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
    VALUES (v_portfolio_id, v_cash_asset_id, v_cash_value, 1.0, 1.0, v_snapshot_date)
    ON CONFLICT (portfolio_id, asset_id) DO UPDATE
      SET shares = EXCLUDED.shares, price = 1.0, cost = 1.0;
  END IF;

  -- The template IS the book, so anything not in it is not held.
  -- Previously this only ever inserted, which is how a re-seed over an
  -- existing portfolio left names behind that the template had dropped.
  DELETE FROM portfolio_holdings h
   WHERE h.portfolio_id = v_portfolio_id
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_positions) pos
       JOIN assets a ON a.symbol = pos->>'symbol'
       WHERE a.id = h.asset_id
     )
     AND (v_cash_asset_id IS NULL OR h.asset_id <> v_cash_asset_id);

  -- A seeded book is complete by construction, so it may claim an as-of.
  UPDATE portfolios
     SET book_as_of = v_snapshot_date,
         book_source = 'onboarding',
         book_reconciled_at = now()
   WHERE id = v_portfolio_id;

  -- Mark onboarding complete
  UPDATE org_onboarding_status
     SET is_completed = true,
         completed_by = v_pm_user_id,
         completed_at = now(),
         updated_at = now()
   WHERE organization_id = p_org_id;
  INSERT INTO org_onboarding_status (organization_id, is_completed, completed_by, completed_at)
  VALUES (p_org_id, true, v_pm_user_id, now())
  ON CONFLICT (organization_id) DO NOTHING;

  -- Wire any dangling pilot_scenario rows (scenario created before the
  -- portfolio existed) to this freshly-seeded portfolio so the first
  -- login's ensure_pilot_scenario_for_user call doesn't get stuck
  -- treating an empty shell as "already exists".
  UPDATE pilot_scenarios
     SET portfolio_id = v_portfolio_id, updated_at = now()
   WHERE organization_id = p_org_id
     AND is_template = false
     AND status = 'active'
     AND portfolio_id IS NULL;

  RETURN jsonb_build_object(
    'portfolio_id', v_portfolio_id,
    'snapshot_id', v_snapshot_id,
    'positions_loaded', v_position_count,
    'cash_value', v_cash_value,
    'total_market_value', v_total_mv
  );
END;
$function$;
