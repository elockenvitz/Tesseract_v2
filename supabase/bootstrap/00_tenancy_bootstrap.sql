-- Minimal tenancy bootstrap, for a REVIEW database only.
--
-- ══════════════════════════════════════════════════════════════════════════
-- READ THIS BEFORE RUNNING IT ANYWHERE
--
-- This file is NOT a migration and must never be applied to production. It
-- lives outside supabase/migrations/ deliberately so that `db push` cannot
-- pick it up. Production already has these objects; running this there would
-- attempt to recreate tables that hold real rows.
--
-- It exists because of a defect this lane documented and did not cause:
-- `organizations`, `organization_memberships` and `users` have NO CREATE
-- TABLE in any of the 305 migrations. They predate the migration directory.
-- The practical consequence is that the migration set cannot be replayed onto
-- an empty database, so there is no way to stand up a review environment from
-- the repo alone — which is exactly what blocked Files V1 review.
--
-- ── What this is, and what it is not ──────────────────────────────────────
--
-- It is the smallest set of objects Files V1's RLS actually calls, so that
-- the Files page can be exercised end to end on a scratch project. It is a
-- REVIEW SCAFFOLD, not a reconstruction of production: column sets are
-- minimal, and anything Files does not touch is absent. Do not treat a
-- database built from this as evidence about production's schema, and do not
-- grow it into a shadow copy of production — that is how a scaffold becomes a
-- second, wrong source of truth.
--
-- Contains no production data. Only structure, plus whatever you seed.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── organizations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── users ─────────────────────────────────────────────────────────────────
-- Mirrors auth.users by id, which is the shape the app assumes everywhere:
-- `auth.uid()` is joined straight against `public.users.id`.
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  first_name text,
  last_name text,
  -- The durable tenant pointer current_org_id() reads.
  current_organization_id uuid REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── organization_memberships ──────────────────────────────────────────────
-- Column set driven by what the three helpers below actually read:
-- user_id, organization_id, status, expires_at, is_org_admin.
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  is_org_admin boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

-- ── current_org_id() ──────────────────────────────────────────────────────
-- Transcribed from migration 20260826100000, which defines it against the
-- tables above. SECURITY DEFINER with a pinned search_path: the `users`
-- SELECT policy calls this, so a SECURITY INVOKER function would re-enter
-- the policy and recurse.
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

REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO anon, authenticated, service_role;

-- ── RLS on the scaffold tables ────────────────────────────────────────────
-- On by default, the same posture as production. A review database with RLS
-- off would make every Files tenancy assertion vacuous — the exact failure
-- mode the Files test suite exists to rule out.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_self ON public.users;
CREATE POLICY users_select_self ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS memberships_select_self ON public.organization_memberships;
CREATE POLICY memberships_select_self ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_memberships om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

-- ── the assets bucket ─────────────────────────────────────────────────────
-- Files V1 reuses the existing private `assets` bucket rather than adding
-- one. Created private here to match; the Files storage migration adds the
-- policies that govern it.
INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
