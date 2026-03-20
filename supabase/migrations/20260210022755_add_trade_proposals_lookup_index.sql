-- Reconstructed locally to match remote-applied migration. Original applied 2026-02-10.
-- Adds a composite lookup index for fast proposal queries by item, user, and portfolio.

CREATE INDEX IF NOT EXISTS idx_trade_proposals_user_portfolio_active
  ON trade_proposals (trade_queue_item_id, user_id, portfolio_id)
  WHERE (is_active = true);
