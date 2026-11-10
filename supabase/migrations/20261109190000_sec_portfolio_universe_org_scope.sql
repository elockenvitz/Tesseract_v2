-- P3 remediation 1 of 4: portfolio_universe_assets / portfolio_universe_filters
-- were readable AND writable by any authenticated user in any organization.
--
-- ── What was wrong, measured on production 2026-11-09 ─────────────────────
--
-- Both tables carried the same pair of policies, TO PUBLIC:
--
--   "Users can view portfolio universe <x>"   SELECT  USING (auth.role() = 'authenticated')
--   "Users can manage portfolio universe <x>" ALL     USING (auth.role() = 'authenticated')
--
-- `auth.role() = 'authenticated'` proves only that a session exists. It says
-- nothing about which organization the caller belongs to, so it is as open as
-- USING (true) for every logged-in user.
--
-- Impersonating a real member of organization 8e879d89-... against a
-- portfolio owned by organization 4b4713e8-..., in a rolled-back transaction:
--
--   select count(*) from portfolio_universe_filters          ->  1 row
--   insert into portfolio_universe_assets  (their portfolio) ->  SUCCEEDED
--   insert into portfolio_universe_filters (their portfolio) ->  SUCCEEDED
--
-- A portfolio's investable universe and its screening filters are the shape
-- of a firm's research funnel. Reading another firm's is a tenant breach;
-- writing to it is worse, because the owning firm has no way to tell the rows
-- are not theirs -- neither table records who added a row in practice (see
-- the adjacent finding at the foot of this file).
--
-- ── The fix, and why this shape ───────────────────────────────────────────
--
-- Neither table has an organization_id, and neither needs one: both are
-- children of `portfolios`, which does. So authority is derived from the
-- parent through the existing helper:
--
--   portfolio_in_current_org(p_portfolio_id)
--     = EXISTS (select 1 from portfolios
--                where id = p_portfolio_id
--                  and organization_id = current_org_id())
--
-- and current_org_id() itself resolves to the caller's current organization
-- ONLY when they hold an active, unexpired membership of it. So a removed or
-- suspended member fails, and a caller from another organization fails.
--
-- This is the established pattern for a portfolio child table on this
-- database, not a new invention. Verified against the live catalog,
-- `portfolio_checklist_items` and `portfolio_workflow_progress` each carry
-- exactly these four policies with exactly this predicate.
--
-- Four separate policies rather than one FOR ALL, because ALL does not take a
-- WITH CHECK that is distinguishable from its USING, and an INSERT has no
-- existing row to test. Written out per verb, the predicate that governs each
-- verb is visible in the catalog without reasoning about defaults.
--
-- TO authenticated, not the TO PUBLIC these were: PUBLIC includes anon.

begin;

-- ── portfolio_universe_assets ─────────────────────────────────────────────

drop policy if exists "Users can view portfolio universe assets"   on public.portfolio_universe_assets;
drop policy if exists "Users can manage portfolio universe assets" on public.portfolio_universe_assets;

create policy "portfolio_universe_assets_select"
  on public.portfolio_universe_assets
  for select
  to authenticated
  using (portfolio_in_current_org(portfolio_id));

create policy "portfolio_universe_assets_insert"
  on public.portfolio_universe_assets
  for insert
  to authenticated
  with check (portfolio_in_current_org(portfolio_id));

-- Both sides on UPDATE: USING decides which rows may be touched, WITH CHECK
-- decides what they may become. Without the WITH CHECK a caller could move a
-- row to another organization's portfolio by rewriting portfolio_id.
create policy "portfolio_universe_assets_update"
  on public.portfolio_universe_assets
  for update
  to authenticated
  using (portfolio_in_current_org(portfolio_id))
  with check (portfolio_in_current_org(portfolio_id));

create policy "portfolio_universe_assets_delete"
  on public.portfolio_universe_assets
  for delete
  to authenticated
  using (portfolio_in_current_org(portfolio_id));

-- ── portfolio_universe_filters ────────────────────────────────────────────

drop policy if exists "Users can view portfolio universe filters"   on public.portfolio_universe_filters;
drop policy if exists "Users can manage portfolio universe filters" on public.portfolio_universe_filters;

create policy "portfolio_universe_filters_select"
  on public.portfolio_universe_filters
  for select
  to authenticated
  using (portfolio_in_current_org(portfolio_id));

create policy "portfolio_universe_filters_insert"
  on public.portfolio_universe_filters
  for insert
  to authenticated
  with check (portfolio_in_current_org(portfolio_id));

create policy "portfolio_universe_filters_update"
  on public.portfolio_universe_filters
  for update
  to authenticated
  using (portfolio_in_current_org(portfolio_id))
  with check (portfolio_in_current_org(portfolio_id));

create policy "portfolio_universe_filters_delete"
  on public.portfolio_universe_filters
  for delete
  to authenticated
  using (portfolio_in_current_org(portfolio_id));

-- ── Defence in depth at the grant layer ───────────────────────────────────
--
-- `anon` held the complete default-privilege set on both tables (SELECT,
-- INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), purely
-- because Supabase's ALTER DEFAULT PRIVILEGES grants it on every table
-- created in `public`. Nothing in the application reads a portfolio universe
-- without an account: the only call site is
-- src/components/portfolio/InvestableUniverseSection.tsx, which runs inside
-- an authenticated portfolio page.
--
-- With the policies above, anon is already denied -- auth.uid() is NULL and
-- current_org_id() returns NULL, so portfolio_in_current_org() is false. The
-- revoke means a future policy regression cannot reach an anonymous caller at
-- all.
revoke all on public.portfolio_universe_assets  from anon;
revoke all on public.portfolio_universe_filters from anon;

-- TRUNCATE, REFERENCES and TRIGGER are not governed by RLS, so a correct
-- policy set does not constrain them: TRUNCATE empties the table regardless
-- of any USING clause. authenticated keeps exactly the four DML verbs the
-- feature uses.
revoke all on public.portfolio_universe_assets from authenticated;
grant select, insert, update, delete on public.portfolio_universe_assets to authenticated;

revoke all on public.portfolio_universe_filters from authenticated;
grant select, insert, update, delete on public.portfolio_universe_filters to authenticated;

commit;

-- ── Adjacent, NOT fixed here ──────────────────────────────────────────────
--
-- portfolio_universe_assets.added_by and portfolio_universe_filters.created_by
-- are nullable, have no column DEFAULT, and the only client that writes these
-- tables does not set them:
--
--   InvestableUniverseSection.tsx:122  insert({ portfolio_id, asset_id })
--   InvestableUniverseSection.tsx:138  insert({ portfolio_id, ...filter })
--
-- So every row's provenance is NULL, and a WITH CHECK of
-- `added_by = auth.uid()` would break the feature rather than tighten it.
-- Giving these columns a `default auth.uid()` and then pinning them in the
-- policy is a separate, independently reviewable change.
--
-- Verify after running, as a member of an organization that owns no
-- portfolio in the test set:
--   select count(*) from portfolio_universe_filters;   -- 0
--   insert into portfolio_universe_assets (portfolio_id, asset_id)
--     values ('<another org''s portfolio>', '<any asset>');  -- 42501
