-- =============================================================================
-- Harness objects for the terms-acceptance lane
--
-- Loaded on top of 00-harness.sql. Adds only what
-- supabase/tests/terms-acceptances-tenant-isolation.sql needs and
-- 00-harness.sql does not already provide.
--
-- Every object here was copied from the LIVE catalogue on 2026-11-25 via
-- pg_get_functiondef() and information_schema.columns -- not from
-- supabase/migrations/, which does not describe production.
--
-- WHAT THIS ADDS, AND WHY EACH ONE IS NEEDED
--
--   organization_memberships.is_org_admin   00-harness.sql's copy of this
--                                           table has only (organization_id,
--                                           user_id, status, expires_at). The
--                                           admin read policy needs the admin
--                                           flag, and the live column is
--                                           `is_org_admin`, NOT `is_admin`.
--
--   is_member_of_org(uuid)                  Used by the RPC's authorization
--                                           check. Absent from 00-harness.sql
--                                           (10-decision-review-objects.sql
--                                           references it but does not define
--                                           it, so this lane must).
--
-- PRECONDITIONS
--
-- Fails loudly rather than quietly relaxing anything. A harness that relaxes
-- a constraint turns a real failure green, which is worse than no harness.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.organization_memberships') IS NULL THEN
    RAISE EXCEPTION 'precondition: public.organization_memberships is missing. Load 00-harness.sql first.';
  END IF;
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'precondition: public.organizations is missing. Load 00-harness.sql first.';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'precondition: auth.uid() is missing. Load 00-harness.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'precondition: role authenticated is missing. Load 00-harness.sql first.';
  END IF;
END
$$;

-- ─── The admin flag ─────────────────────────────────────────────────────────
--
-- Live shape: `is_org_admin boolean DEFAULT false` (nullable). Reproduced
-- exactly, nullable default included, because the predicate's correctness
-- depends on how a NULL behaves: `m.is_org_admin = true` is NULL for a NULL
-- column and therefore not true, which is the intended deny.

ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS is_org_admin boolean DEFAULT false;

-- ─── is_member_of_org(uuid) ─────────────────────────────────────────────────
--
-- Body copied verbatim from production. The `coalesce(m.status, 'active')`
-- matters: a membership row with a NULL status counts as active in
-- production, and a harness that treated NULL as inactive would make the
-- legitimate-member assertions fail for the wrong reason.

CREATE OR REPLACE FUNCTION public.is_member_of_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from organization_memberships m
     where m.organization_id = p_org_id
       and m.user_id = auth.uid()
       and coalesce(m.status, 'active') = 'active'
  );
$function$;

REVOKE ALL ON FUNCTION public.is_member_of_org(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_member_of_org(uuid) TO authenticated;

-- ─── Confirmation ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_memberships'
      AND column_name = 'is_org_admin'
  ) THEN
    RAISE EXCEPTION 'postcondition: is_org_admin was not added';
  END IF;
  IF to_regprocedure('public.is_member_of_org(uuid)') IS NULL THEN
    RAISE EXCEPTION 'postcondition: is_member_of_org(uuid) was not created';
  END IF;
  RAISE NOTICE 'terms-acceptance harness objects ready';
END
$$;
