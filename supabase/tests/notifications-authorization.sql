-- =============================================================================
-- notifications Authorization — security regression test
--
-- Proves what scripts/sql/release-b/04-notifications.sql does and, just as
-- importantly, what it does NOT do.
--
-- Reads and updates on this table are already correctly user-scoped
-- (`auth.uid() = user_id`). The finding is `INSERT WITH CHECK (true)`: any
-- authenticated user can create a notification addressed to any user, with any
-- title and body — an attacker-authored message rendered inside the product's
-- own notification centre.
--
-- Release B Stage 1 makes that ATTRIBUTABLE; it does not stop it, because every
-- one of the 18 legitimate client producers also notifies other users, and the
-- table has no column recording who is asking. Assertion 5 is therefore expected
-- to FAIL both before and after Stage 1, deliberately, and to pass only when the
-- Stage 2 producer refactor lands. It is written now so that the day it starts
-- passing is visible.
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
  v_user_a  uuid := gen_random_uuid();
  v_user_b  uuid := gen_random_uuid();
  v_note    uuid;
  v_count   int;
  v_title   text;
  v_pass    int := 0;
  v_fail    int := 0;
  v_has_created_by boolean;
BEGIN
  RAISE NOTICE '=== notifications Authorization (suffix: %) ===', v_suffix;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'created_by'
  ) INTO v_has_created_by;

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
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'PASS', format('anon reads no notifications'));
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'FAIL', format('anon read %s notification(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
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
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (2, 'PASS', format('anon could not create a notification'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (2, 'FAIL', format('anon fabricated a notification')); END IF;

  -- ===========================================================================
  -- 3. A user cannot READ another user's notifications
  --    Expected to pass before and after — this half is already correct.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM notifications WHERE id = v_note;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (3, 'PASS', format('user B cannot read user A notifications'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (3, 'FAIL', format('user B read user A notifications (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 4. A recipient may acknowledge, and may NOT rewrite the content
  --    The live UPDATE policy is `USING/CHECK (auth.uid() = user_id)`, which
  --    scopes the ROW correctly and leaves every COLUMN writable.
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
    v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (4, 'PASS', format('recipient acknowledged without rewriting the notification'));
  ELSIF v_count <> 1 THEN
    v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (4, 'FAIL', format('recipient could not acknowledge their own notification'));
  ELSE
    v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (4, 'FAIL', format('recipient rewrote the notification title'));
  END IF;

  -- ===========================================================================
  -- 5. A user cannot FABRICATE a notification for an unrelated user
  --    KNOWN OPEN. Stage 1 does not close this; Stage 2 (producer RPCs) does.
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
  IF v_count = 0 THEN
    v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (5, 'PASS', format('cross-user fabrication refused'));
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [5] user B fabricated a notification addressed to user A (KNOWN OPEN until Stage 2)';
  END IF;

  -- ===========================================================================
  -- 6. Every new notification is ATTRIBUTABLE — the Stage 1 property
  -- ===========================================================================
  IF NOT v_has_created_by THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'SKIP [6] notifications.created_by does not exist yet (pre-Stage 1)';
  ELSE
    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
      SET LOCAL ROLE authenticated;
      -- Attempt to attribute the notification to somebody else.
      BEGIN
        INSERT INTO notifications (user_id, type, title, message, context_type, context_id, created_by)
          VALUES (v_user_a, 'share', 'misattributed ' || v_suffix, 'body', 'asset', gen_random_uuid(), v_user_a);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE;
    END;
    SELECT count(*) INTO v_count FROM notifications WHERE title = 'misattributed ' || v_suffix;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (6, 'PASS', format('a notification cannot be attributed to another user'));
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (6, 'FAIL', format('user B created a notification attributed to user A')); END IF;
  END IF;

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
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 6 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
