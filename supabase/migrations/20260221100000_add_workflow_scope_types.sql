-- Multi-scope workflow support: asset, portfolio, general
-- Adds scope_type to workflows and creates progress/checklist tables for each scope.

-- 1. Add scope_type to workflows (locked at template creation, inherited by runs)
ALTER TABLE workflows
  ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'asset'
  CONSTRAINT valid_scope_type CHECK (scope_type IN ('asset', 'portfolio', 'general'));

-- 2. Portfolio workflow progress (mirrors asset_workflow_progress)
CREATE TABLE portfolio_workflow_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  current_stage_key VARCHAR,
  is_started BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(portfolio_id, workflow_id)
);

CREATE INDEX idx_portfolio_workflow_progress_workflow ON portfolio_workflow_progress(workflow_id);
CREATE INDEX idx_portfolio_workflow_progress_portfolio ON portfolio_workflow_progress(portfolio_id);

-- 3. General workflow progress (single row per run)
CREATE TABLE general_workflow_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  current_stage_key VARCHAR,
  is_started BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workflow_id)
);

-- 4. General checklist items (per-run checklist, not per-entity)
CREATE TABLE general_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_text TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  sort_order INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unchecked',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workflow_id, stage_id, item_id)
);

CREATE INDEX idx_general_checklist_items_workflow ON general_checklist_items(workflow_id);

-- 5. Workflow portfolio selections (which portfolios a template targets)
CREATE TABLE workflow_portfolio_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workflow_id, portfolio_id)
);

CREATE INDEX idx_workflow_portfolio_selections_workflow ON workflow_portfolio_selections(workflow_id);

-- RLS policies (mirror asset_workflow_progress patterns)
ALTER TABLE portfolio_workflow_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE general_workflow_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE general_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_portfolio_selections ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read/write all (same as asset_workflow_progress)
CREATE POLICY "Authenticated users can read portfolio_workflow_progress"
  ON portfolio_workflow_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert portfolio_workflow_progress"
  ON portfolio_workflow_progress FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update portfolio_workflow_progress"
  ON portfolio_workflow_progress FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete portfolio_workflow_progress"
  ON portfolio_workflow_progress FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read general_workflow_progress"
  ON general_workflow_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert general_workflow_progress"
  ON general_workflow_progress FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update general_workflow_progress"
  ON general_workflow_progress FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete general_workflow_progress"
  ON general_workflow_progress FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read general_checklist_items"
  ON general_checklist_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert general_checklist_items"
  ON general_checklist_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update general_checklist_items"
  ON general_checklist_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete general_checklist_items"
  ON general_checklist_items FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read workflow_portfolio_selections"
  ON workflow_portfolio_selections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert workflow_portfolio_selections"
  ON workflow_portfolio_selections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update workflow_portfolio_selections"
  ON workflow_portfolio_selections FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete workflow_portfolio_selections"
  ON workflow_portfolio_selections FOR DELETE TO authenticated USING (true);
