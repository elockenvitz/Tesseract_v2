-- Add idea expression fields (analyst sizing expectation, not trade instruction)
ALTER TABLE trade_queue_items ADD COLUMN IF NOT EXISTS expected_position_size numeric;
ALTER TABLE trade_queue_items ADD COLUMN IF NOT EXISTS max_position_size numeric;
