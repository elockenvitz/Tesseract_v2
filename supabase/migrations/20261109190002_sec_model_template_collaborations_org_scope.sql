-- P3 remediation 3 of 4: model_template_collaborations carries the same F-1
-- defect, but as a WHOLE POLICY rather than a branch inside one.
--
-- ── What was wrong, measured on production 2026-11-09 ─────────────────────
--
--   "Users can view org-wide collaborations"  SELECT  TO PUBLIC
--     USING ((user_id IS NULL) AND (team_id IS NULL) AND (org_node_id IS NULL))
--
-- The entire predicate places no condition on the caller and references no
-- other table. `anon` holds SELECT on the table. So any organization-wide
-- model-template share is readable by anyone on the internet with no account,
-- exactly as the layout and text-template versions were.
--
-- 1 row in the table, 0 of them org-wide, so nothing is exposed today. The
-- first org-wide share through
-- src/hooks/useModelTemplateCollaborations.ts:151 (shareWithOrganization)
-- arms it.
--
-- ── Why the new policy guard did not catch this one ───────────────────────
--
-- The caller-free-branch detector added in the preceding commit reports a
-- predicate that MIXES branches binding the caller with branches that do not,
-- and deliberately stays silent when EVERY branch is caller-free, because
-- `(is_system = true)` on a global reference table is correct and that
-- exemption is what keeps the false-positive rate at 7 of 946 policies.
--
-- This policy has exactly one branch, and it is caller-free, so it fell into
-- the exemption. That gap is closed separately in the guard; it is recorded
-- here because it is why this table was found by hand and not by CI.
--
-- ── The fix ───────────────────────────────────────────────────────────────
--
-- The parent carries the organization. Verified against the live schema:
--
--   model_templates columns: ..., is_firm_template, organization_id, created_by, ...
--   model_templates rows with organization_id IS NULL: 0  (of 1)
--
-- So the org-wide policy says what it always meant: visible to a caller whose
-- CURRENT organization owns the template. current_org_id() resolves only for
-- a caller holding an active, unexpired membership of that organization, and
-- returns NULL for an anonymous caller, so identity, active membership and
-- ownership are all established by the one predicate.
--
-- ── Why that needs a SECURITY DEFINER helper, measured ────────────────────
--
-- The inline EXISTS form was written first, applied transaction-locally
-- against production and tested. It FAILED the preserve-sharing assertion:
-- the colleague the share exists for read 0 rows. A subquery inside a policy
-- is subject to the CALLER's RLS on the table it reads, and
-- model_templates' SELECT policy is
--
--   "Users can read firm templates"
--     USING ((is_firm_template = true) AND (organization_id = current_org_id()))
--
-- so a non-owner cannot see the parent unless is_firm_template is true, which
-- shareWithOrganization() does not set. model_template_in_current_org() is
-- definer and owned by postgres, so it answers the one question the policy
-- needs without the caller's RLS in the way. Same construction as
-- portfolio_in_current_org().
--
-- ── All four sharing paths checked, not just the vulnerable one ───────────
--
--   "Users can view their own collaborations"
--       USING (user_id = auth.uid())                              caller-bound
--   "Users can view org node collaborations they belong to"
--       USING (org_node_id IS NOT NULL AND EXISTS (
--                select 1 from org_chart_node_members
--                 where node_id = ... and user_id = auth.uid()))  caller-bound
--   "Owners can manage template collaborations"  (ALL)
--       USING (EXISTS (select 1 from model_templates
--                       where id = ... and created_by = auth.uid()))
--                                                                 caller-bound
--   "Users can view org-wide collaborations"                      THE DEFECT
--
-- The three sound ones are narrowed from TO PUBLIC to TO authenticated. None
-- of their predicates can match for anon (auth.uid() is NULL), so that is
-- hygiene, not a behaviour change, and it belongs in this migration so that
-- reverting it reverts with the rest.

begin;

create or replace function public.model_template_in_current_org(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from model_templates
     where id = p_template_id
       and organization_id = current_org_id()
  );
$function$;

comment on function public.model_template_in_current_org(uuid) is
  'True when the named model template belongs to the CALLER''s current organization, where current_org_id() itself requires an active, unexpired membership. SECURITY DEFINER because a policy subquery would otherwise be filtered by model_templates'' own RLS, which hides non-firm parents from the colleagues an org-wide share is for.';

-- BOTH revokes are required: Supabase's default privileges grant EXECUTE to
-- PUBLIC *and* directly to anon on everything created in `public`, and neither
-- revoke implies the other.
revoke all on function public.model_template_in_current_org(uuid) from public;
revoke all on function public.model_template_in_current_org(uuid) from anon;
grant execute on function public.model_template_in_current_org(uuid) to authenticated, service_role;

drop policy if exists "Users can view org-wide collaborations" on public.model_template_collaborations;

create policy "Users can view org-wide collaborations"
  on public.model_template_collaborations
  for select
  to authenticated
  using (
    user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL
    -- No recursion: the helper reads model_templates, not this table.
    and public.model_template_in_current_org(template_id)
  );

drop policy if exists "Users can view their own collaborations" on public.model_template_collaborations;

create policy "Users can view their own collaborations"
  on public.model_template_collaborations
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can view org node collaborations they belong to" on public.model_template_collaborations;

create policy "Users can view org node collaborations they belong to"
  on public.model_template_collaborations
  for select
  to authenticated
  using (
    org_node_id IS NOT NULL
    and exists (
      select 1 from public.org_chart_node_members ocnm
       where ocnm.node_id = model_template_collaborations.org_node_id
         and ocnm.user_id = auth.uid()
    )
  );

drop policy if exists "Owners can manage template collaborations" on public.model_template_collaborations;

create policy "Owners can manage template collaborations"
  on public.model_template_collaborations
  for all
  to authenticated
  using (
    exists (
      select 1 from public.model_templates m
       where m.id = model_template_collaborations.template_id
         and m.created_by = auth.uid()
    )
  );

-- ── Defence in depth at the grant layer ───────────────────────────────────
--
-- `anon` held the complete default-privilege set from Supabase's ALTER DEFAULT
-- PRIVILEGES. Nothing in the application reads a model-template collaboration
-- without an account.
revoke all on public.model_template_collaborations from anon;

-- TRUNCATE, REFERENCES and TRIGGER are not governed by RLS.
revoke all on public.model_template_collaborations from authenticated;
grant select, insert, update, delete on public.model_template_collaborations to authenticated;

commit;

-- ── Adjacent, NOT fixed here ──────────────────────────────────────────────
--
-- model_template_collaborations has a team_id column and the UI writes it
-- (useModelTemplateCollaborations.ts:87 passes team_id), but NONE of the four
-- SELECT policies covers a team-targeted row: there is no
-- `team_memberships.user_id = auth.uid()` branch anywhere on this table. So a
-- team share is invisible to the team it was shared with -- the row is created
-- and then only the template owner can see it. 0 rows carry a team_id today.
-- That is a product defect, not a security one, and adding a branch widens
-- access, so it needs its own change and its own test.
--
-- Verify after running:
--   begin;
--     insert into model_template_collaborations
--            (template_id, user_id, team_id, org_node_id, permission)
--       select id, null, null, null, 'view' from model_templates limit 1;
--     set local role anon;
--     select count(*) from model_template_collaborations;   -- must be 0, or 42501
--   rollback;
