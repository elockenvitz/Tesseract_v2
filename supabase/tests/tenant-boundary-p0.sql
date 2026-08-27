-- =============================================================================
-- P0 Tenant Boundary — security regression test
--
-- Proves the bypass closed by migrations 20260826100000 / …100100 / …100200:
-- an authenticated user could set their own `users.current_organization_id`
-- to any organization UUID, and `current_org_id()` — which 186 RLS policies
-- across 69 tables trust — would then authorise reads into that tenant.
--
-- Designed to run from: SQL Editor (service role), psql, or CI against a
-- shadow database. Run it BEFORE the migrations to watch it fail, and after
-- to watch it pass; that is the proof, not the passing run on its own.
--
-- Unlike multi-org-isolation.sql, this test cannot use direct org_id
-- comparisons — the thing under test IS `auth.uid()` / `current_org_id()`.
-- So each probe assumes the `authenticated` role and forges a JWT claim, the
-- same way PostgREST presents a request, and drops back to the owning role
-- immediately afterwards.
--
-- Self-cleaning, and it restores the borrowed user's real current org.
-- 17 assertions.
-- =============================================================================

DO $$
DECLARE
  v_suffix        text := substr(md5(random()::text), 1, 8);
  v_user_id       uuid;
  v_orig_org      uuid;
  v_orig_first    text;
  v_org_a         uuid;   -- active membership
  v_org_b         uuid;   -- active membership, later revoked
  v_org_c         uuid;   -- never a member: the victim tenant
  v_portfolio_c   uuid;
  v_asset_id      uuid;
  v_claims        text;
  v_got           uuid;
  v_count         int;
  v_bool          boolean;
  v_seeded        int;    -- victim fixture row count, read as owner
  v_pass          int := 0;
  v_fail          int := 0;
BEGIN
  RAISE NOTICE '=== P0 Tenant Boundary Test (suffix: %) ===', v_suffix;

  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'SKIP: no auth users — cannot exercise auth.uid()';
    RETURN;
  END IF;
  SELECT current_organization_id, first_name
    INTO v_orig_org, v_orig_first
    FROM users WHERE id = v_user_id;
  SELECT id INTO v_asset_id FROM assets LIMIT 1;

  v_claims := json_build_object('sub', v_user_id, 'role', 'authenticated')::text;

  -- ---------------------------------------------------------------------------
  -- SETUP
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug) VALUES ('P0 Org A ' || v_suffix, 'p0-a-' || v_suffix)
    RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('P0 Org B ' || v_suffix, 'p0-b-' || v_suffix)
    RETURNING id INTO v_org_b;
  INSERT INTO organizations (name, slug) VALUES ('P0 Victim ' || v_suffix, 'p0-c-' || v_suffix)
    RETURNING id INTO v_org_c;

  -- is_org_admin = false throughout: prevent_last_org_admin_removal() would
  -- otherwise block the revocation this test depends on.
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (v_org_a, v_user_id, 'active', false);
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (v_org_b, v_user_id, 'active', false);

  -- The victim tenant's data. Two different org-scoped shapes: one gated
  -- through portfolio_in_current_org(), one comparing organization_id
  -- directly, so the test covers both ways a policy consumes current_org_id().
  INSERT INTO portfolios (name, organization_id)
    VALUES ('P0 Victim Portfolio ' || v_suffix, v_org_c) RETURNING id INTO v_portfolio_c;
  IF v_asset_id IS NOT NULL THEN
    INSERT INTO portfolio_holdings (portfolio_id, asset_id) VALUES (v_portfolio_c, v_asset_id);
  END IF;
  INSERT INTO allocation_periods (name, start_date, end_date, organization_id)
    VALUES ('P0 Victim Period ' || v_suffix, current_date, current_date + 1, v_org_c);

  -- Start from a legitimate state.
  UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_id;

  -- ===========================================================================
  -- 1. A user operates normally in an org they actually belong to
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT current_org_id() INTO v_got;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_got := NULL;
  END;
  IF v_got = v_org_a THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [1] current_org_id() resolves an active membership';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [1] expected %, got %', v_org_a, v_got; END IF;

  -- ===========================================================================
  -- 2. THE BYPASS: cannot point current_organization_id at a foreign org
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    UPDATE users SET current_organization_id = v_org_c WHERE id = v_user_id;
    RESET ROLE;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [2] BYPASS OPEN — set current_organization_id to a non-member org';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [2] direct write to a foreign org rejected';
  WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [2] rejected (%)', SQLSTATE;
  END;

  -- The row must be untouched by the attempt.
  SELECT current_organization_id INTO v_got FROM users WHERE id = v_user_id;
  IF v_got = v_org_a THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [3] the rejected write left the row unchanged';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [3] row now reads %', v_got; END IF;

  -- ===========================================================================
  -- 3.1-3.4  THE CONSEQUENCE: what the forged pointer actually buys
  --
  -- [2] proves the write lands. On its own that is a wrong value in a column,
  -- and a reader could reasonably ask "so what". These four answer it, and
  -- they run HERE — before [4] moves the pointer on — because this is the only
  -- window in which the pointer is still aimed at the victim tenant.
  --
  -- Every read below goes through ordinary RLS as the same authenticated user
  -- with the same forged JWT claim. No service_role, no owner rights, no
  -- SECURITY DEFINER shortcut: exactly what a browser holding that session
  -- would get from PostgREST.
  --
  -- Phrased as REQUIREMENTS rather than as an exploit script, so they read the
  -- same way as every other assertion in this file: each fails while the
  -- bypass is open and passes once it is closed. After remediation [2] rejects
  -- the write, the pointer stays on Org A, and all four deny on their own.
  --
  -- Two policy shapes are covered deliberately, because the 186 consuming
  -- policies split between them: portfolio_holdings goes through
  -- portfolio_in_current_org(), allocation_periods compares
  -- `organization_id = current_org_id()` directly.
  -- ===========================================================================

  -- Read as the owner first. An absent fixture would come back as zero rows
  -- from the exploit read too, which would score as "denied" and turn these
  -- into assertions that cannot fail.
  SELECT count(*) INTO v_seeded FROM portfolio_holdings WHERE portfolio_id = v_portfolio_c;

  -- 3.1 — does the forged value survive as the caller's organisation?
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT current_org_id() INTO v_got;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_got := NULL;
  END;
  IF v_got IS DISTINCT FROM v_org_c THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [3.1] current_org_id() does not resolve a forged non-member org';
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [3.1] EXPLOIT — current_org_id() resolves the victim org %', v_org_c;
  END IF;

  -- 3.2 — the portfolio-scoping helper that 47 policies delegate to
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT portfolio_in_current_org(v_portfolio_c) INTO v_bool;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_bool := NULL;
  END;
  IF v_bool IS NOT TRUE THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [3.2] portfolio_in_current_org() denies the victim portfolio';
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [3.2] EXPLOIT — portfolio_in_current_org() admits the victim portfolio';
  END IF;

  -- 3.3 — the read itself, through RLS, via the helper-shaped policy
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM portfolio_holdings WHERE portfolio_id = v_portfolio_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_seeded = 0 THEN
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [3.3] victim holdings fixture is missing — this assertion cannot discriminate';
  ELSIF v_count = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [3.3] portfolio_holdings denies the victim org under a forged pointer';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [3.3] EXPLOIT — CROSS-TENANT READ: % of % victim holding row(s) visible through RLS', v_count, v_seeded;
  END IF;

  -- 3.4 — the same read against the `organization_id = current_org_id()` shape
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM allocation_periods WHERE organization_id = v_org_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [3.4] allocation_periods denies the victim org under a forged pointer';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [3.4] EXPLOIT — CROSS-TENANT READ: % victim allocation row(s) visible through RLS', v_count;
  END IF;

  -- ===========================================================================
  -- 4. set_current_org() still works for a real membership
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    PERFORM set_current_org(v_org_b);
    SELECT current_org_id() INTO v_got;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_got := NULL;
  END;
  IF v_got = v_org_b THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [4] set_current_org() switches to an active membership';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [4] expected %, got %', v_org_b, v_got; END IF;

  -- ===========================================================================
  -- 5. set_current_org() refuses an org the user does not belong to
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    PERFORM set_current_org(v_org_c);
    RESET ROLE;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [5] set_current_org() accepted a non-member org';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [5] set_current_org() refuses a non-member org';
  END;

  -- ===========================================================================
  -- 6-9. OFFBOARDING: revoking a membership revokes the authority immediately
  --
  -- The user is currently sitting in Org B. Revoke it out from under them —
  -- the way an admin deactivates a leaver — and every derived authority must
  -- collapse without anybody touching users.current_organization_id.
  -- ===========================================================================
  UPDATE organization_memberships SET status = 'inactive'
    WHERE organization_id = v_org_b AND user_id = v_user_id;

  -- maintain_current_org_on_membership_change() reassigns the column to the
  -- next active org. Put it back to the stale value on purpose: this is the
  -- former-member scenario, where the attacker restores a UUID they remember.
  UPDATE users SET current_organization_id = v_org_b WHERE id = v_user_id;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT current_org_id() INTO v_got;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_got := v_org_b;
  END;
  IF v_got IS NULL THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [6] current_org_id() is NULL for a revoked membership';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [6] stale membership still resolves to %', v_got; END IF;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT portfolio_in_current_org(v_portfolio_c) INTO v_bool;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_bool := true;
  END;
  IF v_bool IS NOT TRUE THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [7] portfolio_in_current_org() denies under a NULL org';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [7] portfolio_in_current_org() allowed a foreign portfolio'; END IF;

  -- The RLS consequence, on two differently-shaped policies.
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM portfolio_holdings WHERE portfolio_id = v_portfolio_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [8] portfolio_holdings denies the victim org';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [8] read % holding row(s) from the victim org', v_count; END IF;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM allocation_periods WHERE organization_id = v_org_c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [9] allocation_periods denies the victim org';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [9] read % allocation row(s) from the victim org', v_count; END IF;

  -- ===========================================================================
  -- 10. A former member cannot re-arm the stale UUID through set_current_org()
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    PERFORM set_current_org(v_org_b);
    RESET ROLE;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [10] a former member re-entered a revoked org';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [10] a former member cannot re-enter a revoked org';
  END;

  -- ===========================================================================
  -- 11. Multi-org: switching is allowed only among real active memberships
  -- ===========================================================================
  UPDATE users SET current_organization_id = v_org_a WHERE id = v_user_id;
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count
      FROM organization_memberships
      WHERE user_id = v_user_id AND status = 'active'
        AND organization_id IN (v_org_a, v_org_b, v_org_c);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_count := -1;
  END;
  IF v_count = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS [11] exactly one of the three test orgs remains switchable';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [11] % switchable test orgs', v_count; END IF;

  -- ===========================================================================
  -- 12-13. The allowlist: profile stays editable, authority does not
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    UPDATE users SET first_name = 'P0Test', timezone = 'UTC' WHERE id = v_user_id;
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [12] ordinary profile fields remain editable';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [12] profile editing broke (%)', SQLSTATE;
  END;

  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
    SET LOCAL ROLE authenticated;
    UPDATE users SET is_active = false WHERE id = v_user_id;
    RESET ROLE;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [13] is_active was client-writable';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [13] is_active is not client-writable';
  END;

  -- ---------------------------------------------------------------------------
  -- coverage_admin is deliberately NOT asserted here. Do not add it back.
  --
  -- There was a [14] that asserted the borrowed user cannot self-grant the flag.
  -- It failed against a correctly migrated database, because the guard in
  -- 20260826100200 permits an ORG ADMIN to set coverage_admin on any member of
  -- a shared organization — including themselves, since actor and subject can
  -- be the same membership row. That mirrors the pre-existing
  -- `Org admins can update coverage_admin for org members` row policy, so it is
  -- the designed behaviour and not a hole.
  --
  -- This file borrows whichever user `SELECT id FROM auth.users LIMIT 1`
  -- returns, and that user may legitimately be an org admin — staging's is. So
  -- the assertion's result depended on the fixture rather than on the code, and
  -- it could not discriminate: it failed identically before and after
  -- remediation, for two entirely different reasons.
  --
  -- coverage_admin authority is covered properly, and more rigorously, by
  -- supabase/tests/tenant-boundary-p0-coverage-admin.sql, which builds its own
  -- admin / non-admin / outsider / multi-org / lapsed fixtures and asserts each
  -- case separately. Nine assertions there beat one ambiguous one here.
  --
  -- The rule this encodes: a gate that borrows an arbitrary row must only
  -- assert things that are true of EVERY row it could borrow.
  -- ---------------------------------------------------------------------------

  -- ===========================================================================
  -- CLEANUP
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  UPDATE users SET first_name = v_orig_first WHERE id = v_user_id;
  DELETE FROM portfolio_holdings WHERE portfolio_id = v_portfolio_c;
  DELETE FROM allocation_periods WHERE organization_id = v_org_c;
  DELETE FROM portfolios WHERE id = v_portfolio_c;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b, v_org_c);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_b, v_org_c);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_b, v_org_c);
  -- Last, and after the memberships are gone, so the maintain trigger cannot
  -- overwrite the value we are restoring.
  UPDATE users SET current_organization_id = v_orig_org WHERE id = v_user_id;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 17 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'P0 TENANT BOUNDARY TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;
