-- ============================================================================
-- P0 — Layer A: current_org_id() must validate active membership
-- ============================================================================
--
-- THE BYPASS
--
-- `current_org_id()` returned `users.current_organization_id` verbatim:
--
--     SELECT current_organization_id FROM users WHERE id = auth.uid();
--
-- Nothing validated that the caller was actually a member of that org. That
-- column is an ordinary table column, `authenticated` held UPDATE on it, and
-- the `Users can update their own profile` policy places no restriction on
-- WHICH columns may change. So one PostgREST call against your own row —
--
--     PATCH /rest/v1/users?id=eq.<self>  {"current_organization_id": "<victim>"}
--
-- — moved you into another tenant, and the 186 RLS policies across 69 tables
-- that trust `current_org_id()` then authorised the reads.
--
-- The other two layers (column grants, write guard) close the write. This one
-- closes the READ, and it is the layer that matters most, because it is the
-- only one that also fixes the case where the column is already wrong:
--
--   * a membership revoked while `current_organization_id` still points at it
--     — offboarding previously did not revoke data access at all;
--   * a membership expired via `expires_at`;
--   * any row written before this migration by a direct DB edit or an
--     out-of-band script.
--
-- After this, a stale or forged value resolves to NULL rather than to a
-- foreign organization.
--
-- WHY NULL IS SAFE FOR EVERY CONSUMER
--
-- Audited against production: 186 policies on 69 tables reference
-- `current_org_id()`, directly or through `portfolio_in_current_org()`,
-- `is_active_member_of_current_org()` and `is_active_org_admin_of_current_org()`.
-- Every one of them consumes it in one of two shapes:
--
--     organization_id = current_org_id()
--     EXISTS (SELECT 1 FROM ... WHERE organization_id = current_org_id())
--
-- Both are NULL — and therefore NOT TRUE, and therefore denied — when the
-- function returns NULL. Verified absent across all 186: `IS NOT DISTINCT
-- FROM` (0), an explicit `current_org_id() IS NULL` test (0), and COALESCE
-- around the call (0). Any of those three would have turned a NULL into an
-- open door; none exist. This fails closed.
--
-- 21 policies additionally admit rows via `organization_id IS NULL`. That is
-- pre-existing behaviour about un-stamped rows and is unchanged here — those
-- rows were already visible regardless of the caller's org.
--
-- WHY IT STAYS SECURITY DEFINER
--
-- Not optional. `users` has a SELECT policy that itself calls
-- `current_org_id()`; as SECURITY INVOKER this function would re-enter that
-- policy and recurse. As DEFINER it runs as `postgres`, which owns `users` and
-- `organization_memberships` — neither of which sets FORCE ROW LEVEL SECURITY
-- — so the owner bypasses RLS and the read is direct. `search_path` stays
-- pinned to `public` for the same reason it was pinned before.
--
-- WHY expires_at IS CHECKED
--
-- `is_active_member_of_current_org()` already honours it, so omitting it here
-- would leave two functions disagreeing about what "active" means. No
-- production membership currently sets `expires_at` (0 of 31), so this is
-- inert today and correct the moment it is used. Note that `set_current_org()`
-- does NOT check expiry — that asymmetry is deliberate and safe in this
-- direction: a caller may select an org whose membership later expires, and
-- the next read then resolves to NULL and denies. Fail closed.
-- ============================================================================

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

COMMENT ON FUNCTION public.current_org_id() IS
  'The caller''s current organization, or NULL when they hold no active '
  'membership in it. Never returns an org the caller is not currently a '
  'member of, so a stale or forged users.current_organization_id fails '
  'closed. See migration 20260826100000.';

-- ----------------------------------------------------------------------------
-- EXECUTE grants
--
-- The implicit PUBLIC grant goes: it hands the function to every present and
-- future role, including any added later by an extension or by Supabase, and
-- nothing needs it.
--
-- `anon` is kept deliberately, and this is the one place where keeping a
-- broader grant is the safer choice. Many policies are declared `TO public`
-- and are therefore evaluated for `anon` on unauthenticated requests. With
-- EXECUTE revoked those evaluations raise `permission denied for function
-- current_org_id` — a 500 on the login page — instead of returning no rows.
-- With it kept, `auth.uid()` is NULL for anon, the function returns NULL, and
-- every org policy denies. Same security outcome, no error surface.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO anon, authenticated, service_role;
