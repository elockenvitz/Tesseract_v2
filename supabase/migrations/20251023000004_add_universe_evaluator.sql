/*
  # Add universe evaluation function

  1. Functions
    - evaluate_workflow_universe: Evaluates universe rules and returns matching asset IDs
    - apply_workflow_to_universe: Applies a workflow to all assets in its universe

  This enables automatic workflow assignment based on universe configuration.
*/

-- Function to evaluate workflow universe rules and return matching asset IDs
CREATE OR REPLACE FUNCTION evaluate_workflow_universe(
  p_workflow_id uuid,
  p_user_id uuid
)
RETURNS TABLE(asset_id uuid) AS $$
DECLARE
  v_rule record;
  v_asset_ids uuid[];
  v_combined_asset_ids uuid[];
  v_list_ids uuid[];
  v_theme_ids uuid[];
  v_sectors text[];
  v_priorities text[];
  v_analyst_user_ids uuid[];
BEGIN
  -- Initialize combined results
  v_combined_asset_ids := ARRAY[]::uuid[];

  -- Loop through all active universe rules for this workflow
  FOR v_rule IN
    SELECT *
    FROM workflow_universe_rules
    WHERE workflow_id = p_workflow_id
      AND is_active = true
    ORDER BY sort_order
  LOOP
    -- Initialize asset_ids for this rule
    v_asset_ids := ARRAY[]::uuid[];

    -- Evaluate based on rule type
    CASE v_rule.rule_type
      WHEN 'list' THEN
        -- Get assets from specified lists
        v_list_ids := ARRAY(SELECT jsonb_array_elements_text(v_rule.rule_config->'list_ids')::uuid);

        SELECT ARRAY_AGG(DISTINCT ala.asset_id)
        INTO v_asset_ids
        FROM asset_lists_assets ala
        WHERE ala.list_id = ANY(v_list_ids);

      WHEN 'theme' THEN
        -- Get assets from specified themes
        v_theme_ids := ARRAY(SELECT jsonb_array_elements_text(v_rule.rule_config->'theme_ids')::uuid);

        SELECT ARRAY_AGG(DISTINCT ta.asset_id)
        INTO v_asset_ids
        FROM theme_assets ta
        WHERE ta.theme_id = ANY(v_theme_ids);

      WHEN 'sector' THEN
        -- Get assets from specified sectors
        v_sectors := ARRAY(SELECT jsonb_array_elements_text(v_rule.rule_config->'sectors'));

        SELECT ARRAY_AGG(DISTINCT a.id)
        INTO v_asset_ids
        FROM assets a
        WHERE a.sector = ANY(v_sectors)
          AND (a.created_by = p_user_id OR a.is_public = true);

      WHEN 'priority' THEN
        -- Get assets with specified priority levels
        v_priorities := ARRAY(SELECT jsonb_array_elements_text(v_rule.rule_config->'levels'));

        SELECT ARRAY_AGG(DISTINCT a.id)
        INTO v_asset_ids
        FROM assets a
        WHERE a.priority = ANY(v_priorities)
          AND (a.created_by = p_user_id OR a.is_public = true);

      WHEN 'coverage' THEN
        -- Get assets covered by specified analysts
        v_analyst_user_ids := ARRAY(SELECT jsonb_array_elements_text(v_rule.rule_config->'analyst_user_ids')::uuid);

        SELECT ARRAY_AGG(DISTINCT c.asset_id)
        INTO v_asset_ids
        FROM coverage c
        WHERE c.user_id = ANY(v_analyst_user_ids);

      WHEN 'index' THEN
        -- Get assets by index membership
        -- TODO: Implement when index membership table exists
        RAISE NOTICE 'Index rule type not yet implemented';

      WHEN 'portfolio' THEN
        -- Get assets from specified portfolios
        -- TODO: Implement when portfolio assets table exists
        RAISE NOTICE 'Portfolio rule type not yet implemented';

      WHEN 'market_cap' THEN
        -- Get assets within market cap range
        -- TODO: Implement when market cap data is available
        RAISE NOTICE 'Market cap rule type not yet implemented';

      WHEN 'stage' THEN
        -- Get assets in specific workflow stages
        -- TODO: Implement stage-based filtering
        RAISE NOTICE 'Stage rule type not yet implemented';

      WHEN 'custom_filter' THEN
        -- Custom filter logic
        -- TODO: Implement custom filter evaluation
        RAISE NOTICE 'Custom filter rule type not yet implemented';

      ELSE
        RAISE NOTICE 'Unknown rule type: %', v_rule.rule_type;
    END CASE;

    -- Combine results based on combination operator
    -- For now, we use 'or' (union) logic by default
    IF v_asset_ids IS NOT NULL THEN
      v_combined_asset_ids := v_combined_asset_ids || v_asset_ids;
    END IF;
  END LOOP;

  -- Remove duplicates and return
  RETURN QUERY
  SELECT DISTINCT unnest(v_combined_asset_ids) AS asset_id
  WHERE unnest(v_combined_asset_ids) IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to apply a workflow to all assets in its universe
CREATE OR REPLACE FUNCTION apply_workflow_to_universe(
  p_workflow_id uuid,
  p_user_id uuid,
  p_start_workflow boolean DEFAULT true
)
RETURNS integer AS $$
DECLARE
  v_asset_id uuid;
  v_first_stage text;
  v_count integer := 0;
BEGIN
  -- Get first stage of workflow
  SELECT stage_key INTO v_first_stage
  FROM workflow_stages
  WHERE workflow_id = p_workflow_id
  ORDER BY sort_order
  LIMIT 1;

  -- Loop through all assets in the universe
  FOR v_asset_id IN
    SELECT asset_id FROM evaluate_workflow_universe(p_workflow_id, p_user_id)
  LOOP
    -- Insert workflow progress for each asset
    INSERT INTO asset_workflow_progress (
      id,
      asset_id,
      workflow_id,
      current_stage,
      is_started,
      is_completed,
      started_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_asset_id,
      p_workflow_id,
      v_first_stage,
      p_start_workflow,
      false,
      CASE WHEN p_start_workflow THEN NOW() ELSE NULL END,
      NOW(),
      NOW()
    ) ON CONFLICT (asset_id, workflow_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION evaluate_workflow_universe(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_workflow_to_universe(uuid, uuid, boolean) TO authenticated;

-- Comment the functions
COMMENT ON FUNCTION evaluate_workflow_universe IS 'Evaluates workflow universe rules and returns matching asset IDs';
COMMENT ON FUNCTION apply_workflow_to_universe IS 'Applies a workflow to all assets in its configured universe';
