/*
  # Create Notifications System

  1. New Tables
    - `notifications`
      - `id` (uuid, primary key)
      - `user_id` (uuid, recipient)
      - `type` (enum: asset_field_change, asset_priority_change, asset_stage_change, note_shared, note_created)
      - `title` (text, notification title)
      - `message` (text, notification message)
      - `context_type` (text: asset, note, portfolio, theme)
      - `context_id` (uuid, related record ID)
      - `context_data` (jsonb, additional context)
      - `is_read` (boolean, read status)
      - `created_at` (timestamp)
      - `read_at` (timestamp, when marked as read)

  2. Functions
    - `notify_asset_coverage_users` - notify users who cover an asset
    - `notify_note_collaborators` - notify note collaborators
    - `create_asset_change_notification` - create notifications for asset changes

  3. Triggers
    - Asset field changes trigger notifications
    - Note sharing triggers notifications
    - Priority/stage changes trigger notifications

  4. Security
    - Enable RLS on notifications table
    - Users can only read their own notifications
*/

-- Create notification type enum
CREATE TYPE notification_type AS ENUM (
  'asset_field_change',
  'asset_priority_change', 
  'asset_stage_change',
  'note_shared',
  'note_created',
  'price_target_change'
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type notification_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  context_type text NOT NULL CHECK (context_type IN ('asset', 'note', 'portfolio', 'theme')),
  context_id uuid NOT NULL,
  context_data jsonb DEFAULT '{}',
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  read_at timestamptz
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_context ON notifications(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read their own notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can create notifications"
  ON notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update their own notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to get users who should be notified about asset changes
CREATE OR REPLACE FUNCTION get_asset_notification_users(asset_id_param uuid)
RETURNS TABLE(user_id uuid, user_email text, user_name text) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT 
    c.user_id,
    u.email,
    COALESCE(u.first_name || ' ' || u.last_name, u.email) as user_name
  FROM coverage c
  JOIN users u ON u.id = c.user_id
  WHERE c.asset_id = asset_id_param;
END;
$$ LANGUAGE plpgsql;

-- Function to create asset change notifications
CREATE OR REPLACE FUNCTION create_asset_change_notification(
  asset_id_param uuid,
  notification_type_param notification_type,
  title_param text,
  message_param text,
  context_data_param jsonb DEFAULT '{}'
) RETURNS void AS $$
DECLARE
  notification_user RECORD;
  asset_info RECORD;
BEGIN
  -- Get asset information
  SELECT symbol, company_name INTO asset_info
  FROM assets WHERE id = asset_id_param;
  
  -- Create notifications for all users who cover this asset
  FOR notification_user IN 
    SELECT user_id FROM get_asset_notification_users(asset_id_param)
  LOOP
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      context_type,
      context_id,
      context_data
    ) VALUES (
      notification_user.user_id,
      notification_type_param,
      title_param,
      message_param,
      'asset',
      asset_id_param,
      context_data_param || jsonb_build_object(
        'asset_symbol', asset_info.symbol,
        'asset_name', asset_info.company_name
      )
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to create note collaboration notifications
CREATE OR REPLACE FUNCTION create_note_collaboration_notification(
  note_id_param uuid,
  note_type_param text,
  notification_type_param notification_type,
  title_param text,
  message_param text,
  exclude_user_id uuid DEFAULT NULL
) RETURNS void AS $$
DECLARE
  collaboration_user RECORD;
BEGIN
  -- Create notifications for all collaborators except the one who made the change
  FOR collaboration_user IN 
    SELECT DISTINCT nc.user_id
    FROM note_collaborations nc
    WHERE nc.note_id = note_id_param 
      AND nc.note_type = note_type_param
      AND (exclude_user_id IS NULL OR nc.user_id != exclude_user_id)
  LOOP
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      context_type,
      context_id,
      context_data
    ) VALUES (
      collaboration_user.user_id,
      notification_type_param,
      title_param,
      message_param,
      'note',
      note_id_param,
      jsonb_build_object('note_type', note_type_param)
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for asset field changes
CREATE OR REPLACE FUNCTION notify_asset_field_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify if this is an update (not insert)
  IF TG_OP = 'UPDATE' THEN
    -- Check for priority changes
    IF OLD.priority IS DISTINCT FROM NEW.priority THEN
      PERFORM create_asset_change_notification(
        NEW.id,
        'asset_priority_change',
        'Priority Changed: ' || NEW.symbol,
        'Priority changed from ' || COALESCE(OLD.priority, 'none') || ' to ' || COALESCE(NEW.priority, 'none'),
        jsonb_build_object(
          'old_priority', OLD.priority,
          'new_priority', NEW.priority,
          'changed_by', auth.uid()
        )
      );
    END IF;
    
    -- Check for stage changes
    IF OLD.process_stage IS DISTINCT FROM NEW.process_stage THEN
      PERFORM create_asset_change_notification(
        NEW.id,
        'asset_stage_change',
        'Stage Changed: ' || NEW.symbol,
        'Stage changed from ' || COALESCE(OLD.process_stage, 'none') || ' to ' || COALESCE(NEW.process_stage, 'none'),
        jsonb_build_object(
          'old_stage', OLD.process_stage,
          'new_stage', NEW.process_stage,
          'changed_by', auth.uid()
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for asset thesis/content changes
CREATE OR REPLACE FUNCTION notify_asset_content_changes()
RETURNS TRIGGER AS $$
DECLARE
  asset_info RECORD;
  field_name text;
BEGIN
  -- Get asset information
  SELECT symbol, company_name INTO asset_info
  FROM assets WHERE id = NEW.asset_id;
  
  -- Determine field name based on table
  CASE TG_TABLE_NAME
    WHEN 'asset_thesis' THEN field_name := 'thesis';
    WHEN 'asset_where_different' THEN field_name := 'where different';
    WHEN 'asset_risks' THEN field_name := 'risks to thesis';
    ELSE field_name := 'content';
  END CASE;
  
  -- Only notify on updates (not initial creation)
  IF TG_OP = 'UPDATE' AND OLD.content IS DISTINCT FROM NEW.content THEN
    PERFORM create_asset_change_notification(
      NEW.asset_id,
      'asset_field_change',
      'Field Updated: ' || asset_info.symbol,
      'The ' || field_name || ' has been updated',
      jsonb_build_object(
        'field_name', field_name,
        'table_name', TG_TABLE_NAME,
        'changed_by', NEW.updated_by
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for price target changes
CREATE OR REPLACE FUNCTION notify_price_target_changes()
RETURNS TRIGGER AS $$
DECLARE
  asset_info RECORD;
BEGIN
  -- Get asset information
  SELECT symbol, company_name INTO asset_info
  FROM assets WHERE id = NEW.asset_id;
  
  -- Notify on updates
  IF TG_OP = 'UPDATE' THEN
    PERFORM create_asset_change_notification(
      NEW.asset_id,
      'price_target_change',
      'Price Target Updated: ' || asset_info.symbol,
      'The ' || NEW.type || ' case price target has been updated',
      jsonb_build_object(
        'price_target_type', NEW.type,
        'old_price', OLD.price,
        'new_price', NEW.price,
        'changed_by', auth.uid()
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for note sharing
CREATE OR REPLACE FUNCTION notify_note_sharing()
RETURNS TRIGGER AS $$
DECLARE
  note_info RECORD;
  note_table text;
  note_title text;
BEGIN
  -- Determine note table and get note info based on note_type
  CASE NEW.note_type
    WHEN 'asset' THEN 
      note_table := 'asset_notes';
      SELECT title INTO note_title FROM asset_notes WHERE id = NEW.note_id;
    WHEN 'portfolio' THEN 
      note_table := 'portfolio_notes';
      SELECT title INTO note_title FROM portfolio_notes WHERE id = NEW.note_id;
    WHEN 'theme' THEN 
      note_table := 'theme_notes';
      SELECT title INTO note_title FROM theme_notes WHERE id = NEW.note_id;
    WHEN 'custom' THEN 
      note_table := 'custom_notebook_notes';
      SELECT title INTO note_title FROM custom_notebook_notes WHERE id = NEW.note_id;
  END CASE;
  
  -- Only notify the new collaborator (not existing ones)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      context_type,
      context_id,
      context_data
    ) VALUES (
      NEW.user_id,
      'note_shared',
      'Note Shared: ' || COALESCE(note_title, 'Untitled'),
      'A note has been shared with you',
      'note',
      NEW.note_id,
      jsonb_build_object(
        'note_type', NEW.note_type,
        'permission', NEW.permission,
        'shared_by', NEW.invited_by
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for asset changes
DROP TRIGGER IF EXISTS asset_field_changes_notification ON assets;
CREATE TRIGGER asset_field_changes_notification
  AFTER UPDATE ON assets
  FOR EACH ROW
  EXECUTE FUNCTION notify_asset_field_changes();

-- Create triggers for content changes
DROP TRIGGER IF EXISTS asset_thesis_changes_notification ON asset_thesis;
CREATE TRIGGER asset_thesis_changes_notification
  AFTER UPDATE ON asset_thesis
  FOR EACH ROW
  EXECUTE FUNCTION notify_asset_content_changes();

DROP TRIGGER IF EXISTS asset_where_different_changes_notification ON asset_where_different;
CREATE TRIGGER asset_where_different_changes_notification
  AFTER UPDATE ON asset_where_different
  FOR EACH ROW
  EXECUTE FUNCTION notify_asset_content_changes();

DROP TRIGGER IF EXISTS asset_risks_changes_notification ON asset_risks;
CREATE TRIGGER asset_risks_changes_notification
  AFTER UPDATE ON asset_risks
  FOR EACH ROW
  EXECUTE FUNCTION notify_asset_content_changes();

-- Create trigger for price target changes
DROP TRIGGER IF EXISTS price_target_changes_notification ON price_targets;
CREATE TRIGGER price_target_changes_notification
  AFTER UPDATE ON price_targets
  FOR EACH ROW
  EXECUTE FUNCTION notify_price_target_changes();

-- Create trigger for note sharing
DROP TRIGGER IF EXISTS note_collaboration_notification ON note_collaborations;
CREATE TRIGGER note_collaboration_notification
  AFTER INSERT ON note_collaborations
  FOR EACH ROW
  EXECUTE FUNCTION notify_note_sharing();

-- Function to mark notification as read
CREATE OR REPLACE FUNCTION mark_notification_read(notification_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE notifications 
  SET is_read = true, read_at = now()
  WHERE id = notification_id AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql;

-- Function to mark all notifications as read for a user
CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS void AS $$
BEGIN
  UPDATE notifications 
  SET is_read = true, read_at = now()
  WHERE user_id = auth.uid() AND is_read = false;
END;
$$ LANGUAGE plpgsql;