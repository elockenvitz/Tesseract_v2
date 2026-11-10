-- Finish the asset_earnings_dates fix: remove the privileges RLS does not govern.
--
-- ── Why this exists ───────────────────────────────────────────────────────
--
-- 20261109190003 denied writes to the global earnings calendar by dropping the
-- ALL policy, so with RLS on and no INSERT/UPDATE/DELETE policy every role that
-- does not bypass RLS is refused. That is correct for the three DML verbs and
-- incomplete for the table, because FOUR privileges are not governed by RLS at
-- all:
--
--   TRUNCATE    empties the table whatever the USING clause says
--   TRIGGER     attaches a function to the table, which then runs on other
--               callers' writes
--   REFERENCES  creates a foreign key against it, which constrains the owner's
--               own deletes
--   MAINTAIN    VACUUM / ANALYZE / REINDEX / CLUSTER / REFRESH (PG 17+)
--
-- So before this migration an ordinary authenticated user in any organization
-- could not insert one earnings row but COULD empty the whole calendar. That is
-- the residual hole the post-deployment privilege read-back surfaced, and it is
-- fixed here on its own rather than inside the broader sweep.
--
-- ── Measured on production 2026-11-09, before this migration ──────────────
--
--   pg_class.relacl, aclexplode'd:
--     authenticated   DELETE, INSERT, MAINTAIN, REFERENCES, SELECT,
--                     TRIGGER, TRUNCATE, UPDATE
--     service_role    the same eight
--     postgres        the same eight (and owns the table)
--     anon            NO ACL ENTRY AT ALL
--     PUBLIC ('-')    NO ACL ENTRY AT ALL
--
--   has_table_privilege(..., 'TRUNCATE'):
--     YES   authenticated, service_role, postgres, supabase_admin
--     no    anon, authenticator, dashboard_user, pgbouncer,
--           supabase_auth_admin, supabase_storage_admin
--
-- The effective check matters because membership grants privileges that never
-- appear in relacl: supabase_admin holds TRUNCATE through role membership, not
-- through an ACL entry. Reading relacl alone would have missed it. It is left
-- in place deliberately: it is the platform's administrative role.
--
-- ── What is deliberately preserved ────────────────────────────────────────
--
-- The trusted ingestion path. There is no earnings writer in the repository
-- today (grepping src, supabase/functions, scripts and .github finds zero
-- insert/update/upsert/delete against this table), so when one lands it must
-- run as service_role, which bypasses RLS. service_role and postgres keep the
-- complete set, including TRUNCATE, so a future loader can replace the calendar
-- wholesale. Nothing in this migration touches either role.
--
-- authenticated keeps SELECT, INSERT, UPDATE and DELETE. The three write verbs
-- are already denied by the absence of a policy; leaving the grants in place
-- keeps this migration to exactly one concern, and a grant without a policy
-- grants nothing.
--
-- ── Safe to run ───────────────────────────────────────────────────────────
--
--   rows in asset_earnings_dates:        0
--   non-internal triggers on the table:  0
--   inbound foreign keys:                0
--
-- So no existing trigger loses its grant and no existing FK loses its
-- REFERENCES. Nothing in the application can notice this change.

begin;

-- `anon` and PUBLIC hold no ACL entry today, but both revokes are issued
-- anyway: Supabase's ALTER DEFAULT PRIVILEGES grants to PUBLIC *and* directly
-- to anon, and neither revoke implies the other. If either grant is ever
-- re-created by a default-privilege change, this migration's intent is on the
-- record. A REVOKE of a privilege that was never granted is a no-op.
revoke truncate, references, trigger, maintain
  on public.asset_earnings_dates from public;

revoke truncate, references, trigger, maintain
  on public.asset_earnings_dates from anon;

-- The actual fix.
revoke truncate, references, trigger, maintain
  on public.asset_earnings_dates from authenticated;

comment on table public.asset_earnings_dates is
  'Global earnings calendar, read by every tenant. Writes are denied by the absence of any INSERT/UPDATE/DELETE policy; ingestion must run as service_role, which bypasses RLS. TRUNCATE, TRIGGER, REFERENCES and MAINTAIN are revoked from authenticated/anon/PUBLIC because RLS does not govern them: a policy cannot stop a TRUNCATE. service_role and postgres retain the full set.';

commit;

-- ── Verify after running (effective privileges, not statement success) ────
--
--   select r.rolname,
--          has_table_privilege(r.rolname,'public.asset_earnings_dates','TRUNCATE')  as trunc,
--          has_table_privilege(r.rolname,'public.asset_earnings_dates','TRIGGER')   as trig,
--          has_table_privilege(r.rolname,'public.asset_earnings_dates','REFERENCES')as refs,
--          has_table_privilege(r.rolname,'public.asset_earnings_dates','MAINTAIN')  as maint,
--          has_table_privilege(r.rolname,'public.asset_earnings_dates','SELECT')    as sel
--     from pg_roles r
--    where r.rolname in ('anon','authenticated','service_role','postgres');
--
--   expected: authenticated f f f f t  ·  anon f f f f f
--             service_role  t t t t t  ·  postgres t t t t t
--
-- Regression test: supabase/tests/asset-earnings-dates-privilege-authority.sql
