-- ============================================================================
-- save_theme_layout_customization
--
-- The write half of the Theme page's research layout. 20261104150001 shipped
-- `user_theme_page_layouts`, `user_theme_layout_selections`,
-- `theme_layout_collaborations` and `theme_layout_access()`, but nothing could
-- write a selection: the Asset page saves through
-- `save_asset_layout_customization` and there was no theme twin, so
-- `user_theme_page_layouts.field_config` existed and stayed empty and every
-- theme field rendered at span 12.
--
-- ── What this is NOT ───────────────────────────────────────────────────────
--
-- It is not a copy of the asset function. Three things in that one are wrong
-- or unsafe here, and copying them would import both defects:
--
--  1. ORG RESOLUTION. The asset version does
--
--       SELECT organization_id INTO v_org_id FROM organization_memberships
--        WHERE user_id = v_user_id AND status = 'active' LIMIT 1;
--
--     `LIMIT 1` over a multi-org user picks an arbitrary organization. This
--     account belongs to two, and the same shape in the frontend is what made
--     a multi-org user's research sections vanish (see the comment at the top
--     of `useUserAssetPagePreferences`). Here the organization is NOT a
--     property of the caller at all: it is a property of the theme, which
--     carries `organization_id NOT NULL`. Read it from the theme, then require
--     the caller to be an active member of THAT organization.
--
--  2. AUTHORIZATION. The asset version checks only that the asset exists,
--     which is right for assets -- they are global reference data with no
--     organization column. Themes are org-owned, so existence is not
--     authorization: a caller must be an active member of the theme's own
--     organization, or this function would let any authenticated user write a
--     layout selection against another firm's theme and create sections in
--     that firm's section library. (It is SECURITY DEFINER, so RLS would not
--     stop it.)
--
--  3. LAYOUT ACCESS. The asset version inlines its own collaboration
--     subquery, and that subquery is the documented cross-org layout-sharing
--     leak: a `layout_collaborations` row with user_id, team_id and
--     org_node_id all NULL means "organization-wide", and
--     `user_asset_page_layouts` has no organization column to scope it with,
--     so the grant reaches any authenticated caller. Do not copy it. This
--     function calls `theme_layout_access(layout, user, 'view')`, which
--     requires active membership of the LAYOUT's organization before any
--     grant counts.
--
-- ── One schema difference that matters ─────────────────────────────────────
--
-- `user_theme_layout_selections.field_overrides` and `section_overrides` are
-- `NOT NULL DEFAULT '[]'::jsonb`, where the asset table allows NULL and the
-- asset function writes NULL for "none". Writing NULL here fails 23502. And
-- the table carries
--
--   CHECK (layout_id IS NOT NULL OR field_overrides <> '[]' OR
--          section_overrides <> '[]')
--
-- so a selection with nothing in it cannot be stored at all; that case
-- deletes the row, which is what the asset function does too.
--
-- ── RLS posture ────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER, so it bypasses RLS by construction and carries its own
-- authorization, stated above: identity from `auth.uid()` and never from a
-- parameter, organization from the theme, membership required, layout access
-- through `theme_layout_access`. EXECUTE is granted to `authenticated` only,
-- and revoked from PUBLIC and `anon` explicitly, because a function created
-- in `public` is born executable by anon and REVOKE FROM PUBLIC does not
-- remove that grant.
--
-- Cross-org isolation test:
--   supabase/tests/save-theme-layout-customization-tenant-isolation.sql
-- ============================================================================

create or replace function public.save_theme_layout_customization(
  p_theme_id          uuid,
  p_layout_id         uuid default null,
  p_field_overrides   jsonb default '[]'::jsonb,
  p_section_overrides jsonb default '[]'::jsonb,
  p_new_sections      jsonb default '[]'::jsonb,
  p_clear_all         boolean default false,
  p_expected_version  integer default null
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id    uuid;
  v_org_id     uuid;
  v_section    record;
  v_base_slug  text;
  v_slug       text;
  v_counter    int;
  v_max_order  int;
  v_temp_id    text;
  v_real_id    uuid;
  v_section_map jsonb := '{}'::jsonb;
  v_mapped_field_overrides   jsonb;
  v_mapped_section_overrides jsonb;
  v_selection_id uuid;
  v_created_sections jsonb := '[]'::jsonb;
  v_fo_count int;
  v_so_count int;
  v_ns_count int;
  v_current_version int;
  v_new_version     int;
  v_prev_layout_id  uuid;
  v_prev_fo_count   int;
  v_prev_so_count   int;
  v_from_state      jsonb;
  v_action_type     text;
begin
  -- ── Identity: never from a parameter ────────────────────────────────────
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- ── The organization is the THEME's, not the caller's ───────────────────
  select organization_id into v_org_id
    from public.themes
   where id = p_theme_id;

  if v_org_id is null then
    raise exception 'Theme not found: %', p_theme_id;
  end if;

  -- ── Authorization: active membership of the theme's organization ────────
  if not exists (
    select 1 from public.organization_memberships m
     where m.user_id = v_user_id
       and m.organization_id = v_org_id
       and m.status = 'active'
       and (m.expires_at is null or m.expires_at > now())
  ) then
    raise exception 'Theme not accessible: %', p_theme_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── Authorization: the named template, through the org-scoped predicate ─
  if p_layout_id is not null then
    if not public.theme_layout_access(p_layout_id, v_user_id, 'view') then
      raise exception 'Layout not accessible: %', p_layout_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ── Input size limits ───────────────────────────────────────────────────
  if jsonb_array_length(p_field_overrides) > 500 then
    raise exception 'Too many field overrides (max 500)';
  end if;
  if jsonb_array_length(p_section_overrides) > 100 then
    raise exception 'Too many section overrides (max 100)';
  end if;
  if jsonb_array_length(p_new_sections) > 20 then
    raise exception 'Too many new sections per save (max 20)';
  end if;

  -- ── Previous state, for the version check and the audit diff ────────────
  select id, layout_id, version,
         coalesce(jsonb_array_length(field_overrides), 0),
         coalesce(jsonb_array_length(section_overrides), 0)
    into v_selection_id, v_prev_layout_id, v_current_version,
         v_prev_fo_count, v_prev_so_count
    from public.user_theme_layout_selections
   where user_id = v_user_id and theme_id = p_theme_id;

  if v_selection_id is not null then
    v_from_state := jsonb_build_object(
      'layout_id', v_prev_layout_id,
      'field_override_count', v_prev_fo_count,
      'section_override_count', v_prev_so_count,
      'version', v_current_version
    );
  else
    v_from_state := null;
    v_current_version := null;
  end if;

  if p_expected_version is not null and v_current_version is not null then
    if v_current_version <> p_expected_version then
      raise exception
        'CONFLICT: expected version % but found %. Another edit may have occurred.',
        p_expected_version, v_current_version
        using errcode = 'serialization_failure';
    end if;
  end if;

  v_new_version := coalesce(v_current_version, 0) + 1;

  -- ── Clear all ───────────────────────────────────────────────────────────
  if p_clear_all then
    delete from public.user_theme_layout_selections
     where user_id = v_user_id and theme_id = p_theme_id;

    insert into public.audit_events (
      actor_id, actor_type, entity_type, entity_id,
      action_type, action_category, from_state, metadata, org_id,
      search_text, checksum
    ) values (
      v_user_id, 'user', 'layout_template', p_theme_id,
      'delete', 'research_layout',
      v_from_state,
      jsonb_build_object(
        'action', 'clear_all_overrides',
        'subject', 'theme',
        'theme_id', p_theme_id,
        'cleared_field_overrides', coalesce(v_prev_fo_count, 0),
        'cleared_section_overrides', coalesce(v_prev_so_count, 0)
      ),
      v_org_id,
      'clear theme layout overrides',
      encode(sha256(convert_to(
        v_user_id::text || p_theme_id::text || now()::text, 'UTF8'
      )), 'hex')
    );

    return jsonb_build_object(
      'status', 'cleared',
      'selection', null,
      'created_sections', '[]'::jsonb,
      'version', null
    );
  end if;

  -- ── Step 1: create new sections in the theme section library ────────────
  for v_section in select * from jsonb_array_elements(p_new_sections)
  loop
    v_temp_id := v_section.value->>'temp_id';

    if length(coalesce(v_section.value->>'name', '')) < 1 then
      raise exception 'Section name cannot be empty';
    end if;
    if length(v_section.value->>'name') > 100 then
      raise exception 'Section name too long (max 100 chars)';
    end if;

    v_base_slug := lower(regexp_replace(v_section.value->>'name', '[^a-z0-9]+', '_', 'gi'));
    v_base_slug := trim(both '_' from v_base_slug);
    v_base_slug := left(v_base_slug, 55);

    v_slug := v_base_slug;
    v_counter := 2;
    while exists (
      select 1 from public.theme_research_sections
       where organization_id = v_org_id and slug = v_slug
    ) loop
      v_slug := v_base_slug || '_' || v_counter;
      v_counter := v_counter + 1;
      if v_counter > 100 then
        raise exception 'Cannot generate unique slug for section "%"', v_section.value->>'name';
      end if;
    end loop;

    select coalesce(max(display_order), 0) into v_max_order
      from public.theme_research_sections
     where organization_id = v_org_id;

    insert into public.theme_research_sections
      (organization_id, name, slug, display_order, is_system)
    values
      (v_org_id, v_section.value->>'name', v_slug, v_max_order + 1, false)
    returning id into v_real_id;

    v_section_map := v_section_map || jsonb_build_object(v_temp_id, v_real_id::text);
    v_created_sections := v_created_sections || jsonb_build_array(
      jsonb_build_object(
        'temp_id', v_temp_id,
        'real_id', v_real_id,
        'name', v_section.value->>'name',
        'slug', v_slug
      )
    );
  end loop;

  -- ── Steps 2 and 3: resolve temp section ids in both override lists ──────
  v_mapped_field_overrides := (
    select coalesce(jsonb_agg(
      case when v_section_map ? (elem->>'section_id')
        then elem || jsonb_build_object('section_id', v_section_map->>(elem->>'section_id'))
        else elem
      end
    ), '[]'::jsonb)
    from jsonb_array_elements(p_field_overrides) as elem
  );

  v_mapped_section_overrides := (
    select coalesce(jsonb_agg(
      case when v_section_map ? (elem->>'section_id')
        then elem || jsonb_build_object('section_id', v_section_map->>(elem->>'section_id'))
        else elem
      end
    ), '[]'::jsonb)
    from jsonb_array_elements(p_section_overrides) as elem
  );

  for v_temp_id in select key from jsonb_each_text(v_section_map)
  loop
    if not exists (
      select 1 from jsonb_array_elements(v_mapped_section_overrides) as elem
       where elem->>'section_id' = v_section_map->>v_temp_id
    ) then
      v_mapped_section_overrides := v_mapped_section_overrides || jsonb_build_array(
        jsonb_build_object('section_id', v_section_map->>v_temp_id, 'is_added', true)
      );
    end if;
  end loop;

  -- ── Step 4: upsert, or delete when the selection says nothing ──────────
  v_fo_count := jsonb_array_length(v_mapped_field_overrides);
  v_so_count := jsonb_array_length(v_mapped_section_overrides);

  if p_layout_id is null and v_fo_count = 0 and v_so_count = 0 then
    -- `theme_selection_has_layout_or_overrides` forbids storing this row.
    delete from public.user_theme_layout_selections
     where user_id = v_user_id and theme_id = p_theme_id;
    v_selection_id := null;
  else
    -- '[]' rather than NULL: both override columns are NOT NULL here.
    insert into public.user_theme_layout_selections
      (user_id, theme_id, layout_id, field_overrides, section_overrides, version)
    values
      (v_user_id, p_theme_id, p_layout_id,
       v_mapped_field_overrides, v_mapped_section_overrides, v_new_version)
    on conflict (user_id, theme_id) do update set
      layout_id         = excluded.layout_id,
      field_overrides   = excluded.field_overrides,
      section_overrides = excluded.section_overrides,
      version           = excluded.version,
      updated_at        = now()
    returning id into v_selection_id;
  end if;

  -- ── Step 5: audit, with the from/to diff ───────────────────────────────
  v_ns_count := jsonb_array_length(p_new_sections);
  v_action_type := case when v_from_state is null then 'create' else 'update_fields' end;

  insert into public.audit_events (
    actor_id, actor_type, entity_type, entity_id,
    action_type, action_category,
    from_state, to_state, changed_fields,
    metadata, org_id, search_text, checksum
  ) values (
    v_user_id, 'user', 'layout_template',
    coalesce(v_selection_id, p_theme_id),
    v_action_type, 'research_layout',
    v_from_state,
    jsonb_build_object(
      'layout_id', p_layout_id,
      'field_override_count', v_fo_count,
      'section_override_count', v_so_count,
      'new_section_count', v_ns_count,
      'version', v_new_version
    ),
    case
      when v_from_state is null then array['field_overrides', 'section_overrides']
      else (
        select array_agg(f) from unnest(array[
          case when v_prev_layout_id is distinct from p_layout_id then 'layout_id' end,
          case when v_prev_fo_count  is distinct from v_fo_count  then 'field_overrides' end,
          case when v_prev_so_count  is distinct from v_so_count  then 'section_overrides' end
        ]) as f where f is not null
      )
    end,
    jsonb_build_object(
      'subject', 'theme',
      'theme_id', p_theme_id,
      'new_sections_created', v_ns_count,
      'ui_source', 'customizer_modal',
      'template_changed', (v_prev_layout_id is distinct from p_layout_id),
      'field_overrides_delta', v_fo_count - coalesce(v_prev_fo_count, 0),
      'section_overrides_delta', v_so_count - coalesce(v_prev_so_count, 0)
    ),
    v_org_id,
    'save theme layout customization',
    encode(sha256(convert_to(
      v_user_id::text || coalesce(v_selection_id, p_theme_id)::text || now()::text, 'UTF8'
    )), 'hex')
  );

  return jsonb_build_object(
    'status', 'saved',
    'selection_id', v_selection_id,
    'created_sections', v_created_sections,
    'version', v_new_version
  );
end;
$function$;

-- A function created in `public` is born executable by anon, and REVOKE FROM
-- PUBLIC does not remove that grant. Both revokes are required.
revoke all on function public.save_theme_layout_customization(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, integer
) from public;
revoke all on function public.save_theme_layout_customization(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, integer
) from anon;
grant execute on function public.save_theme_layout_customization(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, integer
) to authenticated;

comment on function public.save_theme_layout_customization(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, integer
) is
  'Writes one user''s research layout selection for one theme: template '
  'choice, per-field and per-section overrides, and any new sections. '
  'SECURITY DEFINER. Identity from auth.uid(); the organization is the '
  'THEME''s, and the caller must be an active member of it; template access '
  'goes through theme_layout_access(), never an inline collaboration '
  'subquery. Theme twin of save_asset_layout_customization, deliberately not '
  'a copy of it.';
