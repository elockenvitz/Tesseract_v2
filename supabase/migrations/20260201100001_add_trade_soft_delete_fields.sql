/*
  # Add Soft Delete Fields to Trade Tables

  Adds fields for soft delete (trash) functionality and previous state snapshots
  for deterministic restore.

  1. Changes to trade_queue_items
    - Add deleted_at timestamp
    - Add deleted_by user reference
    - Add previous_state jsonb for restore

  2. Changes to pair_trades
    - Add deleted_at timestamp
    - Add deleted_by user reference
    - Add previous_state jsonb for restore

  3. Indexes
    - Index on deleted_at for efficient trash queries
*/

-- Add soft delete fields to trade_queue_items
ALTER TABLE trade_queue_items
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS previous_state JSONB;

-- Add soft delete fields to pair_trades
ALTER TABLE pair_trades
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS previous_state JSONB;

-- Indexes for efficient trash queries
CREATE INDEX IF NOT EXISTS idx_trade_queue_items_deleted_at
  ON trade_queue_items(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pair_trades_deleted_at
  ON pair_trades(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Comments
COMMENT ON COLUMN trade_queue_items.deleted_at IS 'Timestamp when soft-deleted (NULL = not deleted)';
COMMENT ON COLUMN trade_queue_items.deleted_by IS 'User who deleted the item';
COMMENT ON COLUMN trade_queue_items.previous_state IS 'State snapshot before deletion for restore';

COMMENT ON COLUMN pair_trades.deleted_at IS 'Timestamp when soft-deleted (NULL = not deleted)';
COMMENT ON COLUMN pair_trades.deleted_by IS 'User who deleted the item';
COMMENT ON COLUMN pair_trades.previous_state IS 'State snapshot before deletion for restore';
