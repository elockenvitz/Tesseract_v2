-- Single RPC backing the Outcomes chart panel. Replaces three parallel
-- hook fetches (usePositionLifecycle, usePositionPriceHistory,
-- useHoldingsTimeSeries — each with multiple supabase reads of their
-- own) with one round-trip so the price line and shares overlay land
-- together. Previously the price line painted first and the shares
-- overlay layered in noticeably afterward; this collapses that into a
-- single resolution.
--
-- Returns JSONB:
--   {
--     decisions:        [...],   -- raw trade_queue_items rows for this asset+portfolio
--     events:           [...],   -- raw portfolio_trade_events rows
--     asset:            {...},   -- assets row (symbol, company_name, current_price)
--     portfolio:        {...},   -- portfolios row (name)
--     snapshots:        [...],   -- decision_price_snapshots for this asset
--     priceHistory:     [...],   -- {date, close} from price_history_cache (may be empty;
--                                --  client falls back to Yahoo and writes back)
--     currentHolding:   {...},   -- {shares, price, date} for asset in this portfolio
--     portfolioAum:     <num>,   -- summed market value across all holdings (for weight overlay)
--     holdingsEvents:   [...]    -- {event_date, quantity_delta} subset for the share replay
--   }
--
-- Visibility runs through RLS as the calling user (SECURITY INVOKER).

CREATE OR REPLACE FUNCTION public.position_chart_payload(
  p_asset_id uuid,
  p_portfolio_id uuid,
  p_symbol text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_decisions JSONB;
  v_events JSONB;
  v_asset JSONB;
  v_portfolio JSONB;
  v_snapshots JSONB;
  v_price_history JSONB;
  v_current_holding JSONB;
  v_portfolio_aum NUMERIC;
  v_holdings_events JSONB;
BEGIN
  IF p_asset_id IS NULL OR p_portfolio_id IS NULL THEN
    RETURN jsonb_build_object(
      'decisions', '[]'::jsonb,
      'events', '[]'::jsonb,
      'asset', NULL,
      'portfolio', NULL,
      'snapshots', '[]'::jsonb,
      'priceHistory', '[]'::jsonb,
      'currentHolding', NULL,
      'portfolioAum', 0,
      'holdingsEvents', '[]'::jsonb
    );
  END IF;

  -- Decisions (status filter mirrors usePositionLifecycle's IN clause)
  WITH d AS (
    SELECT
      tqi.id, tqi.created_at, tqi.approved_at, tqi.action, tqi.status,
      tqi.visibility_tier, tqi.deleted_at,
      tqi.proposed_shares, tqi.proposed_weight,
      CASE WHEN cu.id IS NOT NULL THEN
        jsonb_build_object('first_name', cu.first_name, 'last_name', cu.last_name)
        ELSE NULL END AS created_by_user
    FROM trade_queue_items tqi
    LEFT JOIN users cu ON cu.id = tqi.created_by
    WHERE tqi.asset_id = p_asset_id
      AND tqi.portfolio_id = p_portfolio_id
      AND tqi.status IN ('approved', 'executed', 'rejected', 'cancelled')
    ORDER BY tqi.approved_at ASC NULLS LAST, tqi.created_at ASC
  )
  SELECT jsonb_agg(to_jsonb(d.*)) INTO v_decisions FROM d;
  v_decisions := COALESCE(v_decisions, '[]'::jsonb);

  -- Events (full payload for lifecycle compute)
  WITH e AS (
    SELECT
      pte.id, pte.event_date, pte.action_type, pte.source_type,
      pte.quantity_delta, pte.quantity_before, pte.quantity_after,
      pte.market_value_before, pte.market_value_after,
      pte.linked_trade_idea_id,
      CASE WHEN cu.id IS NOT NULL THEN
        jsonb_build_object('first_name', cu.first_name, 'last_name', cu.last_name)
        ELSE NULL END AS created_by_user
    FROM portfolio_trade_events pte
    LEFT JOIN users cu ON cu.id = pte.created_by
    WHERE pte.asset_id = p_asset_id
      AND pte.portfolio_id = p_portfolio_id
    ORDER BY pte.event_date ASC
  )
  SELECT jsonb_agg(to_jsonb(e.*)) INTO v_events FROM e;
  v_events := COALESCE(v_events, '[]'::jsonb);

  -- Holdings-events subset (for share-replay overlay)
  SELECT jsonb_agg(jsonb_build_object(
    'event_date', pte.event_date,
    'quantity_delta', pte.quantity_delta
  ) ORDER BY pte.event_date ASC)
  INTO v_holdings_events
  FROM portfolio_trade_events pte
  WHERE pte.asset_id = p_asset_id
    AND pte.portfolio_id = p_portfolio_id
    AND pte.event_date IS NOT NULL;
  v_holdings_events := COALESCE(v_holdings_events, '[]'::jsonb);

  -- Asset
  SELECT jsonb_build_object(
    'id', a.id, 'symbol', a.symbol, 'company_name', a.company_name,
    'current_price', a.current_price
  ) INTO v_asset
  FROM assets a
  WHERE a.id = p_asset_id;

  -- Portfolio
  SELECT jsonb_build_object('id', p.id, 'name', p.name) INTO v_portfolio
  FROM portfolios p
  WHERE p.id = p_portfolio_id;

  -- Snapshots
  SELECT jsonb_agg(jsonb_build_object(
    'trade_queue_item_id', dps.trade_queue_item_id,
    'snapshot_price', dps.snapshot_price,
    'snapshot_at', dps.snapshot_at
  ))
  INTO v_snapshots
  FROM decision_price_snapshots dps
  WHERE dps.asset_id = p_asset_id
    AND dps.snapshot_type = 'approval';
  v_snapshots := COALESCE(v_snapshots, '[]'::jsonb);

  -- Price history (cache-only — Yahoo fallback handled client-side
  -- because Postgres can't make outbound HTTPS calls without an
  -- extension). On a cold cache the client paints with empty price
  -- and refetches from Yahoo, then writes back.
  IF p_symbol IS NOT NULL AND length(p_symbol) > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('date', ph.date, 'close', ph.close) ORDER BY ph.date ASC)
    INTO v_price_history
    FROM price_history_cache ph
    WHERE ph.symbol = p_symbol;
  END IF;
  v_price_history := COALESCE(v_price_history, '[]'::jsonb);

  -- Current holding row (most recent for this asset in this portfolio)
  SELECT jsonb_build_object(
    'shares', ph.shares,
    'price', ph.price,
    'date', ph.date
  ) INTO v_current_holding
  FROM portfolio_holdings ph
  WHERE ph.portfolio_id = p_portfolio_id
    AND ph.asset_id = p_asset_id
  ORDER BY ph.date DESC
  LIMIT 1;

  -- Portfolio AUM (sum across all holdings — used for weight overlay
  -- denominator in useHoldingsTimeSeries)
  SELECT COALESCE(SUM(COALESCE(ph.shares, 0) * COALESCE(ph.price, 0)), 0)
  INTO v_portfolio_aum
  FROM portfolio_holdings ph
  WHERE ph.portfolio_id = p_portfolio_id;

  RETURN jsonb_build_object(
    'decisions', v_decisions,
    'events', v_events,
    'asset', v_asset,
    'portfolio', v_portfolio,
    'snapshots', v_snapshots,
    'priceHistory', v_price_history,
    'currentHolding', v_current_holding,
    'portfolioAum', v_portfolio_aum,
    'holdingsEvents', v_holdings_events
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.position_chart_payload(uuid, uuid, text) TO authenticated;
