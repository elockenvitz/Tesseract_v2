/**
 * How long an asset surface's data is KEPT after the reader leaves it.
 *
 * ── The reload that was not a reload ─────────────────────────────────────
 *
 * Reported: "Both the canonical Asset Page and embedded Asset Workspace
 * appear to reload when I navigate to another application tab and return."
 *
 * `DashboardPage.renderTabContent()` renders the active tab only, so leaving
 * an Asset tab unmounts it and every query it holds goes inactive. What
 * happens to those entries then is `gcTime`, and it was wrong in two
 * different ways.
 *
 * **Immediately, every time.** Two of the four queries behind
 * `useUserAssetPagePreferences` -- the section catalogue and the field
 * catalogue -- carried `gcTime: 0`, commented "Don't cache - always fetch
 * fresh data". `gcTime: 0` discards the entry the instant the component
 * unmounts, so on EVERY return `sectionsLoading` and `fieldsLoading` were
 * true again. `AssetTab` reads them as
 * `pageReady = !layoutLoading && !contributionsLoading`, via that hook's
 * composite `isLoading`, and an unconditional early return replaces the
 * whole page with a skeleton. That is the reload the reader saw, and it was
 * not occasional: it was the switch itself.
 *
 * **After five minutes, for the rest.** The app's `QueryClient` sets
 * `staleTime` and leaves `gcTime` at React Query's default of five minutes,
 * so the layout selection, the default layout and the workspace read survive
 * a quick trip and are collected on a longer one. Coming back after a meeting
 * is then a cold start: the same full-page skeleton in `AssetTab`, and
 * `if (isLoading) return <Skeleton />` plus eight fresh reads in
 * `AssetWorkspace`. (`useContributions` already declared thirty minutes of
 * its own, which is where this figure comes from.)
 *
 * Both are retention problems rather than freshness ones, which is what
 * makes the correction small.
 *
 * This exact fault was found and fixed once already, in
 * `components/ui/InvestmentTimeline.tsx`: nine Process queries carried
 * `gcTime: 0` with the same comment, and "leaving Work for Research and
 * coming straight back refetched all nine from nothing behind a spinner,
 * every time." The two here were missed.
 *
 * ── Why this is `gcTime` and not `staleTime` ─────────────────────────────
 *
 * They are different questions and only one of them is being answered here.
 *
 *   `staleTime`  how long the data is trusted WITHOUT asking again.
 *                Raising it would hide the loading by serving older
 *                numbers, which is the thing the brief rules out and is
 *                also just wrong for a price or a case.
 *   `gcTime`     how long an UNUSED entry is kept before being thrown
 *                away. It has no effect on freshness at all: a kept entry
 *                that is stale still refetches on the next mount.
 *
 * So raising `gcTime` alone gives exactly the asked-for behaviour. The
 * reader comes back, React Query has the previous answer, so `isLoading` is
 * false and the page renders immediately with content rather than a
 * skeleton; `isFetching` is true and the refetch lands underneath. The
 * layout preferences keep their `staleTime: 0` and `refetchOnMount: always`
 * and still revalidate on every mount. Nothing about invalidation changes: a
 * case, target or workflow write still marks its keys stale and still
 * refetches.
 *
 * The honest cost, the same one `InvestmentTimeline` states: a row deleted
 * elsewhere can be on screen for the length of one request. These keys carry
 * the user, the org and the subject, so the briefly-stale data is always the
 * same reader's view of the same thing -- never another org's and never
 * another asset's.
 *
 * ── Why thirty minutes ───────────────────────────────────────────────────
 *
 * It is the figure this codebase already uses for the same purpose on
 * `useAnalystPriceTargets`, `useAnalystRatings`, `useAnalystEstimates`,
 * `OutcomesContainer` and `ThesisContainer` -- a surface a reader leaves and
 * returns to inside a working session. Long enough that a meeting, a
 * detour through three other tabs and a read of someone else's note all
 * end with the page still there; short enough that an abandoned session
 * does not hold a day of rows.
 *
 * ── What it is NOT for ───────────────────────────────────────────────────
 *
 * Not a way to make a slow query acceptable, and not to be applied to a
 * query nobody is waiting on. It belongs on the queries that GATE a visible
 * skeleton on an asset surface, which is a short and deliberate list: the
 * four layout-preference queries behind `AssetTab`'s `pageReady`, and the
 * workspace read behind the embedded pane's own skeleton.
 */
export const ASSET_SURFACE_GC_TIME = 30 * 60 * 1000
