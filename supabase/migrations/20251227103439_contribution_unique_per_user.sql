-- Add unique constraint: one contribution per user per asset per section
-- This enforces the new model where each user has ONE current view per section

-- First, handle any existing duplicates by keeping only the most recent
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY created_by, asset_id, section
           ORDER BY updated_at DESC, created_at DESC
         ) as rn
  FROM asset_contributions
)
DELETE FROM asset_contributions
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Add the unique constraint
ALTER TABLE asset_contributions
ADD CONSTRAINT unique_user_asset_section
UNIQUE (created_by, asset_id, section);

-- Add index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_contributions_by_user
ON asset_contributions(created_by, asset_id);

-- Add index for ordering by update time
CREATE INDEX IF NOT EXISTS idx_contributions_updated
ON asset_contributions(asset_id, section, updated_at DESC);
