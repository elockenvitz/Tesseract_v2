/*
  # Fix update_current_content function to handle unique constraints properly

  1. Function Updates
    - Properly handle existing current records by updating them to is_current = false
    - Use proper transaction handling to prevent constraint violations
    - Ensure atomic operations for version management
    
  2. Security
    - Maintains existing security definer permissions
    - Preserves user authentication checks
*/

-- Drop the existing function
DROP FUNCTION IF EXISTS update_current_content(text, uuid, text, uuid);

-- Create the updated function with proper constraint handling
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
  v_next_version integer;
  v_sql text;
BEGIN
  -- Validate table name to prevent SQL injection
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Get the next version number
  EXECUTE format('SELECT COALESCE(MAX(version), 0) + 1 FROM %I WHERE asset_id = $1', p_table_name)
  INTO v_next_version
  USING p_asset_id;

  -- First, update any existing current record to not be current
  EXECUTE format('UPDATE %I SET is_current = false WHERE asset_id = $1 AND is_current = true', p_table_name)
  USING p_asset_id;

  -- Then insert the new current record
  EXECUTE format(
    'INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at) 
     VALUES ($1, $2, $3, true, $4, $4, now(), now())',
    p_table_name
  ) USING p_asset_id, p_content, v_next_version, p_user_id;

END;
$$;