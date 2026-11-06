-- =============================================================================
-- Workflow-structure RPCs - cross-tenant authorization regression test
--
-- Pins the authorization behaviour of the four SECURITY DEFINER functions
-- repaired by supabase/migrations/20261106160000_sec_workflow_structure_rpcs.sql:
--
--   copy_workflow_with_unique_name
--   activate_template_version
--   create_initial_template_version
--   create_new_template_version
--
-- WHY THIS TEST EXISTS
--
-- All four were SECURITY DEFINER with no caller check at all. A SECURITY
-- DEFINER function is a hole punched through RLS: the policies on `workflows`
-- are correct and were verified to hold (assertion 1 proves the attacker's
-- direct SELECT returns 0 rows), but these functions never looked at
-- auth.uid(), so an ordinary `authenticated` user in organization B could:
--
--   * copy organization A's private workflow, with its stage labels, stage
--     descriptions and automation rules, into their OWN organization, where it
--     became fully readable. The stolen copy landed in the attacker's org
--     because the original INSERT omitted organization_id and the
--     stamp_organization_id() BEFORE INSERT trigger stamps current_org_id().
--   * DELETE every workflow_stages row of organization A's workflow from a
--     version uuid alone (activate_template_version rebuilds stages from a
--     snapshot, and the DELETE runs first).
--   * write template versions into organization A's workflow.
--   * name another user as target_user_id and create a workflow on their
--     behalf.
--
-- Measured against production on 2026-11-06 inside an aborted transaction:
-- 4 of these 12 assertions passed, 8 failed.
--
-- EXPECTED RESULTS BEFORE THE MIGRATION IS APPLIED
--   Assertions 2, 3, 4, 5, 6, 7, 9 FAIL.
--   Assertions 1, 8, 10, 12 pass (1 is the RLS baseline; 8, 10 and 12 are the
--   did-we-break-anything side).
--   Assertion 11 fails for an unrelated reason: see the note on it.
--
-- EXPECTED RESULTS AFTER
--   All 12 pass. Measured.
--
-- THE ADVERSARIAL PROOF (this test is not vacuous)
--
-- Both guards funnel through two helpers, assert_workflow_readable() and
-- assert_workflow_admin(). Replacing the bodies of BOTH helpers with a no-op
--
--   CREATE OR REPLACE FUNCTION public.assert_workflow_admin(uuid)
--   RETURNS uuid ... AS $$ BEGIN RETURN auth.uid(); END; $$;
--
-- while leaving the four repaired functions and their `PERFORM assert_...`
-- lines untouched flips assertions 2, 3 and 6 straight back to FAIL: the
-- cross-org copy succeeds again and organization A's stages are destroyed
-- again. Measured 2026-11-06, 0 passed / 3 failed. If you change the guards,
-- re-run that injection.
--
-- ASSERTION 5 ASSERTS AN ERROR CODE, NOT JUST AN ERROR
--
-- create_new_template_version is ALREADY BROKEN in production for everyone,
-- for a reason unrelated to security: its body selects
-- COALESCE(item_type, 'operational') from workflow_checklist_templates, and
-- that table has no item_type column, so it raises 42703 for any caller. A
-- test that merely asserted "the attacker got an error" would pass on that
-- pre-existing bug and prove nothing about authorization. Assertion 5
-- therefore requires SQLSTATE 42501 specifically, so the guard must fire
-- BEFORE the column error. Assertion 4 does the same for
-- create_initial_template_version, where a version_number collision would
-- otherwise raise 23P01 and look like a successful block.
--
-- ASSERTION 11 IS A KNOWN PRE-EXISTING FAILURE PATH
--
-- An admin collaborator calling create_initial_template_version on a workflow
-- that already has an active version hits
-- workflow_template_versions_unique_active (23P01). That is a product bug, not
-- an authorization bug, so this test gives the admin a workflow with no
-- versions yet (v_wf_virgin) and asserts only that the guard lets them
-- through.
--
-- TRANSACTION SAFETY (read this before running it anywhere)
--
-- The whole file runs inside BEGIN ... ROLLBACK, so NOTHING it writes can
-- persist, by any exit path:
--
--   * normal completion  -> the explicit CLEANUP block deletes the fixtures,
--                           then ROLLBACK discards everything anyway
--   * failed assertion   -> the assertion is caught, the run continues, and
--                           CLEANUP + ROLLBACK still happen
--   * unhandled error    -> the transaction aborts; the final SELECT then
--                           reports 25P02 instead of the results table, and
--                           ROLLBACK discards every fixture row
--
-- The explicit DELETEs are kept as defence in depth, so the file still behaves
-- if someone pastes only the DO block. They are NOT the guarantee; the
-- ROLLBACK is. This file does not rely on a deliberately raised exception for
-- cleanup, and it must never be edited to drop the ROLLBACK.
--
-- Trigger-generated rows are covered too. Inserting a public.users row fires
-- create_default_lists_trigger, which creates asset_lists the fixture never
-- asked for, and seed_default_list_statuses then seeds their statuses. Those
-- are deleted explicitly in CLEANUP, and discarded by the ROLLBACK regardless.
--
-- It touches no real customer record: every row it reads or writes is one it
-- created, in two throwaway organizations with random slugs. The destructive
-- assertion (3) deletes stages of a fixture workflow only.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);
GRANT ALL ON _sec_results TO authenticated, anon;

DO $$
DECLARE
  s text := substr(md5(random()::text), 1, 8);
  v_org_a uuid; v_org_b uuid;
  v_owner uuid := gen_random_uuid();   -- org A, creator of every fixture workflow
  v_admin uuid := gen_random_uuid();   -- org A, 'admin' collaborator
  v_norel uuid := gen_random_uuid();   -- org A, no relationship to the workflow
  v_atk   uuid := gen_random_uuid();   -- org B, the attacker
  v_wf_src uuid;      -- the workflow whose structure is worth stealing
  v_wf_doomed uuid;   -- the workflow whose stages the attacker tries to destroy
  v_wf_virgin uuid;   -- a workflow with no template version yet
  v_ver uuid;         -- a one-stage snapshot of v_wf_doomed
  v_new uuid; v_count int; v_txt text;
  v_pass int := 0; v_fail int := 0;
  v_made uuid[] := '{}';
BEGIN
  -- ===========================================================================
  -- FIXTURE
  -- ===========================================================================
  INSERT INTO organizations (name, slug) VALUES ('RPC-STRUCT A ' || s, 'rpc-struct-a-' || s) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('RPC-STRUCT B ' || s, 'rpc-struct-b-' || s) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner, 'rpcstruct_owner_' || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_admin, 'rpcstruct_admin_' || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_norel, 'rpcstruct_norel_' || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_atk,   'rpcstruct_atk_'   || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner, 'active', false),
    (v_org_a, v_admin, 'active', false),
    (v_org_a, v_norel, 'active', false),
    (v_org_b, v_atk,   'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_owner, v_admin, v_norel);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_atk;

  INSERT INTO workflows (name, organization_id, created_by, is_public, description)
    VALUES ('ORG A SECRET PROCESS ' || s, v_org_a, v_owner, false, 'confidential methodology')
    RETURNING id INTO v_wf_src;
  INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, stage_description, sort_order) VALUES
    (v_wf_src, 's1', 'ORG A SECRET STAGE 1', 'proprietary step one', 1),
    (v_wf_src, 's2', 'ORG A SECRET STAGE 2', 'proprietary step two', 2);
  INSERT INTO workflow_automation_rules (workflow_id, rule_name, rule_type, condition_type, action_type, created_by, is_active)
    VALUES (v_wf_src, 'ORG A SECRET RULE', 'time', 'time_interval', 'notify_only', v_owner, true);
  INSERT INTO workflow_collaborations (workflow_id, user_id, permission, invited_by)
    VALUES (v_wf_src, v_admin, 'admin', v_owner);

  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('ORG A DESTRUCTION TARGET ' || s, v_org_a, v_owner, false)
    RETURNING id INTO v_wf_doomed;
  INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, sort_order) VALUES
    (v_wf_doomed, 'd1', 'DOOMED STAGE 1', 1),
    (v_wf_doomed, 'd2', 'DOOMED STAGE 2', 2);
  INSERT INTO workflow_template_versions (workflow_id, version_number, stages, created_by, is_active)
    VALUES (v_wf_doomed, 200,
      '[{"key":"restored","name":"RESTORED STAGE","description":"from snapshot","color":"#000","order_index":1,"icon":"x"}]'::jsonb,
      v_owner, true)
    RETURNING id INTO v_ver;

  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('ORG A VIRGIN WORKFLOW ' || s, v_org_a, v_owner, false)
    RETURNING id INTO v_wf_virgin;
  INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, sort_order)
    VALUES (v_wf_virgin, 'c1', 'STAGE C', 1);
  INSERT INTO workflow_collaborations (workflow_id, user_id, permission, invited_by)
    VALUES (v_wf_virgin, v_admin, 'admin', v_owner);

  v_made := ARRAY[v_wf_src, v_wf_doomed, v_wf_virgin];

  -- ===========================================================================
  -- 1. RLS BASELINE. If this fails, the policies regressed and the rest of the
  --    file is measuring the wrong thing.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_atk, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM workflows WHERE id = v_wf_src;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'RLS hides org A''s workflow from the attacker');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('RLS itself leaked %s row(s) - fix the policy, not the RPC', v_count)); END IF;

  -- ===========================================================================
  -- 2. CROSS-ORG READ + WRITE: copy another organization's workflow.
  -- ===========================================================================
  BEGIN
    v_new := copy_workflow_with_unique_name(v_wf_src, 'stolen', v_atk, false);
    SELECT string_agg(stage_label, ' | ') INTO v_txt FROM workflow_stages WHERE workflow_id = v_new;
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (2, 'FAIL', format('CROSS-ORG THEFT: copy succeeded, stole: %s', coalesce(v_txt, '(no stages)')));
    v_made := v_made || v_new;
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (2, 'PASS', format('cross-org copy denied (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 3. CROSS-ORG DESTRUCTION: activate a version of another org's workflow.
  -- ===========================================================================
  BEGIN
    PERFORM activate_template_version(v_ver);
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (3, 'FAIL', 'CROSS-ORG DESTRUCTION: activate_template_version succeeded');
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (3, 'PASS', format('cross-org activate denied (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 4 & 5. CROSS-ORG WRITE: template versions. Both require SQLSTATE 42501
  --        specifically, so a constraint error cannot pass for a block.
  -- ===========================================================================
  BEGIN
    PERFORM create_initial_template_version(v_wf_virgin);
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (4, 'FAIL', 'CROSS-ORG WRITE: create_initial_template_version succeeded');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'cross-org create_initial refused by AUTHORIZATION (42501)');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('blocked, but not by authorization (%s) - the guard did not fire', SQLSTATE)); END IF;
  END;

  BEGIN
    PERFORM create_new_template_version(v_wf_src, 'evil', 'evil', 'minor');
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (5, 'FAIL', 'CROSS-ORG WRITE: create_new_template_version succeeded');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'cross-org create_new refused by AUTHORIZATION (42501)');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('blocked, but not by authorization (%s) - 42703 means the pre-existing item_type bug fired first', SQLSTATE)); END IF;
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 6. DID THE DESTRUCTION LAND? Checked as superuser, not through RLS.
  -- ===========================================================================
  SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id = v_wf_doomed;
  IF v_count = 2 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'org A''s stages survived the attack (2 of 2)');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', format('CROSS-ORG DELETE LANDED: %s of 2 stages left', v_count)); END IF;

  -- ===========================================================================
  -- 7. SAME ORG, NO RELATIONSHIP. The organization term alone is not enough:
  --    a colleague who is not a collaborator must still be refused.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_norel, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_new := copy_workflow_with_unique_name(v_wf_src, 'nosy', v_norel, false);
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (7, 'FAIL', 'same-org non-collaborator copied a private workflow');
    v_made := v_made || v_new;
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (7, 'PASS', format('same-org non-collaborator denied (%s)', SQLSTATE));
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 8. LEGITIMATE: the owner duplicates their own workflow. Must keep working,
  --    with both stages and in their OWN organization.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_new := copy_workflow_with_unique_name(v_wf_src, 'Copy', v_owner, false);
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    v_made := v_made || v_new;
    SELECT count(*) INTO v_count FROM workflow_stages WHERE workflow_id = v_new;
    SELECT (organization_id = v_org_a)::text INTO v_txt FROM workflows WHERE id = v_new;
    IF v_count = 2 AND v_txt = 'true' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', 'owner can still duplicate (2 stages, own org)');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('owner duplicate wrong: %s stages, own org=%s - OVER-TIGHTENED', v_count, v_txt)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; SET LOCAL request.jwt.claims = '';
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (8, 'FAIL', format('owner duplicate BROKEN (%s %s) - OVER-TIGHTENED', SQLSTATE, SQLERRM));
  END;

  -- ===========================================================================
  -- 9. FORGED IDENTIFIER: the owner names someone else as target_user_id.
  --    Nobody may create a workflow on another user's behalf.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_new := copy_workflow_with_unique_name(v_wf_src, 'ForOther', v_admin, false);
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    v_made := v_made || v_new;
    SELECT (created_by = v_admin)::text INTO v_txt FROM workflows WHERE id = v_new;
    IF v_txt = 'true' THEN v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', 'FORGED IDENTIFIER ACCEPTED: workflow created for another user');
    ELSE v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'forged target_user_id ignored, the copy belongs to the caller'); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; SET LOCAL request.jwt.claims = '';
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (9, 'PASS', format('forged target_user_id rejected (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 10. LEGITIMATE: the owner activates a version. The stages must actually be
  --     rebuilt from the snapshot, so this proves the body still runs, not
  --     merely that it returned true.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM activate_template_version(v_ver);
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    SELECT count(*), string_agg(stage_label, ',') INTO v_count, v_txt FROM workflow_stages WHERE workflow_id = v_wf_doomed;
    IF v_count = 1 AND v_txt = 'RESTORED STAGE' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (10, 'PASS', 'owner can still activate a version (stages rebuilt from the snapshot)');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', format('owner activate wrong: %s stage(s) [%s]', v_count, coalesce(v_txt, ''))); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; SET LOCAL request.jwt.claims = '';
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (10, 'FAIL', format('owner activate BROKEN (%s %s) - OVER-TIGHTENED', SQLSTATE, SQLERRM));
  END;

  -- ===========================================================================
  -- 11. LEGITIMATE: an 'admin' collaborator, not the creator, must still be
  --     able to create a version. This is the assertion a fix that only
  --     checked created_by would fail.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_new := create_initial_template_version(v_wf_virgin);
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    IF v_new IS NOT NULL THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (11, 'PASS', 'admin collaborator can still create a version');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', 'admin collaborator got NULL'); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; SET LOCAL request.jwt.claims = '';
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (11, 'FAIL', format('admin collaborator BROKEN (%s %s) - OVER-TIGHTENED', SQLSTATE, SQLERRM));
  END;

  -- ===========================================================================
  -- 12. ANON. Must never reach any of them.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    v_new := copy_workflow_with_unique_name(v_wf_src, 'anon', v_atk, false);
    RESET ROLE;
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (12, 'FAIL', 'anon copied a workflow');
    v_made := v_made || v_new;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (12, 'PASS', format('anon denied (%s)', SQLSTATE));
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- CLEANUP. v_made collects every workflow uuid this test created, including
  -- the ones a FAILING assertion created, so a failing run leaves nothing
  -- behind either.
  -- ===========================================================================
  DELETE FROM workflow_template_versions WHERE workflow_id = ANY(v_made);
  DELETE FROM workflow_checklist_templates WHERE workflow_id = ANY(v_made);
  DELETE FROM workflow_automation_rules WHERE workflow_id = ANY(v_made);
  DELETE FROM workflow_stages WHERE workflow_id = ANY(v_made);
  DELETE FROM workflow_collaborations WHERE workflow_id = ANY(v_made);
  DELETE FROM workflows WHERE id = ANY(v_made);
  DELETE FROM workflows WHERE organization_id IN (v_org_a, v_org_b);
  -- Inserting a public.users row fires create_default_lists_trigger, which
  -- creates a default asset_lists row per user, and seed_default_list_statuses
  -- then seeds its statuses. Leaving them makes the users delete below fail
  -- with 23503 on list_statuses_list_id_fkey.
  DELETE FROM list_statuses WHERE list_id IN (SELECT id FROM asset_lists WHERE created_by IN (v_owner, v_admin, v_norel, v_atk));
  DELETE FROM asset_lists WHERE created_by IN (v_owner, v_admin, v_norel, v_atk);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_owner, v_admin, v_norel, v_atk);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM public.users WHERE id IN (v_owner, v_admin, v_norel, v_atk);
  DELETE FROM auth.users WHERE id IN (v_owner, v_admin, v_norel, v_atk);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 12 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;

-- The guarantee. Do not replace this with COMMIT.
ROLLBACK;
