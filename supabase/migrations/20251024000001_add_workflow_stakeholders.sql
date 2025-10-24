/*
  # Add workflow stakeholders

  1. New Tables
    - workflow_stakeholders
      - Tracks users who will be using the workflow (beyond collaborators with permissions)

  2. Security
    - Enable RLS on workflow_stakeholders
    - Add policies for viewing and managing stakeholders
*/

-- Create workflow_stakeholders table
CREATE TABLE IF NOT EXISTS workflow_stakeholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE(workflow_id, user_id)
);

-- Enable RLS
ALTER TABLE workflow_stakeholders ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view stakeholders for workflows they have access to
CREATE POLICY "Users can view workflow stakeholders"
  ON workflow_stakeholders
  FOR SELECT
  USING (
    -- Workflow is public
    EXISTS (
      SELECT 1 FROM workflows
      WHERE id = workflow_stakeholders.workflow_id
      AND is_public = true
    )
    OR
    -- User is the workflow owner
    EXISTS (
      SELECT 1 FROM workflows
      WHERE id = workflow_stakeholders.workflow_id
      AND created_by = auth.uid()
    )
    OR
    -- User is a collaborator
    EXISTS (
      SELECT 1 FROM workflow_collaborations
      WHERE workflow_id = workflow_stakeholders.workflow_id
      AND user_id = auth.uid()
    )
    OR
    -- User is a stakeholder
    user_id = auth.uid()
  );

-- Policy: Workflow admins and owners can add stakeholders
CREATE POLICY "Workflow admins can add stakeholders"
  ON workflow_stakeholders
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflows
      WHERE id = workflow_stakeholders.workflow_id
      AND created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM workflow_collaborations
      WHERE workflow_id = workflow_stakeholders.workflow_id
      AND user_id = auth.uid()
      AND permission IN ('admin', 'write')
    )
  );

-- Policy: Workflow admins and owners can remove stakeholders
CREATE POLICY "Workflow admins can remove stakeholders"
  ON workflow_stakeholders
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workflows
      WHERE id = workflow_stakeholders.workflow_id
      AND created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM workflow_collaborations
      WHERE workflow_id = workflow_stakeholders.workflow_id
      AND user_id = auth.uid()
      AND permission IN ('admin', 'write')
    )
  );

-- Create index for performance
CREATE INDEX idx_workflow_stakeholders_workflow_id ON workflow_stakeholders(workflow_id);
CREATE INDEX idx_workflow_stakeholders_user_id ON workflow_stakeholders(user_id);

-- Comment the table
COMMENT ON TABLE workflow_stakeholders IS 'Tracks users who will be using the workflow (beyond collaborators with permissions)';
