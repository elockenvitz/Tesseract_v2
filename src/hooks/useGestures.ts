/**
 * useGestures - Touch and swipe gesture detection hook
 *
 * Features:
 * - Swipe left/right detection
 * - Long press detection
 * - Configurable thresholds
 * - Returns gesture state for CSS animations
 */

import { useState, useEffect, useRef, useCallback } from 'react'

export interface GestureState {
  // Current swipe offset (for CSS transform)
  swipeOffset: number
  // Direction being swiped
  swipeDirection: 'left' | 'right' | null
  // Whether swipe threshold has been passed
  swipeTriggered: boolean
  // Whether currently being touched/dragged
  isActive: boolean
  // Long press triggered
  longPressTriggered: boolean
}

export interface GestureConfig {
  // Minimum distance to trigger swipe (default: 60)
  swipeThreshold?: number
  // Maximum vertical movement before canceling swipe (default: 30)
  verticalThreshold?: number
  // Long press duration in ms (default: 500)
  longPressDuration?: number
  // Enable swipe left (default: true)
  enableSwipeLeft?: boolean
  // Enable swipe right (default: true)
  enableSwipeRight?: boolean
  // Enable long press (default: true)
  enableLongPress?: boolean
  // Maximum swipe distance (default: 120)
  maxSwipeDistance?: number
}

export interface GestureCallbacks {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onLongPress?: () => void
  onSwipeStart?: () => void
  onSwipeEnd?: () => void
}

export function useGestures(
  elementRef: React.RefObject<HTMLElement>,
  callbacks: GestureCallbacks = {},
  config: GestureConfig = {}
) {
  const {
    swipeThreshold = 60,
    verticalThreshold = 30,
    longPressDuration = 500,
    enableSwipeLeft = true,
    enableSwipeRight = true,
    enableLongPress = true,
    maxSwipeDistance = 120
  } = config

  const [state, setState] = useState<GestureState>({
    swipeOffset: 0,
    swipeDirection: null,
    swipeTriggered: false,
    isActive: false,
    longPressTriggered: false
  })

  // Touch tracking
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const longPressFired = useRef(false)

  // Clear long press timer
  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Reset state
  const resetState = useCallback(() => {
    setState({
      swipeOffset: 0,
      swipeDirection: null,
      swipeTriggered: false,
      isActive: false,
      longPressTriggered: false
    })
    touchStart.current = null
    longPressFired.current = false
    clearLongPress()
  }, [clearLongPress])

  // Handle touch start
  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0]
    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    }
    longPressFired.current = false

    setState(prev => ({
      ...prev,
      isActive: true,
      swipeOffset: 0,
      swipeDirection: null,
      swipeTriggered: false,
      longPressTriggered: false
    }))

    // Start long press timer
    if (enableLongPress) {
      clearLongPress()
      longPressTimer.current = setTimeout(() => {
        if (touchStart.current) {
          longPressFired.current = true
          setState(prev => ({ ...prev, longPressTriggered: true }))
          callbacks.onLongPress?.()

          // Haptic feedback if available
          if ('vibrate' in navigator) {
            navigator.vibrate(50)
          }
        }
      }, longPressDuration)
    }
  }, [enableLongPress, longPressDuration, callbacks, clearLongPress])

  // Handle touch move
  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStart.current || longPressFired.current) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - touchStart.current.x
    const deltaY = touch.clientY - touchStart.current.y

    // Cancel if moving too much vertically (scrolling)
    if (Math.abs(deltaY) > verticalThreshold) {
      clearLongPress()
      resetState()
      return
    }

    // Cancel long press on significant movement
    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
      clearLongPress()
    }

    // Determine direction
    const direction = deltaX > 0 ? 'right' : 'left'

    // Check if direction is enabled
    if (direction === 'left' && !enableSwipeLeft) return
    if (direction === 'right' && !enableSwipeRight) return

    // Clamp swipe distance with resistance at edges
    const absOffset = Math.abs(deltaX)
    const clampedOffset = absOffset > maxSwipeDistance
      ? maxSwipeDistance + (absOffset - maxSwipeDistance) * 0.3
      : absOffset

    const swipeOffset = direction === 'left' ? -clampedOffset : clampedOffset
    const swipeTriggered = absOffset >= swipeThreshold

    // Prevent default to stop scrolling when swiping horizontally
    if (Math.abs(deltaX) > 10) {
      e.preventDefault()
      callbacks.onSwipeStart?.()
    }

    setState(prev => ({
      ...prev,
      swipeOffset,
      swipeDirection: direction,
      swipeTriggered
    }))
  }, [
    enableSwipeLeft,
    enableSwipeRight,
    maxSwipeDistance,
    swipeThreshold,
    verticalThreshold,
    callbacks,
    clearLongPress,
    resetState
  ])

  // Handle touch end
  const handleTouchEnd = useCallback(() => {
    clearLongPress()

    if (!touchStart.current) {
      resetState()
      return
    }

    const { swipeOffset, swipeDirection, swipeTriggered } = state

    // Fire callback if swipe was triggered
    if (swipeTriggered && swipeDirection) {
      if (swipeDirection === 'left' && enableSwipeLeft) {
        callbacks.onSwipeLeft?.()
      } else if (swipeDirection === 'right' && enableSwipeRight) {
        callbacks.onSwipeRight?.()
      }
    }

    callbacks.onSwipeEnd?.()

    // Animate back to origin with spring-like reset
    // State will reset, and CSS transition handles animation
    resetState()
  }, [
    state,
    enableSwipeLeft,
    enableSwipeRight,
    callbacks,
    clearLongPress,
    resetState
  ])

  // Handle touch cancel
  const handleTouchCancel = useCallback(() => {
    clearLongPress()
    resetState()
  }, [clearLongPress, resetState])

  // Attach event listeners
  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchCancel, { passive: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchCancel)
      clearLongPress()
    }
  }, [
    elementRef,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    clearLongPress
  ])

  // Generate CSS style object for transform
  const gestureStyle: React.CSSProperties = {
    transform: state.swipeOffset !== 0
      ? `translateX(${state.swipeOffset}px)`
      : undefined,
    transition: state.isActive ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
  }

  return {
    state,
    gestureStyle,
    resetState
  }
}

export default useGestures
