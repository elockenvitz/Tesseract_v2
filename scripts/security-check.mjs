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
 * ── Exit codes: "not a pass" is three different facts ──────────────────────────────────────────────
 *
 *   0  PASS         every tier that ran, ran clean, and nothing was skipped
 *   1  FAILED       a check found a problem. Something is wrong.
 *   3  UNVERIFIED   no check found a problem, but at least one could not run — absent staging
 *                   credentials, or a policy capture too stale to speak for production. NOT a pass.
 *
 * The distinction exists because the two have opposite remedies and the same colour. A reader seeing
 * red needs to know whether to fix a policy or wire a secret, and a reader seeing green must never be
 * looking at a tier that was skipped. Both 1 and 3 are red to CI; only 0 is green.
 *
 * Not yet a required branch-protection check: tier 1 is intended to go required first (once green +
 * proven non-vacuous); tiers 2/3 follow once a staging project is wired. See SECURITY-STAGING.md for
 * the exact secrets and project-security-followups for the open debt.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: false, env: { ...process.env, ...env } }).status ?? 1

// The policy guard's own exit 3: it ran, found nothing new, and refuses to claim its capture speaks
// for production. Propagated as unverified rather than collapsed into a failure.
const GUARD_EXIT_UNVERIFIED = 3

let failed = 0
const unverified = []
const section = (name) => console.log(`\n=== ${name} ===`)

/**
 * Write a line to the GitHub step summary as well as stdout.
 *
 * A job's log is read only by someone who already suspects something; the summary is on the PR. The
 * UNVERIFIED case in particular has to be visible without opening the log, because its whole failure
 * mode is being mistaken for a check that ran.
 */
const summary = (line) => {
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`) } catch { /* never fail the gate on this */ }
  }
}

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
// Exit 3 means the guard ran, found nothing new, and its capture is too stale (or too old a schema)
// to stand for production. That is not a failing policy and it is not a pass.
const guardStatus = run('node', ['scripts/unconditional-policy-guard.mjs'])
if (guardStatus === GUARD_EXIT_UNVERIFIED) {
  unverified.push('unconditional-policy guard: the committed policy capture is stale — it does not speak for production')
} else if (guardStatus) {
  failed++
}

section('tier1 static: edge-function authorization guard')
if (run('node', ['scripts/edge-authz-guard.mjs'])) failed++

/** One verdict, three outcomes, printed the same way for both entry points. */
function verdict(label) {
  console.log('')
  if (failed) {
    summary(`### ${label}: FAILED`)
    summary(`${failed} check(s) found a problem. This is a real finding, not missing infrastructure.`)
    for (const u of unverified) summary(`- also UNVERIFIED: ${u}`)
    return 1
  }
  if (unverified.length) {
    summary(`### ${label}: UNVERIFIED — not a pass`)
    summary('No check found a problem, but at least one could not actually run, so this result does')
    summary('NOT establish that production is clean:')
    for (const u of unverified) summary(`- ${u}`)
    summary('')
    summary('Treat this exactly as red. A green security gate must mean every tier ran.')
    return 3
  }
  summary(`### ${label}: PASSED`)
  return 0
}

if (staticOnly) {
  process.exit(verdict('security:check --static'))
}

// ---- TIER 2: DB STRUCTURAL LINT (tenant-boundary-lint) ----
section('tier2 db: tenant-boundary structural lint (RLS + org_id + policy on every table)')
if (ref === PROD_REF) {
  console.error('REFUSED: SECURITY_SUPABASE_REF points at PRODUCTION. The structural lint must run against staging.')
  failed++
} else if (!ref || !serviceKey) {
  // UNVERIFIED, not FAILED. No policy is broken; the tier did not run. Collapsing the two would
  // mean a wired-up staging project and a missing secret look identical in the check list, and the
  // second one is the state that quietly persists for weeks.
  console.error('UNVERIFIED: tenant-boundary-lint requires SECURITY_SUPABASE_REF + SECURITY_SUPABASE_SERVICE_KEY')
  console.error('(a NON-production project). None configured — not skipping, not passing.')
  unverified.push('tier2 tenant-boundary structural lint: no staging credentials (SECURITY_SUPABASE_REF + SECURITY_SUPABASE_SERVICE_KEY)')
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
  console.error('UNVERIFIED: DB-backed security suites require SECURITY_SUPABASE_REF + SECURITY_SUPABASE_TOKEN')
  console.error('(a non-production staging project with synthetic data). None configured — not skipping, not passing.')
  unverified.push('tier3 tenant-isolation suites: no staging credentials (SECURITY_SUPABASE_REF + SECURITY_SUPABASE_TOKEN)')
} else {
  // Positive proof of execution. A suite that ran and asserted nothing is the failure mode these
  // tiers exist to prevent, so each one must report the assertion counts the runner prints; a
  // zero-assertion run is a failure, not a pass. See scripts/security-suite.mjs.
  for (const suite of ['asset-workspace-tenant-isolation', 'platform-rls-baseline', 'tenant-boundary-p0-verify']) {
    if (run('node', ['scripts/security-suite.mjs', suite, ref], { SUPABASE_ACCESS_TOKEN: mgmtToken })) failed++
  }
}

process.exit(verdict('security:check'))
