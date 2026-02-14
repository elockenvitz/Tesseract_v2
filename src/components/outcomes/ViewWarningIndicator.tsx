/**
 * ViewWarningIndicator — Compact header badge + popover for integrity warnings.
 *
 * Sits next to the Visibility control in the asset page header.
 * Shows the count of active warnings; clicking opens a grouped list
 * that navigates to the relevant tile on click.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X, ChevronRight, Info } from 'lucide-react'
import type { ViewWarningsResult, WarningItem, WarningTile } from '../../hooks/useViewWarnings'

interface ViewWarningIndicatorProps {
  warnings: ViewWarningsResult
}

const TILE_META: Record<WarningTile, { label: string; order: number }> = {
  rating: { label: 'Rating', order: 0 },
  targets: { label: 'Targets', order: 1 },
  risks: { label: 'Risks', order: 2 },
  evolution: { label: 'Evolution', order: 3 },
  other: { label: 'Other', order: 4 },
}

export function ViewWarningIndicator({ warnings }: ViewWarningIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Outside click / Escape handling — must be before any early returns
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

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      let x = rect.left
      let y = rect.bottom + 4
      if (x + 300 > window.innerWidth) x = window.innerWidth - 310
      if (y + 300 > window.innerHeight) y = rect.top - 304
      setPosition({ x, y })
      setIsOpen(prev => !prev)
    }
  }, [])

  const handleNavigate = useCallback((anchorId: string) => {
    setIsOpen(false)
    requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }, [])

  // Build grouped list, sorted by tile order, warnings before info
  const grouped = useMemo(() =>
    Object.entries(warnings.byTile)
      .map(([tile, items]) => ({
        tile: tile as WarningTile,
        label: TILE_META[tile as WarningTile]?.label ?? tile,
        order: TILE_META[tile as WarningTile]?.order ?? 99,
        items: [...items].sort((a, b) => {
          if (a.severity === 'warning' && b.severity !== 'warning') return -1
          if (a.severity !== 'warning' && b.severity === 'warning') return 1
          return 0
        }),
      }))
      .sort((a, b) => a.order - b.order),
    [warnings.byTile]
  )

  // Nothing to show — after all hooks
  if (warnings.count === 0) return null

  const { warning: warnCount, info: infoCount } = warnings.countBySeverity

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleClick}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors border border-amber-200/60"
        title={`${warnings.count} integrity warning${warnings.count !== 1 ? 's' : ''} in this view`}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>{warnings.count}</span>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 w-[296px] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden"
            style={{ left: position.x, top: position.y }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-sm font-medium text-gray-900">
                  View Warnings
                </span>
                <span className="text-xs text-gray-500">
                  ({warnCount > 0 ? `${warnCount} warning${warnCount !== 1 ? 's' : ''}` : ''}
                  {warnCount > 0 && infoCount > 0 ? ', ' : ''}
                  {infoCount > 0 ? `${infoCount} info` : ''})
                </span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-0.5 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Grouped list */}
            <div className="py-1 max-h-72 overflow-y-auto">
              {grouped.map(group => (
                <div key={group.tile}>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    {group.label} ({group.items.length})
                  </div>
                  {group.items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleNavigate(item.anchorId)}
                      className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors group"
                    >
                      {item.severity === 'warning' ? (
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
                      ) : (
                        <Info className="w-3.5 h-3.5 mt-0.5 text-blue-400 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 leading-tight">
                          {item.title}
                        </p>
                        <p className="text-xs text-gray-500 leading-snug mt-0.5 line-clamp-2">
                          {item.message}
                        </p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-gray-300 group-hover:text-gray-500 shrink-0" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
