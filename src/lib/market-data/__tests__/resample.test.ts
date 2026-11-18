/**
 * Building the bar sizes EODHD does not publish.
 *
 * Seven of the fifteen Charting frequencies, and four of the ten timeframe
 * presets, ask for `15m`, `30m`, `1wk` or `1mo`. EODHD has no endpoint for
 * any of them, so routing the entitled account to EODHD broke all seven.
 *
 * These tests hold the line between combining real bars (fine, and what a
 * weekly bar IS) and inventing them (never).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resampleCandles, resamplePlanFor } from '../resample'
import type { Candle } from '../eodhd-series'

const bar = (time: string, o: number, h: number, l: number, c: number, v = 100): Candle =>
  ({ time, open: o, high: h, low: l, close: c, volume: v })

/* ────────────────────────── which sizes are built ─────────────────────── */

describe('the plan covers exactly the sizes EODHD lacks', () => {
  it('builds 15m and 30m from 5m', () => {
    expect(resamplePlanFor('15m')).toMatchObject({ base: '5m', target: '15m' })
    expect(resamplePlanFor('30m')).toMatchObject({ base: '5m', target: '30m' })
  })

  it('builds 1wk and 1mo from 1d', () => {
    expect(resamplePlanFor('1wk')).toMatchObject({ base: '1d', target: '1wk' })
    expect(resamplePlanFor('1mo')).toMatchObject({ base: '1d', target: '1mo' })
  })

  it('leaves the four sizes EODHD publishes alone', () => {
    // A plan for these would mean fetching a finer bar and rebuilding one the
    // provider would have handed over directly.
    for (const native of ['1m', '5m', '1h', '1d']) {
      expect(resamplePlanFor(native), native).toBeNull()
    }
  })

  it('covers every unpublished interval the UI can ask for', () => {
    /*
     * The real coverage check, read off the two sources rather than
     * hardcoded: every `apiInterval` in ChartingPage and every interval in
     * `timeframeToParams` must either be native to EODHD or have a plan.
     * Adding a frequency option without one would reintroduce the exact
     * regression, silently, for the entitled account only.
     */
    const charting = readFileSync(resolve(__dirname, '../../../pages/ChartingPage.tsx'), 'utf8')
    const chartData = readFileSync(resolve(__dirname, '../../chartData.ts'), 'utf8')

    const asked = new Set<string>()
    for (const m of charting.matchAll(/apiInterval:\s*'([^']+)'/g)) asked.add(m[1])
    const presets = /timeframeToParams[\s\S]*?\n\}/.exec(chartData)?.[0] ?? ''
    expect(presets, 'the timeframe preset map was not found').not.toBe('')
    expect(presets.length).toBeGreaterThan(100)
    for (const m of presets.matchAll(/interval:\s*'([^']+)'/g)) asked.add(m[1])

    expect(asked.size, 'no intervals were discovered — the regexes went stale')
      .toBeGreaterThan(5)

    const native = new Set(['1m', '5m', '1h', '1d'])
    const uncovered = [...asked].filter(i => !native.has(i) && resamplePlanFor(i) === null)
    expect(uncovered, 'these intervals would fail for the entitled account').toEqual([])
  })
})

/* ──────────────────────────── daily into weekly ───────────────────────── */

describe('a weekly bar is its daily bars combined', () => {
  // Mon 2026-11-02 .. Fri 2026-11-06, then Mon 2026-11-09.
  const week = [
    bar('2026-11-02', 10, 12, 9, 11, 1000),
    bar('2026-11-03', 11, 15, 10, 14, 2000),
    bar('2026-11-04', 14, 14, 8, 9, 1500),
    bar('2026-11-05', 9, 13, 9, 12, 500),
    bar('2026-11-06', 12, 13, 11, 13, 700),
    bar('2026-11-09', 13, 20, 13, 19, 900),
  ]

  it('takes open from the first day and close from the last', () => {
    const out = resampleCandles(week, '1wk')
    expect(out).toHaveLength(2)
    expect(out[0].open).toBe(10)   // Monday's open
    expect(out[0].close).toBe(13)  // Friday's close
  })

  it('takes the extremes across the whole week', () => {
    const [first] = resampleCandles(week, '1wk')
    expect(first.high).toBe(15)  // Tuesday
    expect(first.low).toBe(8)    // Wednesday
  })

  it('sums volume rather than averaging it', () => {
    const [first] = resampleCandles(week, '1wk')
    expect(first.volume).toBe(1000 + 2000 + 1500 + 500 + 700)
  })

  it('stamps the bar with the week, not the first bar it saw', () => {
    /*
     * The bucket's own Monday. If this used the first available bar instead,
     * a week whose Monday was a holiday would be stamped Tuesday, and the
     * same week would carry different dates in two different windows.
     */
    const holidayWeek = resampleCandles([
      bar('2026-11-03', 11, 15, 10, 14),
      bar('2026-11-04', 14, 14, 8, 9),
    ], '1wk')
    expect(holidayWeek).toHaveLength(1)
    expect(holidayWeek[0].time).toBe('2026-11-02')
  })

  it('closes the week on Sunday rather than opening a new one', () => {
    // Sunday 2026-11-08 belongs to the week that began Monday 2026-11-02.
    const out = resampleCandles([
      bar('2026-11-06', 12, 13, 11, 13),
      bar('2026-11-08', 13, 14, 12, 14),
    ], '1wk')
    expect(out).toHaveLength(1)
    expect(out[0].time).toBe('2026-11-02')
  })
})

/* ─────────────────────────── daily into monthly ───────────────────────── */

describe('monthly buckets follow the calendar', () => {
  it('groups by month and stamps the first', () => {
    const out = resampleCandles([
      bar('2026-10-30', 5, 6, 4, 6),
      bar('2026-11-02', 6, 9, 6, 8),
      bar('2026-11-30', 8, 10, 7, 7),
      bar('2026-12-01', 7, 7, 5, 5),
    ], '1mo')
    expect(out.map(c => c.time)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01'])
    expect(out[1].open).toBe(6)
    expect(out[1].close).toBe(7)
    expect(out[1].high).toBe(10)
  })

  it('does not let a timezone move a bar into the wrong month', () => {
    /*
     * The first and last day of a month are where an off-by-one-hour parse
     * shows up. A dated bar is sliced, never re-derived through a local Date.
     */
    const out = resampleCandles([
      bar('2026-03-01', 1, 1, 1, 1),
      bar('2026-03-31', 2, 2, 2, 2),
    ], '1mo')
    expect(out).toHaveLength(1)
    expect(out[0].time).toBe('2026-03-01')
  })
})

/* ──────────────────────── 5-minute into 15 and 30 ─────────────────────── */

describe('intraday buckets align to the clock', () => {
  // 2026-11-16 14:30:00Z onwards, in 5-minute steps.
  const t = (hhmm: string) => String(Math.floor(Date.parse(`2026-11-16T${hhmm}:00Z`) / 1000))

  const session = [
    bar(t('14:30'), 10, 11, 10, 10.5),
    bar(t('14:35'), 10.5, 12, 10.4, 11.8),
    bar(t('14:40'), 11.8, 11.9, 11, 11.2),
    bar(t('14:45'), 11.2, 13, 11.1, 12.9),
    bar(t('14:50'), 12.9, 13.2, 12, 12.1),
    bar(t('14:55'), 12.1, 12.5, 11.5, 12.4),
  ]

  it('makes two 15m bars from six 5m bars', () => {
    const out = resampleCandles(session, '15m')
    expect(out).toHaveLength(2)
    expect(out[0].time).toBe(t('14:30'))
    expect(out[1].time).toBe(t('14:45'))
    expect(out[0].open).toBe(10)
    expect(out[0].close).toBe(11.2)
    expect(out[0].high).toBe(12)
    expect(out[0].low).toBe(10)
  })

  it('makes one 30m bar from the same six', () => {
    const out = resampleCandles(session, '30m')
    expect(out).toHaveLength(1)
    expect(out[0].open).toBe(10)
    expect(out[0].close).toBe(12.4)
    expect(out[0].high).toBe(13.2)
    expect(out[0].low).toBe(10)
  })

  it('puts an instant in the same bucket regardless of the window around it', () => {
    /*
     * THE property that clock alignment buys. Bucketing from the first bar
     * instead would move every boundary when the window shifts, so panning
     * the chart by one bar would redraw every candle differently.
     */
    const full = resampleCandles(session, '15m')
    const shifted = resampleCandles(session.slice(1), '15m')
    expect(shifted[0].time).toBe(full[0].time)
    expect(shifted[1].time).toBe(full[1].time)
    // And the shifted first bucket now opens at the later bar.
    expect(shifted[0].open).toBe(10.5)
  })

  it('keeps unix seconds for intraday and dates for daily', () => {
    expect(resampleCandles(session, '15m')[0].time).toMatch(/^\d+$/)
    expect(resampleCandles([bar('2026-11-02', 1, 1, 1, 1)], '1wk')[0].time)
      .toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

/* ──────────────────────────── nothing invented ────────────────────────── */

describe('no bar is ever fabricated', () => {
  it('emits no candle for a bucket with no data', () => {
    /*
     * A market holiday is an ABSENT week, not a flat one. A zero-volume doji
     * drawn across a closed market is a lie shaped exactly like data.
     */
    const out = resampleCandles([
      bar('2026-11-02', 10, 11, 9, 10),
      // the week of 2026-11-09 is missing entirely
      bar('2026-11-16', 12, 13, 11, 12),
    ], '1wk')
    expect(out).toHaveLength(2)
    expect(out.map(c => c.time)).toEqual(['2026-11-02', '2026-11-16'])
  })

  it('returns nothing for nothing', () => {
    expect(resampleCandles([], '1wk')).toEqual([])
    expect(resampleCandles([], '15m')).toEqual([])
  })

  it('drops bars whose timestamp cannot be read, rather than guessing', () => {
    const out = resampleCandles([
      bar('not-a-date', 1, 1, 1, 1),
      bar('2026-11-02', 10, 11, 9, 10),
    ], '1wk')
    expect(out).toHaveLength(1)
    expect(out[0].open).toBe(10)
  })

  it('orders the input before combining, so open and close are the real ones', () => {
    // Out-of-order input must not make Wednesday's open the week's open.
    const out = resampleCandles([
      bar('2026-11-04', 14, 14, 8, 9),
      bar('2026-11-02', 10, 12, 9, 11),
      bar('2026-11-06', 12, 13, 11, 13),
    ], '1wk')
    expect(out).toHaveLength(1)
    expect(out[0].open).toBe(10)   // Monday
    expect(out[0].close).toBe(13)  // Friday
  })

  it('treats a missing volume as zero, not as a reason to drop the bar', () => {
    const out = resampleCandles([
      { time: '2026-11-02', open: 1, high: 2, low: 1, close: 2 } as Candle,
      bar('2026-11-03', 2, 3, 2, 3, 50),
    ], '1wk')
    expect(out).toHaveLength(1)
    expect(out[0].volume).toBe(50)
  })

  it('is exact on figures a float would round badly', () => {
    // Prices, not sums, so no accumulation error can creep into OHLC.
    const out = resampleCandles([
      bar('2026-11-02', 0.1, 0.3, 0.1, 0.2),
      bar('2026-11-03', 0.2, 0.2, 0.05, 0.15),
    ], '1wk')
    expect(out[0].open).toBe(0.1)
    expect(out[0].high).toBe(0.3)
    expect(out[0].low).toBe(0.05)
    expect(out[0].close).toBe(0.15)
  })
})

/* ──────────────────── the adapter still refuses substitution ──────────── */

describe('aggregation did not become provider substitution', () => {
  const chartData = readFileSync(resolve(__dirname, '../../chartData.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('still refuses an interval with no base to build from', () => {
    expect(chartData.length).toBeGreaterThan(2000)
    expect(chartData).toMatch(/kind: 'not_supported'/)
  })

  it('never reaches Yahoo from inside the EODHD branch', () => {
    const branch = /if \(provider === 'eodhd'\) \{[\s\S]*?\n {6}\}/.exec(chartData)?.[0] ?? ''
    expect(branch, 'the eodhd branch was not found').not.toBe('')
    expect(branch.length).toBeGreaterThan(80)
    expect(branch).not.toMatch(/fetchFromYahoo/)
  })

  it('resamples only when a base was substituted', () => {
    // `plan ? ... : baseCandles` — a native interval must pass through
    // untouched, or a 1d request would be re-bucketed for no reason.
    expect(chartData).toMatch(/plan \? resampleCandles\(/)
  })
})

/* ───────────────── the six sizes that never asked for themselves ──────── */

describe('a frequency option asks for the size it is named after', () => {
  /**
   * The gap the coverage test above could not see.
   *
   * That test asserts every `apiInterval` is FETCHABLE -- native or planned.
   * Six options passed it while asking for the wrong size, because `5m`,
   * `1h` and `1mo` are all perfectly fetchable; they were simply not what
   * the label said. "240 Min" asked for `1h` and drew hourly bars with the
   * control still reading 240 Min.
   *
   * So this reads the label and the interval off the same line and checks
   * they agree. A future option that borrows a neighbour's bar size fails
   * here by name.
   */
  const charting = readFileSync(resolve(__dirname, '../../../pages/ChartingPage.tsx'), 'utf8')

  /** Minutes for an intraday interval token; null for a dated one. */
  const minutesOfInterval = (interval: string): number | null => {
    const m = /^(\d+)(m|h)$/.exec(interval)
    if (!m) return null
    return Number(m[1]) * (m[2] === 'h' ? 60 : 1)
  }

  /** Minutes a label promises, e.g. "240 Min" -> 240; null if not intraday. */
  const minutesOfLabel = (label: string): number | null => {
    const m = /^(\d+)\s*Min$/i.exec(label.trim())
    return m ? Number(m[1]) : null
  }

  const DATED: Record<string, string> = {
    Daily: '1d',
    Weekly: '1wk',
    Monthly: '1mo',
    Quarterly: '1q',
    Yearly: '1y',
  }

  /* Every `{ label: '...', intervals: [...], apiInterval: '...' }` entry. */
  const entries = [
    ...charting.matchAll(
      /label:\s*'([^']+)',\s*intervals:\s*\[[^\]]*\],\s*apiInterval:\s*'([^']+)'/g,
    ),
  ].map(m => ({ label: m[1], interval: m[2] }))

  it('found the frequency table, so the assertions below are not vacuous', () => {
    /* A stale regex would make every case below pass over an empty list --
       the exact way a guard in this repo has gone quietly green before. */
    expect(entries.length).toBeGreaterThanOrEqual(14)
    expect(entries.map(e => e.label)).toContain('240 Min')
    expect(entries.map(e => e.label)).toContain('Quarterly')
  })

  it('matches every minute-labelled option to an interval of the same length', () => {
    const mismatched: string[] = []
    for (const { label, interval } of entries) {
      const wanted = minutesOfLabel(label)
      if (wanted === null) continue
      const got = minutesOfInterval(interval)
      if (got !== wanted) mismatched.push(`${label} asks for ${interval}`)
    }
    expect(mismatched, 'these options draw a bar width other than their label').toEqual([])
  })

  it('matches every dated option to its own calendar size', () => {
    const mismatched: string[] = []
    for (const { label, interval } of entries) {
      const wanted = DATED[label.trim()]
      if (!wanted) continue
      if (interval !== wanted) mismatched.push(`${label} asks for ${interval}`)
    }
    expect(mismatched, 'these options draw a period other than their label').toEqual([])
  })

  it('offers no Tick option, because there is no tick data to build it from', () => {
    /*
     * EODHD publishes no tick stream, and a 1m bar is not a tick at any
     * multiple -- so unlike the other five, this one could not be fixed by
     * aggregating. It was being served minute bars under a label promising
     * individual trades. Removing it is the honest form of not having it,
     * and this is what stops it coming back.
     */
    expect(entries.map(e => e.label)).not.toContain('Tick')
    expect(charting).not.toMatch(/tick:\s*\{\s*label:\s*'Tick'/)
  })
})

/* ─────────────────── the six new sizes, as arithmetic ─────────────────── */

describe('the added intraday sizes', () => {
  it('builds each from the largest published size that divides it', () => {
    /* 10m from 5m rather than 1m: two bars instead of ten, and the identical
       bar, because the high of two 5m highs is the high of the ten 1m highs
       they were built from. */
    expect(resamplePlanFor('3m')).toMatchObject({ base: '1m', target: '3m' })
    expect(resamplePlanFor('10m')).toMatchObject({ base: '5m', target: '10m' })
    expect(resamplePlanFor('2h')).toMatchObject({ base: '1h', target: '2h' })
    expect(resamplePlanFor('4h')).toMatchObject({ base: '1h', target: '4h' })
  })

  it('combines three 1m bars into one 3m bar, aligned to the clock', () => {
    /* 09:30, 09:31 and 09:32 UTC all fall in the 3m bucket opening 09:30.
       09:33 would open the NEXT one, which is the point of clock alignment. */
    const base = Date.UTC(2026, 10, 17, 9, 30) / 1000
    const out = resampleCandles(
      [
        bar(String(base), 10, 12, 9, 11, 100),
        bar(String(base + 60), 11, 15, 10, 14, 200),
        bar(String(base + 120), 14, 14, 13, 13, 300),
      ],
      '3m',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ open: 10, high: 15, low: 9, close: 13, volume: 600 })
    expect(Number(out[0].time)).toBe(Date.UTC(2026, 10, 17, 9, 30) / 1000)
  })

  it('splits a 4h boundary at the clock, not at the first bar', () => {
    /* 03:00 and 04:00 UTC belong to different 4h buckets (00:00 and 04:00),
       so two bars in, two bars out -- not one. */
    const three = Date.UTC(2026, 10, 17, 3, 0) / 1000
    const out = resampleCandles(
      [bar(String(three), 10, 11, 9, 10), bar(String(three + 3600), 20, 21, 19, 20)],
      '4h',
    )
    expect(out).toHaveLength(2)
    expect(Number(out[0].time)).toBe(Date.UTC(2026, 10, 17, 0, 0) / 1000)
    expect(Number(out[1].time)).toBe(Date.UTC(2026, 10, 17, 4, 0) / 1000)
  })

  it('puts two 1h bars inside one 2h bucket', () => {
    const start = Date.UTC(2026, 10, 17, 14, 0) / 1000
    const out = resampleCandles(
      [bar(String(start), 10, 11, 9, 10, 5), bar(String(start + 3600), 10, 20, 8, 18, 7)],
      '2h',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ open: 10, high: 20, low: 8, close: 18, volume: 12 })
  })
})

describe('quarterly and yearly follow the calendar', () => {
  it('builds both from daily bars, not from monthly ones', () => {
    /*
     * Resampling a resampling would make the quarter inherit whatever the
     * month's bucketing decided. One aggregation step is what makes the
     * provenance claim -- every figure is an EODHD daily bar -- literally so.
     */
    expect(resamplePlanFor('1q')).toMatchObject({ base: '1d', target: '1q' })
    expect(resamplePlanFor('1y')).toMatchObject({ base: '1d', target: '1y' })
  })

  it('groups a quarter into one bar stamped at the quarter start', () => {
    const out = resampleCandles(
      [
        bar('2026-04-01', 100, 110, 95, 105, 10),
        bar('2026-05-15', 105, 130, 100, 120, 20),
        bar('2026-06-30', 120, 125, 90, 92, 30),
      ],
      '1q',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      time: '2026-04-01', open: 100, high: 130, low: 90, close: 92, volume: 60,
    })
  })

  it('does NOT bucket a quarter by month', () => {
    /*
     * The trap this guards. `bucketOf` used to read
     * `target === '1wk' ? week : month`, so any dated target that was not
     * weekly fell through to MONTHLY -- and a quarter added without touching
     * that line would have produced twelve bars a year under a Quarterly
     * label. Same defect class as the one this change removes.
     */
    const out = resampleCandles(
      [bar('2026-04-10', 1, 1, 1, 1), bar('2026-05-10', 2, 2, 2, 2), bar('2026-06-10', 3, 3, 3, 3)],
      '1q',
    )
    expect(out).toHaveLength(1)
  })

  it('separates the four calendar quarters', () => {
    const out = resampleCandles(
      [
        bar('2026-02-02', 1, 1, 1, 1),
        bar('2026-04-02', 2, 2, 2, 2),
        bar('2026-08-02', 3, 3, 3, 3),
        bar('2026-11-02', 4, 4, 4, 4),
      ],
      '1q',
    )
    expect(out.map(c => c.time)).toEqual([
      '2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01',
    ])
  })

  it('opens Q1 in January, not in a fiscal month', () => {
    /* A fiscal year differs per company; two charts would then disagree
       about when a quarter began for no reason a reader could see. */
    const out = resampleCandles([bar('2026-01-05', 1, 1, 1, 1)], '1q')
    expect(out[0].time).toBe('2026-01-01')
  })

  it('groups a year into one bar stamped 1 January', () => {
    const out = resampleCandles(
      [
        bar('2026-01-02', 100, 110, 95, 105, 10),
        bar('2026-07-01', 105, 200, 90, 180, 20),
        bar('2026-12-31', 180, 185, 170, 175, 30),
      ],
      '1y',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      time: '2026-01-01', open: 100, high: 200, low: 90, close: 175, volume: 60,
    })
  })

  it('separates two years', () => {
    const out = resampleCandles(
      [bar('2025-12-31', 1, 1, 1, 1), bar('2026-01-01', 2, 2, 2, 2)],
      '1y',
    )
    expect(out.map(c => c.time)).toEqual(['2025-01-01', '2026-01-01'])
  })

  it('emits no bar for a year with no data, as everywhere else here', () => {
    const out = resampleCandles(
      [bar('2024-06-01', 1, 1, 1, 1), bar('2026-06-01', 2, 2, 2, 2)],
      '1y',
    )
    /* 2025 is absent, not flat. A zero-volume doji across a year with no
       bars is a lie that looks like data. */
    expect(out.map(c => c.time)).toEqual(['2024-01-01', '2026-01-01'])
  })
})
