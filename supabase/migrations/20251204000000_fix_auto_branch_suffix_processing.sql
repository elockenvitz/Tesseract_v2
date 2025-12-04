-- Fix auto-create branch function to store processed suffix instead of raw template
-- The branch_suffix should contain the resolved value (e.g., "Dec 2025") not the template (e.g., "{MONTH} {YEAR}")
CREATE OR REPLACE FUNCTION auto_create_workflow_branch()
RETURNS TRIGGER AS $$
DECLARE
  v_workflow_id UUID;
  v_auto_create_rule RECORD;
  v_branch_suffix TEXT;
  v_processed_suffix TEXT;
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

  -- Look for an active auto_create_branch automation rule for this workflow
  SELECT * INTO v_auto_create_rule
  FROM workflow_automation_rules
  WHERE workflow_id = v_workflow_id
    AND action_type = 'auto_create_branch'
    AND is_active = true
  LIMIT 1;

  -- Only proceed if we found an active auto-create rule
  IF v_auto_create_rule.id IS NOT NULL THEN
    v_branch_suffix := v_auto_create_rule.action_value->>'branch_suffix';

    -- Only proceed if we have a branch suffix
    IF v_branch_suffix IS NOT NULL AND v_branch_suffix != '' THEN
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

        -- Process the suffix to resolve dynamic placeholders
        v_processed_suffix := process_dynamic_suffix(v_branch_suffix);

        -- Generate the branch name (this also processes the suffix internally, but we need the processed value separately)
        v_generated_name := generate_unique_workflow_name(
          v_parent_workflow.name,
          v_branch_suffix
        );

        -- Create the new branch with PROCESSED suffix
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
          branched_at
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
          v_processed_suffix,  -- Store the processed suffix, not the raw template
          NOW()
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

        RAISE NOTICE 'Auto-created workflow branch: % (ID: %) with suffix: % via automation rule', v_generated_name, v_new_branch_id, v_processed_suffix;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_create_workflow_branch() IS 'Automatically creates a workflow branch when the first asset is assigned to a workflow with an active auto_create_branch automation rule. Stores processed suffix (resolved placeholders).';
