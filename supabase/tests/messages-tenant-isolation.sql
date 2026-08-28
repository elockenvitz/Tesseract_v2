-- =============================================================================
-- messages Tenant Isolation — security regression test
--
-- Proves (or, run today, disproves) the boundary that Security Release B
-- establishes:
--   scripts/sql/release-b/01-messages-containment.sql
--   scripts/sql/release-b/02-messages-permanent.sql
--
-- Run it BEFORE those and watch it fail, and after to watch it pass; a passing
-- run on its own proves only that the test is not wired to anything. Against
-- production as it stands on 2026-08-28, assertions 1, 2, 3, 4, 5, 8, 9 and 10
-- are expected to FAIL — those are the open doors. 6 and 7 are the "did we
-- break the product" side and are expected to pass both before and after.
--
-- Assertions 6 and 7 are the pair that matters most after remediation: a
-- recipient must still be able to acknowledge a message, and must NOT gain the
-- ability to edit it by having that power. Today, one policy grants both.
--
-- Each probe assumes the `authenticated` (or `anon`) role and forges a JWT claim
-- the way PostgREST presents a request, then drops back immediately. Reads made
-- as the owning role would bypass RLS entirely and prove nothing.
--
-- Self-cleaning: everything is created inside the transaction and rolled back.
-- 10 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org_a    uuid;
  v_org_b    uuid;
  v_user_a   uuid := gen_random_uuid();   -- org A author
  v_user_a2  uuid := gen_random_uuid();   -- org A colleague — the legitimate reader
  v_user_b   uuid := gen_random_uuid();   -- org B, entirely unrelated
  v_team_a   uuid;
  v_pf_a     uuid;
  v_theme_a  uuid;
  v_msg      uuid;
  v_count    int;
  v_text     text;
  v_actor    uuid;
  v_pass     int := 0;
  v_fail     int := 0;
BEGIN
  RAISE NOTICE '=== messages Tenant Isolation (suffix: %) ===', v_suffix;

  -- ---------------------------------------------------------------------------
  -- SETUP
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug) VALUES ('MSG Org A ' || v_suffix, 'msg-a-' || v_suffix)
    RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('MSG Org B ' || v_suffix, 'msg-b-' || v_suffix)
    RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a,  'msg_a_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_a2, 'msg_a2_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b,  'msg_b_'  || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a,  'active', false),
    (v_org_a, v_user_a2, 'active', false),
    (v_org_b, v_user_b,  'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_user_a, v_user_a2);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  -- A theme in org A gives the message a context that genuinely carries a tenant.
  INSERT INTO teams (name, organization_id) VALUES ('MSG Team A ' || v_suffix, v_org_a)
    RETURNING id INTO v_team_a;
  INSERT INTO portfolios (name, team_id) VALUES ('MSG PF A ' || v_suffix, v_team_a)
    RETURNING id INTO v_pf_a;
  INSERT INTO themes (name, organization_id) VALUES ('MSG Theme A ' || v_suffix, v_org_a)
    RETURNING id INTO v_theme_a;

  -- The fixture message: written in-session as the author, so organization_id is
  -- DERIVED by the trigger rather than asserted — which is the behaviour under
  -- test. Before remediation there is no trigger and this is a plain insert.
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;

  INSERT INTO messages (content, user_id, context_type, context_id)
    VALUES ('org A private thread ' || v_suffix, v_user_a, 'theme', v_theme_a)
    RETURNING id INTO v_msg;

  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 1. anon cannot read a message
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM messages WHERE id = v_msg;
    RESET ROLE;
    IF v_count = 0 THEN
      v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'PASS', format('anon reads zero messages'));
    ELSE
      v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'FAIL', format('anon read %s message(s) without logging in', v_count));
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'PASS', format('anon refused at the grant'));
  WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. anon cannot UPDATE a message
  --    The sharpest live finding: "Users can mark messages as read" is
  --    UPDATE TO public USING (true) WITH CHECK (true).
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE messages SET content = 'rewritten by anon' WHERE id = v_msg;
    RESET ROLE;
    SELECT content INTO v_text FROM messages WHERE id = v_msg;
    IF v_text = 'rewritten by anon' THEN
      v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (2, 'FAIL', format('anon rewrote a message with no session'));
    ELSE
      v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (2, 'PASS', format('anon update changed nothing'));
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (2, 'PASS', format('anon update refused at the grant'));
  WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (2, 'PASS', format('anon update refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 3. Org B cannot READ an org A message
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM messages WHERE id = v_msg;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (3, 'PASS', format('org B cannot read org A message'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (3, 'FAIL', format('org B read org A message (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 4. Org B cannot ALTER foreign content
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE messages SET content = 'rewritten by org B' WHERE id = v_msg;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT content INTO v_text FROM messages WHERE id = v_msg;
  IF v_text LIKE 'org A private thread%' THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (4, 'PASS', format('org B could not alter org A content'));
  ELSE
    v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (4, 'FAIL', format('org B rewrote org A content to "%s"', v_text));
  END IF;

  -- ===========================================================================
  -- 5. Org B cannot REASSIGN authorship
  --    `user_id` is the author, and today it is writable by anyone.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE messages SET user_id = v_user_b WHERE id = v_msg;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT user_id INTO v_actor FROM messages WHERE id = v_msg;
  IF v_actor = v_user_a THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (5, 'PASS', format('authorship unchanged'));
  ELSE
    v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (5, 'FAIL', format('authorship reassigned to another org''s user'));
  END IF;

  -- ===========================================================================
  -- 6. A legitimate same-org colleague CAN read the message
  --    The remediation must not be "nobody can read anything".
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM messages WHERE id = v_msg;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (6, 'PASS', format('same-org colleague can read the message'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (6, 'FAIL', format('same-org colleague CANNOT read the message (count %s) — over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 7. That colleague CAN acknowledge it, and CANNOT edit it
  --    One assertion, because the whole point is that the two powers separate.
  --    Before remediation both halves succeed, so this fails on the second.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a2, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.mark_messages_read(ARRAY[v_msg]);
    EXCEPTION WHEN undefined_function THEN
      -- Pre-remediation: no RPC exists, the UI updates the row directly.
      UPDATE messages SET is_read = true, read_at = now() WHERE id = v_msg;
    END;
    BEGIN
      UPDATE messages SET content = 'edited by an acknowledging reader' WHERE id = v_msg;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT content INTO v_text FROM messages WHERE id = v_msg;
  SELECT count(*) INTO v_count FROM messages WHERE id = v_msg AND is_read;
  IF v_count = 1 AND v_text LIKE 'org A private thread%' THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (7, 'PASS', format('reader acknowledged without gaining edit rights'));
  ELSIF v_count <> 1 THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (7, 'FAIL', format('legitimate reader could not acknowledge the message'));
  ELSE
    v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (7, 'FAIL', format('acknowledging reader also rewrote the content'));
  END IF;

  -- ===========================================================================
  -- 8. A user in NO relevant context cannot read
  --    v_user_b is authenticated and a member of an org — just not this one.
  --    Distinct from [3]: this asserts the boundary is the CONTEXT, not merely
  --    that some org column differs.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM messages
     WHERE context_type = 'theme' AND context_id = v_theme_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (8, 'PASS', format('unauthorised context member reads nothing'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (8, 'FAIL', format('unauthorised user read %s message(s) in a foreign context', v_count)); END IF;

  -- ===========================================================================
  -- 9. Org B cannot INSERT into org A's thread
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO messages (content, user_id, context_type, context_id)
      VALUES ('injected by org B ' || v_suffix, v_user_b, 'theme', v_theme_a);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM messages
   WHERE context_type = 'theme' AND context_id = v_theme_a AND user_id = v_user_b;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (9, 'PASS', format('org B could not post into org A''s thread'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (9, 'FAIL', format('org B posted into org A''s thread')); END IF;

  -- ===========================================================================
  -- 10. A message cannot be MOVED to another tenant's context
  --     The portfolio_team lesson applied here: an authorised row must not be
  --     rewritable out of its own tenant.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE messages SET context_type = 'portfolio', context_id = v_pf_a WHERE id = v_msg;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM messages WHERE id = v_msg AND context_type = 'theme';
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (10, 'PASS', format('message context is immutable'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (10, 'FAIL', format('a message was re-parented to a different context')); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  -- Teardown runs as the owner; make sure it really is unauthenticated.
  SET LOCAL request.jwt.claims = '';
  DELETE FROM messages WHERE context_id IN (v_theme_a, v_pf_a);
  DELETE FROM themes WHERE id = v_theme_a;
  DELETE FROM portfolios WHERE id = v_pf_a;
  DELETE FROM teams WHERE id = v_team_a;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL
    WHERE id IN (v_user_a, v_user_a2, v_user_b);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_a2, v_user_b);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 10 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
