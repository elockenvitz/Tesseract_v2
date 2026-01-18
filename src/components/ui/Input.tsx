// src/components/ui/Input.tsx
import React from 'react'
import { clsx } from 'clsx'

// Omit 'loading' from HTMLInputElement attributes as we handle it custom
interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'loading'> {
  label?: string
  error?: string
  helperText?: string
  id?: string
  rightAdornment?: React.ReactNode
  loading?: boolean // Explicitly define loading prop
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  helperText,
  className,
  id,
  rightAdornment,
  loading, // Destructure loading
  disabled, // Destructure disabled
  ...props
}, ref) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 shadow-sm transition-colors cursor-text',
            'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500',
            error && 'border-error-500 focus:border-error-500 focus:ring-error-500',
            (rightAdornment || loading) && 'pr-10', // Add padding to the right if adornment or loading spinner exists
            className
          )}
          disabled={disabled || loading} // Use loading prop to disable the input
          {...props} // Pass remaining props to the native input
        />
        {loading && ( // Conditionally render loading spinner
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-500"></div>
          </div>
        )}
        {rightAdornment && !loading && ( // Render adornment only if not loading
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-auto">
            {rightAdornment}
          </div>
        )}
      </div>
      {error && (
        <p className="text-sm text-error-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="text-sm text-gray-500">{helperText}</p>
      )}
    </div>
  )
})

Input.displayName = 'Input'
