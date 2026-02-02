-- ============================================================================
-- Trade Labs Architecture Migration
-- Creates one Trade Lab per Portfolio with Views, Drafts, and Plans
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ENUMS (idempotent)
-- ============================================================================

-- Reuse existing enums or create if not exists
DO $$ BEGIN
    CREATE TYPE trade_lab_view_type AS ENUM ('my_drafts', 'shared', 'portfolio_working_set');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE trade_lab_view_role AS ENUM ('owner', 'editor', 'viewer');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE trade_plan_status AS ENUM (
        'draft',
        'pending_approval',
        'approved',
        'rejected',
        'sent_to_desk',
        'acknowledged',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE visibility_tier AS ENUM ('active', 'trash', 'archive');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. TRADE_LABS TABLE (one per portfolio - HARD RULE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_labs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Trade Lab',
    description TEXT,
    settings JSONB NOT NULL DEFAULT '{}',

    -- Migration lineage
    legacy_simulation_id UUID,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),

    -- HARD RULE: Exactly ONE lab per portfolio
    CONSTRAINT trade_labs_portfolio_unique UNIQUE (portfolio_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_labs_portfolio ON trade_labs(portfolio_id);

COMMENT ON TABLE trade_labs IS 'One Trade Lab per portfolio - the workspace for composing trades';
COMMENT ON CONSTRAINT trade_labs_portfolio_unique ON trade_labs IS 'Enforces exactly one lab per portfolio';

-- ============================================================================
-- 3. ADD lab_id TO EXISTING TABLES
-- ============================================================================

-- Add lab_id to trade_lab_views (keeping simulation_id for backwards compat)
ALTER TABLE trade_lab_views
    ADD COLUMN IF NOT EXISTS lab_id UUID REFERENCES trade_labs(id) ON DELETE CASCADE;

-- Add owner_id to trade_lab_views (alias for created_by for cleaner API)
ALTER TABLE trade_lab_views
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);

-- Update owner_id from created_by where null
UPDATE trade_lab_views SET owner_id = created_by WHERE owner_id IS NULL;

-- ============================================================================
-- 4. CREATE TRADE_LAB_DRAFTS TABLE (or add columns to simulation_trades)
-- ============================================================================

-- Add autosave columns to simulation_trades
ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS lab_id UUID REFERENCES trade_labs(id) ON DELETE CASCADE;

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS tags TEXT[];

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS last_autosave_at TIMESTAMPTZ;

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS autosave_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS visibility_tier visibility_tier NOT NULL DEFAULT 'active';

ALTER TABLE simulation_trades
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index for lab-based queries
CREATE INDEX IF NOT EXISTS idx_simulation_trades_lab ON simulation_trades(lab_id);
CREATE INDEX IF NOT EXISTS idx_simulation_trades_lab_view ON simulation_trades(lab_id, view_id)
    WHERE visibility_tier = 'active';

-- ============================================================================
-- 5. UPDATE TRADE_LAB_VIEWS INDEXES FOR LAB
-- ============================================================================

-- Index for listing views in a lab
CREATE INDEX IF NOT EXISTS idx_trade_lab_views_lab ON trade_lab_views(lab_id, view_type)
    WHERE visibility_tier = 'active';

-- Unique: one my_drafts per user per lab
DROP INDEX IF EXISTS idx_trade_lab_views_my_drafts_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_lab_views_my_drafts_unique
ON trade_lab_views(lab_id, owner_id)
WHERE view_type = 'my_drafts' AND visibility_tier = 'active' AND lab_id IS NOT NULL;

-- Unique: one portfolio_working_set per lab
DROP INDEX IF EXISTS idx_trade_lab_views_pws_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_lab_views_pws_unique
ON trade_lab_views(lab_id)
WHERE view_type = 'portfolio_working_set' AND visibility_tier = 'active' AND lab_id IS NOT NULL;

-- ============================================================================
-- 6. UPDATE TRADE_PLANS TABLE
-- ============================================================================

-- Add lab_id and source columns
ALTER TABLE trade_plans
    ADD COLUMN IF NOT EXISTS lab_id UUID REFERENCES trade_labs(id);

ALTER TABLE trade_plans
    ADD COLUMN IF NOT EXISTS source_view_id UUID REFERENCES trade_lab_views(id);

ALTER TABLE trade_plans
    ADD COLUMN IF NOT EXISTS source_view_name TEXT;

ALTER TABLE trade_plans
    ADD COLUMN IF NOT EXISTS template_id UUID;

-- Indexes for Trade Plans History queries
CREATE INDEX IF NOT EXISTS idx_trade_plans_lab ON trade_plans(lab_id);
CREATE INDEX IF NOT EXISTS idx_trade_plans_source_view ON trade_plans(source_view_id);
CREATE INDEX IF NOT EXISTS idx_trade_plans_created_at ON trade_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_plans_created_by ON trade_plans(created_by);

-- Composite index for history queries
CREATE INDEX IF NOT EXISTS idx_trade_plans_history
ON trade_plans(portfolio_id, created_at DESC, status)
WHERE visibility_tier = 'active';

-- ============================================================================
-- 7. ACTIVITY_EVENTS TABLE (for comprehensive audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Actor
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'user',
    actor_name TEXT,
    actor_email TEXT,

    -- Entity
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    entity_display_name TEXT,

    -- Action
    action_type TEXT NOT NULL,
    action_category TEXT NOT NULL DEFAULT 'user',

    -- Context
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
    lab_id UUID REFERENCES trade_labs(id) ON DELETE SET NULL,
    view_id UUID REFERENCES trade_lab_views(id) ON DELETE SET NULL,
    plan_id UUID REFERENCES trade_plans(id) ON DELETE SET NULL,

    -- State changes
    from_state JSONB,
    to_state JSONB,
    changed_fields TEXT[],

    -- Metadata
    metadata JSONB NOT NULL DEFAULT '{}',
    request_id UUID,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for activity queries
CREATE INDEX IF NOT EXISTS idx_activity_events_entity ON activity_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_actor ON activity_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_portfolio ON activity_events(portfolio_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_lab ON activity_events(lab_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_plan ON activity_events(plan_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_occurred ON activity_events(occurred_at DESC);

-- ============================================================================
-- 8. HELPER FUNCTIONS
-- ============================================================================

-- Get or create trade lab for a portfolio (enforces one-per-portfolio)
CREATE OR REPLACE FUNCTION get_or_create_trade_lab(p_portfolio_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_lab_id UUID;
    v_portfolio_name TEXT;
BEGIN
    -- Try to get existing lab
    SELECT id INTO v_lab_id
    FROM trade_labs
    WHERE portfolio_id = p_portfolio_id;

    IF v_lab_id IS NOT NULL THEN
        RETURN v_lab_id;
    END IF;

    -- Get portfolio name for lab name
    SELECT name INTO v_portfolio_name
    FROM portfolios
    WHERE id = p_portfolio_id;

    -- Create new lab
    INSERT INTO trade_labs (portfolio_id, name, created_by)
    VALUES (
        p_portfolio_id,
        COALESCE(v_portfolio_name || ' Trade Lab', 'Trade Lab'),
        auth.uid()
    )
    ON CONFLICT (portfolio_id) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_lab_id;

    RETURN v_lab_id;
END;
$$;

-- Get or create My Drafts view for a user in a lab
CREATE OR REPLACE FUNCTION get_or_create_lab_my_drafts_view(p_lab_id UUID, p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_view_id UUID;
BEGIN
    -- Try to get existing view
    SELECT id INTO v_view_id
    FROM trade_lab_views
    WHERE lab_id = p_lab_id
      AND owner_id = p_user_id
      AND view_type = 'my_drafts'
      AND visibility_tier = 'active';

    IF v_view_id IS NOT NULL THEN
        RETURN v_view_id;
    END IF;

    -- Create new view
    INSERT INTO trade_lab_views (lab_id, view_type, name, owner_id, created_by)
    VALUES (
        p_lab_id,
        'my_drafts',
        'My Drafts',
        p_user_id,
        p_user_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_view_id;

    -- If conflict, fetch the existing one
    IF v_view_id IS NULL THEN
        SELECT id INTO v_view_id
        FROM trade_lab_views
        WHERE lab_id = p_lab_id
          AND owner_id = p_user_id
          AND view_type = 'my_drafts'
          AND visibility_tier = 'active';
    END IF;

    RETURN v_view_id;
END;
$$;

-- Get or create Portfolio Working Set view for a lab
CREATE OR REPLACE FUNCTION get_or_create_portfolio_working_set(p_lab_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_view_id UUID;
BEGIN
    -- Try to get existing view
    SELECT id INTO v_view_id
    FROM trade_lab_views
    WHERE lab_id = p_lab_id
      AND view_type = 'portfolio_working_set'
      AND visibility_tier = 'active';

    IF v_view_id IS NOT NULL THEN
        RETURN v_view_id;
    END IF;

    -- Create new view
    INSERT INTO trade_lab_views (lab_id, view_type, name, created_by)
    VALUES (
        p_lab_id,
        'portfolio_working_set',
        'Portfolio Working Set',
        auth.uid()
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_view_id;

    -- If conflict, fetch the existing one
    IF v_view_id IS NULL THEN
        SELECT id INTO v_view_id
        FROM trade_lab_views
        WHERE lab_id = p_lab_id
          AND view_type = 'portfolio_working_set'
          AND visibility_tier = 'active';
    END IF;

    RETURN v_view_id;
END;
$$;

-- Create trade plan from view (snapshots current drafts)
CREATE OR REPLACE FUNCTION create_trade_plan_from_view(
    p_view_id UUID,
    p_plan_name TEXT,
    p_user_id UUID,
    p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_plan_id UUID;
    v_view RECORD;
    v_requires_approval BOOLEAN := false;
BEGIN
    -- Get view and lab info
    SELECT
        v.*,
        l.portfolio_id,
        l.id as lab_id
    INTO v_view
    FROM trade_lab_views v
    JOIN trade_labs l ON l.id = v.lab_id
    WHERE v.id = p_view_id;

    IF v_view IS NULL THEN
        RAISE EXCEPTION 'View not found: %', p_view_id;
    END IF;

    -- Check if user needs approval (based on user_capabilities)
    SELECT NOT COALESCE(can_send_to_desk, false)
    INTO v_requires_approval
    FROM user_capabilities
    WHERE user_id = p_user_id
      AND (portfolio_id = v_view.portfolio_id OR portfolio_id IS NULL)
    LIMIT 1;

    -- Default to requiring approval if no capability record
    v_requires_approval := COALESCE(v_requires_approval, true);

    -- Create the plan
    INSERT INTO trade_plans (
        portfolio_id,
        lab_id,
        source_view_id,
        source_view_name,
        name,
        description,
        requires_approval,
        created_by,
        snapshot_at
    )
    VALUES (
        v_view.portfolio_id,
        v_view.lab_id,
        p_view_id,
        v_view.name,
        p_plan_name,
        p_description,
        v_requires_approval,
        p_user_id,
        now()
    )
    RETURNING id INTO v_plan_id;

    -- Snapshot drafts into plan items
    INSERT INTO trade_plan_items (
        plan_id,
        asset_id,
        ticker,
        asset_name,
        action,
        shares,
        weight,
        price_at_snapshot,
        trade_queue_item_id,
        sort_order
    )
    SELECT
        v_plan_id,
        d.asset_id,
        a.symbol,
        a.company_name,
        d.action,
        d.shares,
        d.weight,
        d.price,
        d.trade_queue_item_id,
        d.sort_order
    FROM simulation_trades d
    JOIN assets a ON a.id = d.asset_id
    WHERE d.view_id = p_view_id
      AND d.visibility_tier = 'active'
    ORDER BY d.sort_order;

    -- Emit activity event
    INSERT INTO activity_events (
        actor_id,
        actor_type,
        entity_type,
        entity_id,
        entity_display_name,
        action_type,
        action_category,
        portfolio_id,
        lab_id,
        view_id,
        plan_id,
        metadata
    )
    VALUES (
        p_user_id,
        'user',
        'trade_plan',
        v_plan_id,
        p_plan_name,
        'plan_created',
        'lifecycle',
        v_view.portfolio_id,
        v_view.lab_id,
        p_view_id,
        v_plan_id,
        jsonb_build_object(
            'source_view_name', v_view.name,
            'source_view_type', v_view.view_type,
            'item_count', (SELECT COUNT(*) FROM trade_plan_items WHERE plan_id = v_plan_id),
            'requires_approval', v_requires_approval
        )
    );

    RETURN v_plan_id;
END;
$$;

-- ============================================================================
-- 9. UPDATED_AT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_trade_labs_updated_at ON trade_labs;
CREATE TRIGGER update_trade_labs_updated_at
    BEFORE UPDATE ON trade_labs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 10. ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE trade_labs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

-- Helper function: check portfolio membership
CREATE OR REPLACE FUNCTION user_is_portfolio_member(p_portfolio_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM portfolio_members
        WHERE portfolio_id = p_portfolio_id
          AND user_id = p_user_id
    );
$$;

-- TRADE_LABS policies
DROP POLICY IF EXISTS trade_labs_select ON trade_labs;
CREATE POLICY trade_labs_select ON trade_labs
    FOR SELECT USING (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS trade_labs_insert ON trade_labs;
CREATE POLICY trade_labs_insert ON trade_labs
    FOR INSERT WITH CHECK (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS trade_labs_update ON trade_labs;
CREATE POLICY trade_labs_update ON trade_labs
    FOR UPDATE USING (user_is_portfolio_member(portfolio_id));

-- ACTIVITY_EVENTS policies
DROP POLICY IF EXISTS activity_events_select ON activity_events;
CREATE POLICY activity_events_select ON activity_events
    FOR SELECT USING (
        portfolio_id IS NULL
        OR user_is_portfolio_member(portfolio_id)
    );

DROP POLICY IF EXISTS activity_events_insert ON activity_events;
CREATE POLICY activity_events_insert ON activity_events
    FOR INSERT WITH CHECK (true); -- Allow service role to insert

-- ============================================================================
-- 11. DATA MIGRATION / BACKFILL
-- ============================================================================

-- Create trade_labs for all portfolios that don't have one
INSERT INTO trade_labs (portfolio_id, name, created_at, created_by)
SELECT
    p.id,
    p.name || ' Trade Lab',
    COALESCE(
        (SELECT MIN(created_at) FROM simulations WHERE portfolio_id = p.id),
        now()
    ),
    (SELECT user_id FROM portfolio_members WHERE portfolio_id = p.id LIMIT 1)
FROM portfolios p
WHERE NOT EXISTS (
    SELECT 1 FROM trade_labs l WHERE l.portfolio_id = p.id
)
ON CONFLICT (portfolio_id) DO NOTHING;

-- Link existing simulations to trade_labs
UPDATE trade_labs l
SET legacy_simulation_id = (
    SELECT s.id FROM simulations s
    WHERE s.portfolio_id = l.portfolio_id
    ORDER BY s.created_at DESC
    LIMIT 1
)
WHERE legacy_simulation_id IS NULL
  AND EXISTS (SELECT 1 FROM simulations s WHERE s.portfolio_id = l.portfolio_id);

-- Backfill lab_id in trade_lab_views from simulation_id
UPDATE trade_lab_views v
SET lab_id = l.id
FROM trade_labs l
JOIN simulations s ON s.portfolio_id = l.portfolio_id
WHERE v.simulation_id = s.id
  AND v.lab_id IS NULL;

-- Backfill lab_id in simulation_trades from simulation_id
UPDATE simulation_trades t
SET lab_id = l.id
FROM trade_labs l
JOIN simulations s ON s.portfolio_id = l.portfolio_id
WHERE t.simulation_id = s.id
  AND t.lab_id IS NULL;

-- Backfill lab_id in trade_plans from portfolio_id
UPDATE trade_plans p
SET lab_id = l.id
FROM trade_labs l
WHERE p.portfolio_id = l.portfolio_id
  AND p.lab_id IS NULL;

-- ============================================================================
-- 12. COMPATIBILITY VIEW
-- ============================================================================

-- Create a view that makes trade_labs look like simulations for gradual migration
CREATE OR REPLACE VIEW trade_labs_as_simulations AS
SELECT
    l.id,
    l.portfolio_id,
    l.name,
    l.description,
    'draft'::text as status,
    'private'::text as visibility,
    l.created_at,
    l.updated_at,
    l.created_by,
    l.settings,
    -- Portfolio info
    p.name as portfolio_name
FROM trade_labs l
JOIN portfolios p ON p.id = l.portfolio_id;

GRANT SELECT ON trade_labs_as_simulations TO authenticated;

COMMIT;
