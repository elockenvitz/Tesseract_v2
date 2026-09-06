/**
 * The engagement seam — invocation.
 *
 * ── Why a window event and not a store or a context ───────────────────────
 *
 * The engagement pane is mounted once, in `Layout`, above the tab shell.
 * Callers are arbitrarily deep inside whichever tab happens to be active, and
 * tabs are not a React ancestor chain the pane can be reached through. This
 * app already solved that with window CustomEvents — `openThoughtsCapture`,
 * `openTradeQueue`, `openIdeasTab`, `openDirectMessage`, `open-asset-by-symbol`
 * — and `openThoughtsCapture` already carries context into this exact pane.
 *
 * So the transport is not new. What is new is that it is *typed and in one
 * place*: today those nine channels are untyped string literals scattered
 * across call sites, and each one re-invents its `detail` shape. Every caller
 * of the engagement seam goes through `openEngagement`, so the payload has one
 * definition and one place to change.
 *
 * A store would work equally well and would be the right move if the pane ever
 * needs to be driven from outside a user gesture. It is not that yet, and
 * swapping the transport later touches only this file plus the subscriber.
 */

import type { EngagementMode, EngagementRequest, EngagementTarget } from './types'

/** Namespaced so it cannot collide with the app's existing bare event names. */
export const ENGAGEMENT_EVENT = 'tesseract:open-engagement' as const

/**
 * Ask the engagement pane to open against this object.
 *
 * Returns false when nothing was dispatched — no `window` (SSR, a node test),
 * or a target with no object to bind. Callers that care can use the return to
 * avoid claiming they opened something; most will ignore it.
 *
 * Deliberately fire-and-forget: the seam's job is to carry the target, not to
 * know whether a pane is mounted to receive it. A surface should not be able
 * to break because the pane is closed.
 */
export function openEngagement(
  target: EngagementTarget,
  mode: EngagementMode,
): boolean {
  if (typeof window === 'undefined') return false
  if (!target?.objectId || !target?.objectType) return false

  const detail: EngagementRequest = { target, mode }
  window.dispatchEvent(new CustomEvent<EngagementRequest>(ENGAGEMENT_EVENT, { detail }))
  return true
}

/** `openEngagement(target, 'ai')`, named for how it reads at a call site. */
export function askAI(target: EngagementTarget): boolean {
  return openEngagement(target, 'ai')
}

/** `openEngagement(target, 'discuss')`. */
export function discuss(target: EngagementTarget): boolean {
  return openEngagement(target, 'discuss')
}

/**
 * Subscribe to engagement requests. Returns an unsubscribe function.
 *
 * Exists so the subscriber does not have to repeat the event name, the cast,
 * or the null-detail guard — three things that are easy to get subtly wrong
 * once and then copy.
 */
export function subscribeToEngagement(
  handler: (request: EngagementRequest) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<EngagementRequest>).detail
    if (!detail?.target?.objectId) return
    handler(detail)
  }

  window.addEventListener(ENGAGEMENT_EVENT, listener)
  return () => window.removeEventListener(ENGAGEMENT_EVENT, listener)
}
