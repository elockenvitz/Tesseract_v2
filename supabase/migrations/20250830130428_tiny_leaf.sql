/*
  # Eliminate versioning system and use simple direct updates

  1. Changes
    - Drop all versioning tables (asset_thesis, asset_where_different, asset_risks)
    - Add content fields directly to assets table
    - Create simple update function that just updates the assets table
    - Remove all versioning complexity

  2. Security
    - Maintain RLS on assets table
    - Simple function to update content fields
*/

-- Drop the versioning tables entirely
DROP TABLE IF EXISTS asset_thesis CASCADE;
DROP TABLE IF EXISTS asset_where_different CASCADE;
DROP TABLE IF EXISTS asset_risks CASCADE;

-- Add content fields directly to the assets table
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS thesis text DEFAULT '',
ADD COLUMN IF NOT EXISTS where_different text DEFAULT '',
ADD COLUMN IF NOT EXISTS risks_to_thesis text DEFAULT '';

-- Create a simple function that just updates the assets table
CREATE OR REPLACE FUNCTION update_asset_content(
  p_table text,
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_field_name text;
BEGIN
  -- Validate inputs
  IF p_asset_id IS NULL OR p_updated_by IS NULL THEN
    RAISE EXCEPTION 'Asset ID and updated_by cannot be null';
  END IF;

  -- Map table names to field names
  CASE p_table
    WHEN 'asset_thesis' THEN v_field_name := 'thesis';
    WHEN 'asset_where_different' THEN v_field_name := 'where_different';
    WHEN 'asset_risks' THEN v_field_name := 'risks_to_thesis';
    ELSE RAISE EXCEPTION 'Invalid table name: %', p_table;
  END CASE;

  -- Simple update of the assets table
  EXECUTE format('UPDATE assets SET %I = $1, updated_at = now() WHERE id = $2', v_field_name)
  USING p_content, p_asset_id;

  -- Verify the update worked
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset with ID % not found', p_asset_id;
  END IF;

END;
$$;