-- Reconstructed locally to match remote-applied migration. Original applied 2026-03-14.
-- Extends decision_requests to support 'under_review' and 'needs_discussion' statuses.
-- Updates the CHECK constraint and partial unique indexes accordingly.

-- Drop the old status CHECK constraint and replace with expanded set
ALTER TABLE decision_requests DROP CONSTRAINT IF EXISTS decision_requests_status_check;
ALTER TABLE decision_requests ADD CONSTRAINT decision_requests_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'under_review'::text,
    'needs_discussion'::text,
    'accepted'::text,
    'rejected'::text,
    'deferred'::text,
    'withdrawn'::text
  ]));

-- Recreate the partial unique index to include the new active statuses
DROP INDEX IF EXISTS idx_decision_requests_active_per_requester;
CREATE UNIQUE INDEX idx_decision_requests_active_per_requester
  ON decision_requests (trade_queue_item_id, portfolio_id, requested_by)
  WHERE (status = ANY (ARRAY['pending'::text, 'under_review'::text, 'needs_discussion'::text]));
