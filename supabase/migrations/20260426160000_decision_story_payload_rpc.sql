-- Single RPC backing the Outcomes detail-pane "story" (theses, decision
-- request, accepted trade, execution rationale, linked-research count,
-- trade idea extras). Replaces the prior 6-parallel-supabase-call
-- pattern in useDecisionStory with one round-trip so the right pane
-- can paint as soon as the click resolves.
--
-- Returns JSONB:
--   {
--     theses: [...],
--     decisionRequest: {...} | null,
--     acceptedTrade: {...} | null,
--     executionRationale: {...} | null,   (only when p_execution_event_id is set)
--     linkedResearchCount: number,
--     ideaExtras: { conviction, time_horizon, urgency, thesis_text } | null
--   }
--
-- Visibility runs through RLS as the calling user (SECURITY INVOKER).

CREATE OR REPLACE FUNCTION public.decision_story_payload(
  p_decision_id uuid,
  p_execution_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_theses JSONB;
  v_decision_request JSONB;
  v_accepted_trade JSONB;
  v_execution_rationale JSONB;
  v_linked_research_count INTEGER;
  v_idea_extras JSONB;
BEGIN
  IF p_decision_id IS NULL THEN
    RETURN jsonb_build_object(
      'theses', '[]'::jsonb,
      'decisionRequest', NULL,
      'acceptedTrade', NULL,
      'executionRationale', NULL,
      'linkedResearchCount', 0,
      'ideaExtras', NULL
    );
  END IF;

  -- Theses with creator name resolved server-side.
  WITH t AS (
    SELECT
      tit.id,
      tit.direction,
      tit.rationale,
      tit.conviction,
      tit.created_at,
      COALESCE(
        NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        u.email,
        NULL
      ) AS created_by_name
    FROM trade_idea_theses tit
    LEFT JOIN users u ON u.id = tit.created_by
    WHERE tit.trade_queue_item_id = p_decision_id
    ORDER BY tit.created_at ASC
  )
  SELECT jsonb_agg(to_jsonb(t.*)) INTO v_theses FROM t;
  v_theses := COALESCE(v_theses, '[]'::jsonb);

  -- Decision request (latest accepted/rejected/etc).
  SELECT jsonb_build_object(
    'id', dr.id,
    'urgency', dr.urgency,
    'context_note', dr.context_note,
    'decision_note', dr.decision_note,
    'status', dr.status,
    'submission_snapshot', dr.submission_snapshot,
    'requester_name', COALESCE(
      NULLIF(btrim(COALESCE(req.first_name, '') || ' ' || COALESCE(req.last_name, '')), ''),
      req.email,
      NULL
    ),
    'reviewed_by_name', COALESCE(
      NULLIF(btrim(COALESCE(rev.first_name, '') || ' ' || COALESCE(rev.last_name, '')), ''),
      rev.email,
      NULL
    ),
    'reviewed_at', dr.reviewed_at,
    'created_at', dr.created_at
  )
  INTO v_decision_request
  FROM decision_requests dr
  LEFT JOIN users req ON req.id = dr.requested_by
  LEFT JOIN users rev ON rev.id = dr.reviewed_by
  WHERE dr.trade_queue_item_id = p_decision_id
    AND dr.status IN ('accepted', 'accepted_with_modification', 'rejected', 'deferred')
  ORDER BY dr.created_at DESC
  LIMIT 1;

  -- Accepted trade (latest active).
  SELECT jsonb_build_object(
    'id', at.id,
    'acceptance_note', at.acceptance_note,
    'price_at_acceptance',
      CASE WHEN at.price_at_acceptance IS NULL THEN NULL ELSE at.price_at_acceptance::numeric END,
    'execution_status', at.execution_status,
    'execution_note', at.execution_note,
    'source', at.source,
    'created_at', at.created_at
  )
  INTO v_accepted_trade
  FROM accepted_trades at
  WHERE at.trade_queue_item_id = p_decision_id
    AND at.is_active = TRUE
  ORDER BY at.created_at DESC
  LIMIT 1;

  -- Execution rationale for the matched event, if one was passed.
  IF p_execution_event_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', ter.id,
      'reason_for_action', ter.reason_for_action,
      'why_now', ter.why_now,
      'what_changed', ter.what_changed,
      'thesis_context', ter.thesis_context,
      'catalyst_trigger', ter.catalyst_trigger,
      'sizing_logic', ter.sizing_logic,
      'risk_context', ter.risk_context,
      'execution_context', ter.execution_context,
      'divergence_from_plan', COALESCE(ter.divergence_from_plan, FALSE),
      'divergence_explanation', ter.divergence_explanation,
      'rationale_type', ter.rationale_type,
      'status', ter.status,
      'authored_by_name', COALESCE(
        NULLIF(btrim(COALESCE(au.first_name, '') || ' ' || COALESCE(au.last_name, '')), ''),
        au.email,
        NULL
      ),
      'reviewed_by_name', COALESCE(
        NULLIF(btrim(COALESCE(rv.first_name, '') || ' ' || COALESCE(rv.last_name, '')), ''),
        rv.email,
        NULL
      ),
      'created_at', ter.created_at
    )
    INTO v_execution_rationale
    FROM trade_event_rationales ter
    LEFT JOIN users au ON au.id = ter.authored_by
    LEFT JOIN users rv ON rv.id = ter.reviewed_by
    WHERE ter.trade_event_id = p_execution_event_id
    ORDER BY ter.version_number DESC
    LIMIT 1;
  END IF;

  -- Linked research count.
  SELECT COUNT(*)::INTEGER
  INTO v_linked_research_count
  FROM object_links ol
  WHERE ol.target_type = 'trade_idea'
    AND ol.target_id = p_decision_id;
  v_linked_research_count := COALESCE(v_linked_research_count, 0);

  -- Idea extras.
  SELECT jsonb_build_object(
    'conviction', tqi.conviction,
    'time_horizon', tqi.time_horizon,
    'urgency', tqi.urgency,
    'thesis_text', tqi.thesis_text
  )
  INTO v_idea_extras
  FROM trade_queue_items tqi
  WHERE tqi.id = p_decision_id;

  RETURN jsonb_build_object(
    'theses', v_theses,
    'decisionRequest', v_decision_request,
    'acceptedTrade', v_accepted_trade,
    'executionRationale', v_execution_rationale,
    'linkedResearchCount', v_linked_research_count,
    'ideaExtras', v_idea_extras
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.decision_story_payload(uuid, uuid) TO authenticated;
