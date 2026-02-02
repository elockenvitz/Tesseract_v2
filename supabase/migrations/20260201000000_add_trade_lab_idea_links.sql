/*
  # Add Trade Lab Idea Links

  Creates a lightweight linking table to associate trade queue ideas with trade labs
  without requiring a full simulation_trade row. This enables the workflow where ideas can be
  "included" in a lab before they are sized/expressed as actual trades.

  1. New Tables
    - trade_lab_idea_links: Links trade queue items to trade labs

  2. Security
    - Enable RLS on trade_lab_idea_links
    - Add policies mirroring trade lab access patterns

  3. Indexes
    - Index on trade_lab_id for efficient lab lookups
    - Index on trade_queue_item_id for efficient idea lookups
*/

-- Create trade_lab_idea_links table
CREATE TABLE IF NOT EXISTS trade_lab_idea_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_lab_id UUID NOT NULL REFERENCES trade_labs(id) ON DELETE CASCADE,
  trade_queue_item_id UUID NOT NULL REFERENCES trade_queue_items(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(trade_lab_id, trade_queue_item_id)
);

-- Enable RLS
ALTER TABLE trade_lab_idea_links ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view links for trade labs they have access to
CREATE POLICY "Users can view trade lab idea links"
  ON trade_lab_idea_links
  FOR SELECT
  USING (
    -- User is a portfolio member for the lab's portfolio
    EXISTS (
      SELECT 1 FROM trade_labs l
      JOIN portfolio_members pm ON pm.portfolio_id = l.portfolio_id
      WHERE l.id = trade_lab_idea_links.trade_lab_id
      AND pm.user_id = auth.uid()
    )
    OR
    -- User created the link
    created_by = auth.uid()
  );

-- Policy: Users can create links if they can write to the trade lab
CREATE POLICY "Users can create trade lab idea links"
  ON trade_lab_idea_links
  FOR INSERT
  WITH CHECK (
    -- User is a portfolio member for the lab's portfolio
    EXISTS (
      SELECT 1 FROM trade_labs l
      JOIN portfolio_members pm ON pm.portfolio_id = l.portfolio_id
      WHERE l.id = trade_lab_idea_links.trade_lab_id
      AND pm.user_id = auth.uid()
    )
  );

-- Policy: Users can delete links if they can write to the trade lab
CREATE POLICY "Users can delete trade lab idea links"
  ON trade_lab_idea_links
  FOR DELETE
  USING (
    -- User is a portfolio member for the lab's portfolio
    EXISTS (
      SELECT 1 FROM trade_labs l
      JOIN portfolio_members pm ON pm.portfolio_id = l.portfolio_id
      WHERE l.id = trade_lab_idea_links.trade_lab_id
      AND pm.user_id = auth.uid()
    )
    OR
    -- User created the link
    created_by = auth.uid()
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_trade_lab_idea_links_trade_lab_id ON trade_lab_idea_links(trade_lab_id);
CREATE INDEX IF NOT EXISTS idx_trade_lab_idea_links_trade_queue_item_id ON trade_lab_idea_links(trade_queue_item_id);

-- Comment the table
COMMENT ON TABLE trade_lab_idea_links IS 'Links trade queue ideas to trade labs for inclusion before full trade expression';
COMMENT ON COLUMN trade_lab_idea_links.trade_lab_id IS 'The trade lab this idea is included in';
COMMENT ON COLUMN trade_lab_idea_links.trade_queue_item_id IS 'The trade queue idea being included';
COMMENT ON COLUMN trade_lab_idea_links.created_by IS 'User who added this idea to the lab';
