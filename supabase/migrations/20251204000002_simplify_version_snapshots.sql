/*
  # Simplify Template Version Snapshots

  This migration removes automation_rules and universe_rules from version snapshots.

  Rationale:
  - Automation rules define WHEN branches are created, not WHAT the workflow structure looks like
  - Universe rules define WHICH assets get the workflow, not the workflow structure
  - These are operational/scoping concerns, not structural concerns
  - Version snapshots should only capture workflow structure (stages, checklists)

  Changes:
  1. Update create_new_template_version to not snapshot automation/universe rules
  2. Update activate_template_version to not restore automation/universe rules
  3. Note: We don't drop the columns as they may contain historical data
*/

-- Drop the old 3-argument version of the function
DROP FUNCTION IF EXISTS create_new_template_version(UUID, TEXT, TEXT);

-- Drop and recreate the 4-argument version
DROP FUNCTION IF EXISTS create_new_template_version(UUID, TEXT, TEXT, TEXT);

-- Recreate create_new_template_version without automation_rules
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
  v_last_major INTEGER;
  v_stages JSONB;
  v_checklists JSONB;
BEGIN
  -- Get last major version number to calculate next version
  SELECT COALESCE(MAX(
    CASE
      WHEN version_number < 100 THEN version_number * 100
      ELSE (version_number / 100) * 100
    END
  ), 0)
  INTO v_last_major
  FROM workflow_template_versions
  WHERE workflow_id = p_workflow_id;

  -- Calculate next version number based on type
  IF p_version_type = 'major' THEN
    -- Major: increment major part (100 -> 200)
    v_next_version := v_last_major + 100;
  ELSE
    -- Minor: get max version and add 1
    SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM workflow_template_versions
    WHERE workflow_id = p_workflow_id;
  END IF;

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

  -- Deactivate all previous versions
  UPDATE workflow_template_versions
  SET is_active = false
  WHERE workflow_id = p_workflow_id AND is_active = true;

  -- Create new version (without automation_rules - they're operational, not structural)
  INSERT INTO workflow_template_versions (
    workflow_id,
    version_number,
    version_name,
    description,
    version_type,
    stages,
    checklist_templates,
    automation_rules,  -- Set to NULL - not part of version structure
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
    NULL,  -- Automation rules are not versioned
    true,
    auth.uid()
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$$;

-- Update activate_template_version to NOT restore automation/universe rules
-- They are operational settings, not structural, so they remain as currently configured
CREATE OR REPLACE FUNCTION activate_template_version(
  p_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workflow_id UUID;
  v_version_data RECORD;
  v_stage JSONB;
  v_checklist JSONB;
  v_stage_id UUID;
BEGIN
  -- Get the version data (only structural parts: stages and checklists)
  SELECT
    workflow_id,
    stages,
    checklist_templates
  INTO v_version_data
  FROM workflow_template_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  v_workflow_id := v_version_data.workflow_id;

  -- Deactivate all versions for this workflow
  UPDATE workflow_template_versions
  SET is_active = false
  WHERE workflow_id = v_workflow_id;

  -- Activate the selected version
  UPDATE workflow_template_versions
  SET is_active = true
  WHERE id = p_version_id;

  -- Clear existing stages
  DELETE FROM workflow_stages
  WHERE workflow_id = v_workflow_id;

  -- Restore stages from version snapshot
  FOR v_stage IN SELECT * FROM jsonb_array_elements(v_version_data.stages)
  LOOP
    INSERT INTO workflow_stages (
      workflow_id,
      stage_key,
      stage_label,
      stage_description,
      stage_color,
      sort_order,
      stage_icon
    )
    VALUES (
      v_workflow_id,
      (v_stage->>'key')::TEXT,
      (v_stage->>'name')::TEXT,
      (v_stage->>'description')::TEXT,
      (v_stage->>'color')::TEXT,
      (v_stage->>'order_index')::INTEGER,
      (v_stage->>'icon')::TEXT
    )
    RETURNING id INTO v_stage_id;
  END LOOP;

  -- Clear existing checklist templates
  DELETE FROM workflow_checklist_templates
  WHERE workflow_id = v_workflow_id;

  -- Restore checklist templates from version snapshot
  IF v_version_data.checklist_templates IS NOT NULL THEN
    FOR v_checklist IN SELECT * FROM jsonb_array_elements(v_version_data.checklist_templates)
    LOOP
      INSERT INTO workflow_checklist_templates (
        workflow_id,
        stage_id,
        item_id,
        item_text,
        sort_order,
        is_required
      )
      VALUES (
        v_workflow_id,
        (v_checklist->>'stage_id')::UUID,
        (v_checklist->>'item_id')::TEXT,
        (v_checklist->>'item_text')::TEXT,
        (v_checklist->>'sort_order')::INTEGER,
        COALESCE((v_checklist->>'is_required')::BOOLEAN, false)
      );
    END LOOP;
  END IF;

  -- NOTE: Automation rules and universe rules are NOT restored
  -- They are operational/scoping settings, not structural
  -- They remain as currently configured on the workflow

  RETURN TRUE;
END;
$$;

-- Update comments to reflect the new model
COMMENT ON FUNCTION create_new_template_version IS 'Creates a new template version snapshot containing stages and checklists. Automation rules and universe rules are not versioned as they are operational settings.';
COMMENT ON FUNCTION activate_template_version IS 'Activates a specific template version, restoring its stages and checklists. Automation rules and universe rules remain unchanged as they are operational settings.';
COMMENT ON COLUMN workflow_template_versions.automation_rules IS 'DEPRECATED: Automation rules are no longer versioned. This column may contain historical data but is not used for new versions.';
