-- Add decision_request_id to lab_variants for reverse-linking inbox accepts to variants.
-- Enables undo: find variant by decision_request_id, delete it, revert request to pending.

ALTER TABLE lab_variants
  ADD COLUMN IF NOT EXISTS decision_request_id UUID REFERENCES decision_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lab_variants_decision_request
  ON lab_variants(decision_request_id) WHERE decision_request_id IS NOT NULL;
