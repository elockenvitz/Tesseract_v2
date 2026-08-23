/**
 * A price path, and nothing else.
 *
 * ── Why this is not `PriceContext` ────────────────────────────────────────
 *
 * `PriceContext` is the interactive chart: ranges, axes, gridlines, bands,
 * markers, and a press-and-hold scrub with pointer capture and axis-locked
 * gesture arbitration. All of that is right for a Curate card, which is one
 * viewport carrying one decision.
 *
 * It is wrong for a mosaic cell. Twenty of them would be twenty interactive
 * components mounting twenty pointer-capture regions, each competing with the
 * grid for the horizontal drag the reader is using to do nothing at all — they
 * are scrolling past. So this has no pointer handlers, no state and no effects:
 * it is a `<path>` with a viewBox, and the interactive version is one tap away
 * on the surface the tile opens.
 *
 * ── Scaled to its own window ──────────────────────────────────────────────
 *
 * Colour comes from the change across the points DRAWN, not from the day's
 * move: tinting a month-long line by today would contradict the shape on
 * screen. Fewer than two points draws nothing rather than a flat line, because
 * a flat line is a claim about the price and one point is not.
 */

interface SparklineProps {
  /** Closes, oldest first. */
  points: number[]
  className?: string
}

/**
 * A taller box than a strip.
 *
 * It was 100x32 and read as a decoration rather than a chart — a month of
 * movement compressed into 32 units flattens everything but the extremes, so
 * every name looked like the same gentle slope. 48 gives the shape somewhere
 * to go, and the fill below it gives the eye a magnitude to read against.
 */
const W = 100
const H = 48

export function Sparkline({ points, className }: SparklineProps) {
  const clean = points.filter(p => Number.isFinite(p) && p > 0)
  if (clean.length < 2) return null

  const lo = Math.min(...clean)
  const hi = Math.max(...clean)
  const span = hi - lo || 1
  const up = clean[clean.length - 1] >= clean[0]

  /**
   * A gradient id per instance.
   *
   * Twenty tiles share a page, and a fixed id would make every one of them
   * reference the FIRST definition — so a falling name would fill with the
   * rising colour. Derived from the data rather than `useId` so this stays a
   * pure function with no hooks, which is what lets it render twenty times
   * without twenty effects.
   */
  const gid = `spark-${up ? 'u' : 'd'}-${clean.length}-${Math.round(lo * 100)}-${Math.round(hi * 100)}`

  const d = clean
    .map((c, i) => {
      const x = (i / (clean.length - 1)) * W
      // Inset a pixel top and bottom so the extremes are not clipped by the
      // stroke, which is what makes a high at the top of the window disappear.
      const y = H - 1 - ((c - lo) / span) * (H - 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      // No pointer handlers and none inherited: the mosaic owns every gesture
      // over a tile, and a chart that captures a drag here would be the Phase
      // 8.1 conflict rebuilt at a smaller scale.
      className={`pointer-events-none h-full w-full ${className ?? ''}`}
      data-testid="sparkline"
      aria-hidden
    >
      {/* The area under the line. A bare stroke on a 100x48 box is a squiggle;
          a filled one reads as a chart, which is what a tile is trying to say
          before anybody taps it. Fading to nothing at the bottom keeps it from
          becoming a solid block on a tile that is mostly text. */}
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${d} L${W},${H} L0,${H} Z`}
        fill={`url(#${gid})`}
        stroke="none"
        className={up ? 'text-emerald-500' : 'text-rose-500'}
      />
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        className={up ? 'text-emerald-500' : 'text-rose-500'}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
