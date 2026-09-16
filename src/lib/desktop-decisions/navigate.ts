/**
 * Where a decision's follow-up actually happens.
 *
 * The Dashboard lens does not review outcomes or keep trade history: Outcomes
 * owns the reflection and Trade Book owns the committed act. Both already
 * accept a target, and both are opened through the shell's existing tab
 * channel -- the same `decision-engine-action` event every other deep link on
 * this surface uses. Nothing new is routed, and nothing is duplicated here.
 */

import type { DecisionRecord } from './model'

function openTab(detail: { id: string; title: string; type: string; data: unknown }): boolean {
  if (typeof window === 'undefined') return false
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail }))
  return true
}

/**
 * Outcomes, on this decision.
 *
 * `tradeQueueItemId` is the parameter Outcomes already takes to open one
 * decision (DashboardPage routes it to `focusDecisionId`), and it is what the
 * pilot's own "Review outcome" step passes.
 */
export function openOutcomesFor(d: Pick<DecisionRecord, 'ideaId'>): boolean {
  if (!d.ideaId) return false
  return openTab({
    id: 'outcomes', title: 'Outcomes', type: 'outcomes',
    data: { tradeQueueItemId: d.ideaId },
  })
}

/**
 * Trade Book, on the committed act.
 *
 * A batch highlights as a batch, a lone trade as a trade: `TradeBookPage`
 * takes `highlightBatchId` and `highlightTradeIds` and this passes whichever
 * the act actually has, with the book so it opens on the right one.
 */
export function openTradeBookFor(
  d: Pick<DecisionRecord, 'portfolioId' | 'execution' | 'batch'>,
): boolean {
  const batchId = d.batch?.id ?? null
  const tradeId = d.execution?.id ?? null
  if (!batchId && !tradeId) return false
  return openTab({
    id: 'trade-book', title: 'Trade Book', type: 'trade-book',
    data: {
      portfolioId: d.portfolioId,
      highlightBatchId: batchId,
      highlightTradeIds: batchId ? null : tradeId ? [tradeId] : null,
    },
  })
}
