/**
 * SuggestionIndicator
 *
 * Small inline dot/badge rendered in table cells when there are pending suggestions.
 * Shows count on hover, clicking opens the review panel filtered to that asset.
 */

import React from 'react'
import { clsx } from 'clsx'
import type { SimulationSuggestion } from '../../hooks/useSimulationSuggestions'

interface SuggestionIndicatorProps {
  suggestions: SimulationSuggestion[]
  onClick?: () => void
}

export function SuggestionIndicator({ suggestions, onClick }: SuggestionIndicatorProps) {
  if (suggestions.length === 0) return null

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={`${suggestions.length} pending suggestion${suggestions.length !== 1 ? 's' : ''}`}
      className={clsx(
        'inline-flex items-center justify-center',
        'ml-1 w-4 h-4 rounded-full text-[9px] font-bold',
        'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
        'hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors',
        'cursor-pointer'
      )}
    >
      {suggestions.length}
    </button>
  )
}
