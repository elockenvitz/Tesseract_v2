import React, { useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { TriggerType, DropdownPosition } from './types'

interface SmartInputDropdownProps {
  isOpen: boolean
  type: TriggerType | null
  position: DropdownPosition
  onClose: () => void
  children: React.ReactNode
  className?: string
}

export function SmartInputDropdown({
  isOpen,
  type,
  position,
  onClose,
  children,
  className
}: SmartInputDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  if (!isOpen || !type) return null

  // Get header label for dropdown
  const getHeader = () => {
    switch (type) {
      case 'mention':
        return 'Mention someone'
      case 'cashtag':
        return 'Search assets'
      case 'hashtag':
        return 'Reference an item'
      case 'template':
        return 'Insert template'
      case 'data':
        return 'Insert data'
      case 'ai':
        return 'AI Generate'
      default:
        return ''
    }
  }

  return (
    <div
      ref={dropdownRef}
      className={clsx(
        'fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden',
        'min-w-[280px] max-w-[360px]',
        className
      )}
      style={{
        top: position.top,
        left: position.left
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {getHeader()}
        </span>
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

// Suggestion item component for consistent styling
interface SuggestionItemProps {
  icon: React.ReactNode
  title: string
  subtitle?: string
  badge?: string
  badgeColor?: string
  isSelected?: boolean
  onClick: () => void
}

export function SuggestionItem({
  icon,
  title,
  subtitle,
  badge,
  badgeColor = 'gray',
  isSelected,
  onClick
}: SuggestionItemProps) {
  const colorClasses: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-600',
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
    pink: 'bg-pink-100 text-pink-600',
    cyan: 'bg-cyan-100 text-cyan-600'
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full flex items-center px-3 py-2 text-left transition-colors',
        isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'
      )}
    >
      <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600">
        {icon}
      </span>
      <div className="ml-3 flex-1 min-w-0">
        <div className="font-medium text-gray-900 truncate">{title}</div>
        {subtitle && (
          <div className="text-sm text-gray-500 truncate">{subtitle}</div>
        )}
      </div>
      {badge && (
        <span className={clsx(
          'ml-2 px-2 py-0.5 text-xs font-medium rounded',
          colorClasses[badgeColor] || colorClasses.gray
        )}>
          {badge}
        </span>
      )}
    </button>
  )
}

// Group header for categorized results
interface SuggestionGroupProps {
  label: string
  children: React.ReactNode
}

export function SuggestionGroup({ label, children }: SuggestionGroupProps) {
  return (
    <div>
      <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide bg-gray-50">
        {label}
      </div>
      {children}
    </div>
  )
}

// Empty state
interface EmptyStateProps {
  message: string
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="px-3 py-6 text-center text-sm text-gray-500">
      {message}
    </div>
  )
}

// Loading state
export function LoadingState() {
  return (
    <div className="px-3 py-6 text-center">
      <div className="inline-flex items-center text-sm text-gray-500">
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Searching...
      </div>
    </div>
  )
}
