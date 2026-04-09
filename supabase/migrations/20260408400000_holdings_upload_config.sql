-- ============================================================
-- Holdings Upload Configuration
-- ============================================================
--
-- Stores per-org/per-portfolio column mapping configs for CSV
-- holdings uploads. Allows different custodian formats to be
-- mapped once and reused.
-- ============================================================

CREATE TABLE IF NOT EXISTS holdings_upload_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- Column mappings: maps Tesseract fields to CSV column headers
  -- e.g. {"symbol": "Ticker", "shares": "Quantity", "price": "Last Price", "market_value": "Market Val"}
  column_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Number of header rows to skip before data starts
  skip_rows INT DEFAULT 0,
  -- Date format for parsing date columns (if present)
  date_format TEXT DEFAULT 'YYYY-MM-DD',
  -- Whether this is the default config for the org
  is_default BOOLEAN DEFAULT false,
  -- Source identifier (e.g., custodian name)
  source_label TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE holdings_upload_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Holdings configs: org members can read"
  ON holdings_upload_configs FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "Holdings configs: org admins can insert"
  ON holdings_upload_configs FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_org_id()
    AND (is_active_org_admin_of_current_org() OR is_platform_admin())
  );

CREATE POLICY "Holdings configs: org admins can update"
  ON holdings_upload_configs FOR UPDATE TO authenticated
  USING (
    organization_id = current_org_id()
    AND (is_active_org_admin_of_current_org() OR is_platform_admin())
  );

CREATE POLICY "Holdings configs: org admins can delete"
  ON holdings_upload_configs FOR DELETE TO authenticated
  USING (
    organization_id = current_org_id()
    AND (is_active_org_admin_of_current_org() OR is_platform_admin())
  );

CREATE INDEX IF NOT EXISTS idx_holdings_upload_configs_org
  ON holdings_upload_configs(organization_id);

-- ============================================================
-- Holdings upload log — tracks each upload for audit/history
-- ============================================================

CREATE TABLE IF NOT EXISTS holdings_upload_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id),
  snapshot_id UUID REFERENCES portfolio_holdings_snapshots(id),
  config_id UUID REFERENCES holdings_upload_configs(id),
  filename TEXT NOT NULL,
  file_size INT,
  snapshot_date DATE NOT NULL,
  positions_count INT DEFAULT 0,
  warnings JSONB DEFAULT '[]'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'partial', 'failed')),
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE holdings_upload_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Upload log: org members can read"
  ON holdings_upload_log FOR SELECT TO authenticated
  USING (organization_id = current_org_id());

CREATE POLICY "Upload log: org members can insert"
  ON holdings_upload_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = current_org_id());

CREATE INDEX IF NOT EXISTS idx_holdings_upload_log_org
  ON holdings_upload_log(organization_id, portfolio_id, created_at DESC);
