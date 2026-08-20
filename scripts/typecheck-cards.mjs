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
 *
 * ── Which command guarantees what ─────────────────────────────────────────
 *
 * This note exists because the trap above caught somebody a second time: a
 * phase report claimed "typecheck clean" after running a command that checks no
 * files. It was documented here and nowhere a person would look first, so the
 * scripts are now named for what they do.
 *
 *   npm run typecheck       tsc -p tsconfig.app.json --noEmit
 *                           Checks the whole application. Reports the ~8.8k
 *                           historical backlog and is NOT a gate. Use it to see
 *                           whether the file you touched is clean.
 *
 *   npm run typecheck:all   tsc -b
 *                           Builds every referenced project, app and node.
 *                           Slowest, widest, also not a gate.
 *
 *   npm run guard:types     this script
 *                           The GATE. Card surface only, ceiling of zero
 *                           errors, plus a floor on how many files tsc loaded.
 *
 *   npx tsc --noEmit        Checks NOTHING. The root config is solution-style
 *                           with "files": [], so this exits 0 whatever the code
 *                           says. Never use it and never quote it as evidence.
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

/**
 * One compile, not two.
 *
 * This ran `--listFilesOnly` for the proof-of-work count and then a second full
 * check for the diagnostics. `--listFiles` emits both from one pass. Measured
 * at 102s for the pair and 96s for the one — the saving is modest, because the
 * checking is what costs and the listing is nearly free, but a redundant full
 * compile is still a redundant full compile.
 *
 * ── --fast ────────────────────────────────────────────────────────────────
 *
 * With `--fast` the compile is incremental against a build-info file cached
 * under node_modules. Cold that is the same ~96s; warm it is ~10s, which is the
 * difference between a type check you run while iterating and one you skip.
 *
 * Deliberately opt-in, and deliberately NOT what `guard:types` uses. A gate
 * should do the same work every time regardless of what happens to be cached,
 * and in CI there is no cache to hit. `guard:quick` opts in; the gate does not.
 */
const FAST = process.argv.includes('--fast')
const args = ['tsc', '-p', 'tsconfig.app.json', '--noEmit', '--listFiles']
if (FAST) {
  args.push('--incremental', '--tsBuildInfoFile', 'node_modules/.cache/tsc-cards.tsbuildinfo')
}

const out = run(args)
const lines = out.split('\n')
const all = lines.filter((l) => /error TS\d+/.test(l))
// Everything that is not a diagnostic is a path tsc loaded.
const filesChecked = lines.filter((l) => l.trim() && !/error TS\d+/.test(l)).length

console.log(`files loaded by tsc: ${filesChecked}${FAST ? ' (incremental)' : ''}`)
if (filesChecked < MIN_FILES) {
  console.error(`FAIL: tsc listed only ${filesChecked} files, expected at least ${MIN_FILES}. It did not run.`)
  process.exit(1)
}

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
