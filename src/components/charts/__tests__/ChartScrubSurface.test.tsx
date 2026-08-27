import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { ChartScrubSurface } from '../ChartScrubSurface'
import { GESTURE } from '../../../lib/mobile/gesture-intent'

/**
 * The touch contract every Recharts chart in the product now shares.
 *
 * ── Why a stand-in for Recharts ───────────────────────────────────────────
 *
 * The surface talks to Recharts through exactly two DOM events on
 * `.recharts-wrapper`: a `mousemove` to move the crosshair, and the `mouseout`
 * React turns into `onMouseLeave` to clear it. Those two are the whole
 * interface, and they are the part that breaks.
 *
 * So the double below is a div with that class and React's `onMouseMove` /
 * `onMouseLeave` on it — the same handlers Recharts attaches in
 * `parseEventsOfWrapper`. That makes these tests assert the mechanism rather
 * than a chart library's internals, and it means the most important assertion
 * here is one a Recharts-based test could not make clearly: that a synthetic
 * `mouseout` with a null `relatedTarget` really does make React fire
 * `onMouseLeave`. Dispatching `mouseleave` directly does nothing — React
 * synthesises leave events from `mouseout` — and getting that wrong is the
 * difference between a fix and a no-op.
 */

interface Spy {
  move: Mock<() => void>
  leave: Mock<() => void>
}

function Chart({ spy }: { spy: Spy }) {
  return (
    <div
      className="recharts-wrapper"
      data-testid="wrapper"
      onMouseMove={() => spy.move()}
      onMouseLeave={() => spy.leave()}
    />
  )
}

function spies(): Spy {
  return { move: vi.fn(), leave: vi.fn() }
}

/**
 * A touch event jsdom will carry.
 *
 * jsdom ships no `TouchEvent` constructor, and the surface only ever reads
 * `touches[0].clientX/clientY`, `cancelable`, `preventDefault` and
 * `stopPropagation` — so a plain Event with a touch list attached exercises
 * exactly the code under test.
 */
function fireTouch(el: Element, type: string, points: { x: number; y: number }[]) {
  const ev = new Event(type, { bubbles: true, cancelable: type === 'touchmove' }) as Event & {
    touches: unknown[]
    changedTouches: unknown[]
  }
  const list = points.map(p => ({ clientX: p.x, clientY: p.y }))
  ev.touches = list
  ev.changedTouches = list
  act(() => { el.dispatchEvent(ev) })
  return ev
}

const HOLD = GESTURE.CHART_HOLD_MS

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('press and hold engages inspection', () => {
  it('does nothing until the hold elapses', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    expect(spy.move).not.toHaveBeenCalled()
    expect(surface.getAttribute('data-scrubbing')).toBe('false')

    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    expect(spy.move).toHaveBeenCalled()
    expect(surface.getAttribute('data-scrubbing')).toBe('true')
  })

  it('tracks the finger once engaged', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    const afterEngage = spy.move.mock.calls.length

    fireTouch(surface, 'touchmove', [{ x: 160, y: 104 }])
    expect(spy.move.mock.calls.length).toBeGreaterThan(afterEngage)
  })

  it('takes the browser pan away only after it has engaged', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    // Undecided: the feed and the carousel still own their axes.
    const early = fireTouch(surface, 'touchmove', [{ x: 103, y: 100 }])
    expect(early.defaultPrevented).toBe(false)

    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    const engaged = fireTouch(surface, 'touchmove', [{ x: 160, y: 100 }])
    expect(engaged.defaultPrevented).toBe(true)
  })
})

describe('a gesture that belongs to something else never scrubs', () => {
  it('ignores a swipe, which belongs to the carousel', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 250, y: 100 }])
    fireTouch(surface, 'touchmove', [{ x: 100, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD * 3) })

    expect(spy.move).not.toHaveBeenCalled()
    expect(surface.getAttribute('data-scrubbing')).toBe('false')
  })

  it('ignores a scroll, which belongs to the feed', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 300 }])
    fireTouch(surface, 'touchmove', [{ x: 100, y: 200 }])
    act(() => { vi.advanceTimersByTime(HOLD * 3) })

    expect(spy.move).not.toHaveBeenCalled()
  })

  it('keeps Recharts out of an ambiguous drag entirely', () => {
    // The drag is under every threshold, so nobody owns it yet. Recharts must
    // not scrub on it: its own touch path would have, on the first pixel.
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    fireTouch(surface, 'touchmove', [{ x: 104, y: 102 }])
    expect(spy.move).not.toHaveBeenCalled()
  })

  it('is not fooled by a second finger', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }, { x: 200, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD * 3) })
    expect(spy.move).not.toHaveBeenCalled()
  })
})

describe('release puts the chart back', () => {
  /**
   * The defect the whole surface exists for.
   *
   * Recharts forwards `touchend` to `handleMouseUp`, which does not clear the
   * tooltip — only `handleMouseLeave` does, and `mouseleave` never fires for a
   * finger. So every chart froze on the last touched point.
   */
  it('clears the tooltip when the finger lifts', () => {
    const spy = spies()
    const onRelease = vi.fn()
    render(
      <ChartScrubSurface testId="surface" onRelease={onRelease}>
        <Chart spy={spy} />
      </ChartScrubSurface>,
    )
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    expect(spy.leave).not.toHaveBeenCalled()

    fireTouch(surface, 'touchend', [])
    expect(spy.leave).toHaveBeenCalledTimes(1)
    expect(onRelease).toHaveBeenCalled()
    expect(surface.getAttribute('data-scrubbing')).toBe('false')
  })

  it('clears it when a native scroll cancels the touch', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    fireTouch(surface, 'touchcancel', [])

    expect(spy.leave).toHaveBeenCalledTimes(1)
    expect(surface.getAttribute('data-scrubbing')).toBe('false')
  })

  it('hands the gesture back when an engaged finger turns into a scroll', () => {
    // Without this the reader is trapped: the surface keeps calling
    // preventDefault and the feed will not move.
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 300 }])
    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    expect(surface.getAttribute('data-scrubbing')).toBe('true')

    fireTouch(surface, 'touchmove', [{ x: 100, y: 300 - GESTURE.CHART_KEEP_PX - 20 }])
    expect(spy.leave).toHaveBeenCalledTimes(1)
    expect(surface.getAttribute('data-scrubbing')).toBe('false')

    const after = fireTouch(surface, 'touchmove', [{ x: 100, y: 100 }])
    expect(after.defaultPrevented).toBe(false)
  })

  it('clears it when a scroll started somewhere else carries the chart away', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    act(() => { window.dispatchEvent(new Event('scroll')) })

    expect(spy.leave).toHaveBeenCalledTimes(1)
  })

  it('clears it on a rotation, which reflows the plot under a still finger', () => {
    const spy = spies()
    render(<ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>)
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    act(() => { window.dispatchEvent(new Event('orientationchange')) })

    expect(spy.leave).toHaveBeenCalledTimes(1)
  })
})

describe('state does not survive what it describes', () => {
  it('drops the inspection when the window changes', () => {
    // A read-out is a claim about a day in a particular window. Changing the
    // timeframe used to leave the dot and the price of a day the new chart
    // does not contain.
    const spy = spies()
    const onRelease = vi.fn()
    const { rerender } = render(
      <ChartScrubSurface testId="surface" resetKey="AAPL:1Y" onRelease={onRelease}>
        <Chart spy={spy} />
      </ChartScrubSurface>,
    )
    const surface = screen.getByTestId('surface')

    fireTouch(surface, 'touchstart', [{ x: 100, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD + 20) })
    expect(surface.getAttribute('data-scrubbing')).toBe('true')

    rerender(
      <ChartScrubSurface testId="surface" resetKey="AAPL:1M" onRelease={onRelease}>
        <Chart spy={spy} />
      </ChartScrubSurface>,
    )

    expect(spy.leave).toHaveBeenCalledTimes(1)
    expect(onRelease).toHaveBeenCalled()
    expect(surface.getAttribute('data-scrubbing')).toBe('false')
  })

  it('does not fire a release before anything has been interacted with', () => {
    const onRelease = vi.fn()
    render(
      <ChartScrubSurface testId="surface" resetKey="AAPL:1Y" onRelease={onRelease}>
        <Chart spy={spies()} />
      </ChartScrubSurface>,
    )
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('does not engage after unmounting mid-hold', () => {
    const spy = spies()
    const { unmount } = render(
      <ChartScrubSurface testId="surface"><Chart spy={spy} /></ChartScrubSurface>,
    )
    fireTouch(screen.getByTestId('surface'), 'touchstart', [{ x: 100, y: 100 }])
    unmount()
    act(() => { vi.advanceTimersByTime(HOLD * 3) })
    expect(spy.move).not.toHaveBeenCalled()
  })
})

describe('two charts on one screen', () => {
  it('does not leak inspection from one to the other', () => {
    // A feed shows several charts at once, and a pair-trade carousel keeps
    // neighbours mounted. Each surface owns its own gesture and its own
    // Recharts instance.
    const a = spies()
    const b = spies()
    render(
      <>
        <ChartScrubSurface testId="a"><Chart spy={a} /></ChartScrubSurface>
        <ChartScrubSurface testId="b"><Chart spy={b} /></ChartScrubSurface>
      </>,
    )
    const first = screen.getByTestId('a')
    const second = screen.getByTestId('b')

    fireTouch(first, 'touchstart', [{ x: 100, y: 100 }])
    act(() => { vi.advanceTimersByTime(HOLD + 20) })

    expect(first.getAttribute('data-scrubbing')).toBe('true')
    expect(second.getAttribute('data-scrubbing')).toBe('false')
    expect(a.move).toHaveBeenCalled()
    expect(b.move).not.toHaveBeenCalled()

    fireTouch(first, 'touchend', [])
    expect(a.leave).toHaveBeenCalledTimes(1)
    expect(b.leave).not.toHaveBeenCalled()
  })
})
