-- =============================================================================
-- Organization BYOK provider key: Vault custody
--
-- THE DEFECTS (both measured in PRODUCTION before 20261110020000)
--
--   Two ways to read a firm's Anthropic API key from a browser.
--
--   1. public.organization_ai_config.byok_api_key -- a plain text column
--      covered by the table's SELECT policy, with `authenticated` holding
--      SELECT on the table. Measured 2026-11-09 as an org admin with a real
--      auth.uid(): `select byok_api_key from organization_ai_config` returned
--      the full 108-character sk-ant- value.
--
--   2. public.get_org_ai_config_for_resolution(uuid) -- SECURITY DEFINER,
--      RETURNS byok_api_key, EXECUTE held by `authenticated`, and its only
--      gate was "active member of the requested org", NOT admin. Measured the
--      same day as a user whose membership role is literally 'member':
--
--          NONADMIN_can_read_key_via_rpc  true
--          key_length_seen                108
--
--      One supabase.rpc() call from the devtools console. This is the hole
--      that mattered; the admin column read was the narrow one.
--
--   The comment in src/hooks/useAIConfig.ts claimed the key is "never shipped
--   to the browser, even for admins". True of the app's own query path, false
--   of the database underneath it.
--
-- WHAT THESE 17 ASSERTIONS PIN
--
--   1-3    The write side. An org admin can store a key; the safe summary RPC
--          reports it as configured without carrying the value; a non-admin
--          member cannot store one.
--   4-5    The two measured holes are closed. 4 is the dropped column
--          (undefined_column). 5 is the dropped RPC (undefined_function), by
--          the same plain member who could read it before.
--   6-7    Its replacement is unreachable by `authenticated`, for a non-admin
--          AND for an admin. Being able to SET a key is not being able to READ
--          one; that asymmetry is the design, and it works because
--          vault.create_secret is executable by postgres and not by
--          authenticated.
--   8-9    anon can neither resolve a key nor overwrite one. Supabase creates
--          every public function anon-executable, and a REVOKE FROM PUBLIC
--          does not remove a grant held by the role itself, so both revokes in
--          the migration are load-bearing and these two assertions are what
--          say so.
--   10     The backstop: the vault schema is out of reach for a browser role,
--          so a leaked secret id is not a leaked secret.
--   11-12  PRESERVE ACCESS. service_role resolves the key, and the value
--          round-trips byte for byte. Without these the suite would pass just
--          as happily against a key nobody can read at all, which is a broken
--          product rather than a secured one -- the lesson from
--          trade-delete-paths.sql, where five denial assertions passed
--          vacuously against a dead end.
--   13-14  Cross-org scope, write and read. The write takes no org argument at
--          all, which is what makes it hard to get wrong; assert it anyway.
--   15     A non-ASCII key is refused at the door. HTTP headers are Latin-1,
--          so a smart quote from a copy/paste makes the provider fetch throw
--          before it sends -- days later, with nothing pointing at the paste.
--   16-17  The clear path: denied to a member; for an admin it destroys the
--          vault row, keeps the config row, and disables BYOK.
--
-- Expected: 17/17 after 20261110020000. Before it, 4, 5, 6, 7 and 10 FAIL --
-- those are the open doors -- while 11 and 12 pass, because the key was
-- readable by everyone including service_role.
--
-- No real key is used. The fixtures are literal fakes, and no secret VALUE is
-- ever emitted: the details carry lengths and booleans only.
--
-- TRANSACTION SAFETY
--
-- The whole file runs inside BEGIN ... ROLLBACK, so nothing it writes can
-- persist by any exit path: normal completion, a failed assertion, or an
-- unhandled error. The ROLLBACK is the guarantee and must never be replaced
-- with COMMIT.
--
-- It replaced an explicit cleanup block for a measured reason rather than a
-- stylistic one. Deleting the three fixture auth users cost 74.9s of the
-- suite's 86.5s, because 338 foreign keys reference the users tables and 196
-- of them have no supporting index, so each delete sequentially scans those
-- 196 tables. That left under 15s for the 17 assertions inside the Management
-- API's ~100s ceiling, and the suite died with a Cloudflare 524 on every run
-- while still executing server-side to completion. A rollback discards the
-- same rows without firing a single cascade check. Those unindexed foreign
-- keys are a real pre-existing property of this database, recorded here and
-- deliberately not fixed here.
--
-- It touches no real customer record: every row is one it created, in two
-- throwaway organizations with random slugs. The single production
-- organization_ai_config row and its vault secret are read by no assertion
-- and written by none.
--
-- Trigger-generated rows are covered as well: inserting an auth user fires
-- handle_new_user(), which mirrors it into public.users and creates default
-- asset_lists and list_statuses the fixture never asked for. The rollback
-- takes those with it.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS _byok_results;
CREATE TEMP TABLE _byok_results(n int, result text, detail text);
-- Several assertions switch into `authenticated` or `anon` and record their
-- outcome from inside that role, so both need write access to the scratch
-- table. Without this the first role-switched INSERT fails 42501 and the
-- suite reports nothing at all.
GRANT ALL ON _byok_results TO authenticated, anon;

-- PROOF THAT ASSERTIONS 6 AND 7 ARE NOT VACUOUS (Standing Rule 3).
-- Adding this line here, which is the exact grant the migration revokes,
-- flips 6 and 7 to FAIL ("non-admin member resolved the key, 82 chars" /
-- "org admin resolved the key, 82 chars") and the runner to exit 1. Verified
-- 2026-11-10. It is safe to repeat: the grant rolls back with everything else
-- in the transaction, so the live privilege is never widened.
--
--   GRANT EXECUTE ON FUNCTION public.resolve_org_ai_config(uuid) TO authenticated;

DO $$
DECLARE
  v_sfx       text := substr(md5(random()::text), 1, 8);
  v_org_a     uuid;
  v_org_b     uuid;
  v_admin_a   uuid := gen_random_uuid();   -- org A, is_org_admin = true
  v_member_a  uuid := gen_random_uuid();   -- org A, is_org_admin = false
  v_admin_b   uuid := gen_random_uuid();   -- org B, is_org_admin = true
  -- Shaped like a real key, and deliberately not one.
  v_key       text := 'sk-ant-api03-TESTONLY-' || repeat('x', 60);
  v_key2      text := 'sk-ant-api03-TESTONLY-' || repeat('y', 60);
  v_secret_a  uuid;
  v_secret_b  uuid;
  v_len       int;
  v_flag      boolean;
  v_denied    boolean;
  v_state     text;
  v_msg       text;
  v_pass      int := 0;
  v_fail      int := 0;
BEGIN
  -- ===========================================================================
  -- SETUP
  -- ===========================================================================
  INSERT INTO organizations (name, slug) VALUES ('BYOK Org A ' || v_sfx, 'byok-a-' || v_sfx)
    RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('BYOK Org B ' || v_sfx, 'byok-b-' || v_sfx)
    RETURNING id INTO v_org_b;

  -- handle_new_user() mirrors each auth user into public.users.
  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_admin_a,  'byok_aa_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_member_a, 'byok_am_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_admin_b,  'byok_ba_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  -- is_active_org_admin_of_current_org() reads is_org_admin, not `role`.
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_admin_a,  'active', true),
    (v_org_a, v_member_a, 'active', false),
    (v_org_b, v_admin_b,  'active', true);

  -- current_org_id() reads users.current_organization_id and re-checks the
  -- membership is active, so both halves are required for any probe below.
  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_admin_a, v_member_a);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_admin_b;

  -- ===========================================================================
  -- 1. An org admin can store a key.
  -- ===========================================================================
  v_denied := false; v_msg := '';
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    PERFORM set_org_ai_api_key(v_key);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true; v_msg := SQLERRM;
  END;
  IF NOT v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (1,'PASS','an org admin stored a key through set_org_ai_api_key()');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (1,'FAIL','an org admin could NOT store a key: ' || v_msg);
  END IF;

  SELECT byok_secret_id INTO v_secret_a FROM organization_ai_config WHERE organization_id = v_org_a;

  -- ===========================================================================
  -- 2. The safe summary RPC reports it as configured, without the value. The
  --    result type has no key column at all, so this is a shape assertion as
  --    much as a behaviour one.
  -- ===========================================================================
  v_flag := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT is_configured INTO v_flag FROM get_org_ai_config_summary();
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_flag := NULL;
  END;
  IF coalesce(v_flag, false) THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (2,'PASS','get_org_ai_config_summary() reports is_configured and carries no key column');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (2,'FAIL','get_org_ai_config_summary() did not report the key as configured');
  END IF;

  -- ===========================================================================
  -- 3. A non-admin member cannot store a key.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    PERFORM set_org_ai_api_key(v_key2);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (3,'PASS','a non-admin member cannot store a key');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (3,'FAIL','a non-admin member STORED an organization key');
  END IF;

  -- ===========================================================================
  -- 4. DEFECT 1 CLOSED. There is no plaintext column left to read, so an
  --    admin's reference to it is an undefined_column (42703).
  -- ===========================================================================
  v_denied := false; v_len := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT length(byok_api_key) FROM organization_ai_config WHERE organization_id = $1'
      INTO v_len USING v_org_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true; v_state := SQLSTATE;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (4,'PASS','org admin cannot read a plaintext key column (SQLSTATE ' || v_state || ')');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (4,'FAIL','org admin read a plaintext key column, ' || coalesce(v_len::text,'null') || ' chars');
  END IF;

  -- ===========================================================================
  -- 5. DEFECT 2 CLOSED, and by the same plain member who could read it before.
  --    Expect undefined_function (42883).
  -- ===========================================================================
  v_denied := false; v_len := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT length(byok_api_key) FROM get_org_ai_config_for_resolution($1)'
      INTO v_len USING v_org_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true; v_state := SQLSTATE;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (5,'PASS','get_org_ai_config_for_resolution() is unreachable to a plain member (SQLSTATE ' || v_state || ')');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (5,'FAIL','a plain MEMBER read the key via the old RPC, ' || coalesce(v_len::text,'null') || ' chars');
  END IF;

  -- ===========================================================================
  -- 6. The replacement is unreachable by a non-admin member (42501).
  -- ===========================================================================
  v_denied := false; v_len := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT length(byok_api_key) FROM resolve_org_ai_config($1)' INTO v_len USING v_org_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true; v_state := SQLSTATE;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (6,'PASS','non-admin member cannot execute resolve_org_ai_config() (SQLSTATE ' || v_state || ')');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (6,'FAIL','non-admin member resolved the key, ' || coalesce(v_len::text,'null') || ' chars');
  END IF;

  -- ===========================================================================
  -- 7. Nor by an org ADMIN. Write without read.
  -- ===========================================================================
  v_denied := false; v_len := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT length(byok_api_key) FROM resolve_org_ai_config($1)' INTO v_len USING v_org_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true; v_state := SQLSTATE;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (7,'PASS','org admin cannot execute resolve_org_ai_config() either (SQLSTATE ' || v_state || ')');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (7,'FAIL','org admin resolved the key, ' || coalesce(v_len::text,'null') || ' chars');
  END IF;

  -- ===========================================================================
  -- 8. anon cannot resolve a key.
  -- ===========================================================================
  v_denied := false; v_len := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    EXECUTE 'SELECT length(byok_api_key) FROM resolve_org_ai_config($1)' INTO v_len USING v_org_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true; v_state := SQLSTATE;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (8,'PASS','anon cannot execute resolve_org_ai_config() (SQLSTATE ' || v_state || ')');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (8,'FAIL','anon resolved the key, ' || coalesce(v_len::text,'null') || ' chars');
  END IF;

  -- ===========================================================================
  -- 9. anon cannot overwrite a firm's provider key.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    SET LOCAL ROLE anon;
    EXECUTE 'SELECT set_org_ai_api_key($1)' USING v_key2;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true; v_state := SQLSTATE;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (9,'PASS','anon cannot execute set_org_ai_api_key() (SQLSTATE ' || v_state || ')');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (9,'FAIL','anon overwrote an organization key');
  END IF;

  -- ===========================================================================
  -- 10. The backstop. A browser role cannot read the vault, so a leaked
  --     secret id is not a leaked secret.
  -- ===========================================================================
  v_denied := false; v_len := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT length(decrypted_secret) FROM vault.decrypted_secrets WHERE id = $1'
      INTO v_len USING v_secret_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true; v_state := SQLSTATE;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (10,'PASS','authenticated cannot read vault.decrypted_secrets (SQLSTATE ' || v_state || ')');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (10,'FAIL','authenticated read the vault directly, ' || coalesce(v_len::text,'null') || ' chars');
  END IF;

  -- ===========================================================================
  -- 11. PRESERVE ACCESS. service_role resolves the key, or ai-chat cannot call
  --     a provider and every assertion above is a wall, not a boundary.
  -- ===========================================================================
  v_len := NULL; v_msg := '';
  BEGIN
    SET LOCAL ROLE service_role;
    SELECT length(byok_api_key) INTO v_len FROM resolve_org_ai_config(v_org_a);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_len := NULL; v_msg := SQLERRM;
  END;
  IF v_len = length(v_key) THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (11,'PASS','service_role resolves the key (' || v_len || ' chars, the length that was stored)');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (11,'FAIL','service_role could not resolve the key: got ' ||
      coalesce(v_len::text,'null') || ', expected ' || length(v_key) || '. ' || v_msg);
  END IF;

  -- ===========================================================================
  -- 12. And it round-trips byte for byte. A mangled key is a provider 401 days
  --     later with nothing pointing here.
  -- ===========================================================================
  v_flag := NULL;
  BEGIN
    SET LOCAL ROLE service_role;
    SELECT byok_api_key = v_key INTO v_flag FROM resolve_org_ai_config(v_org_a);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_flag := NULL;
  END;
  IF coalesce(v_flag, false) THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (12,'PASS','the stored value round-trips through Vault byte for byte');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (12,'FAIL','the resolved key does not equal the key that was stored');
  END IF;

  -- ===========================================================================
  -- 13. Cross-org WRITE scope. Org B's admin stores org B's key; org A's is
  --     untouched and still its own distinct secret.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    PERFORM set_org_ai_api_key(v_key2);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT byok_secret_id INTO v_secret_b FROM organization_ai_config WHERE organization_id = v_org_b;

  v_flag := NULL;
  BEGIN
    SET LOCAL ROLE service_role;
    SELECT byok_api_key = v_key INTO v_flag FROM resolve_org_ai_config(v_org_a);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_flag := NULL;
  END;
  IF coalesce(v_flag, false) AND v_secret_b IS NOT NULL AND v_secret_b <> v_secret_a THEN
    v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (13,'PASS','org B admin wrote org B only; org A key unchanged and a distinct secret');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (13,'FAIL','cross-org write scope: orgA_intact=' || coalesce(v_flag::text,'null') ||
      ', orgB_secret=' || coalesce(v_secret_b::text,'null') ||
      ', distinct=' || (v_secret_b IS DISTINCT FROM v_secret_a)::text);
  END IF;

  -- ===========================================================================
  -- 14. Cross-org READ scope. Org B's admin sees org B in the summary and
  --     never org A, though both rows now exist.
  -- ===========================================================================
  v_flag := NULL;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT bool_and(organization_id = v_org_b) INTO v_flag FROM get_org_ai_config_summary();
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_flag := NULL;
  END;
  IF coalesce(v_flag, false) THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (14,'PASS','the summary RPC is scoped to the caller''s own org');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (14,'FAIL','the summary RPC returned another org''s row, or none at all');
  END IF;

  -- ===========================================================================
  -- 15. A non-ASCII key is refused at the door.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    PERFORM set_org_ai_api_key('sk-ant-api03-' || chr(8220) || repeat('z', 60));
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (15,'PASS','a key carrying a non-ASCII character is refused');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (15,'FAIL','a key carrying a non-ASCII character was accepted');
  END IF;

  -- ===========================================================================
  -- 16. A non-admin member cannot clear the key.
  -- ===========================================================================
  v_denied := false;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    PERFORM clear_org_ai_api_key();
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_denied := true;
  END;
  IF v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (16,'PASS','a non-admin member cannot clear the key');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (16,'FAIL','a non-admin member cleared the organization key');
  END IF;

  -- ===========================================================================
  -- 17. An admin can: the vault row is destroyed, the config row survives,
  --     and BYOK is disabled rather than left enabled against nothing.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    PERFORM clear_org_ai_api_key();
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT (byok_secret_id IS NULL AND byok_enabled = false) INTO v_flag
    FROM organization_ai_config WHERE organization_id = v_org_a;
  v_denied := NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = v_secret_a);

  IF coalesce(v_flag, false) AND v_denied THEN v_pass := v_pass + 1;
    INSERT INTO _byok_results VALUES (17,'PASS','an admin clear destroys the vault secret, keeps the config row and disables BYOK');
  ELSE v_fail := v_fail + 1;
    INSERT INTO _byok_results VALUES (17,'FAIL','clear left state behind: row_cleared=' || coalesce(v_flag::text,'null') ||
      ', vault_row_gone=' || v_denied::text);
  END IF;

  -- ===========================================================================
  -- No CLEANUP block. The ROLLBACK at the end of the file is the guarantee,
  -- and it is both stronger and ~75x cheaper than the DELETEs that used to be
  -- here: it cannot be defeated by an assertion raising before cleanup is
  -- reached, and it fires none of the 338 foreign key checks that deleting an
  -- auth user does. See TRANSACTION SAFETY in the header.
  --
  -- Worth recording, because the old cleanup block had to work around it and a
  -- future reader may reintroduce one: deleting a fixture user directly fails
  -- 23503. handle_new_user() gives every new auth user a default asset_list,
  -- whose list_statuses carry created_by -> users(id) ON DELETE SET NULL
  -- beside list_id -> asset_lists ON DELETE CASCADE; the SET NULL
  -- re-validates list_id against the row that just cascaded away. Deleting
  -- list_statuses, then asset_lists, then the user makes each cascade
  -- single-sided. A real production defect, recorded and not fixed here.
  -- ===========================================================================

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 17 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _byok_results ORDER BY n, result;

-- The guarantee. Do not replace this with COMMIT.
ROLLBACK;
