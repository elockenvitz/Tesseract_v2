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
 * stop running while the guard keeps printing a green summary. One of the 17
 * entries is 43 test files; losing it costs a third of the suite and produces
 * no signal at all.
 *
 * So the list is asserted here instead: every registered directory must exist
 * and must contribute at least one test file, and every test file found on
 * disk must appear in the runner's own report of what it executed. The
 * expected number is derived from the working tree on every run, never pinned,
 * so adding or deleting tests needs no edit here.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Directories whose unit tests gate a merge.
 *
 * This is a deliberate subset, not the whole suite: CI's `Unit tests` job runs
 * the entire `unit` project. Add a directory here when its tests are load
 * bearing enough that a local guard run should refuse to pass without them.
 */
export const REGISTERED_DIRS = [
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
]

/** Mirrors the `unit` project's include glob in vitest.config.ts. */
const TEST_FILE = /\.test\.tsx?$/
const SKIP_DIR = /^(node_modules|\.git|dist|coverage)$/

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

export const toPosix = (p) => String(p).split(path.win32.sep).join('/')

/**
 * Resolve the registered scope against the working tree.
 *
 * Returns the union of test files plus, per directory, what was found — so a
 * directory that has quietly emptied is reported by name rather than as a
 * smaller total.
 */
export function resolveScope(root, dirs = REGISTERED_DIRS) {
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
      problems.push(`registered directory "${dir}" does not exist — its tests are not running`)
    } else if (files.length === 0) {
      problems.push(`registered directory "${dir}" contains no test files — it contributes nothing`)
    }
  }
  return problems
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
  const ran = new Set(results.map((r) => normaliseReported(r?.name)))
  const expected = new Set(expectedFiles)

  const missing = [...expected].filter((f) => !hasSuffix(ran, f))
  if (missing.length) {
    problems.push(
      `${missing.length} registered test file(s) were never executed by the runner:`,
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
    failedResults.slice(0, 20).forEach((r) => problems.push('    ' + normaliseReported(r?.name)))
  }

  return problems
}

/** The reporter emits absolute paths; the scope is repo-relative. */
const normaliseReported = (name) => toPosix(name ?? '')
const hasSuffix = (set, rel) => {
  for (const r of set) if (r === rel || r.endsWith('/' + rel)) return true
  return false
}
