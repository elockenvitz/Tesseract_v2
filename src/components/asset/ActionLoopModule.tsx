/**
 * ActionLoopModule — Prescriptive workflow gap detector.
 *
 * Renders structured Action Cards for exactly 4 triggers:
 *   A. Opportunity: High EV, no active idea (ORANGE)
 *   B. Idea Not Simulated: idea exists but not run through Trade Lab (ORANGE)
 *   C. Proposal Stalled: PM decision pending too long (RED)
 *   D. Execution Not Confirmed: approved but not logged (RED)
 *
 * 0 cards → renders nothing.
 * 1+ cards → collapsed header with severity badge; expand reveals cards only.
 *
 * The component is NOT a metrics display, research summary, or notification feed.
 */

import { useState, useCallback, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  ChevronRight,
  AlertCircle,
  Clock,
  X,
} from 'lucide-react'
import { useActionLoopCards } from '../../hooks/useActionLoopCards'
import type { ActionCard, CardType } from '../../lib/assetActionLoopEvaluator'

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
// Severity styles
// ---------------------------------------------------------------------------

const SEVERITY_STYLES = {
  red: {
    border: 'border-l-red-500 dark:border-l-red-400',
    bg: 'bg-red-50/40 dark:bg-red-950/20',
    icon: 'text-red-500 dark:text-red-400',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
  orange: {
    border: 'border-l-amber-500 dark:border-l-amber-400',
    bg: 'bg-amber-50/40 dark:bg-amber-950/20',
    icon: 'text-amber-500 dark:text-amber-400',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
} as const

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
    cards,
    cardCount,
    isLoading,
    dismiss,
    isDismissing,
  } = useActionLoopCards({ assetId, viewFilter, currentPrice })

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
      return next
    })
  }, [collapseKey])

  // ---- CTA handlers ----
  const handleCardAction = useCallback((action: string) => {
    switch (action) {
      case 'create_idea':
        window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
          detail: {
            contextType: 'asset',
            contextId: assetId,
            contextTitle: assetSymbol || undefined,
            captureType: 'trade_idea',
          },
        }))
        break
      case 'open_trade_lab':
        onNavigate?.({
          id: 'trade-lab',
          title: 'Trade Lab',
          type: 'trade-lab',
          data: { assetId },
        })
        break
      case 'review_proposal':
      case 'confirm_execution':
        onNavigate?.({
          id: 'trade-queue',
          title: 'Trade Queue',
          type: 'trade-queue',
          data: { assetId },
        })
        break
    }
  }, [assetId, assetSymbol, onNavigate])

  // ---- Render nothing if loading or no cards ----
  if (isLoading || cardCount === 0) return null

  // Highest severity for the badge
  const hasRed = cards.some(c => c.severity === 'red')
  const badgeStyle = hasRed ? SEVERITY_STYLES.red.badge : SEVERITY_STYLES.orange.badge

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
        <AlertCircle className={clsx('w-3 h-3', hasRed ? 'text-red-500' : 'text-amber-500')} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Action Loop
        </span>
        <span className={clsx(
          'text-[10px] font-semibold px-1.5 py-px rounded-full tabular-nums',
          badgeStyle,
        )}>
          {cardCount}
        </span>
      </button>

      {/* ---- Expanded: action cards only ---- */}
      {!isCollapsed && (
        <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50">
          {cards.map(card => (
            <ActionCardRow
              key={card.type}
              card={card}
              onAction={handleCardAction}
              onDismiss={() => dismiss(card.type)}
              isDismissing={isDismissing}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionCardRow — Single structured action card
// ---------------------------------------------------------------------------

function ActionCardRow({
  card,
  onAction,
  onDismiss,
  isDismissing,
}: {
  card: ActionCard
  onAction: (action: string) => void
  onDismiss: () => void
  isDismissing: boolean
}) {
  const styles = SEVERITY_STYLES[card.severity]

  return (
    <div className={clsx(
      'flex items-start gap-2 px-3 py-2 border-l-[3px] group',
      styles.border,
      styles.bg,
    )}>
      {/* Icon */}
      <Clock className={clsx('w-3.5 h-3.5 mt-0.5 shrink-0', styles.icon)} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">
          {card.title}
        </div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">
          {card.description}
        </div>
      </div>

      {/* Primary action */}
      <button
        onClick={() => onAction(card.primaryAction.action)}
        className={clsx(
          'shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded transition-colors',
          card.severity === 'red'
            ? 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50'
            : 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50',
        )}
      >
        {card.primaryAction.label}
      </button>

      {/* Dismiss (hover-reveal) */}
      <button
        onClick={onDismiss}
        disabled={isDismissing}
        className="shrink-0 p-0.5 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
        title="Dismiss for 24 hours"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
