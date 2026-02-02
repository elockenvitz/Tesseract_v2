-- ============================================================================
-- Trade Lab Views Migration
-- Creates tables for view-based access control in Trade Labs
-- ============================================================================

-- View Type Enum
DO $$ BEGIN
    CREATE TYPE trade_lab_view_type AS ENUM (
        'my_drafts',              -- Private to creator
        'shared',                 -- Shared with specific users
        'portfolio_working_set'   -- All portfolio members
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- View Member Role Enum
DO $$ BEGIN
    CREATE TYPE trade_lab_view_role AS ENUM (
        'owner',    -- Can manage members and delete view
        'editor',   -- Can edit drafts
        'viewer'    -- Read-only access
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Trade Lab Views Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_lab_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parent Simulation (Trade Lab)
    simulation_id UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,

    -- View Type determines visibility rules
    view_type trade_lab_view_type NOT NULL,

    -- Metadata
    name TEXT NOT NULL,
    description TEXT,

    -- Creator (owner for my_drafts and shared views)
    created_by UUID NOT NULL REFERENCES users(id),

    -- Soft Delete (matching trade_queue_items pattern)
    visibility_tier visibility_tier NOT NULL DEFAULT 'active',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    archived_at TIMESTAMPTZ,

    -- Baseline snapshot for impact calculations
    baseline_holdings JSONB,
    baseline_total_value NUMERIC,
    baseline_captured_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT valid_view_name CHECK (length(trim(name)) > 0)
);

-- Unique constraint: one my_drafts view per user per simulation
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_my_drafts_per_user
    ON trade_lab_views (simulation_id, created_by)
    WHERE view_type = 'my_drafts' AND visibility_tier = 'active';

-- Unique constraint: one portfolio_working_set per simulation
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_portfolio_working_set
    ON trade_lab_views (simulation_id)
    WHERE view_type = 'portfolio_working_set' AND visibility_tier = 'active';

-- Index for listing views in a simulation
CREATE INDEX IF NOT EXISTS idx_trade_lab_views_simulation
    ON trade_lab_views (simulation_id, view_type)
    WHERE visibility_tier = 'active';

-- Index for finding user's views
CREATE INDEX IF NOT EXISTS idx_trade_lab_views_creator
    ON trade_lab_views (created_by)
    WHERE view_type = 'my_drafts' AND visibility_tier = 'active';

-- ============================================================================
-- Trade Lab View Members Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_lab_view_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    view_id UUID NOT NULL REFERENCES trade_lab_views(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Role
    role trade_lab_view_role NOT NULL DEFAULT 'viewer',

    -- Invited by
    invited_by UUID REFERENCES users(id),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Unique: one membership per user per view
    CONSTRAINT unique_view_membership UNIQUE (view_id, user_id)
);

-- Index for checking user access to views
CREATE INDEX IF NOT EXISTS idx_trade_lab_view_members_user
    ON trade_lab_view_members (user_id);

-- Index for listing members of a view
CREATE INDEX IF NOT EXISTS idx_trade_lab_view_members_view
    ON trade_lab_view_members (view_id);

-- ============================================================================
-- Add view_id to simulation_trades (optional link to view)
-- ============================================================================

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS view_id UUID REFERENCES trade_lab_views(id) ON DELETE SET NULL;

-- Index for finding drafts by view
CREATE INDEX IF NOT EXISTS idx_simulation_trades_view
    ON simulation_trades (view_id)
    WHERE view_id IS NOT NULL;

-- ============================================================================
-- Updated At Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trade_lab_views_updated_at ON trade_lab_views;
CREATE TRIGGER trg_trade_lab_views_updated_at
    BEFORE UPDATE ON trade_lab_views
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_trade_lab_view_members_updated_at ON trade_lab_view_members;
CREATE TRIGGER trg_trade_lab_view_members_updated_at
    BEFORE UPDATE ON trade_lab_view_members
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Get or create My Drafts view for a user in a simulation
CREATE OR REPLACE FUNCTION get_or_create_my_drafts_view(
    p_simulation_id UUID,
    p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_view_id UUID;
BEGIN
    -- Try to get existing my_drafts view
    SELECT id INTO v_view_id
    FROM trade_lab_views
    WHERE simulation_id = p_simulation_id
      AND view_type = 'my_drafts'
      AND created_by = p_user_id
      AND visibility_tier = 'active';

    -- Create if not exists
    IF v_view_id IS NULL THEN
        INSERT INTO trade_lab_views (simulation_id, view_type, name, created_by)
        VALUES (p_simulation_id, 'my_drafts', 'My Drafts', p_user_id)
        RETURNING id INTO v_view_id;
    END IF;

    RETURN v_view_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE trade_lab_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_lab_view_members ENABLE ROW LEVEL SECURITY;

-- Trade Lab Views: Can see if user can access the simulation
DROP POLICY IF EXISTS trade_lab_views_select ON trade_lab_views;
CREATE POLICY trade_lab_views_select ON trade_lab_views
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM simulations s
            WHERE s.id = trade_lab_views.simulation_id
              AND (
                  s.created_by = auth.uid()
                  OR s.visibility IN ('team', 'public')
                  OR EXISTS (
                      SELECT 1 FROM simulation_collaborators sc
                      WHERE sc.simulation_id = s.id AND sc.user_id = auth.uid()
                  )
              )
        )
        AND (
            -- my_drafts: only creator
            (view_type = 'my_drafts' AND created_by = auth.uid())
            -- portfolio_working_set: all with simulation access
            OR view_type = 'portfolio_working_set'
            -- shared: members only
            OR (view_type = 'shared' AND EXISTS (
                SELECT 1 FROM trade_lab_view_members m
                WHERE m.view_id = trade_lab_views.id
                  AND m.user_id = auth.uid()
            ))
            -- Creator can always see their views
            OR created_by = auth.uid()
        )
    );

DROP POLICY IF EXISTS trade_lab_views_insert ON trade_lab_views;
CREATE POLICY trade_lab_views_insert ON trade_lab_views
    FOR INSERT WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM simulations s
            WHERE s.id = trade_lab_views.simulation_id
              AND (
                  s.created_by = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM simulation_collaborators sc
                      WHERE sc.simulation_id = s.id
                        AND sc.user_id = auth.uid()
                        AND sc.permission IN ('edit', 'admin')
                  )
              )
        )
    );

DROP POLICY IF EXISTS trade_lab_views_update ON trade_lab_views;
CREATE POLICY trade_lab_views_update ON trade_lab_views
    FOR UPDATE USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM trade_lab_view_members m
            WHERE m.view_id = trade_lab_views.id
              AND m.user_id = auth.uid()
              AND m.role IN ('owner', 'editor')
        )
    );

DROP POLICY IF EXISTS trade_lab_views_delete ON trade_lab_views;
CREATE POLICY trade_lab_views_delete ON trade_lab_views
    FOR DELETE USING (created_by = auth.uid());

-- Trade Lab View Members: Visible to members and view owners
DROP POLICY IF EXISTS trade_lab_view_members_select ON trade_lab_view_members;
CREATE POLICY trade_lab_view_members_select ON trade_lab_view_members
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM trade_lab_views v
            WHERE v.id = trade_lab_view_members.view_id
              AND v.created_by = auth.uid()
        )
    );

DROP POLICY IF EXISTS trade_lab_view_members_insert ON trade_lab_view_members;
CREATE POLICY trade_lab_view_members_insert ON trade_lab_view_members
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM trade_lab_views v
            WHERE v.id = trade_lab_view_members.view_id
              AND v.view_type = 'shared'
              AND (
                  v.created_by = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM trade_lab_view_members m2
                      WHERE m2.view_id = v.id
                        AND m2.user_id = auth.uid()
                        AND m2.role = 'owner'
                  )
              )
        )
    );

DROP POLICY IF EXISTS trade_lab_view_members_delete ON trade_lab_view_members;
CREATE POLICY trade_lab_view_members_delete ON trade_lab_view_members
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM trade_lab_views v
            WHERE v.id = trade_lab_view_members.view_id
              AND (
                  v.created_by = auth.uid()
                  OR EXISTS (
                      SELECT 1 FROM trade_lab_view_members m2
                      WHERE m2.view_id = v.id
                        AND m2.user_id = auth.uid()
                        AND m2.role = 'owner'
                  )
              )
        )
    );

COMMENT ON TABLE trade_lab_views IS 'Views within a Trade Lab (Simulation) for organizing drafts';
COMMENT ON TABLE trade_lab_view_members IS 'Membership for shared Trade Lab views';
COMMENT ON COLUMN trade_lab_views.view_type IS 'my_drafts=private, shared=invited members, portfolio_working_set=all portfolio members';
