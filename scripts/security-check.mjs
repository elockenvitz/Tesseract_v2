#!/usr/bin/env node
/**
 * security:check — the single platform security gate.
 *
 * STATIC layer (always runs, no DB): the tenant-boundary + frontend-tenant lints and the unconditional-policy
 * guard. These scan source and fail on new unsafe patterns (missing org filters, USING(true) policies in migrations).
 *
 * DB layer (fail-closed): the SQL isolation suites + the platform RLS baseline. These require a database with
 * synthetic data. They run only when SECURITY_SUPABASE_REF + SECURITY_SUPABASE_TOKEN point at a NON-production
 * project (staging/synthetic). If those are set they MUST pass. If they are NOT set, this gate FAILS CLOSED:
 * security tests that need infrastructure are never silently skipped. CI must provide a staging project (never
 * production credentials, never fixture writes against prod).
 *
 * Exit non-zero if any layer fails. Intended as a required GitHub Actions check once staging is wired and the
 * existing tenant-lint debt is reconciled (see SECURITY-REGISTER / project-security-followups).
 */
import { spawnSync } from 'node:child_process'

const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: false, env: { ...process.env, ...env } }).status ?? 1

let failed = 0
const section = (name) => console.log(`\n=== ${name} ===`)

// ---- STATIC layer ----
section('static: tenant-boundary lint')
if (run('node', ['scripts/tenant-boundary-lint.mjs'])) failed++
section('static: frontend tenant lint')
if (run('node', ['scripts/frontend-tenant-lint.mjs'])) failed++
section('static: unconditional-policy guard')
if (run('node', ['scripts/unconditional-policy-guard.mjs'])) failed++

// ---- DB layer (fail-closed) ----
const ref = process.env.SECURITY_SUPABASE_REF
const token = process.env.SECURITY_SUPABASE_TOKEN
const PROD_REF = 'wfcebeagznzgeuyysbnt'
section('db: tenant-isolation suites + platform RLS baseline')
if (!ref || !token) {
  console.error('FAIL-CLOSED: DB-backed security suites require SECURITY_SUPABASE_REF + SECURITY_SUPABASE_TOKEN')
  console.error('(a non-production staging project with synthetic data). None configured — not skipping.')
  failed++
} else if (ref === PROD_REF) {
  console.error('REFUSED: SECURITY_SUPABASE_REF points at PRODUCTION. These suites write fixtures; never run against prod.')
  failed++
} else {
  for (const suite of ['asset-workspace-tenant-isolation', 'platform-rls-baseline']) {
    if (run('node', ['scripts/security-suite.mjs', suite, ref], { SUPABASE_ACCESS_TOKEN: token })) failed++
  }
}

console.log(`\n=== security:check ${failed ? 'FAILED (' + failed + ' layer[s])' : 'PASSED'} ===`)
process.exit(failed ? 1 : 0)
