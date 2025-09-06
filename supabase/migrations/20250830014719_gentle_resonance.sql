/*
  # Fix RPC function with proper UPSERT logic

  1. Updates
    - Replace `update_content_simple` RPC function with proper UPSERT logic
    - Check for existing current records and update them instead of inserting duplicates
    - Handle all three content tables: asset_thesis, asset_where_different, asset_risks
    - Maintain proper version tracking and change history

  2. Logic
    - First check if a current record exists for the asset
    - If exists: update the existing record with new content and increment version
    - If not exists: insert new record as current with version 1
    - Properly handle the unique constraints without violations
*/

CREATE OR REPLACE FUNCTION update_content_simple(
  p_asset_id uuid,
  p_table_name text,
  p_content text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_existing_id uuid;
  v_current_version integer;
  v_new_version integer;
BEGIN
  -- Validate table name
  IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Check for existing current record
  IF p_table_name = 'asset_thesis' THEN
    SELECT id, version INTO v_existing_id, v_current_version
    FROM asset_thesis 
    WHERE asset_id = p_asset_id AND is_current = true;
  ELSIF p_table_name = 'asset_where_different' THEN
    SELECT id, version INTO v_existing_id, v_current_version
    FROM asset_where_different 
    WHERE asset_id = p_asset_id AND is_current = true;
  ELSIF p_table_name = 'asset_risks' THEN
    SELECT id, version INTO v_existing_id, v_current_version
    FROM asset_risks 
    WHERE asset_id = p_asset_id AND is_current = true;
  END IF;

  -- Calculate new version
  v_new_version := COALESCE(v_current_version, 0) + 1;

  -- Update existing record or insert new one
  IF v_existing_id IS NOT NULL THEN
    -- Update existing current record
    IF p_table_name = 'asset_thesis' THEN
      UPDATE asset_thesis 
      SET content = p_content, 
          version = v_new_version,
          updated_at = now(),
          updated_by = p_user_id
      WHERE id = v_existing_id;
    ELSIF p_table_name = 'asset_where_different' THEN
      UPDATE asset_where_different 
      SET content = p_content, 
          version = v_new_version,
          updated_at = now(),
          updated_by = p_user_id
      WHERE id = v_existing_id;
    ELSIF p_table_name = 'asset_risks' THEN
      UPDATE asset_risks 
      SET content = p_content, 
          version = v_new_version,
          updated_at = now(),
          updated_by = p_user_id
      WHERE id = v_existing_id;
    END IF;
  ELSE
    -- Insert new current record
    IF p_table_name = 'asset_thesis' THEN
      INSERT INTO asset_thesis (asset_id, content, version, is_current, created_by, updated_by)
      VALUES (p_asset_id, p_content, v_new_version, true, p_user_id, p_user_id);
    ELSIF p_table_name = 'asset_where_different' THEN
      INSERT INTO asset_where_different (asset_id, content, version, is_current, created_by, updated_by)
      VALUES (p_asset_id, p_content, v_new_version, true, p_user_id, p_user_id);
    ELSIF p_table_name = 'asset_risks' THEN
      INSERT INTO asset_risks (asset_id, content, version, is_current, created_by, updated_by)
      VALUES (p_asset_id, p_content, v_new_version, true, p_user_id, p_user_id);
    END IF;
  END IF;

  -- Return success result
  v_result := jsonb_build_object(
    'success', true,
    'message', 'Content updated successfully',
    'version', v_new_version,
    'operation', CASE WHEN v_existing_id IS NOT NULL THEN 'update' ELSE 'insert' END
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to update content: %', SQLERRM;
END;
$$;