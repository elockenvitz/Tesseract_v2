-- Decision Price Snapshots
--
-- Records the market price at the moment a trade idea reaches a terminal outcome.
-- Primary use case: approval-time price snapshots for delay cost analysis.
--
-- Price source: assets.current_price (DB-cached, not real-time intraday).
-- This is a directional proxy — adequate for process analysis, not exact fill attribution.

CREATE TABLE IF NOT EXISTS decision_price_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The decision this snapshot belongs to
    trade_queue_item_id UUID NOT NULL REFERENCES trade_queue_items(id) ON DELETE CASCADE,

    -- Asset and portfolio context (denormalized for query efficiency)
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,

    -- Snapshot type — extensible for future rejection/cancellation snapshots
    snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('approval', 'rejection', 'cancellation')),

    -- The captured price
    snapshot_price NUMERIC NOT NULL,

    -- When the snapshot was taken (usually = outcome_at on the trade idea)
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Where the price came from
    price_source TEXT NOT NULL DEFAULT 'db_cached'
      CHECK (price_source IN ('db_cached', 'live_quote', 'manual', 'backfill')),

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    -- One snapshot per decision per type — prevents duplicates on re-approvals
    UNIQUE (trade_queue_item_id, snapshot_type)
);

-- Index for the primary query pattern: fetch snapshots for a batch of decisions
CREATE INDEX idx_decision_price_snapshots_item
    ON decision_price_snapshots (trade_queue_item_id);

-- Index for asset-level queries (e.g., "all snapshots for AAPL")
CREATE INDEX idx_decision_price_snapshots_asset
    ON decision_price_snapshots (asset_id, snapshot_at DESC);

-- RLS: same access as trade_queue_items (portfolio membership)
ALTER TABLE decision_price_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view snapshots for their portfolio decisions"
    ON decision_price_snapshots FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM trade_queue_items tqi
            WHERE tqi.id = decision_price_snapshots.trade_queue_item_id
              AND (
                  tqi.portfolio_id IS NULL
                  OR user_is_portfolio_member(tqi.portfolio_id)
              )
        )
    );

CREATE POLICY "Users can insert snapshots for their portfolio decisions"
    ON decision_price_snapshots FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM trade_queue_items tqi
            WHERE tqi.id = decision_price_snapshots.trade_queue_item_id
              AND (
                  tqi.portfolio_id IS NULL
                  OR user_is_portfolio_member(tqi.portfolio_id)
              )
        )
    );

-- Comment for documentation
COMMENT ON TABLE decision_price_snapshots IS
    'Records asset price at decision time (approval/rejection/cancellation). '
    'Price source is assets.current_price (DB-cached proxy, not real-time). '
    'Used by Decision Outcomes page for delay cost and move-since-decision metrics.';

COMMENT ON COLUMN decision_price_snapshots.snapshot_price IS
    'Market price at decision time. Source: assets.current_price (DB-cached). '
    'This is a proxy — may not reflect exact intraday price at the moment of approval.';
