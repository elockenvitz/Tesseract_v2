-- Platform RLS baseline gate (standing ratchet). Emits (n,result,detail) for scripts/security-suite.mjs.
-- Read-only. Asserts the platform perimeter invariants + that no table outside a documented allowlist carries an
-- open USING(true)/CHECK(true) policy to anon/authenticated/public. A NEW org-owned feature that ships an open
-- policy fails this gate (security-by-default enforcement). Remediated tables are REMOVED from the debt allowlist
-- (the ratchet only tightens). Intended for CI via `npm run sec:platform-baseline` (staging/synthetic first).
DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);
DO $$
DECLARE
  -- §4 intentional-global / per-user own-row tables whose open policy is BY DESIGN (documented in SECURITY-REGISTER.md)
  allow_global text[] := ARRAY['asset_classes','assets','estimate_metrics','asset_earnings_dates','asset_tags',
    'asset_tag_assignments','tdf_underlying_funds','user_asset_priorities','user_asset_widgets','user_asset_widget_values','author_follows'];
  -- §3 KNOWN DEBT: open today, scheduled for remediation. Each MUST drop out of this list as its lane lands.
  allow_debt text[] := ARRAY['portfolio_checklist_items','portfolio_checklist_attachments','portfolio_workflow_progress',
    'general_checklist_items','general_workflow_progress','checklist_item_comments','checklist_comment_mentions',
    'checklist_comment_references','checklist_task_assignments','checklist_work_requests','stage_assignments',
    'official_allocation_views','individual_allocation_views','simulation_trades','trade_queue_comments','trade_queue_votes',
    'pair_trades','idea_reactions','coverage_portfolios','asset_team_members','asset_team_history','activity_events',
    'project_activity','asset_list_activity','asset_stage_deadlines','theme_workflow_progress','platform_ai_config'];
  v_cnt int; v_rls int; v_anon int; r record; v_unexpected text := '';
BEGIN
  -- 1. no public table may have RLS disabled
  SELECT count(*) INTO v_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false;
  IF v_rls=0 THEN INSERT INTO _sec_results VALUES (1,'PASS','all public tables have RLS enabled');
  ELSE INSERT INTO _sec_results VALUES (1,'FAIL',format('%s public table(s) have RLS DISABLED',v_rls)); END IF;

  -- 2. no table is anonymously reachable (anon grant + anon/public open SELECT policy)
  SELECT count(*) INTO v_anon FROM (
    SELECT DISTINCT g.table_name FROM information_schema.role_table_grants g
    JOIN pg_policies p ON p.schemaname='public' AND p.tablename=g.table_name
    WHERE g.table_schema='public' AND g.grantee='anon' AND g.privilege_type='SELECT'
      AND p.permissive='PERMISSIVE' AND p.cmd IN ('SELECT','ALL') AND p.qual='true' AND p.roles::text ~ '(anon|public)') z;
  IF v_anon=0 THEN INSERT INTO _sec_results VALUES (2,'PASS','no table is anonymously reachable');
  ELSE INSERT INTO _sec_results VALUES (2,'FAIL',format('%s table(s) anonymously reachable',v_anon)); END IF;

  -- 3. every table with an open policy must be in the global OR debt allowlist (no NEW unsafe feature)
  FOR r IN
    SELECT DISTINCT tablename FROM pg_policies WHERE schemaname='public' AND permissive='PERMISSIVE'
      AND (qual='true' OR with_check='true') AND roles::text ~ '(anon|authenticated|public)'
  LOOP
    IF NOT (r.tablename = ANY(allow_global) OR r.tablename = ANY(allow_debt)) THEN
      v_unexpected := v_unexpected || r.tablename || ' ';
    END IF;
  END LOOP;
  IF v_unexpected='' THEN INSERT INTO _sec_results VALUES (3,'PASS','no open-policy table outside the documented allowlist');
  ELSE INSERT INTO _sec_results VALUES (3,'FAIL',format('NEW open-policy table(s) not in allowlist: %s',v_unexpected)); END IF;

  -- 4. visibility: report the current debt count (informational PASS; shrinks as lanes land)
  SELECT count(*) INTO v_cnt FROM (SELECT DISTINCT tablename FROM pg_policies WHERE schemaname='public'
    AND permissive='PERMISSIVE' AND (qual='true' OR with_check='true') AND roles::text ~ '(anon|authenticated|public)'
    AND tablename = ANY(allow_debt)) z;
  INSERT INTO _sec_results VALUES (4,'PASS',format('open-policy remediation debt remaining: %s tables (tracked in SECURITY-REGISTER.md)',v_cnt));
END $$;
SELECT n, result, detail FROM _sec_results ORDER BY n;
