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
export function PriceSinceReview({ w, since, height = 88 }: { w: AnchoredWindow; since: ResearchDateKind; height?: number }) {
  const words = dateWords(since)
  const W = 340
  const H = height
  const min = Math.min(...w.series)
  const max = Math.max(...w.series)
  const span = (max - min) || 1
  const x = (i: number) => (i * W) / Math.max(1, w.series.length - 1)
  const y = (v: number) => 4 + (H - 14) * (1 - (v - min) / span)
  const d = w.series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L')

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
          {w.reachesAnchor ? words.priceSince : 'Price over available history'}
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">
          {w.reachesAnchor ? `${words.since} · ${w.days}d` : `${w.days}d of history`}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}
           role="img" aria-label={`Price, ${w.changePct.toFixed(1)} percent`}>
        <path d={`M${d} L${W},${H} L0,${H} Z`} className="fill-slate-500 opacity-[0.09]" />
        <path d={`M${d}`} fill="none" strokeWidth={1.6} strokeLinejoin="round"
              className="stroke-slate-500 dark:stroke-slate-400" />
        {w.reachesAnchor && (
          <>
            <line x1={0.5} y1={0} x2={0.5} y2={H - 2} strokeWidth={1} strokeDasharray="2 3"
                  className="stroke-gray-400 dark:stroke-gray-600" />
            <text x={4} y={9} className="fill-gray-500 text-[8px]" style={{ letterSpacing: '.05em' }}>
              {words.tick}
            </text>
          </>
        )}
        <circle cx={W - 2} cy={y(w.series[w.series.length - 1])} r={3}
                className="fill-slate-600 dark:fill-slate-300" />
      </svg>

      <div className="mt-1 font-mono text-[16px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {w.changePct >= 0 ? '+' : ''}{w.changePct.toFixed(1)}%
      </div>
      {!w.reachesAnchor && (
        <p className="mt-1 text-[10px] text-gray-500">
          History does not reach {words.the}, so this is not a {words.since} move.
        </p>
      )}
    </div>
  )
}
