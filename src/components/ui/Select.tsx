import React from 'react'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  helperText?: string
  options?: { value: string; label: string }[]
  children?: React.ReactNode
}

export function Select({
  label,
  error,
  helperText,
  options,
  children,
  className,
  id,
  ...props
}: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={clsx(
            'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors appearance-none bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white',
            'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500',
            error && 'border-error-500 focus:border-error-500 focus:ring-error-500',
            className
          )}
          {...props}
        >
          {options ? options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          )) : children}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>
      </div>
      {error && (
        <p className="text-sm text-error-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="text-sm text-gray-500">{helperText}</p>
      )}
    </div>
  )
}