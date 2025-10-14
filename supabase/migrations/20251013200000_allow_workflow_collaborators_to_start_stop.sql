/*
  # Allow Workflow Collaborators to Start/Stop Workflows

  This migration updates the RLS policies on asset_workflow_progress to allow:
  1. Asset owners to start/stop workflows (existing behavior)
  2. Workflow collaborators with write or admin access to start/stop workflows (new behavior)
  3. Users with access to public workflows to start/stop them (new behavior)

  Changes:
  - Drop existing restrictive policies
  - Create new policies that check both asset ownership and workflow collaboration
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can insert workflow progress for their assets" ON asset_workflow_progress;
DROP POLICY IF EXISTS "Users can update workflow progress for their assets" ON asset_workflow_progress;
DROP POLICY IF EXISTS "Users can delete workflow progress for their assets" ON asset_workflow_progress;
DROP POLICY IF EXISTS "Users can read workflow progress for their assets" ON asset_workflow_progress;

-- Create new SELECT policy: Allow reading if user owns asset OR has workflow access
CREATE POLICY "Users can read workflow progress with access"
ON asset_workflow_progress FOR SELECT
USING (
  -- User owns the asset
  asset_id IN (
    SELECT id FROM assets WHERE created_by = auth.uid()
  )
  OR
  -- User has access to the workflow (via collaboration or public workflow)
  workflow_id IN (
    SELECT id FROM workflows
    WHERE is_public = true
    OR created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
    )
  )
);

-- Create new INSERT policy: Allow starting workflow if user owns asset OR has write/admin access to workflow
CREATE POLICY "Users can start workflows with access"
ON asset_workflow_progress FOR INSERT
WITH CHECK (
  -- User owns the asset
  asset_id IN (
    SELECT id FROM assets WHERE created_by = auth.uid()
  )
  OR
  -- User has write or admin access to the workflow
  workflow_id IN (
    SELECT id FROM workflows
    WHERE is_public = true
    OR created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission IN ('write', 'admin')
    )
  )
);

-- Create new UPDATE policy: Allow updating workflow progress if user owns asset OR has write/admin access to workflow
CREATE POLICY "Users can update workflow progress with access"
ON asset_workflow_progress FOR UPDATE
USING (
  -- User owns the asset
  asset_id IN (
    SELECT id FROM assets WHERE created_by = auth.uid()
  )
  OR
  -- User has write or admin access to the workflow
  workflow_id IN (
    SELECT id FROM workflows
    WHERE is_public = true
    OR created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission IN ('write', 'admin')
    )
  )
)
WITH CHECK (
  -- Same conditions for the updated row
  asset_id IN (
    SELECT id FROM assets WHERE created_by = auth.uid()
  )
  OR
  workflow_id IN (
    SELECT id FROM workflows
    WHERE is_public = true
    OR created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission IN ('write', 'admin')
    )
  )
);

-- Create new DELETE policy: Allow deleting workflow progress if user owns asset OR has admin access to workflow
CREATE POLICY "Users can delete workflow progress with admin access"
ON asset_workflow_progress FOR DELETE
USING (
  -- User owns the asset
  asset_id IN (
    SELECT id FROM assets WHERE created_by = auth.uid()
  )
  OR
  -- User has admin access to the workflow
  workflow_id IN (
    SELECT id FROM workflows
    WHERE created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission = 'admin'
    )
  )
);
