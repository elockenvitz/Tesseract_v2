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
import { existsSync, readFileSync } from 'node:fs'
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
// NOTE: 'Invite entry' gates the only route into the product, so it belongs
// here with the rest. Adding it to this list makes a rename fail the guard; it
// does NOT by itself make the check blocking — that is a branch-protection
// setting in repository settings, and it has to be added there too.
const REQUIRED_CHECK_NAMES = [
  'Type check (cards)',
  'Unit tests',
  'Invite entry',
  'Card layout',
]

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

/**
 * The ingestion schedule, checked for the same reason ci.yml is.
 *
 * A workflow that silently stops running is indistinguishable from one that
 * works: `price_history_cache` simply stops gaining rows, and
 * `buildWeightSeries` starts skipping days for want of a close — which it
 * reports honestly, so the symptom surfaces as "the chart has holes" rather
 * than as a failed job.
 *
 * Unparseable YAML is the specific failure this catches. GitHub reports a
 * broken workflow file as a run with ZERO jobs rather than as an error, so the
 * Actions tab looks quiet rather than red.
 */
const INGEST = '.github/workflows/ingest.yml'
if (!existsSync(INGEST)) {
  console.error(`FAIL: ${INGEST} is missing — nightly ingestion would never run.`)
  process.exit(1)
}
let ingest
try {
  ingest = parse(readFileSync(INGEST, 'utf8'))
} catch (e) {
  console.error(`FAIL: ${INGEST} is not parseable YAML — GitHub reports zero jobs, not an error.`)
  console.error(String(e.message ?? e))
  process.exit(1)
}
// `on:` parses as the boolean true in YAML 1.1, which is why this checks both.
const triggers = ingest?.on ?? ingest?.[true]
const crons = (triggers?.schedule ?? []).map(s => s?.cron).filter(Boolean)
const ingestJobs = Object.keys(ingest?.jobs ?? {})
console.log(`ingest jobs: ${ingestJobs.length} -> ${ingestJobs.join(', ')}`)
console.log(`ingest schedule: ${crons.join(' | ') || 'NONE'}`)

if (!crons.length) {
  console.error(`FAIL: ${INGEST} declares no schedule. Nightly ingestion would only ever run by hand.`)
  process.exit(1)
}
for (const want of ['prices', 'benchmark', 'reconcile']) {
  if (!ingestJobs.includes(want)) {
    console.error(`FAIL: ${INGEST} is missing the "${want}" job.`)
    process.exit(1)
  }
}

/**
 * Checked against the PARSED steps, not the file text.
 *
 * The first version grepped the raw source, which would have fired on the
 * prose explaining the rule — the comment describing `npm ci` would have
 * failed the `npm ci` check. Only what a runner actually executes counts.
 *
 * (It also never fired at all: the pattern was written with a literal
 * backspace byte where a word boundary was intended, so it matched nothing and
 * reported PASS. A guard that cannot fail is the defect class this whole file
 * exists to catch, arriving inside the file itself.)
 */
const runCommands = (d) =>
  Object.values(d?.jobs ?? {})
    .flatMap(j => j?.steps ?? [])
    .map(st => st?.run)
    .filter(r => typeof r === 'string')

for (const [wf, parsed] of [[FILE, doc], [INGEST, ingest]]) {
  const offenders = runCommands(parsed).filter(r => /(^|\s|&&|;)npm ci(\s|$)/.test(r))
  if (offenders.length) {
    console.error(`FAIL: ${wf} runs \`npm ci\`, which cannot work in this repo.`)
    offenders.forEach(o => console.error(`  ${o.trim().slice(0, 80)}`))
    console.error('The dependency tree has peer conflicts, so the lockfile is not a')
    console.error('valid `npm ci` input. Use:')
    console.error('  npm install --legacy-peer-deps --no-audit --no-fund --no-progress')
    process.exit(1)
  }
}


// A failure nobody is told about is the same as no job at all.
if (!ingestJobs.includes('notify-failure')) {
  console.error(`FAIL: ${INGEST} has no failure notification. A silent nightly job looks identical to a working one.`)
  process.exit(1)
}
console.log('PASS')
