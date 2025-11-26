/*
  # Add Project Tracking System

  1. Enums
    - project_status: planning, in_progress, blocked, completed, cancelled
    - project_priority: low, medium, high, urgent
    - project_assignment_role: owner, contributor, reviewer

  2. Tables
    - projects: Core project information
    - project_assignments: User assignments to projects
    - project_deliverables: Checkable deliverables/tasks for projects
    - project_comments: Discussion threads on projects
    - project_attachments: File attachments for projects

  3. Notifications
    - Add 'project_assigned' to notification_type enum
    - Add 'project' to context_type check constraint
    - Create notification functions for project assignments

  4. Security
    - RLS policies for all tables
    - Users can see projects they're assigned to
    - Project creators and admins can manage projects
*/

-- Create enums
CREATE TYPE project_status AS ENUM (
  'planning',
  'in_progress',
  'blocked',
  'completed',
  'cancelled'
);

CREATE TYPE project_priority AS ENUM (
  'low',
  'medium',
  'high',
  'urgent'
);

CREATE TYPE project_assignment_role AS ENUM (
  'owner',
  'contributor',
  'reviewer'
);

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status project_status NOT NULL DEFAULT 'planning',
  priority project_priority NOT NULL DEFAULT 'medium',
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Optional context linking (can link to asset, portfolio, theme, etc)
  context_type text CHECK (context_type IN ('asset', 'portfolio', 'theme', 'workflow', 'general')),
  context_id uuid,

  CONSTRAINT valid_completed_at CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status != 'completed' AND completed_at IS NULL)
  )
);

-- Create project_assignments table
CREATE TABLE IF NOT EXISTS project_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  role project_assignment_role NOT NULL DEFAULT 'contributor',
  assigned_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(project_id, assigned_to)
);

-- Create project_deliverables table
CREATE TABLE IF NOT EXISTS project_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  completed boolean NOT NULL DEFAULT false,
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  display_order integer NOT NULL DEFAULT 0,

  CONSTRAINT valid_deliverable_completion CHECK (
    (completed = true AND completed_by IS NOT NULL AND completed_at IS NOT NULL) OR
    (completed = false AND completed_by IS NULL AND completed_at IS NULL)
  )
);

-- Create project_comments table
CREATE TABLE IF NOT EXISTS project_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create project_attachments table
CREATE TABLE IF NOT EXISTS project_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  content_type text,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_projects_created_by ON projects(created_by);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_priority ON projects(priority);
CREATE INDEX idx_projects_due_date ON projects(due_date);
CREATE INDEX idx_projects_context ON projects(context_type, context_id);

CREATE INDEX idx_project_assignments_project ON project_assignments(project_id);
CREATE INDEX idx_project_assignments_user ON project_assignments(assigned_to);

CREATE INDEX idx_project_deliverables_project ON project_deliverables(project_id);
CREATE INDEX idx_project_deliverables_order ON project_deliverables(project_id, display_order);

CREATE INDEX idx_project_comments_project ON project_comments(project_id);
CREATE INDEX idx_project_comments_created ON project_comments(created_at DESC);

CREATE INDEX idx_project_attachments_project ON project_attachments(project_id);

-- Add updated_at triggers
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_deliverables_updated_at
  BEFORE UPDATE ON project_deliverables
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_comments_updated_at
  BEFORE UPDATE ON project_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add project_assigned to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'project_assigned';

-- Update context_type check constraint to include 'project'
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_context_type_check
  CHECK (context_type IN ('asset', 'note', 'portfolio', 'theme', 'list', 'workflow', 'project'));

-- Function to notify users when assigned to a project
CREATE OR REPLACE FUNCTION notify_project_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_project_title text;
  v_assigner_name text;
  v_role_text text;
BEGIN
  -- Get project title
  SELECT title INTO v_project_title
  FROM projects
  WHERE id = NEW.project_id;

  -- Get assigner's name
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_assigner_name
  FROM users
  WHERE id = NEW.assigned_by;

  -- Format role
  v_role_text := CASE NEW.role
    WHEN 'owner' THEN 'owner'
    WHEN 'contributor' THEN 'contributor'
    WHEN 'reviewer' THEN 'reviewer'
    ELSE 'contributor'
  END;

  -- Create notification for assigned user
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
    NEW.assigned_to,
    'project_assigned',
    'Assigned to Project',
    v_assigner_name || ' assigned you to "' || v_project_title || '" as ' || v_role_text,
    'project',
    NEW.project_id,
    jsonb_build_object(
      'project_id', NEW.project_id,
      'project_title', v_project_title,
      'assigned_by', NEW.assigned_by,
      'assigner_name', v_assigner_name,
      'role', NEW.role
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for project assignment notifications
DROP TRIGGER IF EXISTS project_assignment_notification ON project_assignments;
CREATE TRIGGER project_assignment_notification
  AFTER INSERT ON project_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_project_assignment();

-- RLS Policies

-- Projects: Users can see projects they created or are assigned to
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view projects they created or are assigned to"
  ON projects FOR SELECT
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM project_assignments
      WHERE project_assignments.project_id = projects.id
      AND project_assignments.assigned_to = auth.uid()
    )
  );

CREATE POLICY "Users can create projects"
  ON projects FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Project creators and owners can update projects"
  ON projects FOR UPDATE
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM project_assignments
      WHERE project_assignments.project_id = projects.id
      AND project_assignments.assigned_to = auth.uid()
      AND project_assignments.role = 'owner'
    )
  );

CREATE POLICY "Project creators and owners can delete projects"
  ON projects FOR DELETE
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM project_assignments
      WHERE project_assignments.project_id = projects.id
      AND project_assignments.assigned_to = auth.uid()
      AND project_assignments.role = 'owner'
    )
  );

-- Project Assignments: Users can see assignments for projects they have access to
ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view assignments for their projects"
  ON project_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_assignments.project_id
      AND (
        auth.uid() = projects.created_by OR
        EXISTS (
          SELECT 1 FROM project_assignments pa2
          WHERE pa2.project_id = projects.id
          AND pa2.assigned_to = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Project creators and owners can manage assignments"
  ON project_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_assignments.project_id
      AND (
        auth.uid() = projects.created_by OR
        EXISTS (
          SELECT 1 FROM project_assignments pa2
          WHERE pa2.project_id = projects.id
          AND pa2.assigned_to = auth.uid()
          AND pa2.role = 'owner'
        )
      )
    )
  );

-- Project Deliverables: Users can see deliverables for projects they have access to
ALTER TABLE project_deliverables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view deliverables for their projects"
  ON project_deliverables FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_deliverables.project_id
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

CREATE POLICY "Project members can create deliverables"
  ON project_deliverables FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_deliverables.project_id
      AND (
        auth.uid() = projects.created_by OR
        EXISTS (
          SELECT 1 FROM project_assignments
          WHERE project_assignments.project_id = projects.id
          AND project_assignments.assigned_to = auth.uid()
          AND project_assignments.role IN ('owner', 'contributor')
        )
      )
    )
  );

CREATE POLICY "Project members can update deliverables"
  ON project_deliverables FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_deliverables.project_id
      AND (
        auth.uid() = projects.created_by OR
        EXISTS (
          SELECT 1 FROM project_assignments
          WHERE project_assignments.project_id = projects.id
          AND project_assignments.assigned_to = auth.uid()
          AND project_assignments.role IN ('owner', 'contributor')
        )
      )
    )
  );

CREATE POLICY "Project creators and owners can delete deliverables"
  ON project_deliverables FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_deliverables.project_id
      AND (
        auth.uid() = projects.created_by OR
        EXISTS (
          SELECT 1 FROM project_assignments
          WHERE project_assignments.project_id = projects.id
          AND project_assignments.assigned_to = auth.uid()
          AND project_assignments.role = 'owner'
        )
      )
    )
  );

-- Project Comments: Users can view and add comments for projects they have access to
ALTER TABLE project_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comments for their projects"
  ON project_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_comments.project_id
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

CREATE POLICY "Project members can create comments"
  ON project_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_comments.project_id
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

CREATE POLICY "Users can update their own comments"
  ON project_comments FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comments"
  ON project_comments FOR DELETE
  USING (auth.uid() = user_id);

-- Project Attachments: Users can view attachments for projects they have access to
ALTER TABLE project_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view attachments for their projects"
  ON project_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_attachments.project_id
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

CREATE POLICY "Project members can upload attachments"
  ON project_attachments FOR INSERT
  WITH CHECK (
    auth.uid() = uploaded_by AND
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_attachments.project_id
      AND (
        auth.uid() = projects.created_by OR
        EXISTS (
          SELECT 1 FROM project_assignments
          WHERE project_assignments.project_id = projects.id
          AND project_assignments.assigned_to = auth.uid()
          AND project_assignments.role IN ('owner', 'contributor')
        )
      )
    )
  );

CREATE POLICY "Users can delete attachments they uploaded"
  ON project_attachments FOR DELETE
  USING (auth.uid() = uploaded_by);
