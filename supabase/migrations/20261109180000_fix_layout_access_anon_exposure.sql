-- F-1: close the anonymous read of private asset-page layouts.
--
-- ── What was wrong, measured on production 2026-11-09 ─────────────────────
--
-- Impersonating the real `anon` role in a rolled-back transaction:
--
--   user_has_layout_access(<layout>, NULL, 'view')  ->  true
--   layout_collaborations rows visible to anon      ->  1
--   user_asset_page_layouts rows visible to anon    ->  1
--
-- `anon` is the role behind the publishable key, which ships in the browser
-- bundle. So this was readable by anyone on the internet, with no account.
--
-- Two independent defects produced it, and either alone is sufficient:
--
-- 1. The last branch of `user_has_layout_access`:
--
--      -- Check organization-wide collaboration (user_id, team_id, and
--      -- org_node_id are all NULL)
--      SELECT CASE permission ... INTO v_permission_level
--        FROM layout_collaborations
--       WHERE layout_id = p_layout_id
--         AND user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL;
--      IF v_permission_level >= v_min_level THEN RETURN true;
--
--    That block never references `p_user_id` and never mentions an
--    organization, despite what the comment claims. It therefore returns true
--    for a NULL user, and for any user in any other organization. The policy
--    `layout_collaborator_view` calls it, so the policy became unconditional.
--
-- 2. `layout_collab_view_own` carried the same mistake inline, as a final
--    disjunct `(user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL)`
--    with no predicate at all.
--
-- ── Why this is NOT fixed by matching the layout's organization ───────────
--
-- The obvious fix -- scope the org-wide branch to the layout's
-- organization_id -- is impossible here. Verified against the live schema:
--
--   layout_collaborations     columns: created_at, id, invited_by, layout_id,
--                                      org_node_id, permission, team_id, user_id
--   user_asset_page_layouts   columns: created_at, description, field_config,
--                                      id, is_default, name, section_config,
--                                      updated_at, user_id
--
-- NEITHER TABLE HAS AN organization_id. (Their theme twins,
-- theme_layout_collaborations and user_theme_page_layouts, both do -- these
-- two are the older, un-tenanted pair.) And matching a layout's organization
-- would not be sufficient even if the column existed: it establishes which
-- org the row belongs to, not that THE CALLER is a current member of it.
--
-- So the organization is derived from membership instead, which is trusted
-- server-side data: a non-owner may reach a layout only if the caller AND the
-- layout's owner are both ACTIVE, unexpired members of one common
-- organization. That gate is applied once, ahead of every non-owner branch,
-- rather than per-branch -- one place to verify instead of four.
--
-- ── The identity gate ────────────────────────────────────────────────────
--
-- `p_user_id` is caller-supplied, so on its own it is an impersonation
-- parameter. Every caller in the database passes `auth.uid()` and there are
-- exactly three, all policies (verified by scanning every policy and function
-- body in `public`):
--
--   layout_collaborations.layout_collab_admin_manage  (layout_id, auth.uid(), 'admin')
--   user_asset_page_layouts.layout_collaborator_edit  (id,        auth.uid(), 'edit')
--   user_asset_page_layouts.layout_collaborator_view  (id,        auth.uid(), 'view')
--
-- Requiring p_user_id = auth.uid() is therefore behaviour-preserving for
-- every real caller and makes the parameter unusable for impersonation. The
-- signature is kept so the three policies need no rewrite.
--
-- ── Deliberate non-security changes, called out so they are reviewable ────
--
--   * STABLE. The function only reads. Unmarked it defaulted to VOLATILE,
--     which a SELECT policy re-evaluates per row.
--   * max() on the direct and org-wide branches. The original used a bare
--     SELECT ... INTO, which silently takes an arbitrary row when more than
--     one matches. Cannot change single-row behaviour.
--   * search_path pinned (it was unset; 59 anon-executable definer functions
--     share that, tracked separately).

begin;

create or replace function public.user_has_layout_access(
  p_layout_id uuid,
  p_user_id uuid,
  p_min_permission text default 'view'::text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_layout_owner UUID;
  v_min_level    INTEGER;
  v_level        INTEGER;
BEGIN
  -- 1. Identity. A caller may only ever ask about themselves.
  --    auth.uid() IS NULL is tested separately: `p_user_id <> NULL` evaluates
  --    to NULL, which IF treats as false, so it would NOT return early and an
  --    anonymous caller would fall straight through.
  IF p_user_id IS NULL OR auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RETURN false;
  END IF;

  v_min_level := CASE p_min_permission
    WHEN 'view'  THEN 1
    WHEN 'edit'  THEN 2
    WHEN 'admin' THEN 3
    ELSE 1
  END;

  SELECT user_id INTO v_layout_owner
    FROM public.user_asset_page_layouts
   WHERE id = p_layout_id;

  -- No such layout. Returning false here stops the collaboration branches
  -- from being consulted for an id that does not exist.
  IF v_layout_owner IS NULL THEN
    RETURN false;
  END IF;

  -- 2. Owner. Owners have full access and need no organization check: the row
  --    is theirs.
  IF v_layout_owner = p_user_id THEN
    RETURN true;
  END IF;

  -- 3. The tenant gate, ahead of every non-owner branch.
  --
  --    These tables carry no organization_id, so the organization is derived
  --    from membership: the caller and the owner must both be active,
  --    unexpired members of one common organization. A removed or suspended
  --    member fails this, as does any caller from another organization.
  IF NOT EXISTS (
    SELECT 1
      FROM public.organization_memberships me
      JOIN public.organization_memberships owner_m
        ON owner_m.organization_id = me.organization_id
     WHERE me.user_id = p_user_id
       AND me.status = 'active'
       AND (me.expires_at IS NULL OR me.expires_at > now())
       AND owner_m.user_id = v_layout_owner
       AND owner_m.status = 'active'
       AND (owner_m.expires_at IS NULL OR owner_m.expires_at > now())
  ) THEN
    RETURN false;
  END IF;

  -- 4. Direct user collaboration.
  SELECT max(CASE permission
           WHEN 'view' THEN 1 WHEN 'edit' THEN 2 WHEN 'admin' THEN 3 ELSE 0 END)
    INTO v_level
    FROM public.layout_collaborations
   WHERE layout_id = p_layout_id
     AND user_id = p_user_id;
  IF v_level >= v_min_level THEN
    RETURN true;
  END IF;

  -- 5. Team collaboration.
  SELECT max(CASE lc.permission
           WHEN 'view' THEN 1 WHEN 'edit' THEN 2 WHEN 'admin' THEN 3 ELSE 0 END)
    INTO v_level
    FROM public.layout_collaborations lc
    JOIN public.team_memberships tm ON lc.team_id = tm.team_id
   WHERE lc.layout_id = p_layout_id
     AND tm.user_id = p_user_id;
  IF v_level >= v_min_level THEN
    RETURN true;
  END IF;

  -- 6. Org-chart node collaboration.
  SELECT max(CASE lc.permission
           WHEN 'view' THEN 1 WHEN 'edit' THEN 2 WHEN 'admin' THEN 3 ELSE 0 END)
    INTO v_level
    FROM public.layout_collaborations lc
    JOIN public.org_chart_node_members ocnm ON lc.org_node_id = ocnm.node_id
   WHERE lc.layout_id = p_layout_id
     AND ocnm.user_id = p_user_id;
  IF v_level >= v_min_level THEN
    RETURN true;
  END IF;

  -- 7. Organization-wide share: an all-NULL targets row. This is the branch
  --    that was unconditional. It is now reached only after the identity gate
  --    (1) and the shared-active-organization gate (3), which together are
  --    what "organization-wide" was always supposed to mean.
  SELECT max(CASE permission
           WHEN 'view' THEN 1 WHEN 'edit' THEN 2 WHEN 'admin' THEN 3 ELSE 0 END)
    INTO v_level
    FROM public.layout_collaborations
   WHERE layout_id = p_layout_id
     AND user_id IS NULL
     AND team_id IS NULL
     AND org_node_id IS NULL;
  IF v_level >= v_min_level THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

comment on function public.user_has_layout_access(uuid, uuid, text) is
  'Asset-page layout access for the CALLING user. p_user_id must equal auth.uid(); any other value returns false. Non-owner access additionally requires the caller and the layout owner to be active members of one common organization, because neither user_asset_page_layouts nor layout_collaborations carries an organization_id.';

-- The function is policy infrastructure. Nothing calls it from a client, and
-- an anonymous caller has no business asking it anything.
--
-- BOTH revokes are required, and the first dry run proved it. The measured
-- ACL was:
--
--   {=X/postgres, postgres=X/postgres, anon=X/postgres,
--    authenticated=X/postgres, service_role=X/postgres}
--
-- The leading `=X` is the PUBLIC grant -- an empty grantee means PUBLIC. So
-- EXECUTE was held twice over, once via PUBLIC and once as a direct grant to
-- `anon`. `revoke ... from anon` alone left the PUBLIC entry standing and
-- anon could still call it: the dry run's assertion 3 came back `false`
-- instead of `42501`, which is how the no-op was caught.
--
-- This is the mirror of the trap in
-- 20261104140001_set_theme_contribution_audience.sql, where `revoke ... from
-- public` was the no-op and the direct `anon` grant was the one that mattered.
-- Neither revoke implies the other; a function needs both.
revoke all on function public.user_has_layout_access(uuid, uuid, text) from public;
revoke all on function public.user_has_layout_access(uuid, uuid, text) from anon;
-- Put back exactly who needs it. The three calling policies run as
-- `authenticated`; `postgres` owns it and keeps EXECUTE regardless.
grant execute on function public.user_has_layout_access(uuid, uuid, text)
  to authenticated, service_role;

-- ── Defect 2: the same mistake written straight into the policy ───────────
--
-- Rebuilt rather than ALTERed so the whole predicate is visible in one place.
-- The first three disjuncts are unchanged. The fourth gains the gate.
--
-- TO authenticated, not the TO PUBLIC it was: PUBLIC includes anon. The other
-- nine policies on these two tables are also TO PUBLIC and are left alone
-- here -- they are covered by the anon revokes below, and converting all of
-- them is a separate, reviewable change.
drop policy if exists "layout_collab_view_own" on public.layout_collaborations;

create policy "layout_collab_view_own"
  on public.layout_collaborations
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_memberships tm
       where tm.team_id = layout_collaborations.team_id
         and tm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.org_chart_node_members ocnm
       where ocnm.node_id = layout_collaborations.org_node_id
         and ocnm.user_id = auth.uid()
    )
    or (
      user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL
      -- The org-wide row is visible only to someone who genuinely holds
      -- org-wide access to the layout it belongs to. Safe to call from a
      -- policy on this table: the function is SECURITY DEFINER owned by
      -- postgres, which bypasses RLS on layout_collaborations (relforcerowsecurity
      -- is false), so this does not recurse.
      and public.user_has_layout_access(layout_id, auth.uid(), 'view')
    )
  );

-- ── Defence in depth: remove anon at the grant layer too ──────────────────
--
-- The policy and function fixes above each close this independently. These
-- revokes mean a future policy regression on either table cannot reach an
-- anonymous caller at all. `anon` held the full default-privilege set here
-- (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN)
-- purely because Supabase's ALTER DEFAULT PRIVILEGES grants it on every table
-- created in `public`.
revoke all on public.layout_collaborations from anon;
revoke all on public.user_asset_page_layouts from anon;

-- TRUNCATE, REFERENCES and TRIGGER are not governed by RLS, so a correct
-- policy set does not constrain them. authenticated keeps exactly the four
-- DML verbs the feature uses.
revoke all on public.layout_collaborations from authenticated;
grant select, insert, update, delete on public.layout_collaborations to authenticated;

revoke all on public.user_asset_page_layouts from authenticated;
grant select, insert, update, delete on public.user_asset_page_layouts to authenticated;

commit;

-- Verify after running:
--   select public.user_has_layout_access(
--     (select id from user_asset_page_layouts limit 1), null, 'view');   -- false
--   -- and as anon, both of these must be 0 rows / permission denied:
--   --   select count(*) from user_asset_page_layouts;
--   --   select count(*) from layout_collaborations;
