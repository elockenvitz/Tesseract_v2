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
 * ── The chart is direction-neutral, and that is the whole point ─────────
 *
 * The first version drew the line green when the price rose and red when it
 * fell. On MNST that produced a bright rose chart reading -39.0% directly above
 * a caption saying "Not a verdict on the decision" -- the picture calling it a
 * bad call while the words denied doing so. The picture wins that argument
 * every time.
 *
 * So there is ONE colour here regardless of direction. An accepted buy that
 * fell is not thereby a mistake and a declined one that rose is not thereby a
 * proven miss; post-decision price movement is evidence a reader weighs, not a
 * severity the product assigns. The sign stays on the number, because -39.0% is
 * a fact. The hue does not, because "bad" is not.
 *
 * This is deliberately NOT the semantic-tone palette either: rose here would
 * mean broken and emerald would mean good, and neither is a claim history is
 * entitled to make.
 */


import { useState } from 'react'
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
  void up

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
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
          {w.reachesDecision ? 'Price after decision' : 'Price over available history'}
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">
          {w.reachesDecision ? `${w.days}d since decision` : `${w.days}d of history`}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}
           role="img" aria-label={`Price, ${w.changePct.toFixed(1)} percent`}>
        {/* One ink, either direction. */}
        <path d={`M${d} L${W},${H} L0,${H} Z`} className="fill-slate-500 opacity-[0.09]" />
        <path d={`M${d}`} fill="none" strokeWidth={1.6} strokeLinejoin="round"
              className="stroke-slate-500 dark:stroke-slate-400" />

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
                className="fill-slate-600 dark:fill-slate-300" />
      </svg>

      {/* The sign is a fact and stays. The colour is a judgment and goes. */}
      <div className="mt-1 font-mono text-[22px] font-semibold tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
        {w.changePct >= 0 ? '+' : ''}{w.changePct.toFixed(1)}%
      </div>
      <p className="mt-1 text-[10px] text-gray-500">
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
/**
 * The outcome as ink, with no chip around it.
 *
 * ── Why the chip went ────────────────────────────────────────────────────
 *
 * Every card in this lens led with a rounded, filled, bordered badge, which
 * is the treatment Ideas spent a pass removing and Today lost with it: a
 * gallery of filled pills reads as a queue of tagged records rather than a
 * set of decisions somebody made. Two of the five variants were carrying a
 * background AND a border AND a dashed border to say something the word
 * itself already says.
 *
 * The distinctions survive, because they are the point of this lens: an
 * accepted decision is ink, a declined one is grey, a withdrawn one is
 * lighter still, and one nobody has answered keeps the accent -- it is the
 * only state where the book is waiting on a person. `OUTCOME_CHIP` stays for
 * the detail pane's header, where a single badge has nothing beside it to be
 * confused with.
 */
export const OUTCOME_INK: Record<string, string> = {
  accepted: 'text-gray-900 dark:text-gray-100',
  declined: 'text-gray-500 dark:text-gray-400',
  withdrawn: 'text-gray-400 dark:text-gray-500',
  deferred: 'text-gray-600 dark:text-gray-400',
  open: 'text-blue-700 dark:text-blue-400',
}

export const OUTCOME_CHIP: Record<string, string> = {
  accepted: 'text-gray-900 bg-gray-900/[0.07] border-gray-900/20 dark:text-gray-100 dark:bg-white/[0.14] dark:border-white/25',
  declined: 'text-gray-600 bg-transparent border-gray-400 dark:text-gray-400 dark:border-gray-600',
  withdrawn: 'text-gray-500 bg-transparent border-dashed border-gray-300 dark:text-gray-500 dark:border-gray-700',
  deferred: 'text-gray-700 bg-gray-100 border-gray-300 dark:text-gray-300 dark:bg-white/[0.07] dark:border-white/15',
  open: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900/50',
}

export const money = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`

/**
 * What the decision actually changed, and how long it took to make.
 *
 * ── Why this lens gets a visual at all ───────────────────────────────────
 *
 * Decisions has no price series and no returns, so the price chart every
 * other lens now carries would be an invented fact here. For two rounds that
 * was read as "nothing applies", and the cards stayed as prose above two
 * hundred pixels of nothing.
 *
 * But a decision has a size and a duration, and both were already on the
 * record and both went undrawn. `baselineWeight` is what the book carried
 * when the request was submitted and `sizingWeight` is what was asked for --
 * the distance between them IS the decision, and "trim NVDA from 7.4 to 5.0"
 * is a different object from "add 0.2". The days from `requestedAt` to
 * `decidedAt` are the other half: this lens exists to ask what happened
 * next, and how long a request sat before anyone answered it is the first
 * thing that happened.
 *
 * Same vocabulary as every other visual on the desktop: an open ring for
 * where we started, a solid mark for where it was taken to, the span between
 * them inked, and the window named underneath. Nothing is modelled.
 */
export function DecisionSize({
  from, to, requestedAt, decidedAt, open,
}: {
  from: number | null
  to: number | null
  requestedAt: string | null
  decidedAt: string | null
  /** Still awaiting an answer, so the duration is "so far" and not a total. */
  open: boolean
}) {
  if (from == null || to == null) return null

  // A padded domain anchored at zero: a weight cannot be negative, and a
  // decision that takes a position to nothing has to reach the axis to say so.
  const hi = Math.max(from, to)
  const max = hi * 1.15 || 1
  const at = (v: number) => (v / max) * 100
  const up = to >= from

  /*
   * The change itself, which the card never actually stated.
   *
   * Both ends were labelled and the distance between them -- the size of the
   * decision, and the only number a reader is doing arithmetic to get -- was
   * left for them to work out. Pointing at the track says it, in the caption
   * slot that is already reserved, so nothing moves.
   */
  const [on, setOn] = useState(false)
  const delta = to - from

  const days = requestedAt
    ? Math.max(0, Math.round(
        ((decidedAt ? new Date(decidedAt).getTime() : Date.now())
          - new Date(requestedAt).getTime()) / 86_400_000))
    : null

  return (
    <div>
      <div className="flex items-baseline justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>{up ? 'Added to' : 'Taken to'}</span>
        {on ? (
          <span className="font-mono tracking-normal normal-case text-gray-900 dark:text-gray-100">
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% of the book
          </span>
        ) : days != null && (
          <span className="font-mono tracking-normal normal-case text-gray-500">
            {open ? `${days}d waiting` : days === 0 ? 'same day' : `${days}d to decide`}
          </span>
        )}
      </div>

      <div
        className="relative mt-2 h-[22px] w-full cursor-pointer"
        data-testid="decision-size"
        onPointerEnter={() => setOn(true)}
        onPointerLeave={() => setOn(false)}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200 dark:bg-white/10" />
        {/* The change itself. Grey, not green or red: a decision to trim is a
            stance, and the direction colour on this desktop is reserved for
            what a price did. */}
        <div
          className={clsx(
            'absolute top-1/2 -translate-y-1/2 transition-[height] duration-100',
            on ? 'h-[5px] bg-slate-900 dark:bg-white' : 'h-[3px] bg-slate-800 dark:bg-slate-100',
          )}
          style={{
            left: `${Math.min(at(from), at(to))}%`,
            width: `${Math.abs(at(to) - at(from))}%`,
          }}
        />
        <span
          className="absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-slate-500 bg-white dark:border-slate-400 dark:bg-[#141a25]"
          style={{ left: `${at(from)}%` }}
        />
        <span
          className="absolute top-1/2 h-[16px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-slate-900 dark:bg-white"
          style={{ left: `${at(to)}%` }}
        />
      </div>

      <div className="mt-1 flex items-baseline justify-between font-mono text-[11px] tabular-nums">
        <span className="text-gray-500">{from.toFixed(1)}%</span>
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          {to.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

/**
 * Requested, decided, executed -- and where it stalled.
 *
 * ── Why this is the second visual and not more of the first ──────────────
 *
 * `DecisionSize` draws how big a decision was. This draws what happened to
 * it, which is the other half of what the lens asks and a genuinely different
 * shape: a size is one distance on one axis, and a lifecycle is a sequence
 * with gaps in it.
 *
 * Every mark is a stored timestamp. `requestedAt` is when somebody asked,
 * `decidedAt` when the PM answered, `execution.completedAt` when the trade
 * actually settled -- and the LENGTHS between them are the finding. A
 * decision taken in a day and executed three weeks later is a different
 * failure from one that sat unanswered for three weeks and then filled
 * immediately, and the record has always known which happened.
 *
 * Nothing is invented. A leg with no timestamp is drawn as open rather than
 * estimated: an accepted decision that was never executed ends at a hollow
 * mark on "today", which is the true statement about it.
 */
export function DecisionPath({
  requestedAt, decidedAt, executedAt, resolved,
}: {
  requestedAt: string | null
  decidedAt: string | null
  executedAt: string | null
  /** Answered, whether accepted or not. An open request has no second leg. */
  resolved: boolean
}) {
  const [leg, setLeg] = useState<'wait' | 'fill' | null>(null)
  const t0 = requestedAt ? new Date(requestedAt).getTime() : null
  if (!t0 || Number.isNaN(t0)) return null

  const t1 = decidedAt ? new Date(decidedAt).getTime() : null
  const t2 = executedAt ? new Date(executedAt).getTime() : null
  const end = t2 ?? Date.now()
  const span = Math.max(end - t0, 86_400_000)
  const at = (t: number) => ((t - t0) / span) * 100
  const days = (a: number, b: number) => Math.max(0, Math.round((b - a) / 86_400_000))

  const waited = t1 ? days(t0, t1) : days(t0, Date.now())
  const filled = t1 && t2 ? days(t1, t2) : null

  return (
    <div>
      <div className="flex h-[14px] items-baseline justify-between overflow-hidden whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>Requested</span>
        <span className="font-mono tracking-normal normal-case text-gray-500">
          {leg === 'wait' ? `${waited}d to answer`
            : leg === 'fill' ? (filled == null ? 'never executed' : `${filled}d to fill`)
            : t2 ? `${days(t0, t2)}d end to end`
            : resolved ? 'not executed'
            : `${waited}d unanswered`}
        </span>
        <span>{t2 ? 'Executed' : resolved ? 'Decided' : 'Today'}</span>
      </div>

      <div className="relative mt-2 h-[22px] w-full" data-testid="decision-path">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200 dark:bg-white/10" />

        {/* Waiting for an answer. Amber only while it is still waiting --
            a request answered in four days is not a problem, and colouring
            every historic leg would make the whole log look overdue. */}
        <button
          type="button"
          data-testid="path-wait"
          aria-label={`${waited} days to answer`}
          onPointerEnter={() => setLeg('wait')}
          onPointerLeave={() => setLeg(null)}
          onFocus={() => setLeg('wait')}
          onBlur={() => setLeg(null)}
          className="absolute top-0 bottom-0 cursor-default"
          style={{ left: 0, width: `${Math.max(2, at(t1 ?? Date.now()))}%` }}
        >
          <span className={clsx(
            'absolute inset-x-0 top-1/2 -translate-y-1/2 transition-[height]',
            leg === 'wait' ? 'h-[5px]' : 'h-[3px]',
            resolved ? 'bg-slate-500 dark:bg-slate-300' : 'bg-amber-500/80 dark:bg-amber-400/70',
          )} />
        </button>

        {/* Decided to filled. */}
        {t1 && (
          <button
            type="button"
            data-testid="path-fill"
            aria-label={filled == null ? 'never executed' : `${filled} days to fill`}
            onPointerEnter={() => setLeg('fill')}
            onPointerLeave={() => setLeg(null)}
            onFocus={() => setLeg('fill')}
            onBlur={() => setLeg(null)}
            className="absolute top-0 bottom-0 cursor-default"
            style={{ left: `${at(t1)}%`, width: `${Math.max(2, 100 - at(t1))}%` }}
          >
            <span className={clsx(
              'absolute inset-x-0 top-1/2 -translate-y-1/2 transition-[height]',
              leg === 'fill' ? 'h-[5px]' : 'h-[3px]',
              t2 ? 'bg-slate-800 dark:bg-slate-100'
                : 'bg-[repeating-linear-gradient(90deg,rgb(148_163_184)_0_3px,transparent_3px_6px)]',
            )} />
          </button>
        )}

        {/* The marks: asked, answered, filled. */}
        <span className="pointer-events-none absolute left-0 top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-slate-500 bg-white dark:border-slate-400 dark:bg-[#141a25]" />
        {t1 && (
          <span
            className="pointer-events-none absolute top-1/2 h-[14px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-slate-700 dark:bg-slate-200"
            style={{ left: `${at(t1)}%` }}
          />
        )}
        <span
          className={clsx(
            'pointer-events-none absolute right-0 top-1/2 h-[10px] w-[10px] translate-x-1/2 -translate-y-1/2 rounded-full',
            t2 ? 'bg-slate-900 dark:bg-white'
              : 'border-[2px] border-dashed border-slate-300 dark:border-white/25',
          )}
        />
      </div>
    </div>
  )
}

/**
 * What a decision remembers, and what it does not.
 *
 * ── Why this is the visual for an unexplained decision ───────────────────
 *
 * The other two visuals draw quantities: how big the change was, how long
 * each leg took. Neither can draw the thing that is actually wrong with these
 * records, because the thing that is wrong is an ABSENCE -- somebody accepted
 * a trade and never wrote down why.
 *
 * An absence has no magnitude, so drawing it as a bar of any length would be
 * a lie about it. What it has is a shape: which parts of the record exist and
 * which do not. Four slots, filled or hollow, and the hollow one is the whole
 * finding.
 *
 * The order is the order the record is made in -- asked, sized, answered,
 * explained -- so a run of filled slots stopping short reads as a process
 * that stopped, which is exactly what happened.
 */
export function RecordGaps({
  requested, sized, decided, explained, executed,
}: {
  requested: boolean
  sized: boolean
  decided: boolean
  explained: boolean
  /** Null where the outcome does not call for a trade at all. */
  executed: boolean | null
}) {
  const [on, setOn] = useState<string | null>(null)

  const slots = [
    { key: 'asked', has: requested, note: 'a request was submitted' },
    { key: 'sized', has: sized, note: 'a size was asked for' },
    { key: 'answered', has: decided, note: 'somebody ruled on it' },
    { key: 'explained', has: explained, note: 'a person wrote down why' },
    ...(executed == null ? [] : [{ key: 'executed', has: executed, note: 'the trade settled' }]),
  ]
  const missing = slots.filter(x => !x.has)

  return (
    <div onPointerLeave={() => setOn(null)}>
      <div className="flex h-[14px] items-baseline justify-between overflow-hidden whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>On the record</span>
        <span className="font-mono tracking-normal normal-case text-gray-500">
          {on
            ? slots.find(x => x.key === on)!.has
              ? slots.find(x => x.key === on)!.note
              : `no record that ${slots.find(x => x.key === on)!.note}`
            : missing.length === 0
              ? 'complete'
              : `${missing.map(m => m.key).join(' and ')} missing`}
        </span>
      </div>

      <div className="mt-2 flex items-stretch gap-1" data-testid="record-gaps">
        {slots.map(sl => (
          <button
            key={sl.key}
            type="button"
            data-testid={`gap-${sl.key}`}
            data-has={sl.has || undefined}
            aria-label={`${sl.key}: ${sl.has ? 'recorded' : 'missing'}`}
            onPointerEnter={() => setOn(sl.key)}
            onFocus={() => setOn(sl.key)}
            onBlur={() => setOn(null)}
            className="group min-w-0 flex-1 cursor-default text-left"
          >
            <span className={clsx(
              'block h-[6px] w-full transition-colors',
              sl.has
                ? on === sl.key ? 'bg-slate-900 dark:bg-white' : 'bg-slate-700 dark:bg-slate-200'
                // Hollow, not coloured: a missing reason is a gap in the
                // record, not an alarm about the position.
                : on === sl.key
                  ? 'border border-dashed border-amber-600 dark:border-amber-400'
                  : 'border border-dashed border-slate-300 dark:border-white/25',
            )} />
            <span className={clsx(
              'mt-1 block truncate text-[9px] uppercase tracking-[0.06em]',
              sl.has ? 'text-gray-500' : 'text-amber-700 dark:text-amber-500',
            )}>
              {sl.key}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
