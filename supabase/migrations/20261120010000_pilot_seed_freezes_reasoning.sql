-- =============================================================================
-- The pilot seed created a decision request with nothing frozen behind it
--
-- THE DEFECT (measured in production, 2026-11-20)
--
--   `ensure_pilot_decision_request_for_user` inserts a `decision_requests` row
--   and leaves `proposal_version_id` NULL. Every other way a recommendation
--   reaches the Decision Inbox goes through `submitRecommendation`, which calls
--   `captureRecommendationVersion` first and FAILS the submission if the
--   version cannot be written -- "a submission that cannot say what it
--   recommended must fail rather than succeed into an unreconstructable
--   history". The seed is the one path that skips that step.
--
--   In the QA org provisioned for lifecycle validation, the seeded AAPL
--   request is the only one of four with no version:
--
--     AAPL  pending   proposal_version_id NULL   <- seeded
--     CRWD  rejected  -> v1                       <- submitted through the UI
--     META  deferred  -> v1
--     MSFT  accepted  -> v1
--
-- WHY IT MATTERS EVEN THOUGH PILOTS CANNOT ACT ON IT
--
--   `isPilotExampleRequest` marks every non-tutorial request as an EXAMPLE
--   while the pilot has not graduated, and nothing on an example can be
--   accepted, rejected, deferred or re-sized. So an ungraduated pilot is
--   protected.
--
--   That protection ends at graduation. `effectiveIsPilot` is
--   `hasGraduated ? false : isPilot`, so the moment a pilot graduates the
--   seeded request becomes a live, actionable decision whose reasoning was
--   never frozen. Accepting it writes an `accepted_trades` row descended from
--   a decision nobody can reconstruct. That was reproduced: graduating the QA
--   org turned the seeded AAPL request into an actionable row.
--
-- THE FIX
--
--   Freeze the reasoning in the same statement block that creates the request,
--   and link the two. plpgsql gives atomicity for free -- the function body is
--   one transaction, so either both rows exist or neither does, which is what
--   stops a failed seed leaving a misleading partial decision record.
--
--   The version is a GENUINE snapshot of what the seed actually proposes: the
--   scenario's own `why_now` text, its target weight, the proposal's sizing
--   context. It is not a retroactive reconstruction of anything. Nothing
--   historical is touched -- no backfill, no invented snapshot for the
--   requests that already exist without one. Those stay visibly unversioned,
--   which is the honest record.
--
--   `proposal_id` is NOT NULL on `trade_proposal_versions`, so a version
--   cannot exist without a proposal. If the scenario has no active proposal
--   the seed now creates NO decision request at all rather than an unversioned
--   one. A missing teaching example is a smaller harm than an unreconstructable
--   decision.
--
-- WHAT IS UNCHANGED
--
--   Authorization. Identity still comes from `auth.uid()` and never from the
--   `p_user_id` argument -- the argument remains accepted and ignored, exactly
--   as before, so a caller cannot seed a request for somebody else. The
--   scenario lookup is still filtered to `ps.user_id = v_actor`. SECURITY
--   DEFINER, the pinned `search_path`, and the existing duplicate guard from
--   20260425110000 all stay as they are.
--
--   Idempotency. The pre-existing early return on an existing request for the
--   same (trade_queue_item_id, portfolio_id) is untouched, so re-running the
--   seed still cannot produce a second request -- nor, now, a second version.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_pilot_decision_request_for_user(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scenario RECORD;
  v_existing_id UUID;
  v_new_id UUID;
  v_action TEXT;
  v_target_weight NUMERIC;
  v_proposal_id UUID;
  v_proposal_sizing JSONB;
  v_baseline_weight NUMERIC;
  v_actor UUID;
  v_org_id UUID;
  v_asset_id UUID;
  v_stage TEXT;
  v_notes TEXT;
  v_version_id UUID;
  v_next_version INTEGER;
BEGIN
  -- Identity comes from the session, not the argument.
  v_actor := auth.uid();
  IF v_actor IS NULL THEN RETURN NULL; END IF;

  -- org comes from `portfolios` below, not from the queue item: that is the
  -- same derivation `accepted_trades` uses, so a version cannot disagree with
  -- the trade descended from it.
  SELECT ps.*, tqi.action AS tqi_action, tqi.asset_id AS tqi_asset_id,
         tqi.stage::TEXT AS tqi_stage
    INTO v_scenario
  FROM public.pilot_scenarios ps
  JOIN public.trade_queue_items tqi ON tqi.id = ps.trade_queue_item_id
  WHERE ps.user_id = v_actor
    AND ps.status = 'active'
    AND ps.is_template = FALSE
    AND ps.trade_queue_item_id IS NOT NULL
    AND ps.portfolio_id IS NOT NULL
  ORDER BY ps.created_at DESC
  LIMIT 1;

  IF v_scenario.id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_existing_id
  FROM public.decision_requests
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id
    AND portfolio_id = v_scenario.portfolio_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;

  SELECT id, sizing_context INTO v_proposal_id, v_proposal_sizing
  FROM public.trade_proposals
  WHERE trade_queue_item_id = v_scenario.trade_queue_item_id
    AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 1;

  -- A version cannot exist without a proposal (proposal_id is NOT NULL), and a
  -- decision request must not exist without a version. So with no proposal to
  -- freeze against, seed nothing at all rather than something unreconstructable.
  IF v_proposal_id IS NULL THEN RETURN NULL; END IF;

  v_action := COALESCE(v_scenario.tqi_action::TEXT, 'buy');
  v_target_weight := v_scenario.target_weight_pct;
  v_baseline_weight := COALESCE(
    (v_proposal_sizing->>'current_weight_pct')::NUMERIC,
    0
  );
  v_asset_id := v_scenario.tqi_asset_id;
  v_stage := v_scenario.tqi_stage;
  v_notes := COALESCE(v_scenario.why_now, 'Pilot scenario recommendation.');

  SELECT organization_id INTO v_org_id
  FROM public.portfolios
  WHERE id = v_scenario.portfolio_id;

  -- Freeze the reasoning FIRST, so the decision request is never the row that
  -- exists alone. Same transaction either way; this only makes the ordering
  -- match the invariant.
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM public.trade_proposal_versions
  WHERE proposal_id = v_proposal_id;

  INSERT INTO public.trade_proposal_versions (
    proposal_id, version_number, weight, sizing_mode, sizing_context,
    notes, created_by, portfolio_id, organization_id, trade_queue_item_id,
    asset_id, submitted_at, action, idea_stage, captured_from
  ) VALUES (
    v_proposal_id, v_next_version, v_target_weight, 'weight',
    COALESCE(v_proposal_sizing, '{}'::jsonb),
    v_notes, v_actor, v_scenario.portfolio_id, v_org_id,
    v_scenario.trade_queue_item_id, v_asset_id, NOW(), v_action, v_stage,
    jsonb_build_object('source', 'pilot_seed', 'pilot_scenario_id', v_scenario.id)
  )
  RETURNING id INTO v_version_id;

  INSERT INTO public.decision_requests (
    trade_queue_item_id, requested_by, portfolio_id, urgency,
    context_note, status, requested_action, sizing_weight, sizing_mode,
    proposal_id, proposal_version_id, submission_snapshot
  ) VALUES (
    v_scenario.trade_queue_item_id, v_actor, v_scenario.portfolio_id,
    'medium', v_notes,
    'pending', v_action, v_target_weight, 'weight', v_proposal_id,
    v_version_id,
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
$function$;
