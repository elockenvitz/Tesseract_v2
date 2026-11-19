/**
 * Placing the cursor on a bar.
 *
 * The readout built on this runs on every mousemove over the canvas, so two
 * things matter beyond correctness: it must not report a bar the cursor is
 * nowhere near, and it must not take a linear scan of five thousand bars per
 * frame.
 */
import { describe, it, expect } from 'vitest'
import {
  barAtTime, reachForInterval, secondsForInterval,
} from '../bar-at-time'

const DAY = 86_400
const T0 = 1_760_000_000
/** Ten daily bars, ascending, as the chart holds them. */
const bars = Array.from({ length: 10 }, (_, i) => ({ time: T0 + i * DAY, value: i }))

describe('the bar under the cursor', () => {
  it('finds an exact hit', () => {
    expect(barAtTime(bars, T0 + 3 * DAY)?.value).toBe(3)
  })

  it('finds the nearest bar for a time between two', () => {
    /* The case an equality match gets wrong: `xToTime` inverts a pixel into
       a continuous timestamp, which is almost never a bar's own. */
    expect(barAtTime(bars, T0 + 3 * DAY + 1000)?.value).toBe(3)
    expect(barAtTime(bars, T0 + 4 * DAY - 1000)?.value).toBe(4)
  })

  it('breaks a tie toward the earlier bar', () => {
    // So the readout does not jump forward half a bar early.
    expect(barAtTime(bars, T0 + 3 * DAY + DAY / 2)?.value).toBe(3)
  })

  it('clamps to the first and last bar inside reach', () => {
    expect(barAtTime(bars, T0 - 100)?.value).toBe(0)
    expect(barAtTime(bars, T0 + 9 * DAY + 100)?.value).toBe(9)
  })

  it('reports nothing past the end of the series when a reach is given', () => {
    /* The regression this stops: panning into empty canvas past the final
       bar, and the readout staying pinned to that bar -- a row of specific
       numbers asserting the cursor is over something it is nowhere near. */
    expect(barAtTime(bars, T0 + 9 * DAY + DAY * 3, DAY)).toBeNull()
    expect(barAtTime(bars, T0 - DAY * 3, DAY)).toBeNull()
  })

  it('still reports a bar just outside the series but within reach', () => {
    expect(barAtTime(bars, T0 + 9 * DAY + DAY / 2, DAY)?.value).toBe(9)
  })

  it('returns null for an empty series, or no time', () => {
    expect(barAtTime([], T0)).toBeNull()
    expect(barAtTime(bars, null)).toBeNull()
    expect(barAtTime(bars, Number.NaN)).toBeNull()
  })

  it('handles a one-bar series', () => {
    expect(barAtTime([{ time: T0 }], T0 + 10)?.time).toBe(T0)
  })

  it('searches rather than scans', () => {
    /* Five thousand daily bars is the ALL view. A linear scan is five
       thousand comparisons per mousemove; this asserts the implementation
       does not do that, by counting the comparisons the array performs. */
    let reads = 0
    const big = new Proxy(
      Array.from({ length: 5000 }, (_, i) => ({ time: T0 + i * DAY })),
      {
        get(target, prop, recv) {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++
          return Reflect.get(target, prop, recv)
        },
      },
    )
    const hit = barAtTime(big as unknown as { time: number }[], T0 + 4000 * DAY)
    expect(hit?.time).toBe(T0 + 4000 * DAY)
    expect(reads, `read ${reads} elements for 5000 bars`).toBeLessThan(60)
  })
})

describe('how far a cursor may be from a bar', () => {
  it('is one bar, for a known interval', () => {
    expect(reachForInterval(secondsForInterval('1d'))).toBe(DAY)
    expect(reachForInterval(secondsForInterval('1h'))).toBe(3600)
  })

  it('is unbounded for an interval nobody has mapped', () => {
    /* Clamping to the nearest bar is the safer failure than reporting
       nothing at all for a bar size this table has not met. */
    expect(secondsForInterval('3d')).toBe(0)
    expect(reachForInterval(secondsForInterval('3d'))).toBe(Number.POSITIVE_INFINITY)
  })

  it('covers every interval the chart actually asks for', () => {
    /* Kept in step with `timeframeToParams` and the frequency picker: a gap
       here is not a crash, it is a readout that never clears. */
    for (const i of ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo']) {
      expect(secondsForInterval(i), `no bar size for ${i}`).toBeGreaterThan(0)
    }
  })
})
