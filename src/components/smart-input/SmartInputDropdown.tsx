import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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

  // Use portal to render outside of transformed parent containers
  // This fixes positioning issues when parent has CSS transform
  const dropdown = (
    <div
      ref={dropdownRef}
      className={clsx(
        'fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-2xl overflow-hidden',
        'w-72',
        className
      )}
      style={{
        top: position.top,
        left: position.left
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
          {getHeader()}
        </span>
      </div>

      {/* Content - fixed height container for stability */}
      <div className="h-48 overflow-y-auto">
        {children}
      </div>
    </div>
  )

  return createPortal(dropdown, document.body)
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
        'w-full flex items-center px-3 py-2.5 text-left transition-all duration-150',
        isSelected
          ? 'bg-primary-50 border-l-2 border-primary-500'
          : 'hover:bg-gray-50 border-l-2 border-transparent'
      )}
    >
      <span className={clsx(
        "flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors",
        isSelected ? "bg-primary-100 text-primary-600" : "bg-gray-100 text-gray-500"
      )}>
        {icon}
      </span>
      <div className="ml-3 flex-1 min-w-0">
        <div className={clsx(
          "font-medium truncate",
          isSelected ? "text-primary-900" : "text-gray-900"
        )}>{title}</div>
        {subtitle && (
          <div className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</div>
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
    <div className="h-full flex flex-col items-center justify-center px-4 py-8 text-center">
      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <p className="text-sm text-gray-500">{message}</p>
      <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
    </div>
  )
}

// Loading state
export function LoadingState() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-4 py-8">
      <div className="relative">
        <div className="w-10 h-10 rounded-full border-2 border-gray-200"></div>
        <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-primary-500 border-t-transparent animate-spin"></div>
      </div>
      <p className="text-sm text-gray-500 mt-3">Searching...</p>
    </div>
  )
}
