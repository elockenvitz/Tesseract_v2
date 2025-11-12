/*
  # Add Version Type to Workflow Template Versions

  Adds version_type column to support major/minor version designation
*/

-- Add version_type column
ALTER TABLE workflow_template_versions
ADD COLUMN IF NOT EXISTS version_type TEXT DEFAULT 'minor' CHECK (version_type IN ('major', 'minor'));

-- Add index for filtering by version type
CREATE INDEX IF NOT EXISTS idx_workflow_template_versions_type
ON workflow_template_versions(workflow_id, version_type);

-- Update existing versions to be 'minor' by default
UPDATE workflow_template_versions
SET version_type = 'minor'
WHERE version_type IS NULL;

-- Comment on column
COMMENT ON COLUMN workflow_template_versions.version_type IS 'Type of version change: major (breaking changes) or minor (incremental updates)';

-- Update create_new_template_version function to accept version_type
CREATE OR REPLACE FUNCTION create_new_template_version(
  p_workflow_id UUID,
  p_version_name TEXT,
  p_description TEXT,
  p_version_type TEXT DEFAULT 'minor'
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
      'key', stage_key,
      'name', stage_label,
      'description', stage_description,
      'color', stage_color,
      'order_index', sort_order,
      'icon', stage_icon
    ) ORDER BY sort_order
  ), '[]'::jsonb)
  INTO v_stages
  FROM workflow_stages
  WHERE workflow_id = p_workflow_id;

  -- Get current checklist templates
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'workflow_id', workflow_id,
      'stage_id', stage_id,
      'item_id', item_id,
      'item_text', item_text,
      'sort_order', sort_order,
      'is_required', is_required
    ) ORDER BY sort_order
  ), '[]'::jsonb)
  INTO v_checklists
  FROM workflow_checklist_templates
  WHERE workflow_id = p_workflow_id;

  -- Get current automation rules
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'workflow_id', workflow_id,
      'rule_name', rule_name,
      'rule_type', rule_type,
      'condition_type', condition_type,
      'condition_value', condition_value,
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
    version_type,
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
    p_version_type,
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
