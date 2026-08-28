-- =============================================================================
-- Personal coverage owner immutability — security tests
--
-- Acceptance criteria for 20260828120000_coverage_personal_owner_immutable.sql.
--
--   [1]  the owner can create their own personal row
--   [2]  the owner cannot change user_id on it
--   [3]  another normal user cannot change user_id on it
--   [4]  a coverage admin cannot change the personal owner        <- the gap
--   [5]  a privileged/owner-role UPDATE cannot silently change it <- the gap
--   [6]  notes-only personal update still works
--   [7]  delete + re-create still follows normal personal rules
--   [8]  ORG coverage retains normal admin owner reassignment
--   [9]  scope immutability still works (Stage 3, unchanged)
--   [10] the tenant boundary still works (Stage 1/3, unchanged)
--
-- [4] and [5] are the gap. Both fail before this migration and pass after.
--
-- [3] passes either way — RLS already stops a non-owner reaching the row — and
-- is kept because it pins the behaviour the fix does NOT depend on.
--
-- [8] is the regression that matters most: reassigning a governed name between
-- analysts is a normal coverage-admin action and must survive untouched.
--
-- ── Reading a BEFORE run ────────────────────────────────────────────────────
--
-- Against Stage 3 without this migration the suite reports 6 passed / 4 failed:
-- [4], [5], AND [6], [7]. Only the first two are independent defects. [6] and
-- [7] fail as a CASCADE of them — once the admin in [4] has taken the row,
-- OWNER_A is no longer its owner, so the personal UPDATE policy stops them
-- editing it ([6]) and deleting it ([7]).
--
-- That is worth seeing rather than engineering around: it is the blast radius
-- of the gap, stated in assertions. A user whose declaration is reassigned does
-- not merely lose attribution, they lose the row. All four pass together after
-- the migration.
--
-- ── How these run ───────────────────────────────────────────────────────────
--
-- Fixtures are created as the table owner; each assertion then runs as
-- `authenticated` with a JWT `sub`, except [5], which deliberately runs as the
-- table owner with RLS bypassed — that is the privileged path the trigger has
-- to cover and no policy can.
--
-- The whole suite ends in RAISE EXCEPTION, so Postgres aborts the transaction
-- and no fixture can survive. There is no cleanup block to trust.
--
-- 10 assertions. Synthetic fixtures, ids in a reserved range.
-- =============================================================================

DO $$
DECLARE
  OA      uuid := 'aaaa0000-0000-0000-0000-00000000e001';
  OB      uuid := 'aaaa0000-0000-0000-0000-00000000e002';
  OWNER_A uuid := 'bbbb0000-0000-0000-0000-00000000e001';  -- normal user, org A
  OTHER_A uuid := 'bbbb0000-0000-0000-0000-00000000e002';  -- normal user, org A
  ADMIN_A uuid := 'bbbb0000-0000-0000-0000-00000000e003';  -- coverage admin, org A
  USER_B  uuid := 'bbbb0000-0000-0000-0000-00000000e004';  -- normal user, org B
  AS1 uuid := 'cccc0000-0000-0000-0000-00000000e001';
  AS2 uuid := 'cccc0000-0000-0000-0000-00000000e002';
  AS3 uuid := 'cccc0000-0000-0000-0000-00000000e003';

  v_pers uuid; v_org uuid; v_b uuid; v_new uuid;
  v_rows int; v_n int; v_state text; v_owner uuid; v_scope text;
  r text := ''; pass int := 0; fail int := 0;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (id, name, slug) VALUES
    (OA, 'OI Org A _oitest', 'oi-org-a-oitest'),
    (OB, 'OI Org B _oitest', 'oi-org-b-oitest');

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (OWNER_A,'oi_owner_oitest@f.test','{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (OTHER_A,'oi_other_oitest@f.test','{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ADMIN_A,'oi_admin_oitest@f.test','{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (USER_B, 'oi_userb_oitest@f.test','{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status) VALUES
    (OA, OWNER_A, false, 'active'), (OA, OTHER_A, false, 'active'),
    (OA, ADMIN_A, true,  'active'), (OB, USER_B,  false, 'active');

  UPDATE users SET current_organization_id = OA WHERE id IN (OWNER_A, OTHER_A, ADMIN_A);
  UPDATE users SET current_organization_id = OB WHERE id = USER_B;
  UPDATE users SET coverage_admin = false WHERE id IN (OWNER_A, OTHER_A, USER_B);
  UPDATE users SET coverage_admin = true  WHERE id = ADMIN_A;

  INSERT INTO assets (id, symbol, company_name) VALUES
    (AS1,'OIA1','OI Asset 1 _oitest'),
    (AS2,'OIA2','OI Asset 2 _oitest'),
    (AS3,'OIA3','OI Asset 3 _oitest');

  -- ===========================================================================
  -- [1] The owner creates their own personal row.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', OWNER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS1, OWNER_A, 'OI Owner', OA, 'personal') RETURNING id INTO v_pers;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected:'||SQLSTATE; v_pers := NULL; END;
  RESET ROLE;
  IF v_pers IS NOT NULL THEN
    pass := pass+1; r := r || E'\nPASS [1] owner created their own personal coverage';
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [1] owner could not self-declare (%s)', v_state);
  END IF;

  -- ===========================================================================
  -- [2] The owner cannot hand it to someone else.
  --
  -- RLS admits this row to OWNER_A, so the personal UPDATE policy does not stop
  -- it — the WITH CHECK requires `user_id = auth.uid()`, which a handover to
  -- OTHER_A would violate. Either mechanism refusing is a pass; what must not
  -- happen is the owner changing.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', OWNER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET user_id = OTHER_A WHERE id = v_pers;
    v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected:'||SQLSTATE; END;
  RESET ROLE;
  SELECT user_id INTO v_owner FROM coverage WHERE id = v_pers;
  IF v_owner = OWNER_A THEN
    pass := pass+1; r := r || format(E'\nPASS [2] owner cannot reassign their own personal row (%s)', v_state);
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [2] owner became %s', v_owner);
  END IF;

  -- ===========================================================================
  -- [3] Another normal user cannot. Stopped by RLS before the trigger is
  --     reached; kept so a future widening of the personal lane fails loudly.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', OTHER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET user_id = OTHER_A WHERE id = v_pers;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_rows := 0; v_state := 'rejected:'||SQLSTATE; END;
  RESET ROLE;
  SELECT user_id INTO v_owner FROM coverage WHERE id = v_pers;
  IF v_owner = OWNER_A THEN
    pass := pass+1; r := r || format(E'\nPASS [3] a colleague cannot reassign it (%s, %s row(s))', v_state, v_rows);
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [3] a colleague took ownership: %s', v_owner);
  END IF;

  -- ===========================================================================
  -- [4] THE GAP. A coverage admin's UPDATE policy admits every row in the
  --     organization, including personal ones, so nothing before Stage 3.5
  --     stopped this.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET user_id = OTHER_A, analyst_name = 'OI Other' WHERE id = v_pers;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_rows := 0; v_state := 'rejected:'||SQLSTATE; END;
  RESET ROLE;
  SELECT user_id INTO v_owner FROM coverage WHERE id = v_pers;
  IF v_owner = OWNER_A THEN
    pass := pass+1; r := r || format(E'\nPASS [4] a coverage admin cannot reassign a personal row (%s)', v_state);
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [4] admin reassigned a personal declaration to %s', v_owner);
  END IF;

  -- ===========================================================================
  -- [5] THE GAP, privileged path. Runs as the table owner with RLS bypassed —
  --     the same reach `service_role` has. No policy can cover this, which is
  --     why the invariant is a trigger.
  -- ===========================================================================
  BEGIN
    UPDATE coverage SET user_id = OTHER_A WHERE id = v_pers;
    v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected:'||SQLSTATE; END;
  SELECT user_id INTO v_owner FROM coverage WHERE id = v_pers;
  IF v_owner = OWNER_A THEN
    pass := pass+1; r := r || format(E'\nPASS [5] a privileged RLS-bypassing UPDATE cannot reassign it (%s)', v_state);
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [5] service-role-equivalent UPDATE reassigned it to %s', v_owner);
  END IF;

  -- ===========================================================================
  -- [6] Notes-only personal update still works. The guard must not have turned
  --     personal rows read-only to their own owner.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', OWNER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET notes = 'watching into print' WHERE id = v_pers;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_rows := 0; v_state := 'rejected:'||SQLSTATE; END;
  RESET ROLE;
  IF v_rows = 1 AND (SELECT notes FROM coverage WHERE id = v_pers) = 'watching into print' THEN
    pass := pass+1; r := r || E'\nPASS [6] notes-only personal update still works';
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [6] owner can no longer edit their own row (%s)', v_state);
  END IF;

  -- ===========================================================================
  -- [7] Delete and re-create still follows normal personal rules. This is the
  --     supported way to move a declaration between people: the new owner makes
  --     their own, which is the point of the invariant rather than a workaround.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', OWNER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  DELETE FROM coverage WHERE id = v_pers;
  RESET ROLE;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', OTHER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS1, OTHER_A, 'OI Other', OA, 'personal') RETURNING id INTO v_new;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected:'||SQLSTATE; v_new := NULL; END;
  RESET ROLE;
  IF (SELECT count(*) FROM coverage WHERE id = v_pers) = 0 AND v_new IS NOT NULL THEN
    pass := pass+1; r := r || E'\nPASS [7] delete then re-create by the new owner still works';
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [7] delete/re-create broke (%s)', v_state);
  END IF;

  -- ===========================================================================
  -- [8] REGRESSION THAT MATTERS MOST. Org-assigned coverage must retain normal
  --     admin owner reassignment — that is a legitimate, everyday coverage
  --     action and the `analyst_changed` history type exists to record it.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, is_active, start_date)
  VALUES (AS2, OWNER_A, 'OI Owner', OA, 'org', true, CURRENT_DATE - 10) RETURNING id INTO v_org;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET user_id = OTHER_A, analyst_name = 'OI Other' WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_rows := 0; v_state := 'rejected:'||SQLSTATE; END;
  RESET ROLE;
  SELECT user_id INTO v_owner FROM coverage WHERE id = v_org;
  IF v_rows = 1 AND v_owner = OTHER_A THEN
    pass := pass+1; r := r || E'\nPASS [8] org coverage still supports admin owner reassignment';
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [8] admin reassignment of ORG coverage broke (%s, owner=%s)', v_state, v_owner);
  END IF;

  -- ===========================================================================
  -- [9] Stage 3 scope immutability, unchanged in both directions.
  -- ===========================================================================
  BEGIN
    UPDATE coverage SET coverage_scope = 'personal' WHERE id = v_org;
    v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected:'||SQLSTATE; END;
  SELECT coverage_scope INTO v_scope FROM coverage WHERE id = v_org;
  IF v_scope = 'org' AND v_state LIKE 'rejected:%' THEN
    pass := pass+1; r := r || format(E'\nPASS [9] scope immutability intact (%s)', v_state);
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [9] org row became scope=%s', v_scope);
  END IF;

  -- ===========================================================================
  -- [10] Tenant boundary, unchanged. Org B's user sees and touches nothing.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, is_active, start_date)
  VALUES (AS3, USER_B, 'OI User B', OB, 'org', true, CURRENT_DATE - 5) RETURNING id INTO v_b;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_B, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM coverage WHERE organization_id = OA;
  BEGIN
    UPDATE coverage SET notes = 'cross-tenant' WHERE id = v_org;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_rows := 0; END;
  RESET ROLE;
  IF v_n = 0 AND v_rows = 0
     AND (SELECT notes FROM coverage WHERE id = v_org) IS DISTINCT FROM 'cross-tenant' THEN
    pass := pass+1; r := r || E'\nPASS [10] tenant boundary intact (no cross-org read or write)';
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [10] cross-tenant leak: read %s row(s), wrote %s', v_n, v_rows);
  END IF;

  RAISE EXCEPTION E'PERSONAL OWNER IMMUTABILITY (rolled back): % passed, % failed of 10%',
    pass, fail, r;
END;
$$;
