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
import { fileURLToPath } from 'node:url'

const FILE = '.github/workflows/ci.yml'

/** Job KEYS that must exist. Update deliberately, never to make CI pass. */
const EXPECTED_JOBS = ['typecheck-cards', 'test', 'invite', 'layout', 'notify-red-main']

/**
 * The commands each required job has to actually run.
 *
 * ── Why a job's existence is not enough ───────────────────────────────────
 *
 * Everything above this checks that the jobs exist, that their `needs:`
 * resolve, and that their display names still match what branch protection
 * requires. None of it looks at what they DO. Delete the `npm run guard:types`
 * step from `typecheck-cards` and the job still exists, still has the right
 * name, still reports "Type check (cards) — success" on every PR, and checks
 * nothing at all.
 *
 * That is the same vacuous gate this file was written to catch, one layer in:
 * the repo-wide `Type check` job that exited 0 without reading a file. The
 * difference is only that this version would be introduced by a deletion
 * rather than by a misconfiguration.
 *
 * Matched as substrings against the parsed `run:` text, so extra flags are
 * fine and a comment mentioning the command is not (comments are not steps).
 */
const REQUIRED_GUARD_STEPS = {
  'typecheck-cards': ['npm run guard:ci', 'npm run guard:types'],
  test: ['--project unit'],
  invite: ['npm run guard:invite'],
  layout: ['npm run guard:tdz', 'npm run guard:gallery', 'npm run guard:layout'],
}

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

/**
 * Whether a workflow's failure notifier will keep telling someone.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `ingest.yml`'s notifier read `if (existing.data.length === 0) { issues
 * .create(...) }`. The intent was "do not open a hundred duplicate issues";
 * the effect was that once the first failure had opened an issue, every later
 * failure did nothing. Issue #248 opened on 2026-10-06 and 24 further nightly
 * failures passed in silence, which is how a market-data outage ran for 35
 * days inside a product whose prices were visibly wrong.
 *
 * The dedupe was applied to the NOTIFICATION rather than to the issue. One
 * issue is right; one notification is not.
 *
 * Pure, and takes `[path, parsedWorkflow]` pairs, so it can be tested against
 * fixtures rather than only against the two real files.
 *
 * @param {Array<[string, any]>} entries
 * @returns {string[]} one problem per line, empty when every notifier is sound
 */
export function auditFailureNotifiers(entries) {
  const problems = []
  const scriptBodies = (d) =>
    Object.values(d?.jobs ?? {})
      .flatMap(j => j?.steps ?? [])
      .map(st => st?.with?.script)
      .filter(s => typeof s === 'string')
      .join('\n')

  for (const [wf, parsed] of entries ?? []) {
    const bodies = scriptBodies(parsed)
    if (!bodies.trim()) {
      problems.push(`${wf} has no failure-notification script at all.`)
      continue
    }
    if (!/alert-on-failure\.cjs/.test(bodies)) {
      problems.push(`${wf}'s notifier does not route through .github/scripts/alert-on-failure.cjs.`)
    }
    /*
     * The literal shape of the bug, and the two near-spellings of it. A
     * notifier that creates an issue only when none exists is the defect
     * whatever the comparison is written as.
     */
    if (/\.length\s*===\s*0|\.length\s*<\s*1|!\s*existing\.data\.length/.test(bodies)) {
      problems.push(
        `${wf}'s notifier skips the notification when an issue already exists. ` +
        'That is the bug that kept 24 ingestion failures silent.',
      )
    }
  }
  return problems
}

/**
 * Every structural claim this file makes about a workflow, as one pure
 * function so it can be tested against fixture workflows rather than only
 * against the real one.
 */
export function auditCiJobs(jobs) {
  const keys = Object.keys(jobs ?? {})
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

  /**
   * Every required job must still run its guards, and must still be allowed to
   * fail the workflow when one of them fails.
   *
   * `continue-on-error: true` is checked because it does exactly what this whole
   * file exists to prevent: the step goes red, the job goes green, and the
   * required status check reports success over a guard that failed.
   */
  for (const [jobKey, required] of Object.entries(REQUIRED_GUARD_STEPS)) {
    const job = jobs[jobKey]
    if (!job) continue // already reported as a missing job above

    const steps = Array.isArray(job.steps) ? job.steps : []
    const runs = steps.map(s => s?.run).filter(r => typeof r === 'string')

    for (const command of required) {
      if (!runs.some(r => r.includes(command))) {
        problems.push(
          `job "${jobKey}" no longer runs \`${command}\` — the check would report ` +
          `success without doing its work`,
        )
      }
    }

    if (job['continue-on-error'] === true) {
      problems.push(`job "${jobKey}" sets continue-on-error, so a guard failure would report green`)
    }
    for (const step of steps) {
      const run = typeof step?.run === 'string' ? step.run : ''
      if (step?.['continue-on-error'] === true && required.some(c => run.includes(c))) {
        problems.push(
          `job "${jobKey}" runs \`${run.trim().slice(0, 60)}\` with continue-on-error — ` +
          `its failure would be swallowed`,
        )
      }
    }
  }


  return problems
}

/** The script itself. Split from the audit above so a test can import it. */
export function main() {
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

  const problems = auditCiJobs(jobs)

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

  /**
   * The freshness watchdog, checked the same way and for a sharper reason.
   *
   * This is the workflow that would have caught the 35-day market-data
   * outage, and it exists precisely because a check inside `ingest.yml`
   * cannot report that `ingest.yml` died. A watchdog that silently stops
   * running leaves the product in exactly the state it was in before the
   * watchdog existed, and GitHub reports a broken workflow file as a run with
   * ZERO jobs rather than as an error -- so the Actions tab looks quiet
   * rather than red. Hence parse it, not grep it.
   */
  const FRESH = '.github/workflows/market-data-freshness.yml'
  if (!existsSync(FRESH)) {
    console.error(`FAIL: ${FRESH} is missing — nothing would notice stale market data.`)
    process.exit(1)
  }
  let fresh
  try {
    fresh = parse(readFileSync(FRESH, 'utf8'))
  } catch (e) {
    console.error(`FAIL: ${FRESH} is not parseable YAML — GitHub reports zero jobs, not an error.`)
    console.error(String(e.message ?? e))
    process.exit(1)
  }
  const freshTriggers = fresh?.on ?? fresh?.[true]
  const freshCrons = (freshTriggers?.schedule ?? []).map(s => s?.cron).filter(Boolean)
  const freshJobs = Object.keys(fresh?.jobs ?? {})
  console.log(`freshness jobs: ${freshJobs.length} -> ${freshJobs.join(', ')}`)
  console.log(`freshness schedule: ${freshCrons.join(' | ') || 'NONE'}`)
  if (!freshCrons.length) {
    console.error(`FAIL: ${FRESH} declares no schedule, so it would only ever run by hand.`)
    process.exit(1)
  }
  for (const want of ['freshness', 'notify-failure']) {
    if (!freshJobs.includes(want)) {
      console.error(`FAIL: ${FRESH} is missing the "${want}" job.`)
      process.exit(1)
    }
  }

  /*
   * The watchdog must run its own self-test.
   *
   * `--self-test` re-runs every assertion against thresholds nothing can meet
   * and fails if any stays quiet. Without it the workflow could pass forever
   * on a check that had stopped measuring anything, which is the defect class
   * this whole file exists to catch.
   */
  const freshRuns = runCommands(fresh).join('\n')
  if (!/check-market-data-freshness\.mjs/.test(freshRuns)) {
    console.error(`FAIL: ${FRESH} never runs scripts/check-market-data-freshness.mjs.`)
    process.exit(1)
  }
  if (!/--self-test/.test(freshRuns)) {
    console.error(`FAIL: ${FRESH} runs the freshness check without --self-test.`)
    console.error('A check that cannot observe its own failure mode is decoration.')
    process.exit(1)
  }

  /**
   * The notifier must not dedupe the NOTIFICATION.
   *
   * `ingest.yml` carried `if (existing.data.length === 0) { issues.create }`,
   * so after the first failure opened issue #248 on 2026-10-06, 24 further
   * nightly failures said nothing at all. One issue is right; one
   * notification is not. Both notifiers go through
   * `.github/scripts/alert-on-failure.cjs`, which comments on the existing
   * issue, and this asserts neither has drifted back to the old shape.
   */
  const ALERT = '.github/scripts/alert-on-failure.cjs'
  if (!existsSync(ALERT)) {
    console.error(`FAIL: ${ALERT} is missing — the failure notifiers have nothing to call.`)
    process.exit(1)
  }
  const notifierProblems = auditFailureNotifiers([[INGEST, ingest], [FRESH, fresh]])
  if (notifierProblems.length) {
    for (const p of notifierProblems) console.error(`FAIL: ${p}`)
    console.error('')
    console.error('One ISSUE per subject is right; one NOTIFICATION is not. Comment on')
    console.error('the existing issue instead of skipping the notification.')
    process.exit(1)
  }
  console.log(`failure notifiers routed through ${ALERT}: ${[INGEST, FRESH].length}`)

  console.log('PASS')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
