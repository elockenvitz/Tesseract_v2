-- Fix auto-create branch function to:
-- 1. Look for branch_copy or branch_nocopy action types (not auto_create_branch)
-- 2. Assign the new branch to the active template version
-- 3. Only copy from previous branch if one exists in the same template version
-- 4. Store processed suffix instead of raw template

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
  v_active_version RECORD;
  v_copy_from_branch RECORD;
  v_should_copy_progress BOOLEAN;
BEGIN
  -- Get the workflow ID (could be direct or from parent if already a branch)
  SELECT
    COALESCE(parent_workflow_id, id) INTO v_workflow_id
  FROM workflows
  WHERE id = NEW.workflow_id;

  -- Look for an active automation rule that creates branches (branch_copy or branch_nocopy)
  SELECT * INTO v_auto_create_rule
  FROM workflow_automation_rules
  WHERE workflow_id = v_workflow_id
    AND action_type IN ('branch_copy', 'branch_nocopy')
    AND is_active = true
  LIMIT 1;

  -- Only proceed if we found an active auto-create rule
  IF v_auto_create_rule.id IS NOT NULL THEN
    v_branch_suffix := v_auto_create_rule.action_value->>'branch_suffix';

    -- If no suffix provided, use current date as default
    IF v_branch_suffix IS NULL OR v_branch_suffix = '' THEN
      v_branch_suffix := '{MONTH} {YEAR}';
    END IF;

    -- Get the active template version for this workflow
    SELECT * INTO v_active_version
    FROM workflow_template_versions
    WHERE workflow_id = v_workflow_id
      AND is_active = true
    LIMIT 1;

    -- Check if any branches exist for this workflow under the ACTIVE template version
    -- (or any branches if no versioning exists yet)
    IF v_active_version.id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_branch_count
      FROM workflows
      WHERE parent_workflow_id = v_workflow_id
        AND template_version_id = v_active_version.id
        AND deleted IS NOT TRUE
        AND archived IS NOT TRUE;
    ELSE
      -- No versioning - check for any branches
      SELECT COUNT(*) INTO v_branch_count
      FROM workflows
      WHERE parent_workflow_id = v_workflow_id
        AND deleted IS NOT TRUE
        AND archived IS NOT TRUE;
    END IF;

    -- Only create if no branches exist yet for this template version
    IF v_branch_count = 0 THEN
      -- Get parent workflow details
      SELECT * INTO v_parent_workflow
      FROM workflows
      WHERE id = v_workflow_id;

      -- Process the suffix to resolve dynamic placeholders
      v_processed_suffix := process_dynamic_suffix(v_branch_suffix);

      -- Generate the branch name
      v_generated_name := generate_unique_workflow_name(
        v_parent_workflow.name,
        v_branch_suffix
      );

      -- Determine if we should copy progress from a previous branch
      -- Only for branch_copy action type AND when there's a previous branch to copy from
      v_should_copy_progress := false;
      IF v_auto_create_rule.action_type = 'branch_copy' THEN
        -- Look for the most recent non-archived branch to copy from
        -- Prefer branches from the previous template version, but accept any
        SELECT * INTO v_copy_from_branch
        FROM workflows
        WHERE parent_workflow_id = v_workflow_id
          AND deleted IS NOT TRUE
          AND archived IS NOT TRUE
          AND id != v_workflow_id
        ORDER BY
          -- Prefer branches from recent template versions
          COALESCE(template_version_number, 0) DESC,
          branched_at DESC NULLS LAST,
          created_at DESC
        LIMIT 1;

        IF v_copy_from_branch.id IS NOT NULL THEN
          v_should_copy_progress := true;
        END IF;
      END IF;

      -- Create the new branch with active template version
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
        template_version_id,
        template_version_number,
        source_branch_id
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
        NOW(),
        v_active_version.id,  -- Link to active template version
        v_active_version.version_number,  -- Store version number
        CASE WHEN v_should_copy_progress THEN v_copy_from_branch.id ELSE NULL END
      ) RETURNING id INTO v_new_branch_id;

      -- Copy workflow stages from the template version snapshot if available,
      -- otherwise from the parent workflow
      IF v_active_version.id IS NOT NULL AND v_active_version.stages IS NOT NULL THEN
        -- Copy from template version snapshot
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
          stage->>'key',
          stage->>'name',
          stage->>'description',
          stage->>'color',
          (stage->>'order_index')::INTEGER,
          NULL  -- Checklist templates from snapshot don't include this
        FROM jsonb_array_elements(v_active_version.stages) AS stage
        ORDER BY (stage->>'order_index')::INTEGER;
      ELSE
        -- Copy from parent workflow directly
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
      END IF;

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

      -- If copying progress from a previous branch, copy asset progress
      IF v_should_copy_progress AND v_copy_from_branch.id IS NOT NULL THEN
        INSERT INTO asset_workflow_progress (
          asset_id,
          workflow_id,
          current_stage,
          checklist_progress,
          assigned_at,
          started_at
        )
        SELECT
          asset_id,
          v_new_branch_id,
          current_stage,
          checklist_progress,
          NOW(),
          started_at
        FROM asset_workflow_progress
        WHERE workflow_id = v_copy_from_branch.id
          AND asset_id != NEW.asset_id;  -- Don't copy the triggering asset
      END IF;

      -- Update the asset assignment to point to the new branch instead
      NEW.workflow_id := v_new_branch_id;

      RAISE NOTICE 'Auto-created workflow branch: % (ID: %) with suffix: % under template version % via automation rule (copy_progress: %)',
        v_generated_name, v_new_branch_id, v_processed_suffix, COALESCE(v_active_version.version_number::TEXT, 'none'), v_should_copy_progress;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_create_workflow_branch() IS 'Automatically creates a workflow branch when the first asset is assigned to a workflow with an active branch_copy/branch_nocopy automation rule. Creates branch under active template version and handles copy-from-previous logic.';
