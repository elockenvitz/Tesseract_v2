/**
 * Desktop Research — arriving from somewhere else.
 *
 * The same typed shape `openIdea` established, for the same reason: the app
 * already carries ten untyped window CustomEvents whose payloads are
 * re-invented per call site, and adding an eleventh would repeat the mistake.
 *
 * This is what a future Today handoff should use in place of
 * OPEN_ASSET_UPDATE_THESIS's current asset-tab-plus-setTimeout(500) race.
 * That route is NOT changed here -- Research V1 only has to be able to
 * receive, and the reroute belongs with the stage that audits the thesis
 * editor it currently depends on.
 */

/** Which part of the research workspace the caller wants attention on. */
export type ResearchFocus = 'thesis' | 'evidence' | 'price' | 'evolution' | 'team'

export interface OpenResearchRequest {
  /** The asset whose case to open. */
  assetId: string
  focus?: ResearchFocus
  /** Why the user was sent, preserved so it is not lost in transit. */
  issue?: string
  origin?: string
}

export const OPEN_RESEARCH_EVENT = 'tesseract:open-research' as const

export function openResearch(request: OpenResearchRequest): boolean {
  if (typeof window === 'undefined') return false
  if (!request?.assetId) return false
  window.dispatchEvent(new CustomEvent<OpenResearchRequest>(OPEN_RESEARCH_EVENT, { detail: request }))
  return true
}

export function subscribeToOpenResearch(handler: (r: OpenResearchRequest) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OpenResearchRequest>).detail
    if (!detail?.assetId) return
    handler(detail)
  }
  window.addEventListener(OPEN_RESEARCH_EVENT, listener)
  return () => window.removeEventListener(OPEN_RESEARCH_EVENT, listener)
}

/**
 * The tab descriptor a caller hands to `handleSearchResult`.
 *
 * Fixed id, so arriving twice reuses one Research tab and re-selects inside it.
 */
export function researchTabFor(request: OpenResearchRequest) {
  return {
    id: 'research-v2',
    title: 'Research',
    type: 'research-v2' as const,
    data: {
      selectedAssetId: request.assetId,
      focus: request.focus ?? null,
      issue: request.issue ?? null,
      origin: request.origin ?? null,
    },
  }
}
