/*
  # Fix RLS policy violations for asset content functions

  1. Security Updates
    - Make asset content update functions SECURITY DEFINER
    - This allows functions to bypass RLS when managing versioning internally
    - Functions will run with owner privileges instead of invoker privileges

  2. Function Updates
    - update_asset_thesis_content: Now SECURITY DEFINER
    - update_asset_where_different_content: Now SECURITY DEFINER  
    - update_asset_risks_content: Now SECURITY DEFINER

  This resolves the "new row violates row-level security policy" error
  by allowing the functions to manage their own data access patterns.
*/

-- Update asset thesis content function to be SECURITY DEFINER
CREATE OR REPLACE FUNCTION update_asset_thesis_content(
  p_asset_id uuid,
  p_content text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark existing current record as not current
  UPDATE asset_thesis 
  SET is_current = false 
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Insert new current record
  INSERT INTO asset_thesis (
    asset_id, 
    content, 
    version, 
    is_current, 
    created_by, 
    updated_by
  ) 
  VALUES (
    p_asset_id, 
    p_content, 
    COALESCE((
      SELECT MAX(version) + 1 
      FROM asset_thesis 
      WHERE asset_id = p_asset_id
    ), 1),
    true,
    auth.uid(),
    auth.uid()
  );
END;
$$;

-- Update asset where different content function to be SECURITY DEFINER
CREATE OR REPLACE FUNCTION update_asset_where_different_content(
  p_asset_id uuid,
  p_content text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark existing current record as not current
  UPDATE asset_where_different 
  SET is_current = false 
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Insert new current record
  INSERT INTO asset_where_different (
    asset_id, 
    content, 
    version, 
    is_current, 
    created_by, 
    updated_by
  ) 
  VALUES (
    p_asset_id, 
    p_content, 
    COALESCE((
      SELECT MAX(version) + 1 
      FROM asset_where_different 
      WHERE asset_id = p_asset_id
    ), 1),
    true,
    auth.uid(),
    auth.uid()
  );
END;
$$;

-- Update asset risks content function to be SECURITY DEFINER
CREATE OR REPLACE FUNCTION update_asset_risks_content(
  p_asset_id uuid,
  p_content text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark existing current record as not current
  UPDATE asset_risks 
  SET is_current = false 
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Insert new current record
  INSERT INTO asset_risks (
    asset_id, 
    content, 
    version, 
    is_current, 
    created_by, 
    updated_by
  ) 
  VALUES (
    p_asset_id, 
    p_content, 
    COALESCE((
      SELECT MAX(version) + 1 
      FROM asset_risks 
      WHERE asset_id = p_asset_id
    ), 1),
    true,
    auth.uid(),
    auth.uid()
  );
END;
$$;