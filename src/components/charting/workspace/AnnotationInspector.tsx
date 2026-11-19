/**
 * The contextual inspector for a selected mark.
 *
 * ── What it replaces ──────────────────────────────────────────────────────
 *
 * A pill reading "Trend Line selected" with a Delete button, and nothing
 * else. Colour, width and line style existed in `AnnotationStyle` and were
 * rendered faithfully by the engine; no interface offered them. `locked` and
 * `visible` existed on `BaseAnnotation` and had no control at all, so a mark
 * could be neither pinned down nor temporarily hidden.
 *
 * The anchors were the bigger omission. A trend line is a claim about two
 * prices on two dates, and the only statement of that claim was where it sat
 * on a canvas. `annotation-summary` reads it back as figures.
 *
 * ── Collapsible, and empty when nothing is selected ───────────────────────
 *
 * It occupies no width with nothing picked up, so the canvas keeps the space
 * until there is something to say about it.
 */
import { clsx } from 'clsx'
import { Lock, Unlock, Eye, EyeOff, Trash2, X } from 'lucide-react'
import type { Annotation, AnnotationStyle } from '../engine/annotations'
import { describeAnnotation } from './annotation-summary'
import { toolFor } from './drawing-tools'

/** The palette an analyst picks from. Deliberately small: a chart with nine
    colours on it communicates less than one with three. */
const COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#374151']
const WIDTHS = [1, 2, 3]
const LINE_STYLES: AnnotationStyle['lineStyle'][] = ['solid', 'dashed', 'dotted']

export interface AnnotationInspectorProps {
  annotation: Annotation | null
  onChange: (next: Annotation) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export function AnnotationInspector({ annotation, onChange, onDelete, onClose }: AnnotationInspectorProps) {
  if (!annotation) return null

  const rows = describeAnnotation(annotation)
  const title = toolFor(annotation.type)?.label ?? 'Mark'
  const locked = annotation.locked === true
  const hidden = annotation.visible === false

  const patchStyle = (patch: Partial<AnnotationStyle>) =>
    onChange({ ...annotation, style: { ...annotation.style, ...patch } } as Annotation)

  return (
    <aside
      data-charting-inspector
      aria-label={`${title} properties`}
      className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-l border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── The anchors, which are the mark's actual content ───────────── */}
      {rows.length > 0 && (
        <dl className="space-y-1">
          {rows.map(row => (
            <div key={row.label} className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{row.label}</dt>
              <dd className="min-w-0 truncate text-right font-mono text-[11px] tabular-nums text-gray-900 dark:text-gray-100">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* ── Style ───────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Colour</p>
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map(color => (
            <button
              key={color}
              type="button"
              onClick={() => patchStyle({ color })}
              aria-label={`Colour ${color}`}
              aria-pressed={annotation.style.color === color}
              style={{ backgroundColor: color }}
              className={clsx(
                'h-5 w-5 rounded-full border-2 transition-transform',
                annotation.style.color === color
                  ? 'scale-110 border-gray-900 dark:border-white'
                  : 'border-transparent hover:scale-105',
              )}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Width</p>
        <div className="flex gap-1">
          {WIDTHS.map(w => (
            <button
              key={w}
              type="button"
              onClick={() => patchStyle({ lineWidth: w })}
              aria-label={`Line width ${w}`}
              aria-pressed={annotation.style.lineWidth === w}
              className={clsx(
                'flex h-7 flex-1 items-center justify-center rounded border text-[11px]',
                annotation.style.lineWidth === w
                  ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-200'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5',
              )}
            >
              {w}px
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Line</p>
        <div className="flex gap-1">
          {LINE_STYLES.map(style => (
            <button
              key={style}
              type="button"
              onClick={() => patchStyle({ lineStyle: style })}
              aria-label={`Line style ${style}`}
              aria-pressed={annotation.style.lineStyle === style}
              className={clsx(
                'flex h-7 flex-1 items-center justify-center rounded border text-[11px] capitalize',
                annotation.style.lineStyle === style
                  ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-200'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5',
              )}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      {/* ── State, and the one destructive action ───────────────────────── */}
      <div className="mt-auto space-y-1.5 border-t border-gray-200 pt-3 dark:border-gray-700">
        <button
          type="button"
          onClick={() => onChange({ ...annotation, locked: !locked } as Annotation)}
          aria-pressed={locked}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-white/10"
        >
          {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          {locked ? 'Locked' : 'Lock'}
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...annotation, visible: hidden } as Annotation)}
          aria-pressed={hidden}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-white/10"
        >
          {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {hidden ? 'Hidden' : 'Hide'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(annotation.id)}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </aside>
  )
}
