/**
 * DashboardBand — Band-specific rendering for the Decision Engine Console.
 *
 * NOW:   HIGH severity only, flat list, always expanded, max 8 items.
 *        Header: "NOW — Requires Action (N) Oldest: Xd"
 *
 * SOON:  Type-grouped sub-clusters, independently collapsible.
 *        Header: "SOON — Needs Progress (N) Oldest: Xd"
 *        Sub-groups: collapsed by default with counts.
 *
 * AWARE: Softer visual, collapsed by default, no action buttons.
 *        Empty state: "Monitoring your coverage. No active signals."
 *
 * Band expand/collapse persisted in localStorage.
 * Supports collapseAllTrigger (increment to force collapse, skips NOW).
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DashboardRow } from './DashboardRow'
import { groupItems } from '../../lib/dashboard/mapGdeToDashboardItems'
import type {
  DashboardItem,
  DashboardBand as BandType,
  DashboardBandSummary,
} from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Band visual config
// ---------------------------------------------------------------------------

const BAND_STYLE: Record<BandType, {
  container: string
  headerBg: string
  title: string
  badge: string
  icon: string
}> = {
  NOW: {
    container: 'border-l-[2px] border-l-red-500 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden',
    headerBg: 'bg-red-50/20 dark:bg-red-950/10',
    title: 'text-gray-900 dark:text-gray-50',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    icon: 'text-red-400 dark:text-red-500',
  },
  SOON: {
    container: 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden',
    headerBg: '',
    title: 'text-gray-800 dark:text-gray-100',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    icon: 'text-gray-400 dark:text-gray-500',
  },
  AWARE: {
    container: 'rounded-lg border border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 overflow-hidden',
    headerBg: '',
    title: 'text-gray-600 dark:text-gray-300',
    badge: 'bg-gray-200/80 text-gray-500 dark:bg-gray-700/60 dark:text-gray-400',
    icon: 'text-gray-300 dark:text-gray-600',
  },
}

const BAND_TITLE: Record<BandType, string> = {
  NOW: 'NOW \u2014 Requires Action',
  SOON: 'SOON \u2014 Needs Progress',
  AWARE: 'AWARE \u2014 Monitoring',
}

const EMPTY_STATE: Record<BandType, string> = {
  NOW: "You're clear. No blockers.",
  SOON: 'No follow-ups needed.',
  AWARE: 'Monitoring your coverage. No active signals.',
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NOW = 8

// ---------------------------------------------------------------------------
// LocalStorage helpers
// ---------------------------------------------------------------------------

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v === 'true'
  } catch { /* SSR / privacy */ }
  return fallback
}

function writeBool(key: string, value: boolean) {
  try { localStorage.setItem(key, String(value)) } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DashboardBandProps {
  bandKey: BandType
  items: DashboardItem[]
  summary: DashboardBandSummary
  defaultExpanded?: boolean
  onRowClick?: (item: DashboardItem) => void
  id?: string
  /** Increment to force-collapse all non-NOW bands */
  collapseAllTrigger?: number
}

export function DashboardBand({
  bandKey,
  items,
  summary,
  defaultExpanded = false,
  onRowClick,
  id,
  collapseAllTrigger = 0,
}: DashboardBandProps) {
  const style = BAND_STYLE[bandKey]
  const storageKey = `dashboard-band-${bandKey}`

  // NOW is always expanded; others persist in localStorage
  const [expanded, setExpanded] = useState(() => {
    if (bandKey === 'NOW') return true
    return readBool(storageKey, defaultExpanded)
  })

  // Persist expand/collapse
  useEffect(() => {
    if (bandKey !== 'NOW') writeBool(storageKey, expanded)
  }, [expanded, bandKey, storageKey])

  // React to collapse-all (skip NOW)
  useEffect(() => {
    if (collapseAllTrigger > 0 && bandKey !== 'NOW') {
      setExpanded(false)
    }
  }, [collapseAllTrigger, bandKey])

  const toggleExpanded = useCallback(() => {
    if (bandKey === 'NOW') return
    setExpanded(e => !e)
  }, [bandKey])

  // NOW: filter to HIGH severity only, cap at 8
  const visibleItems = useMemo(() => {
    if (bandKey === 'NOW') {
      return items.filter(i => i.severity === 'HIGH').slice(0, MAX_NOW)
    }
    return items
  }, [bandKey, items])

  // SOON: type-grouped sub-clusters
  const typeGroups = useMemo(() => {
    if (bandKey !== 'SOON') return null
    return groupItems(visibleItems, 'type')
  }, [bandKey, visibleItems])

  const hasItems = visibleItems.length > 0

  // ---- Empty state ----
  if (!hasItems) {
    return (
      <div id={id} className={style.container}>
        <div className={clsx('flex items-center gap-2 px-3 py-2', style.headerBg)}>
          <ChevronRight className={clsx('w-3 h-3', style.icon)} />
          <h2 className={clsx('text-[12px] font-semibold', style.title)}>
            {BAND_TITLE[bandKey]}
          </h2>
          <div className="flex-1" />
          <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">
            {EMPTY_STATE[bandKey]}
          </span>
        </div>
      </div>
    )
  }

  // ---- NOW band: flat, always expanded, HIGH only ----
  if (bandKey === 'NOW') {
    return (
      <div id={id} className={style.container}>
        <div className={clsx('flex items-center gap-2 px-3 py-2', style.headerBg)}>
          <h2 className={clsx('text-[12px] font-semibold', style.title)}>
            {BAND_TITLE[bandKey]}
          </h2>
          <span className={clsx(
            'text-[10px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[18px] text-center',
            style.badge,
          )}>
            {visibleItems.length}
          </span>
          <div className="flex-1" />
          {summary.oldestAgeDays > 0 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
              Oldest: {summary.oldestAgeDays}d
            </span>
          )}
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {visibleItems.map(item => (
            <DashboardRow key={item.id} item={item} onRowClick={onRowClick} />
          ))}
        </div>
      </div>
    )
  }

  // ---- AWARE band: softer, collapsed by default, no action buttons ----
  if (bandKey === 'AWARE') {
    return (
      <div id={id} className={style.container}>
        <button
          onClick={toggleExpanded}
          className={clsx(
            'w-full flex items-center gap-2 px-3 py-2 text-left',
            'hover:bg-gray-50/30 dark:hover:bg-gray-700/20 transition-colors',
          )}
        >
          {expanded ? (
            <ChevronDown className={clsx('w-3 h-3 shrink-0', style.icon)} />
          ) : (
            <ChevronRight className={clsx('w-3 h-3 shrink-0', style.icon)} />
          )}
          <h2 className={clsx('text-[12px] font-semibold', style.title)}>
            {BAND_TITLE[bandKey]}
          </h2>
          <span className={clsx(
            'text-[10px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[18px] text-center',
            style.badge,
          )}>
            {visibleItems.length}
          </span>
          <div className="flex-1" />
        </button>
        {expanded && (
          <div className="divide-y divide-gray-100/80 dark:divide-gray-700/30">
            {visibleItems.map(item => (
              <DashboardRow key={item.id} item={item} onRowClick={onRowClick} hideAction />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---- SOON band: type-grouped sub-clusters ----
  return (
    <div id={id} className={style.container}>
      <button
        onClick={toggleExpanded}
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-2 text-left',
          'hover:bg-gray-50/30 dark:hover:bg-gray-800/20 transition-colors',
          style.headerBg,
        )}
      >
        {expanded ? (
          <ChevronDown className={clsx('w-3 h-3 shrink-0', style.icon)} />
        ) : (
          <ChevronRight className={clsx('w-3 h-3 shrink-0', style.icon)} />
        )}
        <h2 className={clsx('text-[12px] font-semibold', style.title)}>
          {BAND_TITLE[bandKey]}
        </h2>
        <span className={clsx(
          'text-[10px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[18px] text-center',
          style.badge,
        )}>
          {summary.count}
        </span>
        <div className="flex-1" />
        {summary.oldestAgeDays > 0 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
            Oldest: {summary.oldestAgeDays}d
          </span>
        )}
      </button>
      {expanded && typeGroups && (
        <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {typeGroups.map(group => (
            <SoonTypeGroup
              key={group.key}
              group={group}
              onRowClick={onRowClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SOON sub-group — independently collapsible by type
// ---------------------------------------------------------------------------

function SoonTypeGroup({
  group,
  onRowClick,
}: {
  group: { key: string; label: string; items: DashboardItem[] }
  onRowClick?: (item: DashboardItem) => void
}) {
  const storageKey = `dashboard-soon-group-${group.key}`
  const [open, setOpen] = useState(() => readBool(storageKey, false))

  useEffect(() => {
    writeBool(storageKey, open)
  }, [open, storageKey])

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-4 py-1.5 bg-gray-50/50 dark:bg-gray-800/30 hover:bg-gray-100/50 dark:hover:bg-gray-700/30 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500" />
        )}
        <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {group.label}
        </span>
        <span className="text-[9px] text-gray-400 dark:text-gray-500 tabular-nums">
          ({group.items.length})
        </span>
      </button>
      {open && group.items.map(item => (
        <DashboardRow key={item.id} item={item} onRowClick={onRowClick} />
      ))}
    </div>
  )
}
