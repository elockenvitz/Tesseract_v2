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
 * ── What the first version of this guard missed ───────────────────────────
 *
 * Looking only for a literal `true` is not enough, because a table's real
 * boundary is not one policy — it is every permissive policy on that command,
 * OR-ed together. `portfolio_team` in production:
 *
 *     Portfolio team: org-scoped read   USING portfolio_in_current_org(portfolio_id)
 *     pt_select_all_authed              USING (auth.uid() IS NOT NULL)
 *
 * Neither predicate is `true`, so the original guard reported nothing at all,
 * while every authenticated user could read every row. The scoped policy is not
 * a boundary; it is a comment with SQL syntax. Two additions follow:
 *
 *   1. SIBLING ANALYSIS. Policies are grouped by (table, command, role) — with
 *      `FOR ALL` expanded to four commands and `TO public` expanded to anon and
 *      authenticated — and judged together. A correctly scoped policy standing
 *      next to a broad one is reported, because the broad one wins.
 *
 *   2. PREDICATE CLASS, not a boolean. `scripts/lib/policy-predicate.mjs` sorts
 *      a predicate into UNCONDITIONAL / AUTH_ONLY / SCOPED / DENY / EMPTY /
 *      UNKNOWN. `auth.uid() IS NOT NULL` proves a session exists and nothing
 *      about which rows — for a logged-in caller it is `true` with extra steps.
 *      Anything unrecognised is UNKNOWN and is never counted as safe.
 *
 * A note on a case that looks like a hole and is not: an UPDATE policy that
 * omits WITH CHECK reuses its USING expression for the new row, so a scoped
 * USING keeps scoping the post-image. What is dangerous is a WITH CHECK that is
 * present and broader — or a permissive sibling supplying a broad one, which is
 * what actually lets a `portfolio_team` row be moved to another tenant. Both are
 * detected; the harmless shape is deliberately not reported.
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
 * The inventory carries no predicate text — a repository is the wrong place to
 * publish every tenant boundary in the product. Predicate classes survive that
 * anyway: inventories at `schema_version` 2 carry a class computed at capture
 * time, and older ones are still classified by matching their predicate hashes
 * against a corpus of known-broad shapes. See `scripts/lib/policy-predicate.mjs`.
 *
 *   node scripts/unconditional-policy-guard.mjs <inventory.json>
 *   node scripts/unconditional-policy-guard.mjs --json
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CLASS, BROAD, resolveClass } from './lib/policy-predicate.mjs'

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
  // The unconditional SELECT policy on `assets` remains correct, but only
  // because C1 moved the columns that made it wrong. The row is global; nine
  // columns on it were not, and `useExploreSearch` searched three of them
  // across every tenant. Those columns are no longer readable by
  // `authenticated` — the table grant was replaced by a column-level grant in
  // scripts/sql/security-c1/09-assets-proprietary-columns.sql — so what this
  // policy now exposes really is identical for all tenants.
  //
  // The predicate alone does not say that, which is why the reason has to.
  assets: 'Security master: identity, listing and market reference only. '
        + 'Proprietary research lives in asset_contributions, workflow state in '
        + 'asset_workflow_progress / _priorities; those columns are revoked from '
        + 'authenticated at the column level (C1/09), not merely unused.',
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
  'contribution_reactions', 'contribution_replies',
  'contribution_summaries', 'asset_tags', 'asset_tag_assignments',
  // --- teams / coverage ---
  'asset_team_history', 'asset_team_members', 'coverage_portfolios',
  // --- TDF ---
  'tdf_comments', 'tdf_executed_trades', 'tdf_glide_path_targets',
  'tdf_notes', 'tdf_trade_proposals',
  'tdf_trade_proposal_items', 'tdf_underlying_funds',
  // --- trading / ideas ---
  'trade_queue_comments', 'trade_queue_votes', 'trade_lab_idea_links',
  'idea_reactions', 'decision_reviews',
  // --- messaging / social ---
  'author_follows',
  // --- per-user surfaces that are not, in fact, per-user ---
  'user_asset_priorities', 'user_asset_widgets', 'user_asset_widget_values',
  // --- platform ---
  'platform_ai_config', 'theme_workflow_progress', 'activity_events',
  'asset_list_activity', 'project_activity',
  // --- unconditional WRITE, no SELECT finding (seeded 2026-08-28) ---
  // Any authenticated user may insert here regardless of tenant. `notifications`
  // is the sharpest: it means a user in any org can fabricate a notification
  // addressed to anyone.
  'pair_trades', 'simulation_trades',
  'asset_classes', 'analyst_price_target_history',
])

/**
 * Tables that the SIBLING detector reports and the original guard could not see.
 *
 * These are NOT new defects — they are older ones that became visible when the
 * guard learned to read predicates instead of counting `true`. They are listed
 * separately from `KNOWN_UNRESOLVED` so that the ratchet's "entries may only be
 * removed" rule stays literally true, and so the cost of the upgrade is legible
 * rather than folded into a number.
 *
 * Same rule: removal only.
 */
export const KNOWN_UNRESOLVED_SIBLING = new Set([
  // `pt_*_all_authed` — USING (auth.uid() IS NOT NULL) — defeats the four
  // "Portfolio team: org-scoped *" policies sitting beside them. This is the
  // escalation that motivated the sibling detector. Remediated in Release C.

  // Found by this detector on the day it was written, in prod AND staging, by
  // no previous check:
  //   "Users can manage their own snapshots"    ALL    USING (user_id = auth.uid())
  //   "Users can view all performance snapshots" SELECT USING (auth.uid() IS NOT NULL)
  // The per-user policy is exactly right and completely inert for reads: every
  // authenticated user can read every analyst's performance history in every
  // org. Not anon-reachable — `auth.uid() IS NOT NULL` is false without a
  // session — so this is SEV2, and it is queued behind messages/audit_events.
])

/** Roles that already bypass RLS; a policy naming them changes no access path. */
const OWNER_ROLES = new Set(['postgres', 'service_role'])

/** Below these, the inventory did not really load. Prod has ~287 / ~928. */
const MIN_TABLES = 200
const MIN_POLICIES = 600

// ---------------------------------------------------------------------------
// Classification (pure — unit tested)
// ---------------------------------------------------------------------------

/** `FOR ALL` is four policies wearing one name. */
const expandCmds = cmd =>
  cmd === 'ALL' ? ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] : [cmd]

/**
 * `TO public` is not "the public role is harmless" — in PostgREST terms it
 * covers `anon` as well as `authenticated`. Expanding it is what lets a policy
 * written for logged-in users be judged as the anonymous grant it also is.
 */
const expandRoles = roles =>
  String(roles ?? '').split(',').map(r => r.trim()).filter(Boolean)
    .flatMap(r => (r === 'public' ? ['anon', 'authenticated'] : [r]))
    .filter(r => !OWNER_ROLES.has(r))

const hasGrant = (table, priv) =>
  new RegExp(`\\b${priv}\\b`).test(String(table?.anon ?? ''))

/** The predicate that decides whether a caller may reach a row, for one command. */
const accessClass = (p, cmd) =>
  cmd === 'INSERT' ? resolveClass(p, 'check') : resolveClass(p, 'qual')

/**
 * The same predicate, judged for one specific role.
 *
 * AUTH_ONLY is broad for `authenticated` and CLOSED for `anon`: `auth.uid() IS
 * NOT NULL` is false when there is no session. Expanding `TO public` into both
 * roles without this distinction reports an anonymous bypass that cannot happen
 * — which is how a guard earns the habit of being ignored.
 *
 * Only a literally unconditional predicate is broad for `anon`.
 */
const accessClassFor = (p, cmd, role) => {
  const c = accessClass(p, cmd)
  if (role === 'anon' && c === CLASS.AUTH_ONLY) return CLASS.DENY
  return c
}

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
    // `postgres` and `service_role` carry BYPASSRLS, so a policy naming them
    // grants nothing they did not already have. Not a finding — and counting it
    // as one trains readers to skim the report.
    if (OWNER_ROLES.has(p.roles)) continue

    const table = tables.get(p.table)
    const known = KNOWN_UNRESOLVED.has(p.table)

    // ── 2. An UPDATE whose post-image check is broader than its row filter ──
    // Only when WITH CHECK is PRESENT and broad: an omitted one falls back to
    // USING, which is not a hole. See policy-predicate.mjs.
    if (p.cmd === 'UPDATE' || p.cmd === 'ALL') {
      const u = resolveClass(p, 'qual')
      const c = resolveClass(p, 'check')
      if (u === CLASS.SCOPED && BROAD.has(c)) {
        findings.push({
          table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
          severity: 'SEV2_UPDATE_CHECK_WEAKER', known,
          detail: `USING is ${u} but WITH CHECK is ${c} — an authorised row can be rewritten out of scope`,
        })
      }
    }

    if (!p.unconditional) continue

    const anonReachable = p.roles === 'public' && hasGrant(table, 'SELECT')
    const allowlisted = Object.hasOwn(GLOBAL_READ_ALLOWLIST, p.table)

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

  return [...findings, ...siblingFindings(inventory)].sort((a, b) =>
    a.severity.localeCompare(b.severity) || a.table.localeCompare(b.table) ||
    String(a.policy).localeCompare(String(b.policy)))
}

/**
 * ── 1. Broad permissive siblings ──────────────────────────────────────────
 *
 * Permissive policies OR together, so a command's real boundary is its widest
 * policy. Group by (table, command, role) and report any group where a broad
 * policy stands beside a scoped one: the scoped policy is doing nothing, and —
 * worse — it is the reason everyone believes the table is safe.
 *
 * Reported separately from a bare `USING (true)` because the failure is
 * different in kind. There the boundary is missing and looks missing. Here the
 * boundary is present, correct, and inert.
 */
export function siblingFindings(inventory) {
  const tables = new Map((inventory.tables ?? []).map(t => [t.name, t]))
  const groups = new Map()

  for (const p of inventory.policies ?? []) {
    // Only PERMISSIVE policies OR together. A RESTRICTIVE policy ANDs, and can
    // only ever narrow — it cannot be the cause of an over-broad boundary, and
    // one present in a group could legitimately rescue it.
    const permissive = String(p.permissive ?? 'PERMISSIVE').toUpperCase()
    for (const cmd of expandCmds(p.cmd)) {
      for (const role of expandRoles(p.roles)) {
        const key = [p.table, cmd, role].join(String.fromCharCode(31))
        if (!groups.has(key)) groups.set(key, { table: p.table, cmd, role, permissive: [], restrictive: [] })
        groups.get(key)[permissive === 'RESTRICTIVE' ? 'restrictive' : 'permissive'].push(p)
      }
    }
  }

  const findings = []
  for (const g of groups.values()) {
    // A restrictive policy ANDs over the whole group and may legitimately be the
    // real boundary. Do not claim a bypass we cannot prove.
    if (g.restrictive.length) continue

    const broad = g.permissive.filter(p => BROAD.has(accessClassFor(p, g.cmd, g.role)))
    const scoped = g.permissive.filter(p => accessClassFor(p, g.cmd, g.role) === CLASS.SCOPED)
    if (!broad.length || !scoped.length) continue

    const anonReachable = g.role === 'anon' &&
      hasGrant(tables.get(g.table), g.cmd === 'SELECT' ? 'SELECT' : g.cmd)

    findings.push({
      table: g.table,
      policy: broad.map(p => p.name).join(' + '),
      cmd: g.cmd,
      roles: g.role,
      severity: anonReachable ? 'SEV1_ANON_SIBLING_BYPASS' : 'SEV2_SIBLING_BYPASS',
      known: KNOWN_UNRESOLVED.has(g.table) || KNOWN_UNRESOLVED_SIBLING.has(g.table),
      detail: `${g.cmd} TO ${g.role}: broad sibling ${broad.map(p => `"${p.name}"`).join(', ')} ` +
              `(${[...new Set(broad.map(p => accessClassFor(p, g.cmd, g.role)))].join('/')}) defeats scoped ` +
              `${scoped.map(p => `"${p.name}"`).join(', ')}`,
    })
  }
  return findings
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
  return [...KNOWN_UNRESOLVED, ...KNOWN_UNRESOLVED_SIBLING]
    .filter(t => !stillFound.has(t)).sort()
}

/**
 * How much of the inventory this run could actually reason about.
 *
 * A sanitized inventory carries hashes, and only predicates matching the known
 * corpus classify. Everything else is UNKNOWN — not safe, just unread. Printing
 * that fraction stops a mostly-blind run from reading like a clean one.
 */
export function coverage(inventory) {
  let classified = 0, unknown = 0
  for (const p of inventory.policies ?? []) {
    if (OWNER_ROLES.has(p.roles)) continue
    for (const cmd of expandCmds(p.cmd)) {
      if (accessClass(p, cmd) === CLASS.UNKNOWN) unknown++
      else classified++
    }
  }
  return { classified, unknown, total: classified + unknown }
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
  const cov = coverage(inventory)

  if (asJson) {
    console.log(JSON.stringify({ findings, fresh, stale, resolved, coverage: cov }, null, 2))
    return fresh.length > 0 ? 1 : 0
  }

  console.log(`Unconditional-policy guard — ${path}`)
  console.log(`  captured ${inventory.captured_at ?? 'unknown'} · ${nTables} tables · ${nPolicies} policies`)
  console.log(`  predicate coverage: ${cov.classified}/${cov.total} classified, ${cov.unknown} UNKNOWN (unread, not safe)\n`)

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
    console.log(`  KNOWN_UNRESOLVED / KNOWN_UNRESOLVED_SIBLING: ${resolved.join(', ')}\n`)
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
