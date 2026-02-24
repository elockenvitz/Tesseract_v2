-- =============================================================================
-- Tenant Boundary Linter — SQL diagnostic queries
-- Run against production/staging to verify multi-org isolation invariants.
-- Returns rows ONLY for violations; empty result = pass.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CHECK 1: Non-global tables missing organization_id
-- Tables that are NOT in the exempt list and do NOT have organization_id.
-- These inherit org scope via FK chains (e.g. portfolios → teams → org),
-- so they are EXPECTED. This check surfaces any NEW table that was added
-- without an explicit exemption or org_id column.
-- -----------------------------------------------------------------------------
-- (Handled by the Node script via GLOBAL_TABLES + FK_CHAIN_TABLES lists)

-- -----------------------------------------------------------------------------
-- CHECK 2: RLS disabled on any public table
-- Every table in the public schema MUST have RLS enabled.
-- -----------------------------------------------------------------------------
SELECT
  c.relname AS table_name,
  'RLS_DISABLED' AS violation
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- -----------------------------------------------------------------------------
-- CHECK 3: Tables with organization_id that allow NULL
-- org_id should be NOT NULL on hub tables to prevent orphaned data.
-- Some legacy tables (ai_column_library, coverage_settings, etc.) have
-- nullable org_id — these are grandfathered but tracked.
-- -----------------------------------------------------------------------------
SELECT
  col.table_name,
  'ORG_ID_NULLABLE' AS violation
FROM information_schema.columns col
WHERE col.table_schema = 'public'
  AND col.column_name = 'organization_id'
  AND col.is_nullable = 'YES'
  AND col.table_name NOT IN (
    -- Grandfathered nullable org_id tables (pre-Phase 2)
    'ai_column_library',
    'coverage_settings',
    'investment_case_templates',
    'model_templates',
    'rating_scales',
    'research_fields'
  )
ORDER BY col.table_name;

-- -----------------------------------------------------------------------------
-- CHECK 4: Tables with org_id but zero RLS policies
-- If a table has organization_id it MUST have at least one RLS policy.
-- -----------------------------------------------------------------------------
SELECT
  c.relname AS table_name,
  'ORG_TABLE_NO_POLICIES' AS violation
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name = c.relname
      AND col.column_name = 'organization_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
  )
ORDER BY c.relname;
