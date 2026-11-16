-- ROLLBACK for 20261104140000_theme_contribution_audience.sql
--   and 20261104140001_set_theme_contribution_audience.sql
--
-- Captured from PRODUCTION on 2026-11-09, BEFORE either migration was applied.
-- Everything below is the measured prior state, not a reconstruction from the
-- migration's inverse. Run this whole file to put production back.
--
-- ── What is and is not reversible ────────────────────────────────────────────
--
-- The forward migration rewrites the `visibility` vocabulary:
--
--     'org'    -> 'firm'
--     'shared' -> 'firm'
--
-- That mapping is LOSSY IN PRINCIPLE: two input values collapse to one, so
-- 'firm' alone cannot tell you which it came from. It is reversible TODAY only
-- because of a measured fact: at capture time all 6 rows in
-- theme_contributions_v2 were 'org' and NONE were 'shared'. So every 'firm' row
-- that predates the migration maps back to 'org'.
--
-- The six row ids are listed explicitly below rather than using a blanket
-- `update ... set visibility='org' where visibility='firm'`. If users create
-- new contributions after the forward migration, those rows are legitimately
-- 'firm' (the new DEFAULT) and a blanket update would silently relabel them as
-- a value the restored CHECK does admit, destroying real data. Restricting to
-- the captured ids cannot do that.
--
-- Rows created after the forward migration with any of the four NEW-only
-- values ('division','department','team','portfolio') have NO pre-migration
-- equivalent. The restored CHECK rejects them, so step 4 fails loudly rather
-- than mangling them. That is deliberate: if that happens, the rollback is no
-- longer safe to run unattended and those rows need a decision. Query
--   select id, visibility from public.theme_contributions_v2
--   where visibility in ('division','department','team','portfolio');
-- BEFORE running this file.
--
-- ── Order ───────────────────────────────────────────────────────────────────
--
-- Drop the RPC first (it reads the targets table), then the targets table,
-- then the data and constraint, then the policies and grants. Wrapped in a
-- transaction: Postgres DDL is transactional, so a failure anywhere leaves
-- production exactly as it was.

begin;

-- ── 1. The RPC from 140001 ──────────────────────────────────────────────────
-- Did not exist in production before the forward migration; the tenant
-- allowlist recorded it as NOT IN PRODUCTION.
drop function if exists public.set_theme_contribution_audience(uuid, uuid[]);

-- ── 2. The audience table from 140000 ───────────────────────────────────────
-- Did not exist before. Dropping it discards any audience assignments made
-- while the feature was live; there is no prior state to restore them to.
-- `cascade` removes its policies, indexes and FK constraints with it.
drop table if exists public.theme_contribution_visibility_targets cascade;

-- ── 3. Restore the vocabulary on the 6 captured rows ────────────────────────
-- All six were 'org' at capture. See the lossiness note above for why this is
-- id-scoped and not value-scoped.
update public.theme_contributions_v2 set visibility = 'org'
where id in (
  '3678625f-93f2-450a-98f3-07307f7269ff',
  '4fd30a88-dcec-4f11-bed6-35afbb0a995c',
  '73109446-7839-435a-b3dc-4bf562919976',
  '8418cb46-7884-426f-9065-12e602032433',
  '9bcc0dd8-39ec-4da0-b5f6-f1b6ff18919d',
  'c8e0d8a3-eb73-4ff7-8c2c-fdbdcbfc6f8a'
);

-- ── 4. Restore the CHECK and DEFAULT exactly as captured ────────────────────
-- Measured: CHECK ((visibility = ANY (ARRAY['org'::text, 'shared'::text])))
--           DEFAULT 'org'::text
-- This is the step that fails if a NEW-only value survives step 3. That is the
-- intended behaviour.
alter table public.theme_contributions_v2
  drop constraint if exists theme_contributions_v2_visibility_check;
alter table public.theme_contributions_v2
  add constraint theme_contributions_v2_visibility_check
  check (visibility = any (array['org'::text, 'shared'::text]));
alter table public.theme_contributions_v2
  alter column visibility set default 'org'::text;

-- ── 5. Restore the 4 original policies ──────────────────────────────────────
-- Captured verbatim from pg_policies. NOTE the roles: all four were TO public,
-- which is why the forward migration's `revoke ... from anon` was a tightening.
-- Restoring them restores that looseness too. If the rollback is permanent
-- rather than an emergency, the anon revoke in step 6 is worth keeping.
drop policy if exists "theme_contributions_v2_select" on public.theme_contributions_v2;
drop policy if exists "theme_contributions_v2_insert" on public.theme_contributions_v2;
drop policy if exists "theme_contributions_v2_update" on public.theme_contributions_v2;
drop policy if exists "theme_contributions_v2_delete" on public.theme_contributions_v2;
drop policy if exists "theme_contributions_v2_writer_select" on public.theme_contributions_v2;
drop policy if exists "theme_contributions_v2_writer_update" on public.theme_contributions_v2;

drop policy if exists "View theme contributions" on public.theme_contributions_v2;
create policy "View theme contributions" on public.theme_contributions_v2
  for select to public
  using (
    (exists (
      select 1 from themes t
      where t.id = theme_contributions_v2.theme_id
        and t.organization_id = current_org_id()
    ))
    and (visibility = 'shared'::text or organization_id = current_org_id())
  );

drop policy if exists "Insert own theme contribution" on public.theme_contributions_v2;
create policy "Insert own theme contribution" on public.theme_contributions_v2
  for insert to public
  with check (
    created_by = auth.uid()
    and organization_id = current_org_id()
    and exists (
      select 1 from themes t
      where t.id = theme_contributions_v2.theme_id
        and t.organization_id = current_org_id()
    )
  );

drop policy if exists "Update own theme contribution" on public.theme_contributions_v2;
create policy "Update own theme contribution" on public.theme_contributions_v2
  for update to public
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "Delete own theme contribution" on public.theme_contributions_v2;
create policy "Delete own theme contribution" on public.theme_contributions_v2
  for delete to public
  using (created_by = auth.uid());

-- ── 6. Grants ───────────────────────────────────────────────────────────────
-- Captured state had anon holding INSERT/SELECT/UPDATE/DELETE and more. That
-- is a pre-existing exposure the forward migration closed. Restoring it is
-- commented out ON PURPOSE: a rollback should not re-open an anon write path.
-- The four policies above are the real gate, and none of them can be satisfied
-- by an anonymous caller (all require auth.uid() or current_org_id()). Uncomment
-- only if something is provably broken by the revoke.
--
-- grant select, insert, update, delete on public.theme_contributions_v2 to anon;
--
-- `tesseract_audience_writer` is a pre-existing role (it was already in
-- production before this migration), so it is NOT dropped here; only its grant
-- on this table, which the forward migration added, is removed.
revoke select, update on public.theme_contributions_v2 from tesseract_audience_writer;
grant select, insert, update, delete on public.theme_contributions_v2 to authenticated;

commit;

-- ── Verify after running ────────────────────────────────────────────────────
--   select visibility, count(*) from public.theme_contributions_v2 group by 1;
--     expect: org | 6   (plus any post-migration rows you decided to keep)
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'theme_contributions_v2_visibility_check';
--     expect: CHECK ((visibility = ANY (ARRAY['org'::text, 'shared'::text])))
--   select count(*) from pg_policies
--     where tablename = 'theme_contributions_v2';
--     expect: 4
--   select to_regclass('public.theme_contribution_visibility_targets');
--     expect: NULL
