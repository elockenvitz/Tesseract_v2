-- Org admins should be able to act on decision requests in their org
-- regardless of portfolio_team / portfolio_memberships membership.
-- The pilot user is org admin of their pilot org but isn't seeded into
-- portfolio_memberships, so accept/reject of the seeded AAPL request
-- failed at the RLS layer (accepted_trades INSERT + trade_idea_portfolios
-- UPDATE both gate on portfolio membership).
--
-- Fix: extend the gating policies to also permit
--   `is_active_org_admin_of_current_org()` AND `portfolio_in_current_org()`
-- so an org admin retains full authority on portfolios in the org they
-- currently have selected. Cross-org isolation is preserved by the
-- portfolio_in_current_org() guard.

-- ============================================================
-- accepted_trades
-- ============================================================

DROP POLICY IF EXISTS "Portfolio members can insert accepted trades" ON accepted_trades;
CREATE POLICY "Portfolio members or org admins can insert accepted trades"
  ON accepted_trades FOR INSERT TO authenticated
  WITH CHECK (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Portfolio members can update accepted trades" ON accepted_trades;
CREATE POLICY "Portfolio members or org admins can update accepted trades"
  ON accepted_trades FOR UPDATE TO authenticated
  USING (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Portfolio members can delete accepted trades" ON accepted_trades;
CREATE POLICY "Portfolio members or org admins can delete accepted trades"
  ON accepted_trades FOR DELETE TO authenticated
  USING (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Accepted trades: org-scoped" ON accepted_trades;
CREATE POLICY "Accepted trades: org-scoped"
  ON accepted_trades FOR SELECT TO authenticated
  USING (
    portfolio_in_current_org(portfolio_id)
    AND (
      user_is_portfolio_member(portfolio_id)
      OR is_active_org_admin_of_current_org()
    )
  );

-- ============================================================
-- trade_idea_portfolios
-- ============================================================

DROP POLICY IF EXISTS "Users can view trade idea portfolios they have access to" ON trade_idea_portfolios;
CREATE POLICY "Trade idea portfolios: team or org admin"
  ON trade_idea_portfolios FOR SELECT TO authenticated
  USING (
    portfolio_id IN (
      SELECT pt.portfolio_id FROM portfolio_team pt WHERE pt.user_id = auth.uid()
    )
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Users can insert trade idea portfolios for their portfolios" ON trade_idea_portfolios;
CREATE POLICY "Trade idea portfolios: team or org admin insert"
  ON trade_idea_portfolios FOR INSERT TO authenticated
  WITH CHECK (
    portfolio_id IN (
      SELECT pt.portfolio_id FROM portfolio_team pt WHERE pt.user_id = auth.uid()
    )
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Users can update trade idea portfolios for their portfolios" ON trade_idea_portfolios;
CREATE POLICY "Trade idea portfolios: team or org admin update"
  ON trade_idea_portfolios FOR UPDATE TO authenticated
  USING (
    portfolio_id IN (
      SELECT pt.portfolio_id FROM portfolio_team pt WHERE pt.user_id = auth.uid()
    )
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Users can delete trade idea portfolios for their portfolios" ON trade_idea_portfolios;
CREATE POLICY "Trade idea portfolios: team or org admin delete"
  ON trade_idea_portfolios FOR DELETE TO authenticated
  USING (
    portfolio_id IN (
      SELECT pt.portfolio_id FROM portfolio_team pt WHERE pt.user_id = auth.uid()
    )
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );
