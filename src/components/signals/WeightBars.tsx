import { useState } from 'react'
import { clsx } from 'clsx'

export type WeightTone = 'subject' | 'proposed' | 'reference' | 'neutral'

export interface WeightRow {
  /** Portfolio name, "Current", "Proposed" — whatever the row IS. */
  label: string
  weightPct: number
  tone?: WeightTone
  /** A date, an owner, a caveat. Rendered small, never load-bearing. */
  note?: string
}

interface WeightBarsProps {
  rows: WeightRow[]
  /**
   * The row every comparison is measured from, by index. Tapping any other row
   * reads out its distance from this one.
   */
  baselineIndex?: number
  /** What the numbers are, in the reader's words: "of each book", "of NAV". */
  unitNote?: string
  /** Cap on rows drawn. The remainder is stated, never silently dropped. */
  limit?: number
  /**
   * Render the values as money rather than percent.
   *
   * The same bars answer a different question. Weight says how much of a book
   * this is; money says how much of the firm is behind it, and a 25% weight in
   * a small fund can be a fraction of a 4% weight in a large one. "Crowded" is
   * a claim about the second, so the card carries both rather than letting the
   * reader assume they rank the same way — they frequently do not.
   */
  unit?: 'percent' | 'usd'
}

/** "$1.2m", "$840k". Enough precision to rank, not so much it wraps. */
function money(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}b`
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}

const TONE: Record<WeightTone, string> = {
  subject: 'bg-gray-900 dark:bg-white',
  proposed: 'bg-primary-500',
  reference: 'bg-gray-300 dark:bg-gray-600',
  neutral: 'bg-gray-400 dark:bg-gray-500',
}

/**
 * Weights side by side, with the arithmetic between them done in place.
 *
 * One primitive rather than three charts. "Current against proposed", "which
 * books hold this and how heavily", and "the stated view against the actual
 * size" are the same picture — a set of labelled magnitudes on a shared axis
 * with one of them as the baseline — and building them separately produced
 * three subtly different bar treatments last time the feed had bespoke tiles
 * per kind.
 *
 * ── Why the delta is a tap, not a permanent column ────────────────────────
 *
 * Rendering every row's distance from the baseline puts six numbers on a
 * 390px card and makes the one the reader wants harder to find, not easier.
 * Tapping a row states that one comparison in a sentence. A tap also survives
 * the carousel: this pane can sit next to a chart that pages horizontally, and
 * a tap is never mistaken for a page gesture — the same reason `PriceContext`
 * places its crosshair on tap.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * A row with a non-finite weight is dropped and counted, not drawn as zero. A
 * zero-height bar is indistinguishable from a real 0.00% position, and the
 * difference between "holds none of it" and "we could not compute this" is the
 * whole reason the suppression contract exists.
 */
export function WeightBars({ rows, baselineIndex = 0, unitNote, limit = 6, unit = 'percent' }: WeightBarsProps) {
  const fmt = (n: number) => (unit === 'usd' ? money(n) : `${n.toFixed(2)}%`)
  const [picked, setPicked] = useState<number | null>(null)

  const usable = rows.filter(r => Number.isFinite(r.weightPct))
  const dropped = rows.length - usable.length
  const shown = usable.slice(0, limit)
  const hidden = usable.length - shown.length
  if (!shown.length) return null

  const max = Math.max(...shown.map(r => Math.abs(r.weightPct)), 0.01)
  const baseline = usable[baselineIndex] ?? usable[0]
  const active = picked != null && picked !== baselineIndex ? shown[picked] : null
  const delta = active ? active.weightPct - baseline.weightPct : null

  return (
    // h-full rather than flex-1, so this fills whichever container it is given.
    // Carousel panes are flex columns and the card's disclosure region is a
    // block; `flex-1` resolves to nothing in the second and the control clumps
    // at the top of an empty band. Same fix, same reason, as `WhatIfSize`.
    <div className="flex h-full min-h-[92px] flex-col overflow-hidden" data-testid="weight-bars">
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
        {shown.map((r, i) => {
          const frac = Math.abs(r.weightPct) / max
          const isBaseline = i === baselineIndex
          return (
            <button
              key={`${r.label}:${i}`}
              type="button"
              data-testid="weight-bar-row"
              aria-pressed={picked === i}
              onClick={() => setPicked(p => (p === i ? null : i))}
              className="flex w-full items-center gap-2 text-left no-touch-target"
            >
              <span className={clsx(
                // 96px, not 74. Real portfolio names — "Tech & Consumer
                // Growth", "Large Cap Growth" — truncated to "LARGE CAP ..."
                // at the old width, which made two different books render as
                // the same label on a chart whose whole point is comparing
                // them.
                'w-[96px] shrink-0 truncate text-[10px] font-bold uppercase tracking-wide',
                isBaseline ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400',
              )}>
                {r.label}
              </span>
              <span className="relative h-[10px] min-w-0 flex-1 rounded-full bg-gray-100 dark:bg-gray-800">
                <span
                  className={clsx(
                    'absolute inset-y-0 left-0 rounded-full',
                    TONE[r.tone ?? 'neutral'],
                    picked === i && 'ring-1 ring-gray-900 dark:ring-white',
                  )}
                  style={{ width: `${Math.max(frac * 100, 2)}%` }}
                />
              </span>
              <span className="w-[52px] shrink-0 text-right text-[10px] font-bold tabular-nums text-gray-700 dark:text-gray-200">
                {fmt(r.weightPct)}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-2 text-[10px] font-semibold text-gray-400">
        {delta != null && active ? (
          // The one comparison asked for, stated rather than left to be read
          // off two bars.
          <span data-testid="weight-bars-delta" className="text-gray-600 dark:text-gray-300">
            {active.label} is {unit === 'usd' ? money(Math.abs(delta)) : `${Math.abs(delta).toFixed(2)}%`} {delta >= 0 ? 'more' : 'less'} than {baseline.label}
            {active.note ? ` · ${active.note}` : ''}
          </span>
        ) : (
          <span>{unitNote ?? 'Tap a row to compare'}</span>
        )}
        {hidden > 0 && <span data-testid="weight-bars-hidden">{hidden} more</span>}
        {/* Never silent. A row that could not be computed is a different fact
            from a row that is zero. */}
        {dropped > 0 && (
          <span data-testid="weight-bars-dropped" className="text-amber-600 dark:text-amber-400">
            {dropped} not computable
          </span>
        )}
      </div>
    </div>
  )
}
