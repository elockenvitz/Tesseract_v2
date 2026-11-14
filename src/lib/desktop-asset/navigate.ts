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

/**
 * The exact thing on the page, where the sender pressed a control about one.
 *
 * ── Why `focus` was not enough ───────────────────────────────────────────
 *
 * `focus` names a LENS — which question the reader arrived with, and which of
 * the page's modes answers it. That is the right granularity for "they came
 * from the Decision Inbox". It is the wrong granularity for "they pressed
 * *Edit in research* inside The case", because Research is a long page and
 * `focus: 'research'` lands the reader at whatever scroll position Research
 * was last left at. The control named a section and the arrival forgot it.
 *
 * ── Why these five values and no more ────────────────────────────────────
 *
 * They are the anchors the Asset page already renders, and the ones its
 * `attentionAnchor` effect already knows how to reach — including the part
 * that is not obvious: the rating and the targets only EXIST in the DOM once
 * the "All" view is forced and the Forecasts section is expanded, and that
 * effect polls until the template query has rendered them. Naming a sixth
 * section here without an anchor to match would be a request that scrolls
 * nowhere, which is the defect `WORK_SECTION_ID.decisions` records.
 *
 * `case` and `thesis` resolve to the same anchor. The case BEGINS at the
 * thesis, so that is the nearest truthful target rather than a redirect.
 */
export const ASSET_SECTION_TARGETS = ['case', 'thesis', 'risks', 'targets', 'rating'] as const
export type AssetSectionTarget = typeof ASSET_SECTION_TARGETS[number]

/** Is this a section the Asset page can actually reach? */
export function isAssetSectionTarget(value: unknown): value is AssetSectionTarget {
  return typeof value === 'string'
    && (ASSET_SECTION_TARGETS as readonly string[]).includes(value)
}

export interface OpenAssetRequest {
  assetId: string
  /** Known to most senders, and the only thing a price read can key on. */
  symbol?: string | null
  companyName?: string | null
  focus?: AssetFocus
  /**
   * Which section of that lens, where the sender pressed a control about one.
   *
   * Optional and usually absent: most arrivals are about an asset, not about
   * a paragraph of it. Set it only when the control the reader pressed names
   * the section — "Edit in research" inside The case does; "open the asset"
   * does not — because an arrival that scrolls when the reader did not ask it
   * to is as disorienting as one that fails to.
   */
  section?: AssetSectionTarget | null
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
  /**
   * The decision request the reader was sent to rule on.
   *
   * `focus` says which part of the asset matters; this says which RECORD.
   * The Decision Inbox knows it, and without it the workspace can only lead
   * with "something is waiting here" rather than with the request the reader
   * clicked. `lib/asset-workspace/entry` reads it.
   */
  decisionId?: string | null
  /**
   * The process run, stage and requirement the reader was sent to advance.
   *
   * These three already travelled in tab data from the process-first route
   * (`destinationFromTabData` names the spellings), written by senders that
   * hand-build their own descriptor. Carrying them HERE puts them in the
   * typed contract, so a sender using `openAsset` does not have to know the
   * payload's field names, and -- like every other context key -- they are
   * written even when absent, so a generic open of a name cannot inherit the
   * run somebody opened twenty minutes ago.
   */
  work?: { workflowId: string; stageId?: string | null; requirementId?: string | null } | null
}

export const OPEN_ASSET_EVENT = 'tesseract:open-asset' as const

/**
 * A unique id per navigation request, so the receiver can tell a NEW intent
 * from one it already acted on.
 *
 * ── Why the descriptor needs this ─────────────────────────────────────────
 *
 * `focus` is written into TAB DATA, and tab data is durable: the shell merges
 * it into the open tab and keeps it there. Only the active tab renders, so
 * moving to another tab unmounts the Asset page and returning remounts it —
 * at which point the focus effect read the same `focus` again and re-applied
 * it, overwriting wherever the reader had since navigated. A reader who
 * arrived from "Edit on the asset", went to History, and came back was put
 * back in Research, forever.
 *
 * The focus value alone cannot distinguish the cases, because "open this
 * asset in Research again" and "this tab was once opened in Research" are the
 * same two fields. An id that changes per call can: the receiver stores the
 * last one it consumed, so a replayed descriptor is recognisably the same
 * request and a genuinely new one — even to the same asset and the same
 * focus — is recognisably different.
 *
 * Not a timestamp alone: two sends inside the same millisecond would collide
 * and the second would be swallowed. A counter makes it unique within the
 * session, and the time prefix keeps it readable in a saved session.
 */
let focusRequestSeq = 0
export function nextFocusRequestId(): string {
  focusRequestSeq += 1
  return `${Date.now().toString(36)}-${focusRequestSeq.toString(36)}`
}

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
      /*
       * Written even when absent, like every other context key: a descriptor
       * that omitted `section` would MERGE over the open tab and leave the
       * last arrival's section attached to a different question, so the next
       * generic open of the same name would scroll to a paragraph nobody
       * asked about. The receiver pairs it with `focusRequestId` below, so a
       * section is acted on once per request rather than every time the tab
       * is returned to -- the durable-replay defect that id exists for.
       */
      section: request.section ?? null,
      /*
       * Stamped per call, never reused. The receiver consumes a focus once
       * per id, so this is what stops a remount replaying the arrival and
       * what lets the same lens send a reader to the same place twice.
       */
      focusRequestId: nextFocusRequestId(),
      portfolioId: request.portfolioId ?? null,
      portfolioName: request.portfolioName ?? null,
      issue: request.issue ?? null,
      origin: request.origin ?? null,
      /* Why the reader is here, as records rather than as a mood. Written
         even when absent: see the comment on `work` above. */
      decisionId: request.decisionId ?? null,
      workflowId: request.work?.workflowId ?? null,
      stageId: request.work?.stageId ?? null,
      requirementId: request.work?.requirementId ?? null,
      /*
       * The older spelling for a requirement, written as null for the same
       * reason. `UserTab` sends `{ taskId, stageId }` on an assigned task and
       * hand-builds its descriptor, so without this a later generic open of
       * the same name would merge over the rest and leave the task behind --
       * and `AssetTab` reads `taskId` directly to resolve a task arrival.
       */
      taskId: null,
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
