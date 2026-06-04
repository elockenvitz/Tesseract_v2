-- Add organization_id to asset_lists, but with one twist: the two
-- system-seeded default lists per user (is_default=true: "Investment
-- Ideas" + "Work in Process") are deliberately user-level — they're
-- the default working space every user gets on signup, regardless of
-- which org they're currently in. So:
--   - is_default=true rows stay organization_id = NULL (cross-org visible)
--   - all other rows get stamped to the inserter's current org by the
--     BEFORE INSERT trigger
--   - read queries combine: (is_default = TRUE) OR (organization_id = X)
--
-- Pre-migration non-default rows stay NULL and become invisible until
-- the user attaches them to an org (we can't reconstruct the origin).

ALTER TABLE public.asset_lists
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_asset_lists_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  -- Default lists stay org-NULL on purpose — they're user-level globals.
  IF NEW.is_default IS TRUE THEN RETURN NEW; END IF;
  IF NEW.organization_id IS NOT NULL THEN RETURN NEW; END IF;
  IF v_caller IS NOT NULL THEN
    SELECT current_organization_id INTO NEW.organization_id
    FROM public.users WHERE id = v_caller;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_asset_lists_org_id_trigger ON public.asset_lists;
CREATE TRIGGER set_asset_lists_org_id_trigger
  BEFORE INSERT ON public.asset_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_asset_lists_org_id();

CREATE INDEX IF NOT EXISTS asset_lists_organization_id_idx
  ON public.asset_lists (organization_id);
