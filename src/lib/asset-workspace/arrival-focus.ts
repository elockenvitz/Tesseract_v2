/**
 * Telling a NEW arrival intent from one already acted on.
 *
 * ── The defect this rule exists to stop ───────────────────────────────────
 *
 * `openAsset({ focus })` writes `focus` into TAB DATA, and tab data is
 * durable: the shell merges it into the open tab and keeps it there. Only the
 * active tab renders, so moving to another tab unmounts the Asset page and
 * returning remounts it — whereupon the arrival effect read the same `focus`
 * and applied it again, discarding wherever the reader had navigated since.
 *
 * A reader who followed "Edit on the asset" into Research, moved to History,
 * then came back was put into Research again. Every time. The mode was not
 * theirs to choose.
 *
 * ── Why the focus value alone cannot decide it ────────────────────────────
 *
 * "Open this asset in Research again" and "this tab was once opened in
 * Research" are the same two fields. Nothing in `{ assetId, focus }`
 * distinguishes a fresh request from a replay, so the receiver needs
 * something that changes per request — `focusRequestId`, stamped by
 * `assetTabFor` on every `openAsset` call.
 *
 * ── Why this is not a ref ─────────────────────────────────────────────────
 *
 * The obvious fix is "remember we did it" in a component ref. The component
 * is the thing being unmounted, so the ref dies with it and the focus
 * replays. The consumed id has to live where the sub-page already survives a
 * remount: the per-asset tab state.
 *
 * ── And why `<AssetTab key={activeTab.id}>` belongs with this ─────────────
 *
 * The shell rendered the Asset page unkeyed, so React kept ONE instance and
 * swapped the `asset` prop when the reader moved between two asset tabs.
 * Every per-asset value the component holds — sub-page, selected work item,
 * viewed stage and requirement, and the consumed id above — therefore
 * survived into the next asset. Worse, the save effect lists `asset.id` among
 * its dependencies and builds its record from current STATE: on the render
 * where the prop had changed and the state had not, it wrote the PREVIOUS
 * asset's state under the NEW asset's id.
 *
 * Observed: open AMZN, switch it to Work, open TSLA, return. AMZN's saved
 * record held TSLA's sub-page and TSLA's consumed focus id, and AMZN opened
 * in Research.
 *
 * Keying makes an asset switch a remount, which is the lifecycle every
 * `useState` initialiser here already assumes — each reads
 * `loadTabState(asset.id)` and simply never ran a second time. It is also the
 * lifecycle the component already handles when the reader leaves for another
 * tab and comes back.
 */

/**
 * The key identifying one arrival intent, or null when there is no focus.
 *
 * Two shapes, and the difference matters:
 *
 *   `req:<id>`    a request from `openAsset`. Unique per call, so the same
 *                 lens can deliberately send a reader to the same asset and
 *                 the same focus twice and have it work both times.
 *
 *   `focus:<f>`   a hand-built descriptor with no request id. Consumed once
 *                 per focus VALUE, so it still stops replaying on remount;
 *                 what it gives up is re-requesting the same focus, which
 *                 only `openAsset` can express. No sender in the app builds
 *                 an asset descriptor carrying `focus` by hand today — this
 *                 is for saved sessions and anything added later that forgets
 *                 the id.
 */
export function focusIntentKey(
  focus: string | null | undefined,
  focusRequestId?: string | null,
): string | null {
  if (!focus) return null
  return focusRequestId ? `req:${focusRequestId}` : `focus:${focus}`
}

/**
 * Should this arrival be acted on?
 *
 * True only for an intent that exists and has not already been consumed. The
 * comparison is deliberately exact: a near-match would be a guess about
 * whether two navigations were the same one.
 */
export function shouldApplyFocus(
  intent: string | null,
  consumedIntent: string | null | undefined,
): boolean {
  if (!intent) return false
  return intent !== consumedIntent
}
