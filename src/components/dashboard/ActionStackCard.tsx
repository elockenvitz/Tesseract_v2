/**
 * ActionStackCard — Renders one CockpitStack.
 *
 * Layout:
 *   [2px left accent] [Icon] Title           [Count badge] [Primary CTA]
 *                      Subtitle
 *                      [Portfolio chips max 4] [Ticker chips max 5]
 *                      ────────────────────────────────────────
 *                      StackItemRow 1
 *                      StackItemRow 2
 *                      StackItemRow 3
 *                      "Show all N items" (expand toggle)
 */

import { useState, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Scale,
  CheckCircle2,
  FlaskConical,
  FileText,
  ListTodo,
  AlertTriangle,
  Radar,
  FolderKanban,
  HelpCircle,
  MessageSquare,
  Flag,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { StackItemRow } from './StackItemRow'
import type { CockpitStack } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Icon map — string → component
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Scale,
  CheckCircle2,
  FlaskConical,
  FileText,
  ListTodo,
  AlertTriangle,
  Radar,
  FolderKanban,
  HelpCircle,
  MessageSquare,
  Flag,
}

// ---------------------------------------------------------------------------
// Accent color classes
// ---------------------------------------------------------------------------

const ACCENT_BORDER: Record<string, string> = {
  red: 'border-l-red-500',
  amber: 'border-l-amber-400',
  blue: 'border-l-blue-400',
  violet: 'border-l-violet-400',
  cyan: 'border-l-cyan-400',
  gray: 'border-l-gray-300 dark:border-l-gray-600',
}

const ACCENT_BADGE: Record<string, string> = {
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  gray: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

const ACCENT_ICON: Record<string, string> = {
  red: 'text-red-500 dark:text-red-400',
  amber: 'text-amber-500 dark:text-amber-400',
  blue: 'text-blue-500 dark:text-blue-400',
  violet: 'text-violet-500 dark:text-violet-400',
  cyan: 'text-cyan-500 dark:text-cyan-400',
  gray: 'text-gray-400 dark:text-gray-500',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ActionStackCardProps {
  stack: CockpitStack
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
  /** Suppress per-item action buttons (AWARE band) */
  hideItemActions?: boolean
}

export function ActionStackCard({
  stack,
  onItemClick,
  hideItemActions,
}: ActionStackCardProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = ICON_MAP[stack.icon] ?? HelpCircle
  const isDecide = stack.band === 'DECIDE'
  // DECIDE shows up to 6 items before collapsing; others show 3
  const previewLimit = isDecide ? 6 : stack.itemsPreview.length
  const previewItems = isDecide ? stack.itemsAll.slice(0, previewLimit) : stack.itemsPreview
  const visibleItems = expanded ? stack.itemsAll : previewItems
  const hasMore = stack.count > previewLimit

  // Microcopy for DECIDE stacks: "7 items · 2 stale (>10d) · 3 aging (>5d)"
  const decideMicrocopy = useMemo(() => {
    if (!isDecide) return null
    const isProposalStack = stack.kind === 'proposal'
    if (isProposalStack) {
      const stale = stack.itemsAll.filter(i => i.severity === 'HIGH').length
      const aging = stack.itemsAll.filter(i => i.severity === 'MED').length
      const parts: string[] = [`${stack.count} item${stack.count !== 1 ? 's' : ''}`]
      if (stale > 0) parts.push(`${stale} stale (>10d)`)
      if (aging > 0) parts.push(`${aging} aging (>5d)`)
      return parts.join(' \u00B7 ')
    }
    const highCount = stack.itemsAll.filter(i => i.severity === 'HIGH').length
    const parts: string[] = [`${stack.count} item${stack.count !== 1 ? 's' : ''}`]
    if (highCount > 0) parts.push(`${highCount} high impact`)
    return parts.join(' \u00B7 ')
  }, [isDecide, stack])

  const toggleExpanded = useCallback(() => setExpanded(e => !e), [])

  return (
    <div
      className={clsx(
        'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden',
        'border-l-[2px]',
        ACCENT_BORDER[stack.accentColor] ?? ACCENT_BORDER.gray,
      )}
    >
      {/* Header */}
      <div className="px-3 py-2 space-y-1">
        {/* Title row */}
        <div className="flex items-center gap-2">
          <Icon className={clsx('w-4 h-4 shrink-0', ACCENT_ICON[stack.accentColor] ?? ACCENT_ICON.gray)} />
          <h3 className="text-[13px] font-semibold text-gray-800 dark:text-gray-100 flex-1 min-w-0 truncate">
            {stack.title}
          </h3>
          <span
            className={clsx(
              'shrink-0 text-[11px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[20px] text-center',
              ACCENT_BADGE[stack.accentColor] ?? ACCENT_BADGE.gray,
            )}
          >
            {stack.count}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              stack.primaryCTA.onClick()
            }}
            className={clsx(
              'shrink-0 text-[11px] font-medium px-2.5 py-[3px] rounded transition-colors',
              stack.accentColor === 'red'
                ? 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50'
                : 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600/50',
            )}
          >
            {stack.primaryCTA.label}
          </button>
        </div>

        {/* Subtitle */}
        <div className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight pl-6">
          {stack.subtitle}
        </div>

        {/* DECIDE microcopy: "7 items · 3 high impact · oldest 13d" */}
        {decideMicrocopy && (
          <div className="text-[10px] text-gray-400 dark:text-gray-500 pl-6 tabular-nums">
            {decideMicrocopy}
          </div>
        )}
      </div>

      {/* Item rows */}
      {visibleItems.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700/50 divide-y divide-gray-50 dark:divide-gray-700/30">
          {visibleItems.map(item => (
            <StackItemRow
              key={item.id}
              item={item}
              onItemClick={onItemClick}
              hideAction={hideItemActions}
              showImpact={isDecide}
            />
          ))}
        </div>
      )}

      {/* Expand toggle */}
      {hasMore && (
        <button
          onClick={toggleExpanded}
          className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors border-t border-gray-100 dark:border-gray-700/50"
        >
          {expanded ? (
            <>
              <ChevronDown className="w-3 h-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3" />
              {isDecide ? `View all ${stack.count}` : `Show all ${stack.count} items`}
            </>
          )}
        </button>
      )}
    </div>
  )
}
