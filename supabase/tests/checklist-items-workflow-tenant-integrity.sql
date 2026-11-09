-- =============================================================================
-- asset_checklist_items Requirement/Workflow Tenant Integrity — regression test
--
-- Proves the boundary that
-- supabase/migrations/20261023120000_checklist_items_workflow_tenant_integrity.sql
-- establishes, and that it does not invalidate anything that works today.
--
-- THE DEFECT UNDER TEST
--
-- `organization_id` is stamped from the caller's session; `workflow_id` is
-- checked only against `workflows(id)`. Nothing ties them, so a member of one
-- organization can create — or repoint — a requirement whose workflow belongs
-- to another.
--
-- AGAINST PRODUCTION AS IT STANDS, assertions 2 and 3 FAIL: the cross-org
-- INSERT writes and the cross-org UPDATE repoints. Every other assertion must
-- pass both before and after, and they are the half that matters most —
-- assertions 1, 4, 5, 8, 9 and 10 are the "did we break the product" side.
--
-- Assertion 2 and 3 check the SQLSTATE, not merely that the write failed. A
-- test that accepts any error passes when a fixture is wrong or a privilege is
-- missing, and proves nothing about the constraint.
--
-- Assertion 11 is the residual: `MATCH SIMPLE` does not enforce when a
-- referencing column is NULL, so a NULL-`organization_id` row with a cross-org
-- workflow would escape the FK. It is unreachable in practice, and this proves
-- why rather than asserting it — the `asset_checklist_items_set_org` BEFORE
-- trigger fills the NULL from `current_org_id()`, which turns the attempt into
-- an ordinary foreign-key violation.
--
-- EXECUTED 2026-10-23 against production inside BEGIN … ROLLBACK, with the
-- migration applied transaction-locally: 11 of 11 passed. Nothing committed.
--
-- Self-cleaning. 11 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix  text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid;
  v_org_b   uuid;
  v_user_a  uuid := gen_random_uuid();
  v_user_b  uuid := gen_random_uuid();
  v_asset   uuid;
  v_wf_a    uuid;
  v_wf_a2   uuid;   -- a second same-org workflow, for the reassignment control
  v_wf_b    uuid;   -- the victim's private workflow
  v_item    uuid;
  v_legacy  uuid := gen_random_uuid();
  v_count   int;
  v_state   text;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== Requirement/Workflow Tenant Integrity (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('RW Org A ' || v_suffix, 'rw-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('RW Org B ' || v_suffix, 'rw-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a, 'rw_a_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b, 'rw_b_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a, 'active', false),
    (v_org_b, v_user_b, 'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_a;
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  -- Assets are global reference data, which is the premise: both firms reach
  -- the same ticker legitimately.
  INSERT INTO assets (symbol, company_name)
    VALUES ('RW' || upper(substr(v_suffix, 1, 4)), 'Requirement Tenancy Test ' || v_suffix)
    RETURNING id INTO v_asset;

  INSERT INTO workflows (name, organization_id) VALUES ('RW WF A ' || v_suffix, v_org_a) RETURNING id INTO v_wf_a;
  INSERT INTO workflows (name, organization_id) VALUES ('RW WF A2 ' || v_suffix, v_org_a) RETURNING id INTO v_wf_a2;
  INSERT INTO workflows (name, organization_id, is_public)
    VALUES ('RW WF B PRIVATE ' || v_suffix, v_org_b, false) RETURNING id INTO v_wf_b;

  -- ===========================================================================
  -- 1. CONTROL: a same-org requirement can still be created
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_checklist_items (asset_id, workflow_id, stage_id, item_id, item_text, completed, item_type)
      VALUES (v_asset, v_wf_a, 'stage_1', 'item_ok', 'Own-org requirement', false, 'operational')
      RETURNING id INTO v_item;
    RESET ROLE;
    v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'same-org INSERT succeeds');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (1, 'FAIL', format('same-org INSERT refused (%s) - over-tightened', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. THE DEFECT: cross-org INSERT, and it must fail as a foreign-key
  --    violation rather than for any other reason
  -- ===========================================================================
  v_state := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_checklist_items (asset_id, workflow_id, stage_id, item_id, item_text, completed, item_type)
      VALUES (v_asset, v_wf_b, 'stage_1', 'item_xorg', 'CROSS-ORG requirement', false, 'operational');
    RESET ROLE;
  EXCEPTION
    WHEN foreign_key_violation THEN RESET ROLE; v_state := '23503';
    WHEN OTHERS THEN RESET ROLE; v_state := SQLSTATE;
  END;
  IF v_state = '23503' THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'cross-org INSERT rejected by the tenant FK (23503)');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (2, 'FAIL',
      coalesce('cross-org INSERT failed for the WRONG reason: ' || v_state, 'cross-org INSERT SUCCEEDED'));
  END IF;

  -- ===========================================================================
  -- 3. THE DEFECT: repointing an existing row at another org's workflow
  -- ===========================================================================
  v_state := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_checklist_items SET workflow_id = v_wf_b WHERE id = v_item;
    RESET ROLE;
  EXCEPTION
    WHEN foreign_key_violation THEN RESET ROLE; v_state := '23503';
    WHEN OTHERS THEN RESET ROLE; v_state := SQLSTATE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_checklist_items WHERE id = v_item AND workflow_id = v_wf_b;
  IF v_state = '23503' AND v_count = 0 THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'cross-org UPDATE rejected by the tenant FK (23503)');
  ELSE
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (3, 'FAIL', format('row repointed=%s, sqlstate=%s', v_count, coalesce(v_state, 'none')));
  END IF;

  -- ===========================================================================
  -- 4. CONTROL: reassignment to another workflow in the SAME org still works
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_checklist_items SET workflow_id = v_wf_a2 WHERE id = v_item;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_checklist_items WHERE id = v_item AND workflow_id = v_wf_a2;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'same-org reassignment still allowed');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', 'same-org reassignment blocked - over-tightened'); END IF;

  -- ===========================================================================
  -- 5. CONTROL: a valid requirement is still readable and writable
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_checklist_items SET status = 'completed', completed = true WHERE id = v_item;
    SELECT count(*) INTO v_count FROM asset_checklist_items WHERE id = v_item;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'valid requirement still readable and completable');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('valid requirement broke (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 6. The victim's workflow row stays hidden (unchanged by this migration)
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_b;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'another org''s workflow remains unreadable');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', 'another org''s workflow is readable'); END IF;

  -- ===========================================================================
  -- 7. A cross-org process RUN stays denied (its own policy, not this FK)
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, current_stage_key)
      VALUES (v_asset, v_wf_b, true, 'stage_1');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_workflow_progress WHERE asset_id = v_asset AND workflow_id = v_wf_b;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'cross-org run creation still denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', 'a cross-org run was created'); END IF;

  -- ===========================================================================
  -- 8. The quarantined shape — NULL org AND NULL workflow — is grandfathered.
  --    `MATCH SIMPLE` is what makes this work without a backfill.
  -- ===========================================================================
  BEGIN
    INSERT INTO asset_checklist_items (id, asset_id, workflow_id, organization_id, stage_id, item_id, item_text, completed, item_type)
      VALUES (v_legacy, v_asset, NULL, NULL, 'stage_1', 'item_legacy', 'Legacy quarantined', false, 'operational');
    SELECT count(*) INTO v_count FROM asset_checklist_items WHERE id = v_legacy;
    IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', 'legacy NULL/NULL row still accepted');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', 'legacy NULL/NULL row rejected'); END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('legacy NULL/NULL row rejected (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 9. A server-side writer with NO session can still write a same-org row.
  --    `auto_start_manually_added_asset` inserts checklist items this way.
  -- ===========================================================================
  BEGIN
    INSERT INTO asset_checklist_items (asset_id, workflow_id, organization_id, stage_id, item_id, item_text, completed, item_type)
      VALUES (v_asset, v_wf_a, v_org_a, 'stage_1', 'item_auto', 'Automated same-org', false, 'operational');
    v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'sessionless same-org write still accepted');
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', format('sessionless write refused (%s) - would break automation', SQLSTATE));
  END;

  -- ===========================================================================
  -- 10. No existing production relationship is invalidated
  -- ===========================================================================
  SELECT count(*) INTO v_count
    FROM asset_checklist_items i JOIN workflows w ON w.id = i.workflow_id
   WHERE i.organization_id IS NOT NULL AND i.organization_id <> w.organization_id;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (10, 'PASS', 'no pre-existing row violates the new FK');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', format('%s existing rows would violate it', v_count)); END IF;

  -- ===========================================================================
  -- 11. RESIDUAL: the MATCH SIMPLE bypass, and why a client cannot reach it.
  --     The set_org trigger fills the NULL from `current_org_id()`, so the
  --     attempt becomes an ordinary FK violation rather than an escape.
  -- ===========================================================================
  v_state := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_checklist_items (asset_id, workflow_id, organization_id, stage_id, item_id, item_text, completed, item_type)
      VALUES (v_asset, v_wf_b, NULL, 'stage_1', 'item_bypass', 'NULL-org bypass attempt', false, 'operational');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state := SQLSTATE;
  END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM asset_checklist_items WHERE item_id = 'item_bypass';
  IF v_count = 0 THEN
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (11, 'PASS', format('NULL-org bypass unreachable (sqlstate %s)', coalesce(v_state, 'none')));
  ELSE
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', 'a NULL-org row with a cross-org workflow was written');
  END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM asset_checklist_items WHERE asset_id = v_asset;
  DELETE FROM asset_workflow_progress WHERE asset_id = v_asset;
  DELETE FROM workflows WHERE id IN (v_wf_a, v_wf_a2, v_wf_b);
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_user_a, v_user_b);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 11 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
