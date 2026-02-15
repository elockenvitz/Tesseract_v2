/**
 * AttentionRow — Consistent row layout for all attention feed items.
 *
 * Layout:
 *   Left:   severity pill + type icon + title (1 line) + description (secondary)
 *   Middle: chips (ticker, portfolio, age, due, owner)
 *   Right:  primary CTA (1 button) + overflow menu (...)
 *
 * Same row regardless of band. Compact but readable.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Scale,
  FlaskConical,
  CheckCircle2,
  ListTodo,
  FolderKanban,
  FileText,
  AlertTriangle,
  Radar,
  MessageSquare,
  ListPlus,
  Bell,
  Users,
  MoreVertical,
  Clock,
  Copy,
} from 'lucide-react'
import { dispatchDecisionAction } from '../../engine/decisionEngine'
import { SNOOZE_PRESETS } from '../../lib/attention-feed/snooze'
import type { AttentionFeedItem, AttentionFeedItemType, AttentionFeedSeverity } from '../../types/attention-feed'

// ---------------------------------------------------------------------------
// Severity styling
// ---------------------------------------------------------------------------

const SEVERITY_PILL: Record<AttentionFeedSeverity, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const SEVERITY_LABEL: Record<AttentionFeedSeverity, string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
}

const SEVERITY_BORDER: Record<AttentionFeedSeverity, string> = {
  high: 'border-l-red-500',
  medium: 'border-l-amber-400 dark:border-l-amber-500',
  low: 'border-l-gray-300 dark:border-l-gray-600',
}

// ---------------------------------------------------------------------------
// Type icon mapping
// ---------------------------------------------------------------------------

const TYPE_ICON: Record<AttentionFeedItemType, React.FC<{ className?: string }>> = {
  proposal: Scale,
  simulation: FlaskConical,
  execution: CheckCircle2,
  deliverable: ListTodo,
  project: FolderKanban,
  thesis: FileText,
  risk: AlertTriangle,
  signal: Radar,
  prompt: MessageSquare,
  suggestion: ListPlus,
  notification: Bell,
  alignment: Users,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AttentionRowProps {
  item: AttentionFeedItem
  onSnooze: (itemId: string, hours: number) => void
  onMarkDone?: (deliverableId: string) => void
  onNavigate?: (item: AttentionFeedItem) => void
}

export function AttentionRow({
  item,
  onSnooze,
  onMarkDone,
  onNavigate,
}: AttentionRowProps) {
  const primaryAction = item.actions.find(a => a.variant === 'primary')
  const overflowActions = item.actions.filter(a => a.variant === 'overflow')
  const Icon = TYPE_ICON[item.type] ?? Bell

  const handlePrimaryCTA = useCallback(() => {
    if (!primaryAction) return

    // Special intents handled differently
    if (primaryAction.intent === 'NAV_SOURCE' || primaryAction.intent === 'NAV_LIST') {
      onNavigate?.(item)
      return
    }

    // Dispatch to decision engine action system
    dispatchDecisionAction(primaryAction.intent, {
      ...item.related,
      ...primaryAction.payload,
    })
  }, [primaryAction, item, onNavigate])

  return (
    <div
      className={clsx(
        'flex items-center gap-2.5 px-4 py-2.5',
        'border-l-[3px] group',
        'hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors',
        SEVERITY_BORDER[item.severity],
      )}
    >
      {/* Severity pill */}
      <span
        className={clsx(
          'shrink-0 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded',
          SEVERITY_PILL[item.severity],
        )}
      >
        {SEVERITY_LABEL[item.severity]}
      </span>

      {/* Type icon */}
      <Icon className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-500" />

      {/* Title + description */}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-gray-800 dark:text-gray-100 leading-tight truncate">
          {item.title}
        </div>
        {item.description && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug truncate">
            {item.description}
          </div>
        )}
      </div>

      {/* Chips */}
      {item.chips.length > 0 && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {item.chips.slice(0, 3).map((chip, i) => (
            <span
              key={i}
              className="text-[9px] font-medium px-1.5 py-px rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 whitespace-nowrap tabular-nums"
            >
              {chip.value}
            </span>
          ))}
        </div>
      )}

      {/* Primary CTA */}
      {primaryAction && (
        <button
          onClick={handlePrimaryCTA}
          className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
        >
          {primaryAction.label}
        </button>
      )}

      {/* Overflow menu */}
      {overflowActions.length > 0 && (
        <OverflowMenu
          itemId={item.id}
          actions={overflowActions}
          onSnooze={onSnooze}
          onMarkDone={onMarkDone}
          deliverableId={item.related.deliverableId}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overflow menu
// ---------------------------------------------------------------------------

function OverflowMenu({
  itemId,
  actions,
  onSnooze,
  onMarkDone,
  deliverableId,
}: {
  itemId: string
  actions: AttentionFeedItem['actions']
  onSnooze: (itemId: string, hours: number) => void
  onMarkDone?: (deliverableId: string) => void
  deliverableId?: string
}) {
  const [open, setOpen] = useState(false)
  const [showSnooze, setShowSnooze] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowSnooze(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => {
          setOpen(o => !o)
          setShowSnooze(false)
        }}
        className="p-0.5 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-0.5 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[140px]">
          {showSnooze ? (
            <>
              <div className="px-3 py-1 text-[10px] font-medium text-gray-400 dark:text-gray-500">
                Defer for...
              </div>
              {SNOOZE_PRESETS.map(preset => (
                <button
                  key={preset.hours}
                  onClick={() => {
                    onSnooze(itemId, preset.hours)
                    setOpen(false)
                    setShowSnooze(false)
                  }}
                  className="w-full text-left text-[11px] px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-300 flex items-center gap-2"
                >
                  <Clock className="w-3 h-3 text-gray-400" />
                  {preset.label}
                </button>
              ))}
            </>
          ) : (
            <>
              {actions.map((action, i) => {
                if (action.intent === 'SNOOZE') {
                  return (
                    <button
                      key={i}
                      onClick={() => setShowSnooze(true)}
                      className="w-full text-left text-[11px] px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-300 flex items-center gap-2"
                    >
                      <Clock className="w-3 h-3 text-gray-400" />
                      Defer
                    </button>
                  )
                }
                if (action.intent === 'MARK_DELIVERABLE_DONE' && onMarkDone && deliverableId) {
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        onMarkDone(deliverableId)
                        setOpen(false)
                      }}
                      className="w-full text-left text-[11px] px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-300 flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-3 h-3 text-gray-400" />
                      Mark done
                    </button>
                  )
                }
                if (action.intent === 'COPY_LINK') {
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.origin + (action.payload?.url ?? ''))
                        setOpen(false)
                      }}
                      className="w-full text-left text-[11px] px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-300 flex items-center gap-2"
                    >
                      <Copy className="w-3 h-3 text-gray-400" />
                      Copy link
                    </button>
                  )
                }
                return null
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
