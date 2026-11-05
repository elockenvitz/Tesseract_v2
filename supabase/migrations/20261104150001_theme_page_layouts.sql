-- Themes get templates: the Asset page's layout layer, org-scoped this time.
--
-- ── What this adds ────────────────────────────────────────────────────────
--
--   user_theme_page_layouts        a named template: which fields, in which
--                                  sections, in what order, at what width
--   user_theme_layout_selections   which template a given theme is using,
--                                  plus that theme's own overrides
--   theme_layout_collaborations    who else can see or edit a template
--   theme_layout_access()          the permission check the policies call
--
-- The jsonb shapes (`field_config`, `section_config`, `field_overrides`,
-- `section_overrides`) are the Asset page's shapes unchanged, so
-- `lib/research/layout-resolver.ts` resolves a theme layout with the same
-- code and not a second implementation.
--
-- ── One deliberate difference from the asset tables, and why ──────────────
--
-- `user_theme_page_layouts` carries `organization_id`.
-- `user_asset_page_layouts` does not, and that is exactly why its sharing
-- leaks across tenants:
--
--   `layout_collaborations` can hold a row with user_id, team_id and
--   org_node_id all NULL, meaning "shared organization-wide".
--   `user_has_layout_access` treats that row as a grant to ANY authenticated
--   caller -- there is no organization predicate anywhere in that arm, and
--   the layout table has no organization column to write one against. The one
--   such row in production ("We can too", permission 'view') is therefore
--   readable by any signed-in user of any organization.
--
-- That defect is NOT fixed here; it is a separate change against the asset
-- tables, and it is reported as a finding. What this migration does is refuse
-- to reproduce it: every theme layout names its organization, every
-- collaboration names the same organization, and `theme_layout_access`
-- requires the caller to be an ACTIVE MEMBER of that organization before any
-- grant is considered, the owner included.
--
-- `theme_layout_access` also sets `search_path`, which
-- `user_has_layout_access` does not. A SECURITY DEFINER function without one
-- resolves unqualified names through the caller's path.
--
-- ── RLS posture ───────────────────────────────────────────────────────────
--
-- THREE NEW TABLES, each with RLS enabled, every policy `TO authenticated`,
-- `anon` revoked. Nothing is widened anywhere.
--
--   user_theme_page_layouts
--     select  own row, or a collaboration grant, both requiring active
--             membership of the layout's org
--     insert  own row AND organization_id = current_org_id()
--     update  own row, or an 'edit' grant; org pinned on both sides
--     delete  own row only
--
--   user_theme_layout_selections
--     all     own row AND the theme is in the caller's current org
--
--   theme_layout_collaborations
--     select  the layout's owner, or the subject of the grant
--     all     the layout's owner, or an 'admin' grant
--             (every arm org-scoped)
--
-- A theme layout is org-owned data, so per Standing Rule 5 this ships with a
-- cross-org isolation test in `supabase/tests/`, proving cross-org read AND
-- write are denied while a same-org member is allowed.
--
-- The same migration also repairs `theme_research_sections` and
-- `theme_research_fields`, whose policies are about to become load-bearing
-- for this feature. STATED PROMINENTLY because it changes existing policies:
-- both tables had `TO public` policies checking only
-- `organization_id = current_org_id()`, with no `is_active_member_of_current_org()`,
-- so a removed member whose JWT still named the org kept reading AND writing
-- the org's field library. The replacements are `TO authenticated` and add
-- the membership check. This NARROWS access; it widens nothing.
--
-- No data is read, moved or deleted. All three tables start empty.

begin;

-- ── 1. Templates ──────────────────────────────────────────────────────────

create table if not exists public.user_theme_page_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  -- The Asset page's shapes, unchanged, so one resolver serves both.
  field_config jsonb not null default '[]'::jsonb,
  section_config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_theme_page_layouts_user
  on public.user_theme_page_layouts (user_id);
create index if not exists idx_user_theme_page_layouts_org
  on public.user_theme_page_layouts (organization_id);

-- ── 2. Which template a theme is using, and its own overrides ─────────────

create table if not exists public.user_theme_layout_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  theme_id uuid not null references public.themes (id) on delete cascade,
  -- SET NULL, as on the asset table: deleting a template must not delete the
  -- overrides a theme accumulated while using it.
  layout_id uuid references public.user_theme_page_layouts (id) on delete set null,
  field_overrides jsonb not null default '[]'::jsonb,
  section_overrides jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, theme_id),
  -- A row that names no template and carries no override is a row that says
  -- nothing. Same constraint the asset table has.
  constraint theme_selection_has_layout_or_overrides check (
    layout_id is not null
    or field_overrides <> '[]'::jsonb
    or section_overrides <> '[]'::jsonb
  )
);

create index if not exists idx_user_theme_layout_selections_theme
  on public.user_theme_layout_selections (theme_id);

-- ── 3. Sharing ────────────────────────────────────────────────────────────

create table if not exists public.theme_layout_collaborations (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.user_theme_page_layouts (id) on delete cascade,
  -- The organization this grant lives in. NOT NULL, and checked by
  -- `theme_layout_access` on every arm. This column is the whole reason the
  -- asset version's organization-wide grant cannot happen here.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Exactly one of these three, or none of them for an org-wide grant.
  user_id uuid references public.users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  org_node_id uuid references public.org_chart_nodes (id) on delete cascade,
  permission text not null default 'view'
    check (permission = any (array['view','edit','admin'])),
  invited_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  constraint theme_layout_collab_one_subject check (
    (case when user_id    is not null then 1 else 0 end)
  + (case when team_id    is not null then 1 else 0 end)
  + (case when org_node_id is not null then 1 else 0 end) <= 1
  ),
  unique nulls not distinct (layout_id, user_id),
  unique nulls not distinct (layout_id, team_id),
  unique nulls not distinct (layout_id, org_node_id)
);

create index if not exists idx_theme_layout_collab_layout
  on public.theme_layout_collaborations (layout_id);
create index if not exists idx_theme_layout_collab_org
  on public.theme_layout_collaborations (organization_id);

-- ── 4. The permission check ───────────────────────────────────────────────

create or replace function public.theme_layout_access(
  p_layout_id uuid,
  p_user_id uuid,
  p_min_permission text default 'view'
)
returns boolean
language plpgsql
security definer
stable
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_min  int;
  v_org  uuid;
  v_best int := 0;
BEGIN
  IF p_layout_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  v_min := CASE p_min_permission
             WHEN 'admin' THEN 3
             WHEN 'edit'  THEN 2
             ELSE 1
           END;

  -- The layout's organization. Every grant below is read against it, which is
  -- the predicate the asset function has nowhere to put.
  SELECT organization_id INTO v_org
    FROM public.user_theme_page_layouts
   WHERE id = p_layout_id;
  IF v_org IS NULL THEN
    RETURN false;
  END IF;

  -- Active membership of THAT organization is the floor, for the owner too.
  -- A removed member keeps neither their own templates nor a grant.
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
     WHERE m.user_id = p_user_id
       AND m.organization_id = v_org
       AND m.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_theme_page_layouts l
     WHERE l.id = p_layout_id AND l.user_id = p_user_id
  ) THEN
    RETURN true;
  END IF;

  SELECT coalesce(max(CASE c.permission
                        WHEN 'admin' THEN 3
                        WHEN 'edit'  THEN 2
                        WHEN 'view'  THEN 1
                        ELSE 0 END), 0)
    INTO v_best
    FROM public.theme_layout_collaborations c
   WHERE c.layout_id = p_layout_id
     AND c.organization_id = v_org
     AND (
       -- named user
       c.user_id = p_user_id
       -- a team the caller is in
       OR (c.team_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.team_memberships tm
              WHERE tm.team_id = c.team_id AND tm.user_id = p_user_id))
       -- an org-chart group the caller is in
       OR (c.org_node_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.org_chart_node_members nm
              WHERE nm.node_id = c.org_node_id AND nm.user_id = p_user_id))
       -- organization-wide, which here means THIS organization and no other
       OR (c.user_id IS NULL AND c.team_id IS NULL AND c.org_node_id IS NULL)
     );

  RETURN v_best >= v_min;
END $function$;

revoke all on function public.theme_layout_access(uuid, uuid, text) from public;
grant execute on function public.theme_layout_access(uuid, uuid, text)
  to authenticated, service_role;

-- ── 5. Policies ───────────────────────────────────────────────────────────

alter table public.user_theme_page_layouts enable row level security;

create policy "user_theme_page_layouts_select"
  on public.user_theme_page_layouts for select to authenticated
  using (
    (user_id = auth.uid()
     and is_active_member_of_current_org()
     and organization_id = current_org_id())
    or public.theme_layout_access(id, auth.uid(), 'view')
  );

create policy "user_theme_page_layouts_insert"
  on public.user_theme_page_layouts for insert to authenticated
  with check (
    user_id = auth.uid()
    and is_active_member_of_current_org()
    and organization_id = current_org_id()
  );

create policy "user_theme_page_layouts_update"
  on public.user_theme_page_layouts for update to authenticated
  using (
    (user_id = auth.uid() and organization_id = current_org_id())
    or public.theme_layout_access(id, auth.uid(), 'edit')
  )
  -- The org cannot be rewritten by an update, by an owner or an editor.
  with check (organization_id = current_org_id());

create policy "user_theme_page_layouts_delete"
  on public.user_theme_page_layouts for delete to authenticated
  using (user_id = auth.uid() and organization_id = current_org_id());

alter table public.user_theme_layout_selections enable row level security;

-- One policy for all four commands: a selection is the caller's own row about
-- a theme in the caller's own org, and that is the whole rule.
create policy "user_theme_layout_selections_own"
  on public.user_theme_layout_selections for all to authenticated
  using (
    user_id = auth.uid()
    and is_active_member_of_current_org()
    and exists (
      select 1 from public.themes t
       where t.id = user_theme_layout_selections.theme_id
         and t.organization_id = current_org_id()
    )
  )
  with check (
    user_id = auth.uid()
    and is_active_member_of_current_org()
    and exists (
      select 1 from public.themes t
       where t.id = user_theme_layout_selections.theme_id
         and t.organization_id = current_org_id()
    )
    -- A selection may only point at a layout the caller can actually read.
    and (
      layout_id is null
      or public.theme_layout_access(layout_id, auth.uid(), 'view')
    )
  );

alter table public.theme_layout_collaborations enable row level security;

create policy "theme_layout_collaborations_select"
  on public.theme_layout_collaborations for select to authenticated
  using (
    organization_id = current_org_id()
    and is_active_member_of_current_org()
    and (
      exists (
        select 1 from public.user_theme_page_layouts l
         where l.id = theme_layout_collaborations.layout_id
           and l.user_id = auth.uid()
      )
      or user_id = auth.uid()
      or (team_id is not null and exists (
            select 1 from public.team_memberships tm
             where tm.team_id = theme_layout_collaborations.team_id
               and tm.user_id = auth.uid()))
      or (org_node_id is not null and exists (
            select 1 from public.org_chart_node_members nm
             where nm.node_id = theme_layout_collaborations.org_node_id
               and nm.user_id = auth.uid()))
      or (user_id is null and team_id is null and org_node_id is null)
    )
  );

create policy "theme_layout_collaborations_write"
  on public.theme_layout_collaborations for all to authenticated
  using (
    organization_id = current_org_id()
    and (
      exists (
        select 1 from public.user_theme_page_layouts l
         where l.id = theme_layout_collaborations.layout_id
           and l.user_id = auth.uid()
      )
      or public.theme_layout_access(layout_id, auth.uid(), 'admin')
    )
  )
  with check (
    organization_id = current_org_id()
    and is_active_member_of_current_org()
    -- The grant's org must be the layout's org. Without this an admin could
    -- write a grant tagged with their current org against a layout owned by
    -- another, which is the asset version's hole arriving by another door.
    and exists (
      select 1 from public.user_theme_page_layouts l
       where l.id = theme_layout_collaborations.layout_id
         and l.organization_id = theme_layout_collaborations.organization_id
    )
    and (
      exists (
        select 1 from public.user_theme_page_layouts l
         where l.id = theme_layout_collaborations.layout_id
           and l.user_id = auth.uid()
      )
      or public.theme_layout_access(layout_id, auth.uid(), 'admin')
    )
  );

revoke all on public.user_theme_page_layouts from anon;
revoke all on public.user_theme_layout_selections from anon;
revoke all on public.theme_layout_collaborations from anon;

grant select, insert, update, delete on public.user_theme_page_layouts to authenticated;
grant select, insert, update, delete on public.user_theme_layout_selections to authenticated;
grant select, insert, update, delete on public.theme_layout_collaborations to authenticated;

-- ── 6. The field library's own policies, repaired ─────────────────────────
--
-- See the note at the top. These two tables are what a template is a template
-- OF, so this feature rests on them. Both were `TO public` and neither
-- checked active membership. `TO authenticated` plus
-- `is_active_member_of_current_org()` NARROWS both.

drop policy if exists "Org members can view theme research sections"   on public.theme_research_sections;
drop policy if exists "Org members can manage theme research sections" on public.theme_research_sections;

create policy "theme_research_sections_select"
  on public.theme_research_sections for select to authenticated
  using (is_active_member_of_current_org() and organization_id = current_org_id());

create policy "theme_research_sections_write"
  on public.theme_research_sections for all to authenticated
  using (is_active_member_of_current_org() and organization_id = current_org_id())
  with check (is_active_member_of_current_org() and organization_id = current_org_id());

drop policy if exists "Org members can view theme research fields"   on public.theme_research_fields;
drop policy if exists "Org members can manage theme research fields" on public.theme_research_fields;

create policy "theme_research_fields_select"
  on public.theme_research_fields for select to authenticated
  using (is_active_member_of_current_org() and organization_id = current_org_id());

create policy "theme_research_fields_write"
  on public.theme_research_fields for all to authenticated
  using (is_active_member_of_current_org() and organization_id = current_org_id())
  with check (
    is_active_member_of_current_org()
    and organization_id = current_org_id()
    -- A field has to land in a section of the same organization. The old
    -- policy checked the field's own org and not its parent's, so a field
    -- could be filed under another tenant's section.
    and exists (
      select 1 from public.theme_research_sections s
       where s.id = theme_research_fields.section_id
         and s.organization_id = theme_research_fields.organization_id
    )
  );

revoke all on public.theme_research_sections from anon;
revoke all on public.theme_research_fields from anon;
grant select, insert, update, delete on public.theme_research_sections to authenticated;
grant select, insert, update, delete on public.theme_research_fields to authenticated;

commit;
