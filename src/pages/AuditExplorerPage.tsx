/**
 * Activity — Institutional Memory Timeline
 *
 * Enterprise-grade activity feed with:
 * - Event tier classification (core/secondary/debug) controlling default visibility
 * - Centered max-width layout with 3-column row grid (icon | content | meta)
 * - Slide-over details drawer (not a permanent side panel)
 * - Modeling-session clustering for Trade Lab variant events
 * - Functional event-type segmented filtering
 * - Compact, high-density rows with meaningful change summaries
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  RotateCcw,
  ArrowRight,
  CheckCircle2,
  Edit2,
  Download,
  UserPlus,
  UserMinus,
  Users,
  Archive,
  Star,
  Target,
  Link2,
  Unlink,
  X,
  Loader2,
  Clock,
  Layers,
  ExternalLink,
  FlaskConical,
} from 'lucide-react'
import { format, subDays, subHours, endOfDay, isToday, isYesterday } from 'date-fns'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { EmptyState } from '../components/common/EmptyState'
import type { AuditEvent, EntityType, ActionCategory } from '../lib/audit'

// ─── Types ────────────────────────────────────────────────────────────────────

type ScopeMode = 'me' | 'my_portfolios' | 'my_coverage' | 'firm'
type EventTier = 'core' | 'secondary' | 'debug'
type TierFilter = 'core' | 'core_plus' | 'all'
type EventSegment = 'all' | 'decisions' | 'research' | 'execution' | 'workflow' | 'collaboration' | 'system'

interface EventCluster {
  id: string
  representative: AuditEvent
  events: AuditEvent[]
  count: number
  actorName: string
  actionType: string
  entityType: string
  actionCategory: string
  timeStart: string
  timeEnd: string
  isModelingSession: boolean
  actionBreakdown: Record<string, number>
}

type FeedItem =
  | { kind: 'event'; event: AuditEvent; tier: EventTier }
  | { kind: 'cluster'; cluster: EventCluster }

type InspectorTarget =
  | { kind: 'event'; event: AuditEvent }
  | { kind: 'cluster'; cluster: EventCluster; focusedEvent?: AuditEvent }

interface AuditExplorerPageProps {
  onNavigate?: (item: { id: string; title: string; type: string; data?: any }) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCOPE_OPTIONS: { value: ScopeMode; label: string }[] = [
  { value: 'me', label: 'Me' },
  { value: 'my_portfolios', label: 'My Portfolios' },
  { value: 'my_coverage', label: 'My Coverage' },
  { value: 'firm', label: 'Firm-wide' },
]

const TIME_RANGES = [
  { id: '24h', label: '24 hours', getStart: () => subHours(new Date(), 24) },
  { id: '7d', label: '7 days', getStart: () => subDays(new Date(), 7) },
  { id: '30d', label: '30 days', getStart: () => subDays(new Date(), 30) },
  { id: '90d', label: '90 days', getStart: () => subDays(new Date(), 90) },
]

const TIER_OPTIONS: { value: TierFilter; label: string }[] = [
  { value: 'core', label: 'Core' },
  { value: 'core_plus', label: '+ Detail' },
  { value: 'all', label: 'All' },
]

const SEGMENT_OPTIONS: { value: EventSegment; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'decisions', label: 'Decisions' },
  { value: 'research', label: 'Research' },
  { value: 'execution', label: 'Execution' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'collaboration', label: 'Collab' },
  { value: 'system', label: 'System' },
]

const ENTITY_TYPE_OPTIONS: { value: EntityType | 'all'; label: string }[] = [
  { value: 'all', label: 'All entities' },
  { value: 'trade_idea', label: 'Trade Ideas' },
  { value: 'pair_trade', label: 'Pair Trades' },
  { value: 'simulation', label: 'Simulations' },
  { value: 'portfolio', label: 'Portfolios' },
  { value: 'asset', label: 'Assets' },
  { value: 'coverage', label: 'Coverage' },
  { value: 'order', label: 'Orders' },
  { value: 'execution', label: 'Executions' },
]

const CATEGORY_OPTIONS: { value: ActionCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All categories' },
  { value: 'lifecycle', label: 'Lifecycle' },
  { value: 'state_change', label: 'State Changes' },
  { value: 'field_edit', label: 'Field Edits' },
  { value: 'relationship', label: 'Relationships' },
  { value: 'access', label: 'Access' },
  { value: 'system', label: 'System' },
]

const PAGE_SIZE = 50
const CLUSTER_WINDOW_DEFAULT = 10 * 60 * 1000
const CLUSTER_WINDOW_MODELING = 15 * 60 * 1000
const CLUSTER_MIN_SIZE = 3

// Icon map
const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  create: Plus, delete: Trash2, restore: RotateCcw,
  move_stage: ArrowRight, set_outcome: CheckCircle2,
  auto_archive: Archive, update_field: Edit2, update_fields: Edit2,
  set_rating: Star, set_price_target: Target,
  assign_coverage: UserPlus, remove_coverage: UserMinus,
  attach: Link2, detach: Unlink,
}

const ACTION_COLORS: Record<string, string> = {
  create:           'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  delete:           'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  restore:          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  move_stage:       'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  set_outcome:      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  auto_archive:     'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  update_field:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  update_fields:    'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  set_rating:       'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  set_price_target: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  set_thesis:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  assign_coverage:  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  remove_coverage:  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  attach:           'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  detach:           'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  share:            'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
}

const DEFAULT_ICON_COLOR = 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'

const ENTITY_LABELS: Record<string, string> = {
  trade_idea: 'Trade Idea', pair_trade: 'Pair Trade',
  simulation: 'Simulation', portfolio: 'Portfolio',
  asset: 'Asset', coverage: 'Coverage',
  order: 'Order', execution: 'Execution',
  user: 'User', team: 'Team',
  comment: 'Comment', attachment: 'Attachment',
  lab_variant: 'Lab Variant', trade_sheet: 'Trade Sheet',
}

const ENTITY_PLURALS: Record<string, string> = {
  trade_idea: 'trade ideas', pair_trade: 'pair trades',
  simulation: 'simulations', portfolio: 'portfolios',
  asset: 'assets', coverage: 'coverage records',
  order: 'orders', execution: 'executions',
  user: 'users', team: 'teams',
  comment: 'comments', attachment: 'attachments',
  lab_variant: 'lab variants', trade_sheet: 'trade sheets',
}

const CATEGORY_COLORS: Record<string, string> = {
  lifecycle:     'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
  state_change:  'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
  field_edit:    'bg-gray-50 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400',
  relationship:  'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
  access:        'bg-slate-50 text-slate-600 dark:bg-slate-700/50 dark:text-slate-400',
  system:        'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400',
}

const STAGE_LABELS: Record<string, string> = {
  idea: 'Ideas', discussing: 'Working On', working_on: 'Working On',
  simulating: 'Modeling', modeling: 'Modeling', deciding: 'Deciding',
  approved: 'Committed', rejected: 'Rejected', cancelled: 'Deferred',
  archived: 'Archived', executed: 'Executed',
}

const ENTITY_TAB_TYPE: Record<string, string> = {
  trade_idea: 'idea', pair_trade: 'idea',
  asset: 'asset', portfolio: 'portfolio',
  simulation: 'trade-lab', order: 'trade-queue',
  execution: 'trade-queue', coverage: 'coverage',
  user: 'user', team: 'organization',
}

// Fields with highest information value for change previews
const PRIORITY_DIFF_FIELDS = [
  'stage', 'workflow_stage', 'decision_outcome', 'outcome', 'workflow_outcome',
  'status', 'rating', 'price_target', 'weight', 'shares', 'priority', 'sizing_input',
  'thesis', 'bull_case', 'bear_case', 'process_stage',
]

// Thesis-adjacent fields on assets that count as core research events
const THESIS_FIELDS = new Set([
  'thesis', 'bull_case', 'bear_case', 'priority', 'process_stage',
  'rating', 'price_target', 'ev_upside', 'ev_downside',
])

// ─── Event Tier Classification ────────────────────────────────────────────────

function classifyActivityEvent(e: AuditEvent): { tier: EventTier; reason: string } {
  // ── Tier 3: DEBUG — always-low events ────────────────────────
  if (e.entity_type === ('lab_variant' as any)) return { tier: 'debug', reason: 'Trade Lab variant' }
  if (e.action_category === 'system') return { tier: 'debug', reason: 'System event' }
  if (['backfill', 'migrate', 'reconcile', 'auto_archive'].includes(e.action_type))
    return { tier: 'debug', reason: 'System maintenance' }
  if (e.action_type === ('view' as any) || e.action_type === ('export' as any))
    return { tier: 'debug', reason: 'Access log' }

  // ── Tier 1: CORE — institutional memory ────────────────────
  // Decisions
  if (e.action_type === 'set_outcome') return { tier: 'core', reason: 'Decision recorded' }
  // Stage transitions
  if (e.action_type === 'move_stage') return { tier: 'core', reason: 'Stage transition' }
  // Key entity lifecycle
  if (e.action_type === 'create' && ['trade_idea', 'pair_trade', 'trade_sheet', 'portfolio'].includes(e.entity_type))
    return { tier: 'core', reason: 'Entity created' }
  if (e.action_type === 'delete' && ['trade_idea', 'pair_trade', 'trade_sheet'].includes(e.entity_type))
    return { tier: 'core', reason: 'Entity deleted' }
  if (e.action_type === 'restore') return { tier: 'core', reason: 'Entity restored' }
  // Coverage
  if (['assign_coverage', 'remove_coverage', 'transfer_ownership'].includes(e.action_type))
    return { tier: 'core', reason: 'Coverage change' }
  // Research signals
  if (['set_rating', 'set_price_target', 'set_thesis'].includes(e.action_type))
    return { tier: 'core', reason: 'Research update' }
  // Thesis-related field edits on assets
  if ((e.action_type === 'update_field' || e.action_type === 'update_fields') && e.entity_type === 'asset') {
    if (e.changed_fields?.some(f => THESIS_FIELDS.has(f)))
      return { tier: 'core', reason: 'Research update' }
  }
  // Share / escalate
  if (e.action_type === ('share' as any)) return { tier: 'core', reason: 'Shared' }
  if (e.action_type === 'escalate') return { tier: 'core', reason: 'Escalation' }
  // Trade sheet state changes
  if (e.entity_type === ('trade_sheet' as any) && e.action_category === 'state_change')
    return { tier: 'core', reason: 'Trade sheet status' }
  // Simulation shared
  if (e.entity_type === 'simulation' && e.action_type === ('share' as any))
    return { tier: 'core', reason: 'Simulation shared' }

  // ── Tier 2: SECONDARY ──────────────────────────────────────
  if (e.entity_type === ('comment' as any)) return { tier: 'secondary', reason: 'Comment' }
  if (e.entity_type === ('attachment' as any)) return { tier: 'secondary', reason: 'Attachment' }
  if (e.entity_type === 'simulation' && ['create', 'update_field', 'update_fields'].includes(e.action_type))
    return { tier: 'secondary', reason: 'Simulation draft' }
  if (['attach', 'detach', 'link', 'unlink'].includes(e.action_type))
    return { tier: 'secondary', reason: 'Relationship' }
  if (e.action_category === 'field_edit') return { tier: 'secondary', reason: 'Field edit' }
  if (e.action_category === 'lifecycle') return { tier: 'secondary', reason: 'Lifecycle' }

  return { tier: 'secondary', reason: 'Other' }
}

function passesTierFilter(tier: EventTier, filter: TierFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'core_plus') return tier === 'core' || tier === 'secondary'
  return tier === 'core'
}

// ─── Event Segment Classification ────────────────────────────────────────────

function matchesEventSegment(e: AuditEvent, seg: EventSegment): boolean {
  if (seg === 'all') return true
  switch (seg) {
    case 'decisions':
      return (
        e.action_type === 'set_outcome' ||
        (e.action_type === 'move_stage' && ['trade_idea', 'pair_trade'].includes(e.entity_type)) ||
        (['trade_idea', 'pair_trade'].includes(e.entity_type) && e.action_category === 'lifecycle')
      )
    case 'research':
      return (
        ['set_rating', 'set_price_target', 'set_thesis'].includes(e.action_type) ||
        (e.entity_type === 'asset' && e.action_category === 'field_edit') ||
        e.entity_type === 'coverage'
      )
    case 'execution':
      return ['trade_sheet', 'order', 'execution'].includes(e.entity_type as string)
    case 'workflow':
      return (
        (e.action_type === 'move_stage' && !['trade_idea', 'pair_trade'].includes(e.entity_type)) ||
        (e.entity_type === 'simulation' && e.action_category !== 'field_edit')
      )
    case 'collaboration':
      return (
        e.entity_type === ('comment' as any) ||
        e.entity_type === ('attachment' as any) ||
        e.action_type === ('share' as any) ||
        ['assign_coverage', 'remove_coverage', 'transfer_ownership'].includes(e.action_type)
      )
    case 'system':
      return (
        e.entity_type === ('lab_variant' as any) ||
        e.action_category === 'system' ||
        ['backfill', 'migrate', 'reconcile', 'auto_archive'].includes(e.action_type) ||
        e.action_type === ('view' as any) || e.action_type === ('export' as any)
      )
  }
  return true
}

// ─── Event Summarization ─────────────────────────────────────────────────────

function summarizeEvent(e: AuditEvent): string | null {
  // Stage change
  if (e.action_type === 'move_stage') {
    const from = e.from_state?.stage || e.from_state?.workflow_stage || e.from_state?.status
    const to = e.to_state?.stage || e.to_state?.workflow_stage || e.to_state?.status
    if (from && to) return `Stage: ${STAGE_LABELS[from as string] || from} → ${STAGE_LABELS[to as string] || to}`
  }
  // Decision
  if (e.action_type === 'set_outcome') {
    const outcome = e.to_state?.outcome || e.to_state?.workflow_outcome || e.to_state?.decision_outcome
    if (outcome) return `Decision: ${String(outcome)}`
  }
  // Rating
  if (e.action_type === 'set_rating') {
    const from = e.from_state?.rating
    const to = e.to_state?.rating
    if (from && to) return `Rating: ${from} → ${to}`
    if (to) return `Rating: ${to}`
  }
  // Price target
  if (e.action_type === 'set_price_target') {
    const from = e.from_state?.price_target
    const to = e.to_state?.price_target
    if (from && to) return `PT: $${from} → $${to}`
    if (to) return `PT: $${to}`
  }
  // Thesis
  if (e.action_type === 'set_thesis' || (e.entity_type === 'asset' && e.changed_fields?.some(f => THESIS_FIELDS.has(f)))) {
    const count = e.changed_fields?.filter(f => THESIS_FIELDS.has(f)).length || 0
    return count > 1 ? `Updated thesis (+${count} fields)` : 'Updated thesis'
  }
  // Trade sheet status
  if (e.entity_type === ('trade_sheet' as any) && e.action_category === 'state_change') {
    const from = e.from_state?.status || e.from_state?.stage
    const to = e.to_state?.status || e.to_state?.stage
    if (from && to) return `Status: ${from} → ${to}`
  }
  // Sizing
  if (e.changed_fields?.includes('sizing_input') && e.from_state?.sizing_input && e.to_state?.sizing_input) {
    return `Size: ${fmtVal(e.from_state.sizing_input)} → ${fmtVal(e.to_state.sizing_input)}`
  }
  // Coverage
  if (e.action_type === 'assign_coverage') return `Assigned to ${e.entity_display_name || 'asset'}`
  if (e.action_type === 'remove_coverage') return `Removed from ${e.entity_display_name || 'asset'}`
  // Generic field edits with from/to state
  if (e.from_state && e.to_state) {
    const fields = getFieldDiff(e.from_state, e.to_state)
    const top = PRIORITY_DIFF_FIELDS.find(f => fields.includes(f)) || fields[0]
    if (top) {
      const from = fmtVal(e.from_state[top])
      const to = fmtVal(e.to_state[top])
      if (from !== to) return `${top.replace(/_/g, ' ')}: ${from} → ${to}`
    }
  }
  // Changed fields list fallback
  if (e.changed_fields?.length) {
    const preview = e.changed_fields.slice(0, 2).map(f => f.replace(/_/g, ' ')).join(', ')
    return e.changed_fields.length > 2 ? `${preview} +${e.changed_fields.length - 2} more` : preview
  }
  return null
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function fmtVal(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'string') return val.length > 28 ? val.slice(0, 28) + '...' : val
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  return JSON.stringify(val).slice(0, 28)
}

function formatDiffValue(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') return val.length > 120 ? val.slice(0, 120) + '...' : val
  return JSON.stringify(val).slice(0, 120)
}

function getFieldDiff(from: any, to: any): string[] {
  if (!from && !to) return []
  const allKeys = new Set([...Object.keys(from || {}), ...Object.keys(to || {})])
  const changed: string[] = []
  for (const key of allKeys) {
    if (JSON.stringify(from?.[key]) !== JSON.stringify(to?.[key])) changed.push(key)
  }
  return changed
}

function formatRelativeTime(dateString: string): string {
  const ms = Date.now() - new Date(dateString).getTime()
  const mins = Math.floor(ms / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  const d = new Date(dateString)
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

function getDayLabel(dateString: string): string {
  const d = new Date(dateString)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'EEEE, MMM d')
}

function getDayKey(dateString: string): string {
  return format(new Date(dateString), 'yyyy-MM-dd')
}

function actionVerb(actionType: string): string {
  switch (actionType) {
    case 'create': return 'created'
    case 'delete': return 'deleted'
    case 'restore': return 'restored'
    case 'move_stage': return 'moved'
    case 'set_outcome': return 'set outcome on'
    case 'update_field': case 'update_fields': return 'updated'
    case 'set_rating': return 'rated'
    case 'set_price_target': return 'updated price on'
    case 'set_thesis': return 'updated thesis on'
    case 'assign_coverage': return 'assigned coverage to'
    case 'remove_coverage': return 'removed coverage from'
    case 'transfer_ownership': return 'transferred ownership of'
    case 'auto_archive': return 'auto-archived'
    case 'attach': return 'linked'
    case 'detach': return 'unlinked'
    case 'share': return 'shared'
    case 'escalate': return 'escalated'
    default: return actionType.replace(/_/g, ' ')
  }
}

function formatEventTitle(event: AuditEvent): { actor: string; verb: string; entity: string } {
  const actor = event.actor_name?.split(' ')[0] || event.actor_email?.split('@')[0] || 'System'
  const entity = event.entity_display_name || event.asset_symbol || (ENTITY_LABELS[event.entity_type] || event.entity_type)
  const verb = actionVerb(event.action_type)
  return { actor, verb, entity }
}

// ─── Clustering ───────────────────────────────────────────────────────────────

function getClusterKey(event: AuditEvent): string {
  const actor = event.actor_id || event.actor_name || 'system'
  const parent = event.parent_entity_id ? `${event.parent_entity_type}:${event.parent_entity_id}` : ''
  // Lab variants: group ALL action types together into modeling sessions
  if (event.entity_type === ('lab_variant' as any)) {
    return `modeling|${actor}|${parent}`
  }
  return `${actor}|${event.action_type}|${event.entity_type}|${parent}`
}

function getClusterWindow(entityType: string): number {
  return entityType === 'lab_variant' ? CLUSTER_WINDOW_MODELING : CLUSTER_WINDOW_DEFAULT
}

function buildCluster(events: AuditEvent[]): EventCluster {
  const rep = events[0]
  const actor = rep.actor_name?.split(' ')[0] || rep.actor_email?.split('@')[0] || 'System'
  const isModelingSession = rep.entity_type === ('lab_variant' as any)
  const actionBreakdown: Record<string, number> = {}
  for (const e of events) {
    actionBreakdown[e.action_type] = (actionBreakdown[e.action_type] || 0) + 1
  }
  return {
    id: `cluster-${rep.id}`,
    representative: rep,
    events,
    count: events.length,
    actorName: actor,
    actionType: rep.action_type,
    entityType: rep.entity_type,
    actionCategory: rep.action_category,
    timeEnd: events[0].occurred_at,
    timeStart: events[events.length - 1].occurred_at,
    isModelingSession,
    actionBreakdown,
  }
}

function clusterEvents(events: AuditEvent[]): FeedItem[] {
  if (events.length === 0) return []

  const result: FeedItem[] = []
  let group: AuditEvent[] = [events[0]]

  function flush() {
    if (group.length >= CLUSTER_MIN_SIZE) {
      result.push({ kind: 'cluster', cluster: buildCluster(group) })
    } else {
      for (const e of group) {
        result.push({ kind: 'event', event: e, tier: classifyActivityEvent(e).tier })
      }
    }
  }

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]
    const curr = events[i]
    const gap = new Date(prev.occurred_at).getTime() - new Date(curr.occurred_at).getTime()
    const window = getClusterWindow(prev.entity_type)
    if (getClusterKey(prev) === getClusterKey(curr) && gap <= window) {
      group.push(curr)
    } else {
      flush()
      group = [curr]
    }
  }
  flush()
  return result
}

function summarizeModelingSession(cluster: EventCluster): string {
  return Object.entries(cluster.actionBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => `${actionVerb(action)} ${count}`)
    .join(', ')
}

// ─── Row Components ───────────────────────────────────────────────────────────

function EventRow({ event, tier, isSelected, onClick }: {
  event: AuditEvent
  tier: EventTier
  isSelected: boolean
  onClick: (event: AuditEvent) => void
}) {
  const Icon = ACTION_ICONS[event.action_type] || Activity
  const colorCls = ACTION_COLORS[event.action_type] || DEFAULT_ICON_COLOR
  const { actor, verb, entity } = formatEventTitle(event)
  const summary = tier === 'core' ? summarizeEvent(event) : null
  const isDebug = tier === 'debug'
  const isFieldEdit = event.action_category === 'field_edit' && tier !== 'core'

  return (
    <button
      onClick={() => onClick(event)}
      className={clsx(
        'w-full text-left grid grid-cols-[36px_1fr_120px] gap-x-2.5 py-2 px-3 border-l-2 transition-colors group',
        isSelected
          ? 'bg-primary-50 dark:bg-primary-900/20 border-l-primary-500'
          : tier === 'core'
            ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border-l-blue-400/50 dark:border-l-blue-500/30'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 border-l-transparent',
        isDebug && 'opacity-50',
      )}
    >
      {/* Icon */}
      <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center mt-0.5', colorCls)}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Content */}
      <div className="min-w-0">
        <p className={clsx(
          'text-[13px] leading-5',
          isDebug || isFieldEdit ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100',
        )}>
          <span className="font-medium">{actor}</span>
          {' '}<span className={isDebug || isFieldEdit ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}>{verb}</span>{' '}
          <span className="font-medium">{entity}</span>
        </p>
        <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
          {event.asset_symbol && (
            <span className="inline-flex px-1.5 py-px rounded text-[10px] font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 flex-shrink-0">
              {event.asset_symbol}
            </span>
          )}
          <span className="inline-flex px-1.5 py-px rounded text-[10px] bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400 flex-shrink-0">
            {ENTITY_LABELS[event.entity_type] || event.entity_type}
          </span>
          <span className={clsx('inline-flex px-1.5 py-px rounded text-[10px] flex-shrink-0',
            CATEGORY_COLORS[event.action_category] || 'bg-gray-50 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
          )}>
            {event.action_category.replace(/_/g, ' ')}
          </span>
        </div>
        {summary && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{summary}</p>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-col items-end pt-0.5">
        <span
          className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums"
          title={format(new Date(event.occurred_at), 'PPpp')}
        >
          {formatRelativeTime(event.occurred_at)}
        </span>
        <ChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  )
}

function ClusterRow({ cluster, isSelected, onSelectCluster, onSelectEvent }: {
  cluster: EventCluster
  isSelected: boolean
  onSelectCluster: (c: EventCluster) => void
  onSelectEvent: (e: AuditEvent) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const Icon = cluster.isModelingSession ? FlaskConical : (ACTION_ICONS[cluster.actionType] || Activity)
  const colorCls = cluster.isModelingSession
    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
    : ACTION_COLORS[cluster.actionType] || DEFAULT_ICON_COLOR
  const verb = actionVerb(cluster.actionType)
  const plural = ENTITY_PLURALS[cluster.entityType] || `${cluster.entityType}s`

  const spanMs = new Date(cluster.timeEnd).getTime() - new Date(cluster.timeStart).getTime()
  const spanMins = Math.round(spanMs / 60000)
  const spanText = spanMins < 1 ? '<1m' : `${spanMins}m`

  return (
    <div className={clsx(
      'border-l-2 transition-colors',
      isSelected
        ? 'bg-primary-50/50 dark:bg-primary-900/10 border-l-primary-500'
        : cluster.isModelingSession
          ? 'border-l-violet-300 dark:border-l-violet-600 bg-violet-50/30 dark:bg-violet-900/5'
          : 'border-l-gray-200 dark:border-l-gray-700 bg-gray-50/30 dark:bg-gray-800/20',
    )}>
      {/* Header */}
      <button
        onClick={() => { onSelectCluster(cluster); setExpanded(v => !v) }}
        className="w-full text-left grid grid-cols-[36px_1fr_120px] gap-x-2.5 py-2 px-3 hover:bg-gray-100/40 dark:hover:bg-gray-800/40 transition-colors group"
      >
        {/* Icon with count badge */}
        <div className="relative">
          <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center mt-0.5', colorCls)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-gray-600 dark:bg-gray-400 text-white dark:text-gray-900 flex items-center justify-center px-1">
            <span className="text-[9px] font-bold leading-none">{cluster.count}</span>
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0">
          {cluster.isModelingSession ? (
            <p className="text-[13px] leading-5 text-gray-900 dark:text-gray-100">
              <span className="font-medium">{cluster.actorName}</span>
              {' '}<span className="text-gray-500 dark:text-gray-400">ran modeling session:</span>{' '}
              <span className="text-gray-600 dark:text-gray-300">{summarizeModelingSession(cluster)}</span>
            </p>
          ) : (
            <p className="text-[13px] leading-5 text-gray-900 dark:text-gray-100">
              <span className="font-medium">{cluster.actorName}</span>
              {' '}<span className="text-gray-500 dark:text-gray-400">{verb}</span>{' '}
              <span className="font-semibold">{cluster.count}</span>{' '}
              <span className="text-gray-500 dark:text-gray-400">{plural}</span>
            </p>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <span className="inline-flex px-1.5 py-px rounded text-[10px] bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {ENTITY_LABELS[cluster.entityType] || cluster.entityType}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              over {spanText}
            </span>
            {expanded
              ? <ChevronDown className="h-3 w-3 text-gray-400 ml-0.5" />
              : <ChevronRight className="h-3 w-3 text-gray-400 ml-0.5" />}
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-col items-end pt-0.5">
          <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums"
            title={format(new Date(cluster.timeEnd), 'PPpp')}>
            {formatRelativeTime(cluster.timeEnd)}
          </span>
        </div>
      </button>

      {/* Expanded child events */}
      {expanded && (
        <div className="ml-[50px] mr-3 mb-1 border border-gray-100 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700/50 overflow-hidden">
          {cluster.events.map(event => (
            <button
              key={event.id}
              onClick={() => onSelectEvent(event)}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-xs text-gray-600 dark:text-gray-400"
            >
              <span className="font-medium text-gray-700 dark:text-gray-300 truncate flex-1">
                {event.entity_display_name || event.entity_id.slice(0, 8)}
              </span>
              {event.asset_symbol && (
                <span className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-semibold flex-shrink-0">
                  {event.asset_symbol}
                </span>
              )}
              <span className="text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
                {format(new Date(event.occurred_at), 'h:mm a')}
              </span>
              <ChevronRight className="h-3 w-3 text-gray-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Drawer Components ────────────────────────────────────────────────────────

function DrawerShell({ title, badge, onClose, children, backLabel, onBack }: {
  title: string
  badge?: string
  onClose: () => void
  children: React.ReactNode
  backLabel?: string
  onBack?: () => void
}) {
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl">
      <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-shrink-0">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline mr-1">
            <ChevronRight className="h-3 w-3 rotate-180" />
            {backLabel || 'Back'}
          </button>
        )}
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate flex-1">{title}</h3>
        {badge && (
          <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 flex-shrink-0">
            {badge}
          </span>
        )}
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 flex-shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function EventDrawer({ event, onClose, onNavigate }: {
  event: AuditEvent
  onClose: () => void
  onNavigate?: AuditExplorerPageProps['onNavigate']
}) {
  const { actor, verb, entity } = formatEventTitle(event)
  const hasDiff = event.from_state || event.to_state
  const changedFields = event.changed_fields || (hasDiff ? getFieldDiff(event.from_state, event.to_state) : [])
  const tabType = ENTITY_TAB_TYPE[event.entity_type]

  return (
    <DrawerShell
      title={event.entity_display_name || ENTITY_LABELS[event.entity_type] || event.entity_type}
      badge={ENTITY_LABELS[event.entity_type] || event.entity_type}
      onClose={onClose}
    >
      <div className="p-4 space-y-4">
        {/* Summary */}
        <div>
          <p className="text-sm text-gray-900 dark:text-gray-100">
            <span className="font-medium">{actor}</span>{' '}
            <span className="text-gray-500 dark:text-gray-400">{verb}</span>{' '}
            <span className="font-medium">{entity}</span>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {format(new Date(event.occurred_at), 'PPpp')}
          </p>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <MetaField label="Action" value={event.action_type.replace(/_/g, ' ')} />
          <MetaField label="Category" value={event.action_category.replace(/_/g, ' ')} />
          <MetaField label="Actor" value={event.actor_name || event.actor_email || event.actor_role || 'System'} />
          {event.asset_symbol && <MetaField label="Asset" value={event.asset_symbol} />}
          {event.metadata?.ui_source && <MetaField label="Source" value={String(event.metadata.ui_source)} />}
          {event.metadata?.reason && <MetaField label="Reason" value={String(event.metadata.reason)} />}
        </div>

        {/* Diff table */}
        {hasDiff && changedFields.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider">Changes</h4>
            <DiffTable from={event.from_state} to={event.to_state} fields={changedFields} />
          </div>
        )}

        {/* Changed fields (no state data) */}
        {!hasDiff && event.changed_fields && event.changed_fields.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider">Changed Fields</h4>
            <div className="flex flex-wrap gap-1">
              {event.changed_fields.map(f => (
                <span key={f} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-300">
                  {f.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Raw state */}
        {event.from_state && <CollapsibleJSON label="From State" data={event.from_state} />}
        {event.to_state && <CollapsibleJSON label="To State" data={event.to_state} />}

        {/* Links */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-2">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Links</h4>
          {tabType && onNavigate && (
            <button
              onClick={() => onNavigate({ id: event.entity_id, title: event.entity_display_name || event.entity_type, type: tabType })}
              className="flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open {ENTITY_LABELS[event.entity_type] || event.entity_type}
            </button>
          )}
          {event.parent_entity_type && event.parent_entity_id && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Related to {ENTITY_LABELS[event.parent_entity_type] || event.parent_entity_type}{' '}
              <code className="font-mono text-[10px]">{event.parent_entity_id.slice(0, 8)}</code>
            </p>
          )}
        </div>

        {/* IDs */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider">Identifiers</h4>
          <div className="space-y-1 text-xs">
            <IdRow label="Event" value={event.id} />
            <IdRow label="Entity" value={event.entity_id} />
            {event.actor_id && <IdRow label="Actor" value={event.actor_id} />}
          </div>
        </div>
      </div>
    </DrawerShell>
  )
}

function ClusterDrawer({ cluster, focusedEvent, onClose, onNavigate }: {
  cluster: EventCluster
  focusedEvent?: AuditEvent
  onClose: () => void
  onNavigate?: AuditExplorerPageProps['onNavigate']
}) {
  const [selectedInCluster, setSelectedInCluster] = useState<AuditEvent | null>(focusedEvent || null)

  useEffect(() => {
    if (focusedEvent) setSelectedInCluster(focusedEvent)
  }, [focusedEvent])

  const verb = actionVerb(cluster.actionType)
  const plural = ENTITY_PLURALS[cluster.entityType] || `${cluster.entityType}s`
  const spanMs = new Date(cluster.timeEnd).getTime() - new Date(cluster.timeStart).getTime()
  const spanMins = Math.round(spanMs / 60000)

  if (selectedInCluster) {
    return (
      <DrawerShell
        title={selectedInCluster.entity_display_name || ENTITY_LABELS[selectedInCluster.entity_type] || selectedInCluster.entity_type}
        badge={ENTITY_LABELS[selectedInCluster.entity_type]}
        onClose={onClose}
        backLabel={`Cluster (${cluster.count})`}
        onBack={() => setSelectedInCluster(null)}
      >
        <div className="p-4 space-y-4">
          <EventDrawerContent event={selectedInCluster} onNavigate={onNavigate} />
        </div>
      </DrawerShell>
    )
  }

  return (
    <DrawerShell
      title={cluster.isModelingSession ? 'Modeling Session' : 'Cluster Summary'}
      badge={`${cluster.count} events`}
      onClose={onClose}
    >
      <div className="p-4 space-y-4">
        <div>
          {cluster.isModelingSession ? (
            <p className="text-sm text-gray-900 dark:text-gray-100">
              <span className="font-medium">{cluster.actorName}</span>{' '}
              <span className="text-gray-500">ran modeling session:</span>{' '}
              <span className="text-gray-700 dark:text-gray-300">{summarizeModelingSession(cluster)}</span>
            </p>
          ) : (
            <p className="text-sm text-gray-900 dark:text-gray-100">
              <span className="font-medium">{cluster.actorName}</span>{' '}
              <span className="text-gray-500">{verb}</span>{' '}
              <span className="font-semibold">{cluster.count}</span>{' '}
              <span className="text-gray-500">{plural}</span>
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {format(new Date(cluster.timeStart), 'h:mm a')} – {format(new Date(cluster.timeEnd), 'h:mm a')}
            {' '}({spanMins < 1 ? '<1' : spanMins}m span)
          </p>
        </div>

        {/* Action breakdown for modeling sessions */}
        {cluster.isModelingSession && Object.keys(cluster.actionBreakdown).length > 1 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {Object.entries(cluster.actionBreakdown).sort((a, b) => b[1] - a[1]).map(([action, count]) => (
              <MetaField key={action} label={action.replace(/_/g, ' ')} value={String(count)} />
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <MetaField label="Entity Type" value={ENTITY_LABELS[cluster.entityType] || cluster.entityType} />
          <MetaField label="Category" value={cluster.actionCategory.replace(/_/g, ' ')} />
          <MetaField label="Count" value={String(cluster.count)} />
          <MetaField label="Duration" value={`${spanMins < 1 ? '<1' : spanMins}m`} />
        </div>

        {/* Event list */}
        <div>
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider">
            Events ({cluster.count})
          </h4>
          <div className="border border-gray-100 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 max-h-[400px] overflow-y-auto">
            {cluster.events.map(event => (
              <button
                key={event.id}
                onClick={() => setSelectedInCluster(event)}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors flex items-center gap-2 text-xs"
              >
                <span className="font-medium text-gray-700 dark:text-gray-300 truncate flex-1">
                  {event.entity_display_name || event.entity_id.slice(0, 8)}
                </span>
                {event.asset_symbol && (
                  <span className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-semibold flex-shrink-0">
                    {event.asset_symbol}
                  </span>
                )}
                <span className="text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
                  {format(new Date(event.occurred_at), 'h:mm:ss a')}
                </span>
                <ChevronRight className="h-3 w-3 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </DrawerShell>
  )
}

/** Reusable content block for an event inside a drawer (without the shell). */
function EventDrawerContent({ event, onNavigate }: {
  event: AuditEvent
  onNavigate?: AuditExplorerPageProps['onNavigate']
}) {
  const { actor, verb, entity } = formatEventTitle(event)
  const hasDiff = event.from_state || event.to_state
  const changedFields = event.changed_fields || (hasDiff ? getFieldDiff(event.from_state, event.to_state) : [])
  const tabType = ENTITY_TAB_TYPE[event.entity_type]

  return (
    <>
      <div>
        <p className="text-sm text-gray-900 dark:text-gray-100">
          <span className="font-medium">{actor}</span>{' '}
          <span className="text-gray-500 dark:text-gray-400">{verb}</span>{' '}
          <span className="font-medium">{entity}</span>
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {format(new Date(event.occurred_at), 'PPpp')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <MetaField label="Action" value={event.action_type.replace(/_/g, ' ')} />
        <MetaField label="Category" value={event.action_category.replace(/_/g, ' ')} />
        <MetaField label="Actor" value={event.actor_name || event.actor_email || event.actor_role || 'System'} />
        {event.asset_symbol && <MetaField label="Asset" value={event.asset_symbol} />}
      </div>

      {hasDiff && changedFields.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider">Changes</h4>
          <DiffTable from={event.from_state} to={event.to_state} fields={changedFields} />
        </div>
      )}

      {!hasDiff && event.changed_fields && event.changed_fields.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider">Changed Fields</h4>
          <div className="flex flex-wrap gap-1">
            {event.changed_fields.map(f => (
              <span key={f} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-300">
                {f.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {event.from_state && <CollapsibleJSON label="From State" data={event.from_state} />}
      {event.to_state && <CollapsibleJSON label="To State" data={event.to_state} />}

      {tabType && onNavigate && (
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={() => onNavigate({ id: event.entity_id, title: event.entity_display_name || event.entity_type, type: tabType })}
            className="flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Open {ENTITY_LABELS[event.entity_type] || event.entity_type}
          </button>
        </div>
      )}
    </>
  )
}

// ─── Shared Components ────────────────────────────────────────────────────────

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-gray-900 dark:text-gray-100 font-medium">{value}</dd>
    </div>
  )
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 dark:text-gray-400 w-12 flex-shrink-0">{label}</span>
      <code className="text-gray-700 dark:text-gray-300 font-mono text-[10px] truncate">{value}</code>
    </div>
  )
}

function DiffTable({ from, to, fields }: { from: any; to: any; fields: string[] }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left px-3 py-1.5 font-medium text-gray-500 dark:text-gray-400 w-1/3">Field</th>
            <th className="text-left px-3 py-1.5 font-medium text-red-500 dark:text-red-400 w-1/3">From</th>
            <th className="text-left px-3 py-1.5 font-medium text-green-500 dark:text-green-400 w-1/3">To</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {fields.map(field => (
            <tr key={field}>
              <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">{field.replace(/_/g, ' ')}</td>
              <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 font-mono break-all">
                {from?.[field] !== undefined ? formatDiffValue(from[field]) : '—'}
              </td>
              <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 font-mono break-all">
                {to?.[field] !== undefined ? formatDiffValue(to[field]) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CollapsibleJSON({ label, data }: { label: string; data: any }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label}
      </button>
      {open && (
        <pre className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-[10px] font-mono text-gray-600 dark:text-gray-400 overflow-x-auto max-h-40 overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AuditExplorerPage({ onNavigate }: AuditExplorerPageProps = {}) {
  const { user } = useAuth()

  // ── Filter state ──
  const [scope, setScope] = useState<ScopeMode>('firm')
  const [timeRange, setTimeRange] = useState('7d')
  const [tierFilter, setTierFilter] = useState<TierFilter>('core')
  const [segment, setSegment] = useState<EventSegment>('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // ── Inspector state ──
  const [inspectorTarget, setInspectorTarget] = useState<InspectorTarget | null>(null)

  // ── Pagination ──
  const [pageOffset, setPageOffset] = useState(0)
  const [loadedEvents, setLoadedEvents] = useState<AuditEvent[]>([])

  // ── Secondary filters visibility ──
  const [showSecondaryFilters, setShowSecondaryFilters] = useState(false)

  // ── Debounce search ──
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Filter key for detecting changes
  const filterKey = `${scope}|${timeRange}|${tierFilter}|${segment}|${entityTypeFilter}|${categoryFilter}|${debouncedSearch}`
  const prevFilterKeyRef = useRef(filterKey)

  useEffect(() => {
    if (filterKey !== prevFilterKeyRef.current) {
      prevFilterKeyRef.current = filterKey
      setLoadedEvents([])
      setPageOffset(0)
      setInspectorTarget(null)
    }
  }, [filterKey])

  // ── Scope data queries ──
  const { data: userPortfolioIds } = useQuery({
    queryKey: ['user-portfolio-ids', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data } = await supabase.from('portfolio_team').select('portfolio_id').eq('user_id', user.id)
      return data?.map(r => r.portfolio_id) || []
    },
    enabled: !!user?.id && scope === 'my_portfolios',
    staleTime: 60000,
  })

  const { data: userCoveredAssetIds } = useQuery({
    queryKey: ['user-covered-assets', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data } = await supabase.from('coverage_assignments').select('asset_id').eq('user_id', user.id).eq('is_active', true)
      return data?.map(r => r.asset_id) || []
    },
    enabled: !!user?.id && scope === 'my_coverage',
    staleTime: 60000,
  })

  // ── Query params ──
  const queryParams = useMemo(() => {
    const tr = TIME_RANGES.find(t => t.id === timeRange)
    const start = tr ? tr.getStart().toISOString() : subDays(new Date(), 7).toISOString()
    const end = endOfDay(new Date()).toISOString()
    return {
      start, end,
      entityType: entityTypeFilter !== 'all' ? entityTypeFilter : null,
      category: categoryFilter !== 'all' ? categoryFilter : null,
      search: debouncedSearch || null,
      scope,
      actorId: scope === 'me' ? user?.id : null,
      portfolioIds: scope === 'my_portfolios' ? (userPortfolioIds || []) : null,
      assetIds: scope === 'my_coverage' ? (userCoveredAssetIds || []) : null,
      offset: pageOffset,
      tierFilter,
    }
  }, [timeRange, entityTypeFilter, categoryFilter, debouncedSearch, scope, user?.id, userPortfolioIds, userCoveredAssetIds, pageOffset, tierFilter])

  // ── Fetch events ──
  const { data: queryResult, isLoading, isFetching } = useQuery({
    queryKey: ['activity-feed', queryParams],
    queryFn: async () => {
      let query = supabase
        .from('audit_events')
        .select('*', { count: 'exact' })
        .gte('occurred_at', queryParams.start)
        .lte('occurred_at', queryParams.end)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(queryParams.offset, queryParams.offset + PAGE_SIZE - 1)

      // DB-level tier exclusions for efficiency
      if (queryParams.tierFilter !== 'all') {
        query = query.neq('entity_type', 'lab_variant')
      }
      if (queryParams.tierFilter === 'core') {
        query = query.neq('action_category', 'system')
      }

      if (queryParams.entityType) query = query.eq('entity_type', queryParams.entityType)
      if (queryParams.category) query = query.eq('action_category', queryParams.category)
      if (queryParams.actorId) query = query.eq('actor_id', queryParams.actorId)
      if (queryParams.portfolioIds && queryParams.portfolioIds.length > 0) {
        query = query.in('portfolio_id', queryParams.portfolioIds)
      }
      if (queryParams.assetIds && queryParams.assetIds.length > 0) {
        query = query.in('asset_id', queryParams.assetIds)
      }
      if (queryParams.search) {
        query = query.or(`entity_display_name.ilike.%${queryParams.search}%,search_text.ilike.%${queryParams.search}%,actor_name.ilike.%${queryParams.search}%,asset_symbol.ilike.%${queryParams.search}%`)
      }

      const { data, error, count } = await query
      if (error) throw new Error(`Activity query failed: ${error.message}`)

      return {
        events: (data || []) as AuditEvent[],
        totalCount: count || 0,
        pageHasMore: (data?.length || 0) === PAGE_SIZE,
      }
    },
    staleTime: 20000,
  })

  // ── Accumulate events across pages ──
  const rawEvents = queryResult?.events
  const processedOffsetRef = useRef(-1)

  useEffect(() => {
    if (!rawEvents?.length) {
      if (pageOffset === 0 && rawEvents) setLoadedEvents([])
      return
    }
    if (processedOffsetRef.current === pageOffset) return
    processedOffsetRef.current = pageOffset

    if (pageOffset === 0) {
      setLoadedEvents(rawEvents)
    } else {
      setLoadedEvents(prev => {
        const existingIds = new Set(prev.map(e => e.id))
        const newOnes = rawEvents.filter(e => !existingIds.has(e.id))
        return newOnes.length > 0 ? [...prev, ...newOnes] : prev
      })
    }
  }, [rawEvents, pageOffset])

  useEffect(() => {
    processedOffsetRef.current = -1
  }, [filterKey])

  const totalCount = queryResult?.totalCount || 0
  const hasMore = queryResult?.pageHasMore || false

  // ── Client-side tier + segment filtering ──
  const filteredEvents = useMemo(() => {
    return loadedEvents.filter(e => {
      const { tier } = classifyActivityEvent(e)
      if (!passesTierFilter(tier, tierFilter)) return false
      if (!matchesEventSegment(e, segment)) return false
      return true
    })
  }, [loadedEvents, tierFilter, segment])

  // ── Cluster filtered events ──
  const feedItems = useMemo(() => clusterEvents(filteredEvents), [filteredEvents])

  // ── Day grouping with counts ──
  const dayGroups = useMemo(() => {
    const groups: { dayKey: string; dayLabel: string; items: FeedItem[]; eventCount: number; coreCount: number }[] = []
    let currentKey = ''

    for (const item of feedItems) {
      const ts = item.kind === 'event' ? item.event.occurred_at : item.cluster.timeEnd
      const key = getDayKey(ts)
      if (key !== currentKey) {
        currentKey = key
        groups.push({ dayKey: key, dayLabel: getDayLabel(ts), items: [], eventCount: 0, coreCount: 0 })
      }
      const g = groups[groups.length - 1]
      g.items.push(item)
      if (item.kind === 'event') {
        g.eventCount++
        if (item.tier === 'core') g.coreCount++
      } else {
        g.eventCount += item.cluster.count
        // Count core events inside cluster
        for (const e of item.cluster.events) {
          if (classifyActivityEvent(e).tier === 'core') g.coreCount++
        }
      }
    }
    return groups
  }, [feedItems])

  // ── Handlers ──
  const handleSelectEvent = useCallback((event: AuditEvent) => {
    setInspectorTarget({ kind: 'event', event })
  }, [])

  const handleSelectCluster = useCallback((cluster: EventCluster) => {
    setInspectorTarget({ kind: 'cluster', cluster })
  }, [])

  const handleSelectEventInCluster = useCallback((event: AuditEvent) => {
    for (const item of feedItems) {
      if (item.kind === 'cluster' && item.cluster.events.some(e => e.id === event.id)) {
        setInspectorTarget({ kind: 'cluster', cluster: item.cluster, focusedEvent: event })
        return
      }
    }
    setInspectorTarget({ kind: 'event', event })
  }, [feedItems])

  const handleLoadMore = useCallback(() => {
    setPageOffset(prev => prev + PAGE_SIZE)
  }, [])

  const handleExport = useCallback(() => {
    if (!loadedEvents.length) return
    const csv = [
      ['Timestamp', 'Actor', 'Action', 'Category', 'Entity Type', 'Entity', 'Asset', 'Tier', 'Changed Fields'].join(','),
      ...loadedEvents.map(e => [
        e.occurred_at,
        e.actor_name || e.actor_email || e.actor_id || 'System',
        e.action_type, e.action_category, e.entity_type,
        e.entity_display_name || e.entity_id,
        e.asset_symbol || '',
        classifyActivityEvent(e).tier,
        (e.changed_fields || []).join(';'),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `activity-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [loadedEvents])

  const hasSecondaryFilters = entityTypeFilter !== 'all' || categoryFilter !== 'all'
  const handleResetFilters = useCallback(() => {
    setTierFilter('core')
    setSegment('all')
    setEntityTypeFilter('all')
    setCategoryFilter('all')
    setSearchInput('')
    setDebouncedSearch('')
  }, [])

  // Close drawer on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && inspectorTarget) setInspectorTarget(null)
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [inspectorTarget])

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* ─── Filter Bar ─── */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* Primary row */}
        <div className="max-w-[1100px] mx-auto px-4 py-2 flex items-center gap-2 flex-wrap">
          {/* Scope */}
          <div className="relative">
            <select value={scope} onChange={e => setScope(e.target.value as ScopeMode)}
              className="appearance-none bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg pl-3 pr-7 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500">
              {SCOPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Users className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
          </div>

          {/* Time range */}
          <div className="relative">
            <select value={timeRange} onChange={e => setTimeRange(e.target.value)}
              className="appearance-none bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg pl-3 pr-7 py-1.5 text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500">
              {TIME_RANGES.map(r => <option key={r.id} value={r.id}>Last {r.label}</option>)}
            </select>
            <Clock className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
          </div>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />

          {/* Tier toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
            {TIER_OPTIONS.map(t => (
              <button key={t.value} onClick={() => setTierFilter(t.value)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium transition-colors',
                  tierFilter === t.value
                    ? 'bg-primary-600 text-white dark:bg-primary-500'
                    : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600',
                )}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />

          {/* Search */}
          <div className="relative flex-1 max-w-[200px] min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search..."
              className="w-full pl-7 pr-7 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setDebouncedSearch('') }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* More filters toggle */}
          <button onClick={() => setShowSecondaryFilters(!showSecondaryFilters)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border transition-colors',
              showSecondaryFilters || hasSecondaryFilters
                ? 'bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-400'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300',
            )}>
            <Layers className="h-3 w-3" />
            Filters
            {hasSecondaryFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />}
          </button>

          <div className="flex-1" />

          {/* Stats */}
          <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
            {filteredEvents.length !== loadedEvents.length
              ? `${filteredEvents.length} shown · ${totalCount.toLocaleString()} total`
              : `${totalCount.toLocaleString()} events`
            }
          </span>
          <button onClick={handleExport} disabled={!loadedEvents.length}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 disabled:opacity-40" title="Export CSV">
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Segment row */}
        <div className="max-w-[1100px] mx-auto px-4 pb-2 flex items-center gap-1.5">
          {SEGMENT_OPTIONS.map(s => (
            <button key={s.value} onClick={() => setSegment(s.value)}
              className={clsx(
                'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                segment === s.value
                  ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
              )}>
              {s.label}
            </button>
          ))}

          {(segment !== 'all' || hasSecondaryFilters || searchInput) && (
            <>
              <div className="flex-1" />
              <button onClick={handleResetFilters} className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline">
                Reset all
              </button>
            </>
          )}
        </div>

        {/* Secondary filters (entity type + category) */}
        {showSecondaryFilters && (
          <div className="max-w-[1100px] mx-auto px-4 pb-2 flex items-center gap-2 border-t border-gray-100 dark:border-gray-700 pt-2">
            <span className="text-[11px] text-gray-400 dark:text-gray-500 mr-1">Filter by:</span>
            <select value={entityTypeFilter} onChange={e => setEntityTypeFilter(e.target.value)}
              className="appearance-none bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1 pr-6 text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500">
              {ENTITY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="appearance-none bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1 pr-6 text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500">
              {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {hasSecondaryFilters && (
              <button onClick={() => { setEntityTypeFilter('all'); setCategoryFilter('all') }}
                className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline">
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Content Area ─── */}
      <div className="flex-1 min-h-0 relative">
        {/* Feed */}
        <div className="h-full overflow-y-auto">
          <div className="max-w-[1100px] mx-auto">
            {isLoading && pageOffset === 0 ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">Loading activity...</span>
              </div>
            ) : filteredEvents.length === 0 && !isFetching ? (
              <div className="p-8">
                <EmptyState
                  icon={Activity}
                  title={tierFilter === 'core' ? 'No core events' : 'No activity found'}
                  description={
                    tierFilter === 'core'
                      ? 'No institutional-memory events match your filters. Try expanding to "+ Detail" or "All" to see more.'
                      : 'No events match your current filters. Try adjusting the scope, time range, or filters.'
                  }
                  compact
                />
              </div>
            ) : (
              <div>
                {dayGroups.map(group => (
                  <div key={group.dayKey}>
                    {/* Day header */}
                    <div className="sticky top-0 z-10 px-3 py-1 bg-gray-100/95 dark:bg-gray-800/95 backdrop-blur-sm border-b border-gray-200/40 dark:border-gray-700/40">
                      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{group.dayLabel}</span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-1.5">
                        — {group.eventCount} event{group.eventCount !== 1 ? 's' : ''}
                        {tierFilter !== 'core' && group.coreCount > 0 && ` (${group.coreCount} core)`}
                      </span>
                    </div>
                    {/* Events */}
                    <div className="divide-y divide-gray-100/80 dark:divide-gray-800/60">
                      {group.items.map(item => {
                        if (item.kind === 'cluster') {
                          const isSelected = inspectorTarget?.kind === 'cluster' && inspectorTarget.cluster.id === item.cluster.id
                          return (
                            <ClusterRow key={item.cluster.id} cluster={item.cluster}
                              isSelected={isSelected}
                              onSelectCluster={handleSelectCluster}
                              onSelectEvent={handleSelectEventInCluster} />
                          )
                        }
                        const isSelected = inspectorTarget?.kind === 'event' && inspectorTarget.event.id === item.event.id
                        return (
                          <EventRow key={item.event.id} event={item.event} tier={item.tier}
                            isSelected={isSelected} onClick={handleSelectEvent} />
                        )
                      })}
                    </div>
                  </div>
                ))}

                {/* Pagination footer */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
                    Loaded {loadedEvents.length.toLocaleString()} of {totalCount.toLocaleString()}
                    {filteredEvents.length !== loadedEvents.length && ` · ${filteredEvents.length} visible`}
                  </span>
                  {hasMore && (
                    <button onClick={handleLoadMore} disabled={isFetching}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 transition-colors">
                      {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
                      Load more
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Slide-over Drawer */}
        {inspectorTarget && (
          <>
            {/* Backdrop (click to close) */}
            <div
              className="absolute inset-0 z-10"
              onClick={() => setInspectorTarget(null)}
            />
            {/* Drawer panel */}
            <div className="absolute inset-y-0 right-0 w-[400px] z-20">
              {inspectorTarget.kind === 'cluster'
                ? <ClusterDrawer cluster={inspectorTarget.cluster} focusedEvent={inspectorTarget.focusedEvent} onClose={() => setInspectorTarget(null)} onNavigate={onNavigate} />
                : <EventDrawer event={inspectorTarget.event} onClose={() => setInspectorTarget(null)} onNavigate={onNavigate} />
              }
            </div>
          </>
        )}
      </div>
    </div>
  )
}
