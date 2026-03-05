-- Add source_team_node_id to portfolio_team to track provenance.
-- When a portfolio_team row is created because the user was added to a team node,
-- source_team_node_id references that team node. NULL means direct assignment.
ALTER TABLE portfolio_team
  ADD COLUMN IF NOT EXISTS source_team_node_id uuid DEFAULT NULL;

-- Backfill: all existing rows are treated as direct assignments (NULL).
-- No update needed since the default is NULL.

-- Index for efficient cascade-delete lookup (find rows by user + source team).
CREATE INDEX IF NOT EXISTS idx_portfolio_team_source
  ON portfolio_team (source_team_node_id)
  WHERE source_team_node_id IS NOT NULL;
