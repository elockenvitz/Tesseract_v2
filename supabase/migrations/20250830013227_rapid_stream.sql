/*
  # Update change history tracking

  1. Functions
    - Update `update_current_content` to always create new version entries
    - Ensure each edit creates a separate history record
    - Properly track version increments for audit trail

  2. Changes
    - Modified logic to always insert new records instead of updating existing ones
    - Each save operation now creates a new version entry
    - Maintains proper version sequencing and history tracking
*/

-- Drop the existing function
DROP FUNCTION IF EXISTS update_current_content(text, uuid, text, uuid);

-- Create the updated function that always creates new version entries
CREATE OR REPLACE FUNCTION update_current_content(
  p_table_name text,
  p_asset_id uuid,
  p_content text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_version integer := 1;
  v_new_version integer;
BEGIN
  -- Get the current highest version for this asset
  EXECUTE format('
    SELECT COALESCE(MAX(version), 0) + 1
    FROM %I
    WHERE asset_id = $1
  ', p_table_name)
  INTO v_new_version
  USING p_asset_id;

  -- Mark all existing records as non-current
  EXECUTE format('
    UPDATE %I
    SET is_current = false
    WHERE asset_id = $1 AND is_current = true
  ', p_table_name)
  USING p_asset_id;

  -- Always insert a new record with the new version
  EXECUTE format('
    INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, $3, true, $4, $4, now(), now())
  ', p_table_name)
  USING p_asset_id, p_content, v_new_version, p_user_id;

  -- Log the change for debugging
  RAISE NOTICE 'Created new version % for asset % in table %', v_new_version, p_asset_id, p_table_name;
END;
$$;