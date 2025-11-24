/**
 * EmptyState Component
 *
 * Displays helpful empty states with call-to-action buttons.
 * Improves UX when lists or views have no data.
 */

import React, { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'
import { Button } from '../ui/Button'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
    icon?: LucideIcon
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  illustration?: ReactNode
  compact?: boolean
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  illustration,
  compact = false
}: EmptyStateProps) {
  const containerClass = compact
    ? 'py-8'
    : 'flex items-center justify-center py-12'

  const maxWidth = compact ? 'max-w-sm' : 'max-w-md'

  return (
    <div className={containerClass}>
      <div className={`${maxWidth} w-full text-center`}>
        {/* Icon or Illustration */}
        {illustration ? (
          <div className="mb-6">{illustration}</div>
        ) : Icon ? (
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
              <Icon className="w-8 h-8 text-gray-400" />
            </div>
          </div>
        ) : null}

        {/* Title */}
        <h3 className={`font-semibold text-gray-900 mb-2 ${compact ? 'text-base' : 'text-lg'}`}>
          {title}
        </h3>

        {/* Description */}
        <p className={`text-gray-600 mb-6 ${compact ? 'text-sm' : 'text-base'}`}>
          {description}
        </p>

        {/* Actions */}
        {(action || secondaryAction) && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {action && (
              <Button onClick={action.onClick} size={compact ? 'sm' : 'md'}>
                {action.icon && <action.icon className="w-4 h-4 mr-2" />}
                {action.label}
              </Button>
            )}
            {secondaryAction && (
              <Button
                onClick={secondaryAction.onClick}
                variant="outline"
                size={compact ? 'sm' : 'md'}
              >
                {secondaryAction.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Specialized empty states for common scenarios
 */

interface SimpleEmptyStateProps {
  message: string
  compact?: boolean
}

export function NoResultsFound({ message = 'No results found', compact }: SimpleEmptyStateProps) {
  return (
    <div className={compact ? 'py-6 text-center' : 'py-12 text-center'}>
      <p className="text-gray-500 text-sm">{message}</p>
      <p className="text-gray-400 text-xs mt-1">Try adjusting your search or filters</p>
    </div>
  )
}

export function NoDataAvailable({ message = 'No data available', compact }: SimpleEmptyStateProps) {
  return (
    <div className={compact ? 'py-6 text-center' : 'py-12 text-center'}>
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  )
}
