-- =============================================================================
-- Audience management — security regression test for 20-audience-management.sql
--
-- Real `authenticated` and `anon` roles, real request.jwt.claims. Writes
-- synthetic fixture rows and deletes them.
--
-- ── Running this against production ─────────────────────────────────────────
--
-- An earlier header said NEVER RUN AGAINST PRODUCTION. That blanket warning is
-- replaced by the conditions that actually make it safe, because
-- docs/contribution-visibility-deployment.md §2 requires this suite as the
-- Step 2 baseline. It is sanctioned against production ONLY when all of these
-- hold, and none of them may be relaxed:
--
--   1. The whole file reaches the server as ONE statement batch under
--      autocommit — `psql -f`, the Supabase SQL Editor, or a single
--      Supabase MCP execute_sql call (verified: one call is one transaction
--      and one session).
--   2. **Do NOT wrap it in an explicit BEGIN.** A transaction committed
--      despite an earlier error would defeat the rollback guarantee.
--   3. Every fixture is created and destroyed inside the one `DO` block:
--      success runs cleanup, a caught assertion failure is a subtransaction so
--      cleanup still runs, and an uncaught error aborts the single statement
--      and takes every fixture with it.
--   4. It creates only `ZZ`-prefixed synthetic organizations, users, assets,
--      org-chart nodes and contributions. No pre-existing research,
--      contribution, visibility value, target row or audit record is read or
--      written at any point.
--
-- If any of those four cannot be guaranteed, do not run it against production.
--
-- ── Expected ────────────────────────────────────────────────────────────────
--
--   BEFORE 20-audience-management.sql:  4 PASS, 9 FAIL, 1 SKIP
--       PASS: 1, 2, 11, 14 — behaviour that already works.
--       SKIP: 12 — set_contribution_audience() does not exist yet, so a
--             foreign-org refusal cannot be observed. A SKIP is NOT a pass.
--       FAIL: 3, 4, 5, 6, 7, 8, 9, 10, 13 — every protection 20- adds.
--       If anything else passes, the suite is not observing the defects.
--
--       11 passes BEFORE 20- and it is not vacuous: measured, a non-author is
--       already blocked on all three paths by the author-scoped RLS policies
--       on asset_contributions and contribution_visibility_targets. The hole
--       20- closes is that the AUTHOR (and therefore a stale client acting as
--       them) can change the audience outside the RPC — which is what 3, 4, 5
--       and 6 observe failing. 11 is the preserve-access guard for the
--       non-author boundary: if it ever fails, 20- has widened something.
--
--   AFTER:                              14 PASS, 0 FAIL, 0 SKIP
--
-- Assertion 2 is the one that must pass in BOTH states: ordinary research
-- editing. If it ever fails, the safeguard has broken writing prose and is too
-- tight, which is a worse outcome than the defect it fixes.
--
-- ── Corrected 2026-10-20, after the first production baseline run ───────────
--
-- The first run returned 5 PASS / 9 FAIL, and three results were artifacts
-- rather than observations:
--
--   6  passed while the attack it tests SUCCEEDED. It compared the total
--      target count, which happened to be 1 because assertion 5 had already
--      deleted the original row and 6's own unauthorized insert replaced it.
--      It now asserts the specific unauthorized node is absent.
--   11 failed for a reason it did not name: its precondition (2 targets,
--      visibility 'team') had been destroyed by assertions 3 and 9. It now
--      builds its own contribution and targets, captures that state, and
--      compares against what it captured. It also attempts the DIRECT write
--      paths, not only the RPC — before 20- those are what actually let a
--      non-author through, so an RPC-only attempt passed vacuously while the
--      hole was open.
--   12 passed because the RPC was absent, which is not a security boundary.
--      It now distinguishes SQLSTATE 42883 (no such function -> SKIP) from a
--      genuine refusal (-> PASS).
--
-- Assertion 1 has the same shape as 12's old form — pre-fix it passes because
-- the function is missing — and is left alone deliberately: it is listed in
-- the expectations above as an already-works pass, not as proof of a boundary.
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
  v_state   text;                        -- SQLSTATE of the last guarded call
  v_errm    text;                        -- SQLERRM, so a refusal's REASON is checked
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
  -- Assert the SPECIFIC unauthorized node is absent. A total-count check is
  -- unsound here: assertion 5's direct delete may already have removed the
  -- original target, so an unauthorized insert can leave the count at 1 and
  -- look like success while the write actually went through.
  IF NOT EXISTS (SELECT 1 FROM contribution_visibility_targets
                  WHERE contribution_id = v_c AND node_id = v_team2) THEN
    v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (6,'PASS','the unauthorized node was not inserted');
  ELSE v_fail := v_fail+1;
    INSERT INTO _aud_results VALUES (6,'FAIL',
      'an authenticated non-writer inserted a target row directly (node present)'); END IF;

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
  -- 11. A NON-AUTHOR CANNOT CHANGE THE AUDIENCE.          FAILS BEFORE
  --
  --     Two corrections after the first baseline run.
  --
  --     (a) INDEPENDENT PRECONDITION. It used to inherit whatever assertions
  --         3 and 9 had left on the shared contribution; when those failed it
  --         reported "non-author changed it" about damage done before it ran.
  --         It now creates its OWN contribution and targets, captures that
  --         state, and compares against the captured values rather than
  --         hard-coded ones. INSERT, not UPDATE — a_pin_audience is
  --         BEFORE UPDATE only, so a fresh row keeps the audience it is given
  --         in BOTH states. If the precondition cannot be established it
  --         records SKIP, never PASS.
  --
  --     (b) EVERY WRITE PATH, not just the RPC. Before 20- the RPC does not
  --         exist, so an RPC-only attempt raises and the assertion passed
  --         while a non-author could still change the audience by writing the
  --         fields and target rows directly. Those are the paths the defect
  --         actually lives in, so it attempts all three.
  -- ===========================================================================
  DECLARE
    v_c11       uuid := gen_random_uuid();
    v_pre_vis   text;  v_pre_team  uuid;  v_pre_tgts  uuid[];
    v_post_vis  text;  v_post_team uuid;  v_post_tgts uuid[];
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    INSERT INTO asset_contributions(id, asset_id, section, content, created_by, visibility, team_id)
    VALUES (v_c11, v_asset, 'where_different', 'ZZ ASSERTION 11 PROSE '||v_suffix,
            v_owner, 'team', NULL);
    SET LOCAL request.jwt.claims = '';
    INSERT INTO contribution_visibility_targets(contribution_id, node_id, organization_id)
    VALUES (v_c11, v_team1, v_org_a), (v_c11, v_team2, v_org_a);

    SELECT visibility, team_id INTO v_pre_vis, v_pre_team
      FROM asset_contributions WHERE id = v_c11;
    SELECT array_agg(node_id ORDER BY node_id) INTO v_pre_tgts
      FROM contribution_visibility_targets WHERE contribution_id = v_c11;

    IF v_pre_vis IS DISTINCT FROM 'team'
       OR coalesce(array_length(v_pre_tgts,1),0) <> 2 THEN
      INSERT INTO _aud_results VALUES (11,'SKIP',
        format('precondition not established (vis=%s, targets=%s) — NOT verified',
               v_pre_vis, coalesce(array_length(v_pre_tgts,1),0)));
    ELSE
      EXECUTE format('SET LOCAL request.jwt.claims = %L',
                     json_build_object('sub', v_other, 'role','authenticated')::text);
      -- (i) through the RPC
      BEGIN SET LOCAL ROLE authenticated;
        v_res := public.set_contribution_audience(v_c11, 'firm', '{}');
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
      -- (ii) by writing the audience fields directly
      BEGIN SET LOCAL ROLE authenticated;
        UPDATE asset_contributions SET visibility = 'firm', team_id = NULL WHERE id = v_c11;
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
      -- (iii) by deleting the target rows directly
      BEGIN SET LOCAL ROLE authenticated;
        DELETE FROM contribution_visibility_targets WHERE contribution_id = v_c11;
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN RESET ROLE; END;
      SET LOCAL request.jwt.claims = '';

      SELECT visibility, team_id INTO v_post_vis, v_post_team
        FROM asset_contributions WHERE id = v_c11;
      SELECT array_agg(node_id ORDER BY node_id) INTO v_post_tgts
        FROM contribution_visibility_targets WHERE contribution_id = v_c11;

      v_msg := '';
      IF v_post_vis  IS DISTINCT FROM v_pre_vis  THEN
        v_msg := v_msg || format('visibility %s->%s ', v_pre_vis, v_post_vis); END IF;
      IF v_post_team IS DISTINCT FROM v_pre_team THEN
        v_msg := v_msg || 'team_id changed '; END IF;
      IF v_post_tgts IS DISTINCT FROM v_pre_tgts THEN
        v_msg := v_msg || format('targets %s->%s ',
          coalesce(array_length(v_pre_tgts,1),0),
          coalesce(array_length(v_post_tgts,1),0)); END IF;

      IF v_msg = '' THEN v_pass := v_pass+1;
        INSERT INTO _aud_results VALUES (11,'PASS',
          'a non-author changed nothing, by RPC or by direct field/target write');
      ELSE v_fail := v_fail+1;
        INSERT INTO _aud_results VALUES (11,'FAIL',
          'non-author changed its OWN fixture: '||v_msg); END IF;
    END IF;

    DELETE FROM contribution_visibility_targets WHERE contribution_id = v_c11;
    DELETE FROM asset_contribution_history      WHERE contribution_id = v_c11;
    DELETE FROM asset_contributions             WHERE id = v_c11;
  END;

  -- ===========================================================================
  -- 12. A FOREIGN-ORG NODE IS REFUSED.             SKIPS BEFORE, PASSES AFTER
  --
  --     An ABSENT RPC IS NOT A SECURITY BOUNDARY. This used to pass before
  --     20- purely because set_contribution_audience() did not exist, so the
  --     call raised and no foreign node was stored. SQLSTATE 42883
  --     (undefined_function) is now reported as SKIP; only a genuine refusal
  --     by the deployed function counts as a pass.
  -- ===========================================================================
  --     STRENGTHENED: the refusal's REASON is checked, not merely that one
  --     occurred. When the writer role lacked a SELECT policy the function
  --     raised 42501 'contribution not found or not yours' for every call, and
  --     this assertion passed on that — a refusal from the ownership lookup,
  --     not from the foreign-org check it claims to test. A lookup failure is
  --     now an explicit FAIL.
  v_msg := ''; v_state := NULL; v_errm := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'team', ARRAY[v_team_b]);
    RESET ROLE;
    v_msg := 'accepted another organization''s node ';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state := SQLSTATE; v_errm := SQLERRM; END;
  IF v_state = '42883' THEN
    INSERT INTO _aud_results VALUES (12,'SKIP',
      'set_contribution_audience() does not exist (42883) — a foreign-org refusal cannot be observed; a missing function is NOT a boundary');
  ELSIF EXISTS (SELECT 1 FROM contribution_visibility_targets
                 WHERE contribution_id = v_c AND node_id = v_team_b) THEN
    v_fail := v_fail+1;
    INSERT INTO _aud_results VALUES (12,'FAIL','the foreign-org node was stored');
  ELSIF v_msg <> '' THEN
    v_fail := v_fail+1; INSERT INTO _aud_results VALUES (12,'FAIL', v_msg);
  ELSIF v_errm LIKE '%not found or not yours%' THEN
    v_fail := v_fail+1;
    INSERT INTO _aud_results VALUES (12,'FAIL',
      'refused by the OWNERSHIP LOOKUP, not the foreign-org check — the author could not even be matched: '||v_errm);
  ELSIF v_errm NOT LIKE '%groups in your organization%' THEN
    v_fail := v_fail+1;
    INSERT INTO _aud_results VALUES (12,'FAIL',
      format('refused for an unexpected reason (%s): %s', v_state, v_errm));
  ELSE
    v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (12,'PASS',
      format('foreign-org node refused by the target check (%s: %s)', v_state, v_errm));
  END IF;

  -- ===========================================================================
  -- 13. A SCOPE/TARGET TYPE MISMATCH IS REFUSED.   FAILS BEFORE
  --     'department' visibility aimed at a team node. The CHECK constraint
  --     cannot see this; only the function can.
  -- ===========================================================================
  --     STRENGTHENED for the same reason as 12: an ownership-lookup refusal is
  --     not a type check, and must not be allowed to pass as one.
  v_msg := ''; v_state := NULL; v_errm := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', v_owner, 'role','authenticated')::text);
    SET LOCAL ROLE authenticated;
    v_res := public.set_contribution_audience(v_c, 'department', ARRAY[v_team1]);
    RESET ROLE;
    v_msg := 'accepted a team node for department visibility ';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_state := SQLSTATE; v_errm := SQLERRM; END;
  SELECT visibility INTO v_txt FROM asset_contributions WHERE id = v_c;
  IF v_txt <> 'team' THEN v_msg := v_msg||format('visibility changed to %s ', v_txt); END IF;
  IF v_msg <> '' THEN
    v_fail := v_fail+1; INSERT INTO _aud_results VALUES (13,'FAIL', v_msg);
  ELSIF v_state = '42883' THEN
    INSERT INTO _aud_results VALUES (13,'SKIP',
      'set_contribution_audience() does not exist (42883) — a type refusal cannot be observed');
  ELSIF v_errm LIKE '%not found or not yours%' THEN
    v_fail := v_fail+1;
    INSERT INTO _aud_results VALUES (13,'FAIL',
      'refused by the OWNERSHIP LOOKUP, not the scope/type check: '||v_errm);
  ELSIF v_errm NOT LIKE '%are not department groups%' THEN
    v_fail := v_fail+1;
    INSERT INTO _aud_results VALUES (13,'FAIL',
      format('refused for an unexpected reason (%s): %s', v_state, v_errm));
  ELSE
    v_pass := v_pass+1;
    INSERT INTO _aud_results VALUES (13,'PASS',
      format('scope/target type mismatch refused by the type check (%s: %s)', v_state, v_errm));
  END IF;

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
  -- Creating a user seeds default lists (handle_new_user_lists ->
  -- create_default_lists_for_user) and four statuses per list
  -- (seed_default_list_statuses). Deleting the user then fires TWO conflicting
  -- referential actions on the same row: asset_lists.created_by is ON DELETE
  -- CASCADE while list_statuses.created_by is ON DELETE SET NULL, and the
  -- SET NULL re-validates list_statuses.list_id against a list the cascade has
  -- already removed. Children first, scoped to these synthetic users' own lists.
  DELETE FROM list_statuses
   WHERE list_id IN (SELECT id FROM asset_lists
                      WHERE created_by IN (v_owner, v_member, v_other, v_outside));
  DELETE FROM asset_lists WHERE created_by IN (v_owner, v_member, v_other, v_outside);
  DELETE FROM auth.users WHERE id IN (v_owner, v_member, v_other, v_outside);

  RAISE NOTICE '=== RESULTS: % passed, % failed out of 14 ===', v_pass, v_fail;
  RAISE NOTICE 'Before the fix only 1, 2 and 14 may pass; 12 must SKIP; a SKIP is not a pass.';
END $$;

SELECT n, result, detail FROM _aud_results ORDER BY n, result;
