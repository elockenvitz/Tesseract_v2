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
