/*
  # Add status field to checklist items for three-state support

  This migration adds a `status` field to support three states for checklist items:
  - 'unchecked' (default)
  - 'completed'
  - 'na' (not applicable)

  The migration preserves existing data by mapping the current `completed` boolean
  to the new status field, then keeps the completed field for backwards compatibility.
*/

-- Add status column with default 'unchecked'
ALTER TABLE asset_checklist_items
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unchecked'
CHECK (status IN ('unchecked', 'completed', 'na'));

-- Migrate existing data: set status based on completed field
UPDATE asset_checklist_items
SET status = CASE
  WHEN completed = true THEN 'completed'
  ELSE 'unchecked'
END;

-- Add index for status field
CREATE INDEX IF NOT EXISTS idx_asset_checklist_items_status ON asset_checklist_items(status);

-- Add comment
COMMENT ON COLUMN asset_checklist_items.status IS
  'Three-state status: unchecked, completed, or na (not applicable)';
