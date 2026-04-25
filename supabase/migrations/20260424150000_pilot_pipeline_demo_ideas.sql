-- Pilot pipeline demo ideas — seeds 3 additional trade_queue_items
-- across earlier research stages so the kanban has visible flow
-- (not just the AAPL ready_for_decision + MSFT thesis_forming pair
-- that ensure_pilot_scenario_for_user already writes).
--
-- Idempotent via origin_metadata->>'pilot_seed_slug': running the
-- function twice does not create duplicates. Assets missing from
-- the assets table are skipped silently so the function is safe to
-- call from any pilot org regardless of preloaded data.

CREATE OR REPLACE FUNCTION seed_pilot_pipeline_demo_ideas(
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_portfolio_id UUID;
  v_scenario_id UUID;
  v_demo RECORD;
  v_asset_id UUID;
  v_inserted INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;

  SELECT organization_id, portfolio_id, id
    INTO v_org_id, v_portfolio_id, v_scenario_id
  FROM pilot_scenarios
  WHERE user_id = p_user_id
    AND status = 'active'
    AND is_template = FALSE
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_org_id IS NULL THEN RETURN 0; END IF;

  FOR v_demo IN
    SELECT * FROM (VALUES
      (
        'aware_nvda'::TEXT, 'NVDA'::TEXT, 'aware'::trade_stage, 'buy'::trade_action,
        'AI capex risk is becoming more debated after recent multiple expansion.'::TEXT,
        'medium'::TEXT
      ),
      (
        'investigate_amzn'::TEXT, 'AMZN'::TEXT, 'investigate'::trade_stage, 'buy'::trade_action,
        'AWS margin recovery and retail efficiency may be underappreciated.'::TEXT,
        'medium'::TEXT
      ),
      (
        'deep_research_meta'::TEXT, 'META'::TEXT, 'deep_research'::trade_stage, 'buy'::trade_action,
        'Ad load recovery and AI-driven targeting improvement need deeper validation.'::TEXT,
        'high'::TEXT
      )
    ) AS t(slug, symbol, stage, action, rationale, conviction)
  LOOP
    SELECT id INTO v_asset_id
    FROM assets
    WHERE UPPER(symbol) = v_demo.symbol
    LIMIT 1;
    IF v_asset_id IS NULL THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM trade_queue_items
      WHERE created_by = p_user_id
        AND origin_metadata->>'pilot_seed_slug' = v_demo.slug
        AND (origin_metadata->>'pilot_scenario_id')::UUID = v_scenario_id
        AND visibility_tier = 'active'
    ) THEN CONTINUE; END IF;

    INSERT INTO trade_queue_items (
      portfolio_id, asset_id, action, stage, status,
      rationale, thesis_text, conviction, created_by,
      origin_metadata, visibility_tier, origin_type
    ) VALUES (
      v_portfolio_id, v_asset_id, v_demo.action, v_demo.stage,
      'idea'::trade_queue_status,
      v_demo.rationale, v_demo.rationale, v_demo.conviction, p_user_id,
      jsonb_build_object(
        'pilot_scenario_id', v_scenario_id,
        'pilot_seed', TRUE,
        'pilot_seed_slug', v_demo.slug,
        'role', 'demo_idea'
      ),
      'active'::visibility_tier,
      'manual'::origin_type
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION seed_pilot_pipeline_demo_ideas(UUID) TO authenticated;
