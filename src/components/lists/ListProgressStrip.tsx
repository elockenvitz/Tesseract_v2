import React, { useMemo } from 'react'
import { clsx } from 'clsx'
import type { ListStatus } from '../../hooks/lists/useListStatuses'

interface ListProgressStripProps {
  statuses: ListStatus[]
  /** The visible assets (already mapped to carry _statusId). */
  assets: Array<{ _statusId: string | null | undefined }>
  /** Called with a statusId (or null for "no status") when a chip is clicked. */
  onFilterByStatus?: (statusId: string | null) => void
  /** Currently filtered status IDs (for highlighting the active chip). */
  activeStatusIds?: string[]
}

const UNASSIGNED_KEY = '__none__'
const UNASSIGNED_COLOR = '#d1d5db'

export function ListProgressStrip({
  statuses,
  assets,
  onFilterByStatus,
  activeStatusIds = []
}: ListProgressStripProps) {
  const { segments, total } = useMemo(() => {
    const counts = new Map<string, number>()
    counts.set(UNASSIGNED_KEY, 0)
    for (const s of statuses) counts.set(s.id, 0)
    for (const a of assets) {
      const k = a._statusId ?? UNASSIGNED_KEY
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }

    const segments = [
      ...statuses.map(s => ({
        key: s.id,
        label: s.name,
        color: s.color,
        count: counts.get(s.id) ?? 0,
        id: s.id as string | null
      })),
      {
        key: UNASSIGNED_KEY,
        label: 'No status',
        color: UNASSIGNED_COLOR,
        count: counts.get(UNASSIGNED_KEY) ?? 0,
        id: null as string | null
      }
    ]
    return { segments, total: assets.length }
  }, [statuses, assets])

  if (total === 0) return null

  const activeSet = new Set(activeStatusIds)
  const isClickable = !!onFilterByStatus
  const anyActive = activeSet.size > 0

  // Hide empty statuses unless they're the active filter (keeps an escape path)
  const visible = segments.filter(seg =>
    seg.count > 0 || (seg.id !== null && activeSet.has(seg.id))
  )

  return (
    <div className="flex items-center gap-1 flex-wrap text-[11px]">
      {visible.map(seg => {
        const isActive = seg.id !== null && activeSet.has(seg.id)
        const dimmed = anyActive && !isActive
        return (
          <button
            key={seg.key}
            onClick={() => isClickable && onFilterByStatus?.(seg.id)}
            disabled={!isClickable}
            className={clsx(
              'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md transition-all',
              isClickable ? 'cursor-pointer' : 'cursor-default',
              isActive
                ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                : isClickable
                  ? 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  : 'text-gray-600 dark:text-gray-400',
              dimmed && 'opacity-60'
            )}
            title={isActive ? `Remove ${seg.label} filter` : `Filter by ${seg.label}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: seg.color }}
            />
            <span className="tabular-nums font-medium">{seg.count}</span>
            <span className={clsx(isActive ? '' : 'text-gray-500 dark:text-gray-400')}>
              {seg.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
