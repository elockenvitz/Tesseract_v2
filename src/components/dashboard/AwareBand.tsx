/**
 * AwareBand — Calm monitoring section.
 *
 * Lower-intensity than DECIDE/ADVANCE. Shows items to monitor:
 *   - Rating changes
 *   - Intelligence signals
 *   - Coverage freshness concerns
 *
 * Compact rows, muted styling, collapsible.
 * Designed to be informative without demanding action.
 */

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, Eye } from 'lucide-react'
import type { CockpitBandData, CockpitStack } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// LocalStorage
// ---------------------------------------------------------------------------

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v === 'true'
  } catch { /* noop */ }
  return fallback
}

function writeBool(key: string, value: boolean) {
  try { localStorage.setItem(key, String(value)) } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AwareBandProps {
  id?: string
  bandData: CockpitBandData
  onItemClick?: (item: DashboardItem) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AwareBand({ id, bandData, onItemClick }: AwareBandProps) {
  const storageKey = 'cockpit-band-AWARE'
  const [expanded, setExpanded] = useState(() => readBool(storageKey, false))

  useEffect(() => { writeBool(storageKey, expanded) }, [expanded])

  const toggleExpanded = useCallback(() => setExpanded(e => !e), [])

  if (bandData.stacks.length === 0) {
    return (
      <div id={id} className="rounded-lg border border-gray-100 dark:border-gray-700/40 bg-gray-50/30 dark:bg-gray-800/20 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2">
          <Eye className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
          <span className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">
            AWARE
          </span>
          <div className="flex-1" />
          <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">
            Coverage within normal bounds.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className="rounded-lg border border-gray-100 dark:border-gray-700/40 bg-gray-50/30 dark:bg-gray-800/20 overflow-hidden">
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center gap-2 px-3.5 py-2 text-left hover:bg-gray-100/40 dark:hover:bg-gray-700/20 transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-500" />
          : <ChevronRight className="w-3 h-3 text-gray-400 dark:text-gray-500" />
        }
        <Eye className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
        <span className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">
          AWARE
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          Monitoring
        </span>
        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 tabular-nums bg-gray-200/60 dark:bg-gray-700/40 px-1.5 py-px rounded-full">
          {bandData.totalItems}
        </span>

        {/* Inline summary when collapsed */}
        {!expanded && (
          <span className="flex-1 text-[10px] text-gray-400 dark:text-gray-500 text-right truncate">
            {bandData.stacks.map(s => `${s.count} ${s.title.toLowerCase()}`).join(' \u00B7 ')}
          </span>
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700/30 divide-y divide-gray-100/50 dark:divide-gray-700/20">
          {bandData.stacks.map(stack => (
            <AwareStackGroup key={stack.stackKey} stack={stack} onItemClick={onItemClick} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AwareStackGroup
// ---------------------------------------------------------------------------

function AwareStackGroup({
  stack,
  onItemClick,
}: {
  stack: CockpitStack
  onItemClick?: (item: DashboardItem) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const previewCount = 3
  const visible = showAll ? stack.itemsAll : stack.itemsAll.slice(0, previewCount)

  return (
    <div>
      {/* Stack label */}
      <div className="flex items-center gap-2 px-3.5 py-1.5 bg-gray-50/50 dark:bg-gray-800/30">
        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          {stack.title}
        </span>
        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 tabular-nums">
          {stack.count}
        </span>
      </div>

      {/* Items */}
      <div className="divide-y divide-gray-50 dark:divide-gray-700/20">
        {visible.map(item => (
          <AwareItemRow key={item.id} item={item} onItemClick={onItemClick} />
        ))}
      </div>

      {stack.count > previewCount && (
        <button
          onClick={() => setShowAll(e => !e)}
          className="w-full text-center py-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {showAll ? 'Show less' : `+${stack.count - previewCount} more`}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AwareItemRow — Compact monitoring row
// ---------------------------------------------------------------------------

function AwareItemRow({
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

  // Build detail text
  let detail = ''
  if (item.meta?.ratingFrom && item.meta?.ratingTo) {
    detail = `${item.meta.ratingFrom} \u2192 ${item.meta.ratingTo}`
  } else if (item.reason) {
    detail = item.reason.length > 60 ? item.reason.slice(0, 57) + '...' : item.reason
  }

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'flex items-center gap-2 px-3.5 py-[4px] group',
        onItemClick && 'cursor-pointer',
        'hover:bg-gray-100/40 dark:hover:bg-gray-700/20 transition-colors',
      )}
    >
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-gray-400 dark:text-gray-500 w-[22px] text-right">
        {age}d
      </span>

      {item.asset?.ticker && (
        <span className="shrink-0 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          {item.asset.ticker}
        </span>
      )}

      <span className="flex-1 min-w-0 text-[10px] text-gray-400 dark:text-gray-500 truncate">
        {detail || item.title}
      </span>

      {item.portfolio?.name && (
        <span className="shrink-0 text-[9px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {item.portfolio.name}
        </span>
      )}
    </div>
  )
}
