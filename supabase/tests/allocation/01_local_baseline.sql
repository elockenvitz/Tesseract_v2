-- Enough Supabase to run the allocation migrations on a bare Postgres.
--
-- The three allocation migrations depend on scaffolding that a plain Postgres
-- does not have: the `authenticated` and `anon` roles, `auth.uid()`, the
-- `organizations` / `users` / `organization_memberships` tables that
-- `current_org_id()` reads, and the seven tables from the 2025-11-27
-- framework migration.
--
-- Reproducing the whole repository migration history locally is not possible
-- without the Supabase stack, so this builds the minimum the allocation domain
-- actually touches, transcribed from the live catalog. That is a real
-- limitation and worth naming: this validates the allocation migrations
-- against a faithful model of their dependencies, not against a byte-identical
-- copy of production.
--
-- Everything here is scaffolding. The objects under test are created by the
-- migrations themselves.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Roles ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

-- ── auth.uid() ─────────────────────────────────────────────────────────────
-- Same contract as Supabase's: read `sub` out of the request JWT claims.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(
    current_setting('request.jwt.claims', true)::json ->> 'sub', ''
  )::uuid;
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ── Tenancy scaffolding ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  current_organization_id uuid REFERENCES organizations(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  is_org_admin boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

-- Transcribed from the live catalog, including the SECURITY DEFINER and the
-- pinned search_path, because 40_catalog asserts those properties.
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT u.current_organization_id
  FROM users u
  WHERE u.id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.user_id = u.id
        AND om.organization_id = u.current_organization_id
        AND om.status = 'active'
        AND (om.expires_at IS NULL OR om.expires_at > now())
    );
$$;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.stamp_organization_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := current_org_id();
  END IF;
  RETURN NEW;
END $$;

-- ── The 2025-11-27 allocation framework, as production has it ──────────────
-- Seven tables. `allocation_periods` already carries organization_id and its
-- org-scoped policies; the rest carry the permissive ones.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='allocation_view') THEN
    CREATE TYPE allocation_view AS ENUM
      ('strong_underweight','underweight','market_weight','overweight','strong_overweight');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='allocation_view_status') THEN
    CREATE TYPE allocation_view_status AS ENUM ('draft','active','archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='allocation_vote_type') THEN
    CREATE TYPE allocation_vote_type AS ENUM ('agree','disagree','abstain');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS asset_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  parent_id uuid REFERENCES asset_classes(id) ON DELETE SET NULL,
  color text DEFAULT '#3b82f6',
  icon text DEFAULT 'layers',
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allocation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status allocation_view_status DEFAULT 'draft',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS individual_allocation_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view allocation_view NOT NULL,
  rationale text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (period_id, asset_class_id, user_id)
);

CREATE TABLE IF NOT EXISTS allocation_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote allocation_vote_type NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (period_id, asset_class_id, user_id)
);

CREATE TABLE IF NOT EXISTS official_allocation_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  view allocation_view NOT NULL,
  rationale text,
  set_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (period_id, asset_class_id)
);

CREATE TABLE IF NOT EXISTS allocation_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid REFERENCES asset_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  reply_to uuid REFERENCES allocation_comments(id) ON DELETE CASCADE,
  is_pinned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allocation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  previous_view allocation_view,
  new_view allocation_view NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz DEFAULT now()
);

ALTER TABLE asset_classes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_periods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE individual_allocation_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_votes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE official_allocation_views   ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_comments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_history          ENABLE ROW LEVEL SECURITY;

-- The legacy policies, named exactly as production names them — the point of
-- the catalog-driven sweep in M3 is that these names are not guessable, so the
-- fixture must use the real ones for the sweep to be under test.
CREATE POLICY "Users can view asset classes"   ON asset_classes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert asset classes" ON asset_classes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update asset classes" ON asset_classes FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Org members can view allocation periods in current org"
  ON allocation_periods FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY "Org members can create allocation periods in current org"
  ON allocation_periods FOR INSERT WITH CHECK (organization_id = current_org_id());
CREATE POLICY "Org members can update allocation periods in current org"
  ON allocation_periods FOR UPDATE USING (organization_id = current_org_id());

CREATE POLICY "Users can view official views"   ON official_allocation_views FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert official views" ON official_allocation_views FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update official views" ON official_allocation_views FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Users can view all individual views" ON individual_allocation_views FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own views" ON individual_allocation_views FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own views" ON individual_allocation_views FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can delete own views" ON individual_allocation_views FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can view votes" ON allocation_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own votes" ON allocation_votes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own votes" ON allocation_votes FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can delete own votes" ON allocation_votes FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can view comments" ON allocation_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own comments" ON allocation_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own comments" ON allocation_comments FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can delete own comments" ON allocation_comments FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can view history" ON allocation_history FOR SELECT TO authenticated USING (true);

-- Triggers, including the two SECURITY DEFINER history writers that are the
-- reason allocation_history needs no INSERT policy.
DROP TRIGGER IF EXISTS trg_stamp_org_id ON allocation_periods;
CREATE TRIGGER trg_stamp_org_id BEFORE INSERT ON allocation_periods
  FOR EACH ROW EXECUTE FUNCTION stamp_organization_id();

CREATE OR REPLACE FUNCTION public.log_official_view_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO allocation_history (period_id, asset_class_id, previous_view, new_view, changed_by)
  VALUES (NEW.period_id, NEW.asset_class_id, NULL, NEW.view, NEW.set_by);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.log_official_view_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.view IS DISTINCT FROM NEW.view THEN
    INSERT INTO allocation_history (period_id, asset_class_id, previous_view, new_view, changed_by)
    VALUES (NEW.period_id, NEW.asset_class_id, OLD.view, NEW.view, NEW.set_by);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS official_view_insert_trigger ON official_allocation_views;
CREATE TRIGGER official_view_insert_trigger AFTER INSERT ON official_allocation_views
  FOR EACH ROW EXECUTE FUNCTION log_official_view_insert();

DROP TRIGGER IF EXISTS official_view_change_trigger ON official_allocation_views;
CREATE TRIGGER official_view_change_trigger AFTER UPDATE ON official_allocation_views
  FOR EACH ROW EXECUTE FUNCTION log_official_view_change();

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
