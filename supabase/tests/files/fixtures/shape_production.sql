-- Turn the baseline into the PRODUCTION shape, as read from the live catalog
-- on 2026-09-27.
--
-- `00_baseline.sql` reproduces the pre-Files world: the four legacy `assets`
-- policies from 20251013115000, and no tenancy helpers. That is the FRESH /
-- LEGACY shape, and it is what M1 State B and M2's create path are for.
--
-- Production is not that. It carries the four hardened policies and both
-- helpers already, which is precisely why M1 and M2 must do nothing there.
-- This fixture builds that second shape so the no-op can be PROVEN rather
-- than asserted in a commit message.
--
-- Two details are deliberate and load-bearing:
--
--   * The helpers are granted EXECUTE to PUBLIC, because production grants
--     it. Without that the "M2 preserves existing privileges" test would
--     pass against an ACL that never had the thing it must preserve.
--   * The hardened policies are written exactly as M1 writes them, so a
--     byte comparison of the deparsed catalog before and after M1 is
--     meaningful.

\set ON_ERROR_STOP on

BEGIN;

-- ── Replace the legacy four with the hardened four ─────────────────────────
DROP POLICY "Authenticated users can upload files" ON storage.objects;
DROP POLICY "Authenticated users can read files"   ON storage.objects;
DROP POLICY "Users can update their own files"     ON storage.objects;
DROP POLICY "Users can delete their own files"     ON storage.objects;

CREATE POLICY "assets: read within current org"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
);

CREATE POLICY "assets: upload within current org"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
);

CREATE POLICY "assets: update own files within current org"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND owner = auth.uid()
);

CREATE POLICY "assets: delete own files within current org"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'assets'
  AND (storage.foldername(name))[1] = current_org_id()::text
  AND owner = auth.uid()
);

-- ── The helpers, exactly as production has them ────────────────────────────
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

-- Production's ACL: EXECUTE to PUBLIC survives on both helpers. Postgres
-- grants EXECUTE to PUBLIC by default on CREATE FUNCTION, so this is really
-- an assertion that nothing here revoked it — stated explicitly so the
-- fixture's intent survives someone "tidying" it.
GRANT EXECUTE ON FUNCTION public.is_active_member_of_current_org() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_org_admin_of_current_org() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_member_of_current_org() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_org_admin_of_current_org() TO anon, authenticated, service_role;

-- current_org_id() does NOT carry PUBLIC in production. Mirrored so the
-- asymmetry the deferred security item describes is present here too.
REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO anon, authenticated, service_role;

COMMIT;
