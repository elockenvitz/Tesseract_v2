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

import {
  isEngagementObjectType,
  type EngagementMode,
  type EngagementRequest,
  type EngagementResult,
  type EngagementTarget,
} from './types'
import { canDiscuss } from './target'

/** Namespaced so it cannot collide with the app's existing bare event names. */
export const ENGAGEMENT_EVENT = 'tesseract:open-engagement' as const

/**
 * Ask the engagement pane to open against this object.
 *
 * Returns what it did rather than whether it did something. A boolean could
 * only say "dispatched", which conflates three outcomes a caller may need to
 * tell apart: nothing was bindable, the object is of a kind this app does not
 * engage with, and the pane opened but the capability the user asked for does
 * not exist for this object yet. The last is the interesting one — it is how
 * Discuss on a research note reports itself.
 *
 * Refusal is silent and safe. A surface must never break, or claim it opened
 * something, because the seam declined: every failure path here returns a
 * value and dispatches nothing.
 *
 * Note what a `discuss-unsupported` limitation does NOT do. It does not stop
 * the dispatch and it does not substitute AI. The pane opens on the mode that
 * was asked for and says plainly that threads do not attach to this kind of
 * object (see `EngagementThread`). Quietly redirecting someone who asked to
 * talk to a person into talking to a model would be worse than telling them.
 */
export function openEngagement(
  target: EngagementTarget,
  mode: EngagementMode,
): EngagementResult {
  if (typeof window === 'undefined') return { opened: false, refused: 'no-window' }
  if (!target?.objectId || !target?.objectType) {
    return { opened: false, refused: 'no-target' }
  }
  if (!isEngagementObjectType(target.objectType)) {
    return { opened: false, refused: 'unsupported-type' }
  }

  const detail: EngagementRequest = { target, mode }
  window.dispatchEvent(new CustomEvent<EngagementRequest>(ENGAGEMENT_EVENT, { detail }))

  const limited = mode === 'discuss' && !canDiscuss(target)
  return {
    opened: true,
    mode,
    objectType: target.objectType,
    objectId: target.objectId,
    ...(limited ? { limitation: 'discuss-unsupported' as const } : {}),
  }
}

/** `openEngagement(target, 'ai')`, named for how it reads at a call site. */
export function askAI(target: EngagementTarget): EngagementResult {
  return openEngagement(target, 'ai')
}

/** `openEngagement(target, 'discuss')`. */
export function discuss(target: EngagementTarget): EngagementResult {
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
