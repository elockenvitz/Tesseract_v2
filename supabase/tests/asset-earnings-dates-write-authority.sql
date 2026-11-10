-- =============================================================================
-- asset_earnings_dates write authority
--
-- Guards the fix in
-- supabase/migrations/20261109190003_sec_asset_earnings_dates_write_restriction.sql.
--
-- THE DEFECT
--
--   "Users can manage earnings dates"  ALL  TO PUBLIC  USING (auth.role() = 'authenticated')
--
-- The ALL policy governs INSERT, UPDATE and DELETE, and `auth.role() =
-- 'authenticated'` proves only that a session exists. Measured on production
-- 2026-11-09 in a rolled-back transaction, a member of one organization
-- inserted a row into the global earnings calendar every tenant reads.
--
-- `assets` is a global table and so is this calendar, so there is no tenant
-- boundary to cross: one bad or malicious row is read by all 24
-- organizations. That is the point. This is not a tenant-isolation test, it is
-- a write-authority test.
--
-- ── Intended access, established before changing it ───────────────────────
--
-- Reads are intentional and must survive. Three call sites read this table and
-- all three are `select` only:
--
--   src/hooks/useAssetEvents.ts:27
--   src/hooks/useAttention.ts:1271
--   src/hooks/useCommandCenter.ts:355
--
-- Writes have NO caller: grepping src, supabase/functions, scripts and
-- .github finds zero insert, update, upsert or delete against this table
-- anywhere in the repository, and the codebase already records the table as
-- empty with no ingestion in three places. So assertion 4 cannot be breaking
-- an ingestion path, because there is none to break. When one lands it must
-- run as service_role, which bypasses RLS and needs no policy.
--
-- ── Expected results ────────────────────────────────────────────────────────
--
--   BEFORE the migration:
--       3 PASS, 2 FAIL - assertions 4 and 5 MUST fail.
--       If fewer fail, this test is decoration and must not be trusted.
--
--   AFTER the migration:
--       5 PASS, 0 FAIL.
--
-- Assertions 1, 2 and 3 pass in BOTH states by design. 2 and 3 are the
-- preserve-reads side and are the reason this migration does not simply revoke
-- SELECT: the attention and command-centre surfaces would go blank.
--
-- Assertion 1 (anon) passes before the migration only because anon holds no
-- grant on this table - measured, an anon read returns 42501, not 0 rows.
-- The TO PUBLIC `USING (true)` SELECT policy would otherwise have published
-- the calendar to the browser bundle's key. The migration names
-- `authenticated` so a future grant cannot quietly arm it.
--
-- Self-cleaning. 5 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _aed_results;
CREATE TEMP TABLE _aed_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org    uuid;
  v_member uuid := gen_random_uuid();
  v_asset  uuid;
  v_seed   uuid;
  v_count  int;
  v_pass   int := 0;
  v_fail   int := 0;
BEGIN
  RAISE NOTICE '=== asset_earnings_dates write authority (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('AED Org ' || v_suffix, 'aed-' || v_suffix) RETURNING id INTO v_org;
  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_member, 'aed_m_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (v_org, v_member, 'active', false);
  UPDATE users SET current_organization_id = v_org WHERE id = v_member;

  INSERT INTO assets (symbol, company_name)
    VALUES ('AED' || upper(v_suffix), 'AED Test ' || v_suffix) RETURNING id INTO v_asset;

  -- One row the reads must find, written as the table owner (what an ingestion
  -- job running as service_role will look like).
  INSERT INTO asset_earnings_dates (asset_id, earnings_date, earnings_quarter, earnings_year, is_estimated)
    VALUES (v_asset, '2099-03-31', 'Q1', 2099, true) RETURNING id INTO v_seed;

  -- ===========================================================================
  -- 1. anon reads nothing. The calendar is public market data, but publishing
  --    it to the browser bundle's key is still a decision nobody made.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM asset_earnings_dates WHERE asset_id = v_asset;
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _aed_results VALUES (1, 'PASS', 'anon reads no earnings row');
    ELSE v_fail := v_fail + 1; INSERT INTO _aed_results VALUES (1, 'FAIL', format('ANON READ: %s row(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _aed_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. PRESERVE. An authenticated member still reads the calendar. This is
  --    useAssetEvents.ts:27 and useCommandCenter.ts:355.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_earnings_dates WHERE asset_id = v_asset;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _aed_results VALUES (2, 'PASS', 'authenticated member reads the earnings row');
  ELSE v_fail := v_fail + 1; INSERT INTO _aed_results VALUES (2, 'FAIL', format('earnings read returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 3. PRESERVE. The upcoming-earnings shape useAttention.ts:1271 sends, with
  --    the date filter, still returns the row.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM asset_earnings_dates
      WHERE asset_id = v_asset AND earnings_date >= current_date;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _aed_results VALUES (3, 'PASS', 'the upcoming-earnings query still returns the row');
  ELSE v_fail := v_fail + 1; INSERT INTO _aed_results VALUES (3, 'FAIL', format('upcoming-earnings returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 4. THE FINDING, insert. An ordinary authenticated user must not be able to
  --    add a row to the calendar every tenant reads.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_earnings_dates (asset_id, earnings_date, earnings_quarter, earnings_year)
      VALUES (v_asset, '2099-06-30', 'Q2', 2099);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _aed_results VALUES (4, 'PASS', 'authenticated cannot insert an earnings row');
  ELSE v_fail := v_fail + 1; INSERT INTO _aed_results VALUES (4, 'FAIL', 'UNAUTHORIZED WRITE: authenticated inserted an earnings row'); END IF;
  DELETE FROM asset_earnings_dates WHERE asset_id = v_asset AND earnings_date = '2099-06-30';

  -- ===========================================================================
  -- 5. THE FINDING, update. Silently moving a published earnings date is worse
  --    than adding one, because every tenant's attention surface reads it and
  --    nothing records that it moved.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE asset_earnings_dates SET earnings_date = '2099-12-31' WHERE id = v_seed;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _aed_results VALUES (5, 'PASS', 'authenticated cannot move a published earnings date');
  ELSE v_fail := v_fail + 1; INSERT INTO _aed_results VALUES (5, 'FAIL', format('UNAUTHORIZED WRITE: %s earnings row(s) moved', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM asset_earnings_dates WHERE asset_id = v_asset;
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id = v_org;
  UPDATE users SET current_organization_id = NULL WHERE id = v_member;
  DELETE FROM organization_audit_log WHERE organization_id = v_org;
  DELETE FROM organizations WHERE id = v_org;
  DELETE FROM auth.users WHERE id = v_member;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 5 assertions ===', v_pass, v_fail;
  RAISE NOTICE 'Before the migration, 4 and 5 MUST be among the failures.';
END;
$$;

SELECT n, result, detail FROM _aed_results ORDER BY n, result;
