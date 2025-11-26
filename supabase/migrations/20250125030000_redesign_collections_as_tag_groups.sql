/*
  # Redesign Collections as Tag-Based Groups

  1. Changes
    - Remove filter_criteria from collections (collections are now simple groupings)
    - Add project_collection_assignments table for many-to-many relationship
    - Collections are now like folders - projects can belong to multiple collections
    - Collections can optionally be linked to a tag for automatic grouping

  2. New Tables
    - project_collection_assignments: Links projects to collections

  3. Security
    - RLS policies for collection assignments
*/

-- Add optional tag_id to collections (for automatic grouping by tag)
ALTER TABLE project_collections
ADD COLUMN IF NOT EXISTS tag_id uuid REFERENCES project_tags(id) ON DELETE SET NULL;

-- Make filter_criteria nullable since we're moving away from filter-based collections
ALTER TABLE project_collections
ALTER COLUMN filter_criteria DROP NOT NULL,
ALTER COLUMN filter_criteria SET DEFAULT NULL;

-- Create project_collection_assignments table
CREATE TABLE IF NOT EXISTS project_collection_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES project_collections(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, collection_id)
);

-- Create indexes
CREATE INDEX idx_collection_assignments_project ON project_collection_assignments(project_id);
CREATE INDEX idx_collection_assignments_collection ON project_collection_assignments(collection_id);

-- RLS Policies
ALTER TABLE project_collection_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view assignments for their collections"
  ON project_collection_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_collections
      WHERE project_collections.id = project_collection_assignments.collection_id
      AND project_collections.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can create assignments for their collections"
  ON project_collection_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_collections
      WHERE project_collections.id = project_collection_assignments.collection_id
      AND project_collections.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can delete assignments from their collections"
  ON project_collection_assignments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM project_collections
      WHERE project_collections.id = project_collection_assignments.collection_id
      AND project_collections.created_by = auth.uid()
    )
  );
