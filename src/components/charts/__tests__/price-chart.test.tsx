/**
 * PriceChart — the desktop price chart.
 *
 * jsdom has no layout engine, so `getBoundingClientRect` returns zeroes and
 * `ResizeObserver` does not exist. Both are stubbed here, which is what makes
 * the measurement contract testable at all: the component draws in PIXELS, so
 * "did it measure its box" is the single assumption everything else rests on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PriceChart, type PricePoint } from '../PriceChart'

// ── Harness ────────────────────────────────────────────────────────────

const BOX = { width: 900, height: 300 }

let originalRect: typeof Element.prototype.getBoundingClientRect
let observers: Array<{ el: Element; cb: ResizeObserverCallback }> = []

beforeEach(() => {
  originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    return {
      width: BOX.width, height: BOX.height, top: 0, left: 0,
      right: BOX.width, bottom: BOX.height, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect
  }
  observers = []
  ;(globalThis as any).ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) { observers.push({ el, cb: this.cb }) }
    unobserve() {}
    disconnect() { observers = observers.filter(o => o.cb !== this.cb) }
  }
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect
  delete (globalThis as any).ResizeObserver
})

/** `n` daily closes ending today, with enough shape to have a high and a low. */
function series(n: number, from = '2026-01-01'): PricePoint[] {
  const start = Date.parse(`${from}T12:00:00Z`)
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    close: 100 + Math.sin(i / 4) * 9 + i * 0.05,
  }))
}

const svgOf = (testId: string) =>
  screen.getByTestId(testId).closest('svg') as SVGSVGElement

// ── The measurement contract ───────────────────────────────────────────

describe('the chart measures the box it was given', () => {
  it('sizes its canvas to the measured box, not to a fallback', () => {
    render(<PriceChart symbol="LLY" series={series(120)} />)
    const svg = svgOf('price-chart-line')
    expect(svg.getAttribute('width')).toBe(String(BOX.width))
    expect(svg.getAttribute('height')).toBe(String(BOX.height))
  })

  /**
   * The regression that shipped: an observer that was never attached.
   *
   * The measurement lived in `useLayoutEffect(..., [])` reading a ref object.
   * On the first render the series had not arrived, so the component returned
   * its empty state, the plot div did not exist, `ref.current` was null, the
   * effect bailed — and because the dependency list was empty it never ran
   * again. When the series landed the plot rendered at whatever the stale
   * fallback said, measured 71px inside a 231px box on real data: a chart
   * drawn into the top third of its own container.
   *
   * Mounting empty and then populating is exactly that sequence, and it is
   * the sequence every caller produces, because price history is fetched.
   */
  it('measures when the series arrives after an empty first render', () => {
    const { rerender } = render(<PriceChart symbol="LLY" series={[]} />)
    expect(screen.getByTestId('price-chart-empty')).toBeInTheDocument()

    rerender(<PriceChart symbol="LLY" series={series(120)} />)
    const svg = svgOf('price-chart-line')
    expect(svg.getAttribute('height')).toBe(String(BOX.height))
    expect(svg.getAttribute('width')).toBe(String(BOX.width))
  })

  it('keeps observing, so a resize after mount still redraws', () => {
    render(<PriceChart symbol="LLY" series={series(120)} />)
    expect(observers.length).toBeGreaterThan(0)
    expect(observers.some(o => o.el === screen.getByTestId('price-chart').querySelector('div[tabindex]')))
      .toBe(true)
  })
})

// ── What the feed chart could not draw ─────────────────────────────────

describe('it draws what a pixel-space chart can', () => {
  it('labels the price axis at round numbers', () => {
    const { container } = render(<PriceChart symbol="LLY" series={series(120)} />)
    const labels = [...container.querySelectorAll('text')]
      .map(t => t.textContent ?? '')
      .filter(t => /^\d/.test(t))
    expect(labels.length).toBeGreaterThan(1)
    /*
     * Round, not `(max-min)/5`.
     *
     * The whole point of the nice-number walk is that a reader can place a
     * value against the scale without arithmetic, so every tick must be a
     * number somebody would have chosen: no 102.37 gridlines.
     */
    const numeric = labels.map(t => Number(t.replace(/,/g, ''))).filter(n => Number.isFinite(n))
    const steps = numeric.slice(1).map((n, i) => Math.abs(n - numeric[i])).filter(s => s > 0)
    for (const s of steps) {
      const mag = Math.pow(10, Math.floor(Math.log10(s)))
      expect([1, 2, 2.5, 5, 10]).toContain(Number((s / mag).toFixed(4)))
    }
  })

  it('offers only ranges the series can fill', () => {
    render(<PriceChart symbol="LLY" series={series(120)} />)
    const chips = within(screen.getByTestId('price-chart-ranges'))
      .getAllByRole('button').map(b => b.textContent)
    expect(chips).toEqual(['5D', '1M', '3M', 'ALL'])
    // A `1Y` chip over four months of history draws four months and lies.
    expect(chips).not.toContain('1Y')
  })

  it('draws a level per price and says when one is off the scale', () => {
    render(
      <PriceChart
        symbol="LLY"
        series={series(120)}
        levels={[
          { label: 'Target', price: 112, kind: 'target' },
          { label: 'Bear', price: 4000, kind: 'case' },
        ]}
      />,
    )
    const levels = screen.getAllByTestId('price-chart-level')
    expect(levels).toHaveLength(2)
    /*
     * A target far outside the traded range must not flatten the plot.
     *
     * Letting a 4,000 level expand the scale turns a year of price action
     * into a band one pixel tall at the bottom of the chart, which destroys
     * the only thing the chart is for. It is pinned to the edge and labelled
     * instead — present, and honest about being off-scale.
     */
    expect(screen.getByText(/Bear \(off scale\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Target \(off scale\)/)).not.toBeInTheDocument()
  })

  it('marks dated events on the line and drops those outside the window', () => {
    render(
      <PriceChart
        symbol="LLY"
        series={series(120)}
        initialRange="1M"
        events={[
          // Inside the last month of a series that starts 2026-01-01.
          { date: '2026-04-20', label: 'Case written', kind: 'case' },
          // Years before anything in the series.
          { date: '2020-01-01', label: 'Ancient', kind: 'idea' },
        ]}
      />,
    )
    const marks = screen.queryAllByTestId('price-chart-event')
    expect(marks).toHaveLength(1)
    expect(within(screen.getByTestId('price-chart')).getByText('Case written')).toBeInTheDocument()
  })
})

// ── Interrogation ──────────────────────────────────────────────────────

describe('the chart can be interrogated', () => {
  it('reports the last close until the reader points somewhere', () => {
    const data = series(120)
    render(<PriceChart symbol="LLY" series={data} initialRange="ALL" />)
    const last = data[data.length - 1].close
    expect(screen.getByTestId('price-chart-readout').textContent)
      .toBe(last.toFixed(2))
  })

  /**
   * The crosshair snaps to a close, never to a pixel.
   *
   * Interpolating between points would report a price for a day the market
   * was shut, which is inventing a quote. Keyboard scrub is the testable
   * path and exists for its own sake: a readout only reachable with a mouse
   * is a readout half the desk cannot use.
   */
  it('scrubs with the keyboard and reports a real close', async () => {
    const data = series(120)
    render(<PriceChart symbol="LLY" series={data} initialRange="ALL" />)
    const plot = screen.getByRole('img', { name: /Price history for LLY/ })
    plot.focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')

    const shown = screen.getByTestId('price-chart-readout').textContent
    const closes = data.map(p => p.close.toFixed(2))
    expect(closes).toContain(shown)
    // Two steps back from the end, not an interpolated value near it.
    expect(shown).toBe(data[data.length - 3].close.toFixed(2))
    expect(screen.getByTestId('price-chart-crosshair')).toBeInTheDocument()
  })

  it('narrows to a chosen range and reports it', async () => {
    const onRangeChange = vi.fn()
    render(<PriceChart symbol="LLY" series={series(120)} onRangeChange={onRangeChange} />)
    await userEvent.click(screen.getByRole('button', { name: '1M' }))
    expect(onRangeChange).toHaveBeenCalledWith('1M')
    expect(screen.getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says so plainly rather than drawing a line through one point', () => {
    render(<PriceChart symbol="LLY" series={[{ date: '2026-10-01', close: 100 }]} />)
    expect(screen.getByTestId('price-chart-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('price-chart-line')).not.toBeInTheDocument()
  })
})
