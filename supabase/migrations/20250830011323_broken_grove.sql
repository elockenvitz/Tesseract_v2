/*
  # Create theme_assets junction table

  1. New Tables
    - `theme_assets`
      - `id` (uuid, primary key)
      - `theme_id` (uuid, foreign key to themes)
      - `asset_id` (uuid, foreign key to assets)
      - `added_by` (uuid, foreign key to users)
      - `added_at` (timestamp)
      - `notes` (text, optional notes about the relationship)

  2. Security
    - Enable RLS on `theme_assets` table
    - Add policies for authenticated users to manage their own theme-asset relationships

  3. Indexes
    - Unique constraint on theme_id + asset_id combination
    - Indexes for efficient querying
*/

-- Create theme_assets junction table
CREATE TABLE IF NOT EXISTS theme_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  added_at timestamptz DEFAULT now(),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(theme_id, asset_id)
);

-- Enable RLS
ALTER TABLE theme_assets ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can create theme-asset relationships"
  ON theme_assets
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = added_by);

CREATE POLICY "Users can read all theme-asset relationships"
  ON theme_assets
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update their own theme-asset relationships"
  ON theme_assets
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = added_by)
  WITH CHECK (auth.uid() = added_by);

CREATE POLICY "Users can delete their own theme-asset relationships"
  ON theme_assets
  FOR DELETE
  TO authenticated
  USING (auth.uid() = added_by);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_theme_assets_theme_id ON theme_assets(theme_id);
CREATE INDEX IF NOT EXISTS idx_theme_assets_asset_id ON theme_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_theme_assets_added_by ON theme_assets(added_by);
CREATE INDEX IF NOT EXISTS idx_theme_assets_added_at ON theme_assets(added_at);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_theme_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_theme_assets_updated_at
  BEFORE UPDATE ON theme_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_theme_assets_updated_at();