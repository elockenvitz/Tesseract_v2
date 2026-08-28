-- =============================================================================
-- Coverage self-service — security tests
--
-- Acceptance criteria for the Stage 3 pair:
--   20260828110000_coverage_scope_and_self_service_rls.sql
--   20260828110100_coverage_triggers_scope_aware.sql
--
-- BOTH are required. Assertions [15]-[18] fail against the first migration
-- alone: adding a personal lane without teaching the triggers about lanes gives
-- every authenticated user a one-insert way to retire admin-assigned coverage.
-- That is the point of running this file between the two.
--
--   TENANT BOUNDARY   [1]-[4]    no cross-org read, insert, move or delete
--   PERSONAL LANE     [5]-[10]   own rows only, no forging, no lane escape
--   ORG LANE          [11]-[14]  normal users cannot touch it; admins still can
--   TRIGGERS          [15]-[20]  supersession and history respect lane + owner
--   MIGRATION         [21]-[24]  legacy rows, counts, ownership, defaults
--   ADMIN SUPERSEDE   [25]       an org assignment does not retire personal rows
--
-- ── Where each trigger defect is actually exposed ───────────────────────────
--
-- The two triggers have different exposure, and the tests are shaped around it.
--
-- `end_previous_coverage()` is SECURITY INVOKER, so its UPDATE is filtered by
-- whatever policy admits the caller. For a personal-lane insert that is
-- `coverage_update_own_personal`, which already narrows the blast radius to the
-- inserting user's own personal rows — so [15] and [16] pass even with a
-- lane-blind trigger. They are kept because they pin that, but they are NOT
-- where the defect shows.
--
-- [25] is. A coverage admin's UPDATE policy admits every row in the
-- organization, so an admin inserting an org assignment reaches personal rows
-- with nothing narrowing it. `service_role` and the table owner bypass RLS
-- entirely and behave the same way.
--
-- `log_coverage_change()` is SECURITY DEFINER, so RLS masks nothing at all and
-- [18] fails against the RLS migration alone: a second user's personal
-- declaration gets logged as `analyst_changed` naming the first user.
--
-- ── How these run ───────────────────────────────────────────────────────────
--
-- Fixtures are created as the table owner, then every assertion runs as
-- `authenticated` with a JWT `sub`, because the policies are the thing under
-- test and the owner bypasses RLS entirely. The trigger assertions deliberately
-- run through the same authenticated path: a trigger that fires on an ordinary
-- user's insert is exactly the case that matters.
--
-- The whole suite ends in RAISE EXCEPTION, so the transaction is aborted by
-- Postgres and no fixture can survive — there is no cleanup block to trust and
-- no path that leaves a row behind. The results ride out on the exception
-- message.
--
-- 25 assertions. Synthetic fixtures only, ids in a reserved range.
-- =============================================================================

DO $$
DECLARE
  OA        uuid := 'aaaa0000-0000-0000-0000-0000000000a1';
  OB        uuid := 'aaaa0000-0000-0000-0000-0000000000b1';
  ADMIN_A   uuid := 'bbbb0000-0000-0000-0000-0000000000a1';
  USER_A    uuid := 'bbbb0000-0000-0000-0000-0000000000a2';
  USER_A2   uuid := 'bbbb0000-0000-0000-0000-0000000000a3';
  ADMIN_B   uuid := 'bbbb0000-0000-0000-0000-0000000000b1';
  USER_B    uuid := 'bbbb0000-0000-0000-0000-0000000000b2';
  AS1 uuid := 'cccc0000-0000-0000-0000-000000000001';
  AS2 uuid := 'cccc0000-0000-0000-0000-000000000002';
  AS3 uuid := 'cccc0000-0000-0000-0000-000000000003';
  AS4 uuid := 'cccc0000-0000-0000-0000-000000000004';
  AS5 uuid := 'cccc0000-0000-0000-0000-000000000005';
  AS6 uuid := 'cccc0000-0000-0000-0000-000000000006';
  AS7 uuid := 'cccc0000-0000-0000-0000-000000000007';
  AS8 uuid := 'cccc0000-0000-0000-0000-000000000008';

  v_org_b_row   uuid;   -- an org-lane row owned by org B
  v_org_a_row   uuid;   -- an org-lane row owned by org A
  v_pers_a      uuid;   -- USER_A's personal row
  v_pers_a2     uuid;   -- USER_A2's personal row
  v_legacy1     uuid;
  v_legacy2     uuid;

  v_rows int; v_n int; v_state text; v_scope text; v_owner uuid; v_type text;
  r text := ''; pass int := 0; fail int := 0;

  PROCEDURE_marker text;
BEGIN
  -- ---- fixtures, as owner -------------------------------------------------
  INSERT INTO organizations (id, name, slug) VALUES
    (OA, 'S3 Org A _s3test', 's3-org-a-s3test'),
    (OB, 'S3 Org B _s3test', 's3-org-b-s3test');

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (ADMIN_A,'s3_admin_a_s3test@f.test','{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (USER_A, 's3_user_a_s3test@f.test', '{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (USER_A2,'s3_user_a2_s3test@f.test','{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ADMIN_B,'s3_admin_b_s3test@f.test','{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (USER_B, 's3_user_b_s3test@f.test', '{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status) VALUES
    (OA, ADMIN_A, true, 'active'), (OA, USER_A, false, 'active'), (OA, USER_A2, false, 'active'),
    (OB, ADMIN_B, true, 'active'), (OB, USER_B, false, 'active');

  UPDATE users SET current_organization_id = OA WHERE id IN (ADMIN_A, USER_A, USER_A2);
  UPDATE users SET current_organization_id = OB WHERE id IN (ADMIN_B, USER_B);
  UPDATE users SET coverage_admin = false WHERE id IN (USER_A, USER_A2, USER_B);
  UPDATE users SET coverage_admin = true  WHERE id IN (ADMIN_A, ADMIN_B);

  INSERT INTO assets (id, symbol, company_name) VALUES
    (AS1,'S3A1','S3 Asset 1 _s3test'),(AS2,'S3A2','S3 Asset 2 _s3test'),
    (AS3,'S3A3','S3 Asset 3 _s3test'),(AS4,'S3A4','S3 Asset 4 _s3test'),
    (AS5,'S3A5','S3 Asset 5 _s3test'),(AS6,'S3A6','S3 Asset 6 _s3test'),
    (AS7,'S3A7','S3 Asset 7 _s3test'),(AS8,'S3A8','S3 Asset 8 _s3test');

  -- ===========================================================================
  -- [21][22][23] Legacy rows: seeded WITHOUT naming coverage_scope, exactly as
  -- every pre-Stage-3 write path did. They must land in the governed lane by
  -- default, keep their owner, and not be reassigned to anyone.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date, created_by)
  VALUES (AS1, USER_A, 'S3 User A', OA, true, CURRENT_DATE - 60, ADMIN_A) RETURNING id INTO v_legacy1;
  -- created_by = user_id, the shape that could be mistaken for self-declared.
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date, created_by)
  VALUES (AS2, USER_A2, 'S3 User A2', OA, true, CURRENT_DATE - 60, USER_A2) RETURNING id INTO v_legacy2;

  SELECT count(*) INTO v_n FROM coverage
   WHERE id IN (v_legacy1, v_legacy2) AND coverage_scope = 'org';
  IF v_n = 2 THEN
    pass := pass+1; r := r || E'\nPASS [21] legacy-shaped rows default to org scope';
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [21] only %s of 2 legacy rows are org scope', v_n);
  END IF;

  SELECT count(*) INTO v_n FROM coverage WHERE organization_id = OA;
  IF v_n = 2 THEN
    pass := pass+1; r := r || E'\nPASS [22] row count preserved by the backfill default';
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [22] expected 2 org A rows, found %s', v_n);
  END IF;

  IF (SELECT user_id FROM coverage WHERE id = v_legacy1) = USER_A
     AND (SELECT user_id FROM coverage WHERE id = v_legacy2) = USER_A2
     AND (SELECT coverage_scope FROM coverage WHERE id = v_legacy2) = 'org' THEN
    pass := pass+1;
    r := r || E'\nPASS [23] no ownership reassignment; created_by=user_id still reads as org';
  ELSE
    fail := fail+1; r := r || E'\nFAIL [23] a legacy row changed owner or lane';
  END IF;

  -- [24] The scope column rejects anything outside the two lanes, so a replay
  -- or a later writer cannot introduce a third.
  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS8, USER_A, 'S3 User A', OA, 'sometimes');
    v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected'; END;
  IF v_state = 'rejected' THEN
    pass := pass+1; r := r || E'\nPASS [24] an unknown coverage_scope is rejected by the constraint';
  ELSE
    fail := fail+1; r := r || E'\nFAIL [24] an arbitrary coverage_scope was accepted';
  END IF;

  -- Org-lane fixtures for the boundary and trigger assertions.
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, is_active, start_date)
  VALUES (AS3, USER_B, 'S3 User B', OB, 'org', true, CURRENT_DATE - 30) RETURNING id INTO v_org_b_row;
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, is_active, start_date)
  VALUES (AS4, USER_A, 'S3 User A', OA, 'org', true, CURRENT_DATE - 30) RETURNING id INTO v_org_a_row;

  -- ===========================================================================
  -- TENANT BOUNDARY [1]-[4] — org A's normal user against org B's rows
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_n FROM coverage WHERE organization_id = OB;
  IF v_n = 0 THEN pass := pass+1; r := r || E'\nPASS [1] cross-org SELECT returns nothing';
  ELSE fail := fail+1; r := r || format(E'\nFAIL [1] read %s org B row(s)', v_n); END IF;

  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS5, USER_A, 'S3 User A', OB, 'personal');
    v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected'; END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM coverage WHERE organization_id = OB AND asset_id = AS5;
  IF v_state = 'rejected' AND v_n = 0 THEN
    pass := pass+1; r := r || E'\nPASS [2] cannot INSERT into another organization';
  ELSE fail := fail+1; r := r || E'\nFAIL [2] wrote a row into org B'; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET organization_id = OB WHERE id = v_org_a_row;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_rows := 0; v_state := 'rejected'; END;
  RESET ROLE;
  IF (SELECT organization_id FROM coverage WHERE id = v_org_a_row) = OA THEN
    pass := pass+1; r := r || E'\nPASS [3] cannot move a row into another organization';
  ELSE fail := fail+1; r := r || E'\nFAIL [3] a row was moved to org B'; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN DELETE FROM coverage WHERE id = v_org_b_row; EXCEPTION WHEN OTHERS THEN NULL; END;
  RESET ROLE;
  IF (SELECT count(*) FROM coverage WHERE id = v_org_b_row) = 1 THEN
    pass := pass+1; r := r || E'\nPASS [4] cannot DELETE another organization''s coverage';
  ELSE fail := fail+1; r := r || E'\nFAIL [4] deleted an org B row'; END IF;

  -- ===========================================================================
  -- PERSONAL LANE [5]-[10]
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS5, USER_A, 'S3 User A', OA, 'personal') RETURNING id INTO v_pers_a;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected:'||SQLSTATE; v_pers_a := NULL; END;
  RESET ROLE;
  IF v_pers_a IS NOT NULL THEN
    pass := pass+1; r := r || E'\nPASS [5] a normal user created their own personal coverage';
  ELSE fail := fail+1; r := r || format(E'\nFAIL [5] normal user could not self-declare (%s)', v_state); END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS6, USER_A2, 'S3 User A2', OA, 'personal');
    v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected'; END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM coverage WHERE asset_id = AS6 AND user_id = USER_A2;
  IF v_state = 'rejected' AND v_n = 0 THEN
    pass := pass+1; r := r || E'\nPASS [6] cannot create personal coverage for another user';
  ELSE fail := fail+1; r := r || E'\nFAIL [6] assigned personal coverage to a colleague'; END IF;

  -- USER_A2's own personal row, created by USER_A2, for [7] and [8].
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A2, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
  VALUES (AS6, USER_A2, 'S3 User A2', OA, 'personal') RETURNING id INTO v_pers_a2;
  RESET ROLE;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET notes = 'tampered' WHERE id = v_pers_a2;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_rows := 0; END;
  RESET ROLE;
  IF v_rows = 0 AND (SELECT notes FROM coverage WHERE id = v_pers_a2) IS DISTINCT FROM 'tampered' THEN
    pass := pass+1; r := r || E'\nPASS [7] cannot update another user''s personal coverage';
  ELSE fail := fail+1; r := r || E'\nFAIL [7] modified a colleague''s personal row'; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN DELETE FROM coverage WHERE id = v_pers_a2; EXCEPTION WHEN OTHERS THEN NULL; END;
  RESET ROLE;
  IF (SELECT count(*) FROM coverage WHERE id = v_pers_a2) = 1 THEN
    pass := pass+1; r := r || E'\nPASS [8] cannot delete another user''s personal coverage';
  ELSE fail := fail+1; r := r || E'\nFAIL [8] deleted a colleague''s personal row'; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET organization_id = OB WHERE id = v_pers_a;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RESET ROLE;
  IF (SELECT organization_id FROM coverage WHERE id = v_pers_a) = OA THEN
    pass := pass+1; r := r || E'\nPASS [9] cannot change organization_id on own personal row';
  ELSE fail := fail+1; r := r || E'\nFAIL [9] moved own personal row to another org'; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET coverage_scope = 'org' WHERE id = v_pers_a;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RESET ROLE;
  IF (SELECT coverage_scope FROM coverage WHERE id = v_pers_a) = 'personal' THEN
    pass := pass+1; r := r || E'\nPASS [10] cannot promote personal coverage to the org lane';
  ELSE fail := fail+1; r := r || E'\nFAIL [10] personal row escaped into the org lane'; END IF;

  -- ===========================================================================
  -- ORG LANE [11]-[14]
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS7, USER_A, 'S3 User A', OA, 'org');
    v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected'; END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM coverage WHERE asset_id = AS7 AND coverage_scope = 'org';
  IF v_state = 'rejected' AND v_n = 0 THEN
    pass := pass+1; r := r || E'\nPASS [11] a normal user cannot create org coverage';
  ELSE fail := fail+1; r := r || E'\nFAIL [11] a non-admin created governed coverage'; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET notes = 'tampered', is_active = false WHERE id = v_org_a_row;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_rows := 0; END;
  RESET ROLE;
  IF v_rows = 0 AND (SELECT is_active FROM coverage WHERE id = v_org_a_row) THEN
    pass := pass+1; r := r || E'\nPASS [12] a normal user cannot mutate org coverage';
  ELSE fail := fail+1; r := r || E'\nFAIL [12] a non-admin mutated governed coverage'; END IF;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS7, USER_A2, 'S3 User A2', OA, 'org');
    UPDATE coverage SET notes = 'admin touched' WHERE id = v_org_a_row;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    DELETE FROM coverage WHERE asset_id = AS7 AND organization_id = OA;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected:'||SQLSTATE; v_rows := 0; END;
  RESET ROLE;
  IF v_state = 'ok' AND v_rows = 1 THEN
    pass := pass+1; r := r || E'\nPASS [13] an authorized admin still creates, updates and deletes org coverage';
  ELSE fail := fail+1; r := r || format(E'\nFAIL [13] admin org CRUD broke (%s, %s row(s))', v_state, v_rows); END IF;

  -- [14] admin authority is same-org: the coverage_admin flag is global, so the
  -- organization predicate is the only thing stopping org B's admin here.
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', ADMIN_B, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE coverage SET notes = 'foreign admin' WHERE id = v_org_a_row;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_rows := 0; END;
  RESET ROLE;
  IF v_rows = 0 AND (SELECT notes FROM coverage WHERE id = v_org_a_row) IS DISTINCT FROM 'foreign admin' THEN
    pass := pass+1; r := r || E'\nPASS [14] a coverage admin of another org cannot reach these rows';
  ELSE fail := fail+1; r := r || E'\nFAIL [14] a foreign admin mutated org A coverage'; END IF;

  -- ===========================================================================
  -- TRIGGERS [15]-[20]
  --
  -- Org A is armed with allow_multiple_coverage = false, so the supersede
  -- branch genuinely runs for every insert below. This is the configuration in
  -- which an unnarrowed trigger is destructive.
  -- ===========================================================================
  INSERT INTO coverage_settings (organization_id, allow_multiple_coverage, updated_by)
  VALUES (OA, false, ADMIN_A);

  -- AS1 already carries USER_A's org-lane legacy row and now gains USER_A2's
  -- personal row; USER_A then declares personal coverage of the same asset.
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A2, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, start_date)
  VALUES (AS1, USER_A2, 'S3 User A2', OA, 'personal', CURRENT_DATE - 20) RETURNING id INTO v_pers_a2;
  RESET ROLE;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, start_date)
  VALUES (AS1, USER_A, 'S3 User A', OA, 'personal', CURRENT_DATE);
  RESET ROLE;

  IF (SELECT is_active FROM coverage WHERE id = v_pers_a2) THEN
    pass := pass+1; r := r || E'\nPASS [15] a personal insert did not retire another user''s personal coverage';
  ELSE fail := fail+1; r := r || E'\nFAIL [15] a personal insert retired a colleague''s personal row'; END IF;

  IF (SELECT is_active FROM coverage WHERE id = v_legacy1) THEN
    pass := pass+1; r := r || E'\nPASS [16] a personal insert did not retire admin-assigned org coverage';
  ELSE fail := fail+1; r := r || E'\nFAIL [16] a personal insert retired governed org coverage'; END IF;

  -- [17] the same user's own earlier personal row IS superseded, which is the
  -- behaviour the setting asks for within a single owner's lane.
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A2, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, start_date)
  VALUES (AS1, USER_A2, 'S3 User A2 later', OA, 'personal', CURRENT_DATE);
  RESET ROLE;
  IF (SELECT is_active FROM coverage WHERE id = v_pers_a2) IS FALSE THEN
    pass := pass+1; r := r || E'\nPASS [17] same-user personal supersede still works';
  ELSE fail := fail+1; r := r || E'\nFAIL [17] a user''s own earlier personal row was not superseded'; END IF;

  -- [18] history attribution: same org, and never naming a foreign lane/owner.
  SELECT count(*) INTO v_n FROM coverage_history h
   WHERE h.asset_id = AS1
     AND (h.organization_id IS DISTINCT FROM OA
          OR h.old_user_id IN (USER_B, ADMIN_B));
  SELECT change_type, old_user_id INTO v_type, v_owner
    FROM coverage_history
   WHERE asset_id = AS1 AND new_user_id = USER_A2
   ORDER BY changed_at DESC, ctid DESC LIMIT 1;
  IF v_n = 0 AND (v_owner IS NULL OR v_owner = USER_A2) THEN
    pass := pass+1; r := r || format(E'\nPASS [18] history stayed same-org and same-owner (last: %s/%s)', v_type, v_owner);
  ELSE
    fail := fail+1; r := r || format(E'\nFAIL [18] history leaked: %s foreign row(s), last old_user_id=%s', v_n, v_owner);
  END IF;

  -- [19] org B has no settings row, so it must still behave as "multiple
  -- allowed" and must not read org A's `false`.
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, is_active, start_date)
  VALUES (AS3, USER_B, 'S3 User B earlier', OB, 'org', true, CURRENT_DATE - 5);
  IF (SELECT is_active FROM coverage WHERE id = v_org_b_row) THEN
    pass := pass+1; r := r || E'\nPASS [19] allow_multiple_coverage stayed tenant-scoped';
  ELSE fail := fail+1; r := r || E'\nFAIL [19] org A''s setting governed org B'; END IF;

  -- ===========================================================================
  -- [25] An admin's org assignment must not retire personal declarations.
  --
  -- The supersede path that RLS does NOT mask: a coverage admin's UPDATE policy
  -- admits every row in the organization, so with a lane-blind trigger this
  -- insert reaches USER_A's and USER_A2's personal rows on the same asset.
  -- Org A is still armed with allow_multiple_coverage = false.
  -- ===========================================================================
  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', USER_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, start_date)
  VALUES (AS4, USER_A, 'S3 User A personal', OA, 'personal', CURRENT_DATE - 10)
  RETURNING id INTO v_pers_a;
  RESET ROLE;

  EXECUTE format('SET LOCAL request.jwt.claims = %L',
                 json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
  SET LOCAL ROLE authenticated;
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, start_date)
  VALUES (AS4, USER_A2, 'S3 User A2 assigned', OA, 'org', CURRENT_DATE);
  RESET ROLE;

  IF (SELECT is_active FROM coverage WHERE id = v_pers_a) THEN
    pass := pass+1; r := r || E'
PASS [25] an admin org assignment did not retire a personal declaration';
  ELSE
    fail := fail+1; r := r || E'
FAIL [25] an admin org insert retired a user''s personal coverage';
  END IF;

  -- [20] NOT NULL on organization_id.
  BEGIN
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (AS8, USER_A, 'S3 User A', NULL, 'org');
    v_state := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_state := 'rejected:'||SQLSTATE; END;
  IF v_state LIKE 'rejected:%' THEN
    pass := pass+1; r := r || format(E'\nPASS [20] a NULL organization_id write is rejected (%s)', v_state);
  ELSE fail := fail+1; r := r || E'\nFAIL [20] created a tenant-less coverage row'; END IF;

  RAISE EXCEPTION E'COVERAGE SELF-SERVICE RESULTS (rolled back): % passed, % failed of 25%',
    pass, fail, r;
END;
$$;
