-- =============================================================================
-- notifications Authorization — security regression test
--
-- Proves the boundary that scripts/sql/release-b/04-notifications.sql
-- establishes: direct client INSERT is gone, own-user SELECT/UPDATE survive,
-- and the trusted server-side producers keep working.
--
-- Run BEFORE 04 and watch it fail, and after to watch it pass. Against
-- production as it stands on 2026-08-28, assertions 2, 5, 6 and 9 are expected
-- to FAIL — those are the open doors. 1, 3, 4, 7 and 8 are the "did we break the
-- product" side and should pass both before and after; if any of those starts
-- failing after 04, the containment went too far.
--
-- Assertion 9 is the one that catches the trap in this change: four `notify_*`
-- trigger functions and their helpers are SECURITY INVOKER, so they run as the
-- calling user and would start failing the moment the INSERT grant is revoked —
-- taking asset field edits, price target saves and note sharing down with them.
--
-- Self-cleaning. 9 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix  text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid;
  v_org_b   uuid;
  v_user_a  uuid := gen_random_uuid();
  v_user_b  uuid := gen_random_uuid();
  v_note    uuid;
  v_count   int;
  v_title   text;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== notifications Authorization (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('NT Org A ' || v_suffix, 'nt-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('NT Org B ' || v_suffix, 'nt-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a, 'nt_a_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b, 'nt_b_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a, 'active', false),
    (v_org_b, v_user_b, 'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_a;
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  -- Fixture written as the owner, so it exists regardless of the policy state.
  INSERT INTO notifications (user_id, type, title, message, context_type, context_id)
    VALUES (v_user_a, 'share', 'NT fixture ' || v_suffix, 'body', 'asset', gen_random_uuid())
    RETURNING id INTO v_note;

  -- ===========================================================================
  -- 1. anon cannot read notifications
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM notifications WHERE id = v_note;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'anon reads no notifications');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', format('anon read %s notification(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. anon cannot CREATE a notification
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO notifications (user_id, type, title, message, context_type, context_id)
      VALUES (v_user_a, 'share', 'anon forged ' || v_suffix, 'body', 'asset', gen_random_uuid());
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM notifications WHERE title = 'anon forged ' || v_suffix;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (2, 'PASS', 'anon could not create a notification');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (2, 'FAIL', 'anon fabricated a notification'); END IF;

  -- ===========================================================================
  -- 3. Own-user SELECT still works  [required test 10]
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM notifications WHERE id = v_note;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (3, 'PASS', 'recipient reads their own notification');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (3, 'FAIL', format('recipient CANNOT read their own notification (count %s) - over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 4. Own-user UPDATE still works, and only for the read state
  --    [required test 11]
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE notifications SET is_read = true, read_at = now() WHERE id = v_note;
    BEGIN
      UPDATE notifications SET title = 'rewritten by recipient' WHERE id = v_note;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT title INTO v_title FROM notifications WHERE id = v_note;
  SELECT count(*) INTO v_count FROM notifications WHERE id = v_note AND is_read;
  IF v_count = 1 AND v_title = 'NT fixture ' || v_suffix THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (4, 'PASS', 'recipient acknowledged without rewriting the notification');
  ELSIF v_count <> 1 THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', 'recipient could not acknowledge their own notification - over-tightened');
  ELSE
    v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (4, 'FAIL', 'recipient rewrote the notification title');
  END IF;

  -- ===========================================================================
  -- 5. An authenticated user cannot INSERT AT ALL  [required test 9]
  --    Not "cannot insert for someone else" - cannot insert. Containment removes
  --    the grant, so even a self-addressed notification is refused.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO notifications (user_id, type, title, message, context_type, context_id)
      VALUES (v_user_b, 'share', 'self insert ' || v_suffix, 'body', 'asset', gen_random_uuid());
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM notifications WHERE title = 'self insert ' || v_suffix;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'authenticated direct INSERT is denied');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', 'an authenticated user inserted a notification directly'); END IF;

  -- ===========================================================================
  -- 6. A user cannot FABRICATE a notification for an unrelated user
  --    The finding this release exists to close: an attacker-authored message
  --    rendered inside the product's own notification centre.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO notifications (user_id, type, title, message, context_type, context_id)
      VALUES (v_user_a, 'share', 'cross user forged ' || v_suffix,
              'Your account requires attention', 'asset', gen_random_uuid());
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM notifications WHERE title = 'cross user forged ' || v_suffix;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'cross-user fabrication refused');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', 'user B fabricated a notification addressed to user A'); END IF;

  -- ===========================================================================
  -- 7. Cross-user SELECT and UPDATE stay denied  [required test 12]
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM notifications WHERE id = v_note;
    BEGIN
      UPDATE notifications SET is_read = true WHERE id = v_note;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'user B can neither read nor update user A notifications');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', format('user B read %s of user A notifications', v_count)); END IF;

  -- ===========================================================================
  -- 8. The trusted server-side path still creates notifications
  --    [required test 13]
  --    service_role holds BYPASSRLS, so containment must not touch it. If this
  --    fails, every trigger-driven notification is dead too.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE service_role;
    INSERT INTO notifications (user_id, type, title, message, context_type, context_id)
      VALUES (v_user_a, 'share', 'trusted path ' || v_suffix, 'body', 'asset', gen_random_uuid());
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM notifications WHERE title = 'trusted path ' || v_suffix;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (8, 'PASS', 'service_role can still create notifications');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (8, 'FAIL', 'the trusted server-side creation path is broken - trigger notifications are dead'); END IF;

  -- ===========================================================================
  -- 9. No invoker-rights function still writes this table
  --    [required test 13, the half that actually bites]
  --    Four notify_* functions and four helpers are SECURITY INVOKER in
  --    production. As invoker they run as the end user, so revoking the INSERT
  --    grant makes them raise - and they are attached to triggers on assets,
  --    price_targets and note_collaborations, so the user's own write fails with
  --    them. Step 04 section 1 promotes them; this proves it happened.
  -- ===========================================================================
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND NOT p.prosecdef
     AND p.prosrc ~* '\minsert\s+into\s+(public\.)?notifications\M';
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (9, 'PASS', 'no SECURITY INVOKER function inserts into notifications');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (9, 'FAIL', format('%s invoker-rights function(s) insert into notifications and will fail under containment', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM notifications WHERE user_id IN (v_user_a, v_user_b);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_user_a, v_user_b);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 9 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
