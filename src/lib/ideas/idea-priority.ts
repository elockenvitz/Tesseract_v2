/**
 * A feed post, as the canonical ranker sees it. One mapping, both shells.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Two rankers and two mappings. Desktop's `scoreFeedItem` produced a flat score
 * from freshness, author, asset relevance, quality and engagement; mobile's
 * `rankInputFor` produced a `PriorityInput` from a subset of the same row and
 * threw desktop's score away. The same post therefore had two priorities, and
 * — because mobile consumed desktop's already-ranked page — one of them decided
 * whether the other ever ran.
 *
 * There is now one priority per post. The shells differ in how many they show
 * and how they arrange them, which is presentation, and agree on what the post
 * is worth, which is not.
 *
 * ── What this file is allowed to decide ───────────────────────────────────
 *
 * How to read a feed row. Nothing about what the reading is worth: every weight
 * lives in `feed-priority`, every scope band in `coverage-relevance`, every
 * suppression window in `judgment-policy`. If a number appears here, it is in
 * the wrong file.
 */

import { ideaCardType } from '../signals/builders/ideas'
import { scopeRelevanceFor, EMPTY_COVERAGE_INDEX, type CoverageIndex } from '../signals/coverage-relevance'
import {
  compareRanked, priorityFor, type PriorityInput, type RankedItem,
} from '../signals/feed-priority'
import type { DispositionMap } from '../signals/dispositions'
import { judgmentRecordFor } from './feed-suppression'
import type { Severity } from '../signals/contract'

/** Everything about the reader that ranking a post depends on. */
export interface IdeaRankContext {
  userId: string | null
  followedIds: readonly string[]
  coverageIndex?: CoverageIndex
  dispositions?: DispositionMap
}

/** The least a row needs to be ranked. Structural, so both shells' shapes fit. */
export interface RankableIdea {
  id: string | number
  type: string
  created_at: string
  author?: { id?: string | null } | null
  asset?: { id?: string | null } | null
  reactionCounts?: readonly { count: number }[] | null
}

/**
 * A proposal is `attention`, everything else is `informational`.
 *
 * The same split `buildIdeaCard` already makes, and for its reason: a colleague
 * proposing a trade is asking for something, where a thought is offering
 * something. Nothing here is `critical` — a red rule on somebody's post would
 * devalue the mark everywhere it means a real problem.
 */
const severityOf = (type: string): Severity =>
  type === 'trade_idea' || type === 'pair_trade' ? 'attention' : 'informational'

/** In the feed because it is still open, not because it is recent. */
export const isOpenProposal = (type: string): boolean =>
  type === 'trade_idea' || type === 'pair_trade'

/**
 * Who wrote it, relative to the reader.
 *
 * Desktop's three-way `authorRelevance` survives as a relation rather than as a
 * number, because "followed" is a fact and 0.9 was an opinion — and the opinion
 * belongs with the other weights, in one file, where it can be argued with.
 */
function authorRelationFor(
  item: RankableIdea,
  ctx: IdeaRankContext,
): 'self' | 'followed' | 'other' {
  const authorId = item.author?.id ?? null
  if (!authorId) return 'other'
  if (authorId === ctx.userId) return 'self'
  return ctx.followedIds.includes(authorId) ? 'followed' : 'other'
}

/**
 * Read a feed row into the canonical ranker's input.
 *
 * ── Why `ideaCardType` and not the ranker's old `ideaSignalType` ──────────
 *
 * Mobile tiered posts through `ideaSignalType`, which answers a coarser
 * question — trade idea, or thought — and collapses notes, thesis updates and
 * discussion into one bucket. The TIER table has always carried distinct
 * entries for all of them (thesis_update 0.60, research_note 0.55,
 * discussion 0.45, thought 0.40), argued for when it was written and then
 * unreachable from the one surface that ranked posts.
 *
 * The canonical model understands the content types once. That reorders the
 * tail of the mobile feed — a note now leads a raw thought — and touches
 * nothing above tier 4, because every post is in tier 4 and the tier sort runs
 * before the score.
 */
export function ideaPriorityInput(
  item: RankableIdea,
  ctx: IdeaRankContext,
): PriorityInput {
  const assetId = item.asset?.id ?? null
  return {
    id: String(item.id),
    type: ideaCardType(item.type),
    severity: severityOf(item.type),
    occurredAt: item.created_at,
    // A post is not a position: it carries no weight and no deviation, and
    // saying so explicitly keeps `materialityBand`'s neutral band from being
    // mistaken for a claim about the book.
    weightPct: null,
    held: false,
    scope: scopeRelevanceFor(ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX, assetId),
    authorRelation: authorRelationFor(item, ctx),
    engagementCount: item.reactionCounts?.reduce((sum, r) => sum + r.count, 0) ?? 0,
    openProposal: isOpenProposal(item.type),
    judgment: ctx.dispositions
      ? judgmentRecordFor({ id: String(item.id), type: item.type }, ctx.dispositions)
      : null,
  }
}

/**
 * Rank a candidate set. Suppressed rows are dropped, exactly as `rankFeed` does.
 *
 * Returns `RankedItem`s rather than a bare order so a shell can read the tier,
 * the components and the reasons without recomputing anything — which is what
 * lets desktop and mobile present the same intelligence differently instead of
 * deriving it twice.
 */
export function rankIdeaCandidates<T extends RankableIdea>(
  items: readonly T[],
  ctx: IdeaRankContext,
  now: number,
): RankedItem<T>[] {
  return items
    .map(item => {
      const input = ideaPriorityInput(item, ctx)
      return { item, input, priority: priorityFor(input, now) }
    })
    .filter(r => !r.priority.suppressed)
    .sort(compareRanked)
}
