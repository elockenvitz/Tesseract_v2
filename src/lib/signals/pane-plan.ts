import {
  framingWantsJudgment, framingWantsPrice, type ResearchFraming,
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
   * Capital leads on a capital card.
   *
   * On every other Research framing the tape comes first — something happened
   * to the price, or enough time passed that the chart is what shows it. On an
   * unwritten position nothing happened, and opening onto a price chart answers
   * a question the reader did not ask.
   */
  const order: InsightPaneId[] = []
  if (hasEvidence) order.push('evidence')
  if (hasCapital) order.push('case')
  if (wantsPrice) order.push('price')
  if (!hasCapital) order.push('case')
  if (hasJudgment) order.push('judgment')

  return {
    order,
    guaranteed: order.filter((p): p is Exclude<InsightPaneId, 'price'> => p !== 'price'),
    caseLeads: hasCapital,
  }
}
