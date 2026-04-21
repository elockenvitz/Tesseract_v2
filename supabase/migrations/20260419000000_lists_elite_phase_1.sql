-- ══════════════════════════════════════════════════════════════════════
-- Lists Elite · Phase 1: schema foundations
-- ══════════════════════════════════════════════════════════════════════
-- Adds list-level project fields (brief, lifecycle, deadline),
-- list-scoped row fields (assignee, due_date, status, is_flagged),
-- per-list taxonomies (list_statuses, list_tags, list_item_tags),
-- and extends asset_list_activity with structured event types.
--
-- DEFERRED to Phase 2:
--   - SECURITY DEFINER RPC for write-collaborators to edit `brief`
--     (asset_lists UPDATE policy is currently owner-only; a targeted RPC
--     lets collaborators edit brief without widening RLS to all columns)
-- ══════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────
-- 1. asset_lists · brief, lifecycle, deadline
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE asset_lists
  ADD COLUMN brief jsonb,
  ADD COLUMN lifecycle text NOT NULL DEFAULT 'active',
  ADD COLUMN deadline date;

ALTER TABLE asset_lists
  ADD CONSTRAINT asset_lists_lifecycle_check
  CHECK (lifecycle IN ('active', 'converted', 'archived'));


-- ──────────────────────────────────────────────────────────────────────
-- 2. list_statuses · per-list workflow taxonomy
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE list_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES asset_lists(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280',
  sort_order integer NOT NULL DEFAULT 0,
  is_default_taxonomy boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (list_id, name)
);

CREATE INDEX idx_list_statuses_list ON list_statuses(list_id, sort_order);


-- ──────────────────────────────────────────────────────────────────────
-- 3. list_tags · per-list tag taxonomy
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE list_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES asset_lists(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (list_id, name)
);

CREATE INDEX idx_list_tags_list ON list_tags(list_id);


-- ──────────────────────────────────────────────────────────────────────
-- 4. list_item_tags · many-to-many join
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE list_item_tags (
  list_item_id uuid NOT NULL REFERENCES asset_list_items(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES list_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  PRIMARY KEY (list_item_id, tag_id)
);

CREATE INDEX idx_list_item_tags_tag ON list_item_tags(tag_id);


-- ──────────────────────────────────────────────────────────────────────
-- 5. asset_list_items · assignee, due_date, status_id, is_flagged
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE asset_list_items
  ADD COLUMN assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN due_date date,
  ADD COLUMN status_id uuid REFERENCES list_statuses(id) ON DELETE SET NULL,
  ADD COLUMN is_flagged boolean NOT NULL DEFAULT false;

CREATE INDEX idx_asset_list_items_assignee ON asset_list_items(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_asset_list_items_status ON asset_list_items(status_id) WHERE status_id IS NOT NULL;


-- ──────────────────────────────────────────────────────────────────────
-- 6. asset_list_activity · extend activity_type vocabulary
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE asset_list_activity
  DROP CONSTRAINT asset_list_activity_activity_type_check;

ALTER TABLE asset_list_activity
  ADD CONSTRAINT asset_list_activity_activity_type_check
  CHECK (activity_type IN (
    -- existing
    'item_added', 'item_removed', 'metadata_updated',
    'collaborator_added', 'collaborator_removed',
    -- new · row-level structured signals
    'status_changed', 'assignee_changed', 'due_date_changed',
    'tag_added', 'tag_removed',
    'flagged', 'unflagged',
    -- new · list-level structured signals
    'brief_updated', 'deadline_changed', 'lifecycle_changed',
    -- new · suggestion outcomes
    'suggestion_accepted', 'suggestion_rejected'
  ));


-- ──────────────────────────────────────────────────────────────────────
-- 7. Seed default statuses on list creation + backfill existing lists
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_default_list_statuses()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO list_statuses (list_id, name, color, sort_order, is_default_taxonomy, created_by) VALUES
    (NEW.id, 'Watching',    '#94a3b8', 0, true, NEW.created_by),
    (NEW.id, 'Researching', '#3b82f6', 1, true, NEW.created_by),
    (NEW.id, 'Convinced',   '#10b981', 2, true, NEW.created_by),
    (NEW.id, 'Passed',      '#ef4444', 3, true, NEW.created_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER seed_default_list_statuses_on_insert
  AFTER INSERT ON asset_lists
  FOR EACH ROW EXECUTE FUNCTION seed_default_list_statuses();

-- Backfill existing lists (idempotent — skips rows that already exist)
INSERT INTO list_statuses (list_id, name, color, sort_order, is_default_taxonomy, created_by)
SELECT l.id, s.name, s.color, s.sort_order, true, l.created_by
FROM asset_lists l
CROSS JOIN (VALUES
  ('Watching',    '#94a3b8', 0),
  ('Researching', '#3b82f6', 1),
  ('Convinced',   '#10b981', 2),
  ('Passed',      '#ef4444', 3)
) AS s(name, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM list_statuses ls WHERE ls.list_id = l.id AND ls.name = s.name
);


-- ──────────────────────────────────────────────────────────────────────
-- 8. RLS · mirrors the existing asset_list_items pattern
-- ──────────────────────────────────────────────────────────────────────
-- SELECT: owner OR any collaborator
-- INSERT/UPDATE/DELETE: owner OR collaborator with write/admin permission
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE list_statuses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_item_tags ENABLE ROW LEVEL SECURITY;

-- list_statuses
CREATE POLICY "list_statuses_select" ON list_statuses FOR SELECT USING (
  list_id IN (
    SELECT id FROM asset_lists WHERE created_by = auth.uid()
    UNION
    SELECT list_id FROM asset_list_collaborations WHERE user_id = auth.uid()
  )
);
CREATE POLICY "list_statuses_insert" ON list_statuses FOR INSERT WITH CHECK (
  list_id IN (
    SELECT id FROM asset_lists WHERE created_by = auth.uid()
    UNION
    SELECT list_id FROM asset_list_collaborations
      WHERE user_id = auth.uid() AND permission IN ('write', 'admin')
  )
);
CREATE POLICY "list_statuses_update" ON list_statuses FOR UPDATE USING (
  list_id IN (
    SELECT id FROM asset_lists WHERE created_by = auth.uid()
    UNION
    SELECT list_id FROM asset_list_collaborations
      WHERE user_id = auth.uid() AND permission IN ('write', 'admin')
  )
);
CREATE POLICY "list_statuses_delete" ON list_statuses FOR DELETE USING (
  list_id IN (
    SELECT id FROM asset_lists WHERE created_by = auth.uid()
    UNION
    SELECT list_id FROM asset_list_collaborations
      WHERE user_id = auth.uid() AND permission IN ('write', 'admin')
  )
);

-- list_tags (same pattern)
CREATE POLICY "list_tags_select" ON list_tags FOR SELECT USING (
  list_id IN (
    SELECT id FROM asset_lists WHERE created_by = auth.uid()
    UNION
    SELECT list_id FROM asset_list_collaborations WHERE user_id = auth.uid()
  )
);
CREATE POLICY "list_tags_insert" ON list_tags FOR INSERT WITH CHECK (
  list_id IN (
    SELECT id FROM asset_lists WHERE created_by = auth.uid()
    UNION
    SELECT list_id FROM asset_list_collaborations
      WHERE user_id = auth.uid() AND permission IN ('write', 'admin')
  )
);
CREATE POLICY "list_tags_update" ON list_tags FOR UPDATE USING (
  list_id IN (
    SELECT id FROM asset_lists WHERE created_by = auth.uid()
    UNION
    SELECT list_id FROM asset_list_collaborations
      WHERE user_id = auth.uid() AND permission IN ('write', 'admin')
  )
);
CREATE POLICY "list_tags_delete" ON list_tags FOR DELETE USING (
  list_id IN (
    SELECT id FROM asset_lists WHERE created_by = auth.uid()
    UNION
    SELECT list_id FROM asset_list_collaborations
      WHERE user_id = auth.uid() AND permission IN ('write', 'admin')
  )
);

-- list_item_tags (gated through list_item → list)
CREATE POLICY "list_item_tags_select" ON list_item_tags FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM asset_list_items i
    WHERE i.id = list_item_id AND i.list_id IN (
      SELECT id FROM asset_lists WHERE created_by = auth.uid()
      UNION
      SELECT list_id FROM asset_list_collaborations WHERE user_id = auth.uid()
    )
  )
);
CREATE POLICY "list_item_tags_insert" ON list_item_tags FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM asset_list_items i
    WHERE i.id = list_item_id AND i.list_id IN (
      SELECT id FROM asset_lists WHERE created_by = auth.uid()
      UNION
      SELECT list_id FROM asset_list_collaborations
        WHERE user_id = auth.uid() AND permission IN ('write', 'admin')
    )
  )
);
CREATE POLICY "list_item_tags_delete" ON list_item_tags FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM asset_list_items i
    WHERE i.id = list_item_id AND i.list_id IN (
      SELECT id FROM asset_lists WHERE created_by = auth.uid()
      UNION
      SELECT list_id FROM asset_list_collaborations
        WHERE user_id = auth.uid() AND permission IN ('write', 'admin')
    )
  )
);
