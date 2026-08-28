-- =============================================================================
-- analyst_performance_snapshots Tenant Scope — security regression test
--
-- Proves the boundary that scripts/sql/release-b/05-analyst-performance-snapshots.sql
-- establishes, and — just as importantly — that it does not empty a shipped
-- leaderboard.
--
-- The finding: two permissive policies OR together, so a correct per-user policy
-- is defeated by a sibling that only proves a session exists.
--
--   "Users can manage their own snapshots"      ALL    USING (user_id = auth.uid())
--   "Users can view all performance snapshots"  SELECT USING (auth.uid() IS NOT NULL)
--
-- Against production as it stands on 2026-08-28, assertions 2 and 3 are expected
-- to FAIL. 4 and 5 are the "did we break the product" side and must pass both
-- before and after: PerformanceLeaderboard.tsx and AnalystPerformanceCard.tsx
-- read other users' rows on purpose, and the fix scopes that to the viewer's
-- organization rather than removing it.
--
-- Assertion 3 is the OR-behaviour test: user B is given a row of their own, so
-- the per-user branch matches something. If the broad sibling is still present,
-- B sees A's row as well — which is the whole defect, and is invisible to any
-- test that only checks "can I see my own".
--
-- Self-cleaning. 6 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix  text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid;
  v_org_b   uuid;
  v_user_a  uuid := gen_random_uuid();   -- org A analyst
  v_user_a2 uuid := gen_random_uuid();   -- org A colleague — the leaderboard viewer
  v_user_b  uuid := gen_random_uuid();   -- org B, unrelated
  v_snap_a  uuid;
  v_count   int;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== analyst_performance_snapshots Tenant Scope (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('AP Org A ' || v_suffix, 'ap-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('AP Org B ' || v_suffix, 'ap-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a,  'ap_a_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_a2, 'ap_a2_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b,  'ap_b_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a,  'active', false),
    (v_org_a, v_user_a2, 'active', false),
    (v_org_b, v_user_b,  'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_user_a, v_user_a2);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  INSERT INTO analyst_performance_snapshots
    (user_id, asset_id, period_type, period_start, period_end, hit_rate, overall_score)
    VALUES (v_user_a, NULL, 'all_time', '2020-01-01', '2026-01-01', 71.5, 88)
    RETURNING id INTO v_snap_a;

  -- B gets a row too, so the per-user branch has something to match. Without
  -- this, assertion 3 could pass for the wrong reason.
  INSERT INTO analyst_performance_snapshots
    (user_id, asset_id, period_type, period_start, period_end, hit_rate, overall_score)
    VALUES (v_user_b, NULL, 'all_time', '2020-01-01', '2026-01-01', 44.0, 51);

  -- ===========================================================================
  -- 1. anon reads nothing
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM analyst_performance_snapshots WHERE id = v_snap_a;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'anon reads no performance snapshots');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s snapshot(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. Org B cannot read an org A analyst's performance history
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM analyst_performance_snapshots WHERE id = v_snap_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'org B cannot read org A performance history');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', format('org B read org A performance history (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 3. The broad sibling does not leak through a whole-table read
  --    This is the OR-behaviour assertion: B queries the table with no filter,
  --    the way the leaderboard does. B must see exactly their own row.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM analyst_performance_snapshots
     WHERE user_id IN (v_user_a, v_user_a2, v_user_b);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'unfiltered read returns only the caller''s own row');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('unfiltered read returned %s row(s); expected 1 - a broad permissive sibling is still present', v_count)); END IF;

  -- ===========================================================================
  -- 4. An analyst can still read their own history
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM analyst_performance_snapshots WHERE id = v_snap_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'analyst reads their own performance history');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('analyst CANNOT read their own history (count %s) - over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 5. A SAME-ORG colleague can still read it — the leaderboard must work
  --    If this fails, PerformanceLeaderboard and AnalystPerformanceCard go
  --    blank, and the fix will be reverted by whoever notices.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM analyst_performance_snapshots WHERE id = v_snap_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'same-org colleague can read it - leaderboard still works');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('same-org colleague CANNOT read it (count %s) - the leaderboard is now empty', v_count)); END IF;

  -- ===========================================================================
  -- 6. Nobody can write another analyst's numbers
  --    Checked because the brief asked whether the write side has a broad
  --    sibling too. It does not: the ALL policy is own-user and its empty
  --    WITH CHECK falls back to the same USING. This pins that.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE analyst_performance_snapshots SET overall_score = 100 WHERE id = v_snap_a;
    BEGIN
      INSERT INTO analyst_performance_snapshots
        (user_id, asset_id, period_type, period_start, period_end, hit_rate, overall_score)
        VALUES (v_user_a, NULL, 'yearly', '2025-01-01', '2026-01-01', 99.0, 100);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM analyst_performance_snapshots
   WHERE user_id = v_user_a AND (overall_score = 100 OR period_type = 'yearly');
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'another analyst''s numbers could be neither altered nor fabricated');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', 'a user wrote another analyst''s performance numbers'); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM analyst_performance_snapshots WHERE user_id IN (v_user_a, v_user_a2, v_user_b);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_user_a, v_user_a2, v_user_b);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_a2, v_user_b);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 6 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
