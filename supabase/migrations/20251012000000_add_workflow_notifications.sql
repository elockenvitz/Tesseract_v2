/*
  # Add workflow invitation notifications

  1. Updates
    - Add 'workflow_invitation' to notification_type enum
    - Add 'workflow' and 'list' to context_type check constraint
    - Create notification function for workflow invitations
    - Add trigger on workflow_collaborations table
*/

-- Add workflow_invitation to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workflow_invitation';

-- Drop the existing check constraint on context_type
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_type_check;

-- Add updated check constraint that includes 'workflow' and 'list'
ALTER TABLE notifications ADD CONSTRAINT notifications_context_type_check
  CHECK (context_type IN ('asset', 'note', 'portfolio', 'theme', 'list', 'workflow'));

-- Create function to notify users when they're invited to a workflow
CREATE OR REPLACE FUNCTION notify_workflow_sharing()
RETURNS TRIGGER AS $$
DECLARE
  v_workflow_name text;
  v_inviter_name text;
  v_permission text;
BEGIN
  -- Get workflow name
  SELECT name INTO v_workflow_name
  FROM workflows
  WHERE id = NEW.workflow_id;

  -- Get inviter's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_inviter_name
  FROM users
  WHERE id = NEW.invited_by;

  -- Format permission level
  v_permission := CASE NEW.permission
    WHEN 'admin' THEN 'Admin'
    WHEN 'write' THEN 'Write'
    ELSE 'Read'
  END;

  -- Create notification for the invited user
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
    NEW.user_id,
    'workflow_invitation',
    'Workflow Access Granted',
    v_inviter_name || ' invited you to collaborate on "' || v_workflow_name || '" with ' || v_permission || ' access',
    'workflow',
    NEW.workflow_id,
    jsonb_build_object(
      'workflow_id', NEW.workflow_id,
      'workflow_name', v_workflow_name,
      'invited_by', NEW.invited_by,
      'inviter_name', v_inviter_name,
      'permission', NEW.permission
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on workflow_collaborations
DROP TRIGGER IF EXISTS workflow_collaboration_notification ON workflow_collaborations;
CREATE TRIGGER workflow_collaboration_notification
  AFTER INSERT ON workflow_collaborations
  FOR EACH ROW
  EXECUTE FUNCTION notify_workflow_sharing();
