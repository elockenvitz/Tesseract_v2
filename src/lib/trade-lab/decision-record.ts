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

export function buildDecisionRecord(args: BuildDecisionRecordArgs): DecisionRecord {
  const { trades, sourceVariants, portfolioName, portfolioId, batchName } = args

  const decisions: RecordedDecision[] = trades.map(t => {
    const variant = matchVariant(t, sourceVariants)
    const tqi = variant?.trade_queue_item ?? null

    const thesis = tqi?.rationale ?? null
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
      whyNow: null, // trade_queue_items doesn't have a distinct why_now field today
      beforeWeight,
      afterWeight,
    }
  })

  return {
    decisions,
    portfolioName,
    portfolioId,
    recordedAt: new Date().toISOString(),
    batchName: batchName ?? null,
  }
}
