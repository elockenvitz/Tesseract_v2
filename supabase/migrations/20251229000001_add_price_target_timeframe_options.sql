/*
  # Add Price Target Timeframe Options

  1. New Columns on analyst_price_targets
    - timeframe_type: 'preset' | 'date' | 'custom'
    - target_date: Explicit target date (used when type is 'date')
    - is_rolling: For preset timeframes, whether they roll forward or are fixed

  2. Logic
    - Preset + Rolling: Target is always X months from NOW (never expires, recalculates)
    - Preset + Not Rolling: Target is X months from SET date (will expire)
    - Date: Target is a specific date chosen by user
    - Custom: User enters a custom timeframe string

  3. Updates to outcome calculation
    - Rolling targets don't create expiry outcomes
    - Fixed/date targets create outcomes that can expire
*/

-- Add new columns to analyst_price_targets
ALTER TABLE analyst_price_targets
ADD COLUMN IF NOT EXISTS timeframe_type TEXT DEFAULT 'preset'
  CHECK (timeframe_type IN ('preset', 'date', 'custom'));

ALTER TABLE analyst_price_targets
ADD COLUMN IF NOT EXISTS target_date DATE;

ALTER TABLE analyst_price_targets
ADD COLUMN IF NOT EXISTS is_rolling BOOLEAN DEFAULT false;

-- Add index for querying by timeframe type
CREATE INDEX IF NOT EXISTS idx_analyst_price_targets_timeframe_type
  ON analyst_price_targets(timeframe_type);

CREATE INDEX IF NOT EXISTS idx_analyst_price_targets_target_date
  ON analyst_price_targets(target_date);

CREATE INDEX IF NOT EXISTS idx_analyst_price_targets_is_rolling
  ON analyst_price_targets(is_rolling);

-- =============================================
-- Update calculate_target_date function to handle rolling
-- For rolling targets, always calculate from current date
-- For non-rolling, calculate from created_at
-- =============================================
CREATE OR REPLACE FUNCTION calculate_target_date(
  p_created_at TIMESTAMPTZ,
  p_timeframe TEXT,
  p_timeframe_type TEXT DEFAULT 'preset',
  p_target_date DATE DEFAULT NULL,
  p_is_rolling BOOLEAN DEFAULT false
) RETURNS DATE AS $$
DECLARE
  v_base_date TIMESTAMPTZ;
BEGIN
  -- If explicit date is set, use it
  IF p_timeframe_type = 'date' AND p_target_date IS NOT NULL THEN
    RETURN p_target_date;
  END IF;

  -- For rolling targets, calculate from now; otherwise from created_at
  IF p_is_rolling THEN
    v_base_date := NOW();
  ELSE
    v_base_date := p_created_at;
  END IF;

  -- Calculate based on timeframe
  RETURN CASE
    WHEN p_timeframe ILIKE '%3 month%' THEN (v_base_date + INTERVAL '3 months')::DATE
    WHEN p_timeframe ILIKE '%6 month%' THEN (v_base_date + INTERVAL '6 months')::DATE
    WHEN p_timeframe ILIKE '%12 month%' OR p_timeframe ILIKE '%1 year%' THEN (v_base_date + INTERVAL '12 months')::DATE
    WHEN p_timeframe ILIKE '%18 month%' THEN (v_base_date + INTERVAL '18 months')::DATE
    WHEN p_timeframe ILIKE '%24 month%' OR p_timeframe ILIKE '%2 year%' THEN (v_base_date + INTERVAL '24 months')::DATE
    ELSE (v_base_date + INTERVAL '12 months')::DATE -- Default to 12 months
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================
-- Update create_outcome_for_target to handle rolling targets
-- Rolling targets don't get outcomes (they never expire)
-- =============================================
CREATE OR REPLACE FUNCTION create_outcome_for_target()
RETURNS TRIGGER AS $$
DECLARE
  v_scenario_name TEXT;
  v_target_date DATE;
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

  -- Calculate target date based on settings
  v_target_date := calculate_target_date(
    NEW.created_at,
    COALESCE(NEW.timeframe, '12 months'),
    COALESCE(NEW.timeframe_type, 'preset'),
    NEW.target_date,
    COALESCE(NEW.is_rolling, false)
  );

  -- Create outcome record
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
    NEW.created_at::DATE,
    v_scenario_name,
    'pending'
  )
  ON CONFLICT (price_target_id) DO UPDATE SET
    target_price = NEW.price,
    target_date = v_target_date,
    scenario_type = v_scenario_name,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate triggers to use updated function
DROP TRIGGER IF EXISTS create_outcome_on_target_insert ON analyst_price_targets;
CREATE TRIGGER create_outcome_on_target_insert
  AFTER INSERT ON analyst_price_targets
  FOR EACH ROW
  EXECUTE FUNCTION create_outcome_for_target();

DROP TRIGGER IF EXISTS update_outcome_on_target_update ON analyst_price_targets;
CREATE TRIGGER update_outcome_on_target_update
  AFTER UPDATE OF price, timeframe, timeframe_type, target_date, is_rolling ON analyst_price_targets
  FOR EACH ROW
  EXECUTE FUNCTION create_outcome_for_target();

-- =============================================
-- Update process_expired_price_targets to skip rolling targets
-- =============================================
CREATE OR REPLACE FUNCTION process_expired_price_targets()
RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_record RECORD;
BEGIN
  -- Find all pending outcomes where target_date has passed
  -- Join with analyst_price_targets to exclude rolling targets
  FOR v_record IN
    SELECT
      pto.id AS outcome_id,
      pto.price_target_id,
      pto.user_id,
      pto.asset_id,
      pto.target_price,
      pto.target_date,
      pto.scenario_type,
      a.name AS asset_name,
      a.symbol AS asset_symbol
    FROM price_target_outcomes pto
    JOIN assets a ON a.id = pto.asset_id
    JOIN analyst_price_targets apt ON apt.id = pto.price_target_id
    WHERE pto.status = 'pending'
      AND pto.target_date < CURRENT_DATE
      AND COALESCE(apt.is_rolling, false) = false  -- Skip rolling targets
  LOOP
    -- Update outcome status to expired
    UPDATE price_target_outcomes
    SET
      status = 'expired',
      evaluated_at = NOW(),
      updated_at = NOW(),
      notes = COALESCE(notes, '') ||
        CASE WHEN notes IS NOT NULL THEN E'\n' ELSE '' END ||
        'Auto-expired on ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
    WHERE id = v_record.outcome_id;

    -- Create notification for the analyst
    PERFORM notify_price_target_expired(
      v_record.price_target_id,
      v_record.user_id,
      v_record.asset_id,
      v_record.asset_name,
      v_record.asset_symbol,
      COALESCE(v_record.scenario_type, 'Unknown'),
      v_record.target_price,
      v_record.target_date
    );

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- Update check_and_expire_user_targets similarly
-- =============================================
CREATE OR REPLACE FUNCTION check_and_expire_user_targets(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_record RECORD;
BEGIN
  FOR v_record IN
    SELECT
      pto.id AS outcome_id,
      pto.price_target_id,
      pto.user_id,
      pto.asset_id,
      pto.target_price,
      pto.target_date,
      pto.scenario_type,
      a.name AS asset_name,
      a.symbol AS asset_symbol
    FROM price_target_outcomes pto
    JOIN assets a ON a.id = pto.asset_id
    JOIN analyst_price_targets apt ON apt.id = pto.price_target_id
    WHERE pto.user_id = p_user_id
      AND pto.status = 'pending'
      AND pto.target_date < CURRENT_DATE
      AND COALESCE(apt.is_rolling, false) = false  -- Skip rolling targets
  LOOP
    UPDATE price_target_outcomes
    SET
      status = 'expired',
      evaluated_at = NOW(),
      updated_at = NOW(),
      notes = COALESCE(notes, '') ||
        CASE WHEN notes IS NOT NULL THEN E'\n' ELSE '' END ||
        'Auto-expired on ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
    WHERE id = v_record.outcome_id;

    PERFORM notify_price_target_expired(
      v_record.price_target_id,
      v_record.user_id,
      v_record.asset_id,
      v_record.asset_name,
      v_record.asset_symbol,
      COALESCE(v_record.scenario_type, 'Unknown'),
      v_record.target_price,
      v_record.target_date
    );

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Set default values for existing records
UPDATE analyst_price_targets
SET
  timeframe_type = 'preset',
  is_rolling = false
WHERE timeframe_type IS NULL;
