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
}

export function useDesktopCandidates(opts: { enabled?: boolean } = {}): DesktopCandidates {
  const enabled = opts.enabled ?? true

  /*
   * Only the post half's loading state is read — see `isLoading` below. The
   * producers' own flags are deliberately not destructured: a lens query still
   * in flight must not blank a feed that already has posts.
   */
  const { data: lenses } = usePortfolioLenses({ enabled })
  const { data: scenarioCards } = useScenarioCards({ enabled })
  const { data: insights } = useDerivedInsights()
  const feed = useDesktopIdeasFeed('all')

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
    isLoading: feed.isLoading,
  }
}
