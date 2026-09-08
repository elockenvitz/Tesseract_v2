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
  GATED_DIRS, DEFERRED_DIRS, resolveScope, scopeProblems, assessUnitReport, testFilesUnder,
  allTestFiles, classifyTestFiles, unclassifiedProblems, staleDeferredDirs,
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

describe('classifyTestFiles', () => {
  const all = [
    'src/lib/signals/__tests__/a.test.ts',
    'src/lib/research/__tests__/b.test.ts',
    'src/pages/__tests__/c.test.tsx',
  ]

  it('sorts files into gated, deferred and neither', () => {
    const out = classifyTestFiles({
      all,
      gatedFiles: ['src/lib/signals/__tests__/a.test.ts'],
      deferredDirs: ['src/lib/research/__tests__'],
    })
    expect(out.gated).toEqual(['src/lib/signals/__tests__/a.test.ts'])
    expect(out.deferred).toEqual(['src/lib/research/__tests__/b.test.ts'])
    expect(out.unclassified).toEqual(['src/pages/__tests__/c.test.tsx'])
  })

  it('matches deferred directories exactly, never as a prefix', () => {
    // A broad `src/lib` entry must NOT absorb a brand new `src/lib/<x>` test
    // directory. That absorption is the silent disappearance this guards
    // against, so the specificity is load bearing.
    const out = classifyTestFiles({
      all: ['src/lib/brand-new-area/__tests__/x.test.ts', 'src/lib/loose.test.ts'],
      gatedFiles: [],
      deferredDirs: ['src/lib'],
    })
    expect(out.deferred).toEqual(['src/lib/loose.test.ts'])
    expect(out.unclassified).toEqual(['src/lib/brand-new-area/__tests__/x.test.ts'])
  })

  it('lets gated win wherever both lists could match', () => {
    const out = classifyTestFiles({
      all: ['src/hooks/mobile/__tests__/a.test.ts'],
      gatedFiles: ['src/hooks/mobile/__tests__/a.test.ts'],
      deferredDirs: ['src/hooks/mobile/__tests__'],
    })
    expect(out.gated).toHaveLength(1)
    expect(out.deferred).toHaveLength(0)
  })
})

describe('unclassifiedProblems', () => {
  it('says nothing when everything is accounted for', () => {
    expect(unclassifiedProblems([])).toEqual([])
  })

  it('reports by directory, because the directory is the decision', () => {
    const problems = unclassifiedProblems([
      'src/pages/__tests__/a.test.tsx',
      'src/pages/__tests__/b.test.tsx',
      'src/components/tabs/__tests__/c.test.tsx',
    ])
    const joined = problems.join('\n')
    expect(problems[0]).toMatch(/3 test file\(s\) in 2 director/)
    expect(joined).toContain('src/pages/__tests__')
    expect(joined).toContain('src/components/tabs/__tests__')
  })
})

describe('the gated scope, against the working tree', () => {
  // Derived from disk on every run, never pinned to today's number: adding or
  // deleting a test must not require an edit here.
  const { perDir, files } = resolveScope(ROOT, GATED_DIRS)
  const onDisk = allTestFiles(ROOT)
  const split = classifyTestFiles({ all: onDisk, gatedFiles: files, deferredDirs: DEFERRED_DIRS })

  it('has no gated directory that is missing or empty', () => {
    expect(scopeProblems(perDir)).toEqual([])
  })

  it('accounts for every test file in the tree', () => {
    // The assertion this lane's reconciliation added. `src/pages/__tests__`
    // landed on main ungated and no number moved; this is what would have said
    // so.
    expect(unclassifiedProblems(split.unclassified)).toEqual([])
    expect(split.gated.length + split.deferred.length).toBe(onDisk.length)
  })

  it('finds a substantial suite', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('gates the page tests that arrived on main after this lane started', () => {
    expect(GATED_DIRS).toContain('src/pages')
    expect(files.some((f: string) => f.startsWith('src/pages/'))).toBe(true)
  })

  it('includes this guard suite, so the guards gate themselves', () => {
    expect(GATED_DIRS).toContain('src/lib/guards')
    expect(files.some((f: string) => f.includes('src/lib/guards/'))).toBe(true)
  })

  it('lists no gated directory twice, and none that is also deferred', () => {
    expect(new Set(GATED_DIRS).size).toBe(GATED_DIRS.length)
    expect(GATED_DIRS.filter((d: string) => DEFERRED_DIRS.includes(d))).toEqual([])
  })

  it('has no deferred entry pointing at nothing', () => {
    // Not fatal in the guard, but a stale entry is a place a real directory
    // could later hide.
    expect(staleDeferredDirs(ROOT, DEFERRED_DIRS)).toEqual([])
  })

  it('returns null for a directory that is not there', () => {
    expect(testFilesUnder(ROOT, 'src/lib/definitely-not-here')).toBeNull()
  })
})

/**
 * The walker skip-list, which had this bug in it.
 *
 * `SKIP_DIR` was `/^(node_modules|\.git|dist|coverage)$/`. `dist` and
 * `coverage` are build outputs at the repo root, but the rule matched a bare
 * directory NAME at any depth, and this product has `src/lib/coverage` and
 * `src/components/coverage` holding six gated test files. The whole-tree walk
 * skipped all six and reported 222 files where `find` counted 228.
 *
 * It stayed invisible because the gated scope was still resolved correctly:
 * the skip applies to directories the walk descends into, not to the root it
 * is handed, so `testFilesUnder(root, 'src/lib/coverage')` was always right.
 * Only the accounting was wrong, and nothing compared the two numbers.
 */
describe('the tree walk', () => {
  it('descends into source directories whose name looks like a build output', () => {
    const all = allTestFiles(ROOT)
    expect(all.some((f: string) => f.startsWith('src/lib/coverage/'))).toBe(true)
    expect(all.some((f: string) => f.startsWith('src/components/coverage/'))).toBe(true)
  })

  it('agrees with the per-directory scan about every gated file', () => {
    const { files } = resolveScope(ROOT, GATED_DIRS)
    const split = classifyTestFiles({
      all: allTestFiles(ROOT),
      gatedFiles: files,
      deferredDirs: DEFERRED_DIRS,
    })
    expect(split.lost).toEqual([])
  })

  it('reports a gated file the whole-tree walk lost', () => {
    // The assertion that turns "two numbers quietly disagree" into a failure.
    const split = classifyTestFiles({
      all: ['src/lib/signals/__tests__/a.test.ts'],
      gatedFiles: ['src/lib/signals/__tests__/a.test.ts', 'src/lib/coverage/__tests__/b.test.ts'],
      deferredDirs: [],
    })
    expect(split.lost).toEqual(['src/lib/coverage/__tests__/b.test.ts'])
  })

  it('still refuses to descend into node_modules', () => {
    expect(allTestFiles(ROOT).some((f: string) => f.includes('node_modules'))).toBe(false)
  })
})
