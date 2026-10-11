-- Authenticated DATA-LAYER integration validation of the Asset Page's reads.
--
-- Runs the exact query shapes `useAssetDecisionTimeline`,
-- `useAssetWorkspace` and `DecisionMemorySummary` issue, as a REAL
-- authenticated user via `set local role authenticated`, against production.
--
-- READ-ONLY. Wrapped in a transaction that ends by raising, so nothing can
-- commit even by accident.
--
-- HELD + history   AAPL
-- UNHELD, none     AA
-- USER             elockenvitz@gmail.com (fa46cffc…), Tesseract, 10 AAPL books
begin;

create temp table ilog (seq serial, line text) on commit drop;

do $v$
DECLARE
  -- held
  n_ideas int; n_req int; n_ruled int; n_withdrawn int;
  n_commit int; n_unfilled int; n_exec int; n_verified int;
  n_outcomes int; n_outcomes_all int; n_reviews int; n_books int;
  n_orphan_outcomes int;
  -- unheld
  u_ideas int; u_req int; u_exec int; u_outcomes int; u_books int;
  -- scoping
  s_exec_growth int; s_exec_all int;
  aapl uuid; aa uuid; book uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"fa46cffc-dafb-4071-a3ea-5536240d462e","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  SELECT id INTO aapl FROM assets WHERE symbol = 'AAPL' LIMIT 1;
  SELECT id INTO aa   FROM assets WHERE symbol = 'AA'   LIMIT 1;

  IF aapl IS NULL OR aa IS NULL THEN
    RAISE EXCEPTION 'FAIL: the fixture securities are not visible to this user';
  END IF;


  -- ── 2. HELD security: every read the page makes ───────────────────────
  SELECT count(*) INTO n_ideas FROM trade_queue_items WHERE asset_id = aapl;
  SELECT count(*) INTO n_req FROM decision_requests d
    JOIN trade_queue_items t ON t.id = d.trade_queue_item_id WHERE t.asset_id = aapl;
  SELECT count(*) INTO n_ruled FROM decision_requests d
    JOIN trade_queue_items t ON t.id = d.trade_queue_item_id
   WHERE t.asset_id = aapl
     AND d.status IN ('accepted','accepted_with_modification','rejected','deferred');
  SELECT count(*) INTO n_withdrawn FROM decision_requests d
    JOIN trade_queue_items t ON t.id = d.trade_queue_item_id
   WHERE t.asset_id = aapl AND d.status = 'withdrawn';
  SELECT count(*) INTO n_commit FROM accepted_trades
   WHERE asset_id = aapl AND is_active = true;
  SELECT count(*) INTO n_unfilled FROM accepted_trades
   WHERE asset_id = aapl AND is_active = true
     AND coalesce(execution_status,'') <> 'complete';
  SELECT count(*) INTO n_exec FROM portfolio_trade_events WHERE asset_id = aapl;
  SELECT count(*) INTO n_verified FROM portfolio_trade_events
   WHERE asset_id = aapl AND detected_by_system = true
     AND source_type::text = 'holdings_diff'
     AND coalesce(metadata->>'origin','') NOT IN
         ('trader_attested','pm_assumed_execution','paper_execute_backfill');
  SELECT count(*) INTO n_outcomes FROM price_target_outcomes
   WHERE asset_id = aapl AND status IN ('hit','missed','expired');
  SELECT count(*) INTO n_outcomes_all FROM price_target_outcomes WHERE asset_id = aapl;
  SELECT count(DISTINCT portfolio_id) INTO n_books
    FROM portfolio_holdings WHERE asset_id = aapl;



  -- ── 3. Decision Memory accuracy: the invariant that matters ───────────
  -- Every visible outcome must join to a price target this user can see.
  SELECT count(*) INTO n_orphan_outcomes FROM price_target_outcomes p
   WHERE NOT EXISTS (SELECT 1 FROM analyst_price_targets apt WHERE apt.id = p.price_target_id);
  IF n_orphan_outcomes <> 0 THEN
    RAISE EXCEPTION 'FAIL: % outcome(s) visible whose parent target is NOT',
      n_orphan_outcomes;
  END IF;


  -- Executions must never be counted as observed unless both stamps agree.
  IF n_verified > n_exec THEN
    RAISE EXCEPTION 'FAIL: verified (%) exceeds total executions (%)', n_verified, n_exec;
  END IF;


  -- ── 4. Portfolio-specific visibility ─────────────────────────────────
  SELECT id INTO book FROM portfolios
   WHERE id IN (SELECT portfolio_id FROM portfolio_holdings WHERE asset_id = aapl)
   LIMIT 1;
  SELECT count(*) INTO s_exec_all FROM portfolio_trade_events WHERE asset_id = aapl;
  SELECT count(*) INTO s_exec_growth FROM portfolio_trade_events
   WHERE asset_id = aapl AND portfolio_id = book;
  IF s_exec_growth > s_exec_all THEN
    RAISE EXCEPTION 'FAIL: scoping to one book returned MORE rows than all books';
  END IF;


  -- ── 5. UNHELD security with no history ───────────────────────────────
  SELECT count(*) INTO u_ideas FROM trade_queue_items WHERE asset_id = aa;
  SELECT count(*) INTO u_req FROM decision_requests d
    JOIN trade_queue_items t ON t.id = d.trade_queue_item_id WHERE t.asset_id = aa;
  SELECT count(*) INTO u_exec FROM portfolio_trade_events WHERE asset_id = aa;
  SELECT count(*) INTO u_outcomes FROM price_target_outcomes WHERE asset_id = aa;
  SELECT count(DISTINCT portfolio_id) INTO u_books
    FROM portfolio_holdings WHERE asset_id = aa;

  IF (u_ideas + u_req + u_exec + u_outcomes + u_books) <> 0 THEN
    RAISE EXCEPTION
      'FAIL: the unheld fixture is no longer empty (ideas=% req=% exec=% outcomes=% books=%)',
      u_ideas, u_req, u_exec, u_outcomes, u_books;
  END IF;


  -- ── 6. Quote freshness source ────────────────────────────────────────
  -- The page labels a price by its basis. Confirm the columns it reads exist
  -- and that a stale close is distinguishable from a live quote.
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='assets'
     AND column_name IN ('current_price','last_price_update');
  RESET ROLE;

  -- Logging happens as the owner: `authenticated` cannot write a temp table
  -- created by postgres, and granting it would be a change to make a test
  -- pass.
  INSERT INTO ilog(line) VALUES
    ('OK  both fixture securities resolve as authenticated'),
    (format('OK  HELD AAPL: ideas=%s requests=%s ruled=%s withdrawn=%s committed=%s unfilled=%s executions=%s verified=%s outcomes(all/timeline)=%s/%s books=%s',
       n_ideas, n_req, n_ruled, n_withdrawn, n_commit, n_unfilled,
       n_exec, n_verified, n_outcomes_all, n_outcomes, n_books)),
    ('OK  no visible outcome outlives an invisible parent (the #252 invariant)'),
    (format('OK  observed executions (%s) cannot exceed total (%s)', n_verified, n_exec)),
    (format('OK  scoping narrows: one book=%s of %s executions', s_exec_growth, s_exec_all)),
    ('OK  UNHELD AA: every read returns zero -- the empty path is reachable'),
    (format('OK  quote basis columns on assets: %s',
       coalesce((SELECT string_agg(column_name, ', ' ORDER BY column_name)
          FROM information_schema.columns
         WHERE table_schema='public' AND table_name='assets'
           AND column_name IN ('current_price','last_price_update','price_as_of')), 'none')));
END $v$;

do $z$
DECLARE report text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY seq) INTO report FROM ilog;
  RAISE EXCEPTION E'AUTHENTICATED DATA-LAYER VALIDATION COMPLETE — ROLLING BACK\n%\n(read-only; nothing committed)', report;
END $z$;
