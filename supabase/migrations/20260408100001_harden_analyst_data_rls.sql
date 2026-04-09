-- ============================================================
-- Harden Analyst Data RLS — Org-Scoped Data Isolation
-- ============================================================
--
-- PROBLEM: analyst_ratings, analyst_estimates, and their history tables
-- have no RLS enabled. Any authenticated user can read/write all analyst
-- data across all organizations.
--
-- FIX: Add organization_id columns, backfill from user's org membership,
-- enable RLS, and create org-scoped policies.
-- ============================================================

-- ============================================================
-- 1. analyst_ratings — add org_id, enable RLS
-- ============================================================

ALTER TABLE analyst_ratings
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill from user's org membership
UPDATE analyst_ratings r
SET organization_id = om.organization_id
FROM organization_memberships om
WHERE r.user_id = om.user_id
  AND om.status = 'active'
  AND r.organization_id IS NULL;

-- For any remaining NULLs, try user's current_organization_id
UPDATE analyst_ratings r
SET organization_id = u.current_organization_id
FROM users u
WHERE r.user_id = u.id
  AND r.organization_id IS NULL
  AND u.current_organization_id IS NOT NULL;

-- Allow NULL for now (legacy data without org context)
-- New inserts will require org_id via the INSERT policy

ALTER TABLE analyst_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analyst ratings: org members can read"
  ON analyst_ratings FOR SELECT TO authenticated
  USING (
    organization_id IS NULL  -- Legacy data visible to all (temporary)
    OR organization_id = current_org_id()
  );

CREATE POLICY "Analyst ratings: org members can insert"
  ON analyst_ratings FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY "Analyst ratings: owner can update"
  ON analyst_ratings FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND (organization_id IS NULL OR organization_id = current_org_id())
  );

CREATE POLICY "Analyst ratings: owner can delete"
  ON analyst_ratings FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND (organization_id IS NULL OR organization_id = current_org_id())
  );

CREATE INDEX IF NOT EXISTS idx_analyst_ratings_org
  ON analyst_ratings(organization_id);

-- ============================================================
-- 2. analyst_estimates — add org_id, enable RLS
-- ============================================================

ALTER TABLE analyst_estimates
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill from user's org membership
UPDATE analyst_estimates e
SET organization_id = om.organization_id
FROM organization_memberships om
WHERE e.user_id = om.user_id
  AND om.status = 'active'
  AND e.organization_id IS NULL;

-- Fallback to user's current_organization_id
UPDATE analyst_estimates e
SET organization_id = u.current_organization_id
FROM users u
WHERE e.user_id = u.id
  AND e.organization_id IS NULL
  AND u.current_organization_id IS NOT NULL;

ALTER TABLE analyst_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analyst estimates: org members can read"
  ON analyst_estimates FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id = current_org_id()
  );

CREATE POLICY "Analyst estimates: org members can insert"
  ON analyst_estimates FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY "Analyst estimates: owner can update"
  ON analyst_estimates FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND (organization_id IS NULL OR organization_id = current_org_id())
  );

CREATE POLICY "Analyst estimates: owner can delete"
  ON analyst_estimates FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND (organization_id IS NULL OR organization_id = current_org_id())
  );

CREATE INDEX IF NOT EXISTS idx_analyst_estimates_org
  ON analyst_estimates(organization_id);

-- ============================================================
-- 3. analyst_estimate_history — enable RLS
-- ============================================================
-- History tables inherit org scope via their parent FK.
-- We add RLS that joins through to the parent's org.

ALTER TABLE analyst_estimate_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Estimate history: readable via parent estimate"
  ON analyst_estimate_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM analyst_estimates e
      WHERE e.id = analyst_estimate_history.estimate_id
        AND (e.organization_id IS NULL OR e.organization_id = current_org_id())
    )
  );

CREATE POLICY "Estimate history: insertable via parent estimate"
  ON analyst_estimate_history FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM analyst_estimates e
      WHERE e.id = analyst_estimate_history.estimate_id
        AND e.organization_id = current_org_id()
    )
  );

-- ============================================================
-- 4. analyst_rating_history — enable RLS
-- ============================================================

ALTER TABLE analyst_rating_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Rating history: readable via parent rating"
  ON analyst_rating_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM analyst_ratings r
      WHERE r.id = analyst_rating_history.rating_id
        AND (r.organization_id IS NULL OR r.organization_id = current_org_id())
    )
  );

CREATE POLICY "Rating history: insertable via parent rating"
  ON analyst_rating_history FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM analyst_ratings r
      WHERE r.id = analyst_rating_history.rating_id
        AND r.organization_id = current_org_id()
    )
  );
