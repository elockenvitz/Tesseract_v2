import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PairStructure } from '../PairStructure'
import { PairLegsPane } from '../PairLegsPane'
import { CONTENT_REGISTRY, judgmentPresentationFor } from '../../../../lib/signals/content-registry'
import { pairSides } from '../../../../lib/signals/pair-shape'

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

describe('the Legs pane earns its place only on a basket', () => {
  /**
   * The rule the feed applies. Asserted on the shape rather than through the
   * dashboard, because the decision IS the shape: one leg a side means the
   * summary already says everything the pane would.
   */
  const isSimple = (legs: any[]) => {
    const s = pairSides(legs)
    return s.long.length === 1 && s.short.length === 1 && s.unknown.length === 0
  }

  it('calls a 1x1 pair simple, so no second pane is built', () => {
    expect(isSimple(ONE_BY_ONE)).toBe(true)
  })

  it('calls a basket not simple, so the detail pane is built', () => {
    expect(isSimple(BASKET)).toBe(false)
  })

  it('treats an unplaceable extra leg as reason enough for the detail pane', () => {
    expect(isSimple([...ONE_BY_ONE, leg({ action: 'hold', symbol: 'ZZZ' })])).toBe(false)
  })

  it('lists every surviving leg when it does render', () => {
    render(<PairLegsPane legs={BASKET} limit={10} />)
    for (const s of ['LLY', 'PFE', 'GH', 'CLOV']) expect(screen.getByText(s)).toBeTruthy()
  })

  it('counts what it could not fit rather than truncating silently', () => {
    render(<PairLegsPane legs={BASKET} limit={2} />)
    expect(screen.getByText(/2 more legs/)).toBeTruthy()
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
