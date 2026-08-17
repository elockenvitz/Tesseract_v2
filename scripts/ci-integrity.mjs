#!/usr/bin/env node
/**
 * Guards the CI workflow against being silently broken.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Deleting a job left `needs: [typecheck, test]` pointing at a job that no
 * longer existed. That makes the whole workflow unparseable to GitHub, which
 * reports it as a run *named after the file path* with **zero jobs** and a
 * failure conclusion — not as a job failure. Nothing appears in the PR check
 * list to explain it, and the required checks simply never report, so the PR
 * hangs looking pending rather than failing.
 *
 * That is the vacuous-gate shape one layer up: broken and passing look alike
 * from the outside. The checks did not run, and nothing said so.
 *
 * This runs inside the workflow, so if it is reachable at all the workflow
 * parsed — and it then asserts that the job set is the one we expect, that
 * every `needs:` resolves, and that the display names branch protection
 * requires still exist. A rename that would orphan a required status check
 * fails here instead of hanging a PR.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const FILE = '.github/workflows/ci.yml'

/** Job KEYS that must exist. Update deliberately, never to make CI pass. */
const EXPECTED_JOBS = ['typecheck-cards', 'test', 'layout', 'notify-red-main']

/**
 * Display NAMES that branch protection requires as status checks.
 *
 * These are matched exactly. GitHub matches required checks on the display
 * name, so renaming a job silently orphans its required context and every
 * subsequent PR waits forever on a check that will never report.
 */
const REQUIRED_CHECK_NAMES = ['Type check (cards)', 'Unit tests', 'Card layout']

let doc
try {
  doc = parse(readFileSync(FILE, 'utf8'))
} catch (e) {
  console.error(`FAIL: ${FILE} is not parseable YAML — GitHub would report a run with zero jobs.`)
  console.error(String(e).slice(0, 400))
  process.exit(1)
}

const jobs = doc?.jobs
if (!jobs || typeof jobs !== 'object') {
  console.error(`FAIL: ${FILE} declares no jobs.`)
  process.exit(1)
}

const keys = Object.keys(jobs)
console.log(`jobs found: ${keys.length} -> ${keys.join(', ')}`)

const problems = []

for (const want of EXPECTED_JOBS) {
  if (!keys.includes(want)) problems.push(`expected job "${want}" is missing`)
}

// Every needs: target must resolve. This is the exact defect that broke the
// workflow — a reference to a deleted job.
for (const [key, job] of Object.entries(jobs)) {
  const needs = job?.needs == null ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]
  for (const dep of needs) {
    if (!keys.includes(dep)) {
      problems.push(`job "${key}" needs "${dep}", which does not exist`)
    }
  }
}

const names = keys.map(k => jobs[k]?.name).filter(Boolean)
for (const required of REQUIRED_CHECK_NAMES) {
  if (!names.includes(required)) {
    problems.push(
      `no job is named "${required}", but branch protection requires it — ` +
      `every PR would wait forever on a check that never reports`,
    )
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} CI integrity problem(s):`)
  problems.forEach(p => console.error('  - ' + p))
  process.exit(1)
}

console.log(`required check names present: ${REQUIRED_CHECK_NAMES.join(' | ')}`)
console.log('PASS')
