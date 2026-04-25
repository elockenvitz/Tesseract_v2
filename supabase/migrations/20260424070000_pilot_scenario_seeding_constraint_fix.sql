/**
 * Fix two check-constraint violations that surfaced on first pilot seed:
 *
 *   (a) trade_queue_items.sharing_visibility accepts only
 *       'private' | 'team' | 'public'. The RPCs used 'shared', which
 *       never would have passed the check. Switched to 'public' so the
 *       staged idea is visible to any org member on the pilot's team.
 *
 *   (b) trade_queue_items.visibility_tier='trash' is only valid when
 *       deleted_at IS NOT NULL AND archived_at IS NULL. The soft-delete
 *       paths were setting 'trash' together with archived_at — a mix
 *       the CHECK doesn't accept. Use deleted_at and clear archived_at.
 *
 * No behaviour change for the happy path beyond unblocking the constraint.
 * The RPC bodies are otherwise identical to 20260424060000.
 */

CREATE OR REPLACE FUNCTION public.stage_pilot_scenario(
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
  p_user_id UUID DEFAULT NULL,
  p_is_template BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scenario_id UUID;
  v_queue_item_id UUID;
  v_proposal_id UUID;
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

  IF v_resolved_asset_id IS NULL AND p_symbol IS NOT NULL AND btrim(p_symbol) <> '' THEN
    SELECT id INTO v_resolved_asset_id
    FROM assets WHERE upper(symbol) = upper(btrim(p_symbol)) LIMIT 1;
  END IF;

  BEGIN
    v_action := COALESCE(NULLIF(btrim(p_direction), ''), 'buy')::trade_action;
  EXCEPTION WHEN invalid_text_representation THEN
    v_action := 'buy'::trade_action;
  END;

  IF NOT p_is_template AND v_resolved_asset_id IS NOT NULL AND p_portfolio_id IS NOT NULL THEN
    v_rationale := COALESCE(p_thesis, '')
      || CASE WHEN p_why_now IS NOT NULL AND btrim(p_why_now) <> ''
              THEN E'\n\nWhy now: ' || p_why_now ELSE '' END;

    INSERT INTO trade_queue_items (
      portfolio_id, asset_id, action, status, stage,
      rationale, thesis_text,
      created_by, origin_type, sharing_visibility,
      proposed_weight
    ) VALUES (
      p_portfolio_id, v_resolved_asset_id, v_action, 'idea', 'ready_for_decision',
      NULLIF(v_rationale, ''), p_thesis,
      COALESCE(p_user_id, v_caller_id), 'manual', 'public',
      p_target_weight_pct
    )
    RETURNING id INTO v_queue_item_id;

    INSERT INTO trade_proposals (
      trade_queue_item_id, user_id, portfolio_id,
      weight, notes, is_active, proposal_type, sizing_context
    ) VALUES (
      v_queue_item_id, COALESCE(p_user_id, v_caller_id), p_portfolio_id,
      p_target_weight_pct,
      COALESCE(p_proposed_action, 'Review the proposed sizing and commit when ready.'),
      TRUE, 'pm_initiated',
      jsonb_build_object(
        'sizing_input', p_proposed_sizing_input,
        'target_weight_pct', p_target_weight_pct,
        'delta_weight_pct', p_delta_weight_pct,
        'why_now', p_why_now,
        'source', 'pilot_scenario'
      )
    )
    ON CONFLICT (trade_queue_item_id, user_id, portfolio_id) WHERE is_active = TRUE
      DO NOTHING
    RETURNING id INTO v_proposal_id;
  END IF;

  INSERT INTO pilot_scenarios (
    organization_id, user_id, title, asset_id, symbol, direction,
    thesis, why_now, proposed_action, proposed_sizing_input,
    target_weight_pct, delta_weight_pct, portfolio_id,
    trade_queue_item_id, status, assigned_at, created_by, is_template
  ) VALUES (
    p_organization_id, p_user_id, btrim(p_title), v_resolved_asset_id,
    CASE WHEN p_symbol IS NULL THEN NULL ELSE upper(btrim(p_symbol)) END,
    p_direction, p_thesis, p_why_now, p_proposed_action, p_proposed_sizing_input,
    p_target_weight_pct, p_delta_weight_pct, p_portfolio_id, v_queue_item_id,
    'active',
    CASE WHEN p_user_id IS NOT NULL THEN now() ELSE NULL END,
    v_caller_id, p_is_template
  )
  RETURNING id INTO v_scenario_id;

  RETURN jsonb_build_object(
    'scenario_id', v_scenario_id,
    'trade_queue_item_id', v_queue_item_id,
    'trade_proposal_id', v_proposal_id,
    'asset_id', v_resolved_asset_id
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.delete_pilot_scenario(p_scenario_id UUID)
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

  SELECT trade_queue_item_id INTO v_queue_item_id FROM pilot_scenarios WHERE id = p_scenario_id;
  DELETE FROM pilot_scenarios WHERE id = p_scenario_id;

  IF v_queue_item_id IS NOT NULL THEN
    UPDATE trade_proposals SET is_active = FALSE, updated_at = now()
      WHERE trade_queue_item_id = v_queue_item_id AND is_active = TRUE;
    UPDATE trade_queue_items
      SET visibility_tier = 'trash', deleted_at = now(), archived_at = NULL
      WHERE id = v_queue_item_id;
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.ensure_pilot_scenario_for_user(
  p_user_id UUID DEFAULT NULL,
  p_force_reset BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_target_user UUID := COALESCE(p_user_id, v_caller_id);
  v_is_admin BOOLEAN := is_platform_admin();
  v_is_pilot BOOLEAN := FALSE;
  v_org_id UUID;
  v_org_pilot BOOLEAN := FALSE;
  v_existing pilot_scenarios;
  v_template pilot_scenarios;
  v_portfolio_id UUID;
  v_asset_id UUID;
  v_queue_item_id UUID;
  v_proposal_id UUID;
  v_scenario_id UUID;
  v_title TEXT;
  v_symbol TEXT;
  v_direction TEXT;
  v_thesis TEXT;
  v_why_now TEXT;
  v_proposed_action TEXT;
  v_proposed_sizing TEXT;
  v_target_weight NUMERIC;
  v_delta_weight NUMERIC;
  v_action trade_action;
  v_rationale TEXT;
  v_proposal_notes TEXT;
BEGIN
  IF v_target_user IS NULL THEN
    RAISE EXCEPTION 'Missing user';
  END IF;
  IF v_target_user <> v_caller_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: cannot seed a scenario for another user';
  END IF;
  IF p_force_reset AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: only platform admins can reset pilot scenarios';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pilot_seed:' || v_target_user::text, 0));

  SELECT u.is_pilot_user, u.current_organization_id INTO v_is_pilot, v_org_id
  FROM users u WHERE u.id = v_target_user;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('seeded', FALSE, 'reason', 'no_organization');
  END IF;

  IF NOT v_is_pilot THEN
    SELECT COALESCE((settings->>'pilot_mode')::BOOLEAN, FALSE) INTO v_org_pilot
    FROM organizations WHERE id = v_org_id;
    v_is_pilot := COALESCE(v_org_pilot, FALSE);
  END IF;

  IF NOT v_is_pilot THEN
    RETURN jsonb_build_object('seeded', FALSE, 'reason', 'not_pilot');
  END IF;

  IF p_force_reset THEN
    FOR v_existing IN
      SELECT * FROM pilot_scenarios
      WHERE user_id = v_target_user AND status = 'active' AND is_template = FALSE
    LOOP
      IF v_existing.trade_queue_item_id IS NOT NULL THEN
        UPDATE trade_proposals SET is_active = FALSE, updated_at = now()
          WHERE trade_queue_item_id = v_existing.trade_queue_item_id AND is_active = TRUE;
        UPDATE trade_queue_items
          SET visibility_tier = 'trash', deleted_at = now(), archived_at = NULL
          WHERE id = v_existing.trade_queue_item_id;
      END IF;
      UPDATE pilot_scenarios SET status = 'archived', updated_at = now()
        WHERE id = v_existing.id;
    END LOOP;
  END IF;

  SELECT * INTO v_existing FROM pilot_scenarios
  WHERE user_id = v_target_user AND status = 'active' AND is_template = FALSE
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'seeded', FALSE, 'reason', 'already_exists',
      'scenario_id', v_existing.id,
      'trade_queue_item_id', v_existing.trade_queue_item_id
    );
  END IF;

  SELECT * INTO v_template FROM pilot_scenarios
  WHERE organization_id = v_org_id AND is_template = TRUE AND status = 'active'
  ORDER BY created_at DESC LIMIT 1;

  v_title           := COALESCE(v_template.title,                  'AAPL - starter position');
  v_symbol          := COALESCE(v_template.symbol,                 'AAPL');
  v_direction       := COALESCE(v_template.direction,              'buy');
  v_thesis          := COALESCE(v_template.thesis,                 'Services growth and margin durability remain underappreciated relative to hardware slowdown concerns.');
  v_why_now         := COALESCE(v_template.why_now,                'Recent multiple compression creates a more attractive entry point versus long-term earnings durability.');
  v_proposed_action := COALESCE(v_template.proposed_action,        'Increase position');
  v_proposed_sizing := COALESCE(v_template.proposed_sizing_input,  '+2.0');
  v_target_weight   := COALESCE(v_template.target_weight_pct,       2);
  v_delta_weight    := COALESCE(v_template.delta_weight_pct,        2);
  v_asset_id        := COALESCE(v_template.asset_id, (SELECT id FROM assets WHERE upper(symbol) = upper(v_symbol) LIMIT 1));

  v_portfolio_id := v_template.portfolio_id;
  IF v_portfolio_id IS NULL THEN
    SELECT id INTO v_portfolio_id FROM portfolios
    WHERE organization_id = v_org_id AND is_active = TRUE AND archived_at IS NULL
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  BEGIN
    v_action := COALESCE(NULLIF(btrim(v_direction), ''), 'buy')::trade_action;
  EXCEPTION WHEN invalid_text_representation THEN
    v_action := 'buy'::trade_action;
  END;

  IF v_portfolio_id IS NOT NULL AND v_asset_id IS NOT NULL THEN
    v_rationale := v_thesis
      || CASE WHEN v_why_now IS NOT NULL AND btrim(v_why_now) <> ''
              THEN E'\n\nWhy now: ' || v_why_now ELSE '' END;

    v_proposal_notes := v_proposed_action
      || ' — target ' || v_target_weight::text || '% of portfolio.'
      || E'\n\n'
      || 'Starter-sized position intended to test the thesis while limiting concentration risk.';

    INSERT INTO trade_queue_items (
      portfolio_id, asset_id, action, status, stage,
      rationale, thesis_text,
      created_by, assigned_to, origin_type, sharing_visibility,
      proposed_weight
    ) VALUES (
      v_portfolio_id, v_asset_id, v_action, 'idea', 'ready_for_decision',
      v_rationale, v_thesis,
      v_target_user, v_target_user, 'manual', 'public',
      v_target_weight
    )
    RETURNING id INTO v_queue_item_id;

    INSERT INTO trade_proposals (
      trade_queue_item_id, user_id, portfolio_id,
      weight, notes, is_active, proposal_type, sizing_context
    ) VALUES (
      v_queue_item_id, v_target_user, v_portfolio_id,
      v_target_weight, v_proposal_notes,
      TRUE, 'pm_initiated',
      jsonb_build_object(
        'sizing_input', v_proposed_sizing,
        'target_weight_pct', v_target_weight,
        'delta_weight_pct', v_delta_weight,
        'why_now', v_why_now,
        'sizing_logic', 'Starter-sized position intended to test the thesis while limiting concentration risk.',
        'source', 'pilot_scenario'
      )
    )
    ON CONFLICT (trade_queue_item_id, user_id, portfolio_id) WHERE is_active = TRUE
      DO NOTHING
    RETURNING id INTO v_proposal_id;
  END IF;

  INSERT INTO pilot_scenarios (
    organization_id, user_id, title, asset_id, symbol, direction,
    thesis, why_now, proposed_action, proposed_sizing_input,
    target_weight_pct, delta_weight_pct, portfolio_id,
    trade_queue_item_id, status, assigned_at, created_by, is_template
  ) VALUES (
    v_org_id, v_target_user, v_title, v_asset_id, upper(v_symbol), v_direction,
    v_thesis, v_why_now, v_proposed_action, v_proposed_sizing,
    v_target_weight, v_delta_weight, v_portfolio_id,
    v_queue_item_id, 'active', now(),
    COALESCE(v_template.created_by, v_caller_id), FALSE
  )
  RETURNING id INTO v_scenario_id;

  RETURN jsonb_build_object(
    'seeded', TRUE,
    'scenario_id', v_scenario_id,
    'trade_queue_item_id', v_queue_item_id,
    'trade_proposal_id', v_proposal_id,
    'portfolio_id', v_portfolio_id,
    'asset_id', v_asset_id,
    'used_template', v_template.id IS NOT NULL
  );
END;
$$;
