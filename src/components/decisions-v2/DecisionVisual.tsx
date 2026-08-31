/**
 * Desktop Decisions — the price path since a decision.
 *
 * ── The anchor is the decision, not the chart's horizon ──────────────────
 *
 * The window rule that Today, Research and Portfolio all carry, applied to the
 * one anchor that matters here: a chart may say SINCE THIS DECISION only when
 * the series actually reaches `decidedAt`. Where it does not, the caption names
 * the window that WAS measured and no anchor tick is drawn.
 *
 * The move is computed from the sliced window, never from whatever horizon a
 * viewer happens to be looking at. "+8.4% since the decision" and "the last 90
 * days" are different claims and must not be able to swap.
 *
 * ── What it deliberately does not say ────────────────────────────────────
 *
 * No colour means "good call" and no label means "wrong". The line is green
 * when the price rose and red when it fell, because that is what the price did;
 * an accepted buy that fell is not thereby a mistake, and a declined one that
 * rose is not thereby a proven miss. The chart states the path and stops.
 */

import { clsx } from 'clsx'

export interface DecisionWindow {
  series: number[]
  changePct: number
  reachesDecision: boolean
  days: number
  /** Index of the decision within `series`, when the series reaches it. */
  anchorIndex: number
}

/**
 * Slice a price series at the decision, reporting honestly whether it got there.
 *
 * Pure and exported so the headline number and the drawing cannot describe
 * different windows.
 */
export function windowSinceDecision(
  history: { date: string; close: number }[] | undefined,
  decidedAtISO: string | null | undefined,
): DecisionWindow | null {
  if (!history || history.length < 2) return null

  const decided = decidedAtISO ? Date.parse(decidedAtISO) : NaN
  const hasAnchor = Number.isFinite(decided)
  const first = Date.parse(history[0].date)
  const reaches = hasAnchor && Number.isFinite(first) && first <= decided

  const startIndex = reaches
    ? Math.max(0, history.findIndex(p => Date.parse(p.date) >= decided))
    : 0

  const slice = history.slice(startIndex)
  if (slice.length < 2 || !(slice[0].close > 0)) return null

  return {
    series: slice.map(p => p.close),
    changePct: ((slice[slice.length - 1].close - slice[0].close) / slice[0].close) * 100,
    reachesDecision: reaches,
    anchorIndex: 0,
    days: Math.round(
      (Date.parse(slice[slice.length - 1].date) - Date.parse(slice[0].date)) / 86_400_000,
    ),
  }
}

export function PriceSinceDecision({
  w, executedOffsetPct,
}: {
  w: DecisionWindow
  /** Where execution landed in the window, 0–1, when both dates are real. */
  executedOffsetPct?: number | null
}) {
  const W = 340
  const H = 92
  const min = Math.min(...w.series)
  const max = Math.max(...w.series)
  const span = (max - min) || 1
  const x = (i: number) => (i * W) / Math.max(1, w.series.length - 1)
  const y = (v: number) => 4 + (H - 14) * (1 - (v - min) / span)
  const d = w.series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L')
  const up = w.changePct >= 0

  // 4% of the window is roughly the width of the DECIDED label. Below that the
  // two marks are the same mark.
  const SEPARATION = 0.04
  const showExecution =
    executedOffsetPct != null && executedOffsetPct > SEPARATION && executedOffsetPct <= 1
  const sameDay =
    executedOffsetPct != null && executedOffsetPct >= 0 && executedOffsetPct <= SEPARATION

  return (
    <div data-testid="price-since-decision">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-gray-500">
          {w.reachesDecision ? 'Price since this decision' : 'Price over available history'}
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-gray-500">
          {w.reachesDecision ? `${w.days}d since decision` : `${w.days}d of history`}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}
           role="img" aria-label={`Price, ${w.changePct.toFixed(1)} percent`}>
        <path d={`M${d} L${W},${H} L0,${H} Z`}
              className={clsx(up ? 'fill-emerald-500' : 'fill-rose-500', 'opacity-10')} />
        <path d={`M${d}`} fill="none" strokeWidth={1.6} strokeLinejoin="round"
              className={up ? 'stroke-emerald-500' : 'stroke-rose-500'} />

        {w.reachesDecision && (
          <>
            <line x1={0.5} y1={0} x2={0.5} y2={H - 2} strokeWidth={1} strokeDasharray="2 3"
                  className="stroke-gray-500 dark:stroke-gray-500" />
            <text x={4} y={9} className="fill-gray-500 text-[8px]" style={{ letterSpacing: '.05em' }}>
              DECIDED
            </text>
          </>
        )}

        {/* Execution, only where a real completion date lands inside the
            window AND far enough from the decision to be a separate mark.
            Same-day execution is the common case here, and two labels stacked
            on one pixel is a smear rather than information -- the chronology
            beside the chart already states both dates. */}
        {showExecution && (
          <>
            <line x1={executedOffsetPct! * W} y1={0} x2={executedOffsetPct! * W} y2={H - 2}
                  strokeWidth={1} strokeDasharray="1 3" className="stroke-blue-500" />
            <text x={executedOffsetPct! * W + 4} y={9} className="fill-blue-600 text-[8px]"
                  style={{ letterSpacing: '.05em' }}>
              EXECUTED
            </text>
          </>
        )}

        <circle cx={W - 2} cy={y(w.series[w.series.length - 1])} r={3}
                className={up ? 'fill-emerald-500' : 'fill-rose-500'} />
      </svg>

      <div className={clsx('mt-1 font-mono text-[16px] font-semibold tabular-nums',
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
        {up ? '+' : ''}{w.changePct.toFixed(1)}%
      </div>
      <p className="mt-1 text-[10.5px] text-gray-500">
        {w.reachesDecision
          ? 'What the price did afterward. Not a verdict on the decision.'
          : 'History does not reach the decision date, so this is not a since-decision move.'}
        {sameDay && ' Execution completed the same day.'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------- outcome chrome */

/**
 * Outcome chips: categorical, deliberately not the severity palette.
 *
 * Accepted is not "good" and declined is not "critical". Using
 * critical/review/info here would put an alarm level on history that nobody
 * computed, so these are quiet slate/ink chips separated by weight and a rule
 * rather than by hue. `open` is the one that borrows a live colour, because it
 * is the one that is genuinely still a live state.
 */
export const OUTCOME_CHIP: Record<string, string> = {
  accepted: 'text-gray-900 bg-gray-900/[0.07] border-gray-900/20 dark:text-gray-100 dark:bg-white/[0.14] dark:border-white/25',
  declined: 'text-gray-600 bg-transparent border-gray-400 dark:text-gray-400 dark:border-gray-600',
  withdrawn: 'text-gray-500 bg-transparent border-dashed border-gray-300 dark:text-gray-500 dark:border-gray-700',
  deferred: 'text-gray-700 bg-gray-100 border-gray-300 dark:text-gray-300 dark:bg-white/[0.07] dark:border-white/15',
  open: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900/50',
}

export const money = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`
