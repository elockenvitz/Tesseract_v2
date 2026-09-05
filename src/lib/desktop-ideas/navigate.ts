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
 * Ask the Ideas workspace to open on one idea.
 *
 * Returns false when there is nothing to open — callers can then decline to
 * claim they navigated. Fire-and-forget otherwise: a surface must not break
 * because the workspace is not mounted.
 */
export function openIdea(request: OpenIdeaRequest): boolean {
  if (typeof window === 'undefined') return false
  if (!request?.ideaId) return false
  window.dispatchEvent(new CustomEvent<OpenIdeaRequest>(OPEN_IDEA_EVENT, { detail: request }))
  return true
}

export function subscribeToOpenIdea(handler: (r: OpenIdeaRequest) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OpenIdeaRequest>).detail
    if (!detail?.ideaId) return
    handler(detail)
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
