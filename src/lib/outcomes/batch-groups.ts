/**
 * Batches in Outcomes: the batch is the container a decision was committed in,
 * the individual trade stays the unit of outcome.
 *
 * ── What a batch card may say ─────────────────────────────────────────────
 *
 * - how many trades, and the mix of their outcome statuses;
 * - a total $ P&L ONLY when every trade in it has its own P&L proxy and none of
 *   those trades is also counted in another batch.
 *
 * There is deliberately no batch return %. A batch mixes buys and sells in
 * different names and sizes; averaging their moves produces a number with no
 * provenance.
 *
 * ── One decision, several batches ─────────────────────────────────────────
 *
 * A decision (trade idea) can be executed more than once, each time in its own
 * batch — production has one committed in four. Its outcome is computed once,
 * for the decision, so it appears under each batch it was committed in but its
 * P&L cannot be attributed to any one of them. A batch holding such a trade
 * therefore reports its P&L as partial rather than counting the same dollars
 * four times.
 */

import type { AccountabilityRow, RowBatch } from '../../types/decision-accountability'
import { formatCompactDollars, type DecisionIntelligence } from '../decision-intelligence'

export type DecisionItem = { row: AccountabilityRow; intel: DecisionIntelligence }

export interface PayloadAcceptedTrade {
  trade_queue_item_id: string | null
  batch_id?: string | null
  batch_name?: string | null
  batch_created_at?: string | null
}

/** Each decision's batches, from the Outcomes payload's active accepted trades. */
export function batchesByDecision(acceptedTrades: readonly PayloadAcceptedTrade[]): Map<string, RowBatch[]> {
  const out = new Map<string, RowBatch[]>()
  for (const at of acceptedTrades) {
    if (!at.trade_queue_item_id || !at.batch_id) continue
    const list = out.get(at.trade_queue_item_id) ?? []
    if (!list.some(b => b.id === at.batch_id)) {
      list.push({ id: at.batch_id, name: at.batch_name?.trim() || null, committedAt: at.batch_created_at ?? null })
    }
    out.set(at.trade_queue_item_id, list)
  }
  for (const list of out.values()) list.sort((a, b) => (b.committedAt ?? '').localeCompare(a.committedAt ?? ''))
  return out
}

export function batchLabel(batch: Pick<RowBatch, 'name'>): string {
  return batch.name || 'Untitled batch'
}

export type BatchPnl =
  | { kind: 'total'; value: number }
  | { kind: 'partial'; known: number; of: number }
  | { kind: 'none' }

export interface BatchGroup {
  batch: RowBatch
  portfolioName: string | null
  /** Every trade committed in the batch (after the page's own filters). */
  items: DecisionItem[]
  /** Trades matching the search; equal to `items` when there is no search or
   *  the batch name itself matched. */
  matches: DecisionItem[]
  statusMix: Array<{ label: string; count: number }>
  pnl: BatchPnl
}

/** Case-insensitive match on ticker, company name, or any batch name. */
export function rowMatchesSearch(row: AccountabilityRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return !!(
    row.asset_symbol?.toLowerCase().includes(q)
    || row.asset_name?.toLowerCase().includes(q)
    || row.batches?.some(b => (b.name ?? '').toLowerCase().includes(q))
  )
}

function statusMix(items: DecisionItem[]) {
  const counts = new Map<string, number>()
  for (const { intel } of items) counts.set(intel.verdictLabel, (counts.get(intel.verdictLabel) ?? 0) + 1)
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function batchPnl(items: DecisionItem[]): BatchPnl {
  const attributable = items.filter(({ row }) =>
    row.impact_proxy != null && Number.isFinite(row.impact_proxy) && (row.batches?.length ?? 0) === 1)
  if (items.length > 0 && attributable.length === items.length) {
    return { kind: 'total', value: attributable.reduce((s, { row }) => s + (row.impact_proxy as number), 0) }
  }
  const known = items.filter(({ row }) => row.impact_proxy != null && Number.isFinite(row.impact_proxy)).length
  return known > 0 ? { kind: 'partial', known, of: items.length } : { kind: 'none' }
}

/**
 * Group the page's (already filtered) decisions by batch.
 *
 * A batch is kept when its name matches the search (with all its trades) or
 * when any of its trades match (listing those in `matches`). Decisions in no
 * batch come back as `standalone`, searched by ticker and company.
 */
export function groupByBatch(items: readonly DecisionItem[], query = ''): { groups: BatchGroup[]; standalone: DecisionItem[] } {
  const q = query.trim().toLowerCase()
  const byBatch = new Map<string, { batch: RowBatch; items: DecisionItem[] }>()
  const standalone: DecisionItem[] = []

  for (const item of items) {
    const batches = item.row.batches ?? []
    if (batches.length === 0) {
      if (rowMatchesSearch(item.row, q)) standalone.push(item)
      continue
    }
    for (const batch of batches) {
      const entry = byBatch.get(batch.id) ?? { batch, items: [] }
      entry.items.push(item)
      byBatch.set(batch.id, entry)
    }
  }

  const groups: BatchGroup[] = []
  for (const { batch, items: batchItems } of byBatch.values()) {
    const nameMatches = !q || (batch.name ?? '').toLowerCase().includes(q)
    const matches = nameMatches
      ? batchItems
      : batchItems.filter(({ row }) => row.asset_symbol?.toLowerCase().includes(q) || row.asset_name?.toLowerCase().includes(q))
    if (matches.length === 0) continue
    groups.push({
      batch,
      portfolioName: batchItems[0]?.row.portfolio_name ?? null,
      items: batchItems,
      matches,
      statusMix: statusMix(batchItems),
      pnl: batchPnl(batchItems),
    })
  }
  groups.sort((a, b) => (b.batch.committedAt ?? '').localeCompare(a.batch.committedAt ?? ''))
  return { groups, standalone }
}

/** "2 Working · 1 Stalled" */
export function statusMixText(mix: BatchGroup['statusMix']): string {
  return mix.map(s => `${s.count} ${s.label}`).join(' · ')
}

/** The card's P&L text, or null to omit it. Never a return percentage. */
export function batchPnlText(pnl: BatchPnl): string | null {
  if (pnl.kind === 'total') return `${formatPnl(pnl.value)} P&L`
  if (pnl.kind === 'partial') return `P&L partial · ${pnl.known} of ${pnl.of}`
  return null
}

/** "+$15K", "−$245": a decision's P&L label format (formatCompactDollars),
 *  so a batch holding one trade shows exactly what that trade's card shows. */
export function formatPnl(value: number): string {
  return formatCompactDollars(value, value > 0 ? '+' : value < 0 ? '−' : '')
}
