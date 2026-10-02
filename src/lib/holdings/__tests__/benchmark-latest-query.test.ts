/**
 * The newest benchmark file, without transferring the history behind it.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * `portfolio_benchmark_weights` became a dated series. `latestBenchmarkRows`
 * kept every read site CORRECT across that change — it was written for exactly
 * that — but it runs in the browser, so five sites went on selecting every
 * historical row and discarding all but the newest.
 *
 * Measured on production's largest portfolio at 33 dates:
 *
 *   unfiltered   15,898 rows   2,575,476 bytes
 *   newest only     481 rows      77,922 bytes
 *
 * A 33x amplification that grew by one date per day, and roughly 110 MB of the
 * 119.868 MB of PostgREST egress seen on 2026-09-16.
 *
 * ── Why these tests count rows ───────────────────────────────────────────
 *
 * The defect was invisible in behaviour: the numbers were right the whole
 * time. Only the VOLUME was wrong. So the fake client below actually applies
 * the filters it is given and records how many rows each query returned, and
 * the assertions are about that count. A test that only checked the returned
 * weights would have passed before this change as happily as after it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  fetchLatestBenchmarkDate,
  fetchLatestBenchmarkWeights,
  fetchLatestBenchmarkWeightsFor,
} from '../benchmark-latest-query'

type Row = { portfolio_id: string; asset_id: string; weight: number; as_of_date: string | null }

interface Recorded {
  columns: string
  rowsReturned: number
}

/**
 * A Supabase double that resolves queries against in-memory rows by really
 * applying the predicates, so `rowsReturned` is the number of rows that would
 * have crossed the wire.
 */
function fakeClient(rows: Row[]) {
  const queries: Recorded[] = []

  const builder = (columns: string) => {
    let working = rows.slice()
    let limit: number | null = null
    let orderDesc = false

    const chain: Record<string, unknown> = {
      eq(col: string, value: unknown) {
        working = working.filter(r => (r as never as Record<string, unknown>)[col] === value)
        return chain
      },
      in(col: string, values: readonly unknown[]) {
        working = working.filter(r => values.includes((r as never as Record<string, unknown>)[col]))
        return chain
      },
      is(col: string, value: null) {
        working = working.filter(r => (r as never as Record<string, unknown>)[col] === value)
        return chain
      },
      or(filter: string) {
        // Supports exactly what the module emits:
        //   as_of_date.is.null,as_of_date.in.(d1,d2)
        const wantsNull = filter.includes('as_of_date.is.null')
        const m = filter.match(/as_of_date\.in\.\(([^)]*)\)/)
        const dates = m && m[1] ? m[1].split(',') : []
        working = working.filter(r =>
          (wantsNull && r.as_of_date === null) || (r.as_of_date !== null && dates.includes(r.as_of_date)),
        )
        return chain
      },
      order(col: string, opts: { ascending: boolean }) {
        orderDesc = !opts.ascending
        working = working.slice().sort((a, b) => {
          const av = String((a as never as Record<string, unknown>)[col] ?? '')
          const bv = String((b as never as Record<string, unknown>)[col] ?? '')
          return orderDesc ? bv.localeCompare(av) : av.localeCompare(bv)
        })
        return chain
      },
      limit(n: number) {
        limit = n
        return chain
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        const out = limit == null ? working : working.slice(0, limit)
        queries.push({ columns, rowsReturned: out.length })
        return Promise.resolve({ data: out, error: null }).then(resolve)
      },
    }
    return chain
  }

  return {
    client: { from: () => ({ select: (columns: string) => builder(columns) }) } as never,
    queries,
    /** Total rows that crossed the wire for every query made. */
    get rowsTransferred() { return queries.reduce((n, q) => n + q.rowsReturned, 0) },
  }
}

/** Production's shape: one file of `names` assets per date, per portfolio. */
function series(portfolioId: string, dates: string[], names: number, weightBase = 1): Row[] {
  return dates.flatMap((d, di) =>
    Array.from({ length: names }, (_, ai) => ({
      portfolio_id: portfolioId,
      asset_id: `asset-${ai}`,
      weight: weightBase + di, // differs per date, so "which file" is observable
      as_of_date: d,
    })),
  )
}

/** 33 lexicographically ordered dates — production's current depth. */
const DATES = Array.from({ length: 33 }, (_, i) => `2026-${i < 18 ? '08' : '09'}-${String((i % 18) + 1).padStart(2, '0')}`)

let fake: ReturnType<typeof fakeClient>

beforeEach(() => { fake = fakeClient([]) })

// ───────────────────────────────────────────────────────────────────────────
// 1. History is not transferred
// ───────────────────────────────────────────────────────────────────────────

describe('a single portfolio with 33 dates', () => {
  const NAMES = 481
  const rows = series('p1', DATES, NAMES)

  it('transfers only the newest file, not the history', async () => {
    // Production dimensions: 33 x 481 = 15,873 rows available.
    const f = fakeClient(rows)
    const out = await fetchLatestBenchmarkWeights(f.client, 'p1')

    expect(out).toHaveLength(NAMES)
    // One row for the date probe, then one file. Nothing else.
    expect(f.rowsTransferred).toBe(NAMES + 1)
    // Emphatically NOT the whole series.
    expect(f.rowsTransferred).toBeLessThan(rows.length / 30)
  })

  it('asks the server for the date rather than scanning dates in the browser', async () => {
    const f = fakeClient(rows)
    await fetchLatestBenchmarkWeights(f.client, 'p1')
    // The probe selects one column and takes one row.
    expect(f.queries[0].columns).toBe('as_of_date')
    expect(f.queries[0].rowsReturned).toBe(1)
  })

  it('returns the newest file, not an older one', async () => {
    const f = fakeClient(rows)
    const out = await fetchLatestBenchmarkWeights(f.client, 'p1')
    // `series` encodes the date index in the weight: the last date wins.
    expect(new Set(out.map(r => r.as_of_date))).toEqual(new Set([DATES[DATES.length - 1]]))
    expect(out.every(r => r.weight === 33)).toBe(true)
  })

  it('narrows further when the caller only needs some assets', async () => {
    const f = fakeClient(rows)
    const out = await fetchLatestBenchmarkWeights(f.client, 'p1', { assetIds: ['asset-0', 'asset-1'] })
    expect(out).toHaveLength(2)
    expect(f.rowsTransferred).toBe(3) // probe + 2
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2. Multiple dates produce correct results
// ───────────────────────────────────────────────────────────────────────────

describe('several dates', () => {
  it('never mixes two files together', async () => {
    const f = fakeClient(series('p1', ['2026-09-01', '2026-09-20', '2026-09-30'], 3))
    const out = await fetchLatestBenchmarkWeights(f.client, 'p1')
    expect(out).toHaveLength(3)
    expect(out.every(r => r.as_of_date === '2026-09-30')).toBe(true)
  })

  it('tracks the newest file when a new one lands', async () => {
    const before = series('p1', ['2026-09-01'], 2)
    const after = [...before, ...series('p1', ['2026-10-01'], 2, 50)]

    const f1 = fakeClient(before)
    expect((await fetchLatestBenchmarkWeights(f1.client, 'p1'))[0].as_of_date).toBe('2026-09-01')

    const f2 = fakeClient(after)
    const out = await fetchLatestBenchmarkWeights(f2.client, 'p1')
    expect(out.every(r => r.as_of_date === '2026-10-01')).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3. No regression with a single snapshot
// ───────────────────────────────────────────────────────────────────────────

describe('a portfolio with exactly one snapshot', () => {
  it('returns it unchanged', async () => {
    const f = fakeClient(series('p1', ['2026-09-30'], 4))
    const out = await fetchLatestBenchmarkWeights(f.client, 'p1')
    expect(out).toHaveLength(4)
    expect(f.rowsTransferred).toBe(5) // probe + the file
  })

  it('handles an undated legacy file with `is null`, not `eq null`', async () => {
    // `as_of_date = NULL` is never true in SQL; an `eq` here would return the
    // file as empty and the portfolio would read as having no benchmark.
    const f = fakeClient([
      { portfolio_id: 'p1', asset_id: 'a', weight: 1, as_of_date: null },
      { portfolio_id: 'p1', asset_id: 'b', weight: 2, as_of_date: null },
    ])
    const out = await fetchLatestBenchmarkWeights(f.client, 'p1')
    expect(out).toHaveLength(2)
  })

  it('prefers a dated file over an undated one', async () => {
    const f = fakeClient([
      { portfolio_id: 'p1', asset_id: 'a', weight: 1, as_of_date: null },
      { portfolio_id: 'p1', asset_id: 'a', weight: 9, as_of_date: '2026-09-30' },
    ])
    const out = await fetchLatestBenchmarkWeights(f.client, 'p1')
    expect(out).toHaveLength(1)
    expect(out[0].weight).toBe(9)
  })

  it('distinguishes "no file" from "an undated file"', async () => {
    const none = fakeClient([])
    expect(await fetchLatestBenchmarkDate(none.client, 'p1')).toBeUndefined()

    const undated = fakeClient([{ portfolio_id: 'p1', asset_id: 'a', weight: 1, as_of_date: null }])
    expect(await fetchLatestBenchmarkDate(undated.client, 'p1')).toBeNull()
  })

  it('returns nothing for a portfolio with no file', async () => {
    const f = fakeClient(series('p1', ['2026-09-30'], 2))
    expect(await fetchLatestBenchmarkWeights(f.client, 'p-other')).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 4. Multi-portfolio, including divergent latest dates
// ───────────────────────────────────────────────────────────────────────────

describe('several portfolios whose newest dates DIFFER', () => {
  /*
   * The correctness trap in the multi-portfolio path. Production holds 33
   * dates for 7 portfolios, 13 for 23 of them, 5 for three and 1 for one;
   * their newest dates coincide today only because one capture run touched
   * all of them. A global `max(as_of_date)` would empty every book that had
   * not been refreshed that morning.
   */
  const rows = [
    ...series('p1', ['2026-09-01', '2026-09-30'], 2, 10), // newest 09-30
    ...series('p2', ['2026-09-01', '2026-09-20'], 2, 20), // newest 09-20
    ...series('p3', ['2026-09-10'], 2, 30),               // newest 09-10
  ]

  it('gives each portfolio its OWN newest file', async () => {
    const f = fakeClient(rows)
    const { rows: out, datesByPortfolio } = await fetchLatestBenchmarkWeightsFor(
      f.client, ['p1', 'p2', 'p3'],
    )
    expect(datesByPortfolio.get('p1')).toBe('2026-09-30')
    expect(datesByPortfolio.get('p2')).toBe('2026-09-20')
    expect(datesByPortfolio.get('p3')).toBe('2026-09-10')

    const byPortfolio = new Map<string, Set<string | null>>()
    for (const r of out as Row[]) {
      if (!byPortfolio.has(r.portfolio_id)) byPortfolio.set(r.portfolio_id, new Set())
      byPortfolio.get(r.portfolio_id)!.add(r.as_of_date)
    }
    expect(byPortfolio.get('p1')).toEqual(new Set(['2026-09-30']))
    expect(byPortfolio.get('p2')).toEqual(new Set(['2026-09-20']))
    expect(byPortfolio.get('p3')).toEqual(new Set(['2026-09-10']))
  })

  it('does not let one portfolio inherit another portfolio\'s date', async () => {
    // p1 HAS a 2026-09-01 file and p2's newest is 2026-09-20 — so a naive
    // `.in('as_of_date', [all newest])` would hand p1 extra rows. The backstop
    // must remove them.
    const f = fakeClient(rows)
    const { rows: out } = await fetchLatestBenchmarkWeightsFor(f.client, ['p1', 'p2', 'p3'])
    expect((out as Row[]).some(r => r.portfolio_id === 'p1' && r.as_of_date !== '2026-09-30')).toBe(false)
    expect((out as Row[]).some(r => r.portfolio_id === 'p2' && r.as_of_date !== '2026-09-20')).toBe(false)
  })

  it('still transfers far less than the whole history', async () => {
    const big = [
      ...series('p1', DATES, 100, 1),
      ...series('p2', DATES.slice(0, 13), 100, 2),
    ]
    const f = fakeClient(big)
    const { rows: out } = await fetchLatestBenchmarkWeightsFor(f.client, ['p1', 'p2'])

    expect(out).toHaveLength(200) // 100 names x 2 books
    // 2 probes + the rows for the two newest dates. p1 and p2 have different
    // newest dates, so the bound is 2 dates' worth, not 33.
    expect(f.rowsTransferred).toBeLessThanOrEqual(2 + 100 * 2 * 2)
    expect(f.rowsTransferred).toBeLessThan(big.length / 10)
  })

  it('handles a mix of dated and undated newest files', async () => {
    const f = fakeClient([
      ...series('p1', ['2026-09-30'], 2, 10),
      { portfolio_id: 'p2', asset_id: 'asset-0', weight: 99, as_of_date: null },
    ])
    const { rows: out } = await fetchLatestBenchmarkWeightsFor(f.client, ['p1', 'p2'])
    expect((out as Row[]).filter(r => r.portfolio_id === 'p1')).toHaveLength(2)
    expect((out as Row[]).filter(r => r.portfolio_id === 'p2')).toHaveLength(1)
  })

  it('skips portfolios with no file, and reports them as undefined', async () => {
    const f = fakeClient(series('p1', ['2026-09-30'], 2))
    const { rows: out, datesByPortfolio } = await fetchLatestBenchmarkWeightsFor(
      f.client, ['p1', 'p-empty'],
    )
    expect(datesByPortfolio.get('p-empty')).toBeUndefined()
    expect((out as Row[]).every(r => r.portfolio_id === 'p1')).toBe(true)
  })

  it('reads nothing at all for an empty portfolio list', async () => {
    const f = fakeClient(series('p1', ['2026-09-30'], 2))
    const { rows: out } = await fetchLatestBenchmarkWeightsFor(f.client, [])
    expect(out).toEqual([])
    expect(f.queries).toHaveLength(0)
  })

  it('de-duplicates a repeated portfolio id rather than probing twice', async () => {
    const f = fakeClient(series('p1', ['2026-09-30'], 2))
    await fetchLatestBenchmarkWeightsFor(f.client, ['p1', 'p1', 'p1'])
    expect(f.queries.filter(q => q.columns === 'as_of_date')).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 5. Measured production dimensions, as a regression bound
// ───────────────────────────────────────────────────────────────────────────

describe('the measured production case', () => {
  it('reads 482 rows where the old path read 15,898', async () => {
    // The real numbers from the audit: the largest portfolio held 33 dates of
    // 481-482 names. This pins the ratio so a regression is a failing number
    // rather than a slow page.
    const rows = series('p-largest', DATES, 481)
    expect(rows).toHaveLength(15873)

    const f = fakeClient(rows)
    const out = await fetchLatestBenchmarkWeights(f.client, 'p-largest')

    expect(out).toHaveLength(481)
    expect(f.rowsTransferred).toBe(482)
    expect(rows.length / f.rowsTransferred).toBeGreaterThan(30)
  })
})
