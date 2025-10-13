/*
  # Add Mentions, Hashtags, and Assignments to Workflow Checklists

  1. New Tables
    - `checklist_comment_mentions` - Track @mentions in checklist comments
    - `checklist_comment_references` - Track #hashtag references in comments
    - `checklist_task_assignments` - Track who is assigned to checklist tasks
    - `stage_assignments` - Track who is assigned to workflow stages

  2. Updates
    - Add 'mention' and 'task_assigned' to notification_type enum
    - Create notification functions for mentions and assignments

  3. Security
    - Enable RLS on all new tables
    - Add policies for authenticated users
*/

-- Add new notification types
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'mention';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_assigned';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'stage_assigned';

-- Create checklist_comment_mentions table
CREATE TABLE IF NOT EXISTS checklist_comment_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id uuid NOT NULL REFERENCES asset_checklist_items(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioned_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_text text NOT NULL,
  mention_position integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT unique_mention_per_comment UNIQUE (checklist_item_id, mentioned_user_id, mention_position)
);

-- Create checklist_comment_references table (for #hashtags)
CREATE TABLE IF NOT EXISTS checklist_comment_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id uuid NOT NULL REFERENCES asset_checklist_items(id) ON DELETE CASCADE,
  reference_type text NOT NULL CHECK (reference_type IN ('asset', 'workflow', 'list', 'theme', 'note')),
  reference_id uuid NOT NULL,
  reference_text text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- Create checklist_task_assignments table
CREATE TABLE IF NOT EXISTS checklist_task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id uuid NOT NULL REFERENCES asset_checklist_items(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  due_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_task_assignment UNIQUE (checklist_item_id, assigned_user_id)
);

-- Create stage_assignments table
CREATE TABLE IF NOT EXISTS stage_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id text NOT NULL,
  assigned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  due_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_stage_assignment UNIQUE (asset_id, workflow_id, stage_id, assigned_user_id)
);

-- Enable RLS
ALTER TABLE checklist_comment_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_comment_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_assignments ENABLE ROW LEVEL SECURITY;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_comment_mentions_user ON checklist_comment_mentions(mentioned_user_id);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_item ON checklist_comment_mentions(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_comment_references_item ON checklist_comment_references(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_comment_references_type_id ON checklist_comment_references(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_user ON checklist_task_assignments(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_item ON checklist_task_assignments(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_stage_assignments_user ON stage_assignments(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_stage_assignments_asset_workflow ON stage_assignments(asset_id, workflow_id);

-- RLS Policies

-- Checklist comment mentions
CREATE POLICY "Users can read mentions"
  ON checklist_comment_mentions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create mentions"
  ON checklist_comment_mentions
  FOR INSERT
  TO authenticated
  WITH CHECK (mentioned_by = auth.uid());

CREATE POLICY "Users can delete their own mentions"
  ON checklist_comment_mentions
  FOR DELETE
  TO authenticated
  USING (mentioned_by = auth.uid());

-- Checklist comment references
CREATE POLICY "Users can read references"
  ON checklist_comment_references
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create references"
  ON checklist_comment_references
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Checklist task assignments
CREATE POLICY "Users can read task assignments"
  ON checklist_task_assignments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create task assignments"
  ON checklist_task_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (assigned_by = auth.uid());

CREATE POLICY "Users can update task assignments they created"
  ON checklist_task_assignments
  FOR UPDATE
  TO authenticated
  USING (assigned_by = auth.uid());

CREATE POLICY "Users can delete task assignments they created"
  ON checklist_task_assignments
  FOR DELETE
  TO authenticated
  USING (assigned_by = auth.uid());

-- Stage assignments
CREATE POLICY "Users can read stage assignments"
  ON stage_assignments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create stage assignments"
  ON stage_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (assigned_by = auth.uid());

CREATE POLICY "Users can update stage assignments they created"
  ON stage_assignments
  FOR UPDATE
  TO authenticated
  USING (assigned_by = auth.uid());

CREATE POLICY "Users can delete stage assignments they created"
  ON stage_assignments
  FOR DELETE
  TO authenticated
  USING (assigned_by = auth.uid());

-- Function to notify users when mentioned in a comment
CREATE OR REPLACE FUNCTION notify_comment_mention()
RETURNS TRIGGER AS $$
DECLARE
  v_mentioner_name text;
  v_asset_symbol text;
  v_stage_label text;
  v_item_text text;
BEGIN
  -- Get mentioner's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_mentioner_name
  FROM users
  WHERE id = NEW.mentioned_by;

  -- Get asset and checklist item details
  SELECT
    a.symbol,
    ci.item_text
  INTO v_asset_symbol, v_item_text
  FROM asset_checklist_items ci
  JOIN assets a ON ci.asset_id = a.id
  WHERE ci.id = NEW.checklist_item_id;

  -- Create notification for the mentioned user
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
    NEW.mentioned_user_id,
    'mention',
    'You were mentioned in a comment',
    v_mentioner_name || ' mentioned you in a comment on "' || COALESCE(v_item_text, 'checklist task') ||
    CASE WHEN v_asset_symbol IS NOT NULL THEN '" for ' || v_asset_symbol ELSE '"' END,
    'workflow',
    NEW.checklist_item_id,
    jsonb_build_object(
      'checklist_item_id', NEW.checklist_item_id,
      'mentioned_by', NEW.mentioned_by,
      'mentioner_name', v_mentioner_name,
      'comment_text', NEW.comment_text,
      'asset_symbol', v_asset_symbol,
      'item_text', v_item_text
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to notify users when assigned to a task
CREATE OR REPLACE FUNCTION notify_task_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_assigner_name text;
  v_asset_symbol text;
  v_item_text text;
  v_workflow_name text;
BEGIN
  -- Get assigner's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_assigner_name
  FROM users
  WHERE id = NEW.assigned_by;

  -- Get task and asset details
  SELECT
    a.symbol,
    ci.item_text,
    w.name
  INTO v_asset_symbol, v_item_text, v_workflow_name
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
      'asset_symbol', v_asset_symbol,
      'item_text', v_item_text,
      'workflow_name', v_workflow_name,
      'due_date', NEW.due_date,
      'notes', NEW.notes
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to notify users when assigned to a stage
CREATE OR REPLACE FUNCTION notify_stage_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_assigner_name text;
  v_asset_symbol text;
  v_workflow_name text;
  v_stage_label text;
BEGIN
  -- Get assigner's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_assigner_name
  FROM users
  WHERE id = NEW.assigned_by;

  -- Get asset and workflow details
  SELECT
    a.symbol,
    w.name
  INTO v_asset_symbol, v_workflow_name
  FROM assets a
  LEFT JOIN workflows w ON a.workflow_id = w.id
  WHERE a.id = NEW.asset_id;

  -- Get stage label from workflow_stages
  SELECT stage_label INTO v_stage_label
  FROM workflow_stages
  WHERE workflow_id = NEW.workflow_id AND stage_key = NEW.stage_id
  LIMIT 1;

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
    'stage_assigned',
    'New Stage Assignment',
    v_assigner_name || ' assigned you to the "' || COALESCE(v_stage_label, NEW.stage_id) || '" stage' ||
    CASE WHEN v_asset_symbol IS NOT NULL THEN ' for ' || v_asset_symbol ELSE '' END,
    'workflow',
    NEW.asset_id,
    jsonb_build_object(
      'asset_id', NEW.asset_id,
      'workflow_id', NEW.workflow_id,
      'stage_id', NEW.stage_id,
      'stage_label', v_stage_label,
      'assigned_by', NEW.assigned_by,
      'assigner_name', v_assigner_name,
      'asset_symbol', v_asset_symbol,
      'workflow_name', v_workflow_name,
      'due_date', NEW.due_date,
      'notes', NEW.notes
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
DROP TRIGGER IF EXISTS comment_mention_notification ON checklist_comment_mentions;
CREATE TRIGGER comment_mention_notification
  AFTER INSERT ON checklist_comment_mentions
  FOR EACH ROW
  EXECUTE FUNCTION notify_comment_mention();

DROP TRIGGER IF EXISTS task_assignment_notification ON checklist_task_assignments;
CREATE TRIGGER task_assignment_notification
  AFTER INSERT ON checklist_task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_assignment();

DROP TRIGGER IF EXISTS stage_assignment_notification ON stage_assignments;
CREATE TRIGGER stage_assignment_notification
  AFTER INSERT ON stage_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_stage_assignment();
