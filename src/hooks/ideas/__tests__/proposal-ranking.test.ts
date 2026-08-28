import { describe, expect, it } from 'vitest'

import { rankCandidatesForTest } from '../useIdeasFeed'
import { PROPOSAL_RECENCY_FLOOR_FOR_TEST } from '../../../lib/signals/feed-priority'

/**
 * The single-row scorer this used to call is gone: ranking is canonical now,
 * drops suppressed rows and sorts by tier before score, so scoring one item in
 * isolation can no longer express what the pipeline does. `score` ranks a
 * one-item set and reads the priority back.
 */
const score = (it: any, ctx: any = CTX) => {
  const [ranked] = rankCandidatesForTest([it], ctx)
  return {
    score: ranked.priority.total,
    recency: ranked.priority.components.recency,
    tier: ranked.priority.tier,
  }
}

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

const SCOPED_ASSET = 'aaaaaaaa-1111-4111-8111-111111111111'
const SCOPED_INDEX = {
  ready: true,
  direct: new Set([SCOPED_ASSET]),
  assigned: new Set<string>(),
  held: new Set([SCOPED_ASSET]),
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
    const old = score(item('trade_idea', 4098))
    // At the floor rather than at zero. The floor is a proportion of the
    // canonical recency span, not of a 0-1 freshness term — see
    // PROPOSAL_RECENCY_FLOOR.
    expect(old.recency).toBeCloseTo(PROPOSAL_RECENCY_FLOOR_FOR_TEST, 10)
  })

  it('applies to pair trades too', () => {
    // Pairs are proposals by the same definition, and are equally old.
    expect(score(item('pair_trade', 4098)).recency)
      .toBeCloseTo(PROPOSAL_RECENCY_FLOOR_FOR_TEST, 10)
  })

  it('still prefers a fresh proposal to an old one', () => {
    // A floor, not a flat rate. Recency still orders proposals among
    // themselves; it just cannot round them all to nothing.
    const fresh = score(item('trade_idea', 2))
    const stale = score(item('trade_idea', 4098))
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
    /**
     * The canonical decay is linear over 14 days rather than an 18-hour
     * half-life — one recency curve for the whole product instead of two. A day
     * old is therefore a small deduction, not half the term. What is preserved
     * is the direction and the fact that a thought DOES decay where a proposal
     * does not.
     */
    const fresh = score(item('quick_thought', 0))
    const day = score(item('quick_thought', 24))
    expect(day.recency).toBeLessThan(fresh.recency)
    expect(day.recency).toBeGreaterThan(0)
  })

  it('leaves an old thought near zero, as intended', () => {
    expect(score(item('quick_thought', 4098)).recency).toBe(0)
  })
})

describe('a proposal competes rather than dominates', () => {
  it("does not automatically outrank this week's writing", () => {
    /**
     * The floor is 0.55, not 1.0. An idea from February should reach the page
     * — it is a live question — but it should not lead a feed over something
     * a colleague wrote this morning about a name you hold.
     */
    const proposal = score(item('trade_idea', 4098))
    // In the reader's personal scope, and by somebody they follow: the
    // strongest a fresh post can be.
    const scoped = score(
      { ...item('quick_thought', 1), asset: { id: SCOPED_ASSET } },
      { ...CTX, followedIds: ['someone'], coverageIndex: SCOPED_INDEX },
    )
    expect(scoped.score).toBeGreaterThan(proposal.score)
  })

  it('beats an equally unremarkable post from months ago', () => {
    // Which is the point: among the old, the one still awaiting a decision is
    // the one worth surfacing.
    const proposal = score(item('trade_idea', 4098))
    const oldPost = score(item('quick_thought', 4098))
    expect(proposal.score).toBeGreaterThan(oldPost.score)
  })
})
