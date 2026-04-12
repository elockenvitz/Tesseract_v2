-- ============================================================
-- Org Isolation RLS Hardening
-- ============================================================
--
-- PROBLEM: Multiple tables had SELECT policies that relied on
-- user-level checks (created_by, portfolio_member) without
-- verifying the data belongs to the user's current organization.
-- When a user belongs to multiple orgs, they could see data
-- from other orgs.
--
-- FIX: Add portfolio_in_current_org() guard to all portfolio-
-- linked tables. Fix analyst tables to use current_org_id()
-- instead of get_user_organization().
-- ============================================================

-- Helper function: check if a portfolio belongs to the current org
CREATE OR REPLACE FUNCTION portfolio_in_current_org(p_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM portfolios
    WHERE id = p_portfolio_id
      AND organization_id = current_org_id()
  );
$$;

-- ============================================================
-- 1. SIMULATIONS
-- ============================================================
DROP POLICY IF EXISTS "Drafts inherit view visibility" ON simulations;
CREATE POLICY "Simulations: org-scoped access" ON simulations FOR SELECT TO authenticated
USING (
  portfolio_in_current_org(portfolio_id)
  AND (
    (view_id IS NULL AND created_by = auth.uid())
    OR EXISTS (
      SELECT 1 FROM trade_lab_views v
      WHERE v.id = simulations.view_id
      AND (
        (v.view_type = 'private' AND v.owner_id = auth.uid())
        OR (v.view_type = 'shared' AND (v.owner_id = auth.uid() OR EXISTS (
          SELECT 1 FROM trade_lab_view_members vm WHERE vm.view_id = v.id AND vm.user_id = auth.uid()
        )))
        OR (v.view_type = 'portfolio' AND EXISTS (
          SELECT 1 FROM trade_labs tl JOIN portfolio_memberships pm ON pm.portfolio_id = tl.portfolio_id
          WHERE tl.id = v.lab_id AND pm.user_id = auth.uid()
        ))
      )
    )
    OR EXISTS (
      SELECT 1 FROM simulation_shares ss
      WHERE ss.simulation_id = simulations.id AND ss.shared_with = auth.uid()
        AND ss.share_mode = 'live' AND ss.revoked_at IS NULL
    )
  )
);

-- ============================================================
-- 2. TRADE_LABS
-- ============================================================
DROP POLICY IF EXISTS "trade_labs_select" ON trade_labs;
CREATE POLICY "trade_labs_select" ON trade_labs FOR SELECT TO authenticated
USING (
  portfolio_in_current_org(portfolio_id)
  AND (user_is_portfolio_member(portfolio_id) OR user_has_live_portfolio_share(portfolio_id))
);

-- ============================================================
-- 3. TRADE_QUEUE_ITEMS
-- ============================================================
DROP POLICY IF EXISTS "Users can view trade queue items" ON trade_queue_items;
CREATE POLICY "Trade queue: org-scoped access" ON trade_queue_items FOR SELECT TO authenticated
USING (
  portfolio_in_current_org(portfolio_id)
  AND (
    sharing_visibility IS DISTINCT FROM 'private'
    OR created_by = auth.uid()
    OR assigned_to = auth.uid()
  )
);

-- ============================================================
-- 4. TRADE_LAB_VIEWS
-- ============================================================
DROP POLICY IF EXISTS "Private views visible only to owner" ON trade_lab_views;
DROP POLICY IF EXISTS "Shared views visible to members" ON trade_lab_views;
DROP POLICY IF EXISTS "Portfolio views visible to portfolio members" ON trade_lab_views;

CREATE POLICY "Private views: org-scoped" ON trade_lab_views FOR SELECT TO authenticated
USING (
  view_type = 'private' AND owner_id = auth.uid()
  AND EXISTS (SELECT 1 FROM trade_labs tl WHERE tl.id = trade_lab_views.lab_id AND portfolio_in_current_org(tl.portfolio_id))
);

CREATE POLICY "Shared views: org-scoped" ON trade_lab_views FOR SELECT TO authenticated
USING (
  view_type = 'shared'
  AND (owner_id = auth.uid() OR EXISTS (SELECT 1 FROM trade_lab_view_members vm WHERE vm.view_id = trade_lab_views.id AND vm.user_id = auth.uid()))
  AND EXISTS (SELECT 1 FROM trade_labs tl WHERE tl.id = trade_lab_views.lab_id AND portfolio_in_current_org(tl.portfolio_id))
);

CREATE POLICY "Portfolio views: org-scoped" ON trade_lab_views FOR SELECT TO authenticated
USING (
  view_type = 'portfolio'
  AND EXISTS (
    SELECT 1 FROM trade_labs tl
    JOIN portfolio_memberships pm ON pm.portfolio_id = tl.portfolio_id
    WHERE tl.id = trade_lab_views.lab_id AND pm.user_id = auth.uid()
      AND portfolio_in_current_org(tl.portfolio_id)
  )
);

-- ============================================================
-- 5. WORKFLOW_TEMPLATES
-- ============================================================
DROP POLICY IF EXISTS "Users can view workflow templates they have access to" ON workflow_templates;
CREATE POLICY "Workflow templates: org-scoped" ON workflow_templates FOR SELECT TO authenticated
USING (
  workflow_id IN (
    SELECT id FROM workflows
    WHERE organization_id = current_org_id()
      AND (is_public = true OR created_by = auth.uid() OR id IN (
        SELECT workflow_id FROM workflow_collaborations WHERE user_id = auth.uid()
      ))
  )
);

-- ============================================================
-- 6. PORTFOLIO_HOLDINGS
-- ============================================================
DROP POLICY IF EXISTS "Users can read all portfolio holdings" ON portfolio_holdings;
CREATE POLICY "Portfolio holdings: org-scoped" ON portfolio_holdings FOR SELECT TO authenticated
USING (portfolio_in_current_org(portfolio_id));

-- ============================================================
-- 7. SIMULATION_TRADES
-- ============================================================
DROP POLICY IF EXISTS "Users can view simulation trades" ON simulation_trades;
DROP POLICY IF EXISTS "Users can view simulation trades they have access to" ON simulation_trades;
CREATE POLICY "Simulation trades: org-scoped" ON simulation_trades FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM simulations s
    WHERE s.id = simulation_trades.simulation_id
      AND portfolio_in_current_org(s.portfolio_id)
  )
);

DROP POLICY IF EXISTS "Users can delete simulation trades" ON simulation_trades;
CREATE POLICY "Simulation trades: org-scoped delete" ON simulation_trades FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM simulations s
    WHERE s.id = simulation_trades.simulation_id
      AND portfolio_in_current_org(s.portfolio_id)
  )
);

DROP POLICY IF EXISTS "Users can update simulation trades" ON simulation_trades;
CREATE POLICY "Simulation trades: org-scoped update" ON simulation_trades FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM simulations s
    WHERE s.id = simulation_trades.simulation_id
      AND portfolio_in_current_org(s.portfolio_id)
  )
);

-- ============================================================
-- 8. LAB_VARIANTS
-- ============================================================
DROP POLICY IF EXISTS "lab_variants_select" ON lab_variants;
CREATE POLICY "lab_variants_select" ON lab_variants FOR SELECT TO authenticated
USING (
  portfolio_in_current_org(portfolio_id)
  AND (user_is_portfolio_member(portfolio_id) OR user_has_live_portfolio_share(portfolio_id))
);

-- ============================================================
-- 9. ACCEPTED_TRADES
-- ============================================================
DROP POLICY IF EXISTS "Portfolio members can view accepted trades" ON accepted_trades;
CREATE POLICY "Accepted trades: org-scoped" ON accepted_trades FOR SELECT TO authenticated
USING (portfolio_in_current_org(portfolio_id) AND user_is_portfolio_member(portfolio_id));

-- ============================================================
-- 10. DECISION_REQUESTS
-- ============================================================
DROP POLICY IF EXISTS "decision_requests_select" ON decision_requests;
CREATE POLICY "Decision requests: org-scoped" ON decision_requests FOR SELECT TO authenticated
USING (
  portfolio_in_current_org(portfolio_id)
  AND EXISTS (
    SELECT 1 FROM portfolio_team pt
    WHERE pt.portfolio_id = decision_requests.portfolio_id AND pt.user_id = auth.uid()
  )
);

-- ============================================================
-- 11. ANALYST_RATINGS (fix get_user_organization → current_org_id)
-- ============================================================
DROP POLICY IF EXISTS "Users can read org ratings" ON analyst_ratings;
CREATE POLICY "Analyst ratings: org-scoped" ON analyst_ratings FOR SELECT TO authenticated
USING (
  user_id IN (
    SELECT om.user_id FROM organization_memberships om
    WHERE om.organization_id = current_org_id() AND om.status = 'active'
  )
);

-- ============================================================
-- 12. ANALYST_ESTIMATES
-- ============================================================
DROP POLICY IF EXISTS "Users can read org estimates" ON analyst_estimates;
CREATE POLICY "Analyst estimates: org-scoped" ON analyst_estimates FOR SELECT TO authenticated
USING (
  user_id IN (
    SELECT om.user_id FROM organization_memberships om
    WHERE om.organization_id = current_org_id() AND om.status = 'active'
  )
);

-- ============================================================
-- 13. PORTFOLIO_MEMBERSHIPS
-- ============================================================
DROP POLICY IF EXISTS "Users can view portfolio memberships in current org" ON portfolio_memberships;
CREATE POLICY "Portfolio memberships: org-scoped" ON portfolio_memberships FOR SELECT TO authenticated
USING (portfolio_in_current_org(portfolio_id));

-- ============================================================
-- 14. PORTFOLIO_TEAM
-- ============================================================
DROP POLICY IF EXISTS "read team" ON portfolio_team;
CREATE POLICY "Portfolio team: org-scoped read" ON portfolio_team FOR SELECT TO authenticated
USING (portfolio_in_current_org(portfolio_id));

DROP POLICY IF EXISTS "delete team" ON portfolio_team;
CREATE POLICY "Portfolio team: org-scoped delete" ON portfolio_team FOR DELETE TO authenticated
USING (portfolio_in_current_org(portfolio_id));

DROP POLICY IF EXISTS "update team" ON portfolio_team;
CREATE POLICY "Portfolio team: org-scoped update" ON portfolio_team FOR UPDATE TO authenticated
USING (portfolio_in_current_org(portfolio_id));

-- ============================================================
-- 15. PAIR_TRADES
-- ============================================================
DROP POLICY IF EXISTS "Users can view all pair trades" ON pair_trades;
CREATE POLICY "Pair trades: org-scoped read" ON pair_trades FOR SELECT TO authenticated
USING (portfolio_in_current_org(portfolio_id));

DROP POLICY IF EXISTS "Users can update pair trades" ON pair_trades;
CREATE POLICY "Pair trades: org-scoped update" ON pair_trades FOR UPDATE TO authenticated
USING (portfolio_in_current_org(portfolio_id));

DROP POLICY IF EXISTS "Users can delete pair trades" ON pair_trades;
CREATE POLICY "Pair trades: org-scoped delete" ON pair_trades FOR DELETE TO authenticated
USING (portfolio_in_current_org(portfolio_id));

-- ============================================================
-- 16. Add 'organization' to audit_events entity_type constraint
-- ============================================================
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS valid_entity_type;
ALTER TABLE audit_events ADD CONSTRAINT valid_entity_type CHECK (
  entity_type = ANY (ARRAY[
    'trade_idea', 'pair_trade', 'order', 'execution', 'asset', 'coverage',
    'portfolio', 'simulation', 'user', 'team', 'comment', 'attachment',
    'audit_explorer', 'lab_variant', 'trade_lab_view', 'layout_template',
    'organization'
  ])
);
