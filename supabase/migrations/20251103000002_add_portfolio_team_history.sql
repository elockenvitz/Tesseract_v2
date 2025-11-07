/*
  # Portfolio Team History

  Add portfolio_team_history table to track team member changes and a trigger to automatically log changes.
*/

-- Create portfolio_team_history table to track changes
CREATE TABLE IF NOT EXISTS portfolio_team_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  team_member_id UUID REFERENCES portfolio_team(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL, -- 'added', 'removed', 'role_changed', 'focus_changed'
  user_id UUID REFERENCES users(id), -- The team member affected
  old_role TEXT,
  new_role TEXT,
  old_focus TEXT,
  new_focus TEXT,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_portfolio_team_history_portfolio_id ON portfolio_team_history(portfolio_id);
CREATE INDEX idx_portfolio_team_history_changed_at ON portfolio_team_history(changed_at DESC);

-- Enable RLS
ALTER TABLE portfolio_team_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for portfolio_team_history
-- Allow all users to view history
CREATE POLICY "Users can view team history"
  ON portfolio_team_history
  FOR SELECT
  TO authenticated
  USING (true);

-- Only coverage admins can insert history (automatically via triggers)
CREATE POLICY "Coverage admins can insert team history"
  ON portfolio_team_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.coverage_admin = true
    )
  );

-- Create function to log team member changes
CREATE OR REPLACE FUNCTION log_portfolio_team_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Log member addition
    INSERT INTO portfolio_team_history (
      portfolio_id,
      team_member_id,
      change_type,
      user_id,
      new_role,
      new_focus,
      changed_by,
      changed_at
    ) VALUES (
      NEW.portfolio_id,
      NEW.id,
      'added',
      NEW.user_id,
      NEW.role,
      NEW.focus,
      auth.uid(),
      NOW()
    );
    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    -- Check what changed
    IF (OLD.role != NEW.role) THEN
      INSERT INTO portfolio_team_history (
        portfolio_id,
        team_member_id,
        change_type,
        user_id,
        old_role,
        new_role,
        old_focus,
        new_focus,
        changed_by,
        changed_at
      ) VALUES (
        NEW.portfolio_id,
        NEW.id,
        'role_changed',
        NEW.user_id,
        OLD.role,
        NEW.role,
        OLD.focus,
        NEW.focus,
        auth.uid(),
        NOW()
      );
    ELSIF (OLD.focus IS DISTINCT FROM NEW.focus) THEN
      INSERT INTO portfolio_team_history (
        portfolio_id,
        team_member_id,
        change_type,
        user_id,
        old_role,
        new_role,
        old_focus,
        new_focus,
        changed_by,
        changed_at
      ) VALUES (
        NEW.portfolio_id,
        NEW.id,
        'focus_changed',
        NEW.user_id,
        OLD.role,
        NEW.role,
        OLD.focus,
        NEW.focus,
        auth.uid(),
        NOW()
      );
    END IF;
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    -- Log member removal
    INSERT INTO portfolio_team_history (
      portfolio_id,
      team_member_id,
      change_type,
      user_id,
      old_role,
      old_focus,
      changed_by,
      changed_at
    ) VALUES (
      OLD.portfolio_id,
      OLD.id,
      'removed',
      OLD.user_id,
      OLD.role,
      OLD.focus,
      auth.uid(),
      NOW()
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically log changes
CREATE TRIGGER portfolio_team_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON portfolio_team
  FOR EACH ROW
  EXECUTE FUNCTION log_portfolio_team_change();
