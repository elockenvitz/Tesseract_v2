/*
  # Fix Task Assignment Notification Context Data

  Update the notify_task_assignment function to include workflow_id, stage_id,
  and asset_id in the notification context_data so that clicking on task
  assignment notifications can properly navigate to the task.
*/

-- Update the task assignment notification function
CREATE OR REPLACE FUNCTION notify_task_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_assigner_name text;
  v_asset_symbol text;
  v_asset_id uuid;
  v_item_text text;
  v_workflow_name text;
  v_workflow_id uuid;
  v_stage_id text;
BEGIN
  -- Get assigner's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_assigner_name
  FROM users
  WHERE id = NEW.assigned_by;

  -- Get task and asset details including workflow_id, stage_id, and asset_id
  SELECT
    a.id,
    a.symbol,
    ci.item_text,
    ci.workflow_id,
    ci.stage_id,
    w.name
  INTO v_asset_id, v_asset_symbol, v_item_text, v_workflow_id, v_stage_id, v_workflow_name
  FROM asset_checklist_items ci
  JOIN assets a ON ci.asset_id = a.id
  LEFT JOIN workflows w ON ci.workflow_id = w.id
  WHERE ci.id = NEW.checklist_item_id;

  -- Create notification for the assigned user
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    context_type,
    context_id,
    context_data,
    is_read
  ) VALUES (
    NEW.assigned_user_id,
    'task_assigned',
    'New Task Assignment',
    v_assigner_name || ' assigned you to "' || COALESCE(v_item_text, 'checklist task') ||
    CASE WHEN v_asset_symbol IS NOT NULL THEN '" for ' || v_asset_symbol ELSE '"' END,
    'workflow',
    NEW.checklist_item_id,
    jsonb_build_object(
      'checklist_item_id', NEW.checklist_item_id,
      'assigned_by', NEW.assigned_by,
      'assigner_name', v_assigner_name,
      'asset_id', v_asset_id,
      'asset_symbol', v_asset_symbol,
      'item_text', v_item_text,
      'workflow_id', v_workflow_id,
      'workflow_name', v_workflow_name,
      'stage_id', v_stage_id,
      'due_date', NEW.due_date,
      'notes', NEW.notes
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
