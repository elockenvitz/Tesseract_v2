-- Capture the two tenancy helpers Files V1 depends on.
--
-- ── Why ────────────────────────────────────────────────────────────────────
--
-- `is_active_member_of_current_org()` and
-- `is_active_org_admin_of_current_org()` exist in production and are
-- referenced by 6 and 19 migrations respectively — but NO migration defines
-- either one. They predate the migration directory. The same is true of
-- `organization_memberships`, `organizations` and `users`, which is why the
-- migration set as a whole cannot be replayed onto an empty database today.
--
-- Files V1's RLS calls both: membership for every read, admin for the archive
-- override. A Files migration that passes only because production happens to
-- contain undocumented functions is not a migration anybody can validate, so
-- the two it needs are captured here.
--
-- Deliberately narrow. `is_platform_admin()`, `set_current_org()`,
-- `resolve_entity_org()` and the membership tables are equally undocumented
-- and equally absent, and are NOT reconstructed here — Files does not call
-- them, and reconstructing production schema this lane does not need is how a
-- reconciliation turns into a rewrite.
--
-- `CREATE OR REPLACE` with bodies transcribed from the live catalog on
-- 2026-09-25, so applying this to production replaces each function with an
-- identical definition: a no-op. Against a fresh database it supplies what
-- the rest of the directory has been assuming all along.
--
-- Both are SECURITY DEFINER with a pinned search_path, matching the live
-- definitions and the reason `current_org_id()` gives for needing it: the
-- `users` SELECT policy itself calls these, so a SECURITY INVOKER function
-- would re-enter the policy and recurse.

BEGIN;

-- Active membership of the caller's CURRENT organisation.
--
-- Transcribed verbatim from production. Note it checks `expires_at`, which
-- `is_active_org_admin_of_current_org()` below does not — that asymmetry is
-- production's, and is preserved rather than quietly corrected. Changing it
-- would alter the meaning of 6 migrations' worth of existing policies, which
-- is not this lane's decision to make.
CREATE OR REPLACE FUNCTION public.is_active_member_of_current_org()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = current_org_id()
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

-- Active org-admin of the caller's CURRENT organisation.
--
-- Transcribed verbatim from production, including the absent `expires_at`
-- term noted above.
CREATE OR REPLACE FUNCTION public.is_active_org_admin_of_current_org()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = current_org_id()
      AND status = 'active'
      AND is_org_admin = true
  );
$$;

-- Same grant shape `current_org_id()` uses. `anon` keeps EXECUTE for the
-- reason given in 20260826100000: revoking it turns `TO public` policies into
-- 500s on the login page instead of empty result sets.
REVOKE ALL ON FUNCTION public.is_active_member_of_current_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_org_admin_of_current_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_member_of_current_org() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_org_admin_of_current_org() TO anon, authenticated, service_role;

COMMIT;
