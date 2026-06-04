-- Backfill: seed the default theme research catalog for every org that
-- doesn't have one yet. The previous one-shot seed (20260425160000)
-- only ran against orgs that existed at the time the migration was
-- applied — every org created since then has rendered an empty Thesis
-- section because no seed code runs at org-creation time.
--
-- + AFTER INSERT trigger on organizations so future orgs get the
-- catalog automatically. Idempotent: seed_default_theme_research_catalog
-- already ON CONFLICT DO NOTHINGs every insert, so re-runs are safe.

DO $$
DECLARE v_org RECORD;
BEGIN
  FOR v_org IN
    SELECT id FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM theme_research_sections WHERE organization_id = o.id
    )
  LOOP
    PERFORM seed_default_theme_research_catalog(v_org.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.organizations_seed_theme_research()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_default_theme_research_catalog(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_seed_theme_research_trigger ON public.organizations;
CREATE TRIGGER organizations_seed_theme_research_trigger
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_seed_theme_research();
