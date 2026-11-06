-- =============================================================================
-- Workflow automation RPCs - cross-tenant authorization regression test
--
-- Pins the three defects closed by
-- supabase/migrations/20261106160200_sec_automation_rule_rpcs.sql:
--
--   recompute_workflow_rule_schedules   trusted its p_user_id argument
--   execute_single_automation_rule      p_trigger_source='scheduler' skipped
--                                       the permission check entirely
--   evaluate_pending_rules              any logged-in user could run the
--                                       scheduler across EVERY organization
--
-- WHAT WAS MEASURED AGAINST PRODUCTION 2026-11-06
--
--   recompute with the VICTIM's uuid as p_user_id   -> {"status":"success"}
--   recompute with the ATTACKER's own uuid          -> "Admin permission required"
--   execute_single_automation_rule(id, NULL, 'scheduler') -> ran, no authz check
--   evaluate_pending_rules() called by an org-B user -> processed 1 rule
--                                                       belonging to org A
--
-- That last line is why evaluate_pending_rules is a confirmed cross-tenant
-- path and not merely a suspected one.
--
-- THE SHAPE OF THE FIX
--
-- The two scheduler-authority functions were taken off the browser's API
-- instead of being rewritten: REVOKE EXECUTE ... FROM authenticated, keeping
-- service_role for the real scheduler. execute_single_automation_rule is 9.4KB
-- of branching action handlers, and transcribing it to insert a guard would be
-- a large and poorly reviewable change in an emergency fix. Two new thin
-- wrappers, run_workflow_rule(uuid) and run_due_workflow_rules(), derive the
-- actor from auth.uid(), fix the trigger source server-side, and scope to
-- current_org_id().
--
-- EXPECTED RESULTS BEFORE THE MIGRATION IS APPLIED
--   Assertion 1 FAILS (the forged p_user_id works).
--   Assertions 2 and 3 FAIL (the two functions are still callable).
--   Assertions 4 and 5 ERROR with 42883, "function does not exist": the
--   wrappers are created BY the migration. That is the correct pre-state.
--   Assertion 6 passes before and after.
--
-- EXPECTED RESULTS AFTER: all 8 pass. Measured.
--
-- ASSERTIONS 2 AND 3 REQUIRE insufficient_privilege SPECIFICALLY
--
-- Not just "an error". A rule-not-found or a constraint error would otherwise
-- pass for a revoked grant and the test would prove nothing about privileges.
--
-- APPLICATION DEPENDENCY
--
-- Assertions 4, 5, 7 and 8 exercise the wrappers that
-- src/pages/WorkflowsPage.tsx now calls. Applying the migration without
-- deploying that frontend change leaves the two automation buttons failing
-- with 42501; deploying the frontend without the migration leaves them failing
-- with PGRST202. They ship together.
--
-- TRANSACTION SAFETY
--
-- The whole file runs inside BEGIN ... ROLLBACK, so nothing it writes can
-- persist by any exit path: normal completion, a failed assertion, or an
-- unhandled error. The explicit CLEANUP DELETEs are defence in depth, not the
-- guarantee; the ROLLBACK is. Cleanup does not depend on a deliberately raised
-- exception, and the ROLLBACK must never be replaced with COMMIT.
--
-- Trigger-generated rows are covered. Two sources here: inserting a
-- public.users row fires create_default_lists_trigger (default asset_lists,
-- then seeded list_statuses), and running a notify_only rule can write a
-- workflow_rule_executions row and a notification. All are deleted explicitly
-- and discarded by the ROLLBACK regardless.
--
-- ONE CAVEAT THAT IS NOT TRANSACTIONAL. Assertions 5 and 8 call
-- run_due_workflow_rules(), which takes pg_try_advisory_lock(hashtext(
-- 'workflow_rule_scheduler')). An advisory lock is SESSION scoped, not
-- transaction scoped, so a ROLLBACK does not release it. The function unlocks
-- on both its success and its exception path, so in normal operation it is
-- released; but if the session is killed between the lock and the unlock, the
-- lock survives the rollback and a later scheduler run returns
-- {"status":"skipped"}. It clears when the session ends. Do not run this file
-- from a long-lived pooled session, and if a sweep starts reporting "skipped",
-- check pg_locks for locktype = 'advisory' before looking anywhere else.
--
-- It touches no real customer record: every row is one it created, in two
-- throwaway organizations with random slugs.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);
GRANT ALL ON _sec_results TO authenticated, anon;

DO $$
DECLARE
  s text := substr(md5(random()::text), 1, 8);
  v_org_a uuid; v_org_b uuid;
  v_owner uuid := gen_random_uuid();   -- org A, workflow creator
  v_atk uuid := gen_random_uuid();     -- org B, the attacker
  v_wf uuid; v_rule uuid; v_j jsonb; v_count int;
  v_pass int := 0; v_fail int := 0;
BEGIN
  -- ===========================================================================
  -- FIXTURE. The rule is deliberately due (next_run_at in the past) so that a
  -- scheduler sweep has something to pick up.
  -- ===========================================================================
  INSERT INTO organizations (name, slug) VALUES ('RPC-AUTO A ' || s, 'rpc-auto-a-' || s) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('RPC-AUTO B ' || s, 'rpc-auto-b-' || s) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner, 'rpcauto_owner_' || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_atk,   'rpcauto_atk_'   || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner, 'active', false),
    (v_org_b, v_atk, 'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id = v_owner;
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_atk;

  INSERT INTO workflows (name, organization_id, created_by, is_public)
    VALUES ('ORG A AUTOMATION ' || s, v_org_a, v_owner, false) RETURNING id INTO v_wf;
  INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, sort_order)
    VALUES (v_wf, 's1', 'Stage 1', 1);
  INSERT INTO workflow_automation_rules
    (workflow_id, rule_name, rule_type, condition_type, condition_value, action_type, created_by, is_active, next_run_at)
    VALUES (v_wf, 'ORG A RULE', 'time', 'time_interval', '{"days":7}', 'notify_only', v_owner, true, now() - interval '1 hour')
    RETURNING id INTO v_rule;

  -- ===========================================================================
  -- 1. FORGED IDENTIFIER. The original check read the caller's own argument,
  --    so it worked perfectly and guarded nothing.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_atk, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;

  v_j := recompute_workflow_rule_schedules(v_wf, v_owner);
  IF v_j->>'status' = 'error' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('forged p_user_id rejected: %s', v_j->>'error'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('FORGED IDENTIFIER ACCEPTED: %s', v_j::text)); END IF;

  -- ===========================================================================
  -- 2 & 3. SCHEDULER AUTHORITY MUST BE UNREACHABLE FROM A BROWSER SESSION.
  --        insufficient_privilege specifically: any other error would mean the
  --        grant is still there and something else blocked the call.
  -- ===========================================================================
  BEGIN
    v_j := execute_single_automation_rule(v_rule, NULL, 'scheduler');
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (2, 'FAIL', 'authenticated can still call execute_single_automation_rule, so p_trigger_source is still forgeable');
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_pass := v_pass + 1;
      INSERT INTO _sec_results VALUES (2, 'PASS', 'execute_single_automation_rule is no longer executable by authenticated (42501)');
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      INSERT INTO _sec_results VALUES (2, 'FAIL', format('blocked by %s, not by a revoked grant - the EXECUTE privilege is still held', SQLSTATE));
  END;

  BEGIN
    v_j := evaluate_pending_rules();
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (3, 'FAIL', format('authenticated can still run the global scheduler sweep (processed %s)', v_j->>'processed'));
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_pass := v_pass + 1;
      INSERT INTO _sec_results VALUES (3, 'PASS', 'evaluate_pending_rules is no longer executable by authenticated (42501)');
    WHEN OTHERS THEN
      v_fail := v_fail + 1;
      INSERT INTO _sec_results VALUES (3, 'FAIL', format('blocked by %s, not by a revoked grant', SQLSTATE));
  END;

  -- ===========================================================================
  -- 4. The wrapper must refuse another organization's rule.
  -- ===========================================================================
  BEGIN
    v_j := run_workflow_rule(v_rule);
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (4, 'FAIL', 'attacker ran another organization''s rule through the wrapper');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42883' THEN v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', 'run_workflow_rule does not exist - the migration is not applied');
    ELSE v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', format('attacker denied by the wrapper (%s)', SQLSTATE)); END IF;
  END;

  -- ===========================================================================
  -- 5. The sweep must be scoped to the caller's own organization. Not an
  --    error: it must succeed and find nothing.
  -- ===========================================================================
  BEGIN
    v_j := run_due_workflow_rules();
    IF (v_j->>'processed')::int = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'the attacker''s sweep processed 0 rules');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('CROSS-ORG EXECUTION: the attacker''s sweep processed %s rule(s)', v_j->>'processed')); END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42883' THEN v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', 'run_due_workflow_rules does not exist - the migration is not applied');
    ELSE v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', format('the attacker''s sweep was denied (%s)', SQLSTATE)); END IF;
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 6, 7, 8. LEGITIMATE: the owner. All three must keep working, or the fix is
  --          over-tightened and the automation UI is broken.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;

  v_j := recompute_workflow_rule_schedules(v_wf, v_owner);
  IF v_j->>'status' = 'success' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', format('owner recompute still works: %s', v_j::text));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', format('owner recompute broken: %s - OVER-TIGHTENED', v_j::text)); END IF;

  BEGIN
    v_j := run_workflow_rule(v_rule);
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (7, 'PASS', format('owner can run their own rule (status %s)', coalesce(v_j->>'status', '(null)')));
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (7, 'FAIL', format('owner blocked from their own rule (%s %s) - OVER-TIGHTENED', SQLSTATE, SQLERRM));
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- recompute above may have cleared next_run_at, so make the rule due again.
  UPDATE workflow_automation_rules SET next_run_at = now() - interval '1 hour' WHERE id = v_rule;

  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_j := run_due_workflow_rules();
    IF (v_j->>'processed')::int >= 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', format('owner''s sweep processed %s of their own rules', v_j->>'processed'));
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('owner''s sweep processed 0: %s - OVER-TIGHTENED', v_j::text)); END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (8, 'FAIL', format('owner''s sweep broken (%s %s) - OVER-TIGHTENED', SQLSTATE, SQLERRM));
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- CLEANUP. Running a notify_only rule can write an execution log row and a
  -- notification, so both are cleared.
  -- ===========================================================================
  DELETE FROM workflow_rule_executions WHERE rule_id = v_rule;
  DELETE FROM workflow_automation_rules WHERE workflow_id = v_wf;
  DELETE FROM workflow_stages WHERE workflow_id = v_wf;
  DELETE FROM workflow_collaborations WHERE workflow_id = v_wf;
  DELETE FROM workflow_template_versions WHERE workflow_id = v_wf;
  DELETE FROM workflows WHERE id = v_wf;
  DELETE FROM notifications WHERE user_id IN (v_owner, v_atk);
  -- Inserting a public.users row fires create_default_lists_trigger, which
  -- creates a default asset_lists row per user, and seed_default_list_statuses
  -- then seeds its statuses. Leaving them makes the users delete below fail
  -- with 23503 on list_statuses_list_id_fkey.
  DELETE FROM list_statuses WHERE list_id IN (SELECT id FROM asset_lists WHERE created_by IN (v_owner, v_atk));
  DELETE FROM asset_lists WHERE created_by IN (v_owner, v_atk);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_owner, v_atk);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM public.users WHERE id IN (v_owner, v_atk);
  DELETE FROM auth.users WHERE id IN (v_owner, v_atk);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 8 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;

-- The guarantee. Do not replace this with COMMIT.
ROLLBACK;

-- Belt and braces for the one thing ROLLBACK cannot undo: see the advisory
-- lock caveat in the header. Safe to run even if the lock was never held.
SELECT pg_advisory_unlock_all();
