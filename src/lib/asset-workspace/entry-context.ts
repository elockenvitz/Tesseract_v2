/**
 * The entry context: what the reader was looking at when they opened a name.
 *
 * ── Why this exists, and why `entry.ts` was not enough ───────────────────
 *
 * `entry.ts` reads a TAB DESCRIPTOR -- the handful of ids `openAsset` writes
 * into a tab -- and answers one question: which of three compositions. That
 * is all a tab can carry, because a tab is a string bag persisted across
 * sessions.
 *
 * The Dashboard's right-hand workspace is not reached through a tab. A card
 * is selected in the feed and the pane beside it renders the name, and that
 * card is holding the whole finding: the target the price passed, the mark it
 * was measured against, which scenario it belongs to, when the target was
 * stated, which books hold it. Every one of those numbers was computed by a
 * producer from a canonical row, and at the pane boundary all of it was
 * dropped on the floor -- the surface received a `focus` and a HEADLINE
 * STRING.
 *
 * So a reader pressed "AAPL has reached the target you set for it" and got a
 * page about AAPL. Correct, and not an answer: nothing on it said which
 * target, what the price was against it, or that a target event was the
 * reason they were standing there. The workspace could only re-derive the
 * asset's CURRENT state, which is a different question from the EVENT the
 * reader selected -- and re-deriving it is how a surface ends up contradicting
 * the card that sent the reader to it.
 *
 * This module is the contract between the two. It is explicit, typed, and
 * carries provenance on every number, because a figure surfaced to a user has
 * to be traceable to its source.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * Not authority. Nothing is read from here to decide what a reader may see or
 * do: the workspace's own org-scoped, RLS-backed queries do that, and the
 * context only decides what the page LEADS with and which facts it states
 * alongside the ones it fetches. An `organizationId` travels so the surface
 * can DISCARD a context that belongs to another organisation, never so that
 * one can be asserted.
 *
 * Not a second data path either. Every field is copied from the producer row
 * the card was built from; nothing here fetches, and nothing here computes a
 * number the producer did not already compute.
 */

import type { WorkspaceEntryMode } from './entry'

/**
 * Why this reader is here.
 *
 * A superset of `WorkspaceEntryMode` rather than a second vocabulary: the
 * three tab modes mean exactly what they mean there, and `target_review` is
 * the one intent a tab descriptor cannot express because it needs the event's
 * numbers to be worth composing at all.
 */
export type EntryIntent = WorkspaceEntryMode | 'target_review'

/**
 * Where a price came from. Named, never assumed.
 *
 * `holdings_mark` is `portfolio_holdings.price` -- the book's own mark, which
 * is what the target lens compares and can sit well away from the last traded
 * close. `price_history` is the close the workspace's own chart draws. The
 * shipping card is already careful to say "the position is marked at" rather
 * than "the price is", and this is that care made into a type so the surface
 * below inherits it instead of having to remember.
 */
export type PriceBasis = 'holdings_mark' | 'price_history' | 'stated'

/** One rung of the scenario ladder, as the producer ordered it. */
export interface LadderRung {
  id: string | null
  name: string | null
  price: number
}

/** A book the name is held in, where the producer resolved its id. */
export interface HeldInBook {
  id: string | null
  name: string
}

/**
 * The price passed a target somebody wrote down.
 *
 * ── What this event does and does not claim ──────────────────────────────
 *
 * It claims: on the holdings snapshot of `asOf`, the book's mark for this
 * name was at or above the `targetPrice` of the named case, which was stated
 * on `statedAt`.
 *
 * It does not claim that the crossing happened today, or on `asOf`, or that
 * it happened at all in the trading sense -- the lens compares a snapshot to
 * a stored number and cannot see the path between them. A surface rendering
 * this must date the reading and must not say "crossed today".
 */
export interface TargetReachedEvent {
  kind: 'target_reached'
  /** The scenario whose price was passed. Null where the row names none. */
  caseName: string | null
  targetPrice: number
  /** The number the target was compared against. */
  observedPrice: number
  /** Where `observedPrice` came from. Always the book's mark, today. */
  observedBasis: Extract<PriceBasis, 'holdings_mark'>
  /** How far past the target, as a fraction. The producer's own figure. */
  overshootPct: number
  /** When the target was written down. ISO, or null if the row had none. */
  statedAt: string | null
  /** The holdings snapshot the comparison was made on. ISO, or null. */
  asOf: string | null
  /** The whole ladder the case belongs to, lowest first. May be empty. */
  ladder: readonly LadderRung[]
  heldIn: readonly HeldInBook[]
}

/**
 * A proposed trade nobody has answered.
 *
 * The sizing and the rationale are the producer's, from `trade_queue_items`
 * and the holdings snapshot it was measured against. `currentWeightPct` is
 * null for a name the book does not hold, which is NOT the same as zero --
 * the producer's own contract makes that distinction and it survives here.
 */
export interface RecommendationEvent {
  kind: 'recommendation'
  /** `trade_queue_items.id`. The object the request is about. */
  tradeQueueItemId: string | null
  action: string | null
  proposedWeightPct: number | null
  currentWeightPct: number | null
  /** The snapshot `currentWeightPct` came from. */
  currentWeightAsOf: string | null
  rationale: string | null
  recommendedBy: string | null
  /** When the recommendation was made. ISO. */
  madeAt: string | null
}

export type WorkspaceEntryEvent = TargetReachedEvent | RecommendationEvent

/** The contract. One object, built once, at the boundary the reader crossed. */
export interface WorkspaceEntryContext {
  intent: EntryIntent
  assetId: string
  /**
   * The organisation the context was built in.
   *
   * Carried to be CHECKED, never to be trusted -- see the header. A context
   * whose organisation is not the reader's current one is discarded by
   * `contextAppliesTo`, which is what stops a stale pane stating one
   * organisation's target event over another's data.
   */
  organizationId: string | null
  symbol: string | null
  /** The Dashboard item itself: which producer, which card, when. */
  sourceItem: { family: string; cardId: string | null; occurredAt: string | null } | null
  /** The card's own words. Never regenerated, never composed here. */
  why: { headline: string; reason: string | null } | null
  portfolioId: string | null
  portfolioName: string | null
  /** A specific request to rule on, where the sender named one. */
  decisionId: string | null
  /** A specific process run to advance, where the sender named one. */
  workflow: { workflowId: string; stageId: string | null; requirementId: string | null } | null
  /** The typed event, where the producer row carried enough to state one. */
  event: WorkspaceEntryEvent | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
/** A date, only if it parses. A malformed stamp is absent, never displayed. */
const iso = (v: unknown): string | null => {
  const s = str(v)
  return s && Number.isFinite(new Date(s).getTime()) ? s : null
}

/** The target-lens row, structurally. See `TargetBreach` in `usePortfolioLenses`. */
export interface TargetBreachRow {
  target?: unknown
  price?: unknown
  overshootPct?: unknown
  caseName?: unknown
  cases?: unknown
  statedAt?: unknown
  asOf?: unknown
  heldIn?: unknown
  heldInIds?: unknown
}

/**
 * The event, from the row the producer returned.
 *
 * Null rather than partial. A target review whose target or whose compared
 * price is missing is an orientation that cannot state what it is about, and
 * the honest fallback is the general workspace the reader would otherwise
 * have seen -- not a panel with a blank where the number goes.
 */
export function targetReachedFrom(row: TargetBreachRow | null | undefined): TargetReachedEvent | null {
  if (!row) return null
  const targetPrice = num(row.target)
  const observedPrice = num(row.price)
  const overshootPct = num(row.overshootPct)
  if (targetPrice == null || targetPrice <= 0) return null
  if (observedPrice == null || observedPrice <= 0) return null
  if (overshootPct == null) return null

  const ladder: LadderRung[] = []
  for (const c of Array.isArray(row.cases) ? row.cases : []) {
    const rung = c as { id?: unknown; name?: unknown; price?: unknown }
    const price = num(rung?.price)
    /* A rung with no price is not a scenario, it is a label. Dropped rather
       than drawn at zero, which would read as a case for a worthless name. */
    if (price == null || price <= 0) continue
    ladder.push({ id: str(rung.id), name: str(rung.name), price })
  }

  const names = Array.isArray(row.heldIn) ? row.heldIn : []
  const ids = Array.isArray(row.heldInIds) ? row.heldInIds : []
  const heldIn: HeldInBook[] = []
  names.forEach((n, i) => {
    const name = str(n)
    if (name) heldIn.push({ name, id: str(ids[i]) })
  })

  return {
    kind: 'target_reached',
    caseName: str(row.caseName),
    targetPrice,
    observedPrice,
    observedBasis: 'holdings_mark',
    overshootPct,
    statedAt: iso(row.statedAt),
    asOf: iso(row.asOf),
    ladder,
    heldIn,
  }
}

/** The recommendation producer's input row, structurally. */
export interface RecommendationRow {
  id?: unknown
  action?: unknown
  proposedWeightPct?: unknown
  currentWeightPct?: unknown
  currentWeightAsOf?: unknown
  rationale?: unknown
  recommendedBy?: unknown
  createdAt?: unknown
}

/**
 * The event behind a pending recommendation.
 *
 * Unlike a target review this one is worth stating on identity alone: the
 * reader is being asked to answer a specific person's specific proposal, and
 * the request exists whether or not a weight was filled in. So the floor is
 * an action or a rationale -- something that says what is being proposed --
 * and the numbers are optional alongside it.
 */
export function recommendationFrom(row: RecommendationRow | null | undefined): RecommendationEvent | null {
  if (!row) return null
  const action = str(row.action)
  const rationale = str(row.rationale)
  if (!action && !rationale) return null
  return {
    kind: 'recommendation',
    tradeQueueItemId: str(row.id),
    action,
    proposedWeightPct: num(row.proposedWeightPct),
    currentWeightPct: num(row.currentWeightPct),
    currentWeightAsOf: iso(row.currentWeightAsOf),
    rationale,
    recommendedBy: str(row.recommendedBy),
    madeAt: iso(row.createdAt),
  }
}

/** What the boundary knows about the selected item. Structural on purpose. */
export interface EntrySelectionLike {
  family: string
  key?: string | null
  assetId?: string | null
  symbol?: string | null
  portfolioId?: string | null
  portfolioName?: string | null
  why?: { headline?: string | null; reason?: string | null; occurredAt?: string | null } | null
}

/**
 * Which intent a family implies, BEFORE the row is consulted.
 *
 * Only the families whose finding changes what the page should lead with are
 * listed. Everything else is general, deliberately: a crowded name and a
 * conviction gap are arguments about the position, and the position module
 * the workspace already renders is where they are answered -- promoting them
 * to a lead would be a panel for the sake of having one.
 */
const INTENT_FOR_FAMILY: Record<string, EntryIntent> = {
  target_hit: 'target_review',
  recommendation: 'decision',
}

/**
 * The context, from the selected item.
 *
 * `row` is the structured row the producer returned for this candidate. When
 * it is absent -- or present and insufficient -- the intent falls back to
 * `general`, because the compositions below are built out of the event and an
 * intent without one promises an orientation the surface cannot draw.
 */
export function entryContextFor(input: {
  selection: EntrySelectionLike
  row?: TargetBreachRow | RecommendationRow | null
  organizationId: string | null
  decisionId?: string | null
  workflow?: { workflowId: string; stageId?: string | null; requirementId?: string | null } | null
}): WorkspaceEntryContext | null {
  const { selection, row, organizationId } = input
  const assetId = str(selection.assetId)
  /* No asset, no workspace to orient. The pane reports the gap itself. */
  if (!assetId) return null

  const declared = INTENT_FOR_FAMILY[selection.family] ?? 'general'
  const event: WorkspaceEntryEvent | null =
    declared === 'target_review' ? targetReachedFrom(row as TargetBreachRow)
      : declared === 'decision' ? recommendationFrom(row as RecommendationRow)
        : null

  const workflowId = str(input.workflow?.workflowId)
  const workflow = workflowId
    ? {
      workflowId,
      stageId: str(input.workflow?.stageId),
      requirementId: str(input.workflow?.requirementId),
    }
    : null

  /*
   * The intent the page can actually honour.
   *
   * A declared intent with no event behind it degrades to general rather than
   * leading with an empty frame. `work` is not declared by any family here --
   * it arrives through the explicit `workflow` argument, from a sender that
   * named a run.
   */
  const intent: EntryIntent = event ? declared : workflow ? 'work' : 'general'

  return {
    intent,
    assetId,
    organizationId,
    symbol: str(selection.symbol),
    sourceItem: {
      family: selection.family,
      cardId: str(selection.key),
      occurredAt: iso(selection.why?.occurredAt),
    },
    why: selection.why?.headline
      ? { headline: selection.why.headline, reason: str(selection.why.reason) }
      : null,
    portfolioId: str(selection.portfolioId),
    portfolioName: str(selection.portfolioName),
    decisionId: str(input.decisionId),
    workflow,
    event,
  }
}

/**
 * Whether a context still describes what is on screen.
 *
 * ── The two ways a context goes stale ────────────────────────────────────
 *
 * The reader opens a second name while the first one's context is still in
 * props, and the reader switches organisation with a pane open. Both have
 * shipped as real defects elsewhere in this app: a cache keyed without the
 * organisation served a previous organisation's configuration, and a pane
 * keyed without the asset kept the first name's framing.
 *
 * The check is deliberately cheap and total -- identity, not a heuristic --
 * and the caller renders the general workspace when it fails, which is the
 * composition the reader would have had if nothing had been carried at all.
 */
export function contextAppliesTo(
  context: WorkspaceEntryContext | null | undefined,
  to: { assetId: string | null; organizationId: string | null },
): boolean {
  if (!context) return false
  if (!to.assetId || context.assetId !== to.assetId) return false
  /*
   * A context built before an organisation resolved carries null, and a null
   * matches nothing: the honest answer to "is this the right organisation" is
   * unknown, and unknown must not render another organisation's event.
   */
  if (context.organizationId == null || to.organizationId == null) return false
  return context.organizationId === to.organizationId
}

/** Whole days between an ISO stamp and now. Null when the stamp is absent. */
export function daysSinceIso(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const then = new Date(value).getTime()
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.floor((now - then) / 86_400_000))
}

/**
 * The rungs the observed price has passed, and the ones it has not.
 *
 * Read off the ladder the event carries rather than recomputed from the
 * workspace's own targets: this is the comparison the card made, and the
 * surface's job is to show the reader what they pressed on. Where the two
 * disagree -- the ladder has been edited since -- the surface says so, which
 * is a statement it can only make if it has both.
 */
export function ladderAgainst(event: TargetReachedEvent): {
  passed: readonly LadderRung[]
  ahead: readonly LadderRung[]
} {
  const sorted = [...event.ladder].sort((a, b) => a.price - b.price)
  return {
    passed: sorted.filter(r => event.observedPrice >= r.price),
    ahead: sorted.filter(r => event.observedPrice < r.price),
  }
}
