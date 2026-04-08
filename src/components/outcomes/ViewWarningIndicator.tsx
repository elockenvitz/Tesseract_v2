/**
 * ViewWarningIndicator — Compact header badge + popover for integrity warnings.
 *
 * Sits next to the Visibility control in the asset page header.
 * Shows the count of active warnings; clicking opens a grouped list
 * that navigates to the relevant tile on click.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X, ChevronRight, Info, Zap } from 'lucide-react'
import type { ViewWarningsResult, WarningItem, WarningTile } from '../../hooks/useViewWarnings'

interface ViewWarningIndicatorProps {
  warnings: ViewWarningsResult
}

const TILE_META: Record<WarningTile, { label: string; order: number }> = {
  attention: { label: 'Needs Attention', order: 0 },
  rating: { label: 'Rating', order: 1 },
  targets: { label: 'Targets', order: 2 },
  risks: { label: 'Risks', order: 3 },
  evolution: { label: 'Evolution', order: 4 },
  other: { label: 'Other', order: 5 },
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

  const { action: actionCount, warning: warnCount, info: infoCount } = warnings.countBySeverity
  const hasActions = actionCount > 0

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleClick}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors border ${
          hasActions
            ? 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200/60'
            : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200/60'
        }`}
        title={`${warnings.count} item${warnings.count !== 1 ? 's' : ''} need attention`}
      >
        {hasActions ? <Zap className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
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
                {hasActions ? <Zap className="w-3.5 h-3.5 text-red-600" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                <span className="text-sm font-medium text-gray-900">
                  Attention
                </span>
                <span className="text-xs text-gray-500">
                  {actionCount > 0 && `${actionCount} action${actionCount !== 1 ? 's' : ''}`}
                  {actionCount > 0 && (warnCount > 0 || infoCount > 0) && ', '}
                  {warnCount > 0 && `${warnCount} warning${warnCount !== 1 ? 's' : ''}`}
                  {warnCount > 0 && infoCount > 0 && ', '}
                  {infoCount > 0 && `${infoCount} info`}
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
            <div className="py-1 max-h-80 overflow-y-auto">
              {grouped.map(group => (
                <div key={group.tile}>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50/50">
                    {group.label} ({group.items.length})
                  </div>
                  {group.items.map(item => (
                    <div
                      key={item.id}
                      className="px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                    >
                      <div
                        className="flex items-start gap-2 cursor-pointer"
                        onClick={() => item.anchorId ? handleNavigate(item.anchorId) : undefined}
                      >
                        {item.severity === 'action' ? (
                          <Zap className="w-3.5 h-3.5 mt-0.5 text-red-500 shrink-0" />
                        ) : item.severity === 'warning' ? (
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
                          {/* Action buttons */}
                          {item.actions && item.actions.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              {item.actions.map((action, idx) => (
                                <button
                                  key={idx}
                                  onClick={(e) => { e.stopPropagation(); action.fn(); setIsOpen(false) }}
                                  className={`text-[11px] font-medium px-2 py-0.5 rounded transition-colors ${
                                    idx === 0
                                      ? 'bg-gray-900 text-white hover:bg-gray-800'
                                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  {action.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {item.anchorId && <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-gray-300 shrink-0" />}
                      </div>
                    </div>
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
