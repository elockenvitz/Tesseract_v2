/*
  # Fix trigger RLS bypass for auto_start_manually_added_asset

  The trigger function needs to bypass RLS when inserting into asset_workflow_progress
  because triggers don't have an auth context (auth.uid() returns NULL).

  We'll update the INSERT policy on asset_workflow_progress to allow the trigger
  to insert by granting the postgres role the ability to insert.
*/

-- Grant the service role permission to bypass RLS on asset_workflow_progress
-- The trigger runs as SECURITY DEFINER which uses the owner's permissions
ALTER TABLE asset_workflow_progress FORCE ROW LEVEL SECURITY;

-- Create a policy that allows service role to insert
DROP POLICY IF EXISTS "Service role can manage workflow progress" ON asset_workflow_progress;
CREATE POLICY "Service role can manage workflow progress"
  ON asset_workflow_progress
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- Add comment
COMMENT ON POLICY "Service role can manage workflow progress" ON asset_workflow_progress IS
  'Allows triggers and system functions to manage workflow progress records';
