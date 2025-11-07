/*
  # Add Workflow Delete Support

  Add deleted field to workflows table to support soft-delete.
  Deleted workflows are hidden from main UI but can be viewed in a separate "Deleted Workflows" section.
  Users can restore deleted workflows or permanently remove them.
*/

-- Add deleted column to workflows table
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;

-- Add deleted_at timestamp for tracking
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add deleted_by to track who deleted it
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- Create index for filtering deleted workflows
CREATE INDEX IF NOT EXISTS idx_workflows_deleted ON workflows(deleted) WHERE deleted = false;

-- Create index for viewing deleted workflows
CREATE INDEX IF NOT EXISTS idx_workflows_deleted_true ON workflows(deleted) WHERE deleted = true;
