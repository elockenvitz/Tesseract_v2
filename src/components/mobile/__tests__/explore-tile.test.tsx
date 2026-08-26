import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import { MobileExplore } from '../MobileExplore'
import { FEED_CATEGORIES } from '../../../lib/mobile/feed-categories'
import type { ExploreItem } from '../../../lib/mobile/explore-item'

/**
 * What a card SAYS and what it DOES, as distinct from where it sits.
 *
 * The geometry is asserted in the phone suite, where there is a layout engine.
 * These are about ambiguity and about dead ends: a number with no unit, a chart
 * with no window, the same fact printed twice, a card drawn as tappable that
 * answers nothing. Each of those shipped, and none is visible to a layout
 * assertion — a card is perfectly well-formed while saying something the reader
 * cannot resolve.
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

const view = (over: Partial<ExploreItem> = {}, props: Record<string, unknown> = {}) => render(
  <MobileExplore
    candidates={[{ ...base, ...over } as ExploreItem]}
    category={null}
    onCategoryChange={vi.fn()}
    onOpen={vi.fn()}
    now={NOW}
    {...props}
  />,
)

describe('a number on a card says what kind of number it is', () => {
  it('names the weight rather than printing a bare percentage', () => {
    // It sat under a price chart, in a footer, beside a metric that might read
    // "TODAY" — a third number in a third unit with nothing to say which.
    const { container } = view({ symbol: 'NVDA', portfolio: { weightPct: 8.1 } })
    expect(attr(container, 'data-explore-weight')?.textContent).toBe('8.1% weight')
  })

  it('stays quiet when the supporting line has already said it', () => {
    // Several adapters write a context of exactly "4.8% of Core Equity", so
    // labelling the footer produced the same number twice on one card in two
    // different phrasings.
    const { container } = view({
      symbol: 'AAPL',
      context: '4.8% of Core Equity',
      portfolio: { weightPct: 4.8 },
    })
    expect(attr(container, 'data-explore-weight')).toBeNull()
    expect(attr(container, 'data-explore-context')?.textContent).toBe('4.8% of Core Equity')
  })

  it('stays quiet when the METRIC has already said it', () => {
    // The other direction, which the footer guard alone never covered: the
    // conviction card's metric IS the weight, so labelling it again in the
    // footer printed the position size twice on one card.
    const { container } = view({
      symbol: 'AMZN',
      metric: { value: '14.2%', label: 'position' },
      portfolio: { weightPct: 14.2, name: 'Large Cap Growth' },
    })
    expect(attr(container, 'data-explore-weight')).toBeNull()
  })

  it('still shows the weight when the supporting line is about something else', () => {
    const { container } = view({
      symbol: 'NVDA',
      context: 'Second revision this quarter',
      portfolio: { weightPct: 8.1 },
    })
    expect(attr(container, 'data-explore-weight')?.textContent).toBe('8.1% weight')
  })

  it('prints the metric once and the context without it', () => {
    // The reported AMZN card: "14.2% POSITION" over "14.2% in Large Cap
    // Growth". One fact, two lines, two phrasings.
    const { container } = view({
      symbol: 'AMZN',
      metric: { value: '14.2%', label: 'position' },
      context: '14.2% in Large Cap Growth',
      portfolio: { weightPct: 14.2, name: 'Large Cap Growth' },
    })
    expect(attr(container, 'data-explore-metric')?.textContent).toContain('14.2%')
    expect(attr(container, 'data-explore-context')?.textContent).toBe('Large Cap Growth')
    // Once in the TEXT. The exposure bar states the same weight as its own
    // label, which is the visual carrying the fact rather than a third
    // sentence repeating it — see §4, where replacing duplicated copy with a
    // picture is the point.
    const text = [
      attr(container, 'data-explore-metric')?.textContent ?? '',
      attr(container, 'data-explore-context')?.textContent ?? '',
      attr(container, 'data-explore-headline')?.textContent ?? '',
    ].join(' ')
    expect(text.match(/14\.2%/g)).toHaveLength(1)
  })
})

describe('an empty card says something true rather than nothing', () => {
  it('falls back to the company name when there is no context', () => {
    // Eight adapters carry `companyName` and nothing rendered it, so the
    // emptiest cards — no metric, no context, no price series — were holding a
    // fact about their subject and showing blank space instead.
    const { container } = view({ symbol: 'TSM', companyName: 'Taiwan Semiconductor' })
    expect(attr(container, 'data-explore-context')?.textContent).toBe('Taiwan Semiconductor')
  })

  it('prefers a real finding to the company name', () => {
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

describe('an idea card carries what the row actually knows', () => {
  it('shows the proposal state when there is one', () => {
    const { container } = view({
      category: 'ideas', subtype: 'idea', symbol: 'TGT',
      title: 'Trade idea', state: 'Buy · Discussing', companyName: 'Target Corporation',
    })
    expect(attr(container, 'data-explore-state')?.textContent).toBe('Buy · Discussing')
    expect(attr(container, 'data-explore-context')?.textContent).toBe('Target Corporation')
  })

  it('omits the state line entirely when the row has none', () => {
    // Never invented. Most cards are not proposals.
    const { container } = view({ category: 'ideas', subtype: 'idea', symbol: 'TGT' })
    expect(attr(container, 'data-explore-state')).toBeNull()
  })
})

describe('the chart appears where price is context, and nowhere else', () => {
  it('draws no chart block when the caller has no line for the symbol', () => {
    // A symbol is not a price history. The box used to be reserved on the
    // symbol alone, so a name with no cached closes reserved 48px and filled
    // it with nothing.
    const { container } = view({ symbol: 'NVDA' })
    expect(attr(container, 'data-explore-spark')).toBeNull()
  })

  it('draws one where the trajectory IS the story', () => {
    const { container } = view(
      { symbol: 'NVDA', signalType: 'unusual_move' },
      { renderSparkline: () => <div>line</div> },
    )
    expect(attr(container, 'data-explore-visual')?.getAttribute('data-explore-visual'))
      .toBe('price_trend')
  })

  it('draws none where a better archetype explains the finding', () => {
    // The change this pass is about: the sparkline is no longer the DEFAULT.
    // A position with a weight draws exposure, because "you own this much
    // without the work" is the claim and a price line is not evidence for it.
    const { container } = view(
      { symbol: 'NVDA', signalType: 'no_research', subtype: 'research', portfolio: { weightPct: 5.1 } },
      { renderSparkline: () => <div>line</div> },
    )
    expect(attr(container, 'data-explore-visual')?.getAttribute('data-explore-visual'))
      .toBe('exposure')
  })

  it('draws none under an idea, even with a line available', () => {
    // §11: an idea's content is its argument. A year of closes under it says
    // the price explains the post, which it does not.
    const { container } = view(
      { symbol: 'TGT', category: 'ideas', subtype: 'idea', title: 'Trade idea' },
      { renderSparkline: () => <div>line</div> },
    )
    expect(attr(container, 'data-explore-spark')).toBeNull()
  })
})

describe('a story keeps its publisher', () => {
  const story = {
    category: 'news' as const, subtype: 'news' as const, symbol: 'JNJ',
    title: "Does Louisiana's US$10 Million Talc Verdict Shift the Legal Risk Bull Case For Johnson & Johnson?",
    source: { kind: 'market' as const, label: '  Simply  Wall St. ' },
  }

  it('shows the source however long the headline runs', () => {
    const { container } = view(story)
    expect(attr(container, 'data-explore-source')?.textContent).toBe('Simply Wall St.')
  })

  it('says the figure the way the card has room for', () => {
    const { container } = view(story)
    const headline = attr(container, 'data-explore-headline')!.textContent!
    expect(headline).toContain('$10M')
    expect(headline).toContain('Johnson & Johnson')
  })

  it('clamps the headline deliberately rather than letting it run', () => {
    const { container } = view(story)
    expect(attr(container, 'data-explore-headline')!.className).toContain('line-clamp-3')
  })
})

describe('the rhythm floors survive the global touch-target rule', () => {
  it('sets the floor where a stylesheet rule cannot outrank it', () => {
    /**
     * `index.css` gives every `button` on a coarse pointer a 44px minimum via
     * `button:not(.no-touch-target)` — a compound selector, so it outranks a
     * single Tailwind utility. A `min-h-[164px]` class on this element computed
     * to 44px and did nothing, which shipped as an aggregate card at 90px in a
     * grid whose other rows were 200.
     */
    const { container } = view({ category: 'workflow', subtype: 'workflow', symbol: null })
    const card = attr(container, 'data-explore-tile') as HTMLElement
    expect(card.getAttribute('data-explore-height')).toBe('compact')
    expect(card.style.minHeight).toBe('132px')
    expect(card.className).not.toContain('min-h-[')
  })

  it('reserves the taller floor from ELIGIBILITY, not from what arrived', () => {
    /**
     * A chart-bearing card is taller, and the variant is decided from whether
     * the card may HAVE a line rather than from whether one has loaded. That is
     * deliberate: the line arrives asynchronously and per symbol, so a floor
     * keyed on arrival would resize the row when data landed and leave the two
     * halves of a row unequal until both resolved. The floor is a floor —
     * content above it still sets the height — so a name that turns out to have
     * no history costs padding, not an empty band.
     */
    // A card carrying a PICTURE gets the taller floor, whatever kind of
    // picture. The variant used to key off "has a symbol", which after the
    // archetype split would give a news story the tall box and squeeze a range
    // bar into the short one.
    const { container } = view({ symbol: 'NVDA', portfolio: { weightPct: 4.1, name: 'Core' } })
    const card = attr(container, 'data-explore-tile') as HTMLElement
    expect(card.getAttribute('data-explore-height')).toBe('compact-chart')
    expect(parseInt(card.style.minHeight, 10)).toBeGreaterThan(132)
    // And no sparkline was drawn: exposure is the archetype here.
    expect(attr(container, 'data-explore-visual')?.getAttribute('data-explore-visual'))
      .toBe('exposure')
  })
})

describe('a card is one tap target', () => {
  it('reports the item when the card itself is pressed', () => {
    const onOpen = vi.fn()
    const { container } = view({ symbol: 'NVDA' }, { onOpen })
    fireEvent.click(attr(container, 'data-explore-tile') as HTMLElement)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'x' }))
  })

  it('carries no button of its own inside the preview', () => {
    // §15: a preview with a call to action is a decision card. The whole card
    // is the target and there is nothing else to press.
    const { container } = view({ symbol: 'NVDA', portfolio: { weightPct: 8.1 } })
    const card = attr(container, 'data-explore-tile') as HTMLElement
    expect(card.tagName).toBe('BUTTON')
    expect(card.querySelectorAll('button, a, input')).toHaveLength(0)
  })

  it('keeps a visible focus state for a keyboard', () => {
    const { container } = view({ symbol: 'NVDA' })
    expect((attr(container, 'data-explore-tile') as HTMLElement).className)
      .toContain('focus-visible:ring-2')
  })
})

describe('the filter row', () => {
  it('offers every canonical category and nothing else', () => {
    const { container } = view({ symbol: 'NVDA' })
    const keys = [...container.querySelectorAll('[data-explore-category]')]
      .map(e => e.getAttribute('data-explore-category'))
    expect(keys).toEqual(['all', ...FEED_CATEGORIES.map(c => c.key)])
  })

  it('marks exactly one chip active', () => {
    const { container } = render(
      <MobileExplore
        candidates={[{ ...base, category: 'research', subtype: 'research' } as ExploreItem]}
        category="research"
        onCategoryChange={vi.fn()}
        onOpen={vi.fn()}
        now={NOW}
      />,
    )
    const active = [...container.querySelectorAll('[data-explore-category][aria-pressed="true"]')]
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute('data-explore-category')).toBe('research')
  })

  it('reports the chosen category rather than filtering in place', () => {
    const onCategoryChange = vi.fn()
    const { container } = view({ symbol: 'NVDA' }, { onCategoryChange })
    fireEvent.click(container.querySelector('[data-explore-category="ideas"]') as HTMLElement)
    expect(onCategoryChange).toHaveBeenCalledWith('ideas')
  })
})

/**
 * Every case above renders a card and asserts on its contents. The ones that
 * assert an ABSENCE would pass against a blank screen, so each is paired with a
 * positive case on the same field — the first draft of this file had the wrong
 * candidate shape, nothing rendered at all, and those two passed.
 */
