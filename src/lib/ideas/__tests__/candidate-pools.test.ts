import { describe, expect, it } from 'vitest'
import {
  COVERAGE_WINDOW,
  RECENT_WINDOW,
  candidateRowBudget,
  compareScoredCandidates,
  fetchSourceCandidates,
  mergeCandidatePools,
  recentRange,
  relevanceRange,
  type CandidateQuery,
} from '../candidate-pools'

/**
 * These tests exist to pin one claim: an item can now be considered because the
 * reader is responsible for the name, and not only because it is recent.
 *
 * The claim was previously unfalsifiable. Retrieval and ranking were the same
 * function, so "the covered idea never appears" and "the covered idea ranks
 * last" looked identical from outside, and the fix for one is not the fix for
 * the other. `fetchSourceCandidates` takes a builder rather than a Supabase
 * client precisely so the retrieval half can be run against a table small
 * enough to reason about.
 */

const PAGE_SIZE = 15

const COVERED = '11111111-1111-4111-8111-111111111111'
const OTHER_ANALYST = '99999999-9999-4999-8999-999999999999'

interface Row {
  id: string
  created_at: string
  asset_id: string | null
}

const day = (n: number) => new Date(Date.UTC(2026, 7, 28) - n * 86_400_000).toISOString()

interface FakeSource {
  build: () => CandidateQuery
  /** One entry per query issued, so cost and scoping are assertable. */
  calls: { gte?: string; in?: string[]; range?: [number, number] }[]
}

/**
 * An in-memory table that behaves like the source queries do: ordered
 * `created_at` descending then `id` ascending — the total order the real
 * queries now request — and sliced by `range`.
 */
function fakeSource(rows: Row[], opts: { failOn?: 'recent' | 'relevance' } = {}): FakeSource {
  const calls: FakeSource['calls'] = []
  const build = (): CandidateQuery => {
    const call: FakeSource['calls'][number] = {}
    calls.push(call)
    let filtered = rows.slice()
    const q: CandidateQuery = {
      gte(column, value) {
        call.gte = value
        filtered = filtered.filter(r => String((r as any)[column]) >= value)
        return q
      },
      in(column, values) {
        call.in = [...values]
        filtered = filtered.filter(r => values.includes(String((r as any)[column])))
        return q
      },
      range(from, to) {
        call.range = [from, to]
        const failing = call.in ? 'relevance' : 'recent'
        if (opts.failOn === failing) {
          return Promise.resolve({ data: null, error: { message: 'boom' } })
        }
        const ordered = filtered.slice().sort((a, b) =>
          a.created_at === b.created_at
            ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            : (a.created_at < b.created_at ? 1 : -1))
        return Promise.resolve({ data: ordered.slice(from, to + 1), error: null })
      },
    }
    return q
  }
  return { build, calls }
}

/**
 * The fixture the ticket describes, built to sit either side of the old ceiling.
 *
 *   · 25 recent items on names nobody declared — more than the 20-row recency
 *     window, so they fill it on their own
 *   · one item on a directly covered name, old enough to fall outside it
 *   · one urgent recent item on an uncovered name, which must keep its place
 */
const RECENT_NOISE: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: `noise-${String(i).padStart(2, '0')}`,
  created_at: day(i + 1),
  asset_id: `noise-asset-${i}`,
}))
const URGENT_RECENT: Row = { id: 'urgent-recent', created_at: day(0), asset_id: 'urgent-asset' }
const OLD_COVERED: Row = { id: 'old-covered', created_at: day(60), asset_id: COVERED }
const OLD_OTHERS_COVERAGE: Row = { id: 'old-other', created_at: day(61), asset_id: OTHER_ANALYST }

const TABLE: Row[] = [URGENT_RECENT, ...RECENT_NOISE, OLD_COVERED, OLD_OTHERS_COVERAGE]

const read = (source: FakeSource, coveredAssetIds: string[], offset = 0) =>
  fetchSourceCandidates({
    build: source.build,
    recentSince: day(90),
    coverageSince: day(365),
    offset,
    pageSize: PAGE_SIZE,
    coveredAssetIds,
  })

// ── the ceiling, and its removal ───────────────────────────────────────────

describe('the failure mode: a covered idea outside the recency window', () => {
  it('OLD behaviour — recency alone never reaches the covered idea', async () => {
    const source = fakeSource(TABLE)
    const ids = (await read(source, [])).map(r => r.id)

    expect(ids).not.toContain(OLD_COVERED.id)
    expect(ids).toHaveLength(RECENT_WINDOW)
    // One query, because there was no coverage to ask about.
    expect(source.calls).toHaveLength(1)
  })

  it('NEW behaviour — declaring the name makes it a candidate', async () => {
    const source = fakeSource(TABLE)
    const ids = (await read(source, [COVERED])).map(r => r.id)

    expect(ids).toContain(OLD_COVERED.id)
  })

  /**
   * The guarantee the lift is not allowed to break, at the retrieval stage:
   * widening the candidate set must not narrow it anywhere else.
   */
  it('keeps every recent item it was already returning', async () => {
    const before = (await read(fakeSource(TABLE), [])).map(r => r.id)
    const after = (await read(fakeSource(TABLE), [COVERED])).map(r => r.id)

    expect(after).toEqual(expect.arrayContaining(before))
    expect(after).toContain(URGENT_RECENT.id)
  })

  /**
   * Retrieval decides membership, never precedence. A weak old covered item
   * being *considered* is the whole point; it winning is the ranker's call, and
   * the ranker still sees the urgent recent item ahead of it.
   */
  it('does not put the old covered item ahead of the urgent recent one', async () => {
    const rows = await read(fakeSource(TABLE), [COVERED])
    const ids = rows.map(r => r.id)
    expect(ids.indexOf(URGENT_RECENT.id)).toBeLessThan(ids.indexOf(OLD_COVERED.id))

    // And once scored, recency still decides between them: the covered item
    // enters the comparison rather than winning it.
    const scored = [
      { id: OLD_COVERED.id, created_at: OLD_COVERED.created_at, score: 0.4 },
      { id: URGENT_RECENT.id, created_at: URGENT_RECENT.created_at, score: 0.8 },
    ].sort(compareScoredCandidates)
    expect(scored[0].id).toBe(URGENT_RECENT.id)
  })

  it('does not pull in a name only another analyst covers', async () => {
    const ids = (await read(fakeSource(TABLE), [COVERED])).map(r => r.id)
    expect(ids).not.toContain(OLD_OTHERS_COVERAGE.id)
  })

  /**
   * The relevance pool reaches further back than the rolling window on purpose
   * — the item is a candidate because the reader owns the name, which is not a
   * fact about the calendar — so the two pools must be asking different
   * questions of the same table.
   */
  it('asks the relevance pool a different question, over the same filters', async () => {
    const source = fakeSource(TABLE)
    await read(source, [COVERED])

    expect(source.calls).toHaveLength(2)
    const [recent, relevance] = source.calls
    expect(recent.in).toBeUndefined()
    expect(relevance.in).toEqual([COVERED])
    // Both bounded, and the relevance pool bounded further back.
    expect(recent.gte).toBeDefined()
    expect(relevance.gte).toBeDefined()
    expect(relevance.gte! < recent.gte!).toBe(true)
    expect(recent.range).toEqual([0, RECENT_WINDOW - 1])
    expect(relevance.range).toEqual([0, COVERAGE_WINDOW - 1])
  })
})

// ── the cost of the feature for people who are not using it ────────────────

describe('a reader who has declared nothing pays nothing', () => {
  it('issues one query and returns the identical rows', async () => {
    const withCoverage = fakeSource(TABLE)
    const without = fakeSource(TABLE)

    const baseline = await read(without, [])
    const unchanged = await read(withCoverage, [])

    expect(unchanged.map(r => r.id)).toEqual(baseline.map(r => r.id))
    expect(withCoverage.calls).toHaveLength(1)
  })

  it('bounds the row budget, and adds nothing without coverage', () => {
    expect(candidateRowBudget(0, { hasCoverage: false })).toBe(4 * RECENT_WINDOW + 18)
    expect(candidateRowBudget(0, { hasCoverage: true }))
      .toBe(4 * RECENT_WINDOW + 4 * COVERAGE_WINDOW + 18)
    // The relevance pool is flat per page; only the pair leg window grows.
    const delta = candidateRowBudget(3, { hasCoverage: true }) - candidateRowBudget(3, { hasCoverage: false })
    expect(delta).toBe(4 * COVERAGE_WINDOW)
  })
})

// ── failure is survivable ──────────────────────────────────────────────────

describe('a failing pool degrades rather than empties the feed', () => {
  it('keeps the recency pool when the relevance query fails', async () => {
    const source = fakeSource(TABLE, { failOn: 'relevance' })
    const errors: string[] = []
    const rows = await fetchSourceCandidates({
      build: source.build,
      recentSince: day(90),
      coverageSince: day(365),
      offset: 0,
      pageSize: PAGE_SIZE,
      coveredAssetIds: [COVERED],
      onError: pool => errors.push(pool),
    })

    expect(rows).toHaveLength(RECENT_WINDOW)
    expect(rows.map(r => r.id)).toContain(URGENT_RECENT.id)
    expect(errors).toEqual(['relevance'])
  })

  it('reports a failing recency query rather than reading it as empty', async () => {
    const source = fakeSource(TABLE, { failOn: 'recent' })
    const errors: string[] = []
    const rows = await fetchSourceCandidates({
      build: source.build,
      recentSince: day(90),
      coverageSince: day(365),
      offset: 0,
      pageSize: PAGE_SIZE,
      coveredAssetIds: [COVERED],
      onError: pool => errors.push(pool),
    })

    expect(errors).toEqual(['recent'])
    // The relevance pool still stands, so the covered name survives the outage.
    expect(rows.map(r => r.id)).toEqual([OLD_COVERED.id])
  })
})

// ── pagination ─────────────────────────────────────────────────────────────

describe('pagination stays stable across load-more', () => {
  it('never returns the same row twice within a page', async () => {
    // A covered name that is ALSO recent — the overlap case, where both pools
    // legitimately return the same row.
    const alsoRecent: Row = { id: 'covered-and-recent', created_at: day(2), asset_id: COVERED }
    const source = fakeSource([...TABLE, alsoRecent])
    const ids = (await read(source, [COVERED])).map(r => r.id)

    expect(ids).toEqual([...new Set(ids)])
    expect(ids.filter(id => id === alsoRecent.id)).toHaveLength(1)
  })

  it('walks the relevance pool forward without overlapping itself', () => {
    const windows = [0, PAGE_SIZE, PAGE_SIZE * 2, PAGE_SIZE * 3]
      .map(offset => relevanceRange(offset, PAGE_SIZE))
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i][0]).toBe(windows[i - 1][1] + 1)
    }
    expect(windows[0]).toEqual([0, COVERAGE_WINDOW - 1])
  })

  it('leaves the recency window exactly as it was', () => {
    expect(recentRange(0)).toEqual([0, 19])
    expect(recentRange(PAGE_SIZE)).toEqual([15, 34])
  })

  it('returns different covered rows on the next page', async () => {
    const covered: Row[] = Array.from({ length: COVERAGE_WINDOW * 2 }, (_, i) => ({
      id: `covered-${String(i).padStart(2, '0')}`,
      created_at: day(100 + i),
      asset_id: COVERED,
    }))
    const source = fakeSource([...TABLE, ...covered])

    const page0 = (await read(source, [COVERED], 0)).map(r => r.id)
    const page1 = (await read(source, [COVERED], PAGE_SIZE)).map(r => r.id)

    const coveredOn = (ids: string[]) => ids.filter(id => id.startsWith('covered-'))
    expect(coveredOn(page0).length).toBeGreaterThan(0)
    expect(coveredOn(page1).length).toBeGreaterThan(0)
    expect(coveredOn(page0).some(id => coveredOn(page1).includes(id))).toBe(false)
  })
})

// ── merging and ordering ───────────────────────────────────────────────────

describe('mergeCandidatePools', () => {
  it('keeps the first occurrence and its position', () => {
    const merged = mergeCandidatePools(
      [[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]],
      r => r.id,
    )
    expect(merged.map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops rows with no usable id rather than colliding them', () => {
    const merged = mergeCandidatePools(
      [[{ id: '' }, { id: 'a' }]],
      r => r.id,
    )
    expect(merged.map(r => r.id)).toEqual(['a'])
  })

  it('is independent of which pool resolved first', () => {
    const a = [{ id: 'x' }, { id: 'y' }]
    const b = [{ id: 'y' }, { id: 'z' }]
    expect(mergeCandidatePools([a, b], r => r.id).map(r => r.id)).toEqual(['x', 'y', 'z'])
  })
})

describe('compareScoredCandidates is a total order', () => {
  const item = (id: string, score: number, created_at: string) => ({ id, score, created_at })

  it('orders by score, then recency, then id', () => {
    const rows = [
      item('b', 0.5, day(1)),
      item('a', 0.5, day(1)),
      item('c', 0.5, day(0)),
      item('d', 0.9, day(9)),
    ].sort(compareScoredCandidates)
    expect(rows.map(r => r.id)).toEqual(['d', 'c', 'a', 'b'])
  })

  /**
   * The property the desktop sort lacked. Two cards with equal scores must not
   * swap places between renders, or the feed moves under the reader and no test
   * of ordering can be trusted — the same requirement `compareRanked` states on
   * the mobile side.
   */
  it('produces the same order regardless of input order', () => {
    const rows = [
      item('a', 0.5, day(1)),
      item('b', 0.5, day(1)),
      item('c', 0.5, day(1)),
    ]
    const forwards = rows.slice().sort(compareScoredCandidates).map(r => r.id)
    const backwards = rows.slice().reverse().sort(compareScoredCandidates).map(r => r.id)
    expect(backwards).toEqual(forwards)
    expect(forwards).toEqual(['a', 'b', 'c'])
  })

  it('does not treat an unparseable timestamp as a tie-break win', () => {
    const rows = [
      item('bad', 0.5, 'not-a-date'),
      item('good', 0.5, day(5)),
    ].sort(compareScoredCandidates)
    expect(rows.map(r => r.id)).toEqual(['good', 'bad'])
  })
})
