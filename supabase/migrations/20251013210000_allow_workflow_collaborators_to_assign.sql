/*
  # Allow Workflow Collaborators to Assign Tasks and Stages

  This migration updates the RLS policies on checklist_task_assignments and stage_assignments to allow:
  1. Asset owners to assign tasks/stages (existing behavior)
  2. Workflow collaborators with write or admin access to assign tasks/stages (new behavior)
  3. Users with access to public workflows to assign tasks/stages (new behavior)

  Changes:
  - Drop existing restrictive policies on both tables
  - Create new policies that check both asset ownership and workflow collaboration
*/

-- Drop existing policies for task assignments
DROP POLICY IF EXISTS "Users can create task assignments" ON checklist_task_assignments;
DROP POLICY IF EXISTS "Users can update task assignments they created" ON checklist_task_assignments;
DROP POLICY IF EXISTS "Users can delete task assignments they created" ON checklist_task_assignments;

-- Drop existing policies for stage assignments
DROP POLICY IF EXISTS "Users can create stage assignments" ON stage_assignments;
DROP POLICY IF EXISTS "Users can update stage assignments they created" ON stage_assignments;
DROP POLICY IF EXISTS "Users can delete stage assignments they created" ON stage_assignments;

-- Create new INSERT policy for task assignments: Allow if user owns asset OR has write/admin access to workflow
CREATE POLICY "Users can create task assignments with workflow access"
ON checklist_task_assignments FOR INSERT
WITH CHECK (
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

-- Create new UPDATE policy for task assignments: Allow if user owns asset OR has write/admin access to workflow
CREATE POLICY "Users can update task assignments with workflow access"
ON checklist_task_assignments FOR UPDATE
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
)
WITH CHECK (
  -- Same conditions for the updated row
  checklist_item_id IN (
    SELECT ci.id FROM asset_checklist_items ci
    JOIN assets a ON ci.asset_id = a.id
    WHERE a.created_by = auth.uid()
  )
  OR
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

-- Create new DELETE policy for task assignments: Allow if user owns asset OR has admin access to workflow
CREATE POLICY "Users can delete task assignments with admin access"
ON checklist_task_assignments FOR DELETE
USING (
  -- User owns the asset
  checklist_item_id IN (
    SELECT ci.id FROM asset_checklist_items ci
    JOIN assets a ON ci.asset_id = a.id
    WHERE a.created_by = auth.uid()
  )
  OR
  -- User has admin access to the workflow (or created the assignment)
  (assigned_by = auth.uid() OR checklist_item_id IN (
    SELECT ci.id FROM asset_checklist_items ci
    WHERE ci.workflow_id IN (
      SELECT id FROM workflows
      WHERE created_by = auth.uid()
      OR id IN (
        SELECT workflow_id FROM workflow_collaborations
        WHERE user_id = auth.uid()
        AND permission = 'admin'
      )
    )
  ))
);

-- Create new INSERT policy for stage assignments: Allow if user owns asset OR has write/admin access to workflow
CREATE POLICY "Users can create stage assignments with workflow access"
ON stage_assignments FOR INSERT
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

-- Create new UPDATE policy for stage assignments: Allow if user owns asset OR has write/admin access to workflow
CREATE POLICY "Users can update stage assignments with workflow access"
ON stage_assignments FOR UPDATE
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

-- Create new DELETE policy for stage assignments: Allow if user owns asset OR has admin access to workflow
CREATE POLICY "Users can delete stage assignments with admin access"
ON stage_assignments FOR DELETE
USING (
  -- User owns the asset
  asset_id IN (
    SELECT id FROM assets WHERE created_by = auth.uid()
  )
  OR
  -- User has admin access to the workflow (or created the assignment)
  (assigned_by = auth.uid() OR workflow_id IN (
    SELECT id FROM workflows
    WHERE created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission = 'admin'
    )
  ))
);
