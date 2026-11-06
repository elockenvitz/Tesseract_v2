-- ============================================================================
-- SECURITY: take scheduler authority off the browser API
-- ============================================================================
-- Group C2 of the cross-tenant RPC remediation. Prepared 2026-11-06. NOT YET
-- APPLIED to any database.
--
-- This file contains nothing but privilege changes, and every one of them
-- NARROWS access. It is split out from 20261106160200 because it is the only
-- part of the automation fix that breaks the currently deployed frontend.
--
-- WHAT IT CLOSES
--
--   execute_single_automation_rule(uuid, uuid, text)
--     Its only authorization is
--       IF p_user_id IS NOT NULL AND p_trigger_source = 'manual' THEN ...
--     Both halves are caller-controlled, so p_trigger_source := 'scheduler'
--     or p_user_id := NULL skips the check entirely. The function body is
--     9.4KB of branching action handlers; revoking EXECUTE is a one-line
--     change that cannot be partially wrong, where transcribing the body to
--     insert a guard would be a large and poorly reviewable change in an
--     emergency release.
--
--   evaluate_pending_rules()
--     No arguments, no caller check, EXECUTE held by `authenticated`. It
--     sweeps up to 50 due rules across EVERY organization and runs each one
--     as execute_single_automation_rule(id, NULL, 'scheduler'). Measured on
--     production 2026-11-06: an org-B user's call PROCESSED AN ORG-A RULE.
--     Confirmed, not suspected.
--
-- WHY THIS BREAKS NOTHING ONCE THE FRONTEND IS DEPLOYED (all measured)
--
--   * src/pages/WorkflowsPage.tsx now calls run_workflow_rule(uuid) and
--     run_due_workflow_rules() instead. After the deploy, no application code
--     references either revoked function. Verified by grep across the whole
--     repository: the only remaining mentions are comments.
--   * No edge function calls either one.
--   * No other database function calls execute_single_automation_rule except
--     evaluate_pending_rules, which itself has no caller left.
--   * The real scheduler is the pg_cron job `SELECT
--     execute_due_automation_rules()`, running every minute as role
--     `postgres`, and it does not call either revoked function. All five
--     pg_cron jobs run as `postgres`, which is unaffected by a revoke from
--     `authenticated`.
--   * run_workflow_rule is SECURITY DEFINER owned by `postgres`, so it can
--     still call execute_single_automation_rule after the revoke.
--   * execute_due_automation_rules, process_branch_ending_rules and
--     execute_overdue_ending_rules are ALREADY not executable by
--     `authenticated`, so after this file there is no browser-reachable route
--     to scheduler authority left over.
--
-- ORDER: apply AFTER 20261106160200 and AFTER the WorkflowsPage.tsx deploy is
-- confirmed green. Applying it before the deploy makes the "Run rule" button
-- fail with 42501.
--
-- IDEMPOTENT: REVOKE and GRANT are both idempotent, so re-running this file
-- is a no-op.
--
-- RLS POSTURE: no policy is created, dropped or widened. No function body is
-- touched. Privilege changes only, all of them narrowing.
-- ============================================================================

-- These two carry scheduler authority. service_role keeps them so that a
-- future server-side scheduler can use them; the browser cannot.
REVOKE EXECUTE ON FUNCTION public.execute_single_automation_rule(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_single_automation_rule(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_single_automation_rule(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_single_automation_rule(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.evaluate_pending_rules() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_pending_rules() FROM anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_pending_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_pending_rules() TO service_role;
