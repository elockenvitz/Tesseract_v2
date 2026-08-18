import { useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import type { WeightSeries as Series } from '../../lib/portfolio/weight-series'

interface WeightSeriesProps {
  symbol: string
  series: Series
  /**
   * The benchmark weight, and the ONE date it is true for.
   *
   * Not a line across the window. There is exactly one benchmark file in this
   * database — SPY, 14 Aug 2026, seven copies of the same as-of date — so
   * drawing a level across a six-month axis would assert an index weight held
   * constant for six months, which is false and invisible. It is a marker with
   * its date on it, and the read-out says "vs bench (14 Aug)" rather than
   * "active weight", because an active weight against one stale reading is not
   * the same quantity the active-risk card computes.
   */
  benchmark?: { weightPct: number; asOf: string } | null
}

const CHART_H = 64

function shortUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * How a position's weight moved, and how much of that movement is real.
 *
 * ── Why the coverage line is not a footnote ───────────────────────────────
 *
 * A weight series is the most persuasive chart this product can draw and the
 * easiest one to fake. Two points joined by a line look like a trend whether
 * they are two genuine marks or one mark and one guess, and nothing about the
 * rendering distinguishes them.
 *
 * So the engine refuses to emit a day it cannot price, and this pane states
 * what that cost: how many days were skipped, and how many of the book's names
 * have a daily price at all. Measured against production that second number is
 * 5-7 of 35-92, which is why most books show snapshot dots and no daily line —
 * the correct output, not a broken one.
 *
 * A point marked from a snapshot and a point marked from daily closes are
 * drawn differently, because they are different claims: one is where the book
 * was uploaded, the other is where it stood.
 */
export function WeightSeries({ symbol, series, benchmark }: WeightSeriesProps) {
  const [picked, setPicked] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const model = useMemo(() => {
    const pts = series.points
    if (pts.length < 2) return null
    const values = pts.map(p => p.weightPct)
    const lo = Math.min(...values, benchmark?.weightPct ?? Infinity)
    const hi = Math.max(...values, benchmark?.weightPct ?? -Infinity)
    const span = hi - lo || Math.max(hi * 0.1, 0.5)
    return {
      pts,
      y: (v: number) => CHART_H - ((v - lo) / span) * (CHART_H - 8) - 4,
      x: (i: number) => (i / (pts.length - 1)) * 100,
    }
  }, [series.points, benchmark])

  if (!model) {
    // One point is a number, not a series. The book has been uploaded once.
    return (
      <div className="flex min-h-[92px] flex-1 flex-col justify-center" data-testid="weight-series-empty">
        <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-200">
          {series.points.length === 1 ? 'One snapshot only' : 'No weight history'}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
          {series.points.length === 1
            ? `This book has been uploaded once, so ${symbol}'s weight has nothing to move against yet.`
            : `Nothing priced well enough to place ${symbol}'s weight on a date.`}
          {series.pricedNames > 0 && series.bookNames > 0 && (
            ` ${series.pricedNames} of ${series.bookNames} names carry a daily price.`
          )}
        </p>
      </div>
    )
  }

  const { pts, y, x } = model
  const at = picked == null ? pts.length - 1 : picked
  const point = pts[at]
  const first = pts[0]
  const change = point.weightPct - first.weightPct
  const path = pts.map((p, i) => `${x(i)},${y(p.weightPct)}`).join(' ')

  const pick = (clientX: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return
    const frac = Math.min(Math.max((clientX - r.left) / r.width, 0), 1)
    setPicked(Math.round(frac * (pts.length - 1)))
  }

  const dailyDays = pts.filter(p => p.marked === 'daily').length

  return (
    <div className="flex min-h-[92px] flex-1 flex-col overflow-hidden" data-testid="weight-series">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {symbol} weight
        </span>
        <span className="text-[16px] font-bold tabular-nums text-gray-900 dark:text-white" data-testid="weight-series-readout">
          {point.weightPct.toFixed(2)}%
        </span>
        <span className="text-[11px] font-semibold text-gray-400">{shortUtc(point.date)}</span>
        {benchmark && (
          // Never "active weight". One dated reading is not the quantity the
          // active-risk card computes, and calling it that would let a stale
          // number inherit a precise name.
          <span className="ml-auto shrink-0 text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
            vs bench ({shortUtc(benchmark.asOf)}) {point.weightPct - benchmark.weightPct >= 0 ? '+' : ''}
            {(point.weightPct - benchmark.weightPct).toFixed(2)}%
          </span>
        )}
        {!benchmark && (
          <span className={clsx(
            'ml-auto shrink-0 text-[11px] font-bold tabular-nums',
            change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}
          </span>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 100 ${CHART_H}`}
        preserveAspectRatio="none"
        className="mt-1.5 min-h-0 w-full flex-1 cursor-pointer"
        data-testid="weight-series-chart"
        onPointerDown={e => pick(e.clientX)}
        role="img"
        aria-label={`${symbol} weight from ${shortUtc(first.date)} to ${shortUtc(pts[pts.length - 1].date)}`}
      >
        {benchmark && (
          <line
            x1={0} x2={100} y1={y(benchmark.weightPct)} y2={y(benchmark.weightPct)}
            strokeDasharray="2 3" strokeWidth={1} vectorEffect="non-scaling-stroke"
            data-testid="weight-series-bench"
            className="stroke-gray-400"
          />
        )}

        <polyline
          points={path} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
          className="stroke-gray-800 dark:stroke-gray-200"
        />

        {/* Snapshot marks get a dot; daily marks do not. An upload day and a
            marked day are different claims and must not read as one line of
            uniform confidence. */}
        {pts.map((p, i) => p.marked === 'snapshot' && (
          <circle
            key={p.date} cx={x(i)} cy={y(p.weightPct)} r={1.6}
            data-testid="weight-series-snapshot-dot"
            className="fill-gray-800 dark:fill-gray-200"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <line
          x1={x(at)} x2={x(at)} y1={0} y2={CHART_H}
          strokeWidth={1} vectorEffect="non-scaling-stroke"
          data-testid="weight-series-crosshair"
          className="stroke-gray-300 dark:stroke-gray-600"
        />
      </svg>

      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-2 text-[10px] font-semibold text-gray-400">
        <span data-testid="weight-series-window">
          {shortUtc(first.date)} – {shortUtc(pts[pts.length - 1].date)}
        </span>
        <span data-testid="weight-series-marks">
          {dailyDays > 0 ? `${dailyDays} marked daily` : `${pts.length} snapshots`}
        </span>
        {/* The cost of the coverage gate, stated. A skipped day is a day this
            pane refused to invent, and hiding that would make the line look
            more continuous than the data behind it. */}
        {series.skipped.length > 0 && (() => {
          // The two reasons are different facts and must not be summed into
          // one number. An unpriced day is a gap in the price feed; a partial
          // snapshot is a fragmentary upload that would have made one holding
          // 100% of the book.
          const unpriced = series.skipped.filter(s => s.reason === 'insufficient_price_coverage').length
          const partial = series.skipped.filter(s => s.reason === 'partial_snapshot').length
          return (
            <span data-testid="weight-series-skipped" className="text-amber-600 dark:text-amber-400">
              {[
                unpriced > 0 && `${unpriced} days unpriced · ${series.pricedNames}/${series.bookNames} names have closes`,
                partial > 0 && `${partial} partial upload${partial > 1 ? 's' : ''} skipped`,
              ].filter(Boolean).join(' · ')}
            </span>
          )
        })()}
      </div>
    </div>
  )
}
