/*
  # Add workflow universe configuration

  1. New Tables
    - workflow_universe_rules: Stores rules that define which assets/portfolios/themes should receive a workflow when it kicks off

  2. Features
    - Support for index-based selection (e.g., S&P 500)
    - Support for list-based selection (one or multiple asset lists)
    - Support for theme-based selection
    - Support for dynamic rules (sector, market cap, custom filters)
    - Flexible JSONB configuration for extensibility
*/

-- Create workflow_universe_rules table
CREATE TABLE IF NOT EXISTS workflow_universe_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,

  -- Rule type determines how the rule selects entities
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'index',          -- Select by index membership (S&P 500, Russell 2000, etc.)
    'list',           -- Select assets from specific lists
    'theme',          -- Select assets from specific themes
    'portfolio',      -- Select specific portfolios
    'sector',         -- Select by sector
    'market_cap',     -- Select by market cap range
    'priority',       -- Select by asset priority level
    'stage',          -- Select by current workflow stage
    'coverage',       -- Select assets covered by specific analysts
    'custom_filter'   -- Custom filter rules
  )),

  -- Configuration stored as JSONB for flexibility
  -- Examples:
  -- index: {"index_name": "S&P 500"}
  -- list: {"list_ids": ["uuid1", "uuid2"], "operator": "any"}
  -- theme: {"theme_ids": ["uuid1"], "include_assets": true}
  -- sector: {"sectors": ["Technology", "Healthcare"]}
  -- market_cap: {"min": 10000000000, "max": 100000000000}
  -- priority: {"levels": ["high", "critical"]}
  -- coverage: {"analyst_user_ids": ["uuid1", "uuid2"]}
  -- custom_filter: {"field": "...", "operator": "...", "value": "..."}
  rule_config JSONB NOT NULL DEFAULT '{}',

  -- Combination operator: 'and' or 'or' (how this rule combines with others)
  combination_operator TEXT NOT NULL DEFAULT 'or' CHECK (combination_operator IN ('and', 'or')),

  -- Sort order for applying rules
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Active/inactive flag
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Description for documentation
  description TEXT DEFAULT '',

  -- Timestamps and user tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Add index for faster lookups
CREATE INDEX idx_workflow_universe_rules_workflow_id ON workflow_universe_rules(workflow_id);
CREATE INDEX idx_workflow_universe_rules_active ON workflow_universe_rules(workflow_id, is_active);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_workflow_universe_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_workflow_universe_rules_updated_at
  BEFORE UPDATE ON workflow_universe_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_workflow_universe_rules_updated_at();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_universe_rules TO authenticated;

-- Add RLS policies
ALTER TABLE workflow_universe_rules ENABLE ROW LEVEL SECURITY;

-- Users can view universe rules for workflows they can access
CREATE POLICY "Users can view universe rules for accessible workflows"
  ON workflow_universe_rules
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workflows w
      WHERE w.id = workflow_universe_rules.workflow_id
      AND (
        w.created_by = auth.uid()
        OR w.is_public = true
        OR EXISTS (
          SELECT 1 FROM workflow_collaborations wc
          WHERE wc.workflow_id = w.id
          AND wc.user_id = auth.uid()
        )
      )
    )
  );

-- Users can insert universe rules for workflows they own or have admin access to
CREATE POLICY "Users can insert universe rules for workflows they manage"
  ON workflow_universe_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflows w
      WHERE w.id = workflow_universe_rules.workflow_id
      AND (
        w.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM workflow_collaborations wc
          WHERE wc.workflow_id = w.id
          AND wc.user_id = auth.uid()
          AND wc.permission IN ('write', 'admin')
        )
      )
    )
  );

-- Users can update universe rules for workflows they manage
CREATE POLICY "Users can update universe rules for workflows they manage"
  ON workflow_universe_rules
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workflows w
      WHERE w.id = workflow_universe_rules.workflow_id
      AND (
        w.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM workflow_collaborations wc
          WHERE wc.workflow_id = w.id
          AND wc.user_id = auth.uid()
          AND wc.permission IN ('write', 'admin')
        )
      )
    )
  );

-- Users can delete universe rules for workflows they manage
CREATE POLICY "Users can delete universe rules for workflows they manage"
  ON workflow_universe_rules
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workflows w
      WHERE w.id = workflow_universe_rules.workflow_id
      AND (
        w.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM workflow_collaborations wc
          WHERE wc.workflow_id = w.id
          AND wc.user_id = auth.uid()
          AND wc.permission IN ('write', 'admin')
        )
      )
    )
  );

-- Comment on table
COMMENT ON TABLE workflow_universe_rules IS 'Defines which assets, portfolios, or themes should receive a workflow when it kicks off automatically';
COMMENT ON COLUMN workflow_universe_rules.rule_type IS 'Type of rule: index, list, theme, portfolio, sector, market_cap, priority, stage, or custom_filter';
COMMENT ON COLUMN workflow_universe_rules.rule_config IS 'JSONB configuration specific to the rule type';
COMMENT ON COLUMN workflow_universe_rules.combination_operator IS 'How this rule combines with other rules: "and" (intersection) or "or" (union)';
