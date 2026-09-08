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
 *                           errors, and a completion contract on the compiler.
 *
 *   npx tsc --noEmit        Checks NOTHING. The root config is solution-style
 *                           with "files": [], so this exits 0 whatever the code
 *                           says. Never use it and never quote it as evidence.
 *
 * ── The third time it caught somebody ─────────────────────────────────────
 *
 * A JSX syntax error was introduced in UniversalNoteEditor while another lane
 * was editing it. The application did not compile. This gate printed PASS.
 *
 * It printed PASS because a syntax error makes TypeScript report syntactic
 * diagnostics and skip semantic analysis of the entire program. All 8,769 type
 * errors disappeared along with the ability to find any new one, and the gate
 * read that silence as a clean card surface. Reproduced here exactly:
 *
 *                             clean      one JSX syntax error
 *     tsc exit status             2                         2
 *     files actually loaded   3,131                     3,132
 *     diagnostics             8,773                         4
 *     verdict                  PASS                      PASS
 *
 * Note what did NOT change: the exit status, and the number of files loaded.
 * Neither an exit code nor a file count can tell these two runs apart, so the
 * completion contract below is causal instead. A grammar-band diagnostic is
 * PROOF that type-checking did not happen, and it fails the gate on its own.
 *
 * See scripts/lib/tsc-report.mjs for why the old file counter reported 5,524
 * files on a repository that only has 3,131.
 */
import { spawnSync } from 'node:child_process'
import { classifyChildOutcome, requireCompleted } from './lib/guard-process.mjs'
import { parseTscOutput, assessTscCompletion, scopeDiagnostics } from './lib/tsc-report.mjs'

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

/**
 * A floor on real source files, now that they are counted as source files.
 *
 * 3,131 today. This is deliberately NOT tight: it is here to catch a program
 * that was never built, and the reproduction above proves it cannot catch an
 * aborted compile on its own — the file count moved by one. Tightening it
 * toward 3,131 would buy nothing and would break every time a dependency
 * changes how many `.d.ts` files it ships.
 */
const MIN_FILES = 2200

/**
 * tsc's documented completion codes.
 *
 * 0 Success, 1 DiagnosticsPresent_OutputsSkipped, 2
 * DiagnosticsPresent_OutputsGenerated. This repo's accepted baseline exits 2.
 * 3 (InvalidProject) and 4 (ProjectReferenceCycle) are NOT completions, and
 * anything else is a crash.
 */
const TSC_COMPLETION_CODES = [0, 1, 2]

/** Generous, because a cold full check of this repo takes minutes. */
const TIMEOUT_MS = Number(process.env.GUARD_TYPES_TIMEOUT_MS ?? 20 * 60 * 1000)

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

/**
 * The exit code is kept.
 *
 * The previous version was `try { execFileSync } catch (e) { return e.stdout }`,
 * which discards the status, the signal and any spawn failure. A tsc that was
 * killed, crashed, overflowed maxBuffer, or never started at all came back from
 * that catch looking exactly like a tsc that finished with findings.
 */
const child = spawnSync('npx', args, {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  shell: process.platform === 'win32',
  timeout: TIMEOUT_MS,
})

requireCompleted(
  classifyChildOutcome({
    status: child.status,
    signal: child.signal,
    error: child.error,
    stderr: child.stderr,
    allowedExitCodes: TSC_COMPLETION_CODES,
    label: 'tsc',
  }),
  [`command: npx ${args.join(' ')}`, `timeout: ${TIMEOUT_MS}ms`],
)

const report = parseTscOutput(child.stdout)

console.log(`tsc exit status: ${child.status}`)
console.log(`source files loaded by tsc: ${report.files.length}${FAST ? ' (incremental)' : ''}`)
console.log(`diagnostics: ${report.diagnostics.length} (+${report.continuations} elaboration lines)`)

const incomplete = assessTscCompletion(report, { minFiles: MIN_FILES })
if (incomplete.length) {
  console.error('FAIL: tsc did not complete a type-check of this repository.')
  incomplete.forEach((p) => console.error('  ' + p))
  console.error('')
  console.error('Nothing below this point can be trusted: a compile that aborts before')
  console.error('semantic analysis reports NO type errors, on the card surface or anywhere.')
  process.exit(1)
}

const scoped = scopeDiagnostics(report.diagnostics, PATHS)

console.log(`repo-wide errors: ${report.diagnostics.length}  (reported, not gated)`)
console.log(`card-surface errors: ${scoped.length}`)

if (scoped.length > MAX_ERRORS) {
  console.error(`FAIL: ${scoped.length} type errors on the card surface, ceiling is ${MAX_ERRORS}:`)
  scoped.slice(0, 40).forEach((d) => console.error('  ' + d.raw))
  process.exit(1)
}
console.log('PASS')
