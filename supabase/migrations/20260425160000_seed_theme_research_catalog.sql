-- Seed default theme research catalog (sections + fields) per org.
-- Pilot orgs were provisioned without `theme_research_sections` /
-- `theme_research_fields`, so theme thesis views had no fields to
-- render. Mirror of the asset research catalog seeding.

CREATE OR REPLACE FUNCTION public.seed_default_theme_research_catalog(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_thesis_section_id uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization id is required';
  END IF;

  INSERT INTO theme_research_sections (organization_id, name, slug, description, display_order, is_system)
  VALUES (p_org_id, 'Thesis', 'thesis', 'Your investment thesis on this theme', 0, true)
  ON CONFLICT (organization_id, slug) DO NOTHING;

  SELECT id INTO v_thesis_section_id
  FROM theme_research_sections
  WHERE organization_id = p_org_id AND slug = 'thesis';

  IF v_thesis_section_id IS NULL THEN RETURN; END IF;

  INSERT INTO theme_research_fields (
    organization_id, section_id, name, slug, placeholder, field_type,
    config, is_universal, is_system, is_archived, display_order
  )
  VALUES
    (p_org_id, v_thesis_section_id, 'Investment Thesis', 'thesis',
     'Share your view on this theme...', 'rich_text', '{}'::jsonb, true, true, false, 0),
    (p_org_id, v_thesis_section_id, 'Where We Differ', 'where_different',
     'How does your view differ from consensus?', 'rich_text', '{}'::jsonb, true, true, false, 1),
    (p_org_id, v_thesis_section_id, 'Risks to Thesis', 'risks',
     'What could invalidate this theme?', 'rich_text', '{}'::jsonb, true, true, false, 2)
  ON CONFLICT (organization_id, slug) DO NOTHING;
END;
$function$;

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
