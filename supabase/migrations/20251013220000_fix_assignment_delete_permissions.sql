/*
  # Fix Assignment Delete Permissions

  Allow workflow collaborators with write or admin access to delete assignments
  (not just admin). This aligns with the insert/update permissions.
*/

-- Drop existing restrictive DELETE policies
DROP POLICY IF EXISTS "Users can delete task assignments with admin access" ON checklist_task_assignments;
DROP POLICY IF EXISTS "Users can delete stage assignments with admin access" ON stage_assignments;

-- Create new DELETE policy for task assignments: Allow if user owns asset OR has write/admin access to workflow
CREATE POLICY "Users can delete task assignments with workflow access"
ON checklist_task_assignments FOR DELETE
USING (
  -- User owns the asset
  checklist_item_id IN (
    SELECT ci.id FROM asset_checklist_items ci
    JOIN assets a ON ci.asset_id = a.id
    WHERE a.created_by = auth.uid()
  )
  OR
  -- User has write or admin access to the workflow
  checklist_item_id IN (
    SELECT ci.id FROM asset_checklist_items ci
    WHERE ci.workflow_id IN (
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
);

-- Create new DELETE policy for stage assignments: Allow if user owns asset OR has write/admin access to workflow
CREATE POLICY "Users can delete stage assignments with workflow access"
ON stage_assignments FOR DELETE
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
);
