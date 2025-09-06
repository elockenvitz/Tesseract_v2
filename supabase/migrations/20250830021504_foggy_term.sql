/*
  # Recreate content update functions with proper atomic operations

  1. Functions Updated
    - `update_asset_thesis_content` - Handles asset thesis updates
    - `update_asset_where_different_content` - Handles where different updates  
    - `update_asset_risks_content` - Handles risks to thesis updates

  2. Key Changes
    - Use SECURITY DEFINER to bypass RLS when updating is_current flags
    - Properly handle atomic operations within transactions
    - First mark existing records as not current, then insert new record
    - Handle case where no existing record exists

  3. Security
    - Functions run with elevated privileges to manage is_current flags
    - Only authenticated users can execute these functions
    - Proper error handling and rollback on failure
*/

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS public.update_asset_thesis_content(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.update_asset_where_different_content(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.update_asset_risks_content(uuid, text, uuid);

-- Create update_asset_thesis_content function
CREATE OR REPLACE FUNCTION public.update_asset_thesis_content(
  p_asset_id uuid,
  p_content text,
  p_updated_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- First, mark any existing current record as not current
  UPDATE public.asset_thesis 
  SET is_current = false, updated_at = now()
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Then insert the new record as current
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
    COALESCE((
      SELECT MAX(version) + 1 
      FROM public.asset_thesis 
      WHERE asset_id = p_asset_id
    ), 1),
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
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- First, mark any existing current record as not current
  UPDATE public.asset_where_different 
  SET is_current = false, updated_at = now()
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Then insert the new record as current
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
    COALESCE((
      SELECT MAX(version) + 1 
      FROM public.asset_where_different 
      WHERE asset_id = p_asset_id
    ), 1),
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
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- First, mark any existing current record as not current
  UPDATE public.asset_risks 
  SET is_current = false, updated_at = now()
  WHERE asset_id = p_asset_id AND is_current = true;
  
  -- Then insert the new record as current
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
    COALESCE((
      SELECT MAX(version) + 1 
      FROM public.asset_risks 
      WHERE asset_id = p_asset_id
    ), 1),
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