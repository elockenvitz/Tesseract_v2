/*
  # Fix Asset Content Versioning System

  This migration fixes the versioning system for asset content by:

  1. **Updated RPC Function**
     - Replaces the `update_asset_content` function with proper version management
     - Handles deactivating old versions and creating new ones atomically
     - Uses SECURITY DEFINER to bypass RLS policies for internal operations

  2. **Removed Conflicting Triggers**
     - Drops the BEFORE UPDATE triggers that were causing conflicts
     - Removes the associated trigger functions
     - Centralizes all versioning logic in the RPC function

  3. **Improved Error Handling**
     - Better error messages and validation
     - Proper transaction handling within the function

  This ensures that editable fields save properly and change history reflects accurately.
*/

-- Drop existing conflicting triggers first
DROP TRIGGER IF EXISTS asset_thesis_versioning ON asset_thesis;
DROP TRIGGER IF EXISTS asset_where_different_versioning ON asset_where_different;
DROP TRIGGER IF EXISTS asset_risks_versioning ON asset_risks;

-- Drop the trigger functions (only if they exist and aren't used elsewhere)
DROP FUNCTION IF EXISTS handle_asset_field_update();
DROP FUNCTION IF EXISTS handle_asset_where_different_update();
DROP FUNCTION IF EXISTS handle_asset_risks_update();

-- Create or replace the improved update_asset_content function
CREATE OR REPLACE FUNCTION update_asset_content(
  p_table text,
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_record RECORD;
  new_version integer := 1;
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

  -- Content can be empty string but not null
  IF p_content IS NULL THEN
    p_content := '';
  END IF;

  -- Find the current active record for this asset
  EXECUTE format('
    SELECT * FROM %I 
    WHERE asset_id = $1 AND is_current = true
  ', p_table)
  INTO current_record
  USING p_asset_id;

  -- If we found a current record, deactivate it and increment version
  IF current_record IS NOT NULL THEN
    -- Deactivate the current record
    EXECUTE format('
      UPDATE %I 
      SET is_current = false, updated_at = now()
      WHERE id = $1
    ', p_table)
    USING current_record.id;
    
    -- Set new version to be one higher than current
    new_version := current_record.version + 1;
  END IF;

  -- Insert the new version as the current one
  EXECUTE format('
    INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, $3, true, $4, $4, now(), now())
  ', p_table)
  USING p_asset_id, p_content, new_version, p_updated_by;

  -- Log the operation for debugging
  RAISE NOTICE 'Updated % for asset % with version %', p_table, p_asset_id, new_version;

EXCEPTION
  WHEN OTHERS THEN
    -- Log the error details
    RAISE NOTICE 'Error in update_asset_content: % - %', SQLSTATE, SQLERRM;
    -- Re-raise the exception
    RAISE;
END;
$$;