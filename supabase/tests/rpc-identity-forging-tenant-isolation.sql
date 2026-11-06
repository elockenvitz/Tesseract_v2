-- =============================================================================
-- Identity-forging RPCs - cross-tenant write regression test
--
-- Pins the functions repaired by
-- supabase/migrations/20261106160300_sec_identity_forging_rpcs.sql:
--
--   mark_conversation_read(p_conversation_id, p_user_id)
--   get_or_create_private_view(p_lab_id, p_user_id)
--   get_or_create_trade_lab(p_portfolio_id)
--   ensure_default_scenarios(p_asset_id)
--
-- WHAT WAS MEASURED AGAINST PRODUCTION 2026-11-06, as a user in organization B
-- with no relationship to organization A:
--
--   mark_conversation_read      cleared the VICTIM's unread marker (1 row)
--   get_or_create_private_view  created a trade_lab_views row inside org A's
--                               lab, OWNED BY the victim (1 row)
--   get_or_create_trade_lab     created a trade_labs row on org A's portfolio,
--                               having first read that portfolio's name
--
-- All three are cross-organization WRITES performed by a user who cannot read
-- any of the rows involved. They were classified as "suspected" before this
-- test existed; the measurements above make them confirmed.
--
-- ensure_default_scenarios was NOT exploitable by anon (measured: 42501, it
-- holds no EXECUTE), but it had no caller check and no asset check at all.
--
-- EXPECTED RESULTS BEFORE THE MIGRATION IS APPLIED
--   Assertions 1, 2 and 3 FAIL.
--   Assertion 4 passes before and after (anon was already refused).
--   Assertions 5, 6 and 7 pass before and after: they are the
--   did-we-break-anything side.
--
-- EXPECTED RESULTS AFTER: all 7 pass. Measured.
--
-- NOT COVERED BY THIS FILE
--
-- ensure_pilot_decision_request_for_user also had its identity forced to
-- auth.uid(). It is not exercised here: reaching its INSERT needs a
-- pilot_scenarios row joined to a trade_queue_items row with an active
-- trade_proposals row, and that fixture chain is larger than the one-line
-- substitution it would be testing. The frontend already calls it with no
-- arguments (src/hooks/usePilotSeeding.ts:134), so the DEFAULT auth.uid() is
-- what production uses today and the fix makes that the only behaviour. If
-- that function is ever called with an explicit argument, add a case here.
--
-- TRANSACTION SAFETY
--
-- The whole file runs inside BEGIN ... ROLLBACK, so nothing it writes can
-- persist by any exit path: normal completion, a failed assertion, or an
-- unhandled error. The explicit CLEANUP DELETEs are defence in depth, not the
-- guarantee; the ROLLBACK is. Cleanup does not depend on a deliberately raised
-- exception, and the ROLLBACK must never be replaced with COMMIT.
--
-- Trigger-generated rows are covered: inserting a public.users row fires
-- create_default_lists_trigger, which creates asset_lists the fixture never
-- asked for, and seed_default_list_statuses then seeds their statuses.
--
-- THE ONE PLACE IT TOUCHES A REAL ROW, AND WHY THAT IS SAFE
--
-- It reads one EXISTING asset id, because `assets` is global reference data
-- with no organization_id and creating one would be the larger intrusion. It
-- passes that id only to ensure_default_scenarios, and only from the `anon`
-- role in assertion 4, which is a branch that expects a refusal. Should that
-- refusal ever stop happening, the function's own guard returns early when
-- default scenarios already exist, and the ROLLBACK discards any row it did
-- write. No real asset, scenario or organization row survives this file.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS _sec_results;
CREATE TEMP TABLE _sec_results(n int, result text, detail text);
GRANT ALL ON _sec_results TO authenticated, anon;

DO $$
DECLARE
  s text := substr(md5(random()::text), 1, 8);
  v_org_a uuid; v_org_b uuid;
  v_owner uuid := gen_random_uuid();   -- org A
  v_atk uuid := gen_random_uuid();     -- org B, the attacker
  v_pf uuid; v_lab uuid; v_conv uuid; v_asset uuid;
  v_view uuid; v_lab2 uuid; v_count int;
  v_pass int := 0; v_fail int := 0;
  v_views uuid[] := '{}';
BEGIN
  -- ===========================================================================
  -- FIXTURE
  -- ===========================================================================
  SELECT id INTO v_asset FROM assets ORDER BY created_at LIMIT 1;

  INSERT INTO organizations (name, slug) VALUES ('RPC-ID A ' || s, 'rpc-id-a-' || s) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('RPC-ID B ' || s, 'rpc-id-b-' || s) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner, 'rpcid_owner_' || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_atk,   'rpcid_atk_'   || s || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner, 'active', false),
    (v_org_b, v_atk, 'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id = v_owner;
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_atk;

  INSERT INTO portfolios (name, organization_id, created_by)
    VALUES ('ORG A PORTFOLIO ' || s, v_org_a, v_owner) RETURNING id INTO v_pf;
  INSERT INTO trade_labs (portfolio_id, name, created_by)
    VALUES (v_pf, 'ORG A LAB ' || s, v_owner) RETURNING id INTO v_lab;
  INSERT INTO conversations (organization_id, created_by) VALUES (v_org_a, v_owner) RETURNING id INTO v_conv;
  -- A deliberately old watermark, so "was it moved" is unambiguous.
  INSERT INTO conversation_participants (conversation_id, user_id, last_read_at)
    VALUES (v_conv, v_owner, '2020-01-01T00:00:00Z');

  -- ===========================================================================
  -- 1. CROSS-ORG WRITE: clear another user's unread marker.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_atk, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  PERFORM mark_conversation_read(v_conv, v_owner);
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  SELECT count(*) INTO v_count FROM conversation_participants
    WHERE conversation_id = v_conv AND user_id = v_owner AND last_read_at > '2020-01-02T00:00:00Z';
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (1, 'PASS', 'forged p_user_id does not touch the victim''s participation row');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (1, 'FAIL', 'CROSS-ORG WRITE: the attacker cleared the victim''s unread marker'); END IF;
  UPDATE conversation_participants SET last_read_at = '2020-01-01T00:00:00Z'
    WHERE conversation_id = v_conv AND user_id = v_owner;

  -- ===========================================================================
  -- 2. CROSS-ORG WRITE: create a view inside another org's lab, owned by the
  --    victim. Two forgeries in one call: the lab and the owner.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_atk, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_view := get_or_create_private_view(v_lab, v_owner);
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    v_views := v_views || v_view;
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (2, 'FAIL', 'CROSS-ORG WRITE: the attacker created a private view in org A''s lab');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (2, 'PASS', format('the attacker was denied on org A''s lab (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 3. CROSS-ORG READ + WRITE: reach another org's portfolio. The lab is
  --    deleted first so the function takes its create branch, which is the
  --    branch that reads the portfolio's name.
  -- ===========================================================================
  DELETE FROM trade_lab_views WHERE lab_id = v_lab;
  DELETE FROM trade_labs WHERE id = v_lab;
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_atk, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_lab2 := get_or_create_trade_lab(v_pf);
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (3, 'FAIL', 'CROSS-ORG WRITE: the attacker created a trade lab on org A''s portfolio');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (3, 'PASS', format('the attacker was denied on org A''s portfolio (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 4. ANON must not reach ensure_default_scenarios. Expected to pass both
  --    before and after: anon already holds no EXECUTE.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM ensure_default_scenarios(v_asset);
    RESET ROLE;
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (4, 'FAIL', 'anon can seed default scenarios');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1;
    INSERT INTO _sec_results VALUES (4, 'PASS', format('anon denied on ensure_default_scenarios (%s)', SQLSTATE));
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- 5, 6, 7. LEGITIMATE: the owner. All three must keep working.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  PERFORM mark_conversation_read(v_conv, v_owner);
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  SELECT count(*) INTO v_count FROM conversation_participants
    WHERE conversation_id = v_conv AND user_id = v_owner AND last_read_at > '2020-01-02T00:00:00Z';
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (5, 'PASS', 'the owner can still mark their own conversation read');
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (5, 'FAIL', 'the owner can no longer mark their own conversation read - OVER-TIGHTENED'); END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_lab2 := get_or_create_trade_lab(v_pf);
    IF v_lab2 IS NOT NULL THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (6, 'PASS', 'the owner still gets their portfolio''s trade lab');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (6, 'FAIL', 'the owner got NULL - OVER-TIGHTENED'); END IF;

    v_view := get_or_create_private_view(v_lab2, v_owner);
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    v_views := v_views || v_view;
    SELECT count(*) INTO v_count FROM trade_lab_views WHERE id = v_view AND owner_id = v_owner;
    IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results VALUES (7, 'PASS', 'the owner still gets a private view owned by themselves');
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results VALUES (7, 'FAIL', 'the owner''s private view is missing or owned by someone else'); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    SET LOCAL request.jwt.claims = '';
    v_fail := v_fail + 1;
    INSERT INTO _sec_results VALUES (6, 'FAIL', format('the owner''s trade-lab path is BROKEN (%s %s) - OVER-TIGHTENED', SQLSTATE, SQLERRM));
  END;
  RESET ROLE;
  SET LOCAL request.jwt.claims = '';

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  DELETE FROM trade_lab_views WHERE id = ANY(v_views);
  DELETE FROM trade_lab_views WHERE lab_id IN (SELECT id FROM trade_labs WHERE portfolio_id = v_pf);
  DELETE FROM trade_labs WHERE portfolio_id = v_pf;
  DELETE FROM conversation_participants WHERE conversation_id = v_conv;
  DELETE FROM conversations WHERE id = v_conv;
  DELETE FROM portfolios WHERE id = v_pf;
  -- Inserting a public.users row fires create_default_lists_trigger, which
  -- creates a default asset_lists row per user, and seed_default_list_statuses
  -- then seeds its statuses. Leaving them makes the users delete below fail
  -- with 23503 on list_statuses_list_id_fkey.
  DELETE FROM list_statuses WHERE list_id IN (SELECT id FROM asset_lists WHERE created_by IN (v_owner, v_atk));
  DELETE FROM asset_lists WHERE created_by IN (v_owner, v_atk);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_owner, v_atk);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM public.users WHERE id IN (v_owner, v_atk);
  DELETE FROM auth.users WHERE id IN (v_owner, v_atk);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 7 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;

-- The guarantee. Do not replace this with COMMIT.
ROLLBACK;
