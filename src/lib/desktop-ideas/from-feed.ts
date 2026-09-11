import { maturityOf, type IdeaRow } from './model'
import type { ScoredFeedItem } from '../../hooks/ideas/types'

/**
 * A canonical feed item, projected onto the desktop Idea object.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Desktop Ideas and mobile Ideas disagreed about what an Idea IS. Desktop read
 * `trade_queue_items` directly through `useIdeaScan` — 200 rows, one table, an
 * investment object. Mobile reads `useIdeasFeed` — seven item types across
 * several tables, paged, with signal cards mixed in. Same product name, two
 * candidate sets, and only one of them was the one the reader found useful.
 *
 * The feed wins as the candidate source. This is the adapter that lets it,
 * without throwing away the investment enrichment the desktop workspace has
 * built on `IdeaRow`: exposure, framework, open price, targets and detail all
 * key off that shape, and all of them remain correct for the trade-idea subset
 * of the feed.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *
 * It is not a general flattening of the feed into one schema. Only
 * `trade_idea` projects onto `IdeaRow`, because only a trade idea HAS a
 * direction, a maturity and a proposed weight. A quick thought asked for those
 * fields would answer null four times and mean nothing by it. Every other
 * family keeps its own shape and opens its own workspace.
 *
 * Pure: no React, no Supabase, no clock. Testable on its own, and callable
 * from either shell.
 */

/** The feed's own name for the family this adapter accepts. */
export const IDEA_OBJECT_TYPE = 'trade_idea' as const

/**
 * `null` for every family that is not a trade idea.
 *
 * Returning null rather than a half-filled `IdeaRow` is deliberate: a caller
 * that wants investment enrichment must be holding a row that can carry it,
 * and the type system should say so at the boundary rather than let four nulls
 * travel into a framework lookup.
 */
export function ideaRowFromFeedItem(item: ScoredFeedItem): IdeaRow | null {
  if (item.type !== IDEA_OBJECT_TYPE) return null

  const author = item.author
  const authorName =
    author?.full_name ||
    [author?.first_name, author?.last_name].filter(Boolean).join(' ') ||
    author?.email ||
    null

  return {
    id: item.id,
    assetId: item.asset?.id ?? null,
    symbol: item.asset?.symbol ?? null,
    companyName: item.asset?.company_name ?? null,
    // `action` is the four-value enum the database actually stores. It is NOT
    // narrowed to buy/sell here — a pass that assumed two values rendered
    // every `add` as SELL, which is the worst defect this surface can carry.
    direction: item.action ?? null,
    stage: item.stage ?? null,
    maturity: maturityOf(item.stage),
    conviction: item.conviction ?? null,
    // `rationale` is the central claim as written; `thesis_text` is the longer
    // case where an author wrote one. The scan's `thesis` field means the
    // former, so the fallback direction matters.
    thesis: item.rationale ?? item.thesis_text ?? item.content ?? null,
    urgency: item.urgency ?? null,
    proposedWeight: item.proposed_weight ?? null,
    portfolioId: item.portfolio?.id ?? null,
    portfolioName: item.portfolio?.name ?? null,
    createdBy: author?.id ?? null,
    authorName,
    createdAt: item.created_at,
    updatedAt: item.updated_at ?? null,
    // Not carried on the feed row. The scan reads it for the decided-state
    // badge; a feed-sourced row simply does not know yet, and null is the
    // honest answer rather than a guessed 'pending'.
    decisionOutcome: null,
  }
}

/** Every trade idea in a page of mixed feed items, in the order given. */
export function ideaRowsFromFeed(items: ScoredFeedItem[]): IdeaRow[] {
  const rows: IdeaRow[] = []
  for (const item of items) {
    const row = ideaRowFromFeedItem(item)
    if (row) rows.push(row)
  }
  return rows
}
