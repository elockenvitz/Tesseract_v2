-- =============================================================================
-- Organization Onboarding Policy Tests
--
-- Tests for onboarding_policy column, join_org request type,
-- (Updated for Early Access: routing and approval only GRANT membership for a
--  caller with can_invite_members() authority. Tests 5, 6 and 9 assert both
--  halves — refused without it, still working with it — so a green run cannot
--  mean "domain routing is simply broken".)
-- policy-aware route_org_for_email, approve_org_join_request RPC,
-- and audit log entries.
-- 10 assertions total.
--
-- Self-cleaning: uses unique suffix + cleanup block.
-- Run from SQL Editor (service role) or psql.
-- =============================================================================

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org_id uuid;
  v_user_id uuid;
  v_admin_id uuid;
  v_route jsonb;
  v_action text;
  v_count int;
  v_request_id uuid;
  v_result jsonb;
  v_action_gated text;      -- what an ordinary user gets
  v_denied boolean;         -- did the ungated attempt refuse?
  v_membership_status text;
  v_pass int := 0;
  v_fail int := 0;
BEGIN
  RAISE NOTICE '=== Org Onboarding Policy Tests (suffix: %) ===', v_suffix;

  -- ── Setup: synthetic identities ──────────────────────────────────────────
  --
  -- This used to borrow the two oldest rows out of auth.users, and RETURN
  -- quietly when there were fewer than two — which meant that on a near-empty
  -- staging database the entire file reported success without running a single
  -- assertion. It also meant the test user's real address had nothing to do
  -- with the verified domain under test: routing "worked" only because
  -- route_org_for_email trusted the p_email ARGUMENT. Now that identity comes
  -- from auth.users, the caller has to genuinely be at the domain, so the
  -- harness owns its fixtures.
  v_admin_id := gen_random_uuid();
  v_user_id  := gen_random_uuid();

  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_admin_id, 'policyadmin_' || v_suffix || '@fixture.test', now(), '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    -- deliberately AT the verified domain the tests add below
    (v_user_id,  'policyuser_'  || v_suffix || '@policy-' || v_suffix || '.com', now(), '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  RAISE NOTICE 'Admin user: %, Test user: %', v_admin_id, v_user_id;

  -- Create test org
  INSERT INTO organizations (name, slug)
  VALUES ('PolicyTest_' || v_suffix, 'policy-test-' || v_suffix)
  RETURNING id INTO v_org_id;

  -- Admin is active member + admin
  INSERT INTO organization_memberships (user_id, organization_id, status, is_org_admin, role)
  VALUES (v_admin_id, v_org_id, 'active', true, 'admin');

  -- Add verified domain for this org
  INSERT INTO organization_domains (organization_id, domain, status, created_by, verified_at)
  VALUES (v_org_id, 'policy-' || v_suffix || '.com', 'verified', v_admin_id, now());

  -- ── Test 1: onboarding_policy column exists with CHECK constraint ───────

  BEGIN
    UPDATE organizations SET onboarding_policy = 'invalid_value' WHERE id = v_org_id;
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [1] Invalid policy value should be rejected';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [1] Invalid policy value correctly rejected by CHECK';
  END;

  -- ── Test 2: Default value is invite_only on new org ─────────────────────

  DECLARE
    v_temp_org_id uuid;
    v_policy text;
  BEGIN
    INSERT INTO organizations (name, slug)
    VALUES ('TempOrg_' || v_suffix, 'temp-org-' || v_suffix)
    RETURNING id INTO v_temp_org_id;

    SELECT onboarding_policy INTO v_policy FROM organizations WHERE id = v_temp_org_id;

    IF v_policy = 'invite_only' THEN
      v_pass := v_pass + 1;
      RAISE NOTICE 'PASS [2] Default onboarding_policy is invite_only';
    ELSE
      v_fail := v_fail + 1;
      RAISE NOTICE 'FAIL [2] Expected invite_only, got %', v_policy;
    END IF;

    DELETE FROM organizations WHERE id = v_temp_org_id;
  END;

  -- ── Test 3: Invalid policy value rejected (already tested in 1, extra) ──

  BEGIN
    UPDATE organizations SET onboarding_policy = 'banana' WHERE id = v_org_id;
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [3] Banana policy should be rejected';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [3] Another invalid value correctly rejected';
  END;

  -- ── Test 4: join_org accepted by request_type CHECK ─────────────────────

  BEGIN
    INSERT INTO access_requests (organization_id, requester_id, request_type, status)
    VALUES (v_org_id, v_user_id, 'join_org', 'pending')
    RETURNING id INTO v_request_id;

    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [4] join_org accepted by request_type CHECK';

    -- Clean up for later tests
    DELETE FROM access_requests WHERE id = v_request_id;
  END;

  -- ── Test 5: Open policy → auto_join ─────────────────────────────────────

  -- Remove any existing membership for test user
  DELETE FROM organization_memberships WHERE user_id = v_user_id AND organization_id = v_org_id;

  UPDATE organizations SET onboarding_policy = 'open' WHERE id = v_org_id;

  -- Call route as the test user
  SET LOCAL role TO authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user_id::text,
    'role', 'authenticated'
  )::text, true);

  SELECT route_org_for_email('policyuser_' || v_suffix || '@policy-' || v_suffix || '.com') INTO v_route;
  RESET role;
  v_action_gated := v_route->>'action';

  -- Early Access: an ordinary user does not self-join, whatever the policy
  -- says. Then the same call with membership-granting authority, which must
  -- still auto-join — otherwise this test cannot tell "correctly gated" from
  -- "domain routing is broken".
  INSERT INTO platform_admins (user_id) VALUES (v_user_id) ON CONFLICT DO NOTHING;
  SET LOCAL role TO authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user_id::text, 'role', 'authenticated')::text, true);
  SELECT route_org_for_email('policyuser_' || v_suffix || '@policy-' || v_suffix || '.com') INTO v_route;
  RESET role;
  DELETE FROM platform_admins WHERE user_id = v_user_id;

  v_action := v_route->>'action';
  IF v_action_gated = 'blocked' AND v_action = 'auto_join' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [5] Open policy: ordinary user blocked, authority holder auto_joins';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [5] Expected blocked then auto_join, got % then %', v_action_gated, v_action;
  END IF;

  -- ── Test 6: approval_required → request_created ─────────────────────────

  -- Clean up membership from test 5
  DELETE FROM organization_memberships WHERE user_id = v_user_id AND organization_id = v_org_id;
  DELETE FROM access_requests WHERE requester_id = v_user_id AND organization_id = v_org_id;

  UPDATE organizations SET onboarding_policy = 'approval_required' WHERE id = v_org_id;

  SET LOCAL role TO authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user_id::text,
    'role', 'authenticated'
  )::text, true);

  SELECT route_org_for_email('policyuser_' || v_suffix || '@policy-' || v_suffix || '.com') INTO v_route;
  RESET role;
  v_action_gated := v_route->>'action';

  INSERT INTO platform_admins (user_id) VALUES (v_user_id) ON CONFLICT DO NOTHING;
  SET LOCAL role TO authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user_id::text, 'role', 'authenticated')::text, true);
  SELECT route_org_for_email('policyuser_' || v_suffix || '@policy-' || v_suffix || '.com') INTO v_route;
  RESET role;
  DELETE FROM platform_admins WHERE user_id = v_user_id;

  v_action := v_route->>'action';
  IF v_action_gated = 'blocked' AND v_action = 'request_created' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [6] Approval_required: ordinary user blocked, authority holder creates a request';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [6] Expected blocked then request_created, got % then %', v_action_gated, v_action;
  END IF;

  -- ── Test 7: invite_only → blocked ───────────────────────────────────────

  -- Clean up from test 6
  DELETE FROM organization_memberships WHERE user_id = v_user_id AND organization_id = v_org_id;
  DELETE FROM access_requests WHERE requester_id = v_user_id AND organization_id = v_org_id;

  UPDATE organizations SET onboarding_policy = 'invite_only' WHERE id = v_org_id;

  SET LOCAL role TO authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user_id::text,
    'role', 'authenticated'
  )::text, true);

  SELECT route_org_for_email('policyuser_' || v_suffix || '@policy-' || v_suffix || '.com') INTO v_route;

  RESET role;

  v_action := v_route->>'action';
  IF v_action = 'blocked' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [7] Invite_only returns action=blocked';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [7] Expected blocked, got %', v_action;
  END IF;

  -- ── Test 8: Duplicate pending join_org prevented (unique index) ─────────

  -- Create first pending request
  INSERT INTO access_requests (organization_id, requester_id, request_type, status)
  VALUES (v_org_id, v_user_id, 'join_org', 'pending');

  BEGIN
    INSERT INTO access_requests (organization_id, requester_id, request_type, status)
    VALUES (v_org_id, v_user_id, 'join_org', 'pending');
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [8] Duplicate pending join_org should be rejected';
  EXCEPTION WHEN unique_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [8] Duplicate pending join_org correctly prevented';
  END;

  -- Clean up requests
  DELETE FROM access_requests WHERE requester_id = v_user_id AND organization_id = v_org_id;

  -- ── Test 9: approve_org_join_request activates membership ───────────────

  -- Setup: create pending request + pending membership
  DELETE FROM organization_memberships WHERE user_id = v_user_id AND organization_id = v_org_id;

  INSERT INTO access_requests (organization_id, requester_id, request_type, status)
  VALUES (v_org_id, v_user_id, 'join_org', 'pending')
  RETURNING id INTO v_request_id;

  INSERT INTO organization_memberships (user_id, organization_id, status, role)
  VALUES (v_user_id, v_org_id, 'pending', 'member');

  -- Call as admin
  SET LOCAL role TO authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_id::text,
    'role', 'authenticated'
  )::text, true);

  -- First as a plain org admin, which Early Access no longer accepts.
  v_denied := false;
  BEGIN
    SELECT approve_org_join_request(v_request_id, 'approved', null) INTO v_result;
  EXCEPTION WHEN assert_failure OR OTHERS THEN
    v_denied := true;
  END;
  RESET role;

  -- Then with membership-granting authority, which must still provision.
  INSERT INTO platform_admins (user_id) VALUES (v_admin_id) ON CONFLICT DO NOTHING;
  SET LOCAL role TO authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_id::text, 'role', 'authenticated')::text, true);
  SELECT approve_org_join_request(v_request_id, 'approved', null) INTO v_result;
  RESET role;
  DELETE FROM platform_admins WHERE user_id = v_admin_id;

  SELECT status INTO v_membership_status
  FROM organization_memberships
  WHERE user_id = v_user_id AND organization_id = v_org_id;

  IF v_denied AND v_membership_status = 'active' AND (v_result->>'provisioned_membership')::boolean = true THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [9] Join approval: org admin refused, platform admin activates membership';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [9] org-admin denied=%, status=%, result=%', v_denied, v_membership_status, v_result;
  END IF;

  -- ── Test 10: Audit log entries for auto_join, join_requested, join_approved

  SELECT count(*) INTO v_count
  FROM organization_audit_log
  WHERE organization_id = v_org_id
    AND action IN ('member.auto_joined', 'member.join_requested', 'member.join_approved');

  IF v_count >= 3 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [10] Audit log has % onboarding entries (auto_join + requested + approved)', v_count;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [10] Expected >= 3 audit entries, got %', v_count;
  END IF;

  -- ── Summary + Cleanup ───────────────────────────────────────────────────

  RAISE NOTICE '';
  RAISE NOTICE '=== Results: % passed, % failed (of 10) ===', v_pass, v_fail;

  DELETE FROM organization_audit_log WHERE organization_id = v_org_id;
  DELETE FROM access_requests WHERE organization_id = v_org_id;
  DELETE FROM organization_domains WHERE organization_id = v_org_id;
  DELETE FROM organization_memberships WHERE organization_id = v_org_id;
  DELETE FROM organizations WHERE id = v_org_id;
  DELETE FROM platform_admins WHERE user_id IN (v_admin_id, v_user_id);
  DELETE FROM auth.users WHERE id IN (v_admin_id, v_user_id);

  IF v_fail > 0 THEN
    RAISE EXCEPTION '% test(s) failed', v_fail;
  END IF;
END $$;
