-- decision_reviews tenant isolation — preflight, evidence and verification.
--
-- Read-only. Run sections 1-2 BEFORE the migration and keep the output;
-- sections 3-6 AFTER. Every number in the rollout plan comes from here, so
-- the plan is checkable rather than asserted.
--
--   psql "$DATABASE_URL" -f scripts/sql/decision-reviews/verify.sql
--
-- The RLS behaviour tests in section 6 need two real users in two different
-- organizations. They are written as explicit `set local role` /
-- `request.jwt.claims` blocks so they can run against a branch database
-- without the application.

\echo '== 1. PREFLIGHT: current state =='

-- 1a. The policies as they stand. Expect exactly one SELECT with qual = true.
SELECT polname,
       CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                   WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE polcmd::text END AS cmd,
       pg_get_expr(polqual,      polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
  FROM pg_policy
 WHERE polrelid = 'public.decision_reviews'::regclass
 ORDER BY polname;

-- 1b. RLS enabled / forced.
SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
  FROM pg_class WHERE oid = 'public.decision_reviews'::regclass;

-- 1c. Grants. Expect anon to hold SELECT before, none after.
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'decision_reviews'
 GROUP BY grantee ORDER BY grantee;

\echo '== 2. PREFLIGHT: row counts and resolvability (the backfill evidence) =='

-- 2a. Total rows. Expected: 7. This number must not change.
SELECT count(*) AS total_rows FROM public.decision_reviews;

-- 2b. How many rows resolve to each parent, and how many to none.
--     Expected before: resolvable = 1, unresolvable = 6.
SELECT
  count(*) FILTER (WHERE tqi.id IS NOT NULL) AS via_trade_queue_items,
  count(*) FILTER (WHERE dr2.id IS NOT NULL) AS via_decision_requests,
  count(*) FILTER (WHERE pte.id IS NOT NULL) AS via_trade_events,
  count(*) FILTER (WHERE tqi.id IS NULL AND dr2.id IS NULL AND pte.id IS NULL)
    AS unresolvable
FROM public.decision_reviews r
LEFT JOIN public.trade_queue_items      tqi ON tqi.id::text = r.decision_id
LEFT JOIN public.decision_requests      dr2 ON dr2.id::text = r.decision_id
LEFT JOIN public.portfolio_trade_events pte ON pte.id::text = r.decision_id;

-- 2c. The rows, with the owner each WOULD be given. Keep this output: it is
--     the backfill evidence, and the quarantine list.
SELECT r.id,
       r.decision_id,
       r.reviewed_by,
       (r.process_note IS NOT NULL) AS has_process_note,
       p.organization_id AS would_backfill_to,
       CASE WHEN p.organization_id IS NULL THEN 'QUARANTINE' ELSE 'backfill' END AS disposition
  FROM public.decision_reviews r
  LEFT JOIN public.portfolios p
         ON p.id = public.decision_review_portfolio(r.decision_id)  -- post-migration only
 ORDER BY disposition, r.created_at;

-- 2d. How many distinct organizations currently see every row (the exposure).
SELECT count(DISTINCT m.organization_id) AS orgs_that_can_read_everything
  FROM public.organization_memberships m
 WHERE coalesce(m.status, 'active') = 'active';

\echo '== 3. POST: ownership was derived, not invented =='

-- Expect: owned = 1, quarantined = 6, total still 7.
SELECT count(*)                                        AS total_rows,
       count(organization_id)                          AS owned_rows,
       count(*) - count(organization_id)               AS quarantined_rows
  FROM public.decision_reviews;

-- Every owned row's organization must match what the decision resolves to.
-- Expect zero rows. A row here means an owner was fabricated.
SELECT r.id, r.organization_id AS stamped, p.organization_id AS derived
  FROM public.decision_reviews r
  LEFT JOIN public.portfolios p
         ON p.id = public.decision_review_portfolio(r.decision_id)
 WHERE r.organization_id IS DISTINCT FROM p.organization_id
   AND r.organization_id IS NOT NULL;

\echo '== 4. POST: policies replaced =='

-- Expect three policies, none with a `true` qual.
SELECT polname,
       CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                   WHEN 'w' THEN 'UPDATE' ELSE polcmd::text END AS cmd,
       pg_get_expr(polqual, polrelid)      AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
  FROM pg_policy
 WHERE polrelid = 'public.decision_reviews'::regclass
 ORDER BY polname;

-- Hard assertion: no unconditional predicate survives on this table.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_policy
   WHERE polrelid = 'public.decision_reviews'::regclass
     AND coalesce(pg_get_expr(polqual, polrelid), '') IN ('true', '(true)');
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL: % unconditional policy predicate(s) remain', n;
  END IF;
  RAISE NOTICE 'OK: no unconditional predicate on decision_reviews';
END $$;

\echo '== 5. POST: anon is denied by grant as well as by policy =='

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'decision_reviews'
     AND grantee IN ('anon', 'PUBLIC');
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL: anon/PUBLIC still holds % grant(s)', n;
  END IF;
  RAISE NOTICE 'OK: anon and PUBLIC hold no grant';
END $$;

\echo '== 6. POST: behavioural checks (branch database only) =='
--
-- Requires: :user_a / :org_a  (a member of the org owning a resolvable
--           decision :decision_a) and :user_b / :org_b (a different org).
-- Invoke with -v user_a=... -v user_b=... -v decision_a=... -v other_decision=...
--
-- Each block asserts and raises on failure, so a clean run means every case
-- below actually passed rather than merely not erroring.

-- 6a. SAME-TENANT AUTHORIZED SELECT — the owner's org can read its own row.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', :'user_a', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.decision_reviews
   WHERE decision_id = :'decision_a';
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 6a: owner org read % rows, expected 1', n; END IF;
  RAISE NOTICE 'OK 6a: same-tenant authorized SELECT returns the row';
END $$;

-- 6b. CROSS-TENANT SELECT DENIED — the other org sees nothing at all.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', :'user_b', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.decision_reviews;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6b: foreign org read % rows, expected 0', n; END IF;
  RAISE NOTICE 'OK 6b: cross-tenant SELECT returns nothing';
END $$;

-- 6c. CROSS-TENANT INSERT DENIED — the squat that caused the DoS.
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', :'user_b', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.decision_reviews (decision_id, reviewed_by, decision_quality)
    VALUES (:'decision_a', :'user_b'::uuid, 'bad');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    ok := true;
  END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 6c: foreign INSERT on another org''s decision succeeded'; END IF;
  RAISE NOTICE 'OK 6c: cross-tenant INSERT denied';
END $$;

-- 6d. CROSS-TENANT UPDATE DENIED.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', :'user_b', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.decision_reviews SET decision_quality = 'bad'
   WHERE decision_id = :'decision_a';
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6d: foreign UPDATE touched % rows', n; END IF;
  RAISE NOTICE 'OK 6d: cross-tenant UPDATE touches nothing';
END $$;

-- 6e. CROSS-TENANT UPSERT DENIED — the client''s actual write shape
--     (upsert on decision_id). Must not resolve into a permitted UPDATE.
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', :'user_b', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.decision_reviews (decision_id, reviewed_by, decision_quality)
    VALUES (:'decision_a', :'user_b'::uuid, 'bad')
    ON CONFLICT (decision_id) DO UPDATE SET decision_quality = excluded.decision_quality;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    ok := true;
  END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 6e: foreign UPSERT succeeded'; END IF;
  RAISE NOTICE 'OK 6e: cross-tenant upsert denied';
END $$;

-- 6f. HISTORICAL ORPHAN QUARANTINE — the six preserved rows are visible to
--     nobody, and are still there.
DO $$
DECLARE visible int; present int;
BEGIN
  SELECT count(*) INTO present FROM public.decision_reviews WHERE organization_id IS NULL;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', :'user_a', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO visible FROM public.decision_reviews WHERE organization_id IS NULL;
  RESET ROLE;
  IF visible <> 0 THEN RAISE EXCEPTION 'FAIL 6f: % quarantined rows are visible', visible; END IF;
  IF present = 0 THEN RAISE EXCEPTION 'FAIL 6f: quarantined rows were deleted'; END IF;
  RAISE NOTICE 'OK 6f: % quarantined rows preserved and invisible', present;
END $$;

-- 6g. A LEGITIMATE REVIEWER IS NOT BLOCKED — the requirement that the fix
--     must not lock the rightful owner out of their own review.
DO $$
DECLARE ok boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', :'user_a', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.decision_reviews (decision_id, reviewed_by, decision_quality)
    VALUES (:'decision_a', :'user_a'::uuid, 'good')
    ON CONFLICT (decision_id) DO UPDATE SET decision_quality = excluded.decision_quality;
  EXCEPTION WHEN OTHERS THEN
    ok := false;
    RAISE NOTICE 'detail: %', SQLERRM;
  END;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 6g: the rightful reviewer was blocked'; END IF;
  RAISE NOTICE 'OK 6g: rightful reviewer can write';
END $$;

\echo '== 7. POST: the pre-flight hardening, each as its own assertion =='

-- 7a. AMBIGUITY FAILS CLOSED. A decision_id owned by two distinct portfolios
--     must resolve to NULL, not to whichever table was checked first.
DO $$
DECLARE
  v_p1 uuid; v_p2 uuid; v_res uuid; v_id text := 'verify-ambiguous-' || gen_random_uuid()::text;
BEGIN
  SELECT id INTO v_p1 FROM public.portfolios ORDER BY id LIMIT 1;
  SELECT id INTO v_p2 FROM public.portfolios WHERE id <> v_p1 ORDER BY id LIMIT 1;
  IF v_p2 IS NULL THEN RAISE NOTICE 'SKIP 7a: needs two portfolios'; RETURN; END IF;

  -- Two parents, same id, different owners. Rolled back at the end.
  INSERT INTO public.trade_queue_items (id, portfolio_id) VALUES (v_id::uuid, v_p1);
  INSERT INTO public.decision_requests (id, portfolio_id) VALUES (v_id::uuid, v_p2);
  v_res := public.decision_review_portfolio(v_id);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 7a: ambiguous decision_id resolved to %, expected NULL', v_res;
  END IF;
  RAISE NOTICE 'OK 7a: two distinct owners resolve to NULL';
  RAISE EXCEPTION 'rollback_7a';     -- undo the fixtures
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback_7a' THEN RAISE; END IF;
END $$;

-- 7b. decision_id IS IMMUTABLE. Changing it would migrate a row between
--     organizations under the guise of an edit.
DO $$
DECLARE ok boolean := false; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.decision_reviews WHERE organization_id IS NOT NULL LIMIT 1;
  IF v_id IS NULL THEN RAISE NOTICE 'SKIP 7b: no owned row'; RETURN; END IF;
  BEGIN
    UPDATE public.decision_reviews SET decision_id = decision_id || '-moved' WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 7b: decision_id was mutable'; END IF;
  RAISE NOTICE 'OK 7b: decision_id is immutable';
END $$;

-- 7c. AN OPERATOR CAN STILL REPAIR A QUARANTINED ROW. The trigger must not
--     raise on UPDATE of an unresolvable row, or the only repair path for
--     the six orphans is bricked. Runs as the migration role (RLS bypassed),
--     which is how a repair would actually be performed.
DO $$
DECLARE v_id uuid; n int;
BEGIN
  SELECT id INTO v_id FROM public.decision_reviews WHERE organization_id IS NULL LIMIT 1;
  IF v_id IS NULL THEN RAISE NOTICE 'SKIP 7c: no quarantined row'; RETURN; END IF;
  UPDATE public.decision_reviews SET process_note = process_note WHERE id = v_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7c: could not touch a quarantined row'; END IF;
  -- and it is still quarantined, not silently adopted
  PERFORM 1 FROM public.decision_reviews WHERE id = v_id AND organization_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 7c: a quarantined row acquired an owner'; END IF;
  RAISE NOTICE 'OK 7c: quarantined rows remain repairable and still quarantined';
END $$;

-- 7d. FUNCTION PRIVILEGE BOUNDARY. anon must hold no EXECUTE on either
--     resolver, and the trigger function must be callable by nobody.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public'
     AND routine_name IN ('decision_review_portfolio', 'can_review_decision',
                          'decision_reviews_set_owner')
     AND grantee IN ('anon', 'PUBLIC');
  IF n > 0 THEN RAISE EXCEPTION 'FAIL 7d: % anon/PUBLIC execute grant(s)', n; END IF;

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('decision_review_portfolio', 'can_review_decision',
                       'decision_reviews_set_owner')
     AND p.prosecdef
     AND NOT (coalesce(array_to_string(p.proconfig, ','), '') LIKE '%search_path=%');
  IF n > 0 THEN RAISE EXCEPTION 'FAIL 7d: % SECURITY DEFINER function(s) with no pinned search_path', n; END IF;
  RAISE NOTICE 'OK 7d: execute grants and search_path pinning are correct';
END $$;

\echo '== done =='
