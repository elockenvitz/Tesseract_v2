import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { clsx } from 'clsx'

interface SortableAssetRowProps {
  id: string
  children: React.ReactNode
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

export function SortableAssetRow({
  id,
  children,
  disabled = false,
  className,
  style: propStyle
}: SortableAssetRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id,
    disabled
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto',
    position: 'relative',
    ...propStyle
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        className,
        isDragging && 'shadow-lg bg-white ring-2 ring-blue-500'
      )}
    >
      {children}
    </div>
  )
}

interface DragHandleProps {
  listeners: ReturnType<typeof useSortable>['listeners']
  attributes: ReturnType<typeof useSortable>['attributes']
  className?: string
  iconClassName?: string
}

/**
 * Drag handle component to be used inside SortableAssetRow
 * Must receive listeners and attributes from useSortable
 */
export function DragHandle({
  listeners,
  attributes,
  className,
  iconClassName
}: DragHandleProps) {
  return (
    <button
      className={clsx(
        'touch-none cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600',
        className
      )}
      {...listeners}
      {...attributes}
    >
      <GripVertical className={clsx('h-4 w-4', iconClassName)} />
    </button>
  )
}

/**
 * Hook to get sortable props for a row - can be used instead of SortableAssetRow wrapper
 * when you need more control over the row structure
 */
export function useSortableRow(id: string, disabled = false) {
  const sortable = useSortable({
    id,
    disabled
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 50 : 'auto',
    position: 'relative'
  }

  return {
    ...sortable,
    style,
    dragHandleProps: {
      listeners: sortable.listeners,
      attributes: sortable.attributes
    }
  }
}

export default SortableAssetRow
