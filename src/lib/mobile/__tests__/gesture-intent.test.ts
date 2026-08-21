import { describe, expect, it } from 'vitest'

import { GESTURE, advanceGesture, beginGesture, holdStillPossible } from '../gesture-intent'

const P = (x: number, y: number) => ({ x, y })

/** Drive a gesture through a series of points, returning the final state. */
function drive(
  startedOn: 'chart' | 'slider' | null,
  moves: [number, number, number][], // dx, dy, elapsedMs
) {
  let s = beginGesture(P(100, 100), startedOn)
  for (const [dx, dy, ms] of moves) s = advanceGesture(s, P(100 + dx, 100 + dy), ms)
  return s
}

describe('nothing owns a gesture that has not moved', () => {
  it('stays undecided inside the slop', () => {
    // A finger on glass drifts. Below the slop there is no intent to read.
    expect(drive(null, [[3, 3, 50]]).owner).toBe('undecided')
  })

  it('treats a tap on the chart as a tap, not a scrub', () => {
    // No movement and no hold: this is a tap, and the chart must not engage.
    expect(drive('chart', [[0, 0, 10]]).owner).toBe('undecided')
  })
})

describe('vertical escape', () => {
  it('releases to the feed on a clear downward drag', () => {
    /**
     * The feed is the default surface. A scroll that hesitates reads as a
     * broken page, so vertical intent is recognised on a shorter travel than
     * horizontal — that asymmetry is the point, not an oversight.
     */
    expect(drive(null, [[0, 20, 40]]).owner).toBe('feed')
  })

  it('escapes even when the gesture began on the chart', () => {
    // Reported: a vertical swipe starting over a chart did nothing. Starting
    // on the chart must not pre-empt a scroll the reader clearly intends.
    expect(drive('chart', [[2, 30, 60]]).owner).toBe('feed')
  })

  it('reads an ambiguous diagonal as vertical', () => {
    /**
     * On a vertical feed a crooked scroll is far more common than a deliberate
     * diagonal swipe, so the tie goes to the feed. 20 across and 20 down is
     * inside the ratio and must not page the carousel.
     */
    expect(drive(null, [[20, 20, 40]]).owner).toBe('feed')
  })
})

describe('carousel ownership', () => {
  it('commits on a decisive sideways swipe', () => {
    expect(drive(null, [[40, 3, 40]]).owner).toBe('carousel')
  })

  it('makes the carousel earn it — slop alone is not enough', () => {
    // Past the slop we know the finger moved; the chart is still eligible, so
    // the carousel needs real travel before it claims the touch.
    const s = drive(null, [[GESTURE.SLOP_PX + 2, 0, 30]])
    expect(s.owner).toBe('undecided')
  })

  it('does not let the chart activate midway through a swipe', () => {
    /**
     * The explicit requirement: once the reader is clearly paging, a hold
     * timer firing must not snatch the gesture. Ownership is decided once.
     */
    let s = beginGesture(P(100, 100), 'chart')
    s = advanceGesture(s, P(140, 102), 40)
    expect(s.owner).toBe('carousel')
    s = advanceGesture(s, P(141, 102), 400) // long past CHART_HOLD_MS
    expect(s.owner).toBe('carousel')
  })
})

describe('chart ownership', () => {
  it('engages on a deliberate still press', () => {
    expect(drive('chart', [[1, 1, GESTURE.CHART_HOLD_MS]]).owner).toBe('chart')
  })

  it('will not engage on a card that is not a chart', () => {
    expect(drive(null, [[0, 0, 1000]]).owner).toBe('undecided')
  })

  it('keeps the scrub through the wobble of a real drag', () => {
    /**
     * A finger dragging sideways across a chart does not travel straight.
     * Losing the scrub because the thumb rose 20px is the single most annoying
     * way this can fail, so the chart holds on generously once engaged.
     */
    let s = drive('chart', [[0, 0, GESTURE.CHART_HOLD_MS]])
    expect(s.owner).toBe('chart')
    for (const [dx, dy] of [[30, 14], [60, -22], [90, 30], [120, -10]]) {
      s = advanceGesture(s, P(100 + dx, 100 + dy), 500)
      expect(s.owner).toBe('chart')
    }
  })

  it('gives the gesture up on a genuine vertical departure', () => {
    /**
     * Without this the reader is trapped: while the chart is engaged a
     * non-passive touchmove handler blocks the browser's pan, so the feed
     * cannot scroll until the chart lets go.
     */
    let s = drive('chart', [[0, 0, GESTURE.CHART_HOLD_MS]])
    s = advanceGesture(s, P(102, 100 + GESTURE.CHART_KEEP_PX + 10), 600)
    expect(s.owner).toBe('feed')
  })

  it('does not engage a hold that has wandered', () => {
    // Held long enough, but the finger left. That is a drag, not a press.
    expect(drive('chart', [[30, 0, 30], [30, 0, GESTURE.CHART_HOLD_MS + 100]]).owner)
      .not.toBe('chart')
  })
})

describe('slider ownership', () => {
  it('claims the gesture at pointer-down, with no dead zone', () => {
    // There is nothing to arbitrate: a pointer down on a thumb is unambiguous,
    // and any delay reads as an unresponsive control.
    expect(beginGesture(P(10, 10), 'slider').owner).toBe('slider')
  })

  it('cannot be stolen by the carousel or the feed', () => {
    // Reported: dragging a slider paged the carousel, and a slider drag
    // scrolled the feed. Ownership taken at pointerdown ends both.
    const s = drive('slider', [[80, 0, 40], [80, 60, 80]])
    expect(s.owner).toBe('slider')
  })
})

describe('hold viability', () => {
  it('is abandoned as soon as the finger leaves the slop', () => {
    // Cancel the timer when it can no longer fire, rather than letting it
    // expire into a state where the gesture has already gone elsewhere.
    const s = beginGesture(P(0, 0), 'chart')
    expect(holdStillPossible(s, P(2, 2))).toBe(true)
    expect(holdStillPossible(s, P(GESTURE.SLOP_PX + 1, 0))).toBe(false)
  })

  it('is impossible once anything else owns the gesture', () => {
    const s = drive(null, [[0, 30, 40]])
    expect(holdStillPossible(s, P(0, 30))).toBe(false)
  })
})

describe('the thresholds themselves', () => {
  it('recognises vertical intent sooner than horizontal', () => {
    // The asymmetry that makes the feed feel like the default surface.
    expect(GESTURE.FEED_ESCAPE_PX).toBeLessThan(GESTURE.CAROUSEL_INTENT_PX)
  })

  it('asks more of the carousel than of mere movement', () => {
    expect(GESTURE.CAROUSEL_INTENT_PX).toBeGreaterThan(GESTURE.SLOP_PX)
  })

  it('is more forgiving after the chart has ownership than before', () => {
    // Deciding is strict; keeping is generous.
    expect(GESTURE.CHART_KEEP_PX).toBeGreaterThan(GESTURE.FEED_ESCAPE_PX)
  })
})
