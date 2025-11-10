-- Function to auto-create a workflow branch when assets are first assigned
CREATE OR REPLACE FUNCTION auto_create_workflow_branch()
RETURNS TRIGGER AS $$
DECLARE
  v_workflow_id UUID;
  v_auto_create BOOLEAN;
  v_auto_branch_name TEXT;
  v_cadence_timeframe TEXT;
  v_branch_count INTEGER;
  v_new_branch_id UUID;
  v_generated_name TEXT;
  v_parent_workflow RECORD;
BEGIN
  -- Get the workflow ID (could be direct or from parent if already a branch)
  SELECT
    COALESCE(parent_workflow_id, id) INTO v_workflow_id
  FROM workflows
  WHERE id = NEW.workflow_id;

  -- Get workflow settings
  SELECT
    auto_create_branch,
    auto_branch_name,
    cadence_timeframe
  INTO v_auto_create, v_auto_branch_name, v_cadence_timeframe
  FROM workflows
  WHERE id = v_workflow_id;

  -- Only proceed if auto-create is enabled and we have a branch name
  IF v_auto_create AND v_auto_branch_name IS NOT NULL AND v_auto_branch_name != '' THEN
    -- Check if any branches exist for this workflow
    SELECT COUNT(*) INTO v_branch_count
    FROM workflows
    WHERE parent_workflow_id = v_workflow_id
      AND deleted IS NOT TRUE
      AND archived IS NOT TRUE;

    -- Only create if no branches exist yet
    IF v_branch_count = 0 THEN
      -- Get parent workflow details
      SELECT * INTO v_parent_workflow
      FROM workflows
      WHERE id = v_workflow_id;

      -- Generate the branch name
      v_generated_name := generate_unique_workflow_name(
        v_parent_workflow.name,
        v_auto_branch_name
      );

      -- Create the new branch
      INSERT INTO workflows (
        name,
        description,
        color,
        is_public,
        created_by,
        cadence_days,
        cadence_timeframe,
        kickoff_cadence,
        kickoff_custom_date,
        parent_workflow_id,
        branch_suffix,
        branched_at,
        auto_create_branch,
        auto_branch_name
      ) VALUES (
        v_generated_name,
        v_parent_workflow.description,
        v_parent_workflow.color,
        false, -- Branches are always private
        v_parent_workflow.created_by,
        v_parent_workflow.cadence_days,
        v_parent_workflow.cadence_timeframe,
        v_parent_workflow.kickoff_cadence,
        v_parent_workflow.kickoff_custom_date,
        v_workflow_id,
        v_auto_branch_name,
        NOW(),
        false, -- Don't auto-create branches of branches
        NULL
      ) RETURNING id INTO v_new_branch_id;

      -- Copy workflow stages
      INSERT INTO workflow_stages (
        workflow_id,
        stage_key,
        stage_label,
        stage_description,
        stage_color,
        stage_order,
        checklist_template
      )
      SELECT
        v_new_branch_id,
        stage_key,
        stage_label,
        stage_description,
        stage_color,
        stage_order,
        checklist_template
      FROM workflow_stages
      WHERE workflow_id = v_workflow_id
      ORDER BY stage_order;

      -- Copy workflow collaborations
      INSERT INTO workflow_collaborations (
        workflow_id,
        user_id,
        permission_level
      )
      SELECT
        v_new_branch_id,
        user_id,
        permission_level
      FROM workflow_collaborations
      WHERE workflow_id = v_workflow_id;

      -- Copy workflow stakeholders
      INSERT INTO workflow_stakeholders (
        workflow_id,
        user_id
      )
      SELECT
        v_new_branch_id,
        user_id
      FROM workflow_stakeholders
      WHERE workflow_id = v_workflow_id;

      -- Copy universe rules
      INSERT INTO workflow_universe_rules (
        workflow_id,
        rule_type,
        rule_config,
        combination_operator,
        rule_order
      )
      SELECT
        v_new_branch_id,
        rule_type,
        rule_config,
        combination_operator,
        rule_order
      FROM workflow_universe_rules
      WHERE workflow_id = v_workflow_id;

      -- Update the asset assignment to point to the new branch instead
      NEW.workflow_id := v_new_branch_id;

      RAISE NOTICE 'Auto-created workflow branch: % (ID: %)', v_generated_name, v_new_branch_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on asset_workflow_progress
DROP TRIGGER IF EXISTS trigger_auto_create_workflow_branch ON asset_workflow_progress;
CREATE TRIGGER trigger_auto_create_workflow_branch
  BEFORE INSERT ON asset_workflow_progress
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_workflow_branch();

COMMENT ON FUNCTION auto_create_workflow_branch() IS 'Automatically creates a workflow branch when the first asset is assigned to a workflow with auto_create_branch enabled';
