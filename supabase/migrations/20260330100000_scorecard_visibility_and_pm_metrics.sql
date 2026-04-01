-- Scorecard visibility setting + PM performance tracking
-- 1. Add scorecard_visibility to organization_governance
-- 2. Create pm_performance_snapshots for PM-specific metrics

-- 1. Scorecard visibility on org governance
ALTER TABLE organization_governance
  ADD COLUMN IF NOT EXISTS scorecard_visibility text NOT NULL DEFAULT 'role_scoped';

ALTER TABLE organization_governance
  DROP CONSTRAINT IF EXISTS organization_governance_scorecard_visibility_check;

ALTER TABLE organization_governance
  ADD CONSTRAINT organization_governance_scorecard_visibility_check
    CHECK (scorecard_visibility IN ('open', 'role_scoped', 'private'));

COMMENT ON COLUMN organization_governance.scorecard_visibility IS
  'Controls who can see performance scorecards: open=everyone, role_scoped=PMs see all analyst cards + own PM card / analysts see own + anonymized team averages, private=own only';

-- 2. PM performance snapshots
CREATE TABLE IF NOT EXISTS pm_performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE, -- NULL = across all portfolios

  -- Period
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'yearly', 'all_time')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Decision counts
  total_decisions INTEGER DEFAULT 0,
  decisions_executed INTEGER DEFAULT 0,
  decisions_pending INTEGER DEFAULT 0,
  decisions_missed INTEGER DEFAULT 0,

  -- Sizing quality: did position sizes reflect conviction?
  -- Measures correlation between conviction level and actual weight allocated
  sizing_quality_score NUMERIC, -- 0-100

  -- Timing: delay cost from decision to execution
  avg_execution_lag_days NUMERIC,
  total_delay_cost_bps NUMERIC, -- estimated alpha lost from delay

  -- Result quality: did executed decisions add alpha?
  decisions_positive INTEGER DEFAULT 0, -- price moved in intended direction
  decisions_negative INTEGER DEFAULT 0,
  directional_hit_rate NUMERIC, -- decisions_positive / (positive + negative) * 100

  -- Portfolio contribution
  estimated_alpha_bps NUMERIC, -- total estimated alpha contribution in basis points
  best_decision_id UUID, -- decision with highest positive impact
  worst_decision_id UUID, -- decision with highest negative impact

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, portfolio_id, period_type, period_start, period_end)
);

ALTER TABLE pm_performance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pm_performance_snapshots"
  ON pm_performance_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can manage own pm_performance_snapshots"
  ON pm_performance_snapshots FOR ALL TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_pm_performance_user ON pm_performance_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_pm_performance_portfolio ON pm_performance_snapshots(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_pm_performance_period ON pm_performance_snapshots(period_type, period_start, period_end);

-- Update trigger
CREATE OR REPLACE FUNCTION update_pm_performance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pm_performance_updated_at ON pm_performance_snapshots;
CREATE TRIGGER pm_performance_updated_at
  BEFORE UPDATE ON pm_performance_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_pm_performance_updated_at();
