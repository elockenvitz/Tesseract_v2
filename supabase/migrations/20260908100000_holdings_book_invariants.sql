-- ============================================================
-- Working-book transaction invariants
-- ============================================================
--
-- Three defects in the operations added by 20260907100100, each reproduced
-- against a real Postgres with two concurrent sessions before being fixed.
-- The contract is unchanged; this is about holding it under concurrency,
-- retry and a hostile caller.
--
-- ── 1. A LOST TRADE, when two trades open the same position ───────────────
--
-- apply_trade_to_book read the position with SELECT ... FOR UPDATE. When the
-- row EXISTS that is correct: the second transaction blocks, then re-reads
-- the committed value under READ COMMITTED, and the deltas compose. Measured:
-- two concurrent +100 deltas on a 1,000-share position gave 1,200.
--
-- When the row does NOT exist, FOR UPDATE locks nothing. Both transactions
-- read zero, both compute 0 + delta, and the second's ON CONFLICT DO UPDATE
-- overwrites with its own total. Measured: two concurrent +100 deltas opening
-- a position gave 100 shares, not 200. One trade vanished and BOTH reported
-- applied=true.
--
-- ── 2. A BOOK THAT NO UPLOAD DESCRIBED ────────────────────────────────────
--
-- Two concurrent complete reconciles merged. Each says "this is the entire
-- book"; each DELETE ran against its own snapshot and so could not see the
-- other's inserts. Measured: reconciling to {AAPL 111} and {MSFT 222} at the
-- same time left BOTH, which is a book neither upload stated.
--
-- The same snapshot gap let a trade opening a position mid-reconcile survive
-- a complete reconcile that omitted it. Measured: NVDA present after a
-- reconcile whose payload held only AAPL.
--
-- FIX for both: a transaction-scoped advisory lock keyed on the portfolio,
-- taken first by every book operation. Scoped as narrowly as the invariant
-- allows — per portfolio, not per table — so two portfolios never wait on
-- each other, and released automatically at COMMIT or ROLLBACK so a crashed
-- session cannot wedge a book. Ordinary row locks cannot express this,
-- because the race is about rows that do not exist yet.
--
-- ── 3. A DEFINER FUNCTION READING THE CALLER'S TABLE ──────────────────────
--
-- `SET search_path = public` does NOT exclude pg_temp. Postgres searches the
-- temporary schema FIRST for relations unless pg_temp is listed explicitly,
-- so a caller could shadow the book:
--
--   CREATE TEMP TABLE portfolio_holdings (...);
--   SELECT apply_trade_to_book(...);
--
-- Measured: the SECURITY DEFINER function resolved pg_temp.portfolio_holdings
-- and failed on the missing ON CONFLICT target — proving it had reached the
-- caller's table, not the real one. The real book was untouched. Had the temp
-- table carried a matching unique constraint the write would have landed
-- there while the function returned applied=true, and the trade would have
-- been marked executed against a book that never moved.
--
-- FIX: pg_temp listed LAST, so it can no longer shadow anything.
--
-- ── 4. RETRY ──────────────────────────────────────────────────────────────
--
-- apply_trade_to_book took no trade identity, so calling it twice for one
-- accepted trade applied the delta twice. Nothing in the schema said a trade
-- had already reached the book.
--
-- FIX using the identity and state that already exist, not a new workflow:
-- the accepted trade's id, and its own `execution_status`. The function locks
-- that row, refuses when it is already 'complete', and — this is the part
-- that makes the guard real — stamps it complete IN THE SAME TRANSACTION as
-- the book write. Previously the book moved in one transaction and the claim
-- that it had moved was written in another, so a caller that died between
-- them left a trade that would apply again on retry.
--
-- Passing no trade id keeps the old behaviour, which the reversal path and
-- ad-hoc callers rely on.
-- ============================================================

-- ============================================================
-- The lock namespace
-- ============================================================
--
-- An arbitrary but fixed constant identifying "the working book of one
-- portfolio" among all advisory-lock users in this database. The second key
-- is a hash of the portfolio id, so a collision between two portfolios costs
-- one of them a short wait and can never produce a wrong answer.
CREATE OR REPLACE FUNCTION lock_portfolio_book(p_portfolio_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pg_advisory_xact_lock(1_936_026_723, hashtext(p_portfolio_id::text));
$$;

COMMENT ON FUNCTION lock_portfolio_book(UUID) IS
  'Serialises book operations for one portfolio for the life of the calling '
  'transaction. Every writer takes this first, so lock order is identical '
  'everywhere and the operations cannot deadlock against each other.';

REVOKE ALL ON FUNCTION lock_portfolio_book(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_portfolio_book(UUID) TO authenticated, service_role;

-- ============================================================
-- can_write_portfolio_book — search_path only
-- ============================================================
CREATE OR REPLACE FUNCTION can_write_portfolio_book(p_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.role() = 'service_role'
    OR (
      portfolio_in_current_org(p_portfolio_id)
      AND (
        user_is_portfolio_member(p_portfolio_id)
        OR is_active_org_admin_of_current_org()
      )
    );
$$;

-- ============================================================
-- apply_trade_to_book
-- ============================================================
DROP FUNCTION IF EXISTS apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION apply_trade_to_book(
  p_portfolio_id      UUID,
  p_asset_id          UUID,
  p_target_shares     NUMERIC DEFAULT NULL,
  p_delta_shares      NUMERIC DEFAULT NULL,
  p_price             NUMERIC DEFAULT NULL,
  p_accepted_trade_id UUID DEFAULT NULL,
  p_actor_id          UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before      NUMERIC := 0;
  v_held        BOOLEAN := FALSE;
  v_price_prev  NUMERIC;
  v_cost_prev   NUMERIC;
  v_new         NUMERIC;
  v_price       NUMERIC := COALESCE(p_price, 0);
  v_action      TEXT;
  v_status      TEXT;
BEGIN
  IF p_portfolio_id IS NULL OR p_asset_id IS NULL THEN
    RAISE EXCEPTION 'apply_trade_to_book requires a portfolio and an asset'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  IF NOT can_write_portfolio_book(p_portfolio_id) THEN
    RAISE EXCEPTION 'Not authorized to write the book for portfolio %', p_portfolio_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- First, always, and before reading anything. Two trades opening the same
  -- position have no row to lock, so the mutual exclusion has to name the
  -- book rather than the row.
  PERFORM lock_portfolio_book(p_portfolio_id);

  -- Has this trade already reached the book?
  --
  -- FOR UPDATE rather than a plain read: two retries arriving together would
  -- otherwise both see 'not_started' and both apply. The portfolio lock above
  -- already serialises them, and this holds even if that ever changes.
  IF p_accepted_trade_id IS NOT NULL THEN
    SELECT execution_status INTO v_status
    FROM accepted_trades WHERE id = p_accepted_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No such accepted trade: %', p_accepted_trade_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_status = 'complete' THEN
      RETURN jsonb_build_object(
        'applied', FALSE,
        'reason', 'already_applied',
        'shares_before', NULL,
        'shares_after', NULL,
        'price_used', v_price,
        'action', 'none'
      );
    END IF;
  END IF;

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

  IF p_target_shares IS NOT NULL THEN
    v_new := p_target_shares;
  ELSIF p_delta_shares IS NOT NULL THEN
    v_new := v_before + p_delta_shares;
  ELSE
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

  UPDATE portfolios SET book_source = 'trade' WHERE id = p_portfolio_id;

  -- The book moved, so the trade may say so — in this transaction, not the
  -- caller's next one. This is what makes 'already_applied' above a real
  -- guarantee rather than a race: there is no window in which the book has
  -- moved and the trade still looks unapplied.
  IF p_accepted_trade_id IS NOT NULL THEN
    UPDATE accepted_trades
       SET execution_status = 'complete',
           execution_completed_at = now(),
           executed_by = COALESCE(p_actor_id, executed_by),
           reconciliation_status = 'matched',
           reconciled_at = now(),
           updated_at = now()
     WHERE id = p_accepted_trade_id;
  END IF;

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

COMMENT ON FUNCTION apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, UUID) IS
  'Apply one committed trade to the working book, transactionally and once. '
  'Given an accepted trade id it also stamps that trade complete in the same '
  'transaction, which is what makes a retry a no-op rather than a second '
  'application.';

-- ============================================================
-- reconcile_portfolio_book
-- ============================================================
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_upserted INT := 0;
  v_removed  INT := 0;
  v_incoming INT := 0;
  v_existing INT := 0;
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

  -- Before reading the incoming set OR the existing book. Two complete
  -- reconciles that overlap merge into a book neither of them described,
  -- because each one's DELETE runs against a snapshot taken before the
  -- other's inserts existed.
  PERFORM lock_portfolio_book(p_portfolio_id);

  SELECT count(*) INTO v_incoming
  FROM (
    SELECT DISTINCT ON ((e->>'asset_id')::uuid) (e->>'asset_id')::uuid AS asset_id
    FROM jsonb_array_elements(p_positions) e
    WHERE e->>'asset_id' IS NOT NULL
      AND COALESCE((e->>'shares')::numeric, 0) > 0
    ORDER BY (e->>'asset_id')::uuid
  ) s;

  SELECT count(*) INTO v_existing
  FROM portfolio_holdings WHERE portfolio_id = p_portfolio_id;

  IF v_incoming = 0 AND NOT p_allow_empty THEN
    RAISE EXCEPTION
      'Refusing to empty the book for portfolio % — pass p_allow_empty to do this deliberately',
      p_portfolio_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

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
  removed AS (
    DELETE FROM portfolio_holdings h
     WHERE h.portfolio_id = p_portfolio_id
       AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.asset_id = h.asset_id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM upserted), (SELECT count(*) FROM removed)
    INTO v_upserted, v_removed;

  UPDATE portfolios
     SET book_as_of = p_as_of,
         book_source = COALESCE(p_source, 'upload'),
         book_reconciled_at = now()
   WHERE id = p_portfolio_id;

  -- `removed` and `existing_before` are returned so a caller can SHOW what a
  -- reconcile did. A partial parse — 3 of 35 positions surviving a broken
  -- mapping — clears the empty guard and legitimately removes 32 positions,
  -- and no threshold this function could invent would tell that apart from a
  -- desk that genuinely sold 32 names. It is a number for a human, not a
  -- rule for a function.
  RETURN jsonb_build_object(
    'upserted', v_upserted,
    'removed', v_removed,
    'positions', v_incoming,
    'existing_before', v_existing,
    'as_of', p_as_of,
    'source', p_source
  );
END;
$$;

-- ============================================================
-- Stage 1 leftover: the same search_path hazard
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_holdings_snapshot_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM portfolios
  WHERE id = NEW.portfolio_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'portfolio % has no organization', NEW.portfolio_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.organization_id := v_org_id;
  RETURN NEW;
END;
$$;

-- ============================================================
-- Execution rights
-- ============================================================
--
-- Re-stated because DROP FUNCTION discarded the grants on the old
-- apply_trade_to_book signature. anon stays absent: it holds table-level DML
-- on portfolio_holdings for historical reasons and these functions must not
-- become the way around the policies that stop it using them.
REVOKE ALL ON FUNCTION can_write_portfolio_book(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_portfolio_book(UUID, JSONB, DATE, TEXT, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION can_write_portfolio_book(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reconcile_portfolio_book(UUID, JSONB, DATE, TEXT, BOOLEAN) TO authenticated, service_role;
