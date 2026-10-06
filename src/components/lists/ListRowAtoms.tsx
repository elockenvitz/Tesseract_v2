/**
 * The few read-only display atoms the expanded list row needs.
 *
 * Deliberately small and deliberately here rather than in `components/ui`:
 * these are read-only renderings of investment state for a dense row, and the
 * platform's existing pieces are the wrong size or the wrong direction for
 * that. `MobileRatingField` is an editor, `PriceTargetCard` and
 * `PriceTargetsSummary` are panel-sized, and nothing read-only exists for a
 * rating, a conviction or a covering analyst at row scale. If a second surface
 * needs them, they move to `components/ui` then — not before.
 *
 * Rating colour comes from `RatingScale.values[].color`, never from a palette
 * invented here: the scale is per-organisation and a hardcoded mapping would
 * silently disagree with whatever a desk actually configured.
 */
import React from 'react'
import { clsx } from 'clsx'

/** Small-caps label used across the expanded row. */
export function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">
      {children}
    </div>
  )
}

/**
 * One cell of the investment-state strip.
 *
 * Renders nothing at all when it has no value. The strip is meant to read as
 * orientation, and a row of "—" placeholders is noise that makes a thin case
 * look like a broken one.
 */
export function StateCell({
  label, value, tone = 'default', title,
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'positive' | 'negative' | 'muted'
  title?: string
}) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex flex-col gap-0.5 min-w-0" title={title}>
      <RowLabel>{label}</RowLabel>
      <div
        className={clsx(
          'text-[13px] font-semibold tabular-nums leading-none truncate',
          tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'negative' && 'text-rose-600 dark:text-rose-400',
          tone === 'muted' && 'text-gray-500 dark:text-gray-400',
          tone === 'default' && 'text-gray-900 dark:text-gray-100',
        )}
      >
        {value}
      </div>
    </div>
  )
}

/** A rating, in the colour its own scale defines. */
export function RatingPill({ value, color }: { value: string; color?: string | null }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold leading-none"
      style={{
        color: color ?? '#374151',
        backgroundColor: color ? `${color}1a` : undefined,
      }}
    >
      {value}
    </span>
  )
}

/**
 * Conviction as three bars rather than a word.
 *
 * It sits beside a rating in a strip that is already text-dense, and
 * low/medium/high is ordinal — a filled-bar glyph reads at a glance where a
 * fourth word does not.
 */
export function ConvictionBars({ level }: { level: 'low' | 'medium' | 'high' }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return (
    <span className="inline-flex items-end gap-[2px] align-middle" title={`${level} conviction`}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={clsx(
            'w-[3px] rounded-sm',
            i === 0 && 'h-[5px]',
            i === 1 && 'h-[8px]',
            i === 2 && 'h-[11px]',
            i < filled
              ? 'bg-gray-700 dark:bg-gray-200'
              : 'bg-gray-200 dark:bg-gray-700',
          )}
        />
      ))}
    </span>
  )
}

/** Covering analyst. Lead is marked, because on a shared name it is the answer. */
export function CoverageChip({
  analyst, team, isLead,
}: { analyst: string; team?: string | null; isLead?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 max-w-full text-[11px] text-gray-600 dark:text-gray-300"
      title={team ? `${analyst} — ${team}` : analyst}
    >
      <span className="truncate">{analyst}</span>
      {isLead && (
        <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 flex-shrink-0">
          lead
        </span>
      )}
    </span>
  )
}
