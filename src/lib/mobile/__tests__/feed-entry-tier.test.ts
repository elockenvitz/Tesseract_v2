import { describe, it, expect } from 'vitest'
import { feedEntryTier } from '../feed-entry-tier'

describe('feedEntryTier', () => {
  it('asks a contract card for its own type', () => {
    expect(feedEntryTier({ kind: 'scenario', card: { type: 'scenario_gap' } })).toBe('standard')
    expect(feedEntryTier({ kind: 'template', card: { type: 'news' } })).toBe('compact')
    expect(feedEntryTier({ kind: 'signal', signal: { type: 'active_risk' } })).toBe('tall')
  })

  it('reads a post through the builder\'s own map', () => {
    expect(feedEntryTier({ kind: 'idea', idea: { type: 'quick_thought' } })).toBe('compact')
    expect(feedEntryTier({ kind: 'idea', idea: { type: 'trade_idea' } })).toBe('standard')
  })

  it('does not let the ranker\'s coarser type clip a post', () => {
    /**
     * The distinction this module exists to get right. The RANKER collapses
     * `note` and `thesis_update` into `thought`, which is a compact tier — but
     * they render as their own card types, which nobody has measured. Following
     * the ranker here would reserve 464px for a card that needs more.
     */
    expect(feedEntryTier({ kind: 'idea', idea: { type: 'note' } })).toBe('tall')
    expect(feedEntryTier({ kind: 'idea', idea: { type: 'thesis_update' } })).toBe('tall')
  })

  it('gives a news entry a compact box', () => {
    expect(feedEntryTier({ kind: 'news', news: { id: 'n1' } })).toBe('compact')
  })

  it('keeps a full screen for the kinds it cannot classify', () => {
    for (const kind of ['attention', 'insight', 'lens', 'something-new']) {
      expect(feedEntryTier({ kind }), kind).toBe('tall')
    }
    expect(feedEntryTier({})).toBe('tall')
    expect(feedEntryTier({ kind: 'scenario' })).toBe('tall')
    expect(feedEntryTier({ kind: 'idea', idea: {} })).toBe('tall')
  })
})
