-- Add note versions table for storing historical versions of notes
-- This enables restoring previous versions of notes

CREATE TABLE note_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Polymorphic reference to the note
  note_id UUID NOT NULL,
  note_type TEXT NOT NULL CHECK (note_type IN ('asset', 'portfolio', 'theme', 'custom')),

  -- Version metadata
  version_number INTEGER NOT NULL DEFAULT 1,

  -- Snapshot of note content at this version
  title TEXT NOT NULL,
  content TEXT,
  note_type_category TEXT, -- 'research', 'meeting', etc.

  -- Who created this version and when
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Reason for creating this version (auto, manual, restore)
  version_reason TEXT DEFAULT 'auto',

  UNIQUE(note_id, note_type, version_number)
);

-- Indexes for efficient queries
CREATE INDEX idx_note_versions_note_id ON note_versions(note_id);
CREATE INDEX idx_note_versions_note_type ON note_versions(note_type);
CREATE INDEX idx_note_versions_created_at ON note_versions(created_at DESC);

-- RLS Policies
ALTER TABLE note_versions ENABLE ROW LEVEL SECURITY;

-- Users can view versions of notes they have access to
CREATE POLICY "Users can view note versions they have access to" ON note_versions
  FOR SELECT
  USING (
    CASE note_type
      WHEN 'asset' THEN EXISTS (
        SELECT 1 FROM asset_notes an
        WHERE an.id = note_versions.note_id
        AND (an.created_by = auth.uid() OR an.is_shared = true)
      )
      WHEN 'portfolio' THEN EXISTS (
        SELECT 1 FROM portfolio_notes pn
        WHERE pn.id = note_versions.note_id
        AND (pn.created_by = auth.uid() OR pn.is_shared = true)
      )
      WHEN 'theme' THEN EXISTS (
        SELECT 1 FROM theme_notes tn
        WHERE tn.id = note_versions.note_id
        AND (tn.created_by = auth.uid() OR tn.is_shared = true)
      )
      WHEN 'custom' THEN EXISTS (
        SELECT 1 FROM custom_notebook_notes cn
        WHERE cn.id = note_versions.note_id
        AND cn.created_by = auth.uid()
      )
      ELSE false
    END
  );

-- Users can create versions for their own notes
CREATE POLICY "Users can create versions for their notes" ON note_versions
  FOR INSERT
  WITH CHECK (
    CASE note_type
      WHEN 'asset' THEN EXISTS (
        SELECT 1 FROM asset_notes an
        WHERE an.id = note_versions.note_id
        AND an.created_by = auth.uid()
      )
      WHEN 'portfolio' THEN EXISTS (
        SELECT 1 FROM portfolio_notes pn
        WHERE pn.id = note_versions.note_id
        AND pn.created_by = auth.uid()
      )
      WHEN 'theme' THEN EXISTS (
        SELECT 1 FROM theme_notes tn
        WHERE tn.id = note_versions.note_id
        AND tn.created_by = auth.uid()
      )
      WHEN 'custom' THEN EXISTS (
        SELECT 1 FROM custom_notebook_notes cn
        WHERE cn.id = note_versions.note_id
        AND cn.created_by = auth.uid()
      )
      ELSE false
    END
  );

-- Function to get the next version number for a note
CREATE OR REPLACE FUNCTION get_next_note_version_number(p_note_id UUID, p_note_type TEXT)
RETURNS INTEGER AS $$
DECLARE
  next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO next_version
  FROM note_versions
  WHERE note_id = p_note_id AND note_type = p_note_type;

  RETURN next_version;
END;
$$ LANGUAGE plpgsql;

-- Function to create a version snapshot (called before significant changes)
CREATE OR REPLACE FUNCTION create_note_version(
  p_note_id UUID,
  p_note_type TEXT,
  p_title TEXT,
  p_content TEXT,
  p_note_type_category TEXT,
  p_user_id UUID,
  p_reason TEXT DEFAULT 'auto'
)
RETURNS UUID AS $$
DECLARE
  new_version_id UUID;
  version_num INTEGER;
BEGIN
  version_num := get_next_note_version_number(p_note_id, p_note_type);

  INSERT INTO note_versions (
    note_id, note_type, version_number, title, content,
    note_type_category, created_by, version_reason
  ) VALUES (
    p_note_id, p_note_type, version_num, p_title, p_content,
    p_note_type_category, p_user_id, p_reason
  )
  RETURNING id INTO new_version_id;

  RETURN new_version_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE note_versions IS 'Stores historical versions of notes for restore functionality';
COMMENT ON COLUMN note_versions.version_reason IS 'Reason for version: auto (periodic), manual (user-triggered), restore (restored from version)';
