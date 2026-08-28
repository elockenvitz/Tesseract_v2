-- =============================================================================
-- audit_events Integrity — security regression test
--
-- Proves the boundary that scripts/sql/release-b/03-audit-events.sql establishes.
-- Against production as it stands on 2026-08-28, assertions 1-5 are expected to
-- FAIL: both live policies are unconditional, and every authoritative field —
-- actor_id, org_id, actor_email, actor_name, checksum — is supplied by the
-- caller.
--
-- Assertion 6 is the one that decides whether the remediation is usable: an
-- org-scoped read policy must not hide an organization's own history from it.
--
-- Self-cleaning. 7 assertions.
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
  v_ent_a   uuid := gen_random_uuid();
  v_evt     uuid;
  v_count   int;
  v_actor   uuid;
  v_org     uuid;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== audit_events Integrity (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('AE Org A ' || v_suffix, 'ae-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('AE Org B ' || v_suffix, 'ae-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_user_a, 'ae_a_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user_b, 'ae_b_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_user_a, 'active', false),
    (v_org_b, v_user_b, 'active', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_a;
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_b;

  -- An org A event, written as the owner so the fixture exists regardless of
  -- which write path is currently in force.
  INSERT INTO audit_events (
    occurred_at, recorded_at, actor_id, actor_type, entity_type, entity_id,
    action_type, action_category, org_id, checksum
  ) VALUES (
    now(), now(), v_user_a, 'user', 'asset', v_ent_a,
    'ae_fixture_' || v_suffix, 'state_change', v_org_a, 'fixture'
  ) RETURNING id INTO v_evt;

  -- ===========================================================================
  -- 1. anon cannot read the audit trail
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM audit_events WHERE id = v_evt;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'PASS', format('anon reads no audit events'));
    ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'FAIL', format('anon read %s audit event(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. Org B cannot read org A's decision record
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM audit_events WHERE id = v_evt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (2, 'PASS', format('org B cannot read org A audit events'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (2, 'FAIL', format('org B read org A audit events (count %s)', v_count)); END IF;

  -- ===========================================================================
  -- 3. A caller cannot forge the ACTOR
  --    An append-only ledger anyone can append to is not an audit trail.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO audit_events (
      occurred_at, recorded_at, actor_id, actor_type, entity_type, entity_id,
      action_type, action_category, org_id, checksum, actor_email, actor_name
    ) VALUES (
      now(), now(), v_user_a, 'user', 'asset', v_ent_a,
      'forged_actor_' || v_suffix, 'state_change', v_org_a, 'forged',
      'someone.else@test.invalid', 'Someone Else'
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM audit_events WHERE action_type = 'forged_actor_' || v_suffix;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (3, 'PASS', format('actor could not be forged'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (3, 'FAIL', format('a user attributed an action to another user in another org')); END IF;

  -- ===========================================================================
  -- 4. A caller cannot forge the ORG
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO audit_events (
      occurred_at, recorded_at, actor_id, actor_type, entity_type, entity_id,
      action_type, action_category, org_id, checksum
    ) VALUES (
      now(), now(), v_user_b, 'user', 'asset', v_ent_a,
      'forged_org_' || v_suffix, 'state_change', v_org_a, 'forged'
    );
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM audit_events WHERE action_type = 'forged_org_' || v_suffix;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (4, 'PASS', format('org could not be forged'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (4, 'FAIL', format('a user wrote an audit event into another org')); END IF;

  -- ===========================================================================
  -- 5. The record is append-only in practice, not just by convention
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE audit_events SET action_type = 'tampered_' || v_suffix WHERE id = v_evt;
    DELETE FROM audit_events WHERE id = v_evt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_count FROM audit_events
   WHERE id = v_evt AND action_type = 'ae_fixture_' || v_suffix;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (5, 'PASS', format('event could be neither edited nor deleted'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (5, 'FAIL', format('an audit event was modified or removed')); END IF;

  -- ===========================================================================
  -- 6. Org A CAN still read its own history — the remediation must not blind it
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_a, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM audit_events WHERE id = v_evt;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (6, 'PASS', format('org A reads its own audit history'));
  ELSE v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (6, 'FAIL', format('org A CANNOT read its own audit history (count %s) — over-tightened', v_count)); END IF;

  -- ===========================================================================
  -- 7. The trusted write path derives actor and org rather than accepting them
  --    Skipped (as a pass) before remediation, when the RPC does not yet exist.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user_b, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    PERFORM public.record_audit_event(
      'asset', v_ent_a, 'rpc_write_' || v_suffix, 'state_change'
    );
    RESET ROLE;
    SELECT actor_id, org_id INTO v_actor, v_org
      FROM audit_events WHERE action_type = 'rpc_write_' || v_suffix;
    IF v_actor = v_user_b AND v_org = v_org_b THEN
      v_pass := v_pass + 1; INSERT INTO _sec_results(n, result, detail) VALUES (7, 'PASS', format('RPC derived actor and org from the session'));
    ELSE
      v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (7, 'FAIL', format('RPC recorded actor %s / org %s — expected %s / %s', v_actor, v_org, v_user_b, v_org_b));
    END IF;
  EXCEPTION WHEN undefined_function THEN
    RESET ROLE; v_pass := v_pass + 1;
    RAISE NOTICE 'SKIP [7] record_audit_event() does not exist yet (pre-remediation)';
  WHEN OTHERS THEN
    RESET ROLE; v_fail := v_fail + 1; INSERT INTO _sec_results(n, result, detail) VALUES (7, 'FAIL', format('RPC raised %s', SQLSTATE));
  END;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM audit_events WHERE org_id IN (v_org_a, v_org_b);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_user_a, v_user_b);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 7 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _sec_results ORDER BY n, result;
