/*
  # Add Checklist Item Attachments

  1. New Table
    - `asset_checklist_attachments` - File attachments for checklist items

  2. Security
    - Enable RLS
    - Add policies for authenticated users

  3. Storage
    - Assumes 'assets' storage bucket exists
*/

-- Create asset_checklist_attachments table
CREATE TABLE IF NOT EXISTS asset_checklist_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id text NOT NULL,
  item_id text NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  file_type text,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE asset_checklist_attachments ENABLE ROW LEVEL SECURITY;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_checklist_attachments_asset ON asset_checklist_attachments(asset_id);
CREATE INDEX IF NOT EXISTS idx_checklist_attachments_workflow ON asset_checklist_attachments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_checklist_attachments_stage_item ON asset_checklist_attachments(stage_id, item_id);

-- RLS Policies
CREATE POLICY "Users can read attachments"
  ON asset_checklist_attachments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create attachments"
  ON asset_checklist_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users can delete their own attachments"
  ON asset_checklist_attachments
  FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid());
