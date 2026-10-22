-- =============================================================================
-- asset_checklist_attachments Tenant Isolation — security regression test
--
-- Proves the boundary that
-- supabase/migrations/20261022120000_checklist_attachments_tenant_isolation.sql
-- establishes, and that it does not take the feature away from the colleague
-- it exists for.
--
-- THE FINDING UNDER TEST
--
--   SELECT  USING (EXISTS (SELECT 1 FROM assets WHERE assets.id = asset_id))
--   INSERT  WITH CHECK (same)
--
-- `assets` is global reference data with USING(true), so that EXISTS proves
-- only that a ticker exists. Two firms covering the same ticker could read and
-- write each other's attachment rows.
--
-- AGAINST PRODUCTION AS IT STANDS, assertions 2, 3, 5 and 6 are expected to
-- FAIL. 1, 4, 7 and 8 must pass both before and after: they are the "did we
-- break the product" side, and assertion 4 in particular — a same-org
-- colleague who did not upload the file must still be able to read it —
-- is the one that would get a too-tight fix reverted.
--
-- Assertion 3 is the one that matters most and the one a naive test misses.
-- AssetTab reads this table filtered on asset_id ALONE. So org B is made to
-- query exactly that way, with a row of its own present on the same asset, and
-- must see exactly one row. A test that only checks "can I read my own" passes
-- while the leak is wide open.
--
-- Assertion 8 pins the fail-closed direction: workflow_id is nullable, and a
-- row without a workflow has no tenant, so nobody may read it.
--
-- EXECUTED 2026-10-22 against production inside BEGIN … ROLLBACK, twice:
-- once against the live policies (baseline) and once with the proposed
-- policies applied transaction-locally. Baseline: assertions 2, 3 and 5
-- FAILED — org B read org A's row, an asset-only read returned 2 rows, and
-- org B successfully inserted against org A's workflow. Proposed: all 10
-- passed. Nothing was committed; see the report in the lane's history.
--
-- Note on assertions 6 and 7: cross-org UPDATE and DELETE already passed at
-- baseline, because `uploaded_by = auth.uid()` happened to block them. They
-- are kept because they were protected by accident rather than by a tenant
-- predicate, and the next edit to that predicate should not silently open
-- them.
--
-- Self-cleaning. 10 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix  text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid;
  v_org_b   uuid;
  v_user_a  uuid := gen_random_uuid();   -- org A, uploads the file
  v_user_a2 uuid := gen_random_uuid();   -- org A colleague, uploads nothing
  v_user_b  uuid := gen_random_uuid();   -- org B, covers the same ticker
  v_asset   uuid;                        -- ONE global asset, both orgs cover it
  v_wf_a    uuid;
  v_wf_b    uuid;
  v_att_a   uuid := gen_random_uuid();
  v_att_b   uuid := gen_random_uuid();
  v_att_nul uuid := gen_random_uuid();   -- no workflow: no tenant
  v_count   int;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== asset_checklist_attachments Tenant Isolation (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('ACA Org A ' || v_suffix, 'aca-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('ACA Org B ' || v_suffix, 'aca-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a,  'aca_a_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_a2, 'aca_a2_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b,  'aca_b_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a,  'active', false),
    (v_org_a, v_user_a2, 'active', false),
    (v_org_b, v_user_b,  'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_user_a, v_user_a2);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  -- The shared ticker. This is the whole premise of the defect: assets are
  -- global, so both firms legitimately reach the same asset row.
  INSERT INTO assets (symbol, company_name)
    VALUES ('ZZ' || upper(substr(v_suffix, 1, 4)), 'Attachment Isolation Test Co ' || v_suffix)
    RETURNING id INTO v_asset;

  INSERT INTO workflows (name, organization_id) VALUES ('ACA Earnings Prep A ' || v_suffix, v_org_a) RETURNING id INTO v_wf_a;
  INSERT INTO workflows (name, organization_id) VALUES ('ACA Earnings Prep B ' || v_suffix, v_org_b) RETURNING id INTO v_wf_b;

  -- Seeded as the table owner, bypassing RLS, so the fixture does not depend
  -- on the very policies under test.
  INSERT INTO asset_checklist_attachments
    (id, asset_id, workflow_id, stage_id, item_id, file_name, file_path, file_size, uploaded_by, evidence_type, description)
  VALUES
    (v_att_a,   v_asset, v_wf_a, 'stage_expectations', 'item_0',
     'ORG_A_LBO_model_v4.xlsx', v_org_a || '/t/' || v_asset || '/a.xlsx', 2048, v_user_a, 'model', 'org A internal model'),
    (v_att_b,   v_asset, v_wf_b, 'stage_expectations', 'item_0',
     'ORG_B_notes.pdf',         v_org_b || '/t/' || v_asset || '/b.pdf',   1024, v_user_b, 'other', 'org B note'),
    (v_att_nul, v_asset, NULL,   'stage_expectations', 'item_0',
     'NO_WORKFLOW.txt',         v_org_a || '/t/' || v_asset || '/n.txt',    512, v_user_a, 'other', 'tenantless row');

  -- ===========================================================================
  -- 1. anon reads nothing
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE asset_id = v_asset;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'anon reads no attachment rows');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s attachment row(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. Org B cannot read org A's attachment
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE id = v_att_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'org B cannot read org A''s attachment');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', format('org B read org A''s attachment (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 3. THE REAL LEAK PATH — an asset-scoped read, the way AssetTab does it.
  --    Org B queries on asset_id alone and must see only its own row.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE asset_id = v_asset;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'asset-scoped read returns only the caller''s own org row');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('asset-scoped read returned %s row(s); expected 1 — cross-org metadata is visible', v_count)); END IF;

  -- ===========================================================================
  -- 4. A SAME-ORG colleague who uploaded nothing can still read it.
  --    If this fails the feature is pointless and the fix gets reverted.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE id = v_att_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'same-org colleague reads a teammate''s attachment');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('same-org colleague CANNOT read it (count %s) — over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 5. Org B cannot INSERT against org A's workflow
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_checklist_attachments
      (asset_id, workflow_id, stage_id, item_id, file_name, file_path, uploaded_by, evidence_type)
    VALUES (v_asset, v_wf_a, 'stage_expectations', 'item_0', 'INJECTED.pdf', 'x/injected.pdf', v_user_b, 'other');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE workflow_id = v_wf_a AND file_name = 'INJECTED.pdf';
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'org B cannot attach to org A''s requirement');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', 'org B inserted an attachment against org A''s workflow'); END IF;

  -- ===========================================================================
  -- 5b. Org B cannot UPDATE org A's attachment.
  --     Passed at baseline too, via `uploaded_by = auth.uid()` — kept so that
  --     predicate cannot be loosened without this noticing.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_checklist_attachments SET description = 'TAMPERED BY ORG B' WHERE id = v_att_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE id = v_att_a AND description = 'TAMPERED BY ORG B';
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'org A''s attachment was not altered by org B');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', 'org B updated org A''s attachment description'); END IF;

  -- ===========================================================================
  -- 7b. The uploader can still edit their own row's description.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_checklist_attachments SET description = 'owner edit' WHERE id = v_att_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE id = v_att_a AND description = 'owner edit';
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (10, 'PASS', 'uploader can still edit their own attachment');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', 'uploader CANNOT edit their own attachment — over-tightened'); END IF;

  -- ===========================================================================
  -- 6. Org B cannot DELETE org A's attachment
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM asset_checklist_attachments WHERE id = v_att_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE id = v_att_a;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'org A''s attachment survived org B''s delete');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', 'org B deleted org A''s attachment'); END IF;

  -- ===========================================================================
  -- 7. The uploader can still remove their own file from the requirement
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM asset_checklist_attachments WHERE id = v_att_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE id = v_att_a;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'uploader can remove their own attachment');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', 'uploader CANNOT remove their own attachment — over-tightened'); END IF;

  -- ===========================================================================
  -- 8. A row with no workflow has no tenant, so nobody reads it.
  --    workflow_id is nullable; this is the fail-closed direction, and it is
  --    safe only because the table is empty in production.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_checklist_attachments WHERE id = v_att_nul;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', 'a tenantless row is readable by nobody (fail-closed)');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('a NULL-workflow row was readable (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM asset_checklist_attachments WHERE asset_id = v_asset;
  DELETE FROM workflows WHERE id IN (v_wf_a, v_wf_b);
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_user_a, v_user_a2, v_user_b);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_a2, v_user_b);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 10 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
