/*
  # Fix Transition Detection in Coverage History

  Updates the log_coverage_change function to detect analyst transitions.
  When a new coverage record is inserted for an asset that already has active coverage,
  it should log as 'analyst_changed' instead of 'created'.
*/

CREATE OR REPLACE FUNCTION log_coverage_change()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_coverage RECORD;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Check if there's existing active coverage for this asset
    SELECT * INTO v_existing_coverage
    FROM coverage
    WHERE asset_id = NEW.asset_id
      AND id != NEW.id
      AND is_active = true
    LIMIT 1;

    IF FOUND THEN
      -- This is a transition - log as analyst_changed
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
        'analyst_changed',
        v_existing_coverage.user_id,
        v_existing_coverage.analyst_name,
        v_existing_coverage.start_date,
        v_existing_coverage.end_date,
        v_existing_coverage.is_active,
        NEW.user_id,
        NEW.analyst_name,
        NEW.start_date,
        NEW.end_date,
        NEW.is_active,
        NEW.changed_by,
        NEW.updated_at
      );
    ELSE
      -- This is truly new coverage - log as created
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
    END IF;
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
