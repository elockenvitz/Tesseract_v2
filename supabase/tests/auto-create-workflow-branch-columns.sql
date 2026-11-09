-- =============================================================================
-- Regression test — auto_create_workflow_branch() column repair (Migration C)
--
-- WHAT THIS TEST IS
--
-- It exercises the REAL trigger. Every assertion below is reached by inserting
-- into `asset_workflow_progress` and letting
-- `trigger_auto_create_workflow_branch` fire, exactly as the Asset Page does
-- when a user starts a Process. Nothing here inspects `pg_proc.prosrc` or
-- greps the function text: a test that reads source code cannot tell you the
-- statement would execute.
--
-- HOW TO RUN IT
--
-- Everything runs inside ONE transaction that always ends in ROLLBACK, so no
-- fixture, workflow, branch, run or audit row survives. `CREATE OR REPLACE
-- FUNCTION` is transactional in Postgres, so the function body swaps below are
-- rolled back too and production is left untouched.
--
--   Mode 1 — PRE-DEPLOYMENT REHEARSAL (expected: all PASS)
--     BEGIN;
--       <paste 20261023140000_fix_auto_create_workflow_branch_columns.sql
--        WITHOUT its own BEGIN/COMMIT>
--       <paste PART 1..7 of this file>
--     ROLLBACK;
--
--   Mode 2 — NON-VACUITY GATE (expected: PART 8 reports PASS, meaning the
--            broken body really does fail)
--     BEGIN;
--       <paste the DOWN rollback body WITHOUT its BEGIN/COMMIT>
--       <paste PART 1..2 and PART 8 of this file>
--     ROLLBACK;
--
--   Mode 3 — POST-DEPLOYMENT VERIFICATION (expected: all PASS)
--     BEGIN; <paste PART 1..7>; ROLLBACK;
--
-- The test is deliberately composed with the migration rather than carrying
-- its own copy of the corrected body. A test holding a private copy of the
-- function would pass while the shipped migration was wrong.
--
-- COVERAGE — all five broken statements are reached:
--   PART 3  version-path stage INSERT      (stage_order, checklist_template)
--   PART 3  collaborations INSERT          (permission_level)
--   PART 5  parent-copy stage INSERT       (stage_order x3, checklist_template x2)
--   PART 6  general-scope SELECT ORDER BY  (stage_order)
--   PART 7  asset progress copy INSERT     (current_stage, checklist_progress,
--                                           assigned_at)
-- =============================================================================


-- =============================================================================
-- PART 1 — Result collector
-- =============================================================================
CREATE TEMP TABLE _t(n int generated always as identity, name text, pass boolean, detail text);

CREATE OR REPLACE FUNCTION _ok(p_name text, p_pass boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _t(name, pass, detail) VALUES (p_name, p_pass, p_detail);
END; $$;


-- =============================================================================
-- PART 2 — Fixtures
--
-- Uses a real organization and a real active member, because the branch's
-- organization_id is stamped from current_org_id() -> users.current_organization_id,
-- which requires an active membership. Nothing is created outside this org.
-- =============================================================================
CREATE TEMP TABLE _f(k text primary key, v uuid);

DO $$
DECLARE
  v_user uuid; v_org uuid; v_asset1 uuid; v_asset2 uuid;
BEGIN
  -- An active member whose current_organization_id is that same active membership.
  SELECT u.id, u.current_organization_id INTO v_user, v_org
  FROM users u
  JOIN organization_memberships om
    ON om.user_id = u.id
   AND om.organization_id = u.current_organization_id
   AND om.status = 'active'
   AND (om.expires_at IS NULL OR om.expires_at > now())
  WHERE is_org_archived(u.current_organization_id) IS NOT TRUE
  LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: no active member found; cannot test org stamping';
  END IF;

  INSERT INTO _f(k, v) VALUES ('user', v_user), ('org', v_org);

  -- Act as that user so auth.uid() / current_org_id() resolve.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  -- Two assets: one the run is started on, one to be picked up by the copy path.
  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTA', 'Migration C Fixture A') RETURNING id INTO v_asset1;
  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTB', 'Migration C Fixture B') RETURNING id INTO v_asset2;
  INSERT INTO _f(k, v) VALUES ('asset1', v_asset1), ('asset2', v_asset2);
END $$;

-- Sanity: the fixture user really is resolvable, otherwise every org assertion
-- below would pass vacuously against NULL = NULL.
DO $$
BEGIN
  PERFORM _ok('fixture: current_org_id() resolves to the fixture org',
    current_org_id() = (SELECT v FROM _f WHERE k='org'),
    coalesce(current_org_id()::text,'NULL'));
  PERFORM _ok('fixture: auth.uid() resolves to the fixture user',
    auth.uid() = (SELECT v FROM _f WHERE k='user'),
    coalesce(auth.uid()::text,'NULL'));
END $$;


-- =============================================================================
-- PART 3 — Scenario A: a valid branch-configured workflow starts
--
-- asset scope, branch_nocopy, active template version with 3 stages in a
-- deliberately NON-sequential order_index so that "ordering preserved" is a
-- real claim and not an artifact of insertion order.
-- =============================================================================
DO $$
DECLARE
  v_org uuid; v_user uuid; v_asset1 uuid;
  v_root uuid; v_ver uuid; v_run uuid; v_branch uuid; v_err text;
BEGIN
  SELECT v INTO v_org    FROM _f WHERE k='org';
  SELECT v INTO v_user   FROM _f WHERE k='user';
  SELECT v INTO v_asset1 FROM _f WHERE k='asset1';

  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public, organization_id, status)
  VALUES ('ZZ Migration C Root A', 'fixture', '#111111', 'asset', v_user, true, v_org, 'active')
  RETURNING id INTO v_root;
  INSERT INTO _f(k,v) VALUES ('rootA', v_root);

  INSERT INTO workflow_template_versions (workflow_id, version_number, is_active, stages, created_by)
  VALUES (v_root, 1, true, '[
      {"key":"review","name":"Review","description":"d1","color":"#aaa","order_index":2},
      {"key":"intake","name":"Intake","description":"d2","color":"#bbb","order_index":0},
      {"key":"decide","name":"Decide","description":"d3","color":"#ccc","order_index":1}
    ]'::jsonb, v_user)
  RETURNING id INTO v_ver;
  INSERT INTO _f(k,v) VALUES ('verA', v_ver);

  INSERT INTO workflow_automation_rules
    (workflow_id, rule_name, rule_type, rule_category, condition_type, condition_value,
     action_type, action_value, is_active)
  VALUES (v_root, 'ZZ C nocopy', 'time', 'branch_creation', 'time_interval', '{}'::jsonb,
          'branch_nocopy', '{"branch_suffix":"{MONTH} {YEAR}"}'::jsonb, true);

  -- A collaboration on the root, so the permission/permission_level statement
  -- actually copies a row instead of succeeding on an empty set. 'admin' is
  -- used rather than the column default 'read', so A9 proves the value was
  -- copied and not merely defaulted. (CHECK allows only 'admin' | 'read'.)
  -- invited_by is set because notify_workflow_sharing() NULL-propagates its
  -- message through string concatenation and would raise 23502 without it.
  INSERT INTO workflow_collaborations (workflow_id, user_id, permission, invited_by)
  VALUES (v_root, v_user, 'admin', v_user);

  -- === FIRE THE TRIGGER ===
  BEGIN
    INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, started_at, current_stage_key)
    VALUES (v_asset1, v_root, true, now(), 'intake')
    RETURNING id, workflow_id INTO v_run, v_branch;
    PERFORM _ok('A1 starting a branch-configured Process succeeds', true, 'run '||v_run);
  EXCEPTION WHEN OTHERS THEN
    PERFORM _ok('A1 starting a branch-configured Process succeeds', false, SQLSTATE||' '||SQLERRM);
    RETURN;
  END;

  INSERT INTO _f(k,v) VALUES ('runA', v_run), ('branchA', v_branch);

  PERFORM _ok('A2 run was redirected onto a NEW branch, not the root',
    v_branch IS NOT NULL AND v_branch <> v_root, 'branch '||v_branch);

  PERFORM _ok('A3 exactly one branch was created under the root',
    (SELECT count(*) FROM workflows WHERE parent_workflow_id = v_root) = 1,
    (SELECT count(*)::text FROM workflows WHERE parent_workflow_id = v_root));

  PERFORM _ok('A4 branch points at the active template version',
    (SELECT template_version_id FROM workflows WHERE id = v_branch) = v_ver);

  PERFORM _ok('A5 all three stages were copied to the branch',
    (SELECT count(*) FROM workflow_stages WHERE workflow_id = v_branch) = 3,
    (SELECT count(*)::text FROM workflow_stages WHERE workflow_id = v_branch));

  -- Ordering is the whole point of sort_order: assert the mapping, not the count.
  PERFORM _ok('A6 stage ordering preserved from order_index into sort_order',
    (SELECT array_agg(stage_key ORDER BY sort_order)
       FROM workflow_stages WHERE workflow_id = v_branch) = ARRAY['intake','decide','review'],
    (SELECT array_agg(stage_key||':'||sort_order ORDER BY sort_order)
       FROM workflow_stages WHERE workflow_id = v_branch)::text);

  -- The trap a mechanical rename would have fallen into.
  PERFORM _ok('A7 checklist_items defaulted to [] and is never NULL',
    (SELECT count(*) FROM workflow_stages
      WHERE workflow_id = v_branch AND checklist_items = '[]'::jsonb) = 3
    AND (SELECT count(*) FROM workflow_stages
      WHERE workflow_id = v_branch AND checklist_items IS NULL) = 0);

  PERFORM _ok('A8 branch carries the correct organization',
    (SELECT organization_id FROM workflows WHERE id = v_branch) = v_org
    AND (SELECT organization_id FROM workflows WHERE id = v_branch)
      = (SELECT organization_id FROM workflows WHERE id = v_root));

  PERFORM _ok('A9 collaborations copied with permission preserved',
    (SELECT count(*) FROM workflow_collaborations
      WHERE workflow_id = v_branch AND user_id = v_user AND permission = 'admin') = 1,
    (SELECT count(*)::text FROM workflow_collaborations WHERE workflow_id = v_branch));

  -- Without invited_by the copy dies in notify_workflow_sharing() with 23502.
  PERFORM _ok('A10 copied collaboration carries a non-null invited_by',
    (SELECT count(*) FROM workflow_collaborations
      WHERE workflow_id = v_branch AND invited_by IS NULL) = 0);
END $$;


-- =============================================================================
-- PART 4 — Audit events for the run that actually started (Migration B seam)
-- =============================================================================
DO $$
DECLARE v_run uuid; v_org uuid; v_user uuid; v_dupes int;
BEGIN
  SELECT v INTO v_run  FROM _f WHERE k='runA';
  SELECT v INTO v_org  FROM _f WHERE k='org';
  SELECT v INTO v_user FROM _f WHERE k='user';
  IF v_run IS NULL THEN
    PERFORM _ok('B* audit assertions', false, 'skipped: scenario A did not start');
    RETURN;
  END IF;

  -- audit_events names these columns action_type and org_id.
  PERFORM _ok('B1 audit event written for the run that started',
    (SELECT count(*) FROM audit_events
      WHERE entity_type = 'process_run' AND entity_id = v_run) >= 1,
    (SELECT coalesce(string_agg(DISTINCT action_type, ','),'(none)') FROM audit_events
      WHERE entity_type = 'process_run' AND entity_id = v_run));

  -- "No duplicate events" stated as a real uniqueness claim per (run, action_type).
  SELECT count(*) INTO v_dupes FROM (
    SELECT action_type FROM audit_events
    WHERE entity_type = 'process_run' AND entity_id = v_run
    GROUP BY action_type HAVING count(*) > 1
  ) d;
  PERFORM _ok('B2 no duplicate audit events for the run', v_dupes = 0,
    'duplicated action_types: '||v_dupes);

  PERFORM _ok('B3 audit events carry the acting user as actor',
    (SELECT count(*) FROM audit_events
      WHERE entity_type = 'process_run' AND entity_id = v_run
        AND actor_id IS DISTINCT FROM v_user) = 0);

  PERFORM _ok('B4 audit events carry the correct organization',
    (SELECT count(*) FROM audit_events
      WHERE entity_type = 'process_run' AND entity_id = v_run
        AND org_id IS DISTINCT FROM v_org) = 0);

  -- The branch-creation cascade must not manufacture events for runs that were
  -- never started (the documented not-started ELSE branch in
  -- auto_start_manually_added_asset).
  PERFORM _ok('B5 no process_run start events for runs that are not started',
    (SELECT count(*) FROM audit_events ae
      JOIN asset_workflow_progress awp ON awp.id = ae.entity_id
     WHERE ae.entity_type = 'process_run'
       AND awp.is_started IS NOT TRUE
       AND ae.action_type LIKE '%start%') = 0);
END $$;


-- =============================================================================
-- PART 5 — Scenario B: no active template version -> parent-copy stage path
-- Reaches the ELSE INSERT, which referenced stage_order on BOTH sides plus
-- ORDER BY stage_order, and copied checklist_template.
-- =============================================================================
DO $$
DECLARE
  v_org uuid; v_user uuid; v_asset uuid; v_root uuid; v_branch uuid; v_run uuid;
BEGIN
  SELECT v INTO v_org  FROM _f WHERE k='org';
  SELECT v INTO v_user FROM _f WHERE k='user';

  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTC', 'Migration C Fixture C') RETURNING id INTO v_asset;

  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public, organization_id, status)
  VALUES ('ZZ Migration C Root B', 'fixture', '#222222', 'asset', v_user, true, v_org, 'active')
  RETURNING id INTO v_root;

  -- No workflow_template_versions row at all -> v_active_version.id IS NULL.
  INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, stage_description, stage_color, sort_order, checklist_items)
  VALUES (v_root, 'two',   'Two',   'd', '#aaa', 1, '[{"text":"second"}]'::jsonb),
         (v_root, 'one',   'One',   'd', '#bbb', 0, '[{"text":"first"}]'::jsonb),
         (v_root, 'three', 'Three', 'd', '#ccc', 2, '[]'::jsonb);

  INSERT INTO workflow_automation_rules
    (workflow_id, rule_name, rule_type, rule_category, condition_type, condition_value,
     action_type, action_value, is_active)
  VALUES (v_root, 'ZZ C nocopy nover', 'time', 'branch_creation', 'time_interval', '{}'::jsonb,
          'branch_nocopy', '{"branch_suffix":"NoVer"}'::jsonb, true);

  BEGIN
    INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, started_at, current_stage_key)
    VALUES (v_asset, v_root, true, now(), 'one')
    RETURNING id, workflow_id INTO v_run, v_branch;
    PERFORM _ok('C1 parent-copy stage path succeeds (no active version)', true, 'branch '||v_branch);
  EXCEPTION WHEN OTHERS THEN
    PERFORM _ok('C1 parent-copy stage path succeeds (no active version)', false, SQLSTATE||' '||SQLERRM);
    RETURN;
  END;

  PERFORM _ok('C2 stages copied from parent with ordering preserved',
    (SELECT array_agg(stage_key ORDER BY sort_order)
       FROM workflow_stages WHERE workflow_id = v_branch) = ARRAY['one','two','three'],
    (SELECT array_agg(stage_key||':'||sort_order ORDER BY sort_order)
       FROM workflow_stages WHERE workflow_id = v_branch)::text);

  PERFORM _ok('C3 parent checklist_items copied, not discarded',
    (SELECT checklist_items FROM workflow_stages
      WHERE workflow_id = v_branch AND stage_key = 'one') = '[{"text":"first"}]'::jsonb);
END $$;


-- =============================================================================
-- PART 6 — Scenario C: general scope -> SELECT ... ORDER BY stage_order
-- =============================================================================
DO $$
DECLARE v_org uuid; v_user uuid; v_root uuid; v_asset uuid; v_branch uuid; v_run uuid;
BEGIN
  SELECT v INTO v_org  FROM _f WHERE k='org';
  SELECT v INTO v_user FROM _f WHERE k='user';

  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTD', 'Migration C Fixture D') RETURNING id INTO v_asset;

  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public, organization_id, status)
  VALUES ('ZZ Migration C Root C', 'fixture', '#333333', 'general', v_user, true, v_org, 'active')
  RETURNING id INTO v_root;

  INSERT INTO workflow_template_versions (workflow_id, version_number, is_active, stages, created_by)
  VALUES (v_root, 1, true, '[
      {"key":"later","name":"Later","description":"d","color":"#aaa","order_index":5},
      {"key":"earliest","name":"Earliest","description":"d","color":"#bbb","order_index":1}
    ]'::jsonb, v_user);

  INSERT INTO workflow_automation_rules
    (workflow_id, rule_name, rule_type, rule_category, condition_type, condition_value,
     action_type, action_value, is_active)
  VALUES (v_root, 'ZZ C general', 'time', 'branch_creation', 'time_interval', '{}'::jsonb,
          'branch_nocopy', '{"branch_suffix":"Gen"}'::jsonb, true);

  BEGIN
    INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, started_at)
    VALUES (v_asset, v_root, true, now())
    RETURNING id, workflow_id INTO v_run, v_branch;
    PERFORM _ok('D1 general-scope branch path succeeds', true, 'branch '||v_branch);
  EXCEPTION WHEN OTHERS THEN
    PERFORM _ok('D1 general-scope branch path succeeds', false, SQLSTATE||' '||SQLERRM);
    RETURN;
  END;

  -- The ORDER BY must pick the LOWEST sort_order, not merely some stage.
  PERFORM _ok('D2 general progress opens on the lowest-ordered stage',
    (SELECT current_stage_key FROM general_workflow_progress WHERE workflow_id = v_branch) = 'earliest',
    coalesce((SELECT current_stage_key FROM general_workflow_progress WHERE workflow_id = v_branch),'NULL'));
END $$;


-- =============================================================================
-- PART 7 — Scenario D: branch_copy with a prior branch -> asset progress copy
-- The statement that referenced current_stage, checklist_progress, assigned_at.
-- =============================================================================
DO $$
DECLARE
  v_org uuid; v_user uuid; v_root uuid; v_prior uuid; v_ver uuid;
  v_a1 uuid; v_a2 uuid; v_run uuid; v_branch uuid; v_copied int;
BEGIN
  SELECT v INTO v_org  FROM _f WHERE k='org';
  SELECT v INTO v_user FROM _f WHERE k='user';

  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTE', 'Migration C Fixture E') RETURNING id INTO v_a1;
  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTF', 'Migration C Fixture F') RETURNING id INTO v_a2;

  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public, organization_id, status)
  VALUES ('ZZ Migration C Root D', 'fixture', '#444444', 'asset', v_user, true, v_org, 'active')
  RETURNING id INTO v_root;

  -- Active version v2, and a PRIOR branch on v1. The guard counts branches of
  -- the ACTIVE version (0, so it proceeds) while the copy source lookup is
  -- version-agnostic (finds the v1 branch) -- which is exactly how the copy
  -- path becomes reachable.
  INSERT INTO workflow_template_versions (workflow_id, version_number, is_active, stages, created_by)
  VALUES (v_root, 2, true,
    '[{"key":"s1","name":"S1","description":"d","color":"#aaa","order_index":0}]'::jsonb, v_user)
  RETURNING id INTO v_ver;

  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public,
                         organization_id, status, parent_workflow_id, template_version_number, branched_at)
  VALUES ('ZZ Migration C Root D - prior', 'fixture', '#444444', 'asset', v_user, false,
          v_org, 'active', v_root, 1, now() - interval '1 day')
  RETURNING id INTO v_prior;

  INSERT INTO workflow_stages (workflow_id, stage_key, stage_label, sort_order, checklist_items)
  VALUES (v_prior, 's1', 'S1', 0, '[]'::jsonb);

  -- Progress on the prior branch: one row for the asset we will start on
  -- (must be EXCLUDED to avoid the unique key) and one for another asset
  -- (must be INCLUDED).
  INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, started_at, started_by, current_stage_key, is_completed)
  VALUES (v_a1, v_prior, true, now() - interval '2 hours', v_user, 's1', true),
         (v_a2, v_prior, true, now() - interval '3 hours', v_user, 's1', true);

  INSERT INTO workflow_automation_rules
    (workflow_id, rule_name, rule_type, rule_category, condition_type, condition_value,
     action_type, action_value, is_active)
  VALUES (v_root, 'ZZ C copy', 'time', 'branch_creation', 'time_interval', '{}'::jsonb,
          'branch_copy', '{"branch_suffix":"Copy"}'::jsonb, true);

  BEGIN
    INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, started_at, current_stage_key)
    VALUES (v_a1, v_root, true, now(), 's1')
    RETURNING id, workflow_id INTO v_run, v_branch;
    PERFORM _ok('E1 branch_copy progress-copy path succeeds', true, 'branch '||v_branch);
  EXCEPTION WHEN OTHERS THEN
    PERFORM _ok('E1 branch_copy progress-copy path succeeds', false, SQLSTATE||' '||SQLERRM);
    RETURN;
  END;

  PERFORM _ok('E2 branch records its copy source',
    (SELECT source_branch_id FROM workflows WHERE id = v_branch) = v_prior);

  -- Exactly 2 runs on the new branch: the firing row (asset1) + the copied
  -- row (asset2). 3 would mean the asset_id != NEW.asset_id guard was lost.
  SELECT count(*) INTO v_copied FROM asset_workflow_progress WHERE workflow_id = v_branch;
  PERFORM _ok('E3 copy excludes the firing asset (no unique-key collision)',
    v_copied = 2
    AND (SELECT count(*) FROM asset_workflow_progress
          WHERE workflow_id = v_branch AND asset_id = v_a1) = 1
    AND (SELECT count(*) FROM asset_workflow_progress
          WHERE workflow_id = v_branch AND asset_id = v_a2) = 1,
    'runs on branch: '||v_copied);

  PERFORM _ok('E4 copied run preserves current_stage_key and started_by',
    (SELECT current_stage_key FROM asset_workflow_progress
      WHERE workflow_id = v_branch AND asset_id = v_a2) = 's1'
    AND (SELECT started_by FROM asset_workflow_progress
      WHERE workflow_id = v_branch AND asset_id = v_a2) = v_user);

  PERFORM _ok('E5 copied run is reset to not-completed',
    (SELECT is_completed FROM asset_workflow_progress
      WHERE workflow_id = v_branch AND asset_id = v_a2) IS NOT TRUE);
END $$;


-- =============================================================================
-- PART 7b — A failed transaction leaves no partial Process and no audit rows
--
-- Forced from inside a savepoint by making the branch INSERT fail AFTER the
-- trigger has already created the branch and its stages. If any of that
-- survived the rollback, the Process would be half-created.
-- =============================================================================
DO $$
DECLARE
  v_org uuid; v_user uuid; v_root uuid; v_asset uuid;
  v_wf_before int; v_run_before int; v_audit_before int;
  v_wf_after int;  v_run_after int;  v_audit_after int;
  v_failed boolean := false;
BEGIN
  SELECT v INTO v_org  FROM _f WHERE k='org';
  SELECT v INTO v_user FROM _f WHERE k='user';

  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTG', 'Migration C Fixture G') RETURNING id INTO v_asset;

  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public, organization_id, status)
  VALUES ('ZZ Migration C Root E', 'fixture', '#555555', 'asset', v_user, true, v_org, 'active')
  RETURNING id INTO v_root;

  INSERT INTO workflow_template_versions (workflow_id, version_number, is_active, stages, created_by)
  VALUES (v_root, 1, true,
    '[{"key":"s1","name":"S1","description":"d","color":"#aaa","order_index":0}]'::jsonb, v_user);

  INSERT INTO workflow_automation_rules
    (workflow_id, rule_name, rule_type, rule_category, condition_type, condition_value,
     action_type, action_value, is_active)
  VALUES (v_root, 'ZZ C abort', 'time', 'branch_creation', 'time_interval', '{}'::jsonb,
          'branch_nocopy', '{"branch_suffix":"Abort"}'::jsonb, true);

  SELECT count(*) INTO v_wf_before    FROM workflows WHERE parent_workflow_id = v_root;
  SELECT count(*) INTO v_run_before   FROM asset_workflow_progress WHERE asset_id = v_asset;
  SELECT count(*) INTO v_audit_before FROM audit_events WHERE entity_type = 'process_run';

  BEGIN
    -- NULL asset_id violates NOT NULL, but only after the BEFORE trigger has
    -- run and built the branch.
    INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, started_at)
    VALUES (NULL, v_root, true, now());
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  SELECT count(*) INTO v_wf_after    FROM workflows WHERE parent_workflow_id = v_root;
  SELECT count(*) INTO v_run_after   FROM asset_workflow_progress WHERE asset_id = v_asset;
  SELECT count(*) INTO v_audit_after FROM audit_events WHERE entity_type = 'process_run';

  PERFORM _ok('F1 the deliberately-failing start did fail', v_failed, 'failed='||v_failed);
  PERFORM _ok('F2 failed start left no orphan branch workflow',
    v_wf_after = v_wf_before, v_wf_before||' -> '||v_wf_after);
  PERFORM _ok('F3 failed start left no Process run',
    v_run_after = v_run_before, v_run_before||' -> '||v_run_after);
  PERFORM _ok('F4 failed start left no audit records',
    v_audit_after = v_audit_before, v_audit_before||' -> '||v_audit_after);
END $$;


-- =============================================================================
-- PART 8 — NON-VACUITY GATE (Mode 2 only)
--
-- Run this with the ORIGINAL BROKEN body installed. It asserts the gate can
-- observe its own failure mode. The two rule types fail DIFFERENTLY and both
-- must be observed, otherwise the gate only proves half the defect:
--
--   G1  branch_nocopy -> 55000, the unassigned v_copy_from_branch RECORD,
--                        raised at INSERT INTO workflows before any column
--                        problem is reached.
--   G2  branch_copy with a prior branch -> 42703, the dead stage_order column.
--
-- If both report PASS while the broken body is installed, the suite is real.
-- If either reports FAIL, the test is decoration for that failure mode.
-- =============================================================================
DO $$
DECLARE
  v_org uuid; v_user uuid; v_root uuid; v_asset uuid;
  v_state text := '(no error raised)'; v_msg text := '';
BEGIN
  SELECT v INTO v_org  FROM _f WHERE k='org';
  SELECT v INTO v_user FROM _f WHERE k='user';

  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTH', 'Migration C Fixture H') RETURNING id INTO v_asset;

  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public, organization_id, status)
  VALUES ('ZZ Migration C Root F', 'fixture', '#666666', 'asset', v_user, true, v_org, 'active')
  RETURNING id INTO v_root;

  INSERT INTO workflow_template_versions (workflow_id, version_number, is_active, stages, created_by)
  VALUES (v_root, 1, true,
    '[{"key":"s1","name":"S1","description":"d","color":"#aaa","order_index":0}]'::jsonb, v_user);

  INSERT INTO workflow_automation_rules
    (workflow_id, rule_name, rule_type, rule_category, condition_type, condition_value,
     action_type, action_value, is_active)
  VALUES (v_root, 'ZZ C vacuity nocopy', 'time', 'branch_creation', 'time_interval', '{}'::jsonb,
          'branch_nocopy', '{"branch_suffix":"Vac"}'::jsonb, true);

  BEGIN
    INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, started_at)
    VALUES (v_asset, v_root, true, now());
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  PERFORM _ok('G1 GATE: branch_nocopy on broken body raises 55000 unassigned record',
    v_state = '55000', v_state||' '||v_msg);
END $$;

DO $$
DECLARE
  v_org uuid; v_user uuid; v_root uuid; v_prior uuid; v_asset uuid;
  v_state text := '(no error raised)'; v_msg text := '';
BEGIN
  SELECT v INTO v_org  FROM _f WHERE k='org';
  SELECT v INTO v_user FROM _f WHERE k='user';

  -- assets is global reference data: no organization_id column by design.
  INSERT INTO assets (symbol, company_name)
  VALUES ('ZZTESTI', 'Migration C Fixture I') RETURNING id INTO v_asset;

  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public, organization_id, status)
  VALUES ('ZZ Migration C Root G', 'fixture', '#777777', 'asset', v_user, true, v_org, 'active')
  RETURNING id INTO v_root;

  INSERT INTO workflow_template_versions (workflow_id, version_number, is_active, stages, created_by)
  VALUES (v_root, 2, true,
    '[{"key":"s1","name":"S1","description":"d","color":"#aaa","order_index":0}]'::jsonb, v_user);

  -- A prior branch on an older version, so v_copy_from_branch IS assigned and
  -- execution reaches the stage INSERT where stage_order is referenced.
  INSERT INTO workflows (name, description, color, scope_type, created_by, is_public,
                         organization_id, status, parent_workflow_id, template_version_number, branched_at)
  VALUES ('ZZ Migration C Root G - prior', 'fixture', '#777777', 'asset', v_user, false,
          v_org, 'active', v_root, 1, now() - interval '1 day')
  RETURNING id INTO v_prior;

  INSERT INTO workflow_automation_rules
    (workflow_id, rule_name, rule_type, rule_category, condition_type, condition_value,
     action_type, action_value, is_active)
  VALUES (v_root, 'ZZ C vacuity copy', 'time', 'branch_creation', 'time_interval', '{}'::jsonb,
          'branch_copy', '{"branch_suffix":"VacCopy"}'::jsonb, true);

  BEGIN
    INSERT INTO asset_workflow_progress (asset_id, workflow_id, is_started, started_at)
    VALUES (v_asset, v_root, true, now());
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  PERFORM _ok('G2 GATE: branch_copy on broken body raises 42703 undefined_column',
    v_state = '42703', v_state||' '||v_msg);
END $$;


-- =============================================================================
-- RESULTS
-- =============================================================================
SELECT n, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name, detail
FROM _t ORDER BY n;
