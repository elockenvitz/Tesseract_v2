/*
  # Create Audit Events Table

  Unified audit log for institutional-grade auditability.
  Single source of truth for all meaningful changes across the platform.

  1. New Tables
    - audit_events: Immutable event log with entity-agnostic design

  2. Security
    - RLS enabled with role-based access
    - Append-only (no UPDATE/DELETE allowed)

  3. Indexes
    - Optimized for common query patterns
    - Full-text search support

  4. Constraints
    - Valid entity types, action categories, actor types
    - Checksum for tamper detection
*/

-- ============================================================
-- AUDIT EVENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_events (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Timing
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Actor
  actor_id UUID REFERENCES users(id),
  actor_type TEXT NOT NULL DEFAULT 'user',
  actor_role TEXT,

  -- Entity (what changed)
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  entity_display_name TEXT,

  -- Parent Entity (for relationships)
  parent_entity_type TEXT,
  parent_entity_id UUID,

  -- Action
  action_type TEXT NOT NULL,
  action_category TEXT NOT NULL,

  -- State Change
  from_state JSONB,
  to_state JSONB,
  changed_fields TEXT[],

  -- Context
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Search optimization (denormalized)
  search_text TEXT,

  -- Denormalized actor info (for fast filtering)
  actor_email TEXT,
  actor_name TEXT,

  -- Denormalized entity info
  asset_symbol TEXT,

  -- Organizational context
  org_id UUID NOT NULL,
  team_id UUID,

  -- Immutability marker
  checksum TEXT NOT NULL
);

-- ============================================================
-- CONSTRAINTS
-- ============================================================

ALTER TABLE audit_events ADD CONSTRAINT valid_entity_type
  CHECK (entity_type IN (
    'trade_idea',
    'pair_trade',
    'order',
    'execution',
    'asset',
    'coverage',
    'portfolio',
    'simulation',
    'user',
    'team',
    'comment',
    'attachment',
    'audit_explorer'
  ));

ALTER TABLE audit_events ADD CONSTRAINT valid_action_category
  CHECK (action_category IN (
    'lifecycle',
    'state_change',
    'field_edit',
    'relationship',
    'access',
    'system'
  ));

ALTER TABLE audit_events ADD CONSTRAINT valid_actor_type
  CHECK (actor_type IN ('user', 'system', 'api_key', 'webhook', 'migration'));

-- ============================================================
-- INDEXES
-- ============================================================

-- Primary query patterns
CREATE INDEX idx_audit_events_entity
  ON audit_events(entity_type, entity_id, occurred_at DESC);

CREATE INDEX idx_audit_events_actor
  ON audit_events(actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX idx_audit_events_occurred_at
  ON audit_events(occurred_at DESC);

CREATE INDEX idx_audit_events_action
  ON audit_events(action_type, occurred_at DESC);

CREATE INDEX idx_audit_events_parent
  ON audit_events(parent_entity_type, parent_entity_id, occurred_at DESC)
  WHERE parent_entity_id IS NOT NULL;

-- Search (GIN for full-text)
CREATE INDEX idx_audit_events_search
  ON audit_events USING gin(to_tsvector('english', COALESCE(search_text, '')));

-- Organizational filtering
CREATE INDEX idx_audit_events_org
  ON audit_events(org_id, occurred_at DESC);

-- Composite for common filter patterns
CREATE INDEX idx_audit_events_entity_action
  ON audit_events(entity_type, action_type, occurred_at DESC);

-- Denormalized field indexes for fast filtering
CREATE INDEX idx_audit_events_actor_email
  ON audit_events(actor_email, occurred_at DESC)
  WHERE actor_email IS NOT NULL;

CREATE INDEX idx_audit_events_asset_symbol
  ON audit_events(asset_symbol, occurred_at DESC)
  WHERE asset_symbol IS NOT NULL;

-- Request ID for idempotency checks
CREATE INDEX idx_audit_events_request_id
  ON audit_events((metadata->>'request_id'), entity_type, entity_id)
  WHERE metadata->>'request_id' IS NOT NULL;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view audit events based on role
CREATE POLICY "Users can view audit events based on role"
  ON audit_events
  FOR SELECT
  USING (
    -- User is actor (can always see own actions)
    actor_id = auth.uid()
    OR
    -- User has access to the entity (simplified - expand based on your RLS model)
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.org_id = audit_events.org_id
    )
  );

-- Policy: Only service can insert (enforced via application layer)
CREATE POLICY "Service can insert audit events"
  ON audit_events
  FOR INSERT
  WITH CHECK (true);

-- Policy: No updates allowed (immutable)
CREATE POLICY "Audit events are immutable - no updates"
  ON audit_events
  FOR UPDATE
  USING (false);

-- Policy: No deletes allowed (immutable)
CREATE POLICY "Audit events are immutable - no deletes"
  ON audit_events
  FOR DELETE
  USING (false);

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE audit_events IS 'Immutable audit log for all meaningful changes across the platform';
COMMENT ON COLUMN audit_events.occurred_at IS 'When the action occurred (may differ from recorded_at for imports)';
COMMENT ON COLUMN audit_events.recorded_at IS 'When the event was written to the log';
COMMENT ON COLUMN audit_events.actor_id IS 'User who performed the action (NULL for system actions)';
COMMENT ON COLUMN audit_events.actor_type IS 'Type of actor: user, system, api_key, webhook, migration';
COMMENT ON COLUMN audit_events.actor_role IS 'Role at time of action: analyst, pm, admin, system:auto_archive';
COMMENT ON COLUMN audit_events.entity_type IS 'Type of entity that changed';
COMMENT ON COLUMN audit_events.entity_id IS 'ID of the entity that changed';
COMMENT ON COLUMN audit_events.entity_display_name IS 'Human-readable name for search/display';
COMMENT ON COLUMN audit_events.parent_entity_type IS 'Parent entity type for relationships (e.g., trade_idea for order)';
COMMENT ON COLUMN audit_events.parent_entity_id IS 'Parent entity ID for relationships';
COMMENT ON COLUMN audit_events.action_type IS 'Specific action: create, delete, move_stage, set_outcome, etc.';
COMMENT ON COLUMN audit_events.action_category IS 'Category: lifecycle, state_change, field_edit, relationship, access, system';
COMMENT ON COLUMN audit_events.from_state IS 'State before the change (NULL for creates)';
COMMENT ON COLUMN audit_events.to_state IS 'State after the change (NULL for hard deletes)';
COMMENT ON COLUMN audit_events.changed_fields IS 'Array of field names that changed';
COMMENT ON COLUMN audit_events.metadata IS 'Additional context: request_id, ui_source, batch_id, reason, etc.';
COMMENT ON COLUMN audit_events.search_text IS 'Concatenated searchable content for full-text search';
COMMENT ON COLUMN audit_events.checksum IS 'SHA-256 hash of core fields for tamper detection';
