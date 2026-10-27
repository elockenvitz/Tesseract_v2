import { clsx } from 'clsx'
import { Quote, HelpCircle } from 'lucide-react'

import type { ExploreVisual as Visual } from '../../lib/mobile/explore-visual'

/**
 * The Explore card's picture, one small component per archetype.
 *
 * ── Why SVG and CSS rather than a chart library ───────────────────────────
 *
 * Every primitive here is a track, a marker and two labels. A charting
 * dependency would bring an axis engine, a scale system and a render loop to
 * draw a horizontal line with a dot on it, and the page can hold sixty of
 * these — the cost is per card, not per page. `ExploreSpark` already exists for
 * the one archetype that genuinely plots a series.
 *
 * ── Shared constraints, applied to all of them ────────────────────────────
 *
 * No pointer handlers. A tile is a single tap target and any child that
 * captures a drag competes with the grid's own scroll — the same rule that
 * keeps `TileSparkline` inert. No internal scroller. Nothing here reserves
 * height it might not fill: an archetype whose data is missing is never
 * rendered, because `exploreVisualFor` resolved it to `none` upstream.
 *
 * ── Colour ────────────────────────────────────────────────────────────────
 *
 * Semantic only. Red where a number is a downside breach, green where it is
 * upside, amber where the subject is lateness, and neutral everywhere else.
 * The tracks themselves are grey; the colour is on the marker, which is the
 * thing that carries the meaning.
 */

const TRACK = 'bg-gray-200 dark:bg-gray-700'

/**
 * How much room the picture has — the one thing these primitives were never
 * told.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 *
 * Every size in this file was chosen against a 178px phone cell, and every
 * comment below still cites that number. The desktop gallery then rendered
 * the same markup at 421px on a narrow tile and 881px on a wide one, and a
 * track is a percentage width with a fixed height: it does not get bigger
 * when the card does, it gets THINNER-LOOKING.
 *
 * Measured live at 1920x889 on AMZN's scenario card:
 *
 *   the modelled band          524 x 6px        — 87:1
 *   its two labels             810px apart, one in each bottom corner
 *   the whole picture          64px tall inside a 172px panel box
 *
 * So a bar that reads as a solid object on a phone reads as a hairline ruled
 * across a dashboard tile, and the pair of labels under it stop being a pair.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A picture is BOUNDED and WEIGHTED, never stretched. `tile` thickens every
 * track by roughly half, lifts the figures a step, and `ExploreVisualBlock`
 * caps the whole thing at a measure a label pair can span — past which extra
 * width buys no precision a reader can use and costs the picture its shape.
 *
 * `card` is the phone, byte-identical to what shipped. It is the default, so
 * every mobile caller is unchanged by construction rather than by inspection.
 *
 * The root margin belongs to the CALLER at tile density. On the phone the
 * picture follows prose directly and owns the gap; in the gallery it sits in
 * a container that already spaces it, and the two margins stacked.
 */
export type VisualDensity = 'card' | 'tile'

const SCALE = {
  card: {
    root: 'mt-2',
    bar: 'h-2', band: 'h-1.5', rule: 'h-px', rail: 'h-1',
    row: 'h-5', tick: 'h-2.5', dot: 'h-2 w-2', marker: 'h-3 w-3',
    lead: 'text-[17px]', move: 'text-[15px]', value: 'text-[13px]',
    note: 'text-[10px]', body: 'text-[14px]',
  },
  tile: {
    root: '',
    bar: 'h-3', band: 'h-2.5', rule: 'h-0.5', rail: 'h-1.5',
    row: 'h-6', tick: 'h-3.5', dot: 'h-2.5 w-2.5', marker: 'h-3.5 w-3.5',
    lead: 'text-[20px]', move: 'text-[17px]', value: 'text-[15px]',
    note: 'text-[11px]', body: 'text-[15px]',
  },
} as const

type Scale = (typeof SCALE)['card']

/**
 * The measure a bounded picture gets.
 *
 * 520px is where a two-ended label row stops reading as a pair: `BULL $180`
 * and `$253` at 881px apart are two unrelated captions in opposite corners.
 * It is also comfortably past every narrow tile (421px), so the cap costs
 * those nothing and changes only the cards that were being stretched.
 */
const MEASURE = 'max-w-[520px]'

/** A small caps label. Used identically by every archetype so they read as a set. */
function Cap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx('text-[9px] font-bold uppercase tracking-wide text-gray-400', className)}>
      {children}
    </span>
  )
}

const money = (v: number) => (v >= 1000 ? `$${v.toFixed(0)}` : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)

/**
 * The price against the range somebody modelled.
 *
 * The marker is placed on a track that is the MODELLED range, with padding on
 * both sides so a price outside it still lands on the card. That asymmetry is
 * the point: a dot sitting past the end of the band is the whole finding, and
 * a scale that stretched to include it would put the price back inside the
 * picture and quietly undo the claim.
 */
function ScenarioRange({ v, s }: { v: Extract<Visual, { kind: 'scenario_range' }>; s: Scale }) {
  const span = v.high - v.low
  // A third of the band at each end, which is enough room to show a breach
  // without shrinking the band itself into a stripe.
  const pad = span * 0.34
  const lo = v.low - pad
  const hi = v.high + pad
  const pos = (p: number) => ((p - lo) / (hi - lo)) * 100
  const clamp = (n: number) => Math.min(Math.max(n, 2), 98)

  const above = v.current > v.high
  const below = v.current < v.low
  const outside = above || below
  const edge = above ? v.high : v.low
  const deviation = edge > 0 ? ((v.current - edge) / edge) * 100 : null

  return (
    <div data-explore-visual="scenario_range" className={s.root}>
      {/* The deviation leads, because "the market escaped my range" is the
          finding and the band is the evidence for it. */}
      {outside && deviation != null && (
        <div className="mb-1.5 flex min-w-0 items-baseline gap-1.5">
          <span
            data-scenario-deviation
            className={clsx(
              s.lead, 'font-bold tabular-nums leading-none',
              above ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
            )}
          >
            {deviation >= 0 ? '+' : ''}{deviation.toFixed(0)}%
          </span>
          {/* Short enough to survive a 178px cell. "below your lowest case" is
              22 characters at 9px beside a 17px number, and it rendered as
              "BELOW YOUR LOWES…" on every breach card in the grid — a label
              that truncates mid-word tells the reader less than a shorter one
              that fits. The band underneath is already labelled with the case
              names and prices, so "your range" loses nothing. */}
          <Cap className="min-w-0 truncate">{above ? 'above your range' : 'below your range'}</Cap>
        </div>
      )}

      <div className={clsx('relative', s.row)}>
        {/* The modelled band. Solid, because it is the thing that was stated. */}
        <div
          data-scenario-band
          className={clsx('absolute top-1/2 -translate-y-1/2 rounded-full bg-gray-300 dark:bg-gray-600', s.band)}
          style={{ left: `${pos(v.low)}%`, width: `${pos(v.high) - pos(v.low)}%` }}
        />
        {/* The rest of the axis, so the marker has somewhere to be. */}
        <div className={clsx('absolute inset-x-0 top-1/2 -translate-y-1/2', s.rule, TRACK)} aria-hidden />
        {/* Every case gets a tick, so a three-case ladder does not read as two. */}
        {(v.cases ?? []).map(c => (
          <div
            key={`${c.label}:${c.price}`}
            data-scenario-case={c.label}
            className={clsx('absolute top-1/2 w-px -translate-y-1/2 bg-gray-500 dark:bg-gray-400', s.tick)}
            style={{ left: `${clamp(pos(c.price))}%` }}
          />
        ))}
        <div
          data-scenario-current
          className={clsx(
            'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-gray-900',
            s.marker,
            outside
              ? above ? 'bg-emerald-500' : 'bg-rose-500'
              : 'bg-gray-900 dark:bg-white',
          )}
          style={{ left: `${clamp(pos(v.current))}%` }}
        />
      </div>

      <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
        <Cap className="min-w-0 truncate">{v.breachedLabel ? `${v.breachedLabel} ${money(edge)}` : `${money(v.low)}–${money(v.high)}`}</Cap>
        <span className={clsx('shrink-0 font-bold tabular-nums text-gray-700 dark:text-gray-200', s.note)}>
          {money(v.current)}
        </span>
      </div>
    </div>
  )
}

/**
 * Current against target, including the case where there is no target.
 *
 * A dumbbell rather than a bar: two named points and the distance between them
 * is exactly the claim, and a filled bar would imply a magnitude relative to
 * zero that nobody means. The empty state keeps the geometry and dashes the far
 * end — "nobody has put a number here" said in the shape of the thing that is
 * missing.
 */
function TargetCompare({ v, s }: { v: Extract<Visual, { kind: 'target_compare' }>; s: Scale }) {
  const has = v.target != null
  const upside = has && v.current > 0 ? ((v.target! - v.current) / v.current) * 100 : null

  return (
    <div data-explore-visual="target_compare" className={s.root}>
      <div className="flex items-baseline justify-between">
        <Cap>Current</Cap>
        <Cap>{v.targetLabel ?? 'Target'}</Cap>
      </div>
      {/* `min-w-0` on the row, and the money labels truncate rather than set a
          floor. Without both, a four-figure price and a four-figure target on a
          half-width card push the row past the column — which at 390px is a
          horizontally scrolling PAGE, not a clipped label. */}
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <span className={clsx('min-w-0 truncate font-bold tabular-nums text-gray-900 dark:text-white', s.value)}>
          {money(v.current)}
        </span>
        <span className={clsx('shrink-0 rounded-full bg-gray-900 dark:bg-white', s.dot)} aria-hidden />
        <span
          className={clsx(
            'min-w-0 flex-1',
            has ? clsx(s.rule, TRACK) : 'h-px border-t border-dashed border-gray-300 dark:border-gray-600',
          )}
          aria-hidden
        />
        {has ? (
          <>
            <span className={clsx('shrink-0 rounded-full border-2 border-gray-900 bg-white dark:border-white dark:bg-gray-900', s.dot)} aria-hidden />
            <span data-target-value className={clsx('min-w-0 truncate font-bold tabular-nums text-gray-900 dark:text-white', s.value)}>
              {money(v.target!)}
            </span>
          </>
        ) : (
          /* Not a zero, not a dash on the axis — a stated absence. Implying a
             number here is the one thing a no-target card must not do. */
          <span
            data-target-empty
            className={clsx('min-w-0 shrink truncate rounded border border-dashed border-gray-300 px-1.5 py-0.5 font-bold uppercase tracking-wide text-gray-400 dark:border-gray-600', s.note)}
          >
            Not set
          </span>
        )}
      </div>
      {upside != null && (
        <p className={clsx('mt-1 font-semibold tabular-nums text-gray-500 dark:text-gray-400', s.note)}>
          {upside >= 0 ? '+' : ''}{upside.toFixed(0)}% to target
        </p>
      )}
    </div>
  )
}

/** "14 months", "3 weeks". Whole units — a horizon is not read to two decimals. */
function elapsed(ms: number): string {
  const days = Math.round(ms / 86_400_000)
  if (days < 14) return `${Math.max(days, 0)}d`
  if (days < 60) return `${Math.round(days / 7)}w`
  const m = Math.round(days / 30.44)
  return m < 24 ? `${m}mo` : `${(m / 12).toFixed(1)}y`
}

const shortDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

/**
 * Set → Due → Today, with the overrun drawn as its own stretch.
 *
 * The two spans are the finding: a twelve-month view four months late and a
 * three-month view four months late are the same absolute overrun and entirely
 * different failures. Prose collapses them into one "4mo"; two lengths of one
 * line cannot.
 */
function Elapsed({ v, now, s }: { v: Extract<Visual, { kind: 'timeline' }>; now: number; s: Scale }) {
  const t0 = new Date(v.statedAt).getTime()
  if (!Number.isFinite(t0) || now <= t0) return null
  return (
    <div data-explore-visual="timeline" data-timeline-shape="elapsed" className={s.root}>
      <div className={clsx('w-full rounded-full', s.bar, TRACK)}>
        <div data-timeline-elapsed className="h-full w-full rounded-full bg-amber-400 dark:bg-amber-500" />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <Cap>Last {shortDate(v.statedAt)}</Cap>
        <span className={clsx('font-bold tabular-nums text-amber-600 dark:text-amber-400', s.note)}>
          {elapsed(now - t0)}
        </span>
      </div>
      <p className={clsx('mt-0.5 font-bold text-amber-600 dark:text-amber-400', s.note)}>
        {v.overdueLabel ?? 'since anything was recorded'}
      </p>
    </div>
  )
}

/**
 * With no `dueAt` there is no commitment to have missed.
 *
 * So there is nothing to split the track on: one stretch, the date it started,
 * and how long it has run. Coverage neglect is the case — nothing has happened
 * since a date, and nobody ever set a deadline. Drawing the amber "due" cap on
 * it would assert a promise nobody made, which is the rule `target_compare`
 * already follows when it refuses to draw a target that does not exist.
 *
 * The same primitive rather than a second one: an aging strip and a deadline
 * strip differ by whether a marker exists, which is a property of the data.
 */
function Timeline({ v, now, s }: { v: Extract<Visual, { kind: 'timeline' }>; now: number; s: Scale }) {
  const dueAt = v.dueAt
  if (!dueAt) return <Elapsed v={v} now={now} s={s} />
  const t0 = new Date(v.statedAt).getTime()
  const t1 = new Date(dueAt).getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null
  const t2 = Math.max(now, t1 + 1)

  const honoured = t1 - t0
  const over = t2 - t1
  // Floored so a badly overdue view still shows the stretch it was given.
  const pct = Math.min(Math.max((honoured / (t2 - t0)) * 100, 22), 78)

  return (
    <div data-explore-visual="timeline" className={s.root}>
      <div className={clsx('flex w-full items-stretch gap-0.5', s.bar)}>
        <div className={clsx('rounded-l-full', TRACK)} style={{ width: `${pct}%` }} />
        <div
          data-timeline-overdue
          className="rounded-r-full bg-amber-400 dark:bg-amber-500"
          style={{ width: `${100 - pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <Cap>Set {shortDate(v.statedAt)}</Cap>
        <Cap className="text-amber-600 dark:text-amber-400">Due {shortDate(dueAt)}</Cap>
      </div>
      <p className={clsx('mt-0.5 font-bold text-amber-600 dark:text-amber-400', s.note)}>
        +{elapsed(over)} {v.overdueLabel ?? 'overdue'}
      </p>
    </div>
  )
}

/**
 * How much of a book rides on this.
 *
 * Scaled against a fixed 20% ceiling rather than against the largest weight on
 * the page: a bar whose meaning depends on its neighbours is a bar the reader
 * has to re-learn every scroll, and 20% is comfortably above any single
 * position in these books.
 */
function Exposure({ v, s }: { v: Extract<Visual, { kind: 'exposure' }>; s: Scale }) {
  const pct = Math.min((v.weightPct / 20) * 100, 100)
  return (
    <div data-explore-visual="exposure" className={s.root}>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span data-exposure-value className={clsx('font-bold tabular-nums leading-none text-gray-900 dark:text-white', s.lead)}>
          {v.weightPct.toFixed(1)}%
        </span>
        <Cap className="min-w-0 truncate">{v.portfolioName ? `of ${v.portfolioName}` : 'of the book'}</Cap>
      </div>
      <div className={clsx('mt-1.5 w-full overflow-hidden rounded-full', s.bar, TRACK)}>
        <div className="h-full rounded-full bg-gray-900 dark:bg-white" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Two weights that disagree, drawn to one scale so the gap is the picture. */
function Comparison({ v, s }: { v: Extract<Visual, { kind: 'comparison' }>; s: Scale }) {
  const max = Math.max(...v.rows.map(r => Math.abs(r.pct)), 1)
  return (
    <div data-explore-visual="comparison" className={clsx('space-y-1', s.root)}>
      {v.rows.map((r, i) => (
        <div key={r.label} className="flex min-w-0 items-center gap-1.5">
          <Cap className="w-[52px] shrink-0 truncate">{r.label}</Cap>
          <div className={clsx('min-w-0 flex-1 overflow-hidden rounded-full', s.bar, TRACK)}>
            <div
              data-comparison-bar={r.label}
              className={clsx('h-full rounded-full', i === 0 ? 'bg-gray-900 dark:bg-white' : 'bg-gray-400 dark:bg-gray-500')}
              style={{ width: `${(Math.abs(r.pct) / max) * 100}%` }}
            />
          </div>
          <span className={clsx('w-[38px] shrink-0 text-right font-bold tabular-nums text-gray-700 dark:text-gray-200', s.note)}>
            {r.pct.toFixed(1)}%
          </span>
        </div>
      ))}
      {v.deltaLabel && (
        <p className={clsx('pt-0.5 text-right font-bold text-gray-500 dark:text-gray-400', s.note)}>
          {v.deltaLabel}
        </p>
      )}
    </div>
  )
}

/**
 * The move since anybody looked, with the looking marked.
 *
 * `LAST LOOK → +21% → TODAY` rather than a year of closes: the window that
 * matters starts at the review, and a full-history chart puts the interesting
 * stretch somewhere in the middle of a line with nothing to mark it.
 */
function LastLook({ v, s }: { v: Extract<Visual, { kind: 'last_look' }>; s: Scale }) {
  const up = v.movePct >= 0
  return (
    <div data-explore-visual="last_look" className={s.root}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={clsx('shrink-0 rounded-full border-2 border-gray-400 bg-white dark:bg-gray-900', s.dot)} aria-hidden />
        {/* The label gives way before the number does: "+21%" is the finding
            and "Last look 10mo" is context for it. */}
        {/* "Last look 10mo" is 14 characters between a dot, a rule and a
            number on a 178px card, and it drew as "LAST LOOK 1…" — the age
            truncated to a single digit, which is worse than no age at all
            because a reader cannot tell 1mo from 18mo. The card's own age
            stamp is in the header; this label only has to name the marker. */}
        <Cap className="shrink-0">Last look</Cap>
        <span className={clsx('min-w-0 flex-1', s.rule, TRACK)} aria-hidden />
        <span
          data-lastlook-move
          className={clsx(
            'shrink-0 font-bold tabular-nums leading-none', s.move,
            up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}
        >
          {up ? '+' : ''}{v.movePct.toFixed(0)}%
        </span>
        <span className={clsx('shrink-0 rounded-full', s.dot, up ? 'bg-emerald-500' : 'bg-rose-500')} aria-hidden />
      </div>
      <p className="mt-1 text-right text-[9px] font-bold uppercase tracking-wide text-gray-400">Today</p>
    </div>
  )
}

/** Where an authored thing has got to, as a rail rather than a chart. */
function Workflow({ v, s }: { v: Extract<Visual, { kind: 'workflow' }>; s: Scale }) {
  return (
    <div data-explore-visual="workflow" className={s.root}>
      {v.direction && (
        <span
          data-workflow-direction={v.direction}
          className={clsx(
            'inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            v.direction === 'buy'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
          )}
        >
          {v.direction}
        </span>
      )}
      {/* ── The rail, and ONE label ──────────────────────────────────────
          Every stage used to be captioned, four of them across a 178px cell,
          which left ~40px each at 8px type: "Idea / MODE… / DECIDI… / Done".
          Two of the four words were unreadable, and the two that fitted were
          the two that say least.
          The rail already shows progress — filled segments to the left of the
          marker, empty to the right — so the only word carrying information the
          shape does not is the stage it has actually reached. One label, at a
          size that can be read, under a rail that keeps its four segments. */}
      <div className={clsx('flex items-center gap-1', v.direction && 'mt-1.5')}>
        {v.stages.map((stage, i) => (
          <div
            key={stage}
            data-workflow-stage={stage}
            data-active={i === v.activeIndex}
            className={clsx(
              'min-w-0 flex-1 rounded-full', s.rail,
              i <= v.activeIndex ? 'bg-violet-500' : TRACK,
            )}
          />
        ))}
      </div>
      <p
        data-workflow-active-label
        className={clsx('mt-1.5 truncate font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400', s.note)}
      >
        {v.stages[v.activeIndex] ?? v.stages[0]}
      </p>
    </div>
  )
}

/** Somebody's words, as the hero. No chart, no metric, no track. */
function QuoteVisual({ v, s }: { v: Extract<Visual, { kind: 'quote' }>; s: Scale }) {
  return (
    <div data-explore-visual="quote" className={s.root}>
      <Quote className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" aria-hidden />
      <p
        data-quote-text
        className={clsx('mt-1 line-clamp-4 font-medium italic leading-[1.4] text-gray-800 dark:text-gray-100', s.body)}
      >
        {v.text}
      </p>
    </div>
  )
}

/**
 * The producer's own question, as the object.
 *
 * Deliberately NOT the quote treatment. A quote is somebody's stated view and
 * is set in italics as a thing that was said; this is a thing being ASKED, and
 * it reads as an open question — upright, with the mark of an unanswered
 * prompt beside it. The difference matters on a page carrying both.
 *
 * No answer buttons here. The card's action layer already owns what the reader
 * can do, and a second set of affordances inside the picture would be a fourth
 * place to click on a tile that has three.
 */
function QuestionVisual({ v, s }: { v: Extract<Visual, { kind: 'question' }>; s: Scale }) {
  return (
    <div data-explore-visual="question" className={s.root}>
      <HelpCircle className="h-3.5 w-3.5 text-amber-400 dark:text-amber-500" aria-hidden />
      <p
        data-question-text
        className={clsx('mt-1 line-clamp-3 font-semibold leading-[1.35] text-gray-800 dark:text-gray-100', s.body)}
      >
        {v.text}
      </p>
    </div>
  )
}

interface ExploreVisualProps {
  visual: Visual
  /** The sparkline, injected — this component never reaches for price data. */
  sparkline?: React.ReactNode
  now?: number
  /**
   * How much room the picture has. Defaults to the phone, so every existing
   * caller is unchanged by construction. See `SCALE`.
   */
  density?: VisualDensity
}

/**
 * One switch, so a new archetype is a new branch here and nothing else.
 *
 * `none` and `price_trend` both render whatever the caller injected: the first
 * gets nothing, and the second gets the existing sparkline rather than a second
 * implementation of one.
 */
export function ExploreVisualBlock({ visual, sparkline, now, density = 'card' }: ExploreVisualProps) {
  const t = now ?? Date.now()
  const s = SCALE[density]

  const body = (() => {
    switch (visual.kind) {
      case 'scenario_range': return <ScenarioRange v={visual} s={s} />
      case 'target_compare': return <TargetCompare v={visual} s={s} />
      case 'timeline': return <Timeline v={visual} now={t} s={s} />
      case 'exposure': return <Exposure v={visual} s={s} />
      case 'comparison': return <Comparison v={visual} s={s} />
      case 'last_look': return <LastLook v={visual} s={s} />
      case 'workflow': return <Workflow v={visual} s={s} />
      case 'quote': return <QuoteVisual v={visual} s={s} />
      case 'question': return <QuestionVisual v={visual} s={s} />
      case 'price_trend': return sparkline ? <div data-explore-visual="price_trend">{sparkline}</div> : null
      // Typography carries it. Deliberately renders nothing rather than a box.
      case 'none': return null
    }
  })()

  /*
   * The measure, applied ONCE here rather than nine times below.
   *
   * Not on the phone: the cap is 520px and a phone cell is 178px, so a
   * wrapper there would be a div that does nothing, on sixty cards. And not
   * on the sparkline either — `price_trend` hands back whatever the caller
   * injected, and a plotted series is the one picture that genuinely reads
   * better the wider it gets. Bounding a chart would be the opposite of this
   * rule rather than an instance of it.
   */
  if (density === 'card' || body === null || visual.kind === 'price_trend') return body
  return <div className={MEASURE}>{body}</div>
}
