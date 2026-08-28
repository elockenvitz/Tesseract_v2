-- =============================================================================
-- Coverage self-service — security tests
--
-- Companion to tenant-boundary-p0-coverage-admin.sql. That file proves nobody
-- can grant themselves the `coverage_admin` flag. This one proves what an
-- ordinary user can and cannot do with the personal-coverage lane introduced by
-- 20260828100000_coverage_self_service_foundation.sql, and that the lane did
-- not open a door in the governed lane on its way in.
--
-- Run AFTER that migration. Every assertion below fails against the pre-
-- migration policy set, which is the point: this file is the migration's
-- acceptance criteria, not a regression net bolted on later.
--
-- Assertions 1-4  — the personal lane works and is correctly scoped.
-- Assertions 5-11 — the personal lane cannot be used to escalate.
-- Assertions 12-14 — the governed lane is unchanged.
-- Assertion  15   — the supersede trigger no longer crosses tenants.
--
-- 15 assertions. Fixtures are synthetic, marked `_csstest`, and self-cleaning.
-- Cleanest invocation is inside `BEGIN; \i thisfile; ROLLBACK;` in psql; the
-- cleanup block at the foot handles the non-transactional case.
-- =============================================================================

-- ---- Setup ------------------------------------------------------------------
--   OA  aaaa…cs01   ANALYST (member), ADMIN (coverage_admin), COLLEAGUE
--   OB  aaaa…cs02   OUTSIDER
--
-- Two assets, because a cross-tenant supersede test needs the same asset
-- reachable from both orgs — assets are a shared catalogue, coverage is not.

INSERT INTO organizations (id, name, slug) VALUES
  ('aaaa0000-0000-0000-0000-00000000cs01'::uuid, 'CS Org A _csstest', 'cs-org-a-csstest'),
  ('aaaa0000-0000-0000-0000-00000000cs02'::uuid, 'CS Org B _csstest', 'cs-org-b-csstest');

INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
  ('bbbb0000-0000-0000-0000-00000000cs01'::uuid, 'cs_analyst_csstest@firm.test',   '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000cs02'::uuid, 'cs_admin_csstest@firm.test',     '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000cs03'::uuid, 'cs_colleague_csstest@firm.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000cs04'::uuid, 'cs_outsider_csstest@firm.test',  '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status) VALUES
  ('aaaa0000-0000-0000-0000-00000000cs01'::uuid, 'bbbb0000-0000-0000-0000-00000000cs01'::uuid, false, 'active'),
  ('aaaa0000-0000-0000-0000-00000000cs01'::uuid, 'bbbb0000-0000-0000-0000-00000000cs02'::uuid, true,  'active'),
  ('aaaa0000-0000-0000-0000-00000000cs01'::uuid, 'bbbb0000-0000-0000-0000-00000000cs03'::uuid, false, 'active'),
  ('aaaa0000-0000-0000-0000-00000000cs02'::uuid, 'bbbb0000-0000-0000-0000-00000000cs04'::uuid, false, 'active');

UPDATE users SET current_organization_id = 'aaaa0000-0000-0000-0000-00000000cs01'::uuid
  WHERE id IN ('bbbb0000-0000-0000-0000-00000000cs01'::uuid,
               'bbbb0000-0000-0000-0000-00000000cs02'::uuid,
               'bbbb0000-0000-0000-0000-00000000cs03'::uuid);
UPDATE users SET current_organization_id = 'aaaa0000-0000-0000-0000-00000000cs02'::uuid
  WHERE id = 'bbbb0000-0000-0000-0000-00000000cs04'::uuid;

UPDATE users SET coverage_admin = false
  WHERE id::text LIKE 'bbbb0000-0000-0000-0000-00000000cs%';
UPDATE users SET coverage_admin = true
  WHERE id = 'bbbb0000-0000-0000-0000-00000000cs02'::uuid;

INSERT INTO assets (id, symbol, company_name) VALUES
  ('cccc0000-0000-0000-0000-00000000cs01'::uuid, 'CSTESTA', 'CS Test Asset A _csstest'),
  ('cccc0000-0000-0000-0000-00000000cs02'::uuid, 'CSTESTB', 'CS Test Asset B _csstest')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  OA        uuid := 'aaaa0000-0000-0000-0000-00000000cs01';
  OB        uuid := 'aaaa0000-0000-0000-0000-00000000cs02';
  ANALYST   uuid := 'bbbb0000-0000-0000-0000-00000000cs01';
  ADMIN     uuid := 'bbbb0000-0000-0000-0000-00000000cs02';
  COLLEAGUE uuid := 'bbbb0000-0000-0000-0000-00000000cs03';
  OUTSIDER  uuid := 'bbbb0000-0000-0000-0000-00000000cs04';
  ASSET_A   uuid := 'cccc0000-0000-0000-0000-00000000cs01';
  ASSET_B   uuid := 'cccc0000-0000-0000-0000-00000000cs02';

  v_rows    int;
  v_state   text;      -- 'ok' | 'rejected:<sqlstate>'
  v_n       int;
  v_scope   text;
  v_uid     uuid;
  v_cov     uuid;
  v_gov     uuid;
  v_other   uuid;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== Coverage self-service security tests ===';
  RAISE NOTICE '';

  -- ===========================================================================
  -- [1] An ordinary member can declare their own coverage.
  --
  -- This is the whole point of the change. Before the migration this raised;
  -- `coverage` INSERT required is_coverage_admin(), which 2 of 26 users had.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (ASSET_A, ANALYST, 'CS Analyst', OA, 'personal')
    RETURNING id INTO v_cov;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_cov := NULL;
  END;
  IF v_cov IS NOT NULL THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [1] a non-admin member declared personal coverage';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [1] a non-admin member could NOT declare personal coverage (%)', v_state;
  END IF;

  -- ===========================================================================
  -- [2] The trigger stamps provenance regardless of what the client sent.
  --
  -- The INSERT above deliberately omitted created_by. If the client is the only
  -- thing setting it, a self-declared row is indistinguishable from an
  -- assignment the moment a caller forgets the field.
  -- ===========================================================================
  SELECT created_by, coverage_scope INTO v_uid, v_scope FROM coverage WHERE id = v_cov;
  IF v_uid = ANALYST AND v_scope = 'personal' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [2] created_by stamped to the declaring user by the database';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [2] created_by=% scope=% (expected %/personal)', v_uid, v_scope, ANALYST;
  END IF;

  -- ===========================================================================
  -- [3] A colleague in the same org can READ it. Coverage is not secret inside
  --     a workspace — "who covers this name" is the question it answers.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', COLLEAGUE, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM coverage WHERE id = v_cov;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_n := -1;
  END;
  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [3] same-org colleague can read personal coverage';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [3] same-org colleague saw % row(s), expected 1', v_n;
  END IF;

  -- ===========================================================================
  -- [4] The declaring user can retire their own row.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE coverage SET is_active = false WHERE id = v_cov;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    UPDATE coverage SET is_active = true WHERE id = v_cov;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_rows := 0;
  END;
  IF v_rows = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [4] declaring user can edit their own personal coverage';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [4] declaring user could not edit their own row (% row(s))', v_rows;
  END IF;

  -- ===========================================================================
  -- [5] A user cannot assign coverage to somebody else.
  --
  -- The single most important negative: "self-service" must mean *self*.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (ASSET_B, COLLEAGUE, 'CS Colleague', OA, 'personal');
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  SELECT count(*) INTO v_n FROM coverage WHERE user_id = COLLEAGUE;
  IF v_state LIKE 'rejected:%' AND v_n = 0 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [5] cannot assign coverage to another user (%)', v_state;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [5] assigned coverage to a colleague (state=%, rows=%)', v_state, v_n;
  END IF;

  -- ===========================================================================
  -- [6] A user cannot forge a tenant on insert.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (ASSET_B, ANALYST, 'CS Analyst', OB, 'personal');
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  SELECT count(*) INTO v_n FROM coverage WHERE organization_id = OB;
  IF v_state LIKE 'rejected:%' AND v_n = 0 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [6] cannot write coverage into another organization (%)', v_state;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [6] wrote coverage into a foreign org (state=%, rows=%)', v_state, v_n;
  END IF;

  -- ===========================================================================
  -- [7] A user cannot insert a NULL-org row.
  --
  -- Pre-migration this passed WITH CHECK and produced a row visible to every
  -- active member of every organization. It is now a NOT NULL violation.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope)
    VALUES (ASSET_B, ANALYST, 'CS Analyst', NULL, 'personal');
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  IF v_state LIKE 'rejected:%' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [7] NULL-organization coverage rejected (%)', v_state;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [7] created a tenant-less coverage row';
  END IF;

  -- ===========================================================================
  -- [8] A user cannot claim team authority on a personal row.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE coverage SET is_lead = true WHERE id = v_cov;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  IF (SELECT is_lead FROM coverage WHERE id = v_cov) IS NOT TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [8] cannot make a personal row lead coverage (%)', v_state;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [8] a self-declared row claimed lead authority';
  END IF;

  -- ===========================================================================
  -- [9] A user cannot promote their personal row into the governed lane.
  --
  -- WITH CHECK pins the NEW row to 'personal'. Without this, self-service is a
  -- two-step path to writing org coverage.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE coverage SET coverage_scope = 'org' WHERE id = v_cov;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  SELECT coverage_scope INTO v_scope FROM coverage WHERE id = v_cov;
  IF v_scope = 'personal' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [9] cannot promote personal coverage to org scope (%)', v_state;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [9] personal row escalated to scope=%', v_scope;
  END IF;

  -- ===========================================================================
  -- [10] A user cannot capture a governed row by demoting it.
  --
  -- USING pins the OLD row to 'personal', so an org row is not even visible to
  -- this policy as an update target.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, created_by)
  VALUES (ASSET_B, ANALYST, 'CS Analyst', OA, 'org', ADMIN)
  RETURNING id INTO v_gov;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE coverage SET coverage_scope = 'personal', notes = 'captured' WHERE id = v_gov;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  SELECT coverage_scope INTO v_scope FROM coverage WHERE id = v_gov;
  IF v_scope = 'org' AND v_rows = 0 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [10] cannot capture an org-assigned row (%)', v_state;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [10] org row became scope=% after % row(s) updated', v_scope, v_rows;
  END IF;

  -- ===========================================================================
  -- [11] A user cannot delete an org-assigned row that names them.
  --
  -- The row is *about* them, which is exactly why this is tempting and exactly
  -- why it must not work: an assignment they can delete is not an assignment.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ANALYST, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM coverage WHERE id = v_gov;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  SELECT count(*) INTO v_n FROM coverage WHERE id = v_gov;
  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [11] cannot delete an org assignment naming oneself (%)', v_state;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [11] deleted a governed assignment';
  END IF;

  -- ===========================================================================
  -- [12] An outsider in another org sees none of it. The tenant edge holds for
  --      both lanes.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', OUTSIDER, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM coverage WHERE organization_id = OA;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_n := -1;
  END;
  IF v_n = 0 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [12] cross-org read returns nothing';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [12] outsider read % coverage row(s) from another org', v_n;
  END IF;

  -- ===========================================================================
  -- [13] The governed lane still works for a coverage admin. The personal lane
  --      must not have cost the admin anything.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ADMIN, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE coverage SET notes = 'admin touched' WHERE id = v_gov;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  IF v_rows = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [13] coverage admin still governs org coverage';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [13] coverage admin lost the governed lane (%, % row(s))', v_state, v_rows;
  END IF;

  -- ===========================================================================
  -- [14] A coverage admin in ANOTHER org cannot reach these rows. The
  --      `coverage_admin` flag is global; the org predicate is what makes it
  --      safe, so it is worth asserting rather than assuming.
  -- ===========================================================================
  UPDATE users SET coverage_admin = true WHERE id = OUTSIDER;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', OUTSIDER, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE coverage SET notes = 'foreign admin' WHERE id = v_gov;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  IF v_rows = 0 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [14] a coverage admin in another org cannot mutate these rows';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [14] foreign coverage admin updated % row(s)', v_rows;
  END IF;
  UPDATE users SET coverage_admin = false WHERE id = OUTSIDER;

  -- ===========================================================================
  -- [15] The supersede trigger no longer reaches across tenants.
  --
  -- `end_previous_coverage()` used to read `allow_multiple_coverage` from an
  -- arbitrary org's settings row and then deactivate every active coverage of
  -- the asset with no org filter. Arm it for org B only, insert into org B, and
  -- assert org A's coverage of the same asset survives.
  -- ===========================================================================
  INSERT INTO coverage_settings (organization_id, allow_multiple_coverage, updated_by)
  VALUES (OB, false, OUTSIDER)
  ON CONFLICT DO NOTHING;

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, coverage_scope, created_by)
  VALUES (ASSET_A, OUTSIDER, 'CS Outsider', OB, 'org', OUTSIDER)
  RETURNING id INTO v_other;

  IF (SELECT is_active FROM coverage WHERE id = v_cov) IS TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [15] a foreign tenant''s insert did not retire our coverage';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [15] cross-tenant supersede deactivated another org''s coverage';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed of 15 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'COVERAGE SELF-SERVICE TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;

-- ---- Cleanup ----------------------------------------------------------------
-- Coverage and its history before the assets and orgs they reference.
DELETE FROM coverage_history
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000cs01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000cs02'::uuid);
DELETE FROM coverage
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000cs01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000cs02'::uuid);
DELETE FROM coverage_settings
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000cs01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000cs02'::uuid);
DELETE FROM assets
  WHERE id IN ('cccc0000-0000-0000-0000-00000000cs01'::uuid,
               'cccc0000-0000-0000-0000-00000000cs02'::uuid);
DELETE FROM organization_memberships
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000cs01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000cs02'::uuid);
DELETE FROM organization_audit_log
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000cs01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000cs02'::uuid);
DELETE FROM auth.users
  WHERE id IN ('bbbb0000-0000-0000-0000-00000000cs01'::uuid,
               'bbbb0000-0000-0000-0000-00000000cs02'::uuid,
               'bbbb0000-0000-0000-0000-00000000cs03'::uuid,
               'bbbb0000-0000-0000-0000-00000000cs04'::uuid);
DELETE FROM organizations
  WHERE id IN ('aaaa0000-0000-0000-0000-00000000cs01'::uuid,
               'aaaa0000-0000-0000-0000-00000000cs02'::uuid);
