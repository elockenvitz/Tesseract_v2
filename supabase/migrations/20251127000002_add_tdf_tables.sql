-- Target Date Fund (TDF) Tables Migration
-- Provides TDF management with holdings, comparisons, and trade memorialization

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

CREATE TYPE tdf_trade_status AS ENUM ('proposed', 'approved', 'executed', 'cancelled');

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Target Date Funds (the TDF series: 2015-2070)
CREATE TABLE target_date_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  target_year integer NOT NULL UNIQUE,
  description text,
  fund_code text,
  benchmark text,
  inception_date date,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Underlying Funds (what TDFs can hold)
CREATE TABLE tdf_underlying_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ticker text,
  asset_class text,
  sub_asset_class text,
  expense_ratio numeric(5,4),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Holdings Snapshots (point-in-time captures)
CREATE TABLE tdf_holdings_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tdf_id uuid NOT NULL REFERENCES target_date_funds(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  snapshot_type text DEFAULT 'weekly' CHECK (snapshot_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'manual')),
  total_aum numeric(18,2),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tdf_id, snapshot_date)
);

-- Holdings within a snapshot
CREATE TABLE tdf_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES tdf_holdings_snapshots(id) ON DELETE CASCADE,
  underlying_fund_id uuid NOT NULL REFERENCES tdf_underlying_funds(id) ON DELETE CASCADE,
  weight numeric(7,4) NOT NULL,
  shares numeric(18,4),
  market_value numeric(18,2),
  created_at timestamptz DEFAULT now(),
  UNIQUE(snapshot_id, underlying_fund_id)
);

-- Glide Path Targets (expected allocations by years to retirement)
CREATE TABLE tdf_glide_path_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tdf_id uuid NOT NULL REFERENCES target_date_funds(id) ON DELETE CASCADE,
  years_to_retirement integer NOT NULL,
  equity_weight numeric(5,2) NOT NULL,
  fixed_income_weight numeric(5,2) NOT NULL,
  alternatives_weight numeric(5,2) DEFAULT 0,
  cash_weight numeric(5,2) DEFAULT 0,
  effective_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tdf_id, years_to_retirement, effective_date)
);

-- TDF Notes (positioning rationale, meeting notes, etc.)
CREATE TABLE tdf_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tdf_id uuid NOT NULL REFERENCES target_date_funds(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  content text NOT NULL DEFAULT '',
  note_type text DEFAULT 'general' CHECK (note_type IN ('positioning', 'rationale', 'meeting', 'general')),
  is_pinned boolean DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- TDF Comments (discussion threads)
CREATE TABLE tdf_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tdf_id uuid NOT NULL REFERENCES target_date_funds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  reply_to uuid REFERENCES tdf_comments(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trade Proposals (proposed trades for TDFs)
CREATE TABLE tdf_trade_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tdf_id uuid NOT NULL REFERENCES target_date_funds(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  rationale text NOT NULL,
  status tdf_trade_status DEFAULT 'proposed',
  proposed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trade Proposal Items (individual trades within a proposal)
CREATE TABLE tdf_trade_proposal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES tdf_trade_proposals(id) ON DELETE CASCADE,
  underlying_fund_id uuid NOT NULL REFERENCES tdf_underlying_funds(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('buy', 'sell', 'rebalance')),
  current_weight numeric(7,4),
  target_weight numeric(7,4),
  weight_change numeric(7,4),
  estimated_shares numeric(18,4),
  estimated_value numeric(18,2),
  created_at timestamptz DEFAULT now()
);

-- Executed Trades (memorialization - historical trade log)
CREATE TABLE tdf_executed_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tdf_id uuid NOT NULL REFERENCES target_date_funds(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES tdf_trade_proposals(id) ON DELETE SET NULL,
  underlying_fund_id uuid NOT NULL REFERENCES tdf_underlying_funds(id) ON DELETE CASCADE,
  trade_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('buy', 'sell', 'rebalance')),
  shares numeric(18,4) NOT NULL,
  price numeric(12,4) NOT NULL,
  total_value numeric(18,2) NOT NULL,
  weight_before numeric(7,4),
  weight_after numeric(7,4),
  rationale text,
  execution_notes text,
  executed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_target_date_funds_year ON target_date_funds(target_year);
CREATE INDEX idx_target_date_funds_active ON target_date_funds(is_active);
CREATE INDEX idx_tdf_underlying_funds_asset_class ON tdf_underlying_funds(asset_class);
CREATE INDEX idx_tdf_underlying_funds_active ON tdf_underlying_funds(is_active);
CREATE INDEX idx_tdf_holdings_snapshots_tdf ON tdf_holdings_snapshots(tdf_id);
CREATE INDEX idx_tdf_holdings_snapshots_date ON tdf_holdings_snapshots(snapshot_date DESC);
CREATE INDEX idx_tdf_holdings_snapshots_type ON tdf_holdings_snapshots(snapshot_type);
CREATE INDEX idx_tdf_holdings_snapshot ON tdf_holdings(snapshot_id);
CREATE INDEX idx_tdf_holdings_fund ON tdf_holdings(underlying_fund_id);
CREATE INDEX idx_tdf_glide_path_tdf ON tdf_glide_path_targets(tdf_id);
CREATE INDEX idx_tdf_glide_path_years ON tdf_glide_path_targets(years_to_retirement);
CREATE INDEX idx_tdf_notes_tdf ON tdf_notes(tdf_id);
CREATE INDEX idx_tdf_notes_type ON tdf_notes(note_type);
CREATE INDEX idx_tdf_notes_pinned ON tdf_notes(is_pinned);
CREATE INDEX idx_tdf_comments_tdf ON tdf_comments(tdf_id);
CREATE INDEX idx_tdf_comments_user ON tdf_comments(user_id);
CREATE INDEX idx_tdf_trade_proposals_tdf ON tdf_trade_proposals(tdf_id);
CREATE INDEX idx_tdf_trade_proposals_status ON tdf_trade_proposals(status);
CREATE INDEX idx_tdf_trade_proposal_items_proposal ON tdf_trade_proposal_items(proposal_id);
CREATE INDEX idx_tdf_executed_trades_tdf ON tdf_executed_trades(tdf_id);
CREATE INDEX idx_tdf_executed_trades_date ON tdf_executed_trades(trade_date DESC);
CREATE INDEX idx_tdf_executed_trades_fund ON tdf_executed_trades(underlying_fund_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE target_date_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_underlying_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_holdings_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_glide_path_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_trade_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_trade_proposal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdf_executed_trades ENABLE ROW LEVEL SECURITY;

-- Target Date Funds: All authenticated can view and manage
CREATE POLICY "Users can view TDFs"
  ON target_date_funds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert TDFs"
  ON target_date_funds FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update TDFs"
  ON target_date_funds FOR UPDATE
  TO authenticated
  USING (true);

-- Underlying Funds: All authenticated can view and manage
CREATE POLICY "Users can view underlying funds"
  ON tdf_underlying_funds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert underlying funds"
  ON tdf_underlying_funds FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update underlying funds"
  ON tdf_underlying_funds FOR UPDATE
  TO authenticated
  USING (true);

-- Holdings Snapshots: All authenticated can view and manage
CREATE POLICY "Users can view snapshots"
  ON tdf_holdings_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert snapshots"
  ON tdf_holdings_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update snapshots"
  ON tdf_holdings_snapshots FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete snapshots"
  ON tdf_holdings_snapshots FOR DELETE
  TO authenticated
  USING (true);

-- Holdings: All authenticated can view and manage
CREATE POLICY "Users can view holdings"
  ON tdf_holdings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert holdings"
  ON tdf_holdings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update holdings"
  ON tdf_holdings FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete holdings"
  ON tdf_holdings FOR DELETE
  TO authenticated
  USING (true);

-- Glide Path Targets: All authenticated can view and manage
CREATE POLICY "Users can view glide path"
  ON tdf_glide_path_targets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert glide path"
  ON tdf_glide_path_targets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update glide path"
  ON tdf_glide_path_targets FOR UPDATE
  TO authenticated
  USING (true);

-- TDF Notes: View all, manage own
CREATE POLICY "Users can view TDF notes"
  ON tdf_notes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own TDF notes"
  ON tdf_notes FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own TDF notes"
  ON tdf_notes FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Users can delete own TDF notes"
  ON tdf_notes FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- TDF Comments: View all, manage own
CREATE POLICY "Users can view TDF comments"
  ON tdf_comments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own TDF comments"
  ON tdf_comments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own TDF comments"
  ON tdf_comments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own TDF comments"
  ON tdf_comments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Trade Proposals: All authenticated can view and manage
CREATE POLICY "Users can view trade proposals"
  ON tdf_trade_proposals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert trade proposals"
  ON tdf_trade_proposals FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update trade proposals"
  ON tdf_trade_proposals FOR UPDATE
  TO authenticated
  USING (true);

-- Trade Proposal Items: All authenticated can view and manage
CREATE POLICY "Users can view proposal items"
  ON tdf_trade_proposal_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert proposal items"
  ON tdf_trade_proposal_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update proposal items"
  ON tdf_trade_proposal_items FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete proposal items"
  ON tdf_trade_proposal_items FOR DELETE
  TO authenticated
  USING (true);

-- Executed Trades: All authenticated can view and manage
CREATE POLICY "Users can view executed trades"
  ON tdf_executed_trades FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert executed trades"
  ON tdf_executed_trades FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update executed trades"
  ON tdf_executed_trades FOR UPDATE
  TO authenticated
  USING (true);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Updated_at triggers
CREATE TRIGGER update_target_date_funds_updated_at
  BEFORE UPDATE ON target_date_funds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tdf_underlying_funds_updated_at
  BEFORE UPDATE ON tdf_underlying_funds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tdf_glide_path_updated_at
  BEFORE UPDATE ON tdf_glide_path_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tdf_notes_updated_at
  BEFORE UPDATE ON tdf_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tdf_comments_updated_at
  BEFORE UPDATE ON tdf_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tdf_trade_proposals_updated_at
  BEFORE UPDATE ON tdf_trade_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
