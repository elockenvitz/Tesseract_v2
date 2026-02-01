/**
 * AttentionPage - Full attention center view
 *
 * Provides an expanded view of all attention items with:
 * - All sections visible with no item limits
 * - Filter by attention type
 * - Resolution actions inline
 */

import { useState } from 'react'
import { RefreshCw, AlertCircle, Clock, Filter, CheckCircle, Scale, Newspaper, Users } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { useAttention } from '../hooks/useAttention'
import { AttentionSection } from '../components/attention/AttentionSection'
import type { QuickCaptureMode } from '../components/attention/AttentionCard'
import type { AttentionItem, AttentionType } from '../types/attention'

interface AttentionPageProps {
  initialFilter?: AttentionType
  onNavigate: (result: any) => void
}

export function AttentionPage({ initialFilter, onNavigate }: AttentionPageProps) {
  const [filterType, setFilterType] = useState<AttentionType | 'all'>(initialFilter || 'all')

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
  } = useAttention({ windowHours: 168 }) // 7 days for full view

  // Section order
  const sectionOrder: AttentionType[] = [
    'informational',
    'action_required',
    'decision_required',
    'alignment',
  ]

  // Filter sections if a type is selected
  const visibleSections = filterType === 'all'
    ? sectionOrder
    : sectionOrder.filter(type => type === filterType)

  // Handle navigation from attention items
  const handleItemNavigate = (item: AttentionItem) => {
    const { source_type, source_id, title, context } = item

    switch (source_type) {
      case 'project':
        onNavigate({ id: source_id, title, type: 'project', data: { id: source_id } })
        break
      case 'project_deliverable':
        onNavigate({
          id: context?.project_id || source_id,
          title: item.subtitle || 'Project',
          type: 'project',
          data: { id: context?.project_id || source_id }
        })
        break
      case 'trade_queue_item':
        onNavigate({
          id: 'trade-queue',
          title: 'Trade Queue',
          type: 'trade-queue',
          data: { selectedTradeId: source_id }
        })
        break
      case 'list_suggestion':
        onNavigate({
          id: context?.list_id || source_id,
          title: 'List',
          type: 'list',
          data: { id: context?.list_id || source_id }
        })
        break
      case 'notification':
        if (context?.asset_id) {
          onNavigate({ id: context.asset_id, title, type: 'asset', data: { id: context.asset_id } })
        } else if (context?.project_id) {
          onNavigate({ id: context.project_id, title, type: 'project', data: { id: context.project_id } })
        }
        break
      case 'workflow_item':
        onNavigate({ id: 'workflows', title: 'Workflows', type: 'workflows', data: null })
        break
      case 'quick_thought':
        onNavigate({ id: 'ideas', title: 'Ideas', type: 'ideas', data: { selectedThoughtId: source_id } })
        break
      default:
        if (context?.asset_id) {
          onNavigate({ id: context.asset_id, title, type: 'asset', data: { id: context.asset_id } })
        } else if (context?.project_id) {
          onNavigate({ id: context.project_id, title, type: 'project', data: { id: context.project_id } })
        } else {
          const parts = item.source_url.split('/')
          const type = parts[1]
          const id = parts[2]
          onNavigate({ id: id || type, title, type: type as any, data: { id } })
        }
    }
  }

  // Handle quick capture
  const handleQuickCapture = (item: AttentionItem, mode: QuickCaptureMode) => {
    let contextType: string | undefined
    let contextId: string | undefined
    let contextTitle: string | undefined

    if (item.source_type === 'project' || item.source_type === 'project_deliverable') {
      contextType = 'project'
      contextId = item.context?.project_id || item.source_id
      contextTitle = item.title
    } else if (item.source_type === 'trade_queue_item') {
      onNavigate({ id: 'trade-queue', title: 'Trade Queue', type: 'trade-queue', data: { selectedTradeId: item.source_id } })
      return
    } else if (item.context?.asset_id) {
      contextType = 'asset'
      contextId = item.context.asset_id
      contextTitle = item.title
    } else if (item.context?.list_id) {
      contextType = 'list'
      contextId = item.context.list_id
      contextTitle = item.title
    }

    window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
      detail: { contextType, contextId, contextTitle }
    }))
  }

  // Filter tabs matching the four priority sections
  const filterTabs: { id: AttentionType | 'all'; label: string; icon: React.ElementType; count: number }[] = [
    { id: 'all', label: 'All', icon: Filter, count: counts.total },
    { id: 'informational', label: "What's New", icon: Newspaper, count: counts.informational },
    { id: 'action_required', label: 'To Do', icon: CheckCircle, count: counts.action_required },
    { id: 'decision_required', label: 'Decisions', icon: Scale, count: counts.decision_required },
    { id: 'alignment', label: 'Team', icon: Users, count: counts.alignment },
  ]

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 rounded-xl bg-gray-100 animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  // Error state
  if (isError) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <div>
                <h3 className="text-sm font-medium text-red-800">
                  Failed to load attention items
                </h3>
                <p className="text-sm text-red-600 mt-1">
                  {error instanceof Error ? error.message : 'An unknown error occurred'}
                </p>
              </div>
            </div>
            <button
              onClick={() => refetch()}
              className="mt-4 px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">All Priorities</h1>
            <p className="text-sm text-gray-500 mt-1">
              What needs attention right now
            </p>
          </div>

          <div className="flex items-center gap-3">
            {generatedAt && (
              <span className="text-xs text-gray-400">
                Updated {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}
              </span>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className={clsx(
                'p-2 rounded-lg hover:bg-gray-100 transition-colors',
                isFetching && 'opacity-50'
              )}
              title="Refresh"
            >
              <RefreshCw
                className={clsx(
                  'w-5 h-5 text-gray-500',
                  isFetching && 'animate-spin'
                )}
              />
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
          {filterTabs.map(tab => {
            const Icon = tab.icon
            const isActive = filterType === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
                  isActive
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                )}
              >
                <Icon className={clsx('h-4 w-4', isActive && 'text-primary-500')} />
                <span>{tab.label}</span>
                <span className={clsx(
                  'px-1.5 py-0.5 rounded-full text-xs font-semibold',
                  isActive ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-600'
                )}>
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Empty state */}
        {!hasItems && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-6 h-6 text-gray-400" />
            </div>
            <h3 className="text-sm font-medium text-gray-900">
              All caught up!
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              No attention items at the moment. Check back later.
            </p>
          </div>
        )}

        {/* Attention sections - no item limit */}
        {hasItems && visibleSections.map((type) => (
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
            maxItems={100} // Show all items
            showScore={import.meta.env.DEV}
            initialExpanded={true}
          />
        ))}
      </div>
    </div>
  )
}

export default AttentionPage
