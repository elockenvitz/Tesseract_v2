-- Harden ensure_pilot_decision_request_for_user against creating a
-- duplicate pending decision_request after the user has already
-- accepted (or rejected) the previous one. Symptom: pilot accepts
-- the AAPL recommendation in Trade Lab, the existing pending row
-- flips to 'accepted', then the next dashboard load creates a NEW
-- pending row because the function only checked for status='pending'.
--
-- Fix: the function now bails out if ANY decision_request already
-- exists for the same trade_queue_item_id, regardless of status.
-- The pilot scenario's recommendation is a one-shot — once it's
-- been decided we don't keep re-seeding it.

CREATE OR REPLACE FUNCTION ensure_pilot_decision_request_for_user(
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scenario RECORD;
  v_existing_id UUID;
  v_new_id UUID;
  v_action TEXT;
  v_target_weight NUMERIC;
  v_proposal_id UUID;
  v_proposal_sizing JSONB;
  v_baseline_weight NUMERIC;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT ps.*, tqi.action AS tqi_action
    INTO v_scenario
  FROM pilot_scenarios ps
  JOIN trade_queue_items tqi ON tqi.id = ps.trade_queue_item_id
  WHERE ps.user_id = p_user_id
    AND ps.status = 'active'
    AND ps.is_template = FALSE
    AND ps.trade_queue_item_id IS NOT NULL
    AND ps.portfolio_id IS NOT NULL
  ORDER BY ps.created_at DESC
  LIMIT 1;

  IF v_scenario.id IS NULL THEN RETURN NULL; END IF;

  -- Bail out for ANY existing decision_request — pending OR resolved.
  -- If the pilot has already accepted/rejected/withdrawn the prior row,
  -- we don't reseed; the loop is one-shot for a given recommendation.
  SELECT id INTO v_existing_id
  FROM decision_requests
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id
    AND portfolio_id = v_scenario.portfolio_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  SELECT id, sizing_context INTO v_proposal_id, v_proposal_sizing
  FROM trade_proposals
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id
    AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 1;

  v_action := COALESCE(v_scenario.tqi_action::TEXT, 'buy');
  v_target_weight := v_scenario.target_weight_pct;
  v_baseline_weight := COALESCE(
    (v_proposal_sizing->>'current_weight_pct')::NUMERIC,
    0
  );

  INSERT INTO decision_requests (
    trade_queue_item_id, requested_by, portfolio_id, urgency,
    context_note, status, requested_action, sizing_weight, sizing_mode,
    proposal_id, submission_snapshot
  ) VALUES (
    v_scenario.trade_queue_item_id, p_user_id, v_scenario.portfolio_id,
    'medium', COALESCE(v_scenario.why_now, 'Pilot scenario recommendation.'),
    'pending', v_action, v_target_weight, 'weight', v_proposal_id,
    jsonb_build_object(
      'baseline_weight', v_baseline_weight,
      'weight', v_target_weight,
      'sizing_context', v_proposal_sizing,
      'pilot_seed', TRUE
    )
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_pilot_decision_request_for_user(UUID) TO authenticated;

-- Stamp pilot_seed=true into existing decision_requests'
-- submission_snapshot so the frontend has a reliable signal to swap
-- the requester display from the user's name (e.g. "Money Moves")
-- to "Pilot" without having to re-join trade_queue_items.
UPDATE decision_requests dr
SET submission_snapshot = COALESCE(dr.submission_snapshot, '{}'::jsonb) || jsonb_build_object('pilot_seed', TRUE)
FROM trade_queue_items tqi
WHERE dr.trade_queue_item_id = tqi.id
  AND tqi.origin_metadata->>'role' = 'recommendation'
  AND tqi.origin_metadata ? 'pilot_scenario_id'
  AND COALESCE((dr.submission_snapshot->>'pilot_seed')::BOOLEAN, FALSE) IS DISTINCT FROM TRUE;
