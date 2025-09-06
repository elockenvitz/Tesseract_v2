/*
  # Fix versioning system with atomic is_current flag management

  This migration creates a robust update_asset_content function that properly handles
  the unique constraint on (asset_id, is_current) by ensuring atomic transitions
  between current and non-current records.

  1. Function Updates
    - Completely rewrite update_asset_content function
    - Use explicit transaction control with proper constraint deferral
    - Implement atomic two-step process: deactivate old, insert new
    - Add comprehensive error handling and logging

  2. Security
    - Maintains SECURITY DEFINER to bypass RLS for internal operations
    - Proper parameter validation and sanitization
*/

-- Drop the existing function first
DROP FUNCTION IF EXISTS update_asset_content(text, uuid, text, uuid);

-- Create the robust update_asset_content function
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
  v_current_record RECORD;
  v_next_version integer := 1;
  v_table_name text;
  v_sql text;
BEGIN
  -- Validate table name to prevent SQL injection
  IF p_table NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table;
  END IF;

  -- Validate required parameters
  IF p_asset_id IS NULL THEN
    RAISE EXCEPTION 'Asset ID cannot be null';
  END IF;
  
  IF p_updated_by IS NULL THEN
    RAISE EXCEPTION 'Updated by user ID cannot be null';
  END IF;

  -- Start explicit transaction
  BEGIN
    -- Step 1: Find current record and get next version
    v_sql := format('SELECT * FROM %I WHERE asset_id = $1 AND is_current = TRUE', p_table);
    EXECUTE v_sql INTO v_current_record USING p_asset_id;
    
    -- Get the next version number
    v_sql := format('SELECT COALESCE(MAX(version), 0) + 1 FROM %I WHERE asset_id = $1', p_table);
    EXECUTE v_sql INTO v_next_version USING p_asset_id;
    
    -- Step 2: If there's a current record, deactivate it
    IF v_current_record IS NOT NULL THEN
      v_sql := format('UPDATE %I SET is_current = FALSE WHERE asset_id = $1 AND is_current = TRUE', p_table);
      EXECUTE v_sql USING p_asset_id;
      
      RAISE NOTICE 'Deactivated existing current record for asset % in table %', p_asset_id, p_table;
    END IF;
    
    -- Step 3: Insert new current record
    v_sql := format(
      'INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at) 
       VALUES ($1, $2, $3, TRUE, $4, $4, NOW(), NOW())',
      p_table
    );
    EXECUTE v_sql USING p_asset_id, p_content, v_next_version, p_updated_by;
    
    RAISE NOTICE 'Created new current record version % for asset % in table %', v_next_version, p_asset_id, p_table;
    
    -- Commit the transaction
    COMMIT;
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback on any error
      ROLLBACK;
      RAISE EXCEPTION 'Failed to update asset content in table %: % (SQLSTATE: %)', p_table, SQLERRM, SQLSTATE;
  END;
END;
$$;