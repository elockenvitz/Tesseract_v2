-- Reconstructed locally to match remote-applied migration. Original applied 2026-02-10.
-- Adds a partial index for active proposals scoped to portfolio + trade item.

CREATE INDEX IF NOT EXISTS idx_trade_proposals_portfolio_active
  ON trade_proposals (portfolio_id, trade_queue_item_id)
  WHERE (is_active = true);
