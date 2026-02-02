-- ============================================================================
-- Trade Plans Migration
-- Immutable snapshots with approval workflow
-- ============================================================================

-- Trade Plan Status Enum
DO $$ BEGIN
    CREATE TYPE trade_plan_status AS ENUM (
        'draft',             -- Being composed
        'pending_approval',  -- Submitted, awaiting approval
        'approved',          -- Approved, ready to send
        'rejected',          -- Approval denied
        'sent_to_desk',      -- Sent to trading desk
        'acknowledged'       -- Desk confirmed receipt
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Trade Plans Table (Immutable Snapshots)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source View (immutable reference)
    source_view_id UUID REFERENCES trade_lab_views(id) ON DELETE SET NULL,

    -- Portfolio (denormalized for querying)
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,

    -- Plan Metadata
    name TEXT NOT NULL,
    description TEXT,

    -- Approval Workflow Status
    status trade_plan_status NOT NULL DEFAULT 'draft',

    -- Creator
    created_by UUID NOT NULL REFERENCES users(id),

    -- Submission Details
    submitted_at TIMESTAMPTZ,
    submitted_by UUID REFERENCES users(id),
    submission_note TEXT,

    -- Approval Details
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id),
    approval_note TEXT,

    -- Rejection Details
    rejected_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES users(id),
    rejection_note TEXT,

    -- Desk Submission
    sent_to_desk_at TIMESTAMPTZ,
    sent_to_desk_by UUID REFERENCES users(id),
    desk_reference TEXT,  -- External reference ID from desk

    -- Acknowledgment
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id),
    acknowledgment_note TEXT,

    -- Snapshot Data (immutable after creation)
    snapshot_holdings JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Baseline holdings at plan creation
    snapshot_total_value NUMERIC NOT NULL DEFAULT 0,
    snapshot_metrics JSONB,                                 -- Calculated impact metrics

    -- Soft Delete (matching pattern)
    visibility_tier visibility_tier NOT NULL DEFAULT 'active',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    archived_at TIMESTAMPTZ,
    previous_state JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Version for optimistic concurrency
    version INTEGER NOT NULL DEFAULT 1
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trade_plans_portfolio_status
    ON trade_plans (portfolio_id, status)
    WHERE visibility_tier = 'active';

CREATE INDEX IF NOT EXISTS idx_trade_plans_pending_approval
    ON trade_plans (submitted_at)
    WHERE status = 'pending_approval' AND visibility_tier = 'active';

CREATE INDEX IF NOT EXISTS idx_trade_plans_creator
    ON trade_plans (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_plans_trash_cleanup
    ON trade_plans (deleted_at)
    WHERE visibility_tier = 'trash';

-- ============================================================================
-- Trade Plan Items Table (Immutable line items)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parent Plan
    plan_id UUID NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,

    -- Source References (for traceability)
    source_trade_id UUID REFERENCES simulation_trades(id) ON DELETE SET NULL,
    source_trade_idea_id UUID REFERENCES trade_queue_items(id) ON DELETE SET NULL,

    -- Asset
    asset_id UUID NOT NULL REFERENCES assets(id),

    -- Trade Details (snapshot, immutable)
    action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'trim', 'add')),
    shares NUMERIC NOT NULL,
    weight NUMERIC,
    price NUMERIC NOT NULL,

    -- Calculated Values
    estimated_value NUMERIC GENERATED ALWAYS AS (shares * price) STORED,

    -- Denormalized Asset Info (for display without joins)
    asset_symbol TEXT NOT NULL,
    asset_name TEXT,
    asset_sector TEXT,

    -- Beginning/Ending positions (derived)
    beginning_shares NUMERIC DEFAULT 0,
    beginning_weight NUMERIC DEFAULT 0,
    ending_shares NUMERIC GENERATED ALWAYS AS (
        CASE
            WHEN action IN ('buy', 'add') THEN COALESCE(beginning_shares, 0) + shares
            WHEN action IN ('sell', 'trim') THEN COALESCE(beginning_shares, 0) - shares
            ELSE COALESCE(beginning_shares, 0)
        END
    ) STORED,

    -- Rationale (copied from source)
    rationale TEXT,

    -- Sort Order
    sort_order INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    -- No updated_at: items are immutable
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trade_plan_items_plan
    ON trade_plan_items (plan_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_trade_plan_items_asset
    ON trade_plan_items (asset_id);

-- ============================================================================
-- Trade Plan Approvers (Routing table for approval workflow)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_plan_approvers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Plan being approved
    plan_id UUID NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,

    -- Approver
    approver_id UUID NOT NULL REFERENCES users(id),

    -- Approval Status
    decision TEXT CHECK (decision IN ('pending', 'approved', 'rejected')),
    decision_at TIMESTAMPTZ,
    decision_note TEXT,

    -- Order (for sequential approval chains)
    approval_order INTEGER NOT NULL DEFAULT 0,

    -- Required vs Optional
    is_required BOOLEAN NOT NULL DEFAULT true,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Unique per plan per approver
    CONSTRAINT unique_plan_approver UNIQUE (plan_id, approver_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trade_plan_approvers_plan
    ON trade_plan_approvers (plan_id, approval_order);

CREATE INDEX IF NOT EXISTS idx_trade_plan_approvers_user_pending
    ON trade_plan_approvers (approver_id)
    WHERE decision IS NULL OR decision = 'pending';

-- ============================================================================
-- Triggers
-- ============================================================================

DROP TRIGGER IF EXISTS trg_trade_plans_updated_at ON trade_plans;
CREATE TRIGGER trg_trade_plans_updated_at
    BEFORE UPDATE ON trade_plans
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_trade_plan_approvers_updated_at ON trade_plan_approvers;
CREATE TRIGGER trg_trade_plan_approvers_updated_at
    BEFORE UPDATE ON trade_plan_approvers
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- Version increment for optimistic concurrency
CREATE OR REPLACE FUNCTION trigger_increment_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version = COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trade_plans_version ON trade_plans;
CREATE TRIGGER trg_trade_plans_version
    BEFORE UPDATE ON trade_plans
    FOR EACH ROW
    EXECUTE FUNCTION trigger_increment_version();

-- ============================================================================
-- Helper Function: Create Plan from View
-- ============================================================================

CREATE OR REPLACE FUNCTION create_trade_plan_from_view(
    p_view_id UUID,
    p_name TEXT,
    p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_plan_id UUID;
    v_view trade_lab_views%ROWTYPE;
    v_simulation simulations%ROWTYPE;
BEGIN
    -- Get view details
    SELECT * INTO v_view FROM trade_lab_views WHERE id = p_view_id;
    IF v_view IS NULL THEN
        RAISE EXCEPTION 'View not found: %', p_view_id;
    END IF;

    -- Get simulation details
    SELECT * INTO v_simulation FROM simulations WHERE id = v_view.simulation_id;

    -- Create the plan
    INSERT INTO trade_plans (
        source_view_id,
        portfolio_id,
        name,
        created_by,
        status,
        snapshot_holdings,
        snapshot_total_value
    )
    VALUES (
        p_view_id,
        v_simulation.portfolio_id,
        p_name,
        p_user_id,
        'draft',
        COALESCE(v_simulation.baseline_holdings, '[]'::jsonb),
        COALESCE(v_simulation.baseline_total_value, 0)
    )
    RETURNING id INTO v_plan_id;

    -- Copy all trades from the view (or all trades if no view_id filter)
    INSERT INTO trade_plan_items (
        plan_id,
        source_trade_id,
        source_trade_idea_id,
        asset_id,
        action,
        shares,
        weight,
        price,
        asset_symbol,
        asset_name,
        asset_sector,
        rationale,
        sort_order
    )
    SELECT
        v_plan_id,
        st.id,
        st.trade_queue_item_id,
        st.asset_id,
        st.action,
        COALESCE(st.shares, 0),
        st.weight,
        COALESCE(st.price, 0),
        a.symbol,
        a.company_name,
        a.sector,
        tqi.rationale,
        st.sort_order
    FROM simulation_trades st
    JOIN assets a ON a.id = st.asset_id
    LEFT JOIN trade_queue_items tqi ON tqi.id = st.trade_queue_item_id
    WHERE st.simulation_id = v_view.simulation_id
      AND (st.view_id = p_view_id OR st.view_id IS NULL)
    ORDER BY st.sort_order;

    RETURN v_plan_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE trade_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_plan_approvers ENABLE ROW LEVEL SECURITY;

-- Trade Plans: Portfolio members can view
DROP POLICY IF EXISTS trade_plans_select ON trade_plans;
CREATE POLICY trade_plans_select ON trade_plans
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM portfolios p
            LEFT JOIN portfolio_members pm ON pm.portfolio_id = p.id
            WHERE p.id = trade_plans.portfolio_id
              AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
        )
        OR created_by = auth.uid()
    );

DROP POLICY IF EXISTS trade_plans_insert ON trade_plans;
CREATE POLICY trade_plans_insert ON trade_plans
    FOR INSERT WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM portfolios p
            LEFT JOIN portfolio_members pm ON pm.portfolio_id = p.id
            WHERE p.id = trade_plans.portfolio_id
              AND (p.created_by = auth.uid() OR pm.user_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS trade_plans_update ON trade_plans;
CREATE POLICY trade_plans_update ON trade_plans
    FOR UPDATE USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM trade_plan_approvers a
            WHERE a.plan_id = trade_plans.id
              AND a.approver_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS trade_plans_delete ON trade_plans;
CREATE POLICY trade_plans_delete ON trade_plans
    FOR DELETE USING (created_by = auth.uid());

-- Trade Plan Items: Viewable if parent plan viewable
DROP POLICY IF EXISTS trade_plan_items_select ON trade_plan_items;
CREATE POLICY trade_plan_items_select ON trade_plan_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM trade_plans p
            WHERE p.id = trade_plan_items.plan_id
              AND (
                  p.created_by = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM portfolios port
                      LEFT JOIN portfolio_members pm ON pm.portfolio_id = port.id
                      WHERE port.id = p.portfolio_id
                        AND (port.created_by = auth.uid() OR pm.user_id = auth.uid())
                  )
              )
        )
    );

-- Items are created via function, direct insert requires plan ownership
DROP POLICY IF EXISTS trade_plan_items_insert ON trade_plan_items;
CREATE POLICY trade_plan_items_insert ON trade_plan_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM trade_plans p
            WHERE p.id = trade_plan_items.plan_id
              AND p.created_by = auth.uid()
              AND p.status = 'draft'
        )
    );

-- Trade Plan Approvers: Visible to approvers and plan creators
DROP POLICY IF EXISTS trade_plan_approvers_select ON trade_plan_approvers;
CREATE POLICY trade_plan_approvers_select ON trade_plan_approvers
    FOR SELECT USING (
        approver_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM trade_plans p
            WHERE p.id = trade_plan_approvers.plan_id
              AND p.created_by = auth.uid()
        )
    );

DROP POLICY IF EXISTS trade_plan_approvers_update ON trade_plan_approvers;
CREATE POLICY trade_plan_approvers_update ON trade_plan_approvers
    FOR UPDATE USING (approver_id = auth.uid());

COMMENT ON TABLE trade_plans IS 'Immutable trade plan snapshots with approval workflow';
COMMENT ON TABLE trade_plan_items IS 'Immutable line items within a trade plan';
COMMENT ON TABLE trade_plan_approvers IS 'Approval routing for trade plans';
COMMENT ON COLUMN trade_plans.snapshot_holdings IS 'Immutable copy of holdings at plan creation time';
COMMENT ON COLUMN trade_plans.version IS 'Optimistic concurrency version number';
