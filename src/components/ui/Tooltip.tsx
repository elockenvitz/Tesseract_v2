import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Info } from 'lucide-react'

interface TooltipProps {
  content: string
  children?: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

export function Tooltip({ content, children, position = 'top', className }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const hide = useCallback(() => {
    setIsVisible(false)
    setCoords(null)
  }, [])

  // Hide on scroll or click outside
  useEffect(() => {
    if (!isVisible) return

    const handleScroll = () => hide()
    const handleClickOutside = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        hide()
      }
    }

    // Listen to scroll on window and any scrollable parent
    window.addEventListener('scroll', handleScroll, true)
    // Hide when clicking outside
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isVisible, hide])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()

    if (isVisible) {
      hide()
      return
    }

    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()

    // Show tooltip first to measure it
    setIsVisible(true)

    // Use double requestAnimationFrame to ensure layout is complete
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const tooltipEl = tooltipRef.current
        if (!tooltipEl) return

        const tooltipHeight = tooltipEl.getBoundingClientRect().height
        const tooltipWidth = tooltipEl.getBoundingClientRect().width

        let top = 0
        let left = 0

        // Calculate center of the icon
        const iconCenterY = rect.top + rect.height / 2

        switch (position) {
          case 'top':
            top = rect.top - tooltipHeight - 8
            left = rect.left + rect.width / 2 - tooltipWidth / 2
            break
          case 'bottom':
            top = rect.bottom + 8
            left = rect.left + rect.width / 2 - tooltipWidth / 2
            break
          case 'left':
            top = iconCenterY - tooltipHeight / 2
            left = rect.left - tooltipWidth - 8
            break
          case 'right':
            // Center tooltip vertically with the icon center
            top = iconCenterY - tooltipHeight / 2
            left = rect.right + 6
            break
        }

        // Keep tooltip within viewport
        const padding = 8
        if (left < padding) left = padding
        if (left + tooltipWidth > window.innerWidth - padding) {
          left = window.innerWidth - tooltipWidth - padding
        }
        if (top < padding) {
          top = rect.bottom + 8
        }
        if (top + tooltipHeight > window.innerHeight - padding) {
          top = window.innerHeight - tooltipHeight - padding
        }

        setCoords({ top, left })
      })
    })
  }

  return (
    <>
      <span
        ref={triggerRef}
        onClick={handleClick}
        className={clsx('inline-flex cursor-pointer', className)}
      >
        {children}
      </span>
      {isVisible && createPortal(
        <div
          ref={tooltipRef}
          style={coords ? { top: coords.top, left: coords.left } : { visibility: 'hidden', top: 0, left: 0 }}
          className="fixed z-50 px-3 py-2 text-sm text-white bg-gray-900 rounded-lg shadow-lg max-w-xs pointer-events-none"
        >
          {content}
          {coords && (
            <div
              className={clsx(
                'absolute w-2 h-2 bg-gray-900 rotate-45',
                position === 'top' && 'bottom-[-4px] left-1/2 -translate-x-1/2',
                position === 'bottom' && 'top-[-4px] left-1/2 -translate-x-1/2',
                position === 'left' && 'right-[-4px] top-1/2 -translate-y-1/2',
                position === 'right' && 'left-[-4px] top-1/2 -translate-y-1/2'
              )}
            />
          )}
        </div>,
        document.body
      )}
    </>
  )
}

interface InfoTooltipProps {
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  iconClassName?: string
}

export function InfoTooltip({ content, position = 'top', iconClassName }: InfoTooltipProps) {
  return (
    <Tooltip content={content} position={position}>
      <Info className={clsx('w-4 h-4 text-gray-400 hover:text-gray-600 transition-colors', iconClassName)} />
    </Tooltip>
  )
}
