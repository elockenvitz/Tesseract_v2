-- =============================================================================
-- Two client delete paths that could never succeed
--
-- THE DEFECTS (both measured in production before 20261110010000)
--
--   public.trade_sheets  -- RLS on, policies for SELECT/INSERT/UPDATE, none for
--     DELETE. ClientOnboardingWizard clears the four tables
--     can_discard_portfolio() treats as blockers before calling
--     discard_portfolio(); trade_sheets is one of them. So removing a portfolio
--     that has a trade sheet is impossible from the app, and the wizard shows
--     the portfolio it just told you it removed.
--
--   public.trade_batches -- same shape. execute-sim-variants-service deletes an
--     all-failed batch so it does not pollute the Trade Book. 4 of 24 batches in
--     production have no accepted_trades rows: the delete has never worked.
--
--   Neither call site checks the error, so both failures are silent.
--
-- WHAT THESE 7 ASSERTIONS PIN
--
--   1-3  trade_sheets: the member may delete; an outside org may not; a
--        same-org non-member may not. Membership, not org, is the boundary --
--        which is what the existing SELECT policy already says.
--   4-6  trade_batches: the member may delete an EMPTY batch; may NOT delete a
--        batch holding a committed trade; an outside org may not delete at all.
--   7    The transitive-RLS case, and the reason the emptiness test lives in a
--        SECURITY DEFINER helper. Portfolio membership carries no org
--        condition, but accepted_trades is visible only when
--        portfolio_in_current_org() also holds. So a member of a portfolio in
--        org A whose CURRENT org is org B passes the batch policy's member
--        branch while being unable to see that portfolio's trades. Against an
--        inline `NOT EXISTS` the subquery would return no rows, read as
--        "empty", and hand them a non-empty batch to delete. Assertion 7 is
--        that user, and it fails if the helper is ever inlined.
--
-- Expected: 7/7 after 20261110010000. Before it: 1, 4 FAIL (the deletes are
-- refused) and 2, 3, 5, 6, 7 PASS vacuously, because "no DELETE policy" denies
-- everyone -- which is exactly why the denial assertions alone would not have
-- caught the defect, and why the allow assertions are here.
--
-- Self-cleaning. Every write carries a random suffix, and every row is removed
-- at the end regardless of outcome. Safe to run against production.
-- =============================================================================

DROP TABLE IF EXISTS _tdp_results;
CREATE TEMP TABLE _tdp_results(n int, result text, detail text);

DO $$
DECLARE
  v_sfx       text := substr(md5(random()::text), 1, 8);
  v_org_a     uuid;
  v_org_b     uuid;
  v_member    uuid := gen_random_uuid();  -- member of the portfolio, current org A
  v_nonmember uuid := gen_random_uuid();  -- active in org A, NOT a portfolio member
  v_outside   uuid := gen_random_uuid();  -- active in org B only
  v_crossorg  uuid := gen_random_uuid();  -- member of the portfolio, current org B
  v_pf        uuid;
  v_lab       uuid;
  v_sheet     uuid;
  v_empty     uuid;                       -- batch with no accepted_trades
  v_full      uuid;                       -- batch with one accepted_trade
  v_asset     uuid;
  v_ok        boolean;
  v_left      int;
  v_pass      int := 0;
  v_fail      int := 0;
  c_name      text := 'TDP probe ' || v_sfx;
BEGIN
  -- A refusal under RLS is not an error: DELETE simply matches no rows. So every
  -- assertion below reads its verdict from a follow-up count, never from whether
  -- an exception fired.
  RAISE NOTICE '=== trade delete paths (suffix: %) ===', v_sfx;

  -- ===========================================================================
  -- FIXTURES, written as the table owner (what a migration or a definer RPC is).
  -- ===========================================================================
  INSERT INTO organizations (name, slug) VALUES ('TDP A ' || v_sfx, 'tdp-a-' || v_sfx) RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('TDP B ' || v_sfx, 'tdp-b-' || v_sfx) RETURNING id INTO v_org_b;

  INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud, instance_id) VALUES
    (v_member,    'tdp_m_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_nonmember, 'tdp_n_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_outside,   'tdp_o_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_crossorg,  'tdp_x_' || v_sfx || '@test.invalid', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin) VALUES
    (v_org_a, v_member,    'active', false),
    (v_org_a, v_nonmember, 'active', false),
    (v_org_b, v_outside,   'active', false),
    (v_org_a, v_crossorg,  'active', false),
    (v_org_b, v_crossorg,  'active', false);   -- in both; currently acting in B

  UPDATE users SET current_organization_id = v_org_a WHERE id IN (v_member, v_nonmember);
  UPDATE users SET current_organization_id = v_org_b WHERE id IN (v_outside, v_crossorg);

  INSERT INTO portfolios (name, organization_id) VALUES (c_name || ' pf', v_org_a) RETURNING id INTO v_pf;

  -- v_member and v_crossorg are both portfolio members. Membership has no org
  -- condition, which is the whole point of assertion 7.
  INSERT INTO portfolio_memberships (portfolio_id, user_id) VALUES (v_pf, v_member), (v_pf, v_crossorg);

  INSERT INTO trade_labs (portfolio_id) VALUES (v_pf) RETURNING id INTO v_lab;
  INSERT INTO trade_sheets (lab_id, portfolio_id, name, variants_snapshot)
    VALUES (v_lab, v_pf, c_name || ' sheet', '[]'::jsonb) RETURNING id INTO v_sheet;

  INSERT INTO trade_batches (portfolio_id, created_by) VALUES (v_pf, v_member) RETURNING id INTO v_empty;
  INSERT INTO trade_batches (portfolio_id, created_by) VALUES (v_pf, v_member) RETURNING id INTO v_full;

  SELECT id INTO v_asset FROM assets LIMIT 1;
  INSERT INTO accepted_trades (portfolio_id, asset_id, action, source, accepted_by, batch_id)
    VALUES (v_pf, v_asset, 'buy', 'simulation', v_member, v_full);

  -- ===========================================================================
  -- 1. The onboarding fix: a portfolio member may delete a trade sheet.
  --    Before 20261110010000 this FAILED, and that is the defect.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM trade_sheets WHERE id = v_sheet;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_left FROM trade_sheets WHERE id = v_sheet;
  IF v_left = 0 THEN v_pass := v_pass + 1; INSERT INTO _tdp_results VALUES (1,'PASS','trade_sheets: a portfolio member can delete a sheet, so onboarding can clear the blocker');
  ELSE v_fail := v_fail + 1; INSERT INTO _tdp_results VALUES (1,'FAIL','trade_sheets: the member DELETE was refused, so discard_portfolio keeps reporting a blocker'); END IF;
  -- Restore for assertions 2 and 3.
  IF v_left = 0 THEN
    INSERT INTO trade_sheets (id, lab_id, portfolio_id, name, variants_snapshot)
      VALUES (v_sheet, v_lab, v_pf, c_name || ' sheet', '[]'::jsonb);
  END IF;

  -- ===========================================================================
  -- 2. A user from another organization may not.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outside, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM trade_sheets WHERE id = v_sheet;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_left FROM trade_sheets WHERE id = v_sheet;
  IF v_left = 1 THEN v_pass := v_pass + 1; INSERT INTO _tdp_results VALUES (2,'PASS','trade_sheets: another org cannot delete the sheet');
  ELSE v_fail := v_fail + 1; INSERT INTO _tdp_results VALUES (2,'FAIL','trade_sheets: a user from another ORGANIZATION deleted the sheet'); END IF;

  -- ===========================================================================
  -- 3. Nor may a member of the same org who is not on the portfolio. The
  --    boundary the existing SELECT policy draws is membership, not org.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_nonmember, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM trade_sheets WHERE id = v_sheet;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_left FROM trade_sheets WHERE id = v_sheet;
  IF v_left = 1 THEN v_pass := v_pass + 1; INSERT INTO _tdp_results VALUES (3,'PASS','trade_sheets: a same-org non-member cannot delete the sheet');
  ELSE v_fail := v_fail + 1; INSERT INTO _tdp_results VALUES (3,'FAIL','trade_sheets: a same-org NON-MEMBER deleted the sheet'); END IF;

  -- ===========================================================================
  -- 4. The Trade Book fix: a member may delete an EMPTY batch.
  --    Before 20261110010000 this FAILED, which is why production holds 4 of them.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM trade_batches WHERE id = v_empty;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_left FROM trade_batches WHERE id = v_empty;
  IF v_left = 0 THEN v_pass := v_pass + 1; INSERT INTO _tdp_results VALUES (4,'PASS','trade_batches: a member can delete an empty batch, so an all-failed commit leaves no residue');
  ELSE v_fail := v_fail + 1; INSERT INTO _tdp_results VALUES (4,'FAIL','trade_batches: the empty-batch DELETE was refused, so empty batches accumulate in the Trade Book'); END IF;
  IF v_left = 0 THEN
    INSERT INTO trade_batches (id, portfolio_id, created_by) VALUES (v_empty, v_pf, v_member);
  END IF;

  -- ===========================================================================
  -- 5. But NOT a batch holding a committed trade. The FK is ON DELETE SET NULL,
  --    so this would not destroy the trade -- it would silently detach it from
  --    the grouped approval it was committed under.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_member, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM trade_batches WHERE id = v_full;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_left FROM trade_batches WHERE id = v_full;
  IF v_left = 1 THEN v_pass := v_pass + 1; INSERT INTO _tdp_results VALUES (5,'PASS','trade_batches: a batch holding a committed trade cannot be deleted');
  ELSE v_fail := v_fail + 1; INSERT INTO _tdp_results VALUES (5,'FAIL','trade_batches: a NON-EMPTY batch was deleted, detaching a committed trade from its approval'); END IF;

  -- ===========================================================================
  -- 6. Another organization cannot delete even the empty batch.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_outside, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    DELETE FROM trade_batches WHERE id = v_empty;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  SELECT count(*) INTO v_left FROM trade_batches WHERE id = v_empty;
  IF v_left = 1 THEN v_pass := v_pass + 1; INSERT INTO _tdp_results VALUES (6,'PASS','trade_batches: another org cannot delete the empty batch');
  ELSE v_fail := v_fail + 1; INSERT INTO _tdp_results VALUES (6,'FAIL','trade_batches: a user from another ORGANIZATION deleted the batch'); END IF;

  -- ===========================================================================
  -- 7. The transitive-RLS case. v_crossorg IS a portfolio member (membership
  --    carries no org condition) but is currently acting in org B, so
  --    portfolio_in_current_org() is false for them and the portfolio's
  --    accepted_trades are invisible. If the emptiness test were an inline
  --    NOT EXISTS it would see no trades, read as "empty", and let them delete
  --    a non-empty batch. The definer helper asks the question with RLS out of
  --    the way. This assertion fails the moment the helper is inlined.
  -- ===========================================================================
  BEGIN
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_crossorg, 'role', 'authenticated')::text);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_left FROM accepted_trades WHERE batch_id = v_full;
    DELETE FROM trade_batches WHERE id = v_full;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  v_ok := v_left = 0;  -- did the cross-org member really see no trades?
  SELECT count(*) INTO v_left FROM trade_batches WHERE id = v_full;
  IF v_left = 1 THEN v_pass := v_pass + 1;
    INSERT INTO _tdp_results VALUES (7,'PASS','trade_batches: a portfolio member acting in another org cannot delete a non-empty batch'
      || CASE WHEN v_ok THEN ' (and the trades were genuinely invisible to them, so the helper is what stopped it)'
              ELSE ' (note: the trades were visible to them, so this run did not exercise the definer path)' END);
  ELSE v_fail := v_fail + 1; INSERT INTO _tdp_results VALUES (7,'FAIL','trade_batches: the emptiness test was defeated by the caller RLS -- a non-empty batch was deleted'); END IF;

  -- ===========================================================================
  -- CLEANUP. Unconditional, so a failed assertion cannot leave a fixture behind.
  -- ===========================================================================
  DELETE FROM accepted_trades WHERE portfolio_id = v_pf;
  DELETE FROM trade_batches   WHERE portfolio_id = v_pf;
  DELETE FROM trade_sheets    WHERE portfolio_id = v_pf;
  DELETE FROM trade_labs      WHERE portfolio_id = v_pf;
  DELETE FROM portfolio_memberships WHERE portfolio_id = v_pf;
  DELETE FROM portfolios      WHERE id = v_pf;
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organizations   WHERE id IN (v_org_a, v_org_b);
  -- handle_new_user() gives every new auth user a default asset_list, whose
  -- list_statuses carry created_by -> users(id) ON DELETE SET NULL beside
  -- list_id -> asset_lists ON DELETE CASCADE. Deleting the user fires both, and
  -- the SET NULL re-validates list_id against the row that just cascaded away,
  -- so the whole DELETE fails 23503. Dropping the lists first makes the cascade
  -- single-sided. A real production defect, recorded and not fixed here.
  DELETE FROM list_statuses WHERE created_by IN (v_member, v_nonmember, v_outside, v_crossorg);
  DELETE FROM asset_lists   WHERE created_by IN (v_member, v_nonmember, v_outside, v_crossorg);
  DELETE FROM auth.users    WHERE id IN (v_member, v_nonmember, v_outside, v_crossorg);

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 7 assertions ===', v_pass, v_fail;
END;
$$;

SELECT n, result, detail FROM _tdp_results ORDER BY n, result;
