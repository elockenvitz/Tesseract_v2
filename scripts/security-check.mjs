#!/usr/bin/env node
/**
 * security:check — the single platform security gate.
 *
 * Three tiers, by infrastructure dependency:
 *
 * TIER 1 — STATIC (source only, no DB, runs anywhere including a clean CI checkout):
 *   frontend-tenant-lint (client queries missing an org filter), unconditional-policy-guard
 *   (USING(true) / unconditional policies in the committed policy snapshot), and edge-authz-guard
 *   (every Edge Function registered + reviewed, privileged classes carry a real in-scope test).
 *   These need nothing but the repo. They are the part that can be green and required first.
 *
 * TIER 2 — DB STRUCTURAL LINT (tenant-boundary-lint): queries a live Postgres via PostgREST to
 *   assert every table has RLS + org_id + a policy. Needs SECURITY_SUPABASE_REF (a NON-prod ref;
 *   the URL is derived as https://<ref>.supabase.co) + SECURITY_SUPABASE_SERVICE_KEY.
 *
 * TIER 3 — DB ISOLATION SUITES (SQL): cross-org read/write denial + platform RLS baseline, against a
 *   project with synthetic data. Needs SECURITY_SUPABASE_REF + SECURITY_SUPABASE_TOKEN (Management API).
 *
 * FAIL-CLOSED: tiers 2 and 3 never silently skip. If their creds are absent the gate FAILS — security
 * tests that need infrastructure are never counted as passing when they did not run. Both DB tiers REFUSE
 * the production ref (they write fixtures). CI must point them at staging, never prod, never with fixture
 * writes against prod.
 *
 * Exit non-zero if any tier fails. Not yet a required branch-protection check: tier 1 is intended to go
 * required first (once green + proven non-vacuous); tiers 2/3 follow once a staging project is wired.
 * See SECURITY-STAGING.md for the exact secrets and project-security-followups for the open debt.
 */
import { spawnSync } from 'node:child_process'

const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: false, env: { ...process.env, ...env } }).status ?? 1

let failed = 0
const section = (name) => console.log(`\n=== ${name} ===`)

const PROD_REF = 'wfcebeagznzgeuyysbnt'
const ref = process.env.SECURITY_SUPABASE_REF
const serviceKey = process.env.SECURITY_SUPABASE_SERVICE_KEY
const mgmtToken = process.env.SECURITY_SUPABASE_TOKEN
// --static runs only the no-infra tier (CI can run this on every PR without staging; see SECURITY-STAGING.md).
const staticOnly = process.argv.includes('--static')

// ---- TIER 1: STATIC (no infra) ----
section('tier1 static: frontend tenant lint')
if (run('node', ['scripts/frontend-tenant-lint.mjs'])) failed++
section('tier1 static: unconditional-policy guard')
if (run('node', ['scripts/unconditional-policy-guard.mjs'])) failed++
section('tier1 static: edge-function authorization guard')
if (run('node', ['scripts/edge-authz-guard.mjs'])) failed++

if (staticOnly) {
  console.log(`\n=== security:check --static ${failed ? 'FAILED (' + failed + ' check[s])' : 'PASSED'} ===`)
  process.exit(failed ? 1 : 0)
}

// ---- TIER 2: DB STRUCTURAL LINT (tenant-boundary-lint) ----
section('tier2 db: tenant-boundary structural lint (RLS + org_id + policy on every table)')
if (ref === PROD_REF) {
  console.error('REFUSED: SECURITY_SUPABASE_REF points at PRODUCTION. The structural lint must run against staging.')
  failed++
} else if (!ref || !serviceKey) {
  console.error('FAIL-CLOSED: tenant-boundary-lint requires SECURITY_SUPABASE_REF + SECURITY_SUPABASE_SERVICE_KEY')
  console.error('(a NON-production project). None configured — not skipping.')
  failed++
} else {
  if (run('node', ['scripts/tenant-boundary-lint.mjs'], {
    SUPABASE_URL: `https://${ref}.supabase.co`,
    SUPABASE_SERVICE_KEY: serviceKey,
  })) failed++
}

// ---- TIER 3: DB ISOLATION SUITES (SQL) ----
section('tier3 db: tenant-isolation suites + platform RLS baseline')
if (ref === PROD_REF) {
  console.error('REFUSED: SECURITY_SUPABASE_REF points at PRODUCTION. These suites write fixtures; never run against prod.')
  failed++
} else if (!ref || !mgmtToken) {
  console.error('FAIL-CLOSED: DB-backed security suites require SECURITY_SUPABASE_REF + SECURITY_SUPABASE_TOKEN')
  console.error('(a non-production staging project with synthetic data). None configured — not skipping.')
  failed++
} else {
  for (const suite of ['asset-workspace-tenant-isolation', 'platform-rls-baseline']) {
    if (run('node', ['scripts/security-suite.mjs', suite, ref], { SUPABASE_ACCESS_TOKEN: mgmtToken })) failed++
  }
}

console.log(`\n=== security:check ${failed ? 'FAILED (' + failed + ' tier[s]/suite[s])' : 'PASSED'} ===`)
process.exit(failed ? 1 : 0)
