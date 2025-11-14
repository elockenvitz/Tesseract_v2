/*
  # Add Version Activation/Rollback

  Adds functionality to activate (rollback to) a previous template version:
  - Function to activate a specific version
  - Updates workflow stages, checklists, and rules from version snapshot
  - Marks the activated version as active
*/

-- Function to activate/rollback to a specific template version
CREATE OR REPLACE FUNCTION activate_template_version(
  p_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workflow_id UUID;
  v_version_data RECORD;
  v_stage JSONB;
  v_checklist JSONB;
  v_rule JSONB;
  v_universe_rule JSONB;
  v_stage_id UUID;
BEGIN
  -- Get the version data
  SELECT
    workflow_id,
    stages,
    checklist_templates,
    automation_rules,
    universe_rules
  INTO v_version_data
  FROM workflow_template_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  v_workflow_id := v_version_data.workflow_id;

  -- Deactivate all versions for this workflow
  UPDATE workflow_template_versions
  SET is_active = false
  WHERE workflow_id = v_workflow_id;

  -- Activate the selected version
  UPDATE workflow_template_versions
  SET is_active = true
  WHERE id = p_version_id;

  -- Clear existing stages
  DELETE FROM workflow_stages
  WHERE workflow_id = v_workflow_id;

  -- Restore stages from version snapshot
  FOR v_stage IN SELECT * FROM jsonb_array_elements(v_version_data.stages)
  LOOP
    INSERT INTO workflow_stages (
      workflow_id,
      stage_key,
      stage_label,
      stage_description,
      stage_color,
      sort_order,
      stage_icon
    )
    VALUES (
      v_workflow_id,
      (v_stage->>'key')::TEXT,
      (v_stage->>'name')::TEXT,
      (v_stage->>'description')::TEXT,
      (v_stage->>'color')::TEXT,
      (v_stage->>'order_index')::INTEGER,
      (v_stage->>'icon')::TEXT
    )
    RETURNING id INTO v_stage_id;
  END LOOP;

  -- Clear existing checklist templates
  DELETE FROM workflow_checklist_templates
  WHERE workflow_id = v_workflow_id;

  -- Restore checklist templates from version snapshot
  IF v_version_data.checklist_templates IS NOT NULL THEN
    FOR v_checklist IN SELECT * FROM jsonb_array_elements(v_version_data.checklist_templates)
    LOOP
      INSERT INTO workflow_checklist_templates (
        workflow_id,
        stage_id,
        item_id,
        item_text,
        sort_order,
        is_required
      )
      VALUES (
        v_workflow_id,
        (v_checklist->>'stage_id')::UUID,
        (v_checklist->>'item_id')::TEXT,
        (v_checklist->>'item_text')::TEXT,
        (v_checklist->>'sort_order')::INTEGER,
        COALESCE((v_checklist->>'is_required')::BOOLEAN, false)
      );
    END LOOP;
  END IF;

  -- Clear existing automation rules
  DELETE FROM workflow_automation_rules
  WHERE workflow_id = v_workflow_id;

  -- Restore automation rules from version snapshot
  IF v_version_data.automation_rules IS NOT NULL THEN
    FOR v_rule IN SELECT * FROM jsonb_array_elements(v_version_data.automation_rules)
    LOOP
      INSERT INTO workflow_automation_rules (
        workflow_id,
        rule_name,
        rule_type,
        condition_type,
        condition_value,
        action_type,
        action_value,
        is_active
      )
      VALUES (
        v_workflow_id,
        (v_rule->>'rule_name')::TEXT,
        (v_rule->>'rule_type')::TEXT,
        (v_rule->>'condition_type')::TEXT,
        (v_rule->>'condition_value')::TEXT,
        (v_rule->>'action_type')::TEXT,
        (v_rule->>'action_value')::TEXT,
        COALESCE((v_rule->>'is_active')::BOOLEAN, true)
      );
    END LOOP;
  END IF;

  -- Clear existing universe rules if the table exists
  DELETE FROM workflow_universe_rules
  WHERE workflow_id = v_workflow_id;

  -- Restore universe rules from version snapshot
  IF v_version_data.universe_rules IS NOT NULL THEN
    FOR v_universe_rule IN SELECT * FROM jsonb_array_elements(v_version_data.universe_rules)
    LOOP
      INSERT INTO workflow_universe_rules (
        workflow_id,
        rule_name,
        rule_description,
        filter_type,
        filter_value
      )
      VALUES (
        v_workflow_id,
        (v_universe_rule->>'rule_name')::TEXT,
        (v_universe_rule->>'rule_description')::TEXT,
        (v_universe_rule->>'filter_type')::TEXT,
        (v_universe_rule->>'filter_value')::TEXT
      );
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

-- Comment on function
COMMENT ON FUNCTION activate_template_version IS 'Activates a specific template version, restoring its stages, checklists, automation rules, and universe rules to the workflow';
