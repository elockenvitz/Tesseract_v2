-- =============================================================================
-- ai_artifacts — authorization and isolation regression test
--
-- AUTHORED, NOT YET EXECUTED. See "STATUS" at the end of this header.
--
-- WHAT THIS GUARDS
--
-- An artifact is a pointer at an ACT AI answer: the conversation, the
-- message's own id, and a title the reader wrote. It holds no copy of the
-- answer. Four boundaries have to hold at once:
--
--   1. Ownership. An artifact belongs to ONE reader, because the
--      conversation it points at does (`ai_conversations.user_id =
--      auth.uid()`, no organization column at all). An org-wide read here
--      would hand a colleague a TITLE whose answer they cannot open, which
--      discloses what someone is working on and delivers nothing. This is
--      the rule most likely to be "generalised" away by someone making
--      artifacts shareable without moving the conversation's boundary first.
--   2. Membership. The organization is stamped at write time and checked
--      against LIVE membership, so a reader who leaves a firm loses that
--      firm's titles rather than keeping a readable list.
--   3. Parentage. `conversation_id` could otherwise name any conversation,
--      including another reader's: this table's policy checks who owns the
--      ARTIFACT, and a reader can set that to themselves. Assertion 9 is the
--      only thing that proves the trigger closes it.
--   4. Lifetime. The artifact cannot outlive its conversation. There is no
--      content column, so a surviving row would be a titled pointer at
--      nothing; `ON DELETE CASCADE` is asserted in assertion 11 because a
--      later `SET NULL` would produce exactly that.
--
-- WHY A TRIGGER AND NOT A POLICY PREDICATE
--
-- A policy subquery runs under the caller's own RLS, which in this repository
-- has both hidden real holes and broken legitimate writes. The guard needs to
-- see a row the caller cannot, so it is a SECURITY DEFINER trigger that
-- compares the conversation's owner to the artifact's owner and raises 42501.
--
-- Run inside BEGIN ... ROLLBACK. Nothing is committed, so there is no fixture
-- teardown -- which matters: 196 unindexed foreign keys make deleting a test
-- user take about 75 seconds.
--
-- STATUS
--
-- Neither the migration (`20261113120000_ai_artifacts.sql`) nor this suite
-- has been run anywhere. The connection available while writing them is
-- read-only, which refuses DDL with 25006, so the table cannot be created
-- even inside a transaction that is rolled back. Running this is part of the
-- deployment approval, and the two injections below have to be performed in
-- the same session, after it passes:
--
--   * widen ai_artifacts_select to USING (user_id = auth.uid()), dropping
--     the membership half -> assertion 5 must fail.
--   * drop the ai_artifacts_conversation_own trigger -> assertion 9 must
--     fail.
--
-- Until that has happened this file is a specification, not evidence, and
-- nothing here should be cited as a passing test.
--
-- Either injection is also what proves the VERDICT at the bottom is real.
-- Until 2026-11-13 this suite recorded its failures in a table, printed them
-- and exited 0: both injections above would have been "caught" in a report
-- nothing reads, on a green run. A gate that cannot fail is decoration.
--
-- Self-cleaning, by the transaction opened below. 12 assertions, counted.
-- =============================================================================

-- The transaction the header above promises, which the file did not actually
-- open. Without it a PASSING run COMMITS the fixture -- four `auth.users`, two
-- organizations, three conversations, two artifacts -- and 196 unindexed
-- foreign keys make deleting a test user take about 75 seconds. A FAILING run
-- was always self-cleaning, because the verdict at the bottom aborts the
-- statement; a passing one was not. That is the wrong way round.
BEGIN;

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix    text := substr(md5(random()::text), 1, 8);
  v_org_a     uuid;
  v_org_b     uuid;
  v_owner     uuid := gen_random_uuid();   -- org A, owns the conversation
  v_colleague uuid := gen_random_uuid();   -- org A, same firm, not entitled
  v_outsider  uuid := gen_random_uuid();   -- org B
  v_leaver    uuid := gen_random_uuid();   -- org A, membership revoked below
  v_conv      uuid;
  v_leaver_cv uuid;
  v_other_cv  uuid;
  v_artifact  uuid;
  v_leaver_ar uuid;
  v_count     int;
  v_count2    int;
  v_text      text;
  v_pass      int := 0;
  v_fail      int := 0;
BEGIN
  RAISE NOTICE '=== ai_artifacts authorization (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('ART Org A ' || v_suffix, 'art-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('ART Org B ' || v_suffix, 'art-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner,     'art_o_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_colleague, 'art_c_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_outsider,  'art_x_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_leaver,    'art_l_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner,     'active', false),
    (v_org_a, v_colleague, 'active', false),
    (v_org_a, v_leaver,    'active', false),
    (v_org_b, v_outsider,  'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_owner, v_colleague, v_leaver);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_outsider;

  -- One real answer to point at, in each reader's own thread.
  INSERT INTO ai_conversations (user_id, title, messages)
    VALUES (v_owner, 'ART thread ' || v_suffix,
            '[{"id":"m-1","role":"assistant","content":"The bear case rests on three things."}]'::jsonb)
    RETURNING id INTO v_conv;
  INSERT INTO ai_conversations (user_id, title, messages)
    VALUES (v_leaver, 'ART leaver thread ' || v_suffix, '[]'::jsonb)
    RETURNING id INTO v_leaver_cv;
  INSERT INTO ai_conversations (user_id, title, messages)
    VALUES (v_colleague, 'ART colleague thread ' || v_suffix, '[]'::jsonb)
    RETURNING id INTO v_other_cv;

  -- Seeded as the table owner, so the fixture does not depend on the policies
  -- under test.
  INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
    VALUES (v_owner, v_org_a, v_conv, 'm-1', 'ART LRCX bear case ' || v_suffix)
    RETURNING id INTO v_artifact;
  INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
    VALUES (v_leaver, v_org_a, v_leaver_cv, 'm-1', 'ART leaver kept ' || v_suffix)
    RETURNING id INTO v_leaver_ar;

  -- ===========================================================================
  -- 1. anon reads nothing. The publishable key is a valid JWT, so this is the
  --    boundary an unauthenticated page sits behind.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM ai_artifacts WHERE id IN (v_artifact, v_leaver_ar);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count <= 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon read %s artifact row(s)', greatest(v_count, 0)));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s artifact row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 2. anon cannot create one either. A denied write must be denied, not
  --    accepted and filtered.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
      VALUES (v_owner, v_org_a, v_conv, 'm-anon', 'ART anon ' || v_suffix);
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'anon insert denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', 'anon created an artifact'); END IF;

  -- ===========================================================================
  -- 3. The owner reads their own artifact. The positive case, so the suite
  --    cannot pass by denying everything.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM ai_artifacts WHERE id = v_artifact;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'the owner reads their own artifact');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('owner read %s row(s); expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 4. A colleague in the SAME organization reads nothing. An artifact is
  --    private even inside a firm, because the answer behind it is.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM ai_artifacts WHERE id IN (v_artifact, v_leaver_ar);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'a same-org colleague reads no artifact of anothers');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', format('colleague read %s row(s); expected 0', v_count)); END IF;

  -- ===========================================================================
  -- 5. A reader whose membership is revoked loses their OWN artifacts in that
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
    SELECT count(*) INTO v_count FROM ai_artifacts WHERE id = v_leaver_ar;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'a removed member cannot read their own artifact in that org');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', format('removed member read %s row(s); expected 0', v_count)); END IF;

  -- ===========================================================================
  -- 6. The outsider cannot create one in an organization they do not belong
  --    to, even naming themselves as the owner.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outsider, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
      VALUES (v_outsider, v_org_a, v_conv, 'm-1', 'ART outsider ' || v_suffix);
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'insert into a foreign organization denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', 'outsider created an artifact in another org'); END IF;

  -- ===========================================================================
  -- 7. Nobody creates an artifact OWNED by someone else, even in their own
  --    org. This is the policy half; assertion 9 is the trigger half.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
      VALUES (v_owner, v_org_a, v_conv, 'm-planted', 'ART planted ' || v_suffix);
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'insert on behalf of another user denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', 'an artifact was created for another user'); END IF;

  -- ===========================================================================
  -- 8. A colleague cannot retitle or delete one they cannot see. Zero rows
  --    affected, which for UPDATE/DELETE under RLS is the denial shape.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE ai_artifacts SET title = 'ART hijacked ' || v_suffix WHERE id = v_artifact;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    DELETE FROM ai_artifacts WHERE id = v_artifact;
    GET DIAGNOSTICS v_count2 = ROW_COUNT;
    RESET ROLE;
    v_text := format('%s/%s', v_count, v_count2);
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'error';
  END;
  IF v_text IN ('0/0', 'error') THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', format('colleague update/delete affected %s rows', v_text));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', format('colleague update/delete affected %s rows', v_text)); END IF;

  -- ===========================================================================
  -- 9. THE CHILD GUARD. A reader names themselves as owner while pointing at
  --    a conversation that is not theirs. The policy allows it -- it only
  --    checks the artifact's owner -- and the trigger must raise 42501.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
      VALUES (v_colleague, v_org_a, v_conv, 'm-1', 'ART foreign thread ' || v_suffix);
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'keeping an answer from another users thread denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', 'an artifact was created against another users conversation'); END IF;

  -- ===========================================================================
  -- 10. The legitimate move works, through the policy and the trigger, as the
  --     owner: keep an answer, retitle it, read it back. Without this the
  --     guard could be a blanket refusal and every denial above would still
  --     pass.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
      VALUES (v_owner, v_org_a, v_conv, 'm-own', 'ART kept by owner ' || v_suffix);
    UPDATE ai_artifacts SET title = 'ART renamed ' || v_suffix
     WHERE conversation_id = v_conv AND message_id = 'm-own';
    SELECT count(*) INTO v_count FROM ai_artifacts
     WHERE conversation_id = v_conv AND message_id = 'm-own' AND title = 'ART renamed ' || v_suffix;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (10, 'PASS', 'the owner can keep an answer and retitle it');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (10, 'FAIL', format('owner keep/retitle read back %s row(s); expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 11. Deleting the conversation takes its artifacts with it. There is no
  --     copy of the answer here, so a surviving row would be a titled pointer
  --     at nothing: a later ON DELETE SET NULL would produce exactly that.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM ai_conversations WHERE id = v_conv;
    SELECT count(*) INTO v_count FROM ai_artifacts WHERE conversation_id = v_conv;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (11, 'PASS', 'deleting the conversation removed its artifacts');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (11, 'FAIL', format('%s artifact row(s) survived the conversation', v_count)); END IF;

  -- ===========================================================================
  -- 12. Keeping the same answer twice is one artifact, not two. The uniqueness
  --     is per reader, per conversation, per message.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_colleague, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
      VALUES (v_colleague, v_org_a, v_other_cv, 'm-dup', 'ART dup one ' || v_suffix);
    INSERT INTO ai_artifacts (user_id, organization_id, conversation_id, message_id, title)
      VALUES (v_colleague, v_org_a, v_other_cv, 'm-dup', 'ART dup two ' || v_suffix);
    RESET ROLE;
    v_text := 'allowed';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_text := 'denied';
  END;
  IF v_text = 'denied' THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (12, 'PASS', 'keeping the same answer twice is rejected');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (12, 'FAIL', 'the same answer was kept twice'); END IF;

  RAISE NOTICE '=== % passed, % failed ===', v_pass, v_fail;
END $$;

SELECT n, result, detail FROM _sec_results ORDER BY n;

-- ─── The verdict ────────────────────────────────────────────────────────────
--
-- Without this the suite could not fail. Twelve FAIL rows printed, the script
-- exited 0, and every other suite in this directory raises -- so a harness
-- that reads the exit status would have reported this one green while the
-- isolation it is supposed to prove was wide open.
--
-- Deliberately a SEPARATE statement from the DO block above, so the table of
-- results prints BEFORE the run fails: an exception raised inside that block
-- aborts the statement and takes the temp table with it, leaving a count and
-- no names.
--
-- Two conditions, because a gate that looks only for FAIL rows cannot see the
-- vacuous case -- a suite that aborted early, or an assertion edited out,
-- records no failure at all.
DO $$
DECLARE
  v_fail  int;
  v_total int;
BEGIN
  SELECT count(*) FILTER (WHERE result = 'FAIL'), count(*)
    INTO v_fail, v_total
    FROM _sec_results;

  IF v_total <> 12 THEN
    RAISE EXCEPTION
      'AI_ARTIFACTS AUTHORIZATION TEST INCOMPLETE: expected 12 assertions, recorded %',
      v_total;
  END IF;

  IF v_fail > 0 THEN
    RAISE EXCEPTION
      'AI_ARTIFACTS AUTHORIZATION TEST FAILED: % of 12 assertion(s) failed', v_fail;
  END IF;

  RAISE NOTICE 'ai_artifacts authorization: 12 of 12 assertions passed';
END $$;

ROLLBACK;
