import { describe, expect, it } from 'vitest'

import {
  attentionToExplore, ideasToExplore, lensesToExplore, postTitle, shortNextAction,
} from '../explore-adapters'
import { explorePreview } from '../explore-preview'
import { exploreVisualFor } from '../explore-visual'

const NOW = Date.UTC(2026, 7, 26)
const iso = (offsetDays: number) => new Date(NOW + offsetDays * 86_400_000).toISOString()

/**
 * What the tiles SAY, at the source.
 *
 * Two families of defect are asserted here, and both are the same mistake in
 * opposite directions: a tile printing one fact several times, and a tile
 * dropping the only fact that made it worth a cell.
 */

describe('post tiles', () => {
  const thought = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    type: 'quick_thought',
    content: 'Services margin is doing more work than anyone credits.',
    created_at: iso(-2),
    author: { first_name: 'Priya', last_name: 'Raman' },
    asset: { id: 'aapl', symbol: 'AAPL', company_name: 'Apple' },
    ...over,
  })

  it('never prints the same thought body twice', () => {
    /**
     * The reported defect: `title` fell back to the literal word "Thought",
     * `context` took `content`, and `visual.quote` took `content` again — so
     * the most prominent line said nothing and the body appeared twice
     * underneath it, once clamped to two lines and once to four.
     */
    const [item] = ideasToExplore([thought()])
    const preview = explorePreview(item)
    const quote = item.visual?.quote ?? ''

    expect(quote).toContain('Services margin')
    expect(preview.secondary ?? '').not.toContain('Services margin')
    expect(preview.headline).not.toContain('Services margin')
  })

  it('gives the headline the one fact the quote cannot carry', () => {
    // Who is saying it, and about what. Both come off the row; neither is
    // invented, and neither is the words themselves.
    const [item] = ideasToExplore([thought()])
    expect(item.title).toBe('Priya Raman on AAPL')
  })

  it('does not print the author twice when the headline already names them', () => {
    const [item] = ideasToExplore([thought()])
    const preview = explorePreview(item)
    expect(preview.headline).toContain('Priya Raman')
    expect(preview.source).toBeUndefined()
  })

  it('keeps the footer attribution when the post has its own title', () => {
    // The de-duplication is conditional, not a deletion: a titled post's
    // headline says nothing about who wrote it, so the footer still must.
    const [item] = ideasToExplore([thought({ title: 'Services is the whole story' })])
    const preview = explorePreview(item)
    expect(preview.headline).toBe('Services is the whole story')
    expect(preview.source).toBe('Priya Raman')
  })

  it('still draws the quote archetype for a thought', () => {
    // The fix must not cost the thought its picture — `exploreVisualFor`'s
    // whole rule for this family is that the words ARE the visual.
    const [item] = ideasToExplore([thought()])
    expect(exploreVisualFor(item).kind).toBe('quote')
  })

  it('declines the quote when the words became the headline', () => {
    /**
     * A post with no author and no ticker has nothing to attribute, so its own
     * text is the headline — and drawing it again below would be one sentence
     * twice on a 132px tile.
     */
    const [item] = ideasToExplore([thought({ author: null, asset: null })])
    expect(item.title).toContain('Services margin')
    expect(exploreVisualFor(item).kind).not.toBe('quote')
  })

  it('says what a trade proposes instead of calling it a trade idea', () => {
    const [item] = ideasToExplore([{
      id: 'p2', type: 'trade_idea', action: 'buy', status: 'deciding',
      rationale: 'The re-rate has further to run.',
      created_at: iso(-1),
      author: { first_name: 'Marcus', last_name: 'Webb' },
      asset: { id: 'nvda', symbol: 'NVDA', company_name: 'NVIDIA' },
    }])
    expect(item.title).toBe('Marcus Webb wants to buy NVDA')
    // A proposal has no quote block, so the rationale is its clause.
    expect(item.context).toBe('The re-rate has further to run.')
    expect(exploreVisualFor(item).kind).toBe('workflow')
  })

  it('falls back honestly when the row carries neither name nor ticker', () => {
    expect(postTitle({}, { isTrade: false, author: null, words: '' })).toBe('A post')
    expect(postTitle({}, { isTrade: true, author: null, words: '' })).toBe('Proposed trade')
  })
})

describe('workflow tiles', () => {
  const overdue = {
    attention_id: 'w1',
    source_type: 'project_deliverable',
    title: 'Q3 model refresh',
    created_at: iso(-20),
    due_at: iso(-4),
    next_action: 'Update model',
    priority: 'high',
  }

  it('carries the deadline that makes the tile worth a cell', () => {
    /**
     * The adapter had no metric, no state and no visual, so every workflow tile
     * was a headline and a clause — while `due_at` sat unread on the row and
     * `project_overdue` had been in `TIME_DRIVEN` since the archetypes were
     * written.
     */
    const [item] = attentionToExplore([overdue], NOW)
    expect(item.metric).toEqual({ value: '4d', label: 'overdue', direction: 'bad' })
    expect(item.state).toBe('Update model')
  })

  it('draws time through the existing archetype, not a new one', () => {
    const [item] = attentionToExplore([overdue], NOW)
    const visual = exploreVisualFor(item)
    expect(visual.kind).toBe('timeline')
    if (visual.kind === 'timeline') {
      expect(visual.statedAt).toBe(overdue.created_at)
      expect(visual.dueAt).toBe(overdue.due_at)
    }
  })

  it('calls a deadline still ahead neutral, not a problem', () => {
    const [item] = attentionToExplore([{ ...overdue, due_at: iso(3) }], NOW)
    expect(item.metric).toEqual({ value: '3d', label: 'until due', direction: 'neutral' })
  })

  it('says nothing about a deadline the row does not have', () => {
    const [item] = attentionToExplore([{ ...overdue, due_at: null }], NOW)
    expect(item.metric).toBeUndefined()
    expect(exploreVisualFor(item).kind).not.toBe('timeline')
  })

  it('does not put a sentence in a categorical slot', () => {
    // The same 26-character bar the Curate card's chip row applies, for the
    // same reason: a truncated sentence reads as a rendering fault.
    expect(shortNextAction('Update thesis, rating, or research for this covered name'))
      .toBeUndefined()
    expect(shortNextAction('review.')).toBe('Review')
  })

  it('leaves a trade-queue item alone — it is a decision, not a clock', () => {
    const [item] = attentionToExplore([{
      ...overdue, source_type: 'trade_queue_item',
    }], NOW)
    expect(item.signalType).toBe('recommendation')
    expect(exploreVisualFor(item).kind).not.toBe('timeline')
  })
})

describe('crowding tiles', () => {
  const crowded = {
    assetId: 'nvda', symbol: 'NVDA', companyName: 'NVIDIA',
    portfolioCount: 4, maxWeightPct: 3.2,
    portfolioNames: ['Vision Fund', 'Core Equity'],
    weightsByPortfolio: [
      { name: 'Vision Fund', weightPct: 3.2, valueUsd: 1 },
      { name: 'Core Equity', weightPct: 1.1, valueUsd: 1 },
    ],
    asOf: iso(-3),
  }

  it('states the largest weight once, in the picture that shows it', () => {
    /**
     * It appeared three times: as a "Largest weight 3.2%" clause, as the
     * exposure bar under it, and in the footer. One number, one home.
     */
    const [item] = lensesToExplore({ crowded: [crowded] })
    const preview = explorePreview(item)
    const visual = exploreVisualFor(item)

    expect(preview.secondary ?? '').not.toContain('3.2%')
    expect(visual.kind).toBe('exposure')
    if (visual.kind === 'exposure') {
      expect(visual.weightPct).toBe(3.2)
      // And it names the book the weight is in, rather than "the book".
      expect(visual.portfolioName).toBe('Vision Fund')
    }
  })

  it('keeps the count as the metric, because that is the finding', () => {
    const [item] = lensesToExplore({ crowded: [crowded] })
    expect(item.metric).toEqual({ value: '4', label: 'portfolios', direction: 'neutral' })
  })
})
