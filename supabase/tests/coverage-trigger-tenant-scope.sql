-- =============================================================================
-- Coverage triggers — tenant-scope regression tests
--
-- Acceptance criteria for 20260828090000_coverage_trigger_tenant_scope.sql.
--
--   [1] org A's allow_multiple_coverage cannot govern org B
--   [2] an insert in org A cannot deactivate org B's coverage
--   [3] the same-org supersede still works
--   [4] allow_multiple_coverage = false still logs analyst_changed, naming the
--       organization's OWN previous analyst
--   [5] history: the reactivation path cannot copy an analyst from org B
--   [6] history: the insert path cannot copy an analyst from org B
--   [7] allow_multiple_coverage = true still works (no supersede)
--   [8] an org with NO settings row still behaves as "multiple allowed"
--   [9] a coverage row with no organization fails closed
--
-- Reproduced on staging against the unpatched deployed functions on
-- 2026-08-28: 4 passed, 5 failed. [1], [2], [5], [6] and [9] fail there; after
-- the migration all 9 pass.
--
-- [3], [4], [7] and [8] pass both before and after. They are not filler: they
-- are the assertions that would catch this migration breaking something that
-- already worked, which for a change to a trigger every coverage write passes
-- through is the larger risk of the two.
--
-- ── Why [5] and [6] are two assertions and not one ──────────────────────────
--
-- The obvious test for finding (3) — org B covers an asset, org A inserts on
-- it, check whose analyst lands in org A's history — does NOT fail against the
-- unpatched functions. Finding (2) masks it: the unscoped supersede in
-- `end_previous_coverage` has already deactivated org B's row by the time
-- `log_coverage_change` looks for it, so the lookup finds nothing and logs
-- `created`. Writing the test that way would have produced a green run and no
-- information.
--
-- Two paths leave finding (3) genuinely exposed, and both are covered:
--
--   [5] Reactivation. `trigger_end_previous_coverage` is BEFORE **INSERT
--       ONLY**, so on an UPDATE that flips is_active false→true nothing masks
--       anything at all.
--
--   [6] Insert against a future-dated neighbour. The supersede carries
--       `AND end_date IS NULL`, so it skips a row with an end_date — but the
--       history lookup filters on `is_active = true` alone and still finds it.
--
-- ── Why history rows are ordered by ctid ────────────────────────────────────
--
-- `coverage_history.changed_at` is written as `NEW.updated_at`, which is
-- `now()` — the TRANSACTION timestamp, identical for every row written in one
-- batch. Ordering by it alone is ambiguous and silently returned the wrong row
-- while this file was being written, turning a real reproduction into a false
-- pass. `ctid DESC` breaks the tie on physical order.
--
-- ── How these run ───────────────────────────────────────────────────────────
--
-- As the table owner, with no `SET ROLE` and no JWT claims. Deliberate: these
-- test the TRIGGERS, and a trigger has to be correct on its own rather than
-- because of whatever policy happens to sit above it. `end_previous_coverage()`
-- is SECURITY INVOKER, so under an ordinary authenticated session RLS masks
-- part of finding (2) — which is why it was easy to miss, and why the test must
-- not lean on that masking. Owner execution reproduces the service_role and
-- SECURITY DEFINER paths, where nothing masks it. `log_coverage_change()` is
-- SECURITY DEFINER, so findings (1) and (3) are unmasked in every context.
--
-- auth.uid() is NULL here, so `notify_coverage_added_bulk` returns early and
-- these fixtures emit no notifications.
--
-- 9 assertions. Fixtures are synthetic, marked `_ctstest`, and self-cleaning.
-- Cleanest invocation is `BEGIN; \i thisfile; ROLLBACK;` in psql; the cleanup
-- block at the foot handles the non-transactional case.
-- =============================================================================

-- ---- Setup ------------------------------------------------------------------
--   OA  aaaa…cf01   ANALYST_A   — the tenant under test
--   OB  aaaa…cf02   ANALYST_B   — the neighbour that must never be touched
--
-- One asset per assertion, so no assertion can be contaminated by the state
-- another one left behind. `assets` is a shared catalogue, so two tenants
-- covering the same security is the ordinary case rather than a corner one.

INSERT INTO organizations (id, name, slug) VALUES
  ('aaaa0000-0000-0000-0000-00000000cf01'::uuid, 'CT Org A _ctstest', 'ct-org-a-ctstest'),
  ('aaaa0000-0000-0000-0000-00000000cf02'::uuid, 'CT Org B _ctstest', 'ct-org-b-ctstest');

-- auth.users; the on_auth_user_created trigger creates the public.users rows
-- that coverage_history.old_user_id / new_user_id reference.
INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
  ('bbbb0000-0000-0000-0000-00000000cf01'::uuid, 'ct_analyst_a_ctstest@firm.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000cf02'::uuid, 'ct_analyst_b_ctstest@firm.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000cf03'::uuid, 'ct_analyst_a2_ctstest@firm.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO organization_memberships (organization_id, user_id, is_org_admin, status) VALUES
  ('aaaa0000-0000-0000-0000-00000000cf01'::uuid, 'bbbb0000-0000-0000-0000-00000000cf01'::uuid, false, 'active'),
  ('aaaa0000-0000-0000-0000-00000000cf02'::uuid, 'bbbb0000-0000-0000-0000-00000000cf02'::uuid, false, 'active'),
  ('aaaa0000-0000-0000-0000-00000000cf01'::uuid, 'bbbb0000-0000-0000-0000-00000000cf03'::uuid, false, 'active');

INSERT INTO assets (id, symbol, company_name) VALUES
  ('cccc0000-0000-0000-0000-00000000cf01'::uuid, 'CTAST1', 'CT Asset 1 _ctstest'),
  ('cccc0000-0000-0000-0000-00000000cf02'::uuid, 'CTAST2', 'CT Asset 2 _ctstest'),
  ('cccc0000-0000-0000-0000-00000000cf03'::uuid, 'CTAST3', 'CT Asset 3 _ctstest'),
  ('cccc0000-0000-0000-0000-00000000cf04'::uuid, 'CTAST4', 'CT Asset 4 _ctstest'),
  ('cccc0000-0000-0000-0000-00000000cf05'::uuid, 'CTAST5', 'CT Asset 5 _ctstest'),
  ('cccc0000-0000-0000-0000-00000000cf06'::uuid, 'CTAST6', 'CT Asset 6 _ctstest'),
  ('cccc0000-0000-0000-0000-00000000cf07'::uuid, 'CTAST7', 'CT Asset 7 _ctstest'),
  ('cccc0000-0000-0000-0000-00000000cf08'::uuid, 'CTAST8', 'CT Asset 8 _ctstest');

DO $$
DECLARE
  OA         uuid := 'aaaa0000-0000-0000-0000-00000000cf01';
  OB         uuid := 'aaaa0000-0000-0000-0000-00000000cf02';
  ANALYST_A  uuid := 'bbbb0000-0000-0000-0000-00000000cf01';
  ANALYST_B  uuid := 'bbbb0000-0000-0000-0000-00000000cf02';
  ANALYST_A2 uuid := 'bbbb0000-0000-0000-0000-00000000cf03';
  AS1        uuid := 'cccc0000-0000-0000-0000-00000000cf01';
  AS2        uuid := 'cccc0000-0000-0000-0000-00000000cf02';
  AS3        uuid := 'cccc0000-0000-0000-0000-00000000cf03';
  AS4        uuid := 'cccc0000-0000-0000-0000-00000000cf04';
  AS5        uuid := 'cccc0000-0000-0000-0000-00000000cf05';
  AS6        uuid := 'cccc0000-0000-0000-0000-00000000cf06';
  AS7        uuid := 'cccc0000-0000-0000-0000-00000000cf07';
  AS8        uuid := 'cccc0000-0000-0000-0000-00000000cf08';

  v_a1 uuid; v_a2 uuid; v_b1 uuid; v_b2 uuid; v_null uuid;
  v_type text; v_old_user uuid; v_off int;
  v_pass int := 0;
  v_fail int := 0;
BEGIN
  RAISE NOTICE '=== Coverage trigger tenant-scope tests ===';
  RAISE NOTICE '';

  -- Only org A gets a settings row, and it says allow_multiple = false. With
  -- exactly one row in the table the pre-migration `FROM coverage_settings
  -- LIMIT 1` is deterministic: every tenant reads org A's `false`.
  INSERT INTO coverage_settings (organization_id, allow_multiple_coverage, updated_by)
  VALUES (OA, false, ANALYST_A);

  -- ===========================================================================
  -- [1] Org A's allow_multiple_coverage = false must not govern org B.
  --
  -- Org B has no settings row, so its correct answer is "multiple allowed" and
  -- its earlier coverage must survive a second insert.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS1, ANALYST_B, 'CT Analyst B1', OB, true, CURRENT_DATE - 30)
  RETURNING id INTO v_b1;

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS1, ANALYST_B, 'CT Analyst B2', OB, true, CURRENT_DATE);

  IF (SELECT is_active FROM coverage WHERE id = v_b1) THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [1] org A settings did not govern org B';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [1] org B coverage was superseded under org A''s allow_multiple_coverage=false';
  END IF;

  -- ===========================================================================
  -- [2] An insert in org A must not deactivate org B's coverage.
  -- [3] ...while the same-org supersede must still work.
  -- [4] ...and must still log analyst_changed naming org A's OWN analyst.
  --
  -- Org A is allow_multiple = false, so the destructive branch genuinely runs
  -- here. It has to hit org A's row and only org A's row.
  --
  -- Org B's row starts 30 days back so that the pre-migration cross-tenant
  -- UPDATE lands a valid end_date on it and reports a clean assertion failure,
  -- rather than tripping `coverage_dates_valid` and aborting the whole file.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS2, ANALYST_B, 'CT Analyst B', OB, true, CURRENT_DATE - 30)
  RETURNING id INTO v_b1;

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS2, ANALYST_A, 'CT Analyst A1', OA, true, CURRENT_DATE - 20)
  RETURNING id INTO v_a1;

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS2, ANALYST_A, 'CT Analyst A2', OA, true, CURRENT_DATE)
  RETURNING id INTO v_a2;

  IF (SELECT is_active FROM coverage WHERE id = v_b1) THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [2] org B coverage survived org A''s supersede';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [2] an insert in org A deactivated org B coverage';
  END IF;

  IF (SELECT is_active FROM coverage WHERE id = v_a1) IS FALSE THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [3] same-org supersede still retires the previous row';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [3] same-org supersede stopped working';
  END IF;

  -- ===========================================================================
  -- [4] allow_multiple_coverage = false still logs analyst_changed, naming the
  --     organization's OWN previous analyst.
  --
  -- Deliberately NOT asserted against the rows above, and this is worth
  -- explaining because the obvious version of this assertion fails both before
  -- AND after the migration.
  --
  -- When the previous row has `end_date IS NULL`, `end_previous_coverage` has
  -- already deactivated it by the time `log_coverage_change` runs, so the
  -- lookup finds nothing and logs `created`. The INSERT-path `analyst_changed`
  -- branch is therefore unreachable in that configuration — pre-existing dead
  -- logic, unchanged by this migration and out of scope for it.
  --
  -- The branch IS reachable when the previous row carries an end_date: the
  -- supersede skips it (`AND end_date IS NULL`) and the history lookup finds it
  -- anyway. That is the same asymmetry assertion [6] exploits to expose the
  -- cross-tenant bug — this is its legitimate same-org twin, and it proves the
  -- organization predicate narrowed the lookup without breaking attribution.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date, end_date)
  VALUES (AS8, ANALYST_A2, 'CT Analyst A2', OA, true, CURRENT_DATE - 5, CURRENT_DATE + 30);

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS8, ANALYST_A, 'CT Analyst A', OA, true, CURRENT_DATE)
  RETURNING id INTO v_a2;

  SELECT change_type, old_user_id INTO v_type, v_old_user
  FROM coverage_history WHERE coverage_id = v_a2
  ORDER BY changed_at DESC, ctid DESC LIMIT 1;

  IF v_type = 'analyst_changed' AND v_old_user = ANALYST_A2 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [4] allow_multiple=false logged analyst_changed from the same org';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [4] expected analyst_changed/%, got %/%', ANALYST_A2, v_type, v_old_user;
  END IF;

  -- ===========================================================================
  -- [5] History, reactivation path: org A must not name an org B analyst.
  --
  -- `trigger_end_previous_coverage` is BEFORE INSERT ONLY, so nothing runs
  -- ahead of `log_coverage_change` here and nothing can mask the finding.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS3, ANALYST_B, 'CT Analyst B', OB, true, CURRENT_DATE - 5);

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS3, ANALYST_A, 'CT Analyst A', OA, false, CURRENT_DATE - 20)
  RETURNING id INTO v_a1;

  UPDATE coverage SET is_active = true WHERE id = v_a1;

  SELECT change_type, old_user_id INTO v_type, v_old_user
  FROM coverage_history WHERE coverage_id = v_a1
  ORDER BY changed_at DESC, ctid DESC LIMIT 1;

  IF v_old_user IS DISTINCT FROM ANALYST_B THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [5] reactivation history did not name a foreign analyst';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [5] org A history names org B analyst % (change_type=%)', v_old_user, v_type;
  END IF;

  -- ===========================================================================
  -- [6] History, insert path: same claim, exposed by a future-dated neighbour.
  --
  -- The supersede skips org B's row because it carries an end_date; the history
  -- lookup filters on is_active alone and finds it anyway.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date, end_date)
  VALUES (AS4, ANALYST_B, 'CT Analyst B Future', OB, true, CURRENT_DATE - 5, CURRENT_DATE + 30);

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS4, ANALYST_A, 'CT Analyst A', OA, true, CURRENT_DATE)
  RETURNING id INTO v_a1;

  SELECT change_type, old_user_id INTO v_type, v_old_user
  FROM coverage_history WHERE coverage_id = v_a1
  ORDER BY changed_at DESC, ctid DESC LIMIT 1;

  IF v_old_user IS DISTINCT FROM ANALYST_B THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [6] insert history did not name a foreign analyst';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [6] org A history names org B analyst % (change_type=%)', v_old_user, v_type;
  END IF;

  -- ===========================================================================
  -- [7] allow_multiple_coverage = true still means no supersede, and history
  --     records coverage_added rather than analyst_changed.
  -- ===========================================================================
  UPDATE coverage_settings SET allow_multiple_coverage = true WHERE organization_id = OA;

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS5, ANALYST_A, 'CT Analyst A1', OA, true, CURRENT_DATE - 3)
  RETURNING id INTO v_a1;

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS5, ANALYST_A, 'CT Analyst A2', OA, true, CURRENT_DATE)
  RETURNING id INTO v_a2;

  SELECT change_type INTO v_type
  FROM coverage_history WHERE coverage_id = v_a2
  ORDER BY changed_at DESC, ctid DESC LIMIT 1;

  IF (SELECT is_active FROM coverage WHERE id = v_a1) AND v_type = 'coverage_added' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [7] allow_multiple=true left the previous row active and logged coverage_added';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [7] allow_multiple=true behaviour changed (active=%, type=%)',
                 (SELECT is_active FROM coverage WHERE id = v_a1), v_type;
  END IF;

  -- ===========================================================================
  -- [8] An organization with NO settings row still behaves as "multiple
  --     allowed".
  --
  -- The production-preservation guard, and the assertion most likely to catch a
  -- well-meaning future edit. 26 of production's 27 organizations have no
  -- settings row; today they all read the single existing one and therefore get
  -- `true`. Scoping the lookup WITHOUT defaulting a missing row to true would
  -- flip every one of them into supersede behaviour on deploy day — a security
  -- fix that silently starts deactivating rows. Delete the default in the
  -- migration and this assertion fails.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS6, ANALYST_B, 'CT Analyst B1', OB, true, CURRENT_DATE - 3)
  RETURNING id INTO v_b1;

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS6, ANALYST_B, 'CT Analyst B2', OB, true, CURRENT_DATE)
  RETURNING id INTO v_b2;

  SELECT change_type INTO v_type
  FROM coverage_history WHERE coverage_id = v_b2
  ORDER BY changed_at DESC, ctid DESC LIMIT 1;

  IF (SELECT is_active FROM coverage WHERE id = v_b1) AND v_type = 'coverage_added' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [8] an org with no settings row still allows multiple coverage';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [8] a settings-less org changed behaviour (active=%, type=%) — this '
                 'would silently start superseding coverage in 26 production orgs',
                 (SELECT is_active FROM coverage WHERE id = v_b1), v_type;
  END IF;

  -- ===========================================================================
  -- [9] A coverage row with no organization fails closed.
  --
  -- `coverage.organization_id` is nullable. With no tenant there is no correct
  -- set of rows to retire and no correct previous analyst, so the supersede
  -- must not run and the history must attribute nothing.
  --
  -- Org A is allow_multiple = false again, so the destructive branch is armed.
  -- ===========================================================================
  UPDATE coverage_settings SET allow_multiple_coverage = false WHERE organization_id = OA;

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS7, ANALYST_B, 'CT Analyst B', OB, true, CURRENT_DATE - 30);

  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS7, ANALYST_A, 'CT Orphan', NULL, true, CURRENT_DATE)
  RETURNING id INTO v_null;

  SELECT count(*) INTO v_off FROM coverage
   WHERE asset_id = AS7 AND id <> v_null AND is_active = false;

  SELECT change_type, old_user_id INTO v_type, v_old_user
  FROM coverage_history WHERE coverage_id = v_null
  ORDER BY changed_at DESC, ctid DESC LIMIT 1;

  IF v_off = 0 AND v_type = 'created' AND v_old_user IS NULL THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [9] a tenant-less row retired nothing and attributed nothing';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [9] tenant-less insert deactivated % row(s), logged %/%',
                 v_off, v_type, v_old_user;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed of 9 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'COVERAGE TRIGGER TENANT-SCOPE TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;

-- ---- Cleanup ----------------------------------------------------------------
-- History before coverage (FK), coverage before assets and organizations.
DELETE FROM coverage_history
  WHERE asset_id::text LIKE 'cccc0000-0000-0000-0000-00000000cf0%';
DELETE FROM coverage
  WHERE asset_id::text LIKE 'cccc0000-0000-0000-0000-00000000cf0%';
DELETE FROM coverage_settings
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000cf01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000cf02'::uuid);
DELETE FROM assets
  WHERE id::text LIKE 'cccc0000-0000-0000-0000-00000000cf0%';
DELETE FROM organization_memberships
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000cf01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000cf02'::uuid);
DELETE FROM organization_audit_log
  WHERE organization_id IN ('aaaa0000-0000-0000-0000-00000000cf01'::uuid,
                            'aaaa0000-0000-0000-0000-00000000cf02'::uuid);
DELETE FROM auth.users
  WHERE id IN ('bbbb0000-0000-0000-0000-00000000cf01'::uuid,
               'bbbb0000-0000-0000-0000-00000000cf02'::uuid,
               'bbbb0000-0000-0000-0000-00000000cf03'::uuid);
DELETE FROM organizations
  WHERE id IN ('aaaa0000-0000-0000-0000-00000000cf01'::uuid,
               'aaaa0000-0000-0000-0000-00000000cf02'::uuid);
