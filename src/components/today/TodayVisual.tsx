/**
 * Today — visual-per-problem.
 *
 * Six small renderers, one per archetype. The rule from the approved
 * prototype: the graphic explains why THIS item surfaced, so a stale thesis
 * gets decay, an unresolved proposal gets an age line, and an item whose
 * evaluator carries no such number gets strong typography instead of a
 * decorative chart.
 *
 * Every visual names its window. That rule is borrowed from mobile's
 * `TileSparkline`, which documents the failure it prevents: an unlabelled
 * graphic beside a metric reads as a contradiction, and the reader resolves it
 * by distrusting the number — the one thing on the tile that was unambiguous.
 */
/**
 * ── Price paths are evidence, and the direction is part of the evidence ──
 *
 * This file used to say: ONE ink regardless of sign, because "a stale thesis
 * on a name that fell looked like a failure, and one on a name that rose
 * looked like a success".
 *
 * The worry it names is real and it is still enforced -- by the card, not by
 * the chart. A thesis nobody has revisited in 214 days is equally overdue
 * whichever way the price went; the badge, the claim and the action say so,
 * and none of them takes a colour from the tape. What the refusal actually
 * cost was the most-read fact on the card, and it left this surface grey
 * while the number beside it was already signed.
 *
 * The severity collision the old note worried about -- "rose would say
 * broken" -- is handled by shape and place rather than by giving up the hue:
 * severity is small-caps text in the chrome, direction is a plotted line and
 * the figure above it. A severity badge must never take its colour from the
 * price, and a price line must never take its colour from the severity.
 *
 * The ink itself is `lib/charts/tone`, shared with Ideas and defined beside
 * the scrub mapping these charts already share, so a fall looks the same on
 * every lens and a reader learns it once.
 */

import { useId, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight } from 'lucide-react'
import { indexAtClientX } from '../../lib/charts/scrub'
import { moveTone } from '../../lib/charts/tone'
import type { TodayVisual as Visual } from '../../lib/today'

export function TodayVisual({ visual, compact }: { visual: Visual; compact?: boolean }) {
  // No visual is better than an apology. The user should never read
  // implementation language about what the engine could not measure -- the
  // metric strip and the claim already carry the situation.
  if (visual.archetype === 'metrics') return null

  return (
    /*
      Unboxed.

      This was a rounded, bordered, separately-grounded panel sitting inside a
      rounded, bordered card -- two radii and two grounds nested on every item
      in the feed, which is most of what made the surface read as an
      infographic rather than an instrument. What the zone actually has to do
      is separate the analysis from the prose above it, and a hairline does
      that without a second container. Ideas removed the same nesting; this is
      the same removal.
    */
    <div
      className={clsx(
        'border-t border-gray-200/80 dark:border-white/[0.08]',
        compact ? 'mt-2 pt-2' : 'mt-3 pt-3',
      )}
      data-archetype={visual.archetype}
    >
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-500">
          {visual.caption}
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-500 dark:text-gray-500">
          {visual.window}
        </span>
      </div>

      <Body visual={visual} compact={compact} />

      {visual.note && (
        <div className="mt-1.5 text-[10px] leading-snug text-gray-500 dark:text-gray-500">
          {visual.note}
        </div>
      )}
    </div>
  )
}

function Body({ visual, compact }: { visual: Visual; compact?: boolean }) {
  switch (visual.archetype) {
    case 'exposure':      return <Exposure v={visual} />
    case 'aging':         return <Aging v={visual} compact={compact} />
    case 'transition':    return <Transition v={visual} />
    case 'expected-return': return <ExpectedReturn v={visual} />
    case 'review-window': return <ReviewWindow v={visual} compact={compact} />
    case 'scenario':      return <Scenario v={visual} compact={compact} />
    default:              return null
  }
}

/* ---------------------------------------------------------------- exposure */

function Exposure({ v }: { v: Visual }) {
  const e = v.exposure!
  // The track is the whole book and nothing else.
  //
  // There was a policy-max tick here at a hard-coded 10%. No policy-limit
  // source exists in the data Today loads, so that tick was a constraint the
  // product invented and then drew as though it knew it -- and a marker is
  // read as authoritative precisely because it looks measured. It is gone,
  // and it is not replaced by another reference: NAV is a fact, a threshold
  // would be a guess.
  //
  // The number leads, because at a 4% weight an honest 0-100% bar is a sliver
  // -- which is true, and is exactly why the bar must not be the whole story.
  return (
    <div>
      <div className="font-mono text-[19px] font-semibold leading-none tracking-tight text-gray-900 dark:text-gray-100">
        {e.weightPct.toFixed(1)}%
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06]">
        <i
          className="block h-full rounded-full bg-blue-500/55"
          style={{ width: `${Math.min(100, Math.max(0, e.weightPct))}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-gray-500 dark:text-gray-500">
        of NAV — no policy limit is recorded for this position
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- aging */

/**
 * How long something has been sitting, drawn as a duration.
 *
 * ── Why a line and not just the number ───────────────────────────────────
 *
 * The metric strip already says "324d". What it cannot say is what 324 days
 * looks like against a review cadence -- and that is the whole finding on a
 * card whose complaint is that nobody has looked. The line is the duration;
 * the figure is the count; they are different jobs and the tile needs both.
 *
 * The scale is a year, because a review cycle is the thing a reader is
 * measuring against and nobody thinks in "percent of the longest overdue
 * item". Past a year the track saturates and says so, rather than silently
 * rescaling and making eighteen months look like twelve.
 */
function Aging({ v, compact }: { v: Visual; compact?: boolean }) {
  const a = v.aging!
  const track = useRef<HTMLDivElement | null>(null)
  const [pick, setPick] = useState<number | null>(null)

  const YEAR = 365
  const capped = Math.min(a.days, YEAR)
  const over = a.days > YEAR
  const at = (d: number) => (Math.min(d, YEAR) / YEAR) * 100

  /* Quarter marks, so the length can be read rather than estimated. */
  const ticks = [91, 182, 273].filter(d => d < Math.max(capped, 60))

  return (
    <div>
      <div className="flex h-[14px] items-baseline justify-between overflow-hidden whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>written</span>
        <span className="font-mono tracking-normal normal-case text-gray-500">
          {pick != null
            ? `${Math.round(pick)}d in`
            : over ? 'over a year' : `${a.days}d`}
        </span>
        <span>today</span>
      </div>

      <div
        ref={track}
        data-testid="aging-track"
        className={clsx('relative mt-1.5 w-full cursor-crosshair', compact ? 'h-[20px]' : 'h-[26px]')}
        onPointerMove={e => {
          if (e.pointerType !== 'mouse' || !track.current) return
          const r = track.current.getBoundingClientRect()
          if (r.width <= 0) return
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          setPick(f * YEAR)
        }}
        onPointerLeave={() => setPick(null)}
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200 dark:bg-white/10" />

        {/* The quarters. Faint, and only where they fit inside the run. */}
        {ticks.map(d => (
          <i key={d} className="absolute top-1/2 h-[7px] w-px -translate-y-1/2 bg-slate-300 dark:bg-white/20"
             style={{ left: `${at(d)}%` }} />
        ))}

        {/* The run itself. Amber because an unreviewed case IS the finding
            here -- this is the severity palette doing its actual job, not a
            price wearing it. */}
        <div
          className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-amber-500/80 dark:bg-amber-400/70"
          style={{ left: 0, width: `${at(a.days)}%` }}
        />
        <span className="absolute left-0 top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-slate-500 bg-white dark:border-slate-400 dark:bg-[#141a25]" />
        <span
          className={clsx(
            'absolute top-1/2 w-[2px] -translate-x-1/2 -translate-y-1/2',
            over ? 'h-[18px] bg-rose-600' : 'h-[14px] bg-amber-600 dark:bg-amber-400',
          )}
          style={{ left: `${at(a.days)}%` }}
        />

        {pick != null && (
          <span className="pointer-events-none absolute inset-y-0 w-px bg-slate-900 dark:bg-white"
                style={{ left: `${at(pick)}%` }} />
        )}
      </div>

      <div className="mt-1 flex items-baseline justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span className="font-mono tracking-normal normal-case">0</span>
        <span className="font-mono tracking-normal normal-case">6 months</span>
        <span className="font-mono tracking-normal normal-case">{over ? '1yr+' : '1 year'}</span>
      </div>
    </div>
  )
}

function Transition({ v }: { v: Visual }) {
  const t = v.transition!
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[12px] font-semibold text-gray-500 line-through dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-500">
        {t.from}
      </span>
      <ArrowRight className="h-3 w-3 flex-none text-gray-400 dark:text-gray-600" />
      <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[12px] font-bold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
        {t.to}
      </span>
    </div>
  )
}

/* --------------------------------------------------------- expected return */

function ExpectedReturn({ v }: { v: Visual }) {
  const e = v.expectedReturn!
  const pct = Math.min(100, Math.abs(e.evPct) * 2)
  const up = e.evPct >= 0
  return (
    <div>
      <div className="flex items-baseline gap-2">
        {/* Expected return is a modelled number, not a verdict. The sign is
            the fact; the hue would be the judgment. */}
        <span className="font-mono text-[19px] font-semibold leading-none tracking-tight text-gray-900 dark:text-gray-100">
          {up ? '+' : ''}{e.evPct}%
        </span>
        {e.direction && (
          <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-500">
            {e.direction}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06]">
        <i
          className="block h-full rounded-full bg-slate-500/55" 
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- review window */

/**
 * Price across the window the caption names, with the review anchor marked.
 *
 * The anchor tick is drawn ONLY when the history actually reaches the review
 * date. When it does not, there is no tick and the caption says so: a marker
 * at the left edge of a shorter series would assert "this is where you last
 * looked" about a date the data never saw.
 */
function ReviewWindow({ v, compact }: { v: Visual; compact?: boolean }) {
  const r = v.reviewWindow!
  /*
   * Real plot height.
   *
   * 46 / 64px inside cards 300px tall gave the evidence about a sixth of the
   * card it was the evidence FOR, and left the rest white. A chart drawn that
   * small is a sparkline whatever is done to it, which is what this surface
   * was reported as looking like.
   */
  /*
   * 118, not 148.
   *
   * Measured on the real feed: a split tile is a claim and a metric row on
   * the left against a chart, its caption and its note on the right, and the
   * card takes the taller column. At 148 the right column ran about thirty
   * pixels past the left, and every one of those pixels came out as a hole in
   * the middle of the left column between the figures and the action rail.
   *
   * Still four times what it was before this pass. The floor here is
   * readability, not symmetry -- if a tile ever needs a taller plot than its
   * prose, the plot wins.
   */
  const h = compact ? 84 : 118
  const W = 320
  const min = Math.min(...r.series)
  const max = Math.max(...r.series)
  const span = (max - min) || 1
  const x = (i: number) => (i * W) / Math.max(1, r.series.length - 1)
  const y = (val: number) => 4 + (h - 12) * (1 - (val - min) / span)
  const d = r.series.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' L')
  const up = r.changePct >= 0
  const tone = moveTone(r.changePct)
  // A gradient is referenced by id and a feed mounts many of these; `useId`
  // is the only thing stopping two cards sharing one fill.
  const gid = `today-${useId().replace(/:/g, '')}`

  /*
   * The frame, and the levels it lets a reader read.
   *
   * A bare line states a shape and refuses the questions a reader has: how
   * high, how low, and where did the window start. All three are already in
   * `series`. The scale is a gutter beside the plot rather than labels on it,
   * for the same reason it is on Ideas -- a floated label collides with the
   * end of a rising series, which is exactly where the eye already is.
   */
  const hi = Math.max(...r.series)
  const lo = Math.min(...r.series)
  const first = r.series[0]
  const frame = !compact
  const ticks: { v: number; tag: string }[] = []
  for (const t of [{ v: hi, tag: 'H' }, { v: first, tag: 'open' }, { v: lo, tag: 'L' }]) {
    if (ticks.some(u => Math.abs(y(u.v) - y(t.v)) < 11)) continue
    ticks.push(t)
  }

  /*
   * The plot answers a question when you point at it.
   *
   * Desktop drew this as an infographic: a shape, a percentage, and nothing a
   * reader could ask anything of. The same plot on the phone has been
   * inspectable since `PriceContext` -- point at a day and it tells you that
   * day. This is the mouse half of that contract, and only the mouse half:
   * the touch path there arbitrates a gesture against a scrolling feed, which
   * is a problem a desktop pointer does not have.
   *
   * `indexAtClientX` is the shared mapping both surfaces use, so a point
   * picked here and a point picked on the phone resolve identically.
   *
   * State is one integer and it is local. No query runs, nothing is fetched,
   * and leaving the plot restores the figure the card was already making.
   */
  const plot = useRef<SVGSVGElement | null>(null)
  const [picked, setPicked] = useState<number | null>(null)

  const pick = (clientX: number) => {
    const el = plot.current
    if (!el) return
    setPicked(indexAtClientX(clientX, el.getBoundingClientRect(), r.series.length))
  }

  const at = picked != null ? r.series[picked] : null
  // The delta is measured from the anchor the caption already named, so the
  // read-out and the headline figure cannot disagree about their origin.
  const deltaAt = at != null && first > 0 ? ((at - first) / first) * 100 : null

  return (
    <div>
     <div className="relative flex items-start gap-2">
      <svg
        ref={plot}
        viewBox={`0 0 ${W} ${h}`}
        preserveAspectRatio="none"
        className={clsx('min-w-0 flex-1 cursor-crosshair', tone)}
        style={{ height: h }}
        role="img"
        aria-label={`Price over the window, ${r.changePct.toFixed(1)} percent`}
        onPointerMove={e => { if (e.pointerType === 'mouse') pick(e.clientX) }}
        onPointerLeave={() => setPicked(null)}
      >
        {/* The stops flip with the direction because the area does: a rise is
            shaded from the line down, a fall from the top down to it. Fading
            both the same way puts the solid end on the empty side of half the
            charts in a feed. */}
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={up ? 0.28 : 0.06} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={up ? 0.02 : 0.24} />
          </linearGradient>
        </defs>
        {frame && [0.25, 0.5, 0.75].map(f => (
          <line
            key={f} x1="0" x2={W} y1={h * f} y2={h * f}
            className="stroke-gray-200/70 dark:stroke-white/[0.07]"
            strokeWidth="1" vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={`M${d} L${W},${h} L0,${h} Z`} fill={`url(#${gid})`} />
        <path d={`M${d}`} fill="none" stroke="currentColor" strokeWidth={2.25}
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" className={tone} />
        {r.reachesAnchor && (
          <line x1={0.5} y1={0} x2={0.5} y2={h - 2} strokeWidth={1} strokeDasharray="2 3"
                className="stroke-gray-400 dark:stroke-gray-600" />
        )}
        {/* The inspected point, drawn only while it is being inspected. */}
        {picked != null && at != null && (
          <>
            <line
              x1={x(picked)} y1={0} x2={x(picked)} y2={h}
              strokeWidth={1} className="stroke-gray-400 dark:stroke-gray-500"
            />
            <circle cx={x(picked)} cy={y(at)} r={3} className="fill-blue-600" />
          </>
        )}
        <circle cx={W - 2} cy={y(r.series[r.series.length - 1])} r={3.5} fill="currentColor" />
      </svg>

      {/*
        The anchor's label, as HTML rather than as SVG <text>.

        It was drawn inside a plot with `preserveAspectRatio="none"`, which
        scales x far more than y -- so "LAST REVIEW" came out horizontally
        smeared, at a different amount of smear per card width. It is the same
        defect that made the end-of-series dots render as flat ellipses on
        Ideas, and the same fix: position it outside the stretched coordinate
        system.

        Sentence case, too. Eight-pixel all-caps letter-spaced text riding on
        top of a chart is the least legible thing this surface can draw, and
        the label is a quiet note about a dashed line -- not a heading.
      */}
      {frame && r.reachesAnchor && (
        <span className="pointer-events-none absolute left-[6px] top-0 whitespace-nowrap text-[9px] text-gray-400">
          {(r.anchorLabel ?? 'Last review').toLowerCase()}
        </span>
      )}

      {/* The price scale. Outside the plot, so a level can be read off the
          gridline it sits on without anything overlapping the series. */}
      {frame && (
        <div className="relative w-[38px] shrink-0" style={{ height: h }} aria-hidden>
          {ticks.map(t => (
            <div
              key={t.tag}
              data-tick={t.tag}
              className={clsx(
                'absolute right-0 -translate-y-1/2 font-mono text-[10px] tabular-nums',
                t.tag === 'open'
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-gray-400 dark:text-gray-500',
              )}
              style={{ top: `${Math.min(93, Math.max(7, (y(t.v) / h) * 100))}%` }}
            >
              {t.v.toFixed(2)}
            </div>
          ))}
        </div>
      )}
     </div>
      {/*
        One line, one height, whether or not a point is selected.

        The read-out replaces the headline figure in place rather than
        appearing beneath it: a plot that grows a row on hover moves every card
        below it, which is the reflow the reserved-strip work spent a stage
        removing.
      */}
      <div
        data-testid="chart-readout"
        data-picked={picked ?? undefined}
        className="mt-1 flex items-baseline gap-2 font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-gray-100"
      >
        {at != null ? (
          <>
            <span>{at.toFixed(2)}</span>
            {deltaAt != null && (
              <span className="text-[11px] font-medium text-gray-500">
                {deltaAt >= 0 ? '+' : ''}{deltaAt.toFixed(1)}% from {r.anchorLabel?.toLowerCase() ?? 'the anchor'}
              </span>
            )}
          </>
        ) : (
          <span>{up ? '+' : ''}{r.changePct.toFixed(1)}%</span>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- scenario */

/**
 * The price against the desk's own current ladder.
 *
 * ── What was wrong with it ───────────────────────────────────────────────
 *
 * A 44px strip of rounded-pill tracks under a rose-to-blue-to-emerald
 * gradient, with the current price labelled "SPOT" in bold. Three problems,
 * and only one of them was styling.
 *
 * The gradient ran through blue in the middle, so the band's colour said
 * nothing about the axis it was drawn on -- an axis whose whole meaning is
 * that the left end is the case we lose in and the right end the case we win
 * in. Ideas' `RangeChart` runs rose to emerald for exactly that reason and
 * this is the same object, so it reads the same way here.
 *
 * "SPOT" is desk shorthand for the current price. It was the boldest word on
 * the card and it says nothing "now" does not.
 *
 * And it answered nothing when pointed at. A ladder IS a price axis: every x
 * on it is a price, and "what would a 12% drawdown put me at, and is that
 * still inside what we underwrote" is the question the picture exists to
 * answer. It needed arithmetic.
 *
 * Rendered only when `selectCurrentLadders` returned a valid ladder AND a
 * price exists -- there is no partial version of this graphic. The hatched
 * region between the top case and the price is the whole point when the
 * market has left the framework, and there is nothing to hatch if either end
 * is guessed.
 */
function Scenario({ v, compact }: { v: Visual; compact?: boolean }) {
  const sc = v.scenario!
  const band = useRef<HTMLDivElement | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)

  const prices = sc.cases.map(c => c.price)
  const bear = Math.min(...prices)
  const bull = Math.max(...prices)
  const lo = Math.min(bear, sc.spot) * 0.94
  const hi = Math.max(bull, sc.spot) * 1.06
  const span = (hi - lo) || 1
  const at = (p: number) => ((p - lo) / span) * 100
  const beyond = sc.spot > bull || sc.spot < bear

  /** Which side of the desk's thinking a level falls on. */
  const zoneOf = (p: number) => {
    if (p < bear) return 'below the bear case'
    if (p > bull) return 'above the bull case'
    const inner = [...sc.cases].sort((a, b) => a.price - b.price)
    for (let i = 0; i < inner.length - 1; i++) {
      if (p >= inner[i].price && p <= inner[i + 1].price) {
        return `${inner[i].name.toLowerCase()} to ${inner[i + 1].name.toLowerCase()}`
      }
    }
    return 'inside the framework'
  }

  return (
    <div>
      {/* One line, one height, whether or not a level is being read -- so
          running across the band never moves the card. */}
      <div className="flex h-[14px] items-baseline justify-between overflow-hidden whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>{scrub == null ? 'Bear' : ''}</span>
        {scrub != null && (
          <span
            data-testid="scenario-scrub"
            className="font-mono tracking-normal normal-case text-gray-900 dark:text-gray-100"
          >
            {scrub.toFixed(2)}
            <span className="ml-1.5 font-sans text-gray-500">
              {zoneOf(scrub)} · {scrub >= sc.spot ? '+' : ''}
              {(((scrub - sc.spot) / sc.spot) * 100).toFixed(1)}% from here
            </span>
          </span>
        )}
        <span>{scrub == null ? 'Bull' : ''}</span>
      </div>

      <div
        ref={band}
        data-testid="scenario-band"
        className={clsx('relative mt-1.5 w-full cursor-crosshair', compact ? 'h-[34px]' : 'h-[46px]')}
        onPointerMove={e => {
          if (e.pointerType !== 'mouse' || !band.current) return
          const r = band.current.getBoundingClientRect()
          // A zero-width rect is real -- measured before layout, or inside a
          // collapsed container -- and dividing by it prints "NaN".
          if (r.width <= 0) return
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          setScrub(lo + f * span)
        }}
        onPointerLeave={() => setScrub(null)}
      >
        {/* Outside the range the desk underwrote. Marked, not painted. */}
        <div className="absolute inset-y-0 left-0 bg-rose-500/[0.07] dark:bg-rose-400/[0.10]"
             style={{ width: `${at(bear)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-rose-500/[0.07] dark:bg-rose-400/[0.10]"
             style={{ left: `${at(bull)}%` }} />

        {/* What the desk underwrote, bear to bull, because that is what the
            axis IS: the left edge is the case we lose in. */}
        <div
          className="absolute inset-y-0 bg-gradient-to-r from-rose-500/[0.16] via-slate-400/[0.10] to-emerald-500/[0.16] dark:from-rose-400/[0.18] dark:via-white/[0.07] dark:to-emerald-400/[0.18]"
          style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }}
        />

        {sc.cases.map(c => (
          <i key={c.name} className="absolute inset-y-0 w-[2px] bg-slate-400 dark:bg-white/35"
             style={{ left: `${at(c.price)}%` }} />
        ))}

        {/* Now. The one mark allowed to dominate, and the only coloured one:
            WHERE the price sits relative to the desk's own range is the fact
            worth colouring. */}
        <i className={clsx('absolute inset-y-[-4px] z-[1] w-[2px]', beyond ? 'bg-rose-600' : 'bg-blue-600')}
           style={{ left: `${at(sc.spot)}%` }} />
        <span
          className={clsx(
            'absolute top-1/2 z-[2] -translate-y-1/2 whitespace-nowrap font-mono text-[12px] font-semibold tabular-nums',
            beyond ? 'text-rose-700 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100',
            at(sc.spot) > 62 ? '-translate-x-[calc(100%+8px)]' : 'translate-x-[8px]',
            scrub != null && 'opacity-30',
          )}
          style={{ left: `${at(sc.spot)}%` }}
        >
          {sc.spot.toFixed(2)}
        </span>

        {scrub != null && (
          <span className="pointer-events-none absolute inset-y-[-4px] z-[3] w-px bg-slate-900 dark:bg-white"
                style={{ left: `${at(scrub)}%` }} />
        )}
      </div>

      {/*
        The rungs, named and priced, under the band rather than inside it.

        They were absolutely positioned at the band's own baseline, so on a
        narrow column the three numbers overlapped each other and the price
        mark. A row underneath cannot collide with the geometry it labels.
      */}
      <div className="mt-1 flex items-baseline justify-between font-mono text-[9px] tabular-nums text-gray-500">
        {[...sc.cases].sort((a2, b2) => a2.price - b2.price).map(c => (
          <span key={c.name} className="truncate">
            <span className="font-sans uppercase tracking-[0.06em] text-gray-400">
              {c.name}
            </span>{' '}
            {c.price.toFixed(0)}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- fallback */

// `metrics` renders nothing at all -- see the guard at the top of this file.
