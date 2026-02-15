/**
 * DecisionEngineCard — Primary dashboard surface for capital & process decisions.
 *
 * Two visual tiers:
 *   Tier 1 — Capital at Risk: risk panel cards with dominant count,
 *            oldest age, secondary context, and right-aligned CTA.
 *   Tier 2 — Process Integrity Alerts: purple-tinted compact rows.
 *
 * The entire section uses a tinted background with a red left accent
 * to convey "active capital risk zone."
 *
 * Exported as MyActionQueueCard for backward compatibility.
 */

import { useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { Shield, ChevronRight } from 'lucide-react'
import { dispatchDecisionAction } from '../../engine/decisionEngine'
import type { DecisionItem, DecisionSeverity, DecisionCategory } from '../../engine/decisionEngine'

// ---------------------------------------------------------------------------
// Styling — consistent color system
// ---------------------------------------------------------------------------

/** Card left-border color by severity */
const SEVERITY_ACCENT: Record<DecisionSeverity, string> = {
  red: 'border-l-red-500',
  orange: 'border-l-amber-400 dark:border-l-amber-500',
  blue: 'border-l-blue-400 dark:border-l-blue-500',
  gray: 'border-l-gray-300 dark:border-l-gray-600',
}

/** Large count color by severity */
const SEVERITY_COUNT: Record<DecisionSeverity, string> = {
  red: 'text-red-600 dark:text-red-400',
  orange: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  gray: 'text-gray-500 dark:text-gray-400',
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MyActionQueueCardProps {
  items: DecisionItem[]
  /** Full unfiltered list for the "View All" drawer */
  allItems?: DecisionItem[]
  isLoading?: boolean
  onRollupClick?: (item: DecisionItem) => void
  onViewAll?: () => void
}

export function MyActionQueueCard({
  items,
  allItems,
  isLoading,
  onRollupClick,
  onViewAll,
}: MyActionQueueCardProps) {
  // Split items into tiers
  const { tier1, tier2 } = useMemo(() => {
    const t1: DecisionItem[] = []
    const t2: DecisionItem[] = []
    for (const item of items) {
      if (item.decisionTier === 'capital') {
        t1.push(item)
      } else {
        t2.push(item)
      }
    }
    return { tier1: t1, tier2: t2 }
  }, [items])

  const totalAll = allItems?.length ?? items.length

  if (isLoading) return null

  const hasRed = items.some(i => i.severity === 'red')
  const hasItems = items.length > 0

  return (
    <div className={clsx(
      'rounded-xl transition-colors',
      hasItems
        ? clsx(
            'border-l-[3px] p-5',
            hasRed
              ? 'border-l-red-500 bg-red-50/25 dark:bg-red-950/10'
              : 'border-l-amber-400 dark:border-l-amber-500 bg-amber-50/15 dark:bg-amber-950/8',
          )
        : 'p-5',
    )}>
      {/* Zone header */}
      <div className="flex items-center gap-2.5 mb-4">
        <Shield className={clsx(
          'w-5 h-5',
          hasRed ? 'text-red-500' : hasItems ? 'text-amber-500' : 'text-gray-400',
        )} />
        <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-50">
          Decision Engine
        </h2>
        {hasItems && (
          <span className={clsx(
            'text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums min-w-[20px] text-center',
            hasRed
              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
          )}>
            {totalAll}
          </span>
        )}
        <div className="flex-1" />
        {onViewAll && totalAll > 0 && (
          <button
            onClick={onViewAll}
            className="flex items-center gap-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            View all
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Empty state */}
      {!hasItems && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-5 py-5 text-[12px] text-gray-400 dark:text-gray-500">
          No pending decisions. You're clear.
        </div>
      )}

      {/* Tier 1: Capital at Risk — Risk Panel Cards */}
      {tier1.length > 0 && (
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-red-400/80 dark:text-red-500/60 mb-2.5">
            Capital at Risk
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {tier1.map(item => (
              <MetricCard
                key={item.id}
                item={item}
                onRollupClick={onRollupClick}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tier 2: Process Integrity Alerts — purple-tinted, lighter weight */}
      {tier2.length > 0 && (
        <div className={clsx(tier1.length > 0 && 'mt-5')}>
          <div className="text-[9px] font-bold uppercase tracking-wider text-purple-400/80 dark:text-purple-500/60 mb-2">
            Process Integrity
          </div>
          <div className="rounded-lg border border-purple-100 dark:border-purple-900/30 bg-purple-50/20 dark:bg-purple-950/10 divide-y divide-purple-100/50 dark:divide-purple-900/20">
            {tier2.map(item => (
              <IntegrityRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MetricCard — Tier 1 risk panel
// ---------------------------------------------------------------------------

function MetricCard({
  item,
  onRollupClick,
}: {
  item: DecisionItem
  onRollupClick?: (item: DecisionItem) => void
}) {
  const primary = item.ctas.find(c => c.kind === 'primary') || item.ctas[0]
  const childCount = item.children?.length ?? 0
  const count = childCount > 0 ? childCount : 1
  const chips = item.chips ?? []
  const oldestChip = chips.find(c =>
    c.label.toLowerCase().includes('oldest') || c.label.toLowerCase().includes('age'),
  )

  const handleClick = useCallback(() => {
    if (onRollupClick && item.children && item.children.length > 0) {
      onRollupClick(item)
    } else if (primary) {
      dispatchDecisionAction(primary.actionKey, {
        ...item.context,
        ...primary.payload,
      })
    }
  }, [primary, item, onRollupClick])

  return (
    <button
      onClick={handleClick}
      className={clsx(
        'text-left rounded-lg border-l-[3px] border border-gray-200/80 dark:border-gray-700',
        'bg-white dark:bg-gray-800/70 p-4',
        'shadow-sm hover:shadow-md hover:-translate-y-px transition-all duration-150',
        'group cursor-pointer',
        SEVERITY_ACCENT[item.severity],
      )}
    >
      {/* Label */}
      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 leading-tight mb-1.5 truncate">
        {item.title}
      </div>

      {/* Count (dominant) */}
      <div className={clsx(
        'text-[32px] font-extrabold leading-none tabular-nums',
        SEVERITY_COUNT[item.severity],
      )}>
        {count}
      </div>

      {/* Secondary context text */}
      {item.description && (
        <div className="text-[9px] text-gray-400 dark:text-gray-500 truncate mt-1">
          {item.description}
        </div>
      )}

      {/* Oldest age + CTA row */}
      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-gray-100 dark:border-gray-700/50">
        {oldestChip ? (
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            Oldest: <span className="font-semibold tabular-nums">{oldestChip.value}</span>
          </span>
        ) : (
          <span />
        )}
        {primary && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 group-hover:bg-gray-200 dark:group-hover:bg-gray-600/50 transition-colors">
            {primary.label}
          </span>
        )}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// IntegrityRow — Tier 2 compact alert row (purple = risk/integrity)
// ---------------------------------------------------------------------------

function IntegrityRow({ item }: { item: DecisionItem }) {
  const primary = item.ctas.find(c => c.kind === 'primary') || item.ctas[0]

  const handleCTA = useCallback(() => {
    if (primary) {
      dispatchDecisionAction(primary.actionKey, {
        ...item.context,
        ...primary.payload,
      })
    }
  }, [primary, item.context])

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className={clsx(
        'shrink-0 text-[8px] font-semibold uppercase px-1.5 py-0.5 rounded',
        CATEGORY_PILL[item.category],
      )}>
        {CATEGORY_LABEL[item.category]}
      </span>
      <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate flex-1">
        {item.title}
      </span>
      {item.chips && item.chips.length > 0 && (
        <span className="text-[9px] text-gray-400 dark:text-gray-500 tabular-nums shrink-0">
          {item.chips[0].value}
        </span>
      )}
      {primary && (
        <button
          onClick={handleCTA}
          className="shrink-0 text-[10px] font-medium text-purple-500 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-200 transition-colors"
        >
          {primary.label}
        </button>
      )}
    </div>
  )
}
