import { useMemo } from 'react'
import { buildIdeaCard, type IdeaInput } from '../lib/signals/builders/ideas'
import { feedItemToIdeaInput, type FeedItemLike } from '../lib/signals/feed-item-input'
import { useDesktopIdeasFeed } from './useDesktopIdeasFeed'
import { lensSpec, type IdeaLens } from '../lib/desktop-ideas/lens'
import type { SignalCard } from '../lib/signals/contract'
import type { ScoredFeedItem } from './ideas/types'
import type { IdeaRow } from '../lib/desktop-ideas'
import type { FeedMode } from './ideas/useIdeasFeed'

/**
 * The desktop Explore feed, on the canonical card contract.
 *
 * ── The pipeline, and where it is shared ──────────────────────────────────
 *
 *   useIdeasFeed            candidate identity, eligibility, paging   SHARED
 *   feedItemToIdeaInput     translation into the builder's shape      SHARED
 *   buildIdeaCard           card, dedupeKey, expiry, suppression      SHARED
 *   idea-shape              maturity / stance vocabulary              SHARED
 *   ordering                                                          DESKTOP
 *   presentation                                                      DESKTOP
 *
 * Everything above ordering is the same code mobile runs. Desktop does not
 * re-derive whether a card exists, what it is called, what it dedupes against
 * or when it expires — `buildIdeaCard` decides all four, and a suppression is
 * respected rather than second-guessed.
 *
 * ── Why ordering stays desktop-specific ───────────────────────────────────
 *
 * Mobile ranks tier-first through `feed-priority`; the desktop feed scores a
 * single weighted total inside `useIdeasFeed`. Unifying the arithmetic is a
 * reordering of everybody's feed and belongs to its own reviewed change, not
 * to this one. So desktop keeps the order `useIdeasFeed` already gives it,
 * which is the order the legacy desktop feed used — no reordering ships here.
 *
 * ── Tile engine ───────────────────────────────────────────────────────────
 *
 * The engine's adoption seam is `cardOrOriginal(original, result)`: an adopted
 * family is projected through the engine, an unadopted one keeps the card its
 * shared builder made. Three producers are adopted today — stale target,
 * scenario gap, target hit — and all three are portfolio-lens derived, not
 * feed posts. So no feed family routes through the engine on desktop yet, and
 * this hook does not pretend otherwise: it produces builder cards, which is
 * the same thing mobile does for these families with `tile-engine-v2` off.
 *
 * When a post family is adopted, it is adopted for both shells at once,
 * because both arrive at the engine through the same builder output.
 */

export interface ExploreEntry {
  /** Stable across pages and renders. The card's own id, from the builder. */
  key: string
  card: SignalCard
  /**
   * The builder's own input, kept so the caller can build contextual panes.
   *
   * A card is the claim; the panes are what a reader turns over, and they are
   * assembled from the same input the card was — not re-derived from the card,
   * which has already dropped the fields a pane needs.
   */
  input: IdeaInput
  /** The row the card came from, for actions that need the raw item. */
  item: ScoredFeedItem
  /**
   * Present only for trade ideas. The investment enrichment other families
   * neither have nor need — see `useDesktopIdeasFeed`.
   */
  ideaRow: IdeaRow | null
}

export interface DesktopExploreFeed {
  entries: ExploreEntry[]
  /** Cards the shared suppression rules refused, for the debug affordance. */
  suppressedCount: number
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => void
  isError: boolean
  /** The trade-idea subset, for enrichment queries the workspace already runs. */
  ideaRows: IdeaRow[]
}

/** `quick_thoughts` rows carry prompts too; the feed returns them as one type. */
function isPrompt(item: ScoredFeedItem): boolean {
  const t = item as unknown as { idea_type?: string | null; tags?: string[] | null }
  if (t.idea_type === 'prompt') return true
  return Array.isArray(t.tags) && t.tags.some(tag => tag.startsWith('assignee:'))
}

/**
 * The lens narrows AFTER the feed, not instead of it.
 *
 * Prompts and thoughts are both `quick_thought` rows, so the feed cannot tell
 * them apart by item type alone and neither can the query. Filtering here
 * keeps one candidate set and one cache entry for both lenses — switching
 * between them is instant and refetches nothing.
 */
function inLens(item: ScoredFeedItem, lens: IdeaLens): boolean {
  if (lens === 'all') return true
  if (lens === 'prompts') return item.type === 'quick_thought' && isPrompt(item)
  if (lens === 'thoughts') return (item.type === 'quick_thought' && !isPrompt(item)) || item.type === 'note'
  const types = lensSpec(lens).types
  return !types || types.includes(item.type)
}

export function useDesktopExploreFeed(
  lens: IdeaLens,
  opts: { mode?: FeedMode; assetId?: string; portfolioId?: string; search?: string } = {},
): DesktopExploreFeed {
  /*
   * The feed is fetched UNFILTERED by lens and narrowed below.
   *
   * One query key for every lens means switching lens is a client-side filter
   * over pages already loaded — no refetch, no spinner, and no loss of the
   * reader's place. It also means `quick_thought` is fetched once and split
   * into Thoughts and Prompts without asking the database to know the
   * difference.
   */
  const feed = useDesktopIdeasFeed('all', opts)

  const entries = useMemo(() => {
    const out: ExploreEntry[] = []
    for (const item of feed.items) {
      if (!inLens(item, lens)) continue
      const input = feedItemToIdeaInput(item as unknown as FeedItemLike)
      const built = buildIdeaCard(input)
      // A suppression is the shared rules saying this should not be seen.
      // Desktop honours it rather than rendering the row anyway.
      if (!built.ok) continue
      out.push({ key: built.card.id, card: built.card, input, item, ideaRow: null })
    }
    return out
  }, [feed.items, lens])

  const suppressedCount = useMemo(() => {
    let n = 0
    for (const item of feed.items) {
      if (!inLens(item, lens)) continue
      if (!buildIdeaCard(feedItemToIdeaInput(item as unknown as FeedItemLike)).ok) n += 1
    }
    return n
  }, [feed.items, lens])

  return {
    entries,
    suppressedCount,
    isLoading: feed.isLoading,
    isFetchingNextPage: feed.isFetchingNextPage,
    hasNextPage: feed.hasNextPage,
    fetchNextPage: feed.fetchNextPage,
    isError: feed.isError,
    ideaRows: feed.ideaRows,
  }
}
