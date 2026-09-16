-- Does pilot seeding count what it actually seeded?
--
-- Run against a database that has `seed_pilot_template_portfolio` applied:
--
--     psql "$DATABASE_URL" -f scripts/verify-seed-accounting.sql
--
-- It seeds two throwaway portfolios in a throwaway org and then ALWAYS raises,
-- so the whole probe rolls back and nothing survives. A pass looks like:
--
--     ERROR:  ROLLBACK_OK: all 3 cases passed
--
-- which is a deliberate error and the only success condition. Any other
-- message is a real failure and names the assertion that broke.
--
-- ── Why a probe rather than a unit test ────────────────────────────────────
--
-- The accounting lives in plpgsql: the INNER join that drops an unresolvable
-- symbol, and the counts written to `portfolio_holdings_snapshots` and
-- returned to the caller. A TypeScript test can assert the shape of the SQL
-- source but not that Postgres produced 2 rows and said "2". This calls the
-- real function against real tables and reads back what landed.
--
-- The historical bug this guards against: `positions_loaded` was
-- `jsonb_array_length(p_positions)` computed BEFORE the join, so the seed
-- claimed 35 while holding 34, and `total_positions` and
-- `portfolio_holdings_positions` agreed with the claim rather than the book.

do $$
declare
  v_admin uuid;
  v_org uuid;
  r1 jsonb; r2 jsonb;
  v_hold int; v_pos int; v_snap_total int; v_pid uuid;
  fails text[] := '{}';
begin
  -- `is_platform_admin()` reads auth.uid(); borrow a real admin's identity for
  -- this transaction only. Nothing is written as them — it all rolls back.
  select user_id into v_admin from platform_admins limit 1;
  if v_admin is null then raise exception 'no platform admin to impersonate'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  insert into organizations (name, slug, settings)
  values ('ZZ_seed_semantics_probe', 'zz-seed-semantics-probe', '{"pilot_mode": true}'::jsonb)
  returning id into v_org;

  -- ── 1. Every template symbol resolves ────────────────────────────────
  -- requested = loaded, unresolved empty, and all three stores agree.
  r1 := public.seed_pilot_template_portfolio(
    v_org, 'Probe All Resolve', 'S&P 500',
    '[{"symbol":"AAPL","shares":10,"price":100,"weight_pct":50,"sector":"Technology"},
      {"symbol":"MSFT","shares":10,"price":100,"weight_pct":50,"sector":"Technology"}]'::jsonb,
    '[]'::jsonb, v_admin, 0);

  if (r1->>'positions_requested')::int <> 2 then fails := fails || 'c1 requested<>2'; end if;
  if (r1->>'positions_loaded')::int    <> 2 then fails := fails || 'c1 loaded<>2'; end if;
  if jsonb_array_length(r1->'unresolved_symbols') <> 0 then fails := fails || 'c1 unresolved not empty'; end if;

  v_pid := (r1->>'portfolio_id')::uuid;
  select count(*) into v_hold from portfolio_holdings where portfolio_id = v_pid;
  select count(*) into v_pos  from portfolio_holdings_positions where portfolio_id = v_pid;
  select total_positions into v_snap_total from portfolio_holdings_snapshots where portfolio_id = v_pid;
  if v_hold <> 2 then fails := fails || ('c1 holdings='||v_hold); end if;
  if v_pos  <> 2 then fails := fails || ('c1 positions='||v_pos); end if;
  if v_snap_total <> 2 then fails := fails || ('c1 snapshot_total='||v_snap_total); end if;

  -- ── 2. One symbol cannot resolve ─────────────────────────────────────
  -- Loaded is one lower, the snapshot matches the rows that exist, the name
  -- is listed, and the seed still succeeds.
  r2 := public.seed_pilot_template_portfolio(
    v_org, 'Probe One Missing', 'S&P 500',
    '[{"symbol":"AAPL","shares":10,"price":100,"weight_pct":33,"sector":"Technology"},
      {"symbol":"MSFT","shares":10,"price":100,"weight_pct":33,"sector":"Technology"},
      {"symbol":"ZZZZNOTREAL","shares":10,"price":100,"weight_pct":34,"sector":"Technology"}]'::jsonb,
    '[]'::jsonb, v_admin, 0);

  if (r2->>'positions_requested')::int <> 3 then fails := fails || 'c2 requested<>3'; end if;
  if (r2->>'positions_loaded')::int    <> 2 then fails := fails || ('c2 loaded='||(r2->>'positions_loaded')); end if;
  if r2->'unresolved_symbols' <> '["ZZZZNOTREAL"]'::jsonb then
    fails := fails || ('c2 unresolved='||(r2->>'unresolved_symbols'));
  end if;

  v_pid := (r2->>'portfolio_id')::uuid;
  select count(*) into v_hold from portfolio_holdings where portfolio_id = v_pid;
  select count(*) into v_pos  from portfolio_holdings_positions where portfolio_id = v_pid;
  select total_positions into v_snap_total from portfolio_holdings_snapshots where portfolio_id = v_pid;
  if v_hold <> 2 then fails := fails || ('c2 holdings='||v_hold); end if;
  if v_pos  <> 2 then fails := fails || ('c2 positions='||v_pos); end if;
  if v_snap_total <> 2 then fails := fails || ('c2 snapshot_total='||v_snap_total); end if;

  -- ── 3. No silent claim the missing symbol was loaded ─────────────────
  if exists (select 1 from portfolio_holdings_positions
              where portfolio_id = v_pid and symbol = 'ZZZZNOTREAL') then
    fails := fails || 'c3 missing symbol present in positions';
  end if;
  if v_snap_total >= (r2->>'positions_requested')::int then
    fails := fails || 'c3 snapshot still claims the requested count';
  end if;

  if array_length(fails, 1) is not null then
    raise exception 'SEED SEMANTICS FAILED: %', array_to_string(fails, ' | ');
  end if;

  raise exception 'ROLLBACK_OK: all 3 cases passed';
end $$;
