import { describe, it, expect } from 'vitest'
import { cardTier, TIER_HEIGHT, TIER_PX } from '../card-height'

describe('cardTier', () => {
  it('gives the low-information families a compact box', () => {
    // Measured at 338-418px of content against an 844px box.
    expect(cardTier('news')).toBe('compact')
    expect(cardTier('thought')).toBe('compact')
    expect(cardTier('research_stale')).toBe('compact')
  })

  it('gives the chart-and-ladder families the middle box', () => {
    // Measured at 547-637px.
    expect(cardTier('scenario_gap')).toBe('standard')
    expect(cardTier('target_expired')).toBe('standard')
    expect(cardTier('trade_idea')).toBe('standard')
    expect(cardTier('crowding')).toBe('standard')
    expect(cardTier('awaiting_review')).toBe('standard')
  })

  it('keeps a full screen for the families that fill one', () => {
    // Measured at 695-785px.
    expect(cardTier('active_risk')).toBe('tall')
    expect(cardTier('recommendation')).toBe('tall')
    expect(cardTier('no_target')).toBe('tall')
    expect(cardTier('conviction_oversized')).toBe('tall')
  })

  it('falls back to a full screen for anything unmeasured', () => {
    /**
     * The safety property. An unmeasured type keeps exactly the layout it had
     * before tiers existed, so the worst a missing entry can do is leave room
     * to spare — never clip a card nobody has looked at.
     */
    expect(cardTier('pair_trade')).toBe('tall')
    expect(cardTier('catalyst_ahead')).toBe('tall')
    expect(cardTier('earnings_result')).toBe('tall')
    expect(cardTier('team_focus')).toBe('tall')
  })

  it('orders the tiers, and caps every one at the viewport', () => {
    expect(TIER_PX.compact).toBeLessThan(TIER_PX.standard)
    expect(TIER_PX.standard).toBeLessThan(TIER_PX.tall)
    // The ceiling is what keeps a card from growing an inner vertical
    // scroller to fight the feed for a drag.
    for (const cls of Object.values(TIER_HEIGHT)) {
      expect(cls === 'h-full' || cls.includes('100dvh')).toBe(true)
    }
  })

  it('leaves headroom over the tallest content measured in each tier', () => {
    // The measurements this table was built from. A tier that dropped below
    // its own worst case would clip a shipping card.
    expect(TIER_PX.compact).toBeGreaterThan(418)
    expect(TIER_PX.standard).toBeGreaterThan(637)
    expect(TIER_PX.tall).toBeGreaterThan(785)
  })
})
