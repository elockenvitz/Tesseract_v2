/**
 * The chart workspace a tab switch must not destroy.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * `DashboardPage.renderTabContent()` renders only the ACTIVE tab, so moving
 * from Charting to Overview unmounts `ChartingPage` outright. Its panels —
 * the selected symbol, the timeframe, the chart type, the indicators, the
 * comparison series — lived in `useState` seeded by `getDefaultChartingState`,
 * whose own comment read "(no persistence)". Coming back therefore rebuilt
 * the default: blank symbol, `1M`, no indicators. The state was owned by a
 * component that the navigation in question destroys.
 *
 * Lifting it here, outside React's tree, is the smallest ownership change
 * that survives an unmount. Keeping every tab mounted instead would have
 * changed the behaviour of every other tab in the app to fix one.
 *
 * ── Why the key carries the principal ────────────────────────────────────
 *
 * A plain tab id would let the next person signed in on this machine open
 * Charting and find the previous account's symbols and comparisons sitting
 * there. So the key is `userId:orgId:tabId`, and a different account or a
 * different organization simply reads a different entry — it cannot see the
 * other's, by construction rather than by remembering to clear.
 *
 * `clearChartingWorkspaces` exists as well, wired to the principal change, so
 * the map does not hold a signed-out account's selections in memory. The
 * partitioning is what makes it safe; the clear is hygiene.
 *
 * This is in-memory only, deliberately. A reload starts fresh, which matches
 * every other tab in the app, and nothing about a chart selection is worth
 * writing to disk on a shared machine.
 */
/*
 * Generic over the state it holds, so this module has no dependency on the
 * page. `ChartPanel` and its chart-type unions live with the Charting page;
 * importing them here to type the map would make the page and the store
 * import each other, and the store exists precisely so it does not share the
 * page's lifetime.
 */

/**
 * Exported so a test can seed it and watch the clear empty it.
 *
 * A source assertion that the clear is *called* passes just as happily when
 * the call is dead, which is how an earlier cache guard in this codebase went
 * green with its clear disabled.
 */
export const chartingWorkspaceStore = new Map<string, unknown>()

/**
 * The identity of one workspace.
 *
 * A null principal yields null, and a null key means "do not persist" — an
 * unauthenticated or still-resolving session must not write into a slot that
 * a real principal could later read.
 */
export function chartingWorkspaceKey(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  tabId: string | null | undefined,
): string | null {
  if (!userId || !tabId) return null
  return `${userId}:${orgId ?? 'no-org'}:${tabId}`
}

export function readChartingWorkspace<T>(key: string | null): T | null {
  if (!key) return null
  return (chartingWorkspaceStore.get(key) as T | undefined) ?? null
}

export function writeChartingWorkspace<T>(key: string | null, state: T): void {
  if (!key) return
  chartingWorkspaceStore.set(key, state)
}

export function clearChartingWorkspaces(): void {
  chartingWorkspaceStore.clear()
}
