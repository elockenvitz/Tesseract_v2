/*
  # Add coverage change history tracking

  1. New Tables
    - coverage_history
      - Tracks all changes made to coverage records including:
        - Coverage creation
        - Analyst changes
        - Date range changes (start_date, end_date)
        - Coverage deletion

  2. Functions
    - log_coverage_change: Logs changes to coverage_history table

  3. Triggers
    - coverage_insert_trigger: Logs when new coverage is created
    - coverage_update_trigger: Logs when coverage is modified
    - coverage_delete_trigger: Logs when coverage is deleted

  4. Security
    - Enable RLS on coverage_history
    - Add policies for viewing history
*/

-- Create coverage_history table
CREATE TABLE IF NOT EXISTS coverage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_id UUID NOT NULL, -- References coverage(id), but not FK since record may be deleted
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'analyst_changed', 'dates_changed', 'deleted')),

  -- Before values (null for 'created')
  old_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  old_analyst_name TEXT,
  old_start_date DATE,
  old_end_date DATE,
  old_is_active BOOLEAN,

  -- After values (null for 'deleted')
  new_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  new_analyst_name TEXT,
  new_start_date DATE,
  new_end_date DATE,
  new_is_active BOOLEAN,

  -- Change metadata
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Additional context
  change_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_coverage_history_coverage_id ON coverage_history(coverage_id);
CREATE INDEX idx_coverage_history_asset_id ON coverage_history(asset_id);
CREATE INDEX idx_coverage_history_changed_at ON coverage_history(changed_at DESC);
CREATE INDEX idx_coverage_history_changed_by ON coverage_history(changed_by);

-- Enable RLS
ALTER TABLE coverage_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view coverage history for assets they have access to
CREATE POLICY "Users can view coverage history"
  ON coverage_history
  FOR SELECT
  USING (
    -- Coverage admins can see all history
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND coverage_admin = true
    )
    OR
    -- Users can see history for assets they cover or have covered
    EXISTS (
      SELECT 1 FROM coverage
      WHERE coverage.asset_id = coverage_history.asset_id
      AND coverage.user_id = auth.uid()
    )
  );

-- Function to log coverage changes
CREATE OR REPLACE FUNCTION log_coverage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Log coverage creation
    INSERT INTO coverage_history (
      coverage_id,
      asset_id,
      change_type,
      new_user_id,
      new_analyst_name,
      new_start_date,
      new_end_date,
      new_is_active,
      changed_by,
      changed_at
    ) VALUES (
      NEW.id,
      NEW.asset_id,
      'created',
      NEW.user_id,
      NEW.analyst_name,
      NEW.start_date,
      NEW.end_date,
      NEW.is_active,
      NEW.changed_by,
      NEW.updated_at
    );
    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    -- Determine what changed
    DECLARE
      v_change_type TEXT;
    BEGIN
      IF (OLD.user_id != NEW.user_id OR OLD.analyst_name != NEW.analyst_name) THEN
        v_change_type := 'analyst_changed';
      ELSIF (OLD.start_date != NEW.start_date OR
             (OLD.end_date IS DISTINCT FROM NEW.end_date)) THEN
        v_change_type := 'dates_changed';
      ELSE
        -- Some other field changed, still log it
        v_change_type := 'dates_changed';
      END IF;

      -- Log the change
      INSERT INTO coverage_history (
        coverage_id,
        asset_id,
        change_type,
        old_user_id,
        old_analyst_name,
        old_start_date,
        old_end_date,
        old_is_active,
        new_user_id,
        new_analyst_name,
        new_start_date,
        new_end_date,
        new_is_active,
        changed_by,
        changed_at
      ) VALUES (
        NEW.id,
        NEW.asset_id,
        v_change_type,
        OLD.user_id,
        OLD.analyst_name,
        OLD.start_date,
        OLD.end_date,
        OLD.is_active,
        NEW.user_id,
        NEW.analyst_name,
        NEW.start_date,
        NEW.end_date,
        NEW.is_active,
        NEW.changed_by,
        NEW.updated_at
      );
      RETURN NEW;
    END;

  ELSIF (TG_OP = 'DELETE') THEN
    -- Log coverage deletion
    INSERT INTO coverage_history (
      coverage_id,
      asset_id,
      change_type,
      old_user_id,
      old_analyst_name,
      old_start_date,
      old_end_date,
      old_is_active,
      changed_by,
      changed_at
    ) VALUES (
      OLD.id,
      OLD.asset_id,
      'deleted',
      OLD.user_id,
      OLD.analyst_name,
      OLD.start_date,
      OLD.end_date,
      OLD.is_active,
      auth.uid(),
      NOW()
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
DROP TRIGGER IF EXISTS coverage_insert_trigger ON coverage;
CREATE TRIGGER coverage_insert_trigger
  AFTER INSERT ON coverage
  FOR EACH ROW
  EXECUTE FUNCTION log_coverage_change();

DROP TRIGGER IF EXISTS coverage_update_trigger ON coverage;
CREATE TRIGGER coverage_update_trigger
  AFTER UPDATE ON coverage
  FOR EACH ROW
  EXECUTE FUNCTION log_coverage_change();

DROP TRIGGER IF EXISTS coverage_delete_trigger ON coverage;
CREATE TRIGGER coverage_delete_trigger
  BEFORE DELETE ON coverage
  FOR EACH ROW
  EXECUTE FUNCTION log_coverage_change();

-- Comment the table
COMMENT ON TABLE coverage_history IS 'Audit log tracking all changes to coverage records including creation, analyst changes, date changes, and deletion';
