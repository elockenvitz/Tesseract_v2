import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { PairTradeChartCarousel } from '../PairTradeChartCarousel'
import type { PairTradeLeg } from '../../../hooks/ideas/types'

/**
 * Swipe paging on the pair-trade carousel, and why it is allowed back.
 *
 * ── The decision this pins ────────────────────────────────────────────────
 *
 * Paging by swipe was REMOVED here once, deliberately: paging a leg and
 * inspecting a price were both "drag horizontally", so whichever surface
 * claimed the gesture first won and the other became unreachable. The chart
 * was judged the more valuable of the two, and the carousel was reduced to
 * arrows and dots.
 *
 * `ChartScrubSurface` dissolves the conflict rather than picking a winner: the
 * chart now takes a gesture only after a deliberate press-and-hold, which
 * leaves a plain horizontal drag unambiguously the carousel's. Restoring the
 * swipe is only correct while that stays true, so these tests assert the
 * separation itself — a drag pages, and the declarations that keep the chart
 * out of a plain drag are still in place.
 *
 * If someone later removes the hold gate, the swipe becomes a regression
 * again. This file is where that shows up.
 *
 * ── Why the chart is a stand-in ───────────────────────────────────────────
 *
 * `ReelsChartPanel` is a Recharts instance with its own quote request. The
 * carousel's paging logic never reads it, so mounting the real one would trade
 * a slow, network-shaped test for no additional coverage. The double keeps the
 * `touch-action` wrapper around it, which IS under test.
 */

vi.mock('../ReelsChartPanel', () => ({
  ReelsChartPanel: ({ symbol }: { symbol: string }) => (
    <div data-testid={`chart-${symbol}`} />
  ),
}))

vi.mock('../../mobile/TickerQuoteBadge', () => ({
  TickerQuoteBadge: ({ symbol }: { symbol: string }) => <span>{symbol}</span>,
}))

function leg(id: string, symbol: string, action: string): PairTradeLeg {
  return {
    id,
    action: action as PairTradeLeg['action'],
    asset: { id: `a-${id}`, symbol, company_name: `${symbol} Inc` },
  }
}

const LONG = [leg('1', 'AAPL', 'buy')]
const SHORT = [leg('2', 'MSFT', 'sell')]

/**
 * A touch jsdom will carry.
 *
 * jsdom ships no `TouchEvent` constructor, and `useSwipe` reads only
 * `touches[0].clientX/clientY`, `cancelable` and `preventDefault` — so a plain
 * Event with a touch list attached exercises exactly the code under test.
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

/** The element `useSwipe` binds to — the positioned track holding the legs. */
function track(container: HTMLElement): Element {
  const el = container.querySelector('.flex-1.min-h-0.relative')
  if (!el) throw new Error('swipe track not found')
  return el
}

/** Which leg is the reachable one. The others are `aria-hidden`. */
function visibleSymbols(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[aria-hidden="false"]'))
    .flatMap(pane => Array.from(pane.querySelectorAll('[data-testid^="chart-"]')))
    .map(n => (n.getAttribute('data-testid') ?? '').replace('chart-', ''))
}

/** A drag, delivered as start → move → end. */
function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireTouch(el, 'touchstart', [from])
  fireTouch(el, 'touchmove', [to])
  fireTouch(el, 'touchend', [])
}

describe('pair-trade carousel paging', () => {
  it('a decisive sideways drag advances one leg', () => {
    const { container } = render(<PairTradeChartCarousel longLegs={LONG} shortLegs={SHORT} />)
    expect(visibleSymbols(container)).toEqual(['AAPL'])

    // Well past the 45px threshold and clearly more horizontal than the 1.2
    // axis ratio requires.
    drag(track(container), { x: 300, y: 200 }, { x: 200, y: 205 })

    expect(visibleSymbols(container)).toEqual(['MSFT'])
  })

  it('a drag back returns to the leg before it', () => {
    const { container } = render(<PairTradeChartCarousel longLegs={LONG} shortLegs={SHORT} />)
    drag(track(container), { x: 300, y: 200 }, { x: 200, y: 205 })
    expect(visibleSymbols(container)).toEqual(['MSFT'])

    drag(track(container), { x: 200, y: 200 }, { x: 300, y: 205 })
    expect(visibleSymbols(container)).toEqual(['AAPL'])
  })

  it('a vertical drag is left to the feed', () => {
    const { container } = render(<PairTradeChartCarousel longLegs={LONG} shortLegs={SHORT} />)

    // The feed pages vertically through this same element. A carousel that
    // claimed this would trap the reader on the card.
    drag(track(container), { x: 300, y: 200 }, { x: 295, y: 320 })

    expect(visibleSymbols(container)).toEqual(['AAPL'])
  })

  it('a short drag is not a page', () => {
    const { container } = render(<PairTradeChartCarousel longLegs={LONG} shortLegs={SHORT} />)

    // Under the 45px threshold: a thumb settling, not a swipe.
    drag(track(container), { x: 300, y: 200 }, { x: 270, y: 202 })

    expect(visibleSymbols(container)).toEqual(['AAPL'])
  })

  it('paging still works without a gesture at all', () => {
    const { container } = render(<PairTradeChartCarousel longLegs={LONG} shortLegs={SHORT} />)

    // The dots are the accessible route to the same state, and they were the
    // ONLY route while the swipe was removed. Restoring the swipe must not
    // quietly retire them.
    act(() => { screen.getByLabelText('Show SELL MSFT').click() })

    expect(visibleSymbols(container)).toEqual(['MSFT'])
  })

  it('the chart area still hands horizontal movement to the carousel', () => {
    render(<PairTradeChartCarousel longLegs={LONG} shortLegs={SHORT} />)

    // `pan-y` is the declaration that stops the browser panning the chart
    // sideways, which is what makes a horizontal drag available to `useSwipe`
    // at all. Losing it re-opens the conflict the swipe removal was about.
    // Read through `style.touchAction` rather than matching the attribute
    // text: the property is what the compositor acts on, and the attribute's
    // serialisation is the DOM implementation's business, not this contract's.
    let el: HTMLElement | null = screen.getByTestId('chart-AAPL')
    const declared: string[] = []
    while (el) {
      if (el.style?.touchAction) declared.push(el.style.touchAction)
      el = el.parentElement
    }
    expect(declared).toContain('pan-y')
  })

  it('one leg is not a carousel', () => {
    const { container } = render(<PairTradeChartCarousel longLegs={LONG} shortLegs={[]} />)

    // `useSwipe` is disabled below two legs. A drag that paged to nothing would
    // still have blocked the feed's vertical gesture on the way.
    drag(track(container), { x: 300, y: 200 }, { x: 200, y: 205 })

    expect(visibleSymbols(container)).toEqual(['AAPL'])
  })
})
