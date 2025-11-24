/**
 * QueryErrorDisplay Component
 *
 * Displays error messages for React Query errors with retry functionality.
 * Provides a consistent error UI across all data fetching operations.
 */

import React from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'

export interface QueryErrorDisplayProps {
  error: Error | null
  onRetry?: () => void
  title?: string
  message?: string
  compact?: boolean
}

export function QueryErrorDisplay({
  error,
  onRetry,
  title = 'Failed to load data',
  message,
  compact = false
}: QueryErrorDisplayProps) {
  if (!error) return null

  const errorMessage = message || error.message || 'An unexpected error occurred'

  if (compact) {
    return (
      <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-900">{errorMessage}</p>
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Retry
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center py-12">
      <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-red-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-red-900">{title}</h3>
            <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
          </div>
        </div>

        {onRetry && (
          <div className="mt-4">
            <Button onClick={onRetry} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        )}

        {/* Development details */}
        {process.env.NODE_ENV === 'development' && error.stack && (
          <details className="mt-4">
            <summary className="text-xs text-red-700 cursor-pointer font-medium">
              Error Details (Development Only)
            </summary>
            <pre className="mt-2 text-xs text-red-600 bg-red-100 p-2 rounded overflow-auto max-h-32">
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

/**
 * Inline error display for form fields or smaller areas
 */
export function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-center space-x-2 text-red-600">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  )
}
