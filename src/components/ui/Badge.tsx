import React from 'react'
import { clsx } from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'purple' | 'blue' | 'green' | 'gray' | 'orange' | 'slate'
  size?: 'sm' | 'md'
  className?: string
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className
}: BadgeProps) {
  const baseClasses = 'inline-flex items-center font-medium rounded-full'

  const variants = {
    default: 'bg-gray-100 text-gray-800',
    primary: 'bg-primary-100 text-primary-800',
    secondary: 'bg-blue-100 text-blue-800',
    success: 'bg-success-100 text-success-800',
    warning: 'bg-warning-100 text-warning-800',
    error: 'bg-error-100 text-error-800',
    purple: 'bg-purple-100 text-purple-800',
    blue: 'bg-blue-50 text-blue-700 border border-blue-200',
    green: 'bg-green-50 text-green-700 border border-green-200',
    gray: 'bg-gray-50 text-gray-600 border border-gray-200',
    orange: 'bg-amber-50 text-amber-700 border border-amber-200',
    slate: 'bg-slate-50 text-slate-700 border border-slate-300',
  }
  
  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  }

  return (
    <span
      className={clsx(
        baseClasses,
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  )
}