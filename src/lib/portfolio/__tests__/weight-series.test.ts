import { describe, it, expect } from 'vitest'
import { buildWeightSeries, type PositionRow, type DailyClose } from '../weight-series'

/**
 * The rule under test is not "does it draw a line". It is "does it refuse to
 * draw one it cannot support" — because the failure mode here is a smooth,
 * confident series built from carried-forward prices, which is unfalsifiable
 * by eye and wrong in the denominator.
 */

const A = 'asset-a'
const B = 'asset-b'

/** Two names, two snapshots. A doubles in price; B is flat. */
const ROWS: PositionRow[] = [
  { assetId: A, date: '2026-01-05', shares: 100, price: 10 },
  { assetId: B, date: '2026-01-05', shares: 100, price: 10 },
  { assetId: A, date: '2026-02-05', shares: 100, price: 20 },
  { assetId: B, date: '2026-02-05', shares: 100, price: 10 },
]

const closes = (m: Record<string, DailyClose[]>) =>
  new Map(Object.entries(m))

describe('buildWeightSeries', () => {
  it('produces a weight per snapshot date without any daily prices', () => {
    const s = buildWeightSeries({ rows: ROWS, subjectAssetId: A })
    expect(s.points.map(p => p.date)).toEqual(['2026-01-05', '2026-02-05'])
    // 1000/2000 then 2000/3000.
    expect(s.points[0].weightPct).toBeCloseTo(50, 5)
    expect(s.points[1].weightPct).toBeCloseTo(66.667, 2)
  })

  it('marks snapshot points as fully priced, because they are', () => {
    const s = buildWeightSeries({ rows: ROWS, subjectAssetId: A })
    expect(s.points.every(p => p.pricedPct === 100)).toBe(true)
    expect(s.points.every(p => p.marked === 'snapshot')).toBe(true)
  })

  it('SKIPS a day it cannot price rather than carrying prices forward', () => {
    // Only A has a close. B is half the book, so 50% coverage — nowhere near
    // the gate. Emitting this day would put A's real move over a denominator
    // holding B at a stale mark, and every weight in the book would be wrong
    // in a direction nobody can see.
    const s = buildWeightSeries({
      rows: ROWS,
      subjectAssetId: A,
      closesByAsset: closes({ [A]: [{ date: '2026-01-20', close: 15 }] }),
    })
    expect(s.points.some(p => p.date === '2026-01-20')).toBe(false)
    expect(s.skipped).toHaveLength(1)
    expect(s.skipped[0]).toMatchObject({ date: '2026-01-20', reason: 'insufficient_price_coverage' })
    expect(s.skipped[0].pricedPct).toBeCloseTo(60, 0)
  })

  it('emits a daily point once the whole book is priced', () => {
    const s = buildWeightSeries({
      rows: ROWS,
      subjectAssetId: A,
      closesByAsset: closes({
        [A]: [{ date: '2026-01-20', close: 15 }],
        [B]: [{ date: '2026-01-20', close: 10 }],
      }),
    })
    const day = s.points.find(p => p.date === '2026-01-20')
    expect(day).toBeDefined()
    // 1500 / 2500.
    expect(day!.weightPct).toBeCloseTo(60, 5)
    expect(day!.marked).toBe('daily')
    expect(day!.pricedPct).toBeCloseTo(100, 5)
  })

  it('carries SHARES forward but never prices', () => {
    // A position persists until traded — that is a fact, not an assumption.
    // The 20 Feb day uses the 5 Feb share counts and 20 Feb closes only.
    const s = buildWeightSeries({
      rows: ROWS,
      subjectAssetId: A,
      closesByAsset: closes({
        [A]: [{ date: '2026-02-20', close: 30 }],
        [B]: [{ date: '2026-02-20', close: 10 }],
      }),
    })
    const day = s.points.find(p => p.date === '2026-02-20')!
    // 100 shares still held, marked at 30 → 3000 / 4000.
    expect(day.weightPct).toBeCloseTo(75, 5)
    expect(day.totalValue).toBeCloseTo(4000, 5)
  })

  it('ignores closes from before the book was ever uploaded', () => {
    // There are no share counts to apply, so a weight there would be invented.
    const s = buildWeightSeries({
      rows: ROWS,
      subjectAssetId: A,
      closesByAsset: closes({
        [A]: [{ date: '2025-12-01', close: 9 }],
        [B]: [{ date: '2025-12-01', close: 9 }],
      }),
    })
    expect(s.points.some(p => p.date === '2025-12-01')).toBe(false)
  })

  it('never averages a daily mark with a snapshot on the same date', () => {
    const s = buildWeightSeries({
      rows: ROWS,
      subjectAssetId: A,
      closesByAsset: closes({
        [A]: [{ date: '2026-02-05', close: 40 }],
        [B]: [{ date: '2026-02-05', close: 10 }],
      }),
    })
    const onDate = s.points.filter(p => p.date === '2026-02-05')
    expect(onDate).toHaveLength(1)
    // The daily mark wins: it is the genuinely marked one.
    expect(onDate[0].marked).toBe('daily')
    expect(onDate[0].weightPct).toBeCloseTo(80, 5)
  })

  it('sums two lots of one name into a single position', () => {
    const twoLots: PositionRow[] = [
      { assetId: A, date: '2026-01-05', shares: 60, price: 10 },
      { assetId: A, date: '2026-01-05', shares: 40, price: 10 },
      { assetId: B, date: '2026-01-05', shares: 100, price: 10 },
    ]
    const s = buildWeightSeries({ rows: twoLots, subjectAssetId: A })
    expect(s.points[0].weightPct).toBeCloseTo(50, 5)
  })

  it('reports how much of the book can be priced at all', () => {
    const s = buildWeightSeries({
      rows: ROWS,
      subjectAssetId: A,
      closesByAsset: closes({ [A]: [{ date: '2026-02-20', close: 30 }] }),
    })
    // The number the card has to show: 1 of 2 names has any daily price. In
    // production this is 5-7 of 35-92.
    expect(s.bookNames).toBe(2)
    expect(s.pricedNames).toBe(1)
  })

  it('drops rows that cannot be valued instead of treating them as zero', () => {
    const dirty: PositionRow[] = [
      ...ROWS,
      { assetId: 'ghost', date: '2026-02-05', shares: 100, price: 0 },
      { assetId: 'nan', date: '2026-02-05', shares: NaN, price: 5 },
    ]
    const s = buildWeightSeries({ rows: dirty, subjectAssetId: A })
    // Unchanged from the clean case: a zero price is not a free position.
    expect(s.points[1].weightPct).toBeCloseTo(66.667, 2)
  })

  it('refuses a partial upload as a snapshot', () => {
    // Vision Fund 10K, real: 25 names, 26 names, then 1 name and 2 names. The
    // short ones are corrections, not the book. Treating a one-line upload as
    // a snapshot makes its lone holding 100% of the portfolio — a denominator
    // collapse that renders as a confident number rather than an error.
    const withFragment: PositionRow[] = [
      ...ROWS,
      { assetId: A, date: '2026-03-05', shares: 100, price: 25 },
    ]
    const s = buildWeightSeries({ rows: withFragment, subjectAssetId: A })
    expect(s.points.some(p => p.date === '2026-03-05')).toBe(false)
    expect(s.skipped).toContainEqual(
      expect.objectContaining({ date: '2026-03-05', reason: 'partial_snapshot', names: 1, expectedNames: 2 }),
    )
  })

  it('keeps a book that genuinely shrank a little', () => {
    // Three names down to two is a trim, not a fragment. The gate must not
    // eat real rebalances.
    const trimmed: PositionRow[] = [
      { assetId: A, date: '2026-01-05', shares: 100, price: 10 },
      { assetId: B, date: '2026-01-05', shares: 100, price: 10 },
      { assetId: 'c', date: '2026-01-05', shares: 100, price: 10 },
      { assetId: A, date: '2026-02-05', shares: 100, price: 10 },
      { assetId: B, date: '2026-02-05', shares: 100, price: 10 },
    ]
    const s = buildWeightSeries({ rows: trimmed, subjectAssetId: A })
    expect(s.points.map(p => p.date)).toEqual(['2026-01-05', '2026-02-05'])
    expect(s.points[1].weightPct).toBeCloseTo(50, 5)
  })

  it('returns an empty series rather than throwing on no rows', () => {
    const s = buildWeightSeries({ rows: [], subjectAssetId: A })
    expect(s.points).toEqual([])
    expect(s.bookNames).toBe(0)
  })
})
