-- Decision Inbox: pilot users (and any other org-admin-only user
-- who submits a recommendation on a portfolio they don't sit on
-- the team for) couldn't see their own decision_requests, because
-- the SELECT policy required portfolio_team membership.
--
-- The seeded pilot AAPL recommendation has `requested_by =
-- pilot_user_id`, but pilot users aren't seeded into portfolio_team,
-- so RLS filtered the row out before it ever reached the inbox UI.
-- Result: count shows 0, no amber highlight, no row in the panel.
--
-- Fix: also allow SELECT when `requested_by = auth.uid()`. Still
-- org-scoped via `portfolio_in_current_org()`, so this does not
-- broaden cross-org visibility — it just lets a user see decision
-- requests they themselves submitted, which is consistent with
-- the existing UPDATE policy (which already permits
-- `requested_by = auth.uid()`).

DROP POLICY IF EXISTS "Decision requests: org-scoped" ON decision_requests;

CREATE POLICY "Decision requests: org-scoped" ON decision_requests FOR SELECT TO authenticated
USING (
  portfolio_in_current_org(portfolio_id)
  AND (
    requested_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM portfolio_team pt
      WHERE pt.portfolio_id = decision_requests.portfolio_id
        AND pt.user_id = auth.uid()
    )
  )
);
