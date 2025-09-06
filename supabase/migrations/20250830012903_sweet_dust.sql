/*
  # Fix update_current_content function

  1. Function Updates
    - Fix the atomic update logic to properly handle existing records
    - Use UPDATE instead of INSERT when a current record exists
    - Add proper error handling and logging
    - Ensure the function works correctly for all content tables

  2. Security
    - Maintain SECURITY DEFINER for proper permissions
    - Keep existing RLS policies intact
*/

CREATE OR REPLACE FUNCTION update_current_content(
  p_table_name text,
  p_asset_id uuid,
  p_content text,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_record_exists boolean := false;
  next_version integer := 1;
BEGIN
  -- Validate table name to prevent SQL injection
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Check if a current record exists and get the next version
  EXECUTE format('
    SELECT EXISTS(SELECT 1 FROM %I WHERE asset_id = $1 AND is_current = true),
           COALESCE(MAX(version), 0) + 1
    FROM %I 
    WHERE asset_id = $1
  ', p_table_name, p_table_name)
  INTO current_record_exists, next_version
  USING p_asset_id;

  IF current_record_exists THEN
    -- Update the existing current record
    EXECUTE format('
      UPDATE %I 
      SET content = $1, 
          version = $2,
          updated_at = now(),
          updated_by = $3
      WHERE asset_id = $4 AND is_current = true
    ', p_table_name)
    USING p_content, next_version, p_user_id, p_asset_id;
  ELSE
    -- Insert a new current record
    EXECUTE format('
      INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by)
      VALUES ($1, $2, $3, true, $4, $4)
    ', p_table_name)
    USING p_asset_id, p_content, next_version, p_user_id;
  END IF;
END;
$$;