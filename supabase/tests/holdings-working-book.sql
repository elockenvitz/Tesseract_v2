-- =============================================================================
-- Working-book contract — behavioural regression test
--
-- Proves the model installed by 20260907100000 / …100100:
--
--   portfolio_holdings is the current working book. One row per
--   (portfolio_id, asset_id). No row means no position. Only
--   apply_trade_to_book() and reconcile_portfolio_book() may change it.
--
-- Every assertion below fails against the pre-migration schema, either
-- because the function does not exist or because the dated key permits the
-- thing being forbidden. Run it before and after; the passing run alone is
-- not the proof.
--
-- Designed to run from: SQL Editor (service role), psql, or CI against a
-- shadow database. Self-cleaning.
--
-- 22 assertions.
-- =============================================================================

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org_a    uuid;
  v_org_c    uuid;
  v_user     uuid;
  v_book     uuid;
  v_victim   uuid;
  v_aapl     uuid;
  v_msft     uuid;
  v_nvda     uuid;
  v_res      jsonb;
  v_n        int;
  v_num      numeric;
  v_date     date;
  v_ts       timestamptz;
  v_pass     int := 0;
  v_fail     int := 0;

  v_source   text;
  v_orig_org uuid;
BEGIN
  RAISE NOTICE '=== Working-book contract (suffix: %) ===', v_suffix;

  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'SKIP: no auth users — cannot exercise auth.uid()';
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------------
  -- SETUP
  -- ---------------------------------------------------------------------------
  INSERT INTO organizations (name, slug) VALUES ('WB Org ' || v_suffix, 'wb-a-' || v_suffix)
    RETURNING id INTO v_org_a;
  INSERT INTO organizations (name, slug) VALUES ('WB Victim ' || v_suffix, 'wb-c-' || v_suffix)
    RETURNING id INTO v_org_c;

  INSERT INTO portfolios (name, organization_id) VALUES ('WB Book ' || v_suffix, v_org_a)
    RETURNING id INTO v_book;
  INSERT INTO portfolios (name, organization_id) VALUES ('WB Victim Book ' || v_suffix, v_org_c)
    RETURNING id INTO v_victim;

  SELECT id INTO v_aapl FROM assets ORDER BY symbol LIMIT 1;
  SELECT id INTO v_msft FROM assets WHERE id <> v_aapl ORDER BY symbol LIMIT 1;
  SELECT id INTO v_nvda FROM assets WHERE id NOT IN (v_aapl, v_msft) ORDER BY symbol LIMIT 1;
  IF v_nvda IS NULL THEN
    RAISE NOTICE 'SKIP: fewer than three assets — cannot build a book';
    DELETE FROM portfolios WHERE id IN (v_book, v_victim);
    DELETE FROM organizations WHERE id IN (v_org_a, v_org_c);
    RETURN;
  END IF;

  -- The caller is a member of the book's portfolio and operating in its org.
  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (v_org_a, v_user, 'active', false)
    ON CONFLICT DO NOTHING;
  INSERT INTO portfolio_memberships (portfolio_id, user_id)
    VALUES (v_book, v_user) ON CONFLICT DO NOTHING;

  SELECT current_organization_id INTO v_orig_org FROM users WHERE id = v_user;
  UPDATE users SET current_organization_id = v_org_a WHERE id = v_user;

  -- Present a real authenticated identity for the rest of this transaction.
  --
  -- Without this the whole body would run as whatever role invoked the file —
  -- from the SQL Editor that is service_role, which can_write_portfolio_book()
  -- lets through unconditionally. Every assertion below would then pass with
  -- the member branch completely broken. Setting the claim (and NOT the role)
  -- exercises the path the application actually uses, while leaving the direct
  -- DML in setup running as the owner so RLS does not block the fixture.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text,
    true);

  -- ===========================================================================
  -- 1-2. The key IS the contract
  -- ===========================================================================
  BEGIN
    INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
      VALUES (v_book, v_aapl, 100, 10, 10, current_date);
    INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
      VALUES (v_book, v_aapl, 200, 10, 10, current_date - 1);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [1] a second dated row for one position was accepted';
  EXCEPTION WHEN unique_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [1] one live row per (portfolio, asset)';
  END;

  BEGIN
    INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost)
      VALUES (v_book, v_msft, 0, 10, 10);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [2] a zero-share row was accepted';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [2] zero is not a tombstone — absence is';
  END;

  DELETE FROM portfolio_holdings WHERE portfolio_id = v_book;

  -- ===========================================================================
  -- 3-6. Ordinary trade arithmetic
  -- ===========================================================================
  v_res := apply_trade_to_book(v_book, v_aapl, 1000, NULL, 100);
  SELECT shares INTO v_num FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_aapl;
  IF (v_res->>'action') = 'initiate' AND v_num = 1000 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [3] a buy opens the position';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [3] % / shares %', v_res, v_num; END IF;

  v_res := apply_trade_to_book(v_book, v_aapl, NULL, 200, 110);
  SELECT shares INTO v_num FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_aapl;
  IF v_num = 1200 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [4] an add composes with the live position';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [4] shares %', v_num; END IF;

  v_res := apply_trade_to_book(v_book, v_aapl, NULL, -200, 110);
  SELECT shares INTO v_num FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_aapl;
  IF v_num = 1000 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [5] a partial sell reduces it';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [5] shares %', v_num; END IF;

  -- Two trades on the same name on the same day must compose, not overwrite.
  PERFORM apply_trade_to_book(v_book, v_aapl, NULL, 50, 110);
  PERFORM apply_trade_to_book(v_book, v_aapl, NULL, 25, 110);
  SELECT shares INTO v_num FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_aapl;
  IF v_num = 1075 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [6] repeated same-day trades compose';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [6] shares % (expected 1075)', v_num; END IF;

  -- ===========================================================================
  -- 7-9. STAGE 2 DEFECT 1 — the stale-dated position
  --
  -- The old writer looked the position up with `.eq('date', today)`. Back-date
  -- the row and the two failures reproduce exactly: a delta computed against
  -- zero, and an exit that deleted nothing while reporting success.
  -- ===========================================================================
  UPDATE portfolio_holdings SET date = current_date - 30
   WHERE portfolio_id = v_book AND asset_id = v_aapl;

  v_res := apply_trade_to_book(v_book, v_aapl, NULL, 100, 110);
  SELECT shares INTO v_num FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_aapl;
  IF v_num = 1175 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [7] a delta against a stale-dated position keeps the base';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [7] shares % — the old writer produced 100 here', v_num;
  END IF;

  UPDATE portfolio_holdings SET date = current_date - 30
   WHERE portfolio_id = v_book AND asset_id = v_aapl;

  v_res := apply_trade_to_book(v_book, v_aapl, 0, NULL, 110);
  SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_aapl;
  IF v_n = 0 AND (v_res->>'action') = 'exit' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [8] a full exit of a stale-dated position removes it';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL [8] % row(s) survive the exit, action=%', v_n, v_res->>'action';
  END IF;

  -- And an older row can never be promoted back to current, because there is
  -- no older row to promote.
  SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_aapl;
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [9] an exited position cannot reappear from history';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [9] % row(s) reappeared', v_n; END IF;

  -- ===========================================================================
  -- 10-11. STAGE 2 DEFECT 2 — a trade with no size
  -- ===========================================================================
  v_res := apply_trade_to_book(v_book, v_msft, NULL, NULL, 50);
  IF (v_res->>'applied')::boolean = false AND (v_res->>'reason') = 'no_size' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [10] a trade with no size reports that it was not applied';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [10] %', v_res; END IF;

  SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_msft;
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [11] and it wrote nothing';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [11] it created % row(s)', v_n; END IF;

  -- ===========================================================================
  -- 12-16. The complete reconcile
  -- ===========================================================================
  v_res := reconcile_portfolio_book(
    v_book,
    jsonb_build_array(
      jsonb_build_object('asset_id', v_aapl, 'shares', 400, 'price', 100, 'cost', 90),
      jsonb_build_object('asset_id', v_msft, 'shares', 800, 'price',  50, 'cost', 45),
      jsonb_build_object('asset_id', v_nvda, 'shares', 200, 'price',  75, 'cost', 70)
    ),
    current_date, 'upload');
  SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id = v_book;
  IF v_n = 3 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [12] a complete upload defines the book';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [12] % position(s)', v_n; END IF;

  -- The half no writer ever did: a name absent from the new book leaves it.
  v_res := reconcile_portfolio_book(
    v_book,
    jsonb_build_array(
      jsonb_build_object('asset_id', v_aapl, 'shares', 400, 'price', 100, 'cost', 90),
      jsonb_build_object('asset_id', v_msft, 'shares', 800, 'price',  50, 'cost', 45)
    ),
    current_date, 'upload');
  SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_nvda;
  IF v_n = 0 AND (v_res->>'removed')::int = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [13] an asset absent from a complete upload is removed';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [13] % NVDA row(s), removed=%', v_n, v_res->>'removed'; END IF;

  -- A zero-share line in a custodian file means the position closed.
  v_res := reconcile_portfolio_book(
    v_book,
    jsonb_build_array(
      jsonb_build_object('asset_id', v_aapl, 'shares', 400, 'price', 100, 'cost', 90),
      jsonb_build_object('asset_id', v_msft, 'shares',   0, 'price',  50, 'cost', 45)
    ),
    current_date, 'upload');
  SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id=v_book AND asset_id=v_msft;
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [14] a zero-share line is not a holding';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [14] MSFT survived at zero'; END IF;

  -- A file listing a name twice must not raise.
  BEGIN
    v_res := reconcile_portfolio_book(
      v_book,
      jsonb_build_array(
        jsonb_build_object('asset_id', v_aapl, 'shares', 500, 'price', 100, 'cost', 90),
        jsonb_build_object('asset_id', v_aapl, 'shares', 500, 'price', 100, 'cost', 90)
      ),
      current_date, 'upload');
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [15] a duplicated line does not fail the upload';
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [15] duplicate line raised %', SQLERRM;
  END;

  -- Emptying a book is a real operation, but never an accident.
  BEGIN
    v_res := reconcile_portfolio_book(v_book, '[]'::jsonb, current_date, 'upload');
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [16] an empty upload silently emptied the book';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [16] an empty upload is refused without an explicit flag';
  END;

  -- ===========================================================================
  -- 17-18. Book-level as-of
  -- ===========================================================================
  SELECT book_as_of, book_source, book_reconciled_at INTO v_date, v_source, v_ts
    FROM portfolios WHERE id = v_book;
  IF v_date = current_date AND v_source = 'upload' AND v_ts IS NOT NULL THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [17] a complete reconcile stamps the book';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [17] as_of=% source=% reconciled=%', v_date, v_source, v_ts; END IF;

  UPDATE portfolios SET book_as_of = current_date - 7, book_source = 'upload' WHERE id = v_book;
  PERFORM apply_trade_to_book(v_book, v_aapl, NULL, 10, 100);
  SELECT book_as_of, book_source INTO v_date, v_source FROM portfolios WHERE id = v_book;
  IF v_date = current_date - 7 AND v_source = 'trade' THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [18] a single trade moves the book but does not claim it is current';
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [18] as_of=% source=%', v_date, v_source;
  END IF;

  -- ===========================================================================
  -- 19. A trade changes the book; only a reconcile records a complete one
  --
  -- RESTATED by the historical-ledger stage. This used to assert that neither
  -- operation wrote a snapshot, which was right while the snapshot tables
  -- were being mutated in place by the trade path and had to be defended from
  -- it. A complete reconcile now WRITES a snapshot, because a reconcile knows
  -- the whole book and a trade knows one line. What must still hold is that a
  -- trade does not manufacture one.
  -- ===========================================================================
  SELECT count(*) INTO v_n FROM portfolio_holdings_snapshots
   WHERE portfolio_id = v_book AND source = 'trade';
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [19] a trade records no complete snapshot';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [19] % snapshot(s) written by a trade', v_n; END IF;

  -- ===========================================================================
  -- 20-22. Authorization — the existing model, not a new one
  -- ===========================================================================
  DECLARE
    v_claims text := json_build_object('sub', v_user, 'role', 'authenticated')::text;
  BEGIN
    -- A portfolio in another organization, from a fully legitimate session.
    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
      SET LOCAL ROLE authenticated;
      PERFORM apply_trade_to_book(v_victim, v_aapl, 999999, NULL, 1);
      RESET ROLE;
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL [20] applied a trade to another org''s book';
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_pass := v_pass + 1; RAISE NOTICE 'PASS [20] apply_trade_to_book refuses a foreign portfolio';
    END;

    BEGIN
      EXECUTE format('SET LOCAL request.jwt.claims = %L', v_claims);
      SET LOCAL ROLE authenticated;
      PERFORM reconcile_portfolio_book(
        v_victim,
        jsonb_build_array(jsonb_build_object('asset_id', v_aapl, 'shares', 1, 'price', 1, 'cost', 1)),
        current_date, 'upload');
      RESET ROLE;
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL [21] reconciled another org''s book';
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      v_pass := v_pass + 1; RAISE NOTICE 'PASS [21] reconcile_portfolio_book refuses a foreign portfolio';
    END;

    SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id = v_victim;
    IF v_n = 0 THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS [22] neither refusal left a row behind';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [22] % row(s) in the victim book', v_n; END IF;
  END;

  -- ---------------------------------------------------------------------------
  -- CLEANUP
  -- ---------------------------------------------------------------------------
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  DELETE FROM portfolio_holdings WHERE portfolio_id IN (v_book, v_victim);
  DELETE FROM portfolio_holdings_superseded WHERE portfolio_id IN (v_book, v_victim);
  DELETE FROM portfolio_memberships WHERE portfolio_id IN (v_book, v_victim);
  DELETE FROM portfolios WHERE id IN (v_book, v_victim);
  DELETE FROM organization_memberships WHERE organization_id IN (v_org_a, v_org_c);
  DELETE FROM organization_audit_log WHERE organization_id IN (v_org_a, v_org_c);
  DELETE FROM organizations WHERE id IN (v_org_a, v_org_c);
  UPDATE users SET current_organization_id = v_orig_org WHERE id = v_user;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 22 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'WORKING-BOOK CONTRACT TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;
