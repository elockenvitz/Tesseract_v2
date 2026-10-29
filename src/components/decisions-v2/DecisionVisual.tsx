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
/* The shared tile chart. Decisions positions it on the fill; Portfolio and
   Research mount the same component with their own anchors. */
import { TilePriceChart } from '../desktop/TilePriceChart'
import { AnchoredPriceChart } from '../desktop/AnchoredPriceChart'
import { anchoredWindow, type AnchoredWindow } from '../../lib/market-data/anchored-window'

/**
 * ── `windowSinceDecision` is retired, and it was WRONG ───────────────────
 *
 * It was this lens's own copy of the slicing rule, kept after the shared one
 * moved to `lib/market-data/anchored-window` on the grounds that it was
 * "self-contained". Self-contained is how it kept the bug the shared one had
 * already been fixed for:
 *
 *     const startIndex = reaches
 *       ? Math.max(0, history.findIndex(p => Date.parse(p.date) >= decided))
 *       : 0
 *
 * `findIndex` returns -1 when NO close sits at or after the decision, and
 * `Math.max(0, -1)` is 0 -- so the slice silently became the WHOLE history
 * while `reachesDecision` stayed true. The detail pane then captioned a
 * year-long line "Price after decision · 364d since decision" and printed its
 * full-history change as the since-the-decision move, for a decision taken
 * after the last cached close. `price_history_cache` trails by design, so
 * every decision taken since the last cached close takes that path.
 *
 * The shared slicer answers -1 by refusing the claim: `reachesAnchor` is
 * false and the caption says "Price over available history" instead. Nothing
 * about this lens's anchor is special, which is the whole argument for not
 * having kept a second copy.
 *
 * Re-exported so this lens's importers name one window rule.
 */
export { anchoredWindow }
export type { AnchoredWindow }

/**
 * ── The drawing is the shared one now ────────────────────────────────────
 *
 * What stood here was a hand-rolled SVG: a fixed 340x92 viewBox with
 * `preserveAspectRatio="none"`, measured on the live detail pane at 636px
 * wide -- a 1.87x horizontal stretch against 1.0x vertical. Under it the
 * end-of-series dot (r=3) painted as an 11x6 ellipse and the DECIDED rule's
 * "2 3" dashes came out 3.7px and 5.6px long beside vertical dashes of 2 and
 * 3 on the same screen. It was 92px tall where Research draws 204, it had no
 * price scale, no gridlines, no dates on its x-axis and nothing to hover.
 *
 * Research's chart carried the identical defect at 1.61x and was fixed; that
 * fix never crossed the lens boundary, so this pane went on drawing the old
 * one for another six passes. The geometry lives in
 * `desktop/AnchoredPriceChart` now and both lenses mount it.
 *
 * ── The grey line is gone, and the owner called it ───────────────────────
 *
 * This file's header argues at length that a red line under -39.0% is the
 * picture calling it a bad decision while the caption denies doing so, and
 * the detail chart was held neutral on that argument. It does not survive
 * contact with the lens it is in. The TILES in this same gallery draw the
 * shared `TilePriceChart`, which is graded -- so a reader saw a red line on
 * the NKE card, clicked it, and landed on a grey line of the same series.
 * Not a different judgement: a different product. The same complaint, twice
 * reported: "the chart is still not the same as the other lenses."
 *
 * The protection the rule was written for survives where it belongs.
 * `DecisionPath` -- the lifecycle drawing, which depicts the DECISION rather
 * than the market -- is still one ink, and `convergence.test.ts` still holds
 * it there. A price path is a fact about a price; the object that depicts
 * the call is where a verdict could actually be implied.
 *
 * ── What this lens still keeps ───────────────────────────────────────────
 *
 * The EXECUTION mark, which is this anchor's second date and no other
 * lens's, and the height Research gives the same slot.
 */
export function PriceSinceDecision({
  w, executedOffsetPct,
}: {
  w: AnchoredWindow
  /** Where execution landed in the window, 0–1, when both dates are real. */
  executedOffsetPct?: number | null
}) {
  // 4% of the window is roughly the width of the EXECUTED label. Below that
  // the two marks are the same mark.
  const SEPARATION = 0.04
  const showExecution =
    executedOffsetPct != null && executedOffsetPct > SEPARATION && executedOffsetPct <= 1
  const sameDay =
    executedOffsetPct != null && executedOffsetPct >= 0 && executedOffsetPct <= SEPARATION

  return (
    <AnchoredPriceChart
      w={w}
      testId="price-since-decision"
      /* Research's height for the same slot, not a number of this lens's own. */
      height={204}
      caption={w.reachesAnchor ? 'Price after decision' : 'Price over available history'}
      meta={w.reachesAnchor ? `${w.days}d since decision` : `${w.days}d of history`}
      anchorTick="decided"
      /* Execution, only where a real completion date lands inside the window
         AND far enough from the decision to be a separate mark. Same-day
         execution is the common case here, and two labels stacked on one
         pixel is a smear rather than information -- the chronology beside the
         chart already states both dates. */
      marks={showExecution ? [{ at: executedOffsetPct!, label: 'EXECUTED' }] : undefined}
      note={<>
        {w.reachesAnchor
          ? 'What the price did afterward. Not a verdict on the decision.'
          : 'History does not reach the decision date, so this is not a since-decision move.'}
        {sameDay && ' Execution completed the same day.'}
      </>}
    />
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
  from, to, requestedAt, decidedAt, open, compact,
}: {
  /**
   * What the book held when this was asked for.
   *
   * Null is common and not an error: it comes from `submission_snapshot`,
   * which plenty of real records simply do not carry. A null baseline used to
   * suppress the whole visual, which is how most cards in this lens ended up
   * with no picture at all -- the fixture happened to have one on every row,
   * so the harness never showed it.
   *
   * With no baseline there is no change to draw, so it draws the request
   * alone: one mark on the same axis, and a caption that says which it is
   * rather than implying the book holds nothing.
   */
  from: number | null
  to: number | null
  requestedAt: string | null
  decidedAt: string | null
  /** Still awaiting an answer, so the duration is "so far" and not a total. */
  open: boolean
  /** A small tile: the axis survives, the ticks and one label do not. */
  compact?: boolean
}) {
  const [on, setOn] = useState(false)
  if (to == null) return null
  const known = from != null

  /*
   * ── What was wrong with the first version ────────────────────────────────
   *
   * A 3px rule with two marks on it, 22px tall, stretched across a 900px
   * card -- and the card above it drew a second rule of almost exactly the
   * same shape for the wait. Two hairline threads that looked alike and meant
   * different things, and neither had enough ink to be read at a glance.
   *
   * This is now the card's ONE object, and it carries the wait in its caption
   * rather than in a second line: how big the position is, what the request
   * would make it, which direction that is, and how long the answer has been
   * outstanding.
   */
  const hi = Math.max(from ?? 0, to)
  const max = hi * 1.25 || 1
  const at = (v: number) => (v / max) * 100
  const up = known ? to >= from! : true
  const delta = known ? to - from! : null

  const days = requestedAt
    ? Math.max(0, Math.round(
        ((decidedAt ? new Date(decidedAt).getTime() : Date.now())
          - new Date(requestedAt).getTime()) / 86_400_000))
    : null

  /*
   * One axis position, and everything hangs off it.
   *
   * The marks were positioned with hard-coded tops that assumed the 52px
   * layout, so the compact form put its ring below its own axis. Deriving
   * them means the two sizes cannot drift apart.
   */
  const axisY = compact ? 16 : 26

  /* Whole-percent ticks, so a weight can be read off rather than estimated. */
  const step = max > 12 ? 5 : max > 5 ? 2 : 1
  const ticks: number[] = []
  for (let v = step; v < max; v += step) ticks.push(v)

  return (
    <div onPointerEnter={() => setOn(true)} onPointerLeave={() => setOn(false)}>
      <div className="flex h-[14px] items-baseline justify-between overflow-hidden whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>{!known ? 'Asked for' : up ? 'Add to' : 'Take to'}</span>
        <span className="font-mono tracking-normal normal-case text-gray-500">
          {on && delta != null
            ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% of the book`
            : days == null ? ''
            : open ? `${days}d waiting` : days === 0 ? 'same day' : `${days}d to decide`}
        </span>
      </div>

      {/*
        Three bands, so nothing can land on anything else: ticks and span at
        the top, the two marks on the axis, the two figures underneath. The
        first version stacked all of it into 44px and the ring sat on top of
        its own label.
      */}
      <div
        className={clsx('relative mt-2 w-full', compact ? 'h-[34px]' : 'h-[52px]')}
        data-testid="decision-size"
      >
        <div className="absolute inset-x-0 h-px bg-slate-200 dark:bg-white/10" style={{ top: axisY }} />
        {!compact && ticks.map(v => (
          <span
            key={v}
            className="absolute h-[5px] w-px bg-slate-200 dark:bg-white/10"
            style={{ left: `${at(v)}%`, top: axisY - 4 }}
          />
        ))}

        {/* The change itself, as a filled span from where the book is to
            where the request would put it -- not a line between two dots.
            Grey, because a decision to trim is a stance, and the direction
            colour on this desktop belongs to what a price did. */}
        {known && (
          <div
            className={clsx(
              'absolute transition-[height,top] duration-100',
              up ? 'bg-slate-800 dark:bg-slate-100' : 'bg-slate-300 dark:bg-white/25',
            )}
            style={{
              left: `${Math.min(at(from!), at(to))}%`,
              width: `${Math.max(0.8, Math.abs(at(to) - at(from!)))}%`,
              height: on ? 18 : 14,
              top: axisY - (on ? 18 : 14),
            }}
          />
        )}

        {/* Where the book is today, when the record says. */}
        {known && (
          <span
            className="absolute h-[11px] w-[11px] -translate-x-1/2 rounded-full border-[2px] border-slate-500 bg-white dark:border-slate-400 dark:bg-[#141a25]"
            style={{ left: `${at(from!)}%`, top: axisY - 5 }}
          />
        )}
        {/* Where the request would put it. */}
        <span
          className="absolute h-[15px] w-[2px] -translate-x-1/2 bg-slate-900 dark:bg-white"
          style={{ left: `${at(to)}%`, top: axisY - 7 }}
        />

        {/*
          The figures are anchored OUTWARD from the span, so they move apart
          as the change shrinks instead of converging on each other. Centring
          both on their marks put them on top of one another for any small
          move, which is most of them.
        */}
        {known && !compact && (
          <Edge value={from!} at={at(from!)} outward={at(from!) <= at(to) ? 'left' : 'right'} />
        )}
        <Edge value={to} at={at(to)} outward={known && at(to) < at(from!) ? 'left' : 'right'} lead />
      </div>
    </div>
  )
}

/**
 * A figure anchored outward from the span, and clamped at the axis edges.
 *
 * Anchoring outward keeps the two apart as the change shrinks, instead of
 * letting them converge on one another for any small move -- which is most
 * moves. Clamping is the other half: a position at 0% of the book anchors its
 * label left, off the edge of the axis, and "0.0" rendered as ".0" until this
 * refused to push a label past the boundary it belongs inside.
 */
function Edge({
  value, at, outward, lead,
}: { value: number; at: number; outward: 'left' | 'right'; lead?: boolean }) {
  const dir = at < 8 ? 'right' : at > 92 ? 'left' : outward
  return (
    <span
      className={clsx(
        'absolute bottom-0 font-mono tabular-nums',
        lead ? 'text-[11px] font-semibold text-gray-900 dark:text-gray-100' : 'text-[10px] text-gray-500',
      )}
      style={{
        left: `${at}%`,
        transform: dir === 'left' ? 'translateX(-100%)' : 'translateX(0)',
        paddingLeft: dir === 'right' ? 4 : 0,
        paddingRight: dir === 'left' ? 4 : 0,
      }}
    >
      {lead ? `${value.toFixed(1)}%` : value.toFixed(1)}
    </span>
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
  requested, sized, decided, explained, executed, compact,
}: {
  requested: boolean
  sized: boolean
  decided: boolean
  explained: boolean
  /** Null where the outcome does not call for a trade at all. */
  executed: boolean | null
  /** A small tile: the slots survive, their names do not. */
  compact?: boolean
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
            {!compact && (
              <span className={clsx(
                'mt-1 block truncate text-[9px] uppercase tracking-[0.06em]',
                sl.has ? 'text-gray-500' : 'text-amber-700 dark:text-amber-500',
              )}>
                {sl.key}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Price since the fill, at tile scale, scrubbable.
 *
 * ── Why a separate one ───────────────────────────────────────────────────
 *
 * `PriceSinceDecision` above now mounts the shared `AnchoredPriceChart`, so
 * the two are no longer different drawings of one idea -- but they still
 * read different data. `AnchoredWindow` carries `series: number[]` with the
 * per-point dates thrown away, so its scrub can report a price but not which
 * day it belongs to. This takes the dated points the price hook already
 * returns, so every readout can say which day it is reading, which is what a
 * tile-scale plot in a gallery needs.
 *
 * Real series only. `points` comes from `usePriceHistory`, which reads
 * `price_history_cache` -- the product's canonical dated closes. If the
 * window does not reach the anchor there is no chart, rather than a line
 * starting wherever the cache happens to begin: that is the same mistake that
 * made the "since the decision" percentage untrustworthy.
 */
/**
 * The price around a decision — the same chart Research draws for a stale
 * thesis, anchored on the fill instead of the review.
 *
 * ── One price object, not two ────────────────────────────────────────────
 *
 * This was a bespoke chart with its own geometry, its own green/red ink and
 * its own vocabulary, sitting one tab away from `PriceSinceReview`. Two price
 * charts that look different for no reason make the product read as two
 * products, so this now shares Research's slicer (`anchoredWindow`), its
 * dimensions, its single slate ink, its dashed anchor tick and its end dot.
 * Scrubbing is the one addition, and it only adds a readout.
 *
 * ── "Into the filled" is gone ────────────────────────────────────────────
 *
 * That was my wording for a fill with no closes after it yet, and it was
 * nonsense. Research already had the honest answer for the same situation: if
 * the window cannot be measured from the anchor, say "Price over available
 * history" and draw what there is, with no anchor tick and no since-claim.
 * A decision filled today gets exactly that.
 *
 * One ink regardless of direction, for the reason stated at the top of this
 * file: a buy that fell is not thereby a mistake, and a coloured line says it
 * is louder than any caption can deny.
 */
/**
 * The decision tile's price chart is the SHARED tile chart, anchored on the
 * fill.
 *
 * ── Why the drawing left this file ───────────────────────────────────────
 *
 * It was built here, and then Portfolio needed a price on its cards. What
 * Portfolio could reach was a 20-30px micro sparkline -- no axes, no horizon
 * control, no scrub -- because the good chart was a lens-private component.
 * Unreadable on its own terms, and it made the product read as two products
 * one tab apart.
 *
 * So the drawing moved to `components/desktop/TilePriceChart`, the shared
 * shell every lens can mount, and this is the Decisions-shaped call: the
 * anchor is the fill, or the decision where nothing filled. Nothing about how
 * it renders is decided here any more, which is the point -- one price object,
 * three lenses positioning it.
 */
export function PriceSinceFill(props: {
  points: { date: Date; value: number }[]
  /** The fill, or the decision where nothing filled. */
  anchorISO: string | null
  /** A bare noun -- "fill", "decision" -- the chart builds sentences from it. */
  anchorLabel?: string
  height?: number
  /** Rendered when there is no drawable series at all. */
  empty?: React.ReactNode
}) {
  return <TilePriceChart {...props} />
}

/* The drawing that used to live here is now
   `components/desktop/TilePriceChart`. What follows is deliberately gone: the
   geometry, the axes, the horizon chips, the scrub readout and the
   window-explaining paragraph all moved there intact, so Portfolio and
   Research mount the same object Decisions does rather than a lesser copy. */
