-- ============================================================
-- The only two ways the working book may change
-- ============================================================
--
-- ── Why these are server-side, and why they are functions ─────────────────
--
-- A complete reconcile is "upsert what is present, remove what is absent,
-- stamp the book" — three statements that are one operation. Issued from a
-- browser they are three round trips with no transaction around them, so an
-- interruption between the second and third leaves a book that is neither
-- the old one nor the new one. There is also no client-side way to make the
-- delete and the upsert see the same snapshot of the table.
--
-- The second reason is authority. Stage 1 established that a holdings write
-- must prove organization ownership THROUGH the portfolio. Doing that in a
-- policy means every writer re-derives it; doing it here means there is one
-- gate and the RLS policies become a backstop rather than the mechanism.
--
-- ── The authorization model, unchanged ────────────────────────────────────
--
-- These do NOT invent a role. They require exactly what accepted_trades
-- already requires to insert the trade that causes the write:
--
--   user_is_portfolio_member(portfolio_id)
--   OR (portfolio_in_current_org(portfolio_id) AND is_active_org_admin_of_current_org())
--
-- ANDed with portfolio_in_current_org() on every branch, which accepted_trades
-- omits on its member branch. So this is the existing model, marginally
-- tighter, and it cannot be reached by anyone who could not already commit
-- the trade.
--
-- SECURITY DEFINER bypasses RLS, so the check below is not a convenience —
-- it IS the boundary. It raises 42501 rather than returning quietly, because
-- a refused write that looks like a completed one is the defect this whole
-- lane exists to remove.
--
-- ── The two Stage 2 defects these close ───────────────────────────────────
--
-- 1. STALE-DATE DELTA AND EXIT. The old writer looked up the position with
--    `.eq('date', today)`. A position last written yesterday therefore read
--    as zero shares, so a +100 delta turned a 1,000-share position into a
--    100-share one, and a full exit deleted nothing at all while the trade
--    was still marked complete and matched. There is no date in the lookup
--    here, and there cannot be: the unique key is (portfolio_id, asset_id).
--
-- 2. A TRADE WITH NO SIZE. 4 production trades carry neither target_shares
--    nor delta_shares. The old path returned `applied: false` and the caller
--    marked the trade complete and matched anyway — a claim that the book
--    reflects a trade nobody could size. These return applied=false with a
--    reason, and the caller now leaves such a trade unexecuted.
-- ============================================================

-- ============================================================
-- Shared authorization gate
-- ============================================================
CREATE OR REPLACE FUNCTION can_write_portfolio_book(p_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Trusted server-side callers: the holdings API and the SFTP sync run
    -- as service_role, which has no JWT subject and therefore no membership.
    -- They authenticate by API key against the organization before they get
    -- here; see supabase/functions/holdings-api.
    auth.role() = 'service_role'
    OR (
      portfolio_in_current_org(p_portfolio_id)
      AND (
        user_is_portfolio_member(p_portfolio_id)
        OR is_active_org_admin_of_current_org()
      )
    );
$$;

COMMENT ON FUNCTION can_write_portfolio_book(UUID) IS
  'The one gate on the working book. Mirrors the accepted_trades write '
  'policy, ANDed with organization ownership derived through the portfolio.';

-- ============================================================
-- apply_trade_to_book — one asset, one transaction
-- ============================================================
CREATE OR REPLACE FUNCTION apply_trade_to_book(
  p_portfolio_id  UUID,
  p_asset_id      UUID,
  p_target_shares NUMERIC DEFAULT NULL,
  p_delta_shares  NUMERIC DEFAULT NULL,
  p_price         NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before      NUMERIC := 0;
  v_held        BOOLEAN := FALSE;
  v_price_prev  NUMERIC;
  v_cost_prev   NUMERIC;
  v_new         NUMERIC;
  v_price       NUMERIC := COALESCE(p_price, 0);
  v_action      TEXT;
BEGIN
  IF p_portfolio_id IS NULL OR p_asset_id IS NULL THEN
    RAISE EXCEPTION 'apply_trade_to_book requires a portfolio and an asset'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  IF NOT can_write_portfolio_book(p_portfolio_id) THEN
    RAISE EXCEPTION 'Not authorized to write the book for portfolio %', p_portfolio_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The current position. No date predicate: there is one row or there is
  -- none, and FOR UPDATE holds it for the rest of this statement so two
  -- trades on the same name in the same moment compose instead of racing.
  SELECT h.shares, h.price, h.cost, TRUE
    INTO v_before, v_price_prev, v_cost_prev, v_held
  FROM portfolio_holdings h
  WHERE h.portfolio_id = p_portfolio_id
    AND h.asset_id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_before := 0;
    v_held := FALSE;
  END IF;

  -- Absolute target wins over a delta when both are present, which is what
  -- the Lab promotion path sets and what the previous writer also preferred.
  IF p_target_shares IS NOT NULL THEN
    v_new := p_target_shares;
  ELSIF p_delta_shares IS NOT NULL THEN
    v_new := v_before + p_delta_shares;
  ELSE
    -- Stage 2 defect 2. Nothing to apply, and saying so is the point.
    RETURN jsonb_build_object(
      'applied', FALSE,
      'reason', 'no_size',
      'shares_before', v_before,
      'shares_after', v_before,
      'price_used', v_price,
      'action', 'none'
    );
  END IF;

  IF v_new <= 0 THEN
    -- Full exit. Absence is how this model says "not held", so the row goes.
    -- Note this no longer depends on a row existing at today's date, which
    -- is what made an exit a silent no-op.
    IF v_held THEN
      DELETE FROM portfolio_holdings
       WHERE portfolio_id = p_portfolio_id AND asset_id = p_asset_id;
      v_action := 'exit';
    ELSE
      v_action := 'exit_noop';
    END IF;
    v_new := 0;
  ELSE
    INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
    VALUES (
      p_portfolio_id, p_asset_id, v_new,
      CASE WHEN v_price > 0 THEN v_price ELSE COALESCE(v_price_prev, 0) END,
      -- Cost basis is carried, not overwritten with the trade price. An add
      -- does not reset what the position cost; only a reconcile from the
      -- custodian restates it.
      COALESCE(v_cost_prev, CASE WHEN v_price > 0 THEN v_price ELSE 0 END),
      CURRENT_DATE
    )
    ON CONFLICT (portfolio_id, asset_id) DO UPDATE
      SET shares = EXCLUDED.shares,
          price = CASE WHEN v_price > 0 THEN v_price ELSE portfolio_holdings.price END,
          date = CURRENT_DATE,
          updated_at = now();
    v_action := CASE WHEN v_held THEN 'resize' ELSE 'initiate' END;
  END IF;

  -- The book has moved since its last complete reconcile. `book_as_of` is
  -- deliberately NOT advanced: a trade changes one line, and claiming the
  -- whole book is current as of today would be the same lie the per-row date
  -- was telling. Only a complete reconcile may set that.
  UPDATE portfolios SET book_source = 'trade' WHERE id = p_portfolio_id;

  RETURN jsonb_build_object(
    'applied', TRUE,
    'reason', NULL,
    'shares_before', v_before,
    'shares_after', v_new,
    'price_used', v_price,
    'action', v_action
  );
END;
$$;

COMMENT ON FUNCTION apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC) IS
  'Apply one committed trade to the working book, transactionally. Returns '
  'applied=false with a reason rather than pretending, so the caller can '
  'refuse to mark the trade executed.';

-- ============================================================
-- reconcile_portfolio_book — the whole book, one transaction
-- ============================================================
--
-- This is the operation that did not exist. Onboarding upserted what was
-- present and left everything else alone; the upload hook, the holdings API
-- and the SFTP sync wrote the snapshot tables and never touched the working
-- book at all. So a position that left the book stayed in it, and a book
-- could receive months of clean uploads while every Desktop surface rendered
-- it as it stood at onboarding.
--
-- p_positions is [{asset_id, shares, price, cost}]. Symbol resolution stays
-- with the caller, which already does it against `assets`; a position whose
-- symbol did not resolve has no asset_id and cannot be part of a book keyed
-- on assets.
CREATE OR REPLACE FUNCTION reconcile_portfolio_book(
  p_portfolio_id UUID,
  p_positions    JSONB,
  p_as_of        DATE DEFAULT CURRENT_DATE,
  p_source       TEXT DEFAULT 'upload',
  p_allow_empty  BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_upserted INT := 0;
  v_removed  INT := 0;
  v_incoming INT := 0;
BEGIN
  IF p_portfolio_id IS NULL THEN
    RAISE EXCEPTION 'reconcile_portfolio_book requires a portfolio'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  IF NOT can_write_portfolio_book(p_portfolio_id) THEN
    RAISE EXCEPTION 'Not authorized to write the book for portfolio %', p_portfolio_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_positions IS NULL OR jsonb_typeof(p_positions) <> 'array' THEN
    RAISE EXCEPTION 'reconcile_portfolio_book expects a JSON array of positions'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_source IS NOT NULL AND p_source NOT IN
     ('onboarding', 'upload', 'api_sync', 'sftp_sync', 'reconciliation') THEN
    RAISE EXCEPTION 'Unknown book source: %', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Count first, so the empty-book guard runs before anything is written.
  --
  -- A zero-share line in a custodian file means the position was closed. It
  -- is not a holding, and the CHECK on the table would reject it anyway.
  SELECT count(*) INTO v_incoming
  FROM (
    SELECT DISTINCT ON ((e->>'asset_id')::uuid) (e->>'asset_id')::uuid AS asset_id
    FROM jsonb_array_elements(p_positions) e
    WHERE e->>'asset_id' IS NOT NULL
      AND COALESCE((e->>'shares')::numeric, 0) > 0
    ORDER BY (e->>'asset_id')::uuid
  ) s;

  -- Refusing to empty a book by accident. An upload that parsed to nothing,
  -- or resolved no symbols at all, would otherwise silently delete every
  -- position a desk holds. Emptying a book is a real operation, so it stays
  -- available — it just has to be asked for.
  IF v_incoming = 0 AND NOT p_allow_empty THEN
    RAISE EXCEPTION
      'Refusing to empty the book for portfolio % — pass p_allow_empty to do this deliberately',
      p_portfolio_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Upsert-present and remove-absent as ONE statement.
  --
  -- Not a temp table, for two reasons. A temp table declared ON COMMIT DROP
  -- outlives the function call, so reconciling two portfolios in the same
  -- transaction failed on "relation _incoming already exists" — and an
  -- upload loop does exactly that. And an unqualified temp name inside a
  -- SECURITY DEFINER function is resolved through pg_temp, which the caller
  -- controls; a CTE cannot be shadowed.
  --
  -- Every branch below reads the same snapshot, which is what makes the
  -- delete safe: a row the insert is about to add is in `incoming`, so the
  -- delete's NOT EXISTS already excludes it.
  --
  -- DISTINCT ON gives one position per asset, newest wins, so a file that
  -- lists a name twice does not raise "cannot affect row a second time".
  WITH incoming AS (
    SELECT DISTINCT ON ((e->>'asset_id')::uuid)
           (e->>'asset_id')::uuid AS asset_id,
           COALESCE((e->>'shares')::numeric, 0) AS shares,
           COALESCE((e->>'price')::numeric, 0) AS price,
           COALESCE((e->>'cost')::numeric, (e->>'price')::numeric, 0) AS cost
    FROM jsonb_array_elements(p_positions) e
    WHERE e->>'asset_id' IS NOT NULL
      AND COALESCE((e->>'shares')::numeric, 0) > 0
    ORDER BY (e->>'asset_id')::uuid
  ),
  -- 1. Everything the incoming book holds.
  upserted AS (
    INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)
    SELECT p_portfolio_id, i.asset_id, i.shares, i.price, i.cost, p_as_of
    FROM incoming i
    ON CONFLICT (portfolio_id, asset_id) DO UPDATE
      SET shares = EXCLUDED.shares,
          price = EXCLUDED.price,
          cost = EXCLUDED.cost,
          date = EXCLUDED.date,
          updated_at = now()
    RETURNING 1
  ),
  -- 2. Everything it does not. This is the half no writer ever did, and it
  --    is what makes a complete upload actually define the book.
  removed AS (
    DELETE FROM portfolio_holdings h
     WHERE h.portfolio_id = p_portfolio_id
       AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.asset_id = h.asset_id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM upserted), (SELECT count(*) FROM removed)
    INTO v_upserted, v_removed;

  -- 3. The book is now true as a whole, so it may say so.
  UPDATE portfolios
     SET book_as_of = p_as_of,
         book_source = COALESCE(p_source, 'upload'),
         book_reconciled_at = now()
   WHERE id = p_portfolio_id;

  RETURN jsonb_build_object(
    'upserted', v_upserted,
    'removed', v_removed,
    'positions', v_incoming,
    'as_of', p_as_of,
    'source', p_source
  );
END;
$$;

COMMENT ON FUNCTION reconcile_portfolio_book(UUID, JSONB, DATE, TEXT, BOOLEAN) IS
  'Replace the working book with a complete set of positions, transactionally: '
  'upsert present, remove absent, stamp book_as_of. The operation every '
  'ingestion path was missing.';

-- ============================================================
-- Execution rights
-- ============================================================
REVOKE ALL ON FUNCTION can_write_portfolio_book(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_portfolio_book(UUID, JSONB, DATE, TEXT, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION can_write_portfolio_book(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reconcile_portfolio_book(UUID, JSONB, DATE, TEXT, BOOLEAN) TO authenticated, service_role;

-- anon is deliberately absent. It holds table-level DML grants on
-- portfolio_holdings for historical reasons, and these functions must not
-- become a way around the policies that stop it using them.
