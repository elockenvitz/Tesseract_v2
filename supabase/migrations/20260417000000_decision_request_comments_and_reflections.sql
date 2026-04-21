-- ---------------------------------------------------------------------------
-- Decision Request Comments + Reflection Infrastructure
-- ---------------------------------------------------------------------------
-- Enables post-mortem reflections on passed decisions (rejected/deferred).
-- Mirrors accepted_trade_comments schema for consistency.
-- Also adds 'reflection' comment_type to accepted_trade_comments for
-- structured post-mortem capture on committed trades.
-- ---------------------------------------------------------------------------

-- 1. decision_request_comments — reflections on passed decisions
CREATE TABLE IF NOT EXISTS decision_request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_request_id uuid NOT NULL REFERENCES decision_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  comment_type text NOT NULL DEFAULT 'reflection',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_request_comments_dr
  ON decision_request_comments (decision_request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_decision_request_comments_user
  ON decision_request_comments (user_id);

-- 2. RLS — mirrors accepted_trade_comments pattern
ALTER TABLE decision_request_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Portfolio members can view decision comments"
  ON decision_request_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM decision_requests dr
      WHERE dr.id = decision_request_comments.decision_request_id
        AND user_is_portfolio_member(dr.portfolio_id)
    )
  );

CREATE POLICY "Users can insert own decision comments"
  ON decision_request_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM decision_requests dr
      WHERE dr.id = decision_request_comments.decision_request_id
        AND user_is_portfolio_member(dr.portfolio_id)
    )
  );

-- 3. Grant service role full access (edge functions)
GRANT ALL ON decision_request_comments TO service_role;
GRANT SELECT, INSERT ON decision_request_comments TO authenticated;
