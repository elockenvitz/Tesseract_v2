import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { PriceContext, type PricePoint } from '../PriceContext'

/**
 * The chart is easy to get right and easy to make lie. These assert the lies
 * it must not tell: no "now" on an axis that ends months ago, no silent
 * staleness, no band drawn off-canvas, and no comparison against anything the
 * series does not contain.
 */

/** Ten closes ending on a fixed date, so nothing here depends on the clock. */
const series = (endIso: string, closes: number[]): PricePoint[] => {
  const end = new Date(endIso).getTime()
  return closes.map((close, i) => ({
    date: new Date(end - (closes.length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    close,
  }))
}

const NOW = new Date('2026-08-18T00:00:00.000Z')
const FRESH = series('2026-08-14', [100, 102, 101, 105, 108, 106, 110, 112, 111, 115])
const STALE = series('2026-04-24', [100, 102, 101, 105, 108, 106, 110, 112, 111, 115])

describe('PriceContext', () => {
  it('names the window by its own dates and never says "now"', () => {
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    const window = screen.getByTestId('price-window').textContent ?? ''
    expect(window).toMatch(/Aug/)
    expect(window).not.toMatch(/now|today|Now|Today/)
  })

  it('shows the year when the window crosses one', () => {
    // A full trading year rendered "May 21 – May 13", which reads as eight
    // days and makes twelve months of drawdown look like a bad week.
    const yearLong = [
      { date: '2025-05-21', close: 452.57 },
      { date: '2025-11-19', close: 487.12 },
      { date: '2026-05-13', close: 405.21 },
    ]
    render(<PriceContext symbol="MSFT" series={yearLong} now={NOW} />)
    const window = screen.getByTestId('price-window').textContent ?? ''
    expect(window).toMatch(/’25/)
    expect(window).toMatch(/’26/)
  })

  it('omits the year when the window sits inside one', () => {
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    expect(screen.getByTestId('price-window').textContent).not.toMatch(/’/)
  })

  it('calls out a series that has gone stale', () => {
    // The whole reason this component was parked: AAPL's cache ends 24 Apr.
    // A chart that looks current while ending four months ago is the
    // fabricated-freshness defect drawn at 300 pixels wide.
    render(<PriceContext symbol="AAPL" series={STALE} now={NOW} />)
    const flag = screen.getByTestId('price-stale')
    expect(flag.textContent).toMatch(/not a current price/)
    expect(flag.textContent).toMatch(/116d old/)
  })

  it('does not flag a recent series', () => {
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    expect(screen.queryByTestId('price-stale')).toBeNull()
  })

  it('reads out the last close until something is tapped', () => {
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    expect(screen.getByTestId('price-readout').textContent).toBe('115.00')
  })

  it('moves the read-out only after a deliberate hold', () => {
    /**
     * A tap no longer scrubs, and that is the point.
     *
     * The chart sits inside a carousel that pages sideways and a feed that
     * scrolls vertically, so a quick drag over it belongs to one of those. Only
     * a press that stays still means "show me this day", which is what the hold
     * timer distinguishes.
     */
    vi.useFakeTimers()
    try {
      render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
      const svg = screen.getByTestId('price-chart')
      // jsdom reports a zero-width rect for everything, and the component
      // correctly refuses to divide by it. Stub a real box so this exercises
      // the index maths rather than the guard.
      svg.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
      const latest = screen.getByTestId('price-readout').textContent

      // Pressing alone does nothing until the hold elapses.
      fireEvent.pointerDown(svg, { clientX: 0 })
      expect(screen.getByTestId('price-readout').textContent).toBe(latest)

      act(() => { vi.advanceTimersByTime(300) })
      expect(screen.getByTestId('price-readout').textContent).toBe('100.00')

      // Ten closes across 300px: the midpoint is index 4 or 5, either of which
      // is a real close. Asserting it is neither end proves the move is read.
      fireEvent.pointerMove(svg, { clientX: 150 })
      const mid = screen.getByTestId('price-readout').textContent
      expect(mid).not.toBe('100.00')

      // And releasing puts it back on the latest close.
      fireEvent.pointerUp(svg, { clientX: 150 })
      expect(screen.getByTestId('price-readout').textContent).toBe(latest)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a swipe, which belongs to the carousel', () => {
    vi.useFakeTimers()
    try {
      render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
      const svg = screen.getByTestId('price-chart')
      svg.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
      const latest = screen.getByTestId('price-readout').textContent

      fireEvent.pointerDown(svg, { clientX: 250 })
      // Moved before the hold elapsed: this is a swipe.
      fireEvent.pointerMove(svg, { clientX: 100 })
      act(() => { vi.advanceTimersByTime(400) })

      expect(svg.getAttribute('data-scrubbing')).toBe('false')
      expect(screen.getByTestId('price-readout').textContent).toBe(latest)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a tap when the chart has no width to divide by', () => {
    // Guards the crosshair against NaN, which would render the line at x="NaN"
    // and drop it silently.
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    fireEvent.pointerDown(screen.getByTestId('price-chart'), { clientX: 40 })
    expect(screen.getByTestId('price-readout').textContent).toBe('115.00')
    expect(screen.getByTestId('price-crosshair').getAttribute('x1')).not.toMatch(/NaN/)
  })

  it('measures change against the first close in the window, not a live price', () => {
    // 100 -> 115. Any other number here means it reached for a quote.
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    expect(screen.getByText('+15.0%')).toBeTruthy()
  })

  it('keeps a band on the axis even when it is far above every close', () => {
    // AAPL's Uber Bull is 500 against a tape in the 200s. Scaling to the closes
    // alone would put the line off-canvas, turning "the tape is nowhere near
    // this case" into "there is no such case".
    const { container } = render(
      <PriceContext symbol="AAPL" series={FRESH} now={NOW}
        bands={[{ label: 'Uber Bull', price: 500, kind: 'case' }]} />,
    )
    const band = container.querySelector('[data-testid="price-band"]')
    expect(band).not.toBeNull()
    const y = Number(band!.getAttribute('y1'))
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(72)
  })

  it('states that there is no series rather than drawing one', () => {
    render(<PriceContext symbol="NVDA" series={[{ date: '2026-08-01', close: 180 }]} now={NOW} />)
    expect(screen.getByTestId('price-context-empty')).toBeTruthy()
    expect(screen.queryByTestId('price-chart')).toBeNull()
  })

  it('drops rows that cannot be plotted instead of charting a zero', () => {
    const dirty = [
      ...FRESH,
      { date: 'not-a-date', close: 120 },
      { date: '2026-08-15', close: 0 },
    ]
    render(<PriceContext symbol="MSFT" series={dirty} now={NOW} />)
    // Still the real last close, not the zero and not the undated row.
    expect(screen.getByTestId('price-readout').textContent).toBe('115.00')
  })
})

/** `n` daily closes ending today. */
function daily(n: number): PricePoint[] {
  const out: PricePoint[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(2026, 7, 21) - i * 86_400_000)
    out.push({ date: d.toISOString().slice(0, 10), close: 100 + (n - i) * 0.1 })
  }
  return out
}

const chips = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-price-range]')].map(b => b.getAttribute('data-price-range'))

describe('the range chips offer distinct windows', () => {
  it('drops Max when it would draw exactly what 1Y draws', () => {
    /**
     * Every cached series is roughly a trading year, so `1Y` and `ALL` select
     * the same window on almost every name. Two controls, one result, and the
     * reader taps both to find that out. `1Y` is the more informative label —
     * it says how much history there is — so `ALL` is the one that goes.
     */
    const { container } = render(<PriceContext symbol="AAPL" series={daily(360)} />)
    expect(chips(container)).toContain('1Y')
    expect(chips(container)).not.toContain('ALL')
  })

  it('keeps Max once the history genuinely exceeds a year', () => {
    // The redundancy is a property of today's 16-month cache, not a rule. When
    // history goes deeper, Max means something again.
    const { container } = render(<PriceContext symbol="AAPL" series={daily(900)} />)
    expect(chips(container)).toContain('ALL')
  })

  it('always offers at least one range', () => {
    // Deduplication must never empty the row.
    const { container } = render(<PriceContext symbol="AAPL" series={daily(20)} />)
    expect(chips(container).length).toBeGreaterThan(0)
  })

  it('never offers a range longer than the data', () => {
    // A chip that silently draws nothing is worse than a missing chip.
    const { container } = render(<PriceContext symbol="AAPL" series={daily(40)} />)
    expect(chips(container)).not.toContain('1Y')
    expect(chips(container)).not.toContain('6M')
  })
})

describe('the expand affordance', () => {
  it('is offered only when the card asks for it', () => {
    // The fullscreen chart renders a PriceContext of its own, and offering to
    // expand what is already expanded is furniture.
    const { container } = render(<PriceContext symbol="AAPL" series={daily(100)} />)
    expect(container.querySelector('[data-slot="chart-expand"]')).toBeNull()
  })

  it('sits beside the ranges rather than over the plot', () => {
    /**
     * A control floating on the chart would sit in the middle of the scrub
     * area and be pressed by accident during exactly the gesture it must not
     * interrupt.
     */
    const onExpand = vi.fn()
    const { container } = render(
      <PriceContext symbol="AAPL" series={daily(100)} onExpand={onExpand} />,
    )
    const btn = container.querySelector('[data-slot="chart-expand"]')!
    expect(btn.closest('[data-testid="price-ranges"]')).toBeTruthy()
    fireEvent.click(btn)
    expect(onExpand).toHaveBeenCalled()
  })
})

describe('case labels stay off each other', () => {
  /**
   * A ladder is a set of views on one name, so its cases sit close together in
   * price — and every band label is pinned to the same left edge. Centred on
   * their own rules, two cases a few dollars apart drew two 14px labels a few
   * pixels apart: they overlapped, the upper one won, and a case the analyst
   * had written was simply not on the chart.
   *
   * The y position is the price and cannot move. What moves is which side of
   * its own rule each label sits on, alternating by vertical rank so adjacent
   * cases are always a full label height apart.
   */
  const closes = [90, 95, 92, 98, 96, 101, 99, 104, 102, 106]
  const FLAT = series('2026-08-14', closes)

  const sides = (bands: { label: string; price: number; kind: 'case' | 'target' }[]) => {
    const { container } = render(<PriceContext symbol="MSFT" series={FLAT} bands={bands} now={NOW} />)
    return [...container.querySelectorAll('[data-testid="price-band-label"]')]
      .map(e => e.getAttribute('data-band-side'))
  }

  it('puts two neighbouring cases on opposite sides of their rules', () => {
    // Four dollars apart on a sixteen-dollar range — the collision, exactly.
    const out = sides([
      { label: 'Base', price: 96, kind: 'case' },
      { label: 'Bull', price: 100, kind: 'case' },
    ])
    expect(new Set(out).size).toBe(2)
  })

  it('alternates by price rather than by the order the card assembled them', () => {
    /**
     * `bands` arrives in whatever order the card built it. Alternating on the
     * array would put two vertical neighbours on the same side whenever the
     * input was not already sorted by price, which is most of the time.
     */
    const shuffled = sides([
      { label: 'Base', price: 96, kind: 'case' },
      { label: 'Bear', price: 92, kind: 'case' },
      { label: 'Bull', price: 100, kind: 'case' },
    ])
    // Rendered in input order: base, bear, bull → mid, low, high.
    // By height the ranks are bull(0), base(1), bear(2) → above, below, above.
    expect(shuffled).toEqual(['below', 'above', 'above'])
  })

  it('leans a label at the edge of the plot inward', () => {
    // The plot is `overflow-hidden`, so a label hanging past the top is cut in
    // half rather than merely awkward. An off-scale band is pinned just inside
    // the rail and is the common case for this.
    const out = sides([
      { label: 'Bull', price: 400, kind: 'case' },
      { label: 'Bear', price: 5, kind: 'case' },
    ])
    expect(out).toEqual(['below', 'above'])
  })

  it('draws every case it was given', () => {
    // The point of all of the above: three cases, three visible labels.
    const three = [
      { label: 'Bear', price: 92, kind: 'case' as const },
      { label: 'Base', price: 96, kind: 'case' as const },
      { label: 'Bull', price: 100, kind: 'case' as const },
    ]
    const { container } = render(<PriceContext symbol="MSFT" series={FLAT} bands={three} now={NOW} />)
    const labels = [...container.querySelectorAll('[data-testid="price-band-label"]')]
    expect(labels).toHaveLength(3)
    for (const c of three) {
      expect(labels.some(l => l.textContent?.includes(c.label))).toBe(true)
    }
  })
})

/**
 * A mouse is not a thumb.
 *
 * The hold exists to settle a fight between the chart, the carousel and the
 * feed over one finger. A mouse is in none of that, and requiring a
 * press-and-hold made this the only chart in the product where hovering did
 * nothing — every Recharts surface shows a tooltip on hover.
 */
describe('a mouse inspects on hover', () => {
  const boxed = () => {
    const svg = screen.getByTestId('price-chart')
    // jsdom reports a zero-width rect for everything, and the component
    // correctly refuses to divide by it.
    svg.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
    return svg
  }

  it('moves the read-out on hover, with no hold and no press', () => {
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    const svg = boxed()
    expect(screen.getByTestId('price-readout').textContent).toBe('115.00')

    fireEvent.pointerMove(svg, { clientX: 0, pointerType: 'mouse' })
    expect(screen.getByTestId('price-readout').textContent).toBe('100.00')
    expect(svg.getAttribute('data-scrubbing')).toBe('true')
  })

  it('follows the pointer across the window', () => {
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    const svg = boxed()
    fireEvent.pointerMove(svg, { clientX: 0, pointerType: 'mouse' })
    fireEvent.pointerMove(svg, { clientX: 300, pointerType: 'mouse' })
    expect(screen.getByTestId('price-readout').textContent).toBe('115.00')
  })

  it('restores the last close when the pointer leaves', () => {
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    const svg = boxed()
    fireEvent.pointerMove(svg, { clientX: 0, pointerType: 'mouse' })
    fireEvent.pointerLeave(svg, { pointerType: 'mouse' })
    expect(screen.getByTestId('price-readout').textContent).toBe('115.00')
    expect(svg.getAttribute('data-scrubbing')).toBe('false')
  })

  it('does not blank the read-out on a click', () => {
    // Ending the inspection on pointerup would clear the crosshair under a
    // mouse that has not moved, and the next move would put it straight back.
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    const svg = boxed()
    fireEvent.pointerMove(svg, { clientX: 0, pointerType: 'mouse' })
    fireEvent.pointerDown(svg, { clientX: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(svg, { clientX: 0, pointerType: 'mouse' })
    expect(screen.getByTestId('price-readout').textContent).toBe('100.00')
  })

  it('still makes a finger hold, which is the gesture that has rivals', () => {
    vi.useFakeTimers()
    try {
      render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
      const svg = boxed()
      fireEvent.pointerMove(svg, { clientX: 0, pointerType: 'touch' })
      expect(screen.getByTestId('price-readout').textContent).toBe('115.00')
      expect(svg.getAttribute('data-scrubbing')).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('changing the window ends the inspection', () => {
  it('leaves no crosshair and no armed hold behind', () => {
    // Clearing the picked index alone left `held` set, so the non-passive
    // touchmove blocker stayed armed against a plot that had just been
    // remounted under it.
    const long = series('2026-08-14', Array.from({ length: 400 }, (_, i) => 100 + i * 0.1))
    render(<PriceContext symbol="MSFT" series={long} now={NOW} />)
    const svg = screen.getByTestId('price-chart')
    svg.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect

    fireEvent.pointerMove(svg, { clientX: 0, pointerType: 'mouse' })
    expect(svg.getAttribute('data-scrubbing')).toBe('true')

    const chip = document.querySelector('[data-price-range="1M"]') as HTMLElement
    expect(chip).toBeTruthy()
    fireEvent.click(chip)

    // The plot is keyed on the range, so this is a fresh element.
    const after = screen.getByTestId('price-chart')
    expect(after.getAttribute('data-scrubbing')).toBe('false')
  })
})
