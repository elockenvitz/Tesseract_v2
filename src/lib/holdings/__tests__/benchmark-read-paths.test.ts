/**
 * No read path may select benchmark weights by portfolio alone.
 *
 * `portfolio_benchmark_weights` is a dated series. A query filtered only by
 * `portfolio_id` transfers every historical date — 33 of them in production
 * today, one more each day the capture job runs — so the browser can throw all
 * but the newest away. On the largest portfolio that was 2.46 MB to use 76 KB.
 *
 * The correctness of those five sites was never the problem;
 * `latestBenchmarkRows` held the line. The VOLUME was the problem, and volume
 * is invisible in behaviour, which is why it ran for weeks. So the shape of
 * the query is pinned here: the only permitted reader of this table is the
 * helper that narrows server-side first.
 *
 * ── Why the source is scanned once ───────────────────────────────────────────
 *
 * Every assertion below is a property of the whole source tree, and the tree
 * is about 2800 files. This file used to walk and read all of them SEVEN times
 * per run: `directReaders()` re-scanned on every call, and the second test
 * called it once per candidate inside a `.filter()`, five times over. That
 * test took 4.7s of a 5s budget on its own and timed out whenever vitest ran
 * it beside the two other guards that walk the same tree, which made the
 * Netlify deploy gate fail at random on a green tree.
 *
 * The tree is now read once per run into `corpus` and every assertion reads
 * from it. The assertions and their guarantees are unchanged; only the number
 * of times the disk is read has changed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'src')

/** Source with comments stripped, so prose about the fix cannot satisfy or break a guard. */
function strip(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

function sourceFiles(dir = SRC, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue
      sourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/')

interface SourceFile {
  /** Path relative to src, forward-slashed. */
  rel: string
  /** Raw text, for assertions about comments. */
  raw: string
  /** Comment-stripped text, for assertions about code. */
  code: string
}

/**
 * The tree, read once per run of this file.
 *
 * Populated by `beforeAll` and cleared by `afterAll` rather than memoised on
 * first use. vitest runs both hooks on every execution of this file, including
 * each re-trigger in watch mode, so the cache cannot outlive the tree it
 * describes: a file edited between runs is re-read on the next one. A plain
 * lazy memo would be correct today only because the module registry happens to
 * be rebuilt per run, which is not a guarantee this guard should depend on.
 */
let corpus: SourceFile[] | null = null

beforeAll(() => {
  corpus = sourceFiles().map(abs => {
    const raw = readFileSync(abs, 'utf8')
    return { rel: rel(abs), raw, code: strip(raw) }
  })
})

afterAll(() => {
  corpus = null
})

/**
 * The scanned tree.
 *
 * Throws rather than rescanning if the hook has not run. A guard that quietly
 * substitutes an empty tree would report PASS on every assertion below while
 * checking nothing.
 */
function sources(): SourceFile[] {
  if (corpus === null) {
    throw new Error('the source tree was not scanned: beforeAll did not run')
  }
  if (corpus.length === 0) {
    throw new Error('the source tree scanned as empty, which cannot be right')
  }
  return corpus
}

/** One file's comment-stripped code, by path relative to src. */
function codeOf(relPath: string): string {
  const hit = sources().find(f => f.rel === relPath)
  if (!hit) throw new Error(`${relPath} is not in the scanned source tree`)
  return hit.code
}

/** Files whose CODE queries the table directly. */
function directReaders(): string[] {
  return sources()
    .filter(f => f.code.includes("from('portfolio_benchmark_weights')"))
    .map(f => f.rel)
    .sort()
}

/**
 * The only two modules allowed to touch the table.
 *
 * `benchmark-latest-query` narrows to the newest file for whole-file reads;
 * `benchmark-membership` does the same two-step for a single asset and predates
 * it. Everything else goes through one of them.
 */
const PERMITTED = [
  'lib/holdings/benchmark-latest-query.ts',
  'lib/holdings/benchmark-membership.ts',
]

describe('who may query portfolio_benchmark_weights', () => {
  it('only the two helpers that filter by date server-side', () => {
    expect(directReaders()).toEqual(PERMITTED)
  })

  it('the five paths that caused the egress no longer query it directly', () => {
    const fixed = [
      'hooks/useDesktopPortfolio.ts',
      'hooks/mobile/usePortfolioLenses.ts',
      'components/mobile/MobileDashboard.tsx',
      'components/trading/TradeIdeaDetailModal.tsx',
      'pages/SimulationPage.tsx',
    ]
    const readers = directReaders()
    const offenders = fixed.filter(f => readers.includes(f))
    expect(offenders).toEqual([])
  })

  it('each of the five calls a date-narrowing helper instead', () => {
    const expected: Array<[string, string]> = [
      ['hooks/useDesktopPortfolio.ts', 'fetchLatestBenchmarkWeights('],
      ['hooks/mobile/usePortfolioLenses.ts', 'fetchLatestBenchmarkWeightsFor('],
      ['components/mobile/MobileDashboard.tsx', 'fetchLatestBenchmarkWeightsFor('],
      ['components/trading/TradeIdeaDetailModal.tsx', 'fetchLatestBenchmarkWeightsFor('],
      ['pages/SimulationPage.tsx', 'fetchLatestBenchmarkWeights('],
    ]
    for (const [file, fn] of expected) {
      expect(codeOf(file), `${file} should call ${fn}`).toContain(fn)
    }
  })
})

describe('the helper narrows before it reads', () => {
  const helper = () => codeOf('lib/holdings/benchmark-latest-query.ts')

  it('orders and limits the date probe server-side', () => {
    const code = helper()
    expect(code).toContain("select('as_of_date')")
    expect(code).toContain("order('as_of_date', { ascending: false, nullsFirst: false })")
    expect(code).toContain('limit(1)')
  })

  it('constrains as_of_date on the row read, not just portfolio_id', () => {
    const code = helper()
    // A dated file is matched with eq, an undated one with is-null, and the
    // multi-portfolio case with in/or. All four appear.
    expect(code).toContain(".eq('as_of_date', asOf)")
    expect(code).toContain(".is('as_of_date', null)")
    expect(code).toContain(".in('as_of_date', dated)")
    expect(code).toContain('as_of_date.is.null,as_of_date.in.')
  })

  it('keeps latestBenchmarkRows as the backstop under the narrowed read', () => {
    expect(helper()).toContain('latestBenchmarkRows(')
  })

  it('resolves the date per portfolio rather than globally', () => {
    // A single global max would empty every book not refreshed that morning.
    const code = helper()
    expect(code).toContain('datesByPortfolio')
    expect(code).not.toMatch(/max\(\s*as_of_date\s*\)/)
  })
})

describe('the stale single-date claim is gone', () => {
  /*
   * Every one of the five call sites carried a comment saying the table "can
   * hold only one date today — UNIQUE (portfolio_id, asset_id) forbids a
   * second". That stopped being true, and a comment asserting it is how the
   * next reader concludes the unfiltered read is safe. Checked against raw
   * text, not stripped code, because the claim IS a comment.
   */
  it('no file still claims the table holds a single date', () => {
    const phrases = [
      'can hold only one date',
      'can only hold one',
      'forbids a second',
      'table can hold only one',
    ]
    const offenders = sources()
      .filter(f => phrases.some(p => f.raw.includes(p)))
      .map(f => f.rel)
      // `latest-benchmark.ts` describes the constraint in the PAST tense as
      // the history of its own existence, which is the opposite of claiming
      // it still holds.
      .filter(f => f !== 'lib/holdings/latest-benchmark.ts')
    expect(offenders).toEqual([])
  })
})
