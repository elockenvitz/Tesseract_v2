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
  raw = execFileSync('npx', ['eslint', 'src/components/mobile', '--ext', '.ts,.tsx', '-f', 'json'],
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
const violations = report.flatMap(f =>
  f.messages
    .filter(m => (m.ruleId ?? '').endsWith('no-use-before-define'))
    .map(m => `${f.filePath}:${m.line} ${m.message}`))

console.log(`files linted: ${files}`)
console.log(`use-before-define violations: ${violations.length}`)

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
