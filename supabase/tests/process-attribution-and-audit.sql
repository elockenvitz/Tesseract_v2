-- =============================================================================
-- Process Attribution and Audit History — regression test
--
-- Proves what supabase/migrations/20261023130000_process_attribution_and_audit.sql
-- establishes, and that it breaks neither existing process execution nor the
-- automation that runs without a session.
--
-- WHAT WAS WRONG
--
-- 874 runs with `started_by` NULL. 186 of 188 completed runs with no
-- `completed_by`. Zero process rows in `audit_events`, against 3,101 for
-- Trade Lab and trade ideas — because `valid_entity_type` had no process
-- entity, so a process event was not merely unwritten but impossible.
--
-- WHAT THIS GUARDS, BEYOND THE HAPPY PATH
--
--   8   A run whose starter has been NULL since 2025 must not acquire one
--       because somebody edited its stage today. This is the assertion that
--       fails if attribution is ever loosened to "fill when NULL".
--   7   Cron has no session. The event must say `system` / `unspecified` and
--       no human may be invented — and `record_audit_event` could not be used
--       at all here, because it raises on a null session and would abort the
--       cron transaction.
--  12-14 `asset_checklist_items`' UPDATE policy carries no column
--       restrictions, so any active member can set `completed_by` to any
--       user. Three paths are closed, not one: forging it ON a transition,
--       forging it with NO transition, and forging it on INSERT.
--  15-16 Trigger-only access is a privilege fact, not a naming convention.
--  17  The checksum formula hardcodes `actor_type = 'user'` in
--       `record_audit_event`; a system event must hash `system` or the column
--       contradicts its own inputs.
--  18  A failed mutation must leave no event, which is the whole reason the
--       writer is a trigger and not a client call.
--
-- FIXTURE NOTES, learned the hard way
--
--   * The run INSERT policy's subquery reads `workflows`, so the workflow has
--     to be VISIBLE to the caller — `created_by` and `is_public`, as the
--     application always writes them — not merely in the right organization.
--   * `(asset_id, workflow_id)` is UNIQUE on `asset_workflow_progress`, so
--     each run in this test needs its own workflow.
--
-- EXECUTED 2026-10-23 against production inside BEGIN … ROLLBACK with the
-- migration applied transaction-locally: 19 of 19 passed, and production was
-- verified afterwards to carry none of the new functions, triggers, events or
-- fixtures.
--
-- Self-cleaning. 26 assertions (20-26 are the run-attribution forgery matrix).
--
-- HOW TO RUN: this file asserts behaviour that only exists once the migration
-- is applied. Against an unmigrated database assertions 1-14 and 17-19 fail
-- by design — that is the baseline. Run it inside a transaction with the
-- migration applied, and roll back.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org    uuid;
  v_user   uuid := gen_random_uuid();   -- starts, reopens, recompletes
  v_user2  uuid := gen_random_uuid();   -- completes once, is the forgery target
  v_asset  uuid;
  v_wf     uuid;                        -- the main run
  v_wf2    uuid;                        -- the sessionless run
  v_wf3    uuid;                        -- the historical run
  v_run    uuid;
  v_auto   uuid;
  v_hist   uuid;
  v_item   uuid;
  v_norun  uuid;
  v_count  int;
  v_after  int;
  v_a      text;
  v_b      text;
  v_state  text;
  v_pass   int := 0;
  v_fail   int := 0;
BEGIN
  RAISE NOTICE '=== Process Attribution and Audit (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('PA Org ' || v_suffix, 'pa-' || v_suffix) RETURNING id INTO v_org;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user,  'pa_1_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user2, 'pa_2_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org, v_user, 'active', false), (v_org, v_user2, 'active', false);

  UPDATE users SET current_organization_id = v_org WHERE id IN (v_user, v_user2);

  INSERT INTO assets (symbol, company_name)
    VALUES ('PA' || upper(substr(v_suffix, 1, 4)), 'Process Audit Test ' || v_suffix) RETURNING id INTO v_asset;

  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('PA WF 1 ' || v_suffix, v_org, v_user, true) RETURNING id INTO v_wf;
  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('PA WF 2 ' || v_suffix, v_org, v_user, true) RETURNING id INTO v_wf2;
  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('PA WF 3 ' || v_suffix, v_org, v_user, true) RETURNING id INTO v_wf3;

  -- ===========================================================================
  -- 1. A human starts a run: the actor is recorded and exactly one event fires
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, current_stage_key)
    VALUES (v_asset, v_wf, true, 'stage_1') RETURNING id INTO v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT started_by::text INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  SELECT count(*) INTO v_count FROM audit_events WHERE entity_id = v_run AND action_type = 'process.started';
  IF v_a = v_user::text AND v_count = 1 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (1, 'PASS', 'started_by set to the real actor, one process.started');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (1, 'FAIL', format('started_by=%s, events=%s', coalesce(v_a,'NULL'), v_count)); END IF;

  -- ===========================================================================
  -- 2. Stage change emits exactly one event
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET current_stage_key = 'stage_2' WHERE id = v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM audit_events WHERE entity_id = v_run AND action_type = 'process.stage_changed';
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'one process.stage_changed');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', format('events=%s', v_count)); END IF;

  -- ===========================================================================
  -- 3. A no-op update emits nothing. Without the WHEN clauses this is where
  --    the ledger fills with noise.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET current_stage_key = 'stage_2' WHERE id = v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_count FROM audit_events WHERE entity_id = v_run;
  IF v_count = 2 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'no-op update emitted nothing');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('run events=%s, expected 2', v_count)); END IF;

  -- ===========================================================================
  -- 4. Completion attributes to whoever completed it, not whoever started it
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user2, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET is_completed = true WHERE id = v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT completed_by::text INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  SELECT count(*) INTO v_count FROM audit_events WHERE entity_id = v_run AND action_type = 'process.completed';
  IF v_a = v_user2::text AND v_count = 1 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (4, 'PASS', 'completed_by is the second user, one process.completed');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('completed_by=%s, events=%s', coalesce(v_a,'NULL'), v_count)); END IF;

  -- ===========================================================================
  -- 5. Reopening clears completion attribution AND its timestamp
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET is_completed = false WHERE id = v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT coalesce(completed_by::text,'NULL') || '/' || coalesce(completed_at::text,'NULL')
    INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  SELECT count(*) INTO v_count FROM audit_events WHERE entity_id = v_run AND action_type = 'process.reopened';
  IF v_a = 'NULL/NULL' AND v_count = 1 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (5, 'PASS', 'reopen cleared completed_by and completed_at');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('completed_by/at=%s, events=%s', v_a, v_count)); END IF;

  -- ===========================================================================
  -- 6. Recompletion attributes to whoever recompleted it
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET is_completed = true WHERE id = v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT completed_by::text INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  IF v_a = v_user::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'recompletion re-attributed');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', format('completed_by=%s', coalesce(v_a,'NULL'))); END IF;

  -- ===========================================================================
  -- 7. A sessionless completion — the shape the cron ending-rules take.
  --    No human may be invented, and the call must not raise.
  -- ===========================================================================
  INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, current_stage_key)
    VALUES (v_asset, v_wf2, false, 'stage_auto') RETURNING id INTO v_auto;
  UPDATE asset_workflow_progress SET is_completed = true WHERE id = v_auto;
  SELECT coalesce(actor_type,'?') || '/' || coalesce(metadata->>'origin','?')
    INTO v_b FROM audit_events WHERE entity_id = v_auto AND action_type = 'process.completed';
  SELECT count(*) INTO v_count FROM asset_workflow_progress WHERE id = v_auto AND completed_by IS NOT NULL;
  IF v_b = 'system/unspecified' AND v_count = 0 THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (7, 'PASS', 'sessionless completion recorded as system/unspecified, no actor invented');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', format('event=%s, rows with actor=%s', coalesce(v_b,'none'), v_count)); END IF;

  -- ===========================================================================
  -- 8. A historical run with a NULL starter, edited today by a human, keeps
  --    its NULL. The assertion that fails if attribution is ever loosened.
  -- ===========================================================================
  INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, current_stage_key)
    VALUES (v_asset, v_wf3, true, 'stage_hist') RETURNING id INTO v_hist;
  UPDATE asset_workflow_progress SET started_by = NULL WHERE id = v_hist;
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET current_stage_key = 'stage_hist2' WHERE id = v_hist;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT coalesce(started_by::text,'NULL') INTO v_a FROM asset_workflow_progress WHERE id = v_hist;
  IF v_a = 'NULL' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', 'historical NULL starter preserved');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', 'an unrelated update gave a historical run a false starter'); END IF;

  -- ===========================================================================
  -- 9. All four requirement transitions, plus an assignment change
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO asset_checklist_items (asset_id, workflow_id, stage_id, item_id, item_text, completed, item_type)
    VALUES (v_asset, v_wf, 'stage_1', 'r1', 'Flex Model', false, 'operational') RETURNING id INTO v_item;
  UPDATE asset_checklist_items SET status = 'completed', completed = true  WHERE id = v_item;
  UPDATE asset_checklist_items SET status = 'unchecked', completed = false WHERE id = v_item;
  UPDATE asset_checklist_items SET status = 'na'                            WHERE id = v_item;
  UPDATE asset_checklist_items SET status = 'unchecked'                     WHERE id = v_item;
  UPDATE asset_checklist_items SET assignee_id = v_user2                    WHERE id = v_item;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT string_agg(action_type, ',' ORDER BY occurred_at, action_type) INTO v_a
    FROM audit_events WHERE entity_id = v_item;
  IF v_a LIKE '%requirement.completed%' AND v_a LIKE '%requirement.reopened%'
     AND v_a LIKE '%requirement.marked_na%' AND v_a LIKE '%requirement.restored%'
     AND v_a LIKE '%requirement.assignment_changed%' THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'all five requirement events: ' || v_a);
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', coalesce(v_a, 'no events')); END IF;

  -- ===========================================================================
  -- 10. Parent is the run, org comes from the requirement's own column, and
  --     the assignment event uses the `relationship` category
  -- ===========================================================================
  SELECT parent_entity_type || '/' || (CASE WHEN parent_entity_id = v_run THEN 'run-id' ELSE 'other' END)
         || '/' || action_category || '/' || (CASE WHEN org_id = v_org THEN 'org-ok' ELSE 'ORG-WRONG' END)
    INTO v_a FROM audit_events WHERE entity_id = v_item AND action_type = 'requirement.completed';
  SELECT action_category INTO v_b FROM audit_events WHERE entity_id = v_item AND action_type = 'requirement.assignment_changed';
  IF v_a = 'process_run/run-id/state_change/org-ok' AND v_b = 'relationship' THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (10, 'PASS', 'parent=run, org from the row, assignment=relationship');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', format('%s | assignment=%s', coalesce(v_a,'none'), coalesce(v_b,'none'))); END IF;

  -- ===========================================================================
  -- 11. A requirement with no run row falls back to the asset, and keeps the
  --     workflow in metadata. 22 of 140 production rows are in this shape.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO asset_checklist_items (asset_id, workflow_id, stage_id, item_id, item_text, completed, item_type)
    VALUES (v_asset, v_wf, 'stage_norun', 'r_norun', 'No run requirement', false, 'operational') RETURNING id INTO v_norun;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  DELETE FROM asset_workflow_progress WHERE id = v_run;
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_checklist_items SET status = 'completed', completed = true WHERE id = v_norun;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT parent_entity_type || '/' || (CASE WHEN parent_entity_id = v_asset THEN 'asset-id' ELSE 'other' END)
         || '/wf=' || (CASE WHEN (metadata->>'workflow_id')::uuid = v_wf THEN 'kept' ELSE 'lost' END)
         || '/run=' || coalesce(metadata->>'run_id', 'null')
    INTO v_a FROM audit_events WHERE entity_id = v_norun AND action_type = 'requirement.completed';
  IF v_a = 'asset/asset-id/wf=kept/run=null' THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (11, 'PASS', 'no run: parent fell back to the asset, workflow kept');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', coalesce(v_a, 'no event')); END IF;

  -- ===========================================================================
  -- 12. Forged `completed_by` supplied WITH a real transition
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_checklist_items SET status = 'unchecked', completed = false WHERE id = v_norun;
  UPDATE asset_checklist_items SET status = 'completed', completed = true, completed_by = v_user2 WHERE id = v_norun;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT completed_by::text INTO v_a FROM asset_checklist_items WHERE id = v_norun;
  IF v_a = v_user::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (12, 'PASS', 'forgery on a transition overwritten with the real actor');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (12, 'FAIL', format('completed_by=%s', coalesce(v_a,'NULL'))); END IF;

  -- ===========================================================================
  -- 13. Forged `completed_by` with NO transition — the alternate path that
  --     stays open if only the transition is protected
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_checklist_items SET completed_by = v_user2 WHERE id = v_norun;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT completed_by::text INTO v_a FROM asset_checklist_items WHERE id = v_norun;
  IF v_a = v_user::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (13, 'PASS', 'attribution edit without a transition reverted');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (13, 'FAIL', format('completed_by=%s', coalesce(v_a,'NULL'))); END IF;

  -- ===========================================================================
  -- 14. Forged `completed_by` on INSERT
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO asset_checklist_items (asset_id, workflow_id, stage_id, item_id, item_text, completed, status, completed_by, item_type)
    VALUES (v_asset, v_wf, 'stage_1', 'r_ins', 'Insert forgery', true, 'completed', v_user2, 'operational');
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT completed_by::text INTO v_a FROM asset_checklist_items WHERE item_id = 'r_ins';
  IF v_a = v_user::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (14, 'PASS', 'forgery on INSERT overwritten');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (14, 'FAIL', format('completed_by=%s', coalesce(v_a,'NULL'))); END IF;

  -- ===========================================================================
  -- 15. A client cannot call the writer. Trigger-only access is a privilege
  --     fact; the trigger functions reach it only because they are DEFINER.
  -- ===========================================================================
  v_state := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    PERFORM public.record_process_event('process_run', v_auto, 'process.started', 'lifecycle', v_org);
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_state := '42501';
            WHEN OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SET LOCAL request.jwt.claims = '';
  IF v_state = '42501' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (15, 'PASS', 'client refused the writer (42501)');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (15, 'FAIL', format('sqlstate=%s', coalesce(v_state,'NO ERROR'))); END IF;

  -- ===========================================================================
  -- 16. A client cannot insert into audit_events directly either
  -- ===========================================================================
  v_state := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO audit_events (occurred_at, recorded_at, actor_id, actor_type, entity_type, entity_id, action_type, action_category, org_id)
      VALUES (now(), now(), v_user2, 'user', 'process_run', v_auto, 'process.completed', 'lifecycle', v_org);
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; v_state := '42501';
            WHEN OTHERS THEN RESET ROLE; v_state := SQLSTATE; END;
  SET LOCAL request.jwt.claims = '';
  IF v_state = '42501' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (16, 'PASS', 'client cannot append to the ledger');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (16, 'FAIL', format('sqlstate=%s', coalesce(v_state,'NO ERROR'))); END IF;

  -- ===========================================================================
  -- 17. The checksum is self-consistent for BOTH a user and a system event.
  --     record_audit_event hardcodes 'user' inside its hash; a system event
  --     must hash 'system' or the column contradicts its own inputs.
  -- ===========================================================================
  SELECT (checksum = encode(sha256(convert_to(jsonb_build_object(
            'occurred_at', occurred_at, 'actor_id', actor_id, 'actor_type', actor_type,
            'entity_type', entity_type, 'entity_id', entity_id, 'action_type', action_type,
            'from_state', from_state, 'to_state', to_state, 'org_id', org_id)::text, 'UTF8')), 'hex'))::text
    INTO v_a FROM audit_events WHERE entity_id = v_item AND action_type = 'requirement.completed';
  SELECT (checksum = encode(sha256(convert_to(jsonb_build_object(
            'occurred_at', occurred_at, 'actor_id', actor_id, 'actor_type', actor_type,
            'entity_type', entity_type, 'entity_id', entity_id, 'action_type', action_type,
            'from_state', from_state, 'to_state', to_state, 'org_id', org_id)::text, 'UTF8')), 'hex'))::text
    INTO v_b FROM audit_events WHERE actor_id IS NULL AND entity_type = 'process_run' LIMIT 1;
  IF v_a = 'true' AND v_b = 'true' THEN v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (17, 'PASS', 'checksum verifies for user and system events');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (17, 'FAIL', format('user=%s system=%s', coalesce(v_a,'?'), coalesce(v_b,'?'))); END IF;

  -- ===========================================================================
  -- 18. A failed mutation leaves no event. The reason the writer is a trigger.
  -- ===========================================================================
  SELECT count(*) INTO v_count FROM audit_events WHERE entity_type LIKE 'process_%';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_checklist_items SET status = 'bogus_status' WHERE id = v_item;   -- violates the status CHECK
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  SET LOCAL request.jwt.claims = '';
  SELECT count(*) INTO v_after FROM audit_events WHERE entity_type LIKE 'process_%';
  IF v_count = v_after THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (18, 'PASS', 'failed mutation left no event');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (18, 'FAIL', format('before=%s after=%s', v_count, v_after)); END IF;

  -- ===========================================================================
  -- 19. Nothing landed in another organization's history
  -- ===========================================================================
  SELECT count(*) INTO v_count FROM audit_events
   WHERE entity_type LIKE 'process_%' AND org_id IS DISTINCT FROM v_org;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (19, 'PASS', 'no foreign-org process events');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (19, 'FAIL', format('%s events in another org', v_count)); END IF;

  -- ===========================================================================
  -- 20-26. ACTOR FORGERY ON A RUN.
  --
  -- The first draft set `started_by` on the transition and left it alone
  -- otherwise, which read as safe and was not: "otherwise" included the
  -- forgery, so `UPDATE … SET started_by = <somebody else>` on an
  -- already-started run simply stood. Attribution is now write-once by
  -- transition, and these seven assertions are what that means.
  -- ===========================================================================

  -- 20. INSERT already-started, with a forged starter in the payload
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, current_stage_key, started_by)
    VALUES (v_asset, v_wf2, true, 'f1', v_user2) RETURNING id INTO v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT started_by::text INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  IF v_a = v_user::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (20, 'PASS', 'forged starter on INSERT replaced by the real actor');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (20, 'FAIL', format('started_by=%s', coalesce(v_a,'NULL'))); END IF;

  -- 21. THE FIXED HOLE: rewrite started_by on an already-started run
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET started_by = v_user2 WHERE id = v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT started_by::text INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  IF v_a = v_user::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (21, 'PASS', 'started_by is immutable outside a transition');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (21, 'FAIL', 'started_by was forged on a started run'); END IF;

  -- 22. An unrelated stage update by a DIFFERENT user preserves the starter
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user2, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET current_stage_key = 'f2' WHERE id = v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT started_by::text INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  IF v_a = v_user::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (22, 'PASS', 'unrelated update preserved the starter');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (22, 'FAIL', format('started_by=%s', coalesce(v_a,'NULL'))); END IF;

  -- 23. An upsert cannot rewrite it either — this is how the application's
  --     `onConflict: 'asset_id,workflow_id'` writes actually arrive.
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user2, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, current_stage_key, started_by)
    VALUES (v_asset, v_wf2, true, 'f3', v_user2)
    ON CONFLICT (asset_id, workflow_id) DO UPDATE
      SET current_stage_key = excluded.current_stage_key, started_by = excluded.started_by;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT started_by::text INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  IF v_a = v_user::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (23, 'PASS', 'upsert cannot rewrite the starter');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (23, 'FAIL', 'an upsert rewrote the starter'); END IF;

  -- 24. INSERT not-started with a forged starter: no starter at all
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, current_stage_key, started_by)
    VALUES (v_asset, v_wf3, false, 'f1', v_user2);
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT coalesce(started_by::text,'NULL') INTO v_a
    FROM asset_workflow_progress WHERE asset_id = v_asset AND workflow_id = v_wf3;
  IF v_a = 'NULL' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (24, 'PASS', 'a not-started row carries no starter');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (24, 'FAIL', format('started_by=%s', v_a)); END IF;

  -- 25. completed_by cannot be rewritten on an already-completed run
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user2, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  UPDATE asset_workflow_progress SET is_completed = true, completed_by = v_user WHERE id = v_run;
  UPDATE asset_workflow_progress SET completed_by = v_user WHERE id = v_run;
  RESET ROLE; SET LOCAL request.jwt.claims = '';
  SELECT completed_by::text INTO v_a FROM asset_workflow_progress WHERE id = v_run;
  IF v_a = v_user2::text THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (25, 'PASS', 'completed_by held at the real completer through a forgery');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (25, 'FAIL', format('completed_by=%s', coalesce(v_a,'NULL'))); END IF;

  -- 26. The audit event carries the same actor as the row. Selected BY ACTOR,
  --     not by time: `now()` is transaction-start time, so every event
  --     written in one transaction shares `occurred_at` and cannot be
  --     ordered by it. The same is true of `record_audit_event`.
  SELECT count(*) INTO v_count FROM audit_events
   WHERE entity_type = 'process_run' AND entity_id = v_run
     AND action_type = 'process.completed' AND actor_id = v_user2;
  IF v_count >= 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (26, 'PASS', 'the completion event names the real completer');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (26, 'FAIL', 'no completion event attributed to the real completer'); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM audit_events WHERE org_id = v_org;
  DELETE FROM asset_checklist_items WHERE asset_id = v_asset;
  DELETE FROM asset_workflow_progress WHERE asset_id = v_asset;
  DELETE FROM workflows WHERE id IN (v_wf, v_wf2, v_wf3);
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id = v_org;
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_user, v_user2);
  DELETE FROM organization_audit_log WHERE organization_id = v_org;
  DELETE FROM organizations WHERE id = v_org;
  DELETE FROM auth.users WHERE id IN (v_user, v_user2);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 26 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
