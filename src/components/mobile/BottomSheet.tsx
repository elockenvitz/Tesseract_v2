import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { X } from 'lucide-react'
import { useKeyboardInset, useViewportHeight } from '../../hooks/useMediaQuery'

export interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  /** Right-aligned content in the header row (actions, status). */
  headerAccessory?: React.ReactNode
  /**
   * Heights as a fraction of the visible viewport, smallest first. Dragging
   * down steps to the next-smaller point and dismisses from the smallest.
   */
  snapPoints?: number[]
  initialSnapIndex?: number
  /** Size to content instead of using snap points. Best for short editors. */
  fitContent?: boolean
  /** Pinned below the scrolling body — use for commit/cancel actions. */
  footer?: React.ReactNode
  showHandle?: boolean
  showCloseButton?: boolean
  dismissOnBackdrop?: boolean
  /** Set false while a commit is in flight to stop an accidental dismiss. */
  dismissible?: boolean
  /**
   * Lift the sheet above the on-screen keyboard. On by default — the sizing
   * editor is useless if the numeric field is behind the keyboard.
   */
  avoidKeyboard?: boolean
  className?: string
  contentClassName?: string
  'aria-label'?: string
  children: React.ReactNode
}

/** Drag distance past which a flick counts as dismiss intent. */
const DISMISS_DISTANCE = 88
/** px per ms — a fast flick dismisses even on a short drag. */
const DISMISS_VELOCITY = 0.45
/** Upward drag that promotes the sheet to the next snap point. */
const EXPAND_DISTANCE = 40
/** Backdrop left visible at the top so the sheet never reads as a full page. */
const TOP_PEEK = 24
const EXIT_MS = 240

export function BottomSheet({
  open,
  onClose,
  title,
  headerAccessory,
  snapPoints = [0.6],
  initialSnapIndex = 0,
  fitContent = false,
  footer,
  showHandle = true,
  showCloseButton = true,
  dismissOnBackdrop = true,
  dismissible = true,
  avoidKeyboard = true,
  className,
  contentClassName,
  'aria-label': ariaLabel,
  children,
}: BottomSheetProps) {
  const viewportHeight = useViewportHeight()
  const rawKeyboardInset = useKeyboardInset()
  const keyboardInset = avoidKeyboard ? rawKeyboardInset : 0

  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const [snapIndex, setSnapIndex] = useState(initialSnapIndex)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)

  const sheetRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startTime: number; lastY: number; lastTime: number } | null>(null)

  const requestClose = useCallback(() => {
    if (!dismissible) return
    onClose()
  }, [dismissible, onClose])

  // Mount/unmount around the transition so the exit animation can play.
  useEffect(() => {
    if (open) {
      setMounted(true)
      setSnapIndex(initialSnapIndex)
      setDragY(0)
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }
    setVisible(false)
    const timer = setTimeout(() => setMounted(false), EXIT_MS)
    return () => clearTimeout(timer)
    // `initialSnapIndex` is read only at open time — changing it mid-open
    // would yank the sheet out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Lock background scroll. Without this, scrolling inside the sheet chains to
  // the page behind it and the whole app drifts under the sheet.
  useEffect(() => {
    if (!mounted) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [mounted])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        requestClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, requestClose])

  useEffect(() => {
    if (visible) sheetRef.current?.focus({ preventScroll: true })
  }, [visible])

  /**
   * Bring a focused field into the space the keyboard left.
   *
   * The sheet already shrinks by `keyboardInset`, so the box is correct — but
   * shrinking the box does not move what is INSIDE it. A field near the bottom
   * of a tall sheet ends up under the keyboard anyway, and the only way to see
   * it is to dismiss the keyboard, which is exactly what was reported: the
   * editor looks broken until you press the check mark.
   *
   * Two frames of delay, because the browser resizes the visual viewport after
   * the focus event, and centring against the pre-keyboard height scrolls to
   * the wrong place. `block: 'center'` rather than `nearest`: the browser
   * considers a field that is technically on screen to need no scrolling, and
   * it cannot know the bottom of that screen is now a keyboard.
   */
  useEffect(() => {
    const el = sheetRef.current
    if (!el || !visible) return
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || !('scrollIntoView' in t)) return
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) return
      requestAnimationFrame(() => requestAnimationFrame(() => {
        t.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }))
    }
    el.addEventListener('focusin', onFocusIn)
    return () => el.removeEventListener('focusin', onFocusIn)
  }, [visible])

  const available = Math.max(0, viewportHeight - keyboardInset)
  const snap = snapPoints[Math.min(snapIndex, snapPoints.length - 1)] ?? 0.6
  const sheetHeight = fitContent
    ? undefined
    : Math.min(available * snap, available - TOP_PEEK)

  const onPointerDown = (event: React.PointerEvent) => {
    if (!dismissible) return
    dragRef.current = {
      startY: event.clientY,
      startTime: event.timeStamp,
      lastY: event.clientY,
      lastTime: event.timeStamp,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const state = dragRef.current
    if (!state) return
    const delta = event.clientY - state.startY
    state.lastY = event.clientY
    state.lastTime = event.timeStamp
    // Upward drag only travels if there is a larger snap point to reach.
    const canExpand = !fitContent && snapIndex < snapPoints.length - 1
    setDragY(delta < 0 && !canExpand ? delta * 0.25 : delta)
  }

  const endDrag = (event: React.PointerEvent) => {
    const state = dragRef.current
    if (!state) return
    dragRef.current = null
    setDragging(false)

    const delta = event.clientY - state.startY
    const elapsed = Math.max(1, event.timeStamp - state.startTime)
    const velocity = delta / elapsed

    setDragY(0)

    const wantsDismiss = delta > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY
    const wantsExpand = delta < -EXPAND_DISTANCE || velocity < -DISMISS_VELOCITY

    if (wantsDismiss) {
      if (fitContent || snapIndex === 0) {
        requestClose()
      } else {
        setSnapIndex(index => Math.max(0, index - 1))
      }
      return
    }
    if (wantsExpand && !fitContent && snapIndex < snapPoints.length - 1) {
      setSnapIndex(index => Math.min(snapPoints.length - 1, index + 1))
    }
  }

  if (!mounted || typeof document === 'undefined') return null

  const translateY = visible ? Math.max(0, dragY) : (sheetHeight ?? 400) + 40

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="presentation">
      <div
        className={clsx(
          'absolute inset-0 bg-gray-900/40 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0'
        )}
        onClick={dismissOnBackdrop ? requestClose : undefined}
        aria-hidden="true"
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : 'Sheet')}
        tabIndex={-1}
        className={clsx(
          'relative flex flex-col w-full bg-white dark:bg-gray-900',
          'rounded-t-2xl shadow-2xl border-t border-gray-200 dark:border-gray-700',
          'outline-none overflow-hidden',
          !dragging && 'transition-transform duration-300 ease-out',
          className
        )}
        style={{
          height: sheetHeight,
          maxHeight: available - TOP_PEEK,
          marginBottom: keyboardInset,
          transform: `translateY(${translateY}px)`,
        }}
      >
        {/* Drag affordance. Pointer handlers live on this row rather than the
            whole sheet so drags inside the body scroll the content instead. */}
        {(showHandle || title || showCloseButton) && (
          <div
            className="flex-shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {showHandle && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1.5 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
              </div>
            )}
            {(title || showCloseButton || headerAccessory) && (
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <div className="flex-1 min-w-0">
                  {typeof title === 'string' ? (
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">{title}</h2>
                  ) : (
                    title
                  )}
                </div>
                {headerAccessory}
                {showCloseButton && (
                  <button
                    type="button"
                    onClick={requestClose}
                    disabled={!dismissible}
                    className="flex items-center justify-center h-11 w-11 -mr-2 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 dark:text-gray-400"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className={clsx('flex-1 min-h-0 overflow-y-auto overscroll-contain', contentClassName)}>
          {children}
        </div>

        {footer && (
          <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-4 py-3 pb-safe bg-white dark:bg-gray-900">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
