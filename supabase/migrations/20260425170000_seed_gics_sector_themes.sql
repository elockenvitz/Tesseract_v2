-- Seed the 11 GICS sectors as pre-built themes per org so analysts
-- have somewhere to start aggregating sector-level views without
-- having to create themes by hand. Idempotent via the per-org
-- name-unique partial index.

CREATE OR REPLACE FUNCTION public.seed_gics_sector_themes(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sectors text[][] := ARRAY[
    ARRAY['Energy',                  'Oil, gas, and energy services — exploration, production, and refining.'],
    ARRAY['Materials',               'Chemicals, metals & mining, paper, and construction materials.'],
    ARRAY['Industrials',             'Capital goods, transportation, and commercial services.'],
    ARRAY['Consumer Discretionary',  'Autos, retail, leisure, and consumer durables.'],
    ARRAY['Consumer Staples',        'Food, beverage, household products, and food retail.'],
    ARRAY['Health Care',             'Pharma, biotech, medical devices, and providers.'],
    ARRAY['Financials',              'Banks, insurance, capital markets, and consumer finance.'],
    ARRAY['Information Technology',  'Software, semiconductors, hardware, and IT services.'],
    ARRAY['Communication Services',  'Telecom, media, entertainment, and interactive media.'],
    ARRAY['Utilities',               'Electric, gas, water, multi-utilities, and renewables.'],
    ARRAY['Real Estate',             'REITs and real estate management & development.']
  ];
  v_sector text[];
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization id is required';
  END IF;

  FOREACH v_sector SLICE 1 IN ARRAY v_sectors
  LOOP
    INSERT INTO themes (
      organization_id, name, description, color, theme_type, is_public,
      created_by
    ) VALUES (
      p_org_id, v_sector[1], v_sector[2], '#6366f1', 'sector', true, NULL
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$function$;

DO $$
DECLARE v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM organizations
  LOOP
    PERFORM seed_gics_sector_themes(v_org.id);
  END LOOP;
END $$;
