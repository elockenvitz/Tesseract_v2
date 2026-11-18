/**
 * The time axis has to carry enough labels to be read.
 *
 * ── The failure these exist to stop ──────────────────────────────────────
 *
 * The renderer chose a unit from a range table. A one-month window "is" a
 * month, so it labelled the month boundaries inside it -- of which a
 * thirty-day window contains exactly one. Measured in the browser on the
 * default Charting view (AAPL, 1M) before this change: ONE label, reading
 * "Nov 1", under thirty days of price, and one unlabelled vertical grid line
 * down the middle of the canvas, which reads as a rendering fault rather than
 * as a date.
 *
 * The unit is not the question. The count is. So every case below asserts a
 * count, at the window sizes the timeframe buttons actually produce, and the
 * 1M case is the regression itself.
 */
import { describe, it, expect } from 'vitest'
import {
  calendarGridTimes, timesForStep, DEFAULT_MIN_LABELS, DEFAULT_MAX_LABELS,
} from '../time-axis'

const DAY = 86_400
/** A fixed anchor, so these never depend on when they run. */
const NOW = Math.floor(Date.UTC(2026, 10, 18) / 1000)
const windowOf = (days: number) => [NOW - days * DAY, NOW] as const

/** The window each timeframe button opens, named as the button is. */
const TIMEFRAMES: [string, number][] = [
  ['1D', 1], ['1W', 7], ['1M', 30], ['3M', 90],
  ['6M', 180], ['1Y', 365], ['5Y', 365 * 5], ['ALL', 365 * 20],
]

describe('every timeframe gets a readable number of labels', () => {
  for (const [name, days] of TIMEFRAMES) {
    it(`${name} (${days} days) lands between ${DEFAULT_MIN_LABELS} and ${DEFAULT_MAX_LABELS} labels`, () => {
      const [from, to] = windowOf(days)
      const times = calendarGridTimes(from, to)
      expect(times.length, `${name} drew ${times.length} labels`).toBeGreaterThanOrEqual(DEFAULT_MIN_LABELS)
      expect(times.length, `${name} drew ${times.length} labels`).toBeLessThanOrEqual(DEFAULT_MAX_LABELS)
    })
  }

  it('the 1M view is no longer a single word under a month of price', () => {
    /* The regression, stated on its own. The old table produced exactly one
       label here, and that is the report this change answers. */
    const [from, to] = windowOf(30)
    expect(calendarGridTimes(from, to).length).toBeGreaterThan(1)
  })
})

describe('the labels stay inside the window and in order', () => {
  for (const [name, days] of TIMEFRAMES) {
    it(`${name} puts every label inside the visible range`, () => {
      const [from, to] = windowOf(days)
      for (const t of calendarGridTimes(from, to)) {
        expect(t, `${name}: a label at ${new Date(t * 1000).toISOString()} is outside the window`)
          .toBeGreaterThanOrEqual(from)
        expect(t).toBeLessThanOrEqual(to)
      }
    })
  }

  it('returns them ascending, because the renderer draws them in order', () => {
    const [from, to] = windowOf(365)
    const times = calendarGridTimes(from, to)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('has no duplicates, which would overdraw a grid line', () => {
    const [from, to] = windowOf(90)
    const times = calendarGridTimes(from, to)
    expect(new Set(times).size).toBe(times.length)
  })
})

describe('the alignment that was worth keeping', () => {
  it('a multi-year window lands on January 1st', () => {
    const times = calendarGridTimes(...windowOf(365 * 6))
    for (const t of times) {
      const d = new Date(t * 1000)
      expect(d.getMonth(), `label at ${d.toISOString()}`).toBe(0)
      expect(d.getDate()).toBe(1)
    }
  })

  it('a months-long window lands on the 1st of a month', () => {
    const times = calendarGridTimes(...windowOf(365))
    for (const t of times) {
      expect(new Date(t * 1000).getDate(), `label at ${new Date(t * 1000).toISOString()}`).toBe(1)
    }
  })
})

describe('degenerate input is refused rather than guessed at', () => {
  it('returns nothing for a zero-width window', () => {
    expect(calendarGridTimes(NOW, NOW)).toEqual([])
  })

  it('returns nothing for a backwards window', () => {
    expect(calendarGridTimes(NOW, NOW - DAY)).toEqual([])
  })

  it('returns nothing for a non-finite bound', () => {
    expect(calendarGridTimes(Number.NaN, NOW)).toEqual([])
    expect(calendarGridTimes(NOW - DAY, Number.POSITIVE_INFINITY)).toEqual([])
  })

  it('still labels a window shorter than a minute, rather than drawing a bare axis', () => {
    const times = calendarGridTimes(NOW, NOW + 20)
    expect(times.length).toBeGreaterThanOrEqual(DEFAULT_MIN_LABELS)
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(NOW)
      expect(t).toBeLessThanOrEqual(NOW + 20)
    }
  })
})

describe('a single step, on its own', () => {
  it('walks months from the 1st', () => {
    const from = Math.floor(Date.UTC(2026, 0, 15) / 1000)
    const to = Math.floor(Date.UTC(2026, 5, 15) / 1000)
    const times = timesForStep(from, to, { unit: 'month', every: 1 } as never)
    expect(times.length).toBeGreaterThanOrEqual(4)
    for (const t of times) expect(new Date(t * 1000).getDate()).toBe(1)
  })

  it('aligns a seconds step to a whole multiple, so a daily grid lands on midnight', () => {
    const from = NOW + 12345
    const times = timesForStep(from, from + DAY * 5, { unit: 'seconds', every: DAY } as never)
    for (const t of times) expect(t % DAY).toBe(0)
  })

  it('does not walk five million times for a one-minute step over ten years', () => {
    /* The guard exists because the selection loop asks every step for its
       count, including the finest over the widest window. Without a cap that
       single call takes longer than the whole render. */
    const started = Date.now()
    const times = timesForStep(NOW - DAY * 3650, NOW, { unit: 'seconds', every: 60 } as never)
    expect(Date.now() - started).toBeLessThan(500)
    expect(times.length).toBeGreaterThan(DEFAULT_MAX_LABELS)
  })
})
