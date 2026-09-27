#!/usr/bin/env node
/**
 * Stand up a Files V1 review database on a scratch Supabase project.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `organizations`, `organization_memberships` and `users` have no CREATE
 * TABLE in any of the 305 migrations — they predate the directory. So the
 * migration set cannot be replayed onto an empty database, and there was no
 * way to build a review environment from the repo. That is what blocked
 * Files V1 review, not the Files code.
 *
 * This applies, in order:
 *   1. supabase/bootstrap/00_tenancy_bootstrap.sql  (the missing scaffold)
 *   2. the Files V1 migrations from supabase/migrations/
 *   3. supabase/bootstrap/10_seed_reviewer.sql      (only with --seed)
 *
 * Usage:
 *   node scripts/setup-review-project.mjs <project-ref>
 *   node scripts/setup-review-project.mjs <project-ref> --seed
 *
 * The token comes from SUPABASE_ACCESS_TOKEN in the environment. No database
 * password is needed: the Management API runs SQL with the access token.
 *
 * ── The production guard ───────────────────────────────────────────────────
 *
 * This refuses to run against the production ref, unconditionally and with no
 * override flag. The bootstrap creates tables that hold real rows there, and
 * the seed grants org-admin to every auth user in the project. A --force here
 * would exist only to be used by mistake at 2am, so there isn't one.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

/** Known production. Never a target. */
const PRODUCTION_REF = 'wfcebeagznzgeuyysbnt'

/** Only the Files V1 migrations — this is not a full replay of the set. */
const FILES_MIGRATIONS = [
  '20260925090100_files_tenancy_helper_drift.sql',
  '20260925090200_files_repository.sql',
]

const ref = process.argv[2]
const seed = process.argv.includes('--seed')
const token = process.env.SUPABASE_ACCESS_TOKEN

function die(msg) {
  console.error(`\n  ${msg}\n`)
  process.exit(1)
}

if (!ref) die('Usage: node scripts/setup-review-project.mjs <project-ref> [--seed]')
if (!/^[a-z]{20}$/.test(ref)) die(`"${ref}" is not a project ref (20 lowercase letters).`)
if (ref === PRODUCTION_REF) {
  die(
    'REFUSED: that is the production project.\n' +
    '  This script creates tenancy tables and grants org-admin to every user.\n' +
    '  There is deliberately no override.',
  )
}
if (!token) die('SUPABASE_ACCESS_TOKEN is not set in the environment.')

async function runSql(label, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })

  const body = await res.text()
  if (!res.ok) {
    console.error(`\n  FAILED: ${label}`)
    console.error(`  HTTP ${res.status}`)
    console.error(`  ${body.slice(0, 600)}\n`)
    process.exit(1)
  }
  console.log(`  ok   ${label}`)
}

const steps = [
  ['tenancy bootstrap', path.join(ROOT, 'supabase/bootstrap/00_tenancy_bootstrap.sql')],
  ...FILES_MIGRATIONS.map((f) => [f, path.join(ROOT, 'supabase/migrations', f)]),
]
if (seed) steps.push(['seed reviewer', path.join(ROOT, 'supabase/bootstrap/10_seed_reviewer.sql')])

// Fail before touching the database if a file is missing, rather than
// leaving a half-built schema behind.
for (const [label, file] of steps) {
  try {
    readFileSync(file, 'utf8')
  } catch {
    die(`Missing ${label}: ${path.relative(ROOT, file)}`)
  }
}

const present = new Set(readdirSync(path.join(ROOT, 'supabase/migrations')))
for (const f of FILES_MIGRATIONS) {
  if (!present.has(f)) die(`Expected Files migration not found: ${f}`)
}

console.log(`\n  Target project: ${ref}`)
console.log(`  Seeding:        ${seed ? 'yes' : 'no (pass --seed after you sign up)'}\n`)

for (const [label, file] of steps) {
  await runSql(label, readFileSync(file, 'utf8'))
}

console.log(`
  Done.

  ${seed
    ? 'Sign in and open Files.'
    : `Next:
    1. Point the app at this project and start it
    2. Sign up through the app
    3. Re-run with --seed to give yourself the org and membership`}
`)
