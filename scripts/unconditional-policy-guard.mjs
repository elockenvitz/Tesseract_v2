#!/usr/bin/env node
/**
 * Unconditional-policy guard.
 *
 * ── The defect class this exists to stop ──────────────────────────────────
 *
 * A PERMISSIVE RLS policy whose predicate is literally `true`:
 *
 *     CREATE POLICY x ON t FOR SELECT TO authenticated USING (true);
 *
 * RLS is *enabled*, the table has *policies*, and every existing check in this
 * repo passes — while every row is readable by every caller. The two linters we
 * already run cannot see it: `tenant-boundary-lint.mjs` asks whether a table has
 * `organization_id` and at least one policy, and `frontend-tenant-lint.mjs` asks
 * whether client queries filter by org. Neither reads what a policy *says*.
 *
 * Found 2026-08-28 on `object_links` (the readthrough relationship graph,
 * including its free-text `context`) and on `theme_assets`. Both were believed
 * safe: `theme_assets` is recorded in `tenant-boundary-lint.mjs` as
 * "themes.organization_id via theme_id", and `themes` genuinely IS scoped — but
 * the join table does not inherit that. **An FK chain is not a policy.** That
 * belief, written down and never verified, is the thing this guard checks.
 *
 * ── Why an allowlist and not a baseline count ─────────────────────────────
 *
 * A numeric baseline ("64 known, fail at 65") permits the 65th to be swapped in
 * for a fixed one, and it never has to shrink. This guard instead names every
 * table that may be globally readable and requires a reason for it. A new
 * unconditional policy fails unless someone adds the table to an explicit list
 * and writes down why — which is a code review about a security boundary, which
 * is the point.
 *
 * `KNOWN_UNRESOLVED` is the migration path: the findings that already exist and
 * are being worked. It is a ratchet — entries may be removed, never added.
 *
 * ── Positive proof of work ────────────────────────────────────────────────
 *
 * Follows `lint-mobile-ratchet.mjs`: an empty result must not read as a pass.
 * If the inventory does not parse, or holds implausibly few tables or policies,
 * this fails loudly rather than reporting zero violations.
 *
 * ── Input ─────────────────────────────────────────────────────────────────
 *
 * A sanitized security inventory from `scripts/audit/schema-baseline.mjs`.
 * Reading a committed artifact rather than the live database is deliberate: it
 * needs no credentials, so it can run in CI on every pull request.
 *
 *   node scripts/unconditional-policy-guard.mjs <inventory.json>
 *   node scripts/unconditional-policy-guard.mjs --json
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Tables that MAY carry an unconditional SELECT, each with the reason.
 *
 * The bar: the table holds reference data that is identical for every tenant
 * and reveals nothing about any tenant's activity. "Everyone needs to read it"
 * is not sufficient — coverage and holdings are needed by everyone too.
 *
 * Adding an entry is a security decision. Write the reason, not a placeholder.
 */
export const GLOBAL_READ_ALLOWLIST = {
  assets: 'Security master. Ticker/name/sector reference, identical for all tenants.',
  asset_classes: 'Asset-class taxonomy. Static reference.',
  asset_earnings_dates: 'Earnings calendar. Public market data.',
  analyst_price_target_history: 'Sell-side consensus history. Vendor market data.',
  price_target_history: 'Sell-side consensus history. Vendor market data.',
  estimate_metrics: 'Estimate metric definitions. Static reference vocabulary.',
}

/**
 * Tables where world-readable (anon, no login) is the INTENDED state.
 *
 * Deliberately separate from `GLOBAL_READ_ALLOWLIST`, and deliberately harder
 * to get onto. "Every tenant may read it" and "the open internet may read it"
 * are two different decisions, and collapsing them is how a table that is
 * global-to-customers quietly becomes public-to-everyone. A table must be on
 * BOTH lists to pass as anon-readable.
 *
 * Note: being here justifies only the anon SELECT. The blanket
 * INSERT/UPDATE/DELETE/TRUNCATE grants that `anon` holds on these tables are
 * still wrong and should be revoked as defence in depth — they are currently
 * inert only because no unconditional write policy backs them.
 */
export const ANON_READ_ALLOWLIST = {
  asset_earnings_dates: 'Public market data — earnings dates are published by the issuer.',
  estimate_metrics: 'Static metric-name vocabulary. Contains no tenant or market data.',
}

/**
 * Findings that predate this guard and are being worked.
 *
 * A RATCHET: entries may only be REMOVED. Adding one requires deleting this
 * comment and admitting the guard has been turned into a baseline.
 *
 * Seeded 2026-08-28 from the production inventory. Every entry is a table whose
 * rows belong to a tenant or a user and are currently readable by all.
 */
export const KNOWN_UNRESOLVED = new Set([
  // --- P0, in remediation (this branch) ---
  'object_links', 'theme_assets',
  // --- allocation ---
  'allocation_attachments', 'allocation_cell_notes', 'allocation_comments',
  'allocation_history', 'allocation_team_members', 'allocation_votes',
  'official_allocation_views', 'individual_allocation_views',
  // --- checklists / workflow ---
  'asset_checklist_items', 'checklist_comment_mentions', 'checklist_comment_references',
  'checklist_item_comments', 'checklist_task_assignments', 'checklist_work_requests',
  'general_checklist_items', 'general_workflow_progress', 'stage_assignments',
  'asset_stage_deadlines', 'workflow_portfolio_selections', 'portfolio_workflow_progress',
  'portfolio_checklist_items', 'portfolio_checklist_attachments',
  // --- research / contributions ---
  'asset_contribution_history', 'asset_field_history', 'asset_revisions',
  'asset_revision_events', 'contribution_reactions', 'contribution_replies',
  'contribution_summaries', 'asset_tags', 'asset_tag_assignments',
  // --- teams / coverage ---
  'asset_team_history', 'asset_team_members', 'coverage_portfolios',
  // --- TDF ---
  'tdf_comments', 'tdf_executed_trades', 'tdf_glide_path_targets', 'tdf_holdings',
  'tdf_holdings_snapshots', 'tdf_notes', 'tdf_trade_proposals',
  'tdf_trade_proposal_items', 'tdf_underlying_funds',
  // --- trading / ideas ---
  'scenarios', 'trade_queue_comments', 'trade_queue_votes', 'trade_lab_idea_links',
  'idea_reactions', 'decision_reviews',
  // --- messaging / social ---
  'messages', 'author_follows',
  // --- per-user surfaces that are not, in fact, per-user ---
  'user_asset_priorities', 'user_asset_widgets', 'user_asset_widget_values',
  // --- platform ---
  'audit_events', 'platform_ai_config', 'theme_workflow_progress', 'activity_events',
  'asset_list_activity', 'project_activity', 'portfolio_team',
  // --- unconditional WRITE, no SELECT finding (seeded 2026-08-28) ---
  // Any authenticated user may insert here regardless of tenant. `notifications`
  // is the sharpest: it means a user in any org can fabricate a notification
  // addressed to anyone.
  'notifications', 'pair_trades', 'simulation_trades',
  'asset_classes', 'analyst_price_target_history',
])

/** Roles that already bypass RLS; a policy naming them changes no access path. */
const OWNER_ROLES = new Set(['postgres', 'service_role'])

/** Below these, the inventory did not really load. Prod has ~287 / ~928. */
const MIN_TABLES = 200
const MIN_POLICIES = 600

// ---------------------------------------------------------------------------
// Classification (pure — unit tested)
// ---------------------------------------------------------------------------

/**
 * `public` is not "the public role is harmless".
 *
 * In PostgREST terms a policy `TO public` applies to `anon` as well as
 * `authenticated`. Combined with a SELECT grant to `anon`, an unconditional
 * policy is reachable by anyone holding the publishable key — the open
 * internet, not a tenant bug. Severity is raised for those regardless of any
 * allowlist, because a table may be legitimately global to *customers* and
 * still have no business being world-readable.
 */
export function classify(inventory) {
  const tables = new Map((inventory.tables ?? []).map(t => [t.name, t]))
  const findings = []

  for (const p of inventory.policies ?? []) {
    if (!p.unconditional) continue
    // `postgres` and `service_role` carry BYPASSRLS, so a policy naming them
    // grants nothing they did not already have. Not a finding — and counting it
    // as one trains readers to skim the report.
    if (OWNER_ROLES.has(p.roles)) continue

    const table = tables.get(p.table)
    const anonGrants = String(table?.anon ?? '')
    const anonReachable = p.roles === 'public' && /\bSELECT\b/.test(anonGrants)
    const allowlisted = Object.hasOwn(GLOBAL_READ_ALLOWLIST, p.table)
    const known = KNOWN_UNRESOLVED.has(p.table)

    // A write that anyone can perform, unconditionally.
    if (p.cmd !== 'SELECT') {
      findings.push({
        table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
        severity: p.roles === 'public' ? 'SEV1_ANON_WRITE' : 'SEV2_UNCONDITIONAL_WRITE',
        known,
        detail: `unconditional ${p.cmd} TO ${p.roles}`,
      })
      continue
    }

    if (anonReachable) {
      // Both lists required: global-to-customers is not public-to-everyone.
      if (allowlisted && Object.hasOwn(ANON_READ_ALLOWLIST, p.table)) continue
      findings.push({
        table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
        severity: 'SEV1_ANON_READ', known,
        detail: 'unconditional SELECT TO public AND anon holds SELECT — world-readable',
      })
      continue
    }

    if (allowlisted) continue

    findings.push({
      table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
      severity: 'SEV2_CROSS_TENANT_READ', known,
      detail: 'unconditional SELECT on a table not in GLOBAL_READ_ALLOWLIST',
    })
  }

  return findings.sort((a, b) =>
    a.severity.localeCompare(b.severity) || a.table.localeCompare(b.table))
}

/** Allowlist entries that no longer have an unconditional policy — dead weight. */
export function staleAllowlistEntries(inventory) {
  const live = new Set((inventory.policies ?? [])
    .filter(p => p.unconditional && p.cmd === 'SELECT').map(p => p.table))
  return Object.keys(GLOBAL_READ_ALLOWLIST).filter(t => !live.has(t))
}

/** Ratchet entries that are now clean — the list must shrink. */
export function resolvedEntries(findings) {
  const stillFound = new Set(findings.map(f => f.table))
  return [...KNOWN_UNRESOLVED].filter(t => !stillFound.has(t)).sort()
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const DEFAULT_INVENTORY = 'docs/audit/baselines/production-security-inventory.json'

function main(argv) {
  const asJson = argv.includes('--json')
  const path = argv.find(a => a.endsWith('.json') && a !== '--json') ?? DEFAULT_INVENTORY

  let inventory
  try {
    inventory = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    console.error(`FAIL: could not read a security inventory at ${path}`)
    console.error(`      ${e.message}`)
    console.error('      Generate one with: node scripts/audit/schema-baseline.mjs')
    return 2
  }

  // Positive proof of work — an empty inventory must not read as a pass.
  const nTables = (inventory.tables ?? []).length
  const nPolicies = (inventory.policies ?? []).length
  if (nTables < MIN_TABLES || nPolicies < MIN_POLICIES) {
    console.error(`FAIL: inventory looks truncated — ${nTables} tables, ${nPolicies} policies.`)
    console.error(`      Expected at least ${MIN_TABLES} / ${MIN_POLICIES}. Refusing to report a pass.`)
    return 2
  }

  const findings = classify(inventory)
  const fresh = findings.filter(f => !f.known)
  const stale = staleAllowlistEntries(inventory)
  const resolved = resolvedEntries(findings)

  if (asJson) {
    console.log(JSON.stringify({ findings, fresh, stale, resolved }, null, 2))
    return fresh.length > 0 ? 1 : 0
  }

  console.log(`Unconditional-policy guard — ${path}`)
  console.log(`  captured ${inventory.captured_at ?? 'unknown'} · ${nTables} tables · ${nPolicies} policies\n`)

  const bySeverity = {}
  for (const f of findings) (bySeverity[f.severity] ??= []).push(f)
  for (const sev of Object.keys(bySeverity).sort()) {
    console.log(`  ${sev} — ${bySeverity[sev].length}`)
    for (const f of bySeverity[sev]) {
      console.log(`    ${f.known ? ' ' : '!'} ${f.table}.${f.policy}: ${f.detail}`)
    }
    console.log('')
  }

  if (resolved.length) {
    console.log(`  RATCHET: ${resolved.length} entries are now clean — remove them from`)
    console.log(`  KNOWN_UNRESOLVED: ${resolved.join(', ')}\n`)
  }
  if (stale.length) {
    console.log(`  Allowlist entries no longer needed: ${stale.join(', ')}\n`)
  }

  if (fresh.length) {
    console.log(`FAIL: ${fresh.length} finding(s) not in KNOWN_UNRESOLVED.`)
    console.log('      Either fix the policy, or — if the table is genuinely global')
    console.log('      reference data — add it to GLOBAL_READ_ALLOWLIST with a reason.')
    return 1
  }

  console.log(`PASS: ${findings.length} known finding(s), 0 new.`)
  console.log('      KNOWN_UNRESOLVED is a ratchet, not a baseline. It must shrink.')
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
