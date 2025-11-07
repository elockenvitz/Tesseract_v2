/*
  # Add Workflow Access Request Notifications

  Add notification support for workflow access requests.
  When a user requests write or admin access to a workflow,
  notify the workflow owner and admins.
*/

-- Add workflow_access_request to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workflow_access_request';

-- Create function to notify workflow owner and admins when access is requested
CREATE OR REPLACE FUNCTION notify_workflow_access_request()
RETURNS TRIGGER AS $$
DECLARE
  v_workflow_name text;
  v_requester_name text;
  v_permission text;
  v_workflow_owner uuid;
  v_admin_user_id uuid;
BEGIN
  -- Only send notifications for new pending requests
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Get workflow name and owner
  SELECT name, created_by INTO v_workflow_name, v_workflow_owner
  FROM workflows
  WHERE id = NEW.workflow_id;

  -- Get requester's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_requester_name
  FROM users
  WHERE id = NEW.user_id;

  -- Format requested permission level
  v_permission := CASE NEW.requested_permission
    WHEN 'admin' THEN 'Admin'
    WHEN 'write' THEN 'Write'
    ELSE 'Read'
  END;

  -- Create notification for the workflow owner
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
    v_workflow_owner,
    'workflow_access_request',
    'Workflow Access Request',
    v_requester_name || ' requested ' || v_permission || ' access to "' || v_workflow_name || '"',
    'workflow',
    NEW.workflow_id,
    jsonb_build_object(
      'workflow_id', NEW.workflow_id,
      'workflow_name', v_workflow_name,
      'request_id', NEW.id,
      'requester_id', NEW.user_id,
      'requester_name', v_requester_name,
      'requested_permission', NEW.requested_permission,
      'reason', NEW.reason
    ),
    false
  );

  -- Create notifications for workflow admins (excluding the owner who already got notified)
  FOR v_admin_user_id IN
    SELECT user_id
    FROM workflow_collaborations
    WHERE workflow_id = NEW.workflow_id
      AND permission = 'admin'
      AND user_id != v_workflow_owner
  LOOP
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
      v_admin_user_id,
      'workflow_access_request',
      'Workflow Access Request',
      v_requester_name || ' requested ' || v_permission || ' access to "' || v_workflow_name || '"',
      'workflow',
      NEW.workflow_id,
      jsonb_build_object(
        'workflow_id', NEW.workflow_id,
        'workflow_name', v_workflow_name,
        'request_id', NEW.id,
        'requester_id', NEW.user_id,
        'requester_name', v_requester_name,
        'requested_permission', NEW.requested_permission,
        'reason', NEW.reason
      ),
      false
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on workflow_access_requests
DROP TRIGGER IF EXISTS workflow_access_request_notification ON workflow_access_requests;
CREATE TRIGGER workflow_access_request_notification
  AFTER INSERT ON workflow_access_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_workflow_access_request();
