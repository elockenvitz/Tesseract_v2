-- =============================================================================
-- apply_trade_to_holdings — regression tests
--
-- Acceptance criteria for 20260913120000_apply_trade_to_holdings_rpc.sql.
--
--   [A] first trade of a new date carries the COMPLETE prior snapshot forward
--   [B] a second trade on the same date does not roll forward again, and does
--       not re-apply the first
--   [C] a multi-trade batch leaves one row per asset — no duplicate date
--   [D] target_shares sets the position absolutely
--   [E] pure delta_shares moves the CARRIED-FORWARD position, not zero
--   [F] a buy debits cash, a sell credits it, by (after - before) x price
--   [G] liquidation removes the row and credits the whole position to cash
--   [H] a trade with no usable price is refused, not settled for free
--   [I] the day is decided in UTC, not by the session's TimeZone
--
-- Reproduced against the unpatched client path: [A] leaves a date holding one
-- row (the traded asset) and 35 positions stranded on the prior date, which is
-- what put AAPL at 100% and every other name at 0% in Trade Lab on 2026-09-13.
-- [E] wrote the delta as the whole position. [F] and [G] did nothing to cash
-- at all.
--
-- ── What these cannot prove ────────────────────────────────────────────────
--
-- Concurrency. One psql session is one transaction at a time, so [C] runs the
-- batch sequentially and proves the INVARIANT that concurrency must preserve
-- — one row per asset per date, each trade applied once — not that the lock
-- enforces it under real contention. The lock is asserted structurally in
-- src/lib/services/__tests__/holdings-apply-rpc.test.ts; genuinely proving it
-- needs two sessions racing a fresh date, which belongs in an integration
-- harness this repo does not have. Stated plainly because a test that looks
-- like it covers a race and does not is worse than no test.
--
-- ── How these run ───────────────────────────────────────────────────────────
--
-- As the table owner, no SET ROLE, no JWT claims — same convention as
-- coverage-history-org-delete.sql. The function is SECURITY INVOKER, so under
-- a real caller RLS applies; these assert the ARITHMETIC and the ROLLOVER,
-- which have to be right independently of who is allowed to run them.
--
-- 13 assertions. Fixtures are synthetic, marked `_athtest`, self-cleaning.
-- Cleanest invocation: `BEGIN; \i thisfile; ROLLBACK;` in psql.
-- =============================================================================

-- ---- Setup ------------------------------------------------------------------
--   P    cccc…e001   the portfolio under test
--   AAPL dddd…e001   an existing position (100 shares @ 10)
--   MSFT dddd…e002   an existing position (50 shares @ 20)
--   NVDA dddd…e003   never held — used for the new-position path
--   CASH dddd…e0c0   CASH_USD, 1000 shares @ 1

INSERT INTO organizations (id, name, slug) VALUES
  ('aaaa0000-0000-0000-0000-00000000e001'::uuid, 'ATH Org _athtest', 'ath-org-athtest');

INSERT INTO portfolios (id, name, organization_id, holdings_source) VALUES
  ('cccc0000-0000-0000-0000-00000000e001'::uuid, 'ATH Portfolio _athtest',
   'aaaa0000-0000-0000-0000-00000000e001'::uuid, 'paper');

INSERT INTO assets (id, symbol, company_name) VALUES
  ('dddd0000-0000-0000-0000-00000000e001'::uuid, 'AAPL_ATHTEST', 'Apple _athtest'),
  ('dddd0000-0000-0000-0000-00000000e002'::uuid, 'MSFT_ATHTEST', 'Microsoft _athtest'),
  ('dddd0000-0000-0000-0000-00000000e003'::uuid, 'NVDA_ATHTEST', 'Nvidia _athtest'),
  ('dddd0000-0000-0000-0000-0000000000c0'::uuid, 'CASH_USD', 'Cash _athtest')
ON CONFLICT (id) DO NOTHING;

-- Yesterday's complete snapshot: two positions plus cash.
INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date) VALUES
  ('cccc0000-0000-0000-0000-00000000e001'::uuid, 'dddd0000-0000-0000-0000-00000000e001'::uuid, 100, 10, 10, CURRENT_DATE - 1),
  ('cccc0000-0000-0000-0000-00000000e001'::uuid, 'dddd0000-0000-0000-0000-00000000e002'::uuid, 50, 20, 20, CURRENT_DATE - 1),
  ('cccc0000-0000-0000-0000-00000000e001'::uuid, 'dddd0000-0000-0000-0000-0000000000c0'::uuid, 1000, 1, 1, CURRENT_DATE - 1);

-- ---- [A] first trade of a new date rolls the whole snapshot forward ---------
-- Buy 10 AAPL at 12 (delta only). Before the fix this created a date holding
-- ONLY AAPL, with MSFT and cash stranded on yesterday.
DO $$
DECLARE r jsonb; n int; cash numeric; rolled boolean;
BEGIN
  r := apply_trade_to_holdings(
        'cccc0000-0000-0000-0000-00000000e001'::uuid,
        'dddd0000-0000-0000-0000-00000000e001'::uuid,
        NULL, 10, 12);
  rolled := (r->>'rolled_forward')::boolean;
  IF NOT rolled THEN RAISE EXCEPTION '[A] expected a carry-forward on a new date'; END IF;

  SELECT count(*) INTO n FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid AND date = CURRENT_DATE;
  IF n <> 3 THEN
    RAISE EXCEPTION '[A] today should hold all 3 positions, found %', n;
  END IF;

  -- [E] pure delta moved the CARRIED-FORWARD 100, not 0.
  IF (r->>'shares_before')::numeric <> 100 THEN
    RAISE EXCEPTION '[E] shares_before should be the carried-forward 100, got %', r->>'shares_before';
  END IF;
  IF (r->>'shares_after')::numeric <> 110 THEN
    RAISE EXCEPTION '[E] pure delta should give 110, got %', r->>'shares_after';
  END IF;

  -- [F] a buy debits cash: (110 - 100) x 12 = 120.
  SELECT shares INTO cash FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-0000000000c0'::uuid AND date = CURRENT_DATE;
  IF cash <> 880 THEN RAISE EXCEPTION '[F] cash should be 1000-120=880, got %', cash; END IF;
END $$;

-- MSFT must have come across untouched — the stranding bug in one assertion.
DO $$
DECLARE s numeric;
BEGIN
  SELECT shares INTO s FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-00000000e002'::uuid AND date = CURRENT_DATE;
  IF s IS NULL THEN RAISE EXCEPTION '[A] MSFT was stranded on the prior date'; END IF;
  IF s <> 50 THEN RAISE EXCEPTION '[A] MSFT should carry 50 shares, got %', s; END IF;
END $$;

-- ---- [B] a second trade the same date does not roll forward again -----------
DO $$
DECLARE r jsonb; n int; s numeric;
BEGIN
  r := apply_trade_to_holdings(
        'cccc0000-0000-0000-0000-00000000e001'::uuid,
        'dddd0000-0000-0000-0000-00000000e002'::uuid,
        NULL, 10, 20);
  IF (r->>'rolled_forward')::boolean THEN
    RAISE EXCEPTION '[B] rolled forward twice on the same date';
  END IF;
  IF (r->>'shares_before')::numeric <> 50 THEN
    RAISE EXCEPTION '[B] should read the populated date, got %', r->>'shares_before';
  END IF;

  -- [C] still one row per asset — no duplicated carry-forward.
  SELECT count(*) INTO n FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid AND date = CURRENT_DATE;
  IF n <> 3 THEN RAISE EXCEPTION '[C] expected 3 rows, found % (duplicate date)', n; END IF;

  -- AAPL was not re-applied by the second call.
  SELECT shares INTO s FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-00000000e001'::uuid AND date = CURRENT_DATE;
  IF s <> 110 THEN RAISE EXCEPTION '[B] AAPL applied more than once, got %', s; END IF;
END $$;

-- ---- [D] target_shares is absolute ------------------------------------------
DO $$
DECLARE r jsonb; s numeric; cash numeric;
BEGIN
  SELECT shares INTO cash FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-0000000000c0'::uuid AND date = CURRENT_DATE;

  -- Target 200 from 110, at 5. Delta is deliberately WRONG (999) to prove
  -- target wins: a target_shares trade carries no meaningful delta.
  r := apply_trade_to_holdings(
        'cccc0000-0000-0000-0000-00000000e001'::uuid,
        'dddd0000-0000-0000-0000-00000000e001'::uuid,
        200, 999, 5);
  SELECT shares INTO s FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-00000000e001'::uuid AND date = CURRENT_DATE;
  IF s <> 200 THEN RAISE EXCEPTION '[D] target_shares should set 200, got %', s; END IF;

  -- Cash moves by the REALISED delta (200-110)x5 = 450, not by 999.
  IF (r->>'cash_delta')::numeric <> 450 THEN
    RAISE EXCEPTION '[D] cash should follow the realised delta, got %', r->>'cash_delta';
  END IF;
END $$;

-- ---- [F] a sell credits cash ------------------------------------------------
DO $$
DECLARE r jsonb; cash_before numeric; cash_after numeric;
BEGIN
  SELECT shares INTO cash_before FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-0000000000c0'::uuid AND date = CURRENT_DATE;

  -- Sell 50 MSFT of 60, at 20 → cash + 1000.
  r := apply_trade_to_holdings(
        'cccc0000-0000-0000-0000-00000000e001'::uuid,
        'dddd0000-0000-0000-0000-00000000e002'::uuid,
        NULL, -50, 20);

  SELECT shares INTO cash_after FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-0000000000c0'::uuid AND date = CURRENT_DATE;
  IF cash_after - cash_before <> 1000 THEN
    RAISE EXCEPTION '[F] a sell should credit 1000, moved %', cash_after - cash_before;
  END IF;
END $$;

-- ---- [G] liquidation closes the row and credits the whole position ----------
DO $$
DECLARE r jsonb; n int; cash_before numeric; cash_after numeric;
BEGIN
  SELECT shares INTO cash_before FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-0000000000c0'::uuid AND date = CURRENT_DATE;

  -- MSFT is at 10. Target 0 at 20 → row gone, cash + 200.
  r := apply_trade_to_holdings(
        'cccc0000-0000-0000-0000-00000000e001'::uuid,
        'dddd0000-0000-0000-0000-00000000e002'::uuid,
        0, NULL, 20);

  SELECT count(*) INTO n FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-00000000e002'::uuid AND date = CURRENT_DATE;
  IF n <> 0 THEN RAISE EXCEPTION '[G] liquidated row should be gone, found %', n; END IF;

  SELECT shares INTO cash_after FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-0000000000c0'::uuid AND date = CURRENT_DATE;
  IF cash_after - cash_before <> 200 THEN
    RAISE EXCEPTION '[G] liquidation should credit 200, moved %', cash_after - cash_before;
  END IF;
END $$;

-- ---- [C] a new position on a populated date inserts, does not re-roll -------
DO $$
DECLARE r jsonb; n int;
BEGIN
  r := apply_trade_to_holdings(
        'cccc0000-0000-0000-0000-00000000e001'::uuid,
        'dddd0000-0000-0000-0000-00000000e003'::uuid,
        NULL, 25, 4);
  IF (r->>'shares_before')::numeric <> 0 THEN
    RAISE EXCEPTION '[C] a never-held asset starts at 0, got %', r->>'shares_before';
  END IF;
  IF (r->>'shares_after')::numeric <> 25 THEN
    RAISE EXCEPTION '[C] new position should be 25, got %', r->>'shares_after';
  END IF;
  SELECT count(*) INTO n FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-00000000e003'::uuid AND date = CURRENT_DATE;
  IF n <> 1 THEN RAISE EXCEPTION '[C] expected exactly one NVDA row, found %', n; END IF;
END $$;

-- ---- [H] a trade with no usable price is refused, not settled for free -----
-- The old client did `price_at_acceptance || 0`: a worthless position and a
-- cash leg that cost nothing.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM apply_trade_to_holdings(
      'cccc0000-0000-0000-0000-00000000e001'::uuid,
      'dddd0000-0000-0000-0000-00000000e001'::uuid,
      NULL, 5, NULL);
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '[H] a NULL price should have been refused'; END IF;

  ok := false;
  BEGIN
    PERFORM apply_trade_to_holdings(
      'cccc0000-0000-0000-0000-00000000e001'::uuid,
      'dddd0000-0000-0000-0000-00000000e001'::uuid,
      NULL, 5, 0);
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '[H] a zero price should have been refused'; END IF;
END $$;

-- A trade carrying neither target nor delta still returns cleanly: there is
-- nothing to apply, so there is no price to require.
DO $$
DECLARE r jsonb;
BEGIN
  r := apply_trade_to_holdings(
        'cccc0000-0000-0000-0000-00000000e001'::uuid,
        'dddd0000-0000-0000-0000-00000000e001'::uuid,
        NULL, NULL, NULL);
  IF (r->>'applied')::boolean THEN
    RAISE EXCEPTION '[H] a no-op trade should report applied=false';
  END IF;
END $$;

-- ---- [I] the day is UTC, not the session's -------------------------------
-- Asserted by behaviour: under a deliberately shifted session TimeZone the
-- function must still write to the UTC date.
DO $$
DECLARE r jsonb; n int;
BEGIN
  SET LOCAL TimeZone = 'Pacific/Kiritimati';   -- UTC+14
  r := apply_trade_to_holdings(
        'cccc0000-0000-0000-0000-00000000e001'::uuid,
        'dddd0000-0000-0000-0000-00000000e003'::uuid,
        NULL, 1, 4);
  SELECT count(*) INTO n FROM portfolio_holdings
   WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     AND asset_id = 'dddd0000-0000-0000-0000-00000000e003'::uuid
     AND date = (now() AT TIME ZONE 'UTC')::date;
  IF n <> 1 THEN
    RAISE EXCEPTION '[I] wrote to the session date, not the UTC date';
  END IF;
  RESET TimeZone;
END $$;

-- ---- Invariant sweep: no partial or duplicated dates ------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT asset_id, date FROM portfolio_holdings
     WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid
     GROUP BY asset_id, date HAVING count(*) > 1
  ) d;
  IF n <> 0 THEN RAISE EXCEPTION 'duplicate (asset, date) rows: %', n; END IF;
END $$;

-- ---- Cleanup ----------------------------------------------------------------
DELETE FROM portfolio_holdings WHERE portfolio_id = 'cccc0000-0000-0000-0000-00000000e001'::uuid;
DELETE FROM portfolios        WHERE id = 'cccc0000-0000-0000-0000-00000000e001'::uuid;
DELETE FROM assets            WHERE company_name LIKE '%_athtest';
DELETE FROM organizations     WHERE id = 'aaaa0000-0000-0000-0000-00000000e001'::uuid;
