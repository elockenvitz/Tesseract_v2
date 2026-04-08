-- ============================================================================
-- Migration: auto_branch_scope_support
--
-- Fix auto_create_workflow_branch trigger to support portfolio and general
-- scoped processes:
--   1. Inherit scope_type from parent workflow
--   2. Copy workflow_portfolio_selections for portfolio scope
--   3. Create portfolio_workflow_progress rows for portfolio scope
--   4. Create general_workflow_progress row for general scope
-- ============================================================================

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
  v_scope_type TEXT;
  v_first_stage_key TEXT;
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
    IF v_active_version.id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_branch_count
      FROM workflows
      WHERE parent_workflow_id = v_workflow_id
        AND template_version_id = v_active_version.id
        AND deleted IS NOT TRUE
        AND archived IS NOT TRUE;
    ELSE
      SELECT COUNT(*) INTO v_branch_count
      FROM workflows
      WHERE parent_workflow_id = v_workflow_id
        AND deleted IS NOT TRUE
        AND archived IS NOT TRUE;
    END IF;

    -- Only create if no branches exist yet for this template version
    IF v_branch_count = 0 THEN
      -- Get parent workflow details (including scope_type)
      SELECT * INTO v_parent_workflow
      FROM workflows
      WHERE id = v_workflow_id;

      -- Inherit scope_type from parent
      v_scope_type := COALESCE(v_parent_workflow.scope_type, 'asset');

      -- Process the suffix to resolve dynamic placeholders
      v_processed_suffix := process_dynamic_suffix(v_branch_suffix);

      -- Generate the branch name
      v_generated_name := generate_unique_workflow_name(
        v_parent_workflow.name,
        v_branch_suffix
      );

      -- Determine if we should copy progress from a previous branch
      v_should_copy_progress := false;
      IF v_auto_create_rule.action_type = 'branch_copy' THEN
        SELECT * INTO v_copy_from_branch
        FROM workflows
        WHERE parent_workflow_id = v_workflow_id
          AND deleted IS NOT TRUE
          AND archived IS NOT TRUE
          AND id != v_workflow_id
        ORDER BY
          COALESCE(template_version_number, 0) DESC,
          branched_at DESC NULLS LAST,
          created_at DESC
        LIMIT 1;

        IF v_copy_from_branch.id IS NOT NULL THEN
          v_should_copy_progress := true;
        END IF;
      END IF;

      -- Create the new branch with scope_type inherited from parent
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
        source_branch_id,
        scope_type
      ) VALUES (
        v_generated_name,
        v_parent_workflow.description,
        v_parent_workflow.color,
        false,
        v_parent_workflow.created_by,
        v_parent_workflow.cadence_days,
        v_parent_workflow.cadence_timeframe,
        v_parent_workflow.kickoff_cadence,
        v_parent_workflow.kickoff_custom_date,
        v_workflow_id,
        v_processed_suffix,
        NOW(),
        v_active_version.id,
        v_active_version.version_number,
        CASE WHEN v_should_copy_progress THEN v_copy_from_branch.id ELSE NULL END,
        v_scope_type
      ) RETURNING id INTO v_new_branch_id;

      -- Copy workflow stages from the template version snapshot if available
      IF v_active_version.id IS NOT NULL AND v_active_version.stages IS NOT NULL THEN
        INSERT INTO workflow_stages (
          workflow_id, stage_key, stage_label, stage_description,
          stage_color, stage_order, checklist_template
        )
        SELECT
          v_new_branch_id,
          stage->>'key',
          stage->>'name',
          stage->>'description',
          stage->>'color',
          (stage->>'order_index')::INTEGER,
          NULL
        FROM jsonb_array_elements(v_active_version.stages) AS stage
        ORDER BY (stage->>'order_index')::INTEGER;
      ELSE
        INSERT INTO workflow_stages (
          workflow_id, stage_key, stage_label, stage_description,
          stage_color, stage_order, checklist_template
        )
        SELECT
          v_new_branch_id, stage_key, stage_label, stage_description,
          stage_color, stage_order, checklist_template
        FROM workflow_stages
        WHERE workflow_id = v_workflow_id
        ORDER BY stage_order;
      END IF;

      -- Copy workflow collaborations
      INSERT INTO workflow_collaborations (workflow_id, user_id, permission_level)
      SELECT v_new_branch_id, user_id, permission_level
      FROM workflow_collaborations
      WHERE workflow_id = v_workflow_id;

      -- Copy workflow stakeholders
      INSERT INTO workflow_stakeholders (workflow_id, user_id)
      SELECT v_new_branch_id, user_id
      FROM workflow_stakeholders
      WHERE workflow_id = v_workflow_id;

      -- Copy universe rules (asset scope only)
      IF v_scope_type = 'asset' THEN
        INSERT INTO workflow_universe_rules (
          workflow_id, rule_type, rule_config, combination_operator, rule_order
        )
        SELECT v_new_branch_id, rule_type, rule_config, combination_operator, rule_order
        FROM workflow_universe_rules
        WHERE workflow_id = v_workflow_id;
      END IF;

      -- === SCOPE-SPECIFIC POPULATION ===

      IF v_scope_type = 'portfolio' THEN
        -- Copy portfolio selections from template
        INSERT INTO workflow_portfolio_selections (workflow_id, portfolio_id)
        SELECT v_new_branch_id, portfolio_id
        FROM workflow_portfolio_selections
        WHERE workflow_id = v_workflow_id;

        -- Create portfolio_workflow_progress rows
        INSERT INTO portfolio_workflow_progress (
          portfolio_id, workflow_id, is_started, started_at, is_completed,
          created_at, updated_at
        )
        SELECT
          portfolio_id, v_new_branch_id, true, NOW(), false, NOW(), NOW()
        FROM workflow_portfolio_selections
        WHERE workflow_id = v_workflow_id;

      ELSIF v_scope_type = 'general' THEN
        -- Get first stage key for initial progress
        SELECT stage_key INTO v_first_stage_key
        FROM workflow_stages
        WHERE workflow_id = v_new_branch_id
        ORDER BY stage_order ASC
        LIMIT 1;

        -- Create single general_workflow_progress row
        INSERT INTO general_workflow_progress (
          workflow_id, current_stage_key, is_started, started_at,
          is_completed, created_at, updated_at
        ) VALUES (
          v_new_branch_id, v_first_stage_key, true, NOW(),
          false, NOW(), NOW()
        );

        -- Instantiate general_checklist_items from stage templates
        INSERT INTO general_checklist_items (
          workflow_id, stage_id, item_id, item_text, sort_order,
          completed, status
        )
        SELECT
          v_new_branch_id,
          ws.stage_key,
          'item_' || (row_number() OVER (PARTITION BY ws.stage_key ORDER BY idx) - 1),
          item_elem->>'text',
          (row_number() OVER (PARTITION BY ws.stage_key ORDER BY idx) - 1)::INTEGER,
          false,
          'unchecked'
        FROM workflow_stages ws,
          LATERAL jsonb_array_elements(COALESCE(ws.checklist_items, '[]'::jsonb)) WITH ORDINALITY AS t(item_elem, idx)
        WHERE ws.workflow_id = v_workflow_id
          AND jsonb_typeof(ws.checklist_items) = 'array'
          AND jsonb_array_length(ws.checklist_items) > 0
          AND item_elem->>'text' IS NOT NULL
          AND item_elem->>'text' != '';
      END IF;

      -- If copying progress from a previous branch (asset scope only)
      IF v_should_copy_progress AND v_copy_from_branch.id IS NOT NULL AND v_scope_type = 'asset' THEN
        INSERT INTO asset_workflow_progress (
          asset_id, workflow_id, current_stage, checklist_progress,
          assigned_at, started_at
        )
        SELECT
          asset_id, v_new_branch_id, current_stage, checklist_progress,
          NOW(), started_at
        FROM asset_workflow_progress
        WHERE workflow_id = v_copy_from_branch.id
          AND asset_id != NEW.asset_id;
      END IF;

      -- Update the asset assignment to point to the new branch
      NEW.workflow_id := v_new_branch_id;

      RAISE NOTICE 'Auto-created workflow branch: % (ID: %) scope: % with suffix: % under template version %',
        v_generated_name, v_new_branch_id, v_scope_type, v_processed_suffix, COALESCE(v_active_version.version_number::TEXT, 'none');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix the existing Attribution Review run: populate its portfolio progress
INSERT INTO portfolio_workflow_progress (portfolio_id, workflow_id, is_started, started_at, is_completed, created_at, updated_at)
SELECT ps.portfolio_id, 'b9b2249c-2696-4b3c-a4da-4955361122ff', true, NOW(), false, NOW(), NOW()
FROM workflow_portfolio_selections ps
WHERE ps.workflow_id = '4e034e2e-0831-49eb-8bdc-5efd237d6c2e'
ON CONFLICT (portfolio_id, workflow_id) DO NOTHING;

-- Also copy portfolio selections to the run
INSERT INTO workflow_portfolio_selections (workflow_id, portfolio_id)
SELECT 'b9b2249c-2696-4b3c-a4da-4955361122ff', ps.portfolio_id
FROM workflow_portfolio_selections ps
WHERE ps.workflow_id = '4e034e2e-0831-49eb-8bdc-5efd237d6c2e'
ON CONFLICT (workflow_id, portfolio_id) DO NOTHING;
