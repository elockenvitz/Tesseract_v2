/**
 * Pilot scenario seeding — instantiate a high-quality prepared decision
 * for each pilot user on first login.
 *
 * Model:
 *   - `is_template=TRUE` rows are per-org reusable blueprints. They are
 *     never shown to pilot users directly. `user_id` is NULL on templates.
 *   - `is_template=FALSE` rows are per-user instantiations. `user_id` is
 *     always set for these. Exactly one active instantiation per user is
 *     enforced by a partial unique index, so repeated seeding is a no-op.
 *
 * Seeding resolution (inside ensure_pilot_scenario_for_user):
 *   1. If an active instantiation already exists for the user → return it.
 *   2. Find the org's active template, if any, and clone its content.
 *   3. Otherwise fall back to a built-in AAPL long default.
 *   4. Pick the user's assigned portfolio_id, else the template's, else
 *      the org's first active portfolio. If no portfolio is available the
 *      scenario is still created (the UI renders a clean empty state).
 *   5. Resolve the asset_id from the symbol via the global `assets` table.
 *   6. If both portfolio and asset exist, also create the matching
 *      `trade_queue_items` + `trade_proposals` rows so the idea shows up
 *      in Trade Lab's left panel under "Recommendations".
 *
 * Called by:
 *   - The pilot user themselves on first Trade Lab load (via the client
 *     hook). Auth-gated: caller may only seed for themselves unless they
 *     are a platform admin.
 *   - Platform admins from the ops panel ("Seed" / "Reset and seed").
 */

-- ─── Template flag + idempotency guard ────────────────────────────────
ALTER TABLE public.pilot_scenarios
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;

-- One active non-template scenario per user at a time. Re-running the
-- ensure RPC without a force-reset becomes a no-op after the first run.
CREATE UNIQUE INDEX IF NOT EXISTS pilot_scenarios_user_active_unique
  ON public.pilot_scenarios (user_id)
  WHERE user_id IS NOT NULL AND status = 'active' AND is_template = FALSE;

CREATE INDEX IF NOT EXISTS pilot_scenarios_org_template_idx
  ON public.pilot_scenarios (organization_id)
  WHERE is_template = TRUE AND status = 'active';


-- ─── stage_pilot_scenario (replaced) ──────────────────────────────────
-- Adds trade_proposals row creation so staged ideas appear in the left
-- panel under Recommendations, not only under generic Ideas.

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
    FROM assets
    WHERE upper(symbol) = upper(btrim(p_symbol))
    LIMIT 1;
  END IF;

  BEGIN
    v_action := COALESCE(NULLIF(btrim(p_direction), ''), 'buy')::trade_action;
  EXCEPTION WHEN invalid_text_representation THEN
    v_action := 'buy'::trade_action;
  END;

  -- Templates don't generate queue items / proposals — they're blueprints.
  IF NOT p_is_template
     AND v_resolved_asset_id IS NOT NULL
     AND p_portfolio_id IS NOT NULL THEN
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
      COALESCE(p_user_id, v_caller_id), 'manual', 'shared',
      p_target_weight_pct
    )
    RETURNING id INTO v_queue_item_id;

    -- Pair with a PM-initiated proposal so the idea shows under
    -- Recommendations (amber), not just Ideas.
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
    trade_queue_item_id, status, assigned_at, created_by,
    is_template
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
    v_caller_id,
    p_is_template
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


-- ─── delete_pilot_scenario (replaced) ─────────────────────────────────
-- Also deactivates any linked trade_proposals row so the recommendation
-- stops showing in the pilot user's left panel.

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

  SELECT trade_queue_item_id INTO v_queue_item_id
  FROM pilot_scenarios WHERE id = p_scenario_id;

  DELETE FROM pilot_scenarios WHERE id = p_scenario_id;

  IF v_queue_item_id IS NOT NULL THEN
    UPDATE trade_proposals
    SET is_active = FALSE, updated_at = now()
    WHERE trade_queue_item_id = v_queue_item_id AND is_active = TRUE;

    UPDATE trade_queue_items
    SET visibility_tier = 'trash', archived_at = now()
    WHERE id = v_queue_item_id;
  END IF;
END;
$$;


-- ─── ensure_pilot_scenario_for_user ───────────────────────────────────
-- Idempotent seeding RPC. Callable by:
--   1. The user themselves (p_user_id defaults to auth.uid() — and the
--      function refuses to seed unless the user actually qualifies as
--      pilot).
--   2. Platform admins with any p_user_id, for ops panel actions.
--
-- Use p_force_reset=TRUE to tear down the current active scenario and
-- re-seed. Only platform admins may force-reset (it soft-deletes the
-- user's existing queue item + proposal).

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
BEGIN
  IF v_target_user IS NULL THEN
    RAISE EXCEPTION 'Missing user';
  END IF;

  -- Only platform admins can seed on behalf of someone else.
  IF v_target_user <> v_caller_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: cannot seed a scenario for another user';
  END IF;

  -- Only platform admins can force a reset (destructive).
  IF p_force_reset AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: only platform admins can reset pilot scenarios';
  END IF;

  -- Verify target actually qualifies as pilot. Pilot = users.is_pilot_user
  -- OR organizations.settings.pilot_mode. This prevents a random user
  -- from triggering seeding on themselves.
  SELECT u.is_pilot_user, u.current_organization_id
    INTO v_is_pilot, v_org_id
  FROM users u WHERE u.id = v_target_user;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('seeded', FALSE, 'reason', 'no_organization');
  END IF;

  IF NOT v_is_pilot THEN
    SELECT COALESCE((settings->>'pilot_mode')::BOOLEAN, FALSE)
      INTO v_org_pilot
    FROM organizations WHERE id = v_org_id;
    v_is_pilot := COALESCE(v_org_pilot, FALSE);
  END IF;

  IF NOT v_is_pilot THEN
    RETURN jsonb_build_object('seeded', FALSE, 'reason', 'not_pilot');
  END IF;

  -- Force reset: soft-delete the current active scenario and its linked
  -- queue item + proposal, so the partial unique index is free to accept
  -- a new instantiation.
  IF p_force_reset THEN
    FOR v_existing IN
      SELECT * FROM pilot_scenarios
      WHERE user_id = v_target_user
        AND status = 'active'
        AND is_template = FALSE
    LOOP
      IF v_existing.trade_queue_item_id IS NOT NULL THEN
        UPDATE trade_proposals
          SET is_active = FALSE, updated_at = now()
          WHERE trade_queue_item_id = v_existing.trade_queue_item_id
            AND is_active = TRUE;
        UPDATE trade_queue_items
          SET visibility_tier = 'trash', archived_at = now()
          WHERE id = v_existing.trade_queue_item_id;
      END IF;
      UPDATE pilot_scenarios
        SET status = 'archived', updated_at = now()
        WHERE id = v_existing.id;
    END LOOP;
  END IF;

  -- Short-circuit if an active instantiation already exists.
  SELECT * INTO v_existing
  FROM pilot_scenarios
  WHERE user_id = v_target_user
    AND status = 'active'
    AND is_template = FALSE
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'seeded', FALSE,
      'reason', 'already_exists',
      'scenario_id', v_existing.id,
      'trade_queue_item_id', v_existing.trade_queue_item_id
    );
  END IF;

  -- Pull the org template, if one exists.
  SELECT * INTO v_template
  FROM pilot_scenarios
  WHERE organization_id = v_org_id
    AND is_template = TRUE
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Resolve content. Template wins over default.
  v_title           := COALESCE(v_template.title,                  'AAPL — starter position');
  v_symbol          := COALESCE(v_template.symbol,                 'AAPL');
  v_direction       := COALESCE(v_template.direction,              'buy');
  v_thesis          := COALESCE(v_template.thesis,                 'Services growth and margin durability remain underappreciated relative to hardware slowdown concerns.');
  v_why_now         := COALESCE(v_template.why_now,                'Recent multiple compression creates a more attractive entry point versus long-term earnings durability.');
  v_proposed_action := COALESCE(v_template.proposed_action,        'Increase position');
  v_proposed_sizing := COALESCE(v_template.proposed_sizing_input,  '+2.0');
  v_target_weight   := COALESCE(v_template.target_weight_pct,       2);
  v_delta_weight    := COALESCE(v_template.delta_weight_pct,        2);
  v_asset_id        := COALESCE(v_template.asset_id, (SELECT id FROM assets WHERE upper(symbol) = upper(v_symbol) LIMIT 1));

  -- Pick portfolio: explicit template → user's assigned portfolio →
  -- org's first active portfolio.
  v_portfolio_id := v_template.portfolio_id;
  IF v_portfolio_id IS NULL THEN
    SELECT id INTO v_portfolio_id
    FROM portfolios
    WHERE organization_id = v_org_id
      AND is_active = TRUE
      AND (archived_at IS NULL)
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- Map direction → trade_action; fall back to 'buy' if unrecognised.
  BEGIN
    v_action := COALESCE(NULLIF(btrim(v_direction), ''), 'buy')::trade_action;
  EXCEPTION WHEN invalid_text_representation THEN
    v_action := 'buy'::trade_action;
  END;

  -- Only insert a queue item + proposal when we have both a target
  -- portfolio AND a resolvable asset. Without either, the UI shows a
  -- clean empty state; the scenario row is still recorded so admins can
  -- see the intent in the ops panel.
  IF v_portfolio_id IS NOT NULL AND v_asset_id IS NOT NULL THEN
    v_rationale := v_thesis
      || CASE WHEN v_why_now IS NOT NULL AND btrim(v_why_now) <> ''
              THEN E'\n\nWhy now: ' || v_why_now
              ELSE '' END;

    INSERT INTO trade_queue_items (
      portfolio_id, asset_id, action, status, stage,
      rationale, thesis_text,
      created_by, assigned_to, origin_type, sharing_visibility,
      proposed_weight
    ) VALUES (
      v_portfolio_id, v_asset_id, v_action, 'idea', 'ready_for_decision',
      v_rationale, v_thesis,
      v_target_user, v_target_user, 'manual', 'shared',
      v_target_weight
    )
    RETURNING id INTO v_queue_item_id;

    INSERT INTO trade_proposals (
      trade_queue_item_id, user_id, portfolio_id,
      weight, notes, is_active, proposal_type, sizing_context
    ) VALUES (
      v_queue_item_id, v_target_user, v_portfolio_id,
      v_target_weight,
      v_proposed_action,
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
    trade_queue_item_id, status, assigned_at, created_by,
    is_template
  ) VALUES (
    v_org_id, v_target_user, v_title, v_asset_id, upper(v_symbol), v_direction,
    v_thesis, v_why_now, v_proposed_action, v_proposed_sizing,
    v_target_weight, v_delta_weight, v_portfolio_id,
    v_queue_item_id, 'active', now(),
    COALESCE(v_template.created_by, v_caller_id),
    FALSE
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


GRANT EXECUTE ON FUNCTION public.stage_pilot_scenario(
  UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, UUID, UUID, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_pilot_scenario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_pilot_scenario_for_user(UUID, BOOLEAN) TO authenticated;
