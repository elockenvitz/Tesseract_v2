#!/usr/bin/env node
/**
 * mgmt-query.mjs — read-only Management API query runner for the C1 evidence pass.
 *
 * Why this exists: `scripts/audit/schema-baseline.mjs` and
 * `scripts/apply-migrations-to-staging.mjs` both resolve credentials from
 * `.mcp.json` *in the repository root*. A worktree that lacks that file — and
 * `.mcp.json` is gitignored, so every fresh worktree does — has no way to reach
 * a live database except by exporting the token by hand into every shell.
 * This runner adds one extra, explicitly-authorized resolution step: the main
 * checkout's `.mcp.json`. It reads that file, it never copies it and never
 * writes it, and the token is held in memory only — no argv, no log, no output.
 *
 * READ-ONLY BY CONSTRUCTION. Every statement is checked against a
 * write-verb denylist before it is sent, and the whole batch is wrapped in a
 * read-only transaction server-side, so a statement that slipped past the
 * lexical check would still be refused by Postgres. Production is only ever
 * observed through this path.
 *
 *   node scripts/sql/security-c1/mgmt-query.mjs --env=prod --file=x.sql
 *   node scripts/sql/security-c1/mgmt-query.mjs --env=staging --sql="select 1"
 *   ... --json          emit raw JSON instead of the aligned table
 *   ... --allow-writes  STAGING ONLY — drops the read-only wrapper
 *
 * `--allow-writes` exists for the synthetic RLS fixtures, which must INSERT to
 * prove anything. It is refused outright on `--env=prod`, so no combination of
 * flags reaches a production write through this file.
 *
 * Exit codes: 0 ok · 2 no credential · 3 refused as a write · 4 API error.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// Both refs are recorded in the repository already (scripts/seed-staging.mjs,
// supabase/.temp/linked-project.json). A project ref is not a secret; the
// access token is, and that never appears here.
const PROJECTS = {
  prod: 'wfcebeagznzgeuyysbnt',
  staging: 'pdajkwtrrjcqnjsyvyqt',
}

// The main checkout carries the only `.mcp.json` on this machine. Reading it
// is explicitly authorized for Security C1; copying it into a worktree is not,
// which is exactly why this is a read at call time rather than a bootstrap step.
const AUTHORIZED_MCP_FALLBACKS = ['C:/dev/Tesseract_v2/.mcp.json']

const argv = process.argv.slice(2)
const arg = name => argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const AS_JSON = argv.includes('--json')
const ALLOW_WRITES = argv.includes('--allow-writes')

async function tokenFrom(file) {
  try {
    const mcp = JSON.parse(await readFile(file, 'utf8'))
    return mcp.mcpServers?.supabase?.env?.SUPABASE_ACCESS_TOKEN
  } catch {
    return undefined
  }
}

async function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  for (const file of [path.join(REPO, '.mcp.json'), ...AUTHORIZED_MCP_FALLBACKS]) {
    const token = await tokenFrom(file)
    if (token) return token
  }
  console.error('No Supabase access token: set SUPABASE_ACCESS_TOKEN, or provide .mcp.json.')
  process.exit(2)
}

/**
 * Lexical write check. Comments and string literals are stripped first, so a
 * table named `..._update_...` or the word "insert" inside a doc comment does
 * not trip it. This is a guard rail, not the guarantee — the read-only
 * transaction wrapper below is the guarantee.
 */
const WRITE_VERBS =
  /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|comment|reindex|vacuum|copy|call|do|set\s+role|security\s+label)\b/i

function refuseIfWrite(sql) {
  const bare = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
  const hit = bare.match(WRITE_VERBS)
  if (hit) {
    console.error(`Refused: statement contains a write verb (${hit[1]}). This runner is read-only.`)
    process.exit(3)
  }
}

/**
 * The migration files are written for psql and wrap themselves in BEGIN/COMMIT.
 * The Management API runs the whole batch inside a transaction it opens itself,
 * where an explicit BEGIN/COMMIT pair is a syntax error. Removing an outer pair
 * therefore preserves the semantics exactly — the statements still commit or
 * abort together — rather than relaxing them. Anything other than a matched
 * outer pair is left alone, so a file with real nested transaction control
 * fails loudly instead of being silently rewritten.
 */
function stripOuterTransaction(sql) {
  const trimmed = sql.trim()
  const opens = (trimmed.match(/^\s*BEGIN\s*;/gim) ?? []).length
  const closes = (trimmed.match(/^\s*COMMIT\s*;/gim) ?? []).length
  if (opens !== 1 || closes !== 1) return sql
  if (!/^BEGIN\s*;/i.test(trimmed) || !/COMMIT\s*;$/i.test(trimmed)) return sql
  process.stderr.write('note: outer BEGIN/COMMIT removed — the API supplies the transaction.\n')
  return trimmed.replace(/^BEGIN\s*;/i, '').replace(/COMMIT\s*;$/i, '')
}

async function run(ref, token, sql) {
  // The endpoint already runs the batch inside its own transaction, so an
  // explicit BEGIN/COMMIT pair is a syntax error. `SET TRANSACTION READ ONLY`
  // marks that surrounding transaction instead, and it is the real
  // enforcement: any write that got past the lexical check above still raises
  // `cannot execute ... in a read-only transaction`.
  const query = ALLOW_WRITES ? stripOuterTransaction(sql) : `SET TRANSACTION READ ONLY;\n${sql}`
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) {
    // Never echo the request headers — the token lives there.
    //
    // The body is not truncated to a couple of lines, because the RLS fixture
    // suites deliberately end in `RAISE EXCEPTION` to force a ROLLBACK and
    // carry their assertion table out in the error message. For those runs
    // this *is* the result, not a stack trace.
    console.error(`Management API ${res.status}: ${text}`)
    process.exit(4)
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function renderTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '(0 rows)'
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const cell = v =>
    v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  const width = c => Math.max(c.length, ...rows.map(r => cell(r[c]).length))
  const w = Object.fromEntries(cols.map(c => [c, Math.min(width(c), 80)]))
  const line = cells => cells.map((v, i) => v.padEnd(w[cols[i]])).join('  ').trimEnd()
  return [
    line(cols),
    cols.map(c => '-'.repeat(w[c])).join('  '),
    ...rows.map(r => line(cols.map(c => cell(r[c]).slice(0, 80)))),
    `(${rows.length} row${rows.length === 1 ? '' : 's'})`,
  ].join('\n')
}

const env = arg('env') ?? 'prod'
const ref = PROJECTS[env]
if (!ref) {
  console.error(`Unknown --env=${env}. Expected one of: ${Object.keys(PROJECTS).join(', ')}`)
  process.exit(2)
}

const file = arg('file')
const sql = file ? await readFile(path.resolve(REPO, file), 'utf8') : arg('sql')
if (!sql) {
  console.error('Nothing to run: pass --file=<path> or --sql=<statement>.')
  process.exit(2)
}

// Production is observed, never touched. The environment check comes before
// anything else so `--allow-writes --env=prod` fails on the flag combination
// itself, independently of what the SQL happens to contain.
if (ALLOW_WRITES && env !== 'staging') {
  console.error(`Refused: --allow-writes is staging-only, and --env=${env} was requested.`)
  process.exit(3)
}
if (!ALLOW_WRITES) refuseIfWrite(sql)

const result = await run(ref, await accessToken(), sql)
console.log(AS_JSON ? JSON.stringify(result, null, 2) : renderTable(result))
