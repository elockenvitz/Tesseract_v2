/**
 * Open a pipeline idea's detail, from anywhere.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The parked-work card's whole promise is "come back to this work", and the
 * first version of it linked to `/trade-queue?idea=<id>` — a parameter
 * `TradeQueuePage` does not read. It looked like a deep link and silently
 * did nothing, which is the same class of defect as inventing a fact: a
 * claim the product cannot honour.
 *
 * The real mechanism already existed and is already consumed. `openTradeQueue`
 * switches to the Idea Pipeline tab and `openTradeIdeaModal` pops the detail,
 * both listened for in `TradeQueuePage`. `QuickTradeIdeaCapture` and
 * `LinkedObjectsPanel` each had their own copy of the two-step dance; this is
 * that dance, named, so a third caller does not become a third slightly
 * different copy.
 *
 * ── Why two events and a frame ───────────────────────────────────────────
 *
 * The modal listener lives on `TradeQueuePage`. Dispatching both in the same
 * tick means the second event fires before that page has mounted its
 * listener, and nothing opens. The frame plus the short timeout is what the
 * two existing callers already do, kept rather than re-derived.
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * It opens an idea. It does not create one, does not create a
 * recommendation, and does not clear any obligation — resuming is judged by
 * the deterministic rules in `lib/memory/obligations`, where opening a
 * detail is deliberately NOT a clear condition. A reminder that cancels
 * itself the moment it is looked at is one nobody can rely on.
 */

/** Matches the delay the existing callers settled on. */
const MOUNT_SETTLE_MS = 50

export function openIdeaDetail(tradeQueueItemId: string): void {
  if (!tradeQueueItemId) return
  try {
    window.dispatchEvent(
      new CustomEvent('openTradeQueue', { detail: { selectedTradeId: tradeQueueItemId } }),
    )
    const pop = () =>
      window.dispatchEvent(
        new CustomEvent('openTradeIdeaModal', { detail: { tradeId: tradeQueueItemId } }),
      )
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(pop, MOUNT_SETTLE_MS))
    } else {
      setTimeout(pop, MOUNT_SETTLE_MS)
    }
  } catch {
    /* A navigation that cannot fire must not take the surface down with it. */
  }
}

/**
 * The events this dispatches, exported for tests.
 *
 * Named here rather than typed as string literals at each assertion, so a
 * renamed event breaks the test that proves the CTA works instead of
 * silently passing against the old name.
 */
export const OPEN_IDEA_EVENTS = {
  tab: 'openTradeQueue',
  modal: 'openTradeIdeaModal',
} as const
