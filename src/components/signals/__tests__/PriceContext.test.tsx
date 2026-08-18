import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('moves the read-out to the tapped point', () => {
    render(<PriceContext symbol="MSFT" series={FRESH} now={NOW} />)
    const svg = screen.getByTestId('price-chart')
    // jsdom reports a zero-width rect for everything, and the component
    // correctly refuses to divide by it. Stub a real box so this exercises the
    // index maths rather than the guard.
    svg.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect

    fireEvent.pointerDown(svg, { clientX: 0 })
    expect(screen.getByTestId('price-readout').textContent).toBe('100.00')

    // Ten closes across 300px: the midpoint is index 4or5, either of which is
    // a real close. Asserting it is neither end proves the tap is read.
    fireEvent.pointerDown(svg, { clientX: 150 })
    const mid = screen.getByTestId('price-readout').textContent
    expect(mid).not.toBe('100.00')
    expect(mid).not.toBe('115.00')
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
