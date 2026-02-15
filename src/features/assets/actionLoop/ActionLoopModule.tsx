/**
 * ActionLoopModule — "Needs Attention" engine.
 *
 * Renders structured ActionItems for 6 triggers across 3 categories:
 *   Process (P1/P2/P3), Alpha (A1), Risk (R1/R2)
 *
 * 0 items → renders nothing.
 * 1+ items → collapsed header with severity-coded count badge; expand reveals:
 *   1. Workflow summary strip (Research → Idea → Proposal → Decision → Execution)
 *   2. Action items (max 5 visible, "Show N more" footer for overflow)
 *
 * The component is NOT a metrics display, research summary, or notification feed.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  ChevronRight,
  AlertTriangle,
  MoreVertical,
} from 'lucide-react'
import { useActionLoopItems } from './useActionLoopItems'
import { dispatchAction, type ActionContext } from './actionLoopActions'
import { logActionLoopEvent } from './actionLoopTelemetry'
import type {
  ActionItem,
  ActionCategory,
  ActionSeverity,
  WorkflowSummary,
  WorkflowStepStatus,
} from './assetActionLoopEvaluator'

// ---------------------------------------------------------------------------
// localStorage helpers (per-view collapse)
// ---------------------------------------------------------------------------

const LS_COLLAPSED_PREFIX = 'actionLoop.collapsed.'

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE_ITEMS = 5

// ---------------------------------------------------------------------------
// Category styling
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<ActionCategory, string> = {
  process: 'Process',
  alpha: 'Alpha',
  risk: 'Risk',
}

const CATEGORY_PILL_STYLE: Record<ActionCategory, string> = {
  process: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  alpha: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  risk: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

// ---------------------------------------------------------------------------
// Severity styling — Red is intentionally stronger than orange
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<ActionSeverity, {
  border: string
  bg: string
  titleWeight: string
}> = {
  red: {
    border: 'border-l-red-600 dark:border-l-red-500',
    bg: 'bg-red-50/50 dark:bg-red-950/25',
    titleWeight: 'font-bold',
  },
  orange: {
    border: 'border-l-amber-400 dark:border-l-amber-500',
    bg: 'bg-amber-50/25 dark:bg-amber-950/10',
    titleWeight: 'font-semibold',
  },
  gray: {
    border: 'border-l-gray-300 dark:border-l-gray-600',
    bg: 'bg-gray-50/20 dark:bg-gray-800/15',
    titleWeight: 'font-semibold',
  },
}

const META_CHIP_STYLE: Record<string, string> = {
  default: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

// ---------------------------------------------------------------------------
// Workflow summary strip styling
// ---------------------------------------------------------------------------

const STEP_STATUS_ICON: Record<WorkflowStepStatus, string> = {
  done: '\u2713',     // ✓
  pending: '\u23F3',  // ⏳
  blocked: '\u2757',  // ❗
  none: '\u2014',     // —
}

const STEP_STATUS_STYLE: Record<WorkflowStepStatus, string> = {
  done: 'text-emerald-600 dark:text-emerald-400',
  pending: 'text-amber-500 dark:text-amber-400',
  blocked: 'text-red-500 dark:text-red-400',
  none: 'text-gray-300 dark:text-gray-600',
}

const WORKFLOW_STEPS: { key: keyof WorkflowSummary; label: string }[] = [
  { key: 'research', label: 'Research' },
  { key: 'idea', label: 'Idea' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'decision', label: 'Decision' },
  { key: 'execution', label: 'Execution' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ActionLoopModuleProps {
  assetId: string
  assetSymbol?: string
  viewFilter: 'aggregated' | string
  currentPrice?: number
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
}

export function ActionLoopModule({
  assetId,
  assetSymbol,
  viewFilter,
  currentPrice,
  onNavigate,
}: ActionLoopModuleProps) {
  const {
    items,
    itemCount,
    redCount,
    workflowSummary,
    isLoading,
    dismiss,
    isDismissing,
  } = useActionLoopItems({ assetId, viewFilter, currentPrice })

  // ---- Collapse state (per-view, defaults to collapsed) ----
  const collapseKey = `${LS_COLLAPSED_PREFIX}${assetId}.${viewFilter}`
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(() => {
    const stored = lsGet(collapseKey)
    return stored !== null ? stored === 'true' : null
  })

  useEffect(() => {
    const stored = lsGet(collapseKey)
    setUserCollapsed(stored !== null ? stored === 'true' : null)
  }, [collapseKey])

  const isCollapsed = userCollapsed ?? true

  const toggleCollapsed = useCallback(() => {
    setUserCollapsed(prev => {
      const next = !(prev ?? true)
      lsSet(collapseKey, String(next))
      if (next) {
        logActionLoopEvent({ event: 'action_loop_collapse', assetId })
      } else {
        logActionLoopEvent({ event: 'action_loop_expand', assetId, itemCount })
      }
      return next
    })
  }, [collapseKey, assetId, itemCount])

  // ---- Show more / less ----
  const [showAll, setShowAll] = useState(false)
  const hasOverflow = itemCount > MAX_VISIBLE_ITEMS
  const visibleItems = showAll ? items : items.slice(0, MAX_VISIBLE_ITEMS)
  const hiddenCount = itemCount - MAX_VISIBLE_ITEMS

  // Reset showAll when items change
  useEffect(() => { setShowAll(false) }, [itemCount])

  // ---- Action context ----
  const actionCtx: ActionContext = { assetId, assetSymbol, onNavigate }

  // ---- Render nothing if loading or no items ----
  if (isLoading || itemCount === 0) return null

  const hasRed = redCount > 0

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800/60 overflow-hidden">
      {/* ---- Collapsed header ---- */}
      <button
        onClick={toggleCollapsed}
        className="w-full flex items-center h-7 px-2.5 gap-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
      >
        <ChevronRight className={clsx(
          'w-3 h-3 text-gray-400 transition-transform',
          !isCollapsed && 'rotate-90',
        )} />
        <AlertTriangle className={clsx(
          'w-3 h-3',
          hasRed ? 'text-red-500' : 'text-amber-500',
        )} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Needs Attention
        </span>
        <span className={clsx(
          'text-[10px] font-semibold px-1.5 py-px rounded-full tabular-nums',
          hasRed
            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        )}>
          {itemCount}
        </span>
      </button>

      {/* ---- Expanded content ---- */}
      {!isCollapsed && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {/* Workflow summary strip */}
          {workflowSummary && (
            <WorkflowSummaryStrip summary={workflowSummary} />
          )}

          {/* Action items */}
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {visibleItems.map(item => (
              <ActionItemRow
                key={item.id}
                item={item}
                actionCtx={actionCtx}
                onDismiss={() => {
                  logActionLoopEvent({
                    event: 'action_loop_dismiss',
                    assetId,
                    itemType: item.type,
                  })
                  dismiss(item.type)
                }}
                isDismissing={isDismissing}
              />
            ))}
          </div>

          {/* Show more footer */}
          {hasOverflow && (
            <button
              onClick={() => setShowAll(s => !s)}
              className="w-full text-center text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1.5 border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors"
            >
              {showAll ? 'Show less' : `Show ${hiddenCount} more`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WorkflowSummaryStrip — 1-line status bar
// ---------------------------------------------------------------------------

function WorkflowSummaryStrip({ summary }: { summary: WorkflowSummary }) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-50/50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-700/50">
      {WORKFLOW_STEPS.map((step, i) => {
        const status = summary[step.key]
        return (
          <span key={step.key} className="flex items-center gap-0.5">
            {i > 0 && (
              <span className="text-gray-200 dark:text-gray-700 text-[9px] mr-1.5">&rarr;</span>
            )}
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {step.label}
            </span>
            <span className={clsx('text-[10px]', STEP_STATUS_STYLE[status])}>
              {STEP_STATUS_ICON[status]}
            </span>
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionItemRow — Single structured action item
// ---------------------------------------------------------------------------

function ActionItemRow({
  item,
  actionCtx,
  onDismiss,
  isDismissing,
}: {
  item: ActionItem
  actionCtx: ActionContext
  onDismiss: () => void
  isDismissing: boolean
}) {
  const styles = SEVERITY_STYLES[item.severity]

  const handlePrimary = useCallback(() => {
    logActionLoopEvent({
      event: 'action_loop_action_click',
      assetId: actionCtx.assetId,
      itemType: item.type,
      actionKey: item.primaryAction.actionKey,
    })
    dispatchAction(item.primaryAction.actionKey, actionCtx)
  }, [item, actionCtx])

  const handleSecondary = useCallback(() => {
    if (!item.secondaryAction) return
    logActionLoopEvent({
      event: 'action_loop_action_click',
      assetId: actionCtx.assetId,
      itemType: item.type,
      actionKey: item.secondaryAction.actionKey,
    })
    dispatchAction(item.secondaryAction.actionKey, actionCtx)
  }, [item, actionCtx])

  return (
    <div className={clsx(
      'flex items-start gap-2 px-3 py-2 group',
      item.severity === 'red' ? 'border-l-4' : 'border-l-[3px]',
      styles.border,
      styles.bg,
    )}>
      {/* Category pill */}
      <span className={clsx(
        'shrink-0 text-[9px] font-semibold uppercase px-1.5 py-px rounded mt-0.5',
        CATEGORY_PILL_STYLE[item.category],
      )}>
        {CATEGORY_LABEL[item.category]}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={clsx(
          'text-[11px] text-gray-800 dark:text-gray-100',
          styles.titleWeight,
        )}>
          {item.title}
        </div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">
          {item.description}
        </div>
        {/* Meta chips */}
        {item.meta.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {item.meta.map((chip, i) => (
              <span
                key={i}
                className={clsx(
                  'text-[9px] font-medium px-1.5 py-px rounded',
                  META_CHIP_STYLE[chip.variant] || META_CHIP_STYLE.default,
                )}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1 mt-0.5">
        {/* Primary action */}
        <button
          onClick={handlePrimary}
          className={clsx(
            'text-[10px] font-semibold px-2 py-0.5 rounded transition-colors',
            item.severity === 'red'
              ? 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50'
              : 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50',
          )}
        >
          {item.primaryAction.label}
        </button>

        {/* Secondary action (only if logically valid) */}
        {item.secondaryAction && (
          <button
            onClick={handleSecondary}
            className="text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/40 transition-colors"
          >
            {item.secondaryAction.label}
          </button>
        )}

        {/* Kebab dismiss menu (only for dismissible items — never red) */}
        {item.dismissible && (
          <KebabDismiss
            onDismiss={onDismiss}
            isDismissing={isDismissing}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KebabDismiss — Small kebab menu with dismiss option
// ---------------------------------------------------------------------------

function KebabDismiss({
  onDismiss,
  isDismissing,
}: {
  onDismiss: () => void
  isDismissing: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="p-0.5 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <MoreVertical className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-0.5 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg py-0.5 min-w-[120px]">
          <button
            onClick={() => {
              onDismiss()
              setOpen(false)
            }}
            disabled={isDismissing}
            className="w-full text-left text-[11px] px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-300 disabled:opacity-50"
          >
            Dismiss for 24h
          </button>
        </div>
      )}
    </div>
  )
}
