-- =============================================================================
-- Asset Workspace Tenant Isolation — security regression test
--
-- Pins the boundary established by the 2026-10-18 remediation sprint (lanes
-- P2/P5/P6/P7) across the tables the Asset Workspace reads and writes:
--   price_target_history, asset_checklist_items, contribution_replies,
--   asset_contributions (per-org identity), analyst_ratings (incl. quarantine).
--
-- Contract: emits one (n, result, detail) row per assertion and is consumed by
-- scripts/security-suite.mjs (exit 1 on any non-PASS). Run it BEFORE the sprint
-- migrations to watch the cross-org / anon assertions FAIL (the open doors), and
-- AFTER to watch them PASS. A passing run on an un-migrated database would mean
-- the test is wired to nothing — so the "before" failures are the proof it bites.
--
-- Read probes assume the `authenticated` role and forge a JWT claim the way
-- PostgREST presents a request, then drop back. Reads as the owning role bypass
-- RLS and prove nothing. Trigger-stamped rows are written IN SESSION as their
-- author so organization_id is derived the way the app derives it.
--
-- Self-cleaning. 14 assertions (13 behavioral + the model-templates deny-all catalog check).
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix  text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid;
  v_org_b   uuid;
  v_user_a  uuid := gen_random_uuid();   -- org A author
  v_user_a2 uuid := gen_random_uuid();   -- org A colleague (same-org reader)
  v_user_b  uuid := gen_random_uuid();   -- org B, unrelated
  v_user_d  uuid := gen_random_uuid();   -- member of BOTH orgs (current A)
  v_asset   uuid;
  v_scale   uuid;
  v_pt_a    uuid;
  v_wf_a    uuid;
  v_contrib_a uuid;
  v_reply_a uuid;
  v_rating_null uuid;
  v_count   int;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== Asset Workspace Tenant Isolation (suffix: %) ===', v_suffix;

  -- ---------------------------------------------------------------------------
  -- SETUP (as owner except where a stamp trigger must derive org in-session)
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug) VALUES ('AW Org A ' || v_suffix, 'aw-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('AW Org B ' || v_suffix, 'aw-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a,  'aw_a_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_a2, 'aw_a2_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b,  'aw_b_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_d,  'aw_d_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a,  'active', false),
    (v_org_a, v_user_a2, 'active', false),
    (v_org_a, v_user_d,  'active', false),
    (v_org_b, v_user_b,  'active', false),
    (v_org_b, v_user_d,  'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_user_a, v_user_a2, v_user_d);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  INSERT INTO assets (symbol, company_name) VALUES ('AW' || upper(substr(v_suffix,1,4)), 'AW Asset ' || v_suffix) RETURNING id INTO v_asset;
  INSERT INTO rating_scales (name, values) VALUES ('AW scale ' || v_suffix, '[{"label":"Buy","value":1}]'::jsonb) RETURNING id INTO v_scale;

  -- price_target (org A) + one history row (owner setup, explicit org on the parent)
  INSERT INTO price_targets (asset_id, type, price, created_by, organization_id)
    VALUES (v_asset, 'base', 100, v_user_a, v_org_a) RETURNING id INTO v_pt_a;
  INSERT INTO price_target_history (price_target_id, field_name, old_value, new_value, changed_by)
    VALUES (v_pt_a, 'price', '90', '100', v_user_a);

  -- workflow (org A) + a checklist item, written in session so the P2 stamp trigger derives org A
  INSERT INTO workflows (name, scope_type, organization_id, created_by)
    VALUES ('AW WF ' || v_suffix, 'asset', v_org_a, v_user_a) RETURNING id INTO v_wf_a;
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO asset_checklist_items (asset_id, workflow_id, stage_id, item_id, created_by)
    VALUES (v_asset, v_wf_a, 's1', 'i1', v_user_a);
  -- a contribution + reply, written in session (asset_contributions stamps org server-side)
  INSERT INTO asset_contributions (asset_id, section, content, created_by)
    VALUES (v_asset, 'thesis', 'aw thesis ' || v_suffix, v_user_a) RETURNING id INTO v_contrib_a;
  INSERT INTO contribution_replies (contribution_id, content, created_by)
    VALUES (v_contrib_a, 'aw reply ' || v_suffix, v_user_a) RETURNING id INTO v_reply_a;
  -- an analyst rating in org A, written in session so the P7 stamp trigger derives org A
  INSERT INTO analyst_ratings (asset_id, user_id, rating_value, rating_scale_id, organization_id)
    VALUES (v_asset, v_user_a, 'Buy', v_scale, NULL);
  RESET ROLE; SET LOCAL request.jwt.claims = '';

  -- a QUARANTINED rating: NULL organization_id, authored by user_a. Written as owner with no session, so the
  -- P7 stamp trigger derives current_org_id() = NULL and leaves it NULL (the fail-closed quarantine state).
  INSERT INTO analyst_ratings (asset_id, user_id, rating_value, rating_scale_id, organization_id)
    VALUES (v_asset, v_user_a, 'Buy', v_scale, NULL) RETURNING id INTO v_rating_null;

  -- ===========================================================================
  -- price_target_history
  -- ===========================================================================
  BEGIN  -- 1: anon reads nothing
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM price_target_history WHERE price_target_id = v_pt_a;
    RESET ROLE;
    IF v_count = 0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (1,'PASS','anon reads no price_target_history');
    ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (1,'FAIL',format('anon read %s PT-history row(s)',v_count)); END IF;
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (1,'PASS','anon refused at the grant');
  WHEN OTHERS THEN RESET ROLE; v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (1,'PASS',format('anon refused (%s)',SQLSTATE)); END;

  BEGIN  -- 2: org B cannot read org A's PT history
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM price_target_history WHERE price_target_id = v_pt_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (2,'PASS','org B cannot read org A price_target_history');
  ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (2,'FAIL',format('org B read org A PT history (count %s)',v_count)); END IF;

  BEGIN  -- 3: same-org colleague CAN read it (collaboration preserved)
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM price_target_history WHERE price_target_id = v_pt_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  IF v_count=1 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (3,'PASS','same-org colleague reads org A PT history');
  ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (3,'FAIL',format('same-org colleague cannot read PT history (count %s) - over-tightened',v_count)); END IF;

  -- ===========================================================================
  -- asset_checklist_items
  -- ===========================================================================
  BEGIN  -- 4: anon reads nothing
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM asset_checklist_items WHERE asset_id = v_asset;
    RESET ROLE;
    IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (4,'PASS','anon reads no asset_checklist_items');
    ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (4,'FAIL',format('anon read %s checklist row(s)',v_count)); END IF;
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (4,'PASS','anon refused at the grant');
  WHEN OTHERS THEN RESET ROLE; v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (4,'PASS',format('anon refused (%s)',SQLSTATE)); END;

  BEGIN  -- 5: org B cannot read org A checklist items
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_checklist_items WHERE asset_id = v_asset;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (5,'PASS','org B cannot read org A asset_checklist_items');
  ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (5,'FAIL',format('org B read org A checklist items (count %s)',v_count)); END IF;

  -- ===========================================================================
  -- contribution_replies
  -- ===========================================================================
  BEGIN  -- 6: anon reads nothing
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM contribution_replies WHERE id = v_reply_a;
    RESET ROLE;
    IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (6,'PASS','anon reads no contribution_replies');
    ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (6,'FAIL',format('anon read %s reply row(s)',v_count)); END IF;
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (6,'PASS','anon refused at the grant');
  WHEN OTHERS THEN RESET ROLE; v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (6,'PASS',format('anon refused (%s)',SQLSTATE)); END;

  BEGIN  -- 7: org B cannot read org A's reply
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM contribution_replies WHERE id = v_reply_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (7,'PASS','org B cannot read org A contribution reply');
  ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (7,'FAIL',format('org B read org A reply (count %s)',v_count)); END IF;

  BEGIN  -- 8: same-org colleague CAN read the reply
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM contribution_replies WHERE id = v_reply_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  IF v_count=1 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (8,'PASS','same-org colleague reads the reply');
  ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (8,'FAIL',format('same-org colleague cannot read reply (count %s)',v_count)); END IF;

  -- ===========================================================================
  -- asset_contributions — per-org identity (P6): a dual-org user holds the same
  -- (asset, section) in BOTH orgs without a unique collision.
  -- ===========================================================================
  BEGIN  -- 9: d writes thesis in org A (already exists for user_a; d uses its own)
    UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_d;
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_d, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_contributions (asset_id, section, content, created_by) VALUES (v_asset,'risks','d A '||v_suffix, v_user_d);
    RESET ROLE;
    v_count := 0;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  BEGIN  -- then the SAME (asset, section) in org B — must succeed under the widened key
    UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_d;
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_d, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_contributions (asset_id, section, content, created_by) VALUES (v_asset,'risks','d B '||v_suffix, v_user_d);
    RESET ROLE;
    UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_d;
    IF v_count = 0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (9,'PASS','dual-org user holds the same (asset,section) in both orgs (per-org identity)');
    ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (9,'FAIL','first contribution insert failed - fixture problem'); END IF;
  EXCEPTION WHEN unique_violation THEN RESET ROLE; UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_d;
    v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (9,'FAIL','org-blind unique key blocked the 2nd-org contribution (23505) - P6 not applied');
  WHEN OTHERS THEN RESET ROLE; UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_d;
    v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (9,'FAIL',format('2nd-org contribution errored (%s)',SQLSTATE)); END;

  -- ===========================================================================
  -- analyst_ratings (P7)
  -- ===========================================================================
  BEGIN  -- 10: anon reads nothing
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM analyst_ratings WHERE asset_id = v_asset;
    RESET ROLE;
    IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (10,'PASS','anon reads no analyst_ratings');
    ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (10,'FAIL',format('anon read %s rating(s)',v_count)); END IF;
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (10,'PASS','anon refused at the grant');
  WHEN OTHERS THEN RESET ROLE; v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (10,'PASS',format('anon refused (%s)',SQLSTATE)); END;

  BEGIN  -- 11: org B cannot read org A's rating
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM analyst_ratings WHERE asset_id = v_asset AND organization_id = v_org_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (11,'PASS','org B cannot read org A analyst rating');
  ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (11,'FAIL',format('org B read org A rating (count %s)',v_count)); END IF;

  BEGIN  -- 12: the quarantined (NULL-org) rating is invisible to a same-org NON-author colleague
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM analyst_ratings WHERE id = v_rating_null;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (12,'PASS','quarantined NULL-org rating hidden from a same-org colleague');
  ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (12,'FAIL',format('quarantined rating visible to a non-author (count %s)',v_count)); END IF;

  BEGIN  -- 13: the author still reads their own quarantined rating (preserved, not deleted)
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM analyst_ratings WHERE id = v_rating_null;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count:=-1; END;
  IF v_count=1 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (13,'PASS','author still reads their own quarantined rating');
  ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (13,'FAIL',format('author cannot read own quarantined rating (count %s)',v_count)); END IF;

  -- ===========================================================================
  -- 14. model-templates storage bucket is deny-all (A7): no client policy references it, so files there are
  --     reachable by nobody via the client. (Model-template FILES live in the `assets` bucket under an org path.)
  -- ===========================================================================
  BEGIN
    SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%model-templates%';
    IF v_count=0 THEN v_pass:=v_pass+1; INSERT INTO _sec_results VALUES (14,'PASS','model-templates storage bucket is deny-all (no client policies)');
    ELSE v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (14,'FAIL',format('model-templates bucket has %s client policy(ies) — expected deny-all',v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; INSERT INTO _sec_results VALUES (14,'FAIL',format('model-templates policy check errored (%s)',SQLSTATE)); END;

  -- ===========================================================================
  -- CLEANUP (as owner, unauthenticated)
  -- ===========================================================================
  SET LOCAL request.jwt.claims = '';
  DELETE FROM analyst_ratings WHERE asset_id = v_asset;
  DELETE FROM rating_scales WHERE id = v_scale;
  DELETE FROM contribution_replies WHERE contribution_id = v_contrib_a;
  DELETE FROM asset_contributions WHERE asset_id = v_asset;
  DELETE FROM asset_checklist_items WHERE asset_id = v_asset;
  DELETE FROM workflows WHERE id = v_wf_a;
  DELETE FROM price_target_history WHERE price_target_id = v_pt_a;
  DELETE FROM price_targets WHERE id = v_pt_a;
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_user_a, v_user_a2, v_user_b, v_user_d);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_a2, v_user_b, v_user_d);

  RAISE NOTICE '=== RESULTS: % passed, % failed out of 14 ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
