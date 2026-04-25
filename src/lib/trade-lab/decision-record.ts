/**
 * Builds a DecisionRecord (the data the Decision Recorded modal renders)
 * from an executeSimVariants result + the variants that were committed.
 *
 * Everything here is best-available-data: thesis and context are pulled from
 * whatever's already joined on the variant/idea/trade, with graceful fallbacks.
 * Never throws — if a field is missing, we just emit null / a placeholder.
 */

import type { AcceptedTradeWithJoins, IntentVariantWithDetails } from '../../types/trading'
import type { DecisionRecord, RecordedDecision } from '../../components/trading/DecisionConfirmationModal'

export interface BuildDecisionRecordArgs {
  trades: AcceptedTradeWithJoins[]
  /** The variants the user commanded to execute. Optional; when present we pull
   *  thesis / before-weight / rationale from them. Matching is by asset_id. */
  sourceVariants?: IntentVariantWithDetails[]
  portfolioName: string
  portfolioId: string
  batchName?: string | null
  /** Batch-level rationale / thesis ("why this whole basket of trades"). Shown
   *  above per-trade context on multi-trade records. Trims to null if blank. */
  batchDescription?: string | null
}

function matchVariant(trade: AcceptedTradeWithJoins, variants: IntentVariantWithDetails[] | undefined): IntentVariantWithDetails | null {
  if (!variants || variants.length === 0) return null
  // Prefer explicit lab_variant_id link; fall back to asset_id.
  const byId = trade.lab_variant_id ? variants.find(v => v.id === trade.lab_variant_id) : null
  if (byId) return byId
  return variants.find(v => v.asset_id === trade.asset_id) ?? null
}

function roundPct(n: number | null | undefined, decimals = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null
  const m = Math.pow(10, decimals)
  return Math.round(n * m) / m
}

// Pilot-seeded ideas store rationale as "<thesis>\n\nWhy now: <why-now>" in
// a single column, but the marker can be slightly variable ("Why now:",
// "Why Now -", "WHY NOW:" across seed vintages). Scan for the first
// occurrence of a "why now" heading — case-insensitive, tolerant of common
// separators (: - –) — and split there. Falls through as thesis-only with
// whyNow = null when no marker is present.
function splitRationale(raw: string | null): { thesis: string | null; whyNow: string | null } {
  if (!raw) return { thesis: null, whyNow: null }
  const text = raw.trim()
  if (!text) return { thesis: null, whyNow: null }

  // Look for a "why now" label. The word boundary + optional separator
  // tolerates "Why now:", "Why now -", "WHY NOW —", etc.
  const markerRe = /\bwhy\s+now\b\s*[:\-–—]?\s*/i
  const match = markerRe.exec(text)
  if (!match) return { thesis: text, whyNow: null }

  const markerStart = match.index
  const markerEnd = markerStart + match[0].length
  const thesis = text.slice(0, markerStart).trim()
  const whyNow = text.slice(markerEnd).trim()

  // If the marker was at the very start (no thesis prefix), keep the
  // combined text as the thesis and emit no whyNow — splitting it would
  // leave an empty Thesis card.
  if (!thesis) return { thesis: text, whyNow: null }
  if (!whyNow) return { thesis: text, whyNow: null }

  return { thesis, whyNow }
}

export function buildDecisionRecord(args: BuildDecisionRecordArgs): DecisionRecord {
  const { trades, sourceVariants, portfolioName, portfolioId, batchName, batchDescription } = args

  const decisions: RecordedDecision[] = trades.map(t => {
    const variant = matchVariant(t, sourceVariants)
    const tqi = variant?.trade_queue_item ?? null

    // Rationale on pilot-seeded ideas is stored as "thesis \n\n Why now: …"
    // in a single `rationale` column. Split on the "Why now:" marker so the
    // modal can render the two halves as separate labeled cards.
    const { thesis, whyNow } = splitRationale(tqi?.rationale ?? null)

    const beforeWeight = roundPct((variant?.current_position as any)?.weight ?? null)
    const deltaWeight = roundPct(t.delta_weight)
    const targetWeight = roundPct(t.target_weight)
    const afterWeight = (() => {
      if (targetWeight != null) return targetWeight
      if (beforeWeight != null && deltaWeight != null) return roundPct(beforeWeight + deltaWeight)
      return null
    })()

    return {
      tradeId: t.id,
      symbol: t.asset?.symbol || 'UNKNOWN',
      companyName: t.asset?.company_name ?? null,
      action: t.action,
      deltaWeight,
      targetWeight,
      deltaShares: t.delta_shares,
      notional: t.notional_value,
      priceAtAcceptance: t.price_at_acceptance,
      sizingInput: t.sizing_input,
      acceptanceNote: t.acceptance_note,
      thesis,
      whyNow,
      beforeWeight,
      afterWeight,
    }
  })

  const trimmedDescription = batchDescription?.trim() || null

  return {
    decisions,
    portfolioName,
    portfolioId,
    recordedAt: new Date().toISOString(),
    batchName: batchName ?? null,
    batchDescription: trimmedDescription,
  }
}
