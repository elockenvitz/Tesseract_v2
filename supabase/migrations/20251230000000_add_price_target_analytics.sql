/*
  # Add price target analytics tables

  1. New Tables
    - price_target_outcomes
      - Tracks resolution status of each price target (hit/missed/expired)
      - Stores accuracy metrics and timing data
    - analyst_performance_snapshots
      - Aggregate performance metrics computed periodically
      - Tracks hit rates, accuracy, bias by analyst
    - price_history_cache
      - Caches historical prices for outcome evaluation

  2. Triggers
    - Auto-create outcome record when price target is created
    - Update timestamps on modification

  3. Security
    - Enable RLS on all new tables
    - Policies for authenticated users
*/

-- =============================================
-- Table: price_target_outcomes
-- Tracks the resolution status of each price target
-- =============================================
CREATE TABLE IF NOT EXISTS price_target_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_target_id UUID NOT NULL REFERENCES analyst_price_targets(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario_id UUID REFERENCES scenarios(id) ON DELETE SET NULL,

  -- Target snapshot (captured at creation for historical reference)
  target_price NUMERIC NOT NULL,
  target_date DATE NOT NULL,           -- Expected achievement date (based on timeframe)
  target_set_date DATE NOT NULL,       -- When target was created
  scenario_type TEXT,                  -- Bull/Base/Bear for quick filtering

  -- Outcome status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'hit', 'missed', 'expired', 'cancelled')),
  hit_date DATE,                       -- When target was first hit
  hit_price NUMERIC,                   -- Price when hit
  price_at_expiry NUMERIC,             -- Actual price on target_date

  -- Accuracy metrics
  accuracy_pct NUMERIC,                -- 100 = exact hit, decreases with distance
  days_to_hit INTEGER,                 -- Days from target_set_date to hit_date
  overshoot_pct NUMERIC,               -- How much price exceeded target (positive or negative)

  -- Tracking
  evaluated_at TIMESTAMPTZ,            -- When outcome was last evaluated
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One outcome per price target
  UNIQUE(price_target_id)
);

-- Indexes for price_target_outcomes
CREATE INDEX idx_price_target_outcomes_asset_id ON price_target_outcomes(asset_id);
CREATE INDEX idx_price_target_outcomes_user_id ON price_target_outcomes(user_id);
CREATE INDEX idx_price_target_outcomes_status ON price_target_outcomes(status);
CREATE INDEX idx_price_target_outcomes_target_date ON price_target_outcomes(target_date);
CREATE INDEX idx_price_target_outcomes_scenario_type ON price_target_outcomes(scenario_type);

-- Enable RLS
ALTER TABLE price_target_outcomes ENABLE ROW LEVEL SECURITY;

-- Policies for price_target_outcomes
CREATE POLICY "Users can view all price target outcomes"
  ON price_target_outcomes
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own outcomes"
  ON price_target_outcomes
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "System can insert outcomes"
  ON price_target_outcomes
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================
-- Table: analyst_performance_snapshots
-- Aggregate metrics computed periodically
-- =============================================
CREATE TABLE IF NOT EXISTS analyst_performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE, -- NULL = overall performance

  -- Period
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'yearly', 'all_time')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Target counts
  total_targets INTEGER DEFAULT 0,
  hit_targets INTEGER DEFAULT 0,
  missed_targets INTEGER DEFAULT 0,
  pending_targets INTEGER DEFAULT 0,

  -- Accuracy metrics
  hit_rate NUMERIC,                    -- hit_targets / (hit_targets + missed_targets) * 100
  avg_accuracy NUMERIC,                -- Average accuracy_pct across resolved targets
  avg_days_to_hit NUMERIC,             -- Average days to achieve targets

  -- Bias analysis
  bullish_bias NUMERIC,                -- Positive = overestimates, negative = underestimates

  -- Breakdown by scenario (JSONB)
  scenario_breakdown JSONB,            -- { "Bull": { "hit_rate": 70, "count": 10, "avg_accuracy": 85 } }

  -- Overall score (composite metric 0-100)
  overall_score NUMERIC,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One snapshot per user/asset/period combination
  UNIQUE(user_id, asset_id, period_type, period_start, period_end)
);

-- Indexes for analyst_performance_snapshots
CREATE INDEX idx_analyst_performance_user_id ON analyst_performance_snapshots(user_id);
CREATE INDEX idx_analyst_performance_asset_id ON analyst_performance_snapshots(asset_id);
CREATE INDEX idx_analyst_performance_period ON analyst_performance_snapshots(period_type, period_start, period_end);
CREATE INDEX idx_analyst_performance_hit_rate ON analyst_performance_snapshots(hit_rate DESC);
CREATE INDEX idx_analyst_performance_overall_score ON analyst_performance_snapshots(overall_score DESC);

-- Enable RLS
ALTER TABLE analyst_performance_snapshots ENABLE ROW LEVEL SECURITY;

-- Policies for analyst_performance_snapshots
CREATE POLICY "Users can view all performance snapshots"
  ON analyst_performance_snapshots
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert their own snapshots"
  ON analyst_performance_snapshots
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own snapshots"
  ON analyst_performance_snapshots
  FOR UPDATE
  USING (user_id = auth.uid());

-- =============================================
-- Table: price_history_cache
-- Caches historical prices for outcome evaluation
-- =============================================
CREATE TABLE IF NOT EXISTS price_history_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC NOT NULL,
  volume BIGINT,
  source TEXT DEFAULT 'yahoo',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- One entry per symbol/date
  UNIQUE(symbol, date)
);

-- Indexes for price_history_cache
CREATE INDEX idx_price_history_symbol ON price_history_cache(symbol);
CREATE INDEX idx_price_history_date ON price_history_cache(date DESC);
CREATE INDEX idx_price_history_symbol_date ON price_history_cache(symbol, date DESC);

-- Enable RLS
ALTER TABLE price_history_cache ENABLE ROW LEVEL SECURITY;

-- Policies for price_history_cache
CREATE POLICY "Users can view price history cache"
  ON price_history_cache
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert price history"
  ON price_history_cache
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================
-- Function: calculate_target_date
-- Calculates the expected achievement date based on timeframe
-- =============================================
CREATE OR REPLACE FUNCTION calculate_target_date(
  p_created_at TIMESTAMPTZ,
  p_timeframe TEXT
) RETURNS DATE AS $$
BEGIN
  RETURN CASE
    WHEN p_timeframe ILIKE '%3 month%' THEN (p_created_at + INTERVAL '3 months')::DATE
    WHEN p_timeframe ILIKE '%6 month%' THEN (p_created_at + INTERVAL '6 months')::DATE
    WHEN p_timeframe ILIKE '%12 month%' OR p_timeframe ILIKE '%1 year%' THEN (p_created_at + INTERVAL '12 months')::DATE
    WHEN p_timeframe ILIKE '%18 month%' THEN (p_created_at + INTERVAL '18 months')::DATE
    WHEN p_timeframe ILIKE '%24 month%' OR p_timeframe ILIKE '%2 year%' THEN (p_created_at + INTERVAL '24 months')::DATE
    ELSE (p_created_at + INTERVAL '12 months')::DATE -- Default to 12 months
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================
-- Function: create_outcome_for_target
-- Creates an outcome record when a price target is created
-- =============================================
CREATE OR REPLACE FUNCTION create_outcome_for_target()
RETURNS TRIGGER AS $$
DECLARE
  v_scenario_name TEXT;
BEGIN
  -- Get scenario name for type
  SELECT name INTO v_scenario_name
  FROM scenarios
  WHERE id = NEW.scenario_id;

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
    calculate_target_date(NEW.created_at, COALESCE(NEW.timeframe, '12 months')),
    NEW.created_at::DATE,
    v_scenario_name,
    'pending'
  )
  ON CONFLICT (price_target_id) DO UPDATE SET
    target_price = NEW.price,
    target_date = calculate_target_date(NEW.updated_at, COALESCE(NEW.timeframe, '12 months')),
    scenario_type = v_scenario_name,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create outcome when price target is inserted or updated
DROP TRIGGER IF EXISTS create_outcome_on_target_insert ON analyst_price_targets;
CREATE TRIGGER create_outcome_on_target_insert
  AFTER INSERT ON analyst_price_targets
  FOR EACH ROW
  EXECUTE FUNCTION create_outcome_for_target();

DROP TRIGGER IF EXISTS update_outcome_on_target_update ON analyst_price_targets;
CREATE TRIGGER update_outcome_on_target_update
  AFTER UPDATE OF price, timeframe ON analyst_price_targets
  FOR EACH ROW
  EXECUTE FUNCTION create_outcome_for_target();

-- =============================================
-- Function: calculate_accuracy
-- Calculates accuracy percentage (100 = exact hit)
-- =============================================
CREATE OR REPLACE FUNCTION calculate_accuracy(
  p_target_price NUMERIC,
  p_actual_price NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_pct_diff NUMERIC;
BEGIN
  IF p_target_price IS NULL OR p_actual_price IS NULL OR p_target_price = 0 THEN
    RETURN NULL;
  END IF;

  v_pct_diff := ABS(p_target_price - p_actual_price) / p_target_price * 100;
  RETURN GREATEST(0, 100 - v_pct_diff);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================
-- Function: update_analyst_performance
-- Recalculates performance snapshot for an analyst
-- =============================================
CREATE OR REPLACE FUNCTION update_analyst_performance(
  p_user_id UUID,
  p_asset_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_total INTEGER;
  v_hit INTEGER;
  v_missed INTEGER;
  v_pending INTEGER;
  v_hit_rate NUMERIC;
  v_avg_accuracy NUMERIC;
  v_avg_days NUMERIC;
  v_bullish_bias NUMERIC;
  v_scenario_data JSONB;
BEGIN
  -- Calculate counts
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'hit'),
    COUNT(*) FILTER (WHERE status = 'missed'),
    COUNT(*) FILTER (WHERE status = 'pending')
  INTO v_total, v_hit, v_missed, v_pending
  FROM price_target_outcomes
  WHERE user_id = p_user_id
    AND (p_asset_id IS NULL OR asset_id = p_asset_id);

  -- Calculate hit rate
  IF (v_hit + v_missed) > 0 THEN
    v_hit_rate := v_hit::NUMERIC / (v_hit + v_missed) * 100;
  END IF;

  -- Calculate average accuracy
  SELECT AVG(accuracy_pct)
  INTO v_avg_accuracy
  FROM price_target_outcomes
  WHERE user_id = p_user_id
    AND (p_asset_id IS NULL OR asset_id = p_asset_id)
    AND accuracy_pct IS NOT NULL;

  -- Calculate average days to hit
  SELECT AVG(days_to_hit)
  INTO v_avg_days
  FROM price_target_outcomes
  WHERE user_id = p_user_id
    AND (p_asset_id IS NULL OR asset_id = p_asset_id)
    AND days_to_hit IS NOT NULL;

  -- Calculate bullish bias (average overshoot)
  SELECT AVG(overshoot_pct)
  INTO v_bullish_bias
  FROM price_target_outcomes
  WHERE user_id = p_user_id
    AND (p_asset_id IS NULL OR asset_id = p_asset_id)
    AND overshoot_pct IS NOT NULL;

  -- Calculate scenario breakdown
  SELECT jsonb_object_agg(
    scenario_type,
    jsonb_build_object(
      'hit_rate', CASE WHEN (hit_count + missed_count) > 0
                       THEN hit_count::NUMERIC / (hit_count + missed_count) * 100
                       ELSE NULL END,
      'count', total_count,
      'avg_accuracy', avg_acc
    )
  )
  INTO v_scenario_data
  FROM (
    SELECT
      scenario_type,
      COUNT(*) AS total_count,
      COUNT(*) FILTER (WHERE status = 'hit') AS hit_count,
      COUNT(*) FILTER (WHERE status = 'missed') AS missed_count,
      AVG(accuracy_pct) AS avg_acc
    FROM price_target_outcomes
    WHERE user_id = p_user_id
      AND (p_asset_id IS NULL OR asset_id = p_asset_id)
      AND scenario_type IS NOT NULL
    GROUP BY scenario_type
  ) sub;

  -- Upsert performance snapshot
  INSERT INTO analyst_performance_snapshots (
    user_id,
    asset_id,
    period_type,
    period_start,
    period_end,
    total_targets,
    hit_targets,
    missed_targets,
    pending_targets,
    hit_rate,
    avg_accuracy,
    avg_days_to_hit,
    bullish_bias,
    scenario_breakdown,
    overall_score,
    updated_at
  ) VALUES (
    p_user_id,
    p_asset_id,
    'all_time',
    '1900-01-01'::DATE,
    '2100-12-31'::DATE,
    v_total,
    v_hit,
    v_missed,
    v_pending,
    v_hit_rate,
    v_avg_accuracy,
    v_avg_days,
    v_bullish_bias,
    v_scenario_data,
    -- Overall score: weighted combination of hit rate and accuracy
    CASE WHEN v_hit_rate IS NOT NULL AND v_avg_accuracy IS NOT NULL
         THEN (v_hit_rate * 0.6 + v_avg_accuracy * 0.4)
         ELSE NULL END,
    NOW()
  )
  ON CONFLICT (user_id, asset_id, period_type, period_start, period_end)
  DO UPDATE SET
    total_targets = EXCLUDED.total_targets,
    hit_targets = EXCLUDED.hit_targets,
    missed_targets = EXCLUDED.missed_targets,
    pending_targets = EXCLUDED.pending_targets,
    hit_rate = EXCLUDED.hit_rate,
    avg_accuracy = EXCLUDED.avg_accuracy,
    avg_days_to_hit = EXCLUDED.avg_days_to_hit,
    bullish_bias = EXCLUDED.bullish_bias,
    scenario_breakdown = EXCLUDED.scenario_breakdown,
    overall_score = EXCLUDED.overall_score,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- Backfill: Create outcomes for existing price targets
-- =============================================
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
)
SELECT
  apt.id,
  apt.asset_id,
  apt.user_id,
  apt.scenario_id,
  apt.price,
  calculate_target_date(apt.created_at, COALESCE(apt.timeframe, '12 months')),
  apt.created_at::DATE,
  s.name,
  'pending'
FROM analyst_price_targets apt
LEFT JOIN scenarios s ON s.id = apt.scenario_id
WHERE NOT EXISTS (
  SELECT 1 FROM price_target_outcomes pto
  WHERE pto.price_target_id = apt.id
)
ON CONFLICT (price_target_id) DO NOTHING;
