-- P3-3: stop new tables being born with anonymous and dangerous privileges.
--
-- 20261109210000 removed the four RLS-exempt privileges from every existing
-- table in `public`. This migration removes the cause, so the next table does
-- not arrive with them again.
--
-- ── What a new table inherited, validated by creating one ─────────────────
--
-- Not read off pg_default_acl and reasoned about: a table was actually created
-- inside a rolled-back transaction on production and its relacl read back.
--
--   create table public.__p3_probe_before (...);
--
--   grantee         privileges on the brand-new table
--   anon            DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER,
--                   TRUNCATE, UPDATE          <-- all eight, to anon
--   authenticated   the same eight
--   postgres        the same eight
--   service_role    the same eight
--
-- That is the generator of the P3-2 finding. Every table ever added to this
-- schema was TRUNCATE-able by `anon` from the moment it existed, and would be
-- again tomorrow.
--
-- The source is Supabase's own bootstrap, which runs
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated, service_role;
--
-- for BOTH `postgres` and `supabase_admin`. A default-privilege entry is keyed
-- by the creating role, so there are two independent sets. Measured:
--
--   defaclrole      objtype  acl
--   postgres        r        anon=arwdDxtm, authenticated=arwdDxtm, ...
--   postgres        S        anon=rwU, authenticated=rwU, ...
--   postgres        f        anon=X, authenticated=X, ...
--   supabase_admin  r        anon=arwdDxtm, authenticated=arwdDxtm, ...
--   supabase_admin  S        anon=rwU, ...
--   supabase_admin  f        anon=X, ...
--
-- ── BLOCKER: only the postgres half can be fixed from here ────────────────
--
-- ALTER DEFAULT PRIVILEGES may only be executed by the role whose defaults are
-- being changed, or by a superuser. Measured on production:
--
--   current_user                                            postgres
--   pg_has_role(current_user,'supabase_admin','MEMBER')     false
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres        ...   SUCCEEDED
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...   42501
--                                      permission denied to change default privileges
--
-- So this migration fixes the `postgres` half only. That is not a cosmetic
-- gap, but it is a narrow one, and it is bounded by measurement: all 295
-- tables in `public` are owned by `postgres`, so `supabase_admin`'s defaults
-- have produced NOTHING in this schema to date. They would apply only to an
-- object the platform itself creates in `public`.
--
-- The compensating control is a CI guard that fails on any public table
-- carrying an anon grant or one of the four RLS-exempt privileges for
-- anon/authenticated/PUBLIC, whatever role created it. An event trigger would
-- be the stronger mechanism and is also unavailable: CREATE EVENT TRIGGER
-- requires superuser, and postgres here has rolsuper = false.
--
-- ── What this changes ─────────────────────────────────────────────────────
--
-- Validated the same way, by creating a table after the change:
--
--   grantee         privileges on a table created AFTER this migration
--   anon            none at all          (SELECT=f, TRUNCATE=f)
--   authenticated   DELETE, INSERT, SELECT, UPDATE
--   postgres        all eight
--   service_role    all eight            (SELECT=t, TRUNCATE=t)
--
-- `anon` is removed entirely rather than trimmed, because an anon grant is
-- never the intended default here -- see standing rule 5, "never an anon
-- grant". `authenticated` keeps exactly the four verbs RLS governs.
--
-- Sequences are included for completeness and are inert today: `public`
-- contains 295 tables, 9 views and ZERO sequences, since every table keys on
-- uuid rather than an identity column. The entry is corrected anyway so a
-- future sequence is not born readable and incrementable by anon.
--
-- ── WHAT A NEW APPLICATION TABLE MUST NOW GRANT EXPLICITLY ────────────────
--
-- This is the part to remember. After this migration, a `create table` in
-- `public` gives `authenticated` the four DML verbs and `anon` nothing. So a
-- new org-owned table needs, in the SAME migration that creates it:
--
--   alter table public.<t> enable row level security;
--
--   -- grants: usually nothing further is needed. authenticated already has
--   -- SELECT/INSERT/UPDATE/DELETE from the corrected default. Narrow it if the
--   -- table is read-only to the app:
--   --   revoke insert, update, delete on public.<t> from authenticated;
--
--   -- policies: all four verbs, scoped per standing rule 5. A grant without a
--   -- policy grants nothing, so these are what actually admit the caller.
--   create policy "<t>_select" on public.<t> for select to authenticated
--     using (organization_id = current_org_id());
--   create policy "<t>_insert" on public.<t> for insert to authenticated
--     with check (organization_id = current_org_id());
--   create policy "<t>_update" on public.<t> for update to authenticated
--     using (organization_id = current_org_id())
--     with check (organization_id = current_org_id());
--   create policy "<t>_delete" on public.<t> for delete to authenticated
--     using (organization_id = current_org_id());
--
-- Things that are now NOT automatic, and must be asked for by name:
--
--   * ANY anon access. If a table genuinely serves unauthenticated readers,
--     `grant select on public.<t> to anon;` plus a policy `TO anon` -- and say
--     so prominently in the migration, because it crosses standing rule 5.
--   * TRUNCATE / TRIGGER / REFERENCES / MAINTAIN for anything other than
--     postgres and service_role, which still receive all eight. An ingestion
--     job that must replace a table wholesale runs as service_role and already
--     has what it needs.
--   * A child table whose parent carries the organization: use a SECURITY
--     DEFINER helper (portfolio_in_current_org, text_template_in_current_org),
--     NOT an inline EXISTS -- a policy subquery is filtered by the caller's own
--     RLS on the parent, which hides the parent from exactly the colleagues an
--     org-wide row is for.
--
-- Nothing here is retroactive: existing tables keep the grants they have, and
-- P3-2 is what corrected those.

begin;

-- `anon` loses the table default entirely.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

-- `authenticated` keeps only the verbs RLS governs.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;

-- PUBLIC is revoked separately: a revoke from anon does not remove a PUBLIC
-- grant and vice versa. No PUBLIC default entry exists today; this keeps one
-- from being the way the hole returns.
alter default privileges for role postgres in schema public
  revoke all on tables from public;

-- Sequences: inert today (zero sequences in `public`), corrected so a future
-- one is not born readable and incrementable by anon.
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

alter default privileges for role postgres in schema public
  revoke all on sequences from public;

commit;

-- ── Verify after running, by creating a table rather than reading a catalog ─
--
--   begin;
--     create table public.__probe (id uuid primary key default gen_random_uuid());
--     select a.grantee::regrole::text,
--            string_agg(a.privilege_type, ',' order by a.privilege_type)
--       from pg_class c, aclexplode(c.relacl) a
--      where c.relnamespace='public'::regnamespace and c.relname='__probe'
--      group by 1 order by 1;
--     -- expected: anon absent; authenticated DELETE,INSERT,SELECT,UPDATE;
--     --           postgres and service_role all eight.
--     drop table public.__probe;
--   rollback;
--
-- Regression test: supabase/tests/default-privileges-fail-closed.sql
--
-- ── Adjacent, NOT fixed here ──────────────────────────────────────────────
--
-- The FUNCTION default (`f`, `anon=X`) is untouched. Every function created in
-- `public` is still born EXECUTE-able by anon, which is a documented recurring
-- trap in this codebase. It is left out deliberately: unlike a table grant,
-- removing it can break a genuinely pre-authentication RPC -- invite
-- acceptance is reached without a session -- so it needs its own change, its
-- own inventory of which functions anon must still reach, and its own runtime
-- test. Existing functions keep their grants either way; only future ones
-- would change.
