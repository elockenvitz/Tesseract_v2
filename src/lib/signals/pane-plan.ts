import {
  framingWantsJudgment, framingWantsPrice, framingPriceLeads,
  type ResearchFraming,
} from '../research/case-state'

/**
 * Which panes a Research/insight entry gets, decided from the entry alone.
 *
 * ── Why this is not inlined in the renderer any more ──────────────────────
 *
 * It was, and that was fine while the renderer was the only thing that needed
 * the answer. Two others now do.
 *
 * The gallery is the first. Its capital fixtures mounted a plain card with no
 * panes at all, which is a composition the feed cannot produce — an insight
 * entry always receives a case pane. So those fixtures measured 19-35% ink and
 * 185-271px of dead space, and a density pass spent most of a stage chasing a
 * hole that only existed in the harness. A fixture that does not compose what
 * ships is not a fixture, it is a second implementation.
 *
 * The tier resolver is the second, prospectively. Whether a card carries a
 * flexible region is what decides whether spare height is absorbed into a
 * carousel or pools into a dead band, so a content-aware tier has to know the
 * pane plan BEFORE the card mounts. The moment it asks, there would be two
 * predictions of the same thing, free to drift — and the failure mode of a
 * tier that disagrees with the renderer is a clipped card.
 *
 * One pure function, three readers, no drift.
 *
 * ── On the price pane, which is the honest exception ──────────────────────
 *
 * `price` is an ELIGIBILITY, not a promise, and it is deliberately not counted
 * among the guaranteed panes. The framing can want a price and the pane can
 * still be absent: `pricePane` returns null for a symbol that does not resolve,
 * and the series behind it loads after mount. Anything sizing a card on this
 * plan must treat the price pane as "may appear", never as reserved space —
 * which is exactly why `guaranteed` exists as a separate count.
 */
export type InsightPaneId = 'evidence' | 'case' | 'price' | 'judgment'

export interface InsightPanePlan {
  /**
   * The panes in the order the feed mounts them, price included at the
   * position it would occupy. Read this to COMPOSE.
   */
  order: InsightPaneId[]
  /**
   * The panes that are certain to exist. Read this to reserve SPACE — it
   * excludes `price`, whose presence depends on symbol resolution.
   */
  guaranteed: Exclude<InsightPaneId, 'price'>[]
  /** The case pane leads, because capital is the finding. */
  caseLeads: boolean
}

export interface InsightPaneInput {
  framing: ResearchFraming
  /** The capital reframe applied — an unwritten position with real weight. */
  hasCapital: boolean
  /** Arrivals to review. */
  evidenceCount: number
}

export function insightPanePlan(input: InsightPaneInput): InsightPanePlan {
  const { framing, hasCapital, evidenceCount } = input

  const hasEvidence = framing === 'new_evidence' && evidenceCount > 0
  const hasJudgment = framingWantsJudgment(framing)
  const wantsPrice = framingWantsPrice(framing)

  /**
   * Capital leads on a capital card; the case leads on a structural absence.
   *
   * On `price_move` and `stale_case` the tape comes first — something happened
   * to the price, or enough time passed that the chart is what shows it. On an
   * unwritten position nothing happened, and opening onto a price chart answers
   * a question the reader did not ask.
   *
   * `framingPriceLeads` is that distinction, and it is the whole of what used
   * to be enforced by withholding the pane. Withholding it left the card with
   * nothing to look at; ordering it second says the same thing and still fills
   * the screen the reader gave it.
   */
  const caseFirst = hasCapital || !framingPriceLeads(framing)
  const order: InsightPaneId[] = []
  if (hasEvidence) order.push('evidence')
  if (caseFirst) order.push('case')
  if (wantsPrice) order.push('price')
  if (!caseFirst) order.push('case')
  if (hasJudgment) order.push('judgment')

  return {
    order,
    guaranteed: order.filter((p): p is Exclude<InsightPaneId, 'price'> => p !== 'price'),
    caseLeads: caseFirst,
  }
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/**
 * Which panes a news entry gets, decided from the entry alone.
 *
 * Separate from the insight planner rather than merged with it, because the
 * questions are different rather than differently-parameterised. An insight
 * card is about a case and asks whether the view still holds; a news card is
 * about a story and asks what it means for a name the desk owns. Folding them
 * into one function with a discriminant would produce a planner whose body is
 * two functions in a trenchcoat.
 *
 * `verdict` is the synchronous half: it exists exactly when the story names a
 * symbol the desk has an asset record for, which is knowable from the entry.
 * The price panes are per-symbol and eligibility-only — `pricePane` returns
 * null for a symbol that does not resolve — so they are reported separately
 * and never counted as guaranteed.
 */
export interface NewsPanePlan {
  guaranteed: 'verdict'[]
  /** Symbols a price pane may be drawn for. May yield nothing. */
  priceEligibleSymbols: string[]
}

export function newsPanePlan(input: {
  hasLinkedAsset: boolean
  chartSymbols?: string[]
}): NewsPanePlan {
  return {
    guaranteed: input.hasLinkedAsset ? ['verdict'] : [],
    priceEligibleSymbols: input.chartSymbols ?? [],
  }
}

// ---------------------------------------------------------------------------
// Ideas — the desk's own posts
// ---------------------------------------------------------------------------

/**
 * Which panes an ideas-feed post gets, decided from the post alone.
 *
 * Kept apart from both planners above for the same reason they are apart from
 * each other. The one thing worth noting is what is NOT here: `legs` belongs
 * to `pair_trade` only, and `cases` needs a ladder. A stage brief once
 * recorded that the feed gives a trade idea and a thought a legs pane; it does
 * not, and a fixture built to that belief would have been wrong in a new
 * direction. The gate is `item.type === 'pair_trade'`, in the renderer, and it
 * is mirrored here rather than restated.
 */
export type IdeaPaneId = 'cases' | 'price' | 'legs' | 'changed' | 'post' | 'verdict'

export interface IdeaPanePlan {
  /** Everything certain to mount, in order. Excludes `price`. */
  guaranteed: Exclude<IdeaPaneId, 'price'>[]
  /** Eligible only — the pane still needs a resolvable symbol and a series. */
  priceEligible: boolean
}

export interface IdeaPaneInput {
  isPair: boolean
  /** A scenario-shaped idea WITH a ladder to draw. */
  hasLadder: boolean
  /** The post names an asset, which is what a response is recorded against. */
  hasAsset: boolean
  /** Length of the card's body, as the builder produced it. */
  bodyLength: number
  /** The post has an evolution strip, or is explicitly unchanged. */
  hasEvolution: boolean
  /** A pair whose legs carry market context worth a pane. */
  hasLegContext: boolean
}

/**
 * The body length above which the post gets a pane of its own.
 *
 * The card clamps its body to two lines, so a longer post has a tail the
 * reader cannot reach from the face of the card.
 */
export const IDEA_POST_PANE_MIN_BODY = 140

export function ideaPanePlan(input: IdeaPaneInput): IdeaPanePlan {
  const guaranteed: Exclude<IdeaPaneId, 'price'>[] = []
  if (!input.isPair && input.hasLadder) guaranteed.push('cases')
  if (input.isPair && input.hasLegContext) guaranteed.push('legs')
  if (input.hasEvolution) guaranteed.push('changed')
  if (input.bodyLength > IDEA_POST_PANE_MIN_BODY) guaranteed.push('post')
  if (input.hasAsset) guaranteed.push('verdict')
  return { guaranteed, priceEligible: input.hasAsset }
}
