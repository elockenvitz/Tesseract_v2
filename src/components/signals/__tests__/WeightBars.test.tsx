import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WeightBars, type WeightRow } from '../WeightBars'

const ROWS: WeightRow[] = [
  { label: 'Current', weightPct: 4.0, tone: 'subject' },
  { label: 'Proposed', weightPct: 1.5, tone: 'proposed' },
  { label: 'Benchmark', weightPct: 0.42, tone: 'reference', note: 'SPY 14 Aug' },
]

describe('WeightBars', () => {
  it('draws a row per usable weight', () => {
    render(<WeightBars rows={ROWS} />)
    expect(screen.getAllByTestId('weight-bar-row')).toHaveLength(3)
  })

  it('states the comparison on tap rather than pre-printing every delta', () => {
    render(<WeightBars rows={ROWS} />)
    expect(screen.queryByTestId('weight-bars-delta')).toBeNull()

    fireEvent.click(screen.getAllByTestId('weight-bar-row')[1])
    // 1.5 against a 4.0 baseline.
    expect(screen.getByTestId('weight-bars-delta').textContent)
      .toMatch(/Proposed is 2\.50% less than Current/)
  })

  it('carries the row note into the comparison so a date is not lost', () => {
    render(<WeightBars rows={ROWS} />)
    fireEvent.click(screen.getAllByTestId('weight-bar-row')[2])
    expect(screen.getByTestId('weight-bars-delta').textContent).toMatch(/SPY 14 Aug/)
  })

  it('clears the comparison when the same row is tapped again', () => {
    render(<WeightBars rows={ROWS} />)
    const row = screen.getAllByTestId('weight-bar-row')[1]
    fireEvent.click(row)
    fireEvent.click(row)
    expect(screen.queryByTestId('weight-bars-delta')).toBeNull()
  })

  it('says nothing when the baseline itself is tapped', () => {
    // "Current is 0.00% more than Current" is noise dressed as an answer.
    render(<WeightBars rows={ROWS} />)
    fireEvent.click(screen.getAllByTestId('weight-bar-row')[0])
    expect(screen.queryByTestId('weight-bars-delta')).toBeNull()
  })

  it('counts a row it cannot compute instead of drawing it as zero', () => {
    // The distinction the whole suppression contract exists for: "holds none
    // of it" and "we could not compute this" must not render identically.
    render(<WeightBars rows={[...ROWS, { label: 'Broken', weightPct: NaN }]} />)
    expect(screen.getAllByTestId('weight-bar-row')).toHaveLength(3)
    expect(screen.getByTestId('weight-bars-dropped').textContent).toMatch(/1 not computable/)
  })

  it('states how many rows it truncated', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `P${i}`, weightPct: i + 1 }))
    render(<WeightBars rows={many} limit={6} />)
    expect(screen.getAllByTestId('weight-bar-row')).toHaveLength(6)
    expect(screen.getByTestId('weight-bars-hidden').textContent).toMatch(/3 more/)
  })

  it('renders nothing rather than an empty frame when there is no usable row', () => {
    const { container } = render(<WeightBars rows={[{ label: 'x', weightPct: NaN }]} />)
    expect(container.querySelector('[data-testid="weight-bars"]')).toBeNull()
  })

  it('measures from the row named as the baseline, not always the first', () => {
    render(<WeightBars rows={ROWS} baselineIndex={2} />)
    fireEvent.click(screen.getAllByTestId('weight-bar-row')[0])
    expect(screen.getByTestId('weight-bars-delta').textContent)
      .toMatch(/Current is 3\.58% more than Benchmark/)
  })

  it('states money instead of percent when the rows are exposure', () => {
    // Weight and money rank differently: 25% of a small book can be less
    // exposure than 4% of a large one, which is the whole reason the crowding
    // card carries both.
    render(<WeightBars unit="usd" rows={[
      { label: 'Large Cap Growth', weightPct: 2_400_000 },
      { label: 'Vision Fund 5K', weightPct: 18_000_000 },
    ]} />)
    expect(screen.getByText('$2.4m')).toBeTruthy()
    expect(screen.getByText('$18.0m')).toBeTruthy()

    fireEvent.click(screen.getAllByTestId('weight-bar-row')[1])
    expect(screen.getByTestId('weight-bars-delta').textContent)
      .toMatch(/Vision Fund 5K is \$15\.6m more than Large Cap Growth/)
  })
})
