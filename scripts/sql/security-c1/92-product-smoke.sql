-- =============================================================================
-- C1/92 — product smoke tests, STAGING ONLY
--
-- The matrix (90) proves the policies. This proves the PRODUCT still works: it
-- replays the exact query shapes the repointed application now issues, under a
-- real authenticated role, and asserts they return what the feature needs.
--
-- A policy suite that passes while the app returns nothing is a regression, not
-- a fix, and the two failure modes look identical from the database side — an
-- empty result is what both a correct denial and a broken feature produce.
-- Every assertion below therefore asserts a POSITIVE: the legitimate caller
-- gets their data.
--
-- Same transaction/rollback discipline as 07 and 90.
-- =============================================================================

CREATE TEMP TABLE c1_smoke (seq int, flow text, check_name text, expected text, actual text, pass boolean);
GRANT ALL ON c1_smoke TO authenticated, service_role, anon;

CREATE FUNCTION pg_temp.smoke(seq int, flow text, check_name text, expected anyelement, actual anyelement)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO c1_smoke VALUES (seq, flow, check_name, expected::text, actual::text, expected = actual);
END $fn$;

CREATE FUNCTION pg_temp.smoke_try(seq int, flow text, check_name text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  INSERT INTO c1_smoke VALUES (seq, flow, check_name, 'works', 'works', true);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO c1_smoke VALUES (seq, flow, check_name, 'works', 'ERROR: ' || left(SQLERRM, 70), false);
END $fn$;

INSERT INTO public.organizations (id, name, slug)
  VALUES ('a5000000-0000-4000-8000-000000000001', 'C1 Smoke Org', 'c1-smoke-org');
INSERT INTO auth.users (id, is_sso_user, is_anonymous)
  VALUES ('a5111111-0000-4000-8000-000000000001', false, false);
INSERT INTO public.users (id, current_organization_id)
  VALUES ('a5111111-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001')
  ON CONFLICT (id) DO UPDATE SET current_organization_id = EXCLUDED.current_organization_id;
INSERT INTO public.organization_memberships (organization_id, user_id, status)
  VALUES ('a5000000-0000-4000-8000-000000000001', 'a5111111-0000-4000-8000-000000000001', 'active');
INSERT INTO public.themes (id, name, organization_id, created_by)
  VALUES ('a5700000-0000-4000-8000-000000000001', 'C1 Smoke Theme', 'a5000000-0000-4000-8000-000000000001', 'a5111111-0000-4000-8000-000000000001');
INSERT INTO public.workflows (id, name, organization_id, created_by)
  VALUES ('a5c00000-0000-4000-8000-000000000001', 'C1 Smoke Workflow', 'a5000000-0000-4000-8000-000000000001', 'a5111111-0000-4000-8000-000000000001');
INSERT INTO public.target_date_funds (id, name, target_year, organization_id)
  VALUES ('a5f00000-0000-4000-8000-000000000001', 'C1 Smoke Fund', 2060, 'a5000000-0000-4000-8000-000000000001');
INSERT INTO public.tdf_holdings_snapshots (id, tdf_id, snapshot_date)
  VALUES ('a5500000-0000-4000-8000-000000000001', 'a5f00000-0000-4000-8000-000000000001', '2026-08-01');
INSERT INTO public.tdf_underlying_funds (id, name)
  VALUES ('a5100000-0000-4000-8000-000000000001', 'C1 Smoke Underlying');
INSERT INTO public.tdf_holdings (snapshot_id, underlying_fund_id, weight)
  VALUES ('a5500000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000001', 42);

DO $smoke$
DECLARE
  U   CONSTANT uuid := 'a5111111-0000-4000-8000-000000000001';
  ORG CONSTANT uuid := 'a5000000-0000-4000-8000-000000000001';
  THEME CONSTANT uuid := 'a5700000-0000-4000-8000-000000000001';
  WF  CONSTANT uuid := 'a5c00000-0000-4000-8000-000000000001';
  asset_1 uuid; asset_2 uuid;
  scen_default uuid; scen_custom uuid;
  contrib uuid;
  n int; txt text;
BEGIN
  SELECT id INTO asset_1 FROM public.assets ORDER BY symbol LIMIT 1;
  SELECT id INTO asset_2 FROM public.assets ORDER BY symbol OFFSET 1 LIMIT 1;

  ALTER TABLE public.scenarios DISABLE TRIGGER scenarios_set_organization_id;
  INSERT INTO public.scenarios (asset_id, name, is_default, created_by, organization_id)
    VALUES (asset_1, 'Base Case', true, NULL, NULL) RETURNING id INTO scen_default;
  ALTER TABLE public.scenarios ENABLE TRIGGER scenarios_set_organization_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U, 'role', 'authenticated')::text, true);

  -- ══ ASSET RESEARCH ════════════════════════════════════════════════════════
  -- useContributions write path — the authoritative model.
  INSERT INTO public.asset_contributions (asset_id, section, content, created_by, visibility)
    VALUES (asset_1, 'thesis', 'Smoke thesis: operating leverage', U, 'firm')
    RETURNING id INTO contrib;
  PERFORM pg_temp.smoke(1, 'asset research', 'thesis edit persists to the org-scoped model',
    ORG, (SELECT organization_id FROM public.asset_contributions WHERE id = contrib));

  -- fetchAssetResearch(): the batched read that replaced assets.thesis
  SELECT content INTO txt FROM public.asset_contributions
   WHERE asset_id = ANY(ARRAY[asset_1, asset_2]) AND section = ANY(ARRAY['thesis','where_different','risks_to_thesis'])
     AND is_archived = false ORDER BY updated_at DESC LIMIT 1;
  PERFORM pg_temp.smoke(2, 'asset research', 'research loads for the asset page',
    'Smoke thesis: operating leverage', txt);

  -- saveThesisReferences(): attachments on the caller's own thesis contribution
  UPDATE public.asset_contributions
     SET attachments = '[{"type":"link","title":"10-K","url":"https://example.invalid","addedAt":"2026-08-29"}]'::jsonb
   WHERE asset_id = asset_1 AND section = 'thesis' AND created_by = U;
  SELECT jsonb_array_length(attachments) INTO n FROM public.asset_contributions WHERE id = contrib;
  PERFORM pg_temp.smoke(3, 'asset research', 'thesis references save and read back', 1, n);

  -- ══ EXPLORE SEARCH ════════════════════════════════════════════════════════
  -- The reference pass: symbol / company_name / sector only.
  PERFORM pg_temp.smoke_try(10, 'explore search', 'reference pass over assets',
    'SELECT id, symbol, company_name, sector, updated_at FROM public.assets
      WHERE symbol ILIKE ''%a%'' OR company_name ILIKE ''%a%'' OR sector ILIKE ''%a%'' LIMIT 25');
  -- The research pass: org-scoped, joined to assets for the ticker.
  EXECUTE 'SELECT count(*) FROM public.asset_contributions c JOIN public.assets a ON a.id = c.asset_id
            WHERE c.section = ANY(ARRAY[''thesis'',''where_different'',''risks_to_thesis''])
              AND c.is_archived = false AND c.content ILIKE ''%operating leverage%''' INTO n;
  PERFORM pg_temp.smoke(11, 'explore search', 'own research is findable', 1, n);
  -- The old shape must now be impossible, not merely unused.
  PERFORM pg_temp.smoke(12, 'explore search', 'the pre-C1 query shape is refused',
    false, (SELECT EXISTS (SELECT 1 FROM information_schema.column_privileges
                            WHERE table_schema='public' AND table_name='assets'
                              AND grantee='authenticated' AND column_name='thesis')));

  -- ══ CASE VS PRICE / SCENARIOS ═════════════════════════════════════════════
  INSERT INTO public.scenarios (asset_id, name, is_default, created_by)
    VALUES (asset_1, 'Smoke Bull', false, U) RETURNING id INTO scen_custom;
  PERFORM pg_temp.smoke(20, 'case vs price', 'custom scenario write works',
    ORG, (SELECT organization_id FROM public.scenarios WHERE id = scen_custom));
  -- useScenarios: filters by asset_id only, never by org.
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE asset_id = %L', asset_1) INTO n;
  PERFORM pg_temp.smoke(21, 'case vs price', 'ladder loads global default + own custom', 2, n);
  EXECUTE format('SELECT count(*) FROM public.scenarios WHERE asset_id = %L AND is_default IS TRUE', asset_1) INTO n;
  PERFORM pg_temp.smoke(22, 'case vs price', 'global defaults still load', 1, n);

  -- ══ WORKFLOW ══════════════════════════════════════════════════════════════
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.asset_workflow_progress (asset_id, workflow_id, current_stage_key, is_started)
    VALUES (asset_1, WF, 'analysis', true);
  INSERT INTO public.asset_workflow_priorities (asset_id, workflow_id, priority)
    VALUES (asset_1, WF, 'high');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', U, 'role', 'authenticated')::text, true);

  -- AssetTab's replacement for reading assets.workflow_id
  EXECUTE format('SELECT count(*) FROM public.asset_workflow_progress WHERE asset_id = %L', asset_1) INTO n;
  PERFORM pg_temp.smoke(30, 'workflow', 'workflow relationship resolves from progress', 1, n);
  EXECUTE format('SELECT current_stage_key FROM public.asset_workflow_progress WHERE asset_id = %L AND workflow_id = %L', asset_1, WF) INTO txt;
  PERFORM pg_temp.smoke(31, 'workflow', 'process stage reads from the org-scoped model', 'analysis', txt);
  -- The universe `priority` rule, and InvestmentTimeline's priority read
  EXECUTE format('SELECT count(*) FROM public.asset_workflow_priorities WHERE workflow_id = %L AND priority = ANY(ARRAY[''high'',''critical''])', WF) INTO n;
  PERFORM pg_temp.smoke(32, 'workflow', 'universe priority rule resolves through the workflow', 1, n);

  -- ══ THEMES ════════════════════════════════════════════════════════════════
  PERFORM pg_temp.smoke_try(40, 'themes', 'same-org add asset to theme',
    format('INSERT INTO public.theme_assets (theme_id, asset_id, added_by) VALUES (%L, %L, %L)', THEME, asset_1, U));
  EXECUTE format('SELECT count(*) FROM public.theme_assets WHERE theme_id = %L', THEME) INTO n;
  PERFORM pg_temp.smoke(41, 'themes', 'theme membership reads back', 1, n);
  PERFORM pg_temp.smoke_try(42, 'themes', 'same-org remove asset from theme',
    format('DELETE FROM public.theme_assets WHERE theme_id = %L AND asset_id = %L', THEME, asset_1));

  -- ══ OBJECT LINKS ══════════════════════════════════════════════════════════
  -- Manual readthrough creation (is_auto = false) is the highest-traffic shape.
  PERFORM pg_temp.smoke_try(50, 'object links', 'manual readthrough link creation',
    format('INSERT INTO public.object_links (source_type, source_id, target_type, target_id, link_type, is_auto, created_by)
            VALUES (''theme'', %L, ''asset'', %L, ''references'', false, %L)', THEME, asset_1, U));
  EXECUTE 'SELECT count(*) FROM public.object_links' INTO n;
  PERFORM pg_temp.smoke(51, 'object links', 'link reads back for its creator', 1, n);
  PERFORM pg_temp.smoke_try(52, 'object links', 'link deletion by its creator',
    'DELETE FROM public.object_links WHERE created_by = auth.uid()');

  -- ══ TDF ═══════════════════════════════════════════════════════════════════
  EXECUTE 'SELECT count(*) FROM public.tdf_holdings' INTO n;
  PERFORM pg_temp.smoke(60, 'tdf', 'legitimate holdings view populates', 1, n);
  EXECUTE 'SELECT count(*) FROM public.tdf_holdings_snapshots' INTO n;
  PERFORM pg_temp.smoke(61, 'tdf', 'snapshot list populates', 1, n);

  -- ══ REVISION / HISTORY ════════════════════════════════════════════════════
  PERFORM pg_temp.smoke_try(70, 'revisions', 'authorized revision write',
    format('INSERT INTO public.asset_revisions (asset_id, view_scope_type, actor_user_id, revision_note)
            VALUES (%L, ''firm'', %L, ''smoke revision'')', asset_1, U));
  EXECUTE 'SELECT count(*) FROM public.asset_revisions' INTO n;
  PERFORM pg_temp.smoke(71, 'revisions', 'authorized revisions display', 1, n);
  EXECUTE 'SELECT count(*) FROM public.asset_contribution_history' INTO n;
  PERFORM pg_temp.smoke(72, 'revisions', 'own-org contribution history displays', true, n > 0);

  PERFORM set_config('role', 'postgres', true);
END $smoke$;

DO $report$
DECLARE body text; failed int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT pass), count(*) INTO failed, total FROM c1_smoke;
  SELECT string_agg(format('  %s %3s [%s] %s%s        want: %s | got: %s',
                           CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,
                           seq, flow, check_name, chr(10), expected, actual),
                    chr(10) ORDER BY seq)
    INTO body FROM c1_smoke;
  RAISE EXCEPTION E'\n=== C1 PRODUCT SMOKE TESTS ===\n%\n\n  %/% failed. Rolled back.\n', body, failed, total;
END $report$;
