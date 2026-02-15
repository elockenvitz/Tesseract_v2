/**
 * AssetDecisionView — Asset page "Needs Attention" + "Radar" surface.
 *
 * Filtered view of the global decision engine output for a single asset.
 * Two sections:
 *   1. Needs Attention (action items) — stronger visual hierarchy
 *   2. Radar (intel items) — softer, blue accent, dismissible
 *
 * No local evaluator logic. No additional suppression beyond engine.
 * Items are exactly what runGlobalDecisionEngine produces for this asset.
 *
 * Collapsed by default. Per-asset localStorage persistence.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ChevronRight,
  AlertTriangle,
  Radar,
  MoreVertical,
} from 'lucide-react'
import { useDecisionEngine } from '../../engine/decisionEngine/useDecisionEngine'
import { dispatchDecisionAction } from '../../engine/decisionEngine'
import type {
  DecisionItem,
  DecisionCategory,
  DecisionSeverity,
} from '../../engine/decisionEngine'
import { useAuth } from '../../hooks/useAuth'
import { getDismissedIds, dismiss } from '../../engine/decisionEngine/dismissals'

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_COLLAPSED_PREFIX = 'assetDecision.collapsed.'

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE_ACTION = 5
const MAX_VISIBLE_INTEL = 5

// ---------------------------------------------------------------------------
// Category styling (shared with dashboard cards)
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

// ---------------------------------------------------------------------------
// Severity styling
// ---------------------------------------------------------------------------

const SEVERITY_BORDER: Record<DecisionSeverity, string> = {
  red: 'border-l-red-600 dark:border-l-red-500',
  orange: 'border-l-amber-400 dark:border-l-amber-500',
  blue: 'border-l-blue-400 dark:border-l-blue-500',
  gray: 'border-l-gray-300 dark:border-l-gray-600',
}

const SEVERITY_BG: Record<DecisionSeverity, string> = {
  red: 'bg-red-50/40 dark:bg-red-950/20',
  orange: 'bg-amber-50/25 dark:bg-amber-950/10',
  blue: '',
  gray: '',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AssetDecisionViewProps {
  assetId: string
}

export function AssetDecisionView({ assetId }: AssetDecisionViewProps) {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const { selectForAsset, isLoading } = useDecisionEngine()

  // Slice from engine
  const { action: rawAction, intel: rawIntel } = selectForAsset(assetId)

  // Intel dismissal (shared localStorage with dashboard)
  const [dismissedIds, setDismissedIdsState] = useState<Set<string>>(
    () => getDismissedIds(userId),
  )

  useEffect(() => {
    setDismissedIdsState(getDismissedIds(userId))
  }, [userId])

  const dismissIntel = useCallback((id: string) => {
    setDismissedIdsState(prev => {
      const next = new Set(prev)
      next.add(id)
      dismiss(userId, id)
      return next
    })
  }, [userId])

  const visibleIntel = useMemo(
    () => rawIntel.filter(i => !dismissedIds.has(i.id)),
    [rawIntel, dismissedIds],
  )

  // Counts
  const actionCount = rawAction.length
  const intelCount = visibleIntel.length
  const totalCount = actionCount + intelCount

  // Collapse state (per-asset, defaults to collapsed)
  const collapseKey = `${LS_COLLAPSED_PREFIX}${assetId}`
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

  // Show more / less
  const [showAllAction, setShowAllAction] = useState(false)
  const [showAllIntel, setShowAllIntel] = useState(false)
  const hasOverflowAction = actionCount > MAX_VISIBLE_ACTION
  const hasOverflowIntel = intelCount > MAX_VISIBLE_INTEL
  const visibleActionItems = showAllAction ? rawAction : rawAction.slice(0, MAX_VISIBLE_ACTION)
  const visibleIntelItems = showAllIntel ? visibleIntel : visibleIntel.slice(0, MAX_VISIBLE_INTEL)

  // Reset showAll when counts change
  useEffect(() => { setShowAllAction(false) }, [actionCount])
  useEffect(() => { setShowAllIntel(false) }, [intelCount])

  // Render nothing if loading or no items
  if (isLoading || totalCount === 0) return null

  const hasRed = rawAction.some(i => i.severity === 'red')

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

        {/* Action count */}
        {actionCount > 0 && (
          <>
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
              {actionCount}
            </span>
          </>
        )}

        {/* Intel count */}
        {intelCount > 0 && (
          <>
            {actionCount > 0 && <span className="text-gray-200 dark:text-gray-700 mx-0.5">|</span>}
            <Radar className="w-3 h-3 text-blue-400" />
            {actionCount === 0 && (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Radar
              </span>
            )}
            <span className="text-[10px] font-semibold px-1.5 py-px rounded-full tabular-nums bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {intelCount}
            </span>
          </>
        )}
      </button>

      {/* ---- Expanded content ---- */}
      {!isCollapsed && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {/* Action items section */}
          {actionCount > 0 && (
            <>
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {visibleActionItems.map(item => (
                  <ActionRow key={item.id} item={item} />
                ))}
              </div>
              {hasOverflowAction && (
                <button
                  onClick={() => setShowAllAction(s => !s)}
                  className="w-full text-center text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1.5 border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors"
                >
                  {showAllAction ? 'Show less' : `Show ${actionCount - MAX_VISIBLE_ACTION} more`}
                </button>
              )}
            </>
          )}

          {/* Intel items section */}
          {intelCount > 0 && (
            <>
              {actionCount > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50/50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-700/50">
                  <Radar className="w-3 h-3 text-blue-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    Radar
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-px rounded-full tabular-nums bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {intelCount}
                  </span>
                </div>
              )}
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {visibleIntelItems.map(item => (
                  <IntelRow
                    key={item.id}
                    item={item}
                    onDismiss={() => dismissIntel(item.id)}
                  />
                ))}
              </div>
              {hasOverflowIntel && (
                <button
                  onClick={() => setShowAllIntel(s => !s)}
                  className="w-full text-center text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1.5 border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors"
                >
                  {showAllIntel ? 'Show less' : `Show ${intelCount - MAX_VISIBLE_INTEL} more`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionRow — Strong hierarchy (red/orange accent)
// ---------------------------------------------------------------------------

function ActionRow({ item }: { item: DecisionItem }) {
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
    <div className={clsx(
      'flex items-start gap-2 px-3 py-2 group',
      item.severity === 'red' ? 'border-l-4' : 'border-l-[3px]',
      SEVERITY_BORDER[item.severity],
      SEVERITY_BG[item.severity],
    )}>
      {/* Category pill */}
      <span className={clsx(
        'shrink-0 text-[9px] font-semibold uppercase px-1.5 py-px rounded mt-0.5',
        CATEGORY_PILL[item.category],
      )}>
        {CATEGORY_LABEL[item.category]}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={clsx(
          'text-[11px] text-gray-800 dark:text-gray-100',
          item.severity === 'red' ? 'font-bold' : 'font-semibold',
        )}>
          {item.title}
        </div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug truncate">
          {item.description}
        </div>
        {item.chips && item.chips.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {item.chips.map((chip, i) => (
              <span
                key={i}
                className="text-[9px] font-medium px-1.5 py-px rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {chip.label}: {chip.value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Primary CTA */}
      {primary && primary.actionKey !== 'DISMISS' && (
        <button
          onClick={handleCTA}
          className={clsx(
            'shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded transition-colors mt-0.5',
            item.severity === 'red'
              ? 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50'
              : 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50',
          )}
        >
          {primary.label}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IntelRow — Softer hierarchy (blue accent, dismissible)
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
    <div className="flex items-start gap-2 px-3 py-2 border-l-[3px] border-l-blue-300 dark:border-l-blue-600 group">
      {/* Category pill */}
      <span className={clsx(
        'shrink-0 text-[9px] font-semibold uppercase px-1.5 py-px rounded mt-0.5',
        CATEGORY_PILL[item.category],
      )}>
        {CATEGORY_LABEL[item.category]}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">
          {item.title}
        </div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug truncate">
          {item.description}
        </div>
        {item.chips && item.chips.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {item.chips.map((chip, i) => (
              <span
                key={i}
                className="text-[9px] font-medium px-1.5 py-px rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {chip.label}: {chip.value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* CTA + dismiss */}
      <div className="shrink-0 flex items-center gap-1 mt-0.5">
        {primary && primary.actionKey !== 'DISMISS' && (
          <button
            onClick={handleCTA}
            className="text-[10px] font-semibold px-2 py-0.5 rounded text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
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
            className="w-full text-left text-[11px] px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-600 dark:text-gray-300"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
