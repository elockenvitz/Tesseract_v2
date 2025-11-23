/**
 * ProgressBar Component
 *
 * Reusable progress bar component with label and percentage display.
 * Used in the Overview tab for completion rate and progress metrics.
 *
 * Extracted from WorkflowsPage.tsx during Phase 3 refactoring.
 */

import React from 'react'

export interface ProgressBarProps {
  /** Label displayed above the progress bar */
  label: string

  /** Current value (0-100) */
  value: number

  /** Color scheme for the progress bar */
  color?: 'green' | 'blue' | 'orange' | 'purple' | 'red'

  /** Whether to show the percentage value */
  showPercentage?: boolean
}

const COLOR_CLASSES = {
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
  purple: 'bg-purple-500',
  red: 'bg-red-500'
}

export function ProgressBar({
  label,
  value,
  color = 'green',
  showPercentage = true
}: ProgressBarProps) {
  // Clamp value between 0 and 100
  const clampedValue = Math.min(Math.max(value, 0), 100)
  const colorClass = COLOR_CLASSES[color]

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        {showPercentage && (
          <span className="font-medium">{Math.round(clampedValue)}%</span>
        )}
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`${colorClass} h-2 rounded-full transition-all duration-300`}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  )
}
