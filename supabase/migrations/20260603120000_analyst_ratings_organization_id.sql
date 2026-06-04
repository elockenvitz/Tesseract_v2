-- Add canonical organization_id to analyst_ratings. Same pattern as the
-- 20260603020000_trade_queue_items_organization_id migration: ratings
-- belong to the org they were captured in, not to the user globally —
-- so a rating made in Org A doesn't pre-fill the asset page in a
-- brand-new Org B the user later joins.

ALTER TABLE public.analyst_ratings
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Existing rows stay NULL — we can't reconstruct the original org for
-- ratings written before this migration. They'll simply be invisible on
-- the asset page until the user re-rates in a specific org context.

CREATE OR REPLACE FUNCTION public.set_analyst_ratings_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF NEW.organization_id IS NOT NULL THEN RETURN NEW; END IF;
  IF v_caller IS NOT NULL THEN
    SELECT current_organization_id INTO NEW.organization_id
    FROM public.users WHERE id = v_caller;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_analyst_ratings_org_id_trigger ON public.analyst_ratings;
CREATE TRIGGER set_analyst_ratings_org_id_trigger
  BEFORE INSERT ON public.analyst_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_analyst_ratings_org_id();

CREATE INDEX IF NOT EXISTS analyst_ratings_org_user_asset_idx
  ON public.analyst_ratings (organization_id, user_id, asset_id);
