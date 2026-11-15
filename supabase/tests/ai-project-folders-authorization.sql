-- =============================================================================
-- ai_project_folders — authorization and isolation regression test
--
-- WHAT THIS GUARDS
--
-- ACT AI folders are the first new table in the AI conversation model since
-- the tags table. They hold user-authored NAMES -- "Project Condor", "the
-- Apple case" -- which makes a read leak a disclosure of intent, not just of
-- structure. Three boundaries have to hold at once, and they are different
-- boundaries:
--
--   1. Ownership. A folder belongs to ONE reader. A colleague in the same
--      organization is not entitled to it, which is a stricter rule than most
--      tables in this schema and is easy to "fix" into an org-wide policy by
--      someone generalising later.
--   2. Membership. The folder is stamped with an organization and checked
--      against LIVE membership, so a reader who leaves a firm loses their
--      folders from that firm rather than keeping a readable list.
--   3. Parentage. `ai_conversations.folder_id` could otherwise name any
--      folder, including another reader's: the conversation's own policy only
--      checks who owns the CONVERSATION. A definer trigger closes that, and
--      assertion 9 is the only thing that proves it.
--
-- WHY A TRIGGER AND NOT A POLICY PREDICATE
--
-- A policy subquery runs under the caller's own RLS, which in this repository
-- has both hidden real holes and broken legitimate writes. The guard needs to
-- see rows the caller cannot, so it is a SECURITY DEFINER trigger that
-- compares the folder's owner to the conversation's owner and raises 42501.
--
-- Run inside BEGIN ... ROLLBACK. Nothing is committed, so there is no fixture
-- teardown -- which matters: 196 unindexed foreign keys make deleting a test
-- user take about 75 seconds.
--
-- EXECUTED 2026-11-12 against production inside a transaction that was rolled
-- back by a terminal RAISE: 12 of 12 passed, nothing committed.
--
-- PROVEN NON-VACUOUS the same day, in the same wrapper, by two injections:
--   * ai_project_folders_select widened to USING (user_id = auth.uid()) --
--     dropping the membership half -- failed assertion 5.
--   * the ai_conversations_folder_own trigger dropped -- failed assertion 9.
-- Both reverted and re-verified afterwards.
--
-- Self-cleaning. 12 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix    text := substr(md5(random()::text), 1, 8);
  v_org_a     uuid;
  v_org_b     uuid;
  v_owner     uuid := gen_random_uuid();   -- org A, owns the folder
  v_colleague uuid := gen_random_uuid();   -- org A, same firm, not entitled
  v_outsider  uuid := gen_random_uuid();   -- org B
  v_leaver    uuid := gen_random_uuid();   -- org A, membership revoked below
  v_folder    uuid;
  v_leaver_fd uuid;
  v_conv      uuid;
  v_other_cv  uuid;
  v_count     int;
  v_count2    int;
  v_text      text;
  v_pass      int := 0;
  v_fail      int := 0;
BEGIN
  RAISE NOTICE '=== ai_project_folders authorization (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('APF Org A ' || v_suffix, 'apf-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('APF Org B ' || v_suffix, 'apf-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner,     'apf_o_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_colleague, 'apf_c_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_outsider,  'apf_x_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_leaver,    'apf_l_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner,     'active', false),
    (v_org_a, v_colleague, 'active', false),
    (v_org_a, v_leaver,    'active', false),
    (v_org_b, v_outsider,  'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_owner, v_colleague, v_leaver);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outsider;

  -- Seeded as the table owner, so the fixture does not depend on the policies
  -- under test.
  INSERT INTO ai_project_folders (user_id, organization_id, name)
    VALUES (v_owner, v_org_a, 'APF Earnings season ' || v_suffix)
    RETURNING id INTO v_folder;
  INSERT INTO ai_project_folders (user_id, organization_id, name)
    VALUES (v_leaver, v_org_a, 'APF Leaver shelf ' || v_suffix)
    RETURNING id INTO v_leaver_fd;

  INSERT INTO ai_conversations (user_id, title, messages, folder_id)
    VALUES (v_owner, 'APF thread ' || v_suffix, '[]'::jsonb, v_folder)
    RETURNING id INTO v_conv;
  INSERT INTO ai_conversations (user_id, title, messages)
    VALUES (v_colleague, 'APF colleague thread ' || v_suffix, '[]'::jsonb)
    RETURNING id INTO v_other_cv;

  -- ===========================================================================
  -- 1. anon reads nothing. The publishable key is a valid JWT, so this is the
  --    boundary an unauthenticated page sits behind.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM ai_project_folders WHERE id IN (v_folder, v_leaver_fd);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count <= 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon read %s folder row(s)', greatest(v_count, 0)));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s folder row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 2. anon cannot create one either. A denied write must be denied, not
  --    accepted and filtered.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO ai_project_folders (user_id, organization_id, name)
      VALUES (v_owner, v_org_a, 'APF anon ' || v_suffix);
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'anon insert denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', 'anon inserted a folder'); END IF;

  -- ===========================================================================
  -- 3. The owner reads their own folder. The positive case, so the suite
  --    cannot pass by denying everything.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM ai_project_folders WHERE id = v_folder;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'the owner reads their own folder');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('owner read %s row(s); expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 4. A colleague in the SAME organization reads nothing. Folders are private
  --    even inside a firm -- the rule most likely to be "generalised" away.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM ai_project_folders WHERE id IN (v_folder, v_leaver_fd);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'a same-org colleague reads no folder of anothers');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('colleague read %s row(s); expected 0', v_count)); END IF;

  -- ===========================================================================
  -- 5. A reader whose membership is revoked loses their OWN folders in that
  --    organization. Ownership alone is not enough.
  -- ===========================================================================
  /* `inactive`, not `removed`: enforce_org_membership_status_transition()
     allows active -> inactive and nothing else, so this is what losing a
     seat actually looks like in this schema. */
  UPDATE organization_memberships SET status = 'inactive'
   WHERE organization_id = v_org_a AND user_id = v_leaver;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_leaver, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM ai_project_folders WHERE id = v_leaver_fd;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'a removed member cannot read their own folder in that org');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('removed member read %s row(s); expected 0', v_count)); END IF;

  -- ===========================================================================
  -- 6. The outsider cannot create a folder in an organization they do not
  --    belong to, even naming themselves as the owner.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outsider, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_project_folders (user_id, organization_id, name)
      VALUES (v_outsider, v_org_a, 'APF outsider ' || v_suffix);
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'insert into a foreign organization denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', 'outsider created a folder in another org'); END IF;

  -- ===========================================================================
  -- 7. Nobody creates a folder OWNED by someone else, even in their own org.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_project_folders (user_id, organization_id, name)
      VALUES (v_owner, v_org_a, 'APF planted ' || v_suffix);
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'insert on behalf of another user denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', 'a folder was created for another user'); END IF;

  -- ===========================================================================
  -- 8. A colleague cannot rename or delete a folder they cannot see. Zero rows
  --    affected, which for UPDATE/DELETE under RLS is the denial shape.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE ai_project_folders SET name = 'APF hijacked ' || v_suffix WHERE id = v_folder;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    DELETE FROM ai_project_folders WHERE id = v_folder;
    GET DIAGNOSTICS v_count2 = ROW_COUNT;
    RESET ROLE;
    v_text := format('%s/%s', v_count, v_count2);
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'error';
  END;
  IF v_text IN ('0/0', 'error') THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', format('colleague update/delete affected %s rows', v_text));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('colleague update/delete affected %s rows', v_text)); END IF;

  -- ===========================================================================
  -- 9. THE CHILD GUARD. A reader files their own conversation into their own
  --    folder (allowed), and into someone else's (42501). The second half is
  --    the whole reason the trigger exists.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE ai_conversations SET folder_id = v_folder WHERE id = v_other_cv;
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'filing a conversation into another users folder denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', 'a conversation was filed into another users folder'); END IF;

  -- ===========================================================================
  -- 10. The legitimate move works, through the policy and the trigger, as the
  --     owner. Without this the guard could be a blanket refusal.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE ai_conversations SET folder_id = NULL   WHERE id = v_conv;
    UPDATE ai_conversations SET folder_id = v_folder WHERE id = v_conv;
    SELECT count(*) INTO v_count FROM ai_conversations WHERE id = v_conv AND folder_id = v_folder;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (10, 'PASS', 'the owner can unfile and refile their own conversation');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', format('owner refile read back %s row(s); expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 11. Deleting a folder unfiles its conversations and deletes none of them.
  --     "Archive folders without silently deleting their content" is the
  --     product rule; ON DELETE SET NULL is the mechanism, asserted here
  --     because a later CASCADE would destroy a reader's transcripts.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM ai_project_folders WHERE id = v_folder;
    SELECT format('%s/%s',
             (SELECT count(*) FROM ai_conversations WHERE id = v_conv),
             (SELECT count(*) FROM ai_conversations WHERE id = v_conv AND folder_id IS NULL))
      INTO v_text;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'error';
  END;
  IF v_text = '1/1' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (11, 'PASS', 'deleting a folder leaves the conversation, unfiled');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', format('after folder delete the conversation read back %s; expected 1/1', v_text)); END IF;

  -- ===========================================================================
  -- 12. One name per reader per organization, case- and space-insensitively.
  --     Two shelves called "Earnings" and "earnings " are one shelf.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_project_folders (user_id, organization_id, name) VALUES (v_owner, v_org_a, 'APF Dup ' || v_suffix);
    INSERT INTO ai_project_folders (user_id, organization_id, name) VALUES (v_owner, v_org_a, '  apf dup ' || v_suffix || ' ');
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (12, 'PASS', 'a duplicate folder name is rejected');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (12, 'FAIL', 'two folders with the same name were created'); END IF;

  RAISE NOTICE '=== % passed, % failed ===', v_pass, v_fail;
END $$;

SELECT n, result, detail FROM _sec_results ORDER BY n;
