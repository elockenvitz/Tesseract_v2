-- ============================================================================
-- contribution-visibility / 90 — ROLLBACK  ***DO NOT APPLY***
--
-- Restores the three SELECT policies exactly as C1/06, C1/07 and C1/08 leave
-- them, including the `OR team_id IS NULL` grant. Reverting therefore REOPENS
-- the exposure — that is what reverting means here, and it is stated rather
-- than buried.
--
-- No contribution data, visibility value, target row, timestamp or audit event
-- is touched by 10- or by this file. The fix is policy-only, so the rollback is
-- policy-only and nothing needs a data log.
-- ============================================================================

BEGIN;

-- ── asset_contributions — back to C1/08:70-81 ──────────────────────────────
DROP POLICY IF EXISTS asset_contributions_select ON public.asset_contributions;
CREATE POLICY asset_contributions_select ON public.asset_contributions
  FOR SELECT TO authenticated
  USING (public.is_active_member_of_current_org()
         AND organization_id = public.current_org_id()
         AND (created_by = auth.uid()
              OR visibility = 'firm'
              OR team_id IS NULL
              OR EXISTS (SELECT 1
                           FROM public.contribution_visibility_targets cvt
                           JOIN public.org_chart_node_members ocnm
                             ON ocnm.node_id = cvt.node_id AND ocnm.user_id = auth.uid()
                          WHERE cvt.contribution_id = asset_contributions.id)));

-- ── asset_contribution_history — back to C1/07:32-36 ───────────────────────
DROP POLICY IF EXISTS asset_contribution_history_select ON public.asset_contribution_history;
CREATE POLICY asset_contribution_history_select ON public.asset_contribution_history
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.asset_contributions c
                  WHERE c.id = asset_contribution_history.contribution_id
                    AND c.organization_id = public.current_org_id()));

-- ── asset_revision_events — back to C1/06:136-142 ──────────────────────────
DROP POLICY IF EXISTS asset_revision_events_select ON public.asset_revision_events;
CREATE POLICY asset_revision_events_select ON public.asset_revision_events
  FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id()
         OR (organization_id IS NULL
             AND EXISTS (SELECT 1 FROM public.asset_revisions r
                          WHERE r.id = asset_revision_events.revision_id
                            AND r.actor_user_id = auth.uid())));

-- ── contribution_replies / contribution_reactions — back to production ─────
-- Captured verbatim from preflight A3c. Reverting restores the org-level
-- predicate, which is visibility-blind.
DROP POLICY IF EXISTS contribution_replies_select ON public.contribution_replies;
CREATE POLICY contribution_replies_select ON public.contribution_replies
  FOR SELECT TO authenticated
  USING (public.contribution_in_current_org(contribution_id)
         AND public.is_active_member_of_current_org());

DROP POLICY IF EXISTS contribution_reactions_select ON public.contribution_reactions;
CREATE POLICY contribution_reactions_select ON public.contribution_reactions
  FOR SELECT TO authenticated
  USING (public.contribution_in_current_org(contribution_id)
         AND public.is_active_member_of_current_org());

COMMIT;

-- ── Drop the predicate, only once nothing references it ────────────────────
-- Run AFTER the policies above are back, or the DROP fails on dependency.
-- DROP FUNCTION IF EXISTS public.can_read_asset_contribution(uuid);

-- ── Verify the revert ──────────────────────────────────────────────────────
-- Expect the team_id branch present again, and 1 policy per table.
-- SELECT tablename, policyname, qual FROM pg_policies
--  WHERE schemaname='public' AND cmd='SELECT'
--    AND tablename IN ('asset_contributions','asset_contribution_history','asset_revision_events');
-- SELECT count(*) AS should_be_zero FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname='can_read_asset_contribution';
