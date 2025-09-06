/*
  # Fix RPC function to handle deferred unique constraint

  1. Updates
    - Modified update_current_content RPC function to properly handle deferred unique constraints
    - Uses explicit transaction control with SET CONSTRAINTS to handle timing
    - Ensures proper version incrementing and history tracking
    
  2. Changes
    - Added explicit constraint deferral within transaction
    - Improved error handling for concurrent access
    - Maintains atomic operations for content updates
*/

-- Drop the existing function
DROP FUNCTION IF EXISTS update_current_content(text, uuid, text, uuid);

-- Create the improved RPC function
CREATE OR REPLACE FUNCTION update_current_content(
  p_table_name text,
  p_asset_id uuid,
  p_content text,
  p_user_id uuid
) RETURNS void AS $$
DECLARE
  v_next_version integer;
  v_constraint_name text;
BEGIN
  -- Determine the constraint name based on table
  CASE p_table_name
    WHEN 'asset_thesis' THEN
      v_constraint_name := 'unique_current_thesis';
    WHEN 'asset_where_different' THEN
      v_constraint_name := 'unique_current_where_different';
    WHEN 'asset_risks' THEN
      v_constraint_name := 'unique_current_risks';
    ELSE
      RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END CASE;

  -- Start explicit transaction with deferred constraints
  BEGIN
    -- Defer the unique constraint to end of transaction
    EXECUTE format('SET CONSTRAINTS %I DEFERRED', v_constraint_name);
    
    -- Get the next version number
    EXECUTE format('SELECT COALESCE(MAX(version), 0) + 1 FROM %I WHERE asset_id = $1', p_table_name)
    INTO v_next_version
    USING p_asset_id;
    
    -- First, update existing current record to false
    EXECUTE format('UPDATE %I SET is_current = false WHERE asset_id = $1 AND is_current = true', p_table_name)
    USING p_asset_id;
    
    -- Then insert the new current record
    EXECUTE format('
      INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
      VALUES ($1, $2, $3, true, $4, $4, now(), now())
    ', p_table_name)
    USING p_asset_id, p_content, v_next_version, p_user_id;
    
    -- Commit the transaction (constraints will be checked here)
    COMMIT;
    
  EXCEPTION
    WHEN unique_violation THEN
      -- If we still get a unique violation, fall back to updating existing record
      ROLLBACK;
      
      -- Try to update the existing current record instead
      EXECUTE format('
        UPDATE %I 
        SET content = $2, updated_by = $3, updated_at = now()
        WHERE asset_id = $1 AND is_current = true
      ', p_table_name)
      USING p_asset_id, p_content, p_user_id;
      
      -- If no current record exists, insert one
      IF NOT FOUND THEN
        EXECUTE format('
          INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
          VALUES ($1, $2, 1, true, $3, $3, now(), now())
        ', p_table_name)
        USING p_asset_id, p_content, p_user_id;
      END IF;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;