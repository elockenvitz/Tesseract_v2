-- =============================================================================
-- asset_earnings_dates: the privileges RLS does not govern
--
-- Guards the fix in
-- supabase/migrations/20261109200000_sec_earnings_dates_revoke_dangerous_grants.sql.
--
-- THE DEFECT
--
--   20261109190003 denied INSERT/UPDATE/DELETE on the global earnings calendar
--   by dropping its ALL policy. The companion suite
--   (asset-earnings-dates-write-authority.sql) proves those three verbs are
--   refused. It does NOT prove the table is protected, because four privileges
--   are outside RLS entirely:
--
--     TRUNCATE    empties the table whatever the USING clause says
--     TRIGGER     attaches a function that then runs on other callers' writes
--     REFERENCES  creates a foreign key against it
--     MAINTAIN    VACUUM / ANALYZE / REINDEX / CLUSTER / REFRESH (PG 17+)
--
--   Measured on production 2026-11-09, `authenticated` held all four. So an
--   ordinary user in any organization could not insert one earnings row but
--   could empty the entire calendar every tenant reads. A policy cannot stop a
--   TRUNCATE; only the grant can.
--
-- ── Why assertion 1 attempts the statement and 2-4 read the privilege ─────
--
-- Assertion 1 runs a real TRUNCATE as a real `authenticated` session, because
-- that is the sharp privilege and a statement that executes is the only
-- unambiguous proof. It is safe: the table holds 0 rows, and the whole suite
-- runs inside a transaction that rolls back.
--
-- Assertions 2-4 read has_table_privilege instead of attempting the DDL.
-- CREATE TRIGGER additionally requires ownership of the trigger function, and
-- adding a foreign key requires CREATE on a schema, so `authenticated` would be
-- refused for a SECOND reason and the assertion would pass without observing
-- the privilege at all -- a test passing for the wrong reason, which is the
-- defect class this file exists to avoid. has_table_privilege answers exactly
-- the one question, and it folds in role membership, which reading
-- pg_class.relacl does not: supabase_admin holds TRUNCATE through membership
-- with no ACL entry of its own.
--
-- ── Expected results ──────────────────────────────────────────────────────
--
--   BEFORE the migration:
--       2 PASS, 4 FAIL - assertions 1, 2, 3 and 4 MUST fail.
--       If fewer fail, this test is decoration and must not be trusted.
--
--   AFTER the migration:
--       6 PASS, 0 FAIL.
--
-- Assertions 5 and 6 pass in BOTH states by design. They are the preserve side:
-- 5 proves the ingestion path still has the authority to replace the calendar
-- wholesale, and 6 proves the reads two attention surfaces depend on still
-- work. A fix that revoked SELECT, or that revoked from service_role, would
-- pass assertions 1-4 and fail here.
--
-- Self-cleaning: creates nothing. 6 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _aedp_results;
CREATE TEMP TABLE _aedp_results(n int, result text, detail text);

DO $$
DECLARE
  v_truncated boolean := false;
  v_state     text;
  v_pass      int := 0;
  v_fail      int := 0;
BEGIN
  RAISE NOTICE '=== asset_earnings_dates privilege authority ===';

  -- ===========================================================================
  -- 1. THE FINDING. A real authenticated session must not be able to empty the
  --    calendar. RLS is irrelevant here: TRUNCATE is not policy-governed, so
  --    the only thing standing in the way is the absence of the grant.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE authenticated;
    TRUNCATE TABLE public.asset_earnings_dates;
    v_truncated := true;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; RESET ROLE; v_truncated := false;
  END;
  IF NOT v_truncated THEN
    v_pass := v_pass + 1;
    INSERT INTO _aedp_results VALUES (1, 'PASS', format('authenticated cannot TRUNCATE the calendar (%s)', coalesce(v_state,'refused')));
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _aedp_results VALUES (1, 'FAIL', 'CALENDAR TRUNCATED: authenticated emptied a table every tenant reads');
  END IF;

  -- ===========================================================================
  -- 2. TRIGGER. Attaching a function to this table would let it run on another
  --    caller's write, inside that caller's transaction.
  -- ===========================================================================
  IF NOT has_table_privilege('authenticated', 'public.asset_earnings_dates', 'TRIGGER') THEN
    v_pass := v_pass + 1; INSERT INTO _aedp_results VALUES (2, 'PASS', 'authenticated holds no TRIGGER');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _aedp_results VALUES (2, 'FAIL', 'authenticated holds TRIGGER on the calendar');
  END IF;

  -- ===========================================================================
  -- 3. REFERENCES. A foreign key pointed at this table constrains the owner's
  --    own deletes from it.
  -- ===========================================================================
  IF NOT has_table_privilege('authenticated', 'public.asset_earnings_dates', 'REFERENCES') THEN
    v_pass := v_pass + 1; INSERT INTO _aedp_results VALUES (3, 'PASS', 'authenticated holds no REFERENCES');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _aedp_results VALUES (3, 'FAIL', 'authenticated holds REFERENCES on the calendar');
  END IF;

  -- ===========================================================================
  -- 4. MAINTAIN (PG 17+). VACUUM FULL / CLUSTER take an ACCESS EXCLUSIVE lock,
  --    so this is a denial-of-service grant on a table every tenant reads.
  -- ===========================================================================
  IF NOT has_table_privilege('authenticated', 'public.asset_earnings_dates', 'MAINTAIN') THEN
    v_pass := v_pass + 1; INSERT INTO _aedp_results VALUES (4, 'PASS', 'authenticated holds no MAINTAIN');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _aedp_results VALUES (4, 'FAIL', 'authenticated holds MAINTAIN on the calendar');
  END IF;

  -- ===========================================================================
  -- 5. PRESERVE the ingestion path. service_role must keep the authority to
  --    replace the calendar wholesale, including TRUNCATE. A sweep that
  --    revoked from every role would pass 1-4 and break the loader that has
  --    not been written yet.
  -- ===========================================================================
  IF has_table_privilege('service_role', 'public.asset_earnings_dates', 'TRUNCATE')
     AND has_table_privilege('service_role', 'public.asset_earnings_dates', 'INSERT')
     AND has_table_privilege('service_role', 'public.asset_earnings_dates', 'SELECT') THEN
    v_pass := v_pass + 1; INSERT INTO _aedp_results VALUES (5, 'PASS', 'service_role retains TRUNCATE, INSERT and SELECT');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _aedp_results VALUES (5, 'FAIL', 'INGESTION BROKEN: service_role lost a privilege it needs');
  END IF;

  -- ===========================================================================
  -- 6. PRESERVE the reads. useAssetEvents, useAttention and useCommandCenter
  --    all select from this table; anon must still hold nothing.
  -- ===========================================================================
  IF has_table_privilege('authenticated', 'public.asset_earnings_dates', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.asset_earnings_dates', 'SELECT')
     AND NOT has_table_privilege('anon', 'public.asset_earnings_dates', 'TRUNCATE') THEN
    v_pass := v_pass + 1; INSERT INTO _aedp_results VALUES (6, 'PASS', 'authenticated keeps SELECT; anon holds nothing');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _aedp_results VALUES (6, 'FAIL', 'read path or anon posture is wrong');
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 6 assertions ===', v_pass, v_fail;
  RAISE NOTICE 'Before the migration, 1, 2, 3 and 4 MUST be among the failures.';
END;
$$;

SELECT n, result, detail FROM _aedp_results ORDER BY n, result;
