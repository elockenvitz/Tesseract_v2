/*
  # Add coverage change requests

  1. New Tables
    - coverage_requests
      - Stores requests from non-admin users to add or change coverage assignments

  2. Notification Type
    - Add 'coverage_request' to notification_type enum

  3. Functions
    - notify_coverage_request: Creates notifications for coverage admins

  4. Security
    - Enable RLS on coverage_requests
    - Add policies for creating and viewing coverage requests
*/

-- Create coverage_requests table
CREATE TABLE IF NOT EXISTS coverage_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  current_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  current_analyst_name TEXT,
  requested_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_analyst_name TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('add', 'change', 'remove')),
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create partial unique index to allow only one pending request per user per asset
CREATE UNIQUE INDEX unique_pending_coverage_request
  ON coverage_requests (asset_id, requested_by)
  WHERE status = 'pending';

-- Enable RLS
ALTER TABLE coverage_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own requests
CREATE POLICY "Users can view their own coverage requests"
  ON coverage_requests
  FOR SELECT
  USING (requested_by = auth.uid());

-- Policy: Users can create coverage requests
CREATE POLICY "Users can create coverage requests"
  ON coverage_requests
  FOR INSERT
  WITH CHECK (requested_by = auth.uid());

-- Policy: Coverage admins can view all requests
CREATE POLICY "Coverage admins can view all requests"
  ON coverage_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND coverage_admin = true
    )
  );

-- Policy: Coverage admins can update requests
CREATE POLICY "Coverage admins can update requests"
  ON coverage_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND coverage_admin = true
    )
  );

-- Add coverage_request to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coverage_request';

-- Create function to notify coverage admins when someone requests coverage change
CREATE OR REPLACE FUNCTION notify_coverage_request()
RETURNS TRIGGER AS $$
DECLARE
  v_asset_symbol text;
  v_asset_name text;
  v_requester_name text;
  v_admin_user_id uuid;
  v_message text;
BEGIN
  -- Get asset info
  SELECT symbol, company_name INTO v_asset_symbol, v_asset_name
  FROM assets
  WHERE id = NEW.asset_id;

  -- Get requester's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_requester_name
  FROM users
  WHERE id = NEW.requested_by;

  -- Build message based on request type
  v_message := CASE NEW.request_type
    WHEN 'add' THEN v_requester_name || ' is requesting to add coverage for ' || v_asset_symbol || ' (' || v_asset_name || '). Analyst: ' || NEW.requested_analyst_name
    WHEN 'change' THEN v_requester_name || ' is requesting to change coverage for ' || v_asset_symbol || ' from ' || NEW.current_analyst_name || ' to ' || NEW.requested_analyst_name
    WHEN 'remove' THEN v_requester_name || ' is requesting to remove coverage for ' || v_asset_symbol || ' (' || NEW.current_analyst_name || ')'
  END;

  -- Notify all coverage admins
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
    u.id,
    'coverage_request',
    'Coverage Change Request',
    v_message,
    'asset',
    NEW.asset_id,
    jsonb_build_object(
      'request_id', NEW.id,
      'asset_id', NEW.asset_id,
      'asset_symbol', v_asset_symbol,
      'asset_name', v_asset_name,
      'request_type', NEW.request_type,
      'requested_by', NEW.requested_by,
      'requester_name', v_requester_name,
      'current_analyst_name', NEW.current_analyst_name,
      'requested_analyst_name', NEW.requested_analyst_name,
      'reason', NEW.reason
    ),
    false
  FROM users u
  WHERE u.coverage_admin = true
    AND u.id != NEW.requested_by; -- Don't notify the requester

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for coverage request notifications
DROP TRIGGER IF EXISTS coverage_request_notification ON coverage_requests;
CREATE TRIGGER coverage_request_notification
  AFTER INSERT ON coverage_requests
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION notify_coverage_request();

-- Create index for performance
CREATE INDEX idx_coverage_requests_asset_id ON coverage_requests(asset_id);
CREATE INDEX idx_coverage_requests_requested_by ON coverage_requests(requested_by);
CREATE INDEX idx_coverage_requests_status ON coverage_requests(status);

-- Comment the table
COMMENT ON TABLE coverage_requests IS 'Stores coverage change requests from non-admin users to add, change, or remove coverage assignments';
