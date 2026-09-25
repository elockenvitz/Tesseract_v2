-- The minimum faithful pre-Files baseline, for a disposable cluster.
--
-- ── Why this file exists ───────────────────────────────────────────────────
--
-- `supabase/migrations/` cannot be replayed onto an empty database. The
-- bedrock — `organizations`, `users`, `organization_memberships`, `assets`,
-- `projects`, the `auth` and `storage` schemas — predates the migration
-- directory and is defined nowhere in it. So a local validation of the Files
-- migrations has to start from a hand-built baseline.
--
-- That is a real limitation and worth stating plainly: this reproduces the
-- SHAPE the Files migrations depend on, transcribed from the live catalog on
-- 2026-09-25, not the whole production schema. It is enough to exercise the
-- Files tables, their policies, the storage policies and the adversarial
-- cases — and nothing beyond that should be inferred from a green run here.
--
-- What is faithful:
--   * `auth.uid()` reading a GUC, which is how Supabase resolves the caller
--   * `storage.objects` / `storage.buckets` with RLS and `foldername()`
--   * `organization_memberships` columns and status values, from the catalog
--   * `current_org_id()` verbatim from production
--   * `assets` having NO organization_id, which is the fact `file_links`
--     target validation turns on
--
-- What is not: every other table, every other policy, the real auth schema.

\set ON_ERROR_STOP on

-- ── Roles ──────────────────────────────────────────────────────────────────
-- First: every policy below is `TO authenticated`, and a policy cannot name a
-- role that does not exist yet.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

-- ── Schemas Supabase provides ──────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);

-- The caller. Supabase derives this from the JWT; here it comes from a GUC so
-- a test can impersonate by setting one, which is the same technique the
-- Allocation suite used.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- ── Tenancy bedrock ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organizations (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.users (
  id                      uuid PRIMARY KEY,
  email                   text,
  first_name              text,
  last_name               text,
  current_organization_id uuid REFERENCES public.organizations(id)
);

-- Columns and CHECK values transcribed from the live catalog.
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_org_admin    boolean DEFAULT false,
  status          text DEFAULT 'active',
  expires_at      timestamptz,
  role            text NOT NULL DEFAULT 'member',
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT chk_org_membership_status
    CHECK (status = ANY (ARRAY['active','inactive','invited','pending'])),
  CONSTRAINT organization_memberships_organization_id_user_id_key
    UNIQUE (organization_id, user_id)
);

-- Verbatim from 20260826100000_p0_current_org_id_validates_membership.sql.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.current_organization_id
  FROM users u
  WHERE u.id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM organization_memberships om
      WHERE om.user_id = u.id
        AND om.organization_id = u.current_organization_id
        AND om.status = 'active'
        AND (om.expires_at IS NULL OR om.expires_at > now())
    );
$$;

-- ── Link targets ───────────────────────────────────────────────────────────

-- `assets` is the shared security master and deliberately has NO
-- organization_id. Two firms researching the same ticker share this row —
-- which is exactly why `file_link_target_is_valid` validates an asset for
-- existence only and lets the FILE carry the tenancy.
CREATE TABLE IF NOT EXISTS public.assets (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  company_name text
);

CREATE TABLE IF NOT EXISTS public.projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  created_by      uuid REFERENCES public.users(id),
  deleted_at      timestamptz
);

-- ── Storage ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS storage.buckets (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  public boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  text REFERENCES storage.buckets(id),
  name       text NOT NULL,
  owner      uuid,
  created_at timestamptz DEFAULT now()
);

-- Supabase's own helper: splits a path into segments. The tenant boundary is
-- segment [1], so this is load-bearing for every storage policy.
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_to_array(name, '/');
$$;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ── The PRE-hardening assets policies ──────────────────────────────────────
--
-- Reproduced from 20251013115000 exactly as it stands, so the reconciliation
-- migration has the insecure state to actually remove. Without this the
-- reconciliation would pass by finding nothing, which proves nothing.

INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'assets');

CREATE POLICY "Authenticated users can read files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'assets');

CREATE POLICY "Users can update their own files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'assets' AND auth.uid() = owner);

CREATE POLICY "Users can delete their own files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'assets' AND auth.uid() = owner);

-- ── Grants ─────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth, storage TO authenticated, anon, service_role;
