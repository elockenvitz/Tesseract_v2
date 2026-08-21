import { describe, expect, it } from 'vitest'

import {
  beginExploration, commitExploration, displayedKind, displayedValue, isDirty,
  parseNumericEntry, pointsChange, propose, resetExploration, sliderRange, upsidePct,
} from '../exploration'

describe('the three values stay distinguishable', () => {
  it('shows the reference when nothing is recorded or proposed', () => {
    // A name with no target still needs somewhere for the control to start,
    // and the market price is the only number anybody has.
    const e = beginExploration(null, 182.4)
    expect(displayedValue(e)).toBe(182.4)
    expect(displayedKind(e)).toBe('reference')
  })

  it('prefers the record over the reference, and the proposal over both', () => {
    const e = beginExploration(210, 182.4)
    expect(displayedKind(e)).toBe('recorded')
    expect(displayedKind(propose(e, 225))).toBe('proposed')
    expect(displayedValue(propose(e, 225))).toBe(225)
  })

  it('starts with no proposal at all', () => {
    /**
     * Null rather than "equal to recorded". A control whose proposal happens
     * to match the record is visually identical to one nobody has touched, and
     * the difference decides whether Save should do anything.
     */
    expect(beginExploration(210, 182).proposed).toBeNull()
  })
})

describe('what counts as a change', () => {
  it('is nothing until the reader moves something', () => {
    expect(isDirty(beginExploration(210, 182))).toBe(false)
  })

  it('is a change when a name that had no target gets one', () => {
    expect(isDirty(propose(beginExploration(null, 182), 210))).toBe(true)
  })

  it('is not a change when the proposal lands back on the record', () => {
    // Saving this would write nothing and stamp an audit row saying somebody
    // made a decision.
    expect(isDirty(propose(beginExploration(210, 182), 210))).toBe(false)
  })

  it('tolerates the float noise a slider produces', () => {
    /**
     * A track stepping in cents yields values like 210.00000000000003, and
     * `!==` on those leaves Save permanently enabled on a control nobody
     * touched.
     */
    expect(isDirty(propose(beginExploration(210, 182), 210.00000000000003))).toBe(false)
  })
})

describe('committing', () => {
  it('turns the proposal into the record and stops exploring', () => {
    const done = commitExploration(propose(beginExploration(210, 182), 225))
    expect(done!.saved).toBe(225)
    expect(done!.next.recorded).toBe(225)
    expect(done!.next.proposed).toBeNull()
  })

  it('refuses to commit when there is nothing to commit', () => {
    // The caller cannot accidentally save one value and display another,
    // because it gets both from the same call or neither.
    expect(commitExploration(beginExploration(210, 182))).toBeNull()
    expect(commitExploration(propose(beginExploration(210, 182), 210))).toBeNull()
  })

  it('does not overwrite the record on a mere drag', () => {
    // Exploration must be visually and actually distinct from committed state.
    const explored = propose(beginExploration(210, 182), 300)
    expect(explored.recorded).toBe(210)
  })
})

describe('reset', () => {
  it('returns to the number of record', () => {
    const e = propose(beginExploration(210, 182), 300)
    expect(displayedValue(resetExploration(e))).toBe(210)
  })

  it('returns an untargeted name to the current price, not to zero', () => {
    const e = propose(beginExploration(null, 182), 300)
    expect(displayedValue(resetExploration(e))).toBe(182)
  })
})

describe('secondary figures', () => {
  it('computes upside against the reference', () => {
    expect(upsidePct(210, 182.4)!).toBeCloseTo(15.13, 1)
  })

  it('returns null rather than zero when there is no reference', () => {
    /**
     * 68 of 912 assets have a current price. A card that cannot compute upside
     * must say nothing — claiming the upside is flat is a number somebody
     * could act on.
     */
    expect(upsidePct(210, null)).toBeNull()
    expect(upsidePct(210, 0)).toBeNull()
  })

  it('measures a weight change in points, not in percent of a percent', () => {
    // 7.2% to 5.0% is 2.2 points. Calling it -30% is the classic way to make a
    // sizing control lie.
    expect(pointsChange(5.0, 7.2)!).toBeCloseTo(-2.2, 5)
  })
})

describe('the slider always reaches what the card is talking about', () => {
  it('spans every level it was given', () => {
    /**
     * A fixed window is wrong at both ends: too fine on a $3 name, and it puts
     * a bull case off the end of the track on one that has re-rated. Deriving
     * the range guarantees the reader can drag to the values on screen.
     */
    const r = sliderRange([182, 210, 95, 340])
    expect(r.min).toBeLessThan(95)
    expect(r.max).toBeGreaterThan(340)
  })

  it('never goes below zero', () => {
    expect(sliderRange([1, 2]).min).toBeGreaterThanOrEqual(0)
  })

  it('leaves room to propose beyond the levels already recorded', () => {
    /**
     * Span padding alone is too tight when the known levels sit close
     * together: a $182 price with a $210 target tops the track out at $220,
     * and the reader cannot propose $225 — on a control whose entire purpose
     * is exploring values nobody has recorded yet.
     */
    const r = sliderRange([182.4, 210])
    expect(r.max).toBeGreaterThanOrEqual(210 * 1.25)
  })

  it('puts its own bounds on its own step grid', () => {
    /**
     * An `<input type="range">` quantises to `min + n * step`. A minimum of
     * 9.2483 puts every reachable value on that offset grid, so a reader
     * aiming at 225 lands on 224.9483 — the number shown stops being the
     * number saved, which is the failure this control exists to prevent.
     */
    for (const points of [[182.4, 210], [3.2, 4.1], [1200, 1900]]) {
      const r = sliderRange(points)
      expect(Math.abs(r.min / r.step - Math.round(r.min / r.step)), String(points)).toBeLessThan(1e-6)
    }
  })

  it('copes with a single level, and with none', () => {
    expect(sliderRange([100]).max).toBeGreaterThan(100)
    expect(sliderRange([null, undefined])).toEqual({ min: 0, max: 100, step: 1 })
  })
})

describe('typed entry', () => {
  it('accepts what people actually type', () => {
    for (const [raw, want] of [['$210', 210], ['1,250.50', 1250.5], ['5.2%', 5.2], [' 210 ', 210]] as const) {
      expect(parseNumericEntry(raw), raw).toBe(want)
    }
  })

  it('rejects rather than coerces', () => {
    /**
     * `Number('')` is 0, and zero is a real value somebody could have meant.
     * Coercing an empty or malformed field into it would silently record a
     * target of nothing.
     */
    for (const raw of ['', '   ', 'abc', '-5', '0']) {
      expect(parseNumericEntry(raw), raw).toBeNull()
    }
  })
})
