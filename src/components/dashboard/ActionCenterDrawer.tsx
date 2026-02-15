/**
 * ActionCenterDrawer — Right slide-in panel for rollup drilldown.
 *
 * Shows expanded list of child items from a rollup row,
 * each with severity accent, category pill, chips, and primary CTA.
 */

import { useCallback, useEffect } from 'react'
import { clsx } from 'clsx'
import { X } from 'lucide-react'
import { dispatchDecisionAction } from '../../engine/decisionEngine'
import type { DecisionItem, DecisionSeverity, DecisionCategory } from '../../engine/decisionEngine'

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

const SEVERITY_BORDER: Record<DecisionSeverity, string> = {
  red: 'border-l-red-600 dark:border-l-red-500',
  orange: 'border-l-amber-400 dark:border-l-amber-500',
  blue: 'border-l-blue-400 dark:border-l-blue-500',
  gray: 'border-l-gray-300 dark:border-l-gray-600',
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

interface ActionCenterDrawerProps {
  title: string
  items: DecisionItem[]
  onClose: () => void
}

export function ActionCenterDrawer({ title, items, onClose }: ActionCenterDrawerProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 dark:bg-black/40 z-30"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 z-30 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700/40 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto">
          {items.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {items.map(item => (
                <DrawerItem key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-[12px] text-gray-400 dark:text-gray-500">
              No items.
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// DrawerItem
// ---------------------------------------------------------------------------

function DrawerItem({ item }: { item: DecisionItem }) {
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
    <div className={clsx(
      'flex items-center gap-2 px-4 py-2 border-l-[3px]',
      SEVERITY_BORDER[item.severity],
    )}>
      {/* Category pill */}
      <span className={clsx(
        'shrink-0 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded',
        CATEGORY_PILL[item.category],
      )}>
        {CATEGORY_LABEL[item.category]}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-gray-800 dark:text-gray-100 leading-tight">
          {item.title}
        </div>
        {item.description && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug truncate">
            {item.description}
          </div>
        )}
        {item.chips && item.chips.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {item.chips.map((chip, i) => (
              <span
                key={i}
                className="text-[9px] font-medium px-1.5 py-px rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
              >
                {chip.label}: {chip.value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* CTA — consistent with dashboard cards */}
      {primary && (
        <button
          onClick={handleCTA}
          className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded transition-colors text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-600/50"
        >
          {primary.label}
        </button>
      )}
    </div>
  )
}
