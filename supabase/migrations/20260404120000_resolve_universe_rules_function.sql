-- ============================================================================
-- Migration: resolve_universe_rules_function
--
-- SQL function that resolves workflow universe rules into asset IDs and
-- inserts asset_workflow_progress rows. Called by auto_create_workflow_branch
-- trigger for asset-scoped runs, replacing the client-side-only path.
--
-- Supported rule types: coverage/analyst, list, theme, sector, priority, portfolio
-- Combination: OR (union of all rule results)
-- ============================================================================

-- 1. Function to resolve universe rules → asset IDs → progress rows
CREATE OR REPLACE FUNCTION populate_asset_run_from_universe(
  p_branch_id UUID,
  p_template_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_asset_ids UUID[];
  v_all_asset_ids UUID[] := '{}';
  v_rule_values TEXT[];
  v_inserted INTEGER := 0;
BEGIN
  -- Iterate over universe rules for the template
  FOR v_rule IN
    SELECT rule_type, rule_config
    FROM workflow_universe_rules
    WHERE workflow_id = p_template_id
    ORDER BY rule_order
  LOOP
    v_asset_ids := '{}';

    CASE v_rule.rule_type
      -- Coverage/analyst: assets covered by specified analysts
      WHEN 'coverage' THEN
        SELECT ARRAY_AGG(DISTINCT c.asset_id) INTO v_asset_ids
        FROM coverage c
        WHERE c.user_id = ANY(
          SELECT jsonb_array_elements_text(
            COALESCE(v_rule.rule_config->'analyst_user_ids', '[]'::jsonb)
          )::uuid
        )
        AND c.is_active = true;

      -- List: assets in specified lists
      WHEN 'list' THEN
        SELECT ARRAY_AGG(DISTINCT ali.asset_id) INTO v_asset_ids
        FROM asset_list_items ali
        WHERE ali.list_id = ANY(
          SELECT jsonb_array_elements_text(
            COALESCE(v_rule.rule_config->'list_ids', '[]'::jsonb)
          )::uuid
        );

      -- Theme: assets in specified themes
      WHEN 'theme' THEN
        SELECT ARRAY_AGG(DISTINCT ta.asset_id) INTO v_asset_ids
        FROM theme_assets ta
        WHERE ta.theme_id = ANY(
          SELECT jsonb_array_elements_text(
            COALESCE(v_rule.rule_config->'theme_ids', '[]'::jsonb)
          )::uuid
        );

      -- Sector: assets matching specified sectors
      WHEN 'sector' THEN
        SELECT ARRAY_AGG(DISTINCT a.id) INTO v_asset_ids
        FROM assets a
        WHERE a.sector = ANY(
          SELECT jsonb_array_elements_text(
            COALESCE(v_rule.rule_config->'sectors', '[]'::jsonb)
          )
        );

      -- Priority: assets matching specified priority levels
      WHEN 'priority' THEN
        SELECT ARRAY_AGG(DISTINCT a.id) INTO v_asset_ids
        FROM assets a
        WHERE a.priority = ANY(
          SELECT jsonb_array_elements_text(
            COALESCE(v_rule.rule_config->'levels', '[]'::jsonb)
          )
        );

      -- Portfolio: assets held in specified portfolios
      WHEN 'portfolio' THEN
        SELECT ARRAY_AGG(DISTINCT ph.asset_id) INTO v_asset_ids
        FROM portfolio_holdings ph
        WHERE ph.portfolio_id = ANY(
          SELECT jsonb_array_elements_text(
            COALESCE(
              v_rule.rule_config->'portfolio_ids',
              v_rule.rule_config->'values',
              '[]'::jsonb
            )
          )::uuid
        );

      ELSE
        -- Unknown rule type, skip
        NULL;
    END CASE;

    -- Union: merge into all_asset_ids (OR logic)
    IF v_asset_ids IS NOT NULL AND array_length(v_asset_ids, 1) > 0 THEN
      v_all_asset_ids := v_all_asset_ids || v_asset_ids;
    END IF;
  END LOOP;

  -- Deduplicate
  SELECT ARRAY_AGG(DISTINCT uid) INTO v_all_asset_ids
  FROM unnest(v_all_asset_ids) AS uid;

  -- Insert progress rows
  IF v_all_asset_ids IS NOT NULL AND array_length(v_all_asset_ids, 1) > 0 THEN
    INSERT INTO asset_workflow_progress (
      asset_id, workflow_id, is_started, started_at,
      is_completed, created_at, updated_at
    )
    SELECT
      aid, p_branch_id, true, NOW(), false, NOW(), NOW()
    FROM unnest(v_all_asset_ids) AS aid
    ON CONFLICT (asset_id, workflow_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  RAISE LOG 'populate_asset_run_from_universe: added % assets to branch %',
    v_inserted, p_branch_id;

  RETURN v_inserted;
END;
$$;

-- 2. Update auto_create_workflow_branch to call populate for asset scope
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
  v_populated INTEGER;
BEGIN
  SELECT
    COALESCE(parent_workflow_id, id) INTO v_workflow_id
  FROM workflows
  WHERE id = NEW.workflow_id;

  SELECT * INTO v_auto_create_rule
  FROM workflow_automation_rules
  WHERE workflow_id = v_workflow_id
    AND action_type IN ('branch_copy', 'branch_nocopy')
    AND is_active = true
  LIMIT 1;

  IF v_auto_create_rule.id IS NOT NULL THEN
    v_branch_suffix := v_auto_create_rule.action_value->>'branch_suffix';

    IF v_branch_suffix IS NULL OR v_branch_suffix = '' THEN
      v_branch_suffix := '{MONTH} {YEAR}';
    END IF;

    SELECT * INTO v_active_version
    FROM workflow_template_versions
    WHERE workflow_id = v_workflow_id
      AND is_active = true
    LIMIT 1;

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

    IF v_branch_count = 0 THEN
      SELECT * INTO v_parent_workflow
      FROM workflows
      WHERE id = v_workflow_id;

      v_scope_type := COALESCE(v_parent_workflow.scope_type, 'asset');

      v_processed_suffix := process_dynamic_suffix(v_branch_suffix);

      v_generated_name := generate_unique_workflow_name(
        v_parent_workflow.name,
        v_branch_suffix
      );

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

      INSERT INTO workflows (
        name, description, color, is_public, created_by,
        cadence_days, cadence_timeframe, kickoff_cadence, kickoff_custom_date,
        parent_workflow_id, branch_suffix, branched_at,
        template_version_id, template_version_number, source_branch_id,
        scope_type
      ) VALUES (
        v_generated_name, v_parent_workflow.description, v_parent_workflow.color,
        false, v_parent_workflow.created_by,
        v_parent_workflow.cadence_days, v_parent_workflow.cadence_timeframe,
        v_parent_workflow.kickoff_cadence, v_parent_workflow.kickoff_custom_date,
        v_workflow_id, v_processed_suffix, NOW(),
        v_active_version.id, v_active_version.version_number,
        CASE WHEN v_should_copy_progress THEN v_copy_from_branch.id ELSE NULL END,
        v_scope_type
      ) RETURNING id INTO v_new_branch_id;

      -- Copy stages
      IF v_active_version.id IS NOT NULL AND v_active_version.stages IS NOT NULL THEN
        INSERT INTO workflow_stages (
          workflow_id, stage_key, stage_label, stage_description,
          stage_color, stage_order, checklist_template
        )
        SELECT
          v_new_branch_id, stage->>'key', stage->>'name', stage->>'description',
          stage->>'color', (stage->>'order_index')::INTEGER, NULL
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

      -- Copy collaborations
      INSERT INTO workflow_collaborations (workflow_id, user_id, permission_level)
      SELECT v_new_branch_id, user_id, permission_level
      FROM workflow_collaborations
      WHERE workflow_id = v_workflow_id;

      -- Copy stakeholders
      INSERT INTO workflow_stakeholders (workflow_id, user_id)
      SELECT v_new_branch_id, user_id
      FROM workflow_stakeholders
      WHERE workflow_id = v_workflow_id;

      -- === SCOPE-SPECIFIC POPULATION ===

      IF v_scope_type = 'asset' THEN
        -- Copy universe rules to the run
        INSERT INTO workflow_universe_rules (
          workflow_id, rule_type, rule_config, combination_operator, rule_order
        )
        SELECT v_new_branch_id, rule_type, rule_config, combination_operator, rule_order
        FROM workflow_universe_rules
        WHERE workflow_id = v_workflow_id;

        -- If copying from previous branch, copy asset progress
        IF v_should_copy_progress AND v_copy_from_branch.id IS NOT NULL THEN
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
        ELSE
          -- Resolve universe rules → populate assets
          PERFORM populate_asset_run_from_universe(v_new_branch_id, v_workflow_id);
        END IF;

      ELSIF v_scope_type = 'portfolio' THEN
        -- Copy portfolio selections
        INSERT INTO workflow_portfolio_selections (workflow_id, portfolio_id)
        SELECT v_new_branch_id, portfolio_id
        FROM workflow_portfolio_selections
        WHERE workflow_id = v_workflow_id;

        -- Create portfolio progress rows
        INSERT INTO portfolio_workflow_progress (
          portfolio_id, workflow_id, is_started, started_at, is_completed,
          created_at, updated_at
        )
        SELECT
          portfolio_id, v_new_branch_id, true, NOW(), false, NOW(), NOW()
        FROM workflow_portfolio_selections
        WHERE workflow_id = v_workflow_id;

      ELSIF v_scope_type = 'general' THEN
        -- Get first stage key
        SELECT stage_key INTO v_first_stage_key
        FROM workflow_stages
        WHERE workflow_id = v_new_branch_id
        ORDER BY stage_order ASC
        LIMIT 1;

        -- Create single general progress row
        INSERT INTO general_workflow_progress (
          workflow_id, current_stage_key, is_started, started_at,
          is_completed, created_at, updated_at
        ) VALUES (
          v_new_branch_id, v_first_stage_key, true, NOW(),
          false, NOW(), NOW()
        );

        -- Instantiate checklist items from stage templates
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

      -- Update the asset assignment to point to the new branch
      NEW.workflow_id := v_new_branch_id;

      RAISE NOTICE 'Auto-created workflow branch: % (ID: %) scope: % with suffix: %',
        v_generated_name, v_new_branch_id, v_scope_type, v_processed_suffix;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
