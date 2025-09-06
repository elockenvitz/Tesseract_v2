/*
  # Fix unique constraint error for content update functions

  1. Security Changes
    - Alter content update functions to use SECURITY DEFINER
    - This allows functions to bypass RLS policies when updating is_current flags
    - Prevents "duplicate key value violates unique constraint" errors

  2. Functions Modified
    - update_asset_thesis_content
    - update_asset_where_different_content  
    - update_asset_risks_content

  3. Why This Fixes The Issue
    - RLS policies were preventing functions from updating records created by other users
    - SECURITY DEFINER allows functions to run with elevated privileges
    - Functions can now properly mark old records as is_current = false before inserting new ones
*/

-- Alter the content update functions to use SECURITY DEFINER
-- This allows them to bypass RLS policies when updating is_current flags

ALTER FUNCTION public.update_asset_thesis_content(uuid, text, uuid) SECURITY DEFINER;
ALTER FUNCTION public.update_asset_where_different_content(uuid, text, uuid) SECURITY DEFINER;
ALTER FUNCTION public.update_asset_risks_content(uuid, text, uuid) SECURITY DEFINER;

-- Set proper ownership and permissions for security
ALTER FUNCTION public.update_asset_thesis_content(uuid, text, uuid) OWNER TO supabase_admin;
ALTER FUNCTION public.update_asset_where_different_content(uuid, text, uuid) OWNER TO supabase_admin;
ALTER FUNCTION public.update_asset_risks_content(uuid, text, uuid) OWNER TO supabase_admin;

-- Revoke public access and grant only to authenticated users
REVOKE EXECUTE ON FUNCTION public.update_asset_thesis_content(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_asset_where_different_content(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_asset_risks_content(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_asset_thesis_content(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_asset_where_different_content(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_asset_risks_content(uuid, text, uuid) TO authenticated;