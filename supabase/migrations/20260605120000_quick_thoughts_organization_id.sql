-- Add canonical organization_id to quick_thoughts. Final leg of the
-- Ideas feed cross-org leak: trade_queue_items / asset_notes /
-- asset_contributions already have the column, quick_thoughts didn't,
-- so a thought posted in Org A appeared on the Ideas feed in every
-- other org the same user belongs to.
--
-- No backfill source — visibility_org_id is NULL on every existing row
-- and there's no relation table carrying an org. Pre-migration rows
-- stay NULL and become invisible until the user posts new ones.

ALTER TABLE public.quick_thoughts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_quick_thoughts_org_id()
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

DROP TRIGGER IF EXISTS set_quick_thoughts_org_id_trigger ON public.quick_thoughts;
CREATE TRIGGER set_quick_thoughts_org_id_trigger
  BEFORE INSERT ON public.quick_thoughts
  FOR EACH ROW EXECUTE FUNCTION public.set_quick_thoughts_org_id();

CREATE INDEX IF NOT EXISTS quick_thoughts_organization_id_idx
  ON public.quick_thoughts (organization_id)
  WHERE is_archived IS NOT TRUE;
