/**
 * Adapters — Convert engine + attention items into AttentionFeedItem[].
 *
 * Two source systems:
 *   1. Global Decision Engine (DecisionItem) — primary for trade/research signals
 *   2. Attention System (AttentionItem) — primary for project/notification/team
 *
 * Dedup: engine items take priority for trade_queue_item sources.
 */

import type { DecisionItem } from '../../engine/decisionEngine/types'
import type { AttentionItem } from '../../types/attention'
import type {
  AttentionFeedItem,
  AttentionFeedSeverity,
  AttentionFeedItemType,
  AttentionFeedSource,
  AttentionFeedAction,
} from '../../types/attention-feed'
import { assignBand } from './bandAssignment'

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

function mapDecisionSeverity(sev: string): AttentionFeedSeverity {
  switch (sev) {
    case 'red': return 'high'
    case 'orange': return 'medium'
    case 'blue': return 'low'
    case 'gray': return 'low'
    default: return 'low'
  }
}

function mapAttentionSeverity(sev: string): AttentionFeedSeverity {
  switch (sev) {
    case 'critical': return 'high'
    case 'high': return 'high'
    case 'medium': return 'medium'
    case 'low': return 'low'
    default: return 'low'
  }
}

// ---------------------------------------------------------------------------
// Type mapping from engine item IDs / titleKeys
// ---------------------------------------------------------------------------

function inferFeedType(item: DecisionItem): AttentionFeedItemType {
  if (item.id.startsWith('a1-proposal')) return 'proposal'
  if (item.id.startsWith('a2-execution')) return 'execution'
  if (item.id.startsWith('a3-unsimulated')) return 'simulation'
  if (item.id.startsWith('a4-deliverable')) return 'deliverable'
  if (item.id.startsWith('i1-rating')) return 'risk'
  if (item.id.startsWith('i3-ev')) return 'signal'
  if (item.id.startsWith('thesis-stale')) return 'thesis'
  if (item.id.startsWith('rollup-')) {
    const key = item.titleKey
    if (key === 'PROPOSAL_AWAITING_DECISION') return 'proposal'
    if (key === 'IDEA_NOT_SIMULATED') return 'simulation'
    if (key === 'THESIS_STALE') return 'thesis'
  }
  if (item.category === 'catalyst') return 'signal'
  if (item.category === 'prompt') return 'prompt'
  return 'signal'
}

function inferFeedSource(item: DecisionItem): AttentionFeedSource {
  const type = inferFeedType(item)
  switch (type) {
    case 'proposal':
    case 'simulation':
    case 'execution':
      return 'trade_queue'
    case 'deliverable':
    case 'project':
      return 'projects'
    case 'thesis':
    case 'risk':
      return 'research'
    default:
      return 'monitoring'
  }
}

// ---------------------------------------------------------------------------
// Age computation
// ---------------------------------------------------------------------------

function ageDays(dateStr: string | undefined, now: Date): number {
  if (!dateStr) return 0
  return Math.max(0, Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86400000))
}

function isOverdue(dueAt: string | null | undefined, now: Date): boolean {
  if (!dueAt) return false
  return new Date(dueAt) < now
}

function isDueSoon(dueAt: string | null | undefined, now: Date): boolean {
  if (!dueAt) return false
  const due = new Date(dueAt)
  if (due < now) return false // already overdue, not "soon"
  const daysUntil = (due.getTime() - now.getTime()) / 86400000
  return daysUntil <= 7
}

// ---------------------------------------------------------------------------
// Convert DecisionItem → AttentionFeedItem
// ---------------------------------------------------------------------------

export function adaptDecisionItem(
  item: DecisionItem,
  now: Date = new Date(),
): AttentionFeedItem {
  const feedType = inferFeedType(item)
  const severity = mapDecisionSeverity(item.severity)

  // Overdue detection from chips
  const overdueChip = item.chips?.find(c =>
    c.label.toLowerCase() === 'overdue',
  )
  const overdue = !!overdueChip
  const dueSoon = false // engine items don't track due dates directly

  const requiresDecision = feedType === 'proposal' || feedType === 'suggestion'
  const blocking = item.severity === 'red' && feedType === 'execution'

  const actions: AttentionFeedAction[] = item.ctas.map(cta => ({
    label: cta.label,
    intent: cta.actionKey,
    variant: cta.kind === 'primary' ? 'primary' as const : 'secondary' as const,
    payload: cta.payload,
  }))

  // Add defer overflow action
  actions.push({
    label: 'Defer',
    intent: 'SNOOZE',
    variant: 'overflow',
  })

  const feedItem: AttentionFeedItem = {
    id: item.id,
    type: feedType,
    title: item.title,
    description: item.description,
    severity,
    band: 'now', // placeholder — will be reassigned
    source: inferFeedSource(item),
    related: {
      assetId: item.context.assetId,
      assetTicker: item.context.assetTicker,
      portfolioId: item.context.portfolioId,
      portfolioName: item.context.portfolioName,
      tradeIdeaId: item.context.tradeIdeaId,
      proposalId: item.context.proposalId,
      projectId: item.context.projectId,
    },
    ageDays: ageDays(item.createdAt, now),
    createdAt: item.createdAt ?? now.toISOString(),
    updatedAt: item.createdAt ?? now.toISOString(),
    dueAt: null,
    owner: {},
    actions,
    chips: item.chips ?? [],
    overdue,
    dueSoon,
    requiresDecision,
    blocking,
    _sortScore: item.sortScore,
    _sourceSystem: 'decision_engine',
    _children: item.children?.map(c => adaptDecisionItem(c, now)),
  }

  feedItem.band = assignBand(feedItem)
  return feedItem
}

// ---------------------------------------------------------------------------
// Convert AttentionItem → AttentionFeedItem
// ---------------------------------------------------------------------------

function inferAttentionFeedType(item: AttentionItem): AttentionFeedItemType {
  switch (item.source_type) {
    case 'trade_queue_item': return 'proposal'
    case 'project_deliverable': return 'deliverable'
    case 'project': return 'project'
    case 'list_suggestion': return 'suggestion'
    case 'notification': return 'notification'
    case 'quick_thought': return 'prompt'
    default:
      if (item.attention_type === 'alignment') return 'alignment'
      return 'notification'
  }
}

function inferAttentionSource(item: AttentionItem): AttentionFeedSource {
  switch (item.source_type) {
    case 'trade_queue_item': return 'trade_queue'
    case 'project_deliverable':
    case 'project':
      return 'projects'
    case 'notification': return 'notifications'
    case 'quick_thought': return 'research'
    default:
      if (item.attention_type === 'alignment') return 'team'
      return 'notifications'
  }
}

export function adaptAttentionItem(
  item: AttentionItem,
  now: Date = new Date(),
): AttentionFeedItem {
  const feedType = inferAttentionFeedType(item)
  const severity = mapAttentionSeverity(item.severity)
  const overdue = isOverdue(item.due_at, now)
  const dueSoon = isDueSoon(item.due_at, now)
  const requiresDecision = item.attention_type === 'decision_required'
  const blocking = item.status === 'blocked'

  // Build actions based on type
  const actions: AttentionFeedAction[] = []

  if (feedType === 'proposal') {
    actions.push({
      label: 'Review',
      intent: 'OPEN_TRADE_QUEUE_PROPOSAL',
      variant: 'primary',
      payload: { tradeIdeaId: item.source_id },
    })
  } else if (feedType === 'deliverable' || feedType === 'project') {
    actions.push({
      label: 'Open',
      intent: 'OPEN_PROJECT',
      variant: 'primary',
      payload: { projectId: item.context?.project_id ?? item.source_id },
    })
  } else if (feedType === 'suggestion') {
    actions.push({
      label: 'Review',
      intent: 'NAV_LIST',
      variant: 'primary',
      route: `/list/${item.context?.list_id}`,
      payload: { listId: item.context?.list_id },
    })
  } else {
    actions.push({
      label: 'Open',
      intent: 'NAV_SOURCE',
      variant: 'primary',
      route: item.source_url,
    })
  }

  actions.push({
    label: 'Defer',
    intent: 'SNOOZE',
    variant: 'overflow',
  })

  if (feedType === 'deliverable') {
    actions.push({
      label: 'Mark done',
      intent: 'MARK_DELIVERABLE_DONE',
      variant: 'overflow',
      payload: { deliverableId: item.source_id },
    })
  }

  actions.push({
    label: 'Copy link',
    intent: 'COPY_LINK',
    variant: 'overflow',
    payload: { url: item.source_url },
  })

  // Build chips
  const chips: { label: string; value: string }[] = []
  if (item.context?.asset_id) {
    chips.push({ label: 'Asset', value: item.subtitle ?? '' })
  }
  if (item.context?.portfolio_id) {
    chips.push({ label: 'Portfolio', value: item.subtitle ?? '' })
  }
  if (item.due_at) {
    if (overdue) {
      const overdueDays = ageDays(item.due_at, now)
      chips.push({ label: 'Overdue', value: `${overdueDays}d` })
    } else if (dueSoon) {
      const daysUntil = Math.ceil((new Date(item.due_at).getTime() - now.getTime()) / 86400000)
      chips.push({ label: 'Due', value: `${daysUntil}d` })
    }
  }
  const itemAge = ageDays(item.created_at, now)
  if (itemAge > 0) {
    chips.push({ label: 'Age', value: `${itemAge}d` })
  }

  const feedItem: AttentionFeedItem = {
    id: `attn-${item.attention_id}`,
    type: feedType,
    title: item.title,
    description: item.reason_text,
    severity,
    band: 'soon', // placeholder
    source: inferAttentionSource(item),
    related: {
      assetId: item.context?.asset_id ?? undefined,
      portfolioId: item.context?.portfolio_id ?? undefined,
      projectId: item.context?.project_id ?? undefined,
      deliverableId: feedType === 'deliverable' ? item.source_id : undefined,
    },
    ageDays: itemAge,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    dueAt: item.due_at ?? null,
    owner: {
      userId: item.primary_owner_user_id ?? undefined,
    },
    actions,
    chips: chips.filter(c => c.value),
    overdue,
    dueSoon,
    requiresDecision,
    blocking,
    _sortScore: item.score,
    _sourceSystem: 'attention_system',
  }

  feedItem.band = assignBand(feedItem)
  return feedItem
}

// ---------------------------------------------------------------------------
// Merge + dedup
// ---------------------------------------------------------------------------

/**
 * Merge items from both systems, deduplicating trade_queue_item overlap.
 *
 * Strategy:
 *   - Engine items always included (they have richer CTAs)
 *   - Attention items with source_type='trade_queue_item' are skipped
 *     (engine already covers proposals/executions)
 *   - Attention items with source_type='project_deliverable' are skipped
 *     if the engine already has a matching deliverable item
 */
export function mergeAndDedup(
  engineItems: AttentionFeedItem[],
  attentionItems: AttentionFeedItem[],
): AttentionFeedItem[] {
  // Collect engine deliverable IDs for dedup
  const engineDeliverableIds = new Set<string>()
  for (const item of engineItems) {
    if (item.type === 'deliverable' && item.related.deliverableId) {
      engineDeliverableIds.add(item.related.deliverableId)
    }
  }

  const merged = [...engineItems]

  for (const item of attentionItems) {
    // Skip if engine already covers this deliverable
    if (
      item.type === 'deliverable' &&
      item.related.deliverableId &&
      engineDeliverableIds.has(item.related.deliverableId)
    ) {
      continue
    }
    merged.push(item)
  }

  return merged
}
