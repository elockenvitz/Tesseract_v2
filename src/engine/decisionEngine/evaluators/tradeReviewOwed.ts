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
 * The obligation is now a row, so the surface that exists to say what needs
 * doing can finally say this too. This evaluator invents no rule of its own:
 * it reads what `memory_obligations` already holds open.
 *
 * ── Severity ─────────────────────────────────────────────────────────────
 *
 * From the obligation's own dates, and nothing else. Past its `due_at` is red,
 * because that deadline was set deliberately on the trade
 * (`execution_expected_by`); otherwise age since `raised_at` follows the same
 * two-week / one-week shape the other evaluators use. No new interval is
 * introduced for the condition itself -- only for how loudly an unmet
 * obligation is voiced, which is this file's own business.
 */

import type { DecisionItem, DecisionSeverity } from '../types'

const ORANGE_AFTER_DAYS = 7
const RED_AFTER_DAYS = 14

export interface OpenTradeReviewObligation {
  id: string
  /** The `accepted_trades` row this is about. */
  subject_id: string
  owner_id: string | null
  raised_at: string
  due_at: string | null
  /** Display only, joined by the caller where available. */
  asset_symbol?: string | null
  portfolio_name?: string | null
}

export function evaluateTradeReviewOwed(data: {
  tradeReviewObligations?: OpenTradeReviewObligation[]
  now: Date
}): DecisionItem[] {
  const items: DecisionItem[] = []
  if (!data.tradeReviewObligations?.length) return items

  for (const o of data.tradeReviewObligations) {
    const ageDays = Math.floor(
      (data.now.getTime() - new Date(o.raised_at).getTime()) / 86_400_000,
    )
    const overdue = !!o.due_at && new Date(o.due_at).getTime() < data.now.getTime()

    const severity: DecisionSeverity =
      overdue || ageDays >= RED_AFTER_DAYS ? 'red'
      : ageDays >= ORANGE_AFTER_DAYS ? 'orange'
      : 'yellow'

    const ticker = o.asset_symbol || ''

    items.push({
      // Stable across days: the obligation's own id. An id carrying the age
      // would change every morning and make each dismissal a new orphan row,
      // which is the defect `lib/attention-state/suppression` warns about.
      id: `trade-review-${o.id}`,
      surface: 'action',
      severity,
      category: 'risk',
      title: 'Trade Needs Review',
      titleKey: 'TRADE_REVIEW_OWED',
      description: overdue
        ? 'A committed trade is past its expected execution date and still unreconciled.'
        : 'A committed trade has not reconciled and needs a look.',
      chips: [
        { label: 'Ticker', value: ticker },
        { label: 'Portfolio', value: o.portfolio_name || '' },
        { label: 'Waiting', value: `${ageDays}d` },
      ].filter(c => c.value),
      context: {
        assetTicker: ticker,
        portfolioName: o.portfolio_name || undefined,
      },
      ctas: [
        // The existing route into the surface that owns reconciling it.
        { label: 'Open Trade Book', actionKey: 'OPEN_TRADE_BOOK', kind: 'primary', payload: { tradeId: o.subject_id } },
      ],
      dismissible: false,
      decisionTier: 'capital',
      sortScore: 0,
      createdAt: o.raised_at,
    })
  }

  return items
}
