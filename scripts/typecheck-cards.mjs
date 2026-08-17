#!/usr/bin/env node
/**
 * Scoped type-check gate for the signal-card surface.
 *
 * The repo-wide `Type check` job runs `tsc --noEmit` against a solution-style
 * tsconfig with `"files": []` and project references. That does NOT build the
 * referenced projects: it exits 0 unconditionally, and a deliberately injected
 * type error produced exit 0. It has never checked a file.
 *
 * The correct invocation reports thousands of errors repo-wide, so it cannot be
 * turned on wholesale without a re-baseline. The card surface is already at
 * zero, so it can be gated today — and would have caught the `evidence` prop
 * that SignalCardSection was passed and never declared.
 *
 * Asserts positive proof of work: a count of files tsc actually loaded, so a
 * misconfigured invocation that checks nothing fails instead of passing.
 */
import { execFileSync } from 'node:child_process'

const PATHS = [
  'src/lib/signals',
  'src/components/signals',
  'src/hooks/mobile/useScenarioCards',
  'src/hooks/mobile/useRecommendationCards',
  'src/components/mobile/SignalCardSection',
  'src/components/mobile/MobileDashboard',
  'src/components/mobile/PortfolioLensTile',
  'src/components/mobile/DerivedInsightTile',
  'src/components/mobile/TemplateFeedTile',
  'src/components/mobile/NewsFeedTile',
  'src/components/mobile/AttentionFeedCard',
  'src/lib/mobile/feed-templates',
]
const MAX_ERRORS = 0
/** ~1,900 files in the app project today. A collapse means tsc did not run. */
const MIN_FILES = 800

const run = (args) => {
  try {
    return execFileSync('npx', args, {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      shell: process.platform === 'win32',
    })
  } catch (e) {
    // tsc exits non-zero when it finds errors; that is not a failure to run.
    return e.stdout ?? ''
  }
}

const filesChecked = run(['tsc', '-p', 'tsconfig.app.json', '--noEmit', '--listFilesOnly'])
  .split('\n')
  .filter((l) => l.trim())
  .length

console.log(`files loaded by tsc: ${filesChecked}`)
if (filesChecked < MIN_FILES) {
  console.error(`FAIL: tsc listed only ${filesChecked} files, expected at least ${MIN_FILES}. It did not run.`)
  process.exit(1)
}

const out = run(['tsc', '-p', 'tsconfig.app.json', '--noEmit'])
const all = out.split('\n').filter((l) => /error TS\d+/.test(l))

// Windows tsc emits forward slashes here, but normalise anyway rather than
// depending on it — a separator mismatch would silently scope to nothing and
// report a clean pass, which is the failure mode this whole gate exists for.
const norm = (l) => l.split('\\').join('/')
const scoped = all.filter((l) => PATHS.some((p) => norm(l).startsWith(p)))

console.log(`repo-wide errors: ${all.length}  (reported, not gated)`)
console.log(`card-surface errors: ${scoped.length}`)

if (scoped.length > MAX_ERRORS) {
  console.error(`FAIL: ${scoped.length} type errors on the card surface, ceiling is ${MAX_ERRORS}:`)
  scoped.slice(0, 40).forEach((l) => console.error('  ' + l))
  process.exit(1)
}
console.log('PASS')
