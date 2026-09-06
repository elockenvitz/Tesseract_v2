-- =============================================================================
-- Working-book transaction invariants — regression test
--
-- Companion to holdings-working-book.sql, which pins the CONTRACT. This pins
-- the properties the contract needs in order to survive retry, a hostile
-- caller and an empty payload.
--
-- What is NOT here: the concurrency proofs. Two overlapping transactions
-- cannot be expressed in one DO block, and a test that pretended otherwise
-- would be worse than none. They are driven from two psql sessions instead —
-- see the header of 20260908100000_holdings_book_invariants.sql for the
-- measured before-and-after of each race. What IS here is the machinery those
-- proofs depend on, asserted directly: the lock exists, it is transaction
-- scoped, and both operations take it.
--
-- 16 assertions.
-- =============================================================================

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org      uuid;
  v_user     uuid;
  v_book     uuid;
  v_aapl     uuid;
  v_msft     uuid;
  v_trade    uuid;
  v_res      jsonb;
  v_n        int;
  v_num      numeric;
  v_txt      text;
  v_orig_org uuid;
  v_pass     int := 0;
  v_fail     int := 0;
BEGIN
  RAISE NOTICE '=== Working-book invariants (suffix: %) ===', v_suffix;

  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'SKIP: no auth users';
    RETURN;
  END IF;

  INSERT INTO organizations (name, slug) VALUES ('INV Org ' || v_suffix, 'inv-' || v_suffix)
    RETURNING id INTO v_org;
  INSERT INTO portfolios (name, organization_id) VALUES ('INV Book ' || v_suffix, v_org)
    RETURNING id INTO v_book;

  SELECT id INTO v_aapl FROM assets ORDER BY symbol LIMIT 1;
  SELECT id INTO v_msft FROM assets WHERE id <> v_aapl ORDER BY symbol LIMIT 1;
  IF v_msft IS NULL THEN
    RAISE NOTICE 'SKIP: fewer than two assets';
    DELETE FROM portfolios WHERE id = v_book;
    DELETE FROM organizations WHERE id = v_org;
    RETURN;
  END IF;

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (v_org, v_user, 'active', false) ON CONFLICT DO NOTHING;
  INSERT INTO portfolio_memberships (portfolio_id, user_id)
    VALUES (v_book, v_user) ON CONFLICT DO NOTHING;

  SELECT current_organization_id INTO v_orig_org FROM users WHERE id = v_user;
  UPDATE users SET current_organization_id = v_org WHERE id = v_user;

  -- Run as a real member, not as the service_role bypass. Every assertion
  -- below would pass with the member branch broken if this were omitted.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- ===========================================================================
  -- 1-4. SECURITY DEFINER hardening
  -- ===========================================================================
  SELECT array_to_string(p.proconfig, ',') INTO v_txt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'apply_trade_to_book';
  IF v_txt = 'search_path=public, pg_temp' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [1] apply_trade_to_book pins pg_temp last';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [1] search_path is %', v_txt; END IF;

  SELECT array_to_string(p.proconfig, ',') INTO v_txt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'reconcile_portfolio_book';
  IF v_txt = 'search_path=public, pg_temp' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [2] reconcile_portfolio_book pins pg_temp last';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [2] search_path is %', v_txt; END IF;

  -- `SET search_path = public` does NOT exclude pg_temp: Postgres searches the
  -- temporary schema first for relations unless it is listed. A caller could
  -- CREATE TEMP TABLE portfolio_holdings and the definer function would find
  -- it. Listing pg_temp last is the whole fix, so every definer function that
  -- touches the book has to carry it.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proname IN ('can_write_portfolio_book', 'apply_trade_to_book',
                      'reconcile_portfolio_book', 'lock_portfolio_book',
                      'enforce_holdings_snapshot_org_id')
    AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%pg_temp%';
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [3] no book function can be shadowed through pg_temp';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [3] % function(s) still exposed', v_n; END IF;

  -- EXECUTE must not reach PUBLIC or anon. anon holds table-level DML on
  -- portfolio_holdings for historical reasons, and these functions must not
  -- become the way around the policies that stop it using them.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
       LATERAL unnest(coalesce(p.proacl, '{}'::aclitem[])) acl
  WHERE n.nspname = 'public'
    AND p.proname IN ('apply_trade_to_book', 'reconcile_portfolio_book', 'lock_portfolio_book')
    AND (acl::text LIKE '=%' OR acl::text LIKE 'anon=%');
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [4] EXECUTE is granted to neither PUBLIC nor anon';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [4] % unwanted grant(s)', v_n; END IF;

  -- ===========================================================================
  -- 5-7. The lock the concurrency proofs rest on
  -- ===========================================================================
  SELECT count(*) INTO v_n FROM pg_locks
   WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [5] no book lock is held before an operation runs';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [5] % advisory lock(s) already held', v_n; END IF;

  PERFORM apply_trade_to_book(v_book, v_aapl, 1000, NULL, 100);
  SELECT count(*) INTO v_n FROM pg_locks
   WHERE locktype = 'advisory' AND pid = pg_backend_pid()
     AND classid = 1936026723;
  IF v_n = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [6] apply_trade_to_book takes the book lock';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [6] % book lock(s) held after a trade', v_n; END IF;

  PERFORM reconcile_portfolio_book(
    v_book,
    jsonb_build_array(jsonb_build_object('asset_id', v_aapl, 'shares', 1000, 'price', 100, 'cost', 90)),
    current_date, 'upload');
  SELECT count(*) INTO v_n FROM pg_locks
   WHERE locktype = 'advisory' AND pid = pg_backend_pid()
     AND classid = 1936026723;
  -- Still exactly one: the same portfolio, the same key, and re-taking a lock
  -- already held is free. Two portfolios would show two.
  IF v_n = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [7] reconcile_portfolio_book takes the same book lock';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [7] % book lock(s) held', v_n; END IF;

  -- ===========================================================================
  -- 8-12. IDEMPOTENCY, keyed on the trade's own identity and state
  -- ===========================================================================
  DELETE FROM portfolio_holdings WHERE portfolio_id = v_book;

  INSERT INTO accepted_trades
    (portfolio_id, asset_id, action, source, accepted_by, delta_shares, price_at_acceptance)
  VALUES (v_book, v_aapl, 'buy', 'adhoc', v_user, 100, 10)
  RETURNING id INTO v_trade;

  v_res := apply_trade_to_book(v_book, v_aapl, NULL, 100, 10, v_trade, v_user);
  IF (v_res->>'applied')::boolean AND (v_res->>'action') = 'initiate' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [8] the first application opens the position';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [8] %', v_res; END IF;

  -- The stamp is written by the operation, in the same transaction as the
  -- book write. While those were two transactions there was a window where
  -- the book had moved and the trade still looked unapplied.
  SELECT execution_status || '/' || reconciliation_status INTO v_txt
    FROM accepted_trades WHERE id = v_trade;
  IF v_txt = 'complete/matched' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [9] the trade is stamped by the same operation';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [9] trade reads %', v_txt; END IF;

  v_res := apply_trade_to_book(v_book, v_aapl, NULL, 100, 10, v_trade, v_user);
  IF (v_res->>'applied')::boolean = false AND (v_res->>'reason') = 'already_applied' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [10] a retry is refused, not re-applied';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [10] %', v_res; END IF;

  SELECT shares INTO v_num FROM portfolio_holdings
   WHERE portfolio_id = v_book AND asset_id = v_aapl;
  IF v_num = 100 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [11] and the delta was applied exactly once';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [11] shares % (200 = applied twice)', v_num; END IF;

  -- Without an id there is no identity to key on, so the caller is trusted.
  -- The reversal path depends on this: it applies the negation of a trade
  -- that is already complete.
  v_res := apply_trade_to_book(v_book, v_aapl, NULL, -100, 10);
  SELECT count(*) INTO v_n FROM portfolio_holdings
   WHERE portfolio_id = v_book AND asset_id = v_aapl;
  IF (v_res->>'applied')::boolean AND v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [12] an unkeyed call still applies, so reversal works';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [12] % / % row(s)', v_res, v_n; END IF;

  -- ===========================================================================
  -- 13-16. EMPTY AND MALFORMED PAYLOADS
  -- ===========================================================================
  PERFORM reconcile_portfolio_book(
    v_book,
    jsonb_build_array(
      jsonb_build_object('asset_id', v_aapl, 'shares', 400, 'price', 100, 'cost', 90),
      jsonb_build_object('asset_id', v_msft, 'shares', 800, 'price', 50, 'cost', 45)),
    current_date, 'upload');

  BEGIN
    PERFORM reconcile_portfolio_book(v_book, '[]'::jsonb, current_date, 'upload');
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [13] an empty payload emptied a live book';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [13] an empty payload is refused';
  END;

  -- Rows that cannot be positions: no asset, or no shares. A file that parsed
  -- into nothing usable reduces to the empty case rather than to a wipe.
  BEGIN
    PERFORM reconcile_portfolio_book(
      v_book,
      jsonb_build_array(
        jsonb_build_object('shares', 100, 'price', 10),
        jsonb_build_object('asset_id', v_aapl, 'shares', 0, 'price', 10)),
      current_date, 'upload');
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [14] a malformed payload emptied a live book';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [14] a payload with no usable position is refused';
  END;

  SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id = v_book;
  IF v_n = 2 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [15] the live book survived both refusals intact';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [15] % position(s) left', v_n; END IF;

  -- Emptying stays possible, because it is a real operation. It just has to
  -- be asked for, and it reports what it destroyed.
  v_res := reconcile_portfolio_book(v_book, '[]'::jsonb, current_date, 'onboarding', TRUE);
  SELECT count(*) INTO v_n FROM portfolio_holdings WHERE portfolio_id = v_book;
  IF v_n = 0 AND (v_res->>'removed')::int = 2 AND (v_res->>'existing_before')::int = 2 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [16] the explicit allow-empty path empties it and reports what it removed';
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [16] % row(s) left, result %', v_n, v_res;
  END IF;

  -- ---------------------------------------------------------------------------
  -- CLEANUP
  -- ---------------------------------------------------------------------------
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  DELETE FROM accepted_trades WHERE portfolio_id = v_book;
  DELETE FROM portfolio_holdings WHERE portfolio_id = v_book;
  DELETE FROM portfolio_holdings_superseded WHERE portfolio_id = v_book;
  DELETE FROM portfolio_memberships WHERE portfolio_id = v_book;
  DELETE FROM portfolios WHERE id = v_book;
  DELETE FROM organization_memberships WHERE organization_id = v_org;
  DELETE FROM organization_audit_log WHERE organization_id = v_org;
  DELETE FROM organizations WHERE id = v_org;
  UPDATE users SET current_organization_id = v_orig_org WHERE id = v_user;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 16 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'BOOK INVARIANTS TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;
