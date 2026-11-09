-- P3-2: remove the four table privileges RLS does not govern, schema-wide.
--
-- 20261109200000 did this for asset_earnings_dates alone, because that table
-- had just been protected by policy and the gap was glaring. This migration is
-- the same correction across the rest of `public`.
--
-- ── What RLS does not reach ───────────────────────────────────────────────
--
--   TRUNCATE    empties the table whatever any USING clause says
--   TRIGGER     attaches a function that then runs inside another caller's
--               write, in that caller's transaction
--   REFERENCES  points a foreign key at the table, constraining the owner's
--               own deletes
--   MAINTAIN    VACUUM / ANALYZE / REINDEX / CLUSTER / REFRESH (PG 17+).
--               VACUUM FULL and CLUSTER take ACCESS EXCLUSIVE, so this is a
--               denial-of-service grant on any table the app reads.
--
-- A policy cannot stop any of the four. Only the grant can.
--
-- ── Measured on production 2026-11-09, before this migration ──────────────
--
-- From pg_class.relacl, aclexplode'd, over relkind in ('r','p') in `public`:
--
--   grantee         tables  TRUNCATE  REFERENCES  TRIGGER  MAINTAIN
--   postgres           295       295         295      295       295
--   service_role       295       295         295      295       295
--   authenticated      279       261         262      262       279
--   anon               185       185         185      185       185
--
-- `anon` holds TRUNCATE on 185 public tables. Confirmed by execution, not by
-- reading the ACL: inside a rolled-back transaction,
--
--   SET LOCAL ROLE anon; TRUNCATE TABLE public.ai_conversation_tags;
--
-- SUCCEEDED. Among the 185 are portfolio_benchmark_weights (280,492 rows),
-- price_history_cache (45,499), user_sessions (15,128), portfolio_holdings,
-- organization_audit_log, workflows and research_sections.
--
-- ── Reachability, stated honestly ─────────────────────────────────────────
--
-- This is a serious misconfiguration with NO live path through the API today,
-- and both halves of that sentence matter:
--
--   * `anon` and `authenticated` are NOLOGIN. They are assumed by SET ROLE,
--     by `authenticator` (which can log in) or by PostgREST after it validates
--     a JWT.
--   * PostgREST exposes no verb that emits TRUNCATE, VACUUM or CLUSTER.
--   * Measured: ZERO functions in `public` contain TRUNCATE in their body, so
--     there is no RPC that would run one with the caller's privileges.
--     A SECURITY INVOKER function that truncated anything would arm it
--     immediately, which is exactly why the grant should not be sitting there.
--
-- So: latent, not currently exploitable from the browser key. Not a reason to
-- leave it.
--
-- ── Why revoking these four breaks nothing ────────────────────────────────
--
-- Measured, each one load-bearing for this change:
--
--   all 295 public tables are owned by `postgres`
--   all 276 non-internal trigger functions are owned by `postgres`
--   zero SQL TRUNCATE / VACUUM / REINDEX / CLUSTER anywhere in src,
--     supabase/functions, scripts or .github (every `truncate` hit in the
--     repository is the Tailwind CSS class)
--   `anon` and `authenticated` hold NO CREATE on schema public, and there is
--     no other schema they can create in
--
-- The owner's privileges are what make an existing trigger fire and an
-- existing foreign key hold; a grantee's TRIGGER/REFERENCES bit has nothing to
-- do with either. And without CREATE on a schema, neither role could have used
-- TRIGGER or REFERENCES in the first place -- those two were inert. TRUNCATE
-- and MAINTAIN were not.
--
-- ── What is deliberately preserved ────────────────────────────────────────
--
--   postgres        owner of every table; untouched
--   service_role    the trusted application role, bypasses RLS; untouched,
--                   so an ingestion or maintenance job can still TRUNCATE
--   supabase_admin  holds all four through ROLE MEMBERSHIP with no ACL entry
--                   of its own, so no REVOKE below can affect it. This is
--                   deliberate: it is the platform's administrative role, and
--                   reading relacl alone would have reported it absent.
--   anon,           keep SELECT / INSERT / UPDATE / DELETE exactly as they
--   authenticated   are. Those four verbs ARE governed by RLS, and narrowing
--                   them is a different decision about a different risk.
--                   Nothing here widens or narrows any policy.
--
-- Three statements rather than 885, so the change is reviewable as a whole and
-- is idempotent: a REVOKE of a privilege that was never granted is a no-op.
-- `ALL TABLES IN SCHEMA` covers views as well as tables, which is harmless and
-- means a view added later is covered too.

begin;

-- BOTH the PUBLIC and the per-role revoke are required. Supabase's
-- ALTER DEFAULT PRIVILEGES grants to PUBLIC *and* directly to anon and
-- authenticated, and neither revoke implies the other -- that trap cost a dry
-- run in 20261109180000.
revoke truncate, references, trigger, maintain
  on all tables in schema public from public;

revoke truncate, references, trigger, maintain
  on all tables in schema public from anon;

revoke truncate, references, trigger, maintain
  on all tables in schema public from authenticated;

commit;

-- ── Verify after running ──────────────────────────────────────────────────
--
--   select a.grantee::regrole::text as grantee,
--          count(*) filter (where a.privilege_type='TRUNCATE')   as trunc,
--          count(*) filter (where a.privilege_type='REFERENCES') as refs,
--          count(*) filter (where a.privilege_type='TRIGGER')    as trig,
--          count(*) filter (where a.privilege_type='MAINTAIN')   as maint
--     from pg_class c, aclexplode(c.relacl) a
--    where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
--      and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
--    group by 1 order by 1;
--
--   expected: anon and authenticated absent entirely;
--             postgres and service_role 295/295/295/295.
--
-- Regression test: supabase/tests/dangerous-table-privileges.sql
--
-- ── Adjacent, NOT fixed here ──────────────────────────────────────────────
--
-- This migration does not stop the problem recurring: the DEFAULT privileges
-- that created these grants are still in place, so the next table born in
-- `public` is TRUNCATE-able by anon again on creation. That is P3-3, in its own
-- migration, and the postgres half of it is fixable from here while the
-- supabase_admin half is not -- see that migration's header.
