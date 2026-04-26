-- Trade Lab access for org admins: when an org admin opens Trade Lab
-- on a portfolio in their org, the existing RLS blocked SELECT/INSERT
-- because they aren't necessarily a portfolio_membership member. The
-- SimulationPage auto-create path is gated on `tradeLab` being defined,
-- so the workbench simulation never spawned and the holdings table came
-- up empty even though portfolio_holdings is populated.
--
-- Fix: mirror the "org admins can act in their org" broadening already
-- applied to accepted_trades / trade_idea_portfolios. Cross-org isolation
-- preserved by `portfolio_in_current_org()`.

DROP POLICY IF EXISTS trade_labs_select ON trade_labs;
CREATE POLICY trade_labs_select ON trade_labs FOR SELECT TO public
  USING (
    portfolio_in_current_org(portfolio_id)
    AND (
      user_is_portfolio_member(portfolio_id)
      OR user_has_live_portfolio_share(portfolio_id)
      OR is_active_org_admin_of_current_org()
    )
  );

DROP POLICY IF EXISTS trade_labs_insert ON trade_labs;
CREATE POLICY trade_labs_insert ON trade_labs FOR INSERT TO public
  WITH CHECK (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS trade_labs_update ON trade_labs;
CREATE POLICY trade_labs_update ON trade_labs FOR UPDATE TO public
  USING (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );
