import React from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { clsx } from 'clsx'

interface SuggestionBadgeProps {
  count: number
  onClick?: () => void
  className?: string
}

export function SuggestionBadge({ count, onClick, className }: SuggestionBadgeProps) {
  if (count === 0) return null

  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium transition-colors',
        'bg-amber-100 text-amber-700 hover:bg-amber-200',
        className
      )}
    >
      <MessageSquarePlus className="h-4 w-4" />
      <span>{count} {count === 1 ? 'suggestion' : 'suggestions'}</span>
    </button>
  )
}

// Smaller version for inline use
export function SuggestionBadgeSmall({ count, onClick, className }: SuggestionBadgeProps) {
  if (count === 0) return null

  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium transition-colors',
        'bg-amber-500 text-white hover:bg-amber-600',
        className
      )}
      title={`${count} pending ${count === 1 ? 'suggestion' : 'suggestions'}`}
    >
      {count}
    </button>
  )
}

export default SuggestionBadge
