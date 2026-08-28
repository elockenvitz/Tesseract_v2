#!/usr/bin/env node
/**
 * security-suite — run one supabase/tests/*.sql security suite against a project.
 *
 * Generalises scripts/invite-security-test.mjs, which does the same thing for a
 * single hard-coded suite. Same contract: the suite ends with a SELECT returning
 * one row per assertion — (n, result, detail) — and this exits 1 if any row is
 * not a PASS, so it can gate a deploy.
 *
 * The suites are deliberately runnable against an UN-hardened database: they
 * record findings instead of aborting, which is what makes a "before" run
 * useful. Run each one before the Release B SQL and after, and diff the output.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<staging-ref> \
 *     node scripts/security-suite.mjs messages-tenant-isolation
 *
 * The suite name may omit the directory and the .sql extension. The project ref
 * may also be passed as the second argument. STAGING FIRST — none of these
 * suites should be pointed at production without Main Control's say-so; they
 * write fixtures (organizations, users, messages) and clean them up afterwards.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TESTS = path.join(__dirname, '..', 'supabase', 'tests')

const [rawName, refArg] = process.argv.slice(2)

if (!rawName) {
  const available = fs.readdirSync(TESTS).filter(f => f.endsWith('.sql')).sort()
  console.error('Usage: node scripts/security-suite.mjs <suite> [project-ref]\n')
  console.error('Available suites:')
  for (const f of available) console.error(`  ${f.replace(/\.sql$/, '')}`)
  process.exit(2)
}

const suite = rawName.replace(/\.sql$/, '').replace(/^supabase\/tests\//, '')
const sqlPath = path.join(TESTS, `${suite}.sql`)

if (!fs.existsSync(sqlPath)) {
  console.error(`No such suite: ${sqlPath}`)
  process.exit(2)
}

const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = refArg || process.env.SUPABASE_PROJECT_REF

if (!token || !ref) {
  console.error(
    'Missing credentials.\n' +
      '  SUPABASE_ACCESS_TOKEN  Supabase Management API token (Account → Access Tokens)\n' +
      '  SUPABASE_PROJECT_REF   project ref, or pass it as the second argument'
  )
  process.exit(2)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: fs.readFileSync(sqlPath, 'utf8') }),
})

const text = await res.text()
if (!res.ok) {
  console.error(`Query failed (${res.status}):\n${text}`)
  process.exit(2)
}

let rows
try {
  rows = JSON.parse(text)
} catch {
  console.error(`Unexpected response:\n${text}`)
  process.exit(2)
}

// An empty result must not read as a pass: it means the suite raised before its
// final SELECT, so nothing was actually asserted.
if (!Array.isArray(rows) || rows.length === 0) {
  console.error(`${suite} returned no assertions — it did not reach its final SELECT.`)
  console.error('Check that the fixtures could be created; the suite aborts on a setup error.')
  process.exit(2)
}

const failed = rows.filter(r => r.result !== 'PASS')

console.log(`\n${suite} — project ${ref}\n`)
for (const r of rows) {
  // Detail is printed for passes too: "it refused" is only reassuring once you
  // can see WHY it refused. A check that passes because a function is missing
  // looks identical to one that passes because the grant is gone.
  console.log(`  ${r.result.padEnd(4)}  [${String(r.n).padStart(2)}] ${r.detail}`)
}
console.log(
  `\n  ${rows.length - failed.length}/${rows.length} passed` +
    (failed.length ? `, ${failed.length} FAILED\n` : '\n')
)

process.exit(failed.length ? 1 : 0)
