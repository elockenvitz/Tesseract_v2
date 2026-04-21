-- ══════════════════════════════════════════════════════════════════════
-- Lists Elite · Phase 3A: activity triggers for row-level structured events
-- ══════════════════════════════════════════════════════════════════════
-- 1. Extend log_list_item_activity to fire on UPDATE for:
--    status_changed, assignee_changed, due_date_changed, flagged, unflagged
-- 2. Bind the trigger to UPDATE (in addition to existing INSERT/DELETE)
-- 3. New trigger log_list_item_tag_activity on list_item_tags for
--    tag_added / tag_removed
-- ══════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────
-- 1. Extend log_list_item_activity function
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_list_item_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_symbol         text;
  v_from_status    text;
  v_to_status      text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT symbol INTO v_symbol FROM assets WHERE id = NEW.asset_id;
    INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
    VALUES (NEW.list_id, auth.uid(), 'item_added', jsonb_build_object(
      'asset_id',     NEW.asset_id,
      'asset_symbol', COALESCE(v_symbol, 'Unknown')
    ));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT symbol INTO v_symbol FROM assets WHERE id = OLD.asset_id;
    INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
    VALUES (OLD.list_id, auth.uid(), 'item_removed', jsonb_build_object(
      'asset_id',     OLD.asset_id,
      'asset_symbol', COALESCE(v_symbol, 'Unknown')
    ));
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Lazily resolve symbol only if any relevant field changed
    IF OLD.status_id IS DISTINCT FROM NEW.status_id
       OR OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
       OR OLD.due_date IS DISTINCT FROM NEW.due_date
       OR OLD.is_flagged IS DISTINCT FROM NEW.is_flagged
    THEN
      SELECT symbol INTO v_symbol FROM assets WHERE id = NEW.asset_id;
    END IF;

    -- Status changed
    IF OLD.status_id IS DISTINCT FROM NEW.status_id THEN
      SELECT name INTO v_from_status FROM list_statuses WHERE id = OLD.status_id;
      SELECT name INTO v_to_status   FROM list_statuses WHERE id = NEW.status_id;
      INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
      VALUES (NEW.list_id, auth.uid(), 'status_changed', jsonb_build_object(
        'asset_id',        NEW.asset_id,
        'asset_symbol',    COALESCE(v_symbol, 'Unknown'),
        'from_status_id',  OLD.status_id,
        'to_status_id',    NEW.status_id,
        'from_status',     v_from_status,
        'to_status',       v_to_status
      ));
    END IF;

    -- Assignee changed
    IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
      INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
      VALUES (NEW.list_id, auth.uid(), 'assignee_changed', jsonb_build_object(
        'asset_id',          NEW.asset_id,
        'asset_symbol',      COALESCE(v_symbol, 'Unknown'),
        'from_assignee_id',  OLD.assignee_id,
        'to_assignee_id',    NEW.assignee_id
      ));
    END IF;

    -- Due date changed
    IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
      INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
      VALUES (NEW.list_id, auth.uid(), 'due_date_changed', jsonb_build_object(
        'asset_id',     NEW.asset_id,
        'asset_symbol', COALESCE(v_symbol, 'Unknown'),
        'from',         OLD.due_date,
        'to',           NEW.due_date
      ));
    END IF;

    -- Flagged / unflagged
    IF OLD.is_flagged IS DISTINCT FROM NEW.is_flagged THEN
      INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
      VALUES (NEW.list_id, auth.uid(),
        CASE WHEN NEW.is_flagged THEN 'flagged' ELSE 'unflagged' END,
        jsonb_build_object(
          'asset_id',     NEW.asset_id,
          'asset_symbol', COALESCE(v_symbol, 'Unknown')
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;


-- ──────────────────────────────────────────────────────────────────────
-- 2. Bind trigger to UPDATE as well
-- ──────────────────────────────────────────────────────────────────────
-- Existing triggers cover INSERT + DELETE (two separate triggers sharing
-- the same function). Add a third trigger for UPDATE.

DROP TRIGGER IF EXISTS log_list_item_activity_update ON asset_list_items;

CREATE TRIGGER log_list_item_activity_update
  AFTER UPDATE ON asset_list_items
  FOR EACH ROW EXECUTE FUNCTION log_list_item_activity();


-- ──────────────────────────────────────────────────────────────────────
-- 3. New trigger: list_item_tags → tag_added / tag_removed
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_list_item_tag_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_list_id   uuid;
  v_asset_id  uuid;
  v_symbol    text;
  v_tag_name  text;
  v_tag_color text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT list_id, asset_id INTO v_list_id, v_asset_id
      FROM asset_list_items WHERE id = NEW.list_item_id;
    SELECT symbol INTO v_symbol FROM assets WHERE id = v_asset_id;
    SELECT name, color INTO v_tag_name, v_tag_color FROM list_tags WHERE id = NEW.tag_id;

    IF v_list_id IS NOT NULL THEN
      INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
      VALUES (v_list_id, auth.uid(), 'tag_added', jsonb_build_object(
        'asset_id',     v_asset_id,
        'asset_symbol', COALESCE(v_symbol, 'Unknown'),
        'tag_id',       NEW.tag_id,
        'tag_name',     v_tag_name,
        'tag_color',    v_tag_color
      ));
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT list_id, asset_id INTO v_list_id, v_asset_id
      FROM asset_list_items WHERE id = OLD.list_item_id;
    SELECT symbol INTO v_symbol FROM assets WHERE id = v_asset_id;
    SELECT name, color INTO v_tag_name, v_tag_color FROM list_tags WHERE id = OLD.tag_id;

    IF v_list_id IS NOT NULL THEN
      INSERT INTO asset_list_activity (list_id, actor_id, activity_type, metadata)
      VALUES (v_list_id, auth.uid(), 'tag_removed', jsonb_build_object(
        'asset_id',     v_asset_id,
        'asset_symbol', COALESCE(v_symbol, 'Unknown'),
        'tag_id',       OLD.tag_id,
        'tag_name',     v_tag_name,
        'tag_color',    v_tag_color
      ));
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_list_item_tag_activity_insert ON list_item_tags;
DROP TRIGGER IF EXISTS log_list_item_tag_activity_delete ON list_item_tags;

CREATE TRIGGER log_list_item_tag_activity_insert
  AFTER INSERT ON list_item_tags
  FOR EACH ROW EXECUTE FUNCTION log_list_item_tag_activity();

CREATE TRIGGER log_list_item_tag_activity_delete
  AFTER DELETE ON list_item_tags
  FOR EACH ROW EXECUTE FUNCTION log_list_item_tag_activity();
