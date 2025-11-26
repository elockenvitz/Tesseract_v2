import React, { forwardRef } from 'react'
import { clsx } from 'clsx'

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <textarea
          ref={ref}
          className={clsx(
            'w-full px-3 py-2 border rounded-lg',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
            'bg-white dark:bg-gray-800',
            'text-gray-900 dark:text-white',
            'placeholder-gray-400 dark:placeholder-gray-500',
            error
              ? 'border-red-300 dark:border-red-700'
              : 'border-gray-300 dark:border-gray-600',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'resize-vertical',
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    )
  }
)

TextArea.displayName = 'TextArea'
