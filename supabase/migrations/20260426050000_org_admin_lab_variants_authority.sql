-- lab_variants RLS gated on portfolio_membership / collaborate_share —
-- blocked the org admin from creating/updating/deleting variants in
-- their own org's pilot portfolio. Extend with the same org-admin path
-- as trade_labs / accepted_trades.

DROP POLICY IF EXISTS lab_variants_select ON lab_variants;
CREATE POLICY lab_variants_select ON lab_variants FOR SELECT TO public
  USING (
    portfolio_in_current_org(portfolio_id)
    AND (
      user_is_portfolio_member(portfolio_id)
      OR user_has_live_portfolio_share(portfolio_id)
      OR is_active_org_admin_of_current_org()
    )
  );

DROP POLICY IF EXISTS lab_variants_insert ON lab_variants;
CREATE POLICY lab_variants_insert ON lab_variants FOR INSERT TO public
  WITH CHECK (
    user_is_portfolio_member(portfolio_id)
    OR user_has_collaborate_share(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS lab_variants_update ON lab_variants;
CREATE POLICY lab_variants_update ON lab_variants FOR UPDATE TO public
  USING (
    user_is_portfolio_member(portfolio_id)
    OR user_has_collaborate_share(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );

DROP POLICY IF EXISTS lab_variants_delete ON lab_variants;
CREATE POLICY lab_variants_delete ON lab_variants FOR DELETE TO public
  USING (
    user_is_portfolio_member(portfolio_id)
    OR user_has_collaborate_share(portfolio_id)
    OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
  );
