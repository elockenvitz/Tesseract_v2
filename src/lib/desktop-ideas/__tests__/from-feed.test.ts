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
    expect(ideaRowFromFeedItem(tradeIdea({ stage: 'researching' }))?.maturity).toBe('researching')
    expect(ideaRowFromFeedItem(tradeIdea({ stage: 'developing' }))?.maturity).toBe('thesis_forming')
    expect(ideaRowFromFeedItem(tradeIdea({ stage: 'ready_to_recommend' }))?.maturity).toBe('decision_ready')
    // A pre-migration row still resolves rather than falling through.
    expect(ideaRowFromFeedItem(tradeIdea({ stage: 'deep_research' }))?.maturity).toBe('thesis_forming')
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
   * ── The rail grew a second band, and the rule it was pinned to changed ──
   *
   * This asserted the exact four post lenses, under the heading "no Signals
   * lens until the machine-derived producers are reachable from desktop".
   * They are reachable now -- `useDesktopAttentionFeed` builds scenario,
   * research and recommendation candidates, and the Dashboard turns the last
   * two on -- so the condition the case was guarding has been met rather
   * than abandoned.
   *
   * What the case was really protecting is the rule that a chip must have
   * something behind it, and a frozen list is a weak way to say that: it
   * fails on every addition, correct or not, and says nothing about whether
   * the chip works. So it is rewritten as the rule itself -- every lens
   * selects either post types or card types, and the two bands are exactly
   * that split. A lens that selected neither would be a label over the whole
   * feed, which is what "a dead label" meant.
   *
   * `all` is the deliberate exception and is named, not excused: it selects
   * nothing because it means everything.
   */
  it('gives every lens something to select, and sorts the rail by which', () => {
    for (const l of IDEA_LENSES) {
      if (l.key === 'all') {
        expect(l.types, 'All is unfiltered by design').toBeNull()
        expect(l.cardTypes).toBeNull()
        continue
      }
      const selects = !!l.types || !!l.cardTypes || !!l.othersOnly
      expect(selects, `${l.key} is a chip with nothing behind it`).toBe(true)
      /* Never both. A chip that mixed post types and card types would be the
         mixed-candidate-set problem the lens exists to prevent. */
      expect(!!l.types && !!l.cardTypes, `${l.key} selects posts AND cards`).toBe(false)
      /* The band follows what it selects: post types before the rule, cards
         and the desk's own posts after it. */
      expect(l.group, l.key).toBe(l.types ? 'post' : 'signal')
    }
    /* And the rail is ORDERED by band, so the divider is drawn once. */
    const groups = IDEA_LENSES.map(l => l.group)
    expect(groups.indexOf('post')).toBe(0)
    expect(groups.lastIndexOf('post')).toBeLessThan(groups.indexOf('signal'))
  })

  it('falls back to All for an unknown key rather than throwing', () => {
    expect(lensSpec('nope' as never).key).toBe('all')
  })
})
