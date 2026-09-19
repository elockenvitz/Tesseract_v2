-- =============================================================================
-- Deleting an organization — coverage audit regression tests
--
-- Acceptance criteria for
-- 20260911120000_coverage_history_survives_org_delete.sql.
--
--   [A] an ordinary coverage delete, in a live organization, still writes its
--       `deleted` history row
--   [B] deleting an organization that has coverage AND coverage history
--       succeeds, and both disappear with it
--   [C] deleting org A leaves org B's coverage and history untouched
--   [D] INSERT auditing is unchanged — the guard is on the DELETE branch only
--
-- Reproduced against the unpatched function: [B] fails with
--   insert or update on table "coverage_history" violates foreign key
--   constraint "coverage_history_organization_id_fkey"
-- and the organization is still there afterwards. [A], [C] and [D] pass both
-- before and after, which is the point of including them: the risk in touching
-- a trigger that every coverage write passes through is breaking what already
-- worked, not failing to fix the reported bug.
--
-- ── Why [B] asserts the organization is gone, not just that no error ────────
--
-- A DELETE that silently affects nothing also raises no error. Asserting the
-- row count afterwards is what distinguishes "the cascade completed" from "the
-- statement matched nothing", and the second would pass a weaker test while
-- leaving the tenant exactly where it was.
--
-- ── How these run ───────────────────────────────────────────────────────────
--
-- As the table owner, no SET ROLE, no JWT claims — the same convention as
-- `coverage-trigger-tenant-scope.sql`, and for the same reason: these test
-- TRIGGERS and FOREIGN KEYS, which have to be correct on their own rather than
-- because of a policy sitting above them. auth.uid() is NULL here, so
-- `notify_coverage_added_bulk` returns early and these fixtures emit no
-- notifications.
--
-- 4 assertions. Fixtures are synthetic, marked `_codtest`, and self-cleaning.
-- Cleanest invocation is `BEGIN; \i thisfile; ROLLBACK;` in psql; the cleanup
-- block at the foot handles the non-transactional case.
-- =============================================================================

-- ---- Setup ------------------------------------------------------------------
--   OA  aaaa…d001   the tenant being torn down
--   OB  aaaa…d002   the neighbour that must survive it untouched

INSERT INTO organizations (id, name, slug) VALUES
  ('aaaa0000-0000-0000-0000-00000000d001'::uuid, 'COD Org A _codtest', 'cod-org-a-codtest'),
  ('aaaa0000-0000-0000-0000-00000000d002'::uuid, 'COD Org B _codtest', 'cod-org-b-codtest');

INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
  ('bbbb0000-0000-0000-0000-00000000d001'::uuid, 'cod_analyst_a_codtest@firm.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbb0000-0000-0000-0000-00000000d002'::uuid, 'cod_analyst_b_codtest@firm.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

INSERT INTO assets (id, symbol, company_name) VALUES
  ('cccc0000-0000-0000-0000-00000000d001'::uuid, 'CODT1', 'COD Test One _codtest'),
  ('cccc0000-0000-0000-0000-00000000d002'::uuid, 'CODT2', 'COD Test Two _codtest'),
  ('cccc0000-0000-0000-0000-00000000d003'::uuid, 'CODT3', 'COD Test Three _codtest');

DO $$
DECLARE
  OA         uuid := 'aaaa0000-0000-0000-0000-00000000d001';
  OB         uuid := 'aaaa0000-0000-0000-0000-00000000d002';
  ANALYST_A  uuid := 'bbbb0000-0000-0000-0000-00000000d001';
  ANALYST_B  uuid := 'bbbb0000-0000-0000-0000-00000000d002';
  AS1        uuid := 'cccc0000-0000-0000-0000-00000000d001';
  AS2        uuid := 'cccc0000-0000-0000-0000-00000000d002';
  AS3        uuid := 'cccc0000-0000-0000-0000-00000000d003';

  v_cov  uuid;
  v_n    int;
  v_pass int := 0;
  v_fail int := 0;
BEGIN
  RAISE NOTICE '=== Coverage history / organization delete tests ===';
  RAISE NOTICE '';

  -- ===========================================================================
  -- [A] An ordinary delete, in a live organization, still writes history.
  --
  -- The case the guard must not break. This is every real coverage deletion a
  -- user performs.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS1, ANALYST_A, 'COD Analyst A1', OA, true, CURRENT_DATE)
  RETURNING id INTO v_cov;

  DELETE FROM coverage WHERE id = v_cov;

  SELECT count(*) INTO v_n
  FROM coverage_history
  WHERE coverage_id = v_cov AND change_type = 'deleted' AND organization_id = OA;

  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE '[A] PASS  ordinary delete writes its history row';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '[A] FAIL  expected 1 deleted-history row, found %', v_n;
  END IF;

  -- ===========================================================================
  -- [D] INSERT auditing is untouched.
  --
  -- The guard is on the DELETE branch, and this is what proves the replacement
  -- function did not disturb the other branches on its way past.
  -- ===========================================================================
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS2, ANALYST_A, 'COD Analyst A2', OA, true, CURRENT_DATE)
  RETURNING id INTO v_cov;

  SELECT count(*) INTO v_n
  FROM coverage_history
  WHERE coverage_id = v_cov AND change_type = 'coverage_added' AND organization_id = OA;

  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE '[D] PASS  insert auditing unchanged';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '[D] FAIL  expected 1 coverage_added row, found %', v_n;
  END IF;

  -- The neighbour, which must be identical at the end of this file.
  INSERT INTO coverage (asset_id, user_id, analyst_name, organization_id, is_active, start_date)
  VALUES (AS3, ANALYST_B, 'COD Analyst B1', OB, true, CURRENT_DATE);

  -- ===========================================================================
  -- [B] Deleting the organization succeeds, and takes its coverage and history
  --     with it.
  --
  -- Org A now holds live coverage AND history rows, which is the exact state
  -- that aborted the delete: the cascade fires the DELETE branch, which
  -- inserted history naming an organization that no longer existed.
  -- ===========================================================================
  BEGIN
    DELETE FROM organizations WHERE id = OA;
  EXCEPTION WHEN foreign_key_violation THEN
    v_fail := v_fail + 1;
    RAISE WARNING '[B] FAIL  organization delete aborted: %', SQLERRM;
  END;

  -- Asserted rather than inferred from the absence of an error: a DELETE that
  -- matched nothing also raises nothing.
  SELECT count(*) INTO v_n FROM organizations WHERE id = OA;
  IF v_n = 0 THEN
    SELECT count(*) INTO v_n FROM coverage WHERE organization_id = OA;
    IF v_n > 0 THEN
      v_fail := v_fail + 1;
      RAISE WARNING '[B] FAIL  % coverage row(s) survived the organization', v_n;
    ELSE
      SELECT count(*) INTO v_n FROM coverage_history WHERE organization_id = OA;
      IF v_n > 0 THEN
        v_fail := v_fail + 1;
        RAISE WARNING '[B] FAIL  % history row(s) survived the organization', v_n;
      ELSE
        v_pass := v_pass + 1;
        RAISE NOTICE '[B] PASS  organization deleted; coverage and history went with it';
      END IF;
    END IF;
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '[B] FAIL  organization still present after DELETE';
  END IF;

  -- ===========================================================================
  -- [C] The neighbour is untouched.
  -- ===========================================================================
  SELECT count(*) INTO v_n FROM coverage WHERE organization_id = OB;
  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE '[C] PASS  org B keeps its coverage';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING '[C] FAIL  org B has % coverage row(s), expected 1', v_n;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== % passed, % failed ===', v_pass, v_fail;

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'COVERAGE HISTORY ORG-DELETE TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END $$;

-- ---- Cleanup ----------------------------------------------------------------
-- Org A is already gone via its own cascade; this clears org B and the shared
-- catalogue rows. Harmless inside a transaction that is about to roll back.
DELETE FROM organizations WHERE id IN (
  'aaaa0000-0000-0000-0000-00000000d001'::uuid,
  'aaaa0000-0000-0000-0000-00000000d002'::uuid
);
DELETE FROM auth.users WHERE id IN (
  'bbbb0000-0000-0000-0000-00000000d001'::uuid,
  'bbbb0000-0000-0000-0000-00000000d002'::uuid
);
DELETE FROM assets WHERE id IN (
  'cccc0000-0000-0000-0000-00000000d001'::uuid,
  'cccc0000-0000-0000-0000-00000000d002'::uuid,
  'cccc0000-0000-0000-0000-00000000d003'::uuid
);
