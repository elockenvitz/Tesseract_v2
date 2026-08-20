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
 */
import { execFileSync } from 'node:child_process'

const MIN_FILES = 40      // 50 today. A collapse to 0 means the linter didn't run.
const MAX_VIOLATIONS = 0  // May only decrease.

let raw
try {
  raw = execFileSync('npx', ['eslint', 'src/components/mobile', 'src/components/signals', '--ext', '.ts,.tsx', '-f', 'json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
} catch (e) {
  // eslint exits non-zero when it finds errors; that is not a failure to run.
  raw = e.stdout ?? ''
}

let report
try {
  report = JSON.parse(raw)
} catch {
  console.error('FAIL: eslint produced no parseable JSON — it did not run.')
  console.error(raw.slice(0, 500))
  process.exit(1)
}

const files = report.length
const pick = (test) => report.flatMap(f =>
  f.messages.filter(m => test(m.ruleId ?? '')).map(m => `${f.filePath}:${m.line} ${m.message}`))

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

console.log(`files linted: ${files}`)
console.log(`use-before-define violations: ${violations.length}`)
console.log(`conditional-hook violations: ${hookOrder.length}`)

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
