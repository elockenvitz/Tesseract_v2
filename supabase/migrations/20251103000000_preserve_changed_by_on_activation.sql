/*
  # Preserve changed_by on Future Coverage Activation

  When future coverage becomes active, preserve the original changed_by
  (the person who set up the transition) instead of using the current changed_by.
  This ensures the coverage history shows the correct person who made the transition.
*/

CREATE OR REPLACE FUNCTION log_coverage_change()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_coverage RECORD;
  v_original_changed_by UUID;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Only treat as analyst transition if the NEW coverage is active
    IF NEW.is_active = true THEN
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
        RETURN NEW;
      END IF;
    END IF;

    -- This is new coverage (either truly new or future coverage) - log as created
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
    -- Check if this is an activation of future coverage (becoming active)
    IF OLD.is_active = false AND NEW.is_active = true THEN
      -- Preserve the original changed_by from when the future coverage was created
      -- This ensures we record who set up the transition, not who/what activated it
      v_original_changed_by := OLD.changed_by;

      -- Check if there's existing active coverage
      SELECT * INTO v_existing_coverage
      FROM coverage
      WHERE asset_id = NEW.asset_id
        AND id != NEW.id
        AND is_active = true
      LIMIT 1;

      IF FOUND THEN
        -- Log as analyst_changed for the activation
        -- Use the ORIGINAL changed_by (who set up the transition)
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
          v_original_changed_by,  -- Use original changed_by, not NEW.changed_by
          NEW.updated_at
        );
        RETURN NEW;
      END IF;
    END IF;

    -- Determine what changed for other updates
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
