/*
  # Add Workflow Archive Support

  Add archived field to workflows table to support soft-delete/archiving.
  Archived workflows are hidden from main UI but all data is preserved.
  Assets remain assigned to archived workflows, but filtered out in UI.
*/

-- Add archived column to workflows table
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- Add archived_at timestamp for tracking
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Add archived_by to track who archived it
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id);

-- Create index for filtering archived workflows
CREATE INDEX IF NOT EXISTS idx_workflows_archived ON workflows(archived) WHERE archived = false;
