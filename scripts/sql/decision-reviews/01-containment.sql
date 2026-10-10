-- STEP 1 — IMMEDIATE PRODUCTION CONTAINMENT for decision_reviews.
--
-- Closes the confirmed cross-tenant exposure now, by the bluntest means that
-- cannot be wrong. The permanent fix (02, the tenant-isolation migration)
-- restores legitimate access afterwards.
--
-- ── What this does ────────────────────────────────────────────────────────
--
-- Two independent mechanisms, because either alone can be undone by a later
-- change that looks unrelated:
--
--   1. every client policy becomes deny-by-default (`USING (false)`)
--   2. the table grants are withdrawn from anon and authenticated
--
-- `service_role` is deliberately untouched. It bypasses RLS and keeps its
-- grant, so the rows stay readable and repairable for recovery, for the
-- backfill in step 2, and for a rollback.
--
-- ── What breaks, deliberately ─────────────────────────────────────────────
--
-- Every client read and write of decision_reviews. Specifically:
--
--   src/hooks/useDecisionReview.ts:56   read one review
--   src/hooks/useDecisionReview.ts:79   read many by decision_id
--   src/hooks/useDecisionReview.ts:118  the upsert
--   src/pages/DecisionAccountabilityPage.tsx:3881
--   src/hooks/usePilotScenarioStatus.ts:120
--
-- Visible effect: Decision Quality reads as absent everywhere, Outcomes rows
-- with a review revert from `resolved` to `evaluate`, and saving a review
-- fails. All five call sites go through React Query and surface an error
-- state rather than throwing; none of them renders a review as a precondition
-- for the page.
--
-- That outage is the point. Seven rows carrying structured verdicts are
-- currently readable by every authenticated user in all 28 production
-- organizations, and a brief loss of a feature nobody can safely use is the
-- cheaper side of that trade.
--
-- ── Reversal ──────────────────────────────────────────────────────────────
--
-- 99-rollback-containment.sql restores exactly the pre-existing policies and
-- grants. It re-opens the exposure and exists only so the path is takeable.

BEGIN;

-- 1. Deny-by-default policies, replacing the permissive ones.
DROP POLICY IF EXISTS "decision_reviews_select_authenticated" ON public.decision_reviews;
DROP POLICY IF EXISTS "decision_reviews_insert_self"          ON public.decision_reviews;
DROP POLICY IF EXISTS "decision_reviews_update_self"          ON public.decision_reviews;

CREATE POLICY decision_reviews_contained_select ON public.decision_reviews
  FOR SELECT TO authenticated USING (false);

CREATE POLICY decision_reviews_contained_insert ON public.decision_reviews
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY decision_reviews_contained_update ON public.decision_reviews
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

-- 2. Withdraw the client grants. `anon` was denied only by the absence of a
--    policy naming it; this makes that denial explicit.
REVOKE ALL ON TABLE public.decision_reviews FROM anon;
REVOKE ALL ON TABLE public.decision_reviews FROM authenticated;
REVOKE ALL ON TABLE public.decision_reviews FROM PUBLIC;

-- 3. RLS stays on. Deliberately NOT `FORCE ROW LEVEL SECURITY`: forcing it
--    applies the deny-by-default policies to the table OWNER as well, and
--    the owner is the role this containment and the step-2 backfill are
--    applied through. Forcing here would close the recovery path with the
--    same move that closes the exposure — the exact mistake the trigger in
--    the permanent migration had to be corrected for.
ALTER TABLE public.decision_reviews ENABLE ROW LEVEL SECURITY;

COMMIT;
