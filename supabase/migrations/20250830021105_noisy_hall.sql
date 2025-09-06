/*
  # Fix unique constraint violations for content update functions

  1. Problem
    - Functions are failing with "duplicate key value violates unique constraint unique_current_thesis"
    - This happens because we're trying to insert a new record with is_current=true while another exists

  2. Solution
    - Use proper atomic operations within transactions
    - Update existing current record to is_current=false FIRST
    - Then insert new record with is_current=true
    - Handle all operations in a single transaction to prevent race conditions

  3. Security
    - Functions run with SECURITY DEFINER to bypass RLS when needed
    - Only authenticated users can execute these functions
*/

-- Drop and recreate the functions with proper atomic operations
DROP FUNCTION IF EXISTS public.update_asset_thesis_content(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.update_asset_where_different_content(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.update_asset_risks_content(uuid, text, uuid);

-- Function to update asset thesis content atomically
CREATE OR REPLACE FUNCTION public.update_asset_thesis_content(
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_version integer;
  v_new_id uuid;
BEGIN
  -- Start transaction is implicit in function
  
  -- First, mark all existing records for this asset as not current
  UPDATE public.asset_thesis 
  SET is_current = false, updated_at = now()
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Get the next version number
  SELECT COALESCE(MAX(version), 0) + 1 
  INTO v_new_version
  FROM public.asset_thesis 
  WHERE asset_id = p_asset_id;
  
  -- Insert new record
  INSERT INTO public.asset_thesis (
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
    v_new_version,
    true,
    p_updated_by,
    p_updated_by,
    now(),
    now()
  ) RETURNING id INTO v_new_id;
  
  RETURN v_new_id;
END;
$$;

-- Function to update asset where different content atomically
CREATE OR REPLACE FUNCTION public.update_asset_where_different_content(
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_version integer;
  v_new_id uuid;
BEGIN
  -- First, mark all existing records for this asset as not current
  UPDATE public.asset_where_different 
  SET is_current = false, updated_at = now()
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Get the next version number
  SELECT COALESCE(MAX(version), 0) + 1 
  INTO v_new_version
  FROM public.asset_where_different 
  WHERE asset_id = p_asset_id;
  
  -- Insert new record
  INSERT INTO public.asset_where_different (
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
    v_new_version,
    true,
    p_updated_by,
    p_updated_by,
    now(),
    now()
  ) RETURNING id INTO v_new_id;
  
  RETURN v_new_id;
END;
$$;

-- Function to update asset risks content atomically
CREATE OR REPLACE FUNCTION public.update_asset_risks_content(
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_version integer;
  v_new_id uuid;
BEGIN
  -- First, mark all existing records for this asset as not current
  UPDATE public.asset_risks 
  SET is_current = false, updated_at = now()
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Get the next version number
  SELECT COALESCE(MAX(version), 0) + 1 
  INTO v_new_version
  FROM public.asset_risks 
  WHERE asset_id = p_asset_id;
  
  -- Insert new record
  INSERT INTO public.asset_risks (
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
    v_new_version,
    true,
    p_updated_by,
    p_updated_by,
    now(),
    now()
  ) RETURNING id INTO v_new_id;
  
  RETURN v_new_id;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.update_asset_thesis_content(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_asset_where_different_content(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_asset_risks_content(uuid, text, uuid) TO authenticated;