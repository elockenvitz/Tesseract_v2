/**
 * The type gate's completion contract.
 *
 * ── The run these pin ─────────────────────────────────────────────────────
 *
 * One JSX syntax error was introduced in UniversalNoteEditor by another lane.
 * The application did not compile. `guard:types` printed PASS. Measured on
 * this repository, before and after, with nothing else changed:
 *
 *                             clean      one JSX syntax error
 *     tsc exit status             2                         2
 *     files actually loaded   3,131                     3,132
 *     diagnostics             8,773                         4
 *     "files loaded" printed  5,524                     3,132
 *     verdict                  PASS                      PASS
 *
 * Two things in that table decide the whole design, and both are easy to undo
 * later by someone reaching for the obvious fix:
 *
 *   The exit status is identical. "Require exit 0" does not work here and
 *   would also throw away the repo's deliberate ~8,800-error baseline.
 *
 *   The file count is identical, to within one file. tsc loaded everything
 *   both times; it just stopped type-checking. So a file-count floor cannot
 *   catch this either, at any threshold, and the 5,524 -> 3,132 collapse that
 *   was visible in the output came from counting diagnostic elaborations as
 *   files.
 *
 * What does separate them is causal: TypeScript emits syntactic diagnostics
 * INSTEAD of semantic ones. A grammar-band code is proof that type-checking
 * did not happen. That is the assertion under test.
 */
import { describe, it, expect } from 'vitest'
import {
  parseTscOutput, assessTscCompletion, scopeDiagnostics, isGrammarCode, isInfrastructureCode,
  isConfigFileDiagnostic,
  // @ts-expect-error — plain .mjs script, no type declarations by design
} from '../../../../scripts/lib/tsc-report.mjs'

/** Verbatim from the real captures, trimmed. */
const CLEAN = [
  `src/App.tsx(3,1): error TS6133: 'supabase' is declared but its value is never read.`,
  `src/components/asset/Panel.tsx(25,27): error TS2322: Type 'X' is not assignable to type 'Y'.`,
  `  Type 'undefined' is not assignable to type '{}'.`,
  `    Type '"chart"' is not assignable to type 'EntityType'.`,
  `src/hooks/useThing.ts(9,3): error TS7006: Parameter 'e' implicitly has an 'any' type.`,
  `src/lib/x.ts(1,1): error TS18046: 'e' is of type 'unknown'.`,
  `C:/dev/repo/src/App.tsx`,
  `C:/dev/repo/src/components/asset/Panel.tsx`,
  `C:/dev/repo/node_modules/@types/react/index.d.ts`,
].join('\n')

/** Verbatim from the reproduction. tsc emitted these four and nothing else. */
const SYNTAX_ABORT = [
  `src/components/notes/UniversalNoteEditor.tsx(3,11): error TS17008: JSX element 'div' has no corresponding closing tag.`,
  `src/components/notes/UniversalNoteEditor.tsx(3,34): error TS1003: Identifier expected.`,
  `src/components/notes/UniversalNoteEditor.tsx(4,1): error TS1381: Unexpected token. Did you mean \`{'}'}\` or \`&rbrace;\`?`,
  `src/components/notes/UniversalNoteEditor.tsx(5,1): error TS1005: '</' expected.`,
  `C:/dev/repo/src/App.tsx`,
  `C:/dev/repo/src/components/notes/UniversalNoteEditor.tsx`,
].join('\n')

const manyFiles = (n: number) =>
  Array.from({ length: n }, (_, i) => `C:/dev/repo/src/generated/file${i}.ts`).join('\n')

describe('parseTscOutput', () => {
  it('separates diagnostics, their elaborations, and file paths', () => {
    // The old counter was `lines.filter(l => !/error TS\d+/.test(l))`, which
    // put both elaborations AND file paths in the same bucket and called the
    // total "files loaded by tsc".
    const r = parseTscOutput(CLEAN)
    expect(r.diagnostics).toHaveLength(4)
    expect(r.files).toHaveLength(3)
    expect(r.continuations).toBe(2)
    expect(r.unclassified).toBe(0)
  })

  it('does not let elaboration lines inflate the file count', () => {
    const noisy = parseTscOutput(CLEAN + '\n' + Array(50).fill(`  Type 'a' is not assignable.`).join('\n'))
    const quiet = parseTscOutput(CLEAN)
    expect(noisy.files.length).toBe(quiet.files.length)
  })

  it('reads config errors that carry no source location', () => {
    const r = parseTscOutput(`error TS5023: Unknown compiler option '--nope'.`)
    expect(r.diagnostics).toEqual([expect.objectContaining({ code: 5023 })])
  })

  it('tolerates empty output without inventing files', () => {
    const r = parseTscOutput('')
    expect(r.files).toHaveLength(0)
    expect(r.diagnostics).toHaveLength(0)
  })
})

describe('isGrammarCode', () => {
  it('covers the syntax bands and nothing else', () => {
    expect([1003, 1005, 1381, 17008].every(isGrammarCode)).toBe(true)
    // Every code in the accepted baseline. If any of these were treated as an
    // abort, the repo's deliberate error backlog would fail the gate forever.
    expect([2322, 2345, 6133, 6196, 7006, 18046, 18047].some(isGrammarCode)).toBe(false)
  })
})

describe('isInfrastructureCode', () => {
  it('flags compiler option and file-resolution failures', () => {
    expect(isInfrastructureCode(5023)).toBe(true)
    expect(isInfrastructureCode(6053)).toBe(true)
  })
  it('leaves the unused-symbol codes in the same band alone', () => {
    // Every 6xxx code in the accepted baseline: 6133, 6196, 6192, 6198. All
    // "declared but never used". Failing on the band would fail the gate on a
    // backlog the repo has deliberately chosen to carry.
    expect([6133, 6196, 6192, 6198].some(isInfrastructureCode)).toBe(false)
  })

  it('flags an invalid compiler option argument', () => {
    // TS6046, the code a bad `target` produces. Same band as the four above.
    expect(isInfrastructureCode(6046)).toBe(true)
  })
})

describe('isConfigFileDiagnostic', () => {
  it('treats any complaint about the tsconfig as an infrastructure failure', () => {
    // The general rule, so this does not depend on keeping a list of codes
    // current. tsc only complains about a tsconfig it could not use, and no
    // baseline diagnostic is reported against one.
    expect(isConfigFileDiagnostic({ path: 'tsconfig.app.json' })).toBe(true)
    expect(isConfigFileDiagnostic({ path: 'C:/dev/repo/tsconfig.json' })).toBe(true)
    expect(isConfigFileDiagnostic({ path: 'src/App.tsx' })).toBe(false)
    expect(isConfigFileDiagnostic({})).toBe(false)
  })
})

describe('assessTscCompletion', () => {
  it('accepts a completed compile that reported the accepted baseline', () => {
    const r = parseTscOutput(CLEAN + '\n' + manyFiles(3000))
    expect(assessTscCompletion(r, { minFiles: 2200 })).toEqual([])
  })

  it('fails a compile that aborted on a syntax error', () => {
    const r = parseTscOutput(SYNTAX_ABORT + '\n' + manyFiles(3000))
    const problems = assessTscCompletion(r, { minFiles: 2200 })
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]).toMatch(/syntax\/grammar/)
  })

  it('fails the aborted compile even though it loaded MORE files than the clean one', () => {
    // This is the whole point. The aborted run listed 3,132 files and the
    // clean run listed 3,131. Any check built on the file count says the
    // broken run did more work.
    // SYNTAX_ABORT carries 2 file lines of its own and CLEAN carries 3, so the
    // padding is chosen to land on the two totals that were actually measured.
    const aborted = parseTscOutput(SYNTAX_ABORT + '\n' + manyFiles(3130))
    const clean = parseTscOutput(CLEAN + '\n' + manyFiles(3128))
    expect(aborted.files.length).toBe(3132)
    expect(clean.files.length).toBe(3131)
    expect(aborted.files.length).toBeGreaterThan(clean.files.length)
    expect(assessTscCompletion(aborted, { minFiles: 2200 })).not.toEqual([])
    expect(assessTscCompletion(clean, { minFiles: 2200 })).toEqual([])
  })

  it('fails a compile that could not be configured', () => {
    const r = parseTscOutput(`error TS5023: Unknown compiler option '--nope'.\n` + manyFiles(3000))
    expect(assessTscCompletion(r, { minFiles: 2200 })[0]).toMatch(/configuration\/resolution/)
  })

  it('fails when the program was never built', () => {
    const r = parseTscOutput(manyFiles(12))
    expect(assessTscCompletion(r, { minFiles: 2200 })[0]).toMatch(/listed only 12/)
  })

  it('fails on no output at all', () => {
    expect(assessTscCompletion(parseTscOutput(''), { minFiles: 2200 })).not.toEqual([])
  })
})

describe('scopeDiagnostics', () => {
  const diags = parseTscOutput(
    [
      `src/lib/signals/score.ts(1,1): error TS2322: nope`,
      `src/components/notes/Editor.tsx(1,1): error TS2322: nope`,
    ].join('\n'),
  ).diagnostics

  it('keeps only the gated surface', () => {
    expect(scopeDiagnostics(diags, ['src/lib/signals'])).toHaveLength(1)
  })

  it('normalises separators, so a Windows path does not scope to nothing', () => {
    // A separator mismatch scopes to zero errors and reports a clean pass —
    // the same silence-as-success failure the rest of this file is about.
    const windows = parseTscOutput(`src\\lib\\signals\\score.ts(1,1): error TS2322: nope`).diagnostics
    expect(scopeDiagnostics(windows, ['src/lib/signals'])).toHaveLength(1)
  })
})
