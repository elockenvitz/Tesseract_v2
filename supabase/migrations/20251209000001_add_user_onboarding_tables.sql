-- Migration: Add user onboarding and profile tables
-- This migration creates the necessary tables for the setup wizard and user preferences

-- 1. User Onboarding Status table - tracks wizard completion
CREATE TABLE IF NOT EXISTS user_onboarding_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wizard_completed BOOLEAN DEFAULT FALSE,
  current_step INTEGER DEFAULT 1,
  steps_completed JSONB DEFAULT '[]'::jsonb,
  skipped_steps JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 2. User Profile Extended table - stores detailed user preferences and profile info
CREATE TABLE IF NOT EXISTS user_profile_extended (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Basic profile (Step 1)
  title VARCHAR(100),
  user_type VARCHAR(50) CHECK (user_type IN ('investor', 'operations', 'compliance')),

  -- Investor-specific fields (Step 3a)
  investment_style JSONB DEFAULT '[]'::jsonb, -- ['fundamental', 'quantitative', 'technical', 'macro']
  time_horizon JSONB DEFAULT '[]'::jsonb, -- ['short_term', 'medium_term', 'long_term']
  market_cap_focus JSONB DEFAULT '[]'::jsonb, -- ['large', 'mid', 'small', 'micro']
  geography_focus JSONB DEFAULT '[]'::jsonb, -- ['us', 'international', 'emerging_markets', 'global']
  sector_focus JSONB DEFAULT '[]'::jsonb, -- Array of sector names
  asset_class_focus JSONB DEFAULT '[]'::jsonb, -- ['equities', 'fixed_income', 'alternatives', 'multi_asset']
  universe_scope VARCHAR(50) CHECK (universe_scope IN ('broad', 'specific')),
  specific_tickers JSONB DEFAULT '[]'::jsonb, -- Array of ticker symbols if universe_scope = 'specific'
  strategy_description TEXT, -- Long-form strategy description
  investment_focus_summary TEXT, -- Long-form focus and interests

  -- Operations-specific fields (Step 3b)
  ops_departments JSONB DEFAULT '[]'::jsonb, -- Departments they support
  ops_workflow_types JSONB DEFAULT '[]'::jsonb, -- ['approvals', 'reporting', 'reconciliation', 'settlement']
  ops_role_description TEXT,

  -- Compliance-specific fields (Step 3c)
  compliance_areas JSONB DEFAULT '[]'::jsonb, -- ['trading', 'reporting', 'regulatory', 'risk']
  compliance_divisions JSONB DEFAULT '[]'::jsonb, -- Divisions they oversee
  compliance_role_description TEXT,

  -- Data integrations (Step 4)
  market_data_provider VARCHAR(50) CHECK (market_data_provider IN ('factset', 'bloomberg', 'capiq', 'refinitiv', 'other', 'none')),
  market_data_provider_other VARCHAR(100), -- If 'other' selected
  needs_realtime_prices BOOLEAN DEFAULT FALSE,
  needs_index_data BOOLEAN DEFAULT FALSE,
  needs_fundamentals BOOLEAN DEFAULT FALSE,
  needs_estimates BOOLEAN DEFAULT FALSE,
  needs_news_feeds BOOLEAN DEFAULT FALSE,
  integration_notes TEXT,

  -- Notification preferences (future use)
  email_digest_frequency VARCHAR(20) DEFAULT 'daily' CHECK (email_digest_frequency IN ('realtime', 'daily', 'weekly', 'none')),
  notification_preferences JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 3. Team Access Requests table - for requesting access to teams/portfolios
CREATE TABLE IF NOT EXISTS team_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- What they're requesting access to
  request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('team', 'portfolio', 'division', 'department')),
  target_id UUID NOT NULL, -- ID of the team, portfolio, division, or department
  target_name VARCHAR(255), -- Cached name for display

  -- Request details
  requested_role VARCHAR(100), -- e.g., 'member', 'analyst', 'admin'
  reason TEXT,

  -- Status tracking
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate pending requests
  UNIQUE(user_id, request_type, target_id, status) WHERE status = 'pending'
);

-- Create partial unique index for pending requests (PostgreSQL syntax)
DROP INDEX IF EXISTS idx_team_access_requests_pending_unique;
CREATE UNIQUE INDEX idx_team_access_requests_pending_unique
ON team_access_requests (user_id, request_type, target_id)
WHERE status = 'pending';

-- 4. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_onboarding_status_user_id ON user_onboarding_status(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_extended_user_id ON user_profile_extended(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_extended_user_type ON user_profile_extended(user_type);
CREATE INDEX IF NOT EXISTS idx_team_access_requests_user_id ON team_access_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_team_access_requests_target_id ON team_access_requests(target_id);
CREATE INDEX IF NOT EXISTS idx_team_access_requests_status ON team_access_requests(status);

-- 5. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Add triggers for updated_at
DROP TRIGGER IF EXISTS update_user_onboarding_status_updated_at ON user_onboarding_status;
CREATE TRIGGER update_user_onboarding_status_updated_at
  BEFORE UPDATE ON user_onboarding_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_profile_extended_updated_at ON user_profile_extended;
CREATE TRIGGER update_user_profile_extended_updated_at
  BEFORE UPDATE ON user_profile_extended
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_team_access_requests_updated_at ON team_access_requests;
CREATE TRIGGER update_team_access_requests_updated_at
  BEFORE UPDATE ON team_access_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 7. RLS Policies

-- Enable RLS
ALTER TABLE user_onboarding_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile_extended ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_access_requests ENABLE ROW LEVEL SECURITY;

-- User Onboarding Status policies
CREATE POLICY "Users can view own onboarding status"
  ON user_onboarding_status FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding status"
  ON user_onboarding_status FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding status"
  ON user_onboarding_status FOR UPDATE
  USING (auth.uid() = user_id);

-- User Profile Extended policies
CREATE POLICY "Users can view own profile extended"
  ON user_profile_extended FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile extended"
  ON user_profile_extended FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile extended"
  ON user_profile_extended FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins can view all profiles (for team management)
CREATE POLICY "Admins can view all profiles"
  ON user_profile_extended FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.coverage_admin = true
    )
  );

-- Team Access Requests policies
CREATE POLICY "Users can view own access requests"
  ON team_access_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own access requests"
  ON team_access_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can cancel own pending requests"
  ON team_access_requests FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

-- Admins can view and manage all access requests
CREATE POLICY "Admins can view all access requests"
  ON team_access_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.coverage_admin = true
    )
  );

CREATE POLICY "Admins can update access requests"
  ON team_access_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.coverage_admin = true
    )
  );
