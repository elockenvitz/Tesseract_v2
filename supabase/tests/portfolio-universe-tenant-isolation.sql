-- =============================================================================
-- portfolio_universe_assets / portfolio_universe_filters tenant isolation
--
-- Guards the fix in
-- supabase/migrations/20261109190000_sec_portfolio_universe_org_scope.sql.
--
-- THE DEFECT
--
--   "Users can view portfolio universe <x>"   SELECT  TO PUBLIC  USING (auth.role() = 'authenticated')
--   "Users can manage portfolio universe <x>" ALL     TO PUBLIC  USING (auth.role() = 'authenticated')
--
-- `auth.role() = 'authenticated'` proves a session exists and nothing else. It
-- names no organization, so every logged-in user in every tenant could read
-- AND write every portfolio's investable universe and screening filters.
-- Measured on production 2026-11-09: a member of one organization read
-- another's filter row and successfully inserted into their portfolio.
--
-- Uses ACTUAL database roles (`authenticated`, `anon`) and a real
-- request.jwt.claims context, so grants, RLS and the
-- portfolio_in_current_org() -> current_org_id() chain are all exercised
-- together. No application-level filtering is involved, and none would be
-- sufficient: this is a database path that hands back rows the client never
-- asked to hide.
--
-- ── Expected results ────────────────────────────────────────────────────────
--
--   BEFORE the migration:
--       5 PASS, 7 FAIL - assertions 2, 3, 4, 5, 9, 11 and 12 MUST fail.
--       If fewer fail, this test is decoration and must not be trusted.
--       Measured against production 2026-11-09 inside a rolled-back
--       transaction, before any migration applied: exactly that set failed.
--
--   AFTER the migration:
--       12 PASS, 0 FAIL.
--
-- Assertions 1, 6, 7, 8 and 10 pass in BOTH states by design: they are the
-- preserve-legitimate-access side, and a fix that breaks one is too tight.
-- Assertion 12 is the one a membership-only fix would miss - a REMOVED member
-- whose current_organization_id still points at the org must be denied, which
-- is what current_org_id() enforces by requiring status = 'active'.
--
-- Assertion 11 is the one a USING-only fix would miss: UPDATE needs a WITH
-- CHECK as well, or a caller can move a row they legitimately hold into
-- another organization's portfolio by rewriting portfolio_id.
--
-- Self-cleaning. 12 assertions.
-- =============================================================================

DROP TABLE IF EXISTS _pu_results;
CREATE TEMP TABLE _pu_results(n int, result text, detail text);

DO $$
DECLARE
  v_suffix  text := substr(md5(random()::text), 1, 8);
  v_org_a   uuid;
  v_org_b   uuid;
  v_owner   uuid := gen_random_uuid();   -- org A, current A, owns the portfolio
  v_member  uuid := gen_random_uuid();   -- org A, current A, legitimate colleague
  v_out     uuid := gen_random_uuid();   -- active in A AND B, current B
  v_removed uuid := gen_random_uuid();   -- org A membership INACTIVE, current A
  v_pf_a    uuid;
  v_pf_b    uuid;
  v_asset1  uuid;
  v_asset2  uuid;
  v_asset3  uuid;
  v_row_a   uuid;
  v_row_b   uuid;
  v_count   int;
  v_pass    int := 0;
  v_fail    int := 0;
BEGIN
  RAISE NOTICE '=== portfolio_universe tenant isolation (suffix: %) ===', v_suffix;

  INSERT INTO organizations (name, slug) VALUES ('PU Org A ' || v_suffix, 'pu-a-' || v_suffix) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('PU Org B ' || v_suffix, 'pu-b-' || v_suffix) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_owner,   'pu_o_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_member,  'pu_m_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_out,     'pu_x_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_removed, 'pu_r_' || v_suffix || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  /* The outsider is an ACTIVE member of org A as well as org B, with org B
     current. Not a stranger: a colleague who switched organizations, which is
     the shape the real production users have. The removed user keeps org A as
     their current organization but their membership is inactive. */
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_owner,   'active',   false),
    (v_org_a, v_member,  'active',   false),
    (v_org_a, v_out,     'active',   false),
    (v_org_b, v_out,     'active',   false),
    (v_org_a, v_removed, 'inactive', false);

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_owner, v_member, v_removed);
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_out;

  INSERT INTO portfolios (name, organization_id, created_by)
    VALUES ('PU pf A ' || v_suffix, v_org_a, v_owner) RETURNING id INTO v_pf_a;
  INSERT INTO portfolios (name, organization_id, created_by)
    VALUES ('PU pf B ' || v_suffix, v_org_b, v_out) RETURNING id INTO v_pf_b;

  -- `assets` is global and symbol is UNIQUE, so the fixtures carry the suffix.
  INSERT INTO assets (symbol, company_name)
    VALUES ('PUT1' || upper(v_suffix), 'PU Test One ' || v_suffix) RETURNING id INTO v_asset1;
  INSERT INTO assets (symbol, company_name)
    VALUES ('PUT2' || upper(v_suffix), 'PU Test Two ' || v_suffix) RETURNING id INTO v_asset2;
  /* A third asset exists solely so assertion 11's reparenting target cannot
     collide with UNIQUE (portfolio_id, asset_id). The first run of this test
     used v_asset1 for the org B row, and reparenting it into org A's portfolio
     raised a unique violation that the EXCEPTION handler counted as a
     denial - assertion 11 passed against the VULNERABLE policy set. A test
     that passes for the wrong reason is worse than no test, so the fixture is
     shaped to leave only the policy as the possible cause of a refusal. */
  INSERT INTO assets (symbol, company_name)
    VALUES ('PUT3' || upper(v_suffix), 'PU Test Three ' || v_suffix) RETURNING id INTO v_asset3;

  INSERT INTO portfolio_universe_assets (portfolio_id, asset_id)
    VALUES (v_pf_a, v_asset1) RETURNING id INTO v_row_a;
  INSERT INTO portfolio_universe_assets (portfolio_id, asset_id)
    VALUES (v_pf_b, v_asset3) RETURNING id INTO v_row_b;
  INSERT INTO portfolio_universe_filters (portfolio_id, filter_type, filter_operator, filter_value)
    VALUES (v_pf_a, 'market_cap', 'gt', '1000M');

  -- ===========================================================================
  -- 1. anon reads nothing. Passes before and after; the grant revoke in the
  --    migration is what makes it structural rather than incidental.
  -- ===========================================================================
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_count FROM portfolio_universe_assets WHERE portfolio_id IN (v_pf_a, v_pf_b);
    RESET ROLE;
    IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (1, 'PASS', 'anon reads no universe row');
    ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (1, 'FAIL', format('anon read %s row(s)', v_count)); END IF;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE; v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (1, 'PASS', format('anon refused (%s)', SQLSTATE));
  END;

  -- ===========================================================================
  -- 2. THE FINDING, read. A user whose current organization is B must not read
  --    org A's universe, even as an active member of org A.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM portfolio_universe_assets WHERE portfolio_id = v_pf_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (2, 'PASS', 'org-B user reads no org A universe row');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (2, 'FAIL', format('CROSS-ORG READ: org-B user read %s org A universe row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 3. THE FINDING, insert. The outsider must not add a name to org A's universe.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO portfolio_universe_assets (portfolio_id, asset_id) VALUES (v_pf_a, v_asset2);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (3, 'PASS', 'org-B user cannot insert into org A''s universe');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (3, 'FAIL', 'CROSS-ORG WRITE: org-B user inserted into org A''s universe'); END IF;
  DELETE FROM portfolio_universe_assets WHERE portfolio_id = v_pf_a AND asset_id = v_asset2;

  -- ===========================================================================
  -- 4. THE FINDING, update. The outsider must not rewrite org A's universe row.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE portfolio_universe_assets SET notes = 'tampered' WHERE id = v_row_a;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (4, 'PASS', 'org-B user cannot update org A''s universe row');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (4, 'FAIL', format('CROSS-ORG WRITE: org-B user updated %s org A row(s)', v_count)); END IF;

  -- ===========================================================================
  -- 5. THE FINDING, delete. The outsider must not remove a name from org A's
  --    universe. This is the sharpest of the four: a silent deletion in another
  --    firm's research funnel leaves no trace the owning firm can see.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM portfolio_universe_assets WHERE id = v_row_a;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (5, 'PASS', 'org-B user cannot delete org A''s universe row');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (5, 'FAIL', format('CROSS-ORG WRITE: org-B user deleted %s org A row(s)', v_count)); END IF;
  -- Put it back if assertion 5 failed, so 6 onwards measure the same fixture.
  INSERT INTO portfolio_universe_assets (id, portfolio_id, asset_id)
    VALUES (v_row_a, v_pf_a, v_asset1) ON CONFLICT DO NOTHING;

  -- ===========================================================================
  -- 6. A same-org colleague still READS org A's universe. This is the live query
  --    in InvestableUniverseSection.tsx:37.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM portfolio_universe_assets WHERE portfolio_id = v_pf_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (6, 'PASS', 'same-org colleague reads the universe');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (6, 'FAIL', format('over-tightened: same-org read returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 7. A same-org colleague still INSERTS. InvestableUniverseSection.tsx:122
  --    sends exactly this shape and sets no added_by, so a WITH CHECK pinning
  --    added_by = auth.uid() would fail here - which is why the migration does
  --    not add one.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    INSERT INTO portfolio_universe_assets (portfolio_id, asset_id) VALUES (v_pf_a, v_asset2);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (7, 'PASS', 'same-org colleague inserts into the universe');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (7, 'FAIL', 'over-tightened: same-org insert was denied'); END IF;

  -- ===========================================================================
  -- 8. A same-org colleague still DELETES. InvestableUniverseSection.tsx:130.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM portfolio_universe_assets WHERE portfolio_id = v_pf_a AND asset_id = v_asset2;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (8, 'PASS', 'same-org colleague deletes from the universe');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (8, 'FAIL', 'over-tightened: same-org delete was denied'); END IF;

  -- ===========================================================================
  -- 9. THE FINDING on the filters table. Screening criteria are the funnel's
  --    shape, which is why this is tested separately rather than assumed.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM portfolio_universe_filters WHERE portfolio_id = v_pf_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (9, 'PASS', 'org-B user reads no org A filter');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (9, 'FAIL', format('CROSS-ORG READ: org-B user read %s org A filter(s)', v_count)); END IF;

  -- ===========================================================================
  -- 10. ...while a same-org colleague still reads it.
  --     InvestableUniverseSection.tsx:51.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM portfolio_universe_filters WHERE portfolio_id = v_pf_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (10, 'PASS', 'same-org colleague reads the filters');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (10, 'FAIL', format('over-tightened: same-org filter read returned %s rows, expected 1', v_count)); END IF;

  -- ===========================================================================
  -- 11. Reparenting. The outsider legitimately holds an org B universe row.
  --     They must not be able to move it into org A's portfolio. A fix that
  --     wrote USING without WITH CHECK on UPDATE passes 2 to 5 and fails this.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_out, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    UPDATE portfolio_universe_assets SET portfolio_id = v_pf_a WHERE id = v_row_b;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := 0;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (11, 'PASS', 'a row cannot be reparented into another org''s portfolio');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (11, 'FAIL', 'REPARENTING: org-B row was moved into org A''s portfolio'); END IF;
  UPDATE portfolio_universe_assets SET portfolio_id = v_pf_b WHERE id = v_row_b;
  -- Re-read, so a silent no-op cannot be mistaken for a restored fixture.
  SELECT count(*) INTO v_count FROM portfolio_universe_assets WHERE id = v_row_b AND portfolio_id = v_pf_b;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'fixture restore failed after assertion 11; results above are unsafe to trust';
  END IF;

  -- ===========================================================================
  -- 12. A REMOVED member of org A, whose current_organization_id still points
  --     at org A, reads nothing. current_org_id() requires status = 'active',
  --     so this is the assertion a membership-presence fix would miss.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_removed, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM portfolio_universe_assets WHERE portfolio_id = v_pf_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; INSERT INTO _pu_results VALUES (12, 'PASS', 'a removed member reads no universe row');
  ELSE v_fail := v_fail + 1; INSERT INTO _pu_results VALUES (12, 'FAIL', format('REMOVED MEMBER READ: %s row(s)', v_count)); END IF;

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  SET LOCAL request.jwt.claims = '';
  DELETE FROM portfolio_universe_filters WHERE portfolio_id IN (v_pf_a, v_pf_b);
  DELETE FROM portfolio_universe_assets WHERE portfolio_id IN (v_pf_a, v_pf_b);
  DELETE FROM portfolios WHERE id IN (v_pf_a, v_pf_b);
  DELETE FROM assets WHERE id IN (v_asset1, v_asset2, v_asset3);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  UPDATE users SET current_organization_id = NULL WHERE id IN (v_owner, v_member, v_out, v_removed);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b);
  DELETE FROM auth.users WHERE id IN (v_owner, v_member, v_out, v_removed);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 12 assertions ===', v_pass, v_fail;
  RAISE NOTICE 'Before the migration, 2/3/4/5/9/11/12 MUST be among the failures.';
END;
$$;

SELECT n, result, detail FROM _pu_results ORDER BY n, result;
