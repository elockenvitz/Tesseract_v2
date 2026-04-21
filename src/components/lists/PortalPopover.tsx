import React, { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'

interface PortalPopoverProps {
  /** Ref to the element the popover anchors to (positions below it). */
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  /** Popover body — renders into document.body via portal so table cell overflow doesn't clip it. */
  children: React.ReactNode
  /** Fixed width; defaults to auto. */
  width?: number
  className?: string
  /** Horizontal alignment relative to the anchor's left edge. Defaults to 'start'. */
  align?: 'start' | 'end'
  /** Gap in px between anchor bottom and popover top. Default 4. */
  offset?: number
}

export function PortalPopover({
  anchorRef,
  open,
  onClose,
  children,
  width,
  className,
  align = 'start',
  offset = 4
}: PortalPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  // Position below the anchor; flip above if it would overflow viewport bottom.
  useLayoutEffect(() => {
    if (!open) return
    const compute = () => {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const popW = popoverRef.current?.offsetWidth ?? width ?? 200
      const popH = popoverRef.current?.offsetHeight ?? 200

      let left = align === 'end' ? rect.right - popW : rect.left
      // Keep within viewport horizontally
      const maxLeft = window.innerWidth - popW - 8
      if (left > maxLeft) left = Math.max(8, maxLeft)
      if (left < 8) left = 8

      let top = rect.bottom + offset
      if (top + popH > window.innerHeight - 8) {
        // Flip above
        top = Math.max(8, rect.top - popH - offset)
      }
      setCoords({ top, left })
    }
    compute()
    // Reposition on scroll/resize
    window.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('scroll', compute, true)
      window.removeEventListener('resize', compute)
    }
  }, [open, anchorRef, width, align, offset])

  // Dismiss on outside click / Escape
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      const el = popoverRef.current
      const anchor = anchorRef.current
      const target = e.target as Node
      if (el && el.contains(target)) return
      if (anchor && anchor.contains(target)) return
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose, anchorRef])

  if (!open || typeof document === 'undefined') return null

  const isPositioned = !!coords

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        width,
        opacity: isPositioned ? 1 : 0,
        transform: isPositioned ? 'translateY(0)' : 'translateY(-4px)',
        transition: 'opacity 120ms ease-out, transform 120ms cubic-bezier(0.22, 1, 0.36, 1)',
        zIndex: 100,
        pointerEvents: isPositioned ? 'auto' : 'none'
      }}
      className={clsx(
        'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl ring-1 ring-black/5 overflow-hidden',
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}
