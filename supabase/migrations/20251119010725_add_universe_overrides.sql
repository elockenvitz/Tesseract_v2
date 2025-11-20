-- Create table to track manual overrides to universe rules
CREATE TABLE IF NOT EXISTS workflow_universe_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  override_type TEXT NOT NULL CHECK (override_type IN ('add', 'remove')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,

  -- Ensure one override per asset per workflow
  UNIQUE(workflow_id, asset_id)
);

-- Create index for faster lookups
CREATE INDEX idx_universe_overrides_workflow ON workflow_universe_overrides(workflow_id);
CREATE INDEX idx_universe_overrides_asset ON workflow_universe_overrides(asset_id);

-- Enable RLS
ALTER TABLE workflow_universe_overrides ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view overrides for workflows they have access to
CREATE POLICY "Users can view universe overrides for their workflows"
  ON workflow_universe_overrides
  FOR SELECT
  USING (
    workflow_id IN (
      SELECT id FROM workflows
      WHERE created_by = auth.uid()
      OR is_public = true
    )
  );

-- Policy: Users can insert overrides for workflows they created
CREATE POLICY "Users can insert universe overrides for their workflows"
  ON workflow_universe_overrides
  FOR INSERT
  WITH CHECK (
    workflow_id IN (
      SELECT id FROM workflows WHERE created_by = auth.uid()
    )
  );

-- Policy: Users can delete overrides for workflows they created
CREATE POLICY "Users can delete universe overrides for their workflows"
  ON workflow_universe_overrides
  FOR DELETE
  USING (
    workflow_id IN (
      SELECT id FROM workflows WHERE created_by = auth.uid()
    )
  );

-- Add comment
COMMENT ON TABLE workflow_universe_overrides IS 'Tracks manual additions and removals that override universe rules for workflows';
