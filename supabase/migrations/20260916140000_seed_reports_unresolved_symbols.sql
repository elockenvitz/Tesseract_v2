-- Pilot seeding counts what it actually seeded.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `seed_pilot_template_portfolio` resolves symbols to assets with an INNER
-- join when writing `portfolio_holdings`:
--
--     FROM jsonb_array_elements(p_positions) pos
--     JOIN assets a ON a.symbol = pos->>'symbol'
--
-- A template symbol with no `assets` row is dropped. Nothing said so, and two
-- separate counts asserted the opposite:
--
--   * `v_position_count` is `jsonb_array_length(p_positions)`, computed BEFORE
--     the insert, and is returned as `positions_loaded`.
--   * The same number (plus cash) is written to
--     `portfolio_holdings_snapshots.total_positions`.
--
--   * `portfolio_holdings_positions` was populated from the raw template with
--     no join at all, so it carried a row for the unresolved symbol too.
--
-- So the snapshot said 36, the positions detail listed 36, and
-- `portfolio_holdings` -- the table the product actually reads a book from --
-- held 35. Observed across the pilot estate: the Tech & Consumer Growth
-- template lists 35 names, 25 of the 26 books hold 34, and every one of them
-- claims 36 positions including DUOL. DUOL's `assets` row was created
-- 2026-08-18, after those orgs were seeded.
--
-- ── What changes ───────────────────────────────────────────────────────────
--
-- Resolution happens ONCE, up front, and everything downstream is counted from
-- it:
--
--   positions_requested   what the template asked for (kept: it is the useful
--                         internal number, and the difference is the point)
--   positions_loaded      rows actually inserted
--   unresolved_symbols    the names that could not resolve, listed
--
-- `portfolio_holdings_positions` now takes only resolved rows, so the snapshot
-- detail and the holdings agree. `total_positions` counts the same resolved
-- set plus cash. Market value was already computed from the raw template and
-- is now computed from the resolved set too -- a position that does not exist
-- must not contribute to the book's value, or every weight in it is wrong.
--
-- Deliberately NOT a hard failure. Raising would have refused to create 25
-- pilot orgs over one missing ticker; a book with 34 of 35 names is usable
-- where an org that does not exist is not. The caller surfaces the list.
--
-- ── Not retroactive ────────────────────────────────────────────────────────
--
-- This changes future seeding only. The 26 existing pilot books are left
-- exactly as they seeded: adding DUOL now would change real market value,
-- every weight, and every benchmark-relative metric in a live pilot.
--
-- ── RLS posture ────────────────────────────────────────────────────────────
--
-- Unchanged. Same SECURITY DEFINER function, same `is_platform_admin()` gate,
-- same tables, same signature, same grants. No policy added or widened.

create or replace function public.seed_pilot_unresolved_symbols(p_positions jsonb)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(pos->>'symbol' order by pos->>'symbol'), '{}')
    from jsonb_array_elements(p_positions) pos
   where not exists (select 1 from assets a where a.symbol = pos->>'symbol')
$$;

revoke all on function public.seed_pilot_unresolved_symbols(jsonb) from public, anon;
grant execute on function public.seed_pilot_unresolved_symbols(jsonb) to authenticated, service_role;

comment on function public.seed_pilot_unresolved_symbols(jsonb) is
  'Template symbols with no assets row. The seed cannot place these; this is how a caller sees which.';


CREATE OR REPLACE FUNCTION public.seed_pilot_template_portfolio(
  p_org_id uuid, p_name text, p_benchmark text, p_positions jsonb,
  p_sample_ideas jsonb DEFAULT '[]'::jsonb, p_pm_user_id uuid DEFAULT NULL::uuid,
  p_cash_pct numeric DEFAULT 1.0)
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
  v_requested int;
  v_loaded int;
  v_unresolved text[];
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

  v_requested := jsonb_array_length(p_positions);

  -- Resolve once, here, and count everything downstream from the result.
  CREATE TEMPORARY TABLE _seed_resolved ON COMMIT DROP AS
  SELECT a.id AS asset_id,
         pos->>'symbol'            AS symbol,
         (pos->>'shares')::numeric AS shares,
         (pos->>'price')::numeric  AS price,
         (pos->>'weight_pct')::numeric AS weight_pct,
         pos->>'sector'            AS sector
    FROM jsonb_array_elements(p_positions) pos
    JOIN assets a ON a.symbol = pos->>'symbol';

  SELECT count(*) INTO v_loaded FROM _seed_resolved;
  v_unresolved := public.seed_pilot_unresolved_symbols(p_positions);

  -- Market value from what actually exists. A position that could not be
  -- placed must not contribute to the book's value, or every weight is wrong.
  SELECT COALESCE(SUM(shares * price), 0) INTO v_position_mv FROM _seed_resolved;

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
    -- What was seeded, not what was asked for.
    v_loaded + (CASE WHEN v_cash_value > 0 THEN 1 ELSE 0 END),
    v_pm_user_id,
    'Seeded from template: ' || p_name
    || CASE WHEN array_length(v_unresolved, 1) IS NULL THEN ''
            ELSE ' (unresolved: ' || array_to_string(v_unresolved, ', ') || ')' END
  )
  RETURNING id INTO v_snapshot_id;

  -- Resolved rows only, so the snapshot detail and the holdings agree.
  INSERT INTO portfolio_holdings_positions (
    snapshot_id, portfolio_id, organization_id,
    asset_id, symbol, shares, price, market_value, weight_pct, sector
  )
  SELECT v_snapshot_id, v_portfolio_id, p_org_id,
         r.asset_id, r.symbol, r.shares, r.price,
         r.shares * r.price,
         CASE WHEN v_total_mv > 0 THEN (r.shares * r.price) / v_total_mv * 100
              ELSE r.weight_pct END,
         r.sector
    FROM _seed_resolved r;

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
  SELECT v_portfolio_id, r.asset_id, r.shares, r.price, r.price, v_snapshot_date
    FROM _seed_resolved r
  ON CONFLICT (portfolio_id, asset_id, date) DO UPDATE
    SET shares = EXCLUDED.shares, price = EXCLUDED.price, cost = EXCLUDED.cost;

  IF v_cash_value > 0 AND v_cash_asset_id IS NOT NULL THEN
    INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
    VALUES (v_portfolio_id, v_cash_asset_id, v_cash_value, 1.0, 1.0, v_snapshot_date)
    ON CONFLICT (portfolio_id, asset_id, date) DO UPDATE
      SET shares = EXCLUDED.shares, price = 1.0, cost = 1.0;
  END IF;

  UPDATE org_onboarding_status
     SET is_completed = true, completed_by = v_pm_user_id,
         completed_at = now(), updated_at = now()
   WHERE organization_id = p_org_id;
  INSERT INTO org_onboarding_status (organization_id, is_completed, completed_by, completed_at)
  VALUES (p_org_id, true, v_pm_user_id, now())
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE pilot_scenarios
     SET portfolio_id = v_portfolio_id, updated_at = now()
   WHERE organization_id = p_org_id
     AND is_template = false
     AND status = 'active'
     AND portfolio_id IS NULL;

  DROP TABLE IF EXISTS _seed_resolved;

  RETURN jsonb_build_object(
    'portfolio_id', v_portfolio_id,
    'snapshot_id', v_snapshot_id,
    -- `positions_loaded` is now what landed. `positions_requested` keeps the
    -- template's own number, because the gap between them is the finding.
    'positions_requested', v_requested,
    'positions_loaded', v_loaded,
    'unresolved_symbols', to_jsonb(v_unresolved),
    'cash_value', v_cash_value,
    'total_market_value', v_total_mv
  );
END;
$function$;
