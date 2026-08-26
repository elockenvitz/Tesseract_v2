import { describe, it, expect } from 'vitest'

import {
  deviationFrom, referenceLabelFor, resolvePriceSnapshot, snapshotAgeDays,
} from '../price-snapshot'
import { upsidePct } from '../../mobile/exploration'

/**
 * The GOOGL defect, as an assertion.
 *
 * A `target_expired` card drew a chart ending at $348.06 and, two panes away,
 * an editor headed CURRENT PRICE $142.80 computing "+40.1% vs current" off it.
 * Both numbers were real — one the last close, one the holdings mark — and one
 * of them was wearing the other's label.
 */
const CLOSES = [
  { date: '2026-08-20', close: 341.10 },
  { date: '2026-08-21', close: 345.02 },
  { date: '2026-08-24', close: 348.06 },
]
const HOLDINGS = { holdingsMark: 142.80, holdingsAsOf: '2026-04-21T00:00:00.000Z' }

describe('resolvePriceSnapshot', () => {
  it('prefers the last close over the holdings mark', () => {
    const s = resolvePriceSnapshot({ closes: CLOSES, ...HOLDINGS })
    expect(s).toMatchObject({ price: 348.06, source: 'close', asOf: '2026-08-24' })
  })

  it('takes the LAST close even when the series arrives reversed', () => {
    // A caller handing this a descending series would otherwise price the card
    // off the oldest close, which looks exactly like a correct number.
    const s = resolvePriceSnapshot({ closes: [...CLOSES].reverse() })
    expect(s?.price).toBe(348.06)
  })

  it('falls back to the holdings mark, and does not call it current', () => {
    const s = resolvePriceSnapshot({ closes: [], ...HOLDINGS })
    expect(s).toMatchObject({ price: 142.80, source: 'holdings' })
    expect(referenceLabelFor(s)).toBe('Book mark')
    expect(referenceLabelFor(s)).not.toMatch(/current/i)
  })

  it('names the close "Current price", because that is what it is', () => {
    expect(referenceLabelFor(resolvePriceSnapshot({ closes: CLOSES }))).toBe('Current price')
  })

  it('drops zero and non-finite closes rather than pricing off them', () => {
    const s = resolvePriceSnapshot({
      closes: [{ date: '2026-08-24', close: 0 }, { date: '2026-08-25', close: Number.NaN }],
      ...HOLDINGS,
    })
    expect(s?.source).toBe('holdings')
  })

  it('is null when neither source has anything', () => {
    expect(resolvePriceSnapshot({ closes: [] })).toBeNull()
    expect(resolvePriceSnapshot({ closes: [], holdingsMark: 0, holdingsAsOf: '2026-01-01' })).toBeNull()
    // A mark with no date cannot be dated, and an undated price is not one.
    expect(resolvePriceSnapshot({ closes: [], holdingsMark: 12 })).toBeNull()
  })
})

describe('deviationFrom', () => {
  const snapshot = resolvePriceSnapshot({ closes: CLOSES, ...HOLDINGS })!

  it('measures the target against the canonical price, not the book mark', () => {
    // The card's own numbers must agree: a $245 target is BELOW a $348 close,
    // and the old editor called the same pair "+71.6%" off $142.80.
    expect(deviationFrom(245, snapshot)!).toBeCloseTo(((245 - 348.06) / 348.06) * 100, 6)
    expect(deviationFrom(245, snapshot)!).toBeLessThan(0)
  })

  it('is the same arithmetic the explorers use', () => {
    // One deviation function, so no two surfaces can disagree by rounding, by
    // sign convention, or by which number is the denominator.
    for (const target of [1, 99.99, 245, 500, 1605]) {
      expect(deviationFrom(target, snapshot)).toBe(upsidePct(target, snapshot.price))
    }
  })

  it('is null rather than zero when there is no price', () => {
    expect(deviationFrom(245, null)).toBeNull()
  })
})

describe('snapshotAgeDays', () => {
  it('dates the snapshot from its own asOf, never from now', () => {
    const s = resolvePriceSnapshot({ closes: CLOSES })!
    const now = new Date('2026-08-27T00:00:00.000Z').getTime()
    expect(snapshotAgeDays(s, now)).toBe(3)
  })

  it('never reports a negative age for a future-dated close', () => {
    const s = resolvePriceSnapshot({ closes: [{ date: '2026-12-01', close: 10 }] })!
    expect(snapshotAgeDays(s, new Date('2026-08-27').getTime())).toBe(0)
  })
})
