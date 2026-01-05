-- Excel Integration Foundation
-- Tables for analyst estimates, ratings, and Excel model sync

-- ============================================================================
-- ESTIMATE METRICS (configurable metric types)
-- ============================================================================
CREATE TABLE estimate_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL, -- eps, revenue, ebitda, fcf, etc.
  label text NOT NULL, -- Display name: "EPS", "Revenue"
  format text NOT NULL DEFAULT 'number', -- number, currency, percent, ratio
  unit text, -- millions, billions, per_share, etc.
  is_default boolean DEFAULT false, -- System preset
  sort_order int DEFAULT 100,
  created_at timestamptz DEFAULT now()
);

-- Seed default metrics
INSERT INTO estimate_metrics (key, label, format, unit, is_default, sort_order) VALUES
  ('eps', 'EPS', 'currency', 'per_share', true, 1),
  ('revenue', 'Revenue', 'currency', 'millions', true, 2),
  ('ebitda', 'EBITDA', 'currency', 'millions', true, 3),
  ('net_income', 'Net Income', 'currency', 'millions', true, 4),
  ('fcf', 'Free Cash Flow', 'currency', 'millions', true, 5),
  ('gross_margin', 'Gross Margin', 'percent', null, true, 6),
  ('operating_margin', 'Operating Margin', 'percent', null, true, 7),
  ('eps_growth', 'EPS Growth', 'percent', null, true, 8),
  ('revenue_growth', 'Revenue Growth', 'percent', null, true, 9);

-- ============================================================================
-- RATING SCALES (configurable rating systems)
-- ============================================================================
CREATE TABLE rating_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  values jsonb NOT NULL, -- [{value: "OW", label: "Overweight", color: "#22c55e", sort: 1}, ...]
  is_default boolean DEFAULT false,
  is_system boolean DEFAULT false, -- System preset, cannot be deleted
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Seed default rating scales
INSERT INTO rating_scales (name, description, values, is_default, is_system) VALUES
  (
    'Weight Scale',
    'Overweight / Neutral / Underweight',
    '[
      {"value": "OW", "label": "Overweight", "color": "#22c55e", "sort": 1},
      {"value": "N", "label": "Neutral", "color": "#6b7280", "sort": 2},
      {"value": "UW", "label": "Underweight", "color": "#ef4444", "sort": 3}
    ]'::jsonb,
    true,
    true
  ),
  (
    'Buy/Hold/Sell',
    'Traditional three-tier rating',
    '[
      {"value": "BUY", "label": "Buy", "color": "#22c55e", "sort": 1},
      {"value": "HOLD", "label": "Hold", "color": "#6b7280", "sort": 2},
      {"value": "SELL", "label": "Sell", "color": "#ef4444", "sort": 3}
    ]'::jsonb,
    false,
    true
  ),
  (
    'Five-Tier',
    'Strong Buy to Strong Sell',
    '[
      {"value": "STRONG_BUY", "label": "Strong Buy", "color": "#15803d", "sort": 1},
      {"value": "BUY", "label": "Buy", "color": "#22c55e", "sort": 2},
      {"value": "HOLD", "label": "Hold", "color": "#6b7280", "sort": 3},
      {"value": "SELL", "label": "Sell", "color": "#f97316", "sort": 4},
      {"value": "STRONG_SELL", "label": "Strong Sell", "color": "#ef4444", "sort": 5}
    ]'::jsonb,
    false,
    true
  ),
  (
    'Numeric (1-5)',
    '1 = Most Attractive, 5 = Least Attractive',
    '[
      {"value": "1", "label": "1 - Most Attractive", "color": "#15803d", "sort": 1},
      {"value": "2", "label": "2 - Attractive", "color": "#22c55e", "sort": 2},
      {"value": "3", "label": "3 - Neutral", "color": "#6b7280", "sort": 3},
      {"value": "4", "label": "4 - Unattractive", "color": "#f97316", "sort": 4},
      {"value": "5", "label": "5 - Most Unattractive", "color": "#ef4444", "sort": 5}
    ]'::jsonb,
    false,
    true
  );

-- ============================================================================
-- ANALYST RATINGS
-- ============================================================================
CREATE TABLE analyst_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating_value text NOT NULL, -- The actual rating: 'OW', 'BUY', '1', etc.
  rating_scale_id uuid NOT NULL REFERENCES rating_scales(id),
  notes text,
  source text DEFAULT 'manual', -- manual, excel_sync, api
  source_file_id uuid, -- References model_files if from Excel
  is_official boolean DEFAULT false, -- True if from covering analyst
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(asset_id, user_id)
);

CREATE INDEX idx_analyst_ratings_asset ON analyst_ratings(asset_id);
CREATE INDEX idx_analyst_ratings_user ON analyst_ratings(user_id);

-- ============================================================================
-- ANALYST ESTIMATES
-- ============================================================================
CREATE TABLE analyst_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_key text NOT NULL, -- eps, revenue, ebitda, or custom
  period_type text NOT NULL CHECK (period_type IN ('annual', 'quarterly')),
  fiscal_year int NOT NULL, -- 2024, 2025, etc.
  fiscal_quarter int CHECK (fiscal_quarter IS NULL OR fiscal_quarter BETWEEN 1 AND 4),
  value numeric NOT NULL,
  currency text DEFAULT 'USD',
  notes text,
  source text DEFAULT 'manual', -- manual, excel_sync, api
  source_file_id uuid, -- References model_files if from Excel
  is_official boolean DEFAULT false, -- True if from covering analyst
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(asset_id, user_id, metric_key, period_type, fiscal_year, fiscal_quarter)
);

CREATE INDEX idx_analyst_estimates_asset ON analyst_estimates(asset_id);
CREATE INDEX idx_analyst_estimates_user ON analyst_estimates(user_id);
CREATE INDEX idx_analyst_estimates_metric ON analyst_estimates(metric_key);
CREATE INDEX idx_analyst_estimates_period ON analyst_estimates(fiscal_year, fiscal_quarter);

-- ============================================================================
-- MODEL TEMPLATES (Excel cell mapping configurations)
-- ============================================================================
CREATE TABLE model_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,

  -- Field mappings: which cells map to which Tesseract fields
  -- [{field: "price_target", cell: "Summary!B5", type: "currency"}, ...]
  field_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Snapshot ranges: which areas to capture as images
  -- [{name: "Summary", range: "Summary!A1:H30"}, ...]
  snapshot_ranges jsonb DEFAULT '[]'::jsonb,

  -- Detection rules: how to auto-detect this template
  -- {filename_patterns: ["*OnePager*"], sheet_names: ["Summary"], cell_checks: [{cell: "A1", contains: "One-Pager"}]}
  detection_rules jsonb DEFAULT '{}'::jsonb,

  -- Ownership
  is_firm_template boolean DEFAULT false, -- Available to all users in org
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_model_templates_org ON model_templates(organization_id);

-- ============================================================================
-- MODEL FILES (uploaded Excel files)
-- ============================================================================
CREATE TABLE model_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- File info
  filename text NOT NULL,
  storage_path text NOT NULL, -- Path in Supabase storage
  file_size int,
  mime_type text,

  -- Template used for parsing
  template_id uuid REFERENCES model_templates(id),

  -- Parsed data
  extracted_data jsonb, -- {price_target: 260, rating: "OW", estimates: {...}}
  snapshot_images jsonb, -- [{name: "Summary", url: "..."}, ...]

  -- Sync status
  sync_status text DEFAULT 'pending' CHECK (sync_status IN ('pending', 'processing', 'synced', 'error')),
  sync_error text,
  synced_at timestamptz,

  -- Versioning
  version int DEFAULT 1,
  is_latest boolean DEFAULT true,
  previous_version_id uuid REFERENCES model_files(id),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_model_files_asset ON model_files(asset_id);
CREATE INDEX idx_model_files_user ON model_files(user_id);
CREATE INDEX idx_model_files_latest ON model_files(asset_id, user_id, is_latest) WHERE is_latest = true;

-- ============================================================================
-- HISTORY TABLES (audit trail)
-- ============================================================================

-- Estimate history
CREATE TABLE analyst_estimate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES analyst_estimates(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES users(id),
  source text, -- What triggered the change
  changed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_estimate_history_estimate ON analyst_estimate_history(estimate_id);

-- Rating history
CREATE TABLE analyst_rating_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_id uuid NOT NULL REFERENCES analyst_ratings(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES users(id),
  source text,
  changed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_rating_history_rating ON analyst_rating_history(rating_id);

-- ============================================================================
-- TRIGGERS FOR HISTORY TRACKING
-- ============================================================================

-- Estimate history trigger
CREATE OR REPLACE FUNCTION track_estimate_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.value IS DISTINCT FROM NEW.value THEN
      INSERT INTO analyst_estimate_history (estimate_id, field_name, old_value, new_value, changed_by, source)
      VALUES (NEW.id, 'value', OLD.value::text, NEW.value::text, NEW.user_id, NEW.source);
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER estimate_changes_trigger
  BEFORE UPDATE ON analyst_estimates
  FOR EACH ROW
  EXECUTE FUNCTION track_estimate_changes();

-- Rating history trigger
CREATE OR REPLACE FUNCTION track_rating_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.rating_value IS DISTINCT FROM NEW.rating_value THEN
      INSERT INTO analyst_rating_history (rating_id, field_name, old_value, new_value, changed_by, source)
      VALUES (NEW.id, 'rating_value', OLD.rating_value, NEW.rating_value, NEW.user_id, NEW.source);
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rating_changes_trigger
  BEFORE UPDATE ON analyst_ratings
  FOR EACH ROW
  EXECUTE FUNCTION track_rating_changes();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE estimate_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE rating_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_estimate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_rating_history ENABLE ROW LEVEL SECURITY;

-- Helper function to get user's organization
CREATE OR REPLACE FUNCTION get_user_organization(p_user_id uuid)
RETURNS uuid AS $$
  SELECT organization_id FROM organization_memberships
  WHERE user_id = p_user_id AND status = 'active'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Estimate metrics: everyone can read defaults
CREATE POLICY "Anyone can read estimate metrics"
  ON estimate_metrics FOR SELECT
  USING (true);

-- Rating scales: everyone can read system/default, org members can read org scales
CREATE POLICY "Anyone can read system rating scales"
  ON rating_scales FOR SELECT
  USING (is_system = true OR organization_id IS NULL OR
         organization_id = get_user_organization(auth.uid()));

CREATE POLICY "Org admins can manage rating scales"
  ON rating_scales FOR ALL
  USING (created_by = auth.uid() OR
         organization_id = get_user_organization(auth.uid()));

-- Analyst ratings: users can manage their own, read others in same org
CREATE POLICY "Users can manage own ratings"
  ON analyst_ratings FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Users can read org ratings"
  ON analyst_ratings FOR SELECT
  USING (
    user_id IN (
      SELECT om.user_id FROM organization_memberships om
      WHERE om.organization_id = get_user_organization(auth.uid())
        AND om.status = 'active'
    )
  );

-- Analyst estimates: same as ratings
CREATE POLICY "Users can manage own estimates"
  ON analyst_estimates FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Users can read org estimates"
  ON analyst_estimates FOR SELECT
  USING (
    user_id IN (
      SELECT om.user_id FROM organization_memberships om
      WHERE om.organization_id = get_user_organization(auth.uid())
        AND om.status = 'active'
    )
  );

-- Model templates: users can manage own, read firm templates
CREATE POLICY "Users can manage own templates"
  ON model_templates FOR ALL
  USING (created_by = auth.uid());

CREATE POLICY "Users can read firm templates"
  ON model_templates FOR SELECT
  USING (
    is_firm_template = true AND
    organization_id = get_user_organization(auth.uid())
  );

-- Model files: users can manage their own
CREATE POLICY "Users can manage own model files"
  ON model_files FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Users can read org model files"
  ON model_files FOR SELECT
  USING (
    user_id IN (
      SELECT om.user_id FROM organization_memberships om
      WHERE om.organization_id = get_user_organization(auth.uid())
        AND om.status = 'active'
    )
  );

-- History tables: read-only based on parent access
CREATE POLICY "Users can read estimate history"
  ON analyst_estimate_history FOR SELECT
  USING (
    estimate_id IN (
      SELECT id FROM analyst_estimates WHERE user_id = auth.uid()
      UNION
      SELECT e.id FROM analyst_estimates e
      WHERE e.user_id IN (
        SELECT om.user_id FROM organization_memberships om
        WHERE om.organization_id = get_user_organization(auth.uid())
          AND om.status = 'active'
      )
    )
  );

CREATE POLICY "Users can read rating history"
  ON analyst_rating_history FOR SELECT
  USING (
    rating_id IN (
      SELECT id FROM analyst_ratings WHERE user_id = auth.uid()
      UNION
      SELECT r.id FROM analyst_ratings r
      WHERE r.user_id IN (
        SELECT om.user_id FROM organization_memberships om
        WHERE om.organization_id = get_user_organization(auth.uid())
          AND om.status = 'active'
      )
    )
  );

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get firm consensus for estimates
CREATE OR REPLACE FUNCTION get_estimate_consensus(
  p_asset_id uuid,
  p_metric_key text,
  p_fiscal_year int,
  p_fiscal_quarter int DEFAULT NULL,
  p_method text DEFAULT 'mean'
)
RETURNS TABLE (
  consensus_value numeric,
  analyst_count int,
  min_value numeric,
  max_value numeric,
  std_dev numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE p_method
      WHEN 'mean' THEN AVG(e.value)
      WHEN 'median' THEN PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY e.value)
      ELSE AVG(e.value)
    END as consensus_value,
    COUNT(DISTINCT e.user_id)::int as analyst_count,
    MIN(e.value) as min_value,
    MAX(e.value) as max_value,
    STDDEV(e.value) as std_dev
  FROM analyst_estimates e
  WHERE e.asset_id = p_asset_id
    AND e.metric_key = p_metric_key
    AND e.fiscal_year = p_fiscal_year
    AND (p_fiscal_quarter IS NULL OR e.fiscal_quarter = p_fiscal_quarter);
END;
$$ LANGUAGE plpgsql;

-- Get firm consensus for ratings
CREATE OR REPLACE FUNCTION get_rating_consensus(p_asset_id uuid)
RETURNS TABLE (
  rating_value text,
  rating_count int,
  total_analysts int
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.rating_value,
    COUNT(*)::int as rating_count,
    (SELECT COUNT(DISTINCT user_id)::int FROM analyst_ratings WHERE asset_id = p_asset_id) as total_analysts
  FROM analyst_ratings r
  WHERE r.asset_id = p_asset_id
  GROUP BY r.rating_value
  ORDER BY rating_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Check if user is covering analyst (reuse existing logic)
CREATE OR REPLACE FUNCTION is_covering_analyst(p_asset_id uuid, p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM coverage
    WHERE asset_id = p_asset_id
      AND user_id = p_user_id
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql;

-- Auto-set is_official on insert/update
CREATE OR REPLACE FUNCTION set_official_flag()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_official := is_covering_analyst(NEW.asset_id, NEW.user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_estimate_official
  BEFORE INSERT OR UPDATE ON analyst_estimates
  FOR EACH ROW
  EXECUTE FUNCTION set_official_flag();

CREATE TRIGGER set_rating_official
  BEFORE INSERT OR UPDATE ON analyst_ratings
  FOR EACH ROW
  EXECUTE FUNCTION set_official_flag();
