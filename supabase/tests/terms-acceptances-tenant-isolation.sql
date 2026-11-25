-- =============================================================================
-- terms_acceptances — tenant isolation and write-path authorization
--
-- RUN AGAINST AN ISOLATED LOCAL CLUSTER, NEVER PRODUCTION.
--   scripts/sql/isolated/README.md has the procedure. In short:
--     psql $URL -f scripts/sql/isolated/00-harness.sql
--     psql $URL -f scripts/sql/isolated/11-terms-acceptance-objects.sql
--     psql $URL -f supabase/tests/terms-acceptances-tenant-isolation.sql
--
-- EXPECTED GRID
--
--   Before the migration : the whole suite ERRORS on the first statement
--                          touching public.terms_acceptances -- the relation
--                          does not exist. That is the correct baseline. A
--                          suite that goes green before the thing it tests
--                          exists is testing nothing, which is a documented
--                          recurring defect in this repository.
--   After the migration  : 16 of 16 PASS.
--   After the rollback   : errors again, as before the migration.
--
-- WHAT IS PROVEN, AND WHAT EACH CASE WOULD CATCH
--
-- Denials alone are not enough. A denial-only suite reads green against a
-- dead end -- a table nothing can write to denies everything, including the
-- legitimate case. So every denial here is paired with the matching ALLOW,
-- and the allows come first.
--
-- Wrapped in BEGIN/ROLLBACK, so the cluster is unchanged afterwards and the
-- suite can be re-run without a teardown step.
-- =============================================================================

\set ON_ERROR_STOP off
\pset pager off

BEGIN;

-- ─── Fixtures, written as postgres so RLS does not gate the setup ───────────

-- Two organizations.
INSERT INTO public.organizations (id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Org A'),
  ('b0000000-0000-0000-0000-000000000002', 'Org B');

-- Four users: an Org A member, an Org A admin, an Org B member, and a person
-- who was an Org A member and is not any more.
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333'),
  ('44444444-4444-4444-4444-444444444444');

-- UPDATE, not INSERT: a trigger on auth.users already created these rows, in
-- both production and the harness. The column is `current_organization_id`,
-- which is what current_org_id() reads.
UPDATE public.users SET current_organization_id = 'a0000000-0000-0000-0000-000000000001'
 WHERE id IN ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              '44444444-4444-4444-4444-444444444444');
UPDATE public.users SET current_organization_id = 'b0000000-0000-0000-0000-000000000002'
 WHERE id = '33333333-3333-3333-3333-333333333333';

INSERT INTO public.organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active',  false),
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'active',  true),
  ('b0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'active',  false),
  -- The removed member: the row survives, the status does not. This is how
  -- membership actually ends in this schema, so it is how it must be tested.
  ('a0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'removed', false);

-- Helper: become a user, the way Supabase does it.
CREATE OR REPLACE FUNCTION pg_temp.become(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
$$;

-- Helper: record a result row.
CREATE TEMP TABLE results (n int, name text, pass boolean, detail text);
-- The suite runs most of its cases as `authenticated`, and this table is owned
-- by postgres. Without the grant every case fails with "permission denied for
-- table results" -- which looks exactly like a red baseline, and is not one.
-- That happened on the first run here.
GRANT INSERT, SELECT ON results TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.check(p_n int, p_name text, p_pass boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (p_n, p_name, p_pass, p_detail);
$$;

-- =============================================================================
-- PART 1 — the legitimate paths. These must pass, or every denial below is
-- vacuous.
-- =============================================================================

SET ROLE authenticated;
SELECT pg_temp.become('11111111-1111-1111-1111-111111111111');

-- 1. A member records their own acceptance for their own organization.
DO $$
DECLARE v timestamptz;
BEGIN
  v := public.record_terms_acceptance(
    'application-terms', '1.0.0', 'a0000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.check(1, 'member can record an acceptance', v IS NOT NULL,
    coalesce(v::text, 'returned NULL'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check(1, 'member can record an acceptance', false, SQLERRM);
END
$$;

-- 2. The timestamp came from the server, not the client.
DO $$
DECLARE v timestamptz;
BEGIN
  SELECT accepted_at INTO v FROM public.terms_acceptances
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  PERFORM pg_temp.check(2, 'accepted_at is a server timestamp',
    v IS NOT NULL AND v <= now() AND v > now() - interval '1 minute',
    coalesce(v::text, 'NULL'));
END
$$;

-- 3. They can read their own row back.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.terms_acceptances;
  PERFORM pg_temp.check(3, 'member reads own acceptance', n = 1, format('saw %s rows', n));
END
$$;

-- 4. Recording the same version twice is idempotent and still returns a time.
DO $$
DECLARE v timestamptz; n int;
BEGIN
  v := public.record_terms_acceptance(
    'application-terms', '1.0.0', 'a0000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE user_id = '11111111-1111-1111-1111-111111111111'
     AND document_id = 'application-terms';
  PERFORM pg_temp.check(4, 'a second click is idempotent and returns a time',
    v IS NOT NULL AND n = 1, format('rows=%s, returned=%s', n, coalesce(v::text,'NULL')));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check(4, 'a second click is idempotent and returns a time', false, SQLERRM);
END
$$;

-- 5. A different VERSION is a separate record, not an overwrite.
DO $$
DECLARE n int;
BEGIN
  PERFORM public.record_terms_acceptance(
    'application-terms', '2.0.0', 'a0000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE user_id = '11111111-1111-1111-1111-111111111111'
     AND document_id = 'application-terms';
  PERFORM pg_temp.check(5, 'a new version is a new record', n = 2, format('saw %s rows', n));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check(5, 'a new version is a new record', false, SQLERRM);
END
$$;

-- 6. An acceptance with no organization is allowed (signup before membership).
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.become('33333333-3333-3333-3333-333333333333');
DO $$
DECLARE v timestamptz;
BEGIN
  v := public.record_terms_acceptance('financial-ai-disclosures', '1.0.0', NULL);
  PERFORM pg_temp.check(6, 'an acceptance with no organization is allowed',
    v IS NOT NULL, coalesce(v::text, 'returned NULL'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check(6, 'an acceptance with no organization is allowed', false, SQLERRM);
END
$$;

-- 7. An ACTIVE ADMIN of org A sees org A's acceptances.
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.become('22222222-2222-2222-2222-222222222222');
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';
  -- The two rows user 1 wrote for org A.
  PERFORM pg_temp.check(7, 'an active org admin reads their org''s acceptances',
    n = 2, format('saw %s rows', n));
END
$$;

-- =============================================================================
-- PART 2 — cross-organization denial.
-- =============================================================================

-- 8. Org B's member cannot see org A's acceptances.
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.become('33333333-3333-3333-3333-333333333333');
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';
  PERFORM pg_temp.check(8, 'cross-org read is denied', n = 0, format('saw %s rows', n));
END
$$;

-- 9. Org B's member cannot see org A's rows at all, by any route.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  PERFORM pg_temp.check(9, 'another user''s acceptances are invisible',
    n = 0, format('saw %s rows', n));
END
$$;

-- 10. Org B's member cannot attach their acceptance to org A.
DO $$
DECLARE v timestamptz;
BEGIN
  v := public.record_terms_acceptance(
    'application-terms', '1.0.0', 'a0000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.check(10, 'recording against a foreign org is refused', false,
    format('NOT refused; returned %s', v));
EXCEPTION WHEN OTHERS THEN
  -- The exception IS the pass. It must be the authorization error, not a
  -- constraint violation that happens to look like one.
  PERFORM pg_temp.check(10, 'recording against a foreign org is refused',
    SQLSTATE = '42501', format('%s / %s', SQLSTATE, SQLERRM));
END
$$;

-- 11. ...and the refusal left NO row behind.
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
  -- As postgres, so RLS cannot hide a row that was actually written.
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE user_id = '33333333-3333-3333-3333-333333333333'
     AND organization_id = 'a0000000-0000-0000-0000-000000000001';
  PERFORM pg_temp.check(11, 'a refused call writes nothing', n = 0, format('found %s rows', n));
END
$$;

-- =============================================================================
-- PART 3 — a removed member.
-- =============================================================================

-- 12. Someone whose membership ended cannot record against that org.
SET ROLE authenticated;
SELECT pg_temp.become('44444444-4444-4444-4444-444444444444');
DO $$
BEGIN
  PERFORM public.record_terms_acceptance(
    'application-terms', '1.0.0', 'a0000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.check(12, 'a removed member cannot record against the org', false,
    'NOT refused');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check(12, 'a removed member cannot record against the org',
    SQLSTATE = '42501', format('%s / %s', SQLSTATE, SQLERRM));
END
$$;

-- 13. A removed ADMIN would lose the org view. Tested by promoting the removed
--     user to admin while leaving them removed: the admin flag must not be
--     enough on its own.
RESET ROLE;
UPDATE public.organization_memberships
   SET is_org_admin = true
 WHERE user_id = '44444444-4444-4444-4444-444444444444';
SET ROLE authenticated;
SELECT pg_temp.become('44444444-4444-4444-4444-444444444444');
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';
  PERFORM pg_temp.check(13, 'a removed admin sees nothing', n = 0, format('saw %s rows', n));
END
$$;

-- =============================================================================
-- PART 4 — the record cannot be altered.
-- =============================================================================

-- 14. A user cannot UPDATE their own acceptance. An editable acceptance record
--     is not evidence.
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.become('11111111-1111-1111-1111-111111111111');
DO $$
DECLARE n int;
BEGIN
  UPDATE public.terms_acceptances SET document_version = 'tampered'
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE document_version = 'tampered';
  -- Either the statement errors (no privilege) or it silently affects zero
  -- rows (no policy). Both are acceptable; a changed row is not.
  PERFORM pg_temp.check(14, 'a user cannot alter their acceptance', n = 0,
    format('%s rows tampered', n));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check(14, 'a user cannot alter their acceptance', true,
    format('refused: %s', SQLSTATE));
END
$$;

-- 15. A user cannot DELETE their acceptance.
DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.terms_acceptances
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  SELECT count(*) INTO n FROM public.terms_acceptances
   WHERE user_id = '11111111-1111-1111-1111-111111111111';
  PERFORM pg_temp.check(15, 'a user cannot delete their acceptance', n = 2,
    format('%s rows remain of 2', n));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check(15, 'a user cannot delete their acceptance', true,
    format('refused: %s', SQLSTATE));
END
$$;

-- 16. A user cannot claim a stronger acceptance method than a click.
DO $$
BEGIN
  PERFORM public.record_terms_acceptance(
    'application-terms', '3.0.0', 'a0000000-0000-0000-0000-000000000001',
    'signed_agreement');
  PERFORM pg_temp.check(16, 'a user cannot self-record a signed agreement', false,
    'NOT refused');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check(16, 'a user cannot self-record a signed agreement',
    SQLSTATE = '42501', format('%s / %s', SQLSTATE, SQLERRM));
END
$$;

-- =============================================================================
-- RESULTS
-- =============================================================================

RESET ROLE;

SELECT n,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result,
       name,
       detail
  FROM results
 ORDER BY n;

SELECT count(*) FILTER (WHERE pass)     AS passed,
       count(*) FILTER (WHERE NOT pass) AS failed,
       count(*)                         AS total
  FROM results;

ROLLBACK;
