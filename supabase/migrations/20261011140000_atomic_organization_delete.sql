-- ============================================================================
-- Atomic organization deletion.
--
-- The defect
-- ----------
-- `src/pages/ops/OpsSettingsPage.tsx` deleted an organization in two
-- statements, with no transaction, and never checked the first result:
--
--     await supabase.from('organization_memberships').delete().eq('organization_id', orgId)
--     const { error } = await supabase.from('organizations').delete().eq('id', orgId)
--     if (error) throw error
--
-- PostgREST gives each statement its own transaction, so when the second one
-- failed the first had already committed. Every failed delete attempt
-- destroyed the organization's memberships and left the organization standing.
--
-- It fired in production: `Daniel Adam Capital` ended up with zero memberships
-- and still existed. Nobody was stranded only because that user held other
-- active memberships. On an organization that was someone's ONLY membership
-- the same click locks them out permanently — `current_org_id()` requires an
-- active membership, so they reach "Access Required" with no route back and no
-- UI to restore it.
--
-- The membership delete was never needed in the first place:
-- `organization_memberships.organization_id` is already `ON DELETE CASCADE`.
--
-- The fix
-- -------
-- One RPC, one statement, one transaction. A plpgsql function body runs inside
-- the caller's transaction, so if anything downstream raises — a `NO ACTION`
-- foreign key, or a trigger such as the coverage notification emitter — the
-- whole delete rolls back and the memberships survive.
--
-- Authorization is NOT widened
-- ----------------------------
-- The existing policy is
--   "Platform admins can delete organizations"  DELETE  USING (is_platform_admin())
-- `SECURITY DEFINER` bypasses RLS, so this function re-checks
-- `is_platform_admin()` explicitly and raises `42501` otherwise. The set of
-- callers who can delete an organization is exactly what it was.
--
-- `SECURITY DEFINER` is required rather than cosmetic: the cascade reaches
-- ~60 tables whose own policies would otherwise each have to permit the
-- caller's delete. The authorization decision is made once, at the top, on the
-- same predicate the table policy already used.
--
-- RLS posture: unchanged. No policy, grant, column or table is altered. One
-- function is added, and it narrows nothing and widens nothing.
-- ============================================================================

-- Returns the deleted organization's id rather than void: it gives the caller
-- something to assert on, and a void-returning RPC does not resolve cleanly
-- against supabase-js's `rpc` overloads in `src/types/database.ts`.
CREATE OR REPLACE FUNCTION public.delete_organization(p_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
BEGIN
  -- Same predicate as the DELETE policy on `organizations`. Checked explicitly
  -- because SECURITY DEFINER bypasses RLS.
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only a platform admin may delete an organization'
      USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM organizations WHERE id = p_organization_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Organization % does not exist', p_organization_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ONE statement. `organization_memberships.organization_id` is ON DELETE
  -- CASCADE, so memberships go with the organization. The client must NOT
  -- delete them separately — doing so is what left a shell organization behind
  -- on every failure.
  DELETE FROM organizations WHERE id = p_organization_id;

  RETURN p_organization_id;
END;
$function$;

COMMENT ON FUNCTION public.delete_organization(uuid) IS
  'Deletes an organization and everything cascading from it, atomically. '
  'Requires is_platform_admin(), the same predicate as the DELETE policy on '
  'organizations. If any cascade step raises, the whole delete rolls back and '
  'memberships survive — which the previous two-statement client path could '
  'not guarantee.';

-- Only logged-in callers may invoke it; the function itself then decides.
REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_organization(uuid) TO authenticated;
