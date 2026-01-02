-- Enhanced Text Templates System
-- Adds granular sharing, rich text, tags, favorites, and dynamic variables

-- =============================================
-- 1. Add new columns to text_templates
-- =============================================

-- Add shortcut column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'text_templates' AND column_name = 'shortcut'
  ) THEN
    ALTER TABLE text_templates ADD COLUMN shortcut text;
    CREATE INDEX idx_text_templates_shortcut ON text_templates(shortcut) WHERE shortcut IS NOT NULL;
  END IF;
END $$;

-- Rich text HTML content
ALTER TABLE text_templates ADD COLUMN IF NOT EXISTS content_html text;

-- Template description
ALTER TABLE text_templates ADD COLUMN IF NOT EXISTS description text;

-- Favorites
ALTER TABLE text_templates ADD COLUMN IF NOT EXISTS is_favorite boolean DEFAULT false;

-- Last used timestamp
ALTER TABLE text_templates ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- Index for recently used
CREATE INDEX IF NOT EXISTS idx_text_templates_last_used
  ON text_templates(user_id, last_used_at DESC NULLS LAST)
  WHERE last_used_at IS NOT NULL;

-- Index for favorites
CREATE INDEX IF NOT EXISTS idx_text_templates_favorites
  ON text_templates(user_id, is_favorite)
  WHERE is_favorite = true;

-- =============================================
-- 2. Template Collaborations (sharing)
-- =============================================
CREATE TABLE IF NOT EXISTS template_collaborations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES text_templates(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'admin')),
  invited_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  -- Constraints to ensure unique sharing per user or team
  CONSTRAINT unique_template_user UNIQUE NULLS NOT DISTINCT (template_id, user_id),
  CONSTRAINT unique_template_team UNIQUE NULLS NOT DISTINCT (template_id, team_id)
);

-- Enable RLS
ALTER TABLE template_collaborations ENABLE ROW LEVEL SECURITY;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_template_collab_template ON template_collaborations(template_id);
CREATE INDEX IF NOT EXISTS idx_template_collab_user ON template_collaborations(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_template_collab_team ON template_collaborations(team_id) WHERE team_id IS NOT NULL;

-- =============================================
-- 3. Template Tags
-- =============================================
CREATE TABLE IF NOT EXISTS template_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text DEFAULT '#6366f1',
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT unique_tag_name_per_user UNIQUE (user_id, name)
);

-- Enable RLS
ALTER TABLE template_tags ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_template_tags_user ON template_tags(user_id);

-- Tag assignments junction table
CREATE TABLE IF NOT EXISTS template_tag_assignments (
  template_id uuid NOT NULL REFERENCES text_templates(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES template_tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (template_id, tag_id)
);

-- Enable RLS
ALTER TABLE template_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_template_tag_assign_template ON template_tag_assignments(template_id);
CREATE INDEX IF NOT EXISTS idx_template_tag_assign_tag ON template_tag_assignments(tag_id);

-- =============================================
-- 4. Access Function
-- =============================================
CREATE OR REPLACE FUNCTION user_has_template_access(
  p_template_id UUID,
  p_user_id UUID,
  p_min_permission TEXT DEFAULT 'view'
) RETURNS BOOLEAN AS $$
DECLARE
  v_template_owner UUID;
  v_has_access BOOLEAN := false;
  v_permission_level INTEGER;
  v_min_level INTEGER;
BEGIN
  -- Map permission to numeric level for comparison
  v_min_level := CASE p_min_permission
    WHEN 'view' THEN 1
    WHEN 'edit' THEN 2
    WHEN 'admin' THEN 3
    ELSE 1
  END;

  -- Check if user is the owner (owners have full access)
  SELECT user_id INTO v_template_owner
  FROM text_templates
  WHERE id = p_template_id;

  IF v_template_owner = p_user_id THEN
    RETURN true;
  END IF;

  -- Check direct user collaboration
  SELECT CASE permission
    WHEN 'view' THEN 1
    WHEN 'edit' THEN 2
    WHEN 'admin' THEN 3
    ELSE 0
  END INTO v_permission_level
  FROM template_collaborations
  WHERE template_id = p_template_id
    AND user_id = p_user_id;

  IF v_permission_level >= v_min_level THEN
    RETURN true;
  END IF;

  -- Check team collaboration
  SELECT MAX(CASE tc.permission
    WHEN 'view' THEN 1
    WHEN 'edit' THEN 2
    WHEN 'admin' THEN 3
    ELSE 0
  END) INTO v_permission_level
  FROM template_collaborations tc
  JOIN team_members tm ON tc.team_id = tm.team_id
  WHERE tc.template_id = p_template_id
    AND tm.user_id = p_user_id;

  IF v_permission_level >= v_min_level THEN
    RETURN true;
  END IF;

  -- Check organization-wide collaboration (user_id and team_id are both NULL)
  SELECT CASE permission
    WHEN 'view' THEN 1
    WHEN 'edit' THEN 2
    WHEN 'admin' THEN 3
    ELSE 0
  END INTO v_permission_level
  FROM template_collaborations
  WHERE template_id = p_template_id
    AND user_id IS NULL
    AND team_id IS NULL;

  IF v_permission_level >= v_min_level THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get user's permission level for a template
CREATE OR REPLACE FUNCTION get_template_permission(
  p_template_id UUID,
  p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_template_owner UUID;
  v_permission TEXT := NULL;
  v_level INTEGER := 0;
  v_current_level INTEGER;
BEGIN
  -- Check if user is the owner
  SELECT user_id INTO v_template_owner
  FROM text_templates
  WHERE id = p_template_id;

  IF v_template_owner = p_user_id THEN
    RETURN 'owner';
  END IF;

  -- Check direct user collaboration
  SELECT CASE permission
    WHEN 'view' THEN 1
    WHEN 'edit' THEN 2
    WHEN 'admin' THEN 3
    ELSE 0
  END, permission INTO v_current_level, v_permission
  FROM template_collaborations
  WHERE template_id = p_template_id
    AND user_id = p_user_id;

  IF v_current_level > v_level THEN
    v_level := v_current_level;
    -- v_permission already set
  END IF;

  -- Check team collaboration (take highest)
  SELECT MAX(CASE tc.permission
    WHEN 'view' THEN 1
    WHEN 'edit' THEN 2
    WHEN 'admin' THEN 3
    ELSE 0
  END) INTO v_current_level
  FROM template_collaborations tc
  JOIN team_members tm ON tc.team_id = tm.team_id
  WHERE tc.template_id = p_template_id
    AND tm.user_id = p_user_id;

  IF v_current_level IS NOT NULL AND v_current_level > v_level THEN
    v_level := v_current_level;
    v_permission := CASE v_level WHEN 1 THEN 'view' WHEN 2 THEN 'edit' WHEN 3 THEN 'admin' END;
  END IF;

  -- Check organization-wide
  SELECT CASE permission
    WHEN 'view' THEN 1
    WHEN 'edit' THEN 2
    WHEN 'admin' THEN 3
    ELSE 0
  END, permission INTO v_current_level, v_permission
  FROM template_collaborations
  WHERE template_id = p_template_id
    AND user_id IS NULL
    AND team_id IS NULL;

  IF v_current_level IS NOT NULL AND v_current_level > v_level THEN
    v_permission := (SELECT permission FROM template_collaborations
      WHERE template_id = p_template_id AND user_id IS NULL AND team_id IS NULL);
  END IF;

  RETURN v_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 5. RLS Policies
-- =============================================

-- Drop old policies on text_templates to replace with new ones
DROP POLICY IF EXISTS "Users can manage own templates" ON text_templates;
DROP POLICY IF EXISTS "Users can view shared templates" ON text_templates;

-- Owner has full access
CREATE POLICY "template_owner_all"
  ON text_templates
  FOR ALL
  USING (auth.uid() = user_id);

-- Collaborators can view
CREATE POLICY "template_collaborator_view"
  ON text_templates
  FOR SELECT
  USING (user_has_template_access(id, auth.uid(), 'view'));

-- Collaborators with edit permission can update
CREATE POLICY "template_collaborator_edit"
  ON text_templates
  FOR UPDATE
  USING (user_has_template_access(id, auth.uid(), 'edit'))
  WITH CHECK (user_has_template_access(id, auth.uid(), 'edit'));

-- Template collaborations policies
CREATE POLICY "collab_owner_manage"
  ON template_collaborations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM text_templates
      WHERE id = template_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "collab_admin_manage"
  ON template_collaborations
  FOR ALL
  USING (user_has_template_access(template_id, auth.uid(), 'admin'));

CREATE POLICY "collab_view_own"
  ON template_collaborations
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_members
      WHERE team_id = template_collaborations.team_id
        AND user_id = auth.uid()
    )
    OR (user_id IS NULL AND team_id IS NULL)
  );

-- Template tags policies (users manage their own)
CREATE POLICY "tags_owner_all"
  ON template_tags
  FOR ALL
  USING (auth.uid() = user_id);

-- Tag assignments policies
CREATE POLICY "tag_assign_template_owner"
  ON template_tag_assignments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM text_templates
      WHERE id = template_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "tag_assign_editor"
  ON template_tag_assignments
  FOR ALL
  USING (user_has_template_access(template_id, auth.uid(), 'edit'));

CREATE POLICY "tag_assign_view"
  ON template_tag_assignments
  FOR SELECT
  USING (user_has_template_access(template_id, auth.uid(), 'view'));

-- =============================================
-- 6. Helper Functions
-- =============================================

-- Update last_used_at and increment usage_count
CREATE OR REPLACE FUNCTION record_template_usage(p_template_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE text_templates
  SET
    usage_count = usage_count + 1,
    last_used_at = now()
  WHERE id = p_template_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Toggle favorite status
CREATE OR REPLACE FUNCTION toggle_template_favorite(p_template_id UUID)
RETURNS boolean AS $$
DECLARE
  v_new_status boolean;
BEGIN
  UPDATE text_templates
  SET is_favorite = NOT is_favorite
  WHERE id = p_template_id AND user_id = auth.uid()
  RETURNING is_favorite INTO v_new_status;

  RETURN v_new_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 7. Migrate Existing Data
-- =============================================

-- Copy plain text content to HTML format (wrap in paragraphs)
UPDATE text_templates
SET content_html = '<p>' || regexp_replace(
  regexp_replace(content, E'\n\n+', '</p><p>', 'g'),
  E'\n', '<br>', 'g'
) || '</p>'
WHERE content_html IS NULL AND content IS NOT NULL;

-- Convert is_shared=true to organization-wide collaboration
INSERT INTO template_collaborations (template_id, user_id, team_id, permission, invited_by)
SELECT
  id,
  NULL,
  NULL,
  'view',
  user_id
FROM text_templates
WHERE is_shared = true
ON CONFLICT DO NOTHING;

-- =============================================
-- 8. Comments
-- =============================================
COMMENT ON TABLE template_collaborations IS 'Granular sharing for templates. user_id=NULL and team_id=NULL means organization-wide sharing.';
COMMENT ON TABLE template_tags IS 'User-created tags for organizing templates';
COMMENT ON TABLE template_tag_assignments IS 'Junction table linking templates to tags';
COMMENT ON FUNCTION user_has_template_access IS 'Check if user has at least the specified permission level on a template';
COMMENT ON FUNCTION get_template_permission IS 'Get the highest permission level a user has for a template';
