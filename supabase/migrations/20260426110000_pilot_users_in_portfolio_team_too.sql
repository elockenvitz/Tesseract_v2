-- Pilot users were enrolled in portfolio_memberships but the older
-- portfolio_team table is still the gate for several policies
-- (notably decision_requests INSERT and trade_idea_theses). Seed
-- portfolio_team alongside portfolio_memberships so submitting a
-- recommendation actually lands a decision_request row instead of
-- silently RLS-failing.

-- Backfill: pilot user → 'Portfolio Manager' role on their pilot portfolio.
INSERT INTO portfolio_team (portfolio_id, user_id, role)
SELECT ps.portfolio_id, ps.user_id, 'Portfolio Manager'
FROM pilot_scenarios ps
WHERE ps.user_id IS NOT NULL
  AND ps.portfolio_id IS NOT NULL
  AND ps.is_template = FALSE
  AND ps.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM portfolio_team pt
    WHERE pt.portfolio_id = ps.portfolio_id AND pt.user_id = ps.user_id
  );

-- Backfill the missing decision_request for any active trade_proposal
-- whose synthesis silently failed because the user wasn't yet in
-- portfolio_team. Without this, recommendations the user already
-- submitted stay invisible in the inbox after the policy fix.
--
-- Exclude proposals that have ANY decision_request — including
-- already-accepted/rejected/deferred ones. The intent is to recover
-- recommendations whose DR never landed, not to re-open completed
-- decisions; an accepted DR is canonical and shouldn't be shadowed
-- by a fresh pending one with a stale (pre-execution) weight target.
INSERT INTO decision_requests (
  trade_queue_item_id, requested_by, portfolio_id, urgency,
  context_note, status, requested_action, sizing_weight, sizing_mode,
  proposal_id, submission_snapshot
)
SELECT
  tp.trade_queue_item_id,
  tp.user_id,
  tp.portfolio_id,
  'medium',
  COALESCE(tp.notes, 'Recommendation submitted.'),
  'pending',
  COALESCE(tqi.action::text, 'buy'),
  tp.weight,
  'weight',
  tp.id,
  jsonb_build_object(
    'action', tqi.action,
    'symbol', a.symbol,
    'weight', tp.weight,
    'shares', tp.shares,
    'notes', tp.notes,
    'submitted_at', tp.created_at,
    'backfilled', true
  )
FROM trade_proposals tp
JOIN trade_queue_items tqi ON tqi.id = tp.trade_queue_item_id
LEFT JOIN assets a ON a.id = tqi.asset_id
WHERE tp.is_active = TRUE
  AND tp.trade_queue_item_id IS NOT NULL
  AND tp.portfolio_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM decision_requests dr
    WHERE dr.proposal_id = tp.id
  );

-- Patch ensure_pilot_scenario_for_user to also seed portfolio_team.
-- Identical to the previous version except for the new INSERT block
-- and the corresponding healing block in the early-return branch.
CREATE OR REPLACE FUNCTION public.ensure_pilot_scenario_for_user(
  p_user_id uuid DEFAULT NULL::uuid,
  p_force_reset boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_target_user UUID := COALESCE(p_user_id, v_caller_id);
  v_is_admin BOOLEAN := is_platform_admin();
  v_is_pilot BOOLEAN := FALSE;
  v_org_id UUID;
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
  IF v_target_user IS NULL THEN RAISE EXCEPTION 'Missing user'; END IF;
  IF v_target_user <> v_caller_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: cannot seed a scenario for another user';
  END IF;
  IF p_force_reset AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: only platform admins can reset pilot scenarios';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pilot_seed:' || v_target_user::text, 0));

  SELECT u.current_organization_id INTO v_org_id FROM users u WHERE u.id = v_target_user;
  IF v_org_id IS NULL THEN RETURN jsonb_build_object('seeded', FALSE, 'reason', 'no_organization'); END IF;

  SELECT COALESCE((settings->>'pilot_mode')::BOOLEAN, FALSE) INTO v_is_pilot
  FROM organizations WHERE id = v_org_id;
  IF NOT v_is_pilot THEN RETURN jsonb_build_object('seeded', FALSE, 'reason', 'not_pilot'); END IF;

  IF p_force_reset THEN
    FOR v_existing IN
      SELECT * FROM pilot_scenarios
      WHERE user_id = v_target_user AND organization_id = v_org_id
        AND status = 'active' AND is_template = FALSE
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
  WHERE user_id = v_target_user AND organization_id = v_org_id
    AND status = 'active' AND is_template = FALSE
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    IF v_existing.portfolio_id IS NOT NULL THEN
      INSERT INTO portfolio_memberships (
        portfolio_id, user_id, is_portfolio_manager,
        access_permissions, joined_at
      ) VALUES (
        v_existing.portfolio_id, v_target_user, TRUE,
        '{"can_edit": true, "can_view": true, "can_trade": true, "can_manage": true}'::jsonb,
        COALESCE(v_existing.assigned_at, now())
      ) ON CONFLICT (portfolio_id, user_id) DO NOTHING;

      INSERT INTO portfolio_team (portfolio_id, user_id, role)
      SELECT v_existing.portfolio_id, v_target_user, 'Portfolio Manager'
      WHERE NOT EXISTS (
        SELECT 1 FROM portfolio_team pt
        WHERE pt.portfolio_id = v_existing.portfolio_id AND pt.user_id = v_target_user
      );
    END IF;

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
  v_proposed_action := COALESCE(v_template.proposed_action,        'Buy AAPL');
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

  SELECT om.user_id INTO v_author_id FROM organization_memberships om
  WHERE om.organization_id = v_org_id AND om.status = 'active'
    AND om.user_id <> v_target_user AND om.is_org_admin = TRUE
  ORDER BY om.created_at ASC LIMIT 1;
  IF v_author_id IS NULL THEN
    SELECT om.user_id INTO v_author_id FROM organization_memberships om
    WHERE om.organization_id = v_org_id AND om.status = 'active' AND om.user_id <> v_target_user
    ORDER BY om.created_at ASC LIMIT 1;
  END IF;
  v_author_id := COALESCE(v_author_id, v_target_user);

  IF v_portfolio_id IS NOT NULL AND v_asset_id IS NOT NULL THEN
    WITH totals AS (
      SELECT SUM(shares * price) AS total FROM portfolio_holdings WHERE portfolio_id = v_portfolio_id
    )
    SELECT CASE WHEN t.total > 0 THEN (ph.shares * ph.price) / t.total * 100 ELSE 0 END
      INTO v_current_weight
    FROM portfolio_holdings ph CROSS JOIN totals t
    WHERE ph.portfolio_id = v_portfolio_id AND ph.asset_id = v_asset_id LIMIT 1;
  END IF;
  v_current_weight := COALESCE(v_current_weight, 0);

  IF v_template.target_weight_pct IS NULL THEN
    IF v_current_weight <= 0 THEN
      v_target_weight := 2; v_delta_weight := 2;
      v_proposed_action := 'Buy ' || upper(v_symbol); v_proposed_sizing := '+2.0';
    ELSIF v_current_weight < 2 THEN
      v_target_weight := 2; v_delta_weight := round(2 - v_current_weight, 2);
      v_proposed_action := 'Buy ' || upper(v_symbol); v_proposed_sizing := '+' || round(v_delta_weight, 1)::text;
    ELSE
      v_target_weight := round(v_current_weight + 0.5, 2); v_delta_weight := 0.5;
      v_proposed_action := 'Buy ' || upper(v_symbol); v_proposed_sizing := '+0.5';
    END IF;
  END IF;
  v_direction := 'buy';

  BEGIN v_action := COALESCE(NULLIF(btrim(v_direction), ''), 'buy')::trade_action;
  EXCEPTION WHEN invalid_text_representation THEN v_action := 'buy'::trade_action; END;

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
  ) RETURNING id INTO v_scenario_id;

  IF v_portfolio_id IS NOT NULL THEN
    INSERT INTO portfolio_memberships (
      portfolio_id, user_id, is_portfolio_manager,
      access_permissions, joined_at
    ) VALUES (
      v_portfolio_id, v_target_user, TRUE,
      '{"can_edit": true, "can_view": true, "can_trade": true, "can_manage": true}'::jsonb,
      now()
    ) ON CONFLICT (portfolio_id, user_id) DO NOTHING;

    INSERT INTO portfolio_team (portfolio_id, user_id, role)
    SELECT v_portfolio_id, v_target_user, 'Portfolio Manager'
    WHERE NOT EXISTS (
      SELECT 1 FROM portfolio_team pt
      WHERE pt.portfolio_id = v_portfolio_id AND pt.user_id = v_target_user
    );
  END IF;

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
      jsonb_build_object('pilot_scenario_id', v_scenario_id::text, 'pilot_seed', true, 'role', 'recommendation')
    ) RETURNING id INTO v_queue_item_id;

    INSERT INTO trade_proposals (
      trade_queue_item_id, user_id, portfolio_id,
      weight, notes, is_active, proposal_type, sizing_context
    ) VALUES (
      v_queue_item_id, v_author_id, v_portfolio_id,
      v_target_weight, v_proposal_notes, TRUE, 'pm_initiated',
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
      DO NOTHING RETURNING id INTO v_proposal_id;

    UPDATE pilot_scenarios SET trade_queue_item_id = v_queue_item_id WHERE id = v_scenario_id;

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
        v_author_id, v_target_user, 'manual', 'public',
        NULL,
        jsonb_build_object('pilot_scenario_id', v_scenario_id::text, 'pilot_seed', true, 'role', 'idea')
      ) RETURNING id INTO v_idea_item_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'seeded', TRUE, 'scenario_id', v_scenario_id,
    'trade_queue_item_id', v_queue_item_id, 'trade_proposal_id', v_proposal_id,
    'idea_item_id', v_idea_item_id, 'portfolio_id', v_portfolio_id,
    'asset_id', v_asset_id, 'author_id', v_author_id,
    'current_weight_pct', v_current_weight,
    'target_weight_pct', v_target_weight,
    'delta_weight_pct', v_delta_weight,
    'used_template', v_template.id IS NOT NULL
  );
END;
$function$;
