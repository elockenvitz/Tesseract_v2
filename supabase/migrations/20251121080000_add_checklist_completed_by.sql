/*
  # Add completed_by field to track who completed checklist items

  This migration adds a completed_by field to track which user
  completed or marked a checklist item as N/A.
*/

-- Add completed_by column
ALTER TABLE asset_checklist_items
ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_asset_checklist_items_completed_by
  ON asset_checklist_items(completed_by);

-- Add comment
COMMENT ON COLUMN asset_checklist_items.completed_by IS
  'User who completed or marked the item as N/A';
