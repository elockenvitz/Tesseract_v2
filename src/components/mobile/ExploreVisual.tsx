import { clsx } from 'clsx'
import { Quote } from 'lucide-react'

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
function ScenarioRange({ v }: { v: Extract<Visual, { kind: 'scenario_range' }> }) {
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
    <div data-explore-visual="scenario_range" className="mt-2">
      {/* The deviation leads, because "the market escaped my range" is the
          finding and the band is the evidence for it. */}
      {outside && deviation != null && (
        <div className="mb-1.5 flex min-w-0 items-baseline gap-1.5">
          <span
            data-scenario-deviation
            className={clsx(
              'text-[17px] font-bold tabular-nums leading-none',
              above ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
            )}
          >
            {deviation >= 0 ? '+' : ''}{deviation.toFixed(0)}%
          </span>
          <Cap className="min-w-0 truncate">{above ? 'above your highest case' : 'below your lowest case'}</Cap>
        </div>
      )}

      <div className="relative h-5">
        {/* The modelled band. Solid, because it is the thing that was stated. */}
        <div
          data-scenario-band
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gray-300 dark:bg-gray-600"
          style={{ left: `${pos(v.low)}%`, width: `${pos(v.high) - pos(v.low)}%` }}
        />
        {/* The rest of the axis, so the marker has somewhere to be. */}
        <div className={clsx('absolute inset-x-0 top-1/2 h-px -translate-y-1/2', TRACK)} aria-hidden />
        {/* Every case gets a tick, so a three-case ladder does not read as two. */}
        {(v.cases ?? []).map(c => (
          <div
            key={`${c.label}:${c.price}`}
            data-scenario-case={c.label}
            className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-gray-500 dark:bg-gray-400"
            style={{ left: `${clamp(pos(c.price))}%` }}
          />
        ))}
        <div
          data-scenario-current
          className={clsx(
            'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-gray-900',
            outside
              ? above ? 'bg-emerald-500' : 'bg-rose-500'
              : 'bg-gray-900 dark:bg-white',
          )}
          style={{ left: `${clamp(pos(v.current))}%` }}
        />
      </div>

      <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
        <Cap className="min-w-0 truncate">{v.breachedLabel ? `${v.breachedLabel} ${money(edge)}` : `${money(v.low)}–${money(v.high)}`}</Cap>
        <span className="shrink-0 text-[10px] font-bold tabular-nums text-gray-700 dark:text-gray-200">
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
function TargetCompare({ v }: { v: Extract<Visual, { kind: 'target_compare' }> }) {
  const has = v.target != null
  const upside = has && v.current > 0 ? ((v.target! - v.current) / v.current) * 100 : null

  return (
    <div data-explore-visual="target_compare" className="mt-2">
      <div className="flex items-baseline justify-between">
        <Cap>Current</Cap>
        <Cap>{v.targetLabel ?? 'Target'}</Cap>
      </div>
      {/* `min-w-0` on the row, and the money labels truncate rather than set a
          floor. Without both, a four-figure price and a four-figure target on a
          half-width card push the row past the column — which at 390px is a
          horizontally scrolling PAGE, not a clipped label. */}
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-[13px] font-bold tabular-nums text-gray-900 dark:text-white">
          {money(v.current)}
        </span>
        <span className="h-2 w-2 shrink-0 rounded-full bg-gray-900 dark:bg-white" aria-hidden />
        <span
          className={clsx(
            'h-px min-w-0 flex-1',
            has ? TRACK : 'border-t border-dashed border-gray-300 dark:border-gray-600',
          )}
          aria-hidden
        />
        {has ? (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full border-2 border-gray-900 bg-white dark:border-white dark:bg-gray-900" aria-hidden />
            <span data-target-value className="min-w-0 truncate text-[13px] font-bold tabular-nums text-gray-900 dark:text-white">
              {money(v.target!)}
            </span>
          </>
        ) : (
          /* Not a zero, not a dash on the axis — a stated absence. Implying a
             number here is the one thing a no-target card must not do. */
          <span
            data-target-empty
            className="min-w-0 shrink truncate rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:border-gray-600"
          >
            Not set
          </span>
        )}
      </div>
      {upside != null && (
        <p className="mt-1 text-[10px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
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
function Timeline({ v, now }: { v: Extract<Visual, { kind: 'timeline' }>; now: number }) {
  const t0 = new Date(v.statedAt).getTime()
  const t1 = new Date(v.dueAt).getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null
  const t2 = Math.max(now, t1 + 1)

  const honoured = t1 - t0
  const over = t2 - t1
  // Floored so a badly overdue view still shows the stretch it was given.
  const pct = Math.min(Math.max((honoured / (t2 - t0)) * 100, 22), 78)

  return (
    <div data-explore-visual="timeline" className="mt-2">
      <div className="flex h-2 w-full items-stretch gap-0.5">
        <div className={clsx('rounded-l-full', TRACK)} style={{ width: `${pct}%` }} />
        <div
          data-timeline-overdue
          className="rounded-r-full bg-amber-400 dark:bg-amber-500"
          style={{ width: `${100 - pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <Cap>Set {shortDate(v.statedAt)}</Cap>
        <Cap className="text-amber-600 dark:text-amber-400">Due {shortDate(v.dueAt)}</Cap>
      </div>
      <p className="mt-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
        +{elapsed(over)} overdue
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
function Exposure({ v }: { v: Extract<Visual, { kind: 'exposure' }> }) {
  const pct = Math.min((v.weightPct / 20) * 100, 100)
  return (
    <div data-explore-visual="exposure" className="mt-2">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span data-exposure-value className="text-[17px] font-bold tabular-nums leading-none text-gray-900 dark:text-white">
          {v.weightPct.toFixed(1)}%
        </span>
        <Cap className="min-w-0 truncate">{v.portfolioName ? `of ${v.portfolioName}` : 'of the book'}</Cap>
      </div>
      <div className={clsx('mt-1.5 h-2 w-full overflow-hidden rounded-full', TRACK)}>
        <div className="h-full rounded-full bg-gray-900 dark:bg-white" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Two weights that disagree, drawn to one scale so the gap is the picture. */
function Comparison({ v }: { v: Extract<Visual, { kind: 'comparison' }> }) {
  const max = Math.max(...v.rows.map(r => Math.abs(r.pct)), 1)
  return (
    <div data-explore-visual="comparison" className="mt-2 space-y-1">
      {v.rows.map((r, i) => (
        <div key={r.label} className="flex min-w-0 items-center gap-1.5">
          <Cap className="w-[52px] shrink-0 truncate">{r.label}</Cap>
          <div className={clsx('h-2 min-w-0 flex-1 overflow-hidden rounded-full', TRACK)}>
            <div
              data-comparison-bar={r.label}
              className={clsx('h-full rounded-full', i === 0 ? 'bg-gray-900 dark:bg-white' : 'bg-gray-400 dark:bg-gray-500')}
              style={{ width: `${(Math.abs(r.pct) / max) * 100}%` }}
            />
          </div>
          <span className="w-[38px] shrink-0 text-right text-[10px] font-bold tabular-nums text-gray-700 dark:text-gray-200">
            {r.pct.toFixed(1)}%
          </span>
        </div>
      ))}
      {v.deltaLabel && (
        <p className="pt-0.5 text-right text-[10px] font-bold text-gray-500 dark:text-gray-400">
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
function LastLook({ v, now }: { v: Extract<Visual, { kind: 'last_look' }>; now: number }) {
  const t = new Date(v.lastLookAt).getTime()
  const since = Number.isFinite(t) ? elapsed(now - t) : null
  const up = v.movePct >= 0
  return (
    <div data-explore-visual="last_look" className="mt-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full border-2 border-gray-400 bg-white dark:bg-gray-900" aria-hidden />
        {/* The label gives way before the number does: "+21%" is the finding
            and "Last look 10mo" is context for it. */}
        <Cap className="min-w-0 truncate">Last look{since ? ` ${since}` : ''}</Cap>
        <span className={clsx('h-px min-w-0 flex-1', TRACK)} aria-hidden />
        <span
          data-lastlook-move
          className={clsx(
            'shrink-0 text-[15px] font-bold tabular-nums leading-none',
            up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}
        >
          {up ? '+' : ''}{v.movePct.toFixed(0)}%
        </span>
        <span className={clsx('h-2 w-2 shrink-0 rounded-full', up ? 'bg-emerald-500' : 'bg-rose-500')} aria-hidden />
      </div>
      <p className="mt-1 text-right text-[9px] font-bold uppercase tracking-wide text-gray-400">Today</p>
    </div>
  )
}

/** Where an authored thing has got to, as a rail rather than a chart. */
function Workflow({ v }: { v: Extract<Visual, { kind: 'workflow' }> }) {
  return (
    <div data-explore-visual="workflow" className="mt-2">
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
      <div className={clsx('flex items-center gap-1', v.direction && 'mt-1.5')}>
        {v.stages.map((s, i) => (
          <div key={s} className="flex min-w-0 flex-1 flex-col gap-1">
            <div
              data-workflow-stage={s}
              data-active={i === v.activeIndex}
              className={clsx(
                'h-1 w-full rounded-full',
                i <= v.activeIndex ? 'bg-violet-500' : TRACK,
              )}
            />
            <span
              className={clsx(
                'truncate text-[8px] font-bold uppercase tracking-wide',
                i === v.activeIndex ? 'text-violet-600 dark:text-violet-400' : 'text-gray-400',
              )}
            >
              {s}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Somebody's words, as the hero. No chart, no metric, no track. */
function QuoteVisual({ v }: { v: Extract<Visual, { kind: 'quote' }> }) {
  return (
    <div data-explore-visual="quote" className="mt-2">
      <Quote className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" aria-hidden />
      <p
        data-quote-text
        className="mt-1 line-clamp-4 text-[14px] font-medium italic leading-[1.4] text-gray-800 dark:text-gray-100"
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
}

/**
 * One switch, so a new archetype is a new branch here and nothing else.
 *
 * `none` and `price_trend` both render whatever the caller injected: the first
 * gets nothing, and the second gets the existing sparkline rather than a second
 * implementation of one.
 */
export function ExploreVisualBlock({ visual, sparkline, now }: ExploreVisualProps) {
  const t = now ?? Date.now()
  switch (visual.kind) {
    case 'scenario_range': return <ScenarioRange v={visual} />
    case 'target_compare': return <TargetCompare v={visual} />
    case 'timeline': return <Timeline v={visual} now={t} />
    case 'exposure': return <Exposure v={visual} />
    case 'comparison': return <Comparison v={visual} />
    case 'last_look': return <LastLook v={visual} now={t} />
    case 'workflow': return <Workflow v={visual} />
    case 'quote': return <QuoteVisual v={visual} />
    case 'price_trend': return sparkline ? <div data-explore-visual="price_trend">{sparkline}</div> : null
    // Typography carries it. Deliberately renders nothing rather than a box.
    case 'none': return null
  }
}
