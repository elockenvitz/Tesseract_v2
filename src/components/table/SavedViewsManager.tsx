/**
 * SavedViewsManager - UI for managing and switching saved table views
 *
 * Features:
 * - Dropdown for quick view switching
 * - Save current view button
 * - View management modal (rename, delete, set default)
 * - Keyboard shortcuts display (1-9)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  ChevronDown,
  Check,
  Star,
  Plus,
  Settings,
  Copy,
  Trash2,
  Edit3,
  Bookmark,
  LayoutList,
  LayoutGrid,
  Columns,
  Table2,
  X,
  Loader2,
  GripVertical
} from 'lucide-react'
import { useSavedViews, SavedView, ViewConfig } from '../../hooks/useSavedViews'

// Icon map for views
const ICON_MAP: Record<string, React.ReactNode> = {
  'layout-list': <LayoutList className="w-4 h-4" />,
  'layout-grid': <LayoutGrid className="w-4 h-4" />,
  'columns': <Columns className="w-4 h-4" />,
  'table': <Table2 className="w-4 h-4" />,
  'bookmark': <Bookmark className="w-4 h-4" />
}

// Available icons for selection
const AVAILABLE_ICONS = ['layout-list', 'layout-grid', 'columns', 'table', 'bookmark']

// Available colors
const AVAILABLE_COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#6b7280'  // Gray
]

interface SavedViewsManagerProps {
  activeViewId: string | null
  onSelectView: (view: SavedView) => void
  getCurrentConfig: () => ViewConfig
  className?: string
}

export function SavedViewsManager({
  activeViewId,
  onSelectView,
  getCurrentConfig,
  className
}: SavedViewsManagerProps) {
  const {
    views,
    defaultView,
    isLoading,
    createView,
    updateView,
    deleteView,
    duplicateView,
    setDefaultView,
    isCreating,
    isUpdating,
    isDeleting
  } = useSavedViews()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [editingView, setEditingView] = useState<SavedView | null>(null)
  const [newViewName, setNewViewName] = useState('')
  const [newViewIcon, setNewViewIcon] = useState('layout-list')
  const [newViewColor, setNewViewColor] = useState('#3b82f6')
  const [newViewIsDefault, setNewViewIsDefault] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Get active view
  const activeView = views.find(v => v.id === activeViewId) || null

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  // Handle save current view
  const handleSaveView = async () => {
    if (!newViewName.trim()) return

    const config = getCurrentConfig()

    if (editingView) {
      // Update existing view
      await updateView({
        id: editingView.id,
        name: newViewName,
        icon: newViewIcon,
        color: newViewColor,
        config,
        is_default: newViewIsDefault
      })
    } else {
      // Create new view
      await createView({
        name: newViewName,
        icon: newViewIcon,
        color: newViewColor,
        config,
        is_default: newViewIsDefault
      })
    }

    // Reset and close
    setNewViewName('')
    setNewViewIcon('layout-list')
    setNewViewColor('#3b82f6')
    setNewViewIsDefault(false)
    setEditingView(null)
    setShowSaveModal(false)
  }

  // Handle edit view
  const handleEditView = (view: SavedView) => {
    setEditingView(view)
    setNewViewName(view.name)
    setNewViewIcon(view.icon || 'layout-list')
    setNewViewColor(view.color || '#3b82f6')
    setNewViewIsDefault(view.is_default)
    setShowSaveModal(true)
    setDropdownOpen(false)
  }

  // Handle delete view
  const handleDeleteView = async (viewId: string) => {
    if (confirm('Are you sure you want to delete this view?')) {
      await deleteView(viewId)
    }
  }

  // Handle duplicate view
  const handleDuplicateView = async (view: SavedView) => {
    await duplicateView(view)
    setDropdownOpen(false)
  }

  return (
    <div className={clsx('relative', className)} ref={dropdownRef}>
      {/* Dropdown trigger */}
      <button
        ref={buttonRef}
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors text-sm',
          activeView
            ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
        )}
      >
        {activeView && activeView.icon && ICON_MAP[activeView.icon]}
        <span className="font-medium">
          {activeView?.name || 'Default View'}
        </span>
        <ChevronDown className={clsx(
          'w-4 h-4 transition-transform',
          dropdownOpen && 'rotate-180'
        )} />
      </button>

      {/* Dropdown menu */}
      {dropdownOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Views list */}
          <div className="max-h-64 overflow-y-auto p-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : views.length === 0 ? (
              <div className="px-3 py-6 text-center text-gray-500 text-sm">
                No saved views yet
              </div>
            ) : (
              views.map((view, index) => (
                <div
                  key={view.id}
                  className={clsx(
                    'group flex items-center justify-between rounded-lg transition-colors',
                    view.id === activeViewId
                      ? 'bg-blue-50'
                      : 'hover:bg-gray-50'
                  )}
                >
                  {/* View button */}
                  <button
                    onClick={() => {
                      onSelectView(view)
                      setDropdownOpen(false)
                    }}
                    className="flex-1 flex items-center gap-2 px-3 py-2 text-left"
                  >
                    {/* Icon with color */}
                    <span
                      className="flex items-center justify-center w-6 h-6 rounded"
                      style={{ backgroundColor: `${view.color}20`, color: view.color || '#3b82f6' }}
                    >
                      {view.icon && ICON_MAP[view.icon]}
                    </span>

                    {/* Name and badges */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={clsx(
                          'font-medium text-sm truncate',
                          view.id === activeViewId ? 'text-blue-700' : 'text-gray-900'
                        )}>
                          {view.name}
                        </span>
                        {view.is_default && (
                          <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                        )}
                      </div>
                    </div>

                    {/* Keyboard shortcut */}
                    {index < 9 && (
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-100 text-gray-500 border border-gray-200 rounded hidden group-hover:inline">
                        {index + 1}
                      </kbd>
                    )}

                    {/* Active indicator */}
                    {view.id === activeViewId && (
                      <Check className="w-4 h-4 text-blue-600 shrink-0" />
                    )}
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditView(view)
                      }}
                      className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                      title="Edit"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDuplicateView(view)
                      }}
                      className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                      title="Duplicate"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteView(view.id)
                      }}
                      className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer actions */}
          <div className="p-2 bg-gray-50 border-t border-gray-100 flex gap-1">
            <button
              onClick={() => {
                setEditingView(null)
                setNewViewName('')
                setNewViewIcon('layout-list')
                setNewViewColor('#3b82f6')
                setNewViewIsDefault(false)
                setShowSaveModal(true)
                setDropdownOpen(false)
              }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Save Current View
            </button>
            {views.length > 0 && (
              <button
                onClick={() => {
                  setShowManageModal(true)
                  setDropdownOpen(false)
                }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                title="Manage Views"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Save/Edit Modal */}
      {showSaveModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingView ? 'Edit View' : 'Save View'}
              </h3>
              <button
                onClick={() => {
                  setShowSaveModal(false)
                  setEditingView(null)
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  View Name
                </label>
                <input
                  type="text"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  placeholder="e.g., High Priority Watchlist"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  autoFocus
                />
              </div>

              {/* Icon */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Icon
                </label>
                <div className="flex gap-2">
                  {AVAILABLE_ICONS.map((icon) => (
                    <button
                      key={icon}
                      onClick={() => setNewViewIcon(icon)}
                      className={clsx(
                        'p-2.5 rounded-lg border transition-colors',
                        newViewIcon === icon
                          ? 'border-blue-500 bg-blue-50 text-blue-600'
                          : 'border-gray-200 hover:border-gray-300 text-gray-500'
                      )}
                    >
                      {ICON_MAP[icon]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Color
                </label>
                <div className="flex gap-2">
                  {AVAILABLE_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewViewColor(color)}
                      className={clsx(
                        'w-8 h-8 rounded-full transition-transform',
                        newViewColor === color && 'ring-2 ring-offset-2 ring-gray-400 scale-110'
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Default toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newViewIsDefault}
                  onChange={(e) => setNewViewIsDefault(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Set as default view</span>
                <Star className={clsx(
                  'w-4 h-4',
                  newViewIsDefault ? 'text-amber-500 fill-amber-500' : 'text-gray-300'
                )} />
              </label>
            </div>

            <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowSaveModal(false)
                  setEditingView(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveView}
                disabled={!newViewName.trim() || isCreating || isUpdating}
                className={clsx(
                  'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors',
                  !newViewName.trim() || isCreating || isUpdating
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                )}
              >
                {isCreating || isUpdating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  editingView ? 'Update View' : 'Save View'
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default SavedViewsManager
