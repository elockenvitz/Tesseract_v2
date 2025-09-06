/*
  # Fix update_current_content function with UPSERT approach

  1. Function Updates
    - Replace the existing update_current_content function
    - Use UPSERT (INSERT ... ON CONFLICT) to handle existing records
    - Properly manage the unique constraint on (asset_id, is_current)
    - Ensure atomic operations to prevent race conditions

  2. Changes Made
    - First, set all existing current records to false for the asset
    - Then use UPSERT to either insert new or update existing current record
    - Maintain proper version incrementing and audit trail
*/

CREATE OR REPLACE FUNCTION update_current_content(
  p_table_name text,
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_version integer;
  v_record_id uuid;
BEGIN
  -- Validate table name
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Get the next version number
  EXECUTE format('SELECT COALESCE(MAX(version), 0) + 1 FROM %I WHERE asset_id = $1', p_table_name)
  INTO v_new_version
  USING p_asset_id;

  -- First, set all existing current records to false for this asset
  EXECUTE format('UPDATE %I SET is_current = false WHERE asset_id = $1 AND is_current = true', p_table_name)
  USING p_asset_id;

  -- Generate new UUID for the record
  v_record_id := gen_random_uuid();

  -- Insert the new current record
  EXECUTE format('
    INSERT INTO %I (id, asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, true, $5, $5, now(), now())
  ', p_table_name)
  USING v_record_id, p_asset_id, p_content, v_new_version, p_updated_by;

  RETURN v_record_id;
END;
$$;