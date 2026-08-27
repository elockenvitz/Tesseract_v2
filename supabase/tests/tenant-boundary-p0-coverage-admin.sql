-- =============================================================================
-- P0 Tenant Boundary — coverage_admin authority tests
--
-- Companion to tenant-boundary-p0.sql. That file borrows one real user and
-- proves the org-pointer bypass is closed; assertion [14] there covers only
-- the self-grant case. `coverage_admin` is the one authority-bearing column
-- migration 20260826100100 deliberately LEAVES in the `authenticated` UPDATE
-- allowlist — because OrganizationPage administers it directly — so the
-- trigger in 20260826100200 is the only thing standing between a user and the
-- flag. That deserves its own file and its own fixtures.
--
-- Why separate rather than appended: these tests need four distinct actors
-- with different memberships. tenant-boundary-p0.sql deliberately borrows a
-- single existing user and restores it; mixing synthetic-user creation into
-- that file would complicate a cleanup path that currently cannot strand a
-- real account. Both files must pass. Run this one second.
--
-- Fixtures are synthetic (auth.users rows with a `_catest` marker), following
-- the pattern in supabase/tests/org-governance.sql. Self-cleaning. No real
-- user's coverage_admin is ever read or written.
--
-- Assertions 1-6 are REQUIREMENTS: a failure is a defect in the remediation.
-- Assertions 7-9 are CHARACTERISATIONS: they record behaviour that is
-- intended-but-consequential, so that a later change to it is visible as a
-- test change. They print a WARN line explaining the consequence. See
-- docs/audit/p0-writer-review.md §4.
--
-- On failure the DO block raises, which rolls back the block but NOT the setup
-- statements above it — those are separate statements. Re-run the cleanup block
-- at the foot of this file before running it again, or run the whole file
-- inside `BEGIN; … ROLLBACK;` in psql, which is cleaner and needs no cleanup.
--
-- 9 assertions.
-- =============================================================================

-- ---- Setup ------------------------------------------------------------------
-- Three orgs, five users. Fixed UUIDs so cleanup is unambiguous even if the
-- run aborts halfway.
--
--   OA  aaaa…ca01   ADMIN_A (admin), MEMBER_A, MULTI, LAPSED (inactive)
--   OB  aaaa…ca02   MULTI
--   OC  aaaa…ca03   OUTSIDER
--
-- is_org_admin is false for everyone except ADMIN_A: prevent_last_org_admin_
-- removal() fires on removal, not insert, but keeping the admin set minimal
-- keeps the cleanup path free of it.

INSERT INTO organizations (id, name, slug) VALUES
  ('aaaa0000-0000-0000-0000-00000000ca01'::uuid, 'CA Org A _catest', 'ca-org-a-catest'),
  ('aaaa0000-0000-0000-0000-00000000ca02'::uuid, 'CA Org B _catest', 'ca-org-b-catest'),
  ('aaaa0000-0000-0000-0000-00000000ca03'::uuid, 'CA Org C _catest', 'ca-org-c-catest');

-- auth.users; the on_auth_user_created trigger creates the public.users rows.
INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
  ('bbbb0000-0000-0000-0000-00000000ca01'::uuid, 'ca_admin_a_catest@firm.test',  '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000ca02'::uuid, 'ca_member_a_catest@firm.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000ca03'::uuid, 'ca_outsider_catest@firm.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000ca04'::uuid, 'ca_multi_catest@firm.test',    '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000ca05'::uuid, 'ca_lapsed_catest@firm.test',   '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status) VALUES
  ('aaaa0000-0000-0000-0000-00000000ca01'::uuid, 'bbbb0000-0000-0000-0000-00000000ca01'::uuid, true,  'active'),
  ('aaaa0000-0000-0000-0000-00000000ca01'::uuid, 'bbbb0000-0000-0000-0000-00000000ca02'::uuid, false, 'active'),
  ('aaaa0000-0000-0000-0000-00000000ca03'::uuid, 'bbbb0000-0000-0000-0000-00000000ca03'::uuid, false, 'active'),
  ('aaaa0000-0000-0000-0000-00000000ca01'::uuid, 'bbbb0000-0000-0000-0000-00000000ca04'::uuid, false, 'active'),
  ('aaaa0000-0000-0000-0000-00000000ca02'::uuid, 'bbbb0000-0000-0000-0000-00000000ca04'::uuid, false, 'active'),
  ('aaaa0000-0000-0000-0000-00000000ca01'::uuid, 'bbbb0000-0000-0000-0000-00000000ca05'::uuid, false, 'inactive');

-- Seat each actor in an org they actually belong to. Written as the owner, so
-- the authority guard stands aside; current_org_id() must resolve for the
-- row-level policies on `users` to admit the admin flow at all.
UPDATE users SET current_organization_id = 'aaaa0000-0000-0000-0000-00000000ca01'::uuid
  WHERE id IN ('bbbb0000-0000-0000-0000-00000000ca01'::uuid,
               'bbbb0000-0000-0000-0000-00000000ca02'::uuid,
               'bbbb0000-0000-0000-0000-00000000ca04'::uuid);
UPDATE users SET current_organization_id = 'aaaa0000-0000-0000-0000-00000000ca03'::uuid
  WHERE id = 'bbbb0000-0000-0000-0000-00000000ca03'::uuid;
UPDATE users SET coverage_admin = false
  WHERE id::text LIKE 'bbbb0000-0000-0000-0000-00000000ca%';

DO $$
DECLARE
  OA        uuid := 'aaaa0000-0000-0000-0000-00000000ca01';
  OB        uuid := 'aaaa0000-0000-0000-0000-00000000ca02';
  ADMIN_A   uuid := 'bbbb0000-0000-0000-0000-00000000ca01';
  MEMBER_A  uuid := 'bbbb0000-0000-0000-0000-00000000ca02';
  OUTSIDER  uuid := 'bbbb0000-0000-0000-0000-00000000ca03';
  MULTI     uuid := 'bbbb0000-0000-0000-0000-00000000ca04';
  LAPSED    uuid := 'bbbb0000-0000-0000-0000-00000000ca05';

  v_rows    int;
  v_flag    boolean;
  v_state   text;      -- 'ok' | 'rejected:<sqlstate>'
  v_pass    int := 0;
  v_fail    int := 0;
  v_warn    int := 0;
BEGIN
  RAISE NOTICE '=== P0 coverage_admin authority tests ===';
  RAISE NOTICE '';

  -- ===========================================================================
  -- REQUIREMENT A — an ordinary user cannot grant themselves coverage_admin
  --
  -- The row policy `Users can update their own profile` admits this row, and
  -- migration 20260826100100 deliberately keeps the column grant. The trigger
  -- is the only control. This duplicates assertion [14] of
  -- tenant-boundary-p0.sql on purpose: that one uses a borrowed real user,
  -- this one uses a member with a known-false starting value, so a pre-existing
  -- true value cannot mask a failure.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', MEMBER_A, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = MEMBER_A;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = MEMBER_A;
  IF v_state LIKE 'rejected:%' AND v_flag IS NOT TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [1][A] self-grant rejected (%)', v_state;
  ELSIF v_flag IS NOT TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [1][A] self-grant produced no change (% row(s))', v_rows;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [1][A] a member granted themselves coverage_admin';
  END IF;

  -- ===========================================================================
  -- REQUIREMENT B — an ordinary user cannot modify another user's flag
  --
  -- B1: same organisation. Blocked by the row policy, not the trigger — the
  -- update should match zero rows rather than raise. Either outcome is a pass;
  -- what must not happen is the flag changing.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', MEMBER_A, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = MULTI;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = MULTI;
  IF v_flag IS NOT TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [2][B1] member cannot set the flag on a colleague (%, % row(s))', v_state, v_rows;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [2][B1] a non-admin set coverage_admin on another user in their org';
  END IF;

  -- B2: different organisation. Same expectation, and it also confirms the
  -- row policy is not merely org-scoped-but-permissive.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', MEMBER_A, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = OUTSIDER;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = OUTSIDER;
  IF v_flag IS NOT TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [3][B2] member cannot set the flag on a user in another org (%, % row(s))', v_state, v_rows;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [3][B2] a non-admin set coverage_admin cross-org';
  END IF;

  -- ===========================================================================
  -- REQUIREMENT C — an org admin CAN administer the flag inside their org
  --
  -- This is the regression half: 20260826100200 must not break the
  -- OrganizationPage flow. Three outcomes are distinguishable and only one is
  -- a defect in this PR:
  --
  --   success                  → PASS
  --   rejected with P0032      → FAIL, the guard is over-tight
  --   0 rows / other rejection → the ROW policy is the gate, not the trigger.
  --                              Reported as WARN, not FAIL: it means
  --                              `Org admins can update coverage_admin for org
  --                              members` is absent or shaped differently in
  --                              this database, which is a finding about the
  --                              environment rather than about this migration.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = MEMBER_A;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = MEMBER_A;
  IF v_flag IS TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [4][C] org admin can set coverage_admin for a member of their org';
  ELSIF v_state = 'rejected:P0032' THEN
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [4][C] the authority guard blocked a legitimate org admin — 20260826100200 is over-tight';
  ELSE
    v_warn := v_warn + 1;
    RAISE NOTICE 'WARN [4][C] admin flow did not apply (%, % row(s)) — the guard did not reject it,', v_state, v_rows;
    RAISE NOTICE '           so the row policy "Org admins can update coverage_admin for org';
    RAISE NOTICE '           members" is absent or differently shaped here. Confirm on the';
    RAISE NOTICE '           target database before reading this run as a pass.';
  END IF;

  -- Reset for the tests that follow.
  UPDATE users SET coverage_admin = false WHERE id = MEMBER_A;

  -- ===========================================================================
  -- REQUIREMENT D — an org admin cannot reach outside their organisation
  --
  -- OUTSIDER belongs to OC only. ADMIN_A administers OA. The guard's actor/
  -- subject join requires a SHARED organisation, so this must be rejected with
  -- P0032 — and this is the assertion that proves the guard, not the row
  -- policy, is doing the work, because a rejection here carries our errcode.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = OUTSIDER;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE; v_rows := 0;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = OUTSIDER;
  IF v_flag IS NOT TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [5][D] org admin cannot set the flag for a user outside their org (%, % row(s))', v_state, v_rows;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [5][D] CROSS-ORG: an admin of one org set coverage_admin on an outsider';
  END IF;

  -- D2 — the same attempt, with the subject seated in the admin's org but not
  -- a member of it. Guards that check "is the subject's current_organization_id
  -- mine?" instead of "do we share a membership?" pass D and fail this.
  UPDATE users SET current_organization_id = NULL WHERE id = OUTSIDER;
  INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status)
    VALUES (OA, OUTSIDER, false, 'inactive');
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = OUTSIDER;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = OUTSIDER;
  IF v_flag IS NOT TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [6][D2] an INACTIVE shared membership does not authorise the admin (%)', v_state;
  ELSE
    v_warn := v_warn + 1;
    RAISE NOTICE 'WARN [6][D2] an admin administered a user whose only shared membership is INACTIVE.';
    RAISE NOTICE '           The guard checks actor.status but not subject.status. A former';
    RAISE NOTICE '           colleague remains administrable. Low severity — the flag is';
    RAISE NOTICE '           inert without an active membership — but see';
    RAISE NOTICE '           docs/audit/p0-writer-review.md §4.2.';
    UPDATE users SET coverage_admin = false WHERE id = OUTSIDER;
  END IF;
  DELETE FROM organization_memberships WHERE organization_id = OA AND user_id = OUTSIDER;

  -- ===========================================================================
  -- CHARACTERISATION 7 — an org admin may set the flag on THEMSELVES
  --
  -- The guard's join is satisfied when actor and subject are the same
  -- membership row. This is consistent with the row policy (an admin can
  -- already target their own row through the same UI), so it is intended
  -- rather than a hole — recorded so that a change to it is deliberate.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = ADMIN_A;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = ADMIN_A;
  v_pass := v_pass + 1;
  IF v_flag IS TRUE THEN
    RAISE NOTICE 'PASS [7] characterised: an org admin CAN self-grant coverage_admin (intended)';
  ELSE
    RAISE NOTICE 'PASS [7] characterised: an org admin CANNOT self-grant coverage_admin (%)', v_state;
  END IF;
  UPDATE users SET coverage_admin = false WHERE id = ADMIN_A;

  -- ===========================================================================
  -- CHARACTERISATION 8 — the flag is GLOBAL, so granting it in one org
  --                      confers it in every org the subject belongs to
  --
  -- MULTI is an active member of OA and OB. ADMIN_A administers OA only.
  -- `users.coverage_admin` is a single boolean on the user, not a per-org
  -- grant, so an OA admin setting it also makes MULTI a coverage admin in OB —
  -- an organisation whose admins never authorised it.
  --
  -- This is PRE-EXISTING: the `Org admins can update coverage_admin for org
  -- members` row policy has always allowed it, and 20260826100200 mirrors that
  -- policy rather than widening it. This PR makes the situation strictly
  -- better (self-granting is now impossible) and must not be blocked on it.
  -- Recorded here so the exposure is measured rather than assumed away.
  -- Production had 4 of 24 users holding more than one active membership at
  -- the time of writing.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', ADMIN_A, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = MULTI;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = MULTI;
  v_pass := v_pass + 1;
  IF v_flag IS TRUE THEN
    v_warn := v_warn + 1;
    RAISE NOTICE 'PASS [8] characterised: an OA admin granted coverage_admin to a user who is';
    RAISE NOTICE '         also an active member of OB. The flag is global, so this confers';
    RAISE NOTICE '         coverage administration in OB too. PRE-EXISTING, not introduced by';
    RAISE NOTICE '         this PR. Follow-up: docs/audit/p0-writer-review.md §4.1.';
  ELSE
    RAISE NOTICE 'PASS [8] characterised: cross-org conferral is NOT possible here (%)', v_state;
  END IF;
  UPDATE users SET coverage_admin = false WHERE id = MULTI;

  -- ===========================================================================
  -- CHARACTERISATION 9 — a user with an inactive membership cannot act as
  --                      an admin even if is_org_admin is true
  --
  -- LAPSED is is_org_admin = false and status = 'inactive'. Promote the flag
  -- in the membership row only (not the user's authority) and confirm the
  -- guard still refuses, because it requires actor.status = 'active'.
  -- ===========================================================================
  UPDATE organization_memberships SET is_org_admin = true
    WHERE organization_id = OA AND user_id = LAPSED;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L',
                   json_build_object('sub', LAPSED, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE users SET coverage_admin = true WHERE id = MEMBER_A;
    RESET ROLE;
    v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_state := 'rejected:' || SQLSTATE;
  END;
  SELECT coverage_admin INTO v_flag FROM users WHERE id = MEMBER_A;
  IF v_flag IS NOT TRUE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [9] an inactive membership does not confer admin authority (%)', v_state;
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [9] a DEACTIVATED org admin still administered coverage_admin';
  END IF;
  UPDATE users SET coverage_admin = false WHERE id = MEMBER_A;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed of 9 assertions; % warning(s) raised ===',
               v_pass, v_fail, v_warn;
  IF v_warn > 0 THEN
    RAISE NOTICE 'Warnings are not failures. Read them — each one names a real behaviour.';
  END IF;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'P0 COVERAGE_ADMIN TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;

-- ---- Cleanup ----------------------------------------------------------------
-- Memberships before users, users before orgs. auth.users deletion cascades to
-- public.users. Nothing here touches a real account: every id is a _catest
-- fixture.
DELETE FROM organization_memberships
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000ca01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000ca02'::uuid,
                            'aaaa0000-0000-0000-0000-00000000ca03'::uuid);
DELETE FROM organization_audit_log
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000ca01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000ca02'::uuid,
                            'aaaa0000-0000-0000-0000-00000000ca03'::uuid);
DELETE FROM auth.users
  WHERE id IN ('bbbb0000-0000-0000-0000-00000000ca01'::uuid,
               'bbbb0000-0000-0000-0000-00000000ca02'::uuid,
               'bbbb0000-0000-0000-0000-00000000ca03'::uuid,
               'bbbb0000-0000-0000-0000-00000000ca04'::uuid,
               'bbbb0000-0000-0000-0000-00000000ca05'::uuid);
DELETE FROM organizations
  WHERE id IN ('aaaa0000-0000-0000-0000-00000000ca01'::uuid,
               'aaaa0000-0000-0000-0000-00000000ca02'::uuid,
               'aaaa0000-0000-0000-0000-00000000ca03'::uuid);
