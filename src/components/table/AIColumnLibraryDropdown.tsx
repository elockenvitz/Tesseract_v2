/**
 * AIColumnLibraryDropdown - Dropdown showing AI column library
 *
 * Shows system columns, user's custom columns, and quick prompt option
 */

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Check, Sparkles, FileText, Scale, GitBranch, Zap, Plus,
  Search, Clock, ChevronRight, Settings
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAIColumns, AIColumnDefinition } from '../../hooks/useAIColumns'

// Map icon names to components
const ICON_MAP: Record<string, React.ElementType> = {
  'sparkles': Sparkles,
  'file-text': FileText,
  'scale': Scale,
  'git-branch': GitBranch,
  'zap': Zap,
}

interface AIColumnLibraryDropdownProps {
  listId?: string | null
  position: { x: number; y: number }
  onClose: () => void
  onQuickPrompt: () => void
  onCreateColumn: () => void
  onManageColumns?: () => void
}

export function AIColumnLibraryDropdown({
  listId,
  position,
  onClose,
  onQuickPrompt,
  onCreateColumn,
  onManageColumns,
}: AIColumnLibraryDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const {
    systemColumns,
    customColumns,
    addColumnToView,
    isColumnInView,
    isLoading
  } = useAIColumns(listId)

  // Close on outside click (with delay to prevent immediate close)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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

  const handleAddColumn = (column: AIColumnDefinition) => {
    if (!isColumnInView(column.id)) {
      addColumnToView(column.id, listId)
    }
    onClose()
  }

  // Filter columns by search
  const filteredSystemColumns = systemColumns.filter(col =>
    col.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    col.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredCustomColumns = customColumns.filter(col =>
    col.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    col.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Adjust position to keep in viewport
  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 340),
    y: Math.min(position.y, window.innerHeight - 500),
  }

  const getIcon = (iconName: string) => {
    const Icon = ICON_MAP[iconName] || Sparkles
    return Icon
  }

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 w-80 animate-in fade-in slide-in-from-top-2 duration-150"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <h3 className="text-sm font-medium text-gray-900">AI Columns</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="h-4 w-4 text-gray-400" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search columns..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            autoFocus
          />
        </div>
      </div>

      {/* Quick Prompt Option */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={() => { onQuickPrompt(); onClose(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 hover:border-purple-200 transition-colors text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">Quick Prompt</p>
            <p className="text-xs text-gray-500">Ask anything about assets</p>
          </div>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto px-3 pb-3">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-500">
            Loading columns...
          </div>
        ) : (
          <>
            {/* System Columns */}
            {filteredSystemColumns.length > 0 && (
              <div className="mb-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 mb-1.5">
                  System Columns
                </h4>
                <div className="space-y-1">
                  {filteredSystemColumns.map(column => {
                    const Icon = getIcon(column.icon)
                    const inView = isColumnInView(column.id)

                    return (
                      <button
                        key={column.id}
                        onClick={() => handleAddColumn(column)}
                        disabled={inView}
                        className={clsx(
                          'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                          inView
                            ? 'bg-gray-50 cursor-not-allowed'
                            : 'hover:bg-gray-50'
                        )}
                      >
                        <div className={clsx(
                          'w-7 h-7 rounded-lg flex items-center justify-center',
                          inView ? 'bg-gray-100' : 'bg-purple-100'
                        )}>
                          <Icon className={clsx('h-3.5 w-3.5', inView ? 'text-gray-400' : 'text-purple-600')} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={clsx(
                            'text-sm',
                            inView ? 'text-gray-400' : 'text-gray-900'
                          )}>
                            {column.name}
                          </p>
                          {column.description && (
                            <p className="text-xs text-gray-400 truncate">{column.description}</p>
                          )}
                        </div>
                        {inView && (
                          <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Custom Columns */}
            {filteredCustomColumns.length > 0 && (
              <div className="mb-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 mb-1.5">
                  My Columns
                </h4>
                <div className="space-y-1">
                  {filteredCustomColumns.map(column => {
                    const Icon = getIcon(column.icon)
                    const inView = isColumnInView(column.id)

                    return (
                      <button
                        key={column.id}
                        onClick={() => handleAddColumn(column)}
                        disabled={inView}
                        className={clsx(
                          'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                          inView
                            ? 'bg-gray-50 cursor-not-allowed'
                            : 'hover:bg-gray-50'
                        )}
                      >
                        <div className={clsx(
                          'w-7 h-7 rounded-lg flex items-center justify-center',
                          inView ? 'bg-gray-100' : 'bg-blue-100'
                        )}>
                          <Icon className={clsx('h-3.5 w-3.5', inView ? 'text-gray-400' : 'text-blue-600')} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={clsx(
                            'text-sm',
                            inView ? 'text-gray-400' : 'text-gray-900'
                          )}>
                            {column.name}
                          </p>
                          {column.description && (
                            <p className="text-xs text-gray-400 truncate">{column.description}</p>
                          )}
                        </div>
                        {inView && (
                          <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Empty state */}
            {filteredSystemColumns.length === 0 && filteredCustomColumns.length === 0 && (
              <div className="py-6 text-center">
                <Sparkles className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">
                  {searchQuery ? 'No columns match your search' : 'No AI columns available'}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-2">
        <button
          onClick={() => { onCreateColumn(); onClose(); }}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Column
        </button>
        {onManageColumns && (
          <button
            onClick={() => { onManageColumns(); onClose(); }}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Manage columns"
          >
            <Settings className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}

export default AIColumnLibraryDropdown
