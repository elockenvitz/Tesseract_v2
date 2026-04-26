-- Single RPC that returns all data the Outcomes page needs in one
-- round-trip. Replaces 7 chained client-side queries
-- (decisions → events → rationales → prices → snapshots → accepted_trades)
-- with one call. Every inner SELECT runs through RLS as the calling
-- user, so visibility is identical to what the previous client-side
-- queries returned.
--
-- Shape of the return JSONB:
--   {
--     decisions: [...],
--     events: [...],
--     rationales: [...],
--     prices: [{id, current_price}],
--     snapshots: [{trade_queue_item_id, snapshot_price, snapshot_at}],
--     acceptedTrades: [{id, trade_queue_item_id, acceptance_note,
--                       price_at_acceptance, execution_status,
--                       execution_note, source, created_at,
--                       note_count, latest_note}]
--   }
--
-- The frontend hook (useDecisionAccountability) calls this once and
-- slices the payload into the same shapes the old per-table useQueries
-- returned, so consumers don't change.

CREATE OR REPLACE FUNCTION public.outcomes_payload(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_show_approved BOOLEAN := COALESCE((p_filters->>'showApproved')::boolean, TRUE);
  v_show_rejected BOOLEAN := COALESCE((p_filters->>'showRejected')::boolean, FALSE);
  v_show_cancelled BOOLEAN := COALESCE((p_filters->>'showCancelled')::boolean, FALSE);
  v_date_start TIMESTAMPTZ := COALESCE((p_filters->>'dateStart')::timestamptz, now() - interval '90 days');
  v_date_end TIMESTAMPTZ := COALESCE((p_filters->>'dateEnd')::timestamptz, now() + interval '1 day');
  v_portfolio_ids UUID[] := NULL;
  v_owner_ids UUID[] := NULL;
  v_statuses trade_queue_status[] := ARRAY[]::trade_queue_status[];
  v_decision_ids UUID[];
  v_asset_ids UUID[];
  v_portfolio_ids_decisions UUID[];
  v_event_ids UUID[];
  v_decisions JSONB;
  v_events JSONB;
  v_rationales JSONB;
  v_prices JSONB;
  v_snapshots JSONB;
  v_accepted_trades JSONB;
BEGIN
  IF p_filters ? 'portfolioIds' AND jsonb_array_length(p_filters->'portfolioIds') > 0 THEN
    SELECT array_agg(value::uuid) INTO v_portfolio_ids
    FROM jsonb_array_elements_text(p_filters->'portfolioIds');
  END IF;

  IF p_filters ? 'ownerUserIds' AND jsonb_array_length(p_filters->'ownerUserIds') > 0 THEN
    SELECT array_agg(value::uuid) INTO v_owner_ids
    FROM jsonb_array_elements_text(p_filters->'ownerUserIds');
  END IF;

  IF v_show_approved THEN
    v_statuses := array_cat(v_statuses, ARRAY['approved'::trade_queue_status, 'executed'::trade_queue_status]);
  END IF;
  IF v_show_rejected THEN
    v_statuses := array_append(v_statuses, 'rejected'::trade_queue_status);
  END IF;
  IF v_show_cancelled THEN
    v_statuses := array_append(v_statuses, 'cancelled'::trade_queue_status);
  END IF;
  IF array_length(v_statuses, 1) IS NULL THEN
    v_statuses := ARRAY['approved'::trade_queue_status, 'executed'::trade_queue_status];
  END IF;

  -- Decisions
  WITH d AS (
    SELECT
      tqi.id, tqi.created_at, tqi.approved_at, tqi.approved_by,
      tqi.portfolio_id, tqi.asset_id, tqi.action, tqi.urgency,
      tqi.status, tqi.rationale, tqi.visibility_tier, tqi.deleted_at,
      tqi.origin_metadata, tqi.created_by,
      jsonb_build_object('id', a.id, 'symbol', a.symbol, 'company_name', a.company_name) AS assets,
      jsonb_build_object('id', p.id, 'name', p.name) AS portfolios,
      CASE WHEN au.id IS NOT NULL THEN
        jsonb_build_object('id', au.id, 'email', au.email, 'first_name', au.first_name, 'last_name', au.last_name)
        ELSE NULL END AS approved_by_user,
      CASE WHEN cu.id IS NOT NULL THEN
        jsonb_build_object('id', cu.id, 'email', cu.email, 'first_name', cu.first_name, 'last_name', cu.last_name)
        ELSE NULL END AS created_by_user
    FROM trade_queue_items tqi
    LEFT JOIN assets a ON a.id = tqi.asset_id
    LEFT JOIN portfolios p ON p.id = tqi.portfolio_id
    LEFT JOIN users au ON au.id = tqi.approved_by
    LEFT JOIN users cu ON cu.id = tqi.created_by
    WHERE tqi.status = ANY(v_statuses)
      AND tqi.created_at >= v_date_start
      AND tqi.created_at <= v_date_end
      AND (v_portfolio_ids IS NULL OR tqi.portfolio_id = ANY(v_portfolio_ids))
      AND (v_owner_ids IS NULL OR tqi.created_by = ANY(v_owner_ids))
    ORDER BY tqi.approved_at DESC NULLS LAST, tqi.created_at DESC
  )
  SELECT jsonb_agg(to_jsonb(d.*)) INTO v_decisions FROM d;
  v_decisions := COALESCE(v_decisions, '[]'::jsonb);

  -- Derive id arrays
  SELECT array_agg(DISTINCT (decision->>'id')::uuid)
  INTO v_decision_ids
  FROM jsonb_array_elements(v_decisions) decision;

  SELECT array_agg(DISTINCT (decision->>'asset_id')::uuid)
  INTO v_asset_ids
  FROM jsonb_array_elements(v_decisions) decision
  WHERE decision->>'asset_id' IS NOT NULL;

  SELECT array_agg(DISTINCT (decision->>'portfolio_id')::uuid)
  INTO v_portfolio_ids_decisions
  FROM jsonb_array_elements(v_decisions) decision
  WHERE decision->>'portfolio_id' IS NOT NULL;

  -- Events (last 180d, scoped to decisions' portfolios)
  IF v_portfolio_ids_decisions IS NOT NULL AND array_length(v_portfolio_ids_decisions, 1) > 0 THEN
    WITH e AS (
      SELECT
        pte.id, pte.portfolio_id, pte.asset_id, pte.event_date,
        pte.action_type, pte.source_type, pte.quantity_delta, pte.weight_delta,
        pte.quantity_before, pte.quantity_after,
        pte.market_value_before, pte.market_value_after,
        pte.weight_before, pte.weight_after, pte.status,
        pte.linked_trade_idea_id, pte.linked_trade_sheet_id,
        jsonb_build_object('id', a.id, 'symbol', a.symbol, 'company_name', a.company_name) AS assets,
        jsonb_build_object('id', p.id, 'name', p.name) AS portfolios
      FROM portfolio_trade_events pte
      LEFT JOIN assets a ON a.id = pte.asset_id
      LEFT JOIN portfolios p ON p.id = pte.portfolio_id
      WHERE pte.portfolio_id = ANY(v_portfolio_ids_decisions)
        AND pte.event_date >= (now() - interval '180 days')::date
        AND pte.status::text != 'ignored'
      ORDER BY pte.event_date DESC
    )
    SELECT jsonb_agg(to_jsonb(e.*)) INTO v_events FROM e;

    SELECT array_agg(DISTINCT (event->>'id')::uuid)
    INTO v_event_ids
    FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) event;
  END IF;
  v_events := COALESCE(v_events, '[]'::jsonb);

  -- Rationales (latest per event)
  IF v_event_ids IS NOT NULL AND array_length(v_event_ids, 1) > 0 THEN
    SELECT jsonb_agg(jsonb_build_object(
      'trade_event_id', trade_event_id,
      'status', status,
      'reason_for_action', reason_for_action
    ))
    INTO v_rationales
    FROM (
      SELECT DISTINCT ON (trade_event_id) trade_event_id, status, reason_for_action
      FROM trade_event_rationales
      WHERE trade_event_id = ANY(v_event_ids)
      ORDER BY trade_event_id, version_number DESC
    ) latest;
  END IF;
  v_rationales := COALESCE(v_rationales, '[]'::jsonb);

  -- Asset prices
  IF v_asset_ids IS NOT NULL AND array_length(v_asset_ids, 1) > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('id', id, 'current_price', current_price))
    INTO v_prices
    FROM assets
    WHERE id = ANY(v_asset_ids) AND current_price IS NOT NULL;
  END IF;
  v_prices := COALESCE(v_prices, '[]'::jsonb);

  -- Snapshots
  IF v_decision_ids IS NOT NULL AND array_length(v_decision_ids, 1) > 0 THEN
    SELECT jsonb_agg(jsonb_build_object(
      'trade_queue_item_id', trade_queue_item_id,
      'snapshot_price', snapshot_price,
      'snapshot_at', snapshot_at
    ))
    INTO v_snapshots
    FROM decision_price_snapshots
    WHERE trade_queue_item_id = ANY(v_decision_ids)
      AND snapshot_type = 'approval';
  END IF;
  v_snapshots := COALESCE(v_snapshots, '[]'::jsonb);

  -- Accepted trades + note rollup (note_count, latest_note)
  IF v_decision_ids IS NOT NULL AND array_length(v_decision_ids, 1) > 0 THEN
    WITH at AS (
      SELECT
        at.id, at.trade_queue_item_id, at.acceptance_note,
        at.price_at_acceptance, at.execution_status, at.execution_note,
        at.source, at.created_at,
        (SELECT COUNT(*) FROM accepted_trade_comments c WHERE c.accepted_trade_id = at.id) AS note_count,
        (
          SELECT content FROM accepted_trade_comments c
          WHERE c.accepted_trade_id = at.id AND c.content IS NOT NULL AND btrim(c.content) <> ''
          ORDER BY c.created_at DESC LIMIT 1
        ) AS latest_note
      FROM accepted_trades at
      WHERE at.trade_queue_item_id = ANY(v_decision_ids)
        AND at.is_active = TRUE
    )
    SELECT jsonb_agg(to_jsonb(at.*)) INTO v_accepted_trades FROM at;
  END IF;
  v_accepted_trades := COALESCE(v_accepted_trades, '[]'::jsonb);

  RETURN jsonb_build_object(
    'decisions', v_decisions,
    'events', v_events,
    'rationales', v_rationales,
    'prices', v_prices,
    'snapshots', v_snapshots,
    'acceptedTrades', v_accepted_trades
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.outcomes_payload(jsonb) TO authenticated;
