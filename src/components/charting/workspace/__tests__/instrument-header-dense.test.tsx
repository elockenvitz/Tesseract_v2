/**
 * The instrument block in a narrow pane.
 *
 * This block used to hide its provenance chips at Tailwind's `lg:`, which
 * reads the WINDOW. The command bar's constraint has never been the window:
 * a Charting tab narrowed to a third of a 1920px monitor kept every chip,
 * and the left group then wanted 603px in a 358px row -- a measured 245px of
 * overflow while `lg:` was still satisfied.
 *
 * So the chips are now dropped by a container measurement. What these tests
 * hold is which chips go and which one stays: the basis survives, because it
 * is the label that stops a reader taking a raw series' split for a market
 * move, and a narrow pane does not make that less true.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InstrumentHeader } from '../InstrumentHeader'
import type { SeriesMeta } from '../series-meta'

const META: SeriesMeta = {
  symbol: 'AAPL',
  last: 352.45,
  previous: 356.27,
  bars: 262,
  interval: '1wk',
  provider: 'eodhd',
  observedAt: new Date().toISOString(),
  adjustment: 'split_adjusted',
  adjustmentEvidence: 'measured across the published ex-date',
} as SeriesMeta

const RAW: SeriesMeta = { ...META, adjustment: 'raw' } as SeriesMeta

describe('the chips a narrow pane drops', () => {
  it('shows the full provenance when there is room', () => {
    render(<InstrumentHeader symbol="AAPL" companyName="Apple Inc." meta={META} />)
    expect(screen.getByText(/262 bars/)).toBeTruthy()
    expect(screen.getByText('eodhd')).toBeTruthy()
  })

  it('drops bars, provider and freshness when dense', () => {
    render(<InstrumentHeader symbol="AAPL" companyName="Apple Inc." meta={META} dense />)
    expect(screen.queryByText(/262 bars/)).toBeNull()
    expect(screen.queryByText('eodhd')).toBeNull()
  })

  it('keeps the price and the symbol when dense', () => {
    render(<InstrumentHeader symbol="AAPL" companyName="Apple Inc." meta={META} dense />)
    expect(screen.getByText('AAPL')).toBeTruthy()
    expect(screen.getByText(/352\.45/)).toBeTruthy()
  })
})

describe('the chip a narrow pane must NOT drop', () => {
  it('shows the basis at full width when the series is adjusted', () => {
    render(<InstrumentHeader symbol="AAPL" companyName="Apple Inc." meta={META} />)
    expect(screen.getByText(/split-adjusted/i)).toBeTruthy()
  })

  it('drops the SAFE basis when dense, which is the one chip that can go', () => {
    /*
     * At 360px the left group was still 92px over with every other chip
     * gone, and this chip is about 90 of it. "split-adjusted" tells a
     * reader the chart is safe; that reassurance can be looked up later,
     * and the company name cannot.
     */
    render(<InstrumentHeader symbol="AAPL" companyName="Apple Inc." meta={META} dense />)
    expect(screen.queryByText(/split-adjusted/i)).toBeNull()
  })

  it('keeps the HAZARD when dense, which is the whole point', () => {
    /*
     * A raw series on a long window draws a split as a collapse. If the one
     * chip that says so is the one a narrow pane hides, the narrow pane is
     * where the reader is misled.
     */
    render(<InstrumentHeader symbol="AAPL" companyName="Apple Inc." meta={RAW} dense />)
    expect(screen.getByText(/raw/i)).toBeTruthy()
  })
})

describe('it still refuses meta belonging to another instrument', () => {
  it('shows no price when the meta is for a different symbol', () => {
    /* The pre-existing contract: AAPL's last close must never appear beside
       MSFT's name while the new series loads. Dense must not weaken it. */
    render(<InstrumentHeader symbol="MSFT" companyName="Microsoft" meta={META} dense />)
    expect(screen.queryByText(/352\.45/)).toBeNull()
  })
})
