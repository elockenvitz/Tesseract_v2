import { toResearchStage } from '../trade-status-semantics'

/**
 * A pipeline row: either a single idea or a pair trade carrying its legs.
 *
 * Pairs are one row, not two. The legs move together — movePairTrade moves the
 * whole group — so rendering them as independent cards offers a per-leg move
 * that cannot be made, shows the pair twice, and double-counts its stage.
 *
 * Extracted from MobilePipeline so the grouping is testable on its own. It is
 * the subtlest logic on that surface and every failure mode is silent: a
 * mis-grouped pair still renders, still looks plausible, and only misleads.
 */
export type PipelineRow =
  | { kind: 'item'; id: string; stage: string; status: string; item: any }
  | { kind: 'pair'; id: string; stage: string; status: string; pair: any; legs: any[] }

/** Terminal statuses, split the way the desktop board's fourth column splits them. */
export const COMMITTED_PIPELINE_STATUSES: string[] = ['approved', 'executed']
export const ARCHIVED_PIPELINE_STATUSES: string[] = ['rejected', 'cancelled', 'archived']

/**
 * Collapse a flat trade_queue_items list into rows, grouping pair legs.
 *
 * A leg is identified by `pair_id` or the legacy `pair_trade_id`; rows carrying
 * neither are singles. The pair's stage and status come from its first leg
 * rather than the joined `pair_trades` row, which goes stale whenever a move
 * updates the legs but not the parent.
 *
 * Legs sort long-first so a pair reads as "long X / short Y" and renders
 * identically between loads regardless of what order the query returned.
 */
export function groupIntoRows(items: any[]): PipelineRow[] {
  const pairs = new Map<string, { pair: any; legs: any[] }>()
  const singles: any[] = []

  for (const item of items ?? []) {
    if (!item) continue
    const pairId = item.pair_id || item.pair_trade_id
    if (pairId) {
      if (!pairs.has(pairId)) {
        pairs.set(pairId, {
          pair: item.pair_trades ?? { id: pairId, name: 'Pair Trade', rationale: item.rationale },
          legs: [],
        })
      }
      const group = pairs.get(pairId)!
      // The same leg can arrive twice when a caller merges the items query with
      // the pair_trades join. Deduping here rather than at the call site keeps
      // the invariant with the grouping that depends on it.
      if (!group.legs.some(l => l.id === item.id)) group.legs.push(item)
      // A later row may carry the joined pair record where the first did not.
      if (!group.pair?.name && item.pair_trades) group.pair = item.pair_trades
    } else {
      singles.push(item)
    }
  }

  const rows: PipelineRow[] = singles.map(item => ({
    kind: 'item' as const,
    id: item.id,
    stage: toResearchStage(item.stage) as string,
    status: item.status,
    item,
  }))

  for (const [pairId, group] of pairs) {
    const legs = [...group.legs].sort(
      (a, b) => (a.pair_leg_type === 'long' ? 0 : 1) - (b.pair_leg_type === 'long' ? 0 : 1)
    )
    const first = legs[0]
    rows.push({
      kind: 'pair',
      id: pairId,
      stage: toResearchStage(first?.stage) as string,
      status: first?.status,
      pair: group.pair,
      legs,
    })
  }

  return rows
}

/**
 * What a row is still missing before it can advance to `targetStage`.
 *
 * Mirrors validateStageRequirements in trade-idea-service, which throws on a
 * forward move that fails it. The phone previously offered the move anyway and
 * surfaced the throw afterwards, which is the wrong way round: the reader taps
 * "advance", waits, and is told no. Checking the same rule up front lets the
 * control say what is missing before it is pressed.
 *
 * Deliberately covers only the field gates, which are answerable from the row
 * already in hand. The `deciding` stage additionally requires an active
 * recommendation, which needs a query — and `deciding` is not one of the
 * research stages this surface moves between, so it cannot arise here. If that
 * ever changes this must grow a query rather than silently under-reporting.
 *
 * Backward moves are never gated, matching the service.
 */
export function missingForStage(row: PipelineRow, targetStage: string): string[] {
  if (targetStage !== 'ready_for_decision' && targetStage !== 'deciding') return []

  const subject = row.kind === 'pair' ? row.legs[0] : row.item
  if (!subject) return []

  const missing: string[] = []
  if (!subject.rationale?.toString().trim()) missing.push('Why now')
  if (!subject.thesis_text?.toString().trim()) missing.push('Trade thesis')
  return missing
}

/** Stage order used for "is this a forward move", matching the service. */
const FORWARD_ORDER = [
  'aware', 'investigate', 'deep_research', 'thesis_forming', 'ready_for_decision', 'deciding',
]

export function isForwardMove(fromStage: string, toStage: string): boolean {
  const from = FORWARD_ORDER.indexOf(fromStage)
  const to = FORWARD_ORDER.indexOf(toStage)
  return from >= 0 && to >= 0 && to > from
}

/** Every string a row should be searchable by. */
export function rowSearchText(row: PipelineRow): string {
  const parts =
    row.kind === 'pair'
      ? [
          row.pair?.name,
          row.pair?.rationale,
          ...row.legs.map(l => l.assets?.symbol),
          ...row.legs.map(l => l.assets?.company_name),
        ]
      : [row.item.assets?.symbol, row.item.assets?.company_name, row.item.rationale]
  return parts.filter(Boolean).join(' ').toLowerCase()
}
