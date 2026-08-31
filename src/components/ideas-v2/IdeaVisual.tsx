/**
 * Desktop Ideas — one visual per Idea.
 *
 * The family is chosen by what the data can honestly explain (`familyFor`),
 * and exactly one renders. Nothing here stacks graphics, and nothing draws a
 * shape derived from a single number dressed up as a series — the mistake the
 * retired "evidence recency" bars made on Today.
 *
 * The window rule carries over from mobile's TileSparkline and Today's
 * enrichment: a chart that says SINCE IDEA must be drawn from a series that
 * actually reaches the Idea's creation. Where it does not, the label says what
 * was really measured.
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


import { clsx } from 'clsx'
import type { IdeaEnrichment, IdeaFamily, IdeaRow } from '../../lib/desktop-ideas'

interface Props {
  idea: IdeaRow
  detail: IdeaEnrichment | undefined
  family: IdeaFamily
  height?: number
  compact?: boolean
}

export function IdeaVisual({ idea, detail, family, height = 64, compact }: Props) {
  if (family === 'scenario' && detail?.ladder && detail.spot != null) {
    return <Scenario cases={detail.ladder.cases} spot={detail.spot} />
  }
  if (family === 'target' && detail?.target != null && detail.spot != null) {
    return <TargetGap spot={detail.spot} target={detail.target} history={detail.history} h={height} />
  }
  if (family === 'performance' && detail?.history && detail.history.length >= 2) {
    return <Performance history={detail.history} createdAt={idea.createdAt} h={height} compact={compact} />
  }
  return null
}

/* ------------------------------------------------------------------ window */

/**
 * Where the Idea's creation falls in the series, or null if it predates it.
 *
 * Null is the honest answer, and callers label the window from it rather than
 * stretching a shorter series to stand for "since idea".
 */
export function anchorIndex(history: { date: string }[], createdAt: string): number | null {
  const at = Date.parse(createdAt)
  if (!Number.isFinite(at)) return null
  if (Date.parse(history[0].date) > at) return null
  const i = history.findIndex(p => Date.parse(p.date) >= at)
  return i >= 0 ? i : null
}

function pathFor(series: number[], w: number, h: number) {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = (max - min) || 1
  const x = (i: number) => (i * w) / Math.max(1, series.length - 1)
  const y = (v: number) => 4 + (h - 12) * (1 - (v - min) / span)
  return {
    d: series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L'),
    lastY: y(series[series.length - 1]),
  }
}

/* ------------------------------------------------------------- performance */

function Performance({
  history, createdAt, h, compact,
}: { history: { date: string; close: number }[]; createdAt: string; h: number; compact?: boolean }) {
  const idx = anchorIndex(history, createdAt)
  const start = idx ?? 0
  const series = history.slice(start).map(p => p.close)
  if (series.length < 2) return null

  const change = ((series[series.length - 1] - series[0]) / series[0]) * 100
  const up = change >= 0
  const W = 320
  const H = compact ? 40 : h
  const { d, lastY } = pathFor(series, W, H)
  const days = Math.round(
    (Date.parse(history[history.length - 1].date) - Date.parse(history[start].date)) / 86_400_000,
  )

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-gray-500">
          {idx != null ? 'Price since idea' : 'Price over available history'}
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-gray-500">
          {idx != null ? `since idea · ${days}d` : `${days}d of history`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}
           role="img" aria-label={`Price, ${change.toFixed(1)} percent`}>
        <path d={`M${d} L${W},${H} L0,${H} Z`}
              className="fill-slate-500 opacity-[0.09]" />
        <path d={`M${d}`} fill="none" strokeWidth={1.6} strokeLinejoin="round"
              className="stroke-slate-500 dark:stroke-slate-400" />
        {idx != null && (
          <>
            <line x1={0.5} y1={0} x2={0.5} y2={H - 2} strokeWidth={1} strokeDasharray="2 3"
                  className="stroke-gray-400 dark:stroke-gray-600" />
            <text x={4} y={9} className="fill-gray-500 text-[8px]" style={{ letterSpacing: '.05em' }}>
              IDEA
            </text>
          </>
        )}
        <circle cx={W - 2} cy={lastY} r={3} className="fill-slate-600 dark:fill-slate-300" />
      </svg>
      <div className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {up ? '+' : ''}{change.toFixed(1)}%
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ target */

function TargetGap({
  spot, target, history, h,
}: { spot: number; target: number; history?: { date: string; close: number }[]; h: number }) {
  const gap = ((target - spot) / spot) * 100
  const up = gap >= 0
  const lo = Math.min(spot, target) * 0.92
  const hi = Math.max(spot, target) * 1.08
  const at = (p: number) => ((p - lo) / (hi - lo)) * 100

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-gray-500">
          Current against target
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-gray-500">official target</span>
      </div>
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-[15px] h-2 rounded-full bg-gray-100 dark:bg-white/[0.07]" />
        {/* The span between spot and target. Neutral either way -- upside is
            not virtue and downside is not fault, and Portfolio's framework
            scale reserves rose for spot actually OUTSIDE its own case. */}
        <div className="absolute top-[15px] h-2 rounded-full bg-slate-400/45"
             style={{ left: `${at(Math.min(spot, target))}%`, width: `${Math.abs(at(target) - at(spot))}%` }} />
        <i className="absolute top-[11px] h-5 w-[2.5px] rounded bg-gray-900 dark:bg-gray-100"
           style={{ left: `${at(spot)}%` }} />
        <span className="absolute top-0 -translate-x-1/2 text-[9px] font-bold text-gray-700 dark:text-gray-300"
              style={{ left: `${at(spot)}%` }}>SPOT</span>
        <i className="absolute top-[13px] h-4 w-[1.5px] rounded bg-slate-600 dark:bg-slate-300"
           style={{ left: `${at(target)}%` }} />
        <span className="absolute top-0 -translate-x-1/2 text-[9px] font-bold text-slate-600 dark:text-slate-300"
              style={{ left: `${at(target)}%` }}>TARGET</span>
        <span className="absolute top-[27px] -translate-x-1/2 font-mono text-[9.5px] text-gray-600 dark:text-gray-400"
              style={{ left: `${at(spot)}%` }}>{spot.toFixed(2)}</span>
        <span className="absolute top-[27px] -translate-x-1/2 font-mono text-[9.5px] font-semibold text-gray-700 dark:text-gray-300"
              style={{ left: `${at(target)}%` }}>{target.toFixed(2)}</span>
      </div>
      <div className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {up ? '+' : ''}{gap.toFixed(1)}% <span className="text-[10px] font-normal text-gray-500">to target</span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- scenario */

function Scenario({ cases, spot }: { cases: { name: string; price: number }[]; spot: number }) {
  const prices = cases.map(c => c.price)
  const bull = Math.max(...prices)
  const bear = Math.min(...prices)
  const lo = bear * 0.9
  const hi = Math.max(bull, spot) * 1.06
  const at = (p: number) => ((p - lo) / (hi - lo)) * 100
  const beyond = spot > bull
  const below = spot < bear

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-gray-500">
          Spot against the framework
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-gray-500">{cases.length} cases</span>
      </div>
      <div className="relative h-11">
        <div className="absolute inset-x-0 top-[18px] h-2 rounded-full bg-gray-100 dark:bg-white/[0.07]" />
        <div className="absolute top-[18px] h-2 rounded-full bg-gradient-to-r from-rose-400/50 via-blue-400/50 to-emerald-400/50"
             style={{ left: `${at(bear)}%`, width: `${at(bull) - at(bear)}%` }} />
        {beyond && (
          <div className="absolute top-[18px] h-2 rounded-r-full opacity-45"
               style={{
                 left: `${at(bull)}%`, width: `${at(spot) - at(bull)}%`,
                 backgroundImage: 'repeating-linear-gradient(-45deg,transparent 0 3px,currentColor 3px 4.5px)',
                 color: 'rgb(190 24 60)',
               }} />
        )}
        {cases.map(c => (
          <span key={c.name}>
            <i className="absolute top-[14px] h-5 w-[1.5px] rounded bg-gray-400 dark:bg-gray-500"
               style={{ left: `${at(c.price)}%` }} />
            <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] text-gray-500"
                  style={{ left: `${at(c.price)}%` }}>{c.name}</span>
            <span className="absolute top-[30px] -translate-x-1/2 font-mono text-[9.5px] font-semibold text-gray-600 dark:text-gray-400"
                  style={{ left: `${at(c.price)}%` }}>{c.price.toFixed(0)}</span>
          </span>
        ))}
        <i className={clsx('absolute top-[12px] h-6 w-[2.5px] rounded',
          beyond || below ? 'bg-rose-600' : 'bg-emerald-600')} style={{ left: `${at(spot)}%` }} />
        <span className={clsx('absolute top-0 -translate-x-1/2 text-[9px] font-bold',
          beyond || below ? 'text-rose-600' : 'text-emerald-600')} style={{ left: `${at(spot)}%` }}>SPOT</span>
      </div>
      <div className={clsx('mt-0.5 text-[10.5px]', beyond || below ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500')}>
        {beyond
          ? `Spot is ${(((spot - bull) / bull) * 100).toFixed(1)}% above the bull case.`
          : below
            ? 'Spot is below the bear case.'
            : 'Spot sits inside the framework.'}
      </div>
    </div>
  )
}
