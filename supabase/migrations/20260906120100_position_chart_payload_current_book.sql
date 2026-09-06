-- ============================================================
-- position_chart_payload: one book for the numerator and the denominator
-- ============================================================
--
-- ── The defect ────────────────────────────────────────────────────────────
--
-- The function built a position's share of its book out of two different
-- books:
--
--   currentHolding   SELECT ... FROM portfolio_holdings
--                    WHERE portfolio_id = ? AND asset_id = ?
--                    ORDER BY date DESC LIMIT 1        -- newest row, correct
--
--   portfolioAum     SELECT SUM(shares * price) FROM portfolio_holdings
--                    WHERE portfolio_id = ?            -- EVERY date, summed
--
-- portfolio_holdings is UNIQUE (portfolio_id, asset_id, date). A book that
-- has been written on more than one date carries one row per asset per date,
-- so the unconstrained SUM counts every superseded snapshot of a position as
-- another live position. This is the same collapse that inflated
-- usePortfolioLenses by up to 36x, one table over, in SQL rather than
-- TypeScript — which is exactly why holdings-collapse-audit.mjs never saw it.
-- That guard walked .ts and .tsx only. It now reads SQL as well; see
-- scripts/holdings-collapse-audit.mjs.
--
-- Measured in production on 2026-09-06:
--
--   Vision Fund 10K          reported $199,462,674 against a real $101,461,674
--   Tech & Consumer Growth   1.108x
--   Tech & Consumer Growth   1.071x
--
-- Every weight the position lifecycle chart and the Decision Accountability
-- page derive from portfolioAum on those books is wrong by that factor — and
-- wrong in the safe-looking direction, because a position that is really 4%
-- of the book simply renders as 2%.
--
-- ── The fix ───────────────────────────────────────────────────────────────
--
-- Reduce to the newest row per asset BEFORE summing, which is the same rule
-- the numerator already applies to its one asset, and the same rule
-- currentRows() applies in src/lib/portfolio/holdings.ts. Numerator and
-- denominator now describe the same set of positions.
--
-- DISTINCT ON (asset_id) ... ORDER BY asset_id, date DESC is the direct
-- translation of currentRows: newest date wins, and because the table's
-- unique key includes date there can be at most one row per asset per date,
-- so the choice is deterministic without a tiebreak.
--
-- NULLS LAST matches currentRows' rule that a row with no date loses to any
-- row that has one.
--
-- ── Deliberately unchanged ────────────────────────────────────────────────
--
-- This is the reader-side hotfix, not the working-book migration. The table
-- keeps its date column and its three-part unique key; nothing here assumes
-- one row per (portfolio, asset). When that contract lands, the DISTINCT ON
-- becomes redundant rather than wrong, and can be deleted with the rest of
-- the reduction helpers.
--
-- Everything else in the function is byte-identical to the deployed
-- definition. Only the currentHolding and portfolioAum selects moved.
-- ============================================================

CREATE OR REPLACE FUNCTION public.position_chart_payload(
  p_asset_id uuid,
  p_portfolio_id uuid,
  p_symbol text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

  SELECT jsonb_build_object(
    'id', a.id, 'symbol', a.symbol, 'company_name', a.company_name,
    'current_price', a.current_price
  ) INTO v_asset
  FROM assets a
  WHERE a.id = p_asset_id;

  SELECT jsonb_build_object('id', p.id, 'name', p.name) INTO v_portfolio
  FROM portfolios p
  WHERE p.id = p_portfolio_id;

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

  IF p_symbol IS NOT NULL AND length(p_symbol) > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('date', ph.date, 'close', ph.close) ORDER BY ph.date ASC)
    INTO v_price_history
    FROM price_history_cache ph
    WHERE ph.symbol = p_symbol;
  END IF;
  v_price_history := COALESCE(v_price_history, '[]'::jsonb);

  -- The current line: newest row for this asset in this book.
  -- holdings-audit: safe — reduced to the newest row per asset below.
  SELECT jsonb_build_object(
    'shares', ph.shares,
    'price', ph.price,
    'date', ph.date
  ) INTO v_current_holding
  FROM portfolio_holdings ph
  WHERE ph.portfolio_id = p_portfolio_id
    AND ph.asset_id = p_asset_id
  ORDER BY ph.date DESC NULLS LAST
  LIMIT 1;

  -- The book this line is a share OF: the newest row per asset, summed once.
  -- Previously an unconstrained SUM over every date, which counted each
  -- superseded snapshot as another position.
  -- holdings-audit: safe — DISTINCT ON reduces to the newest row per asset.
  SELECT COALESCE(SUM(COALESCE(cur.shares, 0) * COALESCE(cur.price, 0)), 0)
  INTO v_portfolio_aum
  FROM (
    SELECT DISTINCT ON (ph.asset_id) ph.asset_id, ph.shares, ph.price
    FROM portfolio_holdings ph
    WHERE ph.portfolio_id = p_portfolio_id
    ORDER BY ph.asset_id, ph.date DESC NULLS LAST
  ) cur;

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
