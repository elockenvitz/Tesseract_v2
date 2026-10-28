/**
 * Desktop Research — the anchored price window.
 *
 * ── The window rule, again ────────────────────────────────────────────────
 *
 * The anchor is the date the investment case was last written. A chart may
 * only say SINCE LAST REVIEW if the series actually reaches that date. Where
 * it does not, the label states the window that WAS measured and the anchor
 * tick is not drawn — a marker at the left edge of a shorter series would
 * assert "this is where you last looked" about a date the data never saw.
 *
 * Same grammar as Today's review-window and Ideas' performance chart: area,
 * line, emphasised endpoint, dashed anchor, window named in the caption.
 */
/**
 * ── Price paths are evidence, not grades ─────────────────────────────────
 *
 * These lines were green when the price rose and red when it fell. That reads
 * as a verdict: a stale thesis on a name that fell looked like a failure, and
 * one on a name that rose looked like a success, when the only thing either
 * chart states is what the price did. Decisions settled this first and the
 * whole desktop now follows -- ONE ink regardless of sign.
 *
 * The number keeps its + / - because the sign is a fact. The hue goes because
 * "good" is not. This is deliberately not the severity palette either: rose
 * would say broken and emerald would say healthy, and a price path claims
 * neither. Genuine framework breaks -- spot outside its own case -- keep their
 * critical treatment, because there the framework really is broken.
 */


import { useId, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { useWidth } from '../../lib/charts/use-width'
import { indexAtClientX } from '../../lib/charts/scrub'
import { dateWords, type ResearchDateKind } from '../../lib/desktop-research'

/*
 * ── The slicer moved to `lib/market-data/anchored-window` ────────────────
 *
 * It lived here, and Decisions imported it from this lens -- one lens
 * reaching into another. When the shared tile shell needed it too, that would
 * have made `components/desktop` depend on `components/research-v2`, so a
 * sparkline re-derived the window inline instead and reproduced this
 * function's own bug within the hour: a series whose closes all post-date the
 * anchor is not a since-the-anchor window.
 *
 * Re-exported here so this lens's own importers are unchanged.
 */
export { anchoredWindow } from '../../lib/market-data/anchored-window'
import type { AnchoredWindow } from '../../lib/market-data/anchored-window'
export type { AnchoredWindow }

/**
 * `since` names the date the window starts from -- a review only where one was
 * recorded. It is required: the chart used to say "since last review" about
 * every anchor it was given.
 */
/**
 * The same plot Today draws, on the same terms.
 *
 * ── What was wrong with it ───────────────────────────────────────────────
 *
 * It drew into a fixed 340-unit box with `preserveAspectRatio="none"` and
 * was rendered 548px wide -- a 1.61x horizontal smear, so the end-of-series
 * dot was an ellipse and the anchor rule's dashes came out 1.61x longer than
 * the dashes anywhere else on the page. It was 88px tall against Today's 166,
 * and it offered none of what makes a price chart answerable: no scale, no
 * gridlines, nothing to point at.
 *
 * It is now Today's chart. Not "like" it -- the same geometry, the same
 * `useWidth` measuring the real box, the same half-pixel gridlines, the same
 * anchor-level rule, the same gutter, the same scrub. One grammar for a price
 * path across the product, so a reader who learns it on a tile already knows
 * it here.
 */
export function PriceSinceReview({ w, since, height = 166 }: { w: AnchoredWindow; since: ResearchDateKind; height?: number }) {
  const words = dateWords(since)
  const H = height
  const [box, boxW] = useWidth<HTMLDivElement>(320)
  const W = Math.max(1, Math.round(boxW))

  const PAD = 12
  const min = Math.min(...w.series)
  const max = Math.max(...w.series)
  const span = (max - min) || 1
  const x = (i: number) => (i * (W - 1)) / Math.max(1, w.series.length - 1)
  const y = (v: number) => PAD + (H - PAD * 2) * (1 - (v - min) / span)
  const d = w.series.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' L')

  const gid = `rsv-${useId().replace(/:/g, '')}`
  const up = w.changePct >= 0
  const first = w.series[0]

  /* The levels a reader asks for, in a gutter beside the plot rather than
     floating on it -- a label on the plot collides with the end of a rising
     series, which is exactly where the eye already is. */
  const gutter = 44
  const ticks: { v: number; tag: string }[] = []
  for (const t of [{ v: max, tag: 'H' }, { v: first, tag: 'open' }, { v: min, tag: 'L' }]) {
    if (ticks.some(u => Math.abs(y(u.v) - y(t.v)) < 11)) continue
    ticks.push(t)
  }

  const plot = useRef<SVGSVGElement | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const at = picked != null ? w.series[picked] : null
  const deltaAt = at != null && first > 0 ? ((at - first) / first) * 100 : null

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
          {w.reachesAnchor ? words.priceSince : 'Price over available history'}
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">
          {w.reachesAnchor ? `${words.since} · ${w.days}d` : `${w.days}d of history`}
        </span>
      </div>

      <div className="relative flex items-start gap-2">
        <div ref={box} className="min-w-0 flex-1">
          <svg
            ref={plot}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="block w-full cursor-crosshair text-slate-500 dark:text-slate-400"
            style={{ height: H }}
            role="img"
            aria-label={`Price, ${w.changePct.toFixed(1)} percent`}
            onPointerMove={e => {
              if (e.pointerType !== 'mouse' || !plot.current) return
              setPicked(indexAtClientX(e.clientX, plot.current.getBoundingClientRect(), w.series.length))
            }}
            onPointerLeave={() => setPicked(null)}
          >
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {/* Half-pixel centres: a 1px rule lands ON a device pixel instead
                of straddling two and rendering as a 2px smudge. */}
            {[0.25, 0.5, 0.75].map(f => (
              <line
                key={f} x1="0" x2={W} y1={Math.round(H * f) + 0.5} y2={Math.round(H * f) + 0.5}
                strokeWidth="1" className="stroke-gray-200/70 dark:stroke-white/[0.07]"
              />
            ))}

            {/* The level the window STARTED at. Everything above this line is
                gain since the anchor, everything below is give-back -- which
                is the question this chart exists to answer. */}
            <line
              x1={0} x2={W} y1={Math.round(y(first)) + 0.5} y2={Math.round(y(first)) + 0.5}
              strokeWidth={1} strokeDasharray="3 3"
              className="stroke-slate-400/80 dark:stroke-slate-500/80"
            />

            <path d={`M${d} L${W},${H} L0,${H} Z`} fill={`url(#${gid})`} />
            <path d={`M${d}`} fill="none" stroke="currentColor" strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round" />

            {w.reachesAnchor && (
              <line x1={0.5} y1={0} x2={0.5} y2={H} strokeWidth={1} strokeDasharray="3 3"
                    className="stroke-gray-400 dark:stroke-gray-600" />
            )}

            {picked != null && at != null && (
              <>
                <line
                  x1={Math.round(x(picked)) + 0.5} y1={0} x2={Math.round(x(picked)) + 0.5} y2={H}
                  strokeWidth={1} className="stroke-gray-400 dark:stroke-gray-500"
                />
                <circle cx={x(picked)} cy={y(at)} r={5} className="fill-white dark:fill-[#141a25]" />
                <circle cx={x(picked)} cy={y(at)} r={3.5} fill="currentColor" />
              </>
            )}
            <circle cx={W - 3.5} cy={y(w.series[w.series.length - 1])} r={3.5} fill="currentColor" />
          </svg>
        </div>

        {/* As HTML, not SVG <text>: a label inside the plot inherits whatever
            the coordinate system does to it, which is how "LAST REVIEW" came
            out horizontally smeared at a different amount per card width. */}
        {w.reachesAnchor && (
          <span className="pointer-events-none absolute left-[6px] top-0 whitespace-nowrap text-[9px] text-gray-400">
            {words.tick.toLowerCase()}
          </span>
        )}

        <div className="relative shrink-0" style={{ height: H, width: gutter }} aria-hidden>
          {ticks.map(t => (
            <div
              key={t.tag}
              data-tick={t.tag}
              className={clsx(
                'absolute right-0 -translate-y-1/2 font-mono text-[10px] tabular-nums',
                t.tag === 'open' ? 'text-slate-500 dark:text-slate-400' : 'text-gray-400 dark:text-gray-500',
              )}
              style={{ top: `${Math.min(93, Math.max(7, (y(t.v) / H) * 100))}%` }}
            >
              {t.v.toFixed(2)}
            </div>
          ))}
        </div>
      </div>

      {/* One line, one height, whether or not a point is selected: a plot that
          grows a row on hover moves everything below it. */}
      <div
        data-testid="research-chart-readout"
        className="mt-1 flex items-baseline gap-2 font-mono text-[16px] font-semibold tabular-nums text-gray-900 dark:text-gray-100"
      >
        {at != null ? (
          <>
            <span>{at.toFixed(2)}</span>
            {deltaAt != null && (
              <span className="text-[11px] font-medium text-gray-500">
                {deltaAt >= 0 ? '+' : ''}{deltaAt.toFixed(1)}% from {words.tick.toLowerCase()}
              </span>
            )}
          </>
        ) : (
          <span>{up ? '+' : ''}{w.changePct.toFixed(1)}%</span>
        )}
      </div>

      {!w.reachesAnchor && (
        <p className="mt-1 text-[10px] text-gray-500">
          History does not reach {words.the}, so this is not a {words.since} move.
        </p>
      )}
    </div>
  )
}
