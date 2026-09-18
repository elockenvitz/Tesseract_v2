/**
 * The price chart a desktop tile draws. One of them, for every lens.
 *
 * ── Why this is shared and not per-lens ──────────────────────────────────
 *
 * It began in Decisions as `PriceSinceFill`. Portfolio then needed a price on
 * its cards and got a 20-30px micro sparkline instead -- no axes, no horizon
 * control, no scrub -- which was unreadable, and read as a different, worse
 * product one tab away from the good one. Two price charts that differ for no
 * reason make the product feel like two products.
 *
 * So the real chart lives here, in the shared shell rather than in a lens, and
 * every lens passes its own anchor into it. Decisions anchors on the fill;
 * Portfolio has no single anchor and passes none; Research anchors on the date
 * the case was last written. The geometry, the ink, the axes, the ladder and
 * the scrub are identical in all three, because they are the same object.
 *
 * ── What it refuses to do ────────────────────────────────────────────────
 *
 * It will not claim a window it does not have. `anchoredWindow` reports
 * whether the series actually reaches the anchor, and where it does not the
 * caption says what WAS measured instead of naming a date the data never saw.
 * That rule exists because a full-history line once carried a "364d since
 * filled" caption about a fill from the previous day.
 *
 * It also invents nothing: fewer than two closes and it renders the caller's
 * `empty` node rather than a flat line through a made-up series.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { anchoredWindow } from '../../lib/market-data/anchored-window'
import { rangesFor, type RangeKey } from '../../lib/market-data/price-ranges'

/** One horizon chip. A real button, because the shelf's verbs are too. */
function RangeChip({ label, on, onPick }: { label: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={clsx(
        'rounded px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wide transition-colors',
        on
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
          : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10',
      )}
    >
      {label}
    </button>
  )
}

export function TilePriceChart({
  points, anchorISO = null, anchorLabel = 'fill', height = 132, fill = false,
  empty = null,
}: {
  points: { date: Date; value: number }[]
  /**
   * The date the window measures from, where the lens has one -- a fill, a
   * decision, the day a thesis was written. Null where it does not, and then
   * the chart offers the horizon ladder alone and makes no since-claim.
   */
  anchorISO?: string | null
  /**
   * A bare noun -- "fill", "decision", "review" -- because the component
   * builds sentences out of it: "Price since the fill", "Since fill" on the
   * chip. It was once given "Filled", which produced "Price since Filled".
   */
  anchorLabel?: string
  height?: number
  /**
   * Take whatever height the container gives, instead of a fixed `height`.
   *
   * A tile is two columns and the taller one sets the row's height. With a
   * fixed height the chart stopped short of the bottom and left dead space
   * below it -- worst on exactly the cards with least to say on the other
   * side, where the chart is the only thing worth looking at.
   *
   * In fill mode the plot measures its own box, so the chart reaches the
   * bottom of the tile whichever column is taller.
   */
  fill?: boolean
  /** Rendered when there is no drawable series at all. */
  empty?: React.ReactNode
}) {
  const [at, setAt] = useState<number | null>(null)

  /*
   * ── The viewBox matches the pixel box, so slopes are true ────────────────
   *
   * This drew into a fixed-width viewBox stretched to fit with
   * `preserveAspectRatio="none"`. On a hero tile that meant ~1000 user units
   * mapped onto ~350 physical pixels while the height mapped 1:1 -- x squashed
   * to a third, y untouched -- so every slope rendered about three times
   * steeper than the data. The line looked spiky and unlike the same series
   * drawn anywhere else, and it got worse the taller the tile.
   *
   * Measuring the box and sizing the viewBox to it makes the scale exactly 1
   * in both axes. Slopes are then geometrically true, dash patterns are the
   * lengths they say they are, and a stroke width means what it means.
   *
   * The fallback matters: `ResizeObserver` does not exist in jsdom and the
   * measured width is 0 before first paint, so an unmeasured chart draws at a
   * sane default rather than collapsing to nothing.
   */
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  /*
   * `useLayoutEffect`, not `useEffect`: it runs before the browser paints, so
   * the measured width is in place for the first frame the reader sees. With
   * `useEffect` the chart painted once at the fallback width and corrected
   * itself afterwards -- a visible flicker, and while the mismatch lasted the
   * drawing was scaled to fit rather than filling its box.
   *
   * SSR-safe by accident here (this only ever runs in the browser), but the
   * guard below keeps jsdom quiet where `ResizeObserver` does not exist.
   */
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      setBox(prev => {
        const w = Math.round(r.width)
        const h = Math.round(r.height)
        // Same numbers, same object: re-setting state every observer tick
        // would re-render the whole gallery on any layout change.
        return prev.w === w && prev.h === h ? prev : { w, h }
      })
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /*
   * ── The reader picks the horizon ─────────────────────────────────────────
   *
   * This had exactly one window: since the anchor, or -- where the closes
   * could not span it -- the whole stored history, captioned "Price over
   * available history". That caption was the only thing the reader could do
   * about it, and it reads as an apology for a missing control rather than as
   * a choice, because it was one.
   *
   * The ladder is shared with the mobile price chart through
   * `lib/market-data/price-ranges`, so 3M here selects the same 91 days there.
   */
  const history = points.map(p => ({ date: p.date.toISOString(), close: p.value }))

  /* The shared slicer, measuring the window in one place, which is what stops
     a caption and a line disagreeing. */
  const sinceWindow = anchoredWindow(history, anchorISO)
  const canSince = sinceWindow?.reachesAnchor === true

  const [range, setRange] = useState<RangeKey | 'since' | null>(null)
  /* Null means the reader has not chosen, which is a different fact from
     having chosen the default -- so the default can change with the data
     without overriding a choice. */
  const active: RangeKey | 'since' = range ?? (canSince ? 'since' : 'ALL')

  const spanDays = history.length >= 2
    ? Math.round((Date.parse(history[history.length - 1].date) - Date.parse(history[0].date)) / 86_400_000)
    : 0
  const offered = rangesFor(spanDays)

  const w = (() => {
    if (active === 'since' && sinceWindow) return sinceWindow
    const days = offered.find(r => r.key === active)?.days ?? null
    if (days == null) return anchoredWindow(history, null)
    const cutoff = Date.now() - days * 86_400_000
    const sliced = history.filter(p => Date.parse(p.date) >= cutoff)
    // Too short to draw is not an empty chart -- fall back to everything held
    // rather than blanking the panel because a chip was optimistic.
    return anchoredWindow(sliced.length >= 2 ? sliced : history, null)
  })()
  if (!w) return <>{empty}</>

  /*
   * ── The viewBox is wide, and the stroke does not scale ───────────────────
   *
   * Two artifacts made the line look wrong, both worse the wider the tile:
   *
   * 1. QUANTISATION. The box was 340 units across and x was rounded to one
   *    decimal. With ~270 closes the spacing is ~1.25 units, so rounding moved
   *    each point by up to 4% of a step -- on a hero tile 900px wide that is
   *    several pixels of jitter, and a smooth series rendered as a shaky one.
   *    1000 units with two decimals puts the rounding error far below a pixel
   *    at any width a tile can reach.
   *
   * 2. STROKE DISTORTION. `preserveAspectRatio="none"` stretches x and y by
   *    different factors, and a stroke width in USER units is stretched with
   *    them -- so a vertical segment rendered thick and a horizontal one thin,
   *    and the line appeared to change weight along its own path. On a hero
   *    tile, where x is stretched ~2.6x and y not at all, that is the dominant
   *    defect. `vector-effect="non-scaling-stroke"` applies the width in
   *    screen space instead, so it is even everywhere and the round joins
   *    render as round.
   */
  const W = box.w > 0 ? box.w : 640
  /* In fill mode the measured box IS the height. The floor matters: before the
     first measurement the box reports 0, and a chart with no height is a chart
     nobody can see. */
  const H = fill ? Math.max(56, box.h > 0 ? box.h : height) : height
  const min = Math.min(...w.series)
  const max = Math.max(...w.series)
  const span = (max - min) || 1
  /* Inset by the stroke's half-width, so the first and last points keep their
     full thickness instead of losing half of it to the clip at the frame. */
  const padX = 1
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, w.series.length - 1)
  /* Padding in the same proportion the old 132px chart used, so the line
     keeps its breathing room instead of touching the frame at 200px. */
  const padTop = Math.max(3, H * 0.03)
  const padBottom = Math.max(4, H * 0.045)
  const y = (v: number) => padTop + (H - padTop - padBottom) * (1 - (v - min) / span)
  const d = w.series.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' L')

  /*
   * Coloured by direction, at the product owner's call.
   *
   * One neutral ink was the original rule -- a red line reads as "bad
   * decision" when post-decision drift is evidence, not a verdict. That
   * argument holds for the DECISION and not for the price: up and down are
   * facts about the line, a desk reads them instantly, and the grey chart was
   * read as "no signal" rather than as neutrality.
   *
   * The percentage keeps its sign and the hue says only which way it went.
   */
  const up = w.changePct >= 0
  const stroke = up ? 'stroke-emerald-600 dark:stroke-emerald-400' : 'stroke-rose-600 dark:stroke-rose-400'
  /* `areaInk`, not `fill`: the prop of that name is the layout mode, and two
     different meanings on one identifier is how the wrong one gets read. */
  const areaInk = up ? 'fill-emerald-500' : 'fill-rose-500'
  /* The end marker is a `bg-` class, not `fill-`: it is an HTML element, so it
     stays a circle under the SVG's non-uniform scaling. */
  const dot = up ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-rose-600 dark:bg-rose-400'
  const pctInk = up ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'

  const cursor = at == null ? null : Math.max(0, Math.min(w.series.length - 1, at))
  const readoutPct = cursor == null
    ? w.changePct
    : ((w.series[cursor] - w.series[0]) / w.series[0]) * 100

  /*
   * ── Why the axes are HTML and the plot is SVG ────────────────────────────
   *
   * `preserveAspectRatio="none"` is what lets a 340-unit viewBox fill whatever
   * width the tile gives it, and it is right for the line -- but it scales x
   * and y by different factors, so anything inside the SVG meant to be round
   * or upright is not. The end dot was a `<circle>` and rendered as a
   * flattened ellipse; the anchor's `<text>` was stretched with it.
   *
   * So the SVG draws only what tolerates non-uniform scaling -- area, line,
   * straight gridlines -- and every label, the dot and the readout are HTML
   * positioned over it in percentages.
   */
  const pctFromTop = (v: number) => (y(v) / H) * 100
  const last = w.series[w.series.length - 1]
  const mid = (min + max) / 2
  /* Enough figures to tell two closes apart without spending width: a
     four-digit price does not need cents on an axis, a penny stock does. */
  const axisPrice = (v: number) =>
    v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)
  const axisDate = (iso: string) => {
    const t = new Date(iso)
    return Number.isNaN(t.getTime())
      ? ''
      : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return (
    <div
      data-testid="price-since-fill"
      data-reaches={w.reachesAnchor ? 'true' : 'false'}
      /* In fill mode the caption and chips keep their natural height and the
         plot row takes the rest, so the chart ends flush with the tile. */
      className={fill ? 'flex h-full min-h-0 flex-col' : undefined}
    >
      {/*
        ── The caption is a footer, not a heading ───────────────────────────

        It sat above the chart, which put a label where the reader's eye lands
        first and pushed the thing being labelled down. A chart does not need
        introducing: it is recognisably a chart, and what it is OF is the
        ticker already at the top of the tile.

        So it reads bottom-right, under the plot, next to the percentage --
        the position a chart's attribution normally takes, and it gives the
        plot the top of its own block.

        No day count beside it either: it read "395d" next to a chip row that
        already names the window, restating the reader's own selection in a
        unit they did not pick.
      */}

      {/*
        The horizon chips.

        `data-no-portal` so pressing one does not open the record -- the tile
        shell treats an unhandled click as "open this", and a control inside it
        has to say it is a control. Buttons, not a segmented div, because they
        are reached by keyboard like everything else on the shelf.
      */}
      <div
        data-testid="price-ranges"
        data-range={active}
        data-no-portal
        className="mb-1 flex flex-wrap gap-1"
      >
        {canSince && (
          <RangeChip
            label={`Since ${anchorLabel}`}
            on={active === 'since'}
            onPick={() => setRange('since')}
          />
        )}
        {offered.map(r => (
          <RangeChip
            key={r.key}
            label={r.key}
            on={active === r.key}
            onPick={() => setRange(r.key)}
          />
        ))}
      </div>

      <div
        data-testid="price-axes"
        className={clsx('flex gap-1.5', fill && 'min-h-0 flex-1')}
      >
        {/* ── Price axis ── high, midpoint, low: the three values that make the
            line's amplitude readable. Without them the shape was there but the
            magnitude was unknowable. */}
        <div
          className="flex shrink-0 flex-col justify-between text-right font-mono text-[8px] leading-none text-gray-400 dark:text-gray-500"
          style={{ height: H }}
          aria-hidden
        >
          <span>{axisPrice(max)}</span>
          <span>{axisPrice(mid)}</span>
          <span>{axisPrice(min)}</span>
        </div>

        {/*
          The plot column: the measured box is the PLOT only, not the plot plus
          the date axis beneath it. Measuring both would feed the axis's own
          height back into the chart's, and the line would creep down by ten
          pixels every resize.
        */}
        <div className={clsx('flex min-w-0 flex-1 flex-col', fill && 'min-h-0')}>
        <div ref={boxRef} className={clsx('relative min-w-0', fill && 'min-h-0 flex-1')}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            /*
              ── `none` is the safety net, not the mechanism ─────────────────

              The slopes are true because the viewBox IS the measured pixel box
              -- that is what fixed the 3x vertical exaggeration, and when the
              two match, `none` and the default behave identically.

              They do not always match. Before the first measurement `W` is the
              fallback, and with the DEFAULT `xMidYMid meet` a 640-unit box
              inside a 300px element scales the entire drawing to 47% and
              centres it: a narrow chart floating in empty space, on whichever
              tiles happen to measure a frame late. Stretching to fill is a far
              better wrong answer than shrinking to the middle, and it lasts
              one frame.
            */
            preserveAspectRatio="none"
            className="w-full cursor-crosshair"
            style={{ height: H, display: 'block' }}
            role="img"
            aria-label={`Price ${axisPrice(w.series[0])} to ${axisPrice(last)}, ${w.changePct.toFixed(1)} percent, ${axisDate(w.from)} to ${axisDate(w.to)}`}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              if (r.width <= 0) return
              setAt(Math.round(((e.clientX - r.left) / r.width) * (w.series.length - 1)))
            }}
            onPointerLeave={() => setAt(null)}
          >
            {/* Gridlines at the three labelled prices, so a label points at
                something rather than floating beside the plot. */}
            {/* Gridlines at the three labelled prices, so a label points at
                something rather than floating beside the plot. Every stroke
                in here carries `non-scaling-stroke`: without it the dash
                patterns stretch with x and the hairlines render at different
                weights depending on their direction. */}
            {[max, mid, min].map((v, i) => (
              <line
                key={i}
                x1={0} y1={y(v)} x2={W} y2={y(v)}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="stroke-gray-200 dark:stroke-white/10"
                {...(i === 1 ? { strokeDasharray: '3 4' } : {})}
              />
            ))}
            <path d={`M${d} L${W - padX},${H} L${padX},${H} Z`}
                  className={clsx(areaInk, 'opacity-[0.13]')} />
            <path
              d={`M${d}`}
              fill="none"
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className={stroke}
            />
            {w.reachesAnchor && (
              /* Half a pixel in, so a 1px stroke sits inside the box instead
                 of losing half its width to the clip at x=0. */
              <line x1={0.5} y1={0} x2={0.5} y2={H} strokeWidth={1} strokeDasharray="2 3"
                    vectorEffect="non-scaling-stroke"
                    className="stroke-gray-400 dark:stroke-gray-600" />
            )}
            {cursor != null && (
              <line x1={x(cursor)} y1={0} x2={x(cursor)} y2={H} strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    className="stroke-gray-400 opacity-60 dark:stroke-gray-500" />
            )}
          </svg>

          {/* The anchor's name, upright. */}
          {w.reachesAnchor && (
            <span className="pointer-events-none absolute left-[3px] top-0 font-mono text-[8px] uppercase tracking-[.05em] text-gray-500">
              {anchorLabel}
            </span>
          )}

          {/* Round, because it is HTML. */}
          <span
            className={clsx(
              'pointer-events-none absolute h-[7px] w-[7px] rounded-full ring-2 ring-white dark:ring-gray-900',
              dot,
            )}
            style={{ top: `${pctFromTop(last)}%`, right: padX, transform: 'translate(50%, -50%)' }}
            aria-hidden
          />

          {/* Cursor value, following the scrub. */}
          {cursor != null && (
            <span
              data-testid="price-cursor-readout"
              className="pointer-events-none absolute -translate-y-1/2 rounded bg-gray-900/90 px-1 py-px font-mono text-[9px] text-white dark:bg-white/90 dark:text-gray-900"
              style={{
                top: `${pctFromTop(w.series[cursor])}%`,
                left: `${(x(cursor) / W) * 100}%`,
                transform: `translate(${cursor > w.series.length / 2 ? '-110%' : '10%'}, -50%)`,
              }}
            >
              {axisPrice(w.series[cursor])}
            </span>
          )}

        </div>

          {/* ── Date axis ── the window's real bounds, under the plot they
              describe, and OUTSIDE the measured box so its height is not fed
              back into the plot's. A day count says how long; never when. */}
          <div
            className="mt-0.5 shrink-0 flex justify-between font-mono text-[8px] leading-none text-gray-400 dark:text-gray-500"
            aria-hidden
          >
            <span>{axisDate(w.from)}</span>
            <span>{axisDate(w.to)}</span>
          </div>
        </div>
      </div>

      {/* The move on the left, what this is on the right. The sign is a fact
          and stays; the colour says only direction. */}
      <div className="mt-1 flex items-baseline gap-2">
        <div className={clsx('font-mono text-[18px] font-semibold tabular-nums', pctInk)}>
          {readoutPct >= 0 ? '+' : ''}{readoutPct.toFixed(1)}%
          {cursor != null && (
            <span className="ml-1.5 text-[10px] font-normal text-gray-500">
              {w.series[cursor].toFixed(2)}
            </span>
          )}
        </div>
        <span
          data-testid="price-caption"
          className="ml-auto min-w-0 truncate text-[9px] font-semibold uppercase tracking-widest text-gray-400"
        >
          {active === 'since' && w.reachesAnchor
            ? `Price since the ${anchorLabel}`
            : active === 'ALL' ? 'Price chart'
              : `Price, last ${active}`}
        </span>
      </div>
    </div>
  )
}
