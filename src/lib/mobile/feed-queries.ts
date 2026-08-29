/**
 * Which queries the mobile feed is MADE OF.
 *
 * ── Why this list exists ──────────────────────────────────────────────────
 *
 * Two behaviours need to name the same set and must never drift apart:
 *
 *   1. Returning to the tab refetches the stale ones (`useFeedRefreshOnReturn`).
 *   2. While any of them is fetching, the feed says "Updating…"
 *      (`useFeedIsUpdating`).
 *
 * A source that participates in the first and not the second refreshes
 * silently, which is the failure this pass exists to remove. One list, two
 * consumers.
 *
 * ── Why a key-root list and not an option on each hook ────────────────────
 *
 * `useIdeasFeed` and `useSignalCards` are shared with `IdeasFeedPage` — the
 * DESKTOP feed. Putting `refetchOnWindowFocus` inside them would change a
 * surface this pass is not allowed to touch, and threading an option through
 * eight hooks to avoid that is eight edits to shared code for a mobile
 * concern. Matching on the key root instead keeps the whole policy in the
 * mobile tree: the hooks are untouched and the desktop feed keeps the app-wide
 * default of not refetching on focus.
 *
 * ── Roots, and their staleTime, at the time of writing ────────────────────
 *
 *   ideas-feed                    30s   the feed itself
 *   feed-context                  60s   followed ids + held assets; ranking inputs
 *   signal-cards                   5m   attention clusters, conflicts, stale coverage
 *   scenario-cards                 5m   Case vs Price
 *   recommendation-cards           2m   suggested actions
 *   attention                     30s   the attention sections
 *   derived-insights               5m   derived intelligence
 *   portfolio-lenses               5m   lens definitions used in ranking
 *   coverage-relevance            30s   ranking input; also drives the feed key
 *   coverage-relevance-holdings   60s   ranking input
 *   feed-facets                   30m   filter facets
 *
 * The staleTime is what decides whether a return to the tab costs a request.
 * `feed-facets` participates but, at 30 minutes, almost never fires — which is
 * the point: the policy is "refetch what is stale", not "refetch everything".
 *
 * Deliberately NOT here: quotes (`useMarketData`) and price history. They are
 * per-symbol, they are already fetched lazily for what is on screen, and a
 * focus event would fan out one request per visible symbol to say the same
 * thing the next scroll would say anyway.
 */

export const FEED_QUERY_ROOTS = [
  'ideas-feed',
  'feed-context',
  'signal-cards',
  'scenario-cards',
  'recommendation-cards',
  'attention',
  'derived-insights',
  'portfolio-lenses',
  'coverage-relevance',
  'coverage-relevance-holdings',
  'feed-facets',
] as const

export type FeedQueryRoot = (typeof FEED_QUERY_ROOTS)[number]

const ROOTS: ReadonlySet<string> = new Set(FEED_QUERY_ROOTS)

/**
 * True when a query key belongs to the mobile feed.
 *
 * Matches the FIRST element only. Every key in this app is
 * `[root, ...discriminators]`, and matching deeper would make the answer
 * depend on how many user ids or org ids a given hook happens to append.
 */
export function isFeedQueryKey(key: readonly unknown[]): boolean {
  return typeof key[0] === 'string' && ROOTS.has(key[0])
}
