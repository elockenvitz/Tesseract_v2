import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

import { MobileExplore } from '../MobileExplore'
import type { ExploreItem } from '../../../lib/mobile/explore-item'

/**
 * What a tile SAYS, as distinct from where it sits.
 *
 * The geometry is asserted in the phone suite, where there is a layout engine.
 * These are about ambiguity: a number with no unit, a chart with no window, the
 * same fact printed twice. Each of those shipped, and none of them is visible
 * to a layout assertion — the tile is perfectly well-formed while saying
 * something the reader cannot resolve.
 */

const attr = (c: HTMLElement, n: string) => c.querySelector(`[${n}]`)
const NOW = new Date('2026-08-20T12:00:00.000Z').getTime()

const base = {
  id: 'x', dedupeKey: 'k', signalType: 'target_breached',
  category: 'decisions' as const, subtype: 'signal' as const,
  title: 'NVDA passed its target',
  occurredAt: new Date(NOW - 3_600_000).toISOString(),
  destination: { kind: 'action' as const, action: 'open_asset', assetId: 'a', symbol: 'NVDA' },
}

const view = (over: Partial<ExploreItem> = {}) => render(
  <MobileExplore
    candidates={[{ ...base, ...over } as ExploreItem]}
    category={null}
    onCategoryChange={vi.fn()}
    onOpen={vi.fn()}
    now={NOW}
  />,
)

describe('a number on a tile says what kind of number it is', () => {
  it('names the weight rather than printing a bare percentage', () => {
    // It sat under a price chart, in a footer, beside a metric that might read
    // "TODAY" — a third number in a third unit with nothing to say which.
    const { container } = view({ symbol: 'NVDA', portfolio: { weightPct: 8.1 } })
    expect(attr(container, 'data-explore-weight')?.textContent).toBe('8.1% weight')
  })

  it('stays quiet when the context line has already said it', () => {
    // Several adapters write a context of exactly "4.8% of Core Equity", so
    // labelling the footer produced the same number twice on one tile in two
    // different phrasings.
    const { container } = view({
      symbol: 'AAPL',
      context: '4.8% of Core Equity',
      portfolio: { weightPct: 4.8 },
    })
    expect(attr(container, 'data-explore-weight')).toBeNull()
    expect(attr(container, 'data-explore-context')?.textContent).toBe('4.8% of Core Equity')
  })

  it('still shows the weight when the context is about something else', () => {
    const { container } = view({
      symbol: 'NVDA',
      context: 'Second revision this quarter',
      portfolio: { weightPct: 8.1 },
    })
    expect(attr(container, 'data-explore-weight')?.textContent).toBe('8.1% weight')
  })
})

describe('an empty tile says something true rather than nothing', () => {
  it('falls back to the company name when there is no context', () => {
    // Eight adapters carry `companyName` and nothing rendered it, so the
    // emptiest tiles — no metric, no context, no price series — were holding a
    // fact about their subject and showing blank space instead.
    const { container } = view({ symbol: 'TSM', companyName: 'Taiwan Semiconductor' })
    expect(attr(container, 'data-explore-context')?.textContent).toBe('Taiwan Semiconductor')
  })

  it('prefers a real finding to the company name', () => {
    // A company name where an actual finding exists would be filler.
    const { container } = view({
      symbol: 'TSM', companyName: 'Taiwan Semiconductor',
      context: 'Second revision this quarter',
    })
    expect(attr(container, 'data-explore-context')?.textContent).toBe('Second revision this quarter')
  })

  it('renders no context line at all when there is neither', () => {
    const { container } = view({ symbol: 'TSM' })
    expect(attr(container, 'data-explore-context')).toBeNull()
  })
})

describe('the chart reserves nothing it cannot fill', () => {
  it('draws no chart block when the caller has no line for the symbol', () => {
    // A symbol is not a price history. The box used to be reserved on the
    // symbol alone, so a name with no cached closes reserved 48px and filled
    // it with nothing.
    const { container } = view({ symbol: 'NVDA' })
    expect(attr(container, 'data-explore-spark')).toBeNull()
  })

  it('draws one when the caller supplies a line', () => {
    const { container } = render(
      <MobileExplore
        candidates={[{ ...base, symbol: 'NVDA' } as ExploreItem]}
        category={null}
        onCategoryChange={vi.fn()}
        onOpen={vi.fn()}
        now={NOW}
        renderSparkline={() => <div>line</div>}
      />,
    )
    expect(attr(container, 'data-explore-spark')).toBeTruthy()
  })
})

/**
 * Every case above renders a tile and asserts on its contents. The two that
 * assert an ABSENCE would pass against a blank screen, so each is paired with a
 * positive case on the same field — the first draft of this file had the wrong
 * candidate shape, nothing rendered at all, and those two passed.
 */
