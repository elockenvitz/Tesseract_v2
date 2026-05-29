-- Extend the portfolio-less branch of the trade_queue_items SELECT
-- policy so an explicitly-assigned user can also see the row, not
-- just the creator.
--
-- The previous migration (20260529140000) added a portfolio-less
-- branch that only granted visibility to the creator. That covers
-- the case where a user captures an idea without picking a portfolio
-- and keeps it as a personal draft. But it didn't cover the second
-- expected UX: opening the idea card, assigning a teammate, and
-- having the assignee pick it up from their own pipeline. Without
-- this extension, the assignment would set the column but the
-- assignee couldn't see the row until a portfolio was also attached.
--
-- The UPDATE policy already allows assignees to edit the row
-- (auth.uid() = assigned_to is one of its OR'd branches), so this
-- aligns SELECT with UPDATE.
--
-- Cross-org concern: there isn't one in practice. The recent user-
-- picker sweep (fix/org-scope-remaining-user-pickers) restricts every
-- assignee picker to current-org members via useOrgMembers, so the
-- assignee will always be in the same org as the creator.

DROP POLICY IF EXISTS "Trade queue: org-scoped access" ON trade_queue_items;

CREATE POLICY "Trade queue: org-scoped access" ON trade_queue_items
FOR SELECT TO authenticated
USING (
  -- Portfolio-less personal ideas: visible to the creator AND to any
  -- explicitly assigned user. No org membership check applies because
  -- there is no portfolio to hang one off of; the picker layer
  -- restricts assignment to the creator's current-org members.
  (
    portfolio_id IS NULL
    AND (created_by = auth.uid() OR assigned_to = auth.uid())
  )
  OR (
    -- Portfolio-scoped: unchanged.
    portfolio_in_current_org(portfolio_id)
    AND (
      sharing_visibility IS DISTINCT FROM 'private'
      OR created_by = auth.uid()
      OR assigned_to = auth.uid()
    )
  )
);
