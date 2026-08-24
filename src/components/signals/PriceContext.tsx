import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Maximize2 } from 'lucide-react'

import {
  GESTURE, advanceGesture, beginGesture, holdStillPossible, type GestureState,
} from '../../lib/mobile/gesture-intent'

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

export type RangeKey = '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'

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
  /**
   * Offered as an expand control beside the ranges when present.
   *
   * Optional so the fullscreen chart can render a `PriceContext` of its own
   * without offering to expand what is already expanded.
   */
  onExpand?: () => void
  /**
   * Make one band draggable, against the price history behind it.
   *
   * ── Why the chart is the control ────────────────────────────────────────
   *
   * A target is a claim about where a business gets to, and the only context
   * that makes one assessable is where the stock has actually traded. A
   * slider has none of that: it is a bare track, and the number it produces
   * means nothing until you look somewhere else to interpret it.
   *
   * Dragging the case line ON the tape collapses those two steps. You see the
   * level against the last year while you set it, so "is this reachable" is
   * answered by looking rather than by arithmetic.
   *
   * It also costs no height. The chart is already on the card; the slider,
   * its value row, its presets and its commit row were about 150px of
   * furniture around a number, all of which goes.
   */
  editable?: {
    /** Which band, by label. Only that one gets a handle. */
    label: string
    onChange: (price: number) => void
    /** Fired once when the drag ends, so the caller can stage or commit. */
    onCommit?: () => void
  }
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

/**
 * The ladder, in the order a finance app puts it.
 *
 * ── On 1D, and why it is absent ───────────────────────────────────────────
 *
 * `price_history_cache` holds daily CLOSES. A one-day window over daily closes
 * is a single point, which is not a line and cannot be scrubbed — drawing one
 * would be a chip that produces an empty chart. 1D needs intraday bars, which
 * this project does not store and which the asset-universe work would have to
 * bring in.
 *
 * 5D and 5Y are here and will appear the moment there is data behind them.
 * `available` below filters every entry against the actual span, so a ladder
 * never offers a window it cannot draw — which is why adding them costs
 * nothing today and needs no further change later.
 */
const RANGES: { key: RangeKey; days: number | null }[] = [
  { key: '5D', days: 5 },
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  /**
   * No YTD.
   *
   * It is the least distinct chip on the ladder — for most of the year it
   * selects a window somewhere between 1M and 1Y that one of those already
   * covers — and it was costing the row enough width that `ALL` clipped at the
   * right edge. A control that cannot be read is worth less than one that is
   * merely redundant, so the redundant one goes.
   */
  { key: '1Y', days: 365 },
  { key: '5Y', days: 1825 },
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
  onExpand, editable,
}: PriceContextProps) {
  const gradientId = useId()
  const [picked, setPicked] = useState<number | null>(null)
  const [range, setRange] = useState<RangeKey | null>(initialRange ?? null)
  const svgRef = useRef<SVGSVGElement>(null)
  /** Gesture classification for the current touch. See the header. */
  const drag = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null)

  /**
   * Scrub mode, entered by holding still.
   *
   * A swipe over the chart belongs to the carousel or the feed; only a
   * deliberate press means "show me this day". `HOLD_MS` is the line between
   * them — long enough that a flick never trips it, short enough that a
   * deliberate press does not feel unresponsive.
   */
  const [held, setHeld] = useState(false)
  const holdTimer = useRef<number | null>(null)
  /** The arbitration state for the current touch. See `gesture-intent`. */
  const gesture = useRef<GestureState | null>(null)
  const startedAt = useRef(0)

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
  const endScrub = useCallback((e?: React.PointerEvent<SVGSVGElement>) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
    setHeld(false)
    drag.current = null
    gesture.current = null
    setPicked(null)
    if (e) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* never captured */ }
    }
  }, [])

  /**
   * While scrubbing, stop the browser panning.
   *
   * `touch-action` lets the carousel and the feed have both axes, which is what
   * makes a swipe over the chart page the pane. Once a hold has engaged we need
   * the opposite, and the only way to take it back mid-gesture is a non-passive
   * `touchmove` listener calling preventDefault — React attaches its own
   * handlers passively, so this cannot be done through JSX.
   */
  useEffect(() => {
    const el = svgRef.current
    if (!el || !held) return
    const block = (e: TouchEvent) => e.preventDefault()
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [held])

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
    return RANGES.filter(r => {
      if (r.key === 'ALL') return true
      return full.spanDays > r.days! * 0.9
    })
  }, [full])

  /**
   * Drop a chip that would draw exactly what another chip already draws.
   *
   * Every cached series is roughly a trading year, so `1Y` and `ALL` select
   * the same window on almost every name — two controls, one result, and the
   * reader taps both to find that out. `1Y` is the more informative label of
   * the two (it says how much history there is), so `ALL` is the one that
   * goes when it is redundant.
   *
   * Kept whenever the span genuinely exceeds the widest fixed range, which is
   * what will happen once history goes deeper than a year.
   */
  const shown = useMemo(() => {
    if (!full) return available
    const widestFixed = available
      .filter(r => r.days != null)
      .reduce((n, r) => Math.max(n, r.days!), 0)
    const allIsRedundant = widestFixed > 0 && full.spanDays <= widestFixed
    return allIsRedundant ? available.filter(r => r.key !== 'ALL') : available
  }, [available, full])

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
      const cutoff = endMs - activeRange.days! * 86_400_000
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

  /**
   * A pointer position, as a price.
   *
   * The inverse of `y()`. Two conversions, and both matter: the pointer is in
   * CSS pixels and the scale is in viewBox units, so the rect has to divide
   * out first — and `preserveAspectRatio="none"` means the y scale is
   * independent of x, which is what makes this a clean one-dimensional
   * inverse rather than an aspect-corrected one.
   *
   * Clamped to the plot. A band dragged off the top would be pinned as
   * off-scale anyway, and a negative price is not a target.
   */
  const priceAt = (clientY: number): number | null => {
    const el = svgRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.height <= 0) return null
    const vy = ((clientY - r.top) / r.height) * CHART_H
    const usable = CHART_H - PAD_TOP - PAD_BOTTOM
    const frac = (CHART_H - PAD_BOTTOM - vy) / usable
    const v = lo + frac * (hi - lo)
    return Math.max(0.01, v)
  }

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
        {/* Named as a CLOSE, because that is what it is.
            ── Why this is a label and not a shared number ──────────────────
            A scenario card computes its percentages from the live quote it was
            stamped with; this readout is the last row of `price_history_cache`,
            and under a finger it is whatever close is being scrubbed. On GOOGL
            those were 349.58 and 344.82 — two correct numbers, one labelled
            nothing and the other labelled nothing, sitting on the same card.
            They are not two versions of one figure and reconciling them would
            mean discarding one. Saying which is which is the fix. */}
        <span className="shrink-0 text-[16px] font-bold tabular-nums leading-none text-gray-900 dark:text-white" data-testid="price-readout">
          {point.close.toFixed(2)}
        </span>
        <span
          data-testid="price-readout-label"
          className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gray-400"
        >
          close
        </span>
        <span className={clsx(
          'shrink-0 text-[11px] font-bold tabular-nums',
          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
        )}>
          {up ? '+' : ''}{changePct.toFixed(1)}%
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-0.5" data-testid="price-ranges">
          {/* Expand, beside the ranges rather than over the plot.
              An affordance floating on the chart would sit in the middle of
              the scrub area and be pressed by accident during exactly the
              gesture it must not interrupt. */}
          {onExpand && (
            <button
              type="button"
              data-slot="chart-expand"
              aria-label={`Expand ${symbol} chart`}
              onClick={onExpand}
              className="mr-0.5 rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 no-touch-target"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          {shown.map(r => (
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
          /**
           * Keyed on the range, which forces a fresh element.
           *
           * Reported from a phone: changing the range did not redraw the line
           * until the reader pressed and held the chart — that is, until some
           * OTHER state change forced a paint. The points attribute updates
           * correctly (asserted in a browser), so this is a repaint that never
           * happens, not a computation that never runs: mobile Safari can skip
           * repainting an SVG subtree whose geometry changed but whose box did
           * not.
           *
           * Remounting the plot when the window changes is the reliable fix
           * and costs nothing — the chart is a handful of elements, and the
           * range change is already a deliberate, infrequent tap.
           */
          key={activeRange?.key ?? 'all'}
          ref={svgRef}
          viewBox={`0 0 100 ${CHART_H}`}
          preserveAspectRatio="none"
          /**
           * `pan-x pan-y`, with scrubbing behind a press-and-hold.
           *
           * ── The gesture this arbitrates ────────────────────────────────────
           *
           * The chart lives inside a carousel that pages sideways and a feed
           * that scrolls vertically, so a drag over it has three plausible
           * meanings. `touch-action: none` gave every one of them to the chart:
           * horizontal scrubbed instead of paging, and vertical had to be
           * forwarded by hand. Reported as the chart overriding the carousel.
           *
           * So the browser gets both axes back — a swipe pages, a vertical drag
           * scrolls, and neither needs any code here. Scrubbing is what a
           * DELIBERATE gesture buys: hold still for `HOLD_MS` and the crosshair
           * engages. While it is engaged a non-passive `touchmove` listener
           * calls preventDefault, which is the only way to stop the pan the
           * browser would otherwise start once the finger moves.
           */
          /**
           * `h-full w-full` is load-bearing, not cosmetic.
           *
           * An <svg> is a replaced element with an intrinsic aspect ratio from
           * its viewBox — 1:1 here — so without an explicit size it resolves
           * its HEIGHT from its width. Measured after this class was lost in a
           * refactor: a 318x117 plot box rendered a 318x318 chart, and the
           * bottom two thirds of the line was cut off.
           */
          className="h-full w-full cursor-crosshair [touch-action:pan-x_pan-y]"
          data-testid="price-chart"
          data-scrubbing={held ? 'true' : 'false'}
          onPointerDown={e => {
            const startX = e.clientX
            const startY = e.clientY
            drag.current = { x: startX, y: startY, axis: 'none' }
            // `startedOn: 'chart'` makes a still press eligible for the hold.
            // Everything else about who wins is decided in `gesture-intent`.
            gesture.current = beginGesture({ x: startX, y: startY }, 'chart')
            startedAt.current = Date.now()
            holdTimer.current = window.setTimeout(() => {
              // Still there, and still still. Engage.
              if (!gesture.current) return
              gesture.current = { ...gesture.current, owner: 'chart' }
              /**
               * A tick when inspection engages.
               *
               * The hold is invisible until the crosshair appears, so without
               * a cue the reader cannot tell a press that armed from one that
               * did not — which is most of "it doesn't fire when I want it
               * to". A 10ms tap is the shortest thing that reads as
               * intentional.
               *
               * Android only, honestly: iOS Safari does not implement the
               * Vibration API at all, and there is no web haptics on iOS
               * without native packaging. Optional-called so it is a no-op
               * rather than a crash where it is missing.
               */
              navigator.vibrate?.(10)
              setHeld(true)
              pick(startX)
            }, GESTURE.CHART_HOLD_MS)
          }}
          onPointerMove={e => {
            const g = gesture.current
            if (!g) return
            const at = { x: e.clientX, y: e.clientY }
            const next = advanceGesture(g, at, Date.now() - startedAt.current)
            gesture.current = next

            /**
             * Abandon the hold the moment it can no longer fire, rather than
             * letting it expire into a gesture that has already gone elsewhere
             * — which is how the chart used to activate halfway through a
             * carousel swipe.
             */
            if (next.owner !== 'chart' && holdTimer.current && !holdStillPossible(g, at)) {
              window.clearTimeout(holdTimer.current)
              holdTimer.current = null
            }

            /**
             * The reader engaged the chart and then decided to scroll. The
             * chart has to let go, or the non-passive `touchmove` handler
             * below keeps blocking the browser's pan and the feed is stuck.
             */
            if (held && next.owner === 'feed') { endScrub(e); return }

            if (next.owner === 'chart') pick(e.clientX)
          }}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          // Capture can end without a pointerup — the browser reclaims it when
          // an element is removed or a native scroll wins. Without these the
          // crosshair survives a gesture that already finished.
          onLostPointerCapture={endScrub}
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

          {/* The grab handle for the editable band.
              A wide invisible bar rather than a dot on the line: a 1px dashed
              rule is not a touch target, and the whole width is the natural
              place to press when the thing you are moving spans it. The
              visible affordance is the thicker, solid stroke on that band.
              `touch-action: none` and pointer capture, because a pointer that
              goes down on this is unambiguous — it is the `slider` owner in
              `gesture-intent`, decided at pointerdown rather than after a
              threshold, so it never competes with the scrub or the feed. */}
          {editable && placedBands.filter(b2 => b2.label === editable.label).map(b2 => (
            <g key={`edit:${b2.label}`}>
              <line
                x1={0} x2={100} y1={b2.yPos} y2={b2.yPos}
                strokeWidth={2.5} vectorEffect="non-scaling-stroke"
                className="stroke-primary-600"
                data-testid="price-band-editable"
              />
              <rect
                x={0} y={Math.max(0, b2.yPos - 6)} width={100} height={12}
                fill="transparent"
                className="cursor-ns-resize"
                data-slot="band-handle"
                style={{ touchAction: 'none' }}
                onPointerDown={e => {
                  e.stopPropagation()
                  try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* unsupported */ }
                  const v = priceAt(e.clientY)
                  if (v != null) editable.onChange(v)
                }}
                onPointerMove={e => {
                  if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return
                  e.stopPropagation()
                  const v = priceAt(e.clientY)
                  if (v != null) editable.onChange(v)
                }}
                onPointerUp={e => {
                  try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* gone */ }
                  editable.onCommit?.()
                }}
              />
            </g>
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
