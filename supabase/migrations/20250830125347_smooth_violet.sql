/*
  # Fix update_asset_content function for proper versioning

  This migration fixes the update_asset_content function to properly handle
  updating existing records by using a more robust approach that avoids
  unique constraint violations.

  ## Changes
  1. Rewrite update_asset_content function with proper transaction handling
  2. Use DELETE + INSERT pattern to avoid constraint timing issues
  3. Ensure proper version incrementing
  4. Add comprehensive error handling
*/

-- Drop the existing function
DROP FUNCTION IF EXISTS update_asset_content(text, uuid, text, uuid);

-- Create the improved function
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
  v_current_version integer := 0;
  v_new_version integer := 1;
BEGIN
  -- Validate table name to prevent SQL injection
  IF p_table NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table;
  END IF;

  -- Validate required parameters
  IF p_asset_id IS NULL OR p_updated_by IS NULL THEN
    RAISE EXCEPTION 'Asset ID and updated_by are required';
  END IF;

  -- Get the current version number (if any records exist)
  EXECUTE format('
    SELECT COALESCE(MAX(version), 0)
    FROM %I
    WHERE asset_id = $1
  ', p_table)
  INTO v_current_version
  USING p_asset_id;

  -- Calculate new version
  v_new_version := v_current_version + 1;

  -- Remove all current records for this asset (this avoids constraint issues)
  EXECUTE format('
    UPDATE %I 
    SET is_current = FALSE 
    WHERE asset_id = $1 AND is_current = TRUE
  ', p_table)
  USING p_asset_id;

  -- Insert the new version
  EXECUTE format('
    INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, $3, TRUE, $4, $4, NOW(), NOW())
  ', p_table)
  USING p_asset_id, p_content, v_new_version, p_updated_by;

  -- Log success
  RAISE NOTICE 'Successfully updated % for asset % with version %', p_table, p_asset_id, v_new_version;

EXCEPTION
  WHEN OTHERS THEN
    -- Log the error details
    RAISE EXCEPTION 'Failed to update %: % (SQLSTATE: %)', p_table, SQLERRM, SQLSTATE;
END;
$$;