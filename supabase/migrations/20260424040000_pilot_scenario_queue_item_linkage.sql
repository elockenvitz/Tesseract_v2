/**
 * Make staged pilot scenarios show up in the pilot user's Trade Lab
 * left panel as a real trade idea, not as a separate banner.
 *
 * A pilot scenario has always had a `trade_queue_item_id` column for
 * this linkage, but the ops panel was inserting scenarios with that
 * column NULL. The "scenario is being prepared" banner was the only
 * surface for a staged idea — which pushed page layout down and didn't
 * live alongside other ideas.
 *
 * These two RPCs let the ops panel (running as a platform admin that is
 * typically NOT a member of the pilot org) atomically:
 *   1. Create a trade_queue_items row in the pilot's portfolio.
 *   2. Insert a pilot_scenarios row linked to it via trade_queue_item_id.
 * And on removal, soft-delete both.
 *
 * SECURITY DEFINER is used so the platform admin can insert into the
 * pilot org's trade_queue_items without being a member of that org.
 * Gate remains is_platform_admin().
 */

-- ─── stage_pilot_scenario ──────────────────────────────────────────────
-- Returns the new pilot_scenarios row (joined with trade_queue_item_id),
-- so the client can seamlessly use it like the prior direct INSERT path.

CREATE OR REPLACE FUNCTION stage_pilot_scenario(
  p_organization_id UUID,
  p_title TEXT,
  p_symbol TEXT DEFAULT NULL,
  p_asset_id UUID DEFAULT NULL,
  p_direction TEXT DEFAULT 'buy',
  p_thesis TEXT DEFAULT NULL,
  p_why_now TEXT DEFAULT NULL,
  p_proposed_action TEXT DEFAULT NULL,
  p_proposed_sizing_input TEXT DEFAULT NULL,
  p_target_weight_pct NUMERIC DEFAULT NULL,
  p_delta_weight_pct NUMERIC DEFAULT NULL,
  p_portfolio_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scenario_id UUID;
  v_queue_item_id UUID;
  v_resolved_asset_id UUID := p_asset_id;
  v_caller_id UUID := auth.uid();
  v_action trade_action;
  v_rationale TEXT;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can stage pilot scenarios';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'Title is required';
  END IF;

  -- Resolve asset_id from symbol if the caller gave only a symbol.
  IF v_resolved_asset_id IS NULL AND p_symbol IS NOT NULL AND btrim(p_symbol) <> '' THEN
    SELECT id INTO v_resolved_asset_id
    FROM assets
    WHERE upper(symbol) = upper(btrim(p_symbol))
    LIMIT 1;
  END IF;

  -- Map the free-form direction string to the trade_action enum.
  -- Fall back to 'buy' for anything unrecognised so we never block staging.
  BEGIN
    v_action := COALESCE(NULLIF(btrim(p_direction), ''), 'buy')::trade_action;
  EXCEPTION WHEN invalid_text_representation THEN
    v_action := 'buy'::trade_action;
  END;

  -- Only create a queue item if we have BOTH the asset and the portfolio.
  -- Without either, the Trade Lab left panel wouldn't be able to filter
  -- to it anyway, so we skip it and leave trade_queue_item_id NULL.
  IF v_resolved_asset_id IS NOT NULL AND p_portfolio_id IS NOT NULL THEN
    v_rationale := COALESCE(p_thesis, '')
      || CASE
           WHEN p_why_now IS NOT NULL AND btrim(p_why_now) <> ''
           THEN E'\n\nWhy now: ' || p_why_now
           ELSE ''
         END;

    INSERT INTO trade_queue_items (
      portfolio_id, asset_id, action, status, stage,
      rationale, thesis_text,
      created_by, origin_type, sharing_visibility,
      proposed_weight
    ) VALUES (
      p_portfolio_id, v_resolved_asset_id, v_action, 'idea', 'ready_for_decision',
      NULLIF(v_rationale, ''), p_thesis,
      v_caller_id, 'manual', 'shared',
      p_target_weight_pct
    )
    RETURNING id INTO v_queue_item_id;
  END IF;

  INSERT INTO pilot_scenarios (
    organization_id, user_id, title, asset_id, symbol, direction,
    thesis, why_now, proposed_action, proposed_sizing_input,
    target_weight_pct, delta_weight_pct, portfolio_id,
    trade_queue_item_id, status, assigned_at, created_by
  ) VALUES (
    p_organization_id,
    p_user_id,
    btrim(p_title),
    v_resolved_asset_id,
    CASE WHEN p_symbol IS NULL THEN NULL ELSE upper(btrim(p_symbol)) END,
    p_direction,
    p_thesis,
    p_why_now,
    p_proposed_action,
    p_proposed_sizing_input,
    p_target_weight_pct,
    p_delta_weight_pct,
    p_portfolio_id,
    v_queue_item_id,
    'active',
    CASE WHEN p_user_id IS NOT NULL THEN now() ELSE NULL END,
    v_caller_id
  )
  RETURNING id INTO v_scenario_id;

  RETURN jsonb_build_object(
    'scenario_id', v_scenario_id,
    'trade_queue_item_id', v_queue_item_id,
    'asset_id', v_resolved_asset_id
  );
END;
$$;

-- ─── delete_pilot_scenario ─────────────────────────────────────────────
-- Removes the pilot_scenarios row and soft-deletes the linked queue item
-- (visibility_tier='trash'). Soft-delete preserves the audit trail if the
-- queue item was already acted on — e.g. someone added it to a simulation.

CREATE OR REPLACE FUNCTION delete_pilot_scenario(p_scenario_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_item_id UUID;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can delete pilot scenarios';
  END IF;

  SELECT trade_queue_item_id INTO v_queue_item_id
  FROM pilot_scenarios WHERE id = p_scenario_id;

  DELETE FROM pilot_scenarios WHERE id = p_scenario_id;

  IF v_queue_item_id IS NOT NULL THEN
    UPDATE trade_queue_items
    SET visibility_tier = 'trash', archived_at = now()
    WHERE id = v_queue_item_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION stage_pilot_scenario TO authenticated;
GRANT EXECUTE ON FUNCTION delete_pilot_scenario TO authenticated;
