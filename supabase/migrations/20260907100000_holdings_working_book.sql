-- ============================================================
-- portfolio_holdings becomes the current working book
-- ============================================================
--
-- ── What the table meant, and why that was not one thing ──────────────────
--
-- UNIQUE (portfolio_id, asset_id, date) let a portfolio carry one row per
-- asset PER DATE, and the product read that in two incompatible ways:
--
--   Desktop   currentRows()        newest row per (portfolio, asset)
--   Mobile    latestSnapshotRows() every row on the portfolio's newest date
--
-- Both are correct readings of a dated table and they disagree the moment a
-- writer touches one asset without touching the rest — which every writer
-- does. An accepted trade wrote a single asset at today's date and left the
-- other 34 positions at their older date, so Mobile saw a one-asset book.
--
-- Measured in production on 2026-09-06, four portfolios in four different
-- customer organizations were already in that state:
--
--   Vision Fund 10K          Mobile 2 positions / $2.07m    Desktop 29 / $101.5m
--   Tech & Consumer Growth   Mobile 3 positions / $4.35m    Desktop 36 / $33.8m
--   Tech & Consumer Growth   Mobile 1 position  / $3.15m    Desktop 35 / $33.8m
--   Tech & Consumer Growth   Mobile 1 position  / $0.50m    Desktop 36 / $33.6m
--
-- ── The contract this migration installs ──────────────────────────────────
--
--   portfolio_holdings is the CURRENT WORKING BOOK and nothing else.
--   One row per (portfolio_id, asset_id). The row IS the position.
--   A position that is not held has NO ROW.
--
-- `date` survives as PROVENANCE — when this line was last changed — and is
-- never again an identity or a filter. A per-row as-of cannot describe a
-- book, so the book's own as-of moves to the portfolio. That is the single
-- correction to the model as originally proposed, and it is the whole reason
-- the two reductions could disagree.
--
-- Immutable history stays where it already is: portfolio_holdings_snapshots
-- and portfolio_holdings_positions. Nothing in this file writes them, and
-- after this change nothing else updates or deletes them either.
--
-- ── Why the collapse rule is newest-per-pair ──────────────────────────────
--
-- The alternative — keep the latest complete snapshot — is actively
-- destructive on exactly the books that need repairing. Their newest date IS
-- the one-to-three-asset trade artifact, so it would delete 33 to 34 of 35
-- positions each and discard roughly $130m of book value across three
-- organizations. Newest-per-pair keeps every position and correctly applies
-- the trades that created the newer rows.
--
-- It is deterministic without a tiebreak: the outgoing unique key permits at
-- most one row per date, so max(date) selects exactly one row per pair.
--
-- 1,086 rows in, 1,058 kept, 28 superseded. The 28 are RETAINED in
-- portfolio_holdings_superseded rather than dropped, so the collapse is
-- reversible for as long as anyone might want to check it.
--
-- ── Deliberately NOT done here ────────────────────────────────────────────
--
-- No denormalised organization_id. Every write path added in the next
-- migration derives and verifies the organization THROUGH the portfolio,
-- which is the rule Stage 1 established; a second copy of the org on the row
-- would be another thing that can disagree. Revisit only if RLS performance
-- demands it.
--
-- No column rename. `date` keeps its name so this change stays reviewable
-- against 71 existing read sites; the guard now forbids filtering on it.
-- ============================================================

-- ============================================================
-- 1. Retain what the collapse removes
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_holdings_superseded (
  id            UUID PRIMARY KEY,
  portfolio_id  UUID NOT NULL,
  asset_id      UUID NOT NULL,
  shares        NUMERIC NOT NULL,
  price         NUMERIC NOT NULL,
  cost          NUMERIC NOT NULL,
  date          DATE NOT NULL,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  created_by    UUID,
  -- Why this row was removed, so a reader does not have to infer it.
  collapsed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  collapsed_by  TEXT NOT NULL DEFAULT 'working-book migration 20260907100000'
);

COMMENT ON TABLE portfolio_holdings_superseded IS
  'Dated rows removed when portfolio_holdings became a working book. Retained '
  'so the one-time collapse is reversible and auditable. Not read by the '
  'product; safe to drop once the cutover has been observed through a full '
  'upload cycle.';

-- Read-only to the application. Nothing in the product needs this, and a
-- writable audit trail is not an audit trail.
ALTER TABLE portfolio_holdings_superseded ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superseded holdings: org admins can read" ON portfolio_holdings_superseded;
CREATE POLICY "Superseded holdings: org admins can read"
  ON portfolio_holdings_superseded FOR SELECT TO authenticated
  USING (
    portfolio_in_current_org(portfolio_id)
    AND is_active_org_admin_of_current_org()
  );

-- ============================================================
-- 2. Book-level state
-- ============================================================
--
-- A book is a coherent set of positions marked at one moment. Stamping each
-- ROW with its own as-of is what let a denominator mix April prices with a
-- June one, so the as-of belongs to the book.
--
-- `book_as_of` is what a card prints. `date` on a row stays as provenance
-- for that one line and is not a substitute.
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS book_as_of DATE,
  ADD COLUMN IF NOT EXISTS book_source TEXT,
  ADD COLUMN IF NOT EXISTS book_reconciled_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolios_book_source_check'
  ) THEN
    ALTER TABLE portfolios ADD CONSTRAINT portfolios_book_source_check
      CHECK (book_source IS NULL OR book_source IN (
        'backfill', 'onboarding', 'upload', 'api_sync', 'sftp_sync', 'trade', 'reconciliation'
      ));
  END IF;
END;
$$;

COMMENT ON COLUMN portfolios.book_as_of IS
  'The date the whole working book was last true. Read this, never a row date.';
COMMENT ON COLUMN portfolios.book_source IS
  'What last moved the working book: an upload, a feed, onboarding, or a trade.';
COMMENT ON COLUMN portfolios.book_reconciled_at IS
  'Last COMPLETE reconcile. A single trade does not advance this — only a '
  'whole-book operation can claim the book was reconciled.';

-- ============================================================
-- 3. Collapse to one live row per (portfolio, asset)
-- ============================================================
WITH keep AS (
  SELECT DISTINCT ON (portfolio_id, asset_id) id
  FROM portfolio_holdings
  ORDER BY portfolio_id, asset_id, date DESC
),
moved AS (
  INSERT INTO portfolio_holdings_superseded
    (id, portfolio_id, asset_id, shares, price, cost, date, created_at, updated_at, created_by)
  SELECT h.id, h.portfolio_id, h.asset_id, h.shares, h.price, h.cost, h.date,
         h.created_at, h.updated_at, h.created_by
  FROM portfolio_holdings h
  WHERE h.id NOT IN (SELECT id FROM keep)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
DELETE FROM portfolio_holdings
 WHERE id IN (SELECT id FROM moved);

-- Stamp each book with the newest date it actually carried. This is the
-- honest value: it is when that book was last touched, even though the rows
-- under it were written across several dates.
UPDATE portfolios p
   SET book_as_of = h.max_date,
       book_source = 'backfill',
       book_reconciled_at = NULL
  FROM (
    SELECT portfolio_id, max(date) AS max_date
    FROM portfolio_holdings
    GROUP BY portfolio_id
  ) h
 WHERE h.portfolio_id = p.id
   AND p.book_as_of IS NULL;

-- book_reconciled_at stays NULL on purpose. No complete reconcile has ever
-- run against these books, and claiming one here would be the first lie the
-- new contract tells.

-- ============================================================
-- 4. The key that makes the contract unbreakable
-- ============================================================
--
-- Until this constraint exists, every guarantee above is a convention that
-- the next writer can ignore by accident. After it, a second dated row for
-- the same position is rejected by the database.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'portfolio_holdings_portfolio_asset_date_key'
  ) THEN
    ALTER TABLE portfolio_holdings
      DROP CONSTRAINT portfolio_holdings_portfolio_asset_date_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'portfolio_holdings_portfolio_asset_key'
  ) THEN
    ALTER TABLE portfolio_holdings
      ADD CONSTRAINT portfolio_holdings_portfolio_asset_key
      UNIQUE (portfolio_id, asset_id);
  END IF;
END;
$$;

-- A held position always has shares. Zero is not a tombstone in this model —
-- absence is — so a zero row would read as "held at 0%" to the ~27 reader
-- sites that test membership by row presence.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_holdings_shares_positive'
  ) THEN
    ALTER TABLE portfolio_holdings ADD CONSTRAINT portfolio_holdings_shares_positive
      CHECK (shares > 0);
  END IF;
END;
$$;

COMMENT ON TABLE portfolio_holdings IS
  'The current working book: one live row per (portfolio_id, asset_id). No '
  'row means no position. Immutable history lives in '
  'portfolio_holdings_snapshots / _positions. Write only through '
  'apply_trade_to_book() and reconcile_portfolio_book().';

COMMENT ON COLUMN portfolio_holdings.date IS
  'PROVENANCE ONLY: when this one line was last changed. Never an identity, '
  'never a filter, never a denominator boundary. The book''s as-of is '
  'portfolios.book_as_of.';

-- The date index existed to serve the reductions this change removes.
DROP INDEX IF EXISTS idx_portfolio_holdings_date;
DROP INDEX IF EXISTS idx_portfolio_holdings_portfolio_date;
