-- trade_batches RLS gated on portfolio_membership only — blocked org
-- admins from executing trades in their own org's pilot portfolio.
-- Mirror the pattern applied to trade_labs / lab_variants /
-- accepted_trades.

DROP POLICY IF EXISTS "Portfolio members can view trade batches" ON trade_batches;
CREATE POLICY "Trade batches: members or org admins view" ON trade_batches FOR SELECT TO public
  USING (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Portfolio members can insert trade batches" ON trade_batches;
CREATE POLICY "Trade batches: members or org admins insert" ON trade_batches FOR INSERT TO public
  WITH CHECK (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS "Portfolio members can update trade batches" ON trade_batches;
CREATE POLICY "Trade batches: members or org admins update" ON trade_batches FOR UPDATE TO public
  USING (
    user_is_portfolio_member(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );
