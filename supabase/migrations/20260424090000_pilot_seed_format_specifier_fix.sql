/**
 * Fix silent failure of ensure_pilot_scenario_for_user.
 *
 * The realism pass used C-style format specifiers — e.g. format('%.1f%%',
 * n) — but Postgres' format() only supports %s, %I, %L, and %%. Any call
 * hitting the "add to existing position" branch raised
 *   unrecognized format() type specifier "."
 * which bubbled up as a 400 to the client. The client logs it in DEV and
 * falls through to the empty state, so the failure wasn't obvious — the
 * pilot user kept seeing whatever stale data was already in the DB.
 *
 * This migration replaces the format() calls with round(n, 1)::text and
 * plain string concatenation. No behaviour change beyond unblocking the
 * RPC on the "already-held" code path.
 */

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
  v_idea_item_id UUID;
  v_author_id UUID;
  v_current_weight NUMERIC;
  v_current_txt TEXT;
  v_target_txt TEXT;
  v_delta_txt TEXT;
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
  v_idea_asset_id UUID;
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
      UPDATE trade_proposals SET is_active = FALSE, updated_at = now()
        WHERE trade_queue_item_id IN (
          SELECT id FROM trade_queue_items
          WHERE origin_metadata->>'pilot_scenario_id' = v_existing.id::text
        ) AND is_active = TRUE;

      UPDATE trade_queue_items
        SET visibility_tier = 'trash', deleted_at = now(), archived_at = NULL
        WHERE origin_metadata->>'pilot_scenario_id' = v_existing.id::text;

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

  SELECT om.user_id INTO v_author_id
  FROM organization_memberships om
  WHERE om.organization_id = v_org_id AND om.status = 'active'
    AND om.user_id <> v_target_user AND om.is_org_admin = TRUE
  ORDER BY om.created_at ASC LIMIT 1;

  IF v_author_id IS NULL THEN
    SELECT pa.user_id INTO v_author_id
    FROM platform_admins pa WHERE pa.user_id <> v_target_user
    ORDER BY pa.user_id LIMIT 1;
  END IF;
  v_author_id := COALESCE(v_author_id, v_caller_id, v_target_user);

  IF v_portfolio_id IS NOT NULL AND v_asset_id IS NOT NULL THEN
    SELECT p.weight_pct INTO v_current_weight
    FROM portfolio_holdings_positions p
    WHERE p.snapshot_id = (
      SELECT id FROM portfolio_holdings_snapshots
      WHERE portfolio_id = v_portfolio_id
      ORDER BY snapshot_date DESC NULLS LAST, created_at DESC LIMIT 1
    ) AND p.asset_id = v_asset_id
    LIMIT 1;
  END IF;
  v_current_weight := COALESCE(v_current_weight, 0);

  IF v_template.target_weight_pct IS NULL THEN
    IF v_current_weight <= 0 THEN
      v_direction := 'buy';
      v_target_weight := 2;
      v_delta_weight := 2;
      v_proposed_action := 'Open new starter position';
      v_proposed_sizing := '+2.0';
    ELSIF v_current_weight < 2 THEN
      v_direction := 'add';
      v_target_weight := 2;
      v_delta_weight := 2 - v_current_weight;
      v_proposed_action := 'Add to existing position ('
        || round(v_current_weight, 1)::text || '% -> 2.0%)';
      v_proposed_sizing := '+' || round(v_delta_weight, 1)::text;
    ELSE
      v_direction := 'add';
      v_target_weight := v_current_weight + 0.5;
      v_delta_weight := 0.5;
      v_proposed_action := 'Add to existing position ('
        || round(v_current_weight, 1)::text || '% -> '
        || round(v_current_weight + 0.5, 1)::text || '%)';
      v_proposed_sizing := '+0.5';
    END IF;
  END IF;

  BEGIN
    v_action := COALESCE(NULLIF(btrim(v_direction), ''), 'buy')::trade_action;
  EXCEPTION WHEN invalid_text_representation THEN
    v_action := 'buy'::trade_action;
  END;

  v_current_txt := round(v_current_weight, 1)::text;
  v_target_txt  := round(v_target_weight,  1)::text;
  v_delta_txt   := CASE WHEN v_delta_weight >= 0 THEN '+' ELSE '' END || round(v_delta_weight, 1)::text;

  INSERT INTO pilot_scenarios (
    organization_id, user_id, title, asset_id, symbol, direction,
    thesis, why_now, proposed_action, proposed_sizing_input,
    target_weight_pct, delta_weight_pct, portfolio_id,
    trade_queue_item_id, status, assigned_at, created_by, is_template
  ) VALUES (
    v_org_id, v_target_user, v_title, v_asset_id, upper(v_symbol), v_direction,
    v_thesis, v_why_now, v_proposed_action, v_proposed_sizing,
    v_target_weight, v_delta_weight, v_portfolio_id,
    NULL, 'active', now(), v_author_id, FALSE
  )
  RETURNING id INTO v_scenario_id;

  IF v_portfolio_id IS NOT NULL AND v_asset_id IS NOT NULL THEN
    v_rationale := v_thesis
      || CASE WHEN v_why_now IS NOT NULL AND btrim(v_why_now) <> ''
              THEN E'\n\nWhy now: ' || v_why_now ELSE '' END;

    v_proposal_notes := v_proposed_action
      || CASE WHEN v_current_weight > 0
              THEN E'.\n\nCurrent weight: ' || v_current_txt || '%. Delta: ' || v_delta_txt || '%.'
              ELSE E'.\n\nTarget weight: '  || v_target_txt  || '%. Delta: ' || v_delta_txt || '%.'
         END
      || E'\n\nStarter-sized sizing intended to test the thesis while limiting concentration risk.';

    INSERT INTO trade_queue_items (
      portfolio_id, asset_id, action, status, stage,
      rationale, thesis_text,
      created_by, assigned_to, origin_type, sharing_visibility,
      proposed_weight, origin_metadata
    ) VALUES (
      v_portfolio_id, v_asset_id, v_action, 'idea', 'ready_for_decision',
      v_rationale, v_thesis,
      v_author_id, v_target_user, 'manual', 'public',
      v_target_weight,
      jsonb_build_object(
        'pilot_scenario_id', v_scenario_id::text,
        'pilot_seed', true, 'role', 'recommendation'
      )
    )
    RETURNING id INTO v_queue_item_id;

    INSERT INTO trade_proposals (
      trade_queue_item_id, user_id, portfolio_id,
      weight, notes, is_active, proposal_type, sizing_context
    ) VALUES (
      v_queue_item_id, v_author_id, v_portfolio_id,
      v_target_weight, v_proposal_notes,
      TRUE, 'pm_initiated',
      jsonb_build_object(
        'sizing_input', v_proposed_sizing,
        'target_weight_pct', v_target_weight,
        'delta_weight_pct', v_delta_weight,
        'current_weight_pct', v_current_weight,
        'why_now', v_why_now,
        'sizing_logic', 'Starter-sized sizing intended to test the thesis while limiting concentration risk.',
        'source', 'pilot_scenario'
      )
    )
    ON CONFLICT (trade_queue_item_id, user_id, portfolio_id) WHERE is_active = TRUE
      DO NOTHING
    RETURNING id INTO v_proposal_id;

    UPDATE pilot_scenarios SET trade_queue_item_id = v_queue_item_id
    WHERE id = v_scenario_id;

    SELECT id INTO v_idea_asset_id FROM assets WHERE upper(symbol) = 'MSFT' LIMIT 1;
    IF v_idea_asset_id IS NOT NULL AND v_idea_asset_id <> v_asset_id THEN
      INSERT INTO trade_queue_items (
        portfolio_id, asset_id, action, status, stage,
        rationale, thesis_text,
        created_by, assigned_to, origin_type, sharing_visibility,
        proposed_weight, origin_metadata
      ) VALUES (
        v_portfolio_id, v_idea_asset_id, 'buy'::trade_action, 'idea', 'thesis_forming',
        'AI infrastructure demand is outpacing supply. Margin expansion driven by Azure AI mix shift is underappreciated relative to consensus.',
        'AI infrastructure demand is outpacing supply. Margin expansion driven by Azure AI mix shift is underappreciated relative to consensus.',
        v_author_id, NULL, 'manual', 'public',
        1,
        jsonb_build_object(
          'pilot_scenario_id', v_scenario_id::text,
          'pilot_seed', true, 'role', 'idea'
        )
      )
      RETURNING id INTO v_idea_item_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'seeded', TRUE,
    'scenario_id', v_scenario_id,
    'trade_queue_item_id', v_queue_item_id,
    'trade_proposal_id', v_proposal_id,
    'idea_item_id', v_idea_item_id,
    'portfolio_id', v_portfolio_id,
    'asset_id', v_asset_id,
    'author_id', v_author_id,
    'current_weight_pct', v_current_weight,
    'target_weight_pct', v_target_weight,
    'delta_weight_pct', v_delta_weight,
    'used_template', v_template.id IS NOT NULL
  );
END;
$$;
