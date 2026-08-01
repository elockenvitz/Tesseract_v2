import React, { useMemo } from 'react'
import { clsx } from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'purple' | 'blue' | 'green' | 'gray' | 'orange' | 'slate'
  size?: 'sm' | 'md'
  className?: string
}

// Move static objects outside component
// Dark variants use a translucent tint over the page rather than the solid -100
// fills, which are far too bright against a dark surface.
const VARIANTS = {
  default: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  primary: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300',
  secondary: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  success: 'bg-success-100 text-success-800 dark:bg-success-900/40 dark:text-success-300',
  warning: 'bg-warning-100 text-warning-800 dark:bg-warning-900/40 dark:text-warning-300',
  error: 'bg-error-100 text-error-800 dark:bg-error-900/40 dark:text-error-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  blue: 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  green: 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
  gray: 'bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  orange: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  slate: 'bg-slate-50 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
} as const

const SIZES = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
} as const

const BASE_CLASSES = 'inline-flex items-center font-medium rounded-full'

export const Badge = React.memo(function Badge({
  children,
  variant = 'default',
  size = 'md',
  className
}: BadgeProps) {
  // Memoize className computation
  const badgeClassName = useMemo(() =>
    clsx(
      BASE_CLASSES,
      VARIANTS[variant],
      SIZES[size],
      className
    ),
    [variant, size, className]
  )

  return (
    <span className={badgeClassName}>
      {children}
    </span>
  )
})