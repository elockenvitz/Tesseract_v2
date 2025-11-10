-- Add auto-branch creation fields to workflows table
ALTER TABLE workflows
ADD COLUMN IF NOT EXISTS auto_create_branch BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_branch_name TEXT;

-- Comment on the new columns
COMMENT ON COLUMN workflows.auto_create_branch IS 'Whether to automatically create a branch when the workflow is first used or cadence triggers';
COMMENT ON COLUMN workflows.auto_branch_name IS 'The name/suffix to use for auto-created branches. For perpetual workflows, this is the full branch name. For cadenced workflows, this can include placeholders like {MONTH}, {YEAR}, {QUARTER}';
