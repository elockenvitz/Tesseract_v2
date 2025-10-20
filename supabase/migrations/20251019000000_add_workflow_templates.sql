/*
  # Add Workflow Templates

  Add workflow templates table and storage for file uploads.
  Allow workflow admins and owners to manage templates for their workflows.
*/

-- Create workflow_templates table
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_workflow_templates_workflow_id ON workflow_templates(workflow_id);
CREATE INDEX idx_workflow_templates_uploaded_by ON workflow_templates(uploaded_by);

-- Enable RLS
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view templates for workflows they have access to
CREATE POLICY "Users can view workflow templates they have access to"
ON workflow_templates FOR SELECT
USING (
  workflow_id IN (
    SELECT id FROM workflows
    WHERE is_public = true
    OR created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
    )
  )
);

-- Policy: Workflow owners and admins can insert templates
CREATE POLICY "Workflow owners and admins can insert templates"
ON workflow_templates FOR INSERT
WITH CHECK (
  workflow_id IN (
    SELECT id FROM workflows
    WHERE created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission = 'admin'
    )
  )
);

-- Policy: Workflow owners and admins can update templates
CREATE POLICY "Workflow owners and admins can update templates"
ON workflow_templates FOR UPDATE
USING (
  workflow_id IN (
    SELECT id FROM workflows
    WHERE created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission = 'admin'
    )
  )
);

-- Policy: Workflow owners and admins can delete templates
CREATE POLICY "Workflow owners and admins can delete templates"
ON workflow_templates FOR DELETE
USING (
  workflow_id IN (
    SELECT id FROM workflows
    WHERE created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission = 'admin'
    )
  )
);

-- Create storage bucket for workflow templates (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('workflow-templates', 'workflow-templates', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: Users can view template files for workflows they have access to
CREATE POLICY "Users can view workflow template files they have access to"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'workflow-templates'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM workflows
    WHERE is_public = true
    OR created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
    )
  )
);

-- Storage policy: Workflow owners and admins can upload template files
CREATE POLICY "Workflow owners and admins can upload template files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'workflow-templates'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM workflows
    WHERE created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission = 'admin'
    )
  )
);

-- Storage policy: Workflow owners and admins can delete template files
CREATE POLICY "Workflow owners and admins can delete template files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'workflow-templates'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM workflows
    WHERE created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
      AND permission = 'admin'
    )
  )
);
