/**
 * PrioritizerPage — "My Priorities"
 *
 * Surfaces aging, decay, and things needing attention across the user's
 * investment process. Built on the useAttention system which scores,
 * categorizes, and provides inline resolution actions.
 *
 * Sections (ordered by urgency):
 *   1. Decisions — trade approvals, rejections, deferrals
 *   2. Action Required — deliverables, tasks, follow-ups
 *   3. What's New — relevant activity from others
 *   4. Team Alignment — shared awareness items
 */

import { useState } from 'react'
import {
  RefreshCw, AlertCircle, Clock, Scale, CheckCircle, Newspaper, Users,
  Filter, AlertTriangle, Activity,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { useAttention } from '../hooks/useAttention'
import { AttentionSection } from '../components/attention/AttentionSection'
import type { QuickCaptureMode } from '../components/attention/AttentionCard'
import type { AttentionItem, AttentionType } from '../types/attention'

interface PrioritizerPageProps {
  onItemSelect?: (item: any) => void
}

// Reorder sections: decisions first (highest urgency), then actions, then info
const SECTION_ORDER: AttentionType[] = [
  'decision_required',
  'action_required',
  'informational',
  'alignment',
]

const FILTER_TABS: { id: AttentionType | 'all'; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'All', icon: Filter },
  { id: 'decision_required', label: 'Decisions', icon: Scale },
  { id: 'action_required', label: 'Action Needed', icon: CheckCircle },
  { id: 'informational', label: "What's New", icon: Newspaper },
  { id: 'alignment', label: 'Team', icon: Users },
]

export function PrioritizerPage({ onItemSelect }: PrioritizerPageProps) {
  const [filterType, setFilterType] = useState<AttentionType | 'all'>('all')

  const {
    sections,
    counts,
    generatedAt,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    acknowledge,
    snoozeFor,
    dismiss,
    hasItems,
    markDeliverableDone,
    approveTradeIdea,
    rejectTradeIdea,
    deferTradeIdea,
    dismissWithReason,
  } = useAttention({ windowHours: 168 }) // 7 days

  const onNavigate = onItemSelect || (() => {})

  const handleItemNavigate = (item: AttentionItem) => {
    const { source_type, source_id, title, context } = item
    switch (source_type) {
      case 'project':
        onNavigate({ id: source_id, title, type: 'project', data: { id: source_id } })
        break
      case 'project_deliverable':
        onNavigate({ id: context?.project_id || source_id, title: item.subtitle || 'Project', type: 'project', data: { id: context?.project_id || source_id } })
        break
      case 'trade_queue_item':
        onNavigate({ id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue', data: { selectedTradeId: source_id } })
        break
      case 'list_suggestion':
        onNavigate({ id: context?.list_id || source_id, title: 'List', type: 'list', data: { id: context?.list_id || source_id } })
        break
      case 'notification':
        if (context?.asset_id) onNavigate({ id: context.asset_id, title, type: 'asset', data: { id: context.asset_id } })
        else if (context?.project_id) onNavigate({ id: context.project_id, title, type: 'project', data: { id: context.project_id } })
        break
      case 'quick_thought':
        onNavigate({ id: 'idea-generator', title: 'Ideas', type: 'idea-generator', data: { selectedThoughtId: source_id } })
        break
      default:
        if (context?.asset_id) onNavigate({ id: context.asset_id, title, type: 'asset', data: { id: context.asset_id } })
        else if (context?.project_id) onNavigate({ id: context.project_id, title, type: 'project', data: { id: context.project_id } })
    }
  }

  const handleQuickCapture = (item: AttentionItem, mode: QuickCaptureMode) => {
    if (item.source_type === 'trade_queue_item') {
      onNavigate({ id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue', data: { selectedTradeId: item.source_id } })
      return
    }
    let contextType: string | undefined, contextId: string | undefined, contextTitle: string | undefined
    if (item.source_type === 'project' || item.source_type === 'project_deliverable') {
      contextType = 'project'; contextId = item.context?.project_id || item.source_id; contextTitle = item.title
    } else if (item.context?.asset_id) {
      contextType = 'asset'; contextId = item.context.asset_id; contextTitle = item.title
    }
    window.dispatchEvent(new CustomEvent('openThoughtsCapture', { detail: { contextType, contextId, contextTitle } }))
  }

  const visibleSections = filterType === 'all' ? SECTION_ORDER : SECTION_ORDER.filter(t => t === filterType)

  // Compute headline from counts
  const headline = generateHeadline(counts)

  if (isLoading) {
    return (
      <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
          <div className="h-6 w-72 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-4 w-48 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          <div className="flex gap-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-10 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />)}</div>
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <div>
                <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Failed to load priorities</h3>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
              </div>
            </div>
            <button onClick={() => refetch()} className="mt-4 px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50">Try again</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto px-6 py-5 space-y-5">

        {/* ═══ HEADER ═══ */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">My Priorities</h1>
            {headline && (
              <p className={clsx('text-sm mt-0.5 font-medium',
                counts.decision_required > 0 || counts.action_required > 3
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-gray-500 dark:text-gray-400'
              )}>
                {headline}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {generatedAt && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}
              </span>
            )}
            <button onClick={() => refetch()} disabled={isFetching}
              className={clsx('p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors', isFetching && 'opacity-50')}>
              <RefreshCw className={clsx('w-4 h-4 text-gray-500', isFetching && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* ═══ SUMMARY STRIP ═══ */}
        <div className="flex items-center gap-3 flex-wrap">
          {counts.decision_required > 0 && (
            <SummaryBadge icon={Scale} count={counts.decision_required} label="decisions" severity="critical" />
          )}
          {counts.action_required > 0 && (
            <SummaryBadge icon={AlertTriangle} count={counts.action_required} label="action needed" severity="warning" />
          )}
          {counts.informational > 0 && (
            <SummaryBadge icon={Activity} count={counts.informational} label="updates" severity="info" />
          )}
          {counts.alignment > 0 && (
            <SummaryBadge icon={Users} count={counts.alignment} label="team items" severity="muted" />
          )}
        </div>

        {/* ═══ FILTER TABS ═══ */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
          {FILTER_TABS.map(tab => {
            const Icon = tab.icon
            const isActive = filterType === tab.id
            const count = tab.id === 'all' ? counts.total : counts[tab.id as AttentionType]
            return (
              <button key={tab.id} onClick={() => setFilterType(tab.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                  isActive ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}>
                <Icon className={clsx('h-3.5 w-3.5', isActive && 'text-primary-500')} />
                {tab.label}
                {count > 0 && (
                  <span className={clsx('px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                    isActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                  )}>{count}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* ═══ SECTIONS ═══ */}
        {!hasItems ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-12 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-500" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">All clear</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
              Nothing needs your attention right now. Decisions are resolved, work is progressing, and nothing is stale.
            </p>
          </div>
        ) : (
          visibleSections.map(type => (
            <AttentionSection
              key={type}
              type={type}
              items={sections[type]}
              totalCount={counts[type]}
              onNavigate={handleItemNavigate}
              onAcknowledge={acknowledge}
              onSnooze={snoozeFor}
              onDismiss={dismiss}
              onDismissWithReason={dismissWithReason}
              onMarkDone={markDeliverableDone}
              onApprove={approveTradeIdea}
              onReject={rejectTradeIdea}
              onDefer={deferTradeIdea}
              onQuickCapture={handleQuickCapture}
              maxItems={50}
              showScore={false}
              initialExpanded={true}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary badge
// ---------------------------------------------------------------------------

function SummaryBadge({ icon: Icon, count, label, severity }: {
  icon: React.ElementType; count: number; label: string
  severity: 'critical' | 'warning' | 'info' | 'muted'
}) {
  const cls = {
    critical: 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800',
    warning: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800',
    info: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800',
    muted: 'text-gray-600 bg-gray-100 border-gray-200 dark:text-gray-400 dark:bg-gray-700/60 dark:border-gray-600',
  }[severity]

  return (
    <div className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold', cls)}>
      <Icon className="w-3.5 h-3.5" />
      <span className="font-bold">{count}</span>
      <span className="opacity-80">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Headline generator
// ---------------------------------------------------------------------------

function generateHeadline(counts: Record<string, number>): string {
  const decisions = counts.decision_required || 0
  const actions = counts.action_required || 0
  const total = counts.total || 0

  if (decisions > 0 && actions > 0) {
    return `${decisions} decision${decisions > 1 ? 's' : ''} waiting + ${actions} item${actions > 1 ? 's' : ''} need action`
  }
  if (decisions > 0) {
    return `${decisions} decision${decisions > 1 ? 's' : ''} awaiting your judgment`
  }
  if (actions > 3) {
    return `${actions} items need your attention`
  }
  if (actions > 0) {
    return `${actions} item${actions > 1 ? 's' : ''} to address`
  }
  if (total > 0) {
    return `${total} item${total > 1 ? 's' : ''} to review`
  }
  return 'Nothing needs attention right now'
}

export default PrioritizerPage
