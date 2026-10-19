-- =============================================================================
-- global_search Tenant Isolation — security regression test
--
-- Proves that public.global_search(text,integer), run as SECURITY INVOKER
-- (migration 20261019150000), cannot cross the organization boundary, while
-- still returning the caller's own org results and the global asset universe.
--
-- Exercises ALL 11 access-controlled entity types the RPC returns —
--   themes, portfolios, asset_lists, workflows, projects, tdfs (target_date_funds),
--   notebooks (custom_notebooks), teams, simulations, model_files, users —
-- plus the global `assets` table. It uses ACTUAL database roles (authenticated,
-- anon) and a real request.jwt.claims context, not just current_org_id() values,
-- so RLS, role privileges and policy dependencies are all exercised.
--
-- The three "no organization_id column" types (users, simulations, model_files)
-- are isolated by join/owner policies; they are asserted explicitly.
--
-- Expected against a MIGRATED database: 6/6 pass. Against the pre-migration
-- (SECURITY DEFINER, PUBLIC/anon EXECUTE) function, assertions 1,2,5,6 FAIL —
-- which is the defect this guards.
--
-- Self-cleaning. 6 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org_a    uuid := gen_random_uuid();
  v_org_b    uuid := gen_random_uuid();
  v_user_a   uuid := gen_random_uuid();   -- org A, the searcher
  v_user_a2  uuid := gen_random_uuid();   -- org A colleague (for user search)
  v_user_b   uuid := gen_random_uuid();   -- org B, unrelated
  v_asset    uuid := gen_random_uuid();
  v_pf_a     uuid := gen_random_uuid();
  v_pf_b     uuid := gen_random_uuid();
  tok_a      text := 'ZZAAA' || v_suffix;  -- appears in every org-A searchable field
  tok_b      text := 'ZZBBB' || v_suffix;  -- appears in every org-B searchable field
  tok_as     text := 'ZZASSET' || v_suffix; -- the global asset
  v_res      jsonb;
  v_pass     int := 0;
  v_fail     int := 0;
  v_keys     text[] := ARRAY['themes','portfolios','asset_lists','workflows','projects',
                             'tdfs','notebooks','teams','simulations','model_files','users'];
  k          text;
  v_bad      text;
  v_count    int;
  v_cross    jsonb;
  v_same     jsonb;
  v_msg      text;
  v_year_a   int  := 3000 + (abs(hashtext('a'||v_suffix)) % 900);  -- target_year is globally UNIQUE
  v_year_b   int  := 3900 + (abs(hashtext('b'||v_suffix)) % 900);
BEGIN
  RAISE NOTICE '=== global_search Tenant Isolation (suffix: %) ===', v_suffix;

  -- ----- Seed identities -----
  INSERT INTO auth.users(id) VALUES (v_user_a), (v_user_a2), (v_user_b);
  INSERT INTO organizations(id, name, slug) VALUES
    (v_org_a, 'ZZ Org A '||v_suffix, 'zz-a-'||v_suffix),
    (v_org_b, 'ZZ Org B '||v_suffix, 'zz-b-'||v_suffix);
  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_user_a, v_user_a2);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;
  UPDATE users SET first_name = tok_a WHERE id = v_user_a2;  -- found by same-org search
  UPDATE users SET first_name = tok_b WHERE id = v_user_b;   -- must NOT be found by org A
  INSERT INTO organization_memberships(organization_id, user_id, status) VALUES
    (v_org_a, v_user_a, 'active'), (v_org_a, v_user_a2, 'active'), (v_org_b, v_user_b, 'active');

  -- Global asset (no org): searchable by anyone authenticated.
  INSERT INTO assets(id, symbol, company_name) VALUES (v_asset, tok_as, tok_as||' Co');

  -- ----- Seed org-A owned rows (jwt=uA so org-stamp/owner triggers compute org A) -----
  SET LOCAL request.jwt.claims = '';
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role','authenticated')::text);
  INSERT INTO themes(name, organization_id) VALUES (tok_a, v_org_a);
  INSERT INTO portfolios(id, name, organization_id) VALUES (v_pf_a, tok_a, v_org_a);
  INSERT INTO asset_lists(name, organization_id, created_by) VALUES (tok_a, v_org_a, v_user_a);
  INSERT INTO workflows(name, organization_id, created_by, archived, is_public) VALUES (tok_a, v_org_a, v_user_a, false, true);
  INSERT INTO projects(title, organization_id, created_by) VALUES (tok_a, v_org_a, v_user_a);
  INSERT INTO custom_notebooks(name, organization_id) VALUES (tok_a, v_org_a);
  INSERT INTO target_date_funds(name, organization_id, target_year) VALUES (tok_a, v_org_a, v_year_a);
  INSERT INTO teams(name, slug, organization_id) VALUES (tok_a, 'zzta-'||v_suffix, v_org_a);
  INSERT INTO simulations(name, portfolio_id, created_by, view_id) VALUES (tok_a, v_pf_a, v_user_a, NULL);
  INSERT INTO model_files(filename, user_id, asset_id, storage_path) VALUES (tok_a, v_user_a, v_asset, 'zz/'||v_suffix||'/a');

  -- ----- Seed org-B owned rows (jwt=uB) -----
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role','authenticated')::text);
  INSERT INTO themes(name, organization_id) VALUES (tok_b, v_org_b);
  INSERT INTO portfolios(id, name, organization_id) VALUES (v_pf_b, tok_b, v_org_b);
  INSERT INTO asset_lists(name, organization_id, created_by) VALUES (tok_b, v_org_b, v_user_b);
  INSERT INTO workflows(name, organization_id, created_by, archived, is_public) VALUES (tok_b, v_org_b, v_user_b, false, true);
  INSERT INTO projects(title, organization_id, created_by) VALUES (tok_b, v_org_b, v_user_b);
  INSERT INTO custom_notebooks(name, organization_id) VALUES (tok_b, v_org_b);
  INSERT INTO target_date_funds(name, organization_id, target_year) VALUES (tok_b, v_org_b, v_year_b);
  INSERT INTO teams(name, slug, organization_id) VALUES (tok_b, 'zztb-'||v_suffix, v_org_b);
  INSERT INTO simulations(name, portfolio_id, created_by, view_id) VALUES (tok_b, v_pf_b, v_user_b, NULL);
  INSERT INTO model_files(filename, user_id, asset_id, storage_path) VALUES (tok_b, v_user_b, v_asset, 'zz/'||v_suffix||'/b');
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 1. Anonymous role cannot execute the function at all (EXECUTE revoked).
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.global_search(tok_a, 20);
    RESET ROLE;
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', 'anon was permitted to EXECUTE global_search');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon EXECUTE refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. Cross-org denial: org-A user searching org-B's token sees NOTHING
  --    in any of the 11 access-controlled types.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.global_search(tok_b, 20)::jsonb;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_res := NULL;
  END;
  v_bad := '';
  IF v_res IS NULL THEN v_bad := '(call failed)';
  ELSE
    FOREACH k IN ARRAY v_keys LOOP
      IF jsonb_array_length(COALESCE(v_res->k, '[]'::jsonb)) > 0 THEN
        v_bad := v_bad || k || '(' || jsonb_array_length(v_res->k) || ') ';
      END IF;
    END LOOP;
  END IF;
  IF v_bad = '' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'org A sees none of org B across all 11 types');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', 'org A leaked org B in: '||v_bad); END IF;

  -- ===========================================================================
  -- 3. Authorized same-org: org-A user searching org-A's token sees ALL 11.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.global_search(tok_a, 20)::jsonb;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_res := NULL;
  END;
  v_bad := '';
  IF v_res IS NULL THEN v_bad := '(call failed)';
  ELSE
    FOREACH k IN ARRAY v_keys LOOP
      IF jsonb_array_length(COALESCE(v_res->k, '[]'::jsonb)) = 0 THEN v_bad := v_bad || k || ' '; END IF;
    END LOOP;
  END IF;
  IF v_bad = '' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'org A sees all of its own 11 types');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', 'org A missing own results in: '||v_bad); END IF;

  -- ===========================================================================
  -- 4. Global reference: the asset remains searchable to the authenticated user.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.global_search(tok_as, 20)::jsonb;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_res := NULL;
  END;
  v_count := CASE WHEN v_res IS NULL THEN -1 ELSE jsonb_array_length(COALESCE(v_res->'assets','[]'::jsonb)) END;
  IF v_count >= 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'global assets remain searchable');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('global asset not returned (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 5. Symmetric isolation: org-B user searching org-A's token sees NOTHING.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.global_search(tok_a, 20)::jsonb;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_res := NULL;
  END;
  v_bad := '';
  IF v_res IS NULL THEN v_bad := '(call failed)';
  ELSE
    FOREACH k IN ARRAY v_keys LOOP
      IF jsonb_array_length(COALESCE(v_res->k, '[]'::jsonb)) > 0 THEN v_bad := v_bad || k || ' '; END IF;
    END LOOP;
  END IF;
  IF v_bad = '' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'org B sees none of org A across all 11 types');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', 'org B leaked org A in: '||v_bad); END IF;

  -- ===========================================================================
  -- 6. Complex (no organization_id) policy paths, called out explicitly:
  --    users / simulations / model_files — cross-org empty AND same-org present.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_cross := public.global_search(tok_b, 20)::jsonb;
    v_same  := public.global_search(tok_a, 20)::jsonb;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_cross := NULL; v_same := NULL;
  END;
  IF v_cross IS NULL OR v_same IS NULL THEN v_msg := '(call failed) ';
  ELSE
    FOREACH k IN ARRAY ARRAY['users','simulations','model_files'] LOOP
      IF jsonb_array_length(COALESCE(v_cross->k,'[]'::jsonb)) <> 0 THEN v_msg := v_msg || k || ':cross-leak '; END IF;
      IF jsonb_array_length(COALESCE(v_same->k,'[]'::jsonb))  =  0 THEN v_msg := v_msg || k || ':own-missing '; END IF;
    END LOOP;
  END IF;
  IF v_msg = '' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'users/simulations/model_files isolate and still return own rows');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', 'complex paths: '||v_msg); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  SET LOCAL request.jwt.claims = '';
  DELETE FROM model_files      WHERE user_id IN (v_user_a, v_user_b);
  DELETE FROM simulations      WHERE portfolio_id IN (v_pf_a, v_pf_b);
  DELETE FROM teams            WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM target_date_funds WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM custom_notebooks WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM projects         WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM workflows        WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM asset_lists      WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM portfolios       WHERE id IN (v_pf_a, v_pf_b);
  DELETE FROM themes           WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM assets           WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL, first_name = NULL WHERE id IN (v_user_a, v_user_a2, v_user_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_a2, v_user_b);

  RAISE NOTICE '=== RESULTS: % passed, % failed out of 6 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
