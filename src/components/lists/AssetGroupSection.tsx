import React, { useState, useRef, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'
import {
  ChevronRight,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Edit3,
  Palette,
  Trash2,
  Plus,
  X,
  Check
} from 'lucide-react'
import { clsx } from 'clsx'
import type { ListGroup } from '../../hooks/lists/useListGroups'

// Predefined colors for groups
const GROUP_COLORS = [
  '#6b7280', // gray
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
]

interface AssetGroupSectionProps {
  group: ListGroup
  itemCount: number
  isCollapsed: boolean
  onToggleCollapse: () => void
  onRename: (name: string) => void
  onChangeColor: (color: string) => void
  onDelete: () => void
  children?: React.ReactNode
  isDraggable?: boolean
}

export function AssetGroupSection({
  group,
  itemCount,
  isCollapsed,
  onToggleCollapse,
  onRename,
  onChangeColor,
  onDelete,
  children,
  isDraggable = true
}: AssetGroupSectionProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(group.name)
  const [showMenu, setShowMenu] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Sortable hook for group header dragging
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: `group-${group.id}`,
    disabled: !isDraggable
  })

  // Droppable hook for dropping items into this group
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `group-drop-${group.id}`,
    data: { groupId: group.id }
  })

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  // Focus input when editing
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setShowColorPicker(false)
      }
    }
    if (showMenu || showColorPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu, showColorPicker])

  const handleSaveEdit = () => {
    if (editName.trim() && editName !== group.name) {
      onRename(editName.trim())
    }
    setIsEditing(false)
    setEditName(group.name)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditName(group.name)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  return (
    <div
      ref={setSortableRef}
      style={sortableStyle}
      className={clsx(
        'group/section',
        isDragging && 'opacity-50'
      )}
    >
      {/* Group Header */}
      <div
        ref={setDroppableRef}
        className={clsx(
          'flex items-center gap-2 px-3 py-2 bg-gray-50 border-y border-gray-200 transition-colors',
          isOver && 'bg-blue-50 border-blue-200'
        )}
      >
        {/* Drag Handle */}
        {isDraggable && (
          <button
            {...listeners}
            {...attributes}
            className="touch-none cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={onToggleCollapse}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors text-gray-500"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {/* Color Dot */}
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: group.color }}
        />

        {/* Group Name */}
        {isEditing ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveEdit}
              className="flex-1 px-1.5 py-0.5 text-sm font-medium border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleSaveEdit}
              className="p-0.5 rounded hover:bg-green-100 text-green-600"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleCancelEdit}
              className="p-0.5 rounded hover:bg-red-100 text-red-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <span
            className="font-medium text-sm text-gray-700 flex-1 truncate cursor-pointer hover:text-gray-900"
            onDoubleClick={() => setIsEditing(true)}
          >
            {group.name}
          </span>
        )}

        {/* Item Count */}
        <span className="text-xs text-gray-400 tabular-nums">
          ({itemCount})
        </span>

        {/* Menu Button */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600 opacity-0 group-hover/section:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {/* Dropdown Menu */}
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
              <button
                onClick={() => {
                  setShowMenu(false)
                  setIsEditing(true)
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Rename
              </button>
              <button
                onClick={() => {
                  setShowMenu(false)
                  setShowColorPicker(true)
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Palette className="h-3.5 w-3.5" />
                Change Color
              </button>
              <hr className="my-1 border-gray-100" />
              <button
                onClick={() => {
                  setShowMenu(false)
                  onDelete()
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Group
              </button>
            </div>
          )}

          {/* Color Picker */}
          {showColorPicker && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2">
              <div className="grid grid-cols-3 gap-1">
                {GROUP_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      onChangeColor(color)
                      setShowColorPicker(false)
                    }}
                    className={clsx(
                      'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                      group.color === color ? 'border-gray-800' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Group Content (items) */}
      {!isCollapsed && children}
    </div>
  )
}

// Add Group Button - inline text input
interface AddGroupButtonProps {
  onAdd: (name: string) => void
  isLoading?: boolean
}

export function AddGroupButton({ onAdd, isLoading }: AddGroupButtonProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAdding])

  const handleSubmit = () => {
    if (name.trim()) {
      onAdd(name.trim())
      setName('')
      setIsAdding(false)
    }
  }

  const handleCancel = () => {
    setName('')
    setIsAdding(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (isAdding) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleCancel}
          placeholder="Group name..."
          className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || isLoading}
          className="p-1 rounded hover:bg-green-100 text-green-600 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          onClick={handleCancel}
          className="p-1 rounded hover:bg-gray-100 text-gray-500"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setIsAdding(true)}
      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 w-full transition-colors border-t border-gray-200"
    >
      <Plus className="h-4 w-4" />
      Add Group
    </button>
  )
}

export default AssetGroupSection
