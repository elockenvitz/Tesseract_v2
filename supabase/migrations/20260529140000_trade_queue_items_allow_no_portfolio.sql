-- Allow `trade_queue_items` rows with `portfolio_id IS NULL` to be
-- visible to their creator.
--
-- Symptom: a pilot user submitting a trade idea WITHOUT selecting a
-- portfolio got a "Couldn't save trade idea due to permissions" toast.
-- The INSERT itself was succeeding (INSERT policy is just
-- `auth.uid() = created_by`), but the `.select()` chained on by the
-- Supabase client ran the SELECT policy on the newly-inserted row:
--
--   portfolio_in_current_org(portfolio_id) AND (...)
--
-- That helper does a EXISTS lookup against `portfolios` keyed on the
-- argument, so `portfolio_in_current_org(NULL)` returns FALSE. The
-- creator's own brand-new row was instantly hidden from them, and
-- PostgREST surfaced the empty result as a permission failure.
--
-- Fix: extend the policy with a branch for portfolio-less ideas
-- (private to their creator). No org dimension exists for these rows
-- so the only person who ever needs to read them is the user that
-- created them — there is no cross-org concern.

DROP POLICY IF EXISTS "Trade queue: org-scoped access" ON trade_queue_items;

CREATE POLICY "Trade queue: org-scoped access" ON trade_queue_items
FOR SELECT TO authenticated
USING (
  -- Portfolio-less personal ideas: visible only to the creator. No
  -- org membership check applies because there is no portfolio to
  -- hang one off of.
  (portfolio_id IS NULL AND created_by = auth.uid())
  OR (
    -- Existing portfolio-scoped behavior, unchanged.
    portfolio_in_current_org(portfolio_id)
    AND (
      sharing_visibility IS DISTINCT FROM 'private'
      OR created_by = auth.uid()
      OR assigned_to = auth.uid()
    )
  )
);
