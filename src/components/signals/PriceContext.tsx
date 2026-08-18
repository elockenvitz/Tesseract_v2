import { useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'

export interface PricePoint {
  /** ISO date of the close. */
  date: string
  close: number
}

export interface PriceBand {
  /** "Bear", "Base", "Bull", "Target". */
  label: string
  price: number
  /** Cases colour by position against the last close; a target is neutral. */
  kind: 'case' | 'target' | 'entry'
}

interface PriceContextProps {
  symbol: string
  /** Daily closes, ascending by date. */
  series: PricePoint[]
  /** Case or target prices drawn as horizontal reference lines. */
  bands?: PriceBand[]
  /**
   * Days after which the series is called out as stale rather than merely
   * dated. 45 ≈ two months of trading: past that, "the last close" stops being
   * a usable proxy for where the name is.
   */
  staleAfterDays?: number
  /** Today, injectable so the staleness line is testable without mocking. */
  now?: Date
}

const CHART_H = 72
const STALE_DEFAULT_DAYS = 45

function shortUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * The tape behind the claim — and, deliberately, not one inch more than the
 * tape actually says.
 *
 * ── Why this pane was parked, and what changed ────────────────────────────
 *
 * It was parked because `price_history_cache` held closes for 3 of 10 laddered
 * symbols, stale by months. Re-measured 2026-08-18: 8 symbols, 251 daily
 * closes each — a full trading year — but the windows END at different dates,
 * from 24 Apr to 10 Aug 2026. So the data got better and the hazard did not
 * change at all: this is a SNAPSHOT series, and the last point on it is not
 * where the name is today.
 *
 * ── The three lies this component refuses to tell ─────────────────────────
 *
 * **No "now" marker.** The right edge is the last close in the series and is
 * labelled with its date, never with "today". Drawing the axis out to the
 * present would put a gap on the chart that reads as a flat price.
 *
 * **No live quote.** Nothing here is compared against a live price. Mixing a
 * four-month-old close with a live quote is the `snapshot_vs_live` suppression
 * the contract already names, and a chart is the easiest place in the product
 * to do it by accident.
 *
 * **Staleness is stated, not implied.** A series ending four months ago gets a
 * line saying so. The alternative — a beautiful chart with a small date under
 * it — is `isQuoteFresh` passing on a fabricated quote all over again: the
 * artifact looks authoritative and the caveat is where nobody reads it.
 *
 * ── Why the crosshair is a TAP and not a drag ─────────────────────────────
 *
 * This pane lives inside `CardCarousel`, whose track claims horizontal
 * gestures via `touch-action: pan-x` so that vertical drags fall through to the
 * feed. A horizontal scrub would be exactly the gesture the carousel is
 * listening for, so a drag here would either page the carousel mid-scrub or —
 * if this element took `touch-action: none` — trap the reader on the chart with
 * no way to page past it.
 *
 * Tap-to-place has neither failure. It is also the only one of the two that a
 * headless browser can drive, and `touch-action` arbitration is documented as
 * permanently unprovable in this CI harness.
 */
export function PriceContext({
  symbol, series, bands = [], staleAfterDays = STALE_DEFAULT_DAYS, now,
}: PriceContextProps) {
  const [picked, setPicked] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const model = useMemo(() => {
    const clean = series
      .filter(p => Number.isFinite(p.close) && p.close > 0 && !Number.isNaN(new Date(p.date).getTime()))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (clean.length < 2) return null

    const closes = clean.map(p => p.close)
    // Bands share the axis. A case above the highest close would otherwise sit
    // off-canvas, which silently turns "the tape is nowhere near this" into
    // "there is no such case".
    const bandPrices = bands.map(b => b.price).filter(p => Number.isFinite(p) && p > 0)
    const lo = Math.min(...closes, ...bandPrices)
    const hi = Math.max(...closes, ...bandPrices)
    const span = hi - lo || Math.max(hi * 0.02, 1)
    const y = (v: number) => CHART_H - ((v - lo) / span) * (CHART_H - 6) - 3
    const x = (i: number) => (i / (clean.length - 1)) * 100

    return { clean, lo, hi, span, y, x, last: clean[clean.length - 1], first: clean[0] }
  }, [series, bands])

  if (!model) {
    // Fewer than two closes is not a flat line, it is no series. Saying so
    // beats drawing a chart from one point.
    return (
      <div className="flex min-h-[92px] flex-1 flex-col justify-center" data-testid="price-context-empty">
        <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-200">No price history</p>
        <p className="mt-1 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
          Nothing is cached for {symbol}, so there is no tape to put behind this.
        </p>
      </div>
    )
  }

  const { clean, y, x, last, first } = model
  const lastDate = new Date(last.date)
  const ageDays = Math.floor(((now ?? new Date()).getTime() - lastDate.getTime()) / 86_400_000)
  const stale = ageDays > staleAfterDays

  const at = picked == null ? clean.length - 1 : picked
  const point = clean[at]
  // Always against the FIRST close in the window, never against a live price.
  const changePct = ((point.close - first.close) / first.close) * 100

  const path = clean.map((p, i) => `${x(i)},${y(p.close)}`).join(' ')

  /** Nearest index to the tapped x. Tap, not drag — see the header. */
  const pick = (clientX: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return
    const frac = Math.min(Math.max((clientX - r.left) / r.width, 0), 1)
    setPicked(Math.round(frac * (clean.length - 1)))
  }

  return (
    <div className="flex min-h-[92px] flex-1 flex-col overflow-hidden" data-testid="price-context">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {symbol} close
        </span>
        <span className="text-[16px] font-bold tabular-nums text-gray-900 dark:text-white" data-testid="price-readout">
          {point.close.toFixed(2)}
        </span>
        <span className="text-[11px] font-semibold text-gray-400" data-testid="price-readout-date">
          {shortUtc(point.date)}
        </span>
        <span className={clsx(
          'ml-auto shrink-0 text-[11px] font-bold tabular-nums',
          changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
        )}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 100 ${CHART_H}`}
        preserveAspectRatio="none"
        className="mt-1.5 min-h-0 w-full flex-1 cursor-pointer"
        data-testid="price-chart"
        onPointerDown={e => pick(e.clientX)}
        role="img"
        aria-label={`${symbol} daily closes, ${shortUtc(first.date)} to ${shortUtc(last.date)}`}
      >
        {bands.map(b => (
          <g key={`${b.label}:${b.price}`}>
            <line
              x1={0} x2={100} y1={y(b.price)} y2={y(b.price)}
              strokeDasharray="2 2" strokeWidth={1} vectorEffect="non-scaling-stroke"
              data-testid="price-band"
              className={clsx(
                b.kind === 'case' ? 'stroke-gray-400' : 'stroke-primary-400',
              )}
            />
          </g>
        ))}

        <polyline
          points={path}
          fill="none"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className="stroke-gray-800 dark:stroke-gray-200"
        />

        {/* The crosshair sits on the tapped close. It is a read-out, not a
            selection — nothing about it is written anywhere. */}
        <line
          x1={x(at)} x2={x(at)} y1={0} y2={CHART_H}
          strokeWidth={1} vectorEffect="non-scaling-stroke"
          data-testid="price-crosshair"
          className="stroke-gray-300 dark:stroke-gray-600"
        />
      </svg>

      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-2 text-[10px] font-semibold text-gray-400">
        {/* The window, both ends dated. There is no "now" on this axis.
            Years are shown when the window crosses one: a full trading year
            renders "May 21 – May 13", which reads as eight days rather than
            twelve months and makes a year of drawdown look like a bad week. */}
        <span data-testid="price-window">
          {first.date.slice(0, 4) === last.date.slice(0, 4)
            ? `${shortUtc(first.date)} – ${shortUtc(last.date)}`
            : `${shortUtc(first.date)} ’${first.date.slice(2, 4)} – ${shortUtc(last.date)} ’${last.date.slice(2, 4)}`}
        </span>
        {bands.length > 0 && (
          <span className="text-gray-500 dark:text-gray-400">
            {bands.map(b => b.label).join(' · ')}
          </span>
        )}
        {stale && (
          // Loud, and in the pane rather than in a footnote. A chart that looks
          // current while ending four months ago is the fabricated-freshness
          // defect drawn at 300 pixels wide.
          <span
            data-testid="price-stale"
            className="ml-auto shrink-0 font-bold text-amber-600 dark:text-amber-400"
          >
            {ageDays}d old — not a current price
          </span>
        )}
      </div>
    </div>
  )
}
