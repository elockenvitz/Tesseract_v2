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
      new CustomEvent('openTradeQueue', {
        detail: {
          selectedTradeId: tradeQueueItemId,
          /*
           * The intent, carried in the FIRST event.
           *
           * The second event below is heard only by `TradeQueuePage`, which
           * a phone never mounts — `DashboardPage` renders `MobilePipeline`
           * for that tab. So on mobile the modal half of this never
           * arrived, and "Resume work" landed on a highlighted row in a
           * list. This flag reaches the shell through the event that IS
           * heard on both, and `MobilePipeline` opens the shared detail
           * with it.
           */
          openIdeaDetail: true,
        },
      }),
    )
    /*
     * The deferred half needs its own guard, and did not have one.
     *
     * The `try` below wraps only the SCHEDULING. `pop` runs 50ms later, by
     * which time the surface that asked for it may be gone -- a navigated-away
     * page in the browser, and a torn-down environment under test. Then
     * `window` is undefined inside here, the throw has no caller to catch it,
     * and it surfaces as an uncaught exception.
     *
     * In CI that cost a release: vitest reported `ReferenceError: window is
     * not defined` at this line as an unhandled error and exited 1 with
     * `343 passed, 0 failed`. A required check went red with every test
     * passing, from a test file that does not import this module -- the timer
     * simply outlived whichever file was running when it was set. A gate that
     * reds on unrelated changes is worse than one that is merely absent,
     * because the next person learns to re-run it.
     *
     * Same intent as the outer catch, applied where the work actually happens.
     */
    const pop = () => {
      /* `typeof` and not `!window`, so a torn-down environment where the
         binding is GONE gives a ReferenceError-free check rather than
         another throw. The catch covers the case where it exists but is
         undefined, which is what a stubbed global looks like. */
      if (typeof window === 'undefined') return
      try {
        window.dispatchEvent(
          new CustomEvent('openTradeIdeaModal', { detail: { tradeId: tradeQueueItemId } }),
        )
      } catch {
        /* A navigation that cannot fire must not take the surface down. */
      }
    }
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
