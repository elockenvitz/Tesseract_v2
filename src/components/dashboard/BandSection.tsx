/**
 * BandSection — Renders one CockpitBandData (DECIDE / ADVANCE / AWARE).
 *
 * Collapsible header with count badge and oldest-days indicator.
 * Body renders ActionStackCards. DECIDE is always expanded.
 * Collapse state persisted in localStorage.
 */

import { useState, useCallback, useEffect } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ActionStackCard } from './ActionStackCard'
import type { CockpitBand, CockpitBandData } from '../../types/cockpit'
import type { DashboardItem } from '../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Band visual config
// ---------------------------------------------------------------------------

const BAND_STYLE: Record<CockpitBand, {
  container: string
  headerBg: string
  title: string
  badge: string
  icon: string
}> = {
  DECIDE: {
    container: 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden',
    headerBg: 'bg-red-50/20 dark:bg-red-950/10',
    title: 'text-gray-900 dark:text-gray-50',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    icon: 'text-red-400 dark:text-red-500',
  },
  ADVANCE: {
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
  INVESTIGATE: {
    container: 'rounded-lg border border-violet-100 dark:border-violet-900/30 bg-violet-50/20 dark:bg-violet-950/10 overflow-hidden',
    headerBg: '',
    title: 'text-violet-700 dark:text-violet-300',
    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    icon: 'text-violet-400 dark:text-violet-500',
  },
}

const EMPTY_STATE: Record<CockpitBand, string> = {
  DECIDE: "You're clear. No blockers.",
  ADVANCE: 'No follow-ups needed.',
  AWARE: 'Monitoring your coverage. No active signals.',
  INVESTIGATE: 'Nothing flagged. No items to investigate.',
}

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

interface BandSectionProps {
  id?: string
  bandData: CockpitBandData
  defaultExpanded?: boolean
  onItemClick?: (item: DashboardItem) => void
  onSnooze?: (itemId: string, hours: number) => void
  /** Increment to force-collapse all non-DECIDE bands */
  collapseAllTrigger?: number
}

export function BandSection({
  id,
  bandData,
  defaultExpanded = false,
  onItemClick,
  onSnooze,
  collapseAllTrigger = 0,
}: BandSectionProps) {
  const band = bandData.band
  const style = BAND_STYLE[band]
  const storageKey = `cockpit-band-${band}`
  const isDecide = band === 'DECIDE'

  // DECIDE always expanded; others persist in localStorage
  const [expanded, setExpanded] = useState(() => {
    if (isDecide) return true
    return readBool(storageKey, defaultExpanded)
  })

  // Persist expand/collapse
  useEffect(() => {
    if (!isDecide) writeBool(storageKey, expanded)
  }, [expanded, isDecide, storageKey])

  // React to collapse-all (skip DECIDE)
  useEffect(() => {
    if (collapseAllTrigger > 0 && !isDecide) {
      setExpanded(false)
    }
  }, [collapseAllTrigger, isDecide])

  const toggleExpanded = useCallback(() => {
    if (isDecide) return
    setExpanded(e => !e)
  }, [isDecide])

  // ---- Empty state ----
  if (bandData.stacks.length === 0) {
    return (
      <div id={id} className={style.container}>
        <div className={clsx('flex items-center gap-2 px-3 py-2.5', style.headerBg)}>
          <ChevronRight className={clsx('w-3.5 h-3.5', style.icon)} />
          <h2 className={clsx('text-[13px] font-semibold', style.title)}>
            {bandData.title}
          </h2>
          <div className="flex-1" />
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">
            {EMPTY_STATE[band]}
          </span>
        </div>
      </div>
    )
  }

  // ---- DECIDE: always expanded ----
  if (isDecide) {
    return (
      <div id={id} className={style.container}>
        <div className={clsx('flex items-center gap-2 px-3 py-2.5', style.headerBg)}>
          <h2 className={clsx('text-[13px] font-semibold', style.title)}>
            {bandData.title}
          </h2>
          <span className={clsx(
            'text-[11px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[20px] text-center',
            style.badge,
          )}>
            {bandData.totalItems}
          </span>
        </div>
        <div className="p-2 space-y-2">
          {bandData.stacks.map(stack => (
            <ActionStackCard
              key={stack.stackKey}
              stack={stack}
              onItemClick={onItemClick}
              onSnooze={onSnooze}
            />
          ))}
        </div>
      </div>
    )
  }

  // ---- ADVANCE / AWARE: collapsible ----
  return (
    <div id={id} className={style.container}>
      <button
        onClick={toggleExpanded}
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-2.5 text-left',
          'hover:bg-gray-50/30 dark:hover:bg-gray-700/20 transition-colors',
          style.headerBg,
        )}
      >
        {expanded ? (
          <ChevronDown className={clsx('w-3.5 h-3.5 shrink-0', style.icon)} />
        ) : (
          <ChevronRight className={clsx('w-3.5 h-3.5 shrink-0', style.icon)} />
        )}
        <h2 className={clsx('text-[13px] font-semibold', style.title)}>
          {bandData.title}
        </h2>
        <span className={clsx(
          'text-[11px] font-bold px-1.5 py-px rounded-full tabular-nums min-w-[20px] text-center',
          style.badge,
        )}>
          {bandData.totalItems}
        </span>
      </button>
      {expanded && (
        <div className="p-2 space-y-2">
          {bandData.stacks.map(stack => (
            <ActionStackCard
              key={stack.stackKey}
              stack={stack}
              onItemClick={onItemClick}
              onSnooze={onSnooze}
              hideItemActions={band === 'AWARE'}
            />
          ))}
        </div>
      )}
    </div>
  )
}
