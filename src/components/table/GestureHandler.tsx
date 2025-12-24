/**
 * GestureHandler - Wrapper component for swipe gestures on table rows
 *
 * Features:
 * - Swipe left for quick actions (archive, delete, add to list)
 * - Swipe right to toggle selection
 * - Long press to enter selection mode
 * - CSS-only animations (no framer-motion)
 * - Reveal action buttons under row
 */

import React, { useRef, useState, useCallback } from 'react'
import clsx from 'clsx'
import { Trash2, Archive, ListPlus, Check, X } from 'lucide-react'
import { useGestures, GestureState } from '../../hooks/useGestures'

interface SwipeAction {
  id: string
  icon: React.ReactNode
  label: string
  color: 'red' | 'blue' | 'green' | 'orange' | 'gray'
  onClick: () => void
}

interface GestureHandlerProps {
  children: React.ReactNode
  className?: string
  rowId: string
  isSelected?: boolean
  // Swipe actions (shown when swiping left)
  leftSwipeActions?: SwipeAction[]
  // Right swipe typically toggles selection
  onRightSwipe?: () => void
  onLongPress?: () => void
  disabled?: boolean
}

// Default colors for actions
const ACTION_COLORS = {
  red: 'bg-red-500 hover:bg-red-600',
  blue: 'bg-blue-500 hover:bg-blue-600',
  green: 'bg-green-500 hover:bg-green-600',
  orange: 'bg-orange-500 hover:bg-orange-600',
  gray: 'bg-gray-500 hover:bg-gray-600'
}

export function GestureHandler({
  children,
  className,
  rowId,
  isSelected,
  leftSwipeActions = [],
  onRightSwipe,
  onLongPress,
  disabled = false
}: GestureHandlerProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [showActions, setShowActions] = useState(false)
  const [actionTriggered, setActionTriggered] = useState(false)

  // Handle swipe left - reveal actions
  const handleSwipeLeft = useCallback(() => {
    if (leftSwipeActions.length > 0) {
      setShowActions(true)
    }
  }, [leftSwipeActions])

  // Handle swipe right - toggle selection
  const handleSwipeRight = useCallback(() => {
    onRightSwipe?.()
  }, [onRightSwipe])

  // Handle long press
  const handleLongPress = useCallback(() => {
    onLongPress?.()
    // Haptic feedback already handled in hook
  }, [onLongPress])

  // Use gestures hook
  const { state, gestureStyle, resetState } = useGestures(
    rowRef,
    {
      onSwipeLeft: handleSwipeLeft,
      onSwipeRight: handleSwipeRight,
      onLongPress: handleLongPress,
      onSwipeEnd: () => {
        // Only hide if action wasn't triggered
        if (!actionTriggered) {
          setTimeout(() => setShowActions(false), 300)
        }
      }
    },
    {
      enableSwipeLeft: leftSwipeActions.length > 0 && !disabled,
      enableSwipeRight: !!onRightSwipe && !disabled,
      enableLongPress: !!onLongPress && !disabled,
      swipeThreshold: 50,
      maxSwipeDistance: 100
    }
  )

  // Handle action click
  const handleActionClick = useCallback((action: SwipeAction) => {
    setActionTriggered(true)
    action.onClick()

    // Reset after animation
    setTimeout(() => {
      setShowActions(false)
      setActionTriggered(false)
      resetState()
    }, 200)
  }, [resetState])

  // Close actions
  const handleCloseActions = useCallback(() => {
    setShowActions(false)
    setActionTriggered(false)
    resetState()
  }, [resetState])

  // Calculate reveal amount for action buttons
  const revealAmount = showActions ? 100 : Math.abs(Math.min(0, state.swipeOffset))
  const actionsVisible = revealAmount > 30

  return (
    <div className={clsx('relative overflow-hidden', className)}>
      {/* Background action buttons (revealed on swipe left) */}
      {leftSwipeActions.length > 0 && (
        <div
          className={clsx(
            'absolute inset-y-0 right-0 flex items-center justify-end transition-opacity duration-200',
            actionsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          style={{ width: `${Math.max(100, revealAmount)}px` }}
        >
          {leftSwipeActions.map((action, index) => (
            <button
              key={action.id}
              onClick={() => handleActionClick(action)}
              className={clsx(
                'h-full flex items-center justify-center px-4 text-white transition-all duration-200',
                ACTION_COLORS[action.color],
                actionsVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
              )}
              style={{
                transitionDelay: `${index * 50}ms`
              }}
              title={action.label}
            >
              <div className="flex flex-col items-center gap-0.5">
                {action.icon}
                <span className="text-[10px] font-medium">{action.label}</span>
              </div>
            </button>
          ))}

          {/* Close button */}
          <button
            onClick={handleCloseActions}
            className="h-full px-3 flex items-center justify-center text-white bg-gray-400 hover:bg-gray-500"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Selection indicator (shown on right swipe) */}
      {state.swipeDirection === 'right' && state.swipeOffset > 30 && (
        <div
          className={clsx(
            'absolute inset-y-0 left-0 flex items-center justify-start px-4 transition-all duration-200',
            isSelected ? 'bg-gray-300' : 'bg-green-500',
            state.swipeTriggered ? 'opacity-100' : 'opacity-70'
          )}
          style={{ width: `${state.swipeOffset}px` }}
        >
          <Check className={clsx(
            'w-6 h-6 text-white transition-transform duration-200',
            state.swipeTriggered && 'scale-125'
          )} />
        </div>
      )}

      {/* Row content (slides with swipe) */}
      <div
        ref={rowRef}
        className={clsx(
          'relative bg-white dark:bg-dark-card',
          showActions && 'pointer-events-none'
        )}
        style={{
          ...gestureStyle,
          transform: showActions
            ? 'translateX(-100px)'
            : gestureStyle.transform
        }}
      >
        {children}
      </div>

      {/* Long press indicator */}
      {state.longPressTriggered && (
        <div className="absolute inset-0 bg-blue-500/10 pointer-events-none animate-pulse" />
      )}
    </div>
  )
}

// Pre-configured action sets
export const DEFAULT_SWIPE_ACTIONS = {
  delete: {
    id: 'delete',
    icon: <Trash2 className="w-5 h-5" />,
    label: 'Delete',
    color: 'red' as const
  },
  archive: {
    id: 'archive',
    icon: <Archive className="w-5 h-5" />,
    label: 'Archive',
    color: 'orange' as const
  },
  addToList: {
    id: 'add-to-list',
    icon: <ListPlus className="w-5 h-5" />,
    label: 'Add',
    color: 'blue' as const
  }
}

export default GestureHandler
