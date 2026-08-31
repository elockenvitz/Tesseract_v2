import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PairStructure } from '../PairStructure'
import { PairLegsPane } from '../PairLegsPane'
import { CONTENT_REGISTRY, judgmentPresentationFor } from '../../../../lib/signals/content-registry'
import { PRICE_RANGES } from '../../../signals/PriceContext'

/**
 * Which symbols have a cached tape, mirroring production: MCD, LLY and PFE are
 * covered; CMG, GH and CLOV are not. Mocked rather than fetched so the
 * charted and uncharted branches are both reachable and neither depends on the
 * network settling.
 */
const SERIES = (n: number) => Array.from({ length: n }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
  close: 100 + i * 0.4,
}))
const COVERED = new Set(['MCD', 'LLY', 'PFE'])
vi.mock('../../../../hooks/mobile/useSymbolHistory', () => ({
  useSymbolHistory: (symbol: string) => ({
    data: COVERED.has(String(symbol).toUpperCase()) ? SERIES(300) : [],
    isLoading: false,
  }),
}))

/**
 * `PairLegsPane` fetches each leg's tape, so it needs a client. Retries off and
 * an empty cache: these assert the pane's own composition and its
 * missing-history behaviour, not the network.
 */
const render = (ui: React.ReactElement) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const leg = (over: Record<string, unknown> = {}) => ({
  action: 'buy', status: 'idea', outcome: null, symbol: 'AAA', ...over,
} as any)

const ONE_BY_ONE = [
  leg({ action: 'buy', symbol: 'MCD' }),
  leg({ action: 'sell', symbol: 'CMG' }),
]
const BASKET = [
  leg({ action: 'buy', symbol: 'LLY' }), leg({ action: 'buy', symbol: 'PFE' }),
  leg({ action: 'sell', symbol: 'GH' }), leg({ action: 'sell', symbol: 'CLOV' }),
]

describe('PairStructure — one relative expression', () => {
  it('names both sides as sides, not as adjacent tickers', () => {
    render(<PairStructure legs={ONE_BY_ONE} />)
    expect(screen.getByText('Long')).toBeTruthy()
    expect(screen.getByText('Short')).toBeTruthy()
    expect(screen.getByText('MCD')).toBeTruthy()
    expect(screen.getByText('CMG')).toBeTruthy()
  })

  /**
   * The reported card was "two labels floating in blank space". A 1x1 pair is
   * the one shape with room to be legible, and it now says so.
   */
  it('marks a one-against-one pair as the simple case', () => {
    const { container } = render(<PairStructure legs={ONE_BY_ONE} />)
    expect(container.querySelector('[data-pair-simple="true"]')).toBeTruthy()
  })

  it('does not treat a basket as the simple case', () => {
    const { container } = render(<PairStructure legs={BASKET} />)
    expect(container.querySelector('[data-pair-simple="false"]')).toBeTruthy()
  })

  it('shows real leg facts on a simple pair, and only real ones', () => {
    render(
      <PairStructure
        legs={ONE_BY_ONE}
        factsFor={l => (l.symbol === 'MCD'
          ? { currentPrice: 312.4, targetPrice: 350 }
          : { currentPrice: null, targetPrice: null })}
      />,
    )
    expect(screen.getByText('$312.40')).toBeTruthy()
    expect(screen.getByText('target $350.00')).toBeTruthy()
    // The uncovered leg contributes no invented figure.
    expect(screen.queryByText(/NaN|—\s*target/)).toBeNull()
  })

  /** A price shown against a whole side would belong to one leg and read as the side's. */
  it('does not attach a single leg’s price to a basket side', () => {
    render(<PairStructure legs={BASKET} factsFor={() => ({ currentPrice: 99, targetPrice: 120 })} />)
    expect(screen.queryByText('$99.00')).toBeNull()
  })

  it('summarises a wide side rather than listing every leg', () => {
    const wide = [
      ...['LLY', 'PFE', 'NVO', 'MRK'].map(s => leg({ action: 'buy', symbol: s })),
      leg({ action: 'sell', symbol: 'GH' }),
    ]
    render(<PairStructure legs={wide} size="sm" />)
    expect(screen.getByText('LLY · PFE · +2')).toBeTruthy()
  })

  it('renders a one-sided group as one-sided rather than hiding it', () => {
    render(<PairStructure legs={[leg({ action: 'buy', symbol: 'MCD' })]} />)
    expect(screen.getByText('none')).toBeTruthy()
  })

  it('shows an unplaceable leg as its own action rather than guessing a side', () => {
    render(<PairStructure legs={[...ONE_BY_ONE, leg({ action: 'hold', symbol: 'ZZZ' })]} />)
    expect(screen.getByText('Unplaced')).toBeTruthy()
    expect(screen.getByText(/ZZZ HOLD/)).toBeTruthy()
  })
})

describe('the Legs pane carries market context, not repeated tickers', () => {
  const facts = (l: any) => (l.symbol === 'MCD'
    ? { currentPrice: 312.4, targetPrice: 350 }
    : { currentPrice: 58.2, targetPrice: null })

  it('names every surviving leg with its side', () => {
    render(<PairLegsPane legs={BASKET} />)
    for (const s of ['LLY', 'PFE', 'GH', 'CLOV']) expect(screen.getByText(s)).toBeTruthy()
    expect(screen.getByText('Long')).toBeTruthy()
    expect(screen.getByText('Short')).toBeTruthy()
  })

  it('shows real price and target facts', () => {
    render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    // CMG has no tape, so its stored price is what there is.
    expect(screen.getByText('$58.20')).toBeTruthy()
    expect(screen.getByText('tgt $350.00')).toBeTruthy()
  })

  /**
   * The tape outranks the stored mark, which is `price-snapshot`'s rule
   * applied here: `assets.current_price` carries no timestamp, so where a
   * dated close exists it is the better number. MCD's stored 312.40 yields to
   * its last close.
   */
  it('prefers a dated close over an undated stored price', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    const mcd = container.querySelector('[data-pair-leg-block="MCD"]')!
    expect(mcd.textContent).not.toContain('$312.40')
    expect(mcd.textContent).toMatch(/\$\d/)
  })

  it('computes to-target only when both numbers are real', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    // MCD has both, so it gets one.
    expect(container.querySelector('[data-pair-leg-block="MCD"]')!.textContent).toMatch(/% to target/)
    // CMG has a price and no target, so no percentage is invented for it.
    expect(container.querySelector('[data-pair-leg-block="CMG"]')!.textContent).not.toMatch(/to target/)
    expect(screen.queryAllByText(/to target/)).toHaveLength(1)
  })

  /**
   * The whole point of the pane: a leg with no cached tape still contributes
   * its facts, and says why there is no line rather than drawing an empty box.
   */
  it('renders an honest note instead of a phantom chart', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    // CMG is uncached: a sentence, not an empty box or a flat line.
    expect(container.querySelector('[data-pair-leg-block="CMG"] [data-leg-no-history]')).toBeTruthy()
    expect(screen.getByText('Price history unavailable')).toBeTruthy()
  })

  /**
   * The correction this pass exists for: a leg can be charted even though the
   * PAIR cannot be. MCD has a tape; the pair has no defensible relative return.
   */
  it('charts a covered leg even though the pair itself cannot be charted', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    expect(container.querySelector('[data-pair-leg-block="MCD"][data-leg-charted="true"]')).toBeTruthy()
    expect(container.querySelector('[data-pair-leg-block="CMG"][data-leg-charted="false"]')).toBeTruthy()
  })

  it('charts both covered legs of the real basket and neither uncovered one', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    for (const s of ['LLY', 'PFE']) {
      expect(container.querySelector(`[data-pair-leg-block="${s}"][data-leg-charted="true"]`), s).toBeTruthy()
    }
    for (const s of ['GH', 'CLOV']) {
      expect(container.querySelector(`[data-pair-leg-block="${s}"][data-leg-charted="false"]`), s).toBeTruthy()
      expect(container.querySelector(`[data-pair-leg-block="${s}"] [data-leg-no-history]`), s).toBeTruthy()
    }
  })

  it('offers expand only on a leg that has something to expand', () => {
    const { container } = render(<PairLegsPane legs={BASKET} onExpandLeg={() => {}} />)
    expect(container.querySelector('[data-leg-expand="LLY"]')).toBeTruthy()
    expect(container.querySelector('[data-leg-expand="GH"]')).toBeNull()
  })

  it('hands expand the leg’s own series and the pane’s window', () => {
    const onExpandLeg = vi.fn()
    const { container } = render(<PairLegsPane legs={BASKET} onExpandLeg={onExpandLeg} />)
    ;(container.querySelector('[data-leg-expand="LLY"]') as HTMLElement).click()
    expect(onExpandLeg).toHaveBeenCalledWith('LLY', expect.any(Array), '6M')
  })

  it('offers the shared horizon list rather than a second copy', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} />)
    const keys = [...container.querySelectorAll('[data-leg-range]')]
      .map(b => b.getAttribute('data-leg-range'))
    expect(keys).toEqual(PRICE_RANGES.map(r => r.key))
  })

  it('defaults to the same 6M window every other chart opens on', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} />)
    expect(container.querySelector('[data-leg-range="6M"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows one horizon row for the pane, not one per leg', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    expect(container.querySelectorAll('[data-testid="pair-leg-ranges"]')).toHaveLength(1)
  })

  /** Two facts side by side; nothing sums, differences or overlays them. */
  it('never states a pair-level return', () => {
    const { container } = render(<PairLegsPane legs={BASKET} factsFor={facts} />)
    expect(container.textContent).not.toMatch(/since this pair|spread|relative return|pair \+/i)
  })

  it('says so plainly when no legs survive', () => {
    render(<PairLegsPane legs={[leg({ status: 'deleted' })]} />)
    expect(screen.getByText(/No legs remain/)).toBeTruthy()
  })
})

/**
 * The mechanism behind BOTH reported judgment defects.
 *
 * `on_engage` renders a floating "Your view" control AND filters the verdict
 * pane out of the carousel — so `onActiveChange` could never report `verdict`,
 * the feed's footer gate was never satisfied, and selecting an answer left the
 * footer saying `Actions`. One registry value, two symptoms.
 */
describe('pair judgment is an inline pane, like single names', () => {
  it('declares inline for pair_trade', () => {
    expect(CONTENT_REGISTRY.pair_trade.judgment).toBe('inline')
  })

  it('stays inline at the severity a pair actually carries', () => {
    expect(judgmentPresentationFor({ type: 'pair_trade', severity: 'attention' })).not.toBe('none')
  })

  it('matches the single-name contract exactly', () => {
    expect(CONTENT_REGISTRY.pair_trade.judgment).toBe(CONTENT_REGISTRY.trade_idea.judgment)
  })
})
