-- ============================================================
-- One canonical way to read the book of record
-- ============================================================
--
-- 20260909100000 made snapshots restatable: a corrected custodian file for a
-- day already loaded writes a new revision and supersedes the old one, so the
-- original survives instead of being overwritten. `superseded_at IS NULL`
-- marks the book of record for a date.
--
-- That put a filter between every historical reader and a correct answer, and
-- a filter nobody names is a filter somebody forgets. Five production readers
-- had no way to know it existed:
--
--   pro-forma fetchLatestSnapshot   right by accident — it orders by
--                                   created_at DESC, and a successor happens
--                                   to be created after what it supersedes
--   trade-reconciliation prevSnap   same accident, same fragility
--   useDerivedInsights              selects EVERY snapshot for an org with no
--                                   filter at all, so a restated day would
--                                   contribute both revisions' positions to
--                                   one exposure number
--   useAssetPortfolioWeights        reduces positions to the newest
--                                   snapshot_date; two revisions share that
--                                   date, so a name would appear twice at two
--                                   sizes
--   the three ops pages             list and count snapshots per org, where a
--                                   superseded row is a double count
--
-- The fix is a name, not a filter in five places. `portfolio_book_history`
-- already does this for the position-level view; this adds its snapshot-level
-- counterpart, and the two together are the whole current-history surface.
--
-- Superseded revisions stay fully queryable. They are read from the base
-- table, by id or by portfolio and date, which is the explicit audit path —
-- see portfolio_book_revisions below.
-- ============================================================

-- ── The book of record, per portfolio per date ────────────────────────────
CREATE OR REPLACE VIEW portfolio_book_snapshots_current AS
SELECT
  s.id,
  s.organization_id,
  s.portfolio_id,
  s.snapshot_date,
  s.revision,
  s.source,
  s.base_currency,
  s.total_market_value,
  s.total_positions,
  s.uploaded_at,
  s.uploaded_by,
  s.notes,
  s.created_at
FROM portfolio_holdings_snapshots s
WHERE s.superseded_at IS NULL;

COMMENT ON VIEW portfolio_book_snapshots_current IS
  'The book of record for each (portfolio, date): current revisions only. The '
  'from-clause for every historical holdings reader. Superseded revisions are '
  'deliberately absent — read portfolio_book_revisions for those.';

-- ── The audit path, where superseded revisions are the point ──────────────
--
-- Not a filtered view. Restatement history is the thing being asked for, so
-- every revision is present and the supersede chain is spelled out rather
-- than left to be reconstructed from timestamps.
CREATE OR REPLACE VIEW portfolio_book_revisions AS
SELECT
  s.id,
  s.organization_id,
  s.portfolio_id,
  s.snapshot_date,
  s.revision,
  s.source,
  s.total_market_value,
  s.total_positions,
  s.created_at,
  s.superseded_at,
  s.superseded_by_id,
  (s.superseded_at IS NULL) AS is_current,
  -- What replaced it, so an auditor reads a restatement rather than a diff of
  -- two timestamps.
  succ.revision            AS superseded_by_revision,
  succ.total_market_value  AS superseded_by_total_market_value,
  succ.source              AS superseded_by_source
FROM portfolio_holdings_snapshots s
LEFT JOIN portfolio_holdings_snapshots succ ON succ.id = s.superseded_by_id;

COMMENT ON VIEW portfolio_book_revisions IS
  'Every recorded revision of every book, current and superseded, with what '
  'replaced it. The explicit audit path: use this when restatement history IS '
  'the question, and portfolio_book_snapshots_current for everything else.';

GRANT SELECT ON portfolio_book_snapshots_current TO authenticated, service_role;
GRANT SELECT ON portfolio_book_revisions TO authenticated, service_role;
