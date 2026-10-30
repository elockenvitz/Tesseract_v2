/**
 * Desktop Ideas — arriving from somewhere else.
 *
 * ── The rule this implements ──────────────────────────────────────────────
 *
 * Today is a jumping-off surface. A primary action there must open the
 * CANONICAL WORKSPACE for the object with that object already selected and the
 * triggering issue carried through — never a generic destination where the
 * user has to find the thing again.
 *
 * For a trade idea, the canonical workspace is now Ideas. So Ideas has to be
 * able to receive "open on this idea, focused here", which is what this file
 * provides. It is the receiving half only: rerouting Today's existing actions
 * is deliberately NOT done here (see the note below).
 *
 * ── Why a typed request rather than another bare CustomEvent ──────────────
 *
 * The app already carries ten untyped `window` CustomEvents whose `detail`
 * shape is re-invented per call site. D1 established the alternative — one
 * typed function, one payload definition, one place to change — and this
 * follows it rather than adding an eleventh untyped channel.
 *
 * ── Tab reuse ─────────────────────────────────────────────────────────────
 *
 * The request carries a fixed tab id (`ideas-v2`), and `handleSearchResult`
 * reuses a tab whose id already exists. So arriving from Today twice reuses
 * one Ideas tab and re-selects inside it, rather than stacking duplicates.
 */

/** Which part of the Idea workspace the caller wants attention on. */
export type IdeaFocus = 'decision' | 'thesis' | 'framework' | 'performance' | 'portfolio' | 'research' | 'team'

export interface OpenIdeaRequest {
  /** `trade_queue_items.id` — the object to select. */
  ideaId: string
  /** Where to land inside the workspace. Optional. */
  focus?: IdeaFocus
  /** Why the user was sent here, preserved for display. */
  issue?: string
  /** Where the request came from, for provenance. */
  origin?: string
}

export const OPEN_IDEA_EVENT = 'tesseract:open-idea' as const

/**
 * The acknowledgement a mounted surface writes back onto the request.
 *
 * Not part of `OpenIdeaRequest`: a caller never sets it and a handler never
 * reads it. It exists only so `openIdea` can report whether anything was
 * listening, which is the difference between "the reader has arrived" and
 * "nobody heard that".
 */
type Claimable<T> = T & { claimed?: boolean }

/**
 * Ask whatever is mounted to open one idea, and say whether anything did.
 *
 * ── Why the return value had to become real ──────────────────────────────
 *
 * It used to return `true` for any well-formed request, which made it useless
 * as a decision: every caller paired it with a tab descriptor on the theory
 * that one of the two would apply and the other would be a no-op.
 *
 * That theory is false inside the Dashboard. Its five lenses are ONE shell
 * rendering one lens at a time, so a reader on Decisions has no Ideas
 * workspace mounted to hear this — and the tab descriptor then opened a
 * SECOND Dashboard tab, showing the same shell. Measured: Decisions, "Open
 * the idea", and the app grew a tab titled Ideas.
 *
 * `window.dispatchEvent` runs its listeners synchronously and returns after
 * the last one, so a listener can mark the request as taken and the caller
 * can read that back on the next line. A caller that gets `false` genuinely
 * has nowhere to put the reader and may fall back to opening a tab.
 */
export function openIdea(request: OpenIdeaRequest): boolean {
  if (typeof window === 'undefined') return false
  if (!request?.ideaId) return false
  const detail: Claimable<OpenIdeaRequest> = { ...request }
  window.dispatchEvent(new CustomEvent<Claimable<OpenIdeaRequest>>(OPEN_IDEA_EVENT, { detail }))
  return detail.claimed === true
}

export function subscribeToOpenIdea(handler: (r: OpenIdeaRequest) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<Claimable<OpenIdeaRequest>>).detail
    if (!detail?.ideaId) return
    handler(detail)
    // Subscribing IS taking the reader there: every subscriber is a surface
    // that selects the idea. Claimed after the handler so a handler that
    // throws does not silently swallow the fallback.
    detail.claimed = true
  }
  window.addEventListener(OPEN_IDEA_EVENT, listener)
  return () => window.removeEventListener(OPEN_IDEA_EVENT, listener)
}

/**
 * The tab descriptor a caller hands to `handleSearchResult`.
 *
 * The id is fixed so the tab is reused rather than duplicated; the selection
 * rides in `data`, which the workspace reads on mount and on change.
 */
export function ideasTabFor(request: OpenIdeaRequest) {
  return {
    id: 'ideas-v2',
    title: 'Ideas',
    type: 'ideas-v2' as const,
    data: {
      selectedIdeaId: request.ideaId,
      focus: request.focus ?? null,
      issue: request.issue ?? null,
      origin: request.origin ?? null,
    },
  }
}

/**
 * The tab descriptor for the Pipeline, with one idea's card focused.
 *
 * This exists because the descriptor was being hand-rolled at every call site,
 * and three of them in the lens workspaces hand-rolled it WRONG — they passed
 * `data: null`, which carries no record, so the button landed the reader on
 * the bare Pipeline workspace instead of on the idea whose name was on the
 * button. That is the same class of defect `ideasTabFor` was introduced to end
 * for the Ideas lens; the Pipeline needed its own.
 *
 * `focusIdeaId` is the spelling both receivers already read: `TradeQueuePage`
 * on desktop and `MobilePipeline` on a phone. Both consume it once and clear
 * it, so a later visit does not re-scroll to the same card forever.
 *
 * Returns null when there is no idea, so a caller with nothing to open can
 * decline to draw the link rather than open an empty tab.
 */
export function pipelineTabFor(ideaId: string | null | undefined) {
  if (!ideaId) return null
  return {
    id: 'trade-queue',
    title: 'Idea Pipeline',
    type: 'trade-queue' as const,
    data: { focusIdeaId: ideaId },
  }
}
