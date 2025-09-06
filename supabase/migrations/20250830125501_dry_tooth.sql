/*
  # Fix unique constraint violation in update_asset_content function

  1. Database Changes
    - Recreate update_asset_content function with proper atomic transaction handling
    - Use explicit transaction with COMMIT to leverage DEFERRABLE constraint
    - Ensure is_current flag updates happen atomically

  2. Security
    - Maintain SECURITY DEFINER to bypass RLS policies
    - Keep proper error handling and validation
*/

-- Drop and recreate the update_asset_content function with proper transaction handling
DROP FUNCTION IF EXISTS update_asset_content(uuid, text, text, uuid, uuid);

CREATE OR REPLACE FUNCTION update_asset_content(
  p_asset_id uuid,
  p_content_type text,
  p_content text,
  p_created_by uuid DEFAULT NULL,
  p_updated_by uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_table_name text;
  v_current_version integer := 0;
  v_new_version integer := 1;
  v_result jsonb;
  v_created_by uuid;
  v_updated_by uuid;
BEGIN
  -- Set default values for user IDs
  v_created_by := COALESCE(p_created_by, auth.uid());
  v_updated_by := COALESCE(p_updated_by, auth.uid());
  
  -- Validate inputs
  IF p_asset_id IS NULL THEN
    RAISE EXCEPTION 'Asset ID cannot be null';
  END IF;
  
  IF p_content_type IS NULL OR p_content_type = '' THEN
    RAISE EXCEPTION 'Content type cannot be null or empty';
  END IF;
  
  IF p_content IS NULL THEN
    RAISE EXCEPTION 'Content cannot be null';
  END IF;

  -- Determine table name
  CASE p_content_type
    WHEN 'thesis' THEN v_table_name := 'asset_thesis';
    WHEN 'where_different' THEN v_table_name := 'asset_where_different';
    WHEN 'risks' THEN v_table_name := 'asset_risks';
    ELSE RAISE EXCEPTION 'Invalid content type: %', p_content_type;
  END CASE;

  -- Start explicit transaction to leverage DEFERRABLE constraint
  BEGIN
    -- Get current version number
    EXECUTE format('SELECT COALESCE(MAX(version), 0) FROM %I WHERE asset_id = $1', v_table_name)
    INTO v_current_version
    USING p_asset_id;
    
    v_new_version := v_current_version + 1;

    -- First, set all existing records for this asset to is_current = false
    EXECUTE format('UPDATE %I SET is_current = false WHERE asset_id = $1 AND is_current = true', v_table_name)
    USING p_asset_id;

    -- Then insert the new record with is_current = true
    EXECUTE format('
      INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by)
      VALUES ($1, $2, $3, true, $4, $5)
    ', v_table_name)
    USING p_asset_id, p_content, v_new_version, v_created_by, v_updated_by;

    -- Commit the transaction to finalize the deferred constraint check
    COMMIT;

    -- Return success result
    v_result := jsonb_build_object(
      'success', true,
      'version', v_new_version,
      'content_type', p_content_type,
      'asset_id', p_asset_id
    );

    RETURN v_result;

  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback on any error
      ROLLBACK;
      RAISE EXCEPTION 'Failed to update % content: %', p_content_type, SQLERRM;
  END;
END;
$$;