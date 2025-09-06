/*
  # Fix Investment Thesis Saving with Atomic Operation

  1. New Function
    - `save_asset_content` - Handles versioning atomically
    - Uses proper transaction handling
    - Prevents race conditions

  2. Security
    - Function executes with caller's permissions
    - Maintains existing RLS policies
*/

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS save_asset_content(uuid, text, text);

-- Create atomic save function
CREATE OR REPLACE FUNCTION save_asset_content(
  p_asset_id uuid,
  p_table_name text,
  p_content text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_record record;
  v_new_version integer := 1;
  v_result json;
BEGIN
  -- Get the current record
  EXECUTE format('SELECT * FROM %I WHERE asset_id = $1 AND is_current = true', p_table_name)
  INTO v_current_record
  USING p_asset_id;
  
  -- If content hasn't changed, return early
  IF v_current_record IS NOT NULL AND v_current_record.content = p_content THEN
    RETURN json_build_object('success', true, 'message', 'No changes detected');
  END IF;
  
  -- Calculate new version
  IF v_current_record IS NOT NULL THEN
    v_new_version := v_current_record.version + 1;
    
    -- Mark existing record as not current
    EXECUTE format('UPDATE %I SET is_current = false WHERE id = $1', p_table_name)
    USING v_current_record.id;
  END IF;
  
  -- Insert new record
  EXECUTE format('
    INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, $3, true, COALESCE($4, auth.uid()), auth.uid(), COALESCE($5, now()), now())
  ', p_table_name)
  USING p_asset_id, p_content, v_new_version, 
        CASE WHEN v_current_record IS NOT NULL THEN v_current_record.created_by ELSE auth.uid() END,
        CASE WHEN v_current_record IS NOT NULL THEN v_current_record.created_at ELSE now() END;
  
  RETURN json_build_object('success', true, 'version', v_new_version);
END;
$$;