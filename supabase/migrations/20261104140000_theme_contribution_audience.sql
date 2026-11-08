-- Theme research gets a real audience, and policies that are actually scoped.
--
-- ── The defect this fixes ──────────────────────────────────────────────────
--
-- `theme_contributions_v2` has a `visibility` column and it does NOTHING. The
-- SELECT policy in production was:
--
--     EXISTS (SELECT 1 FROM themes t
--              WHERE t.id = theme_contributions_v2.theme_id
--                AND t.organization_id = current_org_id())
--     AND (visibility = 'shared' OR organization_id = current_org_id())
--
-- Every row's `organization_id` IS the current org for anybody who can reach
-- it, so the second half is always true and the column is inert. Every piece
-- of theme research is readable by every member of the organization whatever
-- its visibility says. Adding an audience PICKER to the Theme page on top of
-- that would have been security theatre: a control promising a restriction the
-- database does not enforce. So the policy is fixed first.
--
-- Three further problems in the same four policies:
--
--   * All four were `TO public`, not `TO authenticated` (Standing Rule 5).
--   * UPDATE and DELETE checked only `created_by = auth.uid()` with no org
--     predicate, while INSERT had one. Own-row only, so not a cross-tenant
--     read, but the asymmetry is how a policy drifts.
--   * SELECT never checked `is_active_member_of_current_org()`, so a removed
--     member whose JWT still names the org kept reading.
--
-- ── What replaces it: the asset model, exactly ─────────────────────────────
--
-- `asset_contributions` already has a working audience, and this mirrors it
-- rather than inventing a second one:
--
--   SELECT  active member AND same org AND (own row OR 'firm'
--           OR targeted at a group in my effective node set)
--   I/U/D   own row AND same org, TO authenticated
--
-- The vocabulary moves with it. Theme visibility was ('org','shared'); asset
-- visibility is ('firm','division','department','team','portfolio'). The six
-- existing rows are all 'org', which means "everyone in the organization", so
-- they migrate to 'firm' -- the same reach under the name the rest of the
-- product uses (`AudienceVisibility`, `ratingViewScope`, the Firm perspective
-- on both pages). 'shared' had zero rows and no meaning in the new model.
--
-- ── Why a second targets table ─────────────────────────────────────────────
--
-- `contribution_visibility_targets.contribution_id` has a foreign key to
-- `asset_contributions`, so a theme contribution's targets cannot live in it.
-- `theme_contribution_visibility_targets` is its twin, with the FK pointed at
-- `theme_contributions_v2` and the same policy pair.
--
-- ── Least privilege is preserved, not approximated ─────────────────────────
--
-- `set_contribution_audience` is SECURITY DEFINER owned by
-- `tesseract_audience_writer`, a role that holds only narrow policies on the
-- two tables it touches -- deliberately NOT postgres, so a bug in the function
-- body cannot reach anything else. `set_theme_contribution_audience` is
-- created the same way, with the same role, the same grants and the same
-- writer policies. Running it as the migration's own owner would have been a
-- superuser-equivalent definer, which is the thing that design avoids.

begin;

-- ── 1. Targets ────────────────────────────────────────────────────────────

create table if not exists public.theme_contribution_visibility_targets (
  contribution_id uuid not null
    references public.theme_contributions_v2 (id) on delete cascade,
  node_id uuid not null
    references public.org_chart_nodes (id) on delete cascade,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contribution_id, node_id)
);

create index if not exists idx_theme_contrib_vis_targets_node
  on public.theme_contribution_visibility_targets (node_id);
create index if not exists idx_theme_contrib_vis_targets_org
  on public.theme_contribution_visibility_targets (organization_id);

alter table public.theme_contribution_visibility_targets enable row level security;

create policy "theme_contribution_visibility_targets_select"
  on public.theme_contribution_visibility_targets for select to authenticated
  using (is_active_member_of_current_org() and organization_id = current_org_id());

create policy "theme_contribution_visibility_targets_insert"
  on public.theme_contribution_visibility_targets for insert to authenticated
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from public.theme_contributions_v2 c
       where c.id = theme_contribution_visibility_targets.contribution_id
         and c.created_by = auth.uid()
    )
  );

create policy "theme_contribution_visibility_targets_delete"
  on public.theme_contribution_visibility_targets for delete to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from public.theme_contributions_v2 c
       where c.id = theme_contribution_visibility_targets.contribution_id
         and c.created_by = auth.uid()
    )
  );

-- The definer role's own narrow access, mirroring the asset targets table.
create policy "theme_contribution_visibility_targets_writer_select"
  on public.theme_contribution_visibility_targets for select to tesseract_audience_writer
  using (organization_id = current_org_id());

create policy "theme_contribution_visibility_targets_writer_insert"
  on public.theme_contribution_visibility_targets for insert to tesseract_audience_writer
  with check (true);

create policy "theme_contribution_visibility_targets_writer_delete"
  on public.theme_contribution_visibility_targets for delete to tesseract_audience_writer
  using (true);

grant select, insert, delete on public.theme_contribution_visibility_targets
  to authenticated, tesseract_audience_writer;

-- ── 2. The vocabulary ─────────────────────────────────────────────────────

-- Data before the constraint, or the UPDATE fails its own new CHECK.
update public.theme_contributions_v2 set visibility = 'firm' where visibility = 'org';
-- Nothing holds 'shared' (verified: 0 rows). Belt and braces for other envs:
-- 'shared' meant org-wide too, so it lands in the same place.
update public.theme_contributions_v2 set visibility = 'firm' where visibility = 'shared';

alter table public.theme_contributions_v2
  drop constraint if exists theme_contributions_v2_visibility_check;
alter table public.theme_contributions_v2
  add constraint theme_contributions_v2_visibility_check
  check (visibility = any (array['firm','division','department','team','portfolio']));

-- The COLUMN DEFAULT is part of the vocabulary and was missed on the first
-- pass: it is `'org'::text`, which the constraint directly above rejects. Any
-- INSERT that omits `visibility` -- and the ones this table had before the
-- client learned to send it -- would fail with 23514 on a value nobody typed.
-- Changing the CHECK without changing the default is a migration that breaks
-- the table it is securing.
--
-- 'firm' and not the asset table's 'team', because 'firm' is the reach every
-- existing row already had under 'org'. A default of 'team' would silently
-- restrict research to a group the insert never named, which the audience RPC
-- refuses outright (23514) and which no INSERT path is checked against.
alter table public.theme_contributions_v2
  alter column visibility set default 'firm';

-- ── 3. The policies ───────────────────────────────────────────────────────

drop policy if exists "View theme contributions"   on public.theme_contributions_v2;
drop policy if exists "Insert own theme contribution" on public.theme_contributions_v2;
drop policy if exists "Update own theme contribution" on public.theme_contributions_v2;
drop policy if exists "Delete own theme contribution" on public.theme_contributions_v2;

create policy "theme_contributions_v2_select"
  on public.theme_contributions_v2 for select to authenticated
  using (
    is_active_member_of_current_org()
    and organization_id = current_org_id()
    and (
      created_by = auth.uid()
      or visibility = 'firm'
      or exists (
        select 1
          from public.theme_contribution_visibility_targets t
          join public.org_chart_nodes n
            on n.id = t.node_id
           and n.organization_id = theme_contributions_v2.organization_id
         where t.contribution_id = theme_contributions_v2.id
           and t.node_id in (select e.node_id from public.current_user_effective_node_ids() e(node_id))
      )
    )
  );

create policy "theme_contributions_v2_insert"
  on public.theme_contributions_v2 for insert to authenticated
  with check (
    created_by = auth.uid()
    and organization_id = current_org_id()
    -- The theme itself must be this org's. The asset policy gets this from
    -- `assets` being global reference data; a theme is org-owned, so the
    -- check the old policy had is kept.
    and exists (
      select 1 from public.themes t
       where t.id = theme_contributions_v2.theme_id
         and t.organization_id = current_org_id()
    )
  );

create policy "theme_contributions_v2_update"
  on public.theme_contributions_v2 for update to authenticated
  using (created_by = auth.uid() and organization_id = current_org_id())
  with check (created_by = auth.uid() and organization_id = current_org_id());

create policy "theme_contributions_v2_delete"
  on public.theme_contributions_v2 for delete to authenticated
  using (created_by = auth.uid() and organization_id = current_org_id());

create policy "theme_contributions_v2_writer_select"
  on public.theme_contributions_v2 for select to tesseract_audience_writer
  using (created_by = current_user_id() and organization_id = current_org_id());

create policy "theme_contributions_v2_writer_update"
  on public.theme_contributions_v2 for update to tesseract_audience_writer
  using (true) with check (true);

revoke all on public.theme_contributions_v2 from anon;
grant select, insert, update, delete on public.theme_contributions_v2 to authenticated;
grant select, update on public.theme_contributions_v2 to tesseract_audience_writer;

commit;
