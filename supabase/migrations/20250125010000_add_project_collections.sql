/*
  # Add Project Collections (Saved Filters)

  1. New Table
    - project_collections: Stores saved filter configurations
      - id: UUID primary key
      - name: Collection name
      - description: Optional description
      - icon: Icon name
      - color: Color code
      - created_by: User who created it
      - filter_criteria: JSONB storing filter configuration
      - sort_order: Display order
      - is_pinned: Whether pinned to top
      - created_at/updated_at: Timestamps

  2. Security
    - RLS policies for user access
    - Users can only see/edit their own collections
*/

-- Create project_collections table
CREATE TABLE IF NOT EXISTS project_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT 'folder',
  color text NOT NULL DEFAULT '#6366f1',
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filter_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_project_collections_user ON project_collections(created_by);
CREATE INDEX idx_project_collections_sort ON project_collections(created_by, sort_order);
CREATE INDEX idx_project_collections_pinned ON project_collections(created_by, is_pinned, sort_order);

-- Add updated_at trigger
CREATE TRIGGER update_project_collections_updated_at
  BEFORE UPDATE ON project_collections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE project_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own collections"
  ON project_collections FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create their own collections"
  ON project_collections FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own collections"
  ON project_collections FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own collections"
  ON project_collections FOR DELETE
  USING (auth.uid() = created_by);

-- Insert some default collections for new users
-- Note: These will need to be created per-user when they first access projects
