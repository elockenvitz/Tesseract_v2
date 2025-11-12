-- Set deleted and archived branches to inactive status
-- This ensures data consistency where deleted/archived branches should not be active

-- Update deleted branches to inactive
UPDATE workflows
SET status = 'inactive'
WHERE deleted = true AND status = 'active';

-- Update archived branches to inactive
UPDATE workflows
SET status = 'inactive'
WHERE archived = true AND status = 'active';

-- Add comment explaining the constraint
COMMENT ON COLUMN workflows.status IS 'Status of the workflow branch - active or inactive. Deleted and archived branches should always be inactive.';
