-- ══════════════════════════════════════════════════════════════════════
-- Lists Elite · Phase 2: brief RPC + activity events for list governance
-- ══════════════════════════════════════════════════════════════════════
-- 1. Fix brief column type (jsonb → text) to match RichTextEditor's
--    HTML convention used throughout the app.
-- 2. Add update_list_brief() RPC so write-collaborators can edit the brief
--    (asset_lists UPDATE policy remains owner-only for governance fields).
-- 3. Extend log_list_metadata_activity() trigger to fire structured events
--    for lifecycle and deadline changes (owner-driven through normal UPDATE).
-- ══════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────
-- 1. Fix brief column type
-- ──────────────────────────────────────────────────────────────────────
-- No existing rows have brief populated (Phase 1 just landed), so
-- a clean drop+add is safe and avoids any cast gymnastics.

ALTER TABLE asset_lists DROP COLUMN brief;
ALTER TABLE asset_lists ADD COLUMN brief text;


-- ──────────────────────────────────────────────────────────────────────
-- 2. update_list_brief RPC
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_list_brief(
  p_list_id uuid,
  p_brief text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Owner OR write/admin collaborator
  SELECT EXISTS (
    SELECT 1 FROM asset_lists
      WHERE id = p_list_id AND created_by = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM asset_list_collaborations
      WHERE list_id = p_list_id
        AND user_id = auth.uid()
        AND permission IN ('write', 'admin')
  ) INTO v_is_allowed;

  IF NOT v_is_allowed THEN
    RAISE EXCEPTION 'Permission denied: cannot edit brief for list %', p_list_id;
  END IF;

  UPDATE asset_lists
  SET brief = p_brief,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = p_list_id;

  INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
  VALUES (p_list_id, auth.uid(), 'brief_updated', '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION update_list_brief(uuid, text) TO authenticated;


-- ──────────────────────────────────────────────────────────────────────
-- 3. Extend log_list_metadata_activity to cover lifecycle + deadline
-- ──────────────────────────────────────────────────────────────────────
-- Keeps the existing 'metadata_updated' event for name/description/color
-- (backward compatible) and adds separate structured events for lifecycle
-- and deadline changes.

CREATE OR REPLACE FUNCTION log_list_metadata_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  changed_fields text[] := '{}';
BEGIN
  -- Existing: basic metadata bucket
  IF OLD.name IS DISTINCT FROM NEW.name THEN changed_fields := array_append(changed_fields, 'name'); END IF;
  IF OLD.description IS DISTINCT FROM NEW.description THEN changed_fields := array_append(changed_fields, 'description'); END IF;
  IF OLD.color IS DISTINCT FROM NEW.color THEN changed_fields := array_append(changed_fields, 'color'); END IF;

  IF array_length(changed_fields, 1) > 0 THEN
    INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
    VALUES (NEW.id, auth.uid(), 'metadata_updated', jsonb_build_object('changed_fields', to_jsonb(changed_fields)));
  END IF;

  -- New: lifecycle (active → converted → archived)
  IF OLD.lifecycle IS DISTINCT FROM NEW.lifecycle THEN
    INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
    VALUES (NEW.id, auth.uid(), 'lifecycle_changed', jsonb_build_object(
      'from', OLD.lifecycle,
      'to', NEW.lifecycle
    ));
  END IF;

  -- New: deadline change
  IF OLD.deadline IS DISTINCT FROM NEW.deadline THEN
    INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
    VALUES (NEW.id, auth.uid(), 'deadline_changed', jsonb_build_object(
      'from', OLD.deadline,
      'to', NEW.deadline
    ));
  END IF;

  RETURN NEW;
END;
$$;
