-- ============================================================================
-- Trade Lab v3 Migration: Intent Variants & Sizing Framework
--
-- Adds:
-- 1. lab_variants table for Intent Variant storage
-- 2. portfolios.rounding_config for lot sizing configuration
-- 3. asset_rounding_configs for per-asset rounding overrides
-- 4. trade_sheets table for immutable execution snapshots
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

-- Sizing framework types
DO $$ BEGIN
    CREATE TYPE sizing_framework AS ENUM (
        'weight_target',
        'weight_delta',
        'active_target',
        'active_delta',
        'shares_target',
        'shares_delta'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Active weight source
DO $$ BEGIN
    CREATE TYPE active_weight_source AS ENUM (
        'portfolio_benchmark',
        'custom',
        'index'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Min lot behavior
DO $$ BEGIN
    CREATE TYPE min_lot_behavior AS ENUM (
        'round',
        'zero',
        'warn'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Trade sheet status
DO $$ BEGIN
    CREATE TYPE trade_sheet_status AS ENUM (
        'draft',
        'pending_approval',
        'approved',
        'sent_to_desk',
        'executed',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. PORTFOLIOS ROUNDING CONFIG
-- ============================================================================

-- Add rounding_config to portfolios
ALTER TABLE portfolios
    ADD COLUMN IF NOT EXISTS rounding_config JSONB NOT NULL DEFAULT '{
        "lot_size": 1,
        "min_lot_behavior": "round",
        "round_direction": "nearest"
    }';

COMMENT ON COLUMN portfolios.rounding_config IS 'Default lot rounding configuration for this portfolio';

-- ============================================================================
-- 3. ASSET ROUNDING CONFIGS (Per-Asset Overrides)
-- ============================================================================

CREATE TABLE IF NOT EXISTS asset_rounding_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,

    -- Rounding configuration
    lot_size INTEGER NOT NULL DEFAULT 1,
    min_lot_behavior min_lot_behavior NOT NULL DEFAULT 'round',
    round_direction TEXT NOT NULL DEFAULT 'nearest' CHECK (round_direction IN ('nearest', 'up', 'down')),

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),

    -- Unique per portfolio-asset pair
    CONSTRAINT asset_rounding_configs_unique UNIQUE (portfolio_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_rounding_portfolio ON asset_rounding_configs(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_asset_rounding_asset ON asset_rounding_configs(asset_id);

COMMENT ON TABLE asset_rounding_configs IS 'Per-asset lot size overrides for specific portfolios';

-- ============================================================================
-- 4. LAB_VARIANTS TABLE (Intent Variants)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lab_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES trade_labs(id) ON DELETE CASCADE,
    view_id UUID REFERENCES trade_lab_views(id) ON DELETE SET NULL,
    trade_queue_item_id UUID REFERENCES trade_queue_items(id) ON DELETE SET NULL,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,

    -- User input
    action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'trim', 'add')),
    sizing_input TEXT NOT NULL,
    sizing_spec JSONB,  -- Parsed SizingSpec from sizing-parser

    -- Computed state (persisted for display, recomputed on price changes)
    computed JSONB,  -- ComputedValues (includes shares_change for conflict detection)
    direction_conflict JSONB,  -- v3: SizingValidationError | null (null = no conflict)
    below_lot_warning BOOLEAN NOT NULL DEFAULT false,

    -- Current position context (snapshot at variant creation/update)
    current_position JSONB,  -- { shares, weight, cost_basis, active_weight }

    -- Active weight configuration
    active_weight_config JSONB,  -- { source, benchmark_weight, custom_benchmark_id }

    -- Metadata
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    touched_in_lab_at TIMESTAMPTZ,  -- Last time modified in Trade Lab UI

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),

    -- Soft delete
    visibility_tier visibility_tier NOT NULL DEFAULT 'active',
    deleted_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_lab_variants_lab ON lab_variants(lab_id);
CREATE INDEX IF NOT EXISTS idx_lab_variants_view ON lab_variants(view_id);
CREATE INDEX IF NOT EXISTS idx_lab_variants_asset ON lab_variants(asset_id);
CREATE INDEX IF NOT EXISTS idx_lab_variants_trade_queue ON lab_variants(trade_queue_item_id);
CREATE INDEX IF NOT EXISTS idx_lab_variants_active ON lab_variants(lab_id, visibility_tier)
    WHERE visibility_tier = 'active';
CREATE INDEX IF NOT EXISTS idx_lab_variants_conflicts ON lab_variants(lab_id)
    WHERE visibility_tier = 'active' AND direction_conflict IS NOT NULL;

COMMENT ON TABLE lab_variants IS 'Intent Variants - ephemeral scenario deltas in Trade Lab';
COMMENT ON COLUMN lab_variants.direction_conflict IS 'v3: SizingValidationError JSONB with conflict details (null = no conflict). Contains code, message, action, shares_change, suggested_direction, trigger.';
COMMENT ON COLUMN lab_variants.below_lot_warning IS 'True if computed shares below lot size threshold';
COMMENT ON COLUMN lab_variants.touched_in_lab_at IS 'Last time this variant was modified in Trade Lab (for staleness detection)';

-- ============================================================================
-- 5. TRADE_SHEETS TABLE (Immutable Execution Snapshots)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES trade_labs(id) ON DELETE CASCADE,
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,

    -- Identification
    name TEXT NOT NULL,
    description TEXT,

    -- Snapshot of variants at creation time (immutable)
    variants_snapshot JSONB NOT NULL,  -- Array of IntentVariant objects

    -- Computed totals at snapshot time
    total_notional NUMERIC NOT NULL DEFAULT 0,
    total_trades INTEGER NOT NULL DEFAULT 0,
    net_weight_change NUMERIC NOT NULL DEFAULT 0,

    -- Workflow state
    status trade_sheet_status NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMPTZ,
    submitted_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id),
    executed_at TIMESTAMPTZ,

    -- Validation state at creation (for audit)
    had_conflicts BOOLEAN NOT NULL DEFAULT false,  -- Should always be false (blocked if true)
    had_below_lot_warnings BOOLEAN NOT NULL DEFAULT false,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),

    -- Soft delete
    visibility_tier visibility_tier NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_trade_sheets_lab ON trade_sheets(lab_id);
CREATE INDEX IF NOT EXISTS idx_trade_sheets_portfolio ON trade_sheets(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_trade_sheets_status ON trade_sheets(status);
CREATE INDEX IF NOT EXISTS idx_trade_sheets_created ON trade_sheets(created_at DESC);

COMMENT ON TABLE trade_sheets IS 'Immutable snapshots of Intent Variants for execution';
COMMENT ON COLUMN trade_sheets.had_conflicts IS 'Should always be false - Trade Sheets cannot be created with conflicts';

-- ============================================================================
-- 6. UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_lab_variants_updated_at ON lab_variants;
CREATE TRIGGER update_lab_variants_updated_at
    BEFORE UPDATE ON lab_variants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_asset_rounding_configs_updated_at ON asset_rounding_configs;
CREATE TRIGGER update_asset_rounding_configs_updated_at
    BEFORE UPDATE ON asset_rounding_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS
ALTER TABLE lab_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_rounding_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_sheets ENABLE ROW LEVEL SECURITY;

-- LAB_VARIANTS policies
DROP POLICY IF EXISTS lab_variants_select ON lab_variants;
CREATE POLICY lab_variants_select ON lab_variants
    FOR SELECT USING (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS lab_variants_insert ON lab_variants;
CREATE POLICY lab_variants_insert ON lab_variants
    FOR INSERT WITH CHECK (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS lab_variants_update ON lab_variants;
CREATE POLICY lab_variants_update ON lab_variants
    FOR UPDATE USING (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS lab_variants_delete ON lab_variants;
CREATE POLICY lab_variants_delete ON lab_variants
    FOR DELETE USING (user_is_portfolio_member(portfolio_id));

-- ASSET_ROUNDING_CONFIGS policies
DROP POLICY IF EXISTS asset_rounding_configs_select ON asset_rounding_configs;
CREATE POLICY asset_rounding_configs_select ON asset_rounding_configs
    FOR SELECT USING (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS asset_rounding_configs_insert ON asset_rounding_configs;
CREATE POLICY asset_rounding_configs_insert ON asset_rounding_configs
    FOR INSERT WITH CHECK (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS asset_rounding_configs_update ON asset_rounding_configs;
CREATE POLICY asset_rounding_configs_update ON asset_rounding_configs
    FOR UPDATE USING (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS asset_rounding_configs_delete ON asset_rounding_configs;
CREATE POLICY asset_rounding_configs_delete ON asset_rounding_configs
    FOR DELETE USING (user_is_portfolio_member(portfolio_id));

-- TRADE_SHEETS policies
DROP POLICY IF EXISTS trade_sheets_select ON trade_sheets;
CREATE POLICY trade_sheets_select ON trade_sheets
    FOR SELECT USING (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS trade_sheets_insert ON trade_sheets;
CREATE POLICY trade_sheets_insert ON trade_sheets
    FOR INSERT WITH CHECK (user_is_portfolio_member(portfolio_id));

DROP POLICY IF EXISTS trade_sheets_update ON trade_sheets;
CREATE POLICY trade_sheets_update ON trade_sheets
    FOR UPDATE USING (user_is_portfolio_member(portfolio_id));

-- ============================================================================
-- 8. HELPER FUNCTIONS
-- ============================================================================

-- Check if a lab has any variants with direction conflicts
-- v3: direction_conflict is JSONB (null = no conflict, object = conflict details)
CREATE OR REPLACE FUNCTION lab_has_conflicts(p_lab_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM lab_variants
        WHERE lab_id = p_lab_id
          AND visibility_tier = 'active'
          AND direction_conflict IS NOT NULL
    );
$$;

-- Get rounding config for a portfolio-asset pair (with asset override fallback)
CREATE OR REPLACE FUNCTION get_rounding_config(p_portfolio_id UUID, p_asset_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        -- Try asset-specific override first
        (
            SELECT jsonb_build_object(
                'lot_size', lot_size,
                'min_lot_behavior', min_lot_behavior::text,
                'round_direction', round_direction
            )
            FROM asset_rounding_configs
            WHERE portfolio_id = p_portfolio_id AND asset_id = p_asset_id
        ),
        -- Fall back to portfolio default
        (SELECT rounding_config FROM portfolios WHERE id = p_portfolio_id),
        -- Ultimate fallback
        '{"lot_size": 1, "min_lot_behavior": "round", "round_direction": "nearest"}'::jsonb
    );
$$;

-- Create trade sheet from lab variants (validates no conflicts)
CREATE OR REPLACE FUNCTION create_trade_sheet(
    p_lab_id UUID,
    p_name TEXT,
    p_user_id UUID,
    p_description TEXT DEFAULT NULL,
    p_view_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sheet_id UUID;
    v_portfolio_id UUID;
    v_has_conflicts BOOLEAN;
    v_has_warnings BOOLEAN;
    v_variants JSONB;
    v_total_notional NUMERIC;
    v_total_trades INTEGER;
    v_net_weight_change NUMERIC;
BEGIN
    -- Get portfolio_id from lab
    SELECT portfolio_id INTO v_portfolio_id
    FROM trade_labs WHERE id = p_lab_id;

    IF v_portfolio_id IS NULL THEN
        RAISE EXCEPTION 'Lab not found: %', p_lab_id;
    END IF;

    -- Check for conflicts
    -- v3: direction_conflict is JSONB (null = no conflict, object = conflict details)
    SELECT EXISTS (
        SELECT 1 FROM lab_variants
        WHERE lab_id = p_lab_id
          AND (p_view_id IS NULL OR view_id = p_view_id)
          AND visibility_tier = 'active'
          AND direction_conflict IS NOT NULL
    ) INTO v_has_conflicts;

    IF v_has_conflicts THEN
        RAISE EXCEPTION 'Cannot create Trade Sheet with unresolved direction conflicts';
    END IF;

    -- Check for below-lot warnings (allowed, but recorded)
    SELECT EXISTS (
        SELECT 1 FROM lab_variants
        WHERE lab_id = p_lab_id
          AND (p_view_id IS NULL OR view_id = p_view_id)
          AND visibility_tier = 'active'
          AND below_lot_warning = true
    ) INTO v_has_warnings;

    -- Snapshot variants
    SELECT
        jsonb_agg(to_jsonb(v)),
        COALESCE(SUM((v.computed->>'notional_value')::numeric), 0),
        COUNT(*),
        COALESCE(SUM((v.computed->>'delta_weight')::numeric), 0)
    INTO v_variants, v_total_notional, v_total_trades, v_net_weight_change
    FROM lab_variants v
    WHERE v.lab_id = p_lab_id
      AND (p_view_id IS NULL OR v.view_id = p_view_id)
      AND v.visibility_tier = 'active';

    IF v_variants IS NULL OR jsonb_array_length(v_variants) = 0 THEN
        RAISE EXCEPTION 'No active variants to include in Trade Sheet';
    END IF;

    -- Create the trade sheet
    INSERT INTO trade_sheets (
        lab_id,
        portfolio_id,
        name,
        description,
        variants_snapshot,
        total_notional,
        total_trades,
        net_weight_change,
        had_conflicts,
        had_below_lot_warnings,
        created_by
    )
    VALUES (
        p_lab_id,
        v_portfolio_id,
        p_name,
        p_description,
        v_variants,
        v_total_notional,
        v_total_trades,
        v_net_weight_change,
        false,  -- We verified no conflicts above
        v_has_warnings,
        p_user_id
    )
    RETURNING id INTO v_sheet_id;

    -- Log activity event
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
        metadata
    )
    VALUES (
        p_user_id,
        'user',
        'trade_sheet',
        v_sheet_id,
        p_name,
        'trade_sheet_created',
        'lifecycle',
        v_portfolio_id,
        p_lab_id,
        jsonb_build_object(
            'variant_count', v_total_trades,
            'total_notional', v_total_notional,
            'had_below_lot_warnings', v_has_warnings
        )
    );

    RETURN v_sheet_id;
END;
$$;

-- ============================================================================
-- 9. GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON lab_variants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_rounding_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON trade_sheets TO authenticated;

COMMIT;
