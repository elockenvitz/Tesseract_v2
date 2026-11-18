/**
 * The OHLC readout shows the bar, and does not invent one.
 *
 * The timestamp and volume formatters it uses are asserted separately in
 * `lib/charting/__tests__/bar-format.test.ts`, including the timezone case.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OhlcReadout } from '../OhlcReadout'

const bar = {
  time: Math.floor(Date.UTC(2026, 10, 17, 14, 30) / 1000),
  open: 350,
  high: 356.2,
  low: 349.1,
  close: 355.4,
  volume: 41_200_000,
}

describe('the readout', () => {
  it('renders nothing when the cursor is not over a bar', () => {
    const { container } = render(<OhlcReadout bar={null} interval="1d" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows open, high, low and close', () => {
    render(<OhlcReadout bar={bar} interval="1d" />)
    expect(screen.getByText('350.00')).toBeInTheDocument()
    expect(screen.getByText('356.20')).toBeInTheDocument()
    expect(screen.getByText('349.10')).toBeInTheDocument()
    expect(screen.getByText('355.40')).toBeInTheDocument()
  })

  it('shows volume shortened', () => {
    render(<OhlcReadout bar={bar} interval="1d" />)
    expect(screen.getByText('41.20M')).toBeInTheDocument()
  })

  it('omits volume rather than printing zero when the feed sent none', () => {
    /* A zero share count claims nothing traded. "This feed does not carry
       volume" is a different statement, and printing 0 makes the wrong one. */
    const { container } = render(<OhlcReadout bar={{ ...bar, volume: 0 }} interval="1d" />)
    expect(container.textContent).not.toMatch(/\bV\b/)
  })

  it('attaches no currency symbol', () => {
    const { container } = render(<OhlcReadout bar={bar} interval="1d" />)
    expect(container.textContent).not.toContain('$')
  })

  it('is transparent to the pointer, so it cannot swallow a click on the chart', () => {
    /* It sits over the canvas. Without this a drawing gesture started in
       the top-left corner would land on a div instead of the chart. */
    const { container } = render(<OhlcReadout bar={bar} interval="1d" />)
    expect((container.firstChild as HTMLElement).className).toContain('pointer-events-none')
  })

  it('colours the close by the bar\'s own direction, not the previous bar\'s', () => {
    /* Close against open, which is what a candle would be drawn with, so
       the colour and the candle agree. */
    const { container: up } = render(<OhlcReadout bar={bar} interval="1d" />)
    expect(up.innerHTML).toContain('emerald')
    const { container: down } = render(
      <OhlcReadout bar={{ ...bar, close: 340 }} interval="1d" />,
    )
    expect(down.innerHTML).toContain('rose')
  })
})
