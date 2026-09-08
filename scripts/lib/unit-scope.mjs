/**
 * The registered scope of `guard:unit`, and the assertions that keep it real.
 *
 * ── Why the directory list is code now ────────────────────────────────────
 *
 * It used to live in package.json:
 *
 *     "guard:unit": "vitest run --project unit src/lib/org-scope src/lib/ideas ..."
 *
 * Those trailing paths are not directory scopes. Vitest treats positional
 * arguments as SUBSTRING FILTERS over test-file paths, and it only errors when
 * the whole filter set matches nothing. Demonstrated on this repository:
 *
 *     vitest run --project unit src/lib/brand src/lib/definitely-not-here
 *     -> 2 passed (2), exit 0
 *
 * The second filter matched no file, and nothing said so. Rename a directory,
 * move its tests, or land a glob change, and that directory's tests silently
 * stop running while the guard keeps printing a green summary.
 *
 * ── The second way a directory disappears ─────────────────────────────────
 *
 * Asserting the registered directories are still populated only protects the
 * ones somebody remembered to register. It says nothing about a test directory
 * that was never registered in the first place, and that is the commoner case:
 * a lane adds `src/pages/__tests__`, the gate does not know the path exists,
 * and 100% of that directory's coverage is missing from the gate on the day it
 * lands. Nothing anywhere reports a number that moved.
 *
 * That happened between this lane's baseline and current main:
 * `src/pages/__tests__/dashboard-mobile-route.test.tsx` arrived on main and no
 * guard ran it. Three unmerged lanes were each independently adding paths to
 * the package.json filter list to work around the same gap.
 *
 * So every test file on disk must now be classified, and there are only two
 * legitimate answers:
 *
 *   GATED_DIRS     run by this gate; a failure here blocks
 *   DEFERRED_DIRS  known to exist, deliberately outside the gate
 *
 * A test file under neither FAILS the guard by name. `guard:unit` is a
 * deliberate subset of the suite — CI's `Unit tests` job runs the whole `unit`
 * project — so the deferred list is not a backlog to burn down. It is the
 * difference between "we decided not to gate this" and "we never noticed it".
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Directories whose unit tests gate a merge.
 *
 * Matched as SUBTREES: everything below the path is gated. Add a directory
 * here when its tests are load bearing enough that a guard run should refuse
 * to pass without them.
 */
export const GATED_DIRS = [
  'src/lib/org-scope',
  'src/lib/ideas',
  'src/lib/ops',
  'src/lib/guards',
  'src/hooks/ideas',
  'src/hooks/mobile',
  'src/lib/signals',
  'src/lib/mobile',
  'src/lib/brand',
  'src/lib/charts',
  'src/lib/security',
  'src/lib/coverage',
  'src/components/coverage',
  'src/components/signals',
  'src/components/mobile',
  'src/components/ui',
  'src/components/charts',
  'src/components/feed',
  // Arrived on main after this lane's baseline, ungated. Two of the three
  // lanes queued behind main were adding it to the filter list by hand.
  'src/pages',
  /*
   * Gated on the feature lanes before scope moved into this file.
   *
   * Each of these was a hand-maintained entry in the old `guard:unit`
   * filter list on `fix/mobile-compatibility` or `feat/tile-engine-v2`.
   * Deferring them here would have quietly downgraded coverage those
   * lanes had already decided they wanted, which is the exact silent
   * disappearance this accounting exists to prevent — so they arrive
   * gated, and the two that main had listed as deferred move up.
   */
  'src/lib/tile-engine',
  'src/lib/notifications',
  'src/components/notifications',
  'src/lib/capture',
  'src/components/notes',
  'src/components/tabs',
  'src/components/layout',  'src/hooks/__tests__',
  'src/components/communication',

]

/**
 * Test directories that exist and are deliberately not gated.
 *
 * Matched EXACTLY, never as a prefix, and that is the whole point. A broad
 * entry like `src/lib` would absorb every future `src/lib/<new>/__tests__`
 * into the deferred set without anyone deciding to, which is the silent
 * disappearance this list exists to prevent. So the entries are the precise
 * directories that hold the files, and a new one fails until it is classified.
 *
 * 75 files across 41 directories today. Being on this list is not a judgement
 * about the tests; CI runs the whole `unit` project regardless.
 */
export const DEFERRED_DIRS = [
  'src/components/asset-v2',
  'src/components/dashboard',
  'src/components/decisions-v2',
  'src/components/desktop',
  'src/components/ideas-v2',
  'src/components/organization/__tests__',
  'src/components/portfolio-v2',
  'src/components/research-v2',
  'src/components/thoughts',
  'src/components/today',
  'src/engine/decisionEngine',
  'src/engine/decisionEngine/__tests__',
  'src/features/assets/actionLoop',
  'src/hooks',
  'src/hooks/workflow',
  'src/lib',
  'src/lib/__tests__',
  'src/lib/activity/__tests__',
  'src/lib/attention-feed/__tests__',
  'src/lib/attention-state',
  'src/lib/dashboard/__tests__',
  'src/lib/desktop-asset',
  'src/lib/desktop-decisions',
  'src/lib/desktop-ideas',
  'src/lib/desktop-portfolio',
  'src/lib/desktop-research',
  'src/lib/engagement',
  'src/lib/financial-data/__tests__',
  'src/lib/holdings/__tests__',
  'src/lib/lists',
  'src/lib/permissions/__tests__',
  'src/lib/portfolio',
  'src/lib/portfolio/__tests__',
  'src/lib/research',
  'src/lib/research/__tests__',
  'src/lib/storage',
  'src/lib/today',
  'src/lib/today/__tests__',
  'src/lib/trade-lab',
]

/** Kept as the old name so nothing that imports it breaks. */
export const REGISTERED_DIRS = GATED_DIRS

/** Mirrors the `unit` project's include glob in vitest.config.ts. */
const TEST_FILE = /\.test\.tsx?$/

/**
 * Directories the walker refuses to descend into.
 *
 * `dist` and `coverage` used to be on this list, which was a bug of exactly
 * the kind this file exists to catch. Both are build outputs at the REPO root,
 * but the rule matched a bare directory NAME at any depth — and this product
 * has `src/lib/coverage` and `src/components/coverage`, which are gated source
 * directories holding six test files. Walking the tree silently skipped all
 * six, so the whole-tree total read 222 where `find` counted 228.
 *
 * Nothing failed. The gated scope was still resolved correctly, because the
 * skip applies to directories it descends into and not to the root it is
 * given, so the miscount only showed up in the accounting. It was found by
 * two numbers in the same run disagreeing.
 *
 * Only build and vendor directories that cannot share a name with a source
 * module belong here. `classifyTestFiles` now also fails if the walk loses a
 * file the gated scope found, so the next version of this cannot be silent.
 */
const SKIP_DIR = /^(node_modules|\.git)$/
/** The tree the `unit` project globs over. */
export const SOURCE_ROOT = 'src'

export const toPosix = (p) => String(p).split(path.win32.sep).join('/')

/** Every test file under `dir`, as repo-relative POSIX paths. */
export function testFilesUnder(root, dir) {
  const abs = path.resolve(root, dir)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return null
  const found = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(entry.name)) walk(path.join(d, entry.name))
      } else if (TEST_FILE.test(entry.name)) {
        found.push(toPosix(path.relative(root, path.join(d, entry.name))))
      }
    }
  }
  walk(abs)
  return found
}

/** Every test file the `unit` project would collect, gated or not. */
export const allTestFiles = (root) => testFilesUnder(root, SOURCE_ROOT) ?? []

/**
 * Resolve the gated scope against the working tree.
 *
 * Returns the union of test files plus, per directory, what was found — so a
 * directory that has quietly emptied is reported by name rather than as a
 * smaller total.
 */
export function resolveScope(root, dirs = GATED_DIRS) {
  const perDir = dirs.map((dir) => ({ dir, files: testFilesUnder(root, dir) }))
  const all = new Set()
  for (const { files } of perDir) (files ?? []).forEach((f) => all.add(f))
  return { perDir, files: [...all].sort() }
}

/** Registered directories that are gone, or that no longer hold any test. */
export function scopeProblems(perDir) {
  const problems = []
  for (const { dir, files } of perDir) {
    if (files === null) {
      problems.push(`gated directory "${dir}" does not exist — its tests are not running`)
    } else if (files.length === 0) {
      problems.push(`gated directory "${dir}" contains no test files — it contributes nothing`)
    }
  }
  return problems
}

const parentDir = (file) => toPosix(file).replace(/\/[^/]*$/, '')

/**
 * Sort every test file on disk into gated, deferred, or neither.
 *
 * Gated wins over deferred wherever both could match, so a broad deferred
 * entry can never hide a gated subtree.
 */
export function classifyTestFiles({ all, gatedFiles, deferredDirs = DEFERRED_DIRS }) {
  const gatedSet = new Set(gatedFiles)
  const deferredSet = new Set(deferredDirs.map(toPosix))
  const gated = []
  const deferred = []
  const unclassified = []
  for (const file of all) {
    if (gatedSet.has(file)) gated.push(file)
    else if (deferredSet.has(parentDir(file))) deferred.push(file)
    else unclassified.push(file)
  }

  /**
   * Two walks of the same tree that disagree.
   *
   * `all` comes from walking src; `gatedFiles` comes from walking each gated
   * directory. Every gated file must therefore appear in `all`. When it did
   * not, the cause was a skip rule in the walker eating `src/lib/coverage`,
   * and the only symptom was a total that no single check compared against
   * anything. Now the disagreement is the finding.
   */
  const seen = new Set(all)
  const lost = gatedFiles.filter((f) => !seen.has(f))

  return { gated, deferred, unclassified, lost }
}

/**
 * A test directory nobody has classified.
 *
 * Reported by DIRECTORY rather than by file, because the directory is the
 * decision: gate it, or record that it is deliberately deferred.
 */
export function unclassifiedProblems(unclassified) {
  if (!unclassified.length) return []
  const dirs = [...new Set(unclassified.map(parentDir))].sort()
  return [
    `${unclassified.length} test file(s) in ${dirs.length} director(y/ies) are neither gated nor deferred:`,
    ...dirs.map((d) => `    ${d}`),
    'Add each to GATED_DIRS to gate it, or to DEFERRED_DIRS to record that it is',
    'deliberately outside the gate. Leaving it unlisted is how a directory of',
    'tests goes missing without any number moving.',
  ]
}

/** Deferred entries that no longer point at anything, so the list can be tidied. */
export function staleDeferredDirs(root, deferredDirs = DEFERRED_DIRS) {
  return deferredDirs.filter((dir) => {
    const files = testFilesUnder(root, dir)
    return files === null || files.length === 0
  })
}

/**
 * Compare what the runner says it executed against what is on disk.
 *
 * This is the assertion the old command could not make. It is derived, not
 * pinned: the expectation is recomputed from the working tree every run, so it
 * cannot rot into "today's number of tests" and it does not punish anyone for
 * adding or removing a test file.
 */
export function assessUnitReport({ expectedFiles, report }) {
  const problems = []

  if (!report || typeof report !== 'object') {
    problems.push('the test runner produced no parseable JSON report — it did not finish')
    return problems
  }

  const results = Array.isArray(report.testResults) ? report.testResults : []
  const ran = new Set(results.map((r) => toPosix(r?.name ?? '')))
  const expected = new Set(expectedFiles)

  const missing = [...expected].filter((f) => !hasSuffix(ran, f))
  if (missing.length) {
    problems.push(
      `${missing.length} gated test file(s) were never executed by the runner:`,
    )
    missing.slice(0, 20).forEach((f) => problems.push('    ' + f))
  }

  if (report.success !== true) {
    problems.push(`the runner reported success=${JSON.stringify(report.success)}`)
  }
  if (Number(report.numFailedTests) > 0) {
    problems.push(`${report.numFailedTests} failing test(s)`)
  }
  if (Number(report.numFailedTestSuites) > 0) {
    problems.push(`${report.numFailedTestSuites} failing test file(s)`)
  }

  // A file that fails to collect contributes zero assertions, so a suite count
  // of zero on a non-empty scope means collection, not the tests, went wrong.
  if (expected.size > 0 && Number(report.numTotalTests) === 0) {
    problems.push('the runner executed no tests at all, on a scope that has test files')
  }

  const failedResults = results.filter((r) => r?.status === 'failed')
  if (failedResults.length) {
    problems.push(`${failedResults.length} test file(s) reported status "failed":`)
    failedResults.slice(0, 20).forEach((r) => problems.push('    ' + toPosix(r?.name ?? '')))
  }

  return problems
}

/** The reporter emits absolute paths; the scope is repo-relative. */
const hasSuffix = (set, rel) => {
  for (const r of set) if (r === rel || r.endsWith('/' + rel)) return true
  return false
}
