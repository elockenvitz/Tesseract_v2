/*
  # Asset Field History Tracking

  1. New Tables
    - `asset_field_history`
      - `id` (uuid, primary key)
      - `asset_id` (uuid, foreign key to assets)
      - `field_name` (text, the field that was changed)
      - `old_value` (text, previous value)
      - `new_value` (text, new value)
      - `changed_by` (uuid, user who made the change)
      - `changed_at` (timestamp)

  2. Functions
    - `track_asset_field_changes()` - Trigger function to automatically track changes
    - `get_asset_field_history()` - Function to retrieve field history

  3. Security
    - Enable RLS on `asset_field_history` table
    - Add policies for authenticated users to read history
    - Add trigger to automatically track changes on assets table
*/

-- Create asset field history table
CREATE TABLE IF NOT EXISTS asset_field_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE asset_field_history ENABLE ROW LEVEL SECURITY;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_asset_field_history_asset_id ON asset_field_history(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_field_history_field_name ON asset_field_history(field_name);
CREATE INDEX IF NOT EXISTS idx_asset_field_history_changed_at ON asset_field_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_field_history_asset_field ON asset_field_history(asset_id, field_name);

-- RLS Policies
CREATE POLICY "Users can read asset field history"
  ON asset_field_history
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert asset field history"
  ON asset_field_history
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to track asset field changes
CREATE OR REPLACE FUNCTION track_asset_field_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Track thesis changes
  IF OLD.thesis IS DISTINCT FROM NEW.thesis THEN
    INSERT INTO asset_field_history (asset_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'thesis', OLD.thesis, NEW.thesis, auth.uid());
  END IF;

  -- Track where_different changes
  IF OLD.where_different IS DISTINCT FROM NEW.where_different THEN
    INSERT INTO asset_field_history (asset_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'where_different', OLD.where_different, NEW.where_different, auth.uid());
  END IF;

  -- Track risks_to_thesis changes
  IF OLD.risks_to_thesis IS DISTINCT FROM NEW.risks_to_thesis THEN
    INSERT INTO asset_field_history (asset_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'risks_to_thesis', OLD.risks_to_thesis, NEW.risks_to_thesis, auth.uid());
  END IF;

  -- Track priority changes
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    INSERT INTO asset_field_history (asset_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'priority', OLD.priority::text, NEW.priority::text, auth.uid());
  END IF;

  -- Track process_stage changes
  IF OLD.process_stage IS DISTINCT FROM NEW.process_stage THEN
    INSERT INTO asset_field_history (asset_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'process_stage', OLD.process_stage::text, NEW.process_stage::text, auth.uid());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add trigger to assets table
DROP TRIGGER IF EXISTS track_asset_field_changes_trigger ON assets;
CREATE TRIGGER track_asset_field_changes_trigger
  AFTER UPDATE ON assets
  FOR EACH ROW
  EXECUTE FUNCTION track_asset_field_changes();

-- Function to get asset field history
CREATE OR REPLACE FUNCTION get_asset_field_history(
  p_asset_id uuid,
  p_field_name text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  field_name text,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_by_email text,
  changed_by_name text,
  changed_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    h.id,
    h.field_name,
    h.old_value,
    h.new_value,
    h.changed_by,
    COALESCE(u.email, 'Unknown') as changed_by_email,
    CASE 
      WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
      THEN u.first_name || ' ' || u.last_name
      WHEN u.email IS NOT NULL 
      THEN split_part(u.email, '@', 1)
      ELSE 'Unknown User'
    END as changed_by_name,
    h.changed_at
  FROM asset_field_history h
  LEFT JOIN users u ON h.changed_by = u.id
  WHERE h.asset_id = p_asset_id
    AND (p_field_name IS NULL OR h.field_name = p_field_name)
  ORDER BY h.changed_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;