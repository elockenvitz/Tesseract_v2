/*
  # Fix invalid transaction termination error

  1. Updates
    - Remove explicit transaction control (BEGIN/COMMIT/ROLLBACK) from update_asset_content function
    - Use atomic operations that rely on PostgreSQL's implicit transaction handling
    - Maintain proper versioning logic without manual transaction management

  2. Security
    - Keep SECURITY DEFINER to bypass RLS when needed
    - Maintain proper error handling without transaction control statements
*/

-- Drop and recreate the update_asset_content function without explicit transaction control
DROP FUNCTION IF EXISTS update_asset_content(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION update_asset_content(
  p_asset_id uuid,
  p_table_name text,
  p_content text,
  p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_version integer := 0;
  v_new_version integer := 1;
  v_result json;
BEGIN
  -- Validate table name
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Get the current maximum version for this asset
  EXECUTE format('SELECT COALESCE(MAX(version), 0) FROM %I WHERE asset_id = $1', p_table_name)
  INTO v_current_version
  USING p_asset_id;

  v_new_version := v_current_version + 1;

  -- Set all existing records for this asset to is_current = FALSE
  EXECUTE format('UPDATE %I SET is_current = FALSE WHERE asset_id = $1 AND is_current = TRUE', p_table_name)
  USING p_asset_id;

  -- Insert new record with is_current = TRUE
  EXECUTE format('
    INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by)
    VALUES ($1, $2, $3, TRUE, $4, $4)
  ', p_table_name)
  USING p_asset_id, p_content, v_new_version, p_user_id;

  -- Return success result
  v_result := json_build_object(
    'success', true,
    'version', v_new_version,
    'table_name', p_table_name
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    -- Return error information
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'error_code', SQLSTATE,
      'table_name', p_table_name
    );
END;
$$;