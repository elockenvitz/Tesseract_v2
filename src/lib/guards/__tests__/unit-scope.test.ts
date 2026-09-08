/**
 * The unit gate's scope contract.
 *
 * `guard:unit` was `vitest run --project unit` followed by seventeen paths.
 * Vitest treats those as substring FILTERS and only errors when the whole set
 * matches nothing, so any subset of them could match nothing and the run would
 * still be green. Verified against this repository:
 *
 *     vitest run --project unit src/lib/brand src/lib/definitely-not-here
 *     -> Test Files  2 passed (2)   exit 0
 *
 * One of those seventeen entries holds 43 test files. Losing it costs a third
 * of the suite and produces no output that says so.
 *
 * The runner itself was never the problem — a syntax error, a missing module
 * and a collection failure each produced exit 1 when the file was matched. The
 * problem was that nothing compared what ran against what exists, so these
 * tests are about that comparison.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  REGISTERED_DIRS, resolveScope, scopeProblems, assessUnitReport, testFilesUnder,
  // @ts-expect-error — plain .mjs script, no type declarations by design
} from '../../../../scripts/lib/unit-scope.mjs'

const ROOT = path.resolve(__dirname, '../../../..')

/** A vitest JSON report over the given repo-relative files, all passing. */
const reportFor = (files: string[], over: Record<string, unknown> = {}) => ({
  success: true,
  numTotalTests: files.length * 3,
  numFailedTests: 0,
  numFailedTestSuites: 0,
  testResults: files.map((f) => ({ name: `C:/dev/repo/${f}`, status: 'passed' })),
  ...over,
})

describe('scopeProblems', () => {
  it('accepts directories that exist and hold tests', () => {
    expect(scopeProblems([{ dir: 'src/lib/brand', files: ['src/lib/brand/a.test.ts'] }])).toEqual([])
  })

  it('names a registered directory that has been renamed away', () => {
    // `files: null` is what testFilesUnder returns for a path that is gone.
    const problems = scopeProblems([{ dir: 'src/lib/gone', files: null }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/does not exist/)
  })

  it('names a registered directory that still exists but has emptied', () => {
    const problems = scopeProblems([{ dir: 'src/lib/hollow', files: [] }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/no test files/)
  })

  it('reports each broken directory rather than only a smaller total', () => {
    const problems = scopeProblems([
      { dir: 'src/lib/gone', files: null },
      { dir: 'src/lib/hollow', files: [] },
      { dir: 'src/lib/fine', files: ['src/lib/fine/a.test.ts'] },
    ])
    expect(problems).toHaveLength(2)
  })
})

describe('assessUnitReport', () => {
  const files = ['src/lib/a/one.test.ts', 'src/lib/a/two.test.ts', 'src/lib/b/three.test.ts']

  it('accepts a run that executed everything on disk', () => {
    expect(assessUnitReport({ expectedFiles: files, report: reportFor(files) })).toEqual([])
  })

  it('fails when a test file on disk was never executed', () => {
    // The silent-shrink case: vitest is perfectly happy, and 33% of the suite
    // did not run.
    const problems = assessUnitReport({ expectedFiles: files, report: reportFor(files.slice(0, 2)) })
    expect(problems[0]).toMatch(/never executed/)
    expect(problems.join('\n')).toContain('src/lib/b/three.test.ts')
  })

  it('fails when the runner produced no report', () => {
    expect(assessUnitReport({ expectedFiles: files, report: null })[0]).toMatch(/no parseable JSON/)
  })

  it('fails when the runner did not report success', () => {
    const report = reportFor(files, { success: false })
    expect(assessUnitReport({ expectedFiles: files, report }).join('\n')).toMatch(/success=false/)
  })

  it('fails on a failing test', () => {
    const report = reportFor(files, { numFailedTests: 1 })
    expect(assessUnitReport({ expectedFiles: files, report }).join('\n')).toMatch(/1 failing test/)
  })

  it('fails on a test file that could not be collected', () => {
    // A syntax error or a missing import surfaces here as a failed suite with
    // no assertions in it.
    const report = reportFor(files, {
      numFailedTestSuites: 1,
      testResults: [
        { name: `C:/dev/repo/${files[0]}`, status: 'failed', message: 'Cannot find module' },
        { name: `C:/dev/repo/${files[1]}`, status: 'passed' },
        { name: `C:/dev/repo/${files[2]}`, status: 'passed' },
      ],
    })
    const joined = assessUnitReport({ expectedFiles: files, report }).join('\n')
    expect(joined).toMatch(/failing test file/)
    expect(joined).toMatch(/status "failed"/)
  })

  it('fails when nothing ran at all on a non-empty scope', () => {
    const report = reportFor(files, { numTotalTests: 0 })
    expect(assessUnitReport({ expectedFiles: files, report }).join('\n')).toMatch(/executed no tests/)
  })

  it('matches the report’s absolute paths against repo-relative ones', () => {
    // The reporter emits absolute paths; the scope is relative. A mismatch here
    // would make every file look un-executed, which is loud rather than silent
    // — but it would also make the guard useless.
    expect(assessUnitReport({ expectedFiles: files, report: reportFor(files) })).toEqual([])
  })
})

describe('the registered scope, against the working tree', () => {
  // Derived from disk on every run, never pinned to today's number: adding or
  // deleting a test must not require an edit here.
  const { perDir, files } = resolveScope(ROOT, REGISTERED_DIRS)

  it('has no directory that is missing or empty', () => {
    expect(scopeProblems(perDir)).toEqual([])
  })

  it('finds a substantial suite', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('includes this guard suite, so the guards gate themselves', () => {
    expect(REGISTERED_DIRS).toContain('src/lib/guards')
    expect(files.some((f: string) => f.includes('src/lib/guards/'))).toBe(true)
  })

  it('returns null for a directory that is not there', () => {
    expect(testFilesUnder(ROOT, 'src/lib/definitely-not-here')).toBeNull()
  })
})
