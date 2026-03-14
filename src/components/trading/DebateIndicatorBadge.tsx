/**
 * DebateIndicatorBadge — Shows bull/bear thesis counts on trade idea cards.
 *
 * Replaces CounterViewBadge. Shows "X Bull · Y Bear" when theses exist.
 */

import { TrendingUp, TrendingDown } from 'lucide-react'
import { useThesisCounts } from '../../hooks/useTheses'
import { clsx } from 'clsx'

interface DebateIndicatorBadgeProps {
  tradeIdeaId: string
  onClick?: () => void
  className?: string
}

export function DebateIndicatorBadge({ tradeIdeaId, onClick, className }: DebateIndicatorBadgeProps) {
  const { data: counts } = useThesisCounts(tradeIdeaId)

  if (!counts || (counts.bull === 0 && counts.bear === 0)) return null

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className={clsx(
        'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium',
        'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
        'hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
        className,
      )}
      title={`${counts.bull} bullish, ${counts.bear} bearish`}
    >
      {counts.bull > 0 && (
        <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
          <TrendingUp className="h-2.5 w-2.5" />
          {counts.bull}
        </span>
      )}
      {counts.bull > 0 && counts.bear > 0 && (
        <span className="text-gray-300 dark:text-gray-600">·</span>
      )}
      {counts.bear > 0 && (
        <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400">
          <TrendingDown className="h-2.5 w-2.5" />
          {counts.bear}
        </span>
      )}
    </button>
  )
}
