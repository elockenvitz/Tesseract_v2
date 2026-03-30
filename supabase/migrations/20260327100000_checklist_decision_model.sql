-- Evolve checklist items into structured decision units
-- Adds: takeaway field, signal typing on comments, evidence metadata on attachments, work requests table

-- 1. Takeaway field on checklist items
ALTER TABLE asset_checklist_items ADD COLUMN IF NOT EXISTS takeaway text;

-- 2. Signal type on comments (maps existing comments → 'insight')
ALTER TABLE checklist_item_comments ADD COLUMN IF NOT EXISTS signal_type text NOT NULL DEFAULT 'insight';
ALTER TABLE checklist_item_comments DROP CONSTRAINT IF EXISTS checklist_item_comments_signal_type_check;
ALTER TABLE checklist_item_comments ADD CONSTRAINT checklist_item_comments_signal_type_check
  CHECK (signal_type IN ('insight', 'question', 'risk', 'data_point', 'commentary'));

-- 3. Evidence metadata on attachments
ALTER TABLE asset_checklist_attachments ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'other';
ALTER TABLE asset_checklist_attachments DROP CONSTRAINT IF EXISTS asset_checklist_attachments_evidence_type_check;
ALTER TABLE asset_checklist_attachments ADD CONSTRAINT asset_checklist_attachments_evidence_type_check
  CHECK (evidence_type IN ('filing', 'chart', 'model', 'news', 'internal_note', 'other'));
ALTER TABLE asset_checklist_attachments ADD COLUMN IF NOT EXISTS description text;

-- 4. Work requests table (replaces generic task assignments for analytical work)
CREATE TABLE IF NOT EXISTS checklist_work_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id uuid NOT NULL REFERENCES asset_checklist_items(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('question', 'investigate', 'validate', 'update_model', 'gather_data', 'follow_up')),
  prompt text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date date,
  expected_output text CHECK (expected_output IS NULL OR expected_output IN ('short_answer', 'written_note', 'data_upload', 'model_update', 'call_summary')),
  context_notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE checklist_work_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read work requests"
  ON checklist_work_requests FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create work requests"
  ON checklist_work_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid());

CREATE POLICY "Owners and requesters can update"
  ON checklist_work_requests FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR requested_by = auth.uid());

CREATE POLICY "Requesters can delete"
  ON checklist_work_requests FOR DELETE TO authenticated
  USING (requested_by = auth.uid());

CREATE INDEX IF NOT EXISTS idx_work_requests_checklist_item ON checklist_work_requests(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_work_requests_owner ON checklist_work_requests(owner_id);
CREATE INDEX IF NOT EXISTS idx_work_requests_status ON checklist_work_requests(status);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_work_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_request_updated_at ON checklist_work_requests;
CREATE TRIGGER work_request_updated_at
  BEFORE UPDATE ON checklist_work_requests
  FOR EACH ROW EXECUTE FUNCTION update_work_request_updated_at();

-- 5. Portfolio checklist items (mirrors general_checklist_items for portfolio-scoped workflows)
CREATE TABLE IF NOT EXISTS portfolio_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_text TEXT,
  item_type TEXT DEFAULT 'operational',
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  sort_order INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unchecked',
  takeaway TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(portfolio_id, workflow_id, stage_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_checklist_items_portfolio_workflow
  ON portfolio_checklist_items(portfolio_id, workflow_id);

ALTER TABLE portfolio_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read portfolio_checklist_items"
  ON portfolio_checklist_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert portfolio_checklist_items"
  ON portfolio_checklist_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update portfolio_checklist_items"
  ON portfolio_checklist_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete portfolio_checklist_items"
  ON portfolio_checklist_items FOR DELETE TO authenticated USING (true);
