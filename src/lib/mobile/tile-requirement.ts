import {
  rowsVisual, plotVisual, type TileRequirement, type VisualRequirement,
} from '../signals/tile-geometry'
import { insightPanePlan } from '../signals/pane-plan'
import { ideaPanePlan, newsPanePlan } from '../signals/pane-plan'
import { ideaCardType } from '../signals/builders/ideas'

type AnyEntry = Record<string, any>

/**
 * What a feed entry will need on screen, before its card is built.
 *
 * ── The boundary this file exists to hold ─────────────────────────────────
 *
 * `tile-geometry.ts` cannot see a SignalType, and must not. But something has
 * to translate "an unwritten position with three missing thesis sections" into
 * "a claim, one context row and a three-row visual" — that translation is
 * domain knowledge and it lives here. The rule is a one-way valve:
 *
 *     this file   knows domain state, returns SHARED REQUIREMENTS
 *     the resolver knows requirements, returns PIXELS
 *
 * So an adapter below may branch on entry kind. It may never return a height,
 * a tier, or anything that resolves to one. If a future reader finds `448` in
 * this file, the boundary has been broken.
 *
 * ── Why the entry and not the card ────────────────────────────────────────
 *
 * `FeedSlot` reserves a box for entries it has not mounted. A requirement read
 * off a rendered card would exist only for tiles already passed, so a deep
 * offset would mean two different things depending on how the reader got
 * there. Everything here reads fields the entry already carries.
 *
 * ── Why the pane planners, and not a second copy of their rules ───────────
 *
 * A pane is a real part of a card's height, and which panes exist is already
 * decided by `insightPanePlan`, `newsPanePlan` and `ideaPanePlan`. Restating
 * those conditions here would be a second prediction of the same thing, free
 * to drift — and the failure mode of geometry disagreeing with the renderer is
 * a clipped card. Only `guaranteed` is consulted: an eligible-but-async pane
 * (a price series that may not resolve) must not have room reserved for it,
 * which is the same lesson the fixture work landed on.
 */

/** Two lines is what the card clamps prose to; anything longer is a drawer. */
const CLAMPED_BODY_LINES = 2

/** Core thesis sections a case is scored against. Drives the rows visual. */
const THESIS_ROWS = 3

function claimCharsOf(...candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().length
  }
  return 0
}

/** One row of chips holds a couple of short labels; more wrap to a second. */
function contextRowsFor(n: number): number {
  if (n <= 0) return 0
  return n <= 2 ? 1 : 2
}

/** A contract card describes itself; this reads it without interpreting it. */
function fromContractCard(card: AnyEntry, visual: VisualRequirement | null): TileRequirement {
  return {
    claimChars: claimCharsOf(card.headline),
    hasMetric: !!card.metric,
    contextRows: contextRowsFor(card.context?.length ?? 0),
    bodyLines: card.body ? CLAMPED_BODY_LINES : 0,
    visual,
    hasActionTray: true,
    workflow: 'passive',
  }
}

export interface RequirementOptions {
  /**
   * The reader is working in this tile — a response open, a note being
   * written. Known by the feed because the feed owns the state that put it
   * there, never inferred from the DOM.
   */
  workflow?: 'passive' | 'active'
}

/**
 * The requirement for one entry, or null when this file cannot describe it.
 *
 * Null is the honest answer for a shape nobody has taught it, and the caller
 * treats it as "give this tile the whole feed" — which is exactly the
 * behaviour every tile had before geometry existed. A wrong guess clips a
 * card; no guess costs a little room on a family nobody has measured.
 */
export function tileRequirementFor(
  e: AnyEntry, opts: RequirementOptions = {},
): TileRequirement | null {
  const workflow = opts.workflow ?? 'passive'
  const withState = (r: TileRequirement | null): TileRequirement | null =>
    r && { ...r, workflow }

  switch (e?.kind) {
    /**
     * A ladder is the point of the card, and a plot can use room it is given.
     */
    case 'scenario':
      return e.card ? withState(fromContractCard(e.card, plotVisual())) : null

    case 'template':
      return e.card ? withState(fromContractCard(e.card, null)) : null

    case 'signal':
      return e.signal ? withState(fromContractCard(e.signal, null)) : null

    /**
     * Research and capital cards. The case pane is always mounted, and what it
     * draws is a row per core thesis section — so the visual requirement is
     * literally "three readable rows", not "this is a no_research card".
     */
    case 'insight': {
      const ins = e.insight
      if (!ins?.issue?.framing) return null
      const plan = insightPanePlan({
        framing: ins.issue.framing,
        hasCapital: !!ins.capital || !!e.card?.capital,
        evidenceCount: ins.issue.evidence?.length ?? 0,
      })
      return withState({
        claimChars: claimCharsOf(ins.headline, e.card?.headline),
        hasMetric: true,
        contextRows: contextRowsFor(ins.portfolioCount ? 2 : 1),
        bodyLines: ins.body ? CLAMPED_BODY_LINES : 0,
        // A judgment pane is a row of answers, not a picture.
        controlRows: plan.guaranteed.includes('judgment') ? 1 : 0,
        visual: plan.guaranteed.includes('case') ? rowsVisual(THESIS_ROWS) : null,
        hasActionTray: true,
      })
    }

    case 'news': {
      const n = e.news
      if (!n) return null
      const plan = newsPanePlan({ hasLinkedAsset: !!n.primarySymbol })
      return withState({
        claimChars: claimCharsOf(n.headline),
        contextRows: 1,
        bodyLines: n.summary ? CLAMPED_BODY_LINES : 0,
        controlRows: plan.guaranteed.includes('verdict') ? 1 : 0,
        // The tape is eligibility, never a promise — see the header.
        visual: null,
        hasActionTray: true,
      })
    }

    case 'idea': {
      const i = e.idea
      if (!i?.type) return null
      const body = claimCharsOf(i.content, i.title)
      const plan = ideaPanePlan({
        isPair: ideaCardType(i.type) === 'pair_trade',
        hasLadder: false,
        hasAsset: !!i.asset?.symbol,
        bodyLength: body,
        hasEvolution: false,
        hasLegContext: false,
      })
      return withState({
        claimChars: Math.min(body, 90),
        contextRows: 1,
        bodyLines: body ? CLAMPED_BODY_LINES : 0,
        controlRows: plan.guaranteed.includes('verdict') ? 1 : 0,
        visual: null,
        hasActionTray: true,
      })
    }

    /**
     * `lens` and `attention` compose from several sources and can each render
     * as more than one shape, so there is no single honest answer yet. They
     * keep the whole feed until somebody measures them.
     */
    default:
      return null
  }
}
