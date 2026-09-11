import { useCallback, useRef, useState } from 'react'
import { clsx } from 'clsx'

/**
 * The desktop feed's price preview.
 *
 * ── Why not `Sparkline` ───────────────────────────────────────────────────
 *
 * `Sparkline` is a `<path>` with no state, no effects and `pointer-events-none`,
 * and its header explains why: twenty of them in a scrolling mosaic would be
 * twenty pointer-capture regions competing with the drag the reader is using
 * to scroll past. That reasoning is correct and it is not reversed here —
 * `Sparkline` is untouched and every existing caller keeps it.
 *
 * A desktop feed is a different surface. It has a pointer rather than a thumb,
 * a 30-to-40rem column rather than a tile, and no gesture competing for the
 * horizontal axis. So this is a second, desktop-only regime over the same
 * batched data, not a second charting system: one component, no library, no
 * new market-data path.
 *
 * ── Why the readout is HTML and the chart is SVG ──────────────────────────
 *
 * The path is drawn in a normalised `viewBox` with `preserveAspectRatio="none"`
 * so it fills whatever width the column gives it. That stretch would distort
 * text, so every label is HTML positioned over the SVG — which also keeps them
 * legible at any column width and costs no font scaling.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * No state until the pointer is inside. The cursor index is `null` on mount
 * and returns to `null` on leave, so a screen of these renders as static paths
 * and only the chart under the pointer re-renders. Nothing subscribes, nothing
 * measures on scroll, and there is no observer per card.
 */

interface Point { date: string; close: number }

const W = 100
const H = 100

export function FeedPriceChart({
  series, reference, referenceLabel = 'Target', className,
}: {
  series: Point[]
  /** A declared reference level. Joins the scale so it cannot sit off-box. */
  reference?: number | null
  referenceLabel?: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)

  const clean = series.filter(p => Number.isFinite(p.close) && p.close > 0)
  const ref = reference != null && Number.isFinite(reference) && reference > 0 ? reference : null

  const onMove = useCallback((clientX: number) => {
    const el = hostRef.current
    if (!el || clean.length < 2) return
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    setCursor(Math.round(t * (clean.length - 1)))
  }, [clean.length])

  if (clean.length < 2) return null

  /*
   * The reference is part of the SCALE, not just the drawing. A target above
   * every close would otherwise sit off the top of the box and be invisible —
   * the common case for a stale target, and precisely the card where the
   * distance is the point.
   */
  const lo = Math.min(...clean.map(p => p.close), ...(ref != null ? [ref] : []))
  const hi = Math.max(...clean.map(p => p.close), ...(ref != null ? [ref] : []))
  const span = hi - lo || 1

  const x = (i: number) => (i / (clean.length - 1)) * W
  const y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4)

  const path = clean.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`).join(' ')
  const area = `${path} L${W},${H} L0,${H} Z`

  const first = clean[0].close
  const last = clean[clean.length - 1].close
  const up = last >= first
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0

  const active = cursor != null ? clean[cursor] : null
  const shown = active ?? clean[clean.length - 1]
  const gid = `fpc-${up ? 'u' : 'd'}-${clean.length}-${Math.round(lo)}-${Math.round(hi)}`

  const money = (v: number) => `$${v.toFixed(2)}`

  return (
    <div className={clsx('relative', className)}>
      {/* Readout. Always present so the box never changes height on hover —
          a chart that reflows under the cursor is worse than no readout. */}
      <div className="mb-1 flex items-baseline justify-between text-[11px] leading-none">
        <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
          {money(shown.close)}
          <span className="ml-1.5 font-normal text-gray-400">
            {new Date(shown.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {ref != null && (
            <span className="text-gray-500 dark:text-gray-400">
              {referenceLabel} <span className="font-semibold tabular-nums">{money(ref)}</span>
            </span>
          )}
          <span className={clsx('font-semibold tabular-nums', up ? 'text-emerald-600' : 'text-rose-600')}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
          </span>
        </span>
      </div>

      <div
        ref={hostRef}
        className="relative h-32 w-full cursor-crosshair"
        /* Inspection only. The tile's click guard sees a focusable descendant
           with a button-ish role and leaves selection alone; this also stops a
           stray click here reaching the tile. */
        role="img"
        aria-label={`Price ${money(first)} to ${money(last)}${ref != null ? `, ${referenceLabel.toLowerCase()} ${money(ref)}` : ''}`}
        tabIndex={0}
        onPointerMove={e => onMove(e.clientX)}
        onPointerLeave={() => setCursor(null)}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          setCursor(c => {
            const base = c ?? clean.length - 1
            return Math.min(clean.length - 1, Math.max(0, base + (e.key === 'ArrowRight' ? 1 : -1)))
          })
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id={gid} className={up ? 'text-emerald-500' : 'text-rose-500'} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={area} fill={`url(#${gid})`} />

          {ref != null && (
            <line
              x1="0" x2={W} y1={y(ref)} y2={y(ref)}
              className="text-amber-500"
              stroke="currentColor" strokeWidth="1" strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            className={up ? 'text-emerald-500' : 'text-rose-500'}
          />

          {active && (
            <line
              x1={x(cursor!)} x2={x(cursor!)} y1="0" y2={H}
              className="text-gray-400"
              stroke="currentColor" strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Dots are HTML so they stay round under the horizontal stretch that
            `preserveAspectRatio="none"` applies to everything in the SVG. */}
        <Dot leftPct={100} topPct={(y(last) / H) * 100} tone={up ? 'up' : 'down'} />
        {active && (
          <Dot leftPct={(x(cursor!) / W) * 100} topPct={(y(active.close) / H) * 100} tone="cursor" />
        )}
      </div>
    </div>
  )
}

function Dot({ leftPct, topPct, tone }: { leftPct: number; topPct: number; tone: 'up' | 'down' | 'cursor' }) {
  return (
    <span
      aria-hidden
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
      className={clsx(
        'pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-gray-800',
        tone === 'cursor' ? 'bg-gray-900 dark:bg-white' : tone === 'up' ? 'bg-emerald-500' : 'bg-rose-500',
      )}
    />
  )
}
