/**
 * InconsistencyBadge — Amber badge shown when user's rating direction
 * conflicts with their probability-weighted expected value.
 *
 * Popover explains the mismatch and offers a 24-hour suppress action.
 */

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X, Clock, ArrowRight } from 'lucide-react'
import type { RatingDirection } from '../../lib/rating-direction'

interface InconsistencyBadgeProps {
  direction: RatingDirection
  evReturn: number
  conflictDescription: string
  /** Whether the current user can suppress this warning (own user view only) */
  canSuppress: boolean
  onSuppress: () => Promise<void>
  isSuppressing: boolean
}

const DIRECTION_PILL: Record<RatingDirection, { label: string; bg: string; text: string }> = {
  positive: { label: 'Positive', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  neutral: { label: 'Neutral', bg: 'bg-gray-100', text: 'text-gray-700' },
  negative: { label: 'Negative', bg: 'bg-red-50', text: 'text-red-700' },
}

export function InconsistencyBadge({
  direction,
  evReturn,
  conflictDescription,
  canSuppress,
  onSuppress,
  isSuppressing,
}: InconsistencyBadgeProps) {
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
      if (x + 300 > window.innerWidth) x = window.innerWidth - 310
      if (y + 240 > window.innerHeight) y = rect.top - 244
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

  const pill = DIRECTION_PILL[direction]
  const evPct = (evReturn * 100).toFixed(1)
  const evColor = evReturn >= 0 ? 'text-emerald-700' : 'text-red-700'

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleClick}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
      >
        <AlertTriangle className="w-3 h-3" />
        EV Mismatch
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 w-80 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden"
            style={{ left: position.x, top: position.y }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
              <span className="text-sm font-medium text-gray-900">
                Rating vs Expected Value
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-0.5 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-3 space-y-3">
              <p className="text-xs text-gray-600 leading-relaxed">
                {conflictDescription}
              </p>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">Rating:</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${pill.bg} ${pill.text}`}>
                    {pill.label}
                  </span>
                </div>
                <ArrowRight className="w-3 h-3 text-gray-300" />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">EV:</span>
                  <span className={`text-xs font-semibold ${evColor}`}>
                    {evReturn >= 0 ? '+' : ''}{evPct}%
                  </span>
                </div>
              </div>

              <div className="pt-1 border-t border-gray-100">
                {canSuppress ? (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      await onSuppress()
                      setIsOpen(false)
                    }}
                    disabled={isSuppressing}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                  >
                    <Clock className="w-3 h-3" />
                    {isSuppressing ? 'Ignoring...' : 'Ignore for 24 hours'}
                  </button>
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    Only the owner of this view can dismiss this warning.
                  </p>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
