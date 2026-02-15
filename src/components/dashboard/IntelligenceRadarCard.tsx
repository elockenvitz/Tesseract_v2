/**
 * IntelligenceRadarCard — AI monitoring surface for awareness signals.
 *
 * Visually distinct from other cards: cool blue gradient background,
 * pulsing radar icon, system-tone typography. Conveys an automated
 * intelligence system scanning coverage.
 *
 * Always visible with meaningful empty state. Items are dismissible.
 * Category count chips summarize signal distribution.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import { Radar, MoreVertical, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import { dispatchDecisionAction } from '../../engine/decisionEngine'
import type { DecisionItem, DecisionCategory } from '../../engine/decisionEngine'

// ---------------------------------------------------------------------------
// Dismiss storage
// ---------------------------------------------------------------------------

function getDismissedIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`tesseract.dismissedIntelItems.${userId}`)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function setDismissedIds(userId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(
      `tesseract.dismissedIntelItems.${userId}`,
      JSON.stringify([...ids]),
    )
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Blue-tinted styling — distinct AI-system feel
// ---------------------------------------------------------------------------

const INTEL_CONTAINER = 'rounded-xl border border-blue-200/50 dark:border-blue-800/30 bg-gradient-to-br from-blue-50/50 via-blue-50/20 to-slate-50/30 dark:from-slate-800/90 dark:via-blue-950/20 dark:to-gray-800/60 overflow-hidden'
const INTEL_HEADER = 'flex items-center gap-2 px-5 py-3 border-b border-blue-100/40 dark:border-blue-900/20'
const INTEL_TITLE = 'text-[13px] font-semibold text-gray-700 dark:text-gray-200'

// ---------------------------------------------------------------------------
// Category styling
// ---------------------------------------------------------------------------

const CATEGORY_PILL: Record<DecisionCategory, string> = {
  process: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  project: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  risk: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  alpha: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  catalyst: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  prompt: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
}

const CATEGORY_LABEL: Record<DecisionCategory, string> = {
  process: 'Process',
  project: 'Project',
  risk: 'Risk',
  alpha: 'Alpha',
  catalyst: 'Catalyst',
  prompt: 'Prompt',
}

const CATEGORY_CHIP_LABEL: Record<DecisionCategory, string> = {
  risk: 'Risks',
  catalyst: 'Catalysts',
  alpha: 'Alpha',
  prompt: 'Prompts',
  process: 'Process',
  project: 'Projects',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const COLLAPSED_COUNT = 3

interface IntelligenceRadarCardProps {
  items: DecisionItem[]
  /** Low-priority awareness signals shown when primary items are empty/dismissed */
  fallbackItems?: DecisionItem[]
  userId: string
  isLoading?: boolean
  defaultCollapsed?: boolean
  onViewAll?: () => void
  /** Number of assets being monitored (shown in system message) */
  coverageCount?: number
}

export function IntelligenceRadarCard({
  items,
  fallbackItems = [],
  userId,
  isLoading,
  defaultCollapsed = false,
  onViewAll,
  coverageCount,
}: IntelligenceRadarCardProps) {
  const [dismissedIds, setDismissedIdsState] = useState<Set<string>>(
    () => getDismissedIds(userId),
  )
  const [expanded, setExpanded] = useState(!defaultCollapsed)

  // Sync when userId changes
  useEffect(() => {
    setDismissedIdsState(getDismissedIds(userId))
  }, [userId])

  const dismiss = useCallback((id: string) => {
    setDismissedIdsState(prev => {
      const next = new Set(prev)
      next.add(id)
      setDismissedIds(userId, next)
      return next
    })
  }, [userId])

  const resetDismissed = useCallback(() => {
    setDismissedIdsState(new Set())
    setDismissedIds(userId, new Set())
  }, [userId])

  const visibleItems = items.filter(i => !dismissedIds.has(i.id))
  const visibleFallback = fallbackItems.filter(i => !dismissedIds.has(i.id))
  const showingFallback = visibleItems.length === 0 && visibleFallback.length > 0

  const activeItems = showingFallback ? visibleFallback : visibleItems
  const displayItems = expanded ? activeItems : activeItems.slice(0, COLLAPSED_COUNT)
  const hiddenCount = activeItems.length - displayItems.length

  // Category count chips
  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<DecisionCategory, number>> = {}
    for (const item of activeItems) {
      counts[item.category] = (counts[item.category] ?? 0) + 1
    }
    return counts
  }, [activeItems])

  if (isLoading) return null

  const hasItems = activeItems.length > 0

  const systemMessage = coverageCount
    ? `Monitoring ${coverageCount} assets across coverage.`
    : 'System monitoring your coverage.'

  return (
    <div className={INTEL_CONTAINER}>
      {/* Header */}
      <div className={clsx(INTEL_HEADER, !hasItems && 'border-b-0')}>
        {hasItems && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-blue-400 dark:text-blue-500 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        <Radar className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-pulse" />
        <h2 className={INTEL_TITLE}>Intelligence Radar</h2>
        {hasItems && (
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums min-w-[20px] text-center bg-blue-100/80 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {activeItems.length}
          </span>
        )}

        {/* Category count chips */}
        {hasItems && (
          <div className="hidden sm:flex items-center gap-1 ml-1">
            {(Object.entries(categoryCounts) as [DecisionCategory, number][]).map(([cat, count]) => (
              <span
                key={cat}
                className="text-[9px] font-medium px-1.5 py-px rounded bg-blue-100/50 text-blue-600/70 dark:bg-blue-900/20 dark:text-blue-400/60"
              >
                {CATEGORY_CHIP_LABEL[cat]} {count}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1" />
        {onViewAll && hasItems && (
          <button
            onClick={onViewAll}
            className="flex items-center gap-0.5 text-[11px] font-medium text-blue-500/60 dark:text-blue-400/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            View all
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
        {dismissedIds.size > 0 && (
          <button
            onClick={resetDismissed}
            className="flex items-center gap-1 text-[10px] text-blue-400/50 hover:text-blue-600 dark:text-blue-500/40 dark:hover:text-blue-300 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>

      {/* Subtitle — system tone */}
      {hasItems && (
        <div className="px-5 py-1.5 text-[10px] font-light tracking-wide text-blue-500/50 dark:text-blue-400/30 border-b border-blue-100/30 dark:border-blue-900/15">
          Emerging signals across your coverage.
        </div>
      )}

      {/* Items */}
      {hasItems ? (
        <>
          {showingFallback && (
            <div className="px-5 py-1 bg-blue-50/40 dark:bg-blue-950/15 border-b border-blue-100/40 dark:border-blue-900/20">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-blue-400/70 dark:text-blue-500/50">
                Awareness
              </span>
            </div>
          )}
          <div className={clsx(
            'divide-y divide-blue-100/30 dark:divide-blue-900/15',
            showingFallback && 'bg-blue-50/10 dark:bg-blue-950/5',
          )}>
            {displayItems.map(item => (
              <IntelRow
                key={item.id}
                item={item}
                onDismiss={() => dismiss(item.id)}
              />
            ))}
            {hiddenCount > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="w-full px-5 py-2 text-[11px] font-medium text-blue-600/70 dark:text-blue-400/60 hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors text-center"
              >
                + {hiddenCount} more signals
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="px-5 py-6 text-center">
          <div className="text-[11px] font-light text-blue-400/60 dark:text-blue-500/50">
            {dismissedIds.size > 0
              ? 'All signals dismissed.'
              : 'No emerging signals.'}
          </div>
          <div className="text-[10px] font-light tracking-wide text-blue-400/35 dark:text-blue-500/25 mt-1">
            {systemMessage}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IntelRow — Compact signal row
// ---------------------------------------------------------------------------

function IntelRow({
  item,
  onDismiss,
}: {
  item: DecisionItem
  onDismiss: () => void
}) {
  const primary = item.ctas.find(c => c.kind === 'primary') || item.ctas[0]

  const handleCTA = useCallback(() => {
    if (primary && primary.actionKey !== 'DISMISS') {
      dispatchDecisionAction(primary.actionKey, {
        ...item.context,
        ...primary.payload,
      })
    }
  }, [primary, item.context])

  return (
    <div className="flex items-center gap-2 px-5 py-2.5 border-l-[3px] border-l-blue-200/60 dark:border-l-blue-700/40 group">
      {/* Category pill */}
      <span className={clsx(
        'shrink-0 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded',
        CATEGORY_PILL[item.category],
      )}>
        {CATEGORY_LABEL[item.category]}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-gray-700 dark:text-gray-200 leading-tight">
          {item.title}
        </div>
        {item.description && (
          <div className="text-[10px] font-light text-gray-500 dark:text-gray-400 leading-snug truncate">
            {item.description}
          </div>
        )}
      </div>

      {/* Chips inline */}
      {item.chips && item.chips.length > 0 && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {item.chips.slice(0, 2).map((chip, i) => (
            <span
              key={i}
              className="text-[9px] font-medium px-1.5 py-px rounded bg-blue-100/40 text-blue-600/60 dark:bg-blue-900/15 dark:text-blue-400/50 whitespace-nowrap"
            >
              {chip.value}
            </span>
          ))}
        </div>
      )}

      {/* CTA + dismiss */}
      <div className="shrink-0 flex items-center gap-1">
        {primary && primary.actionKey !== 'DISMISS' && (
          <button
            onClick={handleCTA}
            className="text-[11px] font-medium px-2.5 py-1 rounded text-blue-600 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
          >
            {primary.label}
          </button>
        )}

        {item.dismissible && (
          <KebabDismiss onDismiss={onDismiss} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KebabDismiss
// ---------------------------------------------------------------------------

function KebabDismiss({ onDismiss }: { onDismiss: () => void }) {
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
        className="p-0.5 text-blue-300/40 hover:text-blue-500 dark:text-blue-600/40 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-0.5 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg py-0.5 min-w-[100px]">
          <button
            onClick={() => {
              onDismiss()
              setOpen(false)
            }}
            className="w-full text-left text-[11px] px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-300"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
