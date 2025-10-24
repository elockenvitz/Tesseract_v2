/*
  # Add workflow automation rule executor

  1. Functions
    - copy_workflow_with_unique_name: Copies a workflow with a unique name
    - execute_workflow_automation_rule: Executes a single automation rule

  This handles the actual execution of automation rules that branch/copy workflows.
*/

-- Function to copy a workflow with a unique name
CREATE OR REPLACE FUNCTION copy_workflow_with_unique_name(
  source_workflow_id uuid,
  suffix text,
  target_user_id uuid,
  copy_progress boolean DEFAULT true
)
RETURNS uuid AS $$
DECLARE
  v_source_workflow workflows%ROWTYPE;
  v_new_workflow_id uuid;
  v_new_workflow_name text;
  v_stage record;
  v_rule record;
BEGIN
  -- Get source workflow
  SELECT * INTO v_source_workflow
  FROM workflows
  WHERE id = source_workflow_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source workflow not found: %', source_workflow_id;
  END IF;

  -- Generate unique name
  v_new_workflow_name := generate_unique_workflow_name(
    v_source_workflow.name,
    suffix,
    target_user_id
  );

  -- Create new workflow ID
  v_new_workflow_id := gen_random_uuid();

  -- Copy workflow
  INSERT INTO workflows (
    id,
    name,
    description,
    color,
    is_default,
    is_public,
    created_by,
    cadence_days,
    cadence_timeframe,
    kickoff_cadence,
    kickoff_custom_date,
    created_at,
    updated_at
  ) VALUES (
    v_new_workflow_id,
    v_new_workflow_name,
    v_source_workflow.description,
    v_source_workflow.color,
    false, -- New workflows are never default
    false, -- New workflows start as private
    target_user_id,
    v_source_workflow.cadence_days,
    v_source_workflow.cadence_timeframe,
    v_source_workflow.kickoff_cadence,
    v_source_workflow.kickoff_custom_date,
    NOW(),
    NOW()
  );

  -- Copy workflow stages
  FOR v_stage IN
    SELECT * FROM workflow_stages
    WHERE workflow_id = source_workflow_id
    ORDER BY sort_order
  LOOP
    INSERT INTO workflow_stages (
      id,
      workflow_id,
      stage_key,
      stage_label,
      stage_description,
      stage_color,
      stage_icon,
      sort_order,
      standard_deadline_days,
      suggested_priorities,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_new_workflow_id,
      v_stage.stage_key,
      v_stage.stage_label,
      v_stage.stage_description,
      v_stage.stage_color,
      v_stage.stage_icon,
      v_stage.sort_order,
      v_stage.standard_deadline_days,
      v_stage.suggested_priorities,
      NOW(),
      NOW()
    );
  END LOOP;

  -- Copy automation rules (optional - you may want to exclude these)
  FOR v_rule IN
    SELECT * FROM workflow_automation_rules
    WHERE workflow_id = source_workflow_id
  LOOP
    INSERT INTO workflow_automation_rules (
      id,
      workflow_id,
      rule_name,
      rule_type,
      condition_type,
      condition_value,
      action_type,
      action_value,
      is_active,
      created_by,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_new_workflow_id,
      v_rule.rule_name,
      v_rule.rule_type,
      v_rule.condition_type,
      v_rule.condition_value,
      v_rule.action_type,
      v_rule.action_value,
      v_rule.is_active,
      target_user_id,
      NOW(),
      NOW()
    );
  END LOOP;

  RETURN v_new_workflow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to execute a workflow automation rule for an asset
CREATE OR REPLACE FUNCTION execute_workflow_automation_action(
  p_asset_id uuid,
  p_workflow_id uuid,
  p_action_type text,
  p_action_value jsonb,
  p_user_id uuid
)
RETURNS void AS $$
DECLARE
  v_new_workflow_id uuid;
  v_suffix text;
  v_target_stage text;
BEGIN
  CASE p_action_type
    WHEN 'branch_copy' THEN
      -- Get suffix from action value
      v_suffix := p_action_value->>'branch_suffix';

      -- Copy workflow with unique name
      v_new_workflow_id := copy_workflow_with_unique_name(
        p_workflow_id,
        v_suffix,
        p_user_id,
        true -- copy progress
      );

      -- Note: Universe rules are copied with the workflow
      -- The caller should use apply_workflow_to_universe() after this
      -- to assign the new workflow to all assets in its universe

    WHEN 'branch_nocopy' THEN
      -- Get suffix from action value
      v_suffix := p_action_value->>'branch_suffix';

      -- Copy workflow with unique name (don't copy progress)
      v_new_workflow_id := copy_workflow_with_unique_name(
        p_workflow_id,
        v_suffix,
        p_user_id,
        false -- don't copy progress
      );

      -- Note: Universe rules are copied with the workflow
      -- The caller should use apply_workflow_to_universe() after this
      -- to assign the new workflow to all assets in its universe

    WHEN 'move_stage' THEN
      -- Get target stage from action value
      v_target_stage := p_action_value->>'target_stage';

      -- If no target stage specified, use first stage
      IF v_target_stage IS NULL OR v_target_stage = '' THEN
        v_target_stage := (
          SELECT stage_key FROM workflow_stages
          WHERE workflow_id = p_workflow_id
          ORDER BY sort_order
          LIMIT 1
        );
      END IF;

      -- Update asset workflow progress to new stage
      UPDATE asset_workflow_progress
      SET
        current_stage = v_target_stage,
        updated_at = NOW()
      WHERE asset_id = p_asset_id
        AND workflow_id = p_workflow_id;

    WHEN 'reset_complete' THEN
      -- Get target stage from action value
      v_target_stage := p_action_value->>'target_stage';

      -- If no target stage specified, use first stage
      IF v_target_stage IS NULL OR v_target_stage = '' THEN
        v_target_stage := (
          SELECT stage_key FROM workflow_stages
          WHERE workflow_id = p_workflow_id
          ORDER BY sort_order
          LIMIT 1
        );
      END IF;

      -- Reset workflow progress
      UPDATE asset_workflow_progress
      SET
        current_stage = v_target_stage,
        is_started = true,
        is_completed = false,
        started_at = NOW(),
        completed_at = NULL,
        updated_at = NOW()
      WHERE asset_id = p_asset_id
        AND workflow_id = p_workflow_id;

      -- Clear stage completion data
      DELETE FROM asset_stage_completion
      WHERE asset_id = p_asset_id
        AND workflow_id = p_workflow_id;

    ELSE
      RAISE NOTICE 'Unknown action type: %', p_action_type;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION copy_workflow_with_unique_name(uuid, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION execute_workflow_automation_action(uuid, uuid, text, jsonb, uuid) TO authenticated;

-- Comment the functions
COMMENT ON FUNCTION copy_workflow_with_unique_name IS 'Copies a workflow with a unique name using dynamic suffix processing';
COMMENT ON FUNCTION execute_workflow_automation_action IS 'Executes an automation rule action (branch, move stage, etc.) for an asset';
