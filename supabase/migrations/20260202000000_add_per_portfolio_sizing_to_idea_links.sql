/*
  # Add Per-Portfolio Sizing to Trade Lab Idea Links

  Adds proposed_weight and proposed_shares columns to trade_lab_idea_links
  to allow different sizing for the same trade idea across different portfolios.

  1. Changes
    - Add proposed_weight column (numeric, nullable)
    - Add proposed_shares column (integer, nullable)
    - Add UPDATE policy for portfolio members

  2. Rationale
    - Different portfolios have different sizes and risk profiles
    - A 2% position in a $10M portfolio != 2% in a $100M portfolio
    - This enables per-portfolio sizing before expressing as draft trades
*/

-- Add sizing columns to trade_lab_idea_links
ALTER TABLE trade_lab_idea_links
  ADD COLUMN IF NOT EXISTS proposed_weight numeric NULL,
  ADD COLUMN IF NOT EXISTS proposed_shares integer NULL;

-- Add UPDATE policy so portfolio team members can update sizing
CREATE POLICY "Users can update trade lab idea links"
  ON trade_lab_idea_links
  FOR UPDATE
  USING (
    -- User is a portfolio team member for the lab's portfolio
    EXISTS (
      SELECT 1 FROM trade_labs l
      JOIN portfolio_team pt ON pt.portfolio_id = l.portfolio_id
      WHERE l.id = trade_lab_idea_links.trade_lab_id
      AND pt.user_id = auth.uid()
    )
    OR
    -- User created the link
    created_by = auth.uid()
  )
  WITH CHECK (
    -- Same check for the new values
    EXISTS (
      SELECT 1 FROM trade_labs l
      JOIN portfolio_team pt ON pt.portfolio_id = l.portfolio_id
      WHERE l.id = trade_lab_idea_links.trade_lab_id
      AND pt.user_id = auth.uid()
    )
    OR
    created_by = auth.uid()
  );

-- Add comments
COMMENT ON COLUMN trade_lab_idea_links.proposed_weight IS 'Proposed portfolio weight for this idea in this specific lab/portfolio';
COMMENT ON COLUMN trade_lab_idea_links.proposed_shares IS 'Proposed share count for this idea in this specific lab/portfolio';
