/**
 * PriceChart — the desktop price chart.
 *
 * ── Why this is not `PriceContext` ────────────────────────────────────────
 *
 * `PriceContext` is the feed's chart, and it is built for the feed: a phone
 * card, ninety-odd pixels tall, where the honest answer is a shape and a
 * number. It draws into a `viewBox="0 0 100 H"` with `preserveAspectRatio:
 * none`, which is exactly right at that size — the plot stretches to whatever
 * the card gives it and nothing has to be measured.
 *
 * That trick does not survive being made large. A non-uniformly stretched
 * viewBox cannot carry text (it would stretch too, which is why every label
 * in that component lives in absolutely-positioned HTML outside the SVG), it
 * cannot carry a circle, and a 1px stroke in viewBox units lands on a
 * fractional device pixel and renders as a grey smear. Blown up to 1,050
 * pixels the result reads as a placeholder: one hairline, no grid, 9px type.
 *
 * So this measures its own box and draws in PIXELS. Everything that follows —
 * crisp gridlines on half-pixel offsets, real axis typography, a crosshair
 * that can carry a readout, labelled price levels, event markers, drag to
 * zoom — is downstream of that single decision.
 *
 * Pure by construction: no data fetching, no Supabase, no app context. It
 * takes a series and draws it, which is what keeps it reachable from the
 * fixture gallery.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'

// ── Inputs ─────────────────────────────────────────────────────────────

export interface PricePoint {
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  close: number
}

/**
 * A price worth drawing a line at: a target, a scenario, an entry cost.
 *
 * `kind` decides the treatment, not the label — a target is the claim the
 * desk is accountable for and is drawn in the accent; a scenario is one of
 * several and is drawn quiet; a cost basis is a fact about the book.
 */
export interface PriceLevel {
  label: string
  price: number
  kind: 'target' | 'case' | 'cost'
}

/** Something dated that happened to the investment, drawn on the line. */
export interface PriceEvent {
  date: string
  label: string
  kind?: 'case' | 'research' | 'idea'
}

export type RangeKey = '5D' | '1M' | '3M' | '6M' | '1Y' | 'ALL'

const RANGE_DAYS: Record<RangeKey, number> = {
  '5D': 7, '1M': 31, '3M': 93, '6M': 186, '1Y': 366, ALL: Number.MAX_SAFE_INTEGER,
}
const RANGE_ORDER: RangeKey[] = ['5D', '1M', '3M', '6M', '1Y', 'ALL']

// ── Geometry ───────────────────────────────────────────────────────────

/**
 * Room for the axes.
 *
 * The price axis is on the RIGHT, where a finance reader looks for it: the
 * last price is the right-hand end of the line, and putting the scale beside
 * it means the eye does not travel the width of the chart to read the level
 * it is already looking at.
 */
const PAD = { top: 10, right: 62, bottom: 22, left: 8 }

/**
 * The flattest this chart will let itself be drawn.
 *
 * A price chart is a wide object, but past about 4:1 the vertical resolution
 * runs out and a real move stops looking like one: the List inspector handed
 * this component a 1,439 × 230 box — better than 6:1 — and a 6% range over
 * three months came out as a jagged horizontal ribbon that reads as noise.
 *
 * Beyond the cap the plot keeps its height and stops taking width, centred in
 * the box. Empty gutters on an unusually wide panel are a smaller lie than a
 * trend drawn flat.
 */
const MAX_ASPECT = 4

/** Half-pixel offsets make a 1px line land on one device pixel, not two. */
const crisp = (n: number) => Math.round(n) + 0.5

/**
 * Axis steps a human would have chosen.
 *
 * `(max - min) / 5` gives steps like 23.4, which produces an axis nobody can
 * read against. This walks 1/2/2.5/5/10 within the right power of ten, which
 * is the standard construction and the reason real charts tick at round
 * numbers.
 */
function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 2.25 ? 2.5 : norm >= 1.5 ? 2 : 1) * mag
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    out.push(Number(v.toFixed(10)))
  }
  return out
}

const fmtPrice = (n: number) =>
  n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : n >= 100 ? n.toFixed(0)
      : n >= 1 ? n.toFixed(2)
        : n.toFixed(3)

const fmtPricePrecise = (n: number) =>
  n >= 1000 ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(2)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Parsed as UTC noon: a bare `YYYY-MM-DD` is UTC midnight, which is the day
 *  before in every timezone west of Greenwich. */
const parseDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)

function fmtDate(iso: string, withYear: boolean) {
  const d = new Date(parseDay(iso))
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  return withYear ? `${base}, ${d.getUTCFullYear()}` : base
}

// ── Component ──────────────────────────────────────────────────────────

export interface PriceChartProps {
  symbol?: string
  series: PricePoint[]
  levels?: PriceLevel[]
  events?: PriceEvent[]
  initialRange?: RangeKey
  /**
   * The live price, when the caller has one better than the last close.
   *
   * The readout defaults to the last point of the drawn window, which is the
   * right answer for a chart on its own and the wrong one beside a row that
   * is showing a live quote: the List inspector read 1,149.85 under a row
   * reading 1169.60 for the same name. Pass it and the headline figure and
   * the window's change are stated against the price the rest of the surface
   * is using. Scrubbing still reports the point under the cursor.
   */
  spot?: number | null
  /** Reported whenever the reader changes the window. */
  onRangeChange?: (range: RangeKey) => void
  /** Rendered beside the range chips — an expand control, usually. */
  action?: React.ReactNode
  className?: string
}

export function PriceChart({
  symbol, series, levels = [], events = [], initialRange = '3M', spot, onRangeChange, action, className,
}: PriceChartProps) {
  // ── The window ───────────────────────────────────────────────────────

  /*
   * Only offer a range the data can fill.
   *
   * A `1Y` chip over nine months of history draws nine months and lies about
   * it. `ALL` is always offered once there is anything at all.
   */
  const spanDays = useMemo(() => {
    if (series.length < 2) return 0
    return (parseDay(series[series.length - 1].date) - parseDay(series[0].date)) / 86_400_000
  }, [series])

  const ranges = useMemo(
    () => RANGE_ORDER.filter(r => r === 'ALL' || RANGE_DAYS[r] <= spanDays + 1),
    [spanDays],
  )

  const [range, setRange] = useState<RangeKey>(initialRange)
  const effectiveRange = ranges.includes(range) ? range : (ranges[ranges.length - 1] ?? 'ALL')

  /** A drag-selected window, which overrides the range chips until reset. */
  const [zoom, setZoom] = useState<{ from: number; to: number } | null>(null)

  const windowed = useMemo(() => {
    if (series.length < 2) return series
    if (zoom) return series.slice(zoom.from, zoom.to + 1)
    if (effectiveRange === 'ALL') return series
    const last = parseDay(series[series.length - 1].date)
    const floor = last - RANGE_DAYS[effectiveRange] * 86_400_000
    const out = series.filter(p => parseDay(p.date) >= floor)
    return out.length >= 2 ? out : series.slice(-2)
  }, [series, effectiveRange, zoom])

  const pickRange = useCallback((r: RangeKey) => {
    setZoom(null)
    setRange(r)
    onRangeChange?.(r)
  }, [onRangeChange])

  // ── The box ──────────────────────────────────────────────────────────

  /*
   * Measured through a CALLBACK ref, not an effect over a ref object.
   *
   * Drawing in pixels means the component cannot render until it knows how
   * many it has, so the measurement has to be wired to the element's actual
   * lifetime. `useLayoutEffect(..., [])` is not: it runs once, and on the
   * render where the series has not arrived this component returns its empty
   * state, so `boxRef.current` is null, the effect bails, and the observer is
   * never attached for the life of the chart. The plot then keeps whatever
   * height the very first layout happened to give it — 71px against a 231px
   * box, which is a chart drawn into the top third of its own container.
   *
   * This is the same defect, in the same shape, as the one that pinned
   * `tableVisibleWidth` to zero in `AssetTableView`. A callback ref fires on
   * attach AND detach, so the observer exists exactly when the element does.
   *
   * The fallbacks below matter for jsdom, where there is no layout and every
   * rect is zero.
   */
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    boxRef.current = el
    setBoxEl(el)
  }, [])
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    if (!boxEl) { setBox({ w: 0, h: 0 }); return }
    const read = () => {
      const r = boxEl.getBoundingClientRect()
      setBox(prev => (Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5)
        ? prev
        : { w: r.width, h: r.height })
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(boxEl)
    return () => ro.disconnect()
  }, [boxEl])

  const H = box.h || 200
  // Width is what the box offers, up to the point where the plot would go
  // flatter than `MAX_ASPECT`. See the constant.
  const W = Math.min(box.w || 720, H * MAX_ASPECT)
  /** Half the width the cap gave back, so the plot sits centred in its box. */
  const gutter = Math.max(0, ((box.w || 720) - W) / 2)
  const plotW = Math.max(1, W - PAD.left - PAD.right)
  const plotH = Math.max(1, H - PAD.top - PAD.bottom)

  // ── The scales ───────────────────────────────────────────────────────

  const scale = useMemo(() => {
    const closes = windowed.map(p => p.close)
    if (!closes.length) return null

    /*
     * Levels stretch the scale only when they are CLOSE to the data.
     *
     * A target 40% above the last price would flatten the price line into a
     * band at the bottom of the chart to make room for a dashed rule. So a
     * level inside a reasonable margin of the price range expands the scale,
     * and one outside it is pinned to the edge and drawn dotted — present,
     * honest about being off-scale, and not destroying the plot.
     */
    let lo = Math.min(...closes)
    let hi = Math.max(...closes)
    const dataSpan = hi - lo || Math.abs(hi) * 0.02 || 1
    for (const l of levels) {
      if (l.price >= lo - dataSpan * 0.6 && l.price <= hi + dataSpan * 0.6) {
        lo = Math.min(lo, l.price)
        hi = Math.max(hi, l.price)
      }
    }
    // Breathing room, so the line never touches the frame.
    const pad = (hi - lo || Math.abs(hi) * 0.02 || 1) * 0.08
    lo -= pad
    hi += pad

    const x = (i: number) => PAD.left + (windowed.length === 1 ? plotW / 2 : (i / (windowed.length - 1)) * plotW)
    const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH
    return { lo, hi, x, y }
  }, [windowed, levels, plotW, plotH])

  // ── Paths ────────────────────────────────────────────────────────────

  const geometry = useMemo(() => {
    if (!scale || windowed.length < 2) return null
    const pts = windowed.map((p, i) => [scale.x(i), scale.y(p.close)] as const)
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('')
    const base = PAD.top + plotH
    const area = `${line}L${pts[pts.length - 1][0].toFixed(2)},${base}L${pts[0][0].toFixed(2)},${base}Z`
    return { pts, line, area, base }
  }, [scale, windowed, plotH])

  const change = windowed.length > 1 && windowed[0].close
    ? ((windowed[windowed.length - 1].close - windowed[0].close) / windowed[0].close) * 100
    : 0
  const up = change >= 0

  // ── Crosshair ────────────────────────────────────────────────────────

  /*
   * One index, not a pixel position.
   *
   * Snapping the crosshair to the nearest data point is what makes the
   * readout honest: a chart that reports an interpolated price for a day the
   * market was shut is inventing a quote.
   */
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)

  const indexAt = useCallback((clientX: number) => {
    const el = boxRef.current
    if (!el || windowed.length < 2) return null
    const r = el.getBoundingClientRect()
    // `gutter`, because the plot is centred when the aspect cap gives width
    // back: without it the crosshair lands half a gutter from the pointer.
    const t = (clientX - r.left - gutter - PAD.left) / plotW
    return Math.max(0, Math.min(windowed.length - 1, Math.round(t * (windowed.length - 1))))
  }, [plotW, gutter, windowed.length])

  const onMove = useCallback((e: React.PointerEvent) => {
    const i = indexAt(e.clientX)
    setHover(i)
    setDrag(d => (d ? { ...d, to: i ?? d.to } : null))
  }, [indexAt])

  const onDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const i = indexAt(e.clientX)
    if (i == null) return
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* unsupported */ }
    setDrag({ from: i, to: i })
  }, [indexAt])

  const onUp = useCallback(() => {
    setDrag(d => {
      // A click, not a drag. Four points is the floor for a readable window.
      if (d && Math.abs(d.to - d.from) >= 3) {
        const lo = Math.min(d.from, d.to)
        const hi = Math.max(d.from, d.to)
        // Offsets into `windowed`, rebased onto `series` so a second zoom
        // composes with the first instead of reinterpreting its indices.
        const base = series.indexOf(windowed[0])
        if (base >= 0) setZoom({ from: base + lo, to: base + hi })
      }
      return null
    })
  }, [series, windowed])

  /** Keyboard scrub, so the readout is not mouse-only. */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (windowed.length < 2) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      setHover(h => {
        const cur = h ?? windowed.length - 1
        return Math.max(0, Math.min(windowed.length - 1, cur + (e.key === 'ArrowRight' ? step : -step)))
      })
    } else if (e.key === 'Escape') {
      setHover(null)
      setZoom(null)
    }
  }, [windowed.length])

  const cursor = hover != null && windowed[hover] ? windowed[hover] : null
  const readout = cursor ?? windowed[windowed.length - 1] ?? null

  /*
   * What the headline figure states, and what date it belongs to.
   *
   * Scrubbing always wins — the reader is pointing at a day and wants that
   * day. Otherwise a caller-supplied `spot` wins over the last close, so the
   * figure agrees with whatever is quoting the price around this chart. When
   * it does, the date line says `live` rather than the last close's date: the
   * spot is not a reading from that day and labelling it with that day's date
   * would be the quieter version of the same lie.
   */
  const liveSpot = !cursor && spot != null && Number.isFinite(spot) && spot > 0 ? spot : null
  const readoutPrice = cursor ? cursor.close : (liveSpot ?? readout?.close ?? null)
  const readoutChange = readoutPrice != null && windowed.length > 1 && windowed[0].close
    ? ((readoutPrice - windowed[0].close) / windowed[0].close) * 100
    : null

  // ── Ticks ────────────────────────────────────────────────────────────

  const yTicks = useMemo(
    () => (scale ? niceTicks(scale.lo, scale.hi, Math.max(2, Math.floor(plotH / 56))) : []),
    [scale, plotH],
  )

  const xTicks = useMemo(() => {
    if (!scale || windowed.length < 2) return []
    const want = Math.max(2, Math.min(7, Math.floor(plotW / 110)))
    const withYear = spanDays > 300
    const step = (windowed.length - 1) / want
    const out: Array<{ x: number; label: string }> = []
    for (let k = 0; k <= want; k++) {
      const i = Math.round(k * step)
      out.push({ x: scale.x(i), label: fmtDate(windowed[i].date, withYear) })
    }
    return out
  }, [scale, windowed, plotW, spanDays])

  // ── Levels and events, placed ────────────────────────────────────────

  const placedLevels = useMemo(() => {
    if (!scale) return []
    return levels.map(l => {
      const off = l.price < scale.lo || l.price > scale.hi
      return {
        ...l,
        off,
        y: off ? (l.price > scale.hi ? PAD.top + 1 : PAD.top + plotH - 1) : scale.y(l.price),
      }
    })
  }, [levels, scale, plotH])

  const placedEvents = useMemo(() => {
    if (!scale || windowed.length < 2) return []
    const first = parseDay(windowed[0].date)
    const last = parseDay(windowed[windowed.length - 1].date)
    const out: Array<{ x: number; y: number; label: string; kind: string }> = []
    for (const ev of events) {
      const t = parseDay(ev.date)
      if (t < first || t > last) continue
      // Nearest close to that date: events do not land on trading days.
      let best = 0
      let bestGap = Infinity
      for (let i = 0; i < windowed.length; i++) {
        const gap = Math.abs(parseDay(windowed[i].date) - t)
        if (gap < bestGap) { bestGap = gap; best = i }
      }
      out.push({ x: scale.x(best), y: scale.y(windowed[best].close), label: ev.label, kind: ev.kind ?? 'case' })
    }
    return out
  }, [events, scale, windowed])

  const gradientId = useMemo(() => `pc-grad-${Math.random().toString(36).slice(2, 9)}`, [])

  // Clear the crosshair when the window changes under it.
  useEffect(() => { setHover(null) }, [effectiveRange, zoom])

  // ── Render ───────────────────────────────────────────────────────────

  if (series.length < 2) {
    return (
      <div className={clsx('flex h-full min-h-[120px] flex-col justify-center', className)}
        data-testid="price-chart-empty">
        <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">No price history</p>
        <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
          Nothing on file for {symbol || 'this security'}.
        </p>
      </div>
    )
  }

  const stroke = up ? 'rgb(5 150 105)' : 'rgb(225 29 72)'
  const dragLo = drag ? Math.min(drag.from, drag.to) : null
  const dragHi = drag ? Math.max(drag.from, drag.to) : null

  return (
    <div className={clsx('flex h-full min-h-0 flex-col', className)} data-testid="price-chart">

      {/* ── Readout and controls ──────────────────────────────────────
          One line, above the plot, because it IS the plot's label: the
          price under the crosshair and the date it belongs to. It does not
          compete with the chart for height the way a figure row does — it
          is the chart telling you what you are pointing at. */}
      <div className="flex shrink-0 items-baseline gap-2.5 pb-1.5">
        <span className="text-[19px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-gray-900 dark:text-white"
          data-testid="price-chart-readout">
          {readoutPrice != null ? fmtPricePrecise(readoutPrice) : '—'}
        </span>
        {readoutChange != null && (
          <span className={clsx('text-[12.5px] font-semibold tabular-nums leading-none',
            readoutChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
            {readoutChange >= 0 ? '+' : ''}{readoutChange.toFixed(2)}%
            {/* The window the move is measured over, attached to the move.
                A bare percentage beside a chart whose range chips can be
                changed is a number with no period — and this panel used to
                show three of them, over three different windows, none of
                them saying so. */}
            <span className="ml-1 font-medium text-gray-400 dark:text-gray-500">
              {zoom ? 'selection' : effectiveRange}
            </span>
          </span>
        )}
        <span className="text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
          {liveSpot != null ? 'live' : readout ? fmtDate(readout.date, true) : ''}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-0.5" data-testid="price-chart-ranges">
          {zoom && (
            <button
              type="button"
              onClick={() => setZoom(null)}
              className="mr-1 rounded px-1.5 py-[3px] text-[10.5px] font-semibold text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-950"
            >
              Reset zoom
            </button>
          )}
          {ranges.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => pickRange(r)}
              aria-pressed={!zoom && r === effectiveRange}
              className={clsx(
                'rounded px-1.5 py-[3px] text-[10.5px] font-semibold tabular-nums transition-colors',
                !zoom && r === effectiveRange
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200',
              )}
            >
              {r}
            </button>
          ))}
          {action}
        </div>
      </div>

      {/* ── The plot ──────────────────────────────────────────────────── */}
      <div
        ref={attachBox}
        className="relative min-h-0 flex-1 cursor-crosshair select-none focus:outline-none"
        tabIndex={0}
        role="img"
        aria-label={`Price history for ${symbol || 'this security'}, ${effectiveRange}`}
        onPointerMove={onMove}
        onPointerLeave={() => { setHover(null); setDrag(null) }}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onKeyDown={onKeyDown}
        style={{ touchAction: 'pan-y' }}
      >
        <svg width={W} height={H} className="mx-auto block overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Gridlines. One weight, one colour, behind everything — a grid
              that competes with the data is a grid that should not be
              drawn. The price axis sits in the right gutter. */}
          {scale && yTicks.map(t => (
            <g key={`y${t}`}>
              <line
                x1={PAD.left} x2={PAD.left + plotW}
                y1={crisp(scale.y(t))} y2={crisp(scale.y(t))}
                strokeWidth={1}
                className="stroke-gray-900/[0.07] dark:stroke-white/[0.08]"
              />
              <text
                x={W - PAD.right + 8} y={scale.y(t) + 3.5}
                className="fill-gray-400 text-[10.5px] tabular-nums dark:fill-gray-500"
              >
                {fmtPrice(t)}
              </text>
            </g>
          ))}

          {/* Date axis. */}
          {xTicks.map((t, i) => (
            <text
              key={`x${i}`}
              x={t.x} y={H - 6}
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
              className="fill-gray-400 text-[10.5px] tabular-nums dark:fill-gray-500"
            >
              {t.label}
            </text>
          ))}

          {/* The selection being dragged. */}
          {scale && dragLo != null && dragHi != null && dragHi > dragLo && (
            <rect
              x={scale.x(dragLo)} y={PAD.top}
              width={Math.max(1, scale.x(dragHi) - scale.x(dragLo))} height={plotH}
              className="fill-primary-500/[0.12]"
              data-testid="price-chart-selection"
            />
          )}

          {/* The price itself. */}
          {geometry && (
            <>
              <path d={geometry.area} fill={`url(#${gradientId})`} data-testid="price-chart-area" />
              <path
                d={geometry.line}
                fill="none"
                stroke={stroke}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                data-testid="price-chart-line"
              />
            </>
          )}

          {/* Levels: target, scenarios, cost. Labelled in the right gutter
              against a chip, because a dashed rule with a number floating
              over the plot is unreadable where the line crosses it. */}
          {scale && placedLevels.map(l => (
            <g key={`${l.label}:${l.price}`} data-testid="price-chart-level">
              <line
                x1={PAD.left} x2={PAD.left + plotW}
                y1={crisp(l.y)} y2={crisp(l.y)}
                strokeWidth={l.off ? 1 : 1.25}
                strokeDasharray={l.off ? '2 3' : '5 4'}
                className={l.kind === 'target'
                  ? 'stroke-primary-500'
                  : l.kind === 'cost' ? 'stroke-amber-500/70' : 'stroke-gray-400/80 dark:stroke-gray-500/80'}
              />
              <text
                x={PAD.left + 4} y={l.y - 5}
                className={clsx(
                  'text-[10px] font-semibold',
                  l.kind === 'target' ? 'fill-primary-600 dark:fill-primary-400' : 'fill-gray-400 dark:fill-gray-500',
                )}
              >
                {l.label}{l.off ? ' (off scale)' : ''} {fmtPrice(l.price)}
              </text>
            </g>
          ))}

          {/* Events, on the line where they happened. */}
          {placedEvents.map((ev, i) => (
            <g key={`ev${i}`} data-testid="price-chart-event">
              <title>{`${ev.label}`}</title>
              <circle cx={ev.x} cy={ev.y} r={4.5} className="fill-white dark:fill-gray-900" />
              <circle
                cx={ev.x} cy={ev.y} r={3.25}
                strokeWidth={1.5}
                className={ev.kind === 'idea'
                  ? 'fill-amber-400 stroke-white dark:stroke-gray-900'
                  : 'fill-gray-400 stroke-white dark:stroke-gray-900'}
              />
            </g>
          ))}

          {/* The crosshair and its anchor. */}
          {scale && cursor && (
            <g data-testid="price-chart-crosshair" pointerEvents="none">
              <line
                x1={crisp(scale.x(hover!))} x2={crisp(scale.x(hover!))}
                y1={PAD.top} y2={PAD.top + plotH}
                strokeWidth={1} strokeDasharray="3 3"
                className="stroke-gray-500/70"
              />
              <line
                x1={PAD.left} x2={PAD.left + plotW}
                y1={crisp(scale.y(cursor.close))} y2={crisp(scale.y(cursor.close))}
                strokeWidth={1} strokeDasharray="3 3"
                className="stroke-gray-500/40"
              />
              <circle cx={scale.x(hover!)} cy={scale.y(cursor.close)} r={3.5}
                fill={stroke} className="stroke-white dark:stroke-gray-900" strokeWidth={1.5} />
              {/* The price chip in the gutter, so the scale reads the cursor
                  rather than the reader interpolating between gridlines. */}
              <rect
                x={W - PAD.right + 3} y={scale.y(cursor.close) - 8}
                width={PAD.right - 6} height={16} rx={3}
                className="fill-gray-900 dark:fill-white"
              />
              <text
                x={W - PAD.right + 8} y={scale.y(cursor.close) + 3.5}
                className="fill-white text-[10.5px] font-semibold tabular-nums dark:fill-gray-900"
              >
                {fmtPrice(cursor.close)}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
