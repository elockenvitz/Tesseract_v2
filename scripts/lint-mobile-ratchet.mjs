#!/usr/bin/env node
/**
 * Temporal-dead-zone ratchet for src/components/mobile.
 *
 * Asserts POSITIVE PROOF OF WORK, not an exit code. `eslint` exiting 0 because
 * its config threw a SyntaxError is indistinguishable from `eslint` exiting 0
 * because the code is clean — that happened in this repo on 2026-08-16, and
 * the zero was reported as "no violations". So this reads the JSON formatter's
 * output, requires that a plausible number of files were actually linted, and
 * only then compares the violation count.
 *
 * ── The hole that survived that fix ───────────────────────────────────────
 *
 * Counting linted files proves eslint ran. It does not prove eslint could READ
 * what it ran on. When a file will not parse, eslint still reports it — as a
 * file, with `errorCount: 1` and a message shaped like this:
 *
 *     { ruleId: null, fatal: true, severity: 2,
 *       message: "Parsing error: Identifier expected." }
 *
 * `ruleId` is null, because no rule ran: there was no syntax tree to run one
 * against. Both selectors below match on rule id, so a fatal parse error
 * matched neither, counted toward the file total, and pushed the violation
 * counts DOWN — a file that cannot be parsed cannot violate anything.
 *
 * Verified by dropping one unparseable .tsx into src/components/mobile:
 *
 *     files linted: 140
 *     use-before-define violations: 0
 *     conditional-hook violations: 0
 *     PASS
 *
 * Same failure as the type gate on the same day: the checker went quiet and
 * the guard read quiet as clean. Fatal messages are now their own hard
 * failure, ahead of both ratchets.
 */
import { spawnSync } from 'node:child_process'
import { classifyChildOutcome, requireCompleted } from './lib/guard-process.mjs'
import { fatalMessages, messagesByRule, filesLinted } from './lib/eslint-report.mjs'

const MIN_FILES = 40      // 140 today. A collapse to 0 means the linter didn't run.
const MAX_VIOLATIONS = 0  // May only decrease.

/**
 * eslint's documented exit codes: 0 clean, 1 lint errors found. 2 means eslint
 * itself failed — a bad config, an unreadable option — and is not a result.
 */
const ESLINT_COMPLETION_CODES = [0, 1]
const TIMEOUT_MS = Number(process.env.GUARD_TDZ_TIMEOUT_MS ?? 10 * 60 * 1000)

const args = [
  'eslint', 'src/components/mobile', 'src/components/signals',
  '--ext', '.ts,.tsx', '-f', 'json',
]

const child = spawnSync('npx', args, {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32',
  timeout: TIMEOUT_MS,
})

requireCompleted(
  classifyChildOutcome({
    status: child.status,
    signal: child.signal,
    error: child.error,
    // eslint uses stderr for deprecation notices that say nothing about the
    // run's validity. The exit status and the JSON below carry that.
    stderr: '',
    allowedExitCodes: ESLINT_COMPLETION_CODES,
    label: 'eslint',
  }),
  [`command: npx ${args.join(' ')}`, ...(child.stderr ? [`stderr: ${child.stderr.slice(0, 400)}`] : [])],
)

let report
try {
  report = JSON.parse(child.stdout ?? '')
} catch {
  console.error('FAIL: eslint produced no parseable JSON — it did not run.')
  console.error(String(child.stdout ?? '').slice(0, 500))
  if (child.stderr) console.error(child.stderr.slice(0, 500))
  process.exit(1)
}
if (!Array.isArray(report)) {
  console.error('FAIL: eslint’s JSON output is not a report array — it did not run.')
  process.exit(1)
}

const files = filesLinted(report)
const pick = (test) => messagesByRule(report, test)

/**
 * Files eslint could not parse.
 *
 * Checked before anything else, because every count below is computed from
 * files eslint understood, and this names the ones it did not.
 */
const fatal = fatalMessages(report)

const violations = pick(id => id.endsWith('no-use-before-define'))

/**
 * Conditional hooks, gated at zero.
 *
 * `CardCarousel` declared two refs after `if (panes.length === 1) return ...`,
 * so a card rendered two hooks on one pass and four on the next — and a pane
 * count does change between passes, because price history arrives and adds a
 * chart pane. React threw #310 and every logged-in reader got the error
 * boundary on a hard refresh.
 *
 * Separate from the ratchet above because this has no backlog to work down: it
 * is a correctness rule and the count is zero today. `exhaustive-deps` is NOT
 * included — it is advisory, has eight standing violations, and folding the two
 * together would mean either allowlisting a crash class or blocking on style.
 */
const hookOrder = pick(id => id === 'react-hooks/rules-of-hooks')

console.log(`eslint exit status: ${child.status}`)
console.log(`files linted: ${files}`)
console.log(`unparseable files: ${fatal.length}`)
console.log(`use-before-define violations: ${violations.length}`)
console.log(`conditional-hook violations: ${hookOrder.length}`)

if (fatal.length > 0) {
  console.error(`FAIL: ${fatal.length} file(s) could not be parsed:`)
  fatal.forEach(v => console.error('  ' + v))
  console.error('')
  console.error('No rule ran against these files, so the violation counts below are')
  console.error('lower than the truth rather than better than it.')
  process.exit(1)
}

if (hookOrder.length > 0) {
  console.error(`FAIL: ${hookOrder.length} hooks called conditionally:`)
  hookOrder.forEach(v => console.error('  ' + v))
  process.exit(1)
}

if (files < MIN_FILES) {
  console.error(`FAIL: only ${files} files linted, expected at least ${MIN_FILES}. The linter did not do its work.`)
  process.exit(1)
}
if (violations.length > MAX_VIOLATIONS) {
  console.error(`FAIL: ${violations.length} violations, ceiling is ${MAX_VIOLATIONS}:`)
  violations.forEach(v => console.error('  ' + v))
  process.exit(1)
}
console.log('PASS')
