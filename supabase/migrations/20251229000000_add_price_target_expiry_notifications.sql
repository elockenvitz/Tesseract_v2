/*
  # Add Price Target Expiry Notifications

  1. Changes
    - Add 'price_target_expired' to notification_type enum
    - Add 'price_target' to context_type check constraint
    - Create function to check and process expired targets
    - Create function to notify analyst of expired target
    - Soft-delete expired targets by marking status as 'expired'

  2. Logic
    - When a price target's target_date passes, mark it as expired
    - Create notification for the analyst who made the target
    - Analyst must create a new target for that scenario
*/

-- Add price_target_expired to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'price_target_expired';

-- Update context_type check constraint to include 'price_target'
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_context_type_check
  CHECK (context_type IN ('asset', 'note', 'portfolio', 'theme', 'list', 'workflow', 'project', 'price_target'));

-- =============================================
-- Function: notify_price_target_expired
-- Creates a notification for the analyst when their target expires
-- =============================================
CREATE OR REPLACE FUNCTION notify_price_target_expired(
  p_price_target_id UUID,
  p_user_id UUID,
  p_asset_id UUID,
  p_asset_name TEXT,
  p_asset_symbol TEXT,
  p_scenario_name TEXT,
  p_target_price NUMERIC,
  p_target_date DATE
) RETURNS VOID AS $$
BEGIN
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    context_type,
    context_id,
    context_data
  ) VALUES (
    p_user_id,
    'price_target_expired',
    'Price Target Expired: ' || p_asset_symbol || ' ' || p_scenario_name,
    'Your ' || p_scenario_name || ' price target of $' || ROUND(p_target_price, 2) || ' for ' || p_asset_name ||
    ' (' || p_asset_symbol || ') expired on ' || TO_CHAR(p_target_date, 'Mon DD, YYYY') ||
    '. Please set a new target for this scenario.',
    'price_target',
    p_price_target_id,
    jsonb_build_object(
      'asset_id', p_asset_id,
      'asset_name', p_asset_name,
      'asset_symbol', p_asset_symbol,
      'scenario_name', p_scenario_name,
      'target_price', p_target_price,
      'target_date', p_target_date,
      'expired_at', NOW()
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- Function: process_expired_price_targets
-- Checks for expired targets and processes them
-- Returns the number of targets processed
-- =============================================
CREATE OR REPLACE FUNCTION process_expired_price_targets()
RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_record RECORD;
BEGIN
  -- Find all pending outcomes where target_date has passed
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
    WHERE pto.status = 'pending'
      AND pto.target_date < CURRENT_DATE
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
-- Function: check_and_expire_user_targets
-- Check and expire targets for a specific user (can be called on login)
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
    WHERE pto.user_id = p_user_id
      AND pto.status = 'pending'
      AND pto.target_date < CURRENT_DATE
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

-- =============================================
-- View: expired_targets_needing_update
-- Shows which analysts need to update their targets
-- =============================================
CREATE OR REPLACE VIEW expired_targets_needing_update AS
SELECT
  pto.user_id,
  u.full_name AS analyst_name,
  pto.asset_id,
  a.name AS asset_name,
  a.symbol AS asset_symbol,
  pto.scenario_type,
  pto.target_price AS expired_price,
  pto.target_date AS expired_date,
  pto.price_target_id,
  pto.evaluated_at AS expired_at
FROM price_target_outcomes pto
JOIN users u ON u.id = pto.user_id
JOIN assets a ON a.id = pto.asset_id
WHERE pto.status = 'expired'
  -- Only show if there's no newer pending/active target for same user/asset/scenario
  AND NOT EXISTS (
    SELECT 1
    FROM price_target_outcomes pto2
    WHERE pto2.user_id = pto.user_id
      AND pto2.asset_id = pto.asset_id
      AND pto2.scenario_type = pto.scenario_type
      AND pto2.status = 'pending'
      AND pto2.created_at > pto.created_at
  )
ORDER BY pto.evaluated_at DESC;

-- Grant access to the view
GRANT SELECT ON expired_targets_needing_update TO authenticated;

-- =============================================
-- Function: get_user_expired_targets
-- Get expired targets that need replacement for a user
-- =============================================
CREATE OR REPLACE FUNCTION get_user_expired_targets(p_user_id UUID)
RETURNS TABLE (
  asset_id UUID,
  asset_name TEXT,
  asset_symbol TEXT,
  scenario_type TEXT,
  expired_price NUMERIC,
  expired_date DATE,
  expired_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.asset_id,
    e.asset_name,
    e.asset_symbol,
    e.scenario_type,
    e.expired_price,
    e.expired_date,
    e.expired_at
  FROM expired_targets_needing_update e
  WHERE e.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run initial check for any already-expired targets
SELECT process_expired_price_targets();
