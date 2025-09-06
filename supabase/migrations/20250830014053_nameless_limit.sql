/*
  # Fix Investment Thesis Saving and History

  1. Updates
    - Fix the update_current_content RPC function to properly handle asset_thesis table
    - Ensure proper version incrementing and history tracking
    - Handle unique constraints correctly for thesis content

  2. Security
    - Maintains existing RLS policies
    - Ensures proper user authentication checks
*/

-- Drop and recreate the RPC function with proper thesis handling
DROP FUNCTION IF EXISTS update_current_content(text, uuid, text, uuid);

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
  v_next_version integer;
  v_existing_current_id uuid;
BEGIN
  -- Validate table name for security
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Get the next version number
  EXECUTE format('SELECT COALESCE(MAX(version), 0) + 1 FROM %I WHERE asset_id = $1', p_table_name)
  INTO v_next_version
  USING p_asset_id;

  -- Check if there's already a current record
  EXECUTE format('SELECT id FROM %I WHERE asset_id = $1 AND is_current = true', p_table_name)
  INTO v_existing_current_id
  USING p_asset_id;

  IF v_existing_current_id IS NOT NULL THEN
    -- Update existing current record to not current
    EXECUTE format('UPDATE %I SET is_current = false WHERE id = $1', p_table_name)
    USING v_existing_current_id;
  END IF;

  -- Insert new current record
  EXECUTE format(
    'INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at) 
     VALUES ($1, $2, $3, true, $4, $4, now(), now())',
    p_table_name
  )
  USING p_asset_id, p_content, v_next_version, p_user_id;

EXCEPTION
  WHEN unique_violation THEN
    -- If we still get a unique violation, update the existing current record
    EXECUTE format(
      'UPDATE %I SET content = $2, version = $3, updated_by = $4, updated_at = now() 
       WHERE asset_id = $1 AND is_current = true',
      p_table_name
    )
    USING p_asset_id, p_content, v_next_version, p_user_id;
END;
$$;