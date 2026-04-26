-- trade_idea_theses INSERT/SELECT/DELETE all gate on
-- user_is_portfolio_member of the parent trade_queue_item's portfolio
-- (or portfolio_id IS NULL). Same blocker for org admins as the other
-- portfolio-scoped tables. Extend with the org-admin-of-current-org
-- path so attaching a thesis to a pilot idea works.

DROP POLICY IF EXISTS "Portfolio members can view theses" ON trade_idea_theses;
CREATE POLICY "Portfolio members or org admins view theses" ON trade_idea_theses FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM trade_queue_items tqi
      WHERE tqi.id = trade_idea_theses.trade_queue_item_id
        AND (
          tqi.portfolio_id IS NULL
          OR user_is_portfolio_member(tqi.portfolio_id)
          OR (portfolio_in_current_org(tqi.portfolio_id) AND is_active_org_admin_of_current_org())
        )
    )
  );

DROP POLICY IF EXISTS "Portfolio members can add theses" ON trade_idea_theses;
CREATE POLICY "Portfolio members or org admins add theses" ON trade_idea_theses FOR INSERT TO public
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM trade_queue_items tqi
      WHERE tqi.id = trade_idea_theses.trade_queue_item_id
        AND (
          tqi.portfolio_id IS NULL
          OR user_is_portfolio_member(tqi.portfolio_id)
          OR (portfolio_in_current_org(tqi.portfolio_id) AND is_active_org_admin_of_current_org())
        )
    )
  );

DROP POLICY IF EXISTS "Authors and PMs can delete theses" ON trade_idea_theses;
CREATE POLICY "Authors, PMs, or org admins can delete theses" ON trade_idea_theses FOR DELETE TO public
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM trade_queue_items tqi
      WHERE tqi.id = trade_idea_theses.trade_queue_item_id
        AND tqi.portfolio_id IS NOT NULL
        AND (
          is_portfolio_pm(tqi.portfolio_id, auth.uid())
          OR (portfolio_in_current_org(tqi.portfolio_id) AND is_active_org_admin_of_current_org())
        )
    )
  );
