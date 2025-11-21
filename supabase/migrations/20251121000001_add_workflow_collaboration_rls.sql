/*
  # Simplify workflow permissions and add collaboration RLS

  This migration simplifies the permission model:
  - Removes 'owner' and 'write' permissions
  - Only 'admin' and 'read' permissions remain
  - Workflow creators are treated as admins
  - Admins can edit templates, versions, and branches
  - Stakeholders have read-only access

  Uses a SECURITY DEFINER function to avoid infinite recursion in RLS policies.
*/

-- Update existing collaborations: convert write and owner to admin
UPDATE workflow_collaborations
SET permission = 'admin'
WHERE permission IN ('write', 'owner');

-- Add constraint to only allow admin or read permissions
DO $$
BEGIN
  -- Drop constraint if it exists
  ALTER TABLE workflow_collaborations
    DROP CONSTRAINT IF EXISTS workflow_collaborations_permission_check;

  -- Add new constraint
  ALTER TABLE workflow_collaborations
    ADD CONSTRAINT workflow_collaborations_permission_check
    CHECK (permission IN ('admin', 'read'));
END $$;

-- Add comment
COMMENT ON COLUMN workflow_collaborations.permission IS
  'Permission level: admin (full edit rights) or read (stakeholder, read-only)';

-- Create a security definer function to check if user has access to a workflow
-- This avoids infinite recursion in RLS policies
CREATE OR REPLACE FUNCTION user_has_workflow_access(workflow_id_param UUID, user_id_param UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Check if user created the workflow
  IF EXISTS (
    SELECT 1 FROM workflows
    WHERE id = workflow_id_param AND created_by = user_id_param
  ) THEN
    RETURN TRUE;
  END IF;

  -- Check if user is a collaborator
  IF EXISTS (
    SELECT 1 FROM workflow_collaborations
    WHERE workflow_id = workflow_id_param AND user_id = user_id_param
  ) THEN
    RETURN TRUE;
  END IF;

  -- Check if user is a stakeholder
  IF EXISTS (
    SELECT 1 FROM workflow_stakeholders
    WHERE workflow_id = workflow_id_param AND user_id = user_id_param
  ) THEN
    RETURN TRUE;
  END IF;

  -- Check if workflow is public
  IF EXISTS (
    SELECT 1 FROM workflows
    WHERE id = workflow_id_param AND is_public = true
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Add policy for users to view workflows where they are collaborators or stakeholders
CREATE POLICY "Users can view workflows they have access to"
  ON workflows
  FOR SELECT
  USING (
    user_has_workflow_access(id, auth.uid())
  );

-- Add policy for users to view branches of workflows they have access to
CREATE POLICY "Users can view branches of accessible parent workflows"
  ON workflows
  FOR SELECT
  USING (
    parent_workflow_id IS NOT NULL
    AND user_has_workflow_access(parent_workflow_id, auth.uid())
  );

-- Add comments
COMMENT ON FUNCTION user_has_workflow_access IS
  'Security definer function to check if a user has access to a workflow (as creator, collaborator, stakeholder, or if public)';

COMMENT ON POLICY "Users can view workflows they have access to" ON workflows IS
  'Allows users to view workflows where they are creator, collaborator, or stakeholder';

COMMENT ON POLICY "Users can view branches of accessible parent workflows" ON workflows IS
  'Allows users to view workflow branches if they have access to the parent workflow';
