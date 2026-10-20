-- =============================================================================
-- Audience management — security regression test for 20-audience-management.sql
--
-- Real `authenticated` and `anon` roles, real request.jwt.claims. Writes
-- fixture rows and deletes them. **NEVER RUN AGAINST PRODUCTION.**
--
-- ── Expected ────────────────────────────────────────────────────────────────
--
--   BEFORE 20-audience-management.sql:  4 PASS, 10 FAIL
--       1, 2, 11 and 14 pass (they assert behaviour that already works);
--       everything else must FAIL, because none of the protections exist yet.
--       If more than four pass, the suite is not observing the defects.
--
--   AFTER:                              14 PASS, 0 FAIL
--
-- Assertion 2 is the one that must pass in BOTH states: ordinary research
-- editing. If it ever fails, the safeguard has broken writing prose and is too
-- tight, which is a worse outcome than the defect it fixes.
--
-- Self-cleaning. 14 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _aud_results;
CREATE TEMP TABLE _aud_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix  text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid := gen_random_uuid();
  v_org_b   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();   -- org A, author
  v_member  uuid := gen_random_uuid();   -- org A, member of the targeted team
  v_other   uuid := gen_random_uuid();   -- org A, member of nothing targeted
  v_outside uuid := gen_random_uuid();   -- org B
  v_asset   uuid := gen_random_uuid();
  v_team1   uuid := gen_random_uuid();   -- org A, team
  v_team2   uuid := gen_random_uuid();   -- org A, team
  v_dept    uuid := gen_random_uuid();   -- org A, department
  v_team_b  uuid := gen_random_uuid();   -- org B, team
  v_c       uuid;                        -- the contribution under test
  v_res     jsonb;
  v_pass    int := 0;
  v_fail    int := 0;
  v_n       int;
  v_txt     text;
  v_msg     text;
BEGIN
  RAISE NOTICE '=== Audience management (suffix: %) ===', v_suffix;

  INSERT INTO auth.users(id) VALUES (v_owner), (v_member), (v_other), (v_outside);
  INSERT INTO organizations(id, name, slug) VALUES
    (v_org_a, 'ZZ Aud A '||v_suffix, 'zz-aud-a-'||v_suffix),
    (v_org_b, 'ZZ Aud B '||v_suffix, 'zz-aud-b-'||v_suffix);
  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_owner, v_member, v_other);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outside;
  INSERT INTO organization_memberships(organization_id, user_id, status) VALUES
    (v_org_a, v_owner,'active'), (v_org_a, v_member,'active'),
    (v_org_a, v_other,'active'), (v_org_b, v_outside,'active');

  INSERT INTO assets(id, symbol, company_name)
  VALUES (v_asset, 'ZZA'||v_suffix, 'ZZ Audience Co '||v_suffix);

  INSERT INTO org_chart_nodes(id, organization_id, node_type, name) VALUES
    (v_team1,  v_org_a, 'team',       'ZZ Team One '||v_suffix),
    (v_team2,  v_org_a, 'team',       'ZZ Team Two '||v_suffix),
    (v_dept,   v_org_a, 'department', 'ZZ Dept '||v_suffix),
    (v_team_b, v_org_b, 'team',       'ZZ Team B '||v_suffix);
  INSERT INTO org_chart_node_members(node_id, user_id, role) VALUES
    (v_team1, v_member, 'member'), (v_team2, v_member, 'member');

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', v_owner, 'role','authenticated')::text);
  INSERT INTO asset_contributions(asset_id, section, content, created_by, visibility, team_id)
  VALUES (v_asset, 'thesis', 'ZZ ORIGINAL PROSE '||v_suffix, v_owner, 'team', v_team1)
  RETURNING id INTO v_c;
  INSERT INTO contribution_visibility_targets(contribution_id, node_id, organization_id)
  VALUES (v_c, v_team1, v_org_a);
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 1. anon cannot execute the function.           PASSES BEFORE AND AFTER
  --    (before: the function does not exist, which also raises)
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.set_contribution_audience(v_c, 'firm', '{}');
    RESET ROLE;
    v_fail := v_fail+1; INSERT INTO _aud_results VALUES (1,'FAIL','anon could execute');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (1,'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. ORDINARY RESEARCH EDITING STILL WORKS.      MUST PASS IN BOTH STATES
  --    A content-only save succeeds and leaves the audience untouched.
  --    If this fails after the fix, the safeguard is too tight.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_contributions SET content = 'ZZ EDITED PROSE '||v_suffix WHERE id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := 'content save raised '||SQLSTATE||' ';
  END;
  SELECT content INTO v_txt FROM asset_contributions WHERE id = v_c;
  IF v_txt IS DISTINCT FROM 'ZZ EDITED PROSE '||v_suffix THEN v_msg := v_msg||'content not saved '; END IF;
  SELECT count(*) INTO v_n FROM contribution_visibility_targets WHERE contribution_id = v_c;
  IF v_n <> 1 THEN v_msg := v_msg||format('audience changed (%s targets) ', v_n); END IF;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (2,'PASS','content save works and leaves the audience alone');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (2,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 3. A STALE CONTENT SAVE CANNOT WIDEN TO FIRM.  FAILS BEFORE
  --    The exact shape an old bundle sends: content plus visibility='firm'.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_contributions
       SET content = 'ZZ STALE SAVE '||v_suffix, visibility = 'firm', team_id = NULL
     WHERE id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  SELECT visibility INTO v_txt FROM asset_contributions WHERE id = v_c;
  IF v_txt = 'team' THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (3,'PASS','visibility pinned against a stale content save');
  ELSE v_fail := v_fail+1;
    INSERT INTO _aud_results VALUES (3,'FAIL', format('visibility widened to %s', v_txt)); END IF;

  -- ===========================================================================
  -- 4. team_id IS PINNED TOO.                      FAILS BEFORE
  -- ===========================================================================
  SELECT (team_id = v_team1) INTO v_msg FROM asset_contributions WHERE id = v_c;
  IF v_msg::boolean THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (4,'PASS','team_id pinned');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (4,'FAIL','team_id was changed'); END IF;

  -- ===========================================================================
  -- 5. DIRECT TARGET DELETION IS REFUSED.          FAILS BEFORE
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM contribution_visibility_targets WHERE contribution_id = v_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  SELECT count(*) INTO v_n FROM contribution_visibility_targets WHERE contribution_id = v_c;
  IF v_n = 1 THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (5,'PASS','direct target delete had no effect');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (5,'FAIL','targets were deleted directly'); END IF;

  -- ===========================================================================
  -- 6. DIRECT TARGET INSERT IS REFUSED.            FAILS BEFORE
  --    Without this, a replace becomes an append and an audience WIDENS.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO contribution_visibility_targets(contribution_id, node_id, organization_id)
    VALUES (v_c, v_team2, v_org_a);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  SELECT count(*) INTO v_n FROM contribution_visibility_targets WHERE contribution_id = v_c;
  IF v_n = 1 THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (6,'PASS','direct target insert had no effect');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (6,'FAIL','a target was added directly'); END IF;

  -- ===========================================================================
  -- 7. RESTRICTED → RESTRICTED replaces, never appends.   FAILS BEFORE
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'team', ARRAY[v_team2]);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := 'call raised '||SQLSTATE||' '; END;
  SELECT count(*) INTO v_n FROM contribution_visibility_targets WHERE contribution_id = v_c;
  IF v_n <> 1 THEN v_msg := v_msg||format('%s targets, expected 1 ', v_n); END IF;
  IF NOT EXISTS (SELECT 1 FROM contribution_visibility_targets
                  WHERE contribution_id = v_c AND node_id = v_team2) THEN
    v_msg := v_msg||'new target missing '; END IF;
  IF EXISTS (SELECT 1 FROM contribution_visibility_targets
              WHERE contribution_id = v_c AND node_id = v_team1) THEN
    v_msg := v_msg||'OLD TARGET SURVIVED — appended, not replaced '; END IF;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (7,'PASS','restricted→restricted replaced the audience');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (7,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 8. RESTRICTED → FIRM clears targets.           FAILS BEFORE
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'firm', '{}');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := 'call raised '||SQLSTATE||' '; END;
  SELECT visibility INTO v_txt FROM asset_contributions WHERE id = v_c;
  IF v_txt <> 'firm' THEN v_msg := v_msg||format('visibility is %s ', v_txt); END IF;
  SELECT count(*) INTO v_n FROM contribution_visibility_targets WHERE contribution_id = v_c;
  IF v_n <> 0 THEN v_msg := v_msg||format('%s targets remain ', v_n); END IF;
  IF (v_res->>'node_count')::int IS DISTINCT FROM 0 THEN v_msg := v_msg||'node_count not 0 '; END IF;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (8,'PASS','restricted→firm cleared the audience and reported it');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (8,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 9. FIRM → RESTRICTED sets an audience and reports it.  FAILS BEFORE
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'team', ARRAY[v_team1, v_team2]);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := 'call raised '||SQLSTATE||' '; END;
  SELECT count(*) INTO v_n FROM contribution_visibility_targets WHERE contribution_id = v_c;
  IF v_n <> 2 THEN v_msg := v_msg||format('%s targets, expected 2 ', v_n); END IF;
  IF (v_res->>'node_count')::int IS DISTINCT FROM 2 THEN v_msg := v_msg||'node_count not 2 '; END IF;
  -- multi-target means team_id is NULL, which after 10- is no longer a grant
  SELECT team_id INTO v_txt FROM asset_contributions WHERE id = v_c;
  IF v_txt IS NOT NULL THEN v_msg := v_msg||'team_id set for a multi-target audience '; END IF;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (9,'PASS','firm→restricted stored two targets and reported them');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (9,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 10. A RESTRICTED SCOPE WITH NO TARGETS IS REFUSED, LOUDLY.   FAILS BEFORE
  --     The rule that used to live only in the client.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'team', '{}');
    RESET ROLE;
    v_msg := 'accepted an empty audience ';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  SELECT count(*) INTO v_n FROM contribution_visibility_targets WHERE contribution_id = v_c;
  IF v_n <> 2 THEN v_msg := v_msg||format('audience damaged by the refused call (%s) ', v_n); END IF;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (10,'PASS','empty restricted audience refused, prior audience intact');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (10,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 11. A NON-AUTHOR CANNOT CHANGE THE AUDIENCE.   PASSES BEFORE AND AFTER
  --     Before: the function is absent, so the call raises anyway. The
  --     assertion checks the AUDIENCE, so it is meaningful in both states.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_other, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'firm', '{}');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  SELECT count(*) INTO v_n FROM contribution_visibility_targets WHERE contribution_id = v_c;
  SELECT visibility INTO v_txt FROM asset_contributions WHERE id = v_c;
  IF v_n = 2 AND v_txt = 'team' THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (11,'PASS','a non-author cannot change the audience');
  ELSE v_fail := v_fail+1;
    INSERT INTO _aud_results VALUES (11,'FAIL', format('non-author changed it (vis=%s, targets=%s)', v_txt, v_n)); END IF;

  -- ===========================================================================
  -- 12. A FOREIGN-ORG NODE IS REFUSED.             FAILS BEFORE
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'team', ARRAY[v_team_b]);
    RESET ROLE;
    v_msg := 'accepted another organization''s node ';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  IF NOT EXISTS (SELECT 1 FROM contribution_visibility_targets
                  WHERE contribution_id = v_c AND node_id = v_team_b) AND v_msg = '' THEN
    v_pass := v_pass+1; INSERT INTO _aud_results VALUES (12,'PASS','foreign-org node refused');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (12,'FAIL', coalesce(nullif(v_msg,''),'foreign node stored')); END IF;

  -- ===========================================================================
  -- 13. A SCOPE/TARGET TYPE MISMATCH IS REFUSED.   FAILS BEFORE
  --     'department' visibility aimed at a team node. The CHECK constraint
  --     cannot see this; only the function can.
  -- ===========================================================================
  v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'department', ARRAY[v_team1]);
    RESET ROLE;
    v_msg := 'accepted a team node for department visibility ';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
  SELECT visibility INTO v_txt FROM asset_contributions WHERE id = v_c;
  IF v_txt <> 'team' THEN v_msg := v_msg||format('visibility changed to %s ', v_txt); END IF;
  IF v_msg = '' THEN v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (13,'PASS','scope/target type mismatch refused');
  ELSE v_fail := v_fail+1; INSERT INTO _aud_results VALUES (13,'FAIL', v_msg); END IF;

  -- ===========================================================================
  -- 14. updated_at IS NOT MOVED BY AN AUDIENCE CHANGE.   PASSES BOTH
  --     Preflight A7: track_contribution_history() stamps updated_at only on a
  --     content or attachment change. This proves the function does not write
  --     it by hand, the way updateVisibility does today.
  -- ===========================================================================
  DECLARE v_before timestamptz; v_after timestamptz;
  BEGIN
    SELECT updated_at INTO v_before FROM asset_contributions WHERE id = v_c;
    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L',
                     json_build_object('sub', v_owner, 'role','authenticated')::text);
      SET LOCAL ROLE authenticated;
      v_res := public.set_contribution_audience(v_c, 'team', ARRAY[v_team1]);
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
    SELECT updated_at INTO v_after FROM asset_contributions WHERE id = v_c;
    IF v_after IS NOT DISTINCT FROM v_before THEN v_pass := v_pass+1;
      INSERT INTO _aud_results VALUES (14,'PASS','an audience change left updated_at alone');
    ELSE v_fail := v_fail+1;
      INSERT INTO _aud_results VALUES (14,'FAIL','updated_at moved on an audience change'); END IF;
  END;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  SET LOCAL request.jwt.claims = '';
  DELETE FROM contribution_visibility_targets WHERE contribution_id = v_c;
  DELETE FROM asset_contribution_history      WHERE contribution_id = v_c;
  DELETE FROM asset_contributions             WHERE id = v_c;
  DELETE FROM org_chart_node_members WHERE node_id IN (v_team1, v_team2, v_dept, v_team_b);
  DELETE FROM org_chart_nodes        WHERE id      IN (v_team1, v_team2, v_dept, v_team_b);
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL
   WHERE id IN (v_owner, v_member, v_other, v_outside);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_owner, v_member, v_other, v_outside);

  RAISE NOTICE '=== RESULTS: % passed, % failed out of 14 ===', v_pass, v_fail;
  RAISE NOTICE 'Before the fix only 1, 2, 11 and 14 may pass.';
END $$;

SELECT n, result, detail FROM _aud_results ORDER BY n, result;
