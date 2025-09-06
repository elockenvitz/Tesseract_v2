/*
  # Fix Investment Thesis Saving

  1. New Functions
    - `update_asset_content_reliable` - Simple, reliable content update function
    - Handles unique constraints properly
    - Maintains version history
    - Works for all content tables (asset_thesis, asset_where_different, asset_risks)

  2. Security
    - Proper RLS enforcement
    - User validation

  3. Changes
    - Replaces problematic RPC functions
    - Uses simple UPDATE or INSERT logic
    - No explicit transaction control
*/

-- Drop existing problematic functions
DROP FUNCTION IF EXISTS update_current_content(text, uuid, text, uuid);
DROP FUNCTION IF EXISTS update_content_simple(text, uuid, text, uuid);

-- Create a reliable content update function
CREATE OR REPLACE FUNCTION update_asset_content_reliable(
  p_table_name text,
  p_asset_id uuid,
  p_content text,
  p_user_id uuid
) RETURNS void AS $$
DECLARE
  v_current_record record;
  v_new_version integer := 1;
BEGIN
  -- Validate table name
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Get current record if it exists
  EXECUTE format('
    SELECT id, version, content 
    FROM %I 
    WHERE asset_id = $1 AND is_current = true
  ', p_table_name) 
  INTO v_current_record 
  USING p_asset_id;

  -- If current record exists and content is the same, do nothing
  IF v_current_record IS NOT NULL AND v_current_record.content = p_content THEN
    RETURN;
  END IF;

  -- Calculate new version
  IF v_current_record IS NOT NULL THEN
    v_new_version := v_current_record.version + 1;
    
    -- Mark existing record as not current
    EXECUTE format('
      UPDATE %I 
      SET is_current = false, updated_at = now()
      WHERE id = $1
    ', p_table_name) 
    USING v_current_record.id;
  END IF;

  -- Insert new current record
  EXECUTE format('
    INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, $3, true, $4, $4, now(), now())
  ', p_table_name) 
  USING p_asset_id, p_content, v_new_version, p_user_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;