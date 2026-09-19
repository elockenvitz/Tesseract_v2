#!/usr/bin/env node
/**
 * The unit-test gate.
 *
 * ── What this replaced, and why ───────────────────────────────────────────
 *
 * `guard:unit` was a bare `vitest run --project unit` with seventeen paths
 * after it. Vitest exits non-zero honestly when a test fails, when a file
 * fails to collect, when an import is missing and when a file has a syntax
 * error — all four were verified — so the runner was never the weak part.
 *
 * The weak part was the scope. Those seventeen paths are substring FILTERS,
 * and vitest only complains when the entire filter set matches nothing. Any
 * proper subset of them can match nothing at all:
 *
 *     vitest run --project unit src/lib/brand src/lib/definitely-not-here
 *     -> 2 passed (2), exit 0
 *
 * So the suite could shrink by a directory — 43 test files, in one case — and
 * report the same green summary it always had. Nothing compared what ran
 * against what exists. That is the same shape as the type gate's failure:
 * a check that gets quieter is indistinguishable from a check that is clean.
 *
 * This wrapper adds the three assertions the command could not make:
 *
 *   1. every registered directory still exists and still holds tests
 *   2. the runner completed — exit status, no signal, a parseable report
 *   3. every test file found on disk appears in that report as executed
 *
 * (3) is recomputed from the working tree on every run. There is no pinned
 * count to go stale, and adding or deleting a test needs no edit here.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyChildOutcome, requireCompleted } from './lib/guard-process.mjs'
import {
  GATED_DIRS, DEFERRED_DIRS, resolveScope, scopeProblems, assessUnitReport,
  allTestFiles, classifyTestFiles, unclassifiedProblems, staleDeferredDirs,
} from './lib/unit-scope.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT_MS = Number(process.env.GUARD_UNIT_TIMEOUT_MS ?? 15 * 60 * 1000)

// ── 1. Is the scope still there, and is all of it accounted for? ─────────
const { perDir, files } = resolveScope(ROOT, GATED_DIRS)
const onDisk = allTestFiles(ROOT)
const split = classifyTestFiles({ all: onDisk, gatedFiles: files, deferredDirs: DEFERRED_DIRS })

console.log(`gated directories: ${GATED_DIRS.length}`)
console.log(`deferred directories: ${DEFERRED_DIRS.length}`)
console.log(`test files on disk: ${onDisk.length}`)
console.log(`test files gated: ${split.gated.length}`)
console.log(`test files deferred: ${split.deferred.length}`)

const scopeIssues = [
  ...scopeProblems(perDir),
  ...unclassifiedProblems(split.unclassified),
  ...(split.lost.length
    ? [
        `${split.lost.length} gated file(s) were not found by the whole-tree walk, ` +
          `so the two scans of src disagree:`,
        ...split.lost.slice(0, 10).map((f) => '    ' + f),
      ]
    : []),
]

// Not a failure: a deferred entry that has emptied costs no coverage, it just
// makes the list less honest than it looks.
const stale = staleDeferredDirs(ROOT, DEFERRED_DIRS)
if (stale.length) {
  console.log(`note: ${stale.length} deferred director(y/ies) no longer hold tests: ${stale.join(', ')}`)
}

if (scopeIssues.length) {
  console.error('FAIL: the gated scope does not account for what is on disk:')
  scopeIssues.forEach((p) => console.error('  ' + p))
  console.error('')
  console.error('Vitest treats these paths as substring filters and ignores the ones that')
  console.error('match nothing, so this would otherwise have run a smaller suite and passed.')
  process.exit(1)
}

// ── 2. Run it, keeping every completion signal ────────────────────────────
const reportDir = mkdtempSync(path.join(tmpdir(), 'tesseract-guard-unit-'))
const reportPath = path.join(reportDir, 'unit-report.json')

const args = [
  'vitest',
  'run',
  '--project',
  'unit',
  ...GATED_DIRS,
  '--reporter=default',
  '--reporter=json',
  `--outputFile.json=${reportPath}`,
]

const child = spawnSync('npx', args, {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'inherit', 'pipe'],
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32',
  timeout: TIMEOUT_MS,
  env: { ...process.env, CI: process.env.CI ?? 'true' },
})

const finish = (code) => {
  try {
    rmSync(reportDir, { recursive: true, force: true })
  } catch {
    /* a leftover temp directory is not worth failing over */
  }
  process.exit(code)
}

/**
 * Only 0 is a completion here.
 *
 * Unlike tsc, vitest has no "ran fine, found problems" exit code that this gate
 * tolerates: a failing test IS a guard failure. Reading the report before the
 * status would invert that, so the status is read first.
 */
const outcome = classifyChildOutcome({
  status: child.status,
  signal: child.signal,
  error: child.error,
  // Vitest writes progress to stderr on some terminals, so stderr is reported
  // rather than treated as a crash; the exit status is the signal that counts.
  stderr: '',
  allowedExitCodes: [0],
  label: 'vitest',
})

if (!outcome.ok) {
  if (child.stderr) process.stderr.write(child.stderr)
  console.error(`FAIL: ${outcome.reason}`)
  console.error('A guard cannot report PASS on a verification that did not complete.')
  console.error(`  command: npx ${args.join(' ')}`)
  console.error(`  timeout: ${TIMEOUT_MS}ms`)
  finish(1)
}

// ── 3. Did it run everything it was supposed to? ──────────────────────────
let report = null
if (existsSync(reportPath)) {
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (e) {
    console.error(`FAIL: the runner's JSON report is not parseable — it did not finish cleanly.`)
    console.error('  ' + String(e.message ?? e))
    finish(1)
  }
} else {
  console.error(`FAIL: the runner produced no JSON report at ${reportPath}.`)
  console.error('An exit status of 0 with no report means the run did not complete.')
  finish(1)
}

const problems = assessUnitReport({ expectedFiles: files, report })

console.log(`test files executed: ${(report.testResults ?? []).length}`)
console.log(`tests executed: ${report.numTotalTests ?? 'unknown'}`)

if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s) with the unit run:`)
  problems.forEach((p) => console.error('  ' + p))
  finish(1)
}

console.log('PASS')
finish(0)
