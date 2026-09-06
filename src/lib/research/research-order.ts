/**
 * How the Research family orders itself when the reader asks for it by name.
 *
 * ── The problem, and where it comes from ──────────────────────────────────
 *
 * `feed-priority` partitions by TIER and the mixed feed leads with everything
 * at or below `LEAD_TIER`. That is right for the mixed feed: tier 1 is "the
 * framework is missing", tier 2 is "worth a look", and a missing framework
 * genuinely outranks a look when the reader is being shown everything at once.
 *
 * Under Curate → Research it produces a feed that is useless. `no_research` is
 * tier 1 and `research_stale` is tier 2, so EVERY no-case card precedes EVERY
 * evidence, move and silence card — structurally, not as a scoring accident.
 * Widening the universe to coverage made that fatal rather than merely wrong:
 * production has 45 candidates with no written case against 9 with one, so the
 * reader who asks for Research gets forty-five "no written case" tiles before
 * the first thing that actually happened.
 *
 * ── Why a separate policy rather than a tier change ───────────────────────
 *
 * The two questions are genuinely different, and the tiers answer one of them
 * correctly:
 *
 *   MIXED FEED    "what deserves my attention across everything?"
 *                 A missing framework beats a look. Unchanged.
 *
 *   RESEARCH      "where should I spend research time?"
 *                 Something that HAPPENED beats a standing gap, because the gap
 *                 will be there tomorrow and the reader can plan for it.
 *
 * Changing the tier table would answer the second question by breaking the
 * first. So this is a scoped reordering applied only when the pool is already
 * entirely Research, and the general feed never reaches it.
 *
 * ── Deterministic ─────────────────────────────────────────────────────────
 *
 * No seed, no sampling, no clock. The same pool yields the same order every
 * time, which is the property `feed-priority`'s header argues for at length and
 * the reason `interleaveByKind` was taken off the head of the feed.
 *
 * Pure — no React, no Supabase. See `case-state.ts`.
 */

import type { ResearchFraming } from './case-state'

/**
 * The bands, strongest first. A hard partition, like a tier.
 *
 *   0  Something arrived that the case has not answered.
 *   1  The market moved and the case has not answered it.
 *   2  A case is missing or half-written on a name the book actually holds.
 *   3  A complete case nobody has revisited in a quarter.
 *   4  A case gap on a name the book does not hold.
 *
 * ── Why "held" is the line for a case gap ─────────────────────────────────
 *
 * Coverage put unheld names in the universe and they belong there: a covered
 * name with no case is real research work. But presence in the universe is not
 * priority, and the book is the honest discriminator — money is exposed to the
 * missing case, which is a reason to write it this week rather than this
 * quarter. Weight then orders within the band through `materialityBand`, so a
 * 5.1% MSFT leads an unsized holding without needing a second threshold here.
 *
 * Deliberately NOT a weight cutoff: 26 of 36 current production positions carry
 * no weight at all, so a threshold would file most of the book under "not
 * material" on missing data.
 */
export type ResearchBand = 0 | 1 | 2 | 3 | 4

export function researchBand(framing: ResearchFraming, held: boolean): ResearchBand {
  switch (framing) {
    case 'new_evidence': return 0
    case 'price_move': return 1
    case 'long_silence': return 3
    // no_case and incomplete_case split on exposure, not on which of the two
    // they are: half a case on a 5% position is more urgent research work than
    // no case on a watchlist name, and the reverse reads as busywork.
    default: return held ? 2 : 4
  }
}

/** The minimum a candidate has to expose to be ordered here. */
export interface ResearchOrderable {
  framing: ResearchFraming
  held: boolean
  /** `priority.total` — orders within a band, and is already materiality-aware. */
  total: number
  /** Stable tie-break, so equal scores cannot reorder between renders. */
  id: string
}

/**
 * How many cards of one framing may run before a different one is pulled up.
 *
 * ── Why a cap at all, when the bands are already correct ──────────────────
 *
 * Band 2 has about thirty members in production and band 3 has one. Strict band
 * order buries the single "case not revisited" card behind thirty "no written
 * case" tiles, and the reader learns after the fourth identical pill that
 * scrolling is not worth it — which is the same monopolisation the banding was
 * introduced to fix, moved one band down rather than removed.
 *
 * Two, not three: the point is that the reader meets the SHAPE of their
 * research load in the first screens, and a third consecutive identical pill
 * teaches nothing the second did not.
 *
 * This is the only rule here that can put a weaker card above a stronger one,
 * and it is bounded: it promotes the best remaining card of some other framing,
 * never a worse card of the same one, and only when one is waiting.
 */
const MAX_RUN = 2

/**
 * Order a Research-only pool: band first, score second, with a run cap.
 *
 * Returns a new array. The input is not mutated, because the caller is holding
 * the ranked feed that the general path also reads.
 */
export function researchScopedOrder<T extends ResearchOrderable>(items: readonly T[]): T[] {
  const remaining = [...items].sort((a, b) => {
    const bandA = researchBand(a.framing, a.held)
    const bandB = researchBand(b.framing, b.held)
    if (bandA !== bandB) return bandA - bandB
    if (b.total !== a.total) return b.total - a.total
    // Never render-order dependent: two cards with the same band and the same
    // score must come out the same way on every pass.
    return a.id.localeCompare(b.id)
  })

  const out: T[] = []
  let runFraming: ResearchFraming | null = null
  let runLength = 0

  while (remaining.length) {
    let pick = 0
    if (runFraming != null && runLength >= MAX_RUN) {
      // The best card of ANY other framing, in the order already established
      // above — so the promotion is to the strongest available alternative,
      // not to whatever happens to be adjacent.
      const alt = remaining.findIndex(r => r.framing !== runFraming)
      if (alt > -1) pick = alt
    }

    const [next] = remaining.splice(pick, 1)
    out.push(next)

    if (next.framing === runFraming) {
      runLength += 1
    } else {
      runFraming = next.framing
      runLength = 1
    }
  }

  return out
}
