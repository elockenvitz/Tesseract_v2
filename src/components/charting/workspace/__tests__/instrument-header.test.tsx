/**
 * The header renders only what it actually knows.
 *
 * The case that matters most is the mismatched symbol. While a new symbol's
 * series loads, the previous one's metadata is still in page state, and
 * printing it would put AAPL's last close beside MSFT's name -- for a second,
 * and plausibly enough that nobody would question it.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InstrumentHeader } from '../InstrumentHeader'
import type { SeriesMeta } from '../series-meta'

const meta: SeriesMeta = {
  symbol: 'AAPL',
  last: 355.4,
  previous: 350,
  lastBarTime: Math.floor(Date.now() / 1000) - 3600,
  observedAt: Math.floor(Date.now() / 1000) - 3600,
  bars: 23,
  interval: '1d',
  provider: 'yahoo',
  adjustment: 'raw',
}

describe('the instrument header', () => {
  it('shows the symbol and the company before any data arrives', () => {
    render(<InstrumentHeader symbol="AAPL" companyName="Apple Inc." meta={null} />)
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
  })

  it('shows the last price and the change once it does', () => {
    render(<InstrumentHeader symbol="AAPL" companyName="Apple Inc." meta={meta} />)
    expect(screen.getByText('355.40')).toBeInTheDocument()
    expect(screen.getByText(/\+1\.54%/)).toBeInTheDocument()
  })

  it('attaches no currency symbol to a price of unstated currency', () => {
    /* A house rule with teeth: GBp is pence and GBP is pounds, and the feed
       does not say which this is. A bare number is honest; a dollar sign is
       a claim. */
    const { container } = render(<InstrumentHeader symbol="AAPL" meta={meta} />)
    expect(container.textContent).not.toContain('$')
    expect(container.textContent).not.toContain('£')
  })

  it('states that the prices are raw, where the prices are', () => {
    render(<InstrumentHeader symbol="AAPL" meta={meta} />)
    expect(screen.getByText(/not split-adjusted/)).toBeInTheDocument()
  })

  it('refuses metadata belonging to a different instrument', () => {
    /* The regression. The header is told MSFT; the metadata in flight is
       still AAPL's. Nothing from that metadata may appear. */
    const { container } = render(
      <InstrumentHeader symbol="MSFT" companyName="Microsoft Corp." meta={meta} />,
    )
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(container.textContent).not.toContain('355.40')
    expect(container.textContent).not.toContain('yahoo')
    expect(container.textContent).not.toContain('23 bars')
  })

  it('matches the symbol regardless of case', () => {
    const { container } = render(<InstrumentHeader symbol="aapl" meta={meta} />)
    expect(container.textContent).toContain('355.40')
  })

  it('shows the bar count, the interval and the feed', () => {
    const { container } = render(<InstrumentHeader symbol="AAPL" meta={meta} />)
    expect(container.textContent).toContain('23 bars')
    expect(container.textContent).toContain('1d')
    expect(container.textContent).toContain('yahoo')
  })

  it('prints no change at all when there is only one bar', () => {
    const { container } = render(
      <InstrumentHeader symbol="AAPL" meta={{ ...meta, previous: null }} />,
    )
    expect(container.textContent).toContain('355.40')
    expect(container.textContent).not.toContain('%')
  })

  describe('freshness comes from the observation, not the bar', () => {
    /*
     * `freshnessLabel` is correct on its own; what this pins is which
     * argument the HEADER hands it. Testing the function alone left the
     * wiring unguarded, and the wiring is where the defect lived: the header
     * passed `lastBarTime`, a bucket boundary, so a current monthly chart
     * announced itself as "18 days ago".
     *
     * The two fields are given deliberately divergent values so only one of
     * them can produce each label.
     */
    const monthly: SeriesMeta = {
      ...meta,
      interval: '1mo',
      // The first of the month, eighteen days back: what a monthly bar carries.
      lastBarTime: Math.floor(Date.now() / 1000) - 18 * 86_400,
      // The provider answered seconds ago.
      observedAt: Math.floor(Date.now() / 1000) - 10,
    }

    it('a current monthly series does not claim to be eighteen days old', () => {
      const { container } = render(<InstrumentHeader symbol="AAPL" meta={monthly} />)
      expect(container.textContent).toContain('just now')
      expect(container.textContent).not.toContain('18 days ago')
    })

    it('a stale answer is still reported stale, whatever the bar says', () => {
      // The inverse, so this cannot be satisfied by always printing "just now".
      const stale: SeriesMeta = {
        ...monthly,
        lastBarTime: Math.floor(Date.now() / 1000) - 60,
        observedAt: Math.floor(Date.now() / 1000) - 3 * 86_400,
      }
      const { container } = render(<InstrumentHeader symbol="AAPL" meta={stale} />)
      expect(container.textContent).toContain('3 days ago')
      expect(container.textContent).not.toContain('just now')
    })

    it('says it does not know rather than inventing an age', () => {
      const { container } = render(
        <InstrumentHeader symbol="AAPL" meta={{ ...monthly, observedAt: null }} />,
      )
      expect(container.textContent).toContain('no data')
    })
  })
})
