-- Add thesis_text column for structured thesis content (unlocked at thesis_forming stage)
ALTER TABLE trade_queue_items ADD COLUMN IF NOT EXISTS thesis_text text;
