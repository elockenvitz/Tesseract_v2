-- ============================================================================
-- Seed default research catalog (sections + fields) for every org.
--
-- Background
-- ----------
-- Pilot orgs were being provisioned via `provision_client_org` without the
-- canonical set of research sections + fields. The asset-page layout
-- resolver falls back to a system default that requires those rows to
-- exist (it filters `availableFields` by org-scoped sections), so a fresh
-- pilot user opening an asset and clicking "My View" saw an empty page —
-- no Thesis, no Forecasts, no Catalysts, no Key References.
--
-- This migration:
--   1. Adds `seed_default_research_catalog(p_org_id)` — an idempotent
--      function that inserts the standard 4 sections and 29 system fields
--      for the given org. Uses ON CONFLICT DO NOTHING so it's safe to
--      re-run / safe to call when partial data already exists.
--   2. Updates `provision_client_org` to call the seed function for every
--      newly-provisioned org so future pilot clients start with the full
--      catalog.
--   3. Backfills existing orgs that have zero research_sections — these
--      are the pilot orgs created before the fix landed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_default_research_catalog(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_thesis_id uuid;
  v_catalysts_id uuid;
  v_forecasts_id uuid;
  v_supporting_id uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization id is required';
  END IF;

  -- ----------------------- Sections -----------------------
  INSERT INTO research_sections (organization_id, name, slug, display_order, is_system)
  VALUES
    (p_org_id, 'Thesis & Risks',        'thesis',          0, true),
    (p_org_id, 'Catalysts & Events',    'catalysts',       1, true),
    (p_org_id, 'Forecasts & Estimates', 'forecasts',       2, true),
    (p_org_id, 'Key References',        'supporting_docs', 3, true)
  ON CONFLICT (organization_id, slug) DO NOTHING;

  SELECT id INTO v_thesis_id     FROM research_sections WHERE organization_id = p_org_id AND slug = 'thesis';
  SELECT id INTO v_catalysts_id  FROM research_sections WHERE organization_id = p_org_id AND slug = 'catalysts';
  SELECT id INTO v_forecasts_id  FROM research_sections WHERE organization_id = p_org_id AND slug = 'forecasts';
  SELECT id INTO v_supporting_id FROM research_sections WHERE organization_id = p_org_id AND slug = 'supporting_docs';

  -- ----------------------- Fields: Thesis & Risks -----------------------
  INSERT INTO research_fields (organization_id, section_id, slug, name, field_type, description, config, is_universal, is_system, display_order)
  VALUES
    (p_org_id, v_thesis_id, 'business_model',         'Business Model',         'rich_text', 'Description of how the company makes money',                       '{}'::jsonb, true, true, 0),
    (p_org_id, v_thesis_id, 'competitive_landscape',  'Competitive Landscape',  'rich_text', 'Analysis of competitors and market position',                      '{}'::jsonb, true, true, 0),
    (p_org_id, v_thesis_id, 'industry_dynamics',      'Industry Dynamics',      'rich_text', 'Key industry trends and drivers',                                  '{}'::jsonb, true, true, 0),
    (p_org_id, v_thesis_id, 'management_assessment',  'Management Assessment',  'rich_text', 'Evaluation of management team quality and track record',           '{}'::jsonb, true, true, 0),
    (p_org_id, v_thesis_id, 'moat_analysis',          'Moat Analysis',          'rich_text', 'Assessment of competitive advantages and sustainability',          '{}'::jsonb, true, true, 0),
    (p_org_id, v_thesis_id, 'regulatory_environment', 'Regulatory Environment', 'rich_text', 'Relevant regulations and policy considerations',                   '{}'::jsonb, true, true, 0),
    (p_org_id, v_thesis_id, 'supply_chain',           'Supply Chain Analysis',  'rich_text', 'Analysis of supply chain and dependencies',                        '{}'::jsonb, true, true, 0),
    (p_org_id, v_thesis_id, 'thesis',                 'Investment Thesis',      'rich_text', 'The core investment thesis explaining why this is an attractive opportunity', '{"legacySection":"thesis"}'::jsonb, true, true, 1),
    (p_org_id, v_thesis_id, 'where_different',        'Where We Differ',        'rich_text', 'How our view differs from market consensus',                       '{"legacySection":"where_different"}'::jsonb, true, true, 2),
    (p_org_id, v_thesis_id, 'risks_to_thesis',        'Risks to Thesis',        'rich_text', 'Key risks that could invalidate the thesis',                       '{"legacySection":"risks_to_thesis"}'::jsonb, true, true, 3)
  ON CONFLICT (organization_id, slug) DO NOTHING;

  -- ----------------------- Fields: Catalysts & Events -----------------------
  INSERT INTO research_fields (organization_id, section_id, slug, name, field_type, description, config, is_universal, is_system, display_order)
  VALUES
    (p_org_id, v_catalysts_id, 'earnings_preview',   'Earnings Preview',   'rich_text', 'Preview and expectations for upcoming earnings', '{}'::jsonb, true, true, 0),
    (p_org_id, v_catalysts_id, 'insider_activity',   'Insider Activity',   'rich_text', 'Insider buying/selling patterns',                '{}'::jsonb, true, true, 0),
    (p_org_id, v_catalysts_id, 'key_catalysts',      'Key Catalysts',      'rich_text', 'Upcoming events and triggers that could move the stock', '{"legacySection":"key_catalysts"}'::jsonb, true, true, 0),
    (p_org_id, v_catalysts_id, 'ma_considerations',  'M&A Considerations', 'rich_text', 'Potential M&A activity and implications',        '{}'::jsonb, true, true, 0),
    (p_org_id, v_catalysts_id, 'short_interest',     'Short Interest',     'rich_text', 'Short interest data and analysis',               '{}'::jsonb, true, true, 0),
    (p_org_id, v_catalysts_id, 'tam_analysis',       'TAM Analysis',       'rich_text', 'Total addressable market analysis and sizing',   '{}'::jsonb, true, true, 0)
  ON CONFLICT (organization_id, slug) DO NOTHING;

  -- ----------------------- Fields: Forecasts & Estimates -----------------------
  INSERT INTO research_fields (organization_id, section_id, slug, name, field_type, description, config, is_universal, is_system, display_order)
  VALUES
    (p_org_id, v_forecasts_id, 'capital_allocation',  'Capital Allocation',  'rich_text',    'Buybacks, dividends, and capital deployment',                  '{}'::jsonb, true, true, 0),
    (p_org_id, v_forecasts_id, 'comparable_analysis', 'Comparable Analysis', 'rich_text',    'Peer comparison and relative valuation',                       '{}'::jsonb, true, true, 0),
    (p_org_id, v_forecasts_id, 'kpi_tracker',         'KPI Tracker',         'checklist',    'Key performance indicators to monitor',                        '{"checklistType":"kpi"}'::jsonb, true, true, 0),
    (p_org_id, v_forecasts_id, 'model_assumptions',   'Model Assumptions',   'rich_text',    'Key assumptions underlying financial model',                   '{}'::jsonb, true, true, 0),
    (p_org_id, v_forecasts_id, 'rating',              'Rating',              'rating',       'Buy/Hold/Sell rating with conviction level',                   '{"widget":"rating"}'::jsonb, true, true, 0),
    (p_org_id, v_forecasts_id, 'sum_of_parts',        'Sum of Parts',        'rich_text',    'Segment-by-segment valuation breakdown',                       '{}'::jsonb, true, true, 0),
    (p_org_id, v_forecasts_id, 'technical_analysis',  'Technical Analysis',  'rich_text',    'Chart patterns and technical indicators',                      '{}'::jsonb, true, true, 0),
    (p_org_id, v_forecasts_id, 'valuation_framework', 'Valuation Framework', 'rich_text',    'DCF, multiples, or other valuation methodology',               '{}'::jsonb, true, true, 0),
    (p_org_id, v_forecasts_id, 'price_targets',       'Price Targets',       'price_target', 'Scenario-based price targets with probabilities',              '{"widget":"price_targets"}'::jsonb, true, true, 1),
    (p_org_id, v_forecasts_id, 'estimates',           'Financial Estimates', 'estimates',    'Revenue, EPS, and other financial projections',                '{"widget":"estimates"}'::jsonb, true, true, 2)
  ON CONFLICT (organization_id, slug) DO NOTHING;

  -- ----------------------- Fields: Key References -----------------------
  INSERT INTO research_fields (organization_id, section_id, slug, name, field_type, description, config, is_universal, is_system, display_order)
  VALUES
    (p_org_id, v_supporting_id, 'dd_checklist',   'Due Diligence Checklist', 'checklist',      'Research checklist and completion status',  '{"checklistType":"due_diligence"}'::jsonb, true, true, 0),
    (p_org_id, v_supporting_id, 'esg_assessment', 'ESG Assessment',          'rich_text',      'Environmental, social, and governance factors', '{}'::jsonb, true, true, 0),
    (p_org_id, v_supporting_id, 'documents',      'Key References',          'key_references', 'Uploaded documents and files',              '{"widget":"documents"}'::jsonb, true, true, 0)
  ON CONFLICT (organization_id, slug) DO NOTHING;
END;
$function$;

-- ============================================================================
-- Wire seed into provision_client_org so newly-provisioned orgs come up
-- with the full research catalog instead of an empty asset page.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provision_client_org(p_name text, p_slug text, p_admin_email text, p_settings jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
  v_admin_user_id UUID;
  v_invite_id UUID;
  v_provisioner_id UUID := auth.uid();
  v_normalized_email TEXT := lower(btrim(p_admin_email));
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied: only platform admins can provision organizations';
  END IF;

  IF v_normalized_email IS NULL
     OR v_normalized_email !~ '^[^@\s,]+@[^@\s,]+\.[^@\s,]+$' THEN
    RAISE EXCEPTION 'Invalid admin email format: "%"', p_admin_email;
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE slug = p_slug) THEN
    RAISE EXCEPTION 'Organization slug "%" already exists', p_slug;
  END IF;

  -- 1. Create the organization
  INSERT INTO organizations (name, slug, settings, onboarding_policy)
  VALUES (p_name, p_slug, p_settings, 'invite_only')
  RETURNING id INTO v_org_id;

  -- 2. Create governance record
  INSERT INTO organization_governance (organization_id)
  VALUES (v_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  -- 3. Create onboarding status (not completed) — restored from the
  --    pre-hardening version so the wizard actually renders for new orgs.
  INSERT INTO org_onboarding_status (organization_id)
  VALUES (v_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  -- 4. Seed default rating scale
  INSERT INTO rating_scales (name, description, organization_id, values)
  VALUES (
    'Default Rating Scale',
    'Standard 5-point rating scale',
    v_org_id,
    '[
      {"value": "1", "label": "Strong Buy", "color": "#10b981", "sort": 1},
      {"value": "2", "label": "Buy", "color": "#34d399", "sort": 2},
      {"value": "3", "label": "Neutral", "color": "#9ca3af", "sort": 3},
      {"value": "4", "label": "Sell", "color": "#f87171", "sort": 4},
      {"value": "5", "label": "Strong Sell", "color": "#ef4444", "sort": 5}
    ]'::jsonb
  );

  -- 4b. Seed default research catalog (sections + fields). Without this
  --     a fresh org's asset pages render empty because the layout
  --     resolver has no fields to fall back to.
  PERFORM seed_default_research_catalog(v_org_id);

  -- 5. Always enroll the provisioner as org admin (durable fallback)
  IF v_provisioner_id IS NOT NULL THEN
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_provisioner_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  END IF;

  -- 6. Enroll the intended admin or create an invite
  SELECT id INTO v_admin_user_id
  FROM users
  WHERE lower(email) = v_normalized_email;

  IF v_admin_user_id IS NOT NULL THEN
    INSERT INTO organization_memberships (user_id, organization_id, is_org_admin, status)
    VALUES (v_admin_user_id, v_org_id, true, 'active')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET is_org_admin = true, status = 'active';
  ELSE
    INSERT INTO organization_invites (
      organization_id, email, invited_by, invited_is_org_admin, status
    ) VALUES (
      v_org_id, v_normalized_email, v_provisioner_id, true, 'pending'
    )
    RETURNING id INTO v_invite_id;
  END IF;

  -- 7. Audit event
  INSERT INTO audit_events (
    actor_id, actor_type, entity_type, entity_id,
    action_type, action_category, to_state, metadata,
    org_id, checksum
  ) VALUES (
    v_provisioner_id, 'user', 'organization', v_org_id,
    'provision', 'lifecycle', '"active"'::jsonb,
    jsonb_build_object(
      'org_name', p_name,
      'org_slug', p_slug,
      'admin_email', v_normalized_email,
      'admin_user_id', v_admin_user_id,
      'invite_id', v_invite_id,
      'provisioner_enrolled', v_provisioner_id IS NOT NULL
    ),
    v_org_id,
    encode(sha256(convert_to(v_org_id::text || '-provision-' || now()::text, 'UTF8')), 'hex')
  );

  v_result := jsonb_build_object(
    'organization_id', v_org_id,
    'name', p_name,
    'slug', p_slug,
    'admin_user_id', v_admin_user_id,
    'admin_invited', v_admin_user_id IS NULL,
    'invite_id', v_invite_id,
    'provisioner_enrolled', v_provisioner_id IS NOT NULL
  );

  RETURN v_result;
END;
$function$;

-- ============================================================================
-- Backfill: any org that has zero research_sections gets the full catalog.
-- This is the set of pilot clients provisioned before the fix.
-- ============================================================================

DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN
    SELECT o.id
    FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM research_sections rs WHERE rs.organization_id = o.id
    )
  LOOP
    PERFORM seed_default_research_catalog(v_org.id);
  END LOOP;
END $$;
