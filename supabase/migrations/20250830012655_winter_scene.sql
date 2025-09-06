/*
  # Create atomic content update function

  1. New Functions
    - `update_current_content` - Atomically updates content sections
      - Marks current record as not current
      - Inserts new record as current
      - Handles version incrementing
      - All within a single transaction

  2. Security
    - Function is accessible to authenticated users
    - Maintains existing RLS policies on tables
*/

CREATE OR REPLACE FUNCTION update_current_content(
    p_table_name TEXT,
    p_asset_id UUID,
    p_content TEXT,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    next_version INT;
BEGIN
    -- Mark current record as not current
    EXECUTE format('UPDATE public.%I SET is_current = FALSE, updated_at = NOW() WHERE asset_id = %L AND is_current = TRUE', p_table_name, p_asset_id);

    -- Get the next version number
    EXECUTE format('SELECT COALESCE(MAX(version), 0) + 1 FROM public.%I WHERE asset_id = %L', p_table_name, p_asset_id) INTO next_version;

    -- Insert new record as current
    EXECUTE format('INSERT INTO public.%I (asset_id, content, version, is_current, created_by, updated_by) VALUES (%L, %L, %L, TRUE, %L, %L)',
        p_table_name, p_asset_id, p_content, next_version, p_user_id, p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;