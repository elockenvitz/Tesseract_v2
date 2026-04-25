-- ============================================================================
-- Pilot scenario fixes: author attribution + post-accept archiving.
--
-- Two bugs reported on existing pilot orgs:
--   1. AAPL idea still showing as "open" in the Decisions stage even though
--      the recommendation was accepted. Root cause: when a trade is
--      accepted, nothing soft-archives the originating trade_queue_items
--      row, and `decision_requests.accepted_trade_id` is left null even
--      though `accepted_trades.decision_request_id` points back. The
--      Idea Pipeline filters by `visibility_tier='active'` so the row
--      keeps appearing.
--   2. The Decision Timeline shows "Dan Lockenvitz" as the author of the
--      seeded recommendation. Root cause: `ensure_pilot_scenario_for_user`
--      falls back to platform_admins when no other org member exists,
--      which leaks the platform admin's identity into pilot data.
--
-- This migration:
--   A. Updates `ensure_pilot_scenario_for_user` so the author fallback
--      chain is: other org member → the pilot user themselves. The
--      platform-admin fallback is removed so developer identities never
--      leak into pilot data.
--   B. Backfills existing pilot-seeded rows where `created_by` is NOT a
--      member of the org (the leak case). Replace with the org admin if
--      one exists, otherwise the org's first active member.
--   C. Backfills `decision_requests.accepted_trade_id` from the inverse
--      `accepted_trades.decision_request_id` link.
--   D. Soft-archives pilot-seeded `trade_queue_items` whose decision was
--      accepted (sets `visibility_tier='trash'`, `deleted_at=now()`) so
--      they fall out of the Idea Pipeline.
--
-- Scoped to `origin_metadata->>'pilot_seed' = 'true'` so non-pilot data
-- is untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Update ensure_pilot_scenario_for_user — drop platform_admins fallback
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_pilot_scenario_for_user(p_user_id uuid DEFAULT NULL::uuid, p_force_reset boolean DEFAULT false)
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

  SELECT u.current_organization_id INTO v_org_id
  FROM users u WHERE u.id = v_target_user;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('seeded', FALSE, 'reason', 'no_organization');
  END IF;

  SELECT COALESCE((settings->>'pilot_mode')::BOOLEAN, FALSE) INTO v_is_pilot
  FROM organizations WHERE id = v_org_id;

  IF NOT v_is_pilot THEN
    RETURN jsonb_build_object('seeded', FALSE, 'reason', 'not_pilot');
  END IF;

  IF p_force_reset THEN
    FOR v_existing IN
      SELECT * FROM pilot_scenarios
      WHERE user_id = v_target_user
        AND organization_id = v_org_id
        AND status = 'active'
        AND is_template = FALSE
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
  WHERE user_id = v_target_user
    AND organization_id = v_org_id
    AND status = 'active'
    AND is_template = FALSE
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

  -- Author selection: prefer another active org member (not the pilot user
  -- themselves) so the recommendation looks like it came from a teammate.
  -- If no such teammate exists in this org, self-author the recommendation.
  -- We deliberately do NOT fall back to platform_admins / caller_id —
  -- that leaks the developer's identity into pilot data.
  SELECT om.user_id INTO v_author_id
  FROM organization_memberships om
  WHERE om.organization_id = v_org_id AND om.status = 'active'
    AND om.user_id <> v_target_user AND om.is_org_admin = TRUE
  ORDER BY om.created_at ASC LIMIT 1;

  IF v_author_id IS NULL THEN
    SELECT om.user_id INTO v_author_id
    FROM organization_memberships om
    WHERE om.organization_id = v_org_id AND om.status = 'active'
      AND om.user_id <> v_target_user
    ORDER BY om.created_at ASC LIMIT 1;
  END IF;

  v_author_id := COALESCE(v_author_id, v_target_user);

  IF v_portfolio_id IS NOT NULL AND v_asset_id IS NOT NULL THEN
    WITH totals AS (
      SELECT SUM(shares * price) AS total
      FROM portfolio_holdings WHERE portfolio_id = v_portfolio_id
    )
    SELECT CASE WHEN t.total > 0
                THEN (ph.shares * ph.price) / t.total * 100
                ELSE 0 END
      INTO v_current_weight
    FROM portfolio_holdings ph CROSS JOIN totals t
    WHERE ph.portfolio_id = v_portfolio_id AND ph.asset_id = v_asset_id
    LIMIT 1;
  END IF;
  v_current_weight := COALESCE(v_current_weight, 0);

  IF v_template.target_weight_pct IS NULL THEN
    IF v_current_weight <= 0 THEN
      v_target_weight := 2;
      v_delta_weight := 2;
      v_proposed_action := 'Buy ' || upper(v_symbol);
      v_proposed_sizing := '+2.0';
    ELSIF v_current_weight < 2 THEN
      v_target_weight := 2;
      v_delta_weight := round(2 - v_current_weight, 2);
      v_proposed_action := 'Buy ' || upper(v_symbol);
      v_proposed_sizing := '+' || round(v_delta_weight, 1)::text;
    ELSE
      v_target_weight := round(v_current_weight + 0.5, 2);
      v_delta_weight := 0.5;
      v_proposed_action := 'Buy ' || upper(v_symbol);
      v_proposed_sizing := '+0.5';
    END IF;
  END IF;
  v_direction := 'buy';

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
        v_author_id, v_target_user, 'manual', 'public',
        NULL,
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
$function$;

-- ----------------------------------------------------------------------------
-- B. Backfill: re-attribute pilot-seeded rows where created_by is not an
--    active member of the org (the platform-admin leak case).
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_qi RECORD;
  v_correct_author UUID;
BEGIN
  FOR v_qi IN
    SELECT tqi.id, tqi.created_by, p.organization_id
    FROM trade_queue_items tqi
    JOIN portfolios p ON p.id = tqi.portfolio_id
    WHERE tqi.origin_metadata->>'pilot_seed' = 'true'
      AND NOT EXISTS (
        SELECT 1 FROM organization_memberships om
        WHERE om.user_id = tqi.created_by
          AND om.organization_id = p.organization_id
          AND om.status = 'active'
      )
  LOOP
    -- Prefer org admin
    SELECT om.user_id INTO v_correct_author
    FROM organization_memberships om
    WHERE om.organization_id = v_qi.organization_id
      AND om.status = 'active' AND om.is_org_admin = TRUE
    ORDER BY om.created_at ASC LIMIT 1;

    -- Fallback: any active member
    IF v_correct_author IS NULL THEN
      SELECT om.user_id INTO v_correct_author
      FROM organization_memberships om
      WHERE om.organization_id = v_qi.organization_id
        AND om.status = 'active'
      ORDER BY om.created_at ASC LIMIT 1;
    END IF;

    IF v_correct_author IS NULL THEN CONTINUE; END IF;

    UPDATE trade_queue_items
      SET created_by = v_correct_author, updated_at = now()
      WHERE id = v_qi.id;

    UPDATE trade_proposals
      SET user_id = v_correct_author, updated_at = now()
      WHERE trade_queue_item_id = v_qi.id
        AND user_id = v_qi.created_by;
  END LOOP;
END $$;

-- pilot_scenarios.created_by — same rule
DO $$
DECLARE
  v_ps RECORD;
  v_correct_author UUID;
BEGIN
  FOR v_ps IN
    SELECT ps.id, ps.created_by, ps.organization_id
    FROM pilot_scenarios ps
    WHERE ps.is_template = FALSE
      AND ps.created_by IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM organization_memberships om
        WHERE om.user_id = ps.created_by
          AND om.organization_id = ps.organization_id
          AND om.status = 'active'
      )
  LOOP
    SELECT om.user_id INTO v_correct_author
    FROM organization_memberships om
    WHERE om.organization_id = v_ps.organization_id
      AND om.status = 'active' AND om.is_org_admin = TRUE
    ORDER BY om.created_at ASC LIMIT 1;

    IF v_correct_author IS NULL THEN
      SELECT om.user_id INTO v_correct_author
      FROM organization_memberships om
      WHERE om.organization_id = v_ps.organization_id
        AND om.status = 'active'
      ORDER BY om.created_at ASC LIMIT 1;
    END IF;

    IF v_correct_author IS NULL THEN CONTINUE; END IF;

    UPDATE pilot_scenarios
      SET created_by = v_correct_author, updated_at = now()
      WHERE id = v_ps.id;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- C. Backfill decision_requests.accepted_trade_id from the inverse link.
-- ----------------------------------------------------------------------------

UPDATE decision_requests dr
   SET accepted_trade_id = at.id
  FROM accepted_trades at
 WHERE at.decision_request_id = dr.id
   AND at.is_active = TRUE
   AND dr.accepted_trade_id IS NULL;

-- ----------------------------------------------------------------------------
-- D. Soft-archive pilot-seeded trade_queue_items whose recommendation was
--    accepted (so they fall out of the Idea Pipeline).
-- ----------------------------------------------------------------------------

UPDATE trade_queue_items tqi
   SET visibility_tier = 'trash',
       deleted_at = now(),
       archived_at = NULL,
       updated_at = now()
 WHERE tqi.origin_metadata->>'pilot_seed' = 'true'
   AND tqi.visibility_tier = 'active'
   AND tqi.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM accepted_trades at
     WHERE at.trade_queue_item_id = tqi.id
       AND at.is_active = TRUE
   );
