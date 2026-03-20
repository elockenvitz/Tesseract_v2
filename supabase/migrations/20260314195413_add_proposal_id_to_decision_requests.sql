-- Reconstructed locally to match remote-applied migration. Original applied 2026-03-14.
-- Adds proposal_id FK column and a partial unique index to prevent duplicate active
-- decision requests for the same proposal.

ALTER TABLE decision_requests ADD COLUMN IF NOT EXISTS proposal_id uuid REFERENCES trade_proposals(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_requests_active_proposal
  ON decision_requests (proposal_id)
  WHERE (proposal_id IS NOT NULL AND status = ANY (ARRAY['pending'::text, 'under_review'::text, 'needs_discussion'::text]));
