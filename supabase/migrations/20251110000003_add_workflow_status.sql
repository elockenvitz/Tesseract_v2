-- Add status column to workflows table
ALTER TABLE workflows
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended'));

-- Add index for status filtering
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

-- Update existing workflows to have 'active' status
UPDATE workflows SET status = 'active' WHERE status IS NULL;

COMMENT ON COLUMN workflows.status IS 'Status of the workflow branch - active or ended';
