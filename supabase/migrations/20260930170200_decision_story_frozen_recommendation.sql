-- decision_story_payload: stop presenting current reasoning as the basis of
-- a past decision.
--
-- ── What was wrong ───────────────────────────────────────────────────────
--
-- Two blocks of this RPC read mutable rows and the Outcomes detail pane
-- renders both directly beneath the decision they supposedly informed:
--
--   `ideaExtras`  SELECTs conviction, time_horizon, urgency and thesis_text
--                 straight from `trade_queue_items`.
--   `theses`      SELECTs direction, rationale and conviction straight from
--                 `trade_idea_theses`.
--
-- Edit an idea and every past decision on it silently re-narrates. Worse,
-- the Outcomes pane offers an "Add thesis" form that writes
-- `trade_idea_theses` and then invalidates this query — so a thesis written
-- AFTER a decision appears as part of the reasoning behind it, with nothing
-- on screen distinguishing the two.
--
-- ── What changes ─────────────────────────────────────────────────────────
--
-- One new block, `recommendationVersion`, carrying the immutable
-- `trade_proposal_versions` row the decision request was raised on —
-- including the bull/bear/catalyst/risk cases frozen at submission.
--
-- `ideaExtras` and `theses` are KEPT and are NOT changed. They answer a real
-- and different question — what does the desk think about this idea now —
-- and the caller already has somewhere to put that. Removing them here would
-- break the pane; silently repointing them at frozen data would mislabel
-- current thinking as historical. The client chooses which to render where,
-- and `recommendationVersion` being non-null is how it knows the historical
-- answer exists.
--
-- Unchanged: signature, return keys (one added), STABLE, SECURITY INVOKER,
-- grants. Visibility still runs through RLS as the calling user, so the new
-- block returns NULL for a version the caller cannot read.

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
  v_recommendation_version JSONB;
BEGIN
  IF p_decision_id IS NULL THEN
    RETURN jsonb_build_object(
      'theses', '[]'::jsonb,
      'decisionRequest', NULL,
      'acceptedTrade', NULL,
      'executionRationale', NULL,
      'linkedResearchCount', 0,
      'ideaExtras', NULL,
      'recommendationVersion', NULL
    );
  END IF;

  -- CURRENT thinking. Mutable by design: this is what the desk believes
  -- today, which is a legitimate thing to show as long as it is not shown as
  -- what the PM was reading when they decided.
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

  -- Decision request (latest resolved).
  SELECT jsonb_build_object(
    'id', dr.id,
    'urgency', dr.urgency,
    'context_note', dr.context_note,
    'decision_note', dr.decision_note,
    'status', dr.status,
    'submission_snapshot', dr.submission_snapshot,
    'proposal_version_id', dr.proposal_version_id,
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

  -- WHAT WAS RECOMMENDED, frozen at submission.
  --
  -- Reached through the decision request's own pointer, never by "the latest
  -- version of this proposal": a revision submitted after the decision would
  -- otherwise retroactively become the thing the PM approved.
  --
  -- NULL for every request raised before versioning existed. The client
  -- treats NULL as "not captured" and says so; it must not fall back to
  -- ideaExtras or theses below.
  IF v_decision_request IS NOT NULL
     AND (v_decision_request ->> 'proposal_version_id') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', v.id,
      'version_number', v.version_number,
      'action', v.action,
      'idea_stage', v.idea_stage,
      'weight', v.weight,
      'shares', v.shares,
      'sizing_mode', v.sizing_mode,
      'notes', v.notes,
      'thesis_text', v.thesis_text,
      'rationale', v.rationale,
      'conviction', v.conviction,
      'target_price', v.target_price,
      'stop_loss', v.stop_loss,
      'take_profit', v.take_profit,
      'time_horizon', v.time_horizon,
      'theses', v.theses,
      'captured_from', v.captured_from,
      'submitted_at', v.submitted_at,
      'submitted_by_name', COALESCE(
        NULLIF(btrim(COALESCE(sub.first_name, '') || ' ' || COALESCE(sub.last_name, '')), ''),
        sub.email,
        NULL
      )
    )
    INTO v_recommendation_version
    FROM trade_proposal_versions v
    LEFT JOIN users sub ON sub.id = v.created_by
    WHERE v.id = (v_decision_request ->> 'proposal_version_id')::uuid;
  END IF;

  -- Accepted trade (latest active).
  SELECT jsonb_build_object(
    'id', at.id,
    'acceptance_note', at.acceptance_note,
    'price_at_acceptance', at.price_at_acceptance,
    'execution_status', at.execution_status,
    'execution_note', at.execution_note,
    'source', at.source,
    'action', at.action,
    'target_weight', at.target_weight,
    'target_shares', at.target_shares,
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

  SELECT COUNT(*)::int
  INTO v_linked_research_count
  FROM object_links ol
  WHERE ol.target_type = 'trade_idea'
    AND ol.target_id = p_decision_id;
  v_linked_research_count := COALESCE(v_linked_research_count, 0);

  -- CURRENT idea state. Kept deliberately and labelled as current by the
  -- caller. Not a fallback for recommendationVersion.
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
    'ideaExtras', v_idea_extras,
    'recommendationVersion', v_recommendation_version
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.decision_story_payload(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.decision_story_payload(uuid, uuid) IS
  'Outcomes detail pane. `recommendationVersion` is what was recommended (immutable, NULL before versioning). `ideaExtras` and `theses` are CURRENT idea state and must never be rendered as the basis of a past decision.';
