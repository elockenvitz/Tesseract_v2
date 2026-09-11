import { useMemo } from 'react'
import { useIdeasFeed, type FeedMode, type IdeasFeedFilters } from './ideas/useIdeasFeed'
import { ideaRowsFromFeed } from '../lib/desktop-ideas/from-feed'
import { lensSpec, type IdeaLens } from '../lib/desktop-ideas/lens'
import type { ScoredFeedItem } from './ideas/types'
import type { IdeaRow } from '../lib/desktop-ideas'

/**
 * The canonical Ideas candidate set, for desktop.
 *
 * ── What changed ──────────────────────────────────────────────────────────
 *
 * `useIdeaScan` read `trade_queue_items` directly: one table, 200 rows,
 * ordered by `updated_at`, an investment-object browser you could scan to the
 * end of. `useIdeasFeed` is what mobile reads: seven item types across several
 * tables, paged, with signal cards mixed in — the surface people actually
 * found useful.
 *
 * The feed wins as the source of candidates. This hook is the one place
 * desktop asks for them, so there is no second definition of "what is in
 * Ideas" for the two shells to drift apart on.
 *
 * `useIdeaScan` does not disappear. It becomes the ENRICHMENT source for the
 * trade-idea subset — exposure, framework, open price and detail all key off
 * `IdeaRow` and all remain correct — which is how the widening keeps the
 * workspace depth instead of trading it away.
 *
 * ── Paging, and why the bounded list is gone ──────────────────────────────
 *
 * The feed pages 20 at a time and continues. That is a deliberate trade: an
 * attention surface is not a database listing, and the 200-row ceiling was
 * only ever a ceiling. Desktop inherits the feed's paging rather than growing
 * a second pagination model beside it.
 *
 * ── Why the filters object is memoised ────────────────────────────────────
 *
 * It is part of `useIdeasFeed`'s query key. Opening an item must not refetch
 * the feed or reset its scroll, so the key has to be stable across the renders
 * that selection causes. Built from the lens and the primitives the caller
 * passes, and nothing else.
 */
export interface DesktopIdeasFeed {
  /** Every candidate in the current lens, in feed order. */
  items: ScoredFeedItem[]
  /**
   * The trade-idea subset, projected onto the desktop Idea object.
   *
   * Non-trade families are absent by design, not missing: only a trade idea
   * has a direction, a maturity and a proposed weight.
   */
  ideaRows: IdeaRow[]
  isLoading: boolean
  /** False while user/org identity is still hydrating. See `useIdeasFeed`. */
  isContextReady: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => void
  isError: boolean
  refetch: () => void
}

export function useDesktopIdeasFeed(
  lens: IdeaLens,
  opts: { mode?: FeedMode; assetId?: string; portfolioId?: string; search?: string } = {},
): DesktopIdeasFeed {
  const spec = lensSpec(lens)
  const { mode = 'for_you', assetId, portfolioId, search } = opts

  const filters = useMemo<IdeasFeedFilters>(() => ({
    mode,
    // `null` means unfiltered. An empty array would ask the feed for nothing,
    // which is a different question and the wrong one for the All lens.
    ...(spec.types && spec.types.length ? { types: spec.types } : {}),
    ...(assetId ? { assetId } : {}),
    ...(portfolioId ? { portfolioId } : {}),
    ...(search ? { search } : {}),
  }), [mode, spec.types, assetId, portfolioId, search])

  const feed = useIdeasFeed(filters)

  const ideaRows = useMemo(() => ideaRowsFromFeed(feed.items), [feed.items])

  return {
    items: feed.items,
    ideaRows,
    isLoading: feed.isLoading,
    isContextReady: feed.isContextReady,
    isFetchingNextPage: feed.isFetchingNextPage,
    hasNextPage: feed.hasNextPage,
    fetchNextPage: () => { void feed.fetchNextPage() },
    isError: feed.isError,
    refetch: () => { void feed.refetch() },
  }
}
