/**
 * A committed trade the lifecycle rule says needs review.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `tradeLifecyclePhase` has always been able to say a trade needs review --
 * reconciliation came back partial, deviated or unmatched, or the staleness
 * sweeper flagged it. Nothing outside Trade Book ever read that. A trade whose
 * fills never matched sat there indefinitely, and the only way to find out was
 * for somebody to open that portfolio's Trade Book and look at a pill.
 *
 * The obligation is a `memory_obligations` row now, so the surface that exists
 * to say what needs doing can say this too. This evaluator invents no rule of
 * its own: it reads what is already open.
 *
 * ── The first producer on the candidate contract ─────────────────────────
 *
 * It produces `FeedCandidate`s -- the claim itself -- and a thin adapter turns
 * those into the `DecisionItem`s Today already renders. Chosen to go first
 * because it derives from a durable memory fact, so the contract gets checked
 * against something real rather than a shape invented to fit it.
 *
 * Eligibility, severity, the stable id and the provenance are unchanged by
 * that move. What changed is that the claim is now separable from the tile.
 *
 * ── Severity ─────────────────────────────────────────────────────────────
 *
 * From the obligation's own dates and nothing else. Past its `due_at` is red,
 * because that deadline was set deliberately on the trade
 * (`execution_expected_by`); otherwise age since `raised_at` follows the same
 * two-week / one-week shape the neighbouring evaluators use.
 */

import type { DecisionItem } from '../types'
import type { FeedCandidate } from '../../../lib/feed/candidate'
import { candidateToDecisionItem } from '../../../lib/feed/to-decision-item'

const ORANGE_AFTER_DAYS = 7
const RED_AFTER_DAYS = 14

export const TRADE_REVIEW_OWED_KIND = 'TRADE_REVIEW_OWED'

export interface OpenTradeReviewObligation {
  id: string
  /** The `accepted_trades` row this is about. */
  subject_id: string
  organization_id?: string | null
  owner_id: string | null
  raised_at: string
  due_at: string | null
  /** Display only, joined by the caller where available. */
  asset_symbol?: string | null
  portfolio_name?: string | null
}

/**
 * The claim, with no tile in sight.
 *
 * Exported so a future surface can consume candidates directly rather than
 * going through the feed-item adapter.
 */
export function tradeReviewCandidates(data: {
  tradeReviewObligations?: OpenTradeReviewObligation[]
  now: Date
}): FeedCandidate[] {
  if (!data.tradeReviewObligations?.length) return []

  return data.tradeReviewObligations.map(o => {
    const ageDays = Math.floor(
      (data.now.getTime() - new Date(o.raised_at).getTime()) / 86_400_000,
    )
    const overdue = !!o.due_at && new Date(o.due_at).getTime() < data.now.getTime()

    const severity: FeedCandidate['severity'] =
      overdue || ageDays >= RED_AFTER_DAYS ? 'red'
      : ageDays >= ORANGE_AFTER_DAYS ? 'orange'
      : 'yellow'

    return {
      // The obligation's own id. An id carrying the age would change every
      // morning and make each dismissal a new orphan row -- the defect
      // `lib/attention-state/suppression` documents.
      id: `trade-review-${o.id}`,
      kind: TRADE_REVIEW_OWED_KIND,
      subjectType: 'trade',
      subjectId: o.subject_id,
      organizationId: o.organization_id ?? '',
      reason: overdue
        ? 'A committed trade is past its expected execution date and still unreconciled.'
        : 'A committed trade has not reconciled and needs a look.',
      severity,
      // When it started being owed, not when this ran. What "waiting" counts.
      occurredAt: o.raised_at,
      facts: {
        assetSymbol: o.asset_symbol ?? null,
        portfolioName: o.portfolio_name ?? null,
        waitingDays: ageDays,
      },
      provenance: {
        producer: 'evaluator:tradeReviewOwed',
        sourceType: 'accepted_trades',
        sourceId: o.subject_id,
      },
      // It exists because a durable obligation is open. That is the whole
      // reason this producer went first.
      memoryRefs: [{ kind: 'obligation', id: o.id }],
      actions: [
        { actionKey: 'OPEN_TRADE_BOOK', payload: { tradeId: o.subject_id } },
      ],
    }
  })
}

/** The same claims, drawn the way Today already draws things. */
export function evaluateTradeReviewOwed(data: {
  tradeReviewObligations?: OpenTradeReviewObligation[]
  now: Date
}): DecisionItem[] {
  return tradeReviewCandidates(data).map(c => candidateToDecisionItem(c, {
    title: 'Trade Needs Review',
    titleKey: TRADE_REVIEW_OWED_KIND,
    category: 'risk',
    chips: [
      { label: 'Ticker', value: String(c.facts?.assetSymbol ?? '') },
      { label: 'Portfolio', value: String(c.facts?.portfolioName ?? '') },
      { label: 'Waiting', value: `${c.facts?.waitingDays ?? 0}d` },
    ],
    ctaLabels: { OPEN_TRADE_BOOK: 'Open Trade Book' },
  }))
}
