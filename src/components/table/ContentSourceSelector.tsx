/**
 * ContentSourceSelector - Dropdown for selecting content source for table columns
 *
 * Options:
 * - Default: Asset's own field value
 * - Our View: AI-summarized team consensus from contributions
 * - Individual: Specific analyst's contribution
 * - Combined: AI-summarized selection of multiple analysts
 */

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, Users, User, Sparkles, FileText, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useColumnContentSource, ContentSourceType, useContributingAnalysts } from '../../hooks/useColumnContentSource'

interface ContentSourceSelectorProps {
  columnId: string
  columnLabel: string
  listId?: string | null
  assetId?: string // For fetching contributing analysts
  position: { x: number; y: number }
  onClose: () => void
}

const SOURCE_OPTIONS: { value: ContentSourceType; label: string; description: string; icon: React.ElementType }[] = [
  {
    value: 'default',
    label: 'My View',
    description: "Your own field value",
    icon: FileText
  },
  {
    value: 'our_view',
    label: 'Our View',
    description: 'AI-summarized team consensus',
    icon: Sparkles
  },
  {
    value: 'individual',
    label: 'Individual',
    description: "Specific analyst's contribution",
    icon: User
  },
  {
    value: 'combined',
    label: 'Combined',
    description: 'AI summary of selected analysts',
    icon: Users
  },
]

export function ContentSourceSelector({
  columnId,
  columnLabel,
  listId,
  assetId,
  position,
  onClose,
}: ContentSourceSelectorProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const { getSourceType, getSourceUserIds, setContentSource, isMutating } = useColumnContentSource(listId)
  const { analysts, isLoading: loadingAnalysts } = useContributingAnalysts(assetId || '', columnId)

  const currentSourceType = getSourceType(columnId, listId)
  const currentSourceUserIds = getSourceUserIds(columnId, listId)

  const [selectedType, setSelectedType] = useState<ContentSourceType>(currentSourceType)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(currentSourceUserIds)
  const [showAnalystPicker, setShowAnalystPicker] = useState(false)

  // Close on outside click (with delay to prevent immediate close)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Add small delay to prevent immediate close from the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 100)
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSelectType = (type: ContentSourceType) => {
    setSelectedType(type)

    if (type === 'individual' || type === 'combined') {
      setShowAnalystPicker(true)
    } else {
      // Apply immediately for default and our_view
      setContentSource({
        columnId,
        listId,
        sourceType: type,
        sourceUserIds: [],
      })
      onClose()
    }
  }

  const handleToggleAnalyst = (userId: string) => {
    if (selectedType === 'individual') {
      // Single selection
      setSelectedUserIds([userId])
    } else {
      // Multi selection for combined
      setSelectedUserIds(prev =>
        prev.includes(userId)
          ? prev.filter(id => id !== userId)
          : [...prev, userId]
      )
    }
  }

  const handleApply = () => {
    setContentSource({
      columnId,
      listId,
      sourceType: selectedType,
      sourceUserIds: selectedUserIds,
    })
    onClose()
  }

  const canApply = () => {
    if (selectedType === 'default' || selectedType === 'our_view') return true
    return selectedUserIds.length > 0
  }

  // Adjust position to keep in viewport
  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 320),
    y: Math.min(position.y, window.innerHeight - 400),
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 w-80 animate-in fade-in slide-in-from-top-2 duration-150"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Content Source</h3>
          <p className="text-xs text-gray-500 mt-0.5">{columnLabel} column</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="h-4 w-4 text-gray-400" />
        </button>
      </div>

      {/* Content */}
      <div className="p-3">
        {!showAnalystPicker ? (
          <div className="space-y-1">
            {SOURCE_OPTIONS.map(option => {
              const Icon = option.icon
              const isSelected = selectedType === option.value

              return (
                <button
                  key={option.value}
                  onClick={() => handleSelectType(option.value)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                    isSelected
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-50 border border-transparent'
                  )}
                >
                  <div className={clsx(
                    'w-8 h-8 rounded-lg flex items-center justify-center',
                    isSelected ? 'bg-blue-100' : 'bg-gray-100'
                  )}>
                    <Icon className={clsx('h-4 w-4', isSelected ? 'text-blue-600' : 'text-gray-500')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={clsx(
                      'text-sm font-medium',
                      isSelected ? 'text-blue-900' : 'text-gray-900'
                    )}>
                      {option.label}
                    </p>
                    <p className="text-xs text-gray-500">{option.description}</p>
                  </div>
                  {isSelected && currentSourceType === option.value && (
                    <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  )}
                  {(option.value === 'individual' || option.value === 'combined') && (
                    <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <div>
            {/* Back button */}
            <button
              onClick={() => setShowAnalystPicker(false)}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-3"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
              Back to sources
            </button>

            {/* Analyst selection */}
            <div className="mb-3">
              <h4 className="text-sm font-medium text-gray-900 mb-1">
                {selectedType === 'individual' ? 'Select Analyst' : 'Select Analysts'}
              </h4>
              <p className="text-xs text-gray-500">
                {selectedType === 'individual'
                  ? 'Choose whose view to display'
                  : 'Select analysts to combine views'}
              </p>
            </div>

            {loadingAnalysts ? (
              <div className="py-8 text-center text-sm text-gray-500">
                Loading analysts...
              </div>
            ) : analysts.length === 0 ? (
              <div className="py-8 text-center">
                <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No contributions found</p>
                <p className="text-xs text-gray-400 mt-1">
                  Analysts who have contributed to this field will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {analysts.map(analyst => {
                  const isSelected = selectedUserIds.includes(analyst.id)

                  return (
                    <button
                      key={analyst.id}
                      onClick={() => handleToggleAnalyst(analyst.id)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                        isSelected
                          ? 'bg-blue-50 border border-blue-200'
                          : 'hover:bg-gray-50 border border-transparent'
                      )}
                    >
                      <div className={clsx(
                        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium',
                        isSelected ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      )}>
                        {analyst.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <span className={clsx(
                        'flex-1 text-sm',
                        isSelected ? 'text-blue-900 font-medium' : 'text-gray-700'
                      )}>
                        {analyst.name}
                      </span>
                      {isSelected && (
                        <Check className="h-4 w-4 text-blue-600" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Apply button */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <button
                onClick={handleApply}
                disabled={!canApply() || isMutating}
                className={clsx(
                  'w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors',
                  canApply() && !isMutating
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                )}
              >
                {isMutating ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export default ContentSourceSelector
