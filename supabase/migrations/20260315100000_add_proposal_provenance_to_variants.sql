-- Add proposal_id to lab_variants for recommendation provenance tracking.
-- When a variant is created from an analyst recommendation (trade_proposal),
-- this FK links them so Trade Sheet commits can auto-resolve decision requests.

ALTER TABLE lab_variants
  ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES trade_proposals(id) ON DELETE SET NULL;

-- Index for looking up variants by proposal
CREATE INDEX IF NOT EXISTS idx_lab_variants_proposal
  ON lab_variants(proposal_id) WHERE proposal_id IS NOT NULL;

-- Add 'committed' to trade_sheet_status enum if not already present
-- (the existing enum has: draft, pending_approval, approved, sent_to_desk, executed, cancelled)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'committed'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'trade_sheet_status')
  ) THEN
    ALTER TYPE trade_sheet_status ADD VALUE 'committed' AFTER 'draft';
  END IF;
END
$$;

-- Add committed_at / committed_by to trade_sheets for the commit workflow
ALTER TABLE trade_sheets
  ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS committed_by UUID REFERENCES users(id);

-- Add 'accepted_with_modification' to decision_request status check
-- This is needed for auto-resolution when PM adjusts sizing from recommendation
ALTER TABLE decision_requests
  DROP CONSTRAINT IF EXISTS decision_requests_status_check;

ALTER TABLE decision_requests
  ADD CONSTRAINT decision_requests_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'under_review'::text,
    'needs_discussion'::text,
    'accepted'::text,
    'accepted_with_modification'::text,
    'rejected'::text,
    'deferred'::text,
    'withdrawn'::text
  ]));
