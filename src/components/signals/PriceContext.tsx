import { useId, useMemo, useRef, useState } from 'react'
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

export interface PriceMarker {
  /** ISO. Snapped to the nearest close in the visible window. */
  date: string
  label: string
  /**
   * `horizon` is a deadline that ran out or is coming: the end of a target's
   * stated timeframe. `event` is something that happened.
   */
  kind: 'event' | 'horizon'
}

export type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'MAX'

interface PriceContextProps {
  symbol: string
  /** Daily closes, ascending by date. */
  series: PricePoint[]
  /** Case or target prices drawn as horizontal reference lines. */
  bands?: PriceBand[]
  /** Dated verticals: a horizon that ran out, an event worth marking. */
  markers?: PriceMarker[]
  /**
   * Days after which the series is called out as stale rather than merely
   * dated. 45 ≈ two months of trading: past that, "the last close" stops being
   * a usable proxy for where the name is.
   */
  staleAfterDays?: number
  /** Today, injectable so the staleness line is testable without mocking. */
  now?: Date
  /** Opening range. Defaults to the widest window that still narrows the data. */
  initialRange?: RangeKey
}

const CHART_H = 100
const STALE_DEFAULT_DAYS = 45

const RANGES: { key: RangeKey; days: number | null }[] = [
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: '1Y', days: 365 },
  { key: 'MAX', days: null },
]

function shortUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * The tape behind the claim, and deliberately not one inch more than the tape
 * actually says.
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
 * line saying so.
 *
 * ── Ranges are measured from the SERIES END, not from today ───────────────
 *
 * As of the nightly backfill, 133 of 135 cached symbols end one day behind the
 * current date, so for almost every name "the last N days of the data" and
 * "the last N days" are the same window. This still measures from the series
 * end, and deliberately.
 *
 * The two are only equal while ingestion is healthy. A symbol the backfill
 * cannot resolve — a rename it reports rather than guesses, a delisting, a
 * night the provider served an interstitial — stops advancing while every
 * other symbol moves on. Measuring "1M" back from today on one of those
 * returns an empty window, and a range chip that silently draws nothing is a
 * worse failure than one showing a stale month clearly labelled as stale.
 * Anchoring to the data means the chart degrades into an honest old window
 * instead of a blank one.
 *
 * ── Why the scrub is a drag, and what protects the feed ───────────────────
 *
 * The plot sets `touch-action: pan-y`. Vertical gestures go to the browser, so
 * the feed's snap scroll is untouched — that is the one gesture the whole card
 * architecture exists to protect. Horizontal gestures come here, which makes a
 * real drag-scrub possible.
 *
 * The cost is that a horizontal swipe *starting on the plot* no longer pages
 * the carousel. That is paid for deliberately: `CardCarousel` renders labelled,
 * tappable indicators precisely so paging never depends on a swipe, and the
 * header and footer rows of this pane keep `pan-x` so a swipe just above or
 * below the plot still pages. Tap-to-place still works for anyone who does not
 * drag, and it is the interaction a headless browser can drive.
 */
export function PriceContext({
  symbol, series, bands = [], markers = [], staleAfterDays = STALE_DEFAULT_DAYS, now, initialRange,
}: PriceContextProps) {
  const gradientId = useId()
  const [picked, setPicked] = useState<number | null>(null)
  const [range, setRange] = useState<RangeKey | null>(initialRange ?? null)
  const svgRef = useRef<SVGSVGElement>(null)

  /** Cleaned, sorted, and the full span it covers. Independent of range. */
  const full = useMemo(() => {
    const clean = series
      .filter(p => Number.isFinite(p.close) && p.close > 0 && !Number.isNaN(new Date(p.date).getTime()))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (clean.length < 2) return null
    const endMs = new Date(clean[clean.length - 1].date).getTime()
    const startMs = new Date(clean[0].date).getTime()
    return { clean, endMs, spanDays: (endMs - startMs) / 86_400_000 }
  }, [series])

  /**
   * Only ranges that actually narrow the data, plus MAX.
   *
   * A "1Y" chip on nine months of closes draws exactly the same chart as MAX
   * and teaches the reader that the controls do nothing. The 1.15 factor keeps
   * a chip off when it would trim a rounding error rather than a window.
   */
  const available = useMemo(() => {
    if (!full) return []
    return RANGES.filter(r => r.days == null || full.spanDays > r.days * 1.15)
  }, [full])

  const activeRange = useMemo(() => {
    if (!available.length) return null
    const found = range && available.find(r => r.key === range)
    if (found) return found
    // Default to the widest window that still narrows the data, so the chart
    // opens on a trend rather than on a year compressed into 300 pixels.
    return available.find(r => r.days != null && r.days >= 180) ?? available[available.length - 1]
  }, [available, range])

  const model = useMemo(() => {
    if (!full) return null
    const { clean, endMs } = full
    const windowed = activeRange?.days == null
      ? clean
      : clean.filter(p => (endMs - new Date(p.date).getTime()) / 86_400_000 <= activeRange.days!)
    // A range that clips to a single point is not a line. Fall back rather than
    // render an empty plot.
    const pts = windowed.length >= 2 ? windowed : clean

    const closes = pts.map(p => p.close)
    // Bands share the axis. A case above the highest close would otherwise sit
    // off-canvas, which silently turns "the tape is nowhere near this" into
    // "there is no such case".
    const bandPrices = bands.map(b => b.price).filter(p => Number.isFinite(p) && p > 0)
    const lo = Math.min(...closes, ...bandPrices)
    const hi = Math.max(...closes, ...bandPrices)
    const span = hi - lo || Math.max(hi * 0.02, 1)
    const PAD = 6
    const y = (v: number) => CHART_H - PAD - ((v - lo) / span) * (CHART_H - PAD * 2)
    const x = (i: number) => (i / (pts.length - 1)) * 100

    return { pts, lo, hi, y, x, last: pts[pts.length - 1], first: pts[0] }
  }, [full, activeRange, bands])

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

  const { pts, y, x, last, first } = model
  const lastDate = new Date(last.date)
  const ageDays = Math.floor(((now ?? new Date()).getTime() - lastDate.getTime()) / 86_400_000)
  const stale = ageDays > staleAfterDays

  const at = picked == null ? pts.length - 1 : Math.min(picked, pts.length - 1)
  const point = pts[at]
  // Always against the first close in the VISIBLE window, never against a live
  // price. Changing the range changes what the percentage is measured from,
  // which is what a range control is for.
  const changePct = ((point.close - first.close) / first.close) * 100
  const up = changePct >= 0

  const line = pts.map((p, i) => `${x(i)},${y(p.close)}`).join(' ')
  const area = `${x(0)},${CHART_H} ${line} ${x(pts.length - 1)},${CHART_H}`

  /** Nearest index to a client x. Shared by tap and drag. */
  const pick = (clientX: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return
    const frac = Math.min(Math.max((clientX - r.left) / r.width, 0), 1)
    setPicked(Math.round(frac * (pts.length - 1)))
  }

  /** Markers snapped to the nearest visible close, dropped when outside it. */
  const placedMarkers = markers
    .map(m => {
      const t = new Date(m.date).getTime()
      if (!Number.isFinite(t)) return null
      let best = -1
      let bestGap = Infinity
      pts.forEach((p, i) => {
        const gap = Math.abs(new Date(p.date).getTime() - t)
        if (gap < bestGap) { bestGap = gap; best = i }
      })
      // More than a fortnight from any close in the window means the date is
      // not on this chart. Snapping it to the edge would put a horizon marker
      // somewhere it never was.
      if (best < 0 || bestGap > 14 * 86_400_000) return null
      return { ...m, index: best }
    })
    .filter(Boolean) as (PriceMarker & { index: number })[]

  const pctTop = (v: number) => `${(y(v) / CHART_H) * 100}%`

  return (
    <div className="flex h-full min-h-[92px] flex-col overflow-hidden" data-testid="price-context">
      {/* Read-out. Keeps pan-x so a swipe here still pages the carousel. */}
      <div className="flex shrink-0 items-baseline gap-2 [touch-action:pan-x]">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {symbol}
        </span>
        <span className="text-[17px] font-bold tabular-nums text-gray-900 dark:text-white" data-testid="price-readout">
          {point.close.toFixed(2)}
        </span>
        <span className="text-[11px] font-semibold text-gray-400" data-testid="price-readout-date">
          {shortUtc(point.date)}
        </span>
        <span className={clsx(
          'ml-auto shrink-0 text-[11px] font-bold tabular-nums',
          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
        )}>
          {up ? '+' : ''}{changePct.toFixed(1)}%
        </span>
      </div>

      {/* overflow-hidden is load-bearing, not tidiness.
          The plot is a bounded viewport with absolutely-positioned children on
          it, and anything anchored at the extremes — the read-out dot at
          `left: 100%`, a band label at the top of the axis — extends past the
          box and grows its scrollWidth. That is a horizontal scroller inside a
          card, which is the one thing this surface may never contain: the feed
          owns vertical, the carousel owns horizontal, and a third scroller
          inside either of them makes both gestures ambiguous. */}
      <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 100 ${CHART_H}`}
          preserveAspectRatio="none"
          // pan-y, not none: vertical belongs to the feed and always will.
          // Horizontal comes here, which is what makes the drag-scrub possible.
          className="absolute inset-0 h-full w-full cursor-crosshair [touch-action:pan-y]"
          data-testid="price-chart"
          // Capture is best-effort. A synthetic or already-released pointer
          // makes setPointerCapture throw NotFoundError, and a chart that
          // refuses to read out because it could not claim a drag is worse
          // than one that only supports tap. The tap path never depends on it.
          onPointerDown={e => {
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* tap-only */ }
            pick(e.clientX)
          }}
          onPointerMove={e => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX)
          }}
          onPointerUp={e => {
            try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* never captured */ }
          }}
          role="img"
          aria-label={`${symbol} daily closes, ${shortUtc(first.date)} to ${shortUtc(last.date)}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={up ? 'text-emerald-500' : 'text-rose-500'} stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" className={up ? 'text-emerald-500' : 'text-rose-500'} stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Fill first, so every line drawn after it stays legible. */}
          <polygon points={area} fill={`url(#${gradientId})`} data-testid="price-area" />

          {bands.map(b => (
            <line
              key={`${b.label}:${b.price}`}
              x1={0} x2={100} y1={y(b.price)} y2={y(b.price)}
              strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke"
              data-testid="price-band"
              className={b.kind === 'case' ? 'stroke-gray-400' : 'stroke-primary-500'}
            />
          ))}

          {placedMarkers.map(m => (
            <line
              key={`${m.label}:${m.date}`}
              x1={x(m.index)} x2={x(m.index)} y1={0} y2={CHART_H}
              strokeDasharray={m.kind === 'horizon' ? '2 3' : undefined}
              strokeWidth={1} vectorEffect="non-scaling-stroke"
              data-testid="price-marker"
              className={m.kind === 'horizon' ? 'stroke-amber-500' : 'stroke-gray-400'}
            />
          ))}

          <polyline
            points={line}
            fill="none"
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            className={up ? 'stroke-emerald-600 dark:stroke-emerald-400' : 'stroke-rose-600 dark:stroke-rose-400'}
          />

          {/* The crosshair sits on the scrubbed close. It is a read-out, not a
              selection: nothing about it is written anywhere. */}
          <line
            x1={x(at)} x2={x(at)} y1={0} y2={CHART_H}
            strokeWidth={1} vectorEffect="non-scaling-stroke"
            data-testid="price-crosshair"
            className="stroke-gray-400 dark:stroke-gray-500"
          />
        </svg>

        {/* Text lives outside the stretched viewBox.
            `preserveAspectRatio="none"` scales x and y independently, which is
            correct for the path and ruinous for glyphs: an SVG <text> in here
            renders at whatever horizontal stretch the card's width happens to
            impose. Positioning HTML in percentages gives the same anchoring
            with type that stays type. */}
        <div className="pointer-events-none absolute inset-0">
          {bands.map(b => (
            <span
              key={`${b.label}:${b.price}`}
              data-testid="price-band-label"
              className={clsx(
                'absolute right-0 -translate-y-1/2 rounded-l px-1 text-[9px] font-bold uppercase tracking-wide',
                b.kind === 'case'
                  ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  : 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300',
              )}
              style={{ top: pctTop(b.price) }}
            >
              {b.label} {b.price.toFixed(0)}
            </span>
          ))}

          {placedMarkers.map(m => (
            <span
              key={`${m.label}:${m.date}`}
              data-testid="price-marker-label"
              className={clsx(
                'absolute top-0 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[9px] font-bold uppercase tracking-wide',
                m.kind === 'horizon'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
              )}
              // Pinned inside the plot: a marker on the last close would
              // otherwise hang its label off the right edge of the card.
              style={{ left: `${Math.min(Math.max(x(m.index), 12), 88)}%` }}
            >
              {m.label}
            </span>
          ))}

          {/* The scrubbed point, so the crosshair reads as a value on the line
              rather than a bare vertical rule.

              The horizontal half of the transform is chosen rather than fixed
              at -50%. The default read-out is the LAST close, which sits at
              `left: 100%`, and a centred dot there is half outside the plot —
              clipped by the overflow rule above into something that reads as a
              rendering fault. At the extremes the dot tucks inside instead,
              which costs it three pixels of accuracy on a chart whose whole
              point is the shape of the line. */}
          <span
            data-testid="price-dot"
            className={clsx(
              'absolute h-2 w-2 rounded-full ring-2 ring-white dark:ring-gray-900',
              up ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-rose-600 dark:bg-rose-400',
            )}
            style={{
              left: `${x(at)}%`,
              top: pctTop(point.close),
              transform: `translate(${x(at) > 97 ? '-100%' : x(at) < 3 ? '0' : '-50%'}, -50%)`,
            }}
          />
        </div>
      </div>

      {/* Ranges, then the window this chart actually covers.
          The window label is unconditional: it is the sentence that stops the
          chart implying it reaches the present, and a card with only one usable
          range needs that just as much as a card with five. Only the chips are
          conditional, because a lone chip is a control that does nothing. */}
      <div className="mt-1.5 flex shrink-0 items-center gap-1 [touch-action:pan-x]" data-testid="price-ranges">
        {available.length > 1 && available.map(r => (
          <button
            key={r.key}
            type="button"
            data-price-range={r.key}
            aria-pressed={activeRange?.key === r.key}
            onClick={() => { setRange(r.key); setPicked(null) }}
            className={clsx(
              'h-6 rounded-md px-2 text-[10px] font-bold tabular-nums transition-colors no-touch-target',
              activeRange?.key === r.key
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
            )}
          >
            {r.key}
          </button>
        ))}
        <span className="ml-auto shrink-0 text-[10px] font-semibold text-gray-400" data-testid="price-window">
          {/* Years are shown when the window crosses one: a full trading year
              renders "May 21 – May 13", which reads as eight days rather than
              twelve months and makes a year of drawdown look like a bad week. */}
          {first.date.slice(0, 4) === last.date.slice(0, 4)
            ? `${shortUtc(first.date)} to ${shortUtc(last.date)}`
            : `${shortUtc(first.date)} ’${first.date.slice(2, 4)} to ${shortUtc(last.date)} ’${last.date.slice(2, 4)}`}
        </span>
      </div>

      {stale && (
        // Loud, and in the pane rather than in a footnote. A chart that looks
        // current while ending four months ago is the fabricated-freshness
        // defect drawn at 300 pixels wide.
        <div
          data-testid="price-stale"
          className="mt-1 shrink-0 text-[10px] font-bold text-amber-600 dark:text-amber-400"
        >
          {ageDays}d old, not a current price
        </div>
      )}
    </div>
  )
}
