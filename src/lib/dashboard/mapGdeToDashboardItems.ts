/**
 * Deterministic mapping layer: GDE DecisionItems → DashboardItem[].
 *
 * Handles:
 *   1. Type inference from engine item ID prefixes
 *   2. Band assignment (NOW / SOON / AWARE)
 *   3. Severity assignment with configurable age thresholds
 *   4. Primary action onClick closure creation
 *   5. Context chip extraction
 *
 * All threshold constants are at the top of this file for easy tuning.
 */

import type { DecisionItem } from '../../engine/decisionEngine/types'
import type { AttentionItem } from '../../types/attention'
import type {
  DashboardItem,
  DashboardBand,
  DashboardSeverity,
  DashboardItemType,
  DashboardBandSummary,
  DashboardGroupBy,
  DashboardGroup,
} from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Threshold constants — tune these to change classification behavior
// ---------------------------------------------------------------------------

/** Proposals awaiting decision: HIGH after 7d, MED after 3d */
export const DECISION_HIGH_DAYS = 7
export const DECISION_MED_DAYS = 3

/** Overdue deliverables are always HIGH */

/** Thesis stale: HIGH after 180d, MED after 90d */
export const THESIS_HIGH_DAYS = 180
export const THESIS_MED_DAYS = 90

/** Rating change without follow-up: MED if within 7d, else LOW */
export const RATING_MED_DAYS = 7

/** Ideas not simulated: MED after 5d, else LOW */
export const SIMULATION_MED_DAYS = 5

/** Execution not confirmed: HIGH after 5d, MED after 2d */
export const EXECUTION_HIGH_DAYS = 5
export const EXECUTION_MED_DAYS = 2

// ---------------------------------------------------------------------------
// Navigation callback type (injected by hook)
// ---------------------------------------------------------------------------

export type NavigateFn = (detail: {
  type: string
  id: string
  title: string
  data?: Record<string, any>
}) => void

// ---------------------------------------------------------------------------
// Type inference from engine item ID prefixes
// ---------------------------------------------------------------------------

function inferType(item: DecisionItem): DashboardItemType {
  if (item.id.startsWith('a1-proposal')) return 'DECISION'
  if (item.id.startsWith('a2-execution')) return 'DECISION'
  if (item.id.startsWith('a3-unsimulated')) return 'SIMULATION'
  if (item.id.startsWith('a4-deliverable')) return 'PROJECT'
  if (item.id.startsWith('i1-rating')) return 'RATING'
  if (item.id.startsWith('i3-ev')) return 'SIGNAL'
  if (item.id.startsWith('thesis-stale')) return 'THESIS'
  if (item.id.startsWith('rollup-')) {
    if (item.titleKey === 'PROPOSAL_AWAITING_DECISION') return 'DECISION'
    if (item.titleKey === 'IDEA_NOT_SIMULATED') return 'SIMULATION'
    if (item.titleKey === 'THESIS_STALE') return 'THESIS'
  }
  if (item.category === 'catalyst') return 'SIGNAL'
  if (item.category === 'project') return 'PROJECT'
  return 'OTHER'
}

function inferTypeFromAttention(item: AttentionItem): DashboardItemType {
  switch (item.source_type) {
    case 'trade_queue_item': return 'DECISION'
    case 'project_deliverable': return 'PROJECT'
    case 'project': return 'PROJECT'
    default:
      if (item.attention_type === 'decision_required') return 'DECISION'
      if (item.attention_type === 'alignment') return 'OTHER'
      return 'OTHER'
  }
}

// ---------------------------------------------------------------------------
// Band assignment
// ---------------------------------------------------------------------------

function assignBandFromEngine(item: DecisionItem, type: DashboardItemType): DashboardBand {
  // Proposals awaiting decision → NOW
  if (item.id.startsWith('a1-proposal')) return 'NOW'
  if (item.titleKey === 'PROPOSAL_AWAITING_DECISION') return 'NOW'

  // Execution not confirmed → NOW
  if (item.id.startsWith('a2-execution')) return 'NOW'

  // Overdue deliverables → NOW (severity=red means overdue)
  if (item.id.startsWith('a4-deliverable') && item.severity === 'red') return 'NOW'

  // Anything the engine marked as red severity and action surface → NOW
  if (item.surface === 'action' && item.severity === 'red') return 'NOW'

  // Ideas not simulated → SOON
  if (item.id.startsWith('a3-unsimulated')) return 'SOON'
  if (item.titleKey === 'IDEA_NOT_SIMULATED') return 'SOON'

  // Thesis stale → SOON
  if (item.id.startsWith('thesis-stale')) return 'SOON'
  if (item.titleKey === 'THESIS_STALE') return 'SOON'

  // Rating change → SOON (needs follow-up)
  if (item.id.startsWith('i1-rating')) return 'SOON'

  // Orange deliverables (due soon but not overdue) → SOON
  if (item.id.startsWith('a4-deliverable') && item.severity === 'orange') return 'SOON'

  // Medium severity action items → SOON
  if (item.surface === 'action' && item.severity === 'orange') return 'SOON'

  // Intel surface items → AWARE
  if (item.surface === 'intel') return 'AWARE'

  // Default
  return 'SOON'
}

function assignBandFromAttention(item: AttentionItem): DashboardBand {
  if (item.attention_type === 'decision_required') return 'NOW'
  if (item.status === 'blocked') return 'NOW'
  if (item.severity === 'critical' || item.severity === 'high') {
    if (item.due_at && new Date(item.due_at) < new Date()) return 'NOW'
  }
  if (item.attention_type === 'action_required') return 'SOON'
  if (item.attention_type === 'alignment') return 'AWARE'
  return 'AWARE'
}

// ---------------------------------------------------------------------------
// Severity assignment
// ---------------------------------------------------------------------------

function assignSeverityFromEngine(item: DecisionItem, type: DashboardItemType, ageDays: number): DashboardSeverity {
  // Proposals: age-based
  if (type === 'DECISION' && (item.id.startsWith('a1-') || item.titleKey === 'PROPOSAL_AWAITING_DECISION')) {
    if (ageDays >= DECISION_HIGH_DAYS) return 'HIGH'
    if (ageDays >= DECISION_MED_DAYS) return 'MED'
    return 'LOW'
  }

  // Execution not confirmed: age-based
  if (item.id.startsWith('a2-execution')) {
    if (ageDays >= EXECUTION_HIGH_DAYS) return 'HIGH'
    if (ageDays >= EXECUTION_MED_DAYS) return 'MED'
    return 'LOW'
  }

  // Overdue deliverables are always HIGH
  if (type === 'PROJECT' && item.severity === 'red') return 'HIGH'
  if (type === 'PROJECT' && item.severity === 'orange') return 'MED'

  // Thesis stale: age-based
  if (type === 'THESIS') {
    if (ageDays >= THESIS_HIGH_DAYS) return 'HIGH'
    if (ageDays >= THESIS_MED_DAYS) return 'MED'
    return 'LOW'
  }

  // Rating change: recency-based (recent = more urgent)
  if (type === 'RATING') {
    if (ageDays <= RATING_MED_DAYS) return 'MED'
    return 'LOW'
  }

  // Ideas not simulated
  if (type === 'SIMULATION') {
    if (ageDays >= SIMULATION_MED_DAYS) return 'MED'
    return 'LOW'
  }

  // Fallback from engine severity
  if (item.severity === 'red') return 'HIGH'
  if (item.severity === 'orange') return 'MED'
  return 'LOW'
}

function assignSeverityFromAttention(item: AttentionItem): DashboardSeverity {
  if (item.severity === 'critical' || item.severity === 'high') return 'HIGH'
  if (item.severity === 'medium') return 'MED'
  return 'LOW'
}

// ---------------------------------------------------------------------------
// Age computation
// ---------------------------------------------------------------------------

function computeAge(dateStr: string | undefined, now: Date): number {
  if (!dateStr) return 0
  return Math.max(0, Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86400000))
}

// ---------------------------------------------------------------------------
// Context chip extraction
// ---------------------------------------------------------------------------

function extractChips(item: DecisionItem): string[] {
  const chips: string[] = []
  if (item.context.portfolioName) chips.push(item.context.portfolioName)
  if (item.context.assetTicker) chips.push(item.context.assetTicker)
  const age = computeAge(item.createdAt, new Date())
  if (age > 0) chips.push(`${age}d`)
  return chips
}

function extractChipsFromAttention(item: AttentionItem, now: Date): string[] {
  const chips: string[] = []
  if (item.subtitle) chips.push(item.subtitle)
  if (item.due_at) {
    const due = new Date(item.due_at)
    if (due < now) {
      const overdueDays = computeAge(item.due_at, now)
      chips.push(`${overdueDays}d overdue`)
    } else {
      const daysUntil = Math.ceil((due.getTime() - now.getTime()) / 86400000)
      chips.push(`due ${daysUntil}d`)
    }
  }
  const age = computeAge(item.created_at, now)
  if (age > 0) chips.push(`${age}d`)
  return chips
}

// ---------------------------------------------------------------------------
// Primary action factory
// ---------------------------------------------------------------------------

function buildPrimaryAction(
  item: DecisionItem,
  type: DashboardItemType,
  navigate: NavigateFn,
): { label: string; onClick: () => void } {
  switch (type) {
    case 'DECISION':
      if (item.id.startsWith('a1-proposal') || item.titleKey === 'PROPOSAL_AWAITING_DECISION') {
        return {
          label: 'Review',
          onClick: () => navigate({
            type: 'trade-queue',
            id: 'trade-queue',
            title: 'Trade Queue',
            data: { selectedTradeId: item.context.tradeIdeaId },
          }),
        }
      }
      if (item.id.startsWith('a2-execution')) {
        return {
          label: 'Confirm',
          onClick: () => navigate({
            type: 'trade-queue',
            id: 'trade-queue',
            title: 'Trade Queue',
            data: { selectedTradeId: item.context.tradeIdeaId },
          }),
        }
      }
      return {
        label: 'Open',
        onClick: () => {
          if (item.context.tradeIdeaId) {
            navigate({ type: 'trade-queue', id: 'trade-queue', title: 'Trade Queue', data: { selectedTradeId: item.context.tradeIdeaId } })
          }
        },
      }

    case 'SIMULATION':
      return {
        label: 'Simulate',
        onClick: () => navigate({
          type: 'trade-lab',
          id: 'trade-lab',
          title: 'Trade Lab',
          data: { assetId: item.context.assetId },
        }),
      }

    case 'THESIS':
      return {
        label: 'Update',
        onClick: () => {
          navigate({
            type: 'asset',
            id: item.context.assetId ?? '',
            title: item.context.assetTicker ?? 'Asset',
            data: { id: item.context.assetId, symbol: item.context.assetTicker },
          })
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('actionloop-edit-thesis', {
              detail: { assetId: item.context.assetId },
            }))
          }, 500)
        },
      }

    case 'PROJECT':
      return {
        label: 'Open',
        onClick: () => navigate({
          type: 'project',
          id: item.context.projectId ?? '',
          title: 'Project',
          data: { id: item.context.projectId },
        }),
      }

    case 'RATING':
      return {
        label: 'Create Idea',
        onClick: () => {
          window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
            detail: {
              contextType: 'asset',
              contextId: item.context.assetId,
              contextTitle: item.context.assetTicker,
              captureType: 'trade_idea',
            },
          }))
        },
      }

    case 'SIGNAL':
      return {
        label: 'View',
        onClick: () => {
          if (item.context.assetId) {
            navigate({
              type: 'asset',
              id: item.context.assetId,
              title: item.context.assetTicker ?? 'Asset',
              data: { id: item.context.assetId, symbol: item.context.assetTicker },
            })
          }
        },
      }

    default:
      return {
        label: 'Open',
        onClick: () => {
          const cta = item.ctas[0]
          if (cta) {
            const { dispatchDecisionAction } = require('../../engine/decisionEngine')
            dispatchDecisionAction(cta.actionKey, { ...item.context, ...cta.payload })
          }
        },
      }
  }
}

function buildAttentionPrimaryAction(
  item: AttentionItem,
  type: DashboardItemType,
  navigate: NavigateFn,
): { label: string; onClick: () => void } {
  if (type === 'DECISION') {
    return {
      label: 'Review',
      onClick: () => navigate({
        type: 'trade-queue',
        id: 'trade-queue',
        title: 'Trade Queue',
        data: { selectedTradeId: item.source_id },
      }),
    }
  }
  if (type === 'PROJECT') {
    return {
      label: 'Open',
      onClick: () => navigate({
        type: 'project',
        id: item.context?.project_id ?? item.source_id,
        title: item.title,
        data: { id: item.context?.project_id ?? item.source_id },
      }),
    }
  }
  return {
    label: 'Open',
    onClick: () => {
      if (item.context?.asset_id) {
        navigate({
          type: 'asset',
          id: item.context.asset_id,
          title: item.title,
          data: { id: item.context.asset_id },
        })
      } else if (item.context?.project_id) {
        navigate({
          type: 'project',
          id: item.context.project_id,
          title: item.title,
          data: { id: item.context.project_id },
        })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Snooze action (secondary)
// ---------------------------------------------------------------------------

function buildSnoozeAction(
  itemId: string,
  onSnooze: (itemId: string, hours: number) => void,
): { label: string; onClick: () => void } {
  return {
    label: 'Defer 1d',
    onClick: () => onSnooze(itemId, 24),
  }
}

// ---------------------------------------------------------------------------
// Map a single DecisionItem → DashboardItem
// ---------------------------------------------------------------------------

export function mapDecisionItem(
  item: DecisionItem,
  navigate: NavigateFn,
  onSnooze: (id: string, hours: number) => void,
  now: Date = new Date(),
): DashboardItem {
  const type = inferType(item)
  const age = computeAge(item.createdAt, now)
  const band = assignBandFromEngine(item, type)
  const severity = assignSeverityFromEngine(item, type, age)
  const primaryAction = buildPrimaryAction(item, type, navigate)

  // Build structured meta from context
  const meta: import('../../types/dashboard-item').DashboardItemMeta = {}
  if (item.context.action) meta.action = item.context.action
  if (item.context.urgency) meta.urgency = item.context.urgency
  if (item.context.rationale) meta.rationale = item.context.rationale
  if (item.context.projectName) meta.projectName = item.context.projectName
  if (item.context.overdueDays != null) meta.overdueDays = item.context.overdueDays
  if (item.context.ratingFrom) meta.ratingFrom = item.context.ratingFrom
  if (item.context.ratingTo) meta.ratingTo = item.context.ratingTo

  return {
    id: item.id,
    band,
    severity,
    type,
    title: item.title,
    reason: item.description,
    ageDays: age,
    createdAt: item.createdAt,
    portfolio: item.context.portfolioId
      ? { id: item.context.portfolioId, name: item.context.portfolioName ?? '' }
      : undefined,
    asset: item.context.assetId
      ? { id: item.context.assetId, ticker: item.context.assetTicker ?? '' }
      : undefined,
    owner: undefined, // Engine items don't carry owner metadata
    meta: Object.keys(meta).length > 0 ? meta : undefined,
    contextChips: extractChips(item),
    primaryAction,
    secondaryActions: [buildSnoozeAction(item.id, onSnooze)],
  }
}

// ---------------------------------------------------------------------------
// Map a single AttentionItem → DashboardItem
// ---------------------------------------------------------------------------

export function mapAttentionItem(
  item: AttentionItem,
  navigate: NavigateFn,
  onSnooze: (id: string, hours: number) => void,
  now: Date = new Date(),
): DashboardItem {
  const type = inferTypeFromAttention(item)
  const band = assignBandFromAttention(item)
  const severity = assignSeverityFromAttention(item)
  const primaryAction = buildAttentionPrimaryAction(item, type, navigate)

  return {
    id: `attn-${item.attention_id}`,
    band,
    severity,
    type,
    title: item.title,
    reason: item.reason_text,
    ageDays: computeAge(item.created_at, now),
    createdAt: item.created_at,
    portfolio: item.context?.portfolio_id
      ? { id: item.context.portfolio_id, name: '' }
      : undefined,
    asset: item.context?.asset_id
      ? { id: item.context.asset_id, ticker: item.subtitle ?? '' }
      : undefined,
    owner: item.primary_owner_user_id
      ? { name: undefined, role: undefined } // ID available; name resolved at render
      : undefined,
    contextChips: extractChipsFromAttention(item, now),
    primaryAction,
    secondaryActions: [buildSnoozeAction(`attn-${item.attention_id}`, onSnooze)],
  }
}

// ---------------------------------------------------------------------------
// Merge + dedup from both sources
// ---------------------------------------------------------------------------

export function mapAllToDashboardItems(
  engineAction: DecisionItem[],
  engineIntel: DecisionItem[],
  attentionItems: AttentionItem[],
  navigate: NavigateFn,
  onSnooze: (id: string, hours: number) => void,
  portfolioFilter: string | null,
): DashboardItem[] {
  const now = new Date()
  const items: DashboardItem[] = []

  // Flatten rollup children from engine
  const flatEngine: DecisionItem[] = []
  for (const item of [...engineAction, ...engineIntel]) {
    if (item.children?.length) {
      flatEngine.push(...item.children)
    } else {
      flatEngine.push(item)
    }
  }

  // Map engine items (apply portfolio filter)
  for (const item of flatEngine) {
    if (portfolioFilter && item.context.portfolioId && item.context.portfolioId !== portfolioFilter) {
      continue
    }
    items.push(mapDecisionItem(item, navigate, onSnooze, now))
  }

  // Track engine deliverable IDs for dedup
  const engineDeliverableIds = new Set<string>()
  for (const item of flatEngine) {
    if (item.id.startsWith('a4-deliverable') && item.context.projectId) {
      engineDeliverableIds.add(item.context.projectId)
    }
  }

  // Map attention items (skip trade_queue_item — engine handles those)
  const skipSourceTypes = new Set(['trade_queue_item'])
  for (const item of attentionItems) {
    if (skipSourceTypes.has(item.source_type)) continue
    if (item.source_type === 'project_deliverable' && engineDeliverableIds.has(item.source_id)) continue
    if (portfolioFilter && item.context?.portfolio_id && item.context.portfolio_id !== portfolioFilter) continue
    items.push(mapAttentionItem(item, navigate, onSnooze, now))
  }

  return items
}

// ---------------------------------------------------------------------------
// Split items by band
// ---------------------------------------------------------------------------

export function splitByBand(items: DashboardItem[]): {
  now: DashboardItem[]
  soon: DashboardItem[]
  aware: DashboardItem[]
} {
  const now: DashboardItem[] = []
  const soon: DashboardItem[] = []
  const aware: DashboardItem[] = []

  for (const item of items) {
    switch (item.band) {
      case 'NOW': now.push(item); break
      case 'SOON': soon.push(item); break
      case 'AWARE': aware.push(item); break
    }
  }

  // Sort within bands
  const sevRank = { HIGH: 3, MED: 2, LOW: 1 }
  now.sort((a, b) => {
    const sd = sevRank[b.severity] - sevRank[a.severity]
    if (sd !== 0) return sd
    return (b.ageDays ?? 0) - (a.ageDays ?? 0)
  })
  soon.sort((a, b) => {
    const sd = sevRank[b.severity] - sevRank[a.severity]
    if (sd !== 0) return sd
    return (b.ageDays ?? 0) - (a.ageDays ?? 0)
  })
  aware.sort((a, b) => {
    // Newest first
    if (a.createdAt && b.createdAt) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
    return 0
  })

  return { now, soon, aware }
}

// ---------------------------------------------------------------------------
// Today summary computation
// ---------------------------------------------------------------------------

export interface DecisionLoadSummary {
  decisions: number
  workItems: number
  riskSignals: number
}

export function computeTodaySummary(bands: {
  now: DashboardItem[]
  soon: DashboardItem[]
  aware: DashboardItem[]
}): DecisionLoadSummary {
  const all = [...bands.now, ...bands.soon, ...bands.aware]
  let decisions = 0
  let workItems = 0
  let riskSignals = 0

  for (const item of all) {
    if (item.type === 'DECISION') decisions++
    else if (item.type === 'SIGNAL' || item.type === 'RATING') riskSignals++
    else workItems++
  }

  return { decisions, workItems, riskSignals }
}

// ---------------------------------------------------------------------------
// Band summary computation
// ---------------------------------------------------------------------------

export function computeBandSummary(
  band: DashboardBand,
  items: DashboardItem[],
): DashboardBandSummary {
  let oldestAgeDays = 0
  const typeCounts = new Map<DashboardItemType, number>()

  for (const item of items) {
    if ((item.ageDays ?? 0) > oldestAgeDays) oldestAgeDays = item.ageDays ?? 0
    typeCounts.set(item.type, (typeCounts.get(item.type) ?? 0) + 1)
  }

  const TYPE_LABELS: Record<DashboardItemType, string> = {
    DECISION: 'decisions',
    SIMULATION: 'simulations',
    PROJECT: 'projects',
    THESIS: 'thesis',
    RATING: 'ratings',
    SIGNAL: 'signals',
    OTHER: 'other',
  }

  const breakdownChips = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ label: TYPE_LABELS[type], count }))

  return { band, count: items.length, oldestAgeDays, breakdownChips }
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export function groupItems(
  items: DashboardItem[],
  groupBy: DashboardGroupBy,
): DashboardGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: '', items }]
  }

  const groups = new Map<string, DashboardItem[]>()

  for (const item of items) {
    let key: string
    let label: string

    if (groupBy === 'portfolio') {
      key = item.portfolio?.id ?? 'none'
      label = item.portfolio?.name || 'No Portfolio'
    } else {
      // groupBy === 'type'
      key = item.type
      const TYPE_LABELS: Record<DashboardItemType, string> = {
        DECISION: 'Decisions',
        SIMULATION: 'Simulations',
        PROJECT: 'Projects',
        THESIS: 'Thesis',
        RATING: 'Ratings',
        SIGNAL: 'Signals',
        OTHER: 'Other',
      }
      label = TYPE_LABELS[item.type]
    }

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }

  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    label: groupBy === 'portfolio'
      ? (items[0]?.portfolio?.name || 'No Portfolio')
      : key.charAt(0) + key.slice(1).toLowerCase(),
    items,
  }))
}

// ---------------------------------------------------------------------------
// Urgent-only filter
// ---------------------------------------------------------------------------

export function filterUrgent(items: DashboardItem[]): DashboardItem[] {
  return items.filter(i => i.band === 'NOW' || (i.band === 'SOON' && i.severity === 'HIGH'))
}
