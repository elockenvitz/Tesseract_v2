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

const W = 100
const H = 32

export function Sparkline({ points, className }: SparklineProps) {
  const clean = points.filter(p => Number.isFinite(p) && p > 0)
  if (clean.length < 2) return null

  const lo = Math.min(...clean)
  const hi = Math.max(...clean)
  const span = hi - lo || 1
  const up = clean[clean.length - 1] >= clean[0]

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
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        className={up ? 'text-emerald-500' : 'text-rose-500'}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
