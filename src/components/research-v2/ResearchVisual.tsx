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


export interface AnchoredWindow {
  series: number[]
  changePct: number
  reachesAnchor: boolean
  days: number
}

/**
 * Slice a series at the anchor, reporting honestly whether it got there.
 *
 * Exported and pure so the metric strip and the chart cannot disagree about
 * which window they describe — the failure mode where a tile shows "+24.6%
 * since review" beside a line covering ninety days.
 */
export function anchoredWindow(
  history: { date: string; close: number }[] | undefined,
  anchorISO: string | null | undefined,
): AnchoredWindow | null {
  if (!history || history.length < 2) return null

  const anchor = anchorISO ? Date.parse(anchorISO) : NaN
  const hasAnchor = Number.isFinite(anchor)
  const first = Date.parse(history[0].date)
  const reachesAnchor = hasAnchor && Number.isFinite(first) && first <= anchor

  const startIndex = reachesAnchor
    ? Math.max(0, history.findIndex(p => Date.parse(p.date) >= anchor))
    : 0

  const slice = history.slice(startIndex)
  if (slice.length < 2 || !(slice[0].close > 0)) return null

  return {
    series: slice.map(p => p.close),
    changePct: ((slice[slice.length - 1].close - slice[0].close) / slice[0].close) * 100,
    reachesAnchor,
    days: Math.round(
      (Date.parse(slice[slice.length - 1].date) - Date.parse(slice[0].date)) / 86_400_000,
    ),
  }
}

export function PriceSinceReview({ w, height = 88 }: { w: AnchoredWindow; height?: number }) {
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
          {w.reachesAnchor ? 'Price since last review' : 'Price over available history'}
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">
          {w.reachesAnchor ? `since review · ${w.days}d` : `${w.days}d of history`}
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
              LAST REVIEW
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
          History does not reach the review date, so this is not a since-review move.
        </p>
      )}
    </div>
  )
}
