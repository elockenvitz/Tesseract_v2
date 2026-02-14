/**
 * DivergenceBadge — Amber badge shown when analysts disagree on a rating.
 *
 * Renders a small pill with AlertTriangle icon. Clicking opens a portal-based
 * popover listing each unique rating value with analyst names.
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'

interface RatingBreakdownEntry {
  value: string
  label: string
  color: string
  analysts: string[]
}

interface DivergenceBadgeProps {
  breakdown: RatingBreakdownEntry[]
}

export function DivergenceBadge({ breakdown }: DivergenceBadgeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      let x = rect.left
      let y = rect.bottom + 4
      if (x + 280 > window.innerWidth) x = window.innerWidth - 290
      if (y + 200 > window.innerHeight) y = rect.top - 204
      setPosition({ x, y })
      setIsOpen((prev) => !prev)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handleOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleClick}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
      >
        <AlertTriangle className="w-3 h-3" />
        Divergent
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 w-72 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden"
            style={{ left: position.x, top: position.y }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
              <span className="text-sm font-medium text-gray-900">
                Analyst Rating Divergence
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-0.5 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-3 space-y-2">
              <p className="text-xs text-gray-500">
                Analysts on this asset have different views.
              </p>
              <div className="space-y-1.5">
                {breakdown.map((entry) => (
                  <div key={entry.value} className="flex items-start gap-2">
                    <span
                      className="shrink-0 mt-0.5 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: `${entry.color}15`,
                        color: entry.color,
                      }}
                    >
                      {entry.label}
                    </span>
                    <span className="text-xs text-gray-600">
                      {entry.analysts.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
