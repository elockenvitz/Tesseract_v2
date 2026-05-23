#!/usr/bin/env node
/**
 * apply-migrations-to-staging.mjs
 *
 * One-shot helper that pushes every file in supabase/migrations/ into a
 * target Supabase project via the Management API. We use this to bootstrap
 * the staging Supabase project from a freshly-empty state — the production
 * migrations are the source of truth for schema.
 *
 * Why a Node script, not the Supabase CLI:
 *   - We don't want to require the CLI install (this script is meant to be
 *     runnable from a bare clone on any dev machine that has Node).
 *   - The Management API's /database/query endpoint is sufficient for
 *     applying DDL; we just iterate in chronological filename order.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<staging-ref> \
 *     node scripts/apply-migrations-to-staging.mjs
 *
 * Reads token + project ref from env, falls back to .mcp.json for the
 * token if SUPABASE_ACCESS_TOKEN isn't set. Refuses to run without an
 * explicit SUPABASE_PROJECT_REF — accidentally pointing this at prod
 * would replay 250 migrations against a database that already has them.
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations')

async function getAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  // Fallback: read from .mcp.json so a developer who has the MCP wired
  // up doesn't need to also export the env var.
  try {
    const mcpRaw = await readFile(path.join(REPO_ROOT, '.mcp.json'), 'utf8')
    const mcp = JSON.parse(mcpRaw)
    return mcp.mcpServers?.supabase?.env?.SUPABASE_ACCESS_TOKEN
  } catch {
    return undefined
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runQuery({ projectRef, token, sql }) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  )
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}

// Wrap runQuery with exponential-backoff on rate limits. The Supabase
// Management API caps requests to roughly 60/min — bursting past that
// returns HTTP 429. We back off 30s, 60s, 120s and stop retrying past
// that to avoid hanging forever.
async function runQueryWithRetry(args, attempt = 0) {
  const result = await runQuery(args)
  if (result.status === 429 && attempt < 3) {
    const waitMs = [30000, 60000, 120000][attempt]
    console.log(`    rate-limited — sleeping ${waitMs / 1000}s before retry…`)
    await sleep(waitMs)
    return runQueryWithRetry(args, attempt + 1)
  }
  return result
}

// "Already exists" / "duplicate object" errors are expected when this
// script is re-run after a partial success. Treat them as warnings.
function isAlreadyExistsError(body) {
  const lc = body.toLowerCase()
  return (
    lc.includes('already exists') ||
    lc.includes('duplicate') ||
    lc.includes('already a member')
  )
}

async function main() {
  const projectRef = process.env.SUPABASE_PROJECT_REF
  if (!projectRef) {
    console.error('ERROR: set SUPABASE_PROJECT_REF (the staging project ref).')
    console.error('Refusing to default — accidentally pointing this at prod')
    console.error('would replay every migration against a populated DB.')
    process.exit(1)
  }

  const token = await getAccessToken()
  if (!token) {
    console.error('ERROR: no SUPABASE_ACCESS_TOKEN found in env or .mcp.json.')
    process.exit(1)
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort()

  console.log(`Applying ${files.length} migrations to project ${projectRef}…`)
  console.log('')

  let applied = 0
  let skippedAlreadyExists = 0
  let failed = 0
  const failures = []

  // Throttle: 1500ms between requests = ~40 req/min, comfortably under
  // the Supabase Management API ceiling of ~60/min. The whole batch
  // takes ~6 min for 250 files, acceptable for a one-shot bootstrap.
  const DELAY_MS = 1500

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
    const result = await runQueryWithRetry({ projectRef, token, sql })

    if (result.ok) {
      applied++
      // Print one line every 10 files to keep the log readable.
      if (applied % 10 === 0 || i === files.length - 1) {
        console.log(`  ${String(i + 1).padStart(3)} / ${files.length}  (latest applied: ${file})`)
      }
    } else if (isAlreadyExistsError(result.body)) {
      // The script is re-runnable — re-applied migrations that already
      // landed produce "already exists" errors. Log them quietly.
      skippedAlreadyExists++
    } else {
      failed++
      failures.push({ file, status: result.status, body: result.body })
      console.log(`  ✗ ${file}  [HTTP ${result.status}]`)
      console.log(`    ${result.body.slice(0, 240)}`)
    }

    if (i < files.length - 1) await sleep(DELAY_MS)
  }

  console.log('')
  console.log(`Done.`)
  console.log(`  Applied:                ${applied} / ${files.length}`)
  console.log(`  Skipped (already done): ${skippedAlreadyExists}`)
  console.log(`  Failed:                 ${failed}`)
  if (failed > 0) {
    console.log('')
    console.log('Failure summary:')
    for (const f of failures) {
      console.log(`  - ${f.file} (HTTP ${f.status})`)
      console.log(`    ${f.body.slice(0, 200)}`)
    }
    process.exit(1)
  }
}

main().catch(err => {
  console.error('UNEXPECTED ERROR:', err)
  process.exit(1)
})
