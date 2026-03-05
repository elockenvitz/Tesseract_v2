-- 1. Add organization_id to portfolios (nullable initially for backfill)
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

-- 2. Backfill organization_id from teams table where team_id is set
UPDATE portfolios p
SET organization_id = t.organization_id
FROM teams t
WHERE p.team_id = t.id
  AND p.organization_id IS NULL;

-- 3. Backfill remaining portfolios from created_by user's current org
UPDATE portfolios p
SET organization_id = u.current_organization_id
FROM users u
WHERE p.created_by = u.id
  AND p.organization_id IS NULL
  AND u.current_organization_id IS NOT NULL;

-- 4. Create portfolio_team_links join table (portfolio <-> org chart team nodes)
CREATE TABLE IF NOT EXISTS portfolio_team_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  team_node_id uuid NOT NULL REFERENCES org_chart_nodes(id) ON DELETE CASCADE,
  is_lead boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (portfolio_id, team_node_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_team_links_portfolio ON portfolio_team_links(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_team_links_team_node ON portfolio_team_links(team_node_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_organization_id ON portfolios(organization_id);

-- 5. Enable RLS on portfolio_team_links
ALTER TABLE portfolio_team_links ENABLE ROW LEVEL SECURITY;

-- Read: any org member can view links in their org
CREATE POLICY "Org members can view portfolio team links"
  ON portfolio_team_links FOR SELECT
  USING (organization_id = current_org_id());

-- Insert: only org admins or coverage admins
CREATE POLICY "Org admins can insert portfolio team links"
  ON portfolio_team_links FOR INSERT
  WITH CHECK (
    organization_id = current_org_id()
    AND (
      is_active_org_admin_of_current_org()
      OR EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid() AND coverage_admin = true
      )
    )
  );

-- Update: only org admins or coverage admins
CREATE POLICY "Org admins can update portfolio team links"
  ON portfolio_team_links FOR UPDATE
  USING (
    organization_id = current_org_id()
    AND (
      is_active_org_admin_of_current_org()
      OR EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid() AND coverage_admin = true
      )
    )
  );

-- Delete: only org admins or coverage admins
CREATE POLICY "Org admins can delete portfolio team links"
  ON portfolio_team_links FOR DELETE
  USING (
    organization_id = current_org_id()
    AND (
      is_active_org_admin_of_current_org()
      OR EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid() AND coverage_admin = true
      )
    )
  );

-- 6. Tighten portfolio INSERT policy: only org admins or coverage admins can create
DROP POLICY IF EXISTS "Org members can create portfolios in current org" ON portfolios;

CREATE POLICY "Admins can create portfolios in current org"
  ON portfolios FOR INSERT
  WITH CHECK (
    (
      -- Portfolio org must match current org (when organization_id is set)
      (organization_id IS NOT NULL AND organization_id = current_org_id())
      OR
      -- Legacy: team_id based org check
      (team_id IN (SELECT id FROM teams WHERE organization_id = current_org_id()))
      OR
      -- Null team_id with org membership
      (team_id IS NULL AND organization_id IS NULL)
    )
    AND (
      is_active_org_admin_of_current_org()
      OR EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid() AND coverage_admin = true
      )
    )
  );

-- 7. Update SELECT policy to also check organization_id
DROP POLICY IF EXISTS "Org members can view portfolios in current org" ON portfolios;

CREATE POLICY "Org members can view portfolios in current org"
  ON portfolios FOR SELECT
  USING (
    (organization_id = current_org_id())
    OR
    (team_id IN (SELECT id FROM teams WHERE organization_id = current_org_id()))
    OR
    (team_id IS NULL AND organization_id IS NULL AND EXISTS (
      SELECT 1 FROM organization_memberships
      WHERE organization_id = current_org_id()
        AND user_id = auth.uid()
        AND status = 'active'
    ))
  );

-- 8. Update UPDATE policy to also check organization_id
DROP POLICY IF EXISTS "Org members can update portfolios in current org" ON portfolios;

CREATE POLICY "Org members can update portfolios in current org"
  ON portfolios FOR UPDATE
  USING (
    (organization_id = current_org_id())
    OR
    (team_id IN (SELECT id FROM teams WHERE organization_id = current_org_id()))
    OR
    (team_id IS NULL AND organization_id IS NULL AND EXISTS (
      SELECT 1 FROM organization_memberships
      WHERE organization_id = current_org_id()
        AND user_id = auth.uid()
        AND status = 'active'
    ))
  );

-- 9. Update DELETE policy to also check organization_id
DROP POLICY IF EXISTS "Org members can delete portfolios in current org" ON portfolios;

CREATE POLICY "Org members can delete portfolios in current org"
  ON portfolios FOR DELETE
  USING (
    (
      (organization_id = current_org_id())
      OR
      (team_id IN (SELECT id FROM teams WHERE organization_id = current_org_id()))
      OR
      (team_id IS NULL AND organization_id IS NULL AND EXISTS (
        SELECT 1 FROM organization_memberships
        WHERE organization_id = current_org_id()
          AND user_id = auth.uid()
          AND status = 'active'
      ))
    )
    AND created_by = auth.uid()
  );
