-- Applying a committed trade to portfolio_holdings, atomically.
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- portfolio_holdings is a series of dated snapshots. The client applied a
-- trade by looking for a row at (portfolio, asset, CURRENT_DATE) and inserting
-- one if it was absent — which, on the first trade of any day, it always is.
-- So the first execute of a new date wrote a snapshot containing ONE position
-- and never carried the other holdings forward.
--
-- Everything downstream then behaved correctly on corrupt input.
-- latestSnapshotRows() picks the newest date, so "current holdings" became
-- that single row; Trade Lab re-snapshots its baseline from it, so the traded
-- name showed at 100% and every other position appeared as NEW at 0%.
-- Observed in production 2026-09-13 on portfolio 9d1d88db: a one-row date
-- holding only AAPL, and a simulation baseline of exactly that.
--
-- Two further defects in the same function:
--   * `shares_before` read 0 on a new date, so a trade carrying only
--     delta_shares wrote the DELTA as the whole position. Trades carrying
--     target_shares survived by luck.
--   * Cash was never adjusted, so the book did not balance after a trade.
--
-- ── Why this has to be an RPC ──────────────────────────────────────────────
--
-- executeSimVariants commits a batch with Promise.all — every variant runs
-- concurrently. A carry-forward done client-side is a read-then-write with no
-- lock: N branches all observe "no rows at today" and all try to clone the
-- prior date.
--
-- Production does have UNIQUE (portfolio_id, asset_id, date)
-- (portfolio_holdings_portfolio_asset_date_key), so those racing clones
-- cannot produce duplicate rows — the losers fail with a unique violation
-- instead. That stops duplicates; it does not make the operation atomic. A
-- loser's trade is lost or errors out, and a client that carries forward and
-- then applies in separate statements can still leave a date half-built
-- between them. Uniqueness constrains the result, not the sequence.
--
-- A transaction-scoped advisory lock keyed on the portfolio serialises the
-- applies for that portfolio and nothing else. The first caller completes the
-- whole carry-forward and its trade before any other caller evaluates the
-- guard, so a date is never partially populated and each trade applies
-- exactly once.
--
-- ── RLS posture ────────────────────────────────────────────────────────────
--
-- SECURITY INVOKER, deliberately. Every statement runs under the caller's own
-- policies on portfolio_holdings and assets, exactly as the client statements
-- it replaces did. No policy is widened, none is added, and a caller who could
-- not write these rows before still cannot. The function only removes a race;
-- it grants nothing.

CREATE OR REPLACE FUNCTION public.apply_trade_to_holdings(
  p_portfolio_id  uuid,
  p_asset_id      uuid,
  p_target_shares numeric,
  p_delta_shares  numeric,
  p_price         numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  /*
   * UTC, explicitly.
   *
   * CURRENT_DATE is the session's date, and a PostgREST connection's TimeZone
   * is whatever the role or the server was configured with. The client this
   * replaces computed its day with toISOString(), which is UTC, and the audit
   * that found the damaged rows read them as UTC dates. Three different
   * notions of "today" over one dated table is how a trade lands on a day
   * nothing else agrees with — and near midnight it would silently start a
   * second partial snapshot for a day that already had one.
   */
  v_today       date := (now() AT TIME ZONE 'UTC')::date;
  v_last        date;
  v_before      numeric := 0;
  v_new         numeric;
  v_after       numeric;
  v_cash_delta  numeric;
  v_cash_id     uuid;
  v_rolled      boolean := false;
BEGIN
  IF p_portfolio_id IS NULL OR p_asset_id IS NULL THEN
    RAISE EXCEPTION 'apply_trade_to_holdings: portfolio and asset are required';
  END IF;

  -- No share information means nothing to apply. Mirrors the client guard.
  IF p_target_shares IS NULL AND p_delta_shares IS NULL THEN
    RETURN jsonb_build_object(
      'shares_before', 0, 'shares_after', 0,
      'price_used', COALESCE(p_price, 0), 'applied', false,
      'rolled_forward', false, 'cash_delta', 0
    );
  END IF;

  -- Serialise concurrent applies for THIS portfolio. Transaction-scoped, so
  -- it releases on commit or abort. One key, so there is no deadlock path.
  /*
   * A trade that moves a position has to have a price.
   *
   * Both writes below depend on it: the holdings row stores it, so a zero
   * price makes the position worth nothing and every weight derived from it
   * wrong; and cash moves by movement x price, so a NULL coalesced to 0
   * settles the trade for free. The old client did exactly that —
   * `trade.price_at_acceptance || 0` — and a missing price silently produced
   * a position nobody paid for. Refused here instead, because a trade whose
   * price we do not know is a trade we cannot apply correctly, and failing
   * loudly is recoverable in a way that a silently free position is not.
   */
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION
      'apply_trade_to_holdings: price is required and must be positive (got %) '
      'for portfolio % asset %', p_price, p_portfolio_id, p_asset_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_portfolio_id::text));

  -- ── Roll the date forward, completely, or not at all ────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM portfolio_holdings
     WHERE portfolio_id = p_portfolio_id AND date = v_today
  ) THEN
    SELECT max(date) INTO v_last
      FROM portfolio_holdings
     WHERE portfolio_id = p_portfolio_id AND date < v_today;

    IF v_last IS NOT NULL THEN
      -- Every position, cash included — cash is an ordinary holdings row.
      INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
      SELECT portfolio_id, asset_id, shares, price, cost, v_today
        FROM portfolio_holdings
       WHERE portfolio_id = p_portfolio_id AND date = v_last;
      v_rolled := true;
    END IF;
  END IF;

  -- ── Apply this trade exactly once ───────────────────────────────────────
  SELECT shares INTO v_before
    FROM portfolio_holdings
   WHERE portfolio_id = p_portfolio_id AND asset_id = p_asset_id AND date = v_today;
  v_before := COALESCE(v_before, 0);

  -- target_shares is absolute; delta_shares is relative to the carried-forward
  -- position, which is why the rollover has to happen first.
  v_new := COALESCE(p_target_shares, v_before + COALESCE(p_delta_shares, 0));
  v_after := GREATEST(v_new, 0);

  IF v_new <= 0 THEN
    DELETE FROM portfolio_holdings
     WHERE portfolio_id = p_portfolio_id AND asset_id = p_asset_id AND date = v_today;
  ELSIF EXISTS (
    SELECT 1 FROM portfolio_holdings
     WHERE portfolio_id = p_portfolio_id AND asset_id = p_asset_id AND date = v_today
  ) THEN
    UPDATE portfolio_holdings
       SET shares = v_new, price = p_price, updated_at = now()
     WHERE portfolio_id = p_portfolio_id AND asset_id = p_asset_id AND date = v_today;
  ELSE
    INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
    VALUES (p_portfolio_id, p_asset_id, v_new, p_price, p_price, v_today);
  END IF;

  -- ── Cash, from the position delta that actually happened ────────────────
  --
  -- Not from delta_shares: a target_shares trade carries no delta, and a
  -- liquidation's delta is whatever the client guessed. (after - before) is
  -- the movement the book just recorded, so it is the movement cash pays for.
  -- Buys make it positive and debit cash; sells make it negative and credit.
  -- p_price is guaranteed non-null and positive by the guard above.
  v_cash_delta := (v_after - v_before) * p_price;

  IF v_cash_delta <> 0 THEN
    SELECT ph.asset_id INTO v_cash_id
      FROM portfolio_holdings ph
      JOIN assets a ON a.id = ph.asset_id
     WHERE ph.portfolio_id = p_portfolio_id
       AND ph.date = v_today
       AND a.symbol = 'CASH_USD'
     LIMIT 1;

    -- Cash is held as shares at price 1, so the notional moves shares.
    -- A portfolio with no cash row is left alone rather than having one
    -- invented for it: inventing cash would be asserting a balance nobody
    -- recorded.
    IF v_cash_id IS NOT NULL THEN
      UPDATE portfolio_holdings
         SET shares = shares - v_cash_delta, updated_at = now()
       WHERE portfolio_id = p_portfolio_id AND asset_id = v_cash_id AND date = v_today;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'shares_before',  v_before,
    'shares_after',   v_after,
    'price_used',     p_price,
    'applied',        true,
    'rolled_forward', v_rolled,
    'cash_delta',     v_cash_delta
  );
END;
$$;

COMMENT ON FUNCTION public.apply_trade_to_holdings(uuid, uuid, numeric, numeric, numeric) IS
  'Applies one committed trade to portfolio_holdings at CURRENT_DATE, rolling '
  'the complete prior snapshot forward first and adjusting CASH_USD by the '
  'realised position delta. Serialised per portfolio by a transaction advisory '
  'lock so a concurrent batch cannot produce a partial or duplicated date. '
  'SECURITY INVOKER — runs under the caller''s RLS.';

-- Callable by signed-in users only; RLS still decides what they may touch.
-- Revoking from PUBLIC is not enough on Supabase: default privileges grant
-- EXECUTE on new public functions to anon explicitly, and that grant survives
-- a PUBLIC revoke. Observed on production when this was first applied.
REVOKE ALL ON FUNCTION public.apply_trade_to_holdings(uuid, uuid, numeric, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_trade_to_holdings(uuid, uuid, numeric, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_trade_to_holdings(uuid, uuid, numeric, numeric, numeric) TO authenticated;
