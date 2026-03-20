-- Reconstructed locally to match remote-applied migration. Original applied 2026-02-03.
-- Creates trade_proposals and decision_requests tables for the Trade Lab proposal system.

-- ============================================================================
-- trade_proposals
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_queue_item_id uuid NOT NULL REFERENCES trade_queue_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  lab_id uuid REFERENCES trade_labs(id) ON DELETE SET NULL,
  weight numeric,
  shares integer,
  sizing_mode text,
  sizing_context jsonb DEFAULT '{}'::jsonb,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  proposal_type text DEFAULT 'analyst'::text,
  analyst_input_requested boolean DEFAULT false,
  analyst_input_requested_at timestamptz,
  CONSTRAINT trade_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY['analyst'::text, 'pm_initiated'::text]))
);

-- Additional FK to public.users for joins
ALTER TABLE trade_proposals
  ADD CONSTRAINT trade_proposals_user_id_public_users_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trade_proposals_item ON trade_proposals (trade_queue_item_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_user ON trade_proposals (user_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_lab ON trade_proposals (lab_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_portfolio ON trade_proposals (portfolio_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_proposal_type ON trade_proposals (proposal_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_proposals_unique_active
  ON trade_proposals (trade_queue_item_id, user_id, portfolio_id) WHERE (is_active = true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_trade_proposals_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trade_proposals_updated_at
  BEFORE UPDATE ON trade_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_trade_proposals_updated_at();

-- ============================================================================
-- decision_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS decision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_queue_item_id uuid NOT NULL REFERENCES trade_queue_items(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  urgency text NOT NULL DEFAULT 'medium'::text,
  context_note text,
  status text NOT NULL DEFAULT 'pending'::text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  decision_note text,
  deferred_until timestamptz,
  sizing_weight numeric,
  sizing_shares numeric,
  sizing_mode text,
  CONSTRAINT decision_requests_urgency_check CHECK (urgency = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])),
  CONSTRAINT decision_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'deferred'::text, 'withdrawn'::text]))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_decision_requests_trade ON decision_requests (trade_queue_item_id);
CREATE INDEX IF NOT EXISTS idx_decision_requests_portfolio ON decision_requests (portfolio_id);
CREATE INDEX IF NOT EXISTS idx_decision_requests_status ON decision_requests (status) WHERE (status = 'pending'::text);

-- Partial unique: one active request per requester per item+portfolio
CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_requests_active_per_requester
  ON decision_requests (trade_queue_item_id, portfolio_id, requested_by) WHERE (status = 'pending'::text);
