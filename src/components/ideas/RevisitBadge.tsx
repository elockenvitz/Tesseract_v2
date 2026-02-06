import React from 'react'
import { CalendarClock } from 'lucide-react'
import { format, isToday, isTomorrow, isPast } from 'date-fns'

export interface RevisitBadgeProps {
  /**
   * The revisit date (ISO string or Date).
   * Badge only renders if date <= today.
   */
  date: string | Date
}

/**
 * Format revisit date for display.
 * - "Today" if same day
 * - "Tomorrow" if next day
 * - "Jan 5" for other dates
 */
function formatRevisitDate(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isTomorrow(date)) return 'Tomorrow'
  return format(date, 'MMM d')
}

/**
 * RevisitBadge - Shows when a Quick Thought is due for revisit.
 * Only renders if revisit_date <= today (overdue or due today).
 * Positioned top-right of card by parent.
 */
export function RevisitBadge({ date }: RevisitBadgeProps) {
  const revisitDate = typeof date === 'string' ? new Date(date) : date

  // Only show if date is today or in the past
  if (!isToday(revisitDate) && !isPast(revisitDate)) {
    return null
  }

  const displayDate = formatRevisitDate(revisitDate)
  const isOverdue = isPast(revisitDate) && !isToday(revisitDate)

  return (
    <div
      className={`
        inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
        ${isOverdue
          ? 'bg-amber-100 text-amber-700'
          : 'bg-amber-50 text-amber-600'
        }
      `}
      title={`Revisit: ${format(revisitDate, 'MMM d, yyyy')}`}
    >
      <CalendarClock className="h-3 w-3" />
      <span>{displayDate}</span>
    </div>
  )
}

export default RevisitBadge
