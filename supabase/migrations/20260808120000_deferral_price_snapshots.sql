-- Deferral price snapshots
--
-- `decision_price_snapshots` recorded a price when an idea was approved,
-- rejected, or cancelled, but deliberately skipped `deferred` on the grounds
-- that a deferral "isn't terminal" (see outcomeToSnapshotType in
-- src/lib/services/decision-snapshot-service.ts).
--
-- That reasoning holds for execution analysis and fails for idea-ledger
-- analysis. "We looked at this and chose not to act, for now" is the single
-- most common way an idea dies, and without a price anchored to that moment
-- there is no way to ask later whether the pass was right.
--
-- The price at the moment of deferral is not recoverable after the fact from
-- assets.current_price, so every deferral that happens before this ships is
-- a permanently unanswerable question. Daily closes can be backfilled from a
-- market data provider, but only at day granularity and only for assets we
-- can map to a public ticker.
--
-- Additive only: widens a CHECK constraint. No existing row changes, no
-- existing query is affected.

ALTER TABLE decision_price_snapshots
  DROP CONSTRAINT IF EXISTS decision_price_snapshots_snapshot_type_check;

ALTER TABLE decision_price_snapshots
  ADD CONSTRAINT decision_price_snapshots_snapshot_type_check
  CHECK (snapshot_type IN ('approval', 'rejection', 'cancellation', 'deferral'));

COMMENT ON TABLE decision_price_snapshots IS
    'Records asset price at decision time (approval/rejection/cancellation/deferral). '
    'Price source is assets.current_price (DB-cached proxy, not real-time). '
    'Approval snapshots drive delay cost and move-since-decision on the Decision '
    'Outcomes page. Rejection and deferral snapshots anchor "was the pass right?" '
    'analysis for ideas that were never acted on.';

COMMENT ON COLUMN decision_price_snapshots.snapshot_type IS
    'approval   — idea was accepted/executed; latest wins (re-approval updates it). '
    'rejection  — idea was killed outright. '
    'cancellation — idea was withdrawn. '
    'deferral   — idea was passed on for now; FIRST deferral wins and is never '
    'overwritten, because the question being answered is "what was it worth when '
    'we first decided not to act", not "when we most recently decided not to act".';
