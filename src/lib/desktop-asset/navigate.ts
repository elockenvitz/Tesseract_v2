/**
 * Opening an asset — the one contract.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Stage 2D0 found the same asset work implemented three times: the Asset page,
 * the Research detail workspace and the Portfolio position workspace. Three
 * thesis editors, three evidence lists, two definitions of weight. The fix is
 * not a better third surface; it is one destination that every lens routes to.
 *
 * That destination is the EXISTING Asset page. It is already the deep place for
 * the case, the framework, workflow, decisions, lists, estimates, consensus,
 * projects and activity, and convergence was never about replacing it -- only
 * about stopping the lenses from growing parallel copies of its work.
 *
 * `openAsset` is that route. It carries what the sender knows -- which part of
 * the asset matters, which book the reader was looking at it from, and why they
 * were sent -- so the Asset page can land on the right sub-page and keep the
 * reason in reach, rather than dropping the reader at a generic top.
 *
 * ── One tab per asset ────────────────────────────────────────────────────
 *
 * The descriptor's id is the asset id, which is what `handleSearchResult`
 * matches on. Opening AAPL from Research and then from Portfolio reuses one
 * tab and updates its focus and book context; it does not accumulate a tab per
 * question asked. Every context field is written explicitly, including when
 * absent: merging a descriptor that omitted `portfolioId` would silently leave
 * the previous book's context attached to a different question.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 *
 * Not a router. The app is a tab shell, not a URL space, and inventing browser
 * routing here would be a second navigation model beside the one that works.
 * This produces a descriptor for the shell that already exists.
 */

import type { EngagementIssue } from '../engagement'

/**
 * Which question the reader arrived with.
 *
 * The workspace is one page in every case -- this orders it and decides what
 * is worth fetching, never which of four sub-applications to show. The old
 * Asset page's Research/Workflow/Decisions/Lists tab bar is exactly the thing
 * this must not become.
 */
export type AssetFocus = 'overview' | 'research' | 'framework' | 'position' | 'decisions'

export interface OpenAssetRequest {
  assetId: string
  /** Known to most senders, and the only thing a price read can key on. */
  symbol?: string | null
  companyName?: string | null
  focus?: AssetFocus
  /**
   * The book the reader was looking at this from.
   *
   * Makes that book the primary position context. It never hides the others:
   * an asset held in four funds is a fact about the asset, and a reader who
   * arrived from one book still needs to know about the other three.
   */
  portfolioId?: string | null
  portfolioName?: string | null
  /** Why they were sent. Survives the hop and seeds the AI context. */
  issue?: EngagementIssue | string | null
  /** Quiet provenance: which lens raised this. */
  origin?: string | null
}

export const OPEN_ASSET_EVENT = 'tesseract:open-asset' as const

/**
 * Two dispatches, no timer.
 *
 * The first is the tab descriptor on the shell's own channel, which is what
 * actually opens or reuses the tab. The second is the typed event, for anything
 * already mounted that wants to react without waiting for a prop to arrive.
 * Neither depends on the other having run, which is the point: the pattern this
 * replaces opened a tab and then fired a follow-up on a 500ms setTimeout.
 */
export function openAsset(request: OpenAssetRequest): boolean {
  if (typeof window === 'undefined') return false
  // No object without an id. Opening "the asset called AAPL" when the sender
  // could not resolve one is how a reader ends up on somebody else's name.
  if (!request?.assetId) return false
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: assetTabFor(request) }))
  window.dispatchEvent(new CustomEvent<OpenAssetRequest>(OPEN_ASSET_EVENT, { detail: request }))
  return true
}

export function subscribeToOpenAsset(handler: (r: OpenAssetRequest) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OpenAssetRequest>).detail
    if (!detail?.assetId) return
    handler(detail)
  }
  window.addEventListener(OPEN_ASSET_EVENT, listener)
  return () => window.removeEventListener(OPEN_ASSET_EVENT, listener)
}

/**
 * The tab descriptor for the shell.
 *
 * `id` is the asset id so the shell reuses one tab per asset. The shell merges
 * `data` into the existing tab's data, which is why every context key is
 * written even when null -- an omitted key would persist, and a generic open
 * of AAPL would silently inherit "Large Cap Core, framework broken" from
 * whatever sent the reader here twenty minutes ago.
 */
export function assetTabFor(request: OpenAssetRequest) {
  return {
    id: request.assetId,
    title: request.symbol ?? 'Asset',
    type: 'asset' as const,
    data: {
      id: request.assetId,
      symbol: request.symbol ?? null,
      company_name: request.companyName ?? null,
      focus: request.focus ?? 'overview',
      portfolioId: request.portfolioId ?? null,
      portfolioName: request.portfolioName ?? null,
      issue: request.issue ?? null,
      origin: request.origin ?? null,
    },
  }
}

/** Sender names, shared with the arrival banner's vocabulary. */
export const ORIGIN_NAME: Record<string, string> = {
  today: 'Dashboard',
  research: 'Research',
  portfolio: 'Portfolio',
  ideas: 'Ideas',
  decisions: 'Decisions',
}

/** The issue as a sentence, whichever shape the sender used. */
export function issueTitle(issue: OpenAssetRequest['issue']): string | null {
  if (!issue) return null
  return typeof issue === 'string' ? issue : issue.title
}

export function issueDetail(issue: OpenAssetRequest['issue']): string | null {
  if (!issue || typeof issue === 'string') return null
  return issue.detail ?? null
}
