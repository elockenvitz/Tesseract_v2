-- Add canonical organization_id to all 4 note tables. Same pattern as
-- the trade_queue_items + analyst_ratings migrations: notes belong to
-- the org they were written in, not to the user globally. Without this
-- a note written in Org A shows up on the "All notes" page in Org B.
--
-- Backfill where the relation table carries an org (themes,
-- portfolios). asset_notes and custom_notebook_notes have no
-- reconstructable origin org for pre-migration rows — they stay NULL
-- and become invisible until the user creates new ones.

ALTER TABLE public.asset_notes
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.portfolio_notes
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.theme_notes
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.custom_notebook_notes
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.portfolio_notes n
SET organization_id = p.organization_id
FROM public.portfolios p
WHERE p.id = n.portfolio_id AND n.organization_id IS NULL;

UPDATE public.theme_notes n
SET organization_id = t.organization_id
FROM public.themes t
WHERE t.id = n.theme_id AND n.organization_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_note_org_id_from_caller()
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

DROP TRIGGER IF EXISTS set_asset_notes_org_id_trigger ON public.asset_notes;
CREATE TRIGGER set_asset_notes_org_id_trigger
  BEFORE INSERT ON public.asset_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_note_org_id_from_caller();

DROP TRIGGER IF EXISTS set_portfolio_notes_org_id_trigger ON public.portfolio_notes;
CREATE TRIGGER set_portfolio_notes_org_id_trigger
  BEFORE INSERT ON public.portfolio_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_note_org_id_from_caller();

DROP TRIGGER IF EXISTS set_theme_notes_org_id_trigger ON public.theme_notes;
CREATE TRIGGER set_theme_notes_org_id_trigger
  BEFORE INSERT ON public.theme_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_note_org_id_from_caller();

DROP TRIGGER IF EXISTS set_custom_notebook_notes_org_id_trigger ON public.custom_notebook_notes;
CREATE TRIGGER set_custom_notebook_notes_org_id_trigger
  BEFORE INSERT ON public.custom_notebook_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_note_org_id_from_caller();

CREATE INDEX IF NOT EXISTS asset_notes_org_id_idx ON public.asset_notes (organization_id) WHERE is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS portfolio_notes_org_id_idx ON public.portfolio_notes (organization_id) WHERE is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS theme_notes_org_id_idx ON public.theme_notes (organization_id) WHERE is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS custom_notebook_notes_org_id_idx ON public.custom_notebook_notes (organization_id) WHERE is_deleted IS NOT TRUE;
