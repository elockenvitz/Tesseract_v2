/*
  # Fix update_asset_content function to handle unique constraints

  1. Function Updates
    - Update `update_asset_content` function to properly handle unique constraints
    - Set existing current records to false before inserting new current records
    - Handle all three content tables: asset_thesis, asset_where_different, asset_risks

  2. Security
    - Maintain SECURITY DEFINER to bypass RLS policies
    - Ensure proper error handling and transaction safety
*/

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
  current_record record;
  new_version integer := 1;
BEGIN
  -- Validate table name
  IF p_table NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table;
  END IF;

  -- Get current record if it exists
  EXECUTE format('
    SELECT * FROM %I 
    WHERE asset_id = $1 AND is_current = true
  ', p_table) 
  INTO current_record
  USING p_asset_id;

  -- If content hasn't changed, do nothing
  IF current_record IS NOT NULL AND current_record.content = p_content THEN
    RETURN;
  END IF;

  -- If current record exists, archive it and increment version
  IF current_record IS NOT NULL THEN
    -- Set current record to not current
    EXECUTE format('
      UPDATE %I 
      SET is_current = false, updated_at = now()
      WHERE id = $1
    ', p_table)
    USING current_record.id;
    
    new_version := current_record.version + 1;
  END IF;

  -- Insert new current record
  EXECUTE format('
    INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, $3, true, $4, $4, now(), now())
  ', p_table)
  USING p_asset_id, p_content, new_version, p_updated_by;

END;
$$;