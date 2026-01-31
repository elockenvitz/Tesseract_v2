/**
 * AttentionCard - Individual priority tile
 *
 * Design philosophy: "Priorities should be resolved, not hidden"
 *
 * Action layouts by attention_type:
 * - informational: Acknowledge (primary), Add thought (secondary), overflow: Not relevant...
 * - action_required: Done (primary), Defer (secondary), overflow: Not relevant...
 * - decision_required: Approve (primary), Reject (secondary), Defer (tertiary), overflow: Add rationale + Not relevant...
 * - alignment: Open (primary), overflow: optional
 */

import { useState, useRef, useEffect } from 'react'
import { formatDistanceToNow, format, isPast, differenceInDays, differenceInMonths, differenceInWeeks } from 'date-fns'
import {
  CheckSquare,
  Workflow,
  FolderKanban,
  ListTodo,
  Scale,
  Lightbulb,
  FileText,
  MessageSquare,
  TrendingUp,
  Users,
  File,
  ArrowLeftRight,
  ListPlus,
  Bell,
  Circle,
  Clock,
  Check,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  PauseCircle,
  Loader2,
  PenLine,
  RotateCcw,
  AlertCircle,
  MoreHorizontal,
  XCircle,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { AttentionItem, AttentionType, AttentionSourceType } from '../../types/attention'

// Dismiss reason type
export type DismissReason = 'duplicate' | 'incorrect_signal' | 'not_my_responsibility' | 'no_longer_relevant'

// Icon mapping
const SOURCE_ICONS: Record<string, React.ElementType> = {
  task: CheckSquare,
  workflow_item: Workflow,
  project: FolderKanban,
  project_deliverable: ListTodo,
  decision: Scale,
  idea: Lightbulb,
  note: FileText,
  message: MessageSquare,
  asset_event: TrendingUp,
  coverage_change: Users,
  file: File,
  trade_queue_item: ArrowLeftRight,
  list_suggestion: ListPlus,
  notification: Bell,
  custom: Circle,
}

// Severity colors
const SEVERITY_COLORS = {
  low: 'text-gray-500',
  medium: 'text-amber-500',
  high: 'text-orange-500',
  critical: 'text-red-500',
}

const SEVERITY_BG = {
  low: 'bg-gray-50',
  medium: 'bg-amber-50',
  high: 'bg-orange-50',
  critical: 'bg-red-50',
}

// Quick capture mode type
export type QuickCaptureMode = 'thought' | 'rationale' | 'note'

// Resolution state for animation
export type ResolutionState = 'none' | 'resolving' | 'resolved'

interface AttentionCardProps {
  item: AttentionItem
  onNavigate: (item: AttentionItem) => void
  onAcknowledge?: (id: string) => void
  onSnooze?: (id: string, hours: number) => void
  onDismiss?: (id: string) => void
  onDismissWithReason?: (id: string, reason: DismissReason, note?: string) => Promise<void>
  // Inline resolution actions
  onMarkDone?: (sourceId: string) => Promise<void>
  onApprove?: (sourceId: string) => Promise<void>
  onReject?: (sourceId: string) => Promise<void>
  onDefer?: (sourceId: string, hours: number) => Promise<void>
  onQuickCapture?: (item: AttentionItem, mode: QuickCaptureMode) => void
  showScore?: boolean
  compact?: boolean
}

/**
 * Generate an action-forward title based on source_type and attention_type
 */
function getActionTitle(item: AttentionItem): { actionTitle: string; objectName: string | null } {
  const { title, source_type, attention_type } = item

  const actionVerbs: Record<AttentionType, string> = {
    action_required: 'Complete',
    decision_required: 'Decide on',
    informational: 'Review',
    alignment: 'Check in on',
  }

  const sourceVerbs: Partial<Record<AttentionSourceType, Record<AttentionType, string>>> = {
    project: {
      action_required: 'Update',
      decision_required: 'Review',
      informational: 'Check',
      alignment: 'Sync on',
    },
    project_deliverable: {
      action_required: 'Complete',
      decision_required: 'Review',
      informational: 'Check',
      alignment: 'Sync on',
    },
    trade_queue_item: {
      action_required: 'Execute',
      decision_required: 'Decide on',
      informational: 'Review',
      alignment: 'Discuss',
    },
    idea: {
      action_required: 'Develop',
      decision_required: 'Evaluate',
      informational: 'Consider',
      alignment: 'Discuss',
    },
    note: {
      action_required: 'Address',
      decision_required: 'Review',
      informational: 'Read',
      alignment: 'Share',
    },
    workflow_item: {
      action_required: 'Process',
      decision_required: 'Approve',
      informational: 'Check',
      alignment: 'Coordinate',
    },
    list_suggestion: {
      action_required: 'Add',
      decision_required: 'Review',
      informational: 'Consider',
      alignment: 'Discuss',
    },
  }

  const verb = sourceVerbs[source_type]?.[attention_type] || actionVerbs[attention_type]

  const sourceLabels: Partial<Record<AttentionSourceType, string>> = {
    project: 'project',
    project_deliverable: 'deliverable',
    trade_queue_item: 'trade',
    idea: 'idea',
    workflow_item: 'workflow',
    list_suggestion: 'suggestion',
    note: 'note',
    task: 'task',
  }

  const sourceLabel = sourceLabels[source_type]
  const startsWithVerb = /^(Review|Complete|Decide|Update|Check|Execute|Approve|Add|Process|Consider|Read|Evaluate|Develop|Address|Discuss|Sync)/i.test(title)

  if (startsWithVerb) {
    return { actionTitle: title, objectName: null }
  }

  const actionTitle = sourceLabel
    ? `${verb} ${title} ${sourceLabel}`
    : `${verb} ${title}`

  return { actionTitle, objectName: title }
}

/**
 * Generate urgency line
 */
function getUrgencyLine(item: AttentionItem): string | null {
  const now = new Date()
  const dueDate = item.due_at ? new Date(item.due_at) : null
  const lastActivity = new Date(item.last_activity_at)
  const createdAt = new Date(item.created_at)

  const daysSinceActivity = differenceInDays(now, lastActivity)
  const weeksSinceActivity = differenceInWeeks(now, lastActivity)
  const monthsSinceActivity = differenceInMonths(now, lastActivity)

  if (dueDate && isPast(dueDate)) {
    const daysOverdue = differenceInDays(now, dueDate)
    const weeksOverdue = differenceInWeeks(now, dueDate)
    const monthsOverdue = differenceInMonths(now, dueDate)

    let overdueText: string
    if (monthsOverdue >= 1) {
      overdueText = `Overdue by ~${monthsOverdue} month${monthsOverdue > 1 ? 's' : ''}`
    } else if (weeksOverdue >= 1) {
      overdueText = `Overdue by ~${weeksOverdue} week${weeksOverdue > 1 ? 's' : ''}`
    } else if (daysOverdue >= 1) {
      overdueText = `Overdue by ${daysOverdue} day${daysOverdue > 1 ? 's' : ''}`
    } else {
      overdueText = 'Overdue since earlier today'
    }

    if (monthsSinceActivity >= 1) {
      return `${overdueText} — no updates in ${monthsSinceActivity} month${monthsSinceActivity > 1 ? 's' : ''}`
    } else if (weeksSinceActivity >= 2) {
      return `${overdueText} — no updates in ${weeksSinceActivity} weeks`
    }
    return overdueText
  }

  if (dueDate) {
    const daysUntilDue = differenceInDays(dueDate, now)
    if (daysUntilDue === 0) return 'Due today — needs your attention now'
    if (daysUntilDue === 1) return 'Due tomorrow — plan your response'
    if (daysUntilDue <= 3) return `Due in ${daysUntilDue} days — getting close`
    if (daysUntilDue <= 7) return `Due this week (${format(dueDate, 'EEEE')})`
  }

  if (monthsSinceActivity >= 2) return `No activity for ${monthsSinceActivity} months — may need attention`
  if (monthsSinceActivity >= 1) return `No activity for over a month — review needed`
  if (weeksSinceActivity >= 2) return `No updates in ${weeksSinceActivity} weeks`

  if (item.status === 'waiting' || item.status === 'blocked') {
    const daysWaiting = differenceInDays(now, createdAt)
    if (daysWaiting >= 7) return `Waiting for ${daysWaiting} days — follow up needed`
    if (daysWaiting >= 3) return `Blocked for ${daysWaiting} days`
  }

  if (item.severity === 'critical' || item.severity === 'high') {
    if (daysSinceActivity <= 1) return 'Recently flagged as high priority'
  }

  return null
}

/**
 * Get single memory badge
 */
function getMemoryBadge(item: AttentionItem): { label: string; icon: React.ElementType } | null {
  const now = new Date()
  const lastActivity = new Date(item.last_activity_at)
  const daysSinceActivity = differenceInDays(now, lastActivity)
  const monthsSinceActivity = differenceInMonths(now, lastActivity)

  const deferredBreakdown = item.score_breakdown?.find(b =>
    b.key.toLowerCase().includes('defer') || b.key.toLowerCase().includes('snooze')
  )
  if (deferredBreakdown && deferredBreakdown.value > 0) {
    return { label: 'Deferred previously', icon: RotateCcw }
  }

  if (item.participant_user_ids && item.participant_user_ids.length > 2) {
    return { label: `${item.participant_user_ids.length} contributors`, icon: Users }
  }

  if (monthsSinceActivity >= 2) {
    return { label: `No activity for ${monthsSinceActivity} months`, icon: Clock }
  } else if (daysSinceActivity >= 14) {
    return { label: `Last touched ${daysSinceActivity} days ago`, icon: Clock }
  }

  if (item.status === 'waiting' || item.status === 'blocked') {
    const createdAt = new Date(item.created_at)
    const daysWaiting = differenceInDays(now, createdAt)
    if (daysWaiting >= 5) {
      return { label: `Waiting ${daysWaiting} days`, icon: Clock }
    }
  }

  return null
}

// Dismiss reason labels
const DISMISS_REASON_OPTIONS: { value: DismissReason; label: string }[] = [
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'incorrect_signal', label: 'Incorrect signal' },
  { value: 'not_my_responsibility', label: 'Not my responsibility' },
  { value: 'no_longer_relevant', label: 'No longer relevant' },
]

/**
 * Not Relevant Popover - requires reason selection
 */
function NotRelevantPopover({
  isOpen,
  onClose,
  onConfirm,
  isPending,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: (reason: DismissReason, note?: string) => void
  isPending: boolean
}) {
  const [selectedReason, setSelectedReason] = useState<DismissReason | null>(null)
  const [note, setNote] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) {
      setSelectedReason(null)
      setNote('')
    }
  }, [isOpen])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-1 w-72 p-3 bg-white border border-gray-200 rounded-lg shadow-lg z-20"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-3">
        <XCircle className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-700">Why isn't this relevant?</span>
      </div>

      <div className="space-y-2 mb-3">
        {DISMISS_REASON_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={clsx(
              'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors',
              selectedReason === option.value ? 'bg-gray-100' : 'hover:bg-gray-50'
            )}
          >
            <input
              type="radio"
              name="dismiss-reason"
              value={option.value}
              checked={selectedReason === option.value}
              onChange={() => setSelectedReason(option.value)}
              className="w-3.5 h-3.5 text-blue-600"
            />
            <span className="text-sm text-gray-700">{option.label}</span>
          </label>
        ))}
      </div>

      <input
        type="text"
        placeholder="Optional note..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded mb-3 focus:outline-none focus:ring-1 focus:ring-blue-400"
        onClick={(e) => e.stopPropagation()}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => selectedReason && onConfirm(selectedReason, note || undefined)}
          disabled={!selectedReason || isPending}
          className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
          ) : (
            'Confirm'
          )}
        </button>
      </div>
    </div>
  )
}

export function AttentionCard({
  item,
  onNavigate,
  onAcknowledge,
  onSnooze,
  onDismissWithReason,
  onMarkDone,
  onApprove,
  onReject,
  onDefer,
  onQuickCapture,
  showScore = false,
  compact = false,
}: AttentionCardProps) {
  const [showDeferMenu, setShowDeferMenu] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showNotRelevantPopover, setShowNotRelevantPopover] = useState(false)
  const [isActionPending, setIsActionPending] = useState<string | null>(null)
  const [resolutionState, setResolutionState] = useState<ResolutionState>('none')
  const [resolutionMessage, setResolutionMessage] = useState<string | null>(null)
  const [showScoreTooltip, setShowScoreTooltip] = useState(false)

  const Icon = SOURCE_ICONS[item.source_type] || Circle
  const { actionTitle, objectName } = getActionTitle(item)
  const urgencyLine = getUrgencyLine(item)
  const memoryBadge = getMemoryBadge(item)

  const handleClick = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (resolutionState !== 'resolved') {
      onNavigate(item)
    }
  }

  // Resolution handlers
  const handleAcknowledge = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onAcknowledge) return
    setIsActionPending('ack')
    try {
      await onAcknowledge(item.attention_id)
      setResolutionState('resolving')
      setResolutionMessage('Acknowledged')
      setTimeout(() => setResolutionState('resolved'), 200)
    } finally {
      setIsActionPending(null)
    }
  }

  const handleMarkDone = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onMarkDone || isActionPending) return
    setIsActionPending('done')
    try {
      await onMarkDone(item.source_id)
      setResolutionState('resolving')
      setResolutionMessage('Marked as done')
      setTimeout(() => setResolutionState('resolved'), 200)
    } finally {
      setIsActionPending(null)
    }
  }

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onApprove || isActionPending) return
    setIsActionPending('approve')
    try {
      await onApprove(item.source_id)
      setResolutionState('resolving')
      setResolutionMessage('Approved')
      setTimeout(() => setResolutionState('resolved'), 200)
    } finally {
      setIsActionPending(null)
    }
  }

  const handleReject = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onReject || isActionPending) return
    setIsActionPending('reject')
    try {
      await onReject(item.source_id)
      setResolutionState('resolving')
      setResolutionMessage('Rejected')
      setTimeout(() => setResolutionState('resolved'), 200)
    } finally {
      setIsActionPending(null)
    }
  }

  const handleDefer = async (e: React.MouseEvent, hours: number) => {
    e.stopPropagation()
    setShowDeferMenu(false)

    // For trade items, use onDefer; for others, use onSnooze
    if (item.source_type === 'trade_queue_item' && onDefer) {
      if (isActionPending) return
      setIsActionPending('defer')
      try {
        await onDefer(item.source_id, hours)
        setResolutionState('resolving')
        setResolutionMessage(hours >= 24 ? 'Deferred' : `Deferred ${hours}h`)
        setTimeout(() => setResolutionState('resolved'), 200)
      } finally {
        setIsActionPending(null)
      }
    } else if (onSnooze) {
      setIsActionPending('defer')
      try {
        await onSnooze(item.attention_id, hours)
        setResolutionState('resolving')
        setResolutionMessage(hours >= 24 ? 'Deferred' : `Deferred ${hours}h`)
        setTimeout(() => setResolutionState('resolved'), 200)
      } finally {
        setIsActionPending(null)
      }
    }
  }

  const handleAddThought = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowOverflowMenu(false)
    onQuickCapture?.(item, 'thought')
  }

  const handleAddRationale = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowOverflowMenu(false)
    onQuickCapture?.(item, 'rationale')
  }

  const handleNotRelevant = async (reason: DismissReason, note?: string) => {
    if (!onDismissWithReason) return
    setIsActionPending('dismiss')
    try {
      await onDismissWithReason(item.attention_id, reason, note)
      setShowNotRelevantPopover(false)
      setShowOverflowMenu(false)
      setResolutionState('resolving')
      setResolutionMessage('Removed')
      setTimeout(() => setResolutionState('resolved'), 200)
    } finally {
      setIsActionPending(null)
    }
  }

  if (resolutionState === 'resolved') {
    return null
  }

  // Compact view
  if (compact) {
    return (
      <div
        onClick={handleClick}
        className={clsx(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200',
          'hover:bg-gray-50 group',
          item.read_state === 'unread' && 'bg-blue-50/50',
          resolutionState === 'resolving' && 'opacity-50 scale-98 translate-x-2'
        )}
      >
        <div className={clsx('p-1.5 rounded', SEVERITY_BG[item.severity])}>
          <Icon className={clsx('w-4 h-4', SEVERITY_COLORS[item.severity])} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {actionTitle}
            </span>
            {urgencyLine && urgencyLine.includes('Overdue') && (
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            )}
          </div>
          {urgencyLine && (
            <p className="text-xs text-amber-600 truncate mt-0.5">
              {urgencyLine}
            </p>
          )}
        </div>

        <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    )
  }

  // Render action buttons based on attention_type
  const renderActions = () => {
    const { attention_type, source_type } = item

    switch (attention_type) {
      case 'informational':
        return (
          <>
            {/* Primary: Acknowledge */}
            {onAcknowledge && (
              <button
                onClick={handleAcknowledge}
                disabled={isActionPending === 'ack'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
              >
                {isActionPending === 'ack' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Acknowledge
              </button>
            )}

            {/* Secondary: Add thought */}
            {onQuickCapture && (
              <button
                onClick={handleAddThought}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
              >
                <PenLine className="w-3.5 h-3.5" />
                Add thought
              </button>
            )}
          </>
        )

      case 'action_required':
        return (
          <>
            {/* Primary: Done (for deliverables) or generic action */}
            {source_type === 'project_deliverable' && onMarkDone ? (
              <button
                onClick={handleMarkDone}
                disabled={isActionPending === 'done'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
              >
                {isActionPending === 'done' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Done
              </button>
            ) : (
              <button
                onClick={(e) => handleClick(e)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                Open
              </button>
            )}

            {/* Secondary: Defer */}
            {onSnooze && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowDeferMenu(!showDeferMenu)
                  }}
                  disabled={isActionPending === 'defer'}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
                >
                  {isActionPending === 'defer' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PauseCircle className="w-3.5 h-3.5" />
                  )}
                  Defer
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showDeferMenu && (
                  <div className="absolute left-0 top-full mt-1 py-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[120px]">
                    {[
                      { hours: 4, label: '4 hours' },
                      { hours: 24, label: 'Tomorrow' },
                      { hours: 168, label: 'Next week' },
                    ].map(({ hours, label }) => (
                      <button
                        key={hours}
                        onClick={(e) => handleDefer(e, hours)}
                        className="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )

      case 'decision_required':
        const isTradeItem = source_type === 'trade_queue_item'

        return (
          <>
            {/* Primary: Approve */}
            {isTradeItem && onApprove ? (
              <button
                onClick={handleApprove}
                disabled={isActionPending === 'approve'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-md shadow-sm transition-colors disabled:opacity-50"
              >
                {isActionPending === 'approve' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ThumbsUp className="w-3.5 h-3.5" />
                )}
                Approve
              </button>
            ) : (
              <button
                onClick={(e) => handleClick(e)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                Review
              </button>
            )}

            {/* Secondary: Reject */}
            {isTradeItem && onReject && (
              <button
                onClick={handleReject}
                disabled={isActionPending === 'reject'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50"
              >
                {isActionPending === 'reject' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ThumbsDown className="w-3.5 h-3.5" />
                )}
                Reject
              </button>
            )}

            {/* Tertiary: Defer (smaller visual weight) */}
            {(isTradeItem ? onDefer : onSnooze) && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowDeferMenu(!showDeferMenu)
                  }}
                  disabled={isActionPending === 'defer'}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                >
                  {isActionPending === 'defer' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <PauseCircle className="w-3 h-3" />
                  )}
                  Defer
                </button>

                {showDeferMenu && (
                  <div className="absolute left-0 top-full mt-1 py-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[120px]">
                    {[
                      { hours: 4, label: '4 hours' },
                      { hours: 24, label: 'Tomorrow' },
                      { hours: 168, label: 'Next week' },
                    ].map(({ hours, label }) => (
                      <button
                        key={hours}
                        onClick={(e) => handleDefer(e, hours)}
                        className="w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )

      case 'alignment':
        return (
          <>
            {/* Primary: Open */}
            <button
              onClick={(e) => handleClick(e)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
              Open
            </button>
          </>
        )

      default:
        return null
    }
  }

  // Render overflow menu items based on attention_type
  const renderOverflowItems = () => {
    const { attention_type } = item

    return (
      <>
        {/* Add rationale for decision_required */}
        {attention_type === 'decision_required' && onQuickCapture && (
          <button
            onClick={handleAddRationale}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50"
          >
            <PenLine className="w-3.5 h-3.5 text-gray-400" />
            Add rationale
          </button>
        )}

        {/* Not relevant - always available except alignment */}
        {attention_type !== 'alignment' && onDismissWithReason && (
          <>
            {attention_type === 'decision_required' && onQuickCapture && (
              <div className="border-t border-gray-100 my-1" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowNotRelevantPopover(true)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-red-600 hover:bg-red-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Not relevant…
            </button>
          </>
        )}
      </>
    )
  }

  const hasOverflowItems =
    (item.attention_type === 'decision_required' && onQuickCapture) ||
    (item.attention_type !== 'alignment' && onDismissWithReason)

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'relative p-4 rounded-lg border cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-gray-300',
        item.read_state === 'unread' ? 'bg-white border-blue-200' : 'bg-white border-gray-200',
        item.severity === 'critical' && 'border-l-4 border-l-red-500',
        item.severity === 'high' && 'border-l-4 border-l-orange-500',
        resolutionState === 'resolving' && 'opacity-60 scale-[0.98] translate-x-1'
      )}
    >
      {/* Resolution overlay */}
      {resolutionState === 'resolving' && resolutionMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-lg z-10">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
            <Check className="w-4 h-4 text-green-500" />
            {resolutionMessage}
          </div>
        </div>
      )}

      {/* Header with icon */}
      <div className="flex items-start gap-3">
        <div className={clsx('p-2 rounded-lg flex-shrink-0', SEVERITY_BG[item.severity])}>
          <Icon className={clsx('w-5 h-5', SEVERITY_COLORS[item.severity])} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Action-forward title */}
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900">
              {actionTitle}
            </h4>
            {item.read_state === 'unread' && (
              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            )}
          </div>

          {/* Object name secondary */}
          {objectName && objectName !== actionTitle && (
            <p className="text-xs text-gray-400 mt-0.5">{item.subtitle || objectName}</p>
          )}

          {/* Urgency line */}
          {urgencyLine && (
            <p className={clsx(
              'text-sm mt-2 font-medium',
              urgencyLine.includes('Overdue') ? 'text-red-600' :
              urgencyLine.includes('Due today') || urgencyLine.includes('Due tomorrow') ? 'text-amber-600' :
              'text-gray-600'
            )}>
              {urgencyLine}
            </p>
          )}

          {/* Fallback to reason_text */}
          {!urgencyLine && item.reason_text && (
            <p className="text-sm text-gray-600 mt-2">
              {item.reason_text}
            </p>
          )}

          {/* Next action */}
          {item.next_action && (
            <div className="mt-2 py-1.5 px-2 bg-gray-50 rounded border-l-2 border-blue-400">
              <p className="text-sm text-gray-700">
                <span className="font-semibold text-blue-600">Next action:</span>{' '}
                {item.next_action}
              </p>
            </div>
          )}

          {/* Memory badge */}
          {memoryBadge && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs text-gray-500 bg-gray-100 rounded-full">
                <memoryBadge.icon className="w-3 h-3" />
                {memoryBadge.label}
              </span>
            </div>
          )}

          {/* Tags */}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {item.tags.slice(0, 3).map((tag, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Score badge (dev only) */}
        {showScore && (
          <div
            className="relative"
            onMouseEnter={() => setShowScoreTooltip(true)}
            onMouseLeave={() => setShowScoreTooltip(false)}
          >
            <span className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-200 text-gray-500 rounded cursor-help">
              {item.score.toFixed(0)}
            </span>
            {showScoreTooltip && item.score_breakdown && (
              <div className="absolute right-0 top-full mt-2 p-3 bg-white border border-gray-200 rounded-lg shadow-xl z-20 min-w-[180px]">
                <div className="text-xs font-medium text-gray-700 mb-2 pb-2 border-b border-gray-100">
                  Score Breakdown
                </div>
                <div className="space-y-1.5">
                  {item.score_breakdown.map((b, i) => {
                    const formattedKey = b.key
                      .split('_')
                      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                      .join(' ')
                    return (
                      <div key={i} className="flex justify-between items-center gap-3">
                        <span className="text-xs text-gray-500">{formattedKey}</span>
                        <span className={clsx(
                          'text-xs font-medium tabular-nums',
                          b.value > 0 ? 'text-green-600' : b.value < 0 ? 'text-red-500' : 'text-gray-400'
                        )}>
                          {b.value > 0 ? '+' : ''}{b.value}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center">
                  <span className="text-xs font-medium text-gray-700">Total</span>
                  <span className="text-sm font-semibold text-gray-900">{item.score.toFixed(0)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
        {renderActions()}

        <div className="flex-1" />

        {/* Overflow menu */}
        {hasOverflowItems && (
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowOverflowMenu(!showOverflowMenu)
              }}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showOverflowMenu && (
              <div className="absolute right-0 top-full mt-1 py-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[160px]">
                {renderOverflowItems()}
              </div>
            )}

            <NotRelevantPopover
              isOpen={showNotRelevantPopover}
              onClose={() => setShowNotRelevantPopover(false)}
              onConfirm={handleNotRelevant}
              isPending={isActionPending === 'dismiss'}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default AttentionCard
