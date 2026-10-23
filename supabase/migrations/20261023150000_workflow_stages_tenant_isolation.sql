/*
  # workflow_stages tenant isolation

  ## What is wrong

  `workflow_stages` carries the SELECT policy it was given on 2025-11-21, in
  `20251121000001_add_workflow_collaboration_rls.sql` — written before
  workflows belonged to organizations at all. That migration contains no
  `organization_id` anywhere. Its second branch is:

      OR user_has_workflow_access(workflow_id, auth.uid())

  `user_has_workflow_access` is SECURITY DEFINER, so it bypasses RLS, and its
  last branch returns TRUE for any workflow with `is_public = true` without
  looking at who is asking or which organization owns it. With `auth.uid()`
  NULL — an unauthenticated request carrying the anon key that ships in the
  browser bundle — the three user-relationship branches all fail and that
  last branch still answers TRUE.

  Measured on production, read-only:

      role anon, select count(*) from workflow_stages  ->  76 rows
                 select count(distinct workflow_id)    ->  18 workflows
                                                           4 organizations

      74 of those rows carry `stage_description`; all 76 carry
      `checklist_items`. Named examples: "Earnings Prep",
      "New Idea Diligence", "Quarterly Position Review".

  Every sibling table returns 0 to anon (`workflows`, `workflow_universe_
  rules`, `workflow_stage_content_tiles`, `workflow_template_versions`,
  `workflow_collaborations`, `workflow_automation_rules`), and anon has no
  grant at all on `asset_checklist_items` or `asset_workflow_progress`.
  `workflow_stages` is the one table that was never migrated.

  Writes were never exposed: `user_has_workflow_edit_access(wf, NULL)`
  returns false for every branch, and this was verified against a live public
  workflow.

  ## What `is_public` means here

  Established from the deployed schema, not assumed. The live `workflows`
  SELECT policy is:

      organization_id = current_org_id()
      AND (is_public = true OR created_by = auth.uid()
           OR user_has_workflow_access(id, auth.uid())
           OR (parent_workflow_id IS NOT NULL
               AND user_has_workflow_access(parent_workflow_id, auth.uid())))

  The organization check is conjoined with the `is_public` disjunction on the
  parent table itself. So `is_public` means "visible to every member of the
  OWNING organization", as opposed to private to its creator, collaborators
  and stakeholders. It has never meant cross-organization template sharing,
  and nothing in the product offers that. This migration propagates the
  boundary the parent table already enforces; it does not introduce a new
  sharing model.

  ## What this changes

  1. `user_has_workflow_access` gains an organization check on its
     `is_public` branch only. That branch is the one that grants access with
     no user relationship whatsoever, and it is the root cause: any future
     policy calling this helper alone would repeat the defect.
     `workflow_rule_executions` already does — its SELECT policy is
     `user_has_workflow_access(workflow_id, auth.uid())` with no org check.
     That table is empty today, so it leaks nothing, but the hole is real and
     this closes it at the source.

     The creator, collaborator and stakeholder branches are deliberately left
     alone: they require a user relationship, and no `workflow_collaborations`
     or `workflow_stakeholders` row currently points outside its workflow's
     owning organization (verified: 0 of 16 and 0 of 9).

  2. Both helpers get `SET search_path = public`. They are SECURITY DEFINER
     with `proconfig` NULL, while `current_org_id()` and
     `is_active_member_of_current_org()` both pin it. An unpinned search_path
     on a definer function lets a caller shadow `workflows` with a table of
     their own.

  3. The two `workflow_stages` policies are replaced with organization-bounded
     ones addressed `TO authenticated` rather than `{public}`, and the SELECT
     predicate is the parent's, verbatim — so a user who can see a workflow
     can see its stages, and nobody else can.

  4. `anon` loses its grants on `workflow_stages`, matching
     `asset_checklist_items` and `asset_workflow_progress`. The policy change
     alone is sufficient; this is the second lock.

  `current_org_id()` already requires an active, unexpired membership, so an
  inactive member is denied without a separate `is_active_member_of_current_
  org()` term. Adding one would make stages STRICTER than the workflow they
  belong to, which is how a tightening breaks legitimate same-org use.

  Rollback: 20261023150001_workflow_stages_tenant_isolation_DOWN.sql.rollback
*/

-- ─────────────────────────────────────────────────────────────────────────
-- 1. The helper: an organization check on the `is_public` branch.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_has_workflow_access(
  workflow_id_param UUID,
  user_id_param UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Creator.
  IF EXISTS (
    SELECT 1 FROM workflows
    WHERE id = workflow_id_param AND created_by = user_id_param
  ) THEN
    RETURN TRUE;
  END IF;

  -- Collaborator.
  IF EXISTS (
    SELECT 1 FROM workflow_collaborations
    WHERE workflow_id = workflow_id_param AND user_id = user_id_param
  ) THEN
    RETURN TRUE;
  END IF;

  -- Stakeholder.
  IF EXISTS (
    SELECT 1 FROM workflow_stakeholders
    WHERE workflow_id = workflow_id_param AND user_id = user_id_param
  ) THEN
    RETURN TRUE;
  END IF;

  /*
   * Public WITHIN ITS ORGANIZATION.
   *
   * This branch grants access with no user relationship, so without the
   * organization term it answers TRUE to anyone at all, including an
   * unauthenticated caller. `current_org_id()` returns NULL when there is no
   * authenticated user with an active membership, and `= NULL` is never
   * true, so anon falls through to FALSE.
   */
  IF EXISTS (
    SELECT 1 FROM workflows
    WHERE id = workflow_id_param
      AND is_public = true
      AND organization_id = current_org_id()
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.user_has_workflow_access IS
  'True when the user created the workflow, collaborates on it, is a '
  'stakeholder, or it is public WITHIN THE CALLER''S CURRENT ORGANIZATION. '
  'The organization term is load-bearing: without it the public branch '
  'grants read to any caller, anon included.';

-- The edit helper is unchanged in logic; it only loses its unpinned
-- search_path. Every branch of it requires a user relationship, so it has no
-- equivalent of the public branch above.
ALTER FUNCTION public.user_has_workflow_edit_access(UUID, UUID)
  SET search_path = public;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. The policies.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view stages of accessible workflows" ON public.workflow_stages;
DROP POLICY IF EXISTS "Users can manage stages of accessible workflows" ON public.workflow_stages;

/*
 * Read: exactly the predicate the parent `workflows` SELECT policy applies.
 * Stated here rather than left to the subquery's own RLS so the boundary is
 * visible in this policy instead of inherited from another one.
 */
CREATE POLICY "workflow_stages_select"
  ON public.workflow_stages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_stages.workflow_id
        AND w.organization_id = current_org_id()
        AND (
          w.is_public = true
          OR w.created_by = auth.uid()
          OR user_has_workflow_access(w.id, auth.uid())
          OR (w.parent_workflow_id IS NOT NULL
              AND user_has_workflow_access(w.parent_workflow_id, auth.uid()))
        )
    )
  );

/*
 * Write: the same organization boundary, plus the edit role the previous
 * policy already required. `FOR ALL` as before, so INSERT, UPDATE and DELETE
 * keep one rule between them.
 */
CREATE POLICY "workflow_stages_write"
  ON public.workflow_stages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_stages.workflow_id
        AND w.organization_id = current_org_id()
    )
    AND user_has_workflow_edit_access(workflow_stages.workflow_id, auth.uid())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = workflow_stages.workflow_id
        AND w.organization_id = current_org_id()
    )
    AND user_has_workflow_edit_access(workflow_stages.workflow_id, auth.uid())
  );

COMMENT ON POLICY "workflow_stages_select" ON public.workflow_stages IS
  'Stages are visible exactly when their workflow is, which is the parent '
  'policy''s predicate including its organization term.';

COMMENT ON POLICY "workflow_stages_write" ON public.workflow_stages IS
  'Edit rights come from workflow ownership or an admin collaboration, and '
  'only inside the caller''s current organization.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. anon has no business here. The second lock.
-- ─────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.workflow_stages FROM anon;
