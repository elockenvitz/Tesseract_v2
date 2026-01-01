/*
  # Fix asset workflow checklist item creation

  When an asset is manually added to a workflow, the trigger was only creating
  the asset_workflow_progress record but NOT:
  1. Setting the current_stage_key to the first stage
  2. Creating asset_checklist_items from workflow_checklist_templates

  This migration fixes the trigger to fully initialize the asset in the workflow.
*/

-- Drop and recreate the function with full initialization
CREATE OR REPLACE FUNCTION auto_start_manually_added_asset()
RETURNS TRIGGER AS $$
DECLARE
  v_workflow_status TEXT;
  v_workflow_parent_id UUID;
  v_first_stage_key TEXT;
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

  -- Get the first stage key for this workflow (ordered by sort_order)
  SELECT stage_key INTO v_first_stage_key
  FROM workflow_stages
  WHERE workflow_id = NEW.workflow_id
  ORDER BY sort_order ASC
  LIMIT 1;

  -- Only auto-start for active workflows (branches with status = 'active')
  IF v_workflow_status = 'active' AND v_workflow_parent_id IS NOT NULL THEN
    -- Create workflow progress record with is_started = true and first stage set
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
      v_first_stage_key  -- Set to first stage
    );

    -- Create asset_checklist_items from workflow_checklist_templates
    INSERT INTO asset_checklist_items (
      asset_id,
      workflow_id,
      stage_id,
      item_id,
      item_text,
      sort_order,
      completed
    )
    SELECT
      NEW.asset_id,
      NEW.workflow_id,
      wct.stage_id,
      wct.item_id,
      wct.item_text,
      wct.sort_order,
      false
    FROM workflow_checklist_templates wct
    WHERE wct.workflow_id = NEW.workflow_id
    ON CONFLICT (asset_id, workflow_id, stage_id, item_id) DO NOTHING;

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

-- Update comment
COMMENT ON FUNCTION auto_start_manually_added_asset() IS 'Automatically creates workflow progress, sets first stage, and creates checklist items for manually added assets in active branches';
