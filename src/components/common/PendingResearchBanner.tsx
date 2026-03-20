/**
 * PendingResearchBanner — Shows linking context when creating research
 * from a trade idea modal.
 *
 * Reads from pendingResearchLinksStore. Renders a compact banner
 * showing what the new object will be linked to on save.
 */

import { X } from 'lucide-react'
import { usePendingResearchLinksStore } from '../../stores/pendingResearchLinksStore'

export function PendingResearchBanner() {
  const context = usePendingResearchLinksStore(s => s.context)
  const clear = usePendingResearchLinksStore(s => s.clear)

  if (!context) return null

  const datePart = context.createdAt
    ? new Date(context.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const metaParts = [context.portfolioName, context.creatorName, datePart].filter(Boolean)

  return (
    <div className="mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200/60 dark:border-blue-800/40 rounded-md">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="text-[10px] font-medium text-blue-500 dark:text-blue-400 uppercase tracking-wide">Linked to</div>
          <div>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{context.ideaLabel}</span>
            {metaParts.length > 0 && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-1.5">
                {metaParts.join(' · ')}
              </span>
            )}
          </div>
          {context.argumentLabel && (
            <div className="text-[11px] text-gray-600 dark:text-gray-300 truncate">
              {context.argumentLabel}
            </div>
          )}
          {context.assetSymbols.length > 0 && (
            <div className="text-[10px] text-gray-400">
              {context.assetSymbols.length === 1 ? 'Asset' : 'Assets'}: {context.assetSymbols.join(', ')}
            </div>
          )}
        </div>
        <button
          onClick={clear}
          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
          title="Remove linking context"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
