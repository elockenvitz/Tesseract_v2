/*
  # Auto-start manually added assets in workflows

  This migration creates a trigger that automatically creates a workflow progress
  record with is_started=true when an asset is manually added to a workflow via
  universe overrides.

  When a user manually adds an asset to an active workflow, it should inherit
  the workflow's state and be started automatically.
*/

-- Create function to auto-start manually added assets
CREATE OR REPLACE FUNCTION auto_start_manually_added_asset()
RETURNS TRIGGER AS $$
DECLARE
  v_workflow_status TEXT;
  v_workflow_parent_id UUID;
BEGIN
  -- Only process 'add' overrides
  IF NEW.override_type != 'add' THEN
    RETURN NEW;
  END IF;

  -- Get the workflow status and check if it's a branch
  SELECT status, parent_workflow_id
  INTO v_workflow_status, v_workflow_parent_id
  FROM workflows
  WHERE id = NEW.workflow_id;

  -- Check if asset_workflow_progress record already exists
  IF EXISTS (
    SELECT 1
    FROM asset_workflow_progress
    WHERE asset_id = NEW.asset_id
    AND workflow_id = NEW.workflow_id
  ) THEN
    -- Record already exists, don't create duplicate
    RETURN NEW;
  END IF;

  -- Only auto-start for active workflows (branches with status = 'active')
  IF v_workflow_status = 'active' AND v_workflow_parent_id IS NOT NULL THEN
    -- Create workflow progress record with is_started = true
    INSERT INTO asset_workflow_progress (
      asset_id,
      workflow_id,
      is_started,
      is_completed,
      started_at,
      current_stage_key
    ) VALUES (
      NEW.asset_id,
      NEW.workflow_id,
      true,  -- Auto-start the workflow
      false,
      NOW(),
      NULL  -- Will be set when user navigates to first stage
    );
  ELSE
    -- For inactive workflows or templates, create progress record but don't start
    INSERT INTO asset_workflow_progress (
      asset_id,
      workflow_id,
      is_started,
      is_completed
    ) VALUES (
      NEW.asset_id,
      NEW.workflow_id,
      false,
      false
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on workflow_universe_overrides
DROP TRIGGER IF EXISTS trigger_auto_start_manually_added_asset ON workflow_universe_overrides;
CREATE TRIGGER trigger_auto_start_manually_added_asset
  AFTER INSERT ON workflow_universe_overrides
  FOR EACH ROW
  EXECUTE FUNCTION auto_start_manually_added_asset();

-- Add comment
COMMENT ON FUNCTION auto_start_manually_added_asset() IS 'Automatically creates workflow progress and starts workflow for manually added assets in active branches';
