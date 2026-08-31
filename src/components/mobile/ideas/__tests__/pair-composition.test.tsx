import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PairStructure } from '../PairStructure'
import { PairLegsPane } from '../PairLegsPane'
import { CONTENT_REGISTRY, judgmentPresentationFor } from '../../../../lib/signals/content-registry'
import { PRICE_RANGES } from '../../../signals/PriceContext'

/**
 * Which symbols have a cached tape, mirroring production: MCD, LLY and PFE are
 * covered; CMG, GH and CLOV are not. Mocked rather than fetched so the charted
 * and uncharted branches are both reachable and neither depends on the network
 * settling.
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
  })

  /** A price shown against a whole side would belong to one leg and read as the side's. */
  it('does not attach a single leg price to a basket side', () => {
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

describe('the Legs pane inspects ONE leg on the shared price chart', () => {
  const facts = (l: any) => (l.symbol === 'MCD'
    ? { currentPrice: 312.4, targetPrice: 350 }
    : { currentPrice: 58.2, targetPrice: null })

  /** `PriceContext` is what Case vs Price renders; its range row identifies it. */
  const charts = (c: HTMLElement) => c.querySelectorAll('[data-testid="price-ranges"]').length
  const tap = (c: HTMLElement | HTMLBodyElement, sel: string) =>
    fireEvent.click(c.querySelector(sel) as HTMLElement)
  const rangeBtn = (c: HTMLElement, k: string) =>
    [...c.querySelectorAll('[data-testid="price-ranges"] button')]
      .find(b => b.textContent === k) as HTMLElement

  const openChooser = (c: HTMLElement) => tap(c, '[data-leg-selector]')

  /** The permanent two-row chip grid was eating the chart's space. */
  it('shows one compact selector, not a permanent row of every symbol', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    expect(container.querySelectorAll('[data-leg-selector]')).toHaveLength(1)
    expect(container.querySelector('[data-leg-chip]')).toBeNull()
  })

  it('reaches every surviving leg through the chooser, grouped by side', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    openChooser(container)
    for (const s of ['LLY', 'PFE', 'GH', 'CLOV']) {
      expect(document.querySelector(`[data-leg-option="${s}"]`), s).toBeTruthy()
    }
    expect(screen.getByText('Long')).toBeTruthy()
    expect(screen.getByText('Short')).toBeTruthy()
  })

  it('states the current subject and its side on the selector', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    const sel = container.querySelector('[data-leg-selector]')!
    expect(sel.textContent).toContain('LLY')
    expect(sel.textContent?.toLowerCase()).toContain('long')
  })

  it('marks legs with no chart in the chooser rather than hiding them', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    openChooser(container)
    expect(document.querySelector('[data-leg-option="GH"]')?.textContent).toContain('no chart')
  })

  /**
   * The correction: the chart is the shared PricePane / PriceContext, not a
   * pair-local sparkline. Its own range row is the marker that it is the real
   * one, because a bespoke chart had no such thing.
   */
  it('renders the standard shared price chart, not a bespoke one', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    expect(charts(container)).toBe(1)
  })

  it('offers the chart own horizon controls, drawn from the shared list', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    const keys = [...container.querySelectorAll('[data-testid="price-ranges"] button')]
      .map(b => b.textContent).filter(t => !!t && t.length <= 3) as string[]
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(PRICE_RANGES.map(r => r.key)).toContain(k)
  })

  it('defaults to the first chartable leg in the fixed order', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    expect(container.querySelector('[data-active-leg="LLY"]')).toBeTruthy()
  })

  /** An initial inspection state, never a claim about importance. */
  it('falls back to the first surviving leg when none can be charted', () => {
    const none = [leg({ action: 'buy', symbol: 'GH' }), leg({ action: 'sell', symbol: 'CLOV' })]
    const { container } = render(<PairLegsPane legs={none} />)
    expect(container.querySelector('[data-active-leg="GH"]')).toBeTruthy()
    expect(charts(container)).toBe(0)
  })

  it('replaces the chart when another leg is selected rather than adding one', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    tap(container, '[data-leg-selector]')
    tap(document.body, '[data-leg-option="PFE"]')
    expect(container.querySelector('[data-active-leg="PFE"]')).toBeTruthy()
    expect(container.querySelector('[data-active-leg="LLY"]')).toBeNull()
    expect(charts(container)).toBe(1)
  })

  it('drops the chart for a leg with no history, keeping its facts', () => {
    const { container } = render(<PairLegsPane legs={BASKET} factsFor={facts} />)
    tap(container, '[data-leg-selector]')
    tap(document.body, '[data-leg-option="CLOV"]')
    expect(container.querySelector('[data-active-leg="CLOV"][data-leg-charted="false"]')).toBeTruthy()
    expect(charts(container)).toBe(0)
    expect(screen.getByText('Price history unavailable')).toBeTruthy()
    expect(screen.getByText('$58.20')).toBeTruthy()
  })

  it('restores the chart on returning to a chartable leg', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    tap(container, '[data-leg-selector]')
    tap(document.body, '[data-leg-option="GH"]')
    expect(charts(container)).toBe(0)
    tap(container, '[data-leg-selector]')
    tap(document.body, '[data-leg-option="LLY"]')
    expect(charts(container)).toBe(1)
  })

  /** The seam PriceContext.onRangeChange exists for. */
  it('keeps the selected window across leg switches', () => {
    const { container } = render(<PairLegsPane legs={BASKET} />)
    fireEvent.click(rangeBtn(container, '3M'))
    tap(container, '[data-leg-selector]')
    tap(document.body, '[data-leg-option="PFE"]')
    expect(container.querySelector('[data-active-leg="PFE"]')).toBeTruthy()
    // Remounted for the new symbol and still offering the same window.
    expect(rangeBtn(container, '3M')).toBeTruthy()
    expect(container.querySelector('[data-range="3M"]')).toBeTruthy()
  })

  it('expands the SELECTED leg with the window in force', () => {
    const onExpandLeg = vi.fn()
    const { container } = render(<PairLegsPane legs={BASKET} onExpandLeg={onExpandLeg} />)
    tap(container, '[data-leg-selector]')
    tap(document.body, '[data-leg-option="PFE"]')
    fireEvent.click(rangeBtn(container, '1M'))
    fireEvent.click(container.querySelector('[data-slot="chart-expand"]') as HTMLElement)
    expect(onExpandLeg).toHaveBeenCalledWith('PFE', expect.any(Array), '1M')
  })

  /**
   * Null is a real value here: it means the reader never chose, which lets
   * `PriceContext` apply its own default rather than this pane asserting one.
   */
  it('reports no window when the reader has not chosen one', () => {
    const onExpandLeg = vi.fn()
    const { container } = render(<PairLegsPane legs={BASKET} onExpandLeg={onExpandLeg} />)
    fireEvent.click(container.querySelector('[data-slot="chart-expand"]') as HTMLElement)
    expect(onExpandLeg).toHaveBeenCalledWith('LLY', expect.any(Array), null)
  })

  it('offers no expand on a leg with nothing to expand', () => {
    const { container } = render(<PairLegsPane legs={BASKET} onExpandLeg={() => {}} />)
    tap(container, '[data-leg-selector]')
    tap(document.body, '[data-leg-option="GH"]')
    expect(container.querySelector('[data-slot="chart-expand"]')).toBeNull()
  })

  /** The chart carries its own read-out; printing it again would duplicate. */
  it('does not repeat the price beside a chart that already shows one', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    expect(container.querySelector('[data-active-leg="MCD"]')!.textContent).not.toContain('$312.40')
  })

  it('shows the stored price only where there is no chart', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    tap(container, '[data-leg-selector]')
    tap(document.body, '[data-leg-option="CMG"]')
    expect(container.querySelector('[data-active-leg="CMG"]')!.textContent).toContain('$58.20')
  })

  it('passes a real target through as chart context', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    expect(container.querySelector('[data-active-leg="MCD"]')!.textContent).toContain('tgt $350.00')
  })

  it('uses the same selector on a simple pair, defaulting to the covered leg', () => {
    const { container } = render(<PairLegsPane legs={ONE_BY_ONE} factsFor={facts} />)
    tap(container, '[data-leg-selector]')
    expect(document.querySelector('[data-leg-option="MCD"]')).toBeTruthy()
    expect(document.querySelector('[data-leg-option="CMG"]')).toBeTruthy()
    tap(document.body, '[data-leg-option="MCD"]')
    expect(container.querySelector('[data-active-leg="MCD"]')).toBeTruthy()
    expect(charts(container)).toBe(1)
  })

  it('never states a pair-level return', () => {
    const { container } = render(<PairLegsPane legs={BASKET} factsFor={facts} />)
    expect(container.textContent).not.toMatch(/since this pair|relative return/i)
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
