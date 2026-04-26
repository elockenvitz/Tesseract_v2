-- accepted_trade_comments INSERT/SELECT both gate on
-- user_is_portfolio_member of the parent accepted_trade's portfolio.
-- Same blocker as trade_events / lab_variants for org admins posting
-- reflections in their org's pilot portfolio. Extend with the same
-- org-admin-of-current-org path.

DROP POLICY IF EXISTS "Users can insert own comments" ON accepted_trade_comments;
CREATE POLICY "Users can insert own comments" ON accepted_trade_comments FOR INSERT TO public
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM accepted_trades at
      WHERE at.id = accepted_trade_comments.accepted_trade_id
        AND (
          user_is_portfolio_member(at.portfolio_id)
          OR (portfolio_in_current_org(at.portfolio_id) AND is_active_org_admin_of_current_org())
        )
    )
  );

DROP POLICY IF EXISTS "Portfolio members can view comments" ON accepted_trade_comments;
CREATE POLICY "Portfolio members or org admins view comments" ON accepted_trade_comments FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM accepted_trades at
      WHERE at.id = accepted_trade_comments.accepted_trade_id
        AND (
          user_is_portfolio_member(at.portfolio_id)
          OR (portfolio_in_current_org(at.portfolio_id) AND is_active_org_admin_of_current_org())
        )
    )
  );
