#!/usr/bin/env node
/**
 * Frontend Tenant Boundary Linter
 *
 * Scans src/**‍/*.ts(x) for supabase.from('<ORG_SCOPED_TABLE>') calls that are
 * missing organization_id filters or are not wrapped in approved patterns.
 *
 * Checks:
 *   1. supabase.from('org_scoped_table') must have .eq('organization_id', ...)
 *      or use an approved wrapper/hook pattern.
 *   2. RPC calls (supabase.rpc) are allowed (server enforces boundaries).
 *   3. Views that are already org-scoped are allowed.
 *
 * Usage:
 *   node scripts/frontend-tenant-lint.mjs [--report] [--ci]
 *
 * Flags:
 *   --report   Show ranked table-by-table breakdown
 *   --ci       Output CI summary (total, P0, delta vs baseline)
 *
 * Exit code 0 = all checks pass, 1 = violations found.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Tables that have organization_id and MUST be filtered by it in frontend code.
 * Sourced from the backend linter's categorization of tables with direct org_id.
 */
const ORG_SCOPED_TABLES = new Set([
  // Hub tables (Phase 2)
  'workflows',
  'projects',
  'themes',
  'conversations',
  'calendar_events',
  'calendar_deliverables',
  'allocation_periods',
  'target_date_funds',
  'topics',
  'captures',
  'custom_notebooks',
  'text_templates',

  // Org-admin tables
  'organization_memberships',
  'organization_invites',
  'organization_audit_log',
  'organization_contacts',
  'teams',
  'org_chart_nodes',

  // Org-scoped config tables
  'coverage_settings',
  'research_fields',
  'research_sections',
  'rating_scales',
  'user_role_definitions',
  'asset_page_templates',
  'investment_case_templates',
  'model_templates',
  'removal_requests',
  'access_requests',
  'coverage_roles',
  'project_collections',
  'project_tags',
  'template_tags',

  // Trade / allocation
  'trade_ideas',
  'workflow_branches',
])

/**
 * P0 tables — highest-risk for cross-org data leakage.
 * These are user-facing hub tables where unscoped SELECTs are most dangerous.
 */
const P0_TABLES = new Set([
  'workflows',
  'projects',
  'themes',
  'conversations',
  'calendar_events',
  'topics',
  'captures',
])

/**
 * Views that are already org-scoped via their definition — allowed without filter.
 */
const ORG_SCOPED_VIEWS = new Set([
  'organization_members_v',
  'org_workflows_v',
  'org_themes_v',
  'org_calendar_events_v',
  'org_topics_v',
  'org_captures_v',
  'org_projects_v',
  'org_org_chart_nodes_v',
])

/**
 * Approved wrapper patterns that handle org scoping internally.
 * If a file uses one of these hooks to fetch data, direct .from() calls are OK.
 */
const APPROVED_WRAPPER_PATTERNS = [
  /useOrganizationData/,
  /useOrgQueryKey/,
]

/**
 * Files explicitly excluded from linting (e.g., the linter test fixtures).
 */
const EXCLUDED_PATHS = [
  'scripts/',
  'src/test/',
  '__fixtures__/',
  '.test.ts',
  '.test.tsx',
  '.stories.tsx',
  // Platform admin console intentionally queries across orgs
  'AdminConsolePage.tsx',
]

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

/**
 * Pre-existing violations that are safe due to RLS enforcement.
 * These queries rely on server-side RLS rather than client-side org_id filtering.
 *
 * Update these when violations are fixed. See docs/tenant-lint-baselines.md.
 */
const BASELINE_TOTAL = 38
const BASELINE_P0 = 17

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Regex to match supabase.from('table_name') calls.
 * Captures the table name in group 1.
 */
const FROM_REGEX = /supabase\s*\.\s*from\(\s*['"`](\w+)['"`]\s*\)/g

/**
 * Regex to check if a chain includes .eq('organization_id', ...)
 * We check a window of ~400 chars after the .from() call.
 */
const ORG_FILTER_REGEX = /\.eq\(\s*['"`]organization_id['"`]/

/**
 * Patterns that indicate the chain is NOT a bare select (mutations are safe due to RLS).
 * INSERT includes org_id in data; UPDATE/DELETE by ID are safe.
 */
const MUTATION_REGEX = /\.(insert|update|upsert|delete)\s*\(/

/**
 * Safe filter patterns — queries filtered by PK or FK are safe because RLS enforces boundaries.
 */
const SAFE_FILTER_REGEX = /\.eq\(\s*['"`](id|workflow_id|team_id|project_id|conversation_id|theme_id|created_by|user_id|portfolio_id|node_id)['"`]/

/**
 * Regex to check for RPC calls (always allowed).
 */
const RPC_REGEX = /supabase\s*\.\s*rpc\(/

function scanFile(filePath, content) {
  const violations = []
  const lines = content.split('\n')

  // Build a flat string for multi-line chain scanning
  let match
  FROM_REGEX.lastIndex = 0

  while ((match = FROM_REGEX.exec(content)) !== null) {
    const tableName = match[1]

    // Skip non-org-scoped tables
    if (!ORG_SCOPED_TABLES.has(tableName)) continue

    // Skip org-scoped views
    if (ORG_SCOPED_VIEWS.has(tableName)) continue

    // Check the chain after .from() for org_id filter (400 char window)
    const afterFrom = content.slice(match.index, match.index + 400)

    // Allow: has organization_id filter
    if (ORG_FILTER_REGEX.test(afterFrom)) continue

    // Allow: mutation chains (INSERT/UPDATE/DELETE/UPSERT) — RLS enforces boundary
    if (MUTATION_REGEX.test(afterFrom)) continue

    // Allow: filtered by PK or FK (inherits org scope through chain)
    if (SAFE_FILTER_REGEX.test(afterFrom)) continue

    // Find line number
    const beforeMatch = content.slice(0, match.index)
    const lineNum = beforeMatch.split('\n').length

    violations.push({
      file: filePath,
      line: lineNum,
      table: tableName,
      isP0: P0_TABLES.has(tableName),
      snippet: lines[lineNum - 1]?.trim() || '',
    })
  }

  return violations
}

function walkDir(dir, extensions) {
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      results.push(...walkDir(fullPath, extensions))
    } else if (extensions.includes(extname(entry.name))) {
      results.push(fullPath)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const showReport = args.includes('--report')
const ciMode = args.includes('--ci')

function run() {
  const srcDir = join(process.cwd(), 'src')
  const files = walkDir(srcDir, ['.ts', '.tsx'])
  let totalViolations = 0
  let filesScanned = 0
  let filesSkipped = 0
  const allViolations = []

  for (const filePath of files) {
    const rel = relative(process.cwd(), filePath).replace(/\\/g, '/')

    // Skip excluded paths
    if (EXCLUDED_PATHS.some((p) => rel.includes(p))) {
      filesSkipped++
      continue
    }

    const content = readFileSync(filePath, 'utf-8')

    // Skip files that use approved wrapper hooks
    if (APPROVED_WRAPPER_PATTERNS.some((p) => p.test(content))) {
      filesSkipped++
      continue
    }

    filesScanned++
    const violations = scanFile(rel, content)
    if (violations.length > 0) {
      allViolations.push(...violations)
      totalViolations += violations.length
    }
  }

  const p0Violations = allViolations.filter(v => v.isP0)
  const p1Violations = allViolations.filter(v => !v.isP0)
  const p0Count = p0Violations.length
  const p1Count = p1Violations.length

  // ── Report mode: ranked table-by-table breakdown ──────────────────────
  if (showReport || !ciMode) {
    console.log('\n=== Frontend Tenant Boundary Lint ===\n')

    if (allViolations.length === 0) {
      console.log('PASS: No unfiltered org-scoped table access found.')
    } else {
      // Group by table with counts
      const byTable = new Map()
      for (const v of allViolations) {
        if (!byTable.has(v.table)) byTable.set(v.table, [])
        byTable.get(v.table).push(v)
      }

      // Sort tables: P0 first (by count desc), then P1 (by count desc)
      const sortedTables = [...byTable.entries()].sort((a, b) => {
        const aP0 = P0_TABLES.has(a[0]) ? 0 : 1
        const bP0 = P0_TABLES.has(b[0]) ? 0 : 1
        if (aP0 !== bP0) return aP0 - bP0
        return b[1].length - a[1].length
      })

      for (const [table, violations] of sortedTables) {
        const priority = P0_TABLES.has(table) ? 'P0' : 'P1'
        console.log(`\n[${priority}] ${table} (${violations.length} violation${violations.length > 1 ? 's' : ''}):`)
        for (const v of violations) {
          console.log(`  ${v.file}:${v.line}`)
          if (v.snippet) console.log(`    ${v.snippet}`)
        }
      }
    }
  }

  // ── CI summary ────────────────────────────────────────────────────────
  console.log(`\n--- Summary ---`)
  console.log(`Files scanned:  ${filesScanned}`)
  console.log(`Files skipped:  ${filesSkipped}`)
  console.log(`Total:          ${totalViolations} (baseline: ${BASELINE_TOTAL}, delta: ${totalViolations - BASELINE_TOTAL >= 0 ? '+' : ''}${totalViolations - BASELINE_TOTAL})`)
  console.log(`  P0:           ${p0Count} (baseline: ${BASELINE_P0}, delta: ${p0Count - BASELINE_P0 >= 0 ? '+' : ''}${p0Count - BASELINE_P0})`)
  console.log(`  P1:           ${p1Count}`)

  // ── Enforcement ───────────────────────────────────────────────────────
  let failed = false

  if (p0Count > BASELINE_P0) {
    console.log(`\nFAILED: ${p0Count - BASELINE_P0} NEW P0 violation(s) above baseline.`)
    console.log('Fix: Add .eq(\'organization_id\', orgId), use an org-scoped view, or use an org-scoped hook.')
    failed = true
  }

  if (totalViolations > BASELINE_TOTAL) {
    console.log(`\nFAILED: ${totalViolations - BASELINE_TOTAL} NEW violation(s) above total baseline.`)
    console.log('Fix: Add .eq(\'organization_id\', orgId), use an org-scoped view, or use an org-scoped hook.')
    failed = true
  }

  if (failed) {
    console.log('')
    process.exit(1)
  }

  if (totalViolations < BASELINE_TOTAL || p0Count < BASELINE_P0) {
    console.log(`\nPASS: Violations decreased! Update baselines:`)
    if (totalViolations < BASELINE_TOTAL) {
      console.log(`  BASELINE_TOTAL: ${BASELINE_TOTAL} → ${totalViolations}`)
    }
    if (p0Count < BASELINE_P0) {
      console.log(`  BASELINE_P0:    ${BASELINE_P0} → ${p0Count}`)
    }
    console.log('')
    process.exit(0)
  }

  console.log('\nPASS: No new violations (at baseline).\n')
  process.exit(0)
}

// Allow importing for tests
export { ORG_SCOPED_TABLES, ORG_SCOPED_VIEWS, P0_TABLES, scanFile }

run()
