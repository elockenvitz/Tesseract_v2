-- Minimum faithful baseline for the ops client-detail RPCs, on a
-- disposable cluster.
--
-- `supabase/migrations/` cannot be replayed onto an empty database —
-- organizations, users and organization_memberships have no CREATE TABLE
-- anywhere in the directory. So this reproduces the SHAPE the ops functions
-- depend on, transcribed from the live catalog, and nothing beyond it should
-- be inferred from a green run here.
--
-- What is faithful: auth.uid() reading a GUC the way Supabase resolves the
-- caller, platform_admins and is_platform_admin() verbatim from production,
-- and organization_id on every activity table the RPC reads.

\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

-- How Supabase resolves the caller: a request-scoped GUC, not a session user.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  current_organization_id uuid REFERENCES public.organizations(id)
);

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  status text NOT NULL DEFAULT 'active',
  is_org_admin boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  UNIQUE (user_id, organization_id)
);

-- The roster is the whole of platform-admin authority.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Verbatim from production.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;

-- ── Activity tables, with the columns the RPC attributes on ────────────────
-- organization_id is NULLABLE on every one of them, on purpose: the
-- unattributed row is the case that produced the bug.

CREATE TABLE IF NOT EXISTS public.portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.asset_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  created_by uuid REFERENCES public.users(id),
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.analyst_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  user_id uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quick_thoughts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  created_by uuid REFERENCES public.users(id),
  idea_type text,
  is_archived boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  user_id uuid REFERENCES public.users(id),
  duration_seconds integer,
  started_at timestamptz NOT NULL DEFAULT now()
);

-- Supabase grants these to the API roles; without them `authenticated`
-- cannot even resolve auth.uid(), and the suite fails on plumbing rather
-- than on anything it means to assert.
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
