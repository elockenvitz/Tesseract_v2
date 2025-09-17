/*
  # Asset Checklist State Storage

  1. New Tables
    - `asset_checklist_items`
      - `id` (uuid, primary key)
      - `asset_id` (uuid, foreign key to assets)
      - `stage_id` (text, stage identifier)
      - `item_id` (text, checklist item identifier)
      - `completed` (boolean, completion status)
      - `comment` (text, optional comment)
      - `completed_at` (timestamp, when completed)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `asset_checklist_items` table
    - Add policies for authenticated users to read/write checklist items
*/

-- Create asset checklist items table
CREATE TABLE IF NOT EXISTS asset_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  stage_id text NOT NULL,
  item_id text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  comment text,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(asset_id, stage_id, item_id)
);

-- Enable RLS
ALTER TABLE asset_checklist_items ENABLE ROW LEVEL SECURITY;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_asset_checklist_items_asset_id ON asset_checklist_items(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_checklist_items_stage_id ON asset_checklist_items(stage_id);
CREATE INDEX IF NOT EXISTS idx_asset_checklist_items_completed ON asset_checklist_items(completed);
CREATE INDEX IF NOT EXISTS idx_asset_checklist_items_asset_stage ON asset_checklist_items(asset_id, stage_id);

-- RLS Policies
CREATE POLICY "Users can read asset checklist items"
  ON asset_checklist_items
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert asset checklist items"
  ON asset_checklist_items
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update asset checklist items"
  ON asset_checklist_items
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete asset checklist items"
  ON asset_checklist_items
  FOR DELETE
  TO authenticated
  USING (true);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_asset_checklist_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to update updated_at timestamp
CREATE TRIGGER update_asset_checklist_items_updated_at_trigger
  BEFORE UPDATE ON asset_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION update_asset_checklist_items_updated_at();