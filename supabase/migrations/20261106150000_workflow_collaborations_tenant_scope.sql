-- =============================================================================
-- workflow_collaborations: scope SELECT to the caller's current organization
--
-- NOT APPLIED. Authored 2026-11-06 as the prepared correction for a measured
-- finding; applying it is a separate decision.
--
-- THE FINDING
--
-- The SELECT policy has no organization term:
--
--   USING ( user_id = auth.uid()
--        OR invited_by = auth.uid()
--        OR workflow_id IN (SELECT id FROM workflows WHERE created_by = auth.uid()) )
--
-- So a user whose current organization is B still reads their own collaboration
-- rows pointing at workflows in organization A, while the workflow itself is
-- correctly invisible. Measured on production: one real user read 10 such rows,
-- another 5. What is exposed is the workflow's uuid, the permission string and
-- the inviting user's id — membership metadata, not workflow content.
--
-- It is not a feature. Nothing can be done with those rows: `workflows` SELECT
-- is conjoined with `organization_id = current_org_id()`, so the workflow cannot
-- be opened from the other organization, and no surface offers cross-org
-- collaboration. Every live reader of this table either filters by a
-- workflow_id it already holds from an org-scoped query, or reads
-- `.select('workflow_id').eq('user_id', me)` and feeds the ids straight back
-- into an org-scoped `workflows` query where the extra ids match nothing:
--
--   src/hooks/workflow/useActiveRuns.ts:61
--   src/components/ui/WorkflowSelector.tsx:84      (feeds org_workflows_v)
--   src/pages/WorkflowsPage.tsx:2058               (feeds workflows)
--
-- THE CORRECTION
--
-- One conjunctive EXISTS, outside the existing disjunction, in the same shape
-- the `workflows` policy uses. The organization term must stay OUTSIDE: the
-- three branches below are all "this row concerns me", none of them says
-- anything about tenancy, so folding the org term into the OR would restore the
-- leak.
--
-- No recursion: evaluating this policy reads `workflows`, whose own policy calls
-- `user_has_workflow_access`, which is SECURITY DEFINER and therefore does not
-- re-enter this table's RLS.
--
-- `current_org_id()` and `auth.uid()` are wrapped in scalar subqueries so the
-- planner evaluates each once per query as an InitPlan rather than once per row.
--
-- TO authenticated replaces TO public. anon could never read a row anyway
-- (auth.uid() is NULL and current_org_id() is NULL), so this states what was
-- already true rather than removing access.
--
-- TESTED 2026-11-06 against production inside a transaction that was aborted by
-- a RAISE, with the policy created transaction-locally. Before: the org-B user
-- read 1 of org A's collaboration rows. After: 0, while the same-org
-- collaborator still read their own row, the workflow owner still read all 2
-- collaborators (the manage-sharing UI), the org-B user still read their own
-- org B collaboration, the "which workflows am I shared on" query still
-- returned its legitimate row, and anon read 0. Nothing was committed and the
-- live policy was re-read afterwards unchanged.
--
-- KNOWN CONSEQUENCE, accepted: the DELETE policy lets a user remove themselves
-- from a collaboration (`user_id = auth.uid()`). After this change they cannot
-- SEE a cross-org collaboration in order to remove it. That was already
-- unreachable from the UI, since the workflow it points at cannot be opened.
-- =============================================================================

DROP POLICY IF EXISTS "Users can view workflow collaborations they have access to"
  ON public.workflow_collaborations;

CREATE POLICY "Users can view workflow collaborations they have access to"
  ON public.workflow_collaborations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workflows w
      WHERE w.id = workflow_collaborations.workflow_id
        AND w.organization_id = (SELECT public.current_org_id())
    )
    AND (
      user_id = (SELECT auth.uid())
      OR invited_by = (SELECT auth.uid())
      OR workflow_id IN (
        SELECT id FROM public.workflows WHERE created_by = (SELECT auth.uid())
      )
    )
  );
