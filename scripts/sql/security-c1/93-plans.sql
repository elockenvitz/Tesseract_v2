-- =============================================================================
-- C1/93 — query plans under synthetic volume, STAGING ONLY
--
-- The design predicted no material performance risk because the C1 tables are
-- small (672 rows is the largest on production). That is an argument, not a
-- measurement, and it says nothing about how the plans behave as the tables
-- grow — an EXISTS re-executed per row is fine at 672 and not fine at 100k.
--
-- This loads roughly 20-100x production volume into the tables whose policies
-- are the most expensive shapes (a two-hop EXISTS, a one-hop EXISTS, and a
-- direct column predicate), runs the reads as a real authenticated caller, and
-- records the plan node and timing. Rolled back like everything else.
--
-- What we are looking for: an index scan or a hashed subplan on the parent, not
-- a sequential scan of the parent per row.
-- =============================================================================

CREATE TEMP TABLE c1_plans (seq int, label text, rows_scanned text, plan_head text, ms numeric);
GRANT ALL ON c1_plans TO authenticated, service_role;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('91000000-0000-4000-8000-000000000001', 'C1 Perf Org', 'c1-perf-org'),
  ('91000000-0000-4000-8000-000000000002', 'C1 Perf Other', 'c1-perf-other');
INSERT INTO auth.users (id, is_sso_user, is_anonymous)
  VALUES ('91111111-0000-4000-8000-000000000001', false, false);
INSERT INTO public.users (id, current_organization_id)
  VALUES ('91111111-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001')
  ON CONFLICT (id) DO UPDATE SET current_organization_id = EXCLUDED.current_organization_id;
INSERT INTO public.organization_memberships (organization_id, user_id, status)
  VALUES ('91000000-0000-4000-8000-000000000001', '91111111-0000-4000-8000-000000000001', 'active');

-- 40 funds across 2 orgs, 20 snapshots each, 50 holdings per snapshot
--  = 800 snapshots, 40,000 holdings (60x production's 672).
INSERT INTO public.target_date_funds (id, name, target_year, organization_id)
SELECT gen_random_uuid(), 'perf fund ' || g, 2000 + g,
       CASE WHEN g % 2 = 0 THEN '91000000-0000-4000-8000-000000000001'
                           ELSE '91000000-0000-4000-8000-000000000002' END::uuid
  FROM generate_series(1, 40) g;

INSERT INTO public.tdf_holdings_snapshots (id, tdf_id, snapshot_date)
SELECT gen_random_uuid(), f.id, DATE '2020-01-01' + (s * 30)
  FROM public.target_date_funds f
  CROSS JOIN generate_series(1, 20) s
 WHERE f.name LIKE 'perf fund %';

INSERT INTO public.tdf_underlying_funds (id, name)
SELECT gen_random_uuid(), 'perf underlying ' || g FROM generate_series(1, 50) g;

INSERT INTO public.tdf_holdings (snapshot_id, underlying_fund_id, weight)
SELECT s.id, u.id, 1
  FROM public.tdf_holdings_snapshots s
  CROSS JOIN public.tdf_underlying_funds u
 WHERE u.name LIKE 'perf underlying %';

-- 2,000 themes and 40,000 theme_assets (2,200x production's 18).
INSERT INTO public.themes (id, name, organization_id, created_by)
SELECT gen_random_uuid(), 'perf theme ' || g,
       CASE WHEN g % 2 = 0 THEN '91000000-0000-4000-8000-000000000001'
                           ELSE '91000000-0000-4000-8000-000000000002' END::uuid,
       '91111111-0000-4000-8000-000000000001'
  FROM generate_series(1, 2000) g;

INSERT INTO public.theme_assets (theme_id, asset_id, added_by)
SELECT t.id, a.id, '91111111-0000-4000-8000-000000000001'
  FROM public.themes t CROSS JOIN public.assets a
 WHERE t.name LIKE 'perf theme %';

ANALYZE public.tdf_holdings;
ANALYZE public.tdf_holdings_snapshots;
ANALYZE public.target_date_funds;
ANALYZE public.theme_assets;
ANALYZE public.themes;

DO $plans$
DECLARE
  plan json;
  head text;
  ms numeric;
  n bigint;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"91111111-0000-4000-8000-000000000001","role":"authenticated"}', true);

  -- tdf_holdings: the two-hop EXISTS, the most expensive predicate in C1.
  EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF) SELECT count(*) FROM public.tdf_holdings' INTO plan;
  head := plan->0->'Plan'->>'Node Type';
  ms   := (plan->0->>'Execution Time')::numeric;
  EXECUTE 'SELECT count(*) FROM public.tdf_holdings' INTO n;
  -- Both counts run as `authenticated`, so this is the post-RLS figure. The
  -- unfiltered total is not read here: doing so would need a role switch and
  -- would say nothing about the plan being measured.
  INSERT INTO c1_plans VALUES (1, 'tdf_holdings 2-hop EXISTS',
    n || ' rows visible post-RLS', head, ms);

  -- theme_assets: the one-hop EXISTS.
  EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF) SELECT count(*) FROM public.theme_assets' INTO plan;
  head := plan->0->'Plan'->>'Node Type';
  ms   := (plan->0->>'Execution Time')::numeric;
  EXECUTE 'SELECT count(*) FROM public.theme_assets' INTO n;
  INSERT INTO c1_plans VALUES (2, 'theme_assets 1-hop EXISTS',
    n || ' visible', head, ms);

  -- A selective read, which is what the app actually issues.
  EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF)
           SELECT id FROM public.theme_assets WHERE asset_id = (SELECT id FROM public.assets LIMIT 1)' INTO plan;
  INSERT INTO c1_plans VALUES (3, 'theme_assets selective by asset_id',
    '', plan->0->'Plan'->>'Node Type', (plan->0->>'Execution Time')::numeric);

  EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF)
           SELECT id FROM public.tdf_holdings WHERE snapshot_id =
             (SELECT id FROM public.tdf_holdings_snapshots LIMIT 1)' INTO plan;
  INSERT INTO c1_plans VALUES (4, 'tdf_holdings selective by snapshot_id',
    '', plan->0->'Plan'->>'Node Type', (plan->0->>'Execution Time')::numeric);

  PERFORM set_config('role', 'postgres', true);
END $plans$;

DO $report$
DECLARE body text;
BEGIN
  SELECT string_agg(format('  %s  %-42s %-28s %s ms   [%s]',
                           seq, label, plan_head, round(ms, 1), rows_scanned), chr(10) ORDER BY seq)
    INTO body FROM c1_plans;
  RAISE EXCEPTION E'\n=== C1 QUERY PLANS UNDER SYNTHETIC VOLUME ===\n%\n', body;
END $report$;
