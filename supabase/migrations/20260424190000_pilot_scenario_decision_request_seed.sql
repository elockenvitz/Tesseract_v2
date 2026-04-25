-- Pilot scenarios need a matching decision_requests row so the
-- staged AAPL recommendation surfaces in the pilot user's Decision
-- Inbox. The Inbox renders rows from decision_requests, not
-- trade_proposals, so without this the pilot's BUY AAPL never
-- shows up as an actionable recommendation.
--
-- Idempotency: the function checks for an existing pending row
-- matching (trade_queue_item_id, portfolio_id) before inserting.
-- A backfill at the bottom catches any pilot scenarios that were
-- seeded before this RPC existed.

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

  SELECT id INTO v_existing_id
  FROM decision_requests
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id
    AND portfolio_id = v_scenario.portfolio_id
    AND status = 'pending'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  SELECT id INTO v_proposal_id
  FROM trade_proposals
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id
    AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 1;

  v_action := COALESCE(v_scenario.tqi_action::TEXT, 'buy');
  v_target_weight := v_scenario.target_weight_pct;

  INSERT INTO decision_requests (
    trade_queue_item_id, requested_by, portfolio_id, urgency,
    context_note, status, requested_action, sizing_weight, sizing_mode,
    proposal_id
  ) VALUES (
    v_scenario.trade_queue_item_id, p_user_id, v_scenario.portfolio_id,
    'medium', COALESCE(v_scenario.why_now, 'Pilot scenario recommendation.'),
    'pending', v_action, v_target_weight, 'weight', v_proposal_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_pilot_decision_request_for_user(UUID) TO authenticated;

-- Backfill — for every active pilot scenario without a pending
-- decision_request, create one. Runs once at migration time;
-- subsequent re-runs are no-ops because of the NOT EXISTS guard.
INSERT INTO decision_requests (
  trade_queue_item_id, requested_by, portfolio_id, urgency,
  context_note, status, requested_action, sizing_weight, sizing_mode,
  proposal_id
)
SELECT
  ps.trade_queue_item_id, ps.user_id, ps.portfolio_id,
  'medium', COALESCE(ps.why_now, 'Pilot scenario recommendation.'),
  'pending', COALESCE(tqi.action::TEXT, 'buy'),
  ps.target_weight_pct, 'weight',
  (SELECT id FROM trade_proposals WHERE trade_queue_item_id = ps.trade_queue_item_id AND is_active = TRUE ORDER BY created_at DESC LIMIT 1)
FROM pilot_scenarios ps
JOIN trade_queue_items tqi ON tqi.id = ps.trade_queue_item_id
WHERE ps.status = 'active'
  AND ps.is_template = FALSE
  AND ps.trade_queue_item_id IS NOT NULL
  AND ps.portfolio_id IS NOT NULL
  AND ps.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM decision_requests dr
    WHERE dr.trade_queue_item_id = ps.trade_queue_item_id
      AND dr.portfolio_id = ps.portfolio_id
  );
