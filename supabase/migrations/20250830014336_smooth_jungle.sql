/*
  # Fix RPC function transaction control

  1. Changes
    - Remove explicit BEGIN/COMMIT/ROLLBACK statements from update_current_content function
    - Supabase RPC calls automatically wrap functions in transactions
    - Keep the logic but let Supabase handle transaction management

  2. Security
    - Maintains existing RLS policies
    - Preserves all existing functionality
*/

CREATE OR REPLACE FUNCTION update_current_content(
  p_table_name text,
  p_asset_id uuid,
  p_content text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_record record;
  v_new_version integer := 1;
  v_result jsonb;
BEGIN
  -- Validate table name
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Lock existing current record to prevent race conditions
  EXECUTE format('
    SELECT version, content, id 
    FROM %I 
    WHERE asset_id = $1 AND is_current = true 
    FOR UPDATE
  ', p_table_name)
  INTO v_current_record
  USING p_asset_id;

  -- If current record exists, check if content actually changed
  IF v_current_record.id IS NOT NULL THEN
    IF v_current_record.content = p_content THEN
      -- No change needed, return existing record
      v_result := jsonb_build_object(
        'id', v_current_record.id,
        'version', v_current_record.version,
        'content', v_current_record.content,
        'is_current', true,
        'message', 'No changes detected'
      );
      RETURN v_result;
    END IF;
    
    -- Set current record to non-current and get next version
    v_new_version := v_current_record.version + 1;
    EXECUTE format('
      UPDATE %I 
      SET is_current = false, updated_at = now() 
      WHERE id = $1
    ', p_table_name)
    USING v_current_record.id;
  END IF;

  -- Insert new current record
  EXECUTE format('
    INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, $3, true, $4, $4, now(), now())
    RETURNING id, version, content, is_current
  ', p_table_name)
  INTO v_current_record
  USING p_asset_id, p_content, v_new_version, p_user_id;

  -- Build result
  v_result := jsonb_build_object(
    'id', v_current_record.id,
    'version', v_current_record.version,
    'content', v_current_record.content,
    'is_current', v_current_record.is_current,
    'message', 'Content updated successfully'
  );

  RETURN v_result;

EXCEPTION
  WHEN unique_violation THEN
    -- Fallback: update existing current record if unique violation occurs
    EXECUTE format('
      UPDATE %I 
      SET content = $2, updated_by = $3, updated_at = now()
      WHERE asset_id = $1 AND is_current = true
      RETURNING id, version, content, is_current
    ', p_table_name)
    INTO v_current_record
    USING p_asset_id, p_content, p_user_id;
    
    v_result := jsonb_build_object(
      'id', v_current_record.id,
      'version', v_current_record.version,
      'content', v_current_record.content,
      'is_current', v_current_record.is_current,
      'message', 'Content updated (fallback)'
    );
    
    RETURN v_result;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to update content: %', SQLERRM;
END;
$$;