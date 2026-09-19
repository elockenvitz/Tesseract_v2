import { useRef } from 'react'
import { usePortfolioLenses } from './mobile/usePortfolioLenses'
import { useScenarioCards } from './mobile/useScenarioCards'
import { useDerivedInsights } from './mobile/useDerivedInsights'
import { useDesktopIdeasFeed } from './useDesktopIdeasFeed'
import type { ScoredFeedItem } from './ideas/types'

/**
 * One pool of material, for both Ideas and Explore.
 *
 * ── The split this corrects ───────────────────────────────────────────────
 *
 * Ideas was reading `useDesktopIdeasFeed` alone, so the attention feed was the
 * posts table while Explore owned every machine-derived object — stale
 * targets, target hits, scenario gaps, derived insights. That divides the
 * product truth along the wrong axis. Both modes are questions about the same
 * desk:
 *
 *   Ideas     what deserves my attention?
 *   Explore   what is here that I might want to investigate?
 *
 * Same material, different arrangement. Ideas applies attention semantics
 * (`rankFeed` / `priorityFor`, tier-first, suppression honoured); Explore
 * applies discovery semantics (`diversifyExplore`, scored then repelled so
 * neighbours are not four of the same sort). Neither mode owns a producer.
 *
 * ── Why a pool and not a normalised type ──────────────────────────────────
 *
 * Each family already has a builder that knows how to turn its own rows into a
 * card, and an Explore adapter that knows how to turn them into a preview.
 * Flattening them into one intermediate shape first would mean a third
 * vocabulary to keep in step with both — and the earlier invented-pane mistake
 * is what that looks like when it goes wrong. So the pool hands back the
 * producers' own output and each mode uses the existing adapter for its
 * question.
 *
 * ── No duplicate queries ──────────────────────────────────────────────────
 *
 * Every hook here is an existing org-scoped query with its own cache key.
 * Calling this from both modes costs nothing extra: react-query serves the
 * same entries, which is also why switching modes is instant rather than a
 * load.
 */
export interface DesktopCandidates {
  /** Portfolio lens conditions: breaches, stale targets, conviction, crowding. */
  lenses: ReturnType<typeof usePortfolioLenses>['data']
  /** Case-versus-price findings. */
  scenarioCards: unknown[]
  /** Derived research insights. */
  insights: unknown[]
  /** The mixed post feed: trade ideas, thoughts, prompts, notes. */
  feedItems: ScoredFeedItem[]
  /** Paging for the post half. The machine families are not paged. */
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  isLoading: boolean
  /** False while user/org identity is still hydrating. */
  isContextReady: boolean
  /**
   * The POST half failed. The machine producers are not folded in: one of them
   * erroring leaves the rest of the feed perfectly usable, so only the source
   * whose absence empties the surface can put it into an error state.
   */
  isError: boolean
  retry: () => void
}

export function useDesktopCandidates(opts: { enabled?: boolean } = {}): DesktopCandidates {
  const enabled = opts.enabled ?? true

  /*
   * Only the post half's loading state is read — see `isLoading` below. The
   * producers' own flags are deliberately not destructured: a lens query still
   * in flight must not blank a feed that already has posts.
   */
  const lensesQ = usePortfolioLenses({ enabled })
  const scenarioQ = useScenarioCards({ enabled })
  const insightsQ = useDerivedInsights()
  const feed = useDesktopIdeasFeed('all')
  const { data: lenses } = lensesQ
  const { data: scenarioCards } = scenarioQ
  const { data: insights } = insightsQ

  /**
   * Has every producer finished its FIRST attempt?
   *
   * The four resolve at different times, and each arrival re-runs `rankFeed`
   * and `composeFeed` over a larger pool — so a cold load rendered the posts,
   * then reordered the whole list when the lenses landed, then again for the
   * scenarios. Individually correct, collectively a feed that shuffles under
   * the reader. That is the hitch.
   *
   * `isFetched` is true after success OR error, which is what makes a failing
   * optional producer unable to hold the feed shut.
   */
  const settledOnce = feed.isContextReady &&
    !feed.isLoading && lensesQ.isFetched && scenarioQ.isFetched && insightsQ.isFetched

  /**
   * Latched, so this gates the FIRST paint and never again.
   *
   * Without the latch every later refetch — a window focus, a five-minute
   * stale tick — would put the feed back into a loading state the reader has
   * no reason to see. Boot is the only moment where waiting is better than
   * showing something and moving it.
   */
  const hasSettled = useRef(false)
  if (settledOnce) hasSettled.current = true

  return {
    lenses,
    scenarioCards: (scenarioCards ?? []) as unknown[],
    insights: (insights ?? []) as unknown[],
    feedItems: feed.items,
    hasNextPage: feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    fetchNextPage: feed.fetchNextPage,
    /*
     * The post half alone decides the spinner.
     *
     * A lens query still in flight must not blank a feed that already has
     * posts to show. The machine families arrive INTO a list rather than
     * replacing it, so the surface stays stable while the slower producers
     * land. `lensesLoading` and friends are deliberately not folded in.
     */
    /*
     * Loading until the pool is whole, once. After that the post half alone
     * decides, so a slow producer arrives INTO the list rather than blanking
     * it.
     */
    isLoading: hasSettled.current ? feed.isLoading : true,
    isContextReady: feed.isContextReady,
    isError: feed.isError,
    retry: () => { void feed.refetch() },
  }
}
