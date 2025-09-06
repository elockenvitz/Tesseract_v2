/*
  # Fix unique constraint error for content update functions

  1. Problem
    - Functions are failing with "duplicate key value violates unique constraint unique_current_thesis"
    - This happens because the functions try to insert new records with is_current=true while old records still have is_current=true

  2. Solution
    - Drop and recreate all content update functions with proper atomic operations
    - Use SECURITY DEFINER to bypass RLS when updating is_current flags
    - Ensure proper transaction handling to prevent constraint violations

  3. Functions Updated
    - update_asset_thesis_content
    - update_asset_where_different_content  
    - update_asset_risks_content
*/

-- Drop existing functions first
DROP FUNCTION IF EXISTS public.update_asset_thesis_content(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.update_asset_where_different_content(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.update_asset_risks_content(uuid, text, uuid);

-- Create update_asset_thesis_content function
CREATE OR REPLACE FUNCTION public.update_asset_thesis_content(
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_version integer := 1;
BEGIN
  -- Get the next version number
  SELECT COALESCE(MAX(version), 0) + 1 
  INTO v_next_version
  FROM asset_thesis 
  WHERE asset_id = p_asset_id;

  -- First, mark all existing records as not current
  UPDATE asset_thesis 
  SET is_current = false 
  WHERE asset_id = p_asset_id AND is_current = true;

  -- Then insert the new record
  INSERT INTO asset_thesis (
    asset_id,
    content,
    version,
    is_current,
    created_by,
    updated_by,
    created_at,
    updated_at
  ) VALUES (
    p_asset_id,
    p_content,
    v_next_version,
    true,
    p_updated_by,
    p_updated_by,
    now(),
    now()
  );
END;
$$;

-- Create update_asset_where_different_content function
CREATE OR REPLACE FUNCTION public.update_asset_where_different_content(
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_version integer := 1;
BEGIN
  -- Get the next version number
  SELECT COALESCE(MAX(version), 0) + 1 
  INTO v_next_version
  FROM asset_where_different 
  WHERE asset_id = p_asset_id;

  -- First, mark all existing records as not current
  UPDATE asset_where_different 
  SET is_current = false 
  WHERE asset_id = p_asset_id AND is_current = true;

  -- Then insert the new record
  INSERT INTO asset_where_different (
    asset_id,
    content,
    version,
    is_current,
    created_by,
    updated_by,
    created_at,
    updated_at
  ) VALUES (
    p_asset_id,
    p_content,
    v_next_version,
    true,
    p_updated_by,
    p_updated_by,
    now(),
    now()
  );
END;
$$;

-- Create update_asset_risks_content function
CREATE OR REPLACE FUNCTION public.update_asset_risks_content(
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_version integer := 1;
BEGIN
  -- Get the next version number
  SELECT COALESCE(MAX(version), 0) + 1 
  INTO v_next_version
  FROM asset_risks 
  WHERE asset_id = p_asset_id;

  -- First, mark all existing records as not current
  UPDATE asset_risks 
  SET is_current = false 
  WHERE asset_id = p_asset_id AND is_current = true;

  -- Then insert the new record
  INSERT INTO asset_risks (
    asset_id,
    content,
    version,
    is_current,
    created_by,
    updated_by,
    created_at,
    updated_at
  ) VALUES (
    p_asset_id,
    p_content,
    v_next_version,
    true,
    p_updated_by,
    p_updated_by,
    now(),
    now()
  );
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.update_asset_thesis_content(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_asset_where_different_content(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_asset_risks_content(uuid, text, uuid) TO authenticated;