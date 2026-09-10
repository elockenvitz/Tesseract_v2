/**
 * AI System V2 — binding a response to the request that asked for it.
 *
 * ── The bug this closes ───────────────────────────────────────────────────
 *
 * The pane's tags, conversation id and allowlist are React state. A request
 * takes seconds; navigation takes none. So a reader who asks about AMZN and
 * then opens MSFT has, at the moment the answer lands, a hook whose `tags`
 * say MSFT — and the completion handler read that state to decide which
 * conversation to persist into and which objects the answer could act on.
 *
 * The result was not a cosmetic mixup. Actions are validated against the
 * allowlist read at completion, so AMZN's answer could have been offered a
 * button targeting MSFT. Worse, `useAI` clears `messages` when the tags
 * change, so the assistant reply appended after that reset landed inside the
 * MSFT thread with no question above it.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * Everything a response needs to be interpreted is frozen at submit time and
 * travels with the request. Nothing downstream reads live state. The snapshot
 * is what decides which conversation the answer belongs to, what it may act
 * on, and how long it was allowed to be.
 *
 * Freezing is not the same as applying. A completion still has to ask whether
 * the reader is looking at the conversation it belongs to — see
 * `shouldApplyToView`. An answer that arrives after the reader moved on is
 * kept in its own thread and must not touch what is on screen.
 */

import type { AiObjectRef } from './actions'
import type { AiResponsePolicy } from './response-policy'
import type { AiTag } from './context-selection'

export interface AiRequestContext {
  /** Unique per request. Used to ignore superseded responses. */
  requestId: string
  /**
   * The conversation this answer belongs to. Null for a thread that did not
   * exist yet at submit time — the answer creates it, and a reader who
   * navigated away in the meantime gets a new thread they can find later.
   */
  conversationId: string | null
  /** Exactly what was sent as context. */
  tags: readonly AiTag[]
  /** Exactly what the answer may target. Frozen; never re-read from state. */
  allowlist: readonly AiObjectRef[]
  policy: AiResponsePolicy
  /** The question, so a stale completion can be matched to it. */
  message: string
  submittedAt: number
}

let counter = 0

/**
 * Freeze the request context.
 *
 * `Object.freeze` is applied to the arrays as well: a snapshot that a later
 * render could mutate in place would defeat the entire point of taking one.
 */
export function createRequestContext(input: {
  conversationId: string | null
  tags: readonly AiTag[]
  allowlist: readonly AiObjectRef[]
  policy: AiResponsePolicy
  message: string
  now?: number
}): AiRequestContext {
  counter += 1
  return Object.freeze({
    requestId: `ai-${input.now ?? Date.now()}-${counter}`,
    conversationId: input.conversationId,
    tags: Object.freeze(input.tags.map(t => Object.freeze({ ...t }))),
    allowlist: Object.freeze(input.allowlist.map(r => Object.freeze({ ...r }))),
    policy: Object.freeze({ ...input.policy }),
    message: input.message,
    submittedAt: input.now ?? Date.now(),
  })
}

/** Test seam — makes generated ids deterministic. */
export function __resetRequestCounter(): void {
  counter = 0
}

export interface ViewState {
  /** The conversation the reader is currently looking at. */
  conversationId: string | null
  /** The tags currently bound to the pane. */
  tags: readonly { type: string; id: string }[]
}

function tagKey(t: { type: string; id: string }): string {
  return `${t.type}:${t.id}`
}

function sameTagSet(a: readonly { type: string; id: string }[], b: readonly { type: string; id: string }[]): boolean {
  if (a.length !== b.length) return false
  const left = a.map(tagKey).sort()
  const right = b.map(tagKey).sort()
  return left.every((k, i) => k === right[i])
}

/**
 * May this response touch what is on screen?
 *
 * Two ways to be the right place. An id match is definitive once a thread
 * exists. Before it does — the first question in a new thread — both ids are
 * null, so the tag set is what identifies the view, and it must match exactly:
 * a reader who navigated from AMZN to MSFT before the first answer landed has
 * a different pane, even though neither has an id yet.
 *
 * A false answer here is not a failure. It means the response is stored in its
 * own conversation and the reader finds it in the list, which is the correct
 * outcome — not a reason to drop the work or to paste it somewhere else.
 */
export function shouldApplyToView(context: AiRequestContext, view: ViewState): boolean {
  if (context.conversationId !== null || view.conversationId !== null) {
    return context.conversationId === view.conversationId
  }
  return sameTagSet(context.tags, view.tags)
}

export type AiRequestStatus = 'streaming' | 'done' | 'cancelled' | 'error'

/**
 * One in-flight request, and the handle that stops it.
 *
 * Cancellation is explicit rather than implicit-on-unmount only: a reader who
 * asks a second question while the first is still running should not pay for
 * both, and the model should not keep writing an answer nobody will read.
 */
export interface AiInFlightRequest {
  context: AiRequestContext
  controller: AbortController
  status: AiRequestStatus
}

export function createInFlight(context: AiRequestContext): AiInFlightRequest {
  return { context, controller: new AbortController(), status: 'streaming' }
}

/**
 * Cancel a request if it is still running.
 *
 * Returns whether anything was actually cancelled, so a caller can avoid
 * claiming it stopped something that had already finished.
 */
export function cancelInFlight(request: AiInFlightRequest | null): boolean {
  if (!request || request.status !== 'streaming') return false
  request.status = 'cancelled'
  try {
    request.controller.abort()
  } catch {
    // An already-aborted controller is not an error worth surfacing.
  }
  return true
}
