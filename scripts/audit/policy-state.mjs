#!/usr/bin/env node
/**
 * Replay every migration in filename order and report which RLS policies are
 * still live — specifically, which are unconditionally permissive.
 *
 * Read-only. Touches no database and no application file. It exists because
 * "is this policy still there?" is not answerable by grepping: a permissive
 * policy created in 2025 may have been dropped by a hardening migration in
 * 2026, and grep reports both as present. The 2026-04 and 2026-08 hardening
 * migrations closed dozens of these correctly, and a report that listed them
 * as open would be useless.
 *
 * So this tracks DROP POLICY / CREATE POLICY pairs across all 279 files and
 * reports only the survivors. Confidence check: the permissive
 * portfolio_holdings_positions policies from 20260221100000 do NOT appear in
 * the output, because 20260408100000_harden_holdings_rls.sql drops them.
 *
 * A policy with no `TO` clause defaults to the PUBLIC role, which in Supabase
 * includes `anon` — so those are reported separately. Whether `anon` can
 * actually reach the table also depends on table grants, which are not in this
 * repository; see docs/audit/platform-readiness-2026-08.md §P0-2.
 *
 * Usage:
 *   node scripts/audit/policy-state.mjs            # permissive survivors
 *   node scripts/audit/policy-state.mjs --all      # every live policy
 *   node scripts/audit/policy-state.mjs --json     # machine-readable
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = 'supabase/migrations'

/** Comments can contain policy bodies verbatim (20260815120000 does). Strip them. */
const stripLineComments = sql => sql.replace(/^\s*--.*$/gm, '')

function replay(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  /** key `${table}::${policyName}` -> policy record. Last write wins, drops delete. */
  const live = new Map()

  for (const file of files) {
    const sql = stripLineComments(readFileSync(join(dir, file), 'utf8'))

    for (const m of sql.matchAll(
      /drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[\w]+)\s+on\s+("?[\w.]+"?)/gis
    )) {
      live.delete(`${normalizeTable(m[2])}::${unquote(m[1])}`)
    }

    for (const m of sql.matchAll(
      /create\s+policy\s+("[^"]+"|[\w]+)\s+on\s+("?[\w.]+"?)([\s\S]*?);/gi
    )) {
      const table = normalizeTable(m[2])
      const name = unquote(m[1])
      const body = m[3]
      live.set(`${table}::${name}`, {
        table,
        name,
        file,
        cmd: (body.match(/for\s+(select|insert|update|delete|all)/i)?.[1] ?? 'all').toUpperCase(),
        role: body.match(/\bto\s+([\w, ]+?)\s*(?:using|with check|$)/i)?.[1].trim() ?? 'PUBLIC (implicit)',
        permissive: isUnconditional(body),
      })
    }
  }
  return [...live.values()]
}

const unquote = s => s.replace(/"/g, '')
const normalizeTable = s => unquote(s).replace(/^public\./, '')

/**
 * True when the policy admits every row. `WITH CHECK (true)` alone counts
 * (INSERT policies have no USING clause); `USING (true) WITH CHECK (…)` also
 * counts, because the read is already unconditional.
 */
function isUnconditional(body) {
  if (/using\s*\(\s*true\s*\)/i.test(body)) return true
  return !/using\s*\(/i.test(body) && /with\s+check\s*\(\s*true\s*\)/i.test(body)
}

const args = process.argv.slice(2)
const policies = replay(MIGRATIONS)
const permissive = policies.filter(p => p.permissive)
const anonReachable = permissive.filter(p => p.role.includes('implicit'))

if (args.includes('--json')) {
  console.log(JSON.stringify({ total: policies.length, permissive, anonReachable }, null, 2))
  process.exit(0)
}

const rows = args.includes('--all') ? policies : permissive
const label = args.includes('--all') ? 'live' : 'live and unconditionally permissive'

console.log(`Live policies after replaying ${readdirSync(MIGRATIONS).length} migrations: ${policies.length}`)
console.log(`Unconditionally permissive: ${permissive.length} across ${new Set(permissive.map(p => p.table)).size} tables`)
console.log(`  ...of which default to the PUBLIC role (includes anon): ${anonReachable.length}\n`)

for (const p of rows.sort((a, b) => a.table.localeCompare(b.table) || a.cmd.localeCompare(b.cmd))) {
  const flag = p.role.includes('implicit') ? ' <- PUBLIC role' : ''
  console.log(`${p.table.padEnd(32)} ${p.cmd.padEnd(7)} ${p.role.padEnd(18)} "${p.name}"  [${p.file}]${flag}`)
}

console.log(`\n(${rows.length} ${label} policies listed)`)
