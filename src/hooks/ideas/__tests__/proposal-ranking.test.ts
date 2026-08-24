import { describe, expect, it } from 'vitest'

import { scoreFeedItemForTest as score } from '../useIdeasFeed'

/**
 * The ranking is what buried open proposals — the fifth and last cause behind
 * "I see no trade ideas".
 *
 * The four before it were all real and none was sufficient: the status rule
 * (only `status = 'idea'` counted), the time window (90 days, when the newest
 * open proposal was 23 days old and the rest were months), diversity deleting
 * rather than deferring, and the Explore adapter mismatches. Each fix moved
 * rows further along the pipeline. This is the stage that dropped them at the
 * end.
 *
 * Freshness decays on an 18-hour half-life. Measured against production on
 * 2026-08-23: the newest open proposal in the reporting org is 553 hours old
 * and the average is 4,098 — so `0.5^(553/18)` is about five ten-billionths.
 * Every idea scored as if it had no recency at all, sorted below anything
 * written this week, and `fetchFeedPage` slices to PAGE_SIZE before the mobile
 * feed sees the list.
 */

const CTX = {
  userId: 'u1',
  organizationId: 'o1',
  followedIds: [] as string[],
  heldAssetIds: new Set<string>(),
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const item = (type: string, ageHours: number) => ({
  id: `${type}:${ageHours}`,
  type,
  content: 'A reasonable amount of rationale, long enough to count as content.',
  created_at: hoursAgo(ageHours),
  author: { id: 'someone' },
} as any)

describe('an open proposal does not age like a comment', () => {
  it('survives being months old', () => {
    /**
     * The exact production case: 4,098 hours. Under the old rule this scored
     * 0.5^227, which is zero in any arithmetic that matters.
     */
    const old = score(item('trade_idea', 4098), CTX, 'for_you')
    expect(old.scoreBreakdown.recency).toBeGreaterThan(0.5)
  })

  it('applies to pair trades too', () => {
    // Pairs are proposals by the same definition, and are equally old.
    expect(score(item('pair_trade', 4098), CTX, 'for_you').scoreBreakdown.recency)
      .toBeGreaterThan(0.5)
  })

  it('still prefers a fresh proposal to an old one', () => {
    // A floor, not a flat rate. Recency still orders proposals among
    // themselves; it just cannot round them all to nothing.
    const fresh = score(item('trade_idea', 2), CTX, 'for_you')
    const stale = score(item('trade_idea', 4098), CTX, 'for_you')
    expect(fresh.score).toBeGreaterThan(stale.score)
  })
})

describe('the decay is unchanged for everything else', () => {
  it('still decays a thought on the original half-life', () => {
    /**
     * The 18-hour half-life is right for the sources this scorer was written
     * for. Widening the floor to everything would have made the feed stop
     * caring about recency at all, which is a different bug.
     */
    const fresh = score(item('quick_thought', 0), CTX, 'for_you')
    const day = score(item('quick_thought', 18), CTX, 'for_you')
    expect(day.scoreBreakdown.recency).toBeCloseTo(fresh.scoreBreakdown.recency / 2, 2)
  })

  it('leaves an old thought near zero, as intended', () => {
    expect(score(item('quick_thought', 4098), CTX, 'for_you').scoreBreakdown.recency)
      .toBeLessThan(0.001)
  })
})

describe('a proposal competes rather than dominates', () => {
  it("does not automatically outrank this week's writing", () => {
    /**
     * The floor is 0.55, not 1.0. An idea from February should reach the page
     * — it is a live question — but it should not lead a feed over something
     * a colleague wrote this morning about a name you hold.
     */
    const proposal = score(item('trade_idea', 4098), CTX, 'for_you')
    // Held, and by somebody followed: the strongest a fresh post can be.
    const withAsset = score(
      { ...item('quick_thought', 1), asset: { id: 'a1' } },
      { ...CTX, followedIds: ['someone'], heldAssetIds: new Set(['a1']) },
      'for_you',
    )
    expect(withAsset.score).toBeGreaterThan(proposal.score)
  })

  it('beats an equally unremarkable post from months ago', () => {
    // Which is the point: among the old, the one still awaiting a decision is
    // the one worth surfacing.
    const proposal = score(item('trade_idea', 4098), CTX, 'for_you')
    const oldPost = score(item('quick_thought', 4098), CTX, 'for_you')
    expect(proposal.score).toBeGreaterThan(oldPost.score)
  })
})
