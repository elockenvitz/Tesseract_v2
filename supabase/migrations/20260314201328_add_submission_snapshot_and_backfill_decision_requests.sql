-- Reconstructed locally to match remote-applied migration. Original applied 2026-03-14.
-- Adds submission_snapshot and requested_action columns to decision_requests,
-- then backfills decision_requests for trade_proposals that lack one.

ALTER TABLE decision_requests ADD COLUMN IF NOT EXISTS submission_snapshot jsonb;
ALTER TABLE decision_requests ADD COLUMN IF NOT EXISTS requested_action text;

-- Backfill: create a pending decision_request for every active trade_proposal
-- that does not already have one.
INSERT INTO decision_requests (
  trade_queue_item_id,
  requested_by,
  portfolio_id,
  proposal_id,
  requested_action,
  submission_snapshot,
  status,
  urgency
)
SELECT
  tp.trade_queue_item_id,
  tp.user_id,
  tp.portfolio_id,
  tp.id,
  'review',
  jsonb_build_object(
    'weight', tp.weight,
    'shares', tp.shares,
    'sizing_mode', tp.sizing_mode,
    'sizing_context', tp.sizing_context,
    'notes', tp.notes,
    'proposal_type', tp.proposal_type,
    'created_at', tp.created_at
  ),
  'pending',
  'medium'
FROM trade_proposals tp
WHERE tp.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM decision_requests dr
    WHERE dr.proposal_id = tp.id
  );
