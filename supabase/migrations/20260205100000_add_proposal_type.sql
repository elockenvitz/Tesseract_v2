/*
  # Add proposal_type to trade_proposals

  Distinguishes between analyst-created proposals and PM-initiated decisions.

  proposal_type values:
  - 'analyst': Created by an analyst (default)
  - 'pm_initiated': Created by PM when initiating a decision

  PM-initiated proposals can have analyst input requested.
*/

-- Add proposal_type column
ALTER TABLE trade_proposals
ADD COLUMN IF NOT EXISTS proposal_type TEXT DEFAULT 'analyst';

-- Add constraint for valid proposal types
ALTER TABLE trade_proposals
ADD CONSTRAINT trade_proposals_proposal_type_check
CHECK (proposal_type IN ('analyst', 'pm_initiated'));

-- Add index for filtering by proposal type
CREATE INDEX IF NOT EXISTS idx_trade_proposals_proposal_type
ON trade_proposals(proposal_type);

-- Add analyst_input_requested column for PM-initiated proposals
-- When true, PM has requested analyst to provide sizing input
ALTER TABLE trade_proposals
ADD COLUMN IF NOT EXISTS analyst_input_requested BOOLEAN DEFAULT false;

-- Add analyst_input_requested_at timestamp
ALTER TABLE trade_proposals
ADD COLUMN IF NOT EXISTS analyst_input_requested_at TIMESTAMPTZ;

-- Comment explaining the columns
COMMENT ON COLUMN trade_proposals.proposal_type IS 'Type of proposal: analyst (created by analyst) or pm_initiated (created by PM when initiating decision)';
COMMENT ON COLUMN trade_proposals.analyst_input_requested IS 'For PM-initiated proposals, whether PM has requested analyst to provide sizing input';
COMMENT ON COLUMN trade_proposals.analyst_input_requested_at IS 'Timestamp when analyst input was requested';
