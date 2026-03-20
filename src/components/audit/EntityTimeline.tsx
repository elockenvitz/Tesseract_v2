/**
 * EntityTimeline Component
 *
 * Displays a chronological timeline of audit events for an entity.
 * Supports merging trade_events (proposal lifecycle) alongside audit_events
 * for a unified investment process history.
 *
 * Features:
 * - Date grouping (Today / Yesterday / Mar 14)
 * - Stage-change noise reduction (collapses rapid consecutive moves)
 * - Investment-specific event labels and iconography
 * - Proposal/recommendation events from trade_events table
 */

import { useState, useMemo } from 'react'
import {
  Trash2,
  RotateCcw,
  ArrowRight,
  CheckCircle2,
  Edit2,
  Star,
  Target,
  UserPlus,
  UserMinus,
  Archive,
  Link2,
  Unlink,
  Activity,
  Sparkles,
  Scale,
  FileText,
  Gavel,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useEntityAuditEvents } from '../../hooks/useAuditEvents'
import type { EntityType, AuditEvent } from '../../lib/audit'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unified timeline item — either an audit event or a synthesized trade event */
interface TimelineItem {
  id: string
  occurred_at: string
  action_type: string
  actor_name: string | null
  actor_email: string | null
  summary: string
  /** Additional detail lines (e.g. weight change, legs, sizing mode) */
  detail?: string | null
  /** For collapsed events (stage changes, recommendation adjustments) */
  collapsed_count?: number
  /** Portfolio scope — used for recommendation collapse grouping */
  portfolio_id?: string | null
  /** Portfolio name for display */
  portfolio_name?: string | null
  /** Recommendation weight (for collapse logic) */
  rec_weight?: number | null
}

interface TradeEventRow {
  id: string
  event_type: string
  actor_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  users?: { first_name: string | null; last_name: string | null; email: string } | null
}

interface EntityTimelineProps {
  entityType: EntityType
  entityId: string
  className?: string
  maxItems?: number
  showHeader?: boolean
  collapsible?: boolean
  excludeActions?: string[]
  groupByDate?: boolean
  /** Trade events (proposal_created, proposal_updated, etc.) to merge into timeline */
  tradeEvents?: TradeEventRow[]
}

// ---------------------------------------------------------------------------
// Icon & color mapping
// ---------------------------------------------------------------------------

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  create: Sparkles,
  delete: Trash2,
  restore: RotateCcw,
  move_stage: ArrowRight,
  move_stage_collapsed: ArrowRight,
  set_outcome: CheckCircle2,
  update: Edit2,
  update_field: Edit2,
  update_fields: Edit2,
  set_rating: Star,
  set_price_target: Target,
  assign_coverage: UserPlus,
  remove_coverage: UserMinus,
  auto_archive: Archive,
  attach: Link2,
  detach: Unlink,
  proposal_created: Scale,
  proposal_updated: Scale,
  note_added: FileText,
  debate_event: Gavel,
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  restore: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  move_stage: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  move_stage_collapsed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  set_outcome: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  update: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  update_field: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  update_fields: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  auto_archive: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  proposal_created: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
  proposal_updated: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
  note_added: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  debate_event: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
}

// ---------------------------------------------------------------------------
// Field label mapping — makes update events human-readable
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  rationale: 'rationale',
  why_now: 'Why Now',
  conviction: 'conviction',
  urgency: 'urgency',
  action: 'trade action',
  thesis: 'thesis',
  risk_notes: 'risk context',
  notes: 'notes',
  catalyst: 'catalyst',
  time_horizon: 'time horizon',
  price_target: 'price target',
  stop_loss: 'stop loss',
  target_weight: 'target weight',
  proposed_weight: 'proposed weight',
  proposed_shares: 'proposed shares',
  stage: 'stage',
  status: 'status',
  assigned_to: 'assignee',
  tags: 'tags',
  context_tags: 'context tags',
  layout_id: 'layout',
  field_overrides: 'field customization',
  section_overrides: 'section layout',
  reference_levels: 'reference levels',
  asset_id: 'asset',
  portfolio_id: 'portfolio',
  visibility_tier: 'visibility',
  sharing_visibility: 'visibility',
  collaborators: 'collaborators',
}

/** Fields to suppress from "updated X" messages — they are noise */
const SUPPRESSED_FIELDS = new Set([
  'layout_id', 'field_overrides', 'section_overrides', 'visibility_tier',
  'deleted_at', 'deleted_by', 'archived_at',
])

function humanizeFieldName(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  return field.replace(/_/g, ' ')
}

function humanizeFieldList(fields: string[]): string {
  // Filter out suppressed/noise fields
  const meaningful = fields.filter(f => !SUPPRESSED_FIELDS.has(f))
  if (meaningful.length === 0) return 'idea details'
  const labels = meaningful.map(humanizeFieldName)
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

// ---------------------------------------------------------------------------
// Stage label helper
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  idea: 'Idea',
  aware: 'Aware',
  investigate: 'Investigate',
  deep_research: 'Deep Research',
  thesis_forming: 'Thesis Forming',
  ready_for_decision: 'Ready for Decision',
  discussing: 'Discussing',
  working_on: 'Working On',
  simulating: 'Simulating',
  modeling: 'Modeling',
  deciding: 'Deciding',
  approved: 'Approved',
}

function getStageLabel(stage: string | undefined): string {
  if (!stage) return 'unknown'
  return STAGE_LABELS[stage] || stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

function formatFullTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatTimeOnly(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getDateGroupLabel(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor((today.getTime() - eventDay.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

// ---------------------------------------------------------------------------
// Audit event → TimelineItem
// ---------------------------------------------------------------------------

function auditEventToSummary(event: AuditEvent): string {
  const actor = event.actor_name?.split(' ')[0] || event.actor_email?.split('@')[0] || null

  switch (event.action_type) {
    case 'create': {
      // Check for counter-view creation
      const meta = event.metadata as Record<string, unknown> | undefined
      if (meta?.counter_view_of) {
        return actor ? `${actor} created counter-view` : 'Counter-view created'
      }
      return actor ? `${actor} created this idea` : 'Idea created'
    }
    case 'delete': {
      const meta = event.metadata as Record<string, unknown> | undefined
      if (meta?.debate_action === 'remove') {
        const debateLabel = (meta.debate_label as string) || 'argument'
        return actor ? `${actor} removed ${debateLabel}` : `Removed ${debateLabel}`
      }
      return actor ? `${actor} moved to trash` : 'Moved to trash'
    }
    case 'restore':
      return actor ? `${actor} restored from trash` : 'Restored from trash'
    case 'move_stage': {
      const toStage = event.to_state?.stage || event.to_state?.workflow_stage || event.to_state?.status
      const label = getStageLabel(toStage)
      return actor ? `${actor} moved stage → ${label}` : `Moved stage → ${label}`
    }
    case 'set_outcome': {
      const outcome = event.to_state?.outcome || event.to_state?.workflow_outcome
      const OUTCOMES: Record<string, string> = { executed: 'Executed', rejected: 'Rejected', deferred: 'Deferred', accepted: 'Committed' }
      const label = OUTCOMES[outcome] || outcome
      return actor ? `${actor} marked as ${label}` : `Marked as ${label}`
    }
    case 'update':
    case 'update_field':
    case 'update_fields': {
      // Check for debate events (thesis CRUD)
      const meta = event.metadata as Record<string, unknown> | undefined
      if (meta?.debate_action) {
        const debateLabel = (meta.debate_label as string) || 'argument'
        const debateAction = meta.debate_action as string
        if (debateAction === 'add') {
          return actor ? `${actor} added ${debateLabel}` : `Added ${debateLabel}`
        }
        if (debateAction === 'update') {
          return actor ? `${actor} updated ${debateLabel}` : `Updated ${debateLabel}`
        }
      }

      const fields = event.changed_fields
      if (!fields || fields.length === 0) {
        return actor ? `${actor} updated idea details` : 'Idea details updated'
      }
      // Filter debate-prefixed fields (handled above) and suppressed fields
      const meaningful = fields.filter(f => !SUPPRESSED_FIELDS.has(f) && !f.startsWith('debate:'))
      if (meaningful.length === 0) {
        return actor ? `${actor} updated idea details` : 'Idea details updated'
      }
      const label = humanizeFieldList(meaningful)
      return actor ? `${actor} updated ${label}` : `Updated ${label}`
    }
    case 'set_rating':
      return actor ? `${actor} changed rating` : 'Rating changed'
    case 'set_price_target':
      return actor ? `${actor} updated price target` : 'Price target updated'
    case 'assign_coverage':
      return actor ? `${actor} assigned coverage` : 'Coverage assigned'
    case 'remove_coverage':
      return actor ? `${actor} removed coverage` : 'Coverage removed'
    case 'auto_archive':
      return 'Automatically archived'
    default: {
      // Handle lab-specific events
      if (event.action_type.startsWith('lab.')) {
        return actor ? `${actor} updated simulation` : 'Simulation updated'
      }
      return actor ? `${actor} updated idea details` : 'Idea details updated'
    }
  }
}

function auditEventToItem(event: AuditEvent): TimelineItem {
  // Remap debate events to distinct action type for icon/color mapping
  const meta = event.metadata as Record<string, unknown> | undefined
  let actionType = event.action_type
  if (meta?.debate_action) {
    actionType = 'debate_event'
  }

  return {
    id: event.id,
    occurred_at: event.occurred_at,
    action_type: actionType,
    actor_name: event.actor_name,
    actor_email: event.actor_email,
    summary: auditEventToSummary(event),
  }
}

// ---------------------------------------------------------------------------
// Trade event → TimelineItem
// ---------------------------------------------------------------------------

function tradeEventToItem(event: TradeEventRow): TimelineItem {
  const actor = event.users?.first_name || event.users?.email?.split('@')[0] || null
  const meta = event.metadata || {}
  const weight = meta.weight as number | undefined
  const previousWeight = meta.previous_weight as number | undefined
  const portfolioName = (meta.portfolio_name as string) || null
  const portfolioId = (meta.portfolio_id as string) || null
  const sizingMode = (meta.sizing_mode as string) || null
  const isPairTrade = !!(meta.is_pair_trade)
  const legs = (meta.legs as Array<{ symbol?: string; action?: string; weight?: number | null; sizingMode?: string; enteredValue?: string }>) || null

  const sizingModeLabel: Record<string, string> = { absolute: 'Absolute', add_reduce: 'Add / Reduce', active: 'Active vs Bench', weight: 'Absolute' }

  // Build leg summary for pair trades: "BUY LLY, PFE · SELL CLOV, GH"
  const buildLegSummary = () => {
    if (!legs || legs.length === 0) return ''
    const buys = legs.filter(l => l.action === 'buy' || l.action === 'add').map(l => l.symbol).filter(Boolean)
    const sells = legs.filter(l => l.action === 'sell' || l.action === 'reduce').map(l => l.symbol).filter(Boolean)
    const parts: string[] = []
    if (buys.length) parts.push(`BUY ${buys.join(', ')}`)
    if (sells.length) parts.push(`SELL ${sells.join(', ')}`)
    return parts.join(' · ')
  }

  let summary: string
  let detail: string | null = null

  switch (event.event_type) {
    case 'proposal_created': {
      summary = `${actor || 'Someone'} submitted recommendation`
      if (portfolioName) summary += ` for ${portfolioName}`
      // Build detail lines
      const detailParts: string[] = []
      if (isPairTrade && legs) {
        detailParts.push(buildLegSummary())
      } else if (weight != null) {
        detailParts.push(`Target: ${weight.toFixed(2)}%`)
      }
      if (sizingMode && sizingModeLabel[sizingMode]) {
        detailParts.push(`Mode: ${sizingModeLabel[sizingMode]}`)
      }
      detail = detailParts.filter(Boolean).join('\n') || null
      break
    }
    case 'proposal_updated': {
      summary = `${actor || 'Someone'} updated recommendation`
      if (portfolioName) summary += ` for ${portfolioName}`
      const detailParts: string[] = []
      // Show weight change if available
      if (isPairTrade && legs) {
        const changes = legs.filter(l => l.enteredValue).map(l => `${l.symbol}: ${l.enteredValue}%`).join(', ')
        if (changes) detailParts.push(changes)
      } else if (previousWeight != null && weight != null && previousWeight !== weight) {
        detailParts.push(`${previousWeight.toFixed(2)}% → ${weight.toFixed(2)}%`)
      } else if (weight != null) {
        detailParts.push(`Target: ${weight.toFixed(2)}%`)
      }
      if (sizingMode && sizingModeLabel[sizingMode]) {
        detailParts.push(`Mode: ${sizingModeLabel[sizingMode]}`)
      }
      detail = detailParts.filter(Boolean).join('\n') || null
      break
    }
    case 'proposal_withdrawn': {
      summary = `${actor || 'Someone'} withdrew recommendation`
      if (portfolioName) summary += ` for ${portfolioName}`
      if (weight != null) detail = `Was: ${weight.toFixed(2)}%`
      break
    }
    case 'note_added':
      summary = actor ? `${actor} added a note` : 'Note added'
      break
    default:
      summary = actor ? `${actor} updated trade` : 'Trade updated'
  }

  return {
    id: event.id,
    occurred_at: event.created_at,
    action_type: event.event_type,
    actor_name: event.users ? `${event.users.first_name || ''} ${event.users.last_name || ''}`.trim() : null,
    actor_email: event.users?.email || null,
    summary,
    detail,
    portfolio_id: portfolioId,
    portfolio_name: portfolioName,
    rec_weight: weight ?? null,
  }
}

// ---------------------------------------------------------------------------
// Noise reduction — collapses rapid stage changes and recommendation adjustments
// ---------------------------------------------------------------------------

const COLLAPSE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

function collapseNoisyEvents(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    // ── Stage-change collapsing ──────────────────────────────────────
    if (item.action_type === 'move_stage') {
      let j = i + 1
      while (
        j < items.length &&
        items[j].action_type === 'move_stage' &&
        items[j].actor_name === item.actor_name &&
        Math.abs(new Date(item.occurred_at).getTime() - new Date(items[j].occurred_at).getTime()) < COLLAPSE_WINDOW_MS
      ) {
        j++
      }

      const count = j - i
      if (count >= 3) {
        result.push({
          ...item,
          action_type: 'move_stage_collapsed',
          summary: `${item.actor_name?.split(' ')[0] || 'Someone'} moved through several stages → ${item.summary.split('→').pop()?.trim() || 'current'}`,
          collapsed_count: count,
        })
        i = j - 1
        continue
      }
    }

    // ── Recommendation-update collapsing ─────────────────────────────
    if (item.action_type === 'proposal_updated') {
      let j = i + 1
      while (
        j < items.length &&
        items[j].action_type === 'proposal_updated' &&
        items[j].actor_name === item.actor_name &&
        items[j].portfolio_id === item.portfolio_id &&
        Math.abs(new Date(item.occurred_at).getTime() - new Date(items[j].occurred_at).getTime()) < COLLAPSE_WINDOW_MS
      ) {
        j++
      }

      const count = j - i
      if (count >= 3) {
        // First item (desc order) = most recent = final weight
        // Last item in range = oldest = original weight
        const actor = item.actor_name?.split(' ')[0] || 'Someone'
        const finalWeight = item.rec_weight
        const originalWeight = items[j - 1].rec_weight
        const portfolioLabel = item.portfolio_name ? ` for ${item.portfolio_name}` : ''

        let weightLabel = ''
        if (originalWeight != null && finalWeight != null && originalWeight !== finalWeight) {
          weightLabel = ` (${originalWeight.toFixed(2)}% → ${finalWeight.toFixed(2)}%)`
        } else if (finalWeight != null) {
          weightLabel = ` → ${finalWeight.toFixed(2)}%`
        }

        result.push({
          ...item,
          action_type: 'proposal_updated',
          summary: `${actor} refined recommendation${weightLabel}${portfolioLabel}`,
          detail: `${count} adjustments`,
          collapsed_count: count,
        })
        i = j - 1
        continue
      }

      // For non-collapsed individual updates, add delta from next older event if available
      if (i + 1 < items.length && items[i + 1].action_type === 'proposal_updated' &&
          items[i + 1].portfolio_id === item.portfolio_id &&
          items[i + 1].rec_weight != null && item.rec_weight != null &&
          items[i + 1].rec_weight !== item.rec_weight) {
        const actor = item.actor_name?.split(' ')[0] || 'Someone'
        const fromW = items[i + 1].rec_weight!
        const toW = item.rec_weight!
        const portfolioLabel = item.portfolio_name ? ` for ${item.portfolio_name}` : ''
        result.push({
          ...item,
          summary: `${actor} updated recommendation (${fromW.toFixed(2)}% → ${toW.toFixed(2)}%)${portfolioLabel}`,
        })
        continue
      }
    }

    // ── Default: pass through ────────────────────────────────────────
    result.push(item)
  }

  return result
}

// ---------------------------------------------------------------------------
// Date grouping
// ---------------------------------------------------------------------------

interface DateGroup {
  label: string
  items: TimelineItem[]
}

function groupByDateBucket(items: TimelineItem[]): DateGroup[] {
  const groups: DateGroup[] = []
  let currentLabel = ''

  for (const item of items) {
    const label = getDateGroupLabel(item.occurred_at)
    if (label !== currentLabel) {
      currentLabel = label
      groups.push({ label, items: [item] })
    } else {
      groups[groups.length - 1].items.push(item)
    }
  }

  return groups
}

// ---------------------------------------------------------------------------
// Timeline event row
// ---------------------------------------------------------------------------

function TimelineEventRow({ item, isLast, showTimeOnly }: { item: TimelineItem; isLast: boolean; showTimeOnly?: boolean }) {
  const Icon = ACTION_ICONS[item.action_type] || Activity
  const colorClass = ACTION_COLORS[item.action_type] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'

  return (
    <div className="relative flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className={clsx(
          'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
          colorClass
        )}>
          <Icon className="h-3 w-3" />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 min-h-[12px]" />
        )}
      </div>

      <div className="flex-1 pb-2.5 min-w-0">
        <p className="text-xs text-gray-900 dark:text-white leading-snug">
          {item.summary}
        </p>
        {item.detail && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5 whitespace-pre-line">
            {item.detail}
          </p>
        )}
        <span
          className="text-[10px] text-gray-400 dark:text-gray-500"
          title={formatFullTime(item.occurred_at)}
        >
          {showTimeOnly ? formatTimeOnly(item.occurred_at) : formatRelativeTime(item.occurred_at)}
          {item.collapsed_count ? ` · ${item.collapsed_count} changes` : ''}
        </span>
      </div>
    </div>
  )
}

function DateGroupHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1 pb-1.5">
      <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{label}</span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EntityTimeline({
  entityType,
  entityId,
  className,
  maxItems = 10,
  showHeader = true,
  collapsible = true,
  excludeActions = [],
  groupByDate = false,
  tradeEvents = [],
}: EntityTimelineProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const { data, isLoading, error } = useEntityAuditEvents(entityType, entityId, {
    limit: 100,
    orderDirection: 'desc',
  })

  // Merge audit events + trade events into unified timeline
  const processedItems = useMemo(() => {
    const rawEvents = Array.isArray(data) ? data : (data?.events || [])
    const filtered = excludeActions.length > 0
      ? rawEvents.filter((e: AuditEvent) => !excludeActions.includes(e.action_type))
      : rawEvents

    // Convert audit events to timeline items
    const auditItems = filtered.map(auditEventToItem)

    // Convert trade events to timeline items
    const tradeItems = tradeEvents.map(tradeEventToItem)

    // Merge and sort by occurred_at desc
    const merged = [...auditItems, ...tradeItems].sort(
      (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    )

    // Collapse rapid stage changes
    return collapseNoisyEvents(merged)
  }, [data, excludeActions, tradeEvents])

  if (isLoading) {
    return (
      <div className={clsx('py-3', className)}>
        <div className="flex items-center gap-2 text-gray-500">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          <span className="text-xs">Loading activity...</span>
        </div>
      </div>
    )
  }

  if (error) {
    console.error('[EntityTimeline] Error loading activity:', error)
    return (
      <div className={clsx('py-3', className)}>
        <p className="text-xs text-gray-500 dark:text-gray-400">Unable to load activity</p>
      </div>
    )
  }

  const displayedItems = showAll ? processedItems : processedItems.slice(0, maxItems)
  const hasMore = processedItems.length > maxItems

  if (processedItems.length === 0) {
    return (
      <div className={clsx('py-3', className)}>
        <p className="text-xs text-gray-500 dark:text-gray-400">No activity recorded yet</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({processedItems.length})
            </span>
          </h3>
          {collapsible && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              {isCollapsed ? 'Show' : 'Hide'}
            </button>
          )}
        </div>
      )}

      {!isCollapsed && (
        <>
          {groupByDate ? (
            <div>
              {groupByDateBucket(displayedItems).map((group) => (
                <div key={group.label}>
                  <DateGroupHeader label={group.label} />
                  <div className="space-y-0">
                    {group.items.map((item) => {
                      const isAbsoluteLast = item === displayedItems[displayedItems.length - 1] && !hasMore
                      return (
                        <TimelineEventRow
                          key={item.id}
                          item={item}
                          isLast={isAbsoluteLast}
                          showTimeOnly={group.label === 'Today' || group.label === 'Yesterday'}
                        />
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-0">
              {displayedItems.map((item, index) => (
                <TimelineEventRow
                  key={item.id}
                  item={item}
                  isLast={index === displayedItems.length - 1 && !hasMore}
                />
              ))}
            </div>
          )}

          {hasMore && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="mt-1.5 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
            >
              {showAll ? `Show less` : `Show ${processedItems.length - maxItems} more`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
