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
  // Membership view: org-filtered in its own definition, but frontend callers must STILL pass
  // organization_id. It exposes member emails and was an anon-exposure target (containment A1),
  // so it is NOT a free-pass view — treat it like an org-scoped table in frontend code.
  'organization_members_v',

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
 * Legacy-finding inventory (replaces the old BASELINE_TOTAL / BASELINE_P0 count
 * thresholds). The inventory is an EXACT, reviewed record of every known
 * pre-existing finding, keyed by (file, table) with its severity and occurrence
 * count. It lives in scripts/tenant-lint-inventory.json and is the review
 * artifact — a count threshold is not. Enforcement (see runner):
 *   - a (file, table) not in the inventory, or a higher count than recorded, or a
 *     severity that worsened (P1 -> P0) => a NEW/WORSENED finding => CI fails;
 *   - a finding that no longer occurs (or occurs fewer times) => the inventory is
 *     STALE => CI fails until the inventory is updated in a reviewed commit, so a
 *     fix is acknowledged and a fixed finding cannot silently reappear later;
 *   - every P0 entry must carry a non-empty `ack`, and all P0 entries are echoed
 *     on each run, so a high-severity finding can never be silently grandfathered.
 * Regenerate the file from the current tree with `--write-inventory` (a reviewed,
 * deliberate action — never run it just to make CI green).
 */
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const INVENTORY_PATH = join(dirname(fileURLToPath(import.meta.url)), 'tenant-lint-inventory.json')

function loadInventory() {
  if (!existsSync(INVENTORY_PATH)) return { findings: {} }
  return JSON.parse(readFileSync(INVENTORY_PATH, 'utf-8'))
}

/** Group a flat violation list into { "file\u0000table": {severity, count} }. */
function groupFindings(violations) {
  const g = new Map()
  for (const v of violations) {
    const key = `${v.file}\u0000${v.table}`
    const cur = g.get(key) || { file: v.file, table: v.table, severity: v.isP0 ? 'P0' : 'P1', count: 0 }
    cur.count++
    if (v.isP0) cur.severity = 'P0'
    g.set(key, cur)
  }
  return g
}

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

  const current = groupFindings(allViolations)

  // ── --write-inventory: regenerate the reviewed inventory from the tree ──
  if (args.includes('--write-inventory')) {
    const prior = loadInventory().findings || {}
    const findings = {}
    for (const { file, table, severity, count } of [...current.values()].sort(
      (a, b) => a.file.localeCompare(b.file) || a.table.localeCompare(b.table))) {
      const priorAck = prior[file]?.[table]?.ack
      findings[file] = findings[file] || {}
      findings[file][table] = {
        severity, count,
        ack: priorAck || (severity === 'P0'
          ? 'LEGACY 2026-10-19: pre-existing; RLS-backstop UNVERIFIED — see project-security-followups'
          : 'legacy 2026-10-19: pre-existing'),
      }
    }
    const out = {
      $comment: 'Reviewed legacy-finding inventory for frontend-tenant-lint. Each (file -> table) is a known pre-existing finding with its severity and occurrence count. NEW/WORSENED findings fail CI; a fixed finding makes this STALE and must be removed here in a reviewed commit. P0 entries require a non-empty ack and are echoed every run. Do NOT regenerate this to silence a real finding.',
      generatedAt: new Date().toISOString().slice(0, 10),
      findings,
    }
    writeFileSync(INVENTORY_PATH, JSON.stringify(out, null, 2) + '\n')
    console.log(`Wrote inventory: ${INVENTORY_PATH} (${current.size} file/table findings)`)
    process.exit(0)
  }

  // ── CI summary ────────────────────────────────────────────────────────
  console.log(`\n--- Summary ---`)
  console.log(`Files scanned:  ${filesScanned}`)
  console.log(`Files skipped:  ${filesSkipped}`)
  console.log(`Total:          ${totalViolations}   P0: ${p0Count}   P1: ${p1Count}`)

  // ── Enforcement: diff current findings against the reviewed inventory ───
  const inv = loadInventory().findings || {}
  const invGet = (file, table) => inv[file]?.[table]
  const newOrWorse = []   // introduced or worsened -> fail
  const stale = []        // fixed/reduced but still in inventory -> fail (needs reviewed removal)
  const ungrounded = []   // P0 in inventory with no ack -> fail
  const grandfathered = [] // P0 legacy still present (echoed, not a failure by itself)

  // current vs inventory
  for (const { file, table, severity, count } of current.values()) {
    const rec = invGet(file, table)
    if (!rec) { newOrWorse.push(`NEW ${severity} ${table} in ${file} (${count}×) — not in inventory`); continue }
    if (count > rec.count) newOrWorse.push(`WORSENED ${table} in ${file}: ${rec.count}→${count} occurrence(s)`)
    if (severity === 'P0' && rec.severity !== 'P0') newOrWorse.push(`WORSENED ${table} in ${file}: ${rec.severity}→P0`)
  }
  // inventory vs current (fixed or stale) + P0 acks
  for (const [file, tables] of Object.entries(inv)) {
    for (const [table, rec] of Object.entries(tables)) {
      const cur = current.get(`${file}\u0000${table}`)
      if (!cur) stale.push(`FIXED ${table} in ${file} (was ${rec.count}×) — remove it from the inventory (reviewed)`)
      else if (cur.count < rec.count) stale.push(`REDUCED ${table} in ${file}: ${rec.count}→${cur.count} — update the inventory (reviewed)`)
      if (rec.severity === 'P0') {
        if (!rec.ack || !String(rec.ack).trim()) ungrounded.push(`${table} in ${file}`)
        else if (cur) grandfathered.push(`P0 ${table} in ${file} (${rec.count}×) — ${rec.ack}`)
      }
    }
  }

  if (grandfathered.length > 0) {
    console.log(`\nGrandfathered P0 legacy findings (visible, must shrink — not silenced):`)
    for (const g of grandfathered) console.log(`  • ${g}`)
  }

  let failed = false
  if (newOrWorse.length > 0) {
    console.log(`\nFAILED: ${newOrWorse.length} new/worsened tenant-isolation finding(s):`)
    for (const m of newOrWorse) console.log(`  ✗ ${m}`)
    console.log(`Fix: add .eq('organization_id', orgId), an org-scoped view, or an org-scoped hook — do NOT add it to the inventory.`)
    failed = true
  }
  if (ungrounded.length > 0) {
    console.log(`\nFAILED: ${ungrounded.length} P0 inventory entr(ies) grandfathered without an ack:`)
    for (const m of ungrounded) console.log(`  ✗ ${m}`)
    failed = true
  }
  if (stale.length > 0) {
    console.log(`\nFAILED: inventory is STALE (${stale.length}) — a finding was fixed/reduced:`)
    for (const m of stale) console.log(`  ✗ ${m}`)
    console.log(`Run: node scripts/frontend-tenant-lint.mjs --write-inventory, then commit the inventory so the fix is reviewed.`)
    failed = true
  }

  if (failed) { console.log(''); process.exit(1) }
  console.log('\nPASS: current findings exactly match the reviewed inventory.\n')
  process.exit(0)
}

// Allow importing for tests
export { ORG_SCOPED_TABLES, ORG_SCOPED_VIEWS, P0_TABLES, scanFile }

run()
