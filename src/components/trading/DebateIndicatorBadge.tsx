/**
 * DebateIndicatorBadge — Compact tilt bar showing bull/bear debate balance.
 *
 * 8-cell horizontal bar: Bull label left, Bear label right.
 * Fills shift based on net tilt. Clickable popover shows detail.
 */

import { useState } from 'react'
import { useThesisCounts } from '../../hooks/useTheses'
import { clsx } from 'clsx'

interface DebateIndicatorBadgeProps {
  tradeIdeaId: string
  onClick?: () => void
  className?: string
}

const CELLS = 8

function computeCells(bull: number, bear: number): { cells: boolean[]; direction: 'bull' | 'bear' | 'neutral' } {
  const total = bull + bear
  const cells = Array(CELLS).fill(false) as boolean[]

  if (total === 0) return { cells, direction: 'neutral' }

  if (bull === bear) {
    // Balanced: fill the middle cells (1 cell per side of center for equal counts)
    const mid = CELLS / 2 // 4
    cells[mid - 1] = true
    cells[mid] = true
    return { cells, direction: 'neutral' }
  }

  const direction: 'bull' | 'bear' = bull > bear ? 'bull' : 'bear'
  const ratio = Math.max(bull, bear) / total
  // Map ratio to filled count: at minimum 1, scale across CELLS
  const filled = Math.max(1, Math.round(ratio * CELLS))

  if (direction === 'bull') {
    for (let i = 0; i < filled; i++) cells[i] = true
  } else {
    for (let i = CELLS - filled; i < CELLS; i++) cells[i] = true
  }

  return { cells, direction }
}

function getTiltLabel(bull: number, bear: number): string {
  if (bull === 0 && bear === 0) return 'No arguments'
  if (bull === bear) return 'Balanced'
  if (bull > bear) return 'Bull leaning'
  return 'Bear leaning'
}

export function DebateIndicatorBadge({ tradeIdeaId, onClick, className }: DebateIndicatorBadgeProps) {
  const { data: counts } = useThesisCounts(tradeIdeaId)
  const [showPopover, setShowPopover] = useState(false)

  if (!counts || (counts.bull === 0 && counts.bear === 0 && counts.context === 0)) return null

  const { cells, direction } = computeCells(counts.bull, counts.bear)
  const tiltLabel = getTiltLabel(counts.bull, counts.bear)

  const fillColor = direction === 'bull'
    ? 'bg-green-500 dark:bg-green-400'
    : direction === 'bear'
    ? 'bg-red-500 dark:bg-red-400'
    : 'bg-gray-400 dark:bg-gray-500'

  return (
    <div className={clsx('relative inline-flex', className)}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowPopover(!showPopover)
        }}
        className="inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
        title={tiltLabel}
      >
        <span className="text-[8px] font-semibold text-green-600 dark:text-green-400 uppercase leading-none">B</span>
        <div className="flex gap-px">
          {cells.map((filled, i) => (
            <div
              key={i}
              className={clsx(
                'w-1.5 h-2 rounded-[1px] transition-colors',
                filled ? fillColor : 'bg-gray-200 dark:bg-gray-700'
              )}
            />
          ))}
        </div>
        <span className="text-[8px] font-semibold text-red-600 dark:text-red-400 uppercase leading-none">S</span>
      </button>

      {showPopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowPopover(false) }} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[150px] overflow-hidden">
            <div className="px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-green-600 dark:text-green-400 font-medium">Bull {counts.bull}</span>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span className="text-red-600 dark:text-red-400 font-medium">Bear {counts.bear}</span>
              </div>
              {counts.context > 0 && (
                <div className="text-[10px] text-gray-400">{counts.context} context</div>
              )}
              <div className={clsx(
                'text-[10px] font-medium',
                direction === 'bull' ? 'text-green-600 dark:text-green-400' :
                direction === 'bear' ? 'text-red-600 dark:text-red-400' :
                'text-gray-500'
              )}>
                {tiltLabel}
              </div>
            </div>
            {onClick && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowPopover(false); onClick() }}
                className="w-full px-3 py-1.5 text-xs text-primary-600 dark:text-primary-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700 transition-colors text-left font-medium"
              >
                Open Debate
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
