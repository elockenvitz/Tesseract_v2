import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WeightSeries } from '../WeightSeries'
import type { WeightSeries as Series } from '../../../lib/portfolio/weight-series'

const series = (over: Partial<Series> = {}): Series => ({
  points: [
    { date: '2026-02-05', weightPct: 4.0, totalValue: 1000, pricedPct: 100, marked: 'snapshot' },
    { date: '2026-03-05', weightPct: 5.2, totalValue: 1100, pricedPct: 100, marked: 'snapshot' },
    { date: '2026-04-24', weightPct: 6.4, totalValue: 1200, pricedPct: 100, marked: 'snapshot' },
  ],
  skipped: [],
  bookNames: 29,
  pricedNames: 5,
  ...over,
})

describe('WeightSeries', () => {
  it('reads out the last point until one is tapped', () => {
    render(<WeightSeries symbol="AAPL" series={series()} />)
    expect(screen.getByTestId('weight-series-readout').textContent).toBe('6.40%')
  })

  it('moves the read-out to the tapped date', () => {
    render(<WeightSeries symbol="AAPL" series={series()} />)
    const svg = screen.getByTestId('weight-series-chart')
    svg.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
    fireEvent.pointerDown(svg, { clientX: 0 })
    expect(screen.getByTestId('weight-series-readout').textContent).toBe('4.00%')
  })

  it('says a single upload is not a series', () => {
    // Four books in the whole database have more than one snapshot. This is
    // the state almost every card is in, so it has to read as a fact rather
    // than as a broken chart.
    render(<WeightSeries symbol="AAPL" series={series({ points: [
      { date: '2026-02-05', weightPct: 4, totalValue: 1000, pricedPct: 100, marked: 'snapshot' },
    ] })} />)
    expect(screen.getByTestId('weight-series-empty').textContent).toMatch(/uploaded once/)
    expect(screen.queryByTestId('weight-series-chart')).toBeNull()
  })

  it('states the days it refused to price and the names it cannot price', () => {
    render(<WeightSeries symbol="AAPL" series={series({
      skipped: [
        { date: '2026-03-01', pricedPct: 12, reason: 'insufficient_price_coverage' },
        { date: '2026-03-02', pricedPct: 12, reason: 'insufficient_price_coverage' },
      ],
    })} />)
    const line = screen.getByTestId('weight-series-skipped').textContent ?? ''
    expect(line).toMatch(/2 days unpriced/)
    expect(line).toMatch(/5\/29 names have closes/)
  })

  it('keeps a skipped upload distinct from a missing price', () => {
    // Different facts. One is a gap in the price feed; the other is a
    // fragmentary upload that would have made a single holding 100% of the
    // book. Summing them into "3 skipped" hides which problem you have.
    render(<WeightSeries symbol="AAPL" series={series({
      skipped: [
        { date: '2026-03-01', pricedPct: 12, reason: 'insufficient_price_coverage' },
        { date: '2026-04-15', pricedPct: 100, reason: 'partial_snapshot', names: 1, expectedNames: 26 },
      ],
    })} />)
    const line = screen.getByTestId('weight-series-skipped').textContent ?? ''
    expect(line).toMatch(/1 days unpriced/)
    expect(line).toMatch(/1 partial upload skipped/)
  })

  it('draws a dot on snapshot marks and not on daily ones', () => {
    // An upload day and a marked day are different claims. A uniform line
    // would let two snapshots joined by nothing read like a continuous mark.
    const { container } = render(<WeightSeries symbol="AAPL" series={series({ points: [
      { date: '2026-02-05', weightPct: 4, totalValue: 1000, pricedPct: 100, marked: 'snapshot' },
      { date: '2026-02-06', weightPct: 4.1, totalValue: 1000, pricedPct: 99, marked: 'daily' },
      { date: '2026-02-07', weightPct: 4.3, totalValue: 1000, pricedPct: 99, marked: 'daily' },
    ] })} />)
    expect(container.querySelectorAll('[data-testid="weight-series-snapshot-dot"]')).toHaveLength(1)
  })

  it('calls the benchmark comparison "vs bench" with its date, never "active weight"', () => {
    // There is exactly one benchmark file in this database. A single dated
    // reading is not the quantity the active-risk card computes, and naming it
    // that would let a stale number inherit a precise meaning.
    render(<WeightSeries symbol="AAPL" series={series()}
      benchmark={{ weightPct: 6.70, asOf: '2026-08-14' }} />)
    const text = document.body.textContent ?? ''
    // Day/month ORDER is the runner's locale, so match on both parts rather
    // than one rendering of them — an assertion that passes only under en-GB
    // is a test of the CI machine, not of the component.
    expect(text).toMatch(/vs bench \((?:14 Aug|Aug 14)\)/)
    expect(text).not.toMatch(/active weight/i)
  })

  it('draws the benchmark as a level only when one is supplied', () => {
    const { container, rerender } = render(<WeightSeries symbol="AAPL" series={series()} />)
    expect(container.querySelector('[data-testid="weight-series-bench"]')).toBeNull()
    rerender(<WeightSeries symbol="AAPL" series={series()}
      benchmark={{ weightPct: 6.7, asOf: '2026-08-14' }} />)
    expect(container.querySelector('[data-testid="weight-series-bench"]')).not.toBeNull()
  })

  it('keeps the benchmark level on the axis when it sits outside the weights', () => {
    const { container } = render(<WeightSeries symbol="AAPL" series={series()}
      benchmark={{ weightPct: 40, asOf: '2026-08-14' }} />)
    const y = Number(container.querySelector('[data-testid="weight-series-bench"]')!.getAttribute('y1'))
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(64)
  })
})
