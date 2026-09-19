/**
 * The feed is becoming the candidate source for desktop Ideas. These pin the
 * two claims that adapter makes, because both are places a quiet defect has
 * already happened once in this codebase.
 */

import { describe, it, expect } from 'vitest'
import { ideaRowFromFeedItem, ideaRowsFromFeed } from '../from-feed'
import { IDEA_LENSES, lensSpec, lensShowsInvestmentFilters } from '../lens'
import type { ScoredFeedItem } from '../../../hooks/ideas/types'

const tradeIdea = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  type: 'trade_idea',
  content: 'body',
  created_at: '2026-09-01T00:00:00Z',
  author: { id: 'u1', first_name: 'Ada', last_name: 'Lovelace' },
  action: 'buy',
  urgency: 'medium',
  status: 'idea',
  score: 1,
  ...over,
} as unknown as ScoredFeedItem)

describe('ideaRowFromFeedItem', () => {
  /**
   * `action` is a four-value enum. A previous pass typed it as buy|sell, so an
   * ADD fell through an `isBuy` ternary and rendered as SELL — a card telling
   * the desk to sell a name whose author asked to add to it.
   */
  it('carries all four directions through unchanged', () => {
    for (const action of ['buy', 'sell', 'add', 'trim']) {
      expect(ideaRowFromFeedItem(tradeIdea({ action }))?.direction).toBe(action)
    }
  })

  it('returns null for every family that is not a trade idea', () => {
    for (const type of ['quick_thought', 'note', 'thesis_update', 'insight']) {
      expect(ideaRowFromFeedItem(tradeIdea({ type }))).toBeNull()
    }
  })

  it('maps stage to maturity rather than inventing one', () => {
    expect(ideaRowFromFeedItem(tradeIdea({ stage: 'deep_research' }))?.maturity).toBe('researching')
    expect(ideaRowFromFeedItem(tradeIdea({ stage: 'ready_for_decision' }))?.maturity).toBe('decision_ready')
    // No stage is a real state, and it must not throw or guess upward.
    expect(ideaRowFromFeedItem(tradeIdea({ stage: null }))?.maturity).toBe('researching')
  })

  it('prefers the written claim over the longer case for `thesis`', () => {
    const row = ideaRowFromFeedItem(tradeIdea({ rationale: 'claim', thesis_text: 'long case' }))
    expect(row?.thesis).toBe('claim')
    const fallback = ideaRowFromFeedItem(tradeIdea({ rationale: undefined, thesis_text: 'long case' }))
    expect(fallback?.thesis).toBe('long case')
  })

  /** A feed row does not know the decision outcome; null is the honest answer. */
  it('does not guess a decision outcome', () => {
    expect(ideaRowFromFeedItem(tradeIdea())?.decisionOutcome).toBeNull()
  })

  it('keeps feed order and drops non-trade families', () => {
    const rows = ideaRowsFromFeed([
      tradeIdea({ id: 'a' }),
      tradeIdea({ id: 'b', type: 'quick_thought' }),
      tradeIdea({ id: 'c' }),
    ])
    expect(rows.map(r => r.id)).toEqual(['a', 'c'])
  })
})

describe('the type lens', () => {
  /**
   * The point of the lens: investment controls exist only where every row in
   * the lens actually has a direction and a maturity. Anywhere else they would
   * silently remove other object types from a mixed feed.
   */
  it('exposes investment filters only in the trade-ideas lens', () => {
    expect(lensShowsInvestmentFilters('trade_ideas')).toBe(true)
    for (const key of ['all', 'thoughts', 'prompts'] as const) {
      expect(lensShowsInvestmentFilters(key), key).toBe(false)
    }
  })

  it('keeps a one-click route to the trade-only workflow', () => {
    const trade = IDEA_LENSES.find(l => l.key === 'trade_ideas')
    expect(trade).toBeDefined()
    expect(trade!.types).toContain('trade_idea')
  })

  /** `null` means unfiltered, and is not the same as listing specific types. */
  it('treats All as unfiltered rather than as a list of every type', () => {
    expect(lensSpec('all').types).toBeNull()
    expect(lensSpec('trade_ideas').types).not.toBeNull()
  })

  /**
   * No Signals lens until the machine-derived producers are reachable from
   * desktop. A tab over a feed that cannot produce a signal is a dead label.
   */
  it('does not offer a lens the feed cannot fill', () => {
    expect(IDEA_LENSES.map(l => l.key)).toEqual(['all', 'trade_ideas', 'thoughts', 'prompts'])
  })

  it('falls back to All for an unknown key rather than throwing', () => {
    expect(lensSpec('nope' as never).key).toBe('all')
  })
})
