import { describe, it, expect } from 'vitest'
import { cardTier, TIER_HEIGHT, TIER_PX } from '../card-height'

describe('cardTier', () => {
  it('gives the text-and-chips families a compact box', () => {
    for (const t of ['news', 'thought', 'research_stale', 'awaiting_review', 'no_research'] as const) {
      expect(cardTier(t), t).toBe('compact')
    }
  })

  it('gives the middle box to families that carried a visual and still pooled space', () => {
    for (const t of ['trade_idea', 'conviction_oversized', 'crowding', 'no_target',
                     'active_risk', 'recommendation'] as const) {
      expect(cardTier(t), t).toBe('standard')
    }
  })

  it('leaves the ladder families at one viewport', () => {
    /**
     * Not an oversight. Both survive at well under a screen — scenario_gap at
     * 531px, target_expired at 400px — and both are left at one anyway,
     * because their spare height goes into the ladder rather than into a dead
     * band. Sizing them down would shrink the only thing on the card worth
     * looking at.
     */
    expect(cardTier('scenario_gap')).toBe('full')
    expect(cardTier('target_expired')).toBe('full')
  })

  it('falls back to a full screen for anything unmeasured', () => {
    // The safety property: an unmeasured type keeps exactly the layout it had
    // before tiers existed, so a missing entry can only leave room to spare.
    for (const t of ['pair_trade', 'catalyst_ahead', 'team_focus', 'target_hit',
                     'conviction_undersized', 'earnings_result'] as const) {
      expect(cardTier(t), t).toBe('full')
    }
    expect(cardTier(null)).toBe('full')
    expect(cardTier(undefined)).toBe('full')
  })

  it('orders the tiers and caps every one at the viewport', () => {
    expect(TIER_PX.compact).toBeLessThan(TIER_PX.standard)
    expect(TIER_PX.standard).toBeLessThan(TIER_PX.full)
    // The ceiling keeps the gesture contract: a card never exceeds the
    // viewport, so it never grows an inner scroller to fight the feed.
    for (const cls of Object.values(TIER_HEIGHT)) {
      expect(cls === 'h-full' || cls.includes('100dvh')).toBe(true)
    }
  })

  it('clears the largest minimum-safe height measured in each tier', () => {
    // Binary-searched per fixture; see the module header. A tier below its own
    // worst case clips a shipping card.
    expect(TIER_PX.compact).toBeGreaterThan(495)   // no_research
    expect(TIER_PX.standard).toBeGreaterThan(706)  // recommendation
  })
})
