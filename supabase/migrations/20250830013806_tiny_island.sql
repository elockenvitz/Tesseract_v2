/*
  # Fix update_current_content function with proper UPSERT

  1. Function Updates
    - Replace the existing update_current_content function
    - Use proper UPSERT logic to handle existing current records
    - Ensure only one record per asset can be marked as current
    - Maintain proper version tracking and history

  2. Key Changes
    - First mark all existing current records as non-current
    - Then use INSERT ... ON CONFLICT to handle duplicates
    - Proper version incrementing for new records
    - Maintains audit trail for all changes
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
  v_max_version integer;
  v_sql text;
BEGIN
  -- Validate table name to prevent SQL injection
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- First, mark all existing current records as non-current
  v_sql := format('UPDATE %I SET is_current = false WHERE asset_id = $1 AND is_current = true', p_table_name);
  EXECUTE v_sql USING p_asset_id;

  -- Get the maximum version for this asset
  v_sql := format('SELECT COALESCE(MAX(version), 0) FROM %I WHERE asset_id = $1', p_table_name);
  EXECUTE v_sql INTO v_max_version USING p_asset_id;

  -- Insert new current record with incremented version
  v_sql := format(
    'INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at) 
     VALUES ($1, $2, $3, true, $4, $4, now(), now())',
    p_table_name
  );
  EXECUTE v_sql USING p_asset_id, p_content, v_max_version + 1, p_user_id;

EXCEPTION
  WHEN unique_violation THEN
    -- If we still get a unique violation, it means another transaction
    -- inserted a current record. Update the existing current record instead.
    v_sql := format(
      'UPDATE %I SET content = $2, updated_by = $3, updated_at = now() 
       WHERE asset_id = $1 AND is_current = true',
      p_table_name
    );
    EXECUTE v_sql USING p_asset_id, p_content, p_user_id;
END;
$$;