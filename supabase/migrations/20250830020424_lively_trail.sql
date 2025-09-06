/*
  # Fix Investment Thesis Atomic Updates

  1. New Functions
    - `update_asset_thesis_content` - Atomically updates asset thesis content
    - `update_asset_where_different_content` - Atomically updates where different content  
    - `update_asset_risks_content` - Atomically updates risks content

  2. Purpose
    - Prevents unique constraint violations by performing mark-old and insert-new operations atomically
    - Ensures proper version incrementing within a single transaction
    - Maintains data integrity for content versioning
*/

-- Function to atomically update asset thesis content
CREATE OR REPLACE FUNCTION public.update_asset_thesis_content(
    p_asset_id uuid,
    p_content text,
    p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_version integer;
BEGIN
    -- Mark the current active thesis for this asset as not current
    UPDATE public.asset_thesis
    SET is_current = FALSE, updated_at = NOW()
    WHERE asset_id = p_asset_id AND is_current = TRUE;

    -- Get the highest version number for this asset's thesis records
    SELECT COALESCE(MAX(version), 0) + 1
    FROM public.asset_thesis
    WHERE asset_id = p_asset_id
    INTO v_next_version;

    -- Insert the new thesis record with is_current = TRUE
    INSERT INTO public.asset_thesis (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES (p_asset_id, p_content, v_next_version, TRUE, p_user_id, p_user_id, NOW(), NOW());
END;
$$;

-- Function to atomically update asset where different content
CREATE OR REPLACE FUNCTION public.update_asset_where_different_content(
    p_asset_id uuid,
    p_content text,
    p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_version integer;
BEGIN
    -- Mark the current active where different for this asset as not current
    UPDATE public.asset_where_different
    SET is_current = FALSE, updated_at = NOW()
    WHERE asset_id = p_asset_id AND is_current = TRUE;

    -- Get the highest version number for this asset's where different records
    SELECT COALESCE(MAX(version), 0) + 1
    FROM public.asset_where_different
    WHERE asset_id = p_asset_id
    INTO v_next_version;

    -- Insert the new where different record with is_current = TRUE
    INSERT INTO public.asset_where_different (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES (p_asset_id, p_content, v_next_version, TRUE, p_user_id, p_user_id, NOW(), NOW());
END;
$$;

-- Function to atomically update asset risks content
CREATE OR REPLACE FUNCTION public.update_asset_risks_content(
    p_asset_id uuid,
    p_content text,
    p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_version integer;
BEGIN
    -- Mark the current active risks for this asset as not current
    UPDATE public.asset_risks
    SET is_current = FALSE, updated_at = NOW()
    WHERE asset_id = p_asset_id AND is_current = TRUE;

    -- Get the highest version number for this asset's risks records
    SELECT COALESCE(MAX(version), 0) + 1
    FROM public.asset_risks
    WHERE asset_id = p_asset_id
    INTO v_next_version;

    -- Insert the new risks record with is_current = TRUE
    INSERT INTO public.asset_risks (asset_id, content, version, is_current, created_by, updated_by, created_at, updated_at)
    VALUES (p_asset_id, p_content, v_next_version, TRUE, p_user_id, p_user_id, NOW(), NOW());
END;
$$;