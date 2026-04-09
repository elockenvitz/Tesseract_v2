-- ============================================================
-- Holdings Integration Configs — SFTP/API Automated Import
-- ============================================================
--
-- Stores per-client integration configurations for automated
-- daily holdings uploads via SFTP, API, or manual process.
-- Only visible to platform staff (not client-visible).
-- ============================================================

CREATE TABLE IF NOT EXISTS holdings_integration_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
  integration_type TEXT NOT NULL
    CHECK (integration_type IN ('sftp', 'api', 'manual')),
  name TEXT NOT NULL,
  description TEXT,

  -- SFTP config
  sftp_host TEXT,
  sftp_port INT DEFAULT 22,
  sftp_path TEXT,           -- Remote directory path
  sftp_username TEXT,
  sftp_credentials_vault_id TEXT,  -- Reference to Supabase Vault or encrypted store
  sftp_file_pattern TEXT,   -- Glob pattern for matching files, e.g., 'holdings_*.csv'

  -- API config
  api_key_id UUID REFERENCES holdings_api_keys(id),

  -- Shared config
  column_mapping_config_id UUID REFERENCES holdings_upload_configs(id),
  schedule_cron TEXT DEFAULT '0 6 * * *',  -- Default: daily at 6 AM UTC
  timezone TEXT DEFAULT 'America/New_York',

  -- Status tracking
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_failures INT DEFAULT 0,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE holdings_integration_configs ENABLE ROW LEVEL SECURITY;

-- Only platform admins can manage integration configs
CREATE POLICY "Integration configs: platform admins can read"
  ON holdings_integration_configs FOR SELECT TO authenticated
  USING (is_platform_admin());

CREATE POLICY "Integration configs: platform admins can insert"
  ON holdings_integration_configs FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "Integration configs: platform admins can update"
  ON holdings_integration_configs FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "Integration configs: platform admins can delete"
  ON holdings_integration_configs FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_holdings_integration_org
  ON holdings_integration_configs(organization_id);

CREATE INDEX IF NOT EXISTS idx_holdings_integration_active
  ON holdings_integration_configs(is_active) WHERE is_active = true;

-- ============================================================
-- Integration run log — tracks each automated run
-- ============================================================

CREATE TABLE IF NOT EXISTS holdings_integration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES holdings_integration_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  snapshot_id UUID REFERENCES portfolio_holdings_snapshots(id),
  file_name TEXT,
  file_size INT,
  positions_count INT,
  warnings JSONB DEFAULT '[]'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE holdings_integration_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Integration runs: platform admins can read"
  ON holdings_integration_runs FOR SELECT TO authenticated
  USING (is_platform_admin());

CREATE POLICY "Integration runs: system can insert"
  ON holdings_integration_runs FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_integration_runs_config
  ON holdings_integration_runs(config_id, created_at DESC);
