import { useCallback, useId, useMemo, useRef, useState } from 'react'
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
  kind: 'event' | 'horizon'
}

export type RangeKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'

interface PriceContextProps {
  symbol: string
  /** Daily closes, ascending by date. */
  series: PricePoint[]
  bands?: PriceBand[]
  markers?: PriceMarker[]
  staleAfterDays?: number
  /** Today, injectable so the staleness line is testable without mocking. */
  now?: Date
  initialRange?: RangeKey
}

/** Plot geometry, in viewBox units. Y only: x is always 0..100. */
const CHART_H = 100
const PAD_TOP = 8
const PAD_BOTTOM = 8
const STALE_DEFAULT_DAYS = 45

/**
 * How far outside the price range a band may sit and still stretch the axis.
 *
 * ── Why a band is not simply part of the domain ───────────────────────────
 *
 * It used to be. Every band price went into the min/max alongside the closes,
 * on the reasoning that a target off-canvas silently turns "the tape is nowhere
 * near this" into "there is no such target".
 *
 * That reasoning is right and the implementation was wrong. A GOOGL target of
 * $1,605 against a $344 close forced a domain five times taller than the price
 * action, so the line the chart exists to show flattened into a horizontal
 * scratch at the bottom while 80% of the plot was empty space under a dashed
 * rule. The card lost its chart in order to place one reference line.
 *
 * So a band stretches the axis only while it stays near the action. Beyond
 * that it is pinned to the edge and drawn as off-scale, with its real value on
 * the label. The reader still learns the target exists and that the price is
 * nowhere near it — which is the whole message — and the tape stays legible.
 */
const BAND_STRETCH = 0.6

const RANGES: { key: RangeKey; days: number | null }[] = [
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  { key: 'YTD', days: null },
  { key: '1Y', days: 365 },
  { key: 'ALL', days: null },
]

function shortUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** Axis prices: whole dollars over $100, cents below. A $3.42 name and a
 *  $3,420 name need different precision and the same amount of room. */
function axisPrice(v: number): string {
  if (v >= 1000) return v.toFixed(0)
  if (v >= 100) return v.toFixed(1)
  return v.toFixed(2)
}

/**
 * The tape behind the claim, and deliberately not one inch more than it says.
 *
 * ── The three lies this component refuses to tell ─────────────────────────
 *
 * **No "now" marker.** The right edge is the last close in the series and is
 * labelled with its date, never with "today".
 *
 * **No live quote.** Nothing here is compared against a live price. Mixing a
 * stale close with a live quote is the `snapshot_vs_live` suppression the
 * contract already names, and a chart is the easiest place to do it by accident.
 *
 * **Staleness is stated, not implied.** A series ending months ago says so.
 *
 * ── Ranges are measured from the SERIES END, not from today ───────────────
 *
 * With ingestion healthy the two are the same window. They diverge exactly when
 * something is wrong: a symbol the backfill cannot resolve stops advancing while
 * the rest move on, and "1M back from today" on one of those returns an empty
 * window. A range chip that silently draws nothing is worse than one showing a
 * clearly labelled stale month, so the anchor is the data.
 *
 * ── Why the scrub locks to an axis ────────────────────────────────────────
 *
 * The plot takes `touch-action: pan-y`, so vertical gestures go to the browser
 * and the feed's snap scroll is untouched. That alone was not enough: a finger
 * starting on the chart and dragging UP scrolled the feed *and* dragged the
 * crosshair, because pointer capture had already been taken on pointerdown and
 * every move event was treated as a scrub. Two things moved for one gesture,
 * which is the "too sensitive, something moved that I did not touch" complaint.
 *
 * The first few pixels of movement now decide. Past a small threshold the
 * gesture is classified once and kept: mostly-horizontal scrubs, mostly-vertical
 * releases capture and never scrubs again for that touch. A tap with no
 * movement still places the crosshair, which is the interaction a headless
 * browser can drive.
 */
export function PriceContext({
  symbol, series, bands = [], markers = [], staleAfterDays = STALE_DEFAULT_DAYS, now, initialRange,
}: PriceContextProps) {
  const gradientId = useId()
  const [picked, setPicked] = useState<number | null>(null)
  const [range, setRange] = useState<RangeKey | null>(initialRange ?? null)
  const svgRef = useRef<SVGSVGElement>(null)
  /** Gesture classification for the current touch. See the header. */
  const drag = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null)

  /**
   * End a scrub and put the chart back where it started.
   *
   * ── The bug this fixes ────────────────────────────────────────────────────
   *
   * `onPointerUp` cleared the drag ref and released capture but never cleared
   * `picked`, so lifting a finger left the crosshair, the price and the date
   * frozen on whatever historical point was last under it. The chart then read
   * as showing the current price when it was showing a day in April, which is
   * the worst possible failure for a number somebody might act on.
   *
   * It survived because releasing capture and clearing the gesture LOOK like
   * cleanup. They tidy up the input; the readout is separate state and nothing
   * touched it.
   *
   * Every path that can end a gesture routes here, including the two that do
   * not fire `pointerup` at all: `lostpointercapture` (the browser takes
   * capture back, or the axis lock hands it away mid-drag) and `pointercancel`
   * (a native scroll wins). Both were previously either unhandled or handled
   * only for the drag ref.
   */
  /** The nearest ancestor that actually scrolls vertically. */
  const scrollerOf = (el: Element | null): HTMLElement | null => {
    for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n
    }
    return null
  }

  const endScrub = useCallback((e?: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null
    setPicked(null)
    if (e) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* never captured */ }
    }
  }, [])

  const full = useMemo(() => {
    const clean = series
      .filter(p => Number.isFinite(p.close) && p.close > 0 && !Number.isNaN(new Date(p.date).getTime()))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (clean.length < 2) return null
    const endMs = new Date(clean[clean.length - 1].date).getTime()
    return { clean, endMs, spanDays: (endMs - new Date(clean[0].date).getTime()) / 86_400_000 }
  }, [series])

  /**
   * Which ranges are worth offering.
   *
   * The old rule required the span to exceed a range by 15% before showing it,
   * which quietly deleted most of the ladder: every cached series is ~364 days,
   * so 1Y needed 419 and never appeared, and a reader was left with two chips
   * where they expected the usual six. The threshold is now 0.9, so a range
   * within a rounding error of the full span still earns its place — a "1Y" on
   * 364 days of data is the honest label, not a missing button.
   */
  const available = useMemo(() => {
    if (!full) return []
    const endYear = new Date(full.endMs).getUTCFullYear()
    return RANGES.filter(r => {
      if (r.key === 'ALL') return true
      if (r.key === 'YTD') {
        // Only when the window actually reaches back into this year's start,
        // and only when that is a different window from ALL.
        const jan1 = Date.UTC(endYear, 0, 1)
        const ytdDays = (full.endMs - jan1) / 86_400_000
        return ytdDays > 20 && full.spanDays > ytdDays * 1.1
      }
      return full.spanDays > r.days! * 0.9
    })
  }, [full])

  const activeRange = useMemo(() => {
    if (!available.length) return null
    return (range && available.find(r => r.key === range))
      ?? available.find(r => r.key === '6M')
      ?? available[available.length - 1]
  }, [available, range])

  const model = useMemo(() => {
    if (!full) return null
    const { clean, endMs } = full

    let windowed = clean
    if (activeRange && activeRange.key !== 'ALL') {
      const cutoff = activeRange.key === 'YTD'
        ? Date.UTC(new Date(endMs).getUTCFullYear(), 0, 1)
        : endMs - activeRange.days! * 86_400_000
      windowed = clean.filter(p => new Date(p.date).getTime() >= cutoff)
    }
    const pts = windowed.length >= 2 ? windowed : clean

    const closes = pts.map(p => p.close)
    const pLo = Math.min(...closes)
    const pHi = Math.max(...closes)
    const pSpan = pHi - pLo || Math.max(pHi * 0.02, 0.01)

    // Bands stretch the axis only while they stay near the action. Past that
    // they are pinned and marked off-scale rather than flattening the line.
    const near = bands.filter(b =>
      Number.isFinite(b.price) && b.price > 0 &&
      b.price >= pLo - pSpan * BAND_STRETCH && b.price <= pHi + pSpan * BAND_STRETCH)
    const lo = Math.min(pLo, ...near.map(b => b.price))
    const hi = Math.max(pHi, ...near.map(b => b.price))
    const span = hi - lo || Math.max(hi * 0.02, 0.01)

    const y = (v: number) =>
      CHART_H - PAD_BOTTOM - ((v - lo) / span) * (CHART_H - PAD_TOP - PAD_BOTTOM)
    const x = (i: number) => (i / (pts.length - 1)) * 100

    const placedBands = bands
      .filter(b => Number.isFinite(b.price) && b.price > 0)
      .map(b => {
        const offScale = b.price > hi ? 'above' : b.price < lo ? 'below' : null
        return {
          ...b,
          offScale,
          // Pinned just inside the plot so the rule and its label stay visible.
          yPos: offScale === 'above' ? PAD_TOP * 0.5
            : offScale === 'below' ? CHART_H - PAD_BOTTOM * 0.5
            : y(b.price),
        }
      })

    return { pts, lo, hi, y, x, placedBands, last: pts[pts.length - 1], first: pts[0] }
  }, [full, activeRange, bands])

  if (!model) {
    return (
      <div className="flex min-h-[92px] flex-1 flex-col justify-center" data-testid="price-context-empty">
        <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-200">No price history</p>
        <p className="mt-1 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
          Nothing is cached for {symbol}, so there is no tape to put behind this.
        </p>
      </div>
    )
  }

  const { pts, lo, hi, y, x, placedBands, last, first } = model
  const ageDays = Math.floor(((now ?? new Date()).getTime() - new Date(last.date).getTime()) / 86_400_000)
  const stale = ageDays > staleAfterDays

  const at = picked == null ? pts.length - 1 : Math.min(picked, pts.length - 1)
  const point = pts[at]
  const changePct = ((point.close - first.close) / first.close) * 100
  const up = changePct >= 0

  const line = pts.map((p, i) => `${x(i)},${y(p.close)}`).join(' ')
  const area = `${x(0)},${CHART_H} ${line} ${x(pts.length - 1)},${CHART_H}`

  const pick = (clientX: number) => {
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return
    const frac = Math.min(Math.max((clientX - r.left) / r.width, 0), 1)
    setPicked(Math.round(frac * (pts.length - 1)))
  }

  const placedMarkers = markers
    .map(m => {
      const t = new Date(m.date).getTime()
      if (!Number.isFinite(t)) return null
      let best = -1, bestGap = Infinity
      pts.forEach((p, i) => {
        const gap = Math.abs(new Date(p.date).getTime() - t)
        if (gap < bestGap) { bestGap = gap; best = i }
      })
      // Outside the window by more than a fortnight is not on this chart.
      // Snapping it to the edge would put a horizon where it never was.
      if (best < 0 || bestGap > 14 * 86_400_000) return null
      return { ...m, index: best }
    })
    .filter(Boolean) as (PriceMarker & { index: number })[]

  const pctTop = (yv: number) => `${(yv / CHART_H) * 100}%`
  const crossesYear = first.date.slice(0, 4) !== last.date.slice(0, 4)
  /** Three gridlines: high, midpoint, low. Enough to read a level off. */
  const gridValues = [hi, (hi + lo) / 2, lo]

  return (
    <div className="flex h-full min-h-[92px] flex-col overflow-hidden" data-testid="price-context">
      {/* Header carries the read-out AND the ranges.
          The range chips used to sit in their own row under the plot, which
          cost the chart a full line of height and put the control furthest
          from the thing it controls. Up here they are beside the number they
          change, and the plot keeps the height. */}
      <div className="flex shrink-0 items-center gap-1.5 [touch-action:pan-x]">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {symbol}
        </span>
        <span className="shrink-0 text-[16px] font-bold tabular-nums leading-none text-gray-900 dark:text-white" data-testid="price-readout">
          {point.close.toFixed(2)}
        </span>
        <span className={clsx(
          'shrink-0 text-[11px] font-bold tabular-nums',
          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
        )}>
          {up ? '+' : ''}{changePct.toFixed(1)}%
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-0.5" data-testid="price-ranges">
          {available.map(r => (
            <button
              key={r.key}
              type="button"
              data-price-range={r.key}
              aria-pressed={activeRange?.key === r.key}
              onClick={() => { setRange(r.key); setPicked(null) }}
              className={clsx(
                'h-5 rounded px-1.5 text-[9px] font-bold tabular-nums transition-colors no-touch-target',
                activeRange?.key === r.key
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {/* Plot and y-axis gutter as two explicit boxes.
          The plot box is the coordinate space for the SVG *and* for every
          absolutely-positioned label on it, so `left: x%` means the same thing
          in both and needs no correction factor.

          The `w-full` on the SVG is load-bearing. An <svg> is a replaced
          element with an intrinsic aspect ratio from its viewBox, so
          `left-0 right-9` with `width: auto` resolved the width from the
          HEIGHT and the 1:1 ratio instead of from the constraint — the plot
          rendered at half the width of its container with the y-axis labels
          stranded 160px to its right. Sizing the box and telling the SVG to
          fill it removes the ambiguity. */}
      <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-y-0 left-0 right-9">
        <svg
          ref={svgRef}
          viewBox={`0 0 100 ${CHART_H}`}
          preserveAspectRatio="none"
          // `none`, not `pan-y`.
          //
          // `pan-y` handed vertical to the browser, which meant any vertical
          // drift while scrubbing horizontally scrolled the feed underneath the
          // finger — reported as "it is scrolling up/down tile wise when I
          // don't want it to". touch-action is fixed for the whole gesture, so
          // there is no way to allow vertical up to the axis lock and forbid it
          // after: the browser has already decided.
          //
          // So the element takes NO native panning and the vertical case is
          // forwarded by hand below. That is more code than a CSS value, and it
          // is the only arrangement where both halves of the complaint can be
          // true at once.
          className="h-full w-full cursor-crosshair [touch-action:none]"
          data-testid="price-chart"
          onPointerDown={e => {
            drag.current = { x: e.clientX, y: e.clientY, axis: 'none' }
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* tap-only */ }
            pick(e.clientX)
          }}
          onPointerMove={e => {
            const d = drag.current
            if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return
            if (d.axis === 'none') {
              const dx = Math.abs(e.clientX - d.x)
              const dy = Math.abs(e.clientY - d.y)
              // Below the threshold the gesture has not declared itself yet.
              if (Math.max(dx, dy) < 6) return
              d.axis = dy > dx ? 'y' : 'x'
              if (d.axis === 'y') {
                // The feed's gesture, not ours. Clear any crosshair the first
                // few pixels drew, and let the forwarding below move the feed.
                setPicked(null)
              }
            }
            if (d.axis === 'x') { pick(e.clientX); return }
            if (d.axis === 'y') {
              /**
               * Vertical, forwarded by hand.
               *
               * With `touch-action: none` the browser will not scroll for us, so
               * a vertical drag that starts on the chart has to be passed to the
               * feed explicitly or the chart becomes a dead zone — which is the
               * other half of the same complaint.
               *
               * `scrollBy` rather than a scroll-into-view: CSS scroll-snap still
               * applies to programmatic scrolling, so the feed settles on a tile
               * when the finger lifts exactly as it would have. What is lost is
               * fling momentum, which is the price of not scrubbing and
               * scrolling at the same time.
               */
              const dy = e.clientY - d.y
              d.y = e.clientY
              scrollerOf(e.currentTarget)?.scrollBy(0, -dy)
            }
          }}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          // Capture can be lost without a pointerup: the browser takes it back
          // when the element is removed, when a native scroll starts, or when
          // the axis lock above releases it mid-gesture. Without this the
          // crosshair survives a gesture that already ended.
          onLostPointerCapture={endScrub}
          // Mouse only. A pointer that leaves the plot without releasing left
          // the readout frozen on desktop for the same reason.
          onPointerLeave={e => { if (e.pointerType === 'mouse') endScrub(e) }}
          role="img"
          aria-label={`${symbol} daily closes, ${shortUtc(first.date)} to ${shortUtc(last.date)}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={up ? 'text-emerald-500' : 'text-rose-500'} stopColor="currentColor" stopOpacity="0.26" />
              <stop offset="100%" className={up ? 'text-emerald-500' : 'text-rose-500'} stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Gridlines first: the axis a reader measures against. Without them
              the plot was a shape with no levels on it, which is what "the axes
              are unclear" means in practice. */}
          {gridValues.map((v, i) => (
            <line
              key={`grid:${i}`}
              x1={0} x2={100} y1={y(v)} y2={y(v)}
              strokeWidth={1} vectorEffect="non-scaling-stroke"
              className="stroke-gray-200 dark:stroke-gray-700"
            />
          ))}

          <polygon points={area} fill={`url(#${gradientId})`} data-testid="price-area" />

          {placedBands.map(b => (
            <line
              key={`${b.label}:${b.price}`}
              x1={0} x2={100} y1={b.yPos} y2={b.yPos}
              strokeDasharray={b.offScale ? '1 3' : '4 3'}
              strokeWidth={b.offScale ? 1 : 1.25} vectorEffect="non-scaling-stroke"
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
            points={line} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke"
            strokeLinejoin="round" strokeLinecap="round"
            className={up ? 'stroke-emerald-600 dark:stroke-emerald-400' : 'stroke-rose-600 dark:stroke-rose-400'}
          />

          <line
            x1={x(at)} x2={x(at)} y1={0} y2={CHART_H}
            strokeWidth={1} vectorEffect="non-scaling-stroke"
            data-testid="price-crosshair"
            className="stroke-gray-400 dark:stroke-gray-500"
          />
        </svg>

        {/* Text lives outside the stretched viewBox: `preserveAspectRatio=none`
            scales x and y independently, which is right for the path and
            ruinous for glyphs. */}
        <div className="pointer-events-none absolute inset-0">
          {placedBands.map(b => (
            <span
              key={`${b.label}:${b.price}`}
              data-testid="price-band-label"
              className={clsx(
                'absolute -translate-y-1/2 rounded px-1 text-[9px] font-bold uppercase tracking-wide',
                b.kind === 'case'
                  ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  : 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300',
              )}
              style={{ top: pctTop(b.yPos), left: 2 }}
            >
              {/* The caret says the level is beyond the visible range, so a
                  pinned rule is never read as a level the price nearly met. */}
              {b.offScale === 'above' ? '↑ ' : b.offScale === 'below' ? '↓ ' : ''}
              {b.label} {b.price.toFixed(b.price >= 100 ? 0 : 2)}
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
              style={{ left: `${Math.min(Math.max(x(m.index), 14), 86)}%` }}
            >
              {m.label}
            </span>
          ))}

          <span
            data-testid="price-dot"
            className={clsx(
              'absolute h-2 w-2 rounded-full ring-2 ring-white dark:ring-gray-900',
              up ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-rose-600 dark:bg-rose-400',
            )}
            style={{
              left: `${x(at)}%`,
              top: pctTop(y(point.close)),
              // Tucked inside at the extremes: the default read-out is the last
              // close at left:100%, and a centred dot there is half outside the
              // plot and clipped into something that reads as a rendering fault.
              transform: `translate(${x(at) > 97 ? '-100%' : x(at) < 3 ? '0' : '-50%'}, -50%)`,
            }}
          />
        </div>
        </div>

        {/* The y axis, in a gutter of its own so a level label can never land
            on top of the line it describes. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-9">
          {gridValues.map((v, i) => (
            <span
              key={`ylab:${i}`}
              data-testid="price-axis-y"
              className="absolute right-0 -translate-y-1/2 text-right text-[9px] font-semibold tabular-nums text-gray-400"
              style={{ top: pctTop(y(v)) }}
            >
              {axisPrice(v)}
            </span>
          ))}
        </div>
      </div>

      {/* X axis: both ends of the window, and the scrubbed date in between so
          the crosshair reads as a position in time rather than a bare rule. */}
      {/* Both ends of the window, with the scrubbed date between them, so the
          crosshair reads as a position in time rather than a bare rule.

          The year appears on BOTH ends when the window crosses one. A full
          trading year rendered "May 21 – May 13", which reads as eight days and
          makes twelve months of drawdown look like a bad week; stamping only
          the right end would leave the same ambiguity at the left. */}
      <div className="mt-0.5 flex shrink-0 items-baseline gap-2 text-[9px] font-semibold text-gray-400" data-testid="price-window">
        <span>{shortUtc(first.date)}{crossesYear ? ` ’${first.date.slice(2, 4)}` : ''}</span>
        <span className="flex-1 truncate text-center font-bold text-gray-600 dark:text-gray-300" data-testid="price-readout-date">
          {shortUtc(point.date)}
        </span>
        <span>{shortUtc(last.date)}{crossesYear ? ` ’${last.date.slice(2, 4)}` : ''}</span>
      </div>

      {stale && (
        <div
          data-testid="price-stale"
          className="mt-0.5 shrink-0 text-[9px] font-bold text-amber-600 dark:text-amber-400"
        >
          {ageDays}d old, not a current price
        </div>
      )}
    </div>
  )
}
