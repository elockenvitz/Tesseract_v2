-- =============================================================================
-- C1/03 — theme_assets tenant boundary
--
-- Before: SELECT `USING (true)`; INSERT `WITH CHECK (auth.uid() = added_by)`.
--
-- That INSERT policy is the live write defect. It asks only "are you claiming
-- to be yourself?", which every caller can satisfy, and says nothing about
-- whose theme is being written to. **Any authenticated user could add an asset
-- to any organization's theme**, and the row would look legitimately authored.
-- The named requirement is that this is refused even when added_by = auth.uid(),
-- so the org predicate is ANDed onto INSERT, not merely onto the read.
--
-- Authority: theme_id -> themes.organization_id. Measured total on production:
-- 0 dangling, 0 parent-without-org, theme_id NOT NULL, themes.organization_id
-- NOT NULL. EXISTS, no denormalisation.
--
-- `added_by = auth.uid()` is KEPT on UPDATE/DELETE. It is not a tenant boundary
-- and never was, but it is the existing per-user semantic — you tidy up your own
-- theme memberships — and removing it here would be an unrelated behaviour
-- change smuggled into a security fix.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users can read all theme-asset relationships"           ON public.theme_assets;
DROP POLICY IF EXISTS "Users can create theme-asset relationships"             ON public.theme_assets;
DROP POLICY IF EXISTS "Users can update their own theme-asset relationships"   ON public.theme_assets;
DROP POLICY IF EXISTS "Users can delete their own theme-asset relationships"   ON public.theme_assets;

-- Replay-safety: these files must be re-runnable against an already
-- remediated database, so the new policy names are dropped as well as the
-- old ones. Without this a second run fails on "policy already exists".
DROP POLICY IF EXISTS theme_assets_select ON public.theme_assets;
DROP POLICY IF EXISTS theme_assets_insert ON public.theme_assets;
DROP POLICY IF EXISTS theme_assets_update ON public.theme_assets;
DROP POLICY IF EXISTS theme_assets_delete ON public.theme_assets;
CREATE POLICY theme_assets_select ON public.theme_assets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.themes t
                  WHERE t.id = theme_assets.theme_id
                    AND t.organization_id = public.current_org_id()));

CREATE POLICY theme_assets_insert ON public.theme_assets
  FOR INSERT TO authenticated
  WITH CHECK (added_by = auth.uid()
              AND EXISTS (SELECT 1 FROM public.themes t
                           WHERE t.id = theme_assets.theme_id
                             AND t.organization_id = public.current_org_id()));

CREATE POLICY theme_assets_update ON public.theme_assets
  FOR UPDATE TO authenticated
  USING (added_by = auth.uid()
         AND EXISTS (SELECT 1 FROM public.themes t
                      WHERE t.id = theme_assets.theme_id
                        AND t.organization_id = public.current_org_id()))
  WITH CHECK (added_by = auth.uid()
              AND EXISTS (SELECT 1 FROM public.themes t
                           WHERE t.id = theme_assets.theme_id
                             AND t.organization_id = public.current_org_id()));

CREATE POLICY theme_assets_delete ON public.theme_assets
  FOR DELETE TO authenticated
  USING (added_by = auth.uid()
         AND EXISTS (SELECT 1 FROM public.themes t
                      WHERE t.id = theme_assets.theme_id
                        AND t.organization_id = public.current_org_id()));

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='theme_assets'
     AND (qual = 'true' OR with_check = 'true');
  IF n > 0 THEN RAISE EXCEPTION 'C1/03: % unconditional policy/policies remain', n; END IF;

  -- The specific defect: INSERT must mention themes, not only added_by.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='theme_assets' AND cmd='INSERT'
     AND with_check LIKE '%themes%';
  IF n <> 1 THEN RAISE EXCEPTION 'C1/03: INSERT policy does not consult themes'; END IF;
END $$;

COMMIT;
