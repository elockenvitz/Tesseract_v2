-- P3 remediation 2 of 4: template_collaborations carried the F-1 defect that
-- PR #276 fixed on layout_collaborations. Same shape, different table.
--
-- ── What was wrong, measured on production 2026-11-09 ─────────────────────
--
--   collab_view_own  SELECT  TO PUBLIC  USING (
--     (user_id = auth.uid())
--     OR EXISTS (select 1 from team_memberships
--                 where team_id = template_collaborations.team_id
--                   and user_id = auth.uid())
--     OR ((user_id IS NULL) AND (team_id IS NULL))          <-- no caller at all
--   )
--
-- An all-NULL targets row is how "share this template with my organization"
-- is recorded -- see shareWithOrganization() in
-- src/hooks/useTemplateCollaborations.ts, which inserts exactly
-- { user_id: null, team_id: null }. That third disjunct places NO condition on
-- the caller, references no other table, and so is satisfied by row content
-- alone. `anon` held SELECT on the table.
--
-- Proven, not inferred. In a rolled-back transaction I inserted one org-wide
-- share row and then read the table as the real `anon` role:
--
--   insert into template_collaborations (template_id, user_id, team_id, permission)
--     select id, null, null, 'view' from text_templates limit 1;
--   set local role anon;
--   select count(*) from template_collaborations;    ->  1
--
-- `anon` is the role behind the publishable key, which ships in the browser
-- bundle. So the first org-wide template share would have been readable by
-- anyone on the internet with no account. The table holds 0 rows today, which
-- is the only reason nothing is exposed right now.
--
-- ── Why this one is simpler than the layout fix ───────────────────────────
--
-- PR #276 could not scope the layout branch by organization because NEITHER
-- layout_collaborations NOR user_asset_page_layouts has an organization_id, so
-- it had to derive a shared organization from membership on both sides.
--
-- Here the parent does have one. Verified against the live schema:
--
--   text_templates columns: ..., is_shared, ..., organization_id
--   text_templates rows with organization_id IS NULL: 0
--
-- So the org-wide branch can say what it always meant: the row is visible to
-- someone whose CURRENT organization is the one that owns the template.
--
-- ── Why that test needs a SECURITY DEFINER helper, measured ───────────────
--
-- The obvious way to write it is an inline EXISTS:
--
--   and exists (select 1 from text_templates t
--                where t.id = template_collaborations.template_id
--                  and t.organization_id = current_org_id())
--
-- That was written, applied transaction-locally against production and
-- tested. It FAILED the preserve-legitimate-sharing assertions: the very
-- colleague the share exists for read 0 rows.
--
-- The cause is that a subquery inside a policy is itself subject to the
-- CALLER's RLS on the table it reads, and text_templates' own SELECT policy is
--
--   "Org members can view shared templates in current org"
--     USING ((organization_id = current_org_id()) AND (is_shared = true))
--
-- so a non-owner can only see the parent row when is_shared is true -- and
-- shareWithOrganization() does not set is_shared. The EXISTS therefore
-- returned false for exactly the people it was meant to admit.
--
-- text_template_in_current_org() is SECURITY DEFINER and owned by postgres, so
-- it reads text_templates without the caller's RLS and answers the one
-- question the policy actually needs. It is the same construction
-- portfolio_in_current_org() already uses for portfolio children, and the same
-- reason user_has_layout_access() is definer. It returns a boolean about a
-- template the caller has already named, so it discloses nothing further.
--
-- current_org_id() is the right half of that test and not merely a convenience:
-- it returns users.current_organization_id only when the caller holds a
-- membership of it that is `status = 'active'` and either has no expires_at or
-- has not yet expired. An anonymous caller gets NULL (auth.uid() is NULL), and
-- NULL = organization_id is NULL, not true. A removed or suspended member gets
-- NULL for the same reason. So identity, active membership and ownership are
-- all established by the one predicate.
--
-- ── The other two disjuncts are left alone, having been checked ────────────
--
-- Both bind the caller directly, so neither can be satisfied without a
-- session:
--
--   user_id = auth.uid()                 -- own row only
--   team_memberships.user_id = auth.uid()  -- only teams the caller is in
--
-- A cross-organization direct or team share is not reachable in the product:
-- useSearchUsers() (useTemplateCollaborations.ts:232) picks collaborators from
-- `users`, whose own RLS is organization-scoped -- measured, a foreign-org
-- caller resolves 0 names out of the table. Tightening those two branches
-- anyway would risk hiding an existing legitimate share, so it is not done
-- here; if cross-org sharing is ever wanted it needs its own decision.
--
-- collab_owner_manage is also narrowed from TO PUBLIC to TO authenticated. Its
-- predicate (text_templates.user_id = auth.uid()) already cannot match for
-- anon, so this is hygiene rather than a fix, and it is in this migration
-- because reverting it belongs with reverting the rest.

begin;

create or replace function public.text_template_in_current_org(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from text_templates
     where id = p_template_id
       and organization_id = current_org_id()
  );
$function$;

comment on function public.text_template_in_current_org(uuid) is
  'True when the named text template belongs to the CALLER''s current organization, where current_org_id() itself requires an active, unexpired membership. SECURITY DEFINER because a policy subquery would otherwise be filtered by text_templates'' own RLS, which hides non-shared parents from the colleagues an org-wide share is for.';

-- Policy infrastructure. Nothing calls it from a client, and an anonymous
-- caller has no business asking it anything. BOTH revokes are required: in
-- `public`, Supabase's default privileges grant EXECUTE to PUBLIC *and*
-- directly to anon, and neither revoke implies the other. That trap cost a
-- dry run in 20261109180000.
revoke all on function public.text_template_in_current_org(uuid) from public;
revoke all on function public.text_template_in_current_org(uuid) from anon;
grant execute on function public.text_template_in_current_org(uuid) to authenticated, service_role;

drop policy if exists "collab_view_own" on public.template_collaborations;

create policy "collab_view_own"
  on public.template_collaborations
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_memberships tm
       where tm.team_id = template_collaborations.team_id
         and tm.user_id = auth.uid()
    )
    or (
      user_id IS NULL AND team_id IS NULL
      -- The org-wide row is visible only to a caller whose current
      -- organization owns the template. Safe to call from a policy on this
      -- table: the helper reads text_templates, not template_collaborations,
      -- so there is no recursion.
      and public.text_template_in_current_org(template_id)
    )
  );

drop policy if exists "collab_owner_manage" on public.template_collaborations;

create policy "collab_owner_manage"
  on public.template_collaborations
  for all
  to authenticated
  using (
    exists (
      select 1 from public.text_templates t
       where t.id = template_collaborations.template_id
         and t.user_id = auth.uid()
    )
  );

-- ── Defence in depth at the grant layer ───────────────────────────────────
--
-- `anon` held the complete default-privilege set here (SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) from Supabase's ALTER
-- DEFAULT PRIVILEGES, not from any decision. Nothing in the application reads
-- or writes a template collaboration without an account.
--
-- The policy fix above closes this independently; the revoke means a future
-- regression on this table cannot reach an anonymous caller at all.
revoke all on public.template_collaborations from anon;

-- TRUNCATE, REFERENCES and TRIGGER are not governed by RLS -- TRUNCATE empties
-- the table whatever the USING clause says. authenticated keeps the four DML
-- verbs the feature uses.
revoke all on public.template_collaborations from authenticated;
grant select, insert, update, delete on public.template_collaborations to authenticated;

commit;

-- Verify after running:
--   begin;
--     insert into template_collaborations (template_id, user_id, team_id, permission)
--       select id, null, null, 'view' from text_templates limit 1;
--     set local role anon;
--     select count(*) from template_collaborations;   -- must be 0, or 42501
--   rollback;
