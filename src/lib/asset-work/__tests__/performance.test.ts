/**
 * What the Work surface may say about a name's performance.
 *
 * ── The defect under test ───────────────────────────────────────────────
 *
 * "Check YTD performance" showed "+7.4% since Sep 18, 2025". That figure
 * was arithmetically correct and honestly stamped, and it was not the
 * number the requirement asked for: it was the move across the whole
 * 400-day cache window, because the surface had one price fact and reused
 * it everywhere.
 *
 * The fixture below is built so the two answers DIFFER and differ in
 * SIGN — the window return is positive and the year-to-date return is
 * negative. A test whose fixture drifts one way the whole time cannot
 * tell the implementations apart, so it would pass against the defect.
 *
 * The second group is about the baseline rule. A YTD measured from the
 * first close OF the year is a different statistic wearing the same name,
 * and the gap between Dec 31 and the first session of January is exactly
 * where the difference lives. `firstOfYearReturn` below computes the wrong
 * one on purpose, and the test asserts we do not produce it.
 */
import { describe, it, expect } from 'vitest'
import { readPerformance, describeBasis } from '../performance'
import { ytdReturn } from '../../lists/price-metrics'

type P = { date: string; close: number }

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Every weekday from `start` to `end` inclusive, priced along a line. */
function leg(start: string, end: string, firstClose: number, lastClose: number): P[] {
  const dates: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const stop = Date.parse(`${end}T00:00:00Z`)
  while (d.getTime() <= stop) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      dates.push(iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()))
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  const span = Math.max(1, dates.length - 1)
  return dates.map((date, i) => ({ date, close: firstClose + ((lastClose - firstClose) * i) / span }))
}

/**
 * The span the AMZN cache actually holds. Up through the back half of
 * 2025 to 240 on the last session of the year, a gap DOWN over the new
 * year to 200, then a recovery to 230 that never regains the year-start
 * price — so the year-to-date move is NEGATIVE while the move across the
 * whole cache window is strongly positive.
 */
const fixture = (): P[] => [
  ...leg('2025-08-18', '2025-12-31', 180, 240),
  ...leg('2026-01-02', '2026-10-01', 200, 230),
]

/** 23 Oct 2026, the day the surface was measured in the browser. */
const NOW = Date.UTC(2026, 9, 23, 12)

/** The implementation this replaces: first close in the window. */
const windowReturnPct = (s: P[]) => ((s[s.length - 1].close - s[0].close) / s[0].close) * 100

/** The other wrong one: the first close OF the year, not the last before it. */
function firstOfYearReturn(s: P[], year: number): number {
  const inYear = s.filter(p => p.date >= `${year}-01-01`)
  return ((inYear[inYear.length - 1].close - inYear[0].close) / inYear[0].close) * 100
}

describe('year-to-date is not the cache window', () => {
  const series = fixture()
  const reading = readPerformance(series, NOW)

  it('the fixture can tell the two apart', () => {
    /* The guard on the guard: if these ever agree, every assertion below
       would pass against the defect. */
    expect(windowReturnPct(series)).toBeGreaterThan(0)
    expect(reading.periods.YTD.pct!).toBeLessThan(0)
  })

  /** THE regression. */
  it('does not report the whole-window move as year-to-date', () => {
    expect(reading.periods.YTD.pct).not.toBeCloseTo(windowReturnPct(series), 4)
  })

  it('measures from the last close before January 1', () => {
    expect(reading.periods.YTD.from!.date).toBe('2025-12-31')
    expect(reading.periods.YTD.from!.close).toBeCloseTo(240, 6)
  })

  it('measures to the newest close held', () => {
    expect(reading.periods.YTD.to!.date).toBe('2026-10-01')
    expect(reading.periods.YTD.to).toEqual(reading.latest)
  })

  /** THE other regression: the first-session-of-January baseline. */
  it('is not the move since the first session of the year', () => {
    const wrong = firstOfYearReturn(series, 2026)
    expect(wrong).toBeGreaterThan(0)
    expect(reading.periods.YTD.pct!).toBeLessThan(0)
    expect(reading.periods.YTD.pct).not.toBeCloseTo(wrong, 4)
  })

  it('computes the arithmetic it claims', () => {
    const { from, to } = reading.periods.YTD
    expect(reading.periods.YTD.pct).toBeCloseTo(((to!.close - from!.close) / from!.close) * 100, 10)
  })

  it('states the two observation dates behind the figure', () => {
    expect(describeBasis(reading.periods.YTD)).toBe('Dec 31, 2025 → Oct 1, 2026')
  })
})

describe('a period the series cannot support is refused, never approximated', () => {
  it('refuses year-to-date when no close precedes January 1', () => {
    const march: P[] = [
      { date: '2026-03-02', close: 100 },
      { date: '2026-03-03', close: 110 },
      { date: '2026-10-01', close: 120 },
    ]
    const r = readPerformance(march, NOW).periods.YTD
    expect(r.pct).toBeNull()
    expect(r.from).toBeNull()
    expect(r.unavailable).toMatch(/No close held before Jan 1, 2026/)
  })

  it('refuses year-to-date when the newest close predates the year', () => {
    const stale: P[] = [
      { date: '2025-11-03', close: 100 },
      { date: '2025-12-31', close: 120 },
    ]
    const r = readPerformance(stale, NOW).periods.YTD
    expect(r.pct).toBeNull()
    expect(r.unavailable).toMatch(/predates 2026/)
  })

  it('refuses a three-month return over three weeks of history', () => {
    const sparse: P[] = [
      { date: '2026-09-10', close: 100 },
      { date: '2026-09-20', close: 105 },
      { date: '2026-10-01', close: 110 },
    ]
    const p = readPerformance(sparse, NOW).periods
    expect(p['3M'].pct).toBeNull()
    expect(p['3M'].unavailable).toMatch(/shorter than three months/)
  })

  it('says so rather than throwing on an empty series', () => {
    const r = readPerformance([], NOW)
    expect(r.latest).toBeNull()
    expect(r.coverage).toBeNull()
    for (const key of ['YTD', '1M', '3M'] as const) {
      expect(r.periods[key].pct).toBeNull()
      expect(r.periods[key].unavailable).toBeTruthy()
    }
  })

  it('refuses a span broken by a discontinuity rather than calling it a return', () => {
    /* A halving across the new year: a split is as likely as a collapse,
       and the two closes are not comparable either way. */
    const split: P[] = [
      { date: '2025-12-30', close: 400 },
      { date: '2025-12-31', close: 400 },
      { date: '2026-01-02', close: 200 },
      { date: '2026-10-01', close: 210 },
    ]
    const r = ytdReturn(split, NOW)
    expect(r.pct).toBeNull()
    expect(r.refused).toBe('not-comparable')
    /* The baseline is still reported, so the surface can say WHICH two
       closes it declined to compare. */
    expect(r.baseline!.date).toBe('2025-12-31')
  })
})

describe('the shorter horizons', () => {
  const reading = readPerformance(fixture(), NOW)

  it('measures one month from inside the series, stamped', () => {
    const m = reading.periods['1M']
    expect(m.pct).not.toBeNull()
    expect(m.from!.date < m.to!.date).toBe(true)
    expect(m.to!.date).toBe('2026-10-01')
  })

  it('gives three months a longer reach back than one month', () => {
    expect(reading.periods['3M'].from!.date < reading.periods['1M'].from!.date).toBe(true)
  })

  it('reports the coverage the cache actually holds', () => {
    const series = fixture()
    expect(reading.coverage).toEqual({
      from: '2025-08-18', to: '2026-10-01', observations: series.length,
    })
  })

  it('ages the latest close against now, not against the series', () => {
    expect(reading.latestAgeDays).toBe(22)
  })
})
