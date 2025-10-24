/*
  # Add workflow access requests

  1. New Tables
    - workflow_access_requests
      - Stores requests for elevated permissions on workflows

  2. Notification Type
    - Add 'workflow_access_request' to notification_type enum

  3. Functions
    - notify_workflow_access_request: Creates notifications for workflow admins/owner

  4. Security
    - Enable RLS on workflow_access_requests
    - Add policies for creating and viewing access requests
*/

-- Create workflow_access_requests table
CREATE TABLE IF NOT EXISTS workflow_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_permission TEXT,
  requested_permission TEXT NOT NULL CHECK (requested_permission IN ('write', 'admin')),
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create partial unique index to allow only one pending request per user per workflow
CREATE UNIQUE INDEX unique_pending_workflow_access_request
  ON workflow_access_requests (workflow_id, user_id)
  WHERE status = 'pending';

-- Enable RLS
ALTER TABLE workflow_access_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own requests
CREATE POLICY "Users can view their own access requests"
  ON workflow_access_requests
  FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Users can create access requests for workflows they have access to
CREATE POLICY "Users can create access requests"
  ON workflow_access_requests
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      -- User must have at least read access to the workflow
      EXISTS (
        SELECT 1 FROM workflow_collaborations
        WHERE workflow_id = workflow_access_requests.workflow_id
        AND user_id = auth.uid()
      )
      OR
      -- Or workflow is public
      EXISTS (
        SELECT 1 FROM workflows
        WHERE id = workflow_access_requests.workflow_id
        AND is_public = true
      )
    )
  );

-- Policy: Workflow admins and owners can view all requests for their workflow
CREATE POLICY "Workflow admins can view access requests"
  ON workflow_access_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflows
      WHERE id = workflow_access_requests.workflow_id
      AND created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM workflow_collaborations
      WHERE workflow_id = workflow_access_requests.workflow_id
      AND user_id = auth.uid()
      AND permission = 'admin'
    )
  );

-- Policy: Workflow admins and owners can update requests
CREATE POLICY "Workflow admins can update access requests"
  ON workflow_access_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workflows
      WHERE id = workflow_access_requests.workflow_id
      AND created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM workflow_collaborations
      WHERE workflow_id = workflow_access_requests.workflow_id
      AND user_id = auth.uid()
      AND permission = 'admin'
    )
  );

-- Add workflow_access_request to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workflow_access_request';

-- Create function to notify workflow admins when someone requests access
CREATE OR REPLACE FUNCTION notify_workflow_access_request()
RETURNS TRIGGER AS $$
DECLARE
  v_workflow_name text;
  v_requester_name text;
  v_admin_user_id uuid;
BEGIN
  -- Get workflow name
  SELECT name INTO v_workflow_name
  FROM workflows
  WHERE id = NEW.workflow_id;

  -- Get requester's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_requester_name
  FROM users
  WHERE id = NEW.user_id;

  -- Notify the workflow owner
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    context_type,
    context_id,
    context_data,
    is_read
  )
  SELECT
    workflows.created_by,
    'workflow_access_request',
    'Access Request for Workflow',
    v_requester_name || ' is requesting ' || NEW.requested_permission || ' access to "' || v_workflow_name || '"',
    'workflow',
    NEW.workflow_id,
    jsonb_build_object(
      'workflow_id', NEW.workflow_id,
      'workflow_name', v_workflow_name,
      'user_id', NEW.user_id,
      'requester_name', v_requester_name,
      'requested_permission', NEW.requested_permission,
      'reason', NEW.reason,
      'request_id', NEW.id
    ),
    false
  FROM workflows
  WHERE workflows.id = NEW.workflow_id;

  -- Notify all workflow admins
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    context_type,
    context_id,
    context_data,
    is_read
  )
  SELECT
    wc.user_id,
    'workflow_access_request',
    'Access Request for Workflow',
    v_requester_name || ' is requesting ' || NEW.requested_permission || ' access to "' || v_workflow_name || '"',
    'workflow',
    NEW.workflow_id,
    jsonb_build_object(
      'workflow_id', NEW.workflow_id,
      'workflow_name', v_workflow_name,
      'user_id', NEW.user_id,
      'requester_name', v_requester_name,
      'requested_permission', NEW.requested_permission,
      'reason', NEW.reason,
      'request_id', NEW.id
    ),
    false
  FROM workflow_collaborations wc
  WHERE wc.workflow_id = NEW.workflow_id
    AND wc.permission = 'admin'
    AND wc.user_id != NEW.user_id; -- Don't notify the requester

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for access request notifications
DROP TRIGGER IF EXISTS workflow_access_request_notification ON workflow_access_requests;
CREATE TRIGGER workflow_access_request_notification
  AFTER INSERT ON workflow_access_requests
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION notify_workflow_access_request();

-- Comment the table
COMMENT ON TABLE workflow_access_requests IS 'Stores requests for elevated workflow permissions from users with read or write access';
