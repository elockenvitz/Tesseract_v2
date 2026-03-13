/**
 * CounterViewsSection — Displays linked opposing ideas in trade idea detail views.
 *
 * Shows each counter-view as a card with action badge, creator, rationale preview,
 * and navigation link. Used in TradeIdeaDetailModal.
 */

import { ArrowLeftRight, ArrowRight, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { useCounterViews } from '../../hooks/useCounterViews'
import type { CounterViewSummary } from '../../hooks/useCounterViews'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CounterViewsSectionProps {
  tradeIdeaId: string
  onNavigateToIdea?: (ideaId: string) => void
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_COLOR: Record<string, { text: string; bg: string }> = {
  buy:  { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
  add:  { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
  sell: { text: 'text-red-700 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/30' },
  trim: { text: 'text-red-700 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/30' },
}

const STAGE_LABEL: Record<string, string> = {
  idea: 'Idea',
  working_on: 'Working On',
  modeling: 'Modeling',
  deciding: 'Deciding',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CounterViewsSection({
  tradeIdeaId,
  onNavigateToIdea,
  className,
}: CounterViewsSectionProps) {
  const { data: counterViews, isLoading } = useCounterViews(tradeIdeaId)

  if (isLoading || !counterViews || counterViews.length === 0) return null

  return (
    <div className={clsx('space-y-2', className)}>
      <div className="flex items-center gap-1.5">
        <ArrowLeftRight className="h-3.5 w-3.5 text-violet-500" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-500">
          Opposing Views
        </span>
        <span className="text-[10px] text-violet-400">({counterViews.length})</span>
      </div>

      {counterViews.map(cv => (
        <CounterViewCard
          key={cv.id}
          counterView={cv}
          onNavigate={onNavigateToIdea ? () => onNavigateToIdea(cv.id) : undefined}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function CounterViewCard({
  counterView,
  onNavigate,
}: {
  counterView: CounterViewSummary
  onNavigate?: () => void
}) {
  const actionColor = ACTION_COLOR[counterView.action] || { text: 'text-gray-600', bg: 'bg-gray-100' }
  const stageLabel = STAGE_LABEL[counterView.stage] || counterView.stage

  return (
    <div className="border border-violet-200/60 dark:border-violet-800/40 rounded-lg bg-violet-50/30 dark:bg-violet-900/10 p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={clsx(
            'text-[9px] font-bold uppercase px-1.5 py-[2px] rounded',
            actionColor.text, actionColor.bg,
          )}>
            {counterView.action}
          </span>
          <span className="text-[12px] font-semibold text-gray-900 dark:text-white">
            {counterView.asset_symbol || '?'}
          </span>
          <span className="text-[9px] text-gray-400 dark:text-gray-500 uppercase">
            {stageLabel}
          </span>
        </div>
        {onNavigate && (
          <button
            onClick={onNavigate}
            className="text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 p-0.5 rounded hover:bg-violet-100 dark:hover:bg-violet-800/40"
            title="Open counter-view"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>

      {counterView.rationale && (
        <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3 mb-1.5">
          {counterView.rationale}
        </p>
      )}

      <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
        {counterView.creator_name && (
          <span>{counterView.creator_name}</span>
        )}
        {counterView.created_at && (
          <>
            <span>{'\u00B7'}</span>
            <span>{format(new Date(counterView.created_at), 'MMM d')}</span>
          </>
        )}
        <span className={clsx(
          'ml-auto text-[8px] uppercase font-medium px-1 py-px rounded',
          counterView.relationship === 'opposed_by'
            ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
        )}>
          {counterView.relationship === 'opposed_by' ? 'Counter-view' : 'Original'}
        </span>
      </div>
    </div>
  )
}
