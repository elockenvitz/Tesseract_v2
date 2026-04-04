/**
 * AdvanceProgressGrid — Dynamic progress modules for ADVANCE band.
 *
 * Ranked by attention score, each module shows:
 *   - Kind icon + title + count
 *   - Status line (why stalled, what's overdue)
 *   - Top 2-3 preview items
 *   - Expand toggle
 *
 * Modules are dynamic — only populated kinds appear, ranked by urgency.
 * Replaces the static AdvanceBandSection card grid.
 */

import { useState, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderKanban,
  FlaskConical,
  ListTodo,
  HelpCircle,
  ArrowRight,
} from 'lucide-react'
import type { CockpitBandData, CockpitStack } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Module config per kind
// ---------------------------------------------------------------------------

const MODULE_CONFIG: Record<string, {
  icon: React.FC<{ className?: string }>
  title: string
  accent: string
  statusLine: (stack: CockpitStack) => string
  statusDescriptor: (stack: CockpitStack) => string | null
}> = {
  thesis: {
    icon: FileText,
    title: 'Stale Thesis',
    accent: 'border-l-amber-400',
    statusLine: (s) => {
      const red = s.itemsAll.filter(i => i.severity === 'HIGH').length
      const med = s.itemsAll.filter(i => i.severity === 'MED').length
      if (red > 0 && med > 0) return `${red} stale >180d \u00B7 ${med} aging \u2014 coverage degrading`
      if (red > 0) return `${red} stale >180d \u2014 blind spot risk`
      if (med > 0) return `${med} aging >90d \u2014 review window missed`
      return `${s.count} nearing staleness threshold`
    },
    statusDescriptor: (s) => {
      const red = s.itemsAll.filter(i => i.severity === 'HIGH').length
      if (red > 0) return 'At Risk'
      if (s.oldestAgeDays >= 120) return 'Stale'
      return null
    },
  },
  deliverable: {
    icon: ListTodo,
    title: 'Overdue Deliverables',
    accent: 'border-l-red-400',
    statusLine: (s) => {
      const overdue = s.itemsAll.filter(
        i => i.meta?.overdueDays != null && i.meta.overdueDays > 0,
      ).length
      const maxOverdue = Math.max(
        0,
        ...s.itemsAll.map(i => i.meta?.overdueDays ?? 0),
      )
      if (overdue > 0) return `${overdue} overdue \u00B7 worst ${maxOverdue}d late`
      return `${s.count} need completion`
    },
    statusDescriptor: (s) => {
      const overdue = s.itemsAll.filter(i => i.meta?.overdueDays != null && i.meta.overdueDays > 0).length
      if (overdue >= 3) return 'Blocked'
      if (overdue > 0) return 'Overdue'
      return null
    },
  },
  project: {
    icon: FolderKanban,
    title: 'Projects',
    accent: 'border-l-amber-400',
    statusLine: (s) => {
      const overdue = s.itemsAll.filter(
        i => (i.meta?.overdueDays != null && i.meta.overdueDays > 0) ||
             i.contextChips?.some(c => c.toLowerCase().includes('overdue'))
      ).length
      if (overdue > 0) return `${overdue} with overdue work \u2014 unblock`
      return `${s.count} active`
    },
    statusDescriptor: (s) => {
      const overdue = s.itemsAll.filter(
        i => (i.meta?.overdueDays != null && i.meta.overdueDays > 0) ||
             i.contextChips?.some(c => c.toLowerCase().includes('overdue'))
      ).length
      if (overdue > 0) return 'At Risk'
      return null
    },
  },
  simulation: {
    icon: FlaskConical,
    title: 'Ideas in Pipeline',
    accent: 'border-l-blue-400',
    statusLine: (s) => {
      const oldest = s.oldestAgeDays
      if (oldest > 14) return `${s.count} pre-decision \u00B7 oldest ${oldest}d stalled`
      if (oldest > 7) return `${s.count} pre-decision \u00B7 oldest ${oldest}d`
      return `${s.count} being worked on`
    },
    statusDescriptor: (s) => {
      if (s.oldestAgeDays > 14) return 'Stalled'
      if (s.oldestAgeDays > 7) return 'Aging'
      return null
    },
  },
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AdvanceProgressGridProps {
  id?: string
  bandData: CockpitBandData
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdvanceProgressGrid({
  id,
  bandData,
  onItemClick,
}: AdvanceProgressGridProps) {
  const [bandExpanded, setBandExpanded] = useState(true)
  const [expandedKind, setExpandedKind] = useState<string | null>(null)

  // Build module list: configured stacks + "other" stacks
  const allModules = useMemo(() => {
    const result: { stack: CockpitStack; config: typeof MODULE_CONFIG[string] }[] = []
    for (const stack of bandData.stacks) {
      const cfg = MODULE_CONFIG[stack.kind]
      if (cfg) {
        result.push({ stack, config: cfg })
      } else {
        result.push({
          stack,
          config: {
            icon: HelpCircle,
            title: stack.title,
            accent: 'border-l-gray-300 dark:border-l-gray-600',
            statusLine: () => `${stack.count} item${stack.count !== 1 ? 's' : ''}`,
            statusDescriptor: () => null,
          },
        })
      }
    }
    return result
  }, [bandData.stacks])

  if (bandData.stacks.length === 0) {
    return (
      <div id={id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          <h2 className="text-[13px] font-bold text-gray-800 dark:text-gray-100 tracking-wide">
            ADVANCE
          </h2>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            Needs Progress
          </span>
          <div className="flex-1" />
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">
            No stalled work or overdue items.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className="space-y-2">
      {/* Band header */}
      <button
        onClick={() => setBandExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3.5 py-2 text-left rounded-lg hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors"
      >
        {bandExpanded
          ? <ChevronDown className="w-3.5 h-3.5 text-amber-400 dark:text-amber-500" />
          : <ChevronRight className="w-3.5 h-3.5 text-amber-400 dark:text-amber-500" />
        }
        <h2 className="text-[13px] font-bold text-gray-800 dark:text-gray-100 tracking-wide">
          ADVANCE
        </h2>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          Needs Progress
        </span>
        <span className={clsx(
          'text-[11px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[20px] text-center',
          'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        )}>
          {bandData.totalItems}
        </span>
      </button>

      {bandExpanded && (
        <div className="space-y-1.5">
          {/* Module cards in a horizontal row */}
          <div className={clsx(
            'grid gap-1.5',
            allModules.length >= 3 ? 'grid-cols-3' : allModules.length === 2 ? 'grid-cols-2' : 'grid-cols-1',
          )}>
            {allModules.map(({ stack, config: cfg }) => (
              <ProgressModuleCard
                key={stack.stackKey}
                stack={stack}
                config={cfg}
                isExpanded={expandedKind === stack.kind}
                onToggle={() => setExpandedKind(expandedKind === stack.kind ? null : stack.kind)}
              />
            ))}
          </div>

          {/* Expanded item list — full width below the grid */}
          {expandedKind && (
            <ExpandedModuleList
              stack={allModules.find(m => m.stack.kind === expandedKind)?.stack ?? null}
              onItemClick={onItemClick}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProgressModuleCard — Compact card in the horizontal grid
// ---------------------------------------------------------------------------

const STATUS_DESCRIPTOR_STYLE: Record<string, string> = {
  'At Risk': 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  'Stale': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'Stalled': 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  'Overdue': 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  'Blocked': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'Aging': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
}

function ProgressModuleCard({
  stack,
  config,
  isExpanded,
  onToggle,
}: {
  stack: CockpitStack
  config: {
    icon: React.FC<{ className?: string }>
    title: string
    accent: string
    statusLine: (stack: CockpitStack) => string
    statusDescriptor?: (stack: CockpitStack) => string | null
  }
  isExpanded: boolean
  onToggle: () => void
}) {
  const Icon = config.icon
  const statusText = config.statusLine(stack)
  const descriptor = config.statusDescriptor?.(stack) ?? null

  return (
    <button
      onClick={onToggle}
      className={clsx(
        'text-left rounded-lg border bg-white dark:bg-gray-800/60 overflow-hidden transition-all',
        'border-l-[2px]',
        config.accent,
        isExpanded
          ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-200/50 dark:ring-amber-800/30'
          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50/30 dark:hover:bg-gray-700/20',
      )}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
          <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-200 truncate">
            {config.title}
          </span>
          <span className="text-[15px] font-bold text-gray-700 dark:text-gray-200 tabular-nums ml-auto shrink-0">
            {stack.count}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {descriptor && (
            <span className={clsx(
              'text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded shrink-0',
              STATUS_DESCRIPTOR_STYLE[descriptor] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
            )}>
              {descriptor}
            </span>
          )}
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
            {statusText}
          </span>
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// ExpandedModuleList — Full-width item list below the grid
// ---------------------------------------------------------------------------

function ExpandedModuleList({
  stack,
  onItemClick,
}: {
  stack: CockpitStack | null
  onItemClick?: (item: DashboardItem) => void
}) {
  if (!stack || stack.itemsAll.length === 0) return null

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className="divide-y divide-gray-50 dark:divide-gray-700/20">
        {stack.itemsAll.map(item => (
          <AdvanceItemRow
            key={item.id}
            item={item}
            onItemClick={onItemClick}
          />
        ))}
      </div>
      <div className="flex justify-end px-3 py-1.5 border-t border-gray-100 dark:border-gray-700/40">
        <button
          onClick={(e) => {
            e.stopPropagation()
            stack.primaryCTA.onClick()
          }}
          className="flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          {stack.primaryCTA.label}
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AdvanceItemRow — Compact item row for ADVANCE modules
// ---------------------------------------------------------------------------

function AdvanceItemRow({
  item,
  onItemClick,
}: {
  item: DashboardItem
  onItemClick?: (item: DashboardItem) => void
}) {
  const handleClick = useCallback(() => {
    onItemClick?.(item)
  }, [item, onItemClick])

  const age = item.ageDays ?? 0
  const overdue = item.meta?.overdueDays ?? 0
  const displayAge = overdue > 0 ? overdue : age
  const isCritical = item.severity === 'HIGH' || overdue >= 10 || age >= 180

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'flex items-center gap-2 px-3 py-[5px] group',
        onItemClick && 'cursor-pointer',
        'hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors',
      )}
    >
      <span className={clsx(
        'shrink-0 text-[10px] font-bold tabular-nums w-[26px] text-right',
        overdue > 0
          ? overdue >= 7 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
          : age >= 14 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500',
      )}>
        {displayAge}d
      </span>

      {item.asset?.ticker && (
        <span className={clsx(
          'shrink-0 text-[11px] font-bold',
          isCritical ? 'text-gray-800 dark:text-gray-100' : 'text-blue-600 dark:text-blue-400',
        )}>
          {item.asset.ticker}
        </span>
      )}

      <span className={clsx(
        'flex-1 min-w-0 text-[11px] truncate',
        isCritical ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-500 dark:text-gray-400',
      )}>
        {item.title}
      </span>

      {item.portfolio?.name && (
        <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {item.portfolio.name}
        </span>
      )}
    </div>
  )
}
