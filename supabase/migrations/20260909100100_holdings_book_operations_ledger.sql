-- ============================================================
-- The book operations write history as well as state
-- ============================================================
--
-- Both operations keep every guarantee the invariants stage established — the
-- per-portfolio advisory lock, the trade-id idempotency guard, the
-- authorization gate, pg_temp pinned last — and now also record WHAT changed
-- and, for a complete reconcile, WHAT THE BOOK THEN WAS.
--
-- Ordering inside a reconcile, which is not arbitrary:
--
--   1. lock the book
--   2. read the before-state, because after step 3 it is gone
--   3. apply the incoming book to the working book
--   4. write the complete snapshot, which materialises the AFTER state
--   5. write one ledger event per changed position, pointing at that snapshot
--
-- The snapshot is written before the events because an event's replay
-- identity is `reconcile:<snapshot_id>:<asset_id>` — the snapshot is what
-- makes a re-sent custodian file distinguishable from the original.
--
-- A trade does NOT write a snapshot. Snapshots are complete books; a trade
-- changes one line. The end-of-day close is what guarantees a book per
-- portfolio per business day — see 20260909100200.
-- ============================================================

-- ============================================================
-- snapshot_portfolio_book — materialise the working book as history
-- ============================================================
--
-- The one place a snapshot is created. Both the reconcile path and the daily
-- close call it, so "what a snapshot contains" is defined once.
--
-- Idempotent per (portfolio, date): if the current snapshot for that date
-- already matches the working book, it is returned unchanged rather than
-- restated. That is what lets the daily close run more than once, or run
-- after a reconcile has already recorded the same book, without manufacturing
-- revisions nobody asked for.
-- ── Why this is split in two ──────────────────────────────────────────────
--
-- The nightly close runs from pg_cron, which is a database session with no
-- JWT. can_write_portfolio_book() correctly refuses it: there is no current
-- organization and no portfolio membership to check, and loosening the gate
-- to admit "no caller" would loosen it for every other user of the gate too.
--
-- So the work lives in an internal function with NO grants at all — callable
-- only by the SECURITY DEFINER functions owned by postgres — and each entry
-- point does its own authorization before calling it. The per-portfolio gate
-- below; the job gate in close_portfolio_books.
CREATE OR REPLACE FUNCTION snapshot_portfolio_book_unchecked(
  p_portfolio_id UUID,
  p_as_of        DATE,
  p_source       TEXT,
  p_actor_id     UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id   UUID;
  v_revision      INT := 1;
  v_snapshot_id   UUID;
  v_total         NUMERIC;
  v_count         INT;
  v_differs       BOOLEAN;
  v_org_id        UUID;
BEGIN
  PERFORM lock_portfolio_book(p_portfolio_id);

  SELECT organization_id INTO v_org_id FROM portfolios WHERE id = p_portfolio_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'portfolio % has no organization', p_portfolio_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT id, revision INTO v_existing_id, v_revision
  FROM portfolio_holdings_snapshots
  WHERE portfolio_id = p_portfolio_id
    AND snapshot_date = p_as_of
    AND superseded_at IS NULL;

  IF v_existing_id IS NOT NULL THEN
    -- Does the recorded book still describe the working book? Compared as a
    -- symmetric difference on (asset, shares, price) rather than on totals: a
    -- buy and a sell of equal value would leave a total unchanged while the
    -- book underneath is different.
    SELECT EXISTS (
      SELECT h.asset_id, h.shares, h.price FROM portfolio_holdings h
       WHERE h.portfolio_id = p_portfolio_id
      EXCEPT
      SELECT p.asset_id, p.shares, p.price FROM portfolio_holdings_positions p
       WHERE p.snapshot_id = v_existing_id
      UNION ALL
      SELECT p.asset_id, p.shares, p.price FROM portfolio_holdings_positions p
       WHERE p.snapshot_id = v_existing_id
      EXCEPT
      SELECT h.asset_id, h.shares, h.price FROM portfolio_holdings h
       WHERE h.portfolio_id = p_portfolio_id
    ) INTO v_differs;

    IF NOT v_differs THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  SELECT COALESCE(SUM(h.shares * h.price), 0), count(*)
    INTO v_total, v_count
  FROM portfolio_holdings h
  WHERE h.portfolio_id = p_portfolio_id;

  -- Supersede BEFORE inserting, in two steps.
  --
  -- `idx_holdings_snapshots_current_day` is a partial unique index on
  -- (portfolio_id, snapshot_date) WHERE superseded_at IS NULL, and a unique
  -- index is checked per statement rather than at commit. Inserting the
  -- replacement first would put two non-superseded snapshots on one date for
  -- the duration of one statement, which is long enough to fail. So the old
  -- row is retired first and back-filled with the pointer once the
  -- replacement has an id.
  IF v_existing_id IS NOT NULL THEN
    UPDATE portfolio_holdings_snapshots
       SET superseded_at = now()
     WHERE id = v_existing_id;
  END IF;

  INSERT INTO portfolio_holdings_snapshots (
    portfolio_id, organization_id, snapshot_date, source,
    total_market_value, total_positions, uploaded_by, revision, base_currency
  ) VALUES (
    p_portfolio_id, v_org_id, p_as_of, p_source,
    v_total, v_count, p_actor_id,
    -- The first book recorded for a date is revision 1. `v_revision` is left
    -- unset when the SELECT above found nothing, so it cannot be added to.
    CASE WHEN v_existing_id IS NULL THEN 1 ELSE v_revision + 1 END,
    'USD'
  )
  RETURNING id INTO v_snapshot_id;

  INSERT INTO portfolio_holdings_positions (
    snapshot_id, portfolio_id, organization_id, asset_id, symbol,
    shares, price, market_value, cost_basis, weight_pct,
    currency, base_currency, fx_rate_to_base
  )
  SELECT
    v_snapshot_id, p_portfolio_id, v_org_id, h.asset_id,
    COALESCE(a.symbol, ''),
    h.shares, h.price, h.shares * h.price, h.cost * h.shares,
    CASE WHEN v_total > 0 THEN (h.shares * h.price) / v_total * 100 ELSE NULL END,
    COALESCE(a.currency, 'USD'), 'USD',
    -- 1 where the position is already in base. NULL rather than a guess
    -- otherwise: this product books only in USD today, and inventing a rate
    -- would make an unreproducible number look reproducible.
    CASE WHEN COALESCE(a.currency, 'USD') = 'USD' THEN 1 ELSE NULL END
  FROM portfolio_holdings h
  LEFT JOIN assets a ON a.id = h.asset_id
  WHERE h.portfolio_id = p_portfolio_id;

  -- The second half of the supersede: now that the replacement has an id, the
  -- retired row can point at it.
  IF v_existing_id IS NOT NULL THEN
    UPDATE portfolio_holdings_snapshots
       SET superseded_by_id = v_snapshot_id
     WHERE id = v_existing_id;
  END IF;

  RETURN v_snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION snapshot_portfolio_book(
  p_portfolio_id UUID,
  p_as_of        DATE DEFAULT CURRENT_DATE,
  p_source       TEXT DEFAULT 'eod_close',
  p_actor_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT can_write_portfolio_book(p_portfolio_id) THEN
    RAISE EXCEPTION 'Not authorized to snapshot portfolio %', p_portfolio_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN snapshot_portfolio_book_unchecked(p_portfolio_id, p_as_of, p_source, p_actor_id);
END;
$$;

COMMENT ON FUNCTION snapshot_portfolio_book(UUID, DATE, TEXT, UUID) IS
  'Materialise the current working book as an immutable complete snapshot for '
  'a date. Idempotent: returns the existing snapshot unchanged when it still '
  'describes the book, and supersedes it with a new revision when it does not.';

-- ============================================================
-- apply_trade_to_book — now also a ledger entry
-- ============================================================
DROP FUNCTION IF EXISTS apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, UUID);

CREATE OR REPLACE FUNCTION apply_trade_to_book(
  p_portfolio_id      UUID,
  p_asset_id          UUID,
  p_target_shares     NUMERIC DEFAULT NULL,
  p_delta_shares      NUMERIC DEFAULT NULL,
  p_price             NUMERIC DEFAULT NULL,
  p_accepted_trade_id UUID DEFAULT NULL,
  p_actor_id          UUID DEFAULT NULL,
  p_batch_id          UUID DEFAULT NULL
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
  v_event_id    UUID;
BEGIN
  IF p_portfolio_id IS NULL OR p_asset_id IS NULL THEN
    RAISE EXCEPTION 'apply_trade_to_book requires a portfolio and an asset'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  IF NOT can_write_portfolio_book(p_portfolio_id) THEN
    RAISE EXCEPTION 'Not authorized to write the book for portfolio %', p_portfolio_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM lock_portfolio_book(p_portfolio_id);

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
        'applied', FALSE, 'reason', 'already_applied',
        'shares_before', NULL, 'shares_after', NULL,
        'price_used', v_price, 'action', 'none', 'event_id', NULL
      );
    END IF;
  END IF;

  SELECT h.shares, h.price, h.cost, TRUE
    INTO v_before, v_price_prev, v_cost_prev, v_held
  FROM portfolio_holdings h
  WHERE h.portfolio_id = p_portfolio_id AND h.asset_id = p_asset_id
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
      'applied', FALSE, 'reason', 'no_size',
      'shares_before', v_before, 'shares_after', v_before,
      'price_used', v_price, 'action', 'none', 'event_id', NULL
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

  -- The ledger entry, in the same transaction as the change it records.
  --
  -- `exit_noop` writes nothing: the book did not move, so there is no event.
  -- A ledger row for a change that did not happen is worse than no row,
  -- because a reader summing deltas would find one that never occurred.
  IF v_action <> 'exit_noop' THEN
    INSERT INTO portfolio_holdings_events (
      organization_id, portfolio_id, asset_id, event_type, source,
      shares_before, shares_delta, shares_after, price,
      effective_at, accepted_trade_id, batch_id, actor_id, idempotency_key
    ) VALUES (
      -- Overwritten by trg_enforce_holdings_event_org_id; a placeholder is
      -- needed only because the column is NOT NULL.
      '00000000-0000-0000-0000-000000000000',
      p_portfolio_id, p_asset_id, 'trade', 'trade',
      v_before, v_new - v_before, v_new,
      NULLIF(v_price, 0),
      CURRENT_DATE, p_accepted_trade_id, p_batch_id, p_actor_id,
      -- A keyed trade replays to the same identity, which the unique
      -- constraint refuses. An unkeyed call — the reversal path, an ad-hoc
      -- correction — gets a fresh identity, because there is nothing to
      -- replay against and refusing it would break reversal.
      CASE
        WHEN p_accepted_trade_id IS NOT NULL THEN 'trade:' || p_accepted_trade_id::text
        ELSE 'adhoc:' || gen_random_uuid()::text
      END
    )
    RETURNING id INTO v_event_id;
  END IF;

  UPDATE portfolios SET book_source = 'trade' WHERE id = p_portfolio_id;

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
    'applied', TRUE, 'reason', NULL,
    'shares_before', v_before, 'shares_after', v_new,
    'price_used', v_price, 'action', v_action, 'event_id', v_event_id
  );
END;
$$;

-- ============================================================
-- reconcile_portfolio_book — book, ledger and snapshot as one act
-- ============================================================
--
-- DROPPED, not replaced. `CREATE OR REPLACE` with a new parameter creates an
-- OVERLOAD, and because both signatures carry defaults every existing
-- four-argument call then fails with "function is not unique" — including the
-- ones in the contract tests and in every client that passes fewer arguments
-- than the longest signature. Adding a parameter to a defaulted function is
-- always a drop-and-create.
DROP FUNCTION IF EXISTS reconcile_portfolio_book(UUID, JSONB, DATE, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION reconcile_portfolio_book(
  p_portfolio_id UUID,
  p_positions    JSONB,
  p_as_of        DATE DEFAULT CURRENT_DATE,
  p_source       TEXT DEFAULT 'upload',
  p_allow_empty  BOOLEAN DEFAULT FALSE,
  p_actor_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_upserted    INT := 0;
  v_removed     INT := 0;
  v_incoming    INT := 0;
  v_existing    INT := 0;
  v_before      JSONB;
  v_snapshot_id UUID;
  v_events      INT := 0;
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

  -- The before-state, captured while it still exists. Books here run to
  -- dozens of positions, so a jsonb map is cheaper than another table and
  -- cannot be shadowed the way a temp table can.
  SELECT COALESCE(jsonb_object_agg(asset_id::text, shares), '{}'::jsonb)
    INTO v_before
  FROM portfolio_holdings WHERE portfolio_id = p_portfolio_id;

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
      SET shares = EXCLUDED.shares, price = EXCLUDED.price,
          cost = EXCLUDED.cost, date = EXCLUDED.date, updated_at = now()
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

  -- The complete book, as it now stands. Written before the events because
  -- an event's replay identity names the snapshot it belongs to.
  v_snapshot_id := snapshot_portfolio_book_unchecked(
    p_portfolio_id, p_as_of, COALESCE(p_source, 'upload'), p_actor_id);

  -- One event per position that actually moved. A position the file restated
  -- to the size it already was is not a change and gets no row.
  WITH after AS (
    SELECT asset_id, shares FROM portfolio_holdings WHERE portfolio_id = p_portfolio_id
  ),
  before AS (
    SELECT (key)::uuid AS asset_id, (value)::numeric AS shares
    FROM jsonb_each_text(v_before)
  ),
  diff AS (
    SELECT
      COALESCE(a.asset_id, b.asset_id) AS asset_id,
      COALESCE(b.shares, 0) AS shares_before,
      COALESCE(a.shares, 0) AS shares_after
    FROM after a
    FULL OUTER JOIN before b ON b.asset_id = a.asset_id
  ),
  written AS (
    INSERT INTO portfolio_holdings_events (
      organization_id, portfolio_id, asset_id, event_type, source,
      shares_before, shares_delta, shares_after,
      effective_at, snapshot_id, actor_id, idempotency_key
    )
    SELECT
      '00000000-0000-0000-0000-000000000000',
      p_portfolio_id, d.asset_id,
      CASE
        WHEN d.shares_before = 0 THEN 'reconcile_add'
        WHEN d.shares_after = 0 THEN 'reconcile_remove'
        ELSE 'reconcile_change'
      END,
      COALESCE(p_source, 'upload'),
      d.shares_before, d.shares_after - d.shares_before, d.shares_after,
      p_as_of, v_snapshot_id, p_actor_id,
      'reconcile:' || v_snapshot_id::text || ':' || d.asset_id::text
    FROM diff d
    WHERE d.shares_before IS DISTINCT FROM d.shares_after
    -- A re-sent file that produced no new snapshot would collide on the
    -- replay identity. Skipping is the correct answer: those events are
    -- already recorded.
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_events FROM written;

  RETURN jsonb_build_object(
    'upserted', v_upserted,
    'removed', v_removed,
    'positions', v_incoming,
    'existing_before', v_existing,
    'events', v_events,
    'snapshot_id', v_snapshot_id,
    'as_of', p_as_of,
    'source', p_source
  );
END;
$$;

-- ============================================================
-- Execution rights
-- ============================================================
-- No grant for the internal one: only the SECURITY DEFINER functions owned
-- by postgres may call it, which is what makes the authorization split real.
REVOKE ALL ON FUNCTION snapshot_portfolio_book_unchecked(UUID, DATE, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION snapshot_portfolio_book(UUID, DATE, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_portfolio_book(UUID, JSONB, DATE, TEXT, BOOLEAN, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION snapshot_portfolio_book(UUID, DATE, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION apply_trade_to_book(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reconcile_portfolio_book(UUID, JSONB, DATE, TEXT, BOOLEAN, UUID) TO authenticated, service_role;
