-- =============================================================================
-- Dangerous table privileges across schema public  (P3-2)
--
-- Guards the fix in
-- supabase/migrations/20261109210000_sec_revoke_dangerous_table_privileges.sql.
--
-- THE DEFECT
--
--   Four table privileges are outside RLS entirely, so no policy can stop
--   them: TRUNCATE, TRIGGER, REFERENCES and MAINTAIN (PG 17+). Measured on
--   production 2026-11-09:
--
--     grantee         tables  TRUNCATE  REFERENCES  TRIGGER  MAINTAIN
--     postgres           295       295         295      295       295
--     service_role       295       295         295      295       295
--     authenticated      279       261         262      262       279
--     anon               185       185         185      185       185
--
--   `anon` held TRUNCATE on 185 public tables, among them
--   portfolio_benchmark_weights (280,492 rows), price_history_cache (45,499),
--   user_sessions, portfolio_holdings, organization_audit_log and workflows.
--   Confirmed by EXECUTION, not by reading the ACL: assertion 4 ran a real
--   TRUNCATE as a real `anon` session and it SUCCEEDED.
--
-- ── Severity, stated honestly ─────────────────────────────────────────────
--
-- No live path through the API today. `anon` and `authenticated` are NOLOGIN
-- and are assumed via SET ROLE; PostgREST exposes no verb that emits TRUNCATE
-- or VACUUM; and ZERO functions in `public` contain TRUNCATE in their body, so
-- no RPC would run one with the caller's privileges. A single SECURITY INVOKER
-- function that truncated anything would arm all 185 at once, which is the
-- reason not to leave the grant sitting there.
--
-- ── Expected results ──────────────────────────────────────────────────────
--
--   BEFORE the migration:
--       4 PASS, 5 FAIL - assertions 1, 2, 3, 4 and 5 MUST fail.
--       If fewer fail, this test is decoration and must not be trusted.
--
--   AFTER the migration:
--       9 PASS, 0 FAIL.
--
-- Assertions 6-9 pass in BOTH states by design. They are the preserve side,
-- and they are the whole reason this is a targeted revoke rather than a
-- blanket one:
--
--   6  postgres and service_role keep all four on all 295 tables. A sweep that
--      took TRUNCATE from service_role would pass 1-5 and break every future
--      maintenance or bulk-reload job.
--   7  a real authenticated session can still INSERT on an RLS-protected
--      table. The four DML verbs are untouched.
--   8  set_asset_notes_org_id_trigger still fires, so organization_id is still
--      derived server-side. An owner trigger's execution does not depend on
--      the writer holding TRIGGER, and this proves it rather than asserting it.
--   9  update_asset_notes_updated_at still fires on an authenticated UPDATE.
--
-- ── Why assertion 9 writes a deliberately wrong timestamp ─────────────────
--
-- The obvious version -- update the row, check updated_at advanced -- CANNOT
-- work, and failed on its first run for that reason. `now()` is fixed for the
-- whole transaction, so a trigger setting `updated_at = now()` writes the same
-- value the INSERT already had, and the assertion fails whether or not the
-- trigger fired. Instead the UPDATE sets updated_at to 2000-01-01 explicitly;
-- if the BEFORE UPDATE trigger fires it overwrites that with now(). The check
-- is then independent of transaction time. A preserve assertion that fails for
-- a reason unrelated to the change is as dangerous as a security assertion
-- that passes for one.
--
-- Self-cleaning. 9 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _dtp_results;
CREATE TEMP TABLE _dtp_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_org    uuid;
  v_member uuid := gen_random_uuid();
  v_asset  uuid;
  v_note   uuid;
  v_orgid  uuid;
  v_upd    timestamptz;
  v_ok     boolean;
  v_state  text;
  v_count  int;
  v_pass   int := 0;
  v_fail   int := 0;
BEGIN
  RAISE NOTICE '=== dangerous table privileges, schema public (suffix: %) ===', v_suffix;

  -- ===========================================================================
  -- 1. THE FINDING. anon must hold TRUNCATE on no public table.
  -- ===========================================================================
  SELECT count(*) INTO v_count FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
     AND a.grantee::regrole::text = 'anon' AND a.privilege_type = 'TRUNCATE';
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (1,'PASS','anon holds TRUNCATE on 0 public tables');
  ELSE v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (1,'FAIL',format('anon holds TRUNCATE on %s public tables', v_count)); END IF;

  -- ===========================================================================
  -- 2. THE FINDING. Same for authenticated.
  -- ===========================================================================
  SELECT count(*) INTO v_count FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
     AND a.grantee::regrole::text = 'authenticated' AND a.privilege_type = 'TRUNCATE';
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (2,'PASS','authenticated holds TRUNCATE on 0 public tables');
  ELSE v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (2,'FAIL',format('authenticated holds TRUNCATE on %s public tables', v_count)); END IF;

  -- ===========================================================================
  -- 3. THE FINDING. The other three, for anon, authenticated and PUBLIC ('-').
  --    PUBLIC is checked explicitly because a revoke from anon does NOT remove
  --    a PUBLIC grant and vice versa.
  -- ===========================================================================
  SELECT count(*) INTO v_count FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
     AND a.grantee::regrole::text IN ('anon','authenticated','-')
     AND a.privilege_type IN ('REFERENCES','TRIGGER','MAINTAIN');
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (3,'PASS','no REFERENCES/TRIGGER/MAINTAIN for anon, authenticated or PUBLIC');
  ELSE v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (3,'FAIL',format('%s REFERENCES/TRIGGER/MAINTAIN entries remain', v_count)); END IF;

  -- ===========================================================================
  -- 4. THE FINDING, executed. A real anon session must be refused. This is the
  --    assertion that turned a predicate-shaped worry into a measurement: it
  --    SUCCEEDED before the migration.
  --    ai_conversation_tags is used because it holds 0 rows, so the proof locks
  --    nothing of consequence; the suite rolls back regardless.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    TRUNCATE TABLE public.ai_conversation_tags;
    v_ok := true; RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; v_ok := false;
  END;
  IF NOT v_ok THEN v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (4,'PASS',format('a real anon TRUNCATE is refused (%s)', v_state));
  ELSE v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (4,'FAIL','ANON TRUNCATED A PUBLIC TABLE'); END IF;

  -- ===========================================================================
  -- 5. THE FINDING, executed, as authenticated.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE authenticated;
    TRUNCATE TABLE public.ai_conversation_tags;
    v_ok := true; RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; RESET ROLE; v_ok := false;
  END;
  IF NOT v_ok THEN v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (5,'PASS',format('a real authenticated TRUNCATE is refused (%s)', v_state));
  ELSE v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (5,'FAIL','AUTHENTICATED TRUNCATED A PUBLIC TABLE'); END IF;

  -- ===========================================================================
  -- 6. PRESERVE the trusted roles. 295 tables x 4 privileges x 2 roles = 2360.
  -- ===========================================================================
  SELECT count(*) INTO v_count FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
     AND a.grantee::regrole::text IN ('postgres','service_role')
     AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN');
  IF v_count = 295*4*2 THEN v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (6,'PASS',format('postgres and service_role retain all four on all 295 tables (%s entries)', v_count));
  ELSE v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (6,'FAIL',format('trusted roles have %s of %s expected entries', v_count, 295*4*2)); END IF;

  -- ===========================================================================
  -- FIXTURE for the functional half
  -- ===========================================================================
  INSERT INTO organizations (name, slug) VALUES ('DTP Org ' || v_suffix, 'dtp-' || v_suffix) RETURNING id INTO v_org;
  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_member, 'dtp_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES (v_org, v_member, 'active', false);
  UPDATE users SET current_organization_id = v_org WHERE id = v_member;
  INSERT INTO assets (symbol, company_name) VALUES ('DTP' || upper(v_suffix), 'DTP Test ' || v_suffix) RETURNING id INTO v_asset;

  -- ===========================================================================
  -- 7. PRESERVE. An authenticated write on an RLS-protected table still works.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO asset_notes (asset_id, title, content, note_type)
      VALUES (v_asset, 'DTP ' || v_suffix, 'body', 'general') RETURNING id INTO v_note;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_note := NULL; v_state := SQLSTATE;
  END;
  IF v_note IS NOT NULL THEN v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (7,'PASS','an authenticated insert on an RLS-protected table still works');
  ELSE v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (7,'FAIL',format('APP BROKEN: authenticated insert refused (%s)', coalesce(v_state,'?'))); END IF;

  IF v_note IS NOT NULL THEN
    -- =========================================================================
    -- 8. PRESERVE. An owner trigger still derives organization_id server-side.
    --    An owner trigger's execution does not depend on the WRITER holding
    --    TRIGGER; this proves that rather than asserting it.
    -- =========================================================================
    SELECT organization_id INTO v_orgid FROM asset_notes WHERE id = v_note;
    IF v_orgid = v_org THEN v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (8,'PASS','set_asset_notes_org_id_trigger still fired (organization_id derived server-side)');
    ELSE v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (8,'FAIL',format('TRIGGER DID NOT FIRE: organization_id=%s expected %s', v_orgid, v_org)); END IF;

    -- =========================================================================
    -- 9. PRESERVE. The BEFORE UPDATE trigger still fires. See the header for
    --    why this hands it 2000-01-01 instead of comparing timestamps.
    -- =========================================================================
    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
      SET LOCAL ROLE authenticated;
      UPDATE asset_notes SET content = 'changed', updated_at = '2000-01-01T00:00:00Z' WHERE id = v_note;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE;
    END;
    SELECT updated_at INTO v_upd FROM asset_notes WHERE id = v_note;
    IF v_upd > '2001-01-01'::timestamptz THEN
      v_pass := v_pass + 1; INSERT INTO _dtp_results VALUES (9,'PASS',format('update_asset_notes_updated_at still fired (overwrote 2000-01-01 with %s)', v_upd));
    ELSE
      v_fail := v_fail + 1; INSERT INTO _dtp_results VALUES (9,'FAIL',format('TRIGGER DID NOT FIRE: updated_at left at %s', v_upd));
    END IF;
  ELSE
    v_fail := v_fail + 2;
    INSERT INTO _dtp_results VALUES (8,'FAIL','skipped: the insert in assertion 7 failed');
    INSERT INTO _dtp_results VALUES (9,'FAIL','skipped: the insert in assertion 7 failed');
  END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM asset_notes WHERE asset_id = v_asset;
  DELETE FROM assets WHERE id = v_asset;
  DELETE FROM organization_memberships WHERE organization_id = v_org;
  UPDATE users SET current_organization_id = NULL WHERE id = v_member;
  DELETE FROM organization_audit_log WHERE organization_id = v_org;
  DELETE FROM organizations WHERE id = v_org;
  DELETE FROM auth.users WHERE id = v_member;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 9 assertions ===', v_pass, v_fail;
  RAISE NOTICE 'Before the migration, 1, 2, 3, 4 and 5 MUST be among the failures.';
END;
$$;

SELECT n, result, detail FROM _dtp_results ORDER BY n, result;
