/*
  # Add helper function for copy and kickoff workflow

  1. Functions
    - copy_and_kickoff_workflow: Copies a workflow and applies it to its universe in one operation

  This simplifies the workflow automation process by combining copy + universe application.
*/

-- Helper function to copy a workflow and apply it to its universe
CREATE OR REPLACE FUNCTION copy_and_kickoff_workflow(
  p_source_workflow_id uuid,
  p_suffix text,
  p_user_id uuid,
  p_copy_progress boolean DEFAULT true,
  p_start_workflow boolean DEFAULT true
)
RETURNS jsonb AS $$
DECLARE
  v_new_workflow_id uuid;
  v_asset_count integer;
  v_result jsonb;
BEGIN
  -- Copy the workflow with unique name
  v_new_workflow_id := copy_workflow_with_unique_name(
    p_source_workflow_id,
    p_suffix,
    p_user_id,
    p_copy_progress
  );

  -- Apply the workflow to its universe
  -- Note: Universe rules are automatically copied with the workflow
  v_asset_count := apply_workflow_to_universe(
    v_new_workflow_id,
    p_user_id,
    p_start_workflow
  );

  -- Return result with workflow ID and asset count
  v_result := jsonb_build_object(
    'workflow_id', v_new_workflow_id,
    'asset_count', v_asset_count,
    'workflow_name', (SELECT name FROM workflows WHERE id = v_new_workflow_id)
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION copy_and_kickoff_workflow(uuid, text, uuid, boolean, boolean) TO authenticated;

-- Comment the function
COMMENT ON FUNCTION copy_and_kickoff_workflow IS 'Copies a workflow with a unique name and applies it to all assets in its universe';
