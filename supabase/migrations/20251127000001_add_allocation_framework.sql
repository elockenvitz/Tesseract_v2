-- Asset Allocation Framework Migration
-- Provides team collaboration on tactical asset allocation views

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

-- Allocation view/stance on asset classes (5 levels)
CREATE TYPE allocation_view AS ENUM (
  'strong_underweight',
  'underweight',
  'market_weight',
  'overweight',
  'strong_overweight'
);

-- Status of allocation periods
CREATE TYPE allocation_view_status AS ENUM ('draft', 'active', 'archived');

-- Vote type for allocation voting
CREATE TYPE allocation_vote_type AS ENUM ('agree', 'disagree', 'abstain');

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Asset Classes (configurable by users)
CREATE TABLE asset_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  parent_id uuid REFERENCES asset_classes(id) ON DELETE SET NULL,
  color text DEFAULT '#3b82f6',
  icon text DEFAULT 'layers',
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Allocation Periods (Q4 2024, November 2024, etc.)
CREATE TABLE allocation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status allocation_view_status DEFAULT 'draft',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Individual Views (each team member's personal view per asset class)
CREATE TABLE individual_allocation_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view allocation_view NOT NULL,
  conviction_level integer CHECK (conviction_level BETWEEN 1 AND 5),
  rationale text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(period_id, asset_class_id, user_id)
);

-- Votes on proposed allocations
CREATE TABLE allocation_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_view allocation_view NOT NULL,
  vote allocation_vote_type NOT NULL,
  comment text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(period_id, asset_class_id, user_id)
);

-- Official Team View (admin-set after discussion)
CREATE TABLE official_allocation_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  view allocation_view NOT NULL,
  rationale text,
  set_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(period_id, asset_class_id)
);

-- Discussion Comments
CREATE TABLE allocation_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid REFERENCES asset_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  reply_to uuid REFERENCES allocation_comments(id) ON DELETE CASCADE,
  is_pinned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- History/Audit Trail for official views
CREATE TABLE allocation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES allocation_periods(id) ON DELETE CASCADE,
  asset_class_id uuid NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  previous_view allocation_view,
  new_view allocation_view NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  change_reason text,
  changed_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_asset_classes_parent ON asset_classes(parent_id);
CREATE INDEX idx_asset_classes_active ON asset_classes(is_active);
CREATE INDEX idx_allocation_periods_status ON allocation_periods(status);
CREATE INDEX idx_allocation_periods_dates ON allocation_periods(start_date, end_date);
CREATE INDEX idx_individual_views_period ON individual_allocation_views(period_id);
CREATE INDEX idx_individual_views_user ON individual_allocation_views(user_id);
CREATE INDEX idx_individual_views_asset_class ON individual_allocation_views(asset_class_id);
CREATE INDEX idx_allocation_votes_period ON allocation_votes(period_id);
CREATE INDEX idx_allocation_votes_user ON allocation_votes(user_id);
CREATE INDEX idx_official_views_period ON official_allocation_views(period_id);
CREATE INDEX idx_allocation_comments_period ON allocation_comments(period_id);
CREATE INDEX idx_allocation_comments_asset_class ON allocation_comments(asset_class_id);
CREATE INDEX idx_allocation_comments_user ON allocation_comments(user_id);
CREATE INDEX idx_allocation_history_period ON allocation_history(period_id);
CREATE INDEX idx_allocation_history_changed_at ON allocation_history(changed_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE asset_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE individual_allocation_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE official_allocation_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_history ENABLE ROW LEVEL SECURITY;

-- Asset Classes: All authenticated users can view and manage
CREATE POLICY "Users can view asset classes"
  ON asset_classes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert asset classes"
  ON asset_classes FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update asset classes"
  ON asset_classes FOR UPDATE
  TO authenticated
  USING (true);

-- Allocation Periods: All authenticated users can view and manage
CREATE POLICY "Users can view allocation periods"
  ON allocation_periods FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert allocation periods"
  ON allocation_periods FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update allocation periods"
  ON allocation_periods FOR UPDATE
  TO authenticated
  USING (true);

-- Individual Views: View all, manage own
CREATE POLICY "Users can view all individual views"
  ON individual_allocation_views FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own views"
  ON individual_allocation_views FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own views"
  ON individual_allocation_views FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own views"
  ON individual_allocation_views FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Votes: View all, manage own
CREATE POLICY "Users can view votes"
  ON allocation_votes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own votes"
  ON allocation_votes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own votes"
  ON allocation_votes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own votes"
  ON allocation_votes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Official Views: View all, manage all (for now, can restrict to admins later)
CREATE POLICY "Users can view official views"
  ON official_allocation_views FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert official views"
  ON official_allocation_views FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update official views"
  ON official_allocation_views FOR UPDATE
  TO authenticated
  USING (true);

-- Comments: View all, manage own
CREATE POLICY "Users can view comments"
  ON allocation_comments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own comments"
  ON allocation_comments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own comments"
  ON allocation_comments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own comments"
  ON allocation_comments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- History: View only
CREATE POLICY "Users can view history"
  ON allocation_history FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Updated_at trigger for asset_classes
CREATE TRIGGER update_asset_classes_updated_at
  BEFORE UPDATE ON asset_classes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for allocation_periods
CREATE TRIGGER update_allocation_periods_updated_at
  BEFORE UPDATE ON allocation_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for individual_allocation_views
CREATE TRIGGER update_individual_views_updated_at
  BEFORE UPDATE ON individual_allocation_views
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for allocation_votes
CREATE TRIGGER update_allocation_votes_updated_at
  BEFORE UPDATE ON allocation_votes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for official_allocation_views
CREATE TRIGGER update_official_views_updated_at
  BEFORE UPDATE ON official_allocation_views
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for allocation_comments
CREATE TRIGGER update_allocation_comments_updated_at
  BEFORE UPDATE ON allocation_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to log official view changes to history
CREATE OR REPLACE FUNCTION log_official_view_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.view IS DISTINCT FROM NEW.view THEN
    INSERT INTO allocation_history (period_id, asset_class_id, previous_view, new_view, changed_by)
    VALUES (NEW.period_id, NEW.asset_class_id, OLD.view, NEW.view, NEW.set_by);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER official_view_change_trigger
  AFTER UPDATE ON official_allocation_views
  FOR EACH ROW
  EXECUTE FUNCTION log_official_view_change();

-- Trigger to log new official views to history
CREATE OR REPLACE FUNCTION log_official_view_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO allocation_history (period_id, asset_class_id, previous_view, new_view, changed_by)
  VALUES (NEW.period_id, NEW.asset_class_id, NULL, NEW.view, NEW.set_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER official_view_insert_trigger
  AFTER INSERT ON official_allocation_views
  FOR EACH ROW
  EXECUTE FUNCTION log_official_view_insert();
