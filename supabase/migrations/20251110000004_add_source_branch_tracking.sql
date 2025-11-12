-- Add source_branch_id to track which branch was copied from when creating a new branch
ALTER TABLE workflows
ADD COLUMN IF NOT EXISTS source_branch_id UUID REFERENCES workflows(id) ON DELETE SET NULL;

-- Add index for source branch lookups
CREATE INDEX IF NOT EXISTS idx_workflows_source_branch ON workflows(source_branch_id);

COMMENT ON COLUMN workflows.source_branch_id IS 'The branch that was used as the source when copying progress to create this branch';
