-- Trade Lab Execute → Outcomes "awaiting execution" forever, plus
-- post-execute Trade Lab reload getting wedged.
--
-- Root cause: portfolio_trade_events INSERT/SELECT/UPDATE/DELETE all
-- gate on user_is_portfolio_member, and portfolio_holdings UPDATE/DELETE
-- gate on auth.uid() = created_by. When an org admin executes a paper
-- trade in their org's pilot portfolio, emitPaperTradeEvent silently
-- fails (try/catch swallows it) and applyTradeToHoldings can't update
-- the system-seeded holding row. Outcomes never sees the execution
-- because matching keys off portfolio_trade_events.linked_trade_idea_id;
-- Trade Lab refetch on the same simulation hits the inconsistent
-- holdings/trades state.
--
-- Fix: extend the policies with the same org-admin path as trade_labs /
-- accepted_trades / lab_variants. Backfill any accepted_trade on a
-- paper/manual_eod portfolio that completed but never got an event row
-- written because of the prior denial.

DROP POLICY IF EXISTS trade_events_select ON portfolio_trade_events;
CREATE POLICY trade_events_select ON portfolio_trade_events FOR SELECT TO public
  USING (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS trade_events_insert ON portfolio_trade_events;
CREATE POLICY trade_events_insert ON portfolio_trade_events FOR INSERT TO public
  WITH CHECK (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS trade_events_update ON portfolio_trade_events;
CREATE POLICY trade_events_update ON portfolio_trade_events FOR UPDATE TO public
  USING (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS trade_events_delete ON portfolio_trade_events;
CREATE POLICY trade_events_delete ON portfolio_trade_events FOR DELETE TO public
  USING (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Users can update their own portfolio holdings" ON portfolio_holdings;
CREATE POLICY "Portfolio holdings: owner or org admin update" ON portfolio_holdings FOR UPDATE TO public
  USING (
    auth.uid() = created_by
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  )
  WITH CHECK (
    auth.uid() = created_by
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Users can delete their own portfolio holdings" ON portfolio_holdings;
CREATE POLICY "Portfolio holdings: owner or org admin delete" ON portfolio_holdings FOR DELETE TO public
  USING (
    auth.uid() = created_by
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

INSERT INTO portfolio_trade_events (
  portfolio_id, asset_id, event_date, action_type, source_type,
  quantity_delta, weight_delta, status, linked_trade_idea_id
)
SELECT
  at.portfolio_id,
  at.asset_id,
  COALESCE(at.execution_completed_at, at.created_at)::date,
  (CASE
    WHEN at.action IN ('buy','add') THEN 'add'
    WHEN at.action IN ('sell','trim') THEN 'reduce'
    ELSE 'other'
  END)::trade_event_action,
  'holdings_diff'::trade_event_source,
  COALESCE(at.delta_shares, 0),
  COALESCE(at.delta_weight, 0),
  'complete'::trade_event_status,
  at.trade_queue_item_id
FROM accepted_trades at
JOIN portfolios p ON p.id = at.portfolio_id
WHERE at.execution_status = 'complete'
  AND at.trade_queue_item_id IS NOT NULL
  AND p.holdings_source IN ('manual_eod', 'paper')
  AND NOT EXISTS (
    SELECT 1 FROM portfolio_trade_events pte
    WHERE pte.linked_trade_idea_id = at.trade_queue_item_id
  );
