-- Update status column to use 'inactive' instead of 'ended'

-- First, update any existing 'ended' values to 'inactive'
UPDATE workflows SET status = 'inactive' WHERE status = 'ended';

-- Drop the old constraint
ALTER TABLE workflows
DROP CONSTRAINT IF EXISTS workflows_status_check;

-- Add new constraint with 'inactive' instead of 'ended'
ALTER TABLE workflows
ADD CONSTRAINT workflows_status_check CHECK (status IN ('active', 'inactive'));

-- Update the column comment
COMMENT ON COLUMN workflows.status IS 'Status of the workflow branch - active or inactive';
