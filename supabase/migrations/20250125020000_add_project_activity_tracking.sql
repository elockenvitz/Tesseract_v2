/*
  # Add Project Activity Tracking

  1. New Enum
    - project_activity_type: Types of activities to track

  2. New Table
    - project_activity: Stores all project-related activities
      - Tracks changes to projects, deliverables, assignments, etc.
      - Includes actor, action type, old/new values
      - Enables complete audit trail

  3. Triggers
    - Auto-log changes to projects table
    - Auto-log changes to project_deliverables
    - Auto-log changes to project_assignments
    - Auto-log changes to project_comments

  4. Security
    - RLS policies for viewing activity
*/

-- Create activity type enum
CREATE TYPE project_activity_type AS ENUM (
  'project_created',
  'project_updated',
  'project_deleted',
  'status_changed',
  'priority_changed',
  'due_date_changed',
  'assignment_added',
  'assignment_removed',
  'deliverable_added',
  'deliverable_completed',
  'deliverable_uncompleted',
  'deliverable_deleted',
  'comment_added',
  'comment_updated',
  'comment_deleted',
  'attachment_added',
  'attachment_deleted'
);

-- Create project_activity table
CREATE TABLE IF NOT EXISTS project_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_type project_activity_type NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Store details about the change
  field_name text,
  old_value text,
  new_value text,
  metadata jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_project_activity_project ON project_activity(project_id, created_at DESC);
CREATE INDEX idx_project_activity_type ON project_activity(activity_type);
CREATE INDEX idx_project_activity_actor ON project_activity(actor_id);

-- Function to log project changes
CREATE OR REPLACE FUNCTION log_project_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Log project creation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      NEW.id,
      'project_created',
      NEW.created_by,
      jsonb_build_object(
        'title', NEW.title,
        'status', NEW.status,
        'priority', NEW.priority
      )
    );
    RETURN NEW;
  END IF;

  -- Log project updates
  IF TG_OP = 'UPDATE' THEN
    -- Status changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO project_activity (project_id, activity_type, actor_id, field_name, old_value, new_value)
      VALUES (NEW.id, 'status_changed', auth.uid(), 'status', OLD.status::text, NEW.status::text);
    END IF;

    -- Priority changed
    IF OLD.priority IS DISTINCT FROM NEW.priority THEN
      INSERT INTO project_activity (project_id, activity_type, actor_id, field_name, old_value, new_value)
      VALUES (NEW.id, 'priority_changed', auth.uid(), 'priority', OLD.priority::text, NEW.priority::text);
    END IF;

    -- Due date changed
    IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
      INSERT INTO project_activity (project_id, activity_type, actor_id, field_name, old_value, new_value)
      VALUES (
        NEW.id,
        'due_date_changed',
        auth.uid(),
        'due_date',
        OLD.due_date::text,
        NEW.due_date::text
      );
    END IF;

    -- General project update (for other fields)
    IF OLD.title IS DISTINCT FROM NEW.title OR
       OLD.description IS DISTINCT FROM NEW.description THEN
      INSERT INTO project_activity (project_id, activity_type, actor_id)
      VALUES (NEW.id, 'project_updated', auth.uid());
    END IF;

    RETURN NEW;
  END IF;

  -- Log project deletion
  IF TG_OP = 'DELETE' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      OLD.id,
      'project_deleted',
      auth.uid(),
      jsonb_build_object('title', OLD.title)
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log assignment changes
CREATE OR REPLACE FUNCTION log_assignment_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      NEW.project_id,
      'assignment_added',
      NEW.assigned_by,
      jsonb_build_object(
        'assigned_to', NEW.assigned_to,
        'role', NEW.role
      )
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      OLD.project_id,
      'assignment_removed',
      auth.uid(),
      jsonb_build_object(
        'assigned_to', OLD.assigned_to,
        'role', OLD.role
      )
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log deliverable changes
CREATE OR REPLACE FUNCTION log_deliverable_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      NEW.project_id,
      'deliverable_added',
      auth.uid(),
      jsonb_build_object('title', NEW.title)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Deliverable completed
    IF OLD.completed = false AND NEW.completed = true THEN
      INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
      VALUES (
        NEW.project_id,
        'deliverable_completed',
        NEW.completed_by,
        jsonb_build_object('title', NEW.title)
      );
    END IF;

    -- Deliverable uncompleted
    IF OLD.completed = true AND NEW.completed = false THEN
      INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
      VALUES (
        NEW.project_id,
        'deliverable_uncompleted',
        auth.uid(),
        jsonb_build_object('title', NEW.title)
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      OLD.project_id,
      'deliverable_deleted',
      auth.uid(),
      jsonb_build_object('title', OLD.title)
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log comment changes
CREATE OR REPLACE FUNCTION log_comment_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      NEW.project_id,
      'comment_added',
      NEW.user_id,
      jsonb_build_object('comment_id', NEW.id)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      NEW.project_id,
      'comment_updated',
      auth.uid(),
      jsonb_build_object('comment_id', NEW.id)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO project_activity (project_id, activity_type, actor_id, metadata)
    VALUES (
      OLD.project_id,
      'comment_deleted',
      auth.uid(),
      jsonb_build_object('comment_id', OLD.id)
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach triggers to tables
DROP TRIGGER IF EXISTS project_change_log ON projects;
CREATE TRIGGER project_change_log
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION log_project_change();

DROP TRIGGER IF EXISTS assignment_change_log ON project_assignments;
CREATE TRIGGER assignment_change_log
  AFTER INSERT OR DELETE ON project_assignments
  FOR EACH ROW
  EXECUTE FUNCTION log_assignment_change();

DROP TRIGGER IF EXISTS deliverable_change_log ON project_deliverables;
CREATE TRIGGER deliverable_change_log
  AFTER INSERT OR UPDATE OR DELETE ON project_deliverables
  FOR EACH ROW
  EXECUTE FUNCTION log_deliverable_change();

DROP TRIGGER IF EXISTS comment_change_log ON project_comments;
CREATE TRIGGER comment_change_log
  AFTER INSERT OR UPDATE OR DELETE ON project_comments
  FOR EACH ROW
  EXECUTE FUNCTION log_comment_change();

-- RLS Policies
ALTER TABLE project_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view activity for their projects"
  ON project_activity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_activity.project_id
      AND (
        auth.uid() = projects.created_by OR
        EXISTS (
          SELECT 1 FROM project_assignments
          WHERE project_assignments.project_id = projects.id
          AND project_assignments.assigned_to = auth.uid()
        )
      )
    )
  );
