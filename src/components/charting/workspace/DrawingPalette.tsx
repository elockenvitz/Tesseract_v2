/**
 * The persistent drawing palette.
 *
 * The tools it arms all worked before it existed; the only way to reach them
 * was a right-click on empty canvas, which the interface never mentioned.
 * See `drawing-tools.ts` for the account.
 *
 * ── Why a rail and not another dropdown ───────────────────────────────────
 *
 * The command bar above the chart is already eight dropdowns wide. A ninth
 * would have hidden the tools behind one more press and put the thing an
 * analyst reaches for most often at the same depth as "Freq". A rail states
 * the whole set at once, keeps the armed one lit, and costs 44px of a canvas
 * that currently has well over a thousand to spare.
 */
import React from 'react'
import { clsx } from 'clsx'
import {
  MousePointer2, TrendingUp, Minus, MoveVertical, Square, Circle,
  Type, ArrowUpRight, Trash2, Undo2, Redo2, Spline,
} from 'lucide-react'
import type { AnnotationType } from '../engine/annotations'
import { DRAWING_TOOLS, TOOL_GROUPS, type DrawingTool } from './drawing-tools'

/** One icon per tool, kept out of the data table so that stays renderless. */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  select: MousePointer2,
  'trend-line': TrendingUp,
  ray: ArrowUpRight,
  'horizontal-line': Minus,
  'vertical-line': MoveVertical,
  rectangle: Square,
  ellipse: Circle,
  fibonacci: Spline,
  text: Type,
  arrow: ArrowUpRight,
}

function iconFor(tool: DrawingTool) {
  return ICONS[tool.type ?? 'select'] ?? MousePointer2
}

export interface DrawingPaletteProps {
  activeTool: AnnotationType | null
  onSelectTool: (type: AnnotationType | null) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onClearAll: () => void
  /** How many marks are on the active panel, so Clear can say so and can
      be disabled when there is nothing to clear. */
  markCount: number
}

export function DrawingPalette({
  activeTool,
  onSelectTool,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onClearAll,
  markCount,
}: DrawingPaletteProps) {
  return (
    <div
      data-charting-palette
      role="toolbar"
      aria-label="Drawing tools"
      aria-orientation="vertical"
      className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-gray-200 bg-gray-50 py-2 dark:border-gray-700 dark:bg-gray-900"
    >
      {TOOL_GROUPS.map((group, gi) => (
        <React.Fragment key={group}>
          {gi > 0 && <span className="my-1 h-px w-5 bg-gray-200 dark:bg-white/10" />}
          {DRAWING_TOOLS.filter(t => t.group === group).map(tool => {
            const Icon = iconFor(tool)
            const armed = activeTool === tool.type
            return (
              <button
                key={tool.label}
                type="button"
                onClick={() => onSelectTool(tool.type)}
                aria-pressed={armed}
                aria-label={`${tool.label} (${tool.shortcut})`}
                /*
                 * `title` carries the hint as well as the key, because the
                 * difference between a tool you click and a tool you drag is
                 * the single thing a reader gets wrong first.
                 */
                title={`${tool.label} · ${tool.shortcut} — ${tool.hint}`}
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                  armed
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white',
                  /* The ray and the arrow share an icon; the ray is the one
                     that continues past its second point, so it is turned to
                     read as a direction rather than a pointer. */
                  tool.type === 'ray' && !armed && 'rotate-0',
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            )
          })}
        </React.Fragment>
      ))}

      <span className="my-1 h-px w-5 bg-gray-200 dark:bg-white/10" />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo · Ctrl+Z"
        className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 enabled:hover:bg-gray-200 enabled:hover:text-gray-900 disabled:opacity-30 dark:text-gray-400 dark:enabled:hover:bg-white/10"
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo · Ctrl+Shift+Z"
        className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 enabled:hover:bg-gray-200 enabled:hover:text-gray-900 disabled:opacity-30 dark:text-gray-400 dark:enabled:hover:bg-white/10"
      >
        <Redo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onClearAll}
        disabled={markCount === 0}
        aria-label={`Clear all marks (${markCount})`}
        title={markCount === 0 ? 'Nothing drawn' : `Clear all ${markCount} marks on this chart`}
        className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 enabled:hover:bg-rose-50 enabled:hover:text-rose-600 disabled:opacity-30 dark:text-gray-400 dark:enabled:hover:bg-rose-500/10 dark:enabled:hover:text-rose-400"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
