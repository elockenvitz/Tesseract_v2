-- ============================================================================
-- Org-scope price_targets and analyst_price_targets.
--
-- Background
-- ----------
-- Both tables had `SELECT USING (true)` policies, so any user could read
-- every row regardless of org. Pilot users opening AAPL saw price targets
-- (and bull/base/bear scenarios) authored by users in the developer's
-- Tesseract org — there was no real way for the pilot org to have those.
--
-- Fix
-- ---
-- 1. Add `organization_id` to both tables (referencing organizations).
-- 2. Backfill from the creator's `users.current_organization_id` (the
--    only signal we have for which org the row was created in).
-- 3. BEFORE INSERT trigger fills `organization_id = current_org_id()`
--    when not provided, so existing frontend code keeps working without
--    every insert call having to add the column explicitly.
-- 4. Replace the global SELECT policies with org-scoped ones.
-- 5. Tighten INSERT/UPDATE policies to require the row's org matches.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema: add organization_id columns
-- ----------------------------------------------------------------------------

ALTER TABLE public.price_targets
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE public.analyst_price_targets
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_price_targets_organization_id
  ON public.price_targets(organization_id);
CREATE INDEX IF NOT EXISTS idx_analyst_price_targets_organization_id
  ON public.analyst_price_targets(organization_id);

-- ----------------------------------------------------------------------------
-- 2. Backfill from the creator's current_organization_id
-- ----------------------------------------------------------------------------

UPDATE public.price_targets pt
   SET organization_id = u.current_organization_id
  FROM public.users u
 WHERE u.id = pt.created_by
   AND pt.organization_id IS NULL
   AND u.current_organization_id IS NOT NULL;

UPDATE public.analyst_price_targets apt
   SET organization_id = u.current_organization_id
  FROM public.users u
 WHERE u.id = apt.user_id
   AND apt.organization_id IS NULL
   AND u.current_organization_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. BEFORE INSERT trigger to default organization_id from current_org_id().
--    Lets existing frontend insert calls keep working unchanged — the
--    column gets populated server-side at insert time.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_price_target_org_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := current_org_id();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS price_targets_set_org_id ON public.price_targets;
CREATE TRIGGER price_targets_set_org_id
  BEFORE INSERT ON public.price_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_price_target_org_id();

DROP TRIGGER IF EXISTS analyst_price_targets_set_org_id ON public.analyst_price_targets;
CREATE TRIGGER analyst_price_targets_set_org_id
  BEFORE INSERT ON public.analyst_price_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_price_target_org_id();

-- ----------------------------------------------------------------------------
-- 4. Replace SELECT policies with org-scoped versions.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can read all price targets" ON public.price_targets;
DROP POLICY IF EXISTS "Org members can view price targets" ON public.price_targets;
CREATE POLICY "Org members can view price targets" ON public.price_targets
  FOR SELECT USING (
    is_active_member_of_current_org()
    AND organization_id = current_org_id()
  );

DROP POLICY IF EXISTS "Users can view all price targets" ON public.analyst_price_targets;
DROP POLICY IF EXISTS "Org members can view analyst price targets" ON public.analyst_price_targets;
CREATE POLICY "Org members can view analyst price targets" ON public.analyst_price_targets
  FOR SELECT USING (
    is_active_member_of_current_org()
    AND organization_id = current_org_id()
  );

-- ----------------------------------------------------------------------------
-- 5. Tighten INSERT/UPDATE policies so users can't write rows targeted at
--    another org. The trigger already fills organization_id when null, so
--    the check matches as long as the user is in the org they're writing
--    in.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can create price targets" ON public.price_targets;
CREATE POLICY "Users can create price targets" ON public.price_targets
  FOR INSERT WITH CHECK (
    auth.uid() = created_by
    AND is_active_member_of_current_org()
    AND (organization_id IS NULL OR organization_id = current_org_id())
  );

DROP POLICY IF EXISTS "Users can update their own price targets" ON public.price_targets;
CREATE POLICY "Users can update their own price targets" ON public.price_targets
  FOR UPDATE USING (auth.uid() = created_by AND organization_id = current_org_id())
              WITH CHECK (auth.uid() = created_by AND organization_id = current_org_id());

DROP POLICY IF EXISTS "Users can delete their own price targets" ON public.price_targets;
CREATE POLICY "Users can delete their own price targets" ON public.price_targets
  FOR DELETE USING (auth.uid() = created_by AND organization_id = current_org_id());

DROP POLICY IF EXISTS "Users can create their own price targets" ON public.analyst_price_targets;
CREATE POLICY "Users can create their own price targets" ON public.analyst_price_targets
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND is_active_member_of_current_org()
    AND (organization_id IS NULL OR organization_id = current_org_id())
  );

DROP POLICY IF EXISTS "Users can update their own price targets" ON public.analyst_price_targets;
CREATE POLICY "Users can update their own price targets" ON public.analyst_price_targets
  FOR UPDATE USING (auth.uid() = user_id AND organization_id = current_org_id())
              WITH CHECK (auth.uid() = user_id AND organization_id = current_org_id());

DROP POLICY IF EXISTS "Users can delete their own price targets" ON public.analyst_price_targets;
CREATE POLICY "Users can delete their own price targets" ON public.analyst_price_targets
  FOR DELETE USING (auth.uid() = user_id AND organization_id = current_org_id());
