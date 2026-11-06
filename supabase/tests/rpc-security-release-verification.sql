-- =============================================================================
-- RPC security release - production verification
--
-- READ ONLY. One single SELECT, so every client shows the whole result,
-- including the Supabase SQL editor and any tool that returns only the last
-- statement. It creates nothing, changes nothing, holds no lock and needs no
-- transaction, so it is safe to run on production at any time, including
-- between migrations.
--
-- Run it after EACH migration. Every row carries the migration it covers, so
-- a partial release still gives a clean read.
--
-- Migrations covered:
--   A   20261106160000_sec_workflow_structure_rpcs.sql
--   B   20261106160100_sec_list_activity_rpcs.sql
--   C1  20261106160200_sec_automation_rule_rpcs.sql          (additive, safe
--                                                             before the deploy)
--   D   20261106160300_sec_identity_forging_rpcs.sql
--   C2  20261106160400_sec_automation_revoke_scheduler_execute.sql
--                                                            (AFTER the deploy)
--
-- VERDICTS
--   FAIL        act on it
--   PENDING     the covering migration is not applied yet. Expected partway
--               through the release.
--   INVESTIGATE not necessarily wrong, but look before you walk away
--   PASS / INFO nothing to do
--
-- Rows sort worst-first, so if the top row says PASS or PENDING you are done.
-- =============================================================================

WITH
-- =============================================================================
-- 1. EXECUTE grants. The security property IS the grant, and it is the one
--    thing a function body cannot fake.
-- =============================================================================
grant_expect(fn, args, who, should_have, covered_by) AS (
  VALUES
    -- A: the guard helpers are internal plumbing. authenticated must not reach them.
    ('assert_workflow_readable','uuid','authenticated',false,'A'),
    ('assert_workflow_readable','uuid','anon',         false,'A'),
    ('assert_workflow_readable','uuid','service_role',  true,'A'),
    ('assert_workflow_admin',   'uuid','authenticated',false,'A'),
    ('assert_workflow_admin',   'uuid','anon',         false,'A'),
    ('assert_workflow_admin',   'uuid','service_role',  true,'A'),
    -- A: the four repaired functions must stay callable by the app.
    ('copy_workflow_with_unique_name','uuid, text, uuid, boolean','authenticated',true ,'A'),
    ('copy_workflow_with_unique_name','uuid, text, uuid, boolean','anon',         false,'A'),
    ('activate_template_version','uuid','authenticated',true ,'A'),
    ('activate_template_version','uuid','anon',         false,'A'),
    ('create_initial_template_version','uuid','authenticated',true ,'A'),
    ('create_initial_template_version','uuid','anon',         false,'A'),
    ('create_new_template_version','uuid, text, text, text','authenticated',true ,'A'),
    ('create_new_template_version','uuid, text, text, text','anon',         false,'A'),
    -- B
    ('get_list_activity_counts','uuid','authenticated',true ,'B'),
    ('get_list_activity_counts','uuid','anon',         false,'B'),
    ('get_latest_list_activities','uuid[]','authenticated',true ,'B'),
    ('get_latest_list_activities','uuid[]','anon',         false,'B'),
    -- C1
    ('recompute_workflow_rule_schedules','uuid, uuid','authenticated',true ,'C1'),
    ('recompute_workflow_rule_schedules','uuid, uuid','anon',         false,'C1'),
    ('run_workflow_rule','uuid','authenticated',true ,'C1'),
    ('run_workflow_rule','uuid','anon',         false,'C1'),
    ('run_due_workflow_rules','','authenticated',true ,'C1'),
    ('run_due_workflow_rules','','anon',         false,'C1'),
    -- C2: the revokes are the whole point of C2.
    ('execute_single_automation_rule','uuid, uuid, text','authenticated',false,'C2'),
    ('execute_single_automation_rule','uuid, uuid, text','anon',         false,'C2'),
    ('execute_single_automation_rule','uuid, uuid, text','service_role',  true,'C2'),
    ('evaluate_pending_rules','','authenticated',false,'C2'),
    ('evaluate_pending_rules','','anon',         false,'C2'),
    ('evaluate_pending_rules','','service_role',  true,'C2'),
    -- D
    ('mark_conversation_read','uuid, uuid','authenticated',true ,'D'),
    ('mark_conversation_read','uuid, uuid','anon',         false,'D'),
    ('get_or_create_private_view','uuid, uuid','authenticated',true ,'D'),
    ('get_or_create_private_view','uuid, uuid','anon',         false,'D'),
    ('get_or_create_trade_lab','uuid','authenticated',true ,'D'),
    ('get_or_create_trade_lab','uuid','anon',         false,'D'),
    ('ensure_pilot_decision_request_for_user','uuid','authenticated',true ,'D'),
    ('ensure_pilot_decision_request_for_user','uuid','anon',         false,'D'),
    ('ensure_default_scenarios','uuid','authenticated',true ,'D'),
    ('ensure_default_scenarios','uuid','anon',         false,'D')
),
chk_grants AS (
  SELECT
    '1 grants' AS section, e.covered_by,
    e.fn || '(' || e.args || ') -> ' || e.who AS target,
    CASE WHEN e.should_have THEN 'can execute' ELSE 'cannot execute' END AS expected,
    CASE WHEN p.oid IS NULL THEN '(no such function)'
         WHEN has_function_privilege(e.who, p.oid, 'EXECUTE') THEN 'can execute'
         ELSE 'cannot execute' END AS actual,
    CASE WHEN p.oid IS NULL THEN 'PENDING'
         WHEN has_function_privilege(e.who, p.oid, 'EXECUTE') = e.should_have THEN 'PASS'
         ELSE 'FAIL' END AS verdict
  FROM grant_expect e
  -- Matched on NAME ONLY, deliberately. pg_get_function_identity_arguments()
  -- includes parameter NAMES as well as types ("source_workflow_id uuid, ..."),
  -- so joining on a types-only string silently matches nothing and every row
  -- reads PENDING -- a false all-clear. Section 3 proves each of these names
  -- has exactly one signature, which is what makes a name-only match safe; if
  -- an overload ever appears, section 3 FAILS loudly and these rows double up
  -- visibly rather than hiding it. The args column is kept for the label only.
  LEFT JOIN pg_proc p
    ON p.pronamespace = 'public'::regnamespace
   AND p.proname = e.fn
),
-- =============================================================================
-- 2. SECURITY DEFINER vs INVOKER, and a pinned search_path. An unpinned
--    search_path on a DEFINER function resolves unqualified names through the
--    CALLER's search_path.
-- =============================================================================
mode_expect(fn, args, want_definer, covered_by) AS (
  VALUES
    ('assert_workflow_readable','uuid',true,'A'),
    ('assert_workflow_admin','uuid',true,'A'),
    ('copy_workflow_with_unique_name','uuid, text, uuid, boolean',true,'A'),
    ('activate_template_version','uuid',true,'A'),
    ('create_initial_template_version','uuid',true,'A'),
    ('create_new_template_version','uuid, text, text, text',true,'A'),
    -- B: these two MUST become INVOKER. That is the fix, not a detail.
    ('get_list_activity_counts','uuid',false,'B'),
    ('get_latest_list_activities','uuid[]',false,'B'),
    ('recompute_workflow_rule_schedules','uuid, uuid',true,'C1'),
    ('run_workflow_rule','uuid',true,'C1'),
    ('run_due_workflow_rules','',true,'C1'),
    ('mark_conversation_read','uuid, uuid',true,'D'),
    ('get_or_create_private_view','uuid, uuid',true,'D'),
    ('get_or_create_trade_lab','uuid',true,'D'),
    ('ensure_pilot_decision_request_for_user','uuid',true,'D'),
    ('ensure_default_scenarios','uuid',true,'D')
),
chk_mode AS (
  SELECT
    '2 definer+path' AS section, e.covered_by,
    e.fn || '(' || e.args || ')' AS target,
    CASE WHEN e.want_definer THEN 'DEFINER + pinned path' ELSE 'INVOKER + pinned path' END AS expected,
    CASE WHEN p.oid IS NULL THEN '(no such function)'
         ELSE (CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END)
              || ' + ' || coalesce(array_to_string(p.proconfig, ','), 'NO PINNED PATH') END AS actual,
    CASE WHEN p.oid IS NULL THEN 'PENDING'
         WHEN p.prosecdef <> e.want_definer THEN 'FAIL'
         WHEN coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path%' THEN 'FAIL'
         ELSE 'PASS' END AS verdict
  FROM mode_expect e
  -- Name-only match, for the same reason as section 1. See the note there.
  LEFT JOIN pg_proc p
    ON p.pronamespace = 'public'::regnamespace
   AND p.proname = e.fn
),
-- =============================================================================
-- 3. No accidental overloads. CREATE OR REPLACE with a changed parameter list
--    creates a SECOND function rather than replacing the first, and the old
--    vulnerable one keeps its grants. This is the most dangerous way this
--    release could silently fail, so it gets its own check.
-- =============================================================================
chk_overloads AS (
  SELECT
    '3 overloads' AS section, '-' AS covered_by,
    p.proname AS target,
    'exactly 1 signature' AS expected,
    count(*)::text || ': ' || string_agg(pg_get_function_identity_arguments(p.oid), ' ||| ' ORDER BY p.oid) AS actual,
    CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN (
      'copy_workflow_with_unique_name','activate_template_version',
      'create_initial_template_version','create_new_template_version',
      'get_list_activity_counts','get_latest_list_activities',
      'recompute_workflow_rule_schedules','execute_single_automation_rule',
      'evaluate_pending_rules','mark_conversation_read','get_or_create_private_view',
      'get_or_create_trade_lab','ensure_pilot_decision_request_for_user',
      'ensure_default_scenarios','assert_workflow_readable','assert_workflow_admin',
      'run_workflow_rule','run_due_workflow_rules')
  GROUP BY p.proname
),
-- =============================================================================
-- 4. Scheduler containment. After C2 no route to scheduler authority may be
--    reachable by `authenticated`. This catches a function nobody thought of,
--    which is the failure mode a per-function checklist cannot catch.
-- =============================================================================
chk_scheduler AS (
  SELECT
    '4 scheduler reach' AS section, 'C2' AS covered_by,
    p.proname || '()' AS target,
    'not reachable by authenticated' AS expected,
    CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
         THEN 'REACHABLE by authenticated' ELSE 'not reachable' END AS actual,
    CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'FAIL' ELSE 'PASS' END AS verdict
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('execute_single_automation_rule','evaluate_pending_rules',
                      'execute_due_automation_rules','process_branch_ending_rules',
                      'execute_overdue_ending_rules')
),
-- =============================================================================
-- 5. pg_cron untouched. Every job must still be active and still run as
--    `postgres`, which is the reason no REVOKE in this release can affect the
--    real scheduler.
-- =============================================================================
chk_cron AS (
  SELECT
    '5 pg_cron' AS section, '-' AS covered_by,
    'job ' || jobid || ' (' || schedule || ')' AS target,
    'active, as postgres' AS expected,
    CASE WHEN active THEN 'active' ELSE 'DISABLED' END || ', as ' || username
      || ' | ' || left(regexp_replace(command, E'[\\n\\r]+', ' ', 'g'), 48) AS actual,
    CASE WHEN active AND username = 'postgres' THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM cron.job
),
-- =============================================================================
-- 6. Nothing was destroyed. Baselines captured on production 2026-11-06,
--    immediately before the release. Normal use only pushes these UP; a drop
--    means something went very wrong.
-- =============================================================================
baseline(tbl, n) AS (
  VALUES
    ('workflows', 153), ('workflow_stages', 498),
    ('workflow_automation_rules', 79), ('workflow_automation_rules_active', 49),
    ('workflow_template_versions', 50), ('workflow_template_versions_active', 19),
    ('workflow_collaborations', 16), ('asset_lists', 66),
    ('asset_list_activity', 19), ('trade_labs', 28), ('trade_lab_views', 2),
    ('scenarios_default', 138), ('conversation_participants', 18)
),
live(tbl, n) AS (
  SELECT 'workflows', count(*) FROM workflows
  UNION ALL SELECT 'workflow_stages', count(*) FROM workflow_stages
  UNION ALL SELECT 'workflow_automation_rules', count(*) FROM workflow_automation_rules
  UNION ALL SELECT 'workflow_automation_rules_active', count(*) FROM workflow_automation_rules WHERE is_active
  UNION ALL SELECT 'workflow_template_versions', count(*) FROM workflow_template_versions
  UNION ALL SELECT 'workflow_template_versions_active', count(*) FROM workflow_template_versions WHERE is_active
  UNION ALL SELECT 'workflow_collaborations', count(*) FROM workflow_collaborations
  UNION ALL SELECT 'asset_lists', count(*) FROM asset_lists
  UNION ALL SELECT 'asset_list_activity', count(*) FROM asset_list_activity
  UNION ALL SELECT 'trade_labs', count(*) FROM trade_labs
  UNION ALL SELECT 'trade_lab_views', count(*) FROM trade_lab_views
  UNION ALL SELECT 'scenarios_default', count(*) FROM scenarios WHERE is_default
  UNION ALL SELECT 'conversation_participants', count(*) FROM conversation_participants
),
chk_inventory AS (
  SELECT
    '6 inventory' AS section, '-' AS covered_by,
    b.tbl AS target,
    '>= ' || b.n AS expected,
    l.n::text || ' (delta ' || (l.n - b.n) || ')' AS actual,
    CASE WHEN l.n >= b.n THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM baseline b JOIN live l USING (tbl)
),
-- =============================================================================
-- 7. Cross-org integrity signatures. The forensic queries from the pre-release
--    investigation, re-run as a regression check. All five returned 0 on
--    2026-11-06; a non-zero count afterwards means a cross-org write got
--    through anyway.
-- =============================================================================
chk_crossorg AS (
  SELECT '7 cross-org' AS section, '-' AS covered_by, chk AS target,
         '0 rows' AS expected, n::text || ' rows' AS actual,
         CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM (
    SELECT 'workflows.created_by outside own org' AS chk, count(*) AS n
    FROM workflows w WHERE w.organization_id IS NOT NULL AND w.created_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organization_memberships om
                      WHERE om.user_id = w.created_by AND om.organization_id = w.organization_id)
    UNION ALL
    SELECT 'template_versions.created_by outside workflow org', count(*)
    FROM workflow_template_versions v JOIN workflows w ON w.id = v.workflow_id
    WHERE w.organization_id IS NOT NULL AND v.created_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organization_memberships om
                      WHERE om.user_id = v.created_by AND om.organization_id = w.organization_id)
    UNION ALL
    SELECT 'automation_rules.created_by outside workflow org', count(*)
    FROM workflow_automation_rules r JOIN workflows w ON w.id = r.workflow_id
    WHERE w.organization_id IS NOT NULL AND r.created_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organization_memberships om
                      WHERE om.user_id = r.created_by AND om.organization_id = w.organization_id)
    UNION ALL
    SELECT 'trade_labs.created_by outside portfolio org', count(*)
    FROM trade_labs tl JOIN portfolios p ON p.id = tl.portfolio_id
    WHERE p.organization_id IS NOT NULL AND tl.created_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organization_memberships om
                      WHERE om.user_id = tl.created_by AND om.organization_id = p.organization_id)
    UNION ALL
    SELECT 'trade_lab_views.owner_id outside portfolio org', count(*)
    FROM trade_lab_views v JOIN trade_labs tl ON tl.id = v.lab_id
    JOIN portfolios p ON p.id = tl.portfolio_id
    WHERE p.organization_id IS NOT NULL AND v.owner_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM organization_memberships om
                      WHERE om.user_id = v.owner_id AND om.organization_id = p.organization_id)
  ) q
),
-- =============================================================================
-- 8. Automation liveness. workflow_rule_executions is written by the pg_cron
--    scheduler, so a stalled clock shows here within minutes. Read this at
--    T+15min, T+1h and T+24h.
-- =============================================================================
chk_liveness AS (
  SELECT
    '8 liveness' AS section, '-' AS covered_by,
    'last rule execution' AS target,
    'within 24h' AS expected,
    coalesce(
      round(extract(epoch FROM (now() - max(executed_at))) / 60)::text || ' min ago; '
      || count(*) FILTER (WHERE executed_at > now() - interval '1 hour') || ' in the last hour, '
      || count(*) FILTER (WHERE executed_at > now() - interval '24 hours') || ' in 24h',
      'no executions on record') AS actual,
    CASE WHEN max(executed_at) IS NULL THEN 'INFO'
         WHEN max(executed_at) > now() - interval '24 hours' THEN 'PASS'
         ELSE 'INVESTIGATE' END AS verdict
  FROM workflow_rule_executions
),
-- =============================================================================
-- 10. The forged-scheduler signature. workflow_rule_executions records
--     trigger_source, so a row claiming 'scheduler' while also naming a user in
--     executed_by is the fingerprint of the p_trigger_source bypass: the real
--     scheduler path never attributes an execution to a person. After C2 this
--     combination is unreachable from the browser, so any NEW row like it would
--     mean the containment is incomplete.
--
--     MEASURED ON PRODUCTION 2026-11-06, BEFORE THE RELEASE:
--     workflow_rule_executions is COMPLETELY EMPTY. 0 rows, no trigger_source
--     values at all. So this check and section 8 both start from nothing, and
--     a PASS here is uninformative rather than reassuring:
--       * it is NOT evidence that the p_trigger_source bypass was never used,
--         because an execution that short-circuits writes no row, and the
--         exploit demonstration itself returned {"status":"skipped"};
--       * section 8 cannot be used as a liveness signal either until this
--         table has data, so do not read "no executions on record" as a
--         stalled scheduler.
--     Both become useful the first time a rule actually fires. Treat a RISE
--     from 0 in this section as the signal.
-- =============================================================================
chk_forged_scheduler AS (
  SELECT
    '10 forged scheduler' AS section, 'C2' AS covered_by,
    'executions claiming scheduler but naming a user' AS target,
    'no increase over the pre-release count' AS expected,
    count(*)::text || ' total; '
      || count(*) FILTER (WHERE executed_at > now() - interval '24 hours') || ' in the last 24h'
      || coalesce('; most recent ' || max(executed_at)::text, '') AS actual,
    CASE WHEN count(*) FILTER (WHERE executed_at > now() - interval '24 hours') = 0
         THEN 'PASS' ELSE 'INVESTIGATE' END AS verdict
  FROM workflow_rule_executions
  WHERE trigger_source = 'scheduler' AND executed_by IS NOT NULL
),
-- =============================================================================
-- 9. Schedule health. recompute_workflow_rule_schedules writes schedule_error,
--    so a spike here after C1 would mean the tightened function is refusing
--    legitimate callers.
-- =============================================================================
chk_schedules AS (
  SELECT
    '9 schedules' AS section, 'C1' AS covered_by,
    'active automation rules' AS target,
    'none overdue by more than 1h' AS expected,
    count(*) || ' active, '
      || count(*) FILTER (WHERE next_run_at IS NOT NULL) || ' scheduled, '
      || count(*) FILTER (WHERE schedule_error IS NOT NULL) || ' with schedule_error, '
      || count(*) FILTER (WHERE next_run_at IS NOT NULL AND next_run_at < now() - interval '1 hour') || ' overdue >1h' AS actual,
    CASE WHEN count(*) FILTER (WHERE next_run_at IS NOT NULL AND next_run_at < now() - interval '1 hour') = 0
         THEN 'PASS' ELSE 'INVESTIGATE' END AS verdict
  FROM workflow_automation_rules WHERE is_active
),
all_checks AS (
  SELECT * FROM chk_grants
  UNION ALL SELECT * FROM chk_mode
  UNION ALL SELECT * FROM chk_overloads
  UNION ALL SELECT * FROM chk_scheduler
  UNION ALL SELECT * FROM chk_cron
  UNION ALL SELECT * FROM chk_inventory
  UNION ALL SELECT * FROM chk_crossorg
  UNION ALL SELECT * FROM chk_liveness
  UNION ALL SELECT * FROM chk_forged_scheduler
  UNION ALL SELECT * FROM chk_schedules
)
SELECT verdict, section, covered_by AS mig, target, expected, actual
FROM all_checks
ORDER BY
  CASE verdict WHEN 'FAIL' THEN 0 WHEN 'INVESTIGATE' THEN 1 WHEN 'PENDING' THEN 2
               WHEN 'INFO' THEN 3 ELSE 4 END,
  section, covered_by, target;
