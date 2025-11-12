/*
  # Add Workflow Template Versions

  This migration adds version control for workflow templates:
  - Creates workflow_template_versions table to store version snapshots
  - Adds version tracking to workflows table
  - Enables version comparison and historical tracking
  - Maintains integrity of active workflows when templates change
*/

-- Create workflow_template_versions table to store template snapshots
CREATE TABLE IF NOT EXISTS workflow_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  version_name TEXT, -- Optional name like "Q4 2024 Update"

  -- Snapshot of template data at this version
  stages JSONB NOT NULL, -- Complete snapshot of workflow stages
  checklist_templates JSONB, -- Complete snapshot of checklist templates
  automation_rules JSONB, -- Complete snapshot of automation/universe rules

  -- Metadata
  description TEXT, -- What changed in this version
  is_active BOOLEAN DEFAULT false, -- Is this the current active version?
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Ensure one active version per workflow
  CONSTRAINT workflow_template_versions_unique_active
    EXCLUDE (workflow_id WITH =) WHERE (is_active = true),

  -- Ensure unique version numbers per workflow
  CONSTRAINT workflow_template_versions_unique_version
    UNIQUE (workflow_id, version_number)
);

-- Create indexes
CREATE INDEX idx_workflow_template_versions_workflow_id ON workflow_template_versions(workflow_id);
CREATE INDEX idx_workflow_template_versions_active ON workflow_template_versions(workflow_id, is_active) WHERE is_active = true;
CREATE INDEX idx_workflow_template_versions_version ON workflow_template_versions(workflow_id, version_number);

-- Add version tracking to workflows table (branches)
ALTER TABLE workflows
ADD COLUMN IF NOT EXISTS template_version_id UUID REFERENCES workflow_template_versions(id),
ADD COLUMN IF NOT EXISTS template_version_number INTEGER;

-- Create index for version lookups
CREATE INDEX idx_workflows_template_version ON workflows(template_version_id);

-- Enable RLS
ALTER TABLE workflow_template_versions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view versions for workflows they have access to
CREATE POLICY "Users can view workflow template versions they have access to"
ON workflow_template_versions FOR SELECT
USING (
  workflow_id IN (
    SELECT id FROM workflows
    WHERE is_public = true
    OR created_by = auth.uid()
    OR id IN (
      SELECT workflow_id FROM workflow_collaborations
      WHERE user_id = auth.uid()
    )
    OR id IN (
      SELECT workflow_id FROM workflow_stakeholders
      WHERE user_id = auth.uid()
    )
  )
);

-- Policy: Workflow owners and admins can create versions
CREATE POLICY "Workflow owners and admins can create versions"
ON workflow_template_versions FOR INSERT
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

-- Policy: Workflow owners and admins can update versions
CREATE POLICY "Workflow owners and admins can update versions"
ON workflow_template_versions FOR UPDATE
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

-- Function to create initial version from current template
CREATE OR REPLACE FUNCTION create_initial_template_version(p_workflow_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_version_id UUID;
  v_stages JSONB;
  v_checklists JSONB;
  v_rules JSONB;
BEGIN
  -- Get current stages
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'key', key,
      'name', name,
      'description', description,
      'color', color,
      'order_index', order_index,
      'is_start', is_start,
      'is_end', is_end
    ) ORDER BY order_index
  ), '[]'::jsonb)
  INTO v_stages
  FROM workflow_stages
  WHERE workflow_id = p_workflow_id;

  -- Get current checklist templates
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'workflow_id', workflow_id,
      'name', name,
      'description', description,
      'stage_key', stage_key,
      'item_type', item_type,
      'order_index', order_index
    ) ORDER BY order_index
  ), '[]'::jsonb)
  INTO v_checklists
  FROM workflow_checklist_templates
  WHERE workflow_id = p_workflow_id;

  -- Get current automation rules
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'workflow_id', workflow_id,
      'name', name,
      'trigger_type', trigger_type,
      'trigger_value', trigger_value,
      'action_type', action_type,
      'action_value', action_value,
      'is_active', is_active
    ) ORDER BY created_at
  ), '[]'::jsonb)
  INTO v_rules
  FROM workflow_automation_rules
  WHERE workflow_id = p_workflow_id;

  -- Create version 1
  INSERT INTO workflow_template_versions (
    workflow_id,
    version_number,
    version_name,
    description,
    stages,
    checklist_templates,
    automation_rules,
    is_active,
    created_by
  )
  VALUES (
    p_workflow_id,
    1,
    'Initial Version',
    'Initial template version created automatically',
    v_stages,
    v_checklists,
    v_rules,
    true,
    auth.uid()
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$$;

-- Function to create new version and mark as active
CREATE OR REPLACE FUNCTION create_new_template_version(
  p_workflow_id UUID,
  p_version_name TEXT,
  p_description TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_version_id UUID;
  v_next_version INTEGER;
  v_stages JSONB;
  v_checklists JSONB;
  v_rules JSONB;
BEGIN
  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM workflow_template_versions
  WHERE workflow_id = p_workflow_id;

  -- Get current stages
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'key', key,
      'name', name,
      'description', description,
      'color', color,
      'order_index', order_index,
      'is_start', is_start,
      'is_end', is_end
    ) ORDER BY order_index
  ), '[]'::jsonb)
  INTO v_stages
  FROM workflow_stages
  WHERE workflow_id = p_workflow_id;

  -- Get current checklist templates
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'workflow_id', workflow_id,
      'name', name,
      'description', description,
      'stage_key', stage_key,
      'item_type', item_type,
      'order_index', order_index
    ) ORDER BY order_index
  ), '[]'::jsonb)
  INTO v_checklists
  FROM workflow_checklist_templates
  WHERE workflow_id = p_workflow_id;

  -- Get current automation rules
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'workflow_id', workflow_id,
      'name', name,
      'trigger_type', trigger_type,
      'trigger_value', trigger_value,
      'action_type', action_type,
      'action_value', action_value,
      'is_active', is_active
    ) ORDER BY created_at
  ), '[]'::jsonb)
  INTO v_rules
  FROM workflow_automation_rules
  WHERE workflow_id = p_workflow_id;

  -- Deactivate all previous versions
  UPDATE workflow_template_versions
  SET is_active = false
  WHERE workflow_id = p_workflow_id AND is_active = true;

  -- Create new version
  INSERT INTO workflow_template_versions (
    workflow_id,
    version_number,
    version_name,
    description,
    stages,
    checklist_templates,
    automation_rules,
    is_active,
    created_by
  )
  VALUES (
    p_workflow_id,
    v_next_version,
    p_version_name,
    p_description,
    v_stages,
    v_checklists,
    v_rules,
    true,
    auth.uid()
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$$;

-- Comment on table
COMMENT ON TABLE workflow_template_versions IS 'Stores version snapshots of workflow templates, enabling safe editing and historical tracking';
COMMENT ON COLUMN workflow_template_versions.version_number IS 'Sequential version number (1, 2, 3...)';
COMMENT ON COLUMN workflow_template_versions.is_active IS 'Only one version can be active per workflow';
COMMENT ON COLUMN workflow_template_versions.stages IS 'Complete snapshot of workflow stages at this version';
COMMENT ON COLUMN workflows.template_version_id IS 'Links workflow branch to specific template version snapshot';
