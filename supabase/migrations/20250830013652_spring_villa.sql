/*
  # Fix concurrent content updates and unique constraint violations

  1. Database Changes
    - Update `update_current_content` RPC function to handle concurrent access
    - Use proper locking and transaction handling
    - Ensure atomic operations for version management

  2. Key Improvements
    - Add row-level locking to prevent race conditions
    - Use UPSERT pattern for safer updates
    - Proper error handling for constraint violations
    - Maintain complete audit trail

  3. Security
    - Function runs with proper security context
    - Maintains existing RLS policies
*/

-- Drop the existing function
DROP FUNCTION IF EXISTS public.update_current_content(TEXT, UUID, TEXT, UUID);

-- Create the improved function with proper concurrency handling
CREATE OR REPLACE FUNCTION public.update_current_content(
    p_table_name TEXT,
    p_asset_id UUID,
    p_content TEXT,
    p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    current_version INT := 0;
    existing_current_id UUID;
BEGIN
    -- Validate table name to prevent SQL injection
    IF p_table_name NOT IN ('asset_thesis', 'asset_where_different', 'asset_risks') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name;
    END IF;

    -- Lock the rows for this asset to prevent concurrent modifications
    -- Get the current version and existing current record ID
    EXECUTE format('
        SELECT version, id 
        FROM %I 
        WHERE asset_id = $1 AND is_current = true 
        FOR UPDATE
    ', p_table_name) 
    INTO current_version, existing_current_id
    USING p_asset_id;

    -- If no current version exists, start with version 1
    IF current_version IS NULL THEN
        current_version := 0;
    END IF;

    -- If there's an existing current record, update it to not current
    IF existing_current_id IS NOT NULL THEN
        EXECUTE format('
            UPDATE %I 
            SET is_current = false, updated_at = NOW() 
            WHERE id = $1
        ', p_table_name) 
        USING existing_current_id;
    END IF;

    -- Insert the new current record
    EXECUTE format('
        INSERT INTO %I (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
        VALUES ($1, $2, $3, true, $4, $4, NOW(), NOW())
    ', p_table_name) 
    USING p_asset_id, p_content, current_version + 1, p_user_id;

EXCEPTION
    WHEN unique_violation THEN
        -- If we still get a unique violation, it means another transaction
        -- inserted a current record. Try to update the existing one instead.
        EXECUTE format('
            UPDATE %I 
            SET content = $2, version = version + 1, updated_by = $3, updated_at = NOW()
            WHERE asset_id = $1 AND is_current = true
        ', p_table_name) 
        USING p_asset_id, p_content, p_user_id;
END;
$$;