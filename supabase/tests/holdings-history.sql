-- =============================================================================
-- Holdings history — the ledger, the snapshots and the daily close
--
-- Third of three. holdings-working-book.sql pins what the CURRENT book means,
-- holdings-book-invariants.sql pins that it survives retry and concurrency,
-- and this pins that the book's HISTORY is recorded, immutable, and
-- reproducible.
--
-- Every assertion fails against the pre-ledger schema — most because the
-- table or function does not exist, the rest because the old snapshot model
-- overwrote a restated day instead of recording it.
--
-- 24 assertions.
-- =============================================================================

DO $$
DECLARE
  v_suffix   text := substr(md5(random()::text), 1, 8);
  v_org      uuid;
  v_user     uuid;
  v_book     uuid;
  v_other    uuid;
  v_a        uuid;
  v_b        uuid;
  v_c        uuid;
  v_trade    uuid;
  v_res      jsonb;
  v_snap1    uuid;
  v_snap2    uuid;
  v_event    uuid;
  v_n        int;
  v_num      numeric;
  v_txt      text;
  v_orig_org uuid;
  v_today    date := current_date;
  v_pass     int := 0;
  v_fail     int := 0;
BEGIN
  RAISE NOTICE '=== Holdings history (suffix: %) ===', v_suffix;

  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN RAISE NOTICE 'SKIP: no auth users'; RETURN; END IF;

  INSERT INTO organizations (name, slug) VALUES ('HIST Org ' || v_suffix, 'hist-' || v_suffix)
    RETURNING id INTO v_org;
  INSERT INTO portfolios (name, organization_id) VALUES ('HIST Book ' || v_suffix, v_org)
    RETURNING id INTO v_book;
  INSERT INTO portfolios (name, organization_id) VALUES ('HIST Other ' || v_suffix, v_org)
    RETURNING id INTO v_other;

  SELECT id INTO v_a FROM assets ORDER BY symbol LIMIT 1;
  SELECT id INTO v_b FROM assets WHERE id <> v_a ORDER BY symbol LIMIT 1;
  SELECT id INTO v_c FROM assets WHERE id NOT IN (v_a, v_b) ORDER BY symbol LIMIT 1;
  IF v_c IS NULL THEN
    RAISE NOTICE 'SKIP: fewer than three assets';
    DELETE FROM portfolios WHERE id IN (v_book, v_other);
    DELETE FROM organizations WHERE id = v_org;
    RETURN;
  END IF;

  INSERT INTO organization_memberships (organization_id, user_id, status, is_org_admin)
    VALUES (v_org, v_user, 'active', false) ON CONFLICT DO NOTHING;
  INSERT INTO portfolio_memberships (portfolio_id, user_id)
    VALUES (v_book, v_user), (v_other, v_user) ON CONFLICT DO NOTHING;

  SELECT current_organization_id INTO v_orig_org FROM users WHERE id = v_user;
  UPDATE users SET current_organization_id = v_org WHERE id = v_user;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- ===========================================================================
  -- 1-6. A reconcile records the book, the change and the complete snapshot
  -- ===========================================================================
  v_res := reconcile_portfolio_book(
    v_book,
    jsonb_build_array(
      jsonb_build_object('asset_id', v_a, 'shares', 100, 'price', 10, 'cost', 9),
      jsonb_build_object('asset_id', v_b, 'shares', 200, 'price', 20, 'cost', 18)),
    v_today, 'upload');
  v_snap1 := (v_res->>'snapshot_id')::uuid;

  SELECT revision INTO v_n FROM portfolio_holdings_snapshots WHERE id = v_snap1;
  IF v_snap1 IS NOT NULL AND v_n = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [1] a reconcile writes a complete snapshot, revision 1';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [1] snapshot %, revision %', v_snap1, v_n; END IF;

  SELECT count(*) INTO v_n FROM portfolio_holdings_positions WHERE snapshot_id = v_snap1;
  IF v_n = 2 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [2] the snapshot holds the whole book, not the delta';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [2] % position(s) in the snapshot', v_n; END IF;

  SELECT count(*) INTO v_n FROM portfolio_holdings_events
   WHERE portfolio_id = v_book AND event_type = 'reconcile_add';
  IF v_n = 2 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [3] both openings are on the ledger';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [3] % add event(s)', v_n; END IF;

  SELECT total_market_value INTO v_num FROM portfolio_holdings_snapshots WHERE id = v_snap1;
  IF v_num = 5000 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [4] the snapshot values the book as struck';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [4] total is %', v_num; END IF;

  -- Weight is stored, not recomputed: it is the weight AS THE BOOK WAS STRUCK.
  SELECT weight_pct INTO v_num FROM portfolio_holdings_positions
   WHERE snapshot_id = v_snap1 AND asset_id = v_a;
  IF round(v_num, 4) = 20.0000 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [5] each position carries its weight at the time';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [5] weight is %', v_num; END IF;

  -- Valuation provenance: the currency and the rate applied are not
  -- recoverable tomorrow, so they are stored rather than derived.
  SELECT count(*) INTO v_n FROM portfolio_holdings_positions
   WHERE snapshot_id = v_snap1 AND currency IS NOT NULL
     AND base_currency IS NOT NULL AND fx_rate_to_base IS NOT NULL;
  IF v_n = 2 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [6] valuation provenance is stored on every position';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [6] % of 2 position(s) carry it', v_n; END IF;

  -- ===========================================================================
  -- 7-10. The event shapes a reconcile can produce
  -- ===========================================================================
  v_res := reconcile_portfolio_book(
    v_book,
    jsonb_build_array(
      jsonb_build_object('asset_id', v_a, 'shares', 150, 'price', 10, 'cost', 9),
      jsonb_build_object('asset_id', v_c, 'shares', 300, 'price', 5, 'cost', 5)),
    v_today + 1, 'upload');

  SELECT count(*) INTO v_n FROM portfolio_holdings_events
   WHERE portfolio_id = v_book AND asset_id = v_a AND event_type = 'reconcile_change';
  IF v_n = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [7] a resized position is a change';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [7] % change event(s)', v_n; END IF;

  SELECT count(*) INTO v_n FROM portfolio_holdings_events
   WHERE portfolio_id = v_book AND asset_id = v_b AND event_type = 'reconcile_remove';
  IF v_n = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [8] a name absent from the file is a removal';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [8] % remove event(s)', v_n; END IF;

  SELECT shares_before, shares_after INTO v_num, v_n FROM portfolio_holdings_events
   WHERE portfolio_id = v_book AND asset_id = v_b AND event_type = 'reconcile_remove';
  IF v_num = 200 AND v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [9] before and after are both stated, always';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [9] % -> %', v_num, v_n; END IF;

  -- A file restating a position to the size it already was is not a change.
  SELECT count(*) INTO v_n FROM portfolio_holdings_events WHERE portfolio_id = v_book;
  PERFORM reconcile_portfolio_book(
    v_book,
    jsonb_build_array(
      jsonb_build_object('asset_id', v_a, 'shares', 150, 'price', 10, 'cost', 9),
      jsonb_build_object('asset_id', v_c, 'shares', 300, 'price', 5, 'cost', 5)),
    v_today + 2, 'upload');
  SELECT count(*) - v_n INTO v_n FROM portfolio_holdings_events WHERE portfolio_id = v_book;
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [10] an unchanged book writes no events';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [10] % event(s) for no change', v_n; END IF;

  -- ===========================================================================
  -- 11-14. A trade is a ledger entry, and only that
  -- ===========================================================================
  INSERT INTO accepted_trades
    (portfolio_id, asset_id, action, source, accepted_by, delta_shares, price_at_acceptance)
  VALUES (v_book, v_a, 'add', 'adhoc', v_user, 50, 12)
  RETURNING id INTO v_trade;

  v_res := apply_trade_to_book(v_book, v_a, NULL, 50, 12, v_trade, v_user);
  v_event := (v_res->>'event_id')::uuid;

  IF v_event IS NOT NULL THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [11] a trade returns the event it recorded';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [11] no event id: %', v_res; END IF;

  SELECT event_type || '/' || source || '/' || shares_before || '->' || shares_after
    INTO v_txt FROM portfolio_holdings_events WHERE id = v_event;
  IF v_txt = 'trade/trade/150->200' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [12] the entry states type, source and both sizes';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [12] reads %', v_txt; END IF;

  SELECT accepted_trade_id INTO v_txt FROM portfolio_holdings_events WHERE id = v_event;
  IF v_txt = v_trade::text THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [13] provenance points back at the trade';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [13] trade link is %', v_txt; END IF;

  -- A retry is refused by the accepted-trade guard AND, if that were ever
  -- bypassed, by the ledger's own replay identity.
  SELECT count(*) INTO v_n FROM portfolio_holdings_events
   WHERE idempotency_key = 'trade:' || v_trade::text;
  BEGIN
    INSERT INTO portfolio_holdings_events (
      organization_id, portfolio_id, asset_id, event_type, source,
      shares_before, shares_delta, shares_after, effective_at, idempotency_key)
    VALUES ('00000000-0000-0000-0000-000000000000', v_book, v_a, 'trade', 'trade',
            200, 50, 250, v_today, 'trade:' || v_trade::text);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [14] the same event was recorded twice';
  EXCEPTION WHEN unique_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [14] replay identity refuses a duplicate event';
  END;

  -- ===========================================================================
  -- 15-18. The ledger is append-only, and says so to everyone
  -- ===========================================================================
  BEGIN
    UPDATE portfolio_holdings_events SET shares_after = 999 WHERE id = v_event;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [15] a ledger row was edited';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [15] a ledger row cannot be edited';
  END;

  BEGIN
    DELETE FROM portfolio_holdings_events WHERE id = v_event;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [16] a ledger row was deleted';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [16] a ledger row cannot be deleted';
  END;

  BEGIN
    UPDATE portfolio_holdings_snapshots SET total_market_value = 1 WHERE id = v_snap1;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [17] a snapshot was restated in place';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [17] a snapshot cannot be restated in place';
  END;

  BEGIN
    DELETE FROM portfolio_holdings_positions WHERE snapshot_id = v_snap1;
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL [18] snapshot positions were deleted';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [18] snapshot positions cannot be deleted';
  END;

  -- ===========================================================================
  -- 19-21. A restated day is recorded, not overwritten
  -- ===========================================================================
  v_res := reconcile_portfolio_book(
    v_book,
    jsonb_build_array(jsonb_build_object('asset_id', v_a, 'shares', 999, 'price', 10, 'cost', 9)),
    v_today, 'upload');
  v_snap2 := (v_res->>'snapshot_id')::uuid;

  SELECT revision INTO v_n FROM portfolio_holdings_snapshots WHERE id = v_snap2;
  IF v_snap2 IS DISTINCT FROM v_snap1 AND v_n = 2 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [19] a corrected file writes revision 2';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [19] snapshot reused, or revision is %', v_n; END IF;

  SELECT superseded_by_id INTO v_txt FROM portfolio_holdings_snapshots WHERE id = v_snap1;
  IF v_txt = v_snap2::text THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [20] the original survives, pointing at what replaced it';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [20] supersede link is %', v_txt; END IF;

  SELECT count(*) INTO v_n FROM portfolio_holdings_snapshots
   WHERE portfolio_id = v_book AND snapshot_date = v_today AND superseded_at IS NULL;
  IF v_n = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [21] exactly one book of record per day remains';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [21] % current snapshot(s) for one date', v_n; END IF;

  -- ===========================================================================
  -- 22-24. The daily close
  -- ===========================================================================
  DELETE FROM portfolio_holdings WHERE portfolio_id = v_other;
  PERFORM reconcile_portfolio_book(
    v_other,
    jsonb_build_array(jsonb_build_object('asset_id', v_b, 'shares', 42, 'price', 3, 'cost', 3)),
    v_today - 10, 'upload');

  -- The close runs as the job, not as a member.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'service_role')::text, true);

  -- A Saturday must produce nothing at all.
  v_res := close_portfolio_books(date_trunc('week', v_today)::date + 5, v_other);
  IF (v_res->>'note') = 'not a business day' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [22] the close skips a non-business day';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [22] %', v_res; END IF;

  -- A day on which nothing happened still gets a complete book.
  v_res := close_portfolio_books(v_today - 3, v_other, TRUE);
  SELECT count(*) INTO v_n FROM portfolio_holdings_snapshots
   WHERE portfolio_id = v_other AND snapshot_date = v_today - 3;
  IF v_n = 1 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS [23] a day with no change still gets a complete book';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [23] % snapshot(s): %', v_n, v_res; END IF;

  -- Running it again must not manufacture a revision.
  v_res := close_portfolio_books(v_today - 3, v_other, TRUE);
  SELECT count(*) INTO v_n FROM portfolio_holdings_snapshots
   WHERE portfolio_id = v_other AND snapshot_date = v_today - 3;
  IF v_n = 1 AND (v_res->>'unchanged')::int = 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS [24] the close is safe to re-run';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL [24] % snapshot(s), result %', v_n, v_res; END IF;

  -- ---------------------------------------------------------------------------
  -- CLEANUP
  --
  -- Portfolios first: the ledger is append-only and its rows can only leave by
  -- cascading from the book they describe.
  -- ---------------------------------------------------------------------------
  RAISE NOTICE '';
  RAISE NOTICE '--- Cleanup ---';
  DELETE FROM portfolio_holdings WHERE portfolio_id IN (v_book, v_other);
  DELETE FROM portfolio_memberships WHERE portfolio_id IN (v_book, v_other);
  DELETE FROM portfolios WHERE id IN (v_book, v_other);
  DELETE FROM accepted_trades WHERE portfolio_id IN (v_book, v_other);
  DELETE FROM organization_memberships WHERE organization_id = v_org;
  DELETE FROM organization_audit_log WHERE organization_id = v_org;
  DELETE FROM organizations WHERE id = v_org;
  UPDATE users SET current_organization_id = v_orig_org WHERE id = v_user;

  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % passed, % failed out of 24 assertions ===', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'HOLDINGS HISTORY TEST FAILED: % assertion(s) failed', v_fail;
  END IF;
END;
$$;
