/**
 * CounterViewBadge — Shows opposing view count on trade idea cards.
 *
 * Renders a small badge like "1 Opposing View" that can be clicked
 * to navigate to the counter-view details.
 */

import { ArrowLeftRight } from 'lucide-react'
import { useCounterViewCount } from '../../hooks/useCounterViews'
import { clsx } from 'clsx'

interface CounterViewBadgeProps {
  tradeIdeaId: string
  onClick?: () => void
  className?: string
}

export function CounterViewBadge({ tradeIdeaId, onClick, className }: CounterViewBadgeProps) {
  const { data: count } = useCounterViewCount(tradeIdeaId)

  if (!count || count === 0) return null

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium',
        'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
        'hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors',
        className,
      )}
      title={`${count} opposing view${count !== 1 ? 's' : ''}`}
    >
      <ArrowLeftRight className="h-2.5 w-2.5" />
      {count} opposing
    </button>
  )
}
