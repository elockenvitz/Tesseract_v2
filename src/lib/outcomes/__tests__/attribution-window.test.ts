/**
 * Performance that happened before a decision must never be attributed to it.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * QA org, 2026-11-20. A synthetic MSFT decision recorded at 00:26:25 UTC was
 * reported in Outcomes as +35.8% / +$156K, with the narrative "You increased
 * exposure to MSFT before strong appreciation. Conviction has been rewarded."
 *
 * The decision was twenty minutes old. The return was
 * $523.10 / $385.20 - 1, where $523.10 is the close of 2026-11-19 -- the day
 * BEFORE the decision -- and $385.20 is a snapshot copied from
 * `assets.current_price`, an undated column then holding a roughly July 2026
 * value. Every point of the move predates the decision.
 *
 * Two invariants are pinned here, and the fixtures are the real numbers.
 */
import { describe, it, expect } from 'vitest'
import {
  attributionWindow,
  positionDirection,
  INSUFFICIENT_DATA_LABEL,
} from '../attribution-window'

// The real MSFT row.
const DECISION_AT = '2026-11-20T00:26:25.221Z'
const LAST_CLOSE_AT = '2026-11-19T00:00:00.000Z'

describe('a move is attributed only when the market spoke after the decision', () => {
  // THE DEFECT.
  it('refuses the MSFT row: the newest close predates the decision', () => {
    const w = attributionWindow(DECISION_AT, LAST_CLOSE_AT)
    expect(w.canAttribute).toBe(false)
    expect(w.blockedBy).toBe('observation_predates_decision')
  })

  it('allows it once an observation lands after the decision', () => {
    const w = attributionWindow(DECISION_AT, '2026-11-20T21:00:00.000Z')
    expect(w.canAttribute).toBe(true)
    expect(w.blockedBy).toBeNull()
  })

  it('refuses an observation stamped at the same instant as the decision', () => {
    expect(attributionWindow(DECISION_AT, DECISION_AT).canAttribute).toBe(false)
  })

  // Fails closed, three ways.
  it('refuses when the decision has no time', () => {
    const w = attributionWindow(null, '2026-11-20T21:00:00.000Z')
    expect(w.canAttribute).toBe(false)
    expect(w.blockedBy).toBe('no_decision_time')
  })

  it('refuses when the price has no observation date', () => {
    const w = attributionWindow(DECISION_AT, null)
    expect(w.canAttribute).toBe(false)
    expect(w.blockedBy).toBe('no_observation_date')
  })

  it('refuses an unparseable date rather than treating it as valid', () => {
    expect(attributionWindow(DECISION_AT, 'not-a-date').canAttribute).toBe(false)
    expect(attributionWindow('whenever', '2026-11-20T21:00:00.000Z').canAttribute).toBe(false)
  })

  it('offers an insufficient-data label instead of a number', () => {
    expect(INSUFFICIENT_DATA_LABEL).toBe('Too early to evaluate')
  })
})

describe('direction comes from the shares, not the thesis', () => {
  // THE DEFECT: a BUY idea that cut the position.
  it('calls the MSFT 4800 -> 3126 change a sell', () => {
    expect(positionDirection(4800, 3126)).toBe('sell')
  })

  it('calls an increase a buy', () => {
    expect(positionDirection(4800, 6000)).toBe('buy')
  })

  it('calls an initiation a buy', () => {
    expect(positionDirection(0, 1500)).toBe('buy')
  })

  it('calls a full exit a sell', () => {
    expect(positionDirection(1000, 0)).toBe('sell')
  })

  it('returns null when nothing moved, so the caller may fall back', () => {
    expect(positionDirection(4800, 4800)).toBeNull()
  })

  it('returns null when a quantity is missing, rather than guessing', () => {
    expect(positionDirection(null, 3126)).toBeNull()
    expect(positionDirection(4800, undefined)).toBeNull()
    expect(positionDirection(Number.NaN, 10)).toBeNull()
  })

  it('never disagrees with the sign of the change', () => {
    const cases: Array<[number, number]> = [
      [4800, 3126], [4800, 6000], [0, 1500], [1000, 0], [500, -200],
    ]
    for (const [before, after] of cases) {
      const d = positionDirection(before, after)
      expect(d, `${before} -> ${after}`).toBe(after - before > 0 ? 'buy' : 'sell')
    }
  })
})
