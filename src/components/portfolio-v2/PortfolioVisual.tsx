/**
 * Desktop Portfolio — visuals that answer a portfolio question.
 *
 * One visual per problem, and none where there is no problem to draw. A
 * sparkline on every row is decoration; a scale that shows spot sitting past
 * the top of its own bull case is an argument.
 *
 * ── The framework scale ───────────────────────────────────────────────────
 *
 * The one visual worth its space. It plots the current ladder as a range and
 * puts spot on it, so "above bull" is something you see rather than read. It
 * renders ONLY from a valid ladder -- two distinct priced rungs, chosen by the
 * shared selector -- and never invents a rung to complete the picture.
 *
 * ── The concentration bar ─────────────────────────────────────────────────
 *
 * Weight against the rest of the book, drawn only where weight is real. There
 * is no policy max, target weight or risk budget anywhere in production, so
 * there is no limit marker on it: a line labelled "max" would be this product
 * inventing someone's mandate.
 */

import { clsx } from 'clsx'
import type { CurrentLadder } from '../../lib/signals/current-ladder'
import { TONE_FILL, type SemanticTone } from '../../lib/semantic-tone'

/* ------------------------------------------------------ framework scale */

export function FrameworkScale({ ladder, spot }: { ladder: CurrentLadder; spot: number }) {
  const rungs = ladder.cases.filter(c => Number.isFinite(c.price) && c.price > 0)
  if (rungs.length < 2 || !(spot > 0)) return null

  const prices = rungs.map(r => r.price)
  const lo = Math.min(...prices, spot)
  const hi = Math.max(...prices, spot)
  const pad = (hi - lo) * 0.12 || hi * 0.05
  const min = lo - pad
  const max = hi + pad
  const at = (v: number) => ((v - min) / (max - min)) * 100

  const bear = rungs.find(r => r.name === 'Bear')?.price
  const bull = rungs.find(r => r.name === 'Bull')?.price
  const outside = (bull != null && spot > bull) || (bear != null && spot < bear)

  return (
    <div data-testid="framework-scale">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
          Spot against the framework
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">
          {rungs.length} case{rungs.length === 1 ? '' : 's'} · {new Date(ladder.updatedAt).toLocaleDateString()}
        </span>
      </div>

      <div className="relative h-[46px]">
        {/* the range the framework actually spans */}
        {bear != null && bull != null && (
          <div
            className="absolute top-[15px] h-[6px] rounded-full bg-gray-200 dark:bg-white/15"
            style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }}
          />
        )}
        {/* the stretch spot has travelled beyond it — hatched, not filled: it
            is territory the case never claimed */}
        {outside && bull != null && spot > bull && (
          <div
            className="absolute top-[15px] h-[6px] rounded-full bg-rose-400/40"
            style={{ left: `${at(bull)}%`, width: `${Math.max(0, at(spot) - at(bull))}%` }}
          />
        )}
        {outside && bear != null && spot < bear && (
          <div
            className="absolute top-[15px] h-[6px] rounded-full bg-rose-400/40"
            style={{ left: `${at(spot)}%`, width: `${Math.max(0, at(bear) - at(spot))}%` }}
          />
        )}

        {rungs.map(r => (
          <div key={r.id} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${at(r.price)}%` }}>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">{r.name}</div>
            <div className="mx-auto mt-[2px] h-[12px] w-px bg-gray-400 dark:bg-gray-600" />
            <div className="mt-[2px] font-mono text-[10px] text-gray-500">{money(r.price)}</div>
          </div>
        ))}

        <div className="absolute top-[9px] -translate-x-1/2" style={{ left: `${at(spot)}%` }}>
          <div className={clsx(
            'h-[18px] w-[2px] rounded',
            outside ? 'bg-rose-600' : 'bg-blue-600',
          )} />
          <div className={clsx(
            'mt-[1px] -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-bold',
            outside ? 'text-rose-600 dark:text-rose-400' : 'text-blue-700 dark:text-blue-400',
          )} style={{ marginLeft: '50%' }}>
            {money(spot)}
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- concentration */

export function WeightBar({
  weightPct, label = 'Weight in book', max,
}: { weightPct: number; label?: string; max?: number }) {
  // Scaled against the largest position in the book, not against 100: a book
  // of forty names would otherwise draw forty near-invisible slivers.
  const ceiling = Math.max(max ?? 0, weightPct, 1)
  return (
    <div data-testid="weight-bar">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">{label}</span>
        <span className="ml-auto font-mono text-[13px] font-semibold tabular-nums">
          {weightPct.toFixed(1)}%
        </span>
      </div>
      <div className="h-[7px] w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-blue-600"
          style={{ width: `${Math.min(100, (weightPct / ceiling) * 100)}%` }}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- book map */

export interface MapCell {
  key: string
  label: string
  /** Geometry. Only weight decides how wide a segment is. */
  weightPct: number
  /** Meaning. The shared tone, never derived from the weight. */
  tone: SemanticTone
}

/**
 * The book, sized by weight and coloured by whether the framework holds.
 *
 * This is the one grouping worth drawing. "Technology 38%, Healthcare 22%" is
 * a fact about the book; "34% of the book sits in names with no written case"
 * is a question about the process, and it is the question the colour answers.
 *
 * Width and colour answer different questions and are computed from different
 * inputs: a wide amber segment is a large position with work outstanding, a
 * narrow rose one is a small position whose case has actually broken. Reading
 * both off one axis is what made the first version a single red bar.
 */
export function BookMap({ cells }: { cells: MapCell[] }) {
  const total = cells.reduce((s, c) => s + c.weightPct, 0)
  if (!cells.length || total <= 0) return null

  return (
    <div data-testid="book-map" className="flex h-[42px] w-full overflow-hidden rounded-lg">
      {cells.map(c => (
        <div
          key={c.key}
          title={`${c.label} · ${c.weightPct.toFixed(1)}%`}
          className={clsx(
            'flex min-w-0 items-center justify-center border-r border-white/60 last:border-r-0 dark:border-black/30',
            TONE_FILL[c.tone],
          )}
          style={{ width: `${(c.weightPct / total) * 100}%` }}
        >
          <span className="truncate px-1 font-mono text-[10px] font-bold">
            {(c.weightPct / total) * 100 >= 6 ? c.label : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

export const money = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`

export const bigMoney = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}bn`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}m`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}k`
  return `$${n.toFixed(0)}`
}
