import { describe, it, expect } from 'vitest'
import { cardTier, TIER_HEIGHT, TIER_PX } from '../card-height'

describe('cardTier', () => {
  it('gives the text-and-chips families a compact box', () => {
    for (const t of ['news', 'thought', 'research_stale', 'awaiting_review'] as const) {
      expect(cardTier(t), t).toBe('compact')
    }
  })

  it('gives no_research its own step, between the two it does not fit', () => {
    /**
     * Measured, not assumed. Its material variant needs 483px, which clips at
     * compact; and standard is worse rather than better, because one pane is
     * not a carousel and the card pools the extra rather than absorbing it.
     */
    expect(cardTier('no_research')).toBe('medium')
    expect(TIER_PX.medium).toBeGreaterThan(483)
    expect(TIER_PX.medium).toBeGreaterThan(TIER_PX.compact)
    expect(TIER_PX.medium).toBeLessThan(TIER_PX.standard)
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

  it('orders the tiers and caps every one against its scroller', () => {
    expect(TIER_PX.compact).toBeLessThan(TIER_PX.medium)
    expect(TIER_PX.medium).toBeLessThan(TIER_PX.standard)
    expect(TIER_PX.standard).toBeLessThan(TIER_PX.full)
    /**
     * Every tier is capped against its PARENT, not against the viewport.
     *
     * This asserted `100dvh`, which is the bug it was meant to prevent. The
     * feed scroller is not the viewport — the app chrome above it takes about
     * 110px — so on a real 400x700 device `min(46rem, 100dvh)` resolved to
     * 700px inside a 590px scroller and the card overflowed its own box by
     * 110px, putting the action bar out of view. `max-h-full` resolves against
     * the slot, which is the box the card actually has to fit inside.
     */
    for (const cls of Object.values(TIER_HEIGHT)) {
      expect(cls === 'h-full' || cls.includes('max-h-full'), cls).toBe(true)
      expect(cls.includes('100dvh'), `${cls} caps against the viewport, not the scroller`).toBe(false)
    }
  })

  it('clears the largest minimum-safe height measured in each tier', () => {
    // Binary-searched per fixture; see the module header. A tier below its own
    // worst case clips a shipping card.
    expect(TIER_PX.compact).toBeGreaterThan(430)   // judgment pane open
    expect(TIER_PX.standard).toBeGreaterThan(706)  // recommendation
  })
})
