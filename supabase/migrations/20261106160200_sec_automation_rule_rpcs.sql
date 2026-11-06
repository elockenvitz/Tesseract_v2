-- ============================================================================
-- SECURITY: workflow automation RPCs stop accepting caller-supplied authority
-- ============================================================================
-- Group C of the cross-tenant RPC remediation. Prepared 2026-11-06. NOT YET
-- APPLIED to any database.
--
-- THREE DISTINCT DEFECTS
-- ----------------------
-- 1. recompute_workflow_rule_schedules(p_workflow_id, p_user_id) -- CONFIRMED
--    SECURITY DEFINER. It has a permission check, and the check reads the
--    caller's own argument:
--
--      IF v_workflow.created_by != p_user_id
--         AND NOT EXISTS (... workflow_collaborations WHERE user_id = p_user_id
--                             AND permission = 'admin') THEN
--        RETURN jsonb_build_object('status','error','error','Admin permission required');
--
--    Reproduced on production as a user in organization B with no relationship
--    to organization A: passing the victim's own uuid as p_user_id returned
--    {"status":"success"} and rewrote organization A's rule schedules; passing
--    the attacker's real uuid returned "Admin permission required". The gate
--    works perfectly and guards nothing, because the attacker chooses the
--    identity it is applied to. There is also no organization term at all.
--
-- 2. execute_single_automation_rule(p_rule_id, p_user_id, p_trigger_source)
--                                                            -- SUSPECTED
--    Its only authorization is:
--
--      IF p_user_id IS NOT NULL AND p_trigger_source = 'manual' THEN
--        ... check creator or admin collaborator ...
--      END IF;
--
--    Both halves are caller-controlled. p_trigger_source := 'scheduler', or
--    p_user_id := NULL, skips the check entirely. No downstream damage was
--    demonstrated, so this is recorded as suspected rather than confirmed, but
--    no caller-controlled parameter should ever be sufficient to claim
--    scheduler authority.
--
-- 3. evaluate_pending_rules()                                 -- SUSPECTED
--    SECURITY DEFINER, no arguments, no caller check, grantable to
--    `authenticated`. It sweeps up to 50 due rules across EVERY organization
--    and runs each one as execute_single_automation_rule(id, NULL, 'scheduler')
--    -- i.e. it is the scheduler, and any logged-in user could ring the bell.
--
-- THE SHAPE OF THE FIX
-- --------------------
-- The two scheduler-authority functions are taken off the public API instead
-- of being rewritten. execute_single_automation_rule is 9.4KB of branching
-- action handlers; transcribing it to add a guard would be a large, poorly
-- reviewable change in an emergency fix. Revoking EXECUTE from `authenticated`
-- is one line, cannot be partially wrong, and leaves the body untouched:
--
--   * execute_single_automation_rule -> service_role only. The scheduler (an
--     edge function / cron using the service key) keeps working. The browser
--     can no longer reach it, so neither p_trigger_source nor p_user_id is
--     reachable from a forged request.
--   * evaluate_pending_rules         -> service_role only, same reasoning.
--
-- The frontend's two buttons are then served by two NEW thin wrappers that
-- derive identity from auth.uid(), scope to current_org_id(), and verify the
-- caller's access to the specific workflow before delegating:
--
--   run_workflow_rule(p_rule_id uuid)      replaces the WorkflowsPage.tsx:4679
--                                          call to execute_single_automation_rule
--   run_due_workflow_rules()               replaces the WorkflowsPage.tsx:4742
--                                          call to evaluate_pending_rules
--
-- Both wrappers call the inner function with p_user_id := auth.uid() and
-- p_trigger_source := 'manual', so the inner function's own creator/admin
-- check now runs on a real identity rather than a claimed one. The wrapper
-- guard is the real boundary; the inner check becomes a second line.
--
-- DEPLOYMENT
--
-- This file is PURELY ADDITIVE and backward compatible. It creates the two
-- wrappers and tightens recompute_workflow_rule_schedules, and it changes no
-- grant that the currently deployed frontend depends on. It can be applied at
-- any time, before the frontend deploy, with no incompatibility window.
--
-- The two REVOKEs that actually take scheduler authority off the browser API
-- are deliberately held back in
-- 20261106160400_sec_automation_revoke_scheduler_execute.sql, because they are
-- the only part that breaks the currently deployed frontend. The sequence is:
--
--   1. apply this file                      (old frontend keeps working)
--   2. deploy the WorkflowsPage.tsx change  (now calls the wrappers)
--   3. apply 20261106160400                 (old route closed)
--
-- If step 2 fails, stop. Step 1 is harmless on its own and step 3 is simply
-- not applied; nothing has to be rolled back. The cost of stopping there is
-- that the p_trigger_source = 'scheduler' bypass stays open until step 3,
-- which is stated plainly rather than papered over.
--
-- VERIFIED BEFORE SPLITTING THIS FILE (measured on production 2026-11-06):
--   * No edge function and no other database function calls
--     execute_single_automation_rule. The only caller is
--     evaluate_pending_rules, which itself now has no caller at all.
--   * The REAL scheduler is the pg_cron job `SELECT
--     execute_due_automation_rules()` (every minute, as role `postgres`), and
--     that function does NOT call execute_single_automation_rule. So
--     evaluate_pending_rules was never the scheduler: it was a browser-only
--     entry point to scheduler authority.
--   * execute_due_automation_rules, process_branch_ending_rules and
--     execute_overdue_ending_rules are already NOT executable by
--     `authenticated`, so the two REVOKEs in 160400 close the only
--     browser-reachable routes to scheduler authority, with none left over.
--   * All five pg_cron jobs run as `postgres`, so no REVOKE here affects them.
--
-- WHY NOT SECURITY INVOKER for recompute_workflow_rule_schedules
-- It UPDATEs workflow_automation_rules, whose policies were not audited as
-- part of this emergency pass. An INVOKER rewrite would make the function's
-- correctness depend on a policy this change does not verify, and a silent
-- 0-row UPDATE would still report {"status":"success"}. It stays DEFINER with
-- an explicit guard, which fails loudly.
--
-- RLS POSTURE: no policy is created, dropped or widened. The only privilege
-- changes are two REVOKEs that NARROW access, plus grants on the two new
-- wrappers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. recompute_workflow_rule_schedules: ignore the supplied identity, and add
--    the organization term the function never had.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_workflow_rule_schedules(
  p_workflow_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_workflow RECORD;
  v_rule RECORD;
  v_next TIMESTAMPTZ;
  v_updated INT := 0;
  v_unsupported INT := 0;
  v_errors INT := 0;
  v_actor uuid;
BEGIN
  -- Identity comes from the session. p_user_id is accepted for call
  -- compatibility (the frontend passes its own id) and is then discarded, so
  -- a forged argument cannot select whose permissions are checked.
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_workflow
  FROM public.workflows
  WHERE id = p_workflow_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Workflow not found');
  END IF;

  -- The organization term the original function was missing entirely.
  -- Deliberately reported as "not found" rather than "forbidden", so the
  -- response does not confirm that a given uuid exists in another tenant.
  IF v_workflow.organization_id IS DISTINCT FROM public.current_org_id() THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Workflow not found');
  END IF;

  -- Permission: creator or admin collaborator. Unchanged logic, now applied
  -- to v_actor instead of to whatever the caller passed.
  IF v_workflow.created_by != v_actor
     AND NOT EXISTS (
       SELECT 1 FROM public.workflow_collaborations
       WHERE workflow_id = p_workflow_id
         AND user_id = v_actor
         AND permission = 'admin'
     )
  THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Admin permission required');
  END IF;

  FOR v_rule IN
    SELECT id, condition_type, condition_value
    FROM public.workflow_automation_rules
    WHERE workflow_id = p_workflow_id
      AND condition_type = 'time_interval'
      AND is_active = true
  LOOP
    BEGIN
      v_next := public.compute_next_run_at(v_rule.condition_type, v_rule.condition_value, now());

      IF v_next IS NOT NULL THEN
        UPDATE public.workflow_automation_rules
        SET next_run_at = v_next,
            schedule_error = NULL
        WHERE id = v_rule.id;
        v_updated := v_updated + 1;
      ELSE
        UPDATE public.workflow_automation_rules
        SET next_run_at = NULL,
            schedule_error = 'Unsupported recurrence pattern'
        WHERE id = v_rule.id;
        v_unsupported := v_unsupported + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.workflow_automation_rules
      SET schedule_error = SQLERRM
      WHERE id = v_rule.id;
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'success',
    'updated', v_updated,
    'unsupported', v_unsupported,
    'errors', v_errors,
    'total', v_updated + v_unsupported + v_errors
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. run_workflow_rule: the guarded replacement for the browser's direct call
--    to execute_single_automation_rule.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_workflow_rule(p_rule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_workflow_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT r.workflow_id INTO v_workflow_id
  FROM public.workflow_automation_rules r
  JOIN public.workflows w ON w.id = r.workflow_id
  WHERE r.id = p_rule_id
    AND w.organization_id = public.current_org_id();

  IF v_workflow_id IS NULL THEN
    RAISE EXCEPTION 'Rule not found' USING ERRCODE = 'P0002';
  END IF;

  -- Creator or admin collaborator on the owning workflow.
  PERFORM public.assert_workflow_admin(v_workflow_id);

  -- Trigger source is fixed by this function, not by the caller.
  RETURN public.execute_single_automation_rule(p_rule_id, v_actor, 'manual');
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. run_due_workflow_rules: the guarded replacement for the browser's direct
--    call to evaluate_pending_rules. Same advisory lock, but the sweep is
--    restricted to due rules on workflows in the caller's own organization
--    that the caller may administer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_due_workflow_rules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_lock_key BIGINT := hashtext('workflow_rule_scheduler');
  v_rule RECORD;
  v_count INT := 0;
  v_results JSONB := '[]'::JSONB;
  v_exec_result JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  v_org := public.current_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No active organization' USING ERRCODE = '42501';
  END IF;

  IF NOT pg_try_advisory_lock(v_lock_key) THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'Another scheduler instance is running',
      'processed', 0
    );
  END IF;

  BEGIN
    FOR v_rule IN
      SELECT r.id, r.workflow_id, r.rule_name
      FROM public.workflow_automation_rules r
      JOIN public.workflows w ON w.id = r.workflow_id
      WHERE r.is_active = true
        AND r.next_run_at IS NOT NULL
        AND r.next_run_at <= now()
        AND w.organization_id = v_org
        AND (
          w.created_by = v_actor
          OR EXISTS (
            SELECT 1 FROM public.workflow_collaborations c
            WHERE c.workflow_id = w.id
              AND c.user_id = v_actor
              AND c.permission = 'admin'
          )
        )
      ORDER BY r.next_run_at ASC
      LIMIT 50
    LOOP
      v_exec_result := public.execute_single_automation_rule(v_rule.id, v_actor, 'manual');
      v_results := v_results || jsonb_build_object(
        'rule_id', v_rule.id,
        'rule_name', v_rule.rule_name,
        'result', v_exec_result
      );
      v_count := v_count + 1;
    END LOOP;

    PERFORM pg_advisory_unlock(v_lock_key);

    RETURN jsonb_build_object(
      'status', 'success',
      'processed', v_count,
      'results', v_results
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(v_lock_key);
    RAISE;
  END;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Privileges.
--    PostgreSQL grants EXECUTE to PUBLIC on every new function, so each
--    REVOKE ALL ... FROM PUBLIC below is load-bearing, not cosmetic.
--
--    THE TWO BREAKING REVOKES ARE NOT IN THIS FILE. They live in
--    20261106160400_sec_automation_revoke_scheduler_execute.sql so that this
--    migration is purely additive and backward compatible: it can be applied
--    before the frontend deploy with no incompatibility window. See the
--    DEPLOYMENT section in this file's header.
-- ----------------------------------------------------------------------------

-- Restated at their existing level.
REVOKE ALL ON FUNCTION public.recompute_workflow_rule_schedules(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_workflow_rule_schedules(uuid, uuid) TO authenticated, service_role;

-- The new wrappers: the browser's only route to running a rule.
REVOKE ALL ON FUNCTION public.run_workflow_rule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_workflow_rule(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.run_due_workflow_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_due_workflow_rules() TO authenticated, service_role;
