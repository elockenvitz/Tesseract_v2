#!/usr/bin/env node
/**
 * invite-security-test — run the Early Access entry-security suite.
 *
 * Executes supabase/tests/early-access-invite-security.sql against a Supabase
 * project through the Management API and prints one line per check. Exits 1 if
 * any check failed, so it can gate a deploy.
 *
 * The suite is deliberately runnable against an un-hardened database: it
 * records findings instead of aborting, which is what makes a "before" run
 * useful. Fixtures are synthetic and cleaned up in the same transaction.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_...  SUPABASE_PROJECT_REF=abcd...  \
 *     node scripts/invite-security-test.mjs
 *
 * The project ref may also be passed as the first argument.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SQL_PATH = path.join(__dirname, '..', 'supabase', 'tests', 'early-access-invite-security.sql')

const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = process.argv[2] || process.env.SUPABASE_PROJECT_REF

if (!token || !ref) {
  console.error(
    'Missing credentials.\n' +
      '  SUPABASE_ACCESS_TOKEN  Supabase Management API token (Account → Access Tokens)\n' +
      '  SUPABASE_PROJECT_REF   project ref, or pass it as the first argument'
  )
  process.exit(2)
}

const sql = fs.readFileSync(SQL_PATH, 'utf8')

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
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

if (!Array.isArray(rows) || rows.length === 0) {
  console.error('The suite returned no findings — it did not reach its final SELECT.')
  process.exit(2)
}

const failed = rows.filter((r) => r.result !== 'PASS')

console.log(`\nEarly Access entry-security suite — project ${ref}\n`)
for (const r of rows) {
  const mark = r.result === 'PASS' ? 'PASS' : 'FAIL'
  console.log(`  ${mark}  [${String(r.n).padStart(2)}] ${r.name}`)
  // Detail is printed for passes too: "it refused" is only reassuring once you
  // can see WHY it refused. A check that passes because the function is
  // missing looks identical to one that passes because the grant is gone.
  if (r.detail) console.log(`             ${r.detail}`)
}
console.log(
  `\n  ${rows.length - failed.length}/${rows.length} passed` +
    (failed.length ? `, ${failed.length} FAILED\n` : '\n')
)

process.exit(failed.length ? 1 : 0)
