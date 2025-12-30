/*
  # Fix Fixed Target Expiry on Update

  When a Fixed (non-rolling) target is updated/saved, the expiration timer
  should restart from NOW, not from the original created_at date.

  This allows analysts to "renew" their targets by simply saving them again.
*/

-- Update the trigger function to use NOW() for updates on fixed targets
CREATE OR REPLACE FUNCTION create_outcome_for_target()
RETURNS TRIGGER AS $$
DECLARE
  v_scenario_name TEXT;
  v_target_date DATE;
  v_base_date TIMESTAMPTZ;
BEGIN
  -- Rolling targets don't create outcome records (they never expire)
  IF NEW.is_rolling = true THEN
    -- Delete any existing outcome for this target since it's now rolling
    DELETE FROM price_target_outcomes WHERE price_target_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Get scenario name for type
  SELECT name INTO v_scenario_name
  FROM scenarios
  WHERE id = NEW.scenario_id;

  -- For Fixed targets:
  -- - On INSERT: use created_at as base
  -- - On UPDATE: use NOW() to restart the timer (analyst is renewing their target)
  -- For Rolling targets: always use NOW() (handled in calculate_target_date)
  IF TG_OP = 'UPDATE' AND COALESCE(NEW.is_rolling, false) = false THEN
    v_base_date := NOW();
  ELSE
    v_base_date := NEW.created_at;
  END IF;

  -- Calculate target date based on settings
  v_target_date := calculate_target_date(
    v_base_date,
    COALESCE(NEW.timeframe, '12 months'),
    COALESCE(NEW.timeframe_type, 'preset'),
    NEW.target_date,
    COALESCE(NEW.is_rolling, false)
  );

  -- Create or update outcome record
  INSERT INTO price_target_outcomes (
    price_target_id,
    asset_id,
    user_id,
    scenario_id,
    target_price,
    target_date,
    target_set_date,
    scenario_type,
    status
  ) VALUES (
    NEW.id,
    NEW.asset_id,
    NEW.user_id,
    NEW.scenario_id,
    NEW.price,
    v_target_date,
    CURRENT_DATE,  -- Use current date as the "set date" for tracking
    v_scenario_name,
    'pending'
  )
  ON CONFLICT (price_target_id) DO UPDATE SET
    target_price = NEW.price,
    target_date = v_target_date,
    target_set_date = CURRENT_DATE,  -- Reset the set date on update
    scenario_type = v_scenario_name,
    status = 'pending',  -- Reset status to pending when renewed
    evaluated_at = NULL,  -- Clear evaluation since it's renewed
    hit_date = NULL,
    hit_price = NULL,
    price_at_expiry = NULL,
    accuracy_pct = NULL,
    days_to_hit = NULL,
    overshoot_pct = NULL,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also update the analyst_price_targets.updated_at on any update
-- This ensures the frontend can use updated_at for expiration calculation
CREATE OR REPLACE FUNCTION update_analyst_price_target_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_analyst_price_target_timestamp ON analyst_price_targets;
CREATE TRIGGER set_analyst_price_target_timestamp
  BEFORE UPDATE ON analyst_price_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_analyst_price_target_timestamp();
