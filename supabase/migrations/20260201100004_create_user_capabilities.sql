-- ============================================================================
-- User Capabilities Migration
-- Role-based permissions for trade workflow (analyst vs PM)
-- ============================================================================

-- ============================================================================
-- User Capabilities Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE,  -- NULL = org-wide

    -- Trade Workflow Capabilities
    can_create_trade_ideas BOOLEAN NOT NULL DEFAULT true,
    can_move_trade_ideas BOOLEAN NOT NULL DEFAULT true,
    can_delete_trade_ideas BOOLEAN NOT NULL DEFAULT false,
    can_restore_trade_ideas BOOLEAN NOT NULL DEFAULT false,

    -- Trade Lab Capabilities
    can_create_shared_views BOOLEAN NOT NULL DEFAULT true,
    can_manage_portfolio_working_set BOOLEAN NOT NULL DEFAULT false,

    -- Trade Plan Capabilities (Analyst vs PM rules)
    can_create_trade_plans BOOLEAN NOT NULL DEFAULT true,
    can_send_to_desk BOOLEAN NOT NULL DEFAULT false,       -- PM only: direct send without approval
    can_approve_trade_plans BOOLEAN NOT NULL DEFAULT false, -- PM only: can approve analyst submissions

    -- Activity History Capabilities
    can_view_archived_activity BOOLEAN NOT NULL DEFAULT false,
    can_export_activity BOOLEAN NOT NULL DEFAULT false,

    -- Admin Capabilities
    is_portfolio_admin BOOLEAN NOT NULL DEFAULT false,
    is_org_admin BOOLEAN NOT NULL DEFAULT false,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Unique constraint per user/portfolio
    CONSTRAINT unique_user_portfolio_capability UNIQUE (user_id, portfolio_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_capabilities_user
    ON user_capabilities (user_id);

CREATE INDEX IF NOT EXISTS idx_user_capabilities_portfolio
    ON user_capabilities (portfolio_id)
    WHERE portfolio_id IS NOT NULL;

-- ============================================================================
-- Trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trg_user_capabilities_updated_at ON user_capabilities;
CREATE TRIGGER trg_user_capabilities_updated_at
    BEFORE UPDATE ON user_capabilities
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Check if user has a specific capability
CREATE OR REPLACE FUNCTION user_has_capability(
    p_user_id UUID,
    p_capability TEXT,
    p_portfolio_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_result BOOLEAN := false;
BEGIN
    -- Check org-wide capabilities first
    EXECUTE format(
        'SELECT COALESCE(bool_or(%I), false) FROM user_capabilities WHERE user_id = $1 AND portfolio_id IS NULL',
        p_capability
    ) INTO v_result USING p_user_id;

    IF v_result THEN
        RETURN true;
    END IF;

    -- Check portfolio-specific if provided
    IF p_portfolio_id IS NOT NULL THEN
        EXECUTE format(
            'SELECT COALESCE(bool_or(%I), false) FROM user_capabilities WHERE user_id = $1 AND portfolio_id = $2',
            p_capability
        ) INTO v_result USING p_user_id, p_portfolio_id;
    END IF;

    RETURN COALESCE(v_result, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user can send directly to desk (PM role)
CREATE OR REPLACE FUNCTION user_can_send_to_desk(
    p_user_id UUID,
    p_portfolio_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN user_has_capability(p_user_id, 'can_send_to_desk', p_portfolio_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user can approve trade plans (PM role)
CREATE OR REPLACE FUNCTION user_can_approve_plans(
    p_user_id UUID,
    p_portfolio_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN user_has_capability(p_user_id, 'can_approve_trade_plans', p_portfolio_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Get user role (analyst or pm) for a portfolio
CREATE OR REPLACE FUNCTION get_user_trade_role(
    p_user_id UUID,
    p_portfolio_id UUID DEFAULT NULL
)
RETURNS TEXT AS $$
BEGIN
    IF user_can_send_to_desk(p_user_id, p_portfolio_id)
       OR user_can_approve_plans(p_user_id, p_portfolio_id) THEN
        RETURN 'pm';
    ELSE
        RETURN 'analyst';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE user_capabilities ENABLE ROW LEVEL SECURITY;

-- Users can view their own capabilities
DROP POLICY IF EXISTS user_capabilities_select ON user_capabilities;
CREATE POLICY user_capabilities_select ON user_capabilities
    FOR SELECT USING (
        user_id = auth.uid()
        OR user_has_capability(auth.uid(), 'is_org_admin', NULL)
    );

-- Only org admins can insert/update capabilities
DROP POLICY IF EXISTS user_capabilities_insert ON user_capabilities;
CREATE POLICY user_capabilities_insert ON user_capabilities
    FOR INSERT WITH CHECK (
        user_has_capability(auth.uid(), 'is_org_admin', NULL)
    );

DROP POLICY IF EXISTS user_capabilities_update ON user_capabilities;
CREATE POLICY user_capabilities_update ON user_capabilities
    FOR UPDATE USING (
        user_has_capability(auth.uid(), 'is_org_admin', NULL)
    );

DROP POLICY IF EXISTS user_capabilities_delete ON user_capabilities;
CREATE POLICY user_capabilities_delete ON user_capabilities
    FOR DELETE USING (
        user_has_capability(auth.uid(), 'is_org_admin', NULL)
    );

-- ============================================================================
-- Seed Default Capabilities for Existing Users
-- ============================================================================

-- Create default (analyst) capabilities for all existing users who don't have any
INSERT INTO user_capabilities (user_id, portfolio_id)
SELECT u.id, NULL
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_capabilities uc WHERE uc.user_id = u.id
)
ON CONFLICT (user_id, portfolio_id) DO NOTHING;

-- ============================================================================
-- Trigger to Create Default Capabilities for New Users
-- ============================================================================

CREATE OR REPLACE FUNCTION ensure_default_user_capabilities()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_capabilities (user_id, portfolio_id)
    VALUES (NEW.id, NULL)
    ON CONFLICT (user_id, portfolio_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_ensure_default_user_capabilities ON users;
CREATE TRIGGER trg_ensure_default_user_capabilities
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION ensure_default_user_capabilities();

COMMENT ON TABLE user_capabilities IS 'User permissions for trade workflow actions';
COMMENT ON COLUMN user_capabilities.can_send_to_desk IS 'PM capability: can send plans directly to desk without approval';
COMMENT ON COLUMN user_capabilities.can_approve_trade_plans IS 'PM capability: can approve plans submitted by analysts';
COMMENT ON FUNCTION get_user_trade_role IS 'Returns analyst or pm based on user capabilities';
