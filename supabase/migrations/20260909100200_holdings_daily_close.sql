-- ============================================================
-- The end-of-day close: one complete book per portfolio per business day
-- ============================================================
--
-- ── What this replaces ────────────────────────────────────────────────────
--
-- `carry_forward_holdings()` copied YESTERDAY'S SNAPSHOT forward when no
-- upload arrived. That was the right idea against the old model, where the
-- snapshot tables were the only record of a book, and it is the wrong one
-- now: the working book is authoritative and already knows what is held, so
-- a close is a materialisation rather than a copy.
--
-- The difference is not cosmetic. Carry-forward could only reproduce the last
-- FILE, so a day whose only change was an executed trade carried forward a
-- book that did not include the trade. Materialising the working book records
-- what the desk actually held.
--
-- carry_forward_holdings is left in place, unscheduled, rather than dropped.
-- It has never run in production — pg_cron is installed and the job was never
-- registered — so nothing depends on it, and deleting a function in the same
-- change that replaces it makes the replacement harder to review. Its removal
-- is a follow-up.
--
-- ── Why the close is not simply "insert a snapshot" ───────────────────────
--
-- snapshot_portfolio_book_unchecked is idempotent per (portfolio, date): it
-- returns the existing snapshot when that snapshot still describes the book,
-- and supersedes it with a new revision when it does not. So the close can be
-- re-run, run late, or run after a reconcile already recorded the same book,
-- and the result is the same. That is what makes a scheduled job safe to
-- retry, which is the only kind worth scheduling.
--
-- ── Business days ─────────────────────────────────────────────────────────
--
-- Weekends are skipped. Market holidays are NOT, because this product has no
-- holiday calendar and inventing one here would put a US-equity assumption
-- into the schema for books that may not be US equity. A holiday produces a
-- snapshot identical to the previous close, which is honest — the desk did
-- hold that book on that day — and costs one row per portfolio.
-- ============================================================

CREATE OR REPLACE FUNCTION close_portfolio_books(
  p_as_of          DATE DEFAULT CURRENT_DATE,
  p_portfolio_id   UUID DEFAULT NULL,
  p_include_weekend BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_portfolio   RECORD;
  v_snapshot_id UUID;
  v_closed      INT := 0;
  v_unchanged   INT := 0;
  v_skipped     INT := 0;
  v_failed      INT := 0;
  v_existing    UUID;
BEGIN
  -- The job gate.
  --
  -- Deliberately NOT can_write_portfolio_book(): this runs across every
  -- organization, so a per-portfolio membership check is the wrong question.
  -- Two callers are legitimate — the service role, and a database session
  -- with no JWT at all, which is what pg_cron is. Anything arriving through
  -- PostgREST carries a role claim, so `auth.role() IS NULL` cannot be
  -- reached by a user; an authenticated caller wanting one book should use
  -- snapshot_portfolio_book, which gates properly.
  IF NOT (auth.role() IS NULL OR auth.role() = 'service_role' OR is_platform_admin()) THEN
    RAISE EXCEPTION 'close_portfolio_books requires the service role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT p_include_weekend AND EXTRACT(ISODOW FROM p_as_of) >= 6 THEN
    RETURN jsonb_build_object(
      'as_of', p_as_of, 'closed', 0, 'unchanged', 0, 'skipped', 0, 'failed', 0,
      'note', 'not a business day'
    );
  END IF;

  FOR v_portfolio IN
    SELECT p.id
    FROM portfolios p
    WHERE (p_portfolio_id IS NULL OR p.id = p_portfolio_id)
      AND p.organization_id IS NOT NULL
      -- A book with no positions has nothing to record. An empty snapshot
      -- would claim the desk held nothing that day, which for a portfolio
      -- that was never funded is a different statement from silence.
      AND EXISTS (SELECT 1 FROM portfolio_holdings h WHERE h.portfolio_id = p.id)
    ORDER BY p.id
  LOOP
    BEGIN
      SELECT id INTO v_existing
      FROM portfolio_holdings_snapshots
      WHERE portfolio_id = v_portfolio.id
        AND snapshot_date = p_as_of
        AND superseded_at IS NULL;

      v_snapshot_id := snapshot_portfolio_book_unchecked(
        v_portfolio.id, p_as_of, 'eod_close', NULL);

      IF v_existing IS NOT NULL AND v_snapshot_id = v_existing THEN
        -- The recorded book already matched. Counted separately so an
        -- operator can tell "nothing moved" from "nothing ran".
        v_unchanged := v_unchanged + 1;
      ELSE
        v_closed := v_closed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One portfolio must not stop the close. A book that fails is counted
      -- and reported; the rest of the desk still gets its history.
      v_failed := v_failed + 1;
      RAISE WARNING 'close_portfolio_books: portfolio % failed: %',
        v_portfolio.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'as_of', p_as_of,
    'closed', v_closed,
    'unchanged', v_unchanged,
    'skipped', v_skipped,
    'failed', v_failed
  );
END;
$$;

COMMENT ON FUNCTION close_portfolio_books(DATE, UUID, BOOLEAN) IS
  'End-of-day close: materialise every funded portfolio''s working book as an '
  'immutable snapshot for the given business day. Idempotent and safe to '
  'retry; a book that already matches its recorded snapshot is left alone.';

REVOKE ALL ON FUNCTION close_portfolio_books(DATE, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_portfolio_books(DATE, UUID, BOOLEAN) TO service_role;

-- ============================================================
-- Schedule
-- ============================================================
--
-- 22:15 UTC on weekdays, which is 15 minutes after the existing ingest jobs
-- (see .github/workflows and scripts/ci-integrity.mjs, which pins the ingest
-- schedule at 22:00). The close has to run AFTER the day's prices and
-- holdings have landed, or it records a book marked with yesterday's prices.
--
-- Registered defensively: the previous attempt at scheduling in this schema
-- (20260330110000) used the same guarded shape and never took effect in
-- production — pg_cron is installed and the job is absent. So this one
-- reports what it did rather than assuming, and
-- supabase/tests/holdings-daily-close.sql asserts the job exists rather than
-- trusting that this block ran.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('close-portfolio-books');
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- not previously scheduled
    END;

    PERFORM cron.schedule(
      'close-portfolio-books',
      '15 22 * * 1-5',
      $cron$SELECT close_portfolio_books(CURRENT_DATE);$cron$
    );
    RAISE NOTICE 'close-portfolio-books scheduled at 15 22 * * 1-5';
  ELSE
    RAISE WARNING 'pg_cron absent: close_portfolio_books must be driven externally';
  END IF;
END;
$$;

-- ============================================================
-- Reading history
-- ============================================================
--
-- Two views, because the two questions history gets asked are different and
-- writing either one by hand is where a reader reintroduces the collapse this
-- lane spent five stages removing.

-- The book of record for each date: current revisions only.
CREATE OR REPLACE VIEW portfolio_book_history AS
SELECT
  s.id                AS snapshot_id,
  s.organization_id,
  s.portfolio_id,
  s.snapshot_date,
  s.revision,
  s.source,
  s.base_currency,
  s.total_market_value,
  s.total_positions,
  p.asset_id,
  p.symbol,
  p.shares,
  p.price,
  p.market_value,
  p.cost_basis,
  p.weight_pct,
  p.currency,
  p.fx_rate_to_base
FROM portfolio_holdings_snapshots s
JOIN portfolio_holdings_positions p ON p.snapshot_id = s.id
WHERE s.superseded_at IS NULL;

COMMENT ON VIEW portfolio_book_history IS
  'Every complete book this desk has recorded, one row per position per date, '
  'superseded revisions excluded. The from-clause for any "what did we hold '
  'on X" question. Values are as struck — never recompute them.';

-- How a position got where it is.
CREATE OR REPLACE VIEW portfolio_position_timeline AS
SELECT
  e.id AS event_id,
  e.organization_id,
  e.portfolio_id,
  e.asset_id,
  e.event_type,
  e.source,
  e.shares_before,
  e.shares_delta,
  e.shares_after,
  e.price,
  e.effective_at,
  e.recorded_at,
  e.accepted_trade_id,
  e.snapshot_id,
  e.corrects_event_id,
  e.actor_id
FROM portfolio_holdings_events e
ORDER BY e.portfolio_id, e.asset_id, e.effective_at, e.recorded_at;

COMMENT ON VIEW portfolio_position_timeline IS
  'The ledger in reading order: every change to every position, oldest first. '
  'Corrections appear as their own rows pointing at what they restate, so a '
  'restated history reads as a restatement rather than as a rewrite.';

GRANT SELECT ON portfolio_book_history TO authenticated, service_role;
GRANT SELECT ON portfolio_position_timeline TO authenticated, service_role;
