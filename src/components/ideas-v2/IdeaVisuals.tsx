/**
 * The visual objects an Ideas card is built from.
 *
 * ── Why the old ones read as placeholders ────────────────────────────────
 *
 * A 4px grey track with a 2px marker is a diagram of a range, not a picture of
 * one. It occupied space, it was technically truthful, and it told a reader
 * nothing they could not have read from the numbers beside it — so the page
 * looked like text with a line under it.
 *
 * These do three things the old ones did not: they fill the space they claim,
 * they distinguish the zones that matter (inside the desk's range, outside
 * it), and they state the asymmetry — how far to the bear case against how far
 * to the bull — which is the actual question somebody scanning a field of
 * ideas is asking.
 *
 * ── Colour has three jobs and no others ──────────────────────────────────
 *
 *   amber   work outstanding: a decision nobody has taken
 *   blue    today's price, and the range it still sits inside
 *   rose    price has left the range the desk itself wrote
 *
 * Direction is never coloured. A sell is a stance, not a warning, and painting
 * it red would collide with the one meaning rose is allowed to carry.
 */

import { clsx } from 'clsx'
import { MATURITY_LABEL, type IdeaMaturity } from '../../lib/desktop-ideas'

/**
 * One size scale, shared by all four primitives.
 *
 * `lg` on a featured card, `md` on a standard one, `sm` on a compact one. The
 * primitives differ in what they draw, never in how they are built: the same
 * caption above, the same geometry band, the same figure-over-label beneath.
 * That repetition is the point -- the middle of every card is the place the
 * page states what matters, and it should be recognisable as that before it is
 * read.
 */
export type VisualSize = 'lg' | 'md' | 'sm'

/**
 * Plot heights, and why they are this large.
 *
 * Every pass before 3S sized these to be tidy, and the result was a page of
 * hairlines: technically a chart, illegible as one. A reader has to be able to
 * see the SHAPE of a move -- the drawdown, the rally, the flat stretch --
 * without reading the percentage underneath it, and that needs real room.
 *
 * 3S then overcorrected. A 165px plot inside a padded zone inside a padded
 * card made a 503px featured tile, which buys legibility with most of the
 * first viewport. These are the sizes where the move still reads and the page
 * still holds several rows: the shell got compressed, not the chart.
 *
 * A range band is smaller than a price plot on purpose. It is horizontally
 * informative -- where spot sits between two written prices -- and height past
 * about 70px adds nothing to that.
 */
const BAND: Record<VisualSize, string> = { lg: 'h-[68px]', md: 'h-[52px]', sm: 'h-[30px]' }
const PLOT: Record<VisualSize, number> = { lg: 128, md: 88, sm: 54 }
const CHIP: Record<VisualSize, string> = { lg: 'text-[13px]', md: 'text-[12px]', sm: 'text-[11px]' }

/**
 * The typography, lifted from the mobile tiles rather than invented.
 *
 * Mobile states a metric at 17-19px bold with `leading-none`, and labels it at
 * 10px BOLD uppercase -- not the 10px semibold the desktop had, which is why
 * the desktop page read as grey instrumentation while the phone read as a
 * product. Desktop gets more room, so the hero figure grows rather than the
 * label shrinking.
 */
const FIG: Record<VisualSize, string> = {
  lg: 'text-[26px]', md: 'text-[21px]', sm: 'text-[16px]',
}

/** The 10px rubric every primitive wears. Bold, as on the phone. */
export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-wide text-gray-400">
      {children}
    </div>
  )
}

/** A figure over its label: the shared way every primitive states a number. */
function Figure({
  value, label, size, align, tone,
}: {
  value: string; label: string; size: VisualSize
  align?: 'right'; tone?: string
}) {
  return (
    <div className={align === 'right' ? 'text-right' : undefined}>
      <div className={clsx(
        'font-mono font-bold tabular-nums leading-none',
        FIG[size], tone ?? 'text-gray-900 dark:text-gray-100',
      )}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
        {label}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- stage */

/**
 * Where the idea is in the process, as a label.
 *
 * This was a four-station track for one stage, and before that a four-segment
 * fill. Both were the same mistake in different clothes: drawing workflow state
 * as geometry, in the place on the card where the page states investment
 * evidence. A reader scanning for what to understand about an idea was being
 * shown what queue it is in.
 *
 * Stage is categorical metadata. It gets a pill, next to the stance pill, and
 * the middle of the card is left for something that is actually about the
 * investment.
 *
 * It keeps its semantic colour: an unresolved decision is work outstanding,
 * and amber is what the page uses to say so.
 */
export function StagePill({ maturity }: { maturity: IdeaMaturity }) {
  const open = maturity === 'deciding' || maturity === 'decision_ready'
  return (
    <span
      className={clsx(
        'shrink-0 rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wider',
        open
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400'
          : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400',
      )}
    >
      {MATURITY_LABEL[maturity]}
    </span>
  )
}

/* ------------------------------------------------------------ framework */

export interface Range { bear: number; bull: number; base: number | null; spot: number }

/** How far spot sits from each end of the desk's range. */
export function asymmetry({ bear, bull, spot }: Range) {
  return {
    toBear: ((bear - spot) / spot) * 100,
    toBull: ((bull - spot) / spot) * 100,
    outside: spot > bull || spot < bear,
  }
}

/**
 * The desk's range, and where price sits in it.
 *
 * ── What it draws ────────────────────────────────────────────────────────
 *
 * A filled band between bear and bull, tinted rose in the region beyond either
 * end, with the base marked and spot carrying a value chip. Beneath it, the two
 * distances that matter: how far down to the bear case against how far up to
 * the bull. Those numbers are the reason to look at a framework at all.
 *
 * Everything is arranged so the eye lands on spot first. The ends are named in
 * one row above the band rather than scattered inside it, the boundaries are
 * drawn heavier than the fill, and spot is the only saturated mark.
 */
export function RangeChart({ range, size = 'lg' }: { range: Range; size?: VisualSize }) {
  const { bear, bull, base, spot } = range
  const { toBear, toBull, outside } = asymmetry(range)
  const lo = Math.min(bear, spot), hi = Math.max(bull, spot)
  const pad = (hi - lo) * 0.16 || hi * 0.06
  const min = lo - pad, max = hi + pad
  const at = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))
  const big = size !== 'sm'

  return (
    <div>
      {/* The ends are named once, above the band, so the geometry underneath
          carries no labels of its own. One row of words, not five. */}
      <Caption>
        <span>Bear <span className="ml-0.5 font-mono tracking-normal text-gray-500">{bear.toFixed(0)}</span></span>
        {base != null && (
          <span className="hidden sm:inline">
            Base <span className="ml-0.5 font-mono tracking-normal text-gray-500">{base.toFixed(0)}</span>
          </span>
        )}
        <span>Bull <span className="ml-0.5 font-mono tracking-normal text-gray-500">{bull.toFixed(0)}</span></span>
      </Caption>

      <div className={clsx('relative mt-1.5 w-full', BAND[size])}>
        {/* Beyond the range, at either end. Quiet, but visibly not the range. */}
        <div className="absolute inset-y-0 left-0 rounded-l-[3px] bg-rose-50 dark:bg-rose-950/25"
             style={{ width: `${at(bear)}%` }} />
        <div className="absolute inset-y-0 right-0 rounded-r-[3px] bg-rose-50 dark:bg-rose-950/25"
             style={{ left: `${at(bull)}%` }} />

        {/* What the desk underwrote, and where it ends. The boundaries are
            drawn heavier than the fill so the band has edges, not a fade. */}
        <div
          className="absolute inset-y-0 rounded-[2px] bg-slate-200/80 dark:bg-white/[0.09]"
          style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }}
        />
        <div className="absolute inset-y-0 w-[2px] bg-slate-400 dark:bg-white/35"
             style={{ left: `${at(bear)}%` }} />
        <div className="absolute inset-y-0 w-[2px] bg-slate-400 dark:bg-white/35"
             style={{ left: `calc(${at(bull)}% - 2px)` }} />
        {/* Base is a reference, not a boundary: inset and dashed. */}
        {base != null && (
          <div className="absolute inset-y-[6px] w-px border-l border-dashed border-slate-400/80 dark:border-white/30"
               style={{ left: `${at(base)}%` }} />
        )}

        {/* Today. The one element allowed to dominate.
            Drawn the way the phone draws it: an ink bar with a ring of the
            card's own ground around it, so it reads as sitting ON the range
            rather than as another tick beside the boundaries. */}
        <div
          className={clsx(
            'absolute inset-y-[-3px] z-[1] rounded-full ring-2 ring-white dark:ring-[#141a25]',
            size === 'sm' ? 'w-[4px]' : 'w-[5px]',
            outside ? 'bg-rose-600' : 'bg-blue-600',
          )}
          style={{ left: `calc(${at(spot)}% - ${size === 'sm' ? 2 : 2.5}px)` }}
        />
        <span
          className={clsx(
            'absolute top-1/2 z-[2] -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-[3px] font-mono font-semibold tabular-nums text-white shadow-sm',
            outside ? 'bg-rose-600' : 'bg-blue-600',
            CHIP[size],
            at(spot) > 62 ? '-translate-x-[calc(100%+7px)]' : 'translate-x-[7px]',
          )}
          style={{ left: `${at(spot)}%` }}
        >
          {spot.toFixed(2)}
        </span>
      </div>

      {/* The asymmetry: the reason to look at a framework at all. */}
      <div className={clsx('flex items-baseline justify-between', big ? 'mt-2' : 'mt-1.5')}>
        <Figure value={signed(toBear)} label="to bear" size={size} />
        {outside && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
            outside
          </span>
        )}
        <Figure value={signed(toBull)} label="to bull" size={size} align="right" />
      </div>
    </div>
  )
}

/** Both legs carry their own sign: past the bull case, the bull leg is negative. */
const signed = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`

/**
 * A single stated target, where there is no full range.
 *
 * A weaker statement of intent than a ladder, and drawn as one: a bar from
 * today to the target with the gap on it. Never dressed up to look like a
 * framework the desk has not written.
 */
export function TargetBar({
  spot, target, size = 'lg',
}: { spot: number; target: number; size?: VisualSize }) {
  const gap = ((target - spot) / spot) * 100
  const up = gap >= 0
  return (
    <div>
      <Caption>
        <span>Spot <span className="ml-0.5 font-mono tracking-normal text-gray-500">{spot.toFixed(2)}</span></span>
        <span>Target <span className="ml-0.5 font-mono tracking-normal text-gray-500">{target.toFixed(2)}</span></span>
      </Caption>
      <div className={clsx(
        'relative mt-2 w-full overflow-hidden rounded-[3px] bg-slate-200/70 dark:bg-white/[0.09]',
        size === 'lg' ? 'h-[16px]' : size === 'md' ? 'h-[13px]' : 'h-[10px]',
      )}>
        <div
          className={clsx('absolute inset-y-0', up ? 'bg-blue-600' : 'bg-slate-400')}
          style={{ width: `${Math.min(100, Math.abs(gap))}%`, ...(up ? { left: 0 } : { right: 0 }) }}
        />
      </div>
      {size !== 'sm' && (
        <div className="mt-2 flex items-baseline justify-between">
          <Figure value={signed(gap)} label="to target" size={size} />
        </div>
      )}
      {size === 'sm' && (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
          {signed(gap)} <span className="font-sans">to target</span>
        </p>
      )}
    </div>
  )
}

/**
 * What the book already holds against what is proposed.
 *
 * For an idea with no price framework but a real sizing question, which is a
 * different kind of setup and deserves its own picture rather than a blank.
 */
export function SizingBar({
  held, proposed, size = 'lg',
}: { held: number; proposed: number; size?: VisualSize }) {
  const max = Math.max(held, proposed, 1)
  const h = size === 'lg' ? 'h-[13px]' : size === 'md' ? 'h-[10px]' : 'h-[7px]'
  const row = (v: number, tone: string) => (
    <div className={clsx('w-full overflow-hidden rounded-[3px] bg-slate-200/70 dark:bg-white/[0.09]', h)}>
      <div className={clsx('h-full', tone)} style={{ width: `${(v / max) * 100}%` }} />
    </div>
  )
  return (
    <div>
      <Caption>
        <span>Held</span>
        <span>Proposed</span>
      </Caption>
      <div className="mt-2 flex flex-col gap-1">
        {row(held, 'bg-slate-400 dark:bg-slate-500')}
        {row(proposed, 'bg-blue-600')}
      </div>
      {size !== 'sm' ? (
        <div className="mt-2 flex items-baseline justify-between">
          <Figure value={`${held.toFixed(1)}%`} label="held" size={size} tone="text-gray-600 dark:text-gray-400" />
          <Figure value={signed(proposed - held)} label="change" size={size} align="right" />
        </div>
      ) : (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
          {held.toFixed(1)}% <span className="font-sans">held</span>
          {' \u2192 '}
          {proposed.toFixed(1)}% <span className="font-sans">proposed</span>
        </p>
      )}
    </div>
  )
}

/* --------------------------------------------------- since the idea opened */

export interface OpenAnchor {
  price: number
  date: string
  /** True when the anchor is the first close AFTER the idea was written. */
  approximate: boolean
}

/**
 * What the market has done since the idea was written.
 *
 * ── Why this and not a six-month chart ───────────────────────────────────
 *
 * An arbitrary window says what the stock did; this says what the stock did
 * *to us*. The origin is the day somebody wrote the idea down, so the figure
 * is the one that starts an argument: the market has moved 15% against this
 * and nobody has revisited the case.
 *
 * ── Direction is movement, not vindication ───────────────────────────────
 *
 * Deliberately monochrome. A stock up 14% since a buy was written is not proof
 * the thesis was right, and a stock down 14% is not proof it was wrong -- both
 * are reasons to look again, which is the only thing this visual is claiming.
 * Painting one green and the other red would assert a verdict the page has no
 * business reaching. Rose stays reserved for a framework the desk itself wrote
 * and price has left.
 */
export function SinceOpen({
  series, anchor, spot, size = 'lg',
}: {
  series: { date: string; close: number }[]
  anchor: OpenAnchor
  spot: number
  size?: VisualSize
}) {
  const pct = ((spot - anchor.price) / anchor.price) * 100
  const path = series.filter(p => p.date >= anchor.date)
  const [min, max] = domainFor(path.map(p => p.close).concat(anchor.price), anchor.price)
  const h = PLOT[size]
  const y = (v: number) => h - ((v - min) / (max - min)) * h

  const BUDGET = size === 'sm' ? 90 : 200
  const step = Math.max(1, Math.ceil(path.length / BUDGET))
  const pts = path.filter((_, i) => i % step === 0 || i === path.length - 1)
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * 100
  const line = pts.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(pt.close).toFixed(2)}`).join(' ')
  const area = `${line} L100,${y(anchor.price).toFixed(2)} L0,${y(anchor.price).toFixed(2)} Z`

  return (
    <div>
      {/* Open on the left, now on the right, with the move between them as the
          hero. The return used to sit under the chart as unrelated text. */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={clsx(
            'font-mono font-bold tabular-nums leading-none text-gray-900 dark:text-gray-100',
            FIG[size],
          )}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
          </div>
          {/* The opening price rides with the figure it is measured from,
              which is what let the separate axis row underneath the plot go. */}
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Since opened
            <span className="ml-1.5 font-mono tracking-normal text-gray-500">
              {anchor.approximate ? '~' : ''}{anchor.price.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={clsx('font-mono font-bold tabular-nums leading-none text-gray-900 dark:text-gray-100',
                               CHIP[size])}>
            {spot.toFixed(2)}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Now</div>
        </div>
      </div>

      <div className={clsx('relative w-full', size === 'sm' ? 'mt-1.5' : 'mt-2')} style={{ height: h }}>
        <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none"
             className="absolute inset-0 h-full w-full overflow-visible">
          <path d={area} className="fill-slate-500/[0.13] dark:fill-slate-300/[0.10]" />
          <line x1="0" x2="100" y1={y(anchor.price)} y2={y(anchor.price)}
                className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1"
                strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          <path d={line} fill="none" className="stroke-slate-900 dark:stroke-slate-100"
                strokeWidth={size === 'sm' ? 1.75 : 2.25} vectorEffect="non-scaling-stroke"
                strokeLinejoin="round" strokeLinecap="round" />
        </svg>

        {/* The two ends, marked the mobile way: an ink dot inside a ring of
            the card's own ground, so it sits ON the line rather than beside
            it.

            These are HTML, not SVG. The plot stretches to the card's width
            with `preserveAspectRatio="none"`, which scales x far more than y --
            a <circle> inside it comes out as a flat ellipse, which is what the
            first version shipped. Positioning them outside the stretched
            coordinate system is the only way they stay round at every width. */}
        <span
          className={clsx(
            'absolute z-[1] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-slate-500 bg-white dark:border-slate-400 dark:bg-[#141a25]',
            size === 'sm' ? 'h-[9px] w-[9px]' : 'h-[12px] w-[12px]',
          )}
          style={{ left: '0%', top: `${(y(anchor.price) / h) * 100}%` }}
        />
        <span
          className={clsx(
            'absolute z-[1] -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-900 ring-[2.5px] ring-white dark:bg-white dark:ring-[#141a25]',
            size === 'sm' ? 'h-[8px] w-[8px]' : 'h-[11px] w-[11px]',
          )}
          style={{ left: '100%', top: `${(y(spot) / h) * 100}%` }}
        />
      </div>

    </div>
  )
}

/**
 * The y-domain, derived from what actually happened.
 *
 * Read from the observed closes and the opening price, never forced to zero --
 * a stock that moved between 240 and 260 should fill the plot with that move,
 * not sit as a flat line in the top tenth of a 0-260 axis.
 *
 * The one guard is against the opposite failure. A name that genuinely did
 * nothing has a near-zero observed range, and scaling that to the full plot
 * turns rounding into a mountain. So the domain is never tighter than 1% of
 * the opening price: below that the line stays visibly flat, which is the
 * truth. Then 18% padding top and bottom so the path and its markers never run
 * along the edge of their own box.
 */
function domainFor(values: number[], anchorPrice: number): [number, number] {
  let lo = Math.min(...values), hi = Math.max(...values)
  const floor = anchorPrice * 0.01
  if (hi - lo < floor) {
    const mid = (hi + lo) / 2
    lo = mid - floor / 2
    hi = mid + floor / 2
  }
  const pad = (hi - lo) * 0.18
  return [lo - pad, hi + pad]
}

/* ------------------------------------------------------------- exposure */

/**
 * What the book already holds, in the book's own terms.
 *
 * The first version drew the weight against a fixed 30% track. That scale had
 * no source: there is no limit, policy or constraint table anywhere in the
 * schema, so the bar implied a ceiling the product does not have and cannot
 * defend. Worse, it made every weight look like progress toward a maximum.
 *
 * The honest comparison is the book itself. 25% is enormous in a fifty-name
 * fund and unremarkable in a four-name one, so the bar is drawn against the
 * largest position in the same book and the rank is stated in words. Nothing
 * here is a threshold; it is a standing.
 */
export function ExposureRank({
  pct, rank, of, largestPct, size = 'lg',
}: {
  pct: number; rank: number | null; of: number; largestPct: number
  size?: VisualSize
}) {
  const share = largestPct > 0 ? Math.min(100, (pct / largestPct) * 100) : 0
  return (
    <div>
      <Caption>
        <span>Held in book</span>
        <span className="font-mono tracking-normal text-gray-500">
          {rank != null ? `#${rank} of ${of}` : `${of} positions`}
        </span>
      </Caption>
      <div className={clsx(
        'mt-2 w-full overflow-hidden rounded-[3px] bg-slate-200/70 dark:bg-white/[0.09]',
        size === 'lg' ? 'h-[18px]' : size === 'md' ? 'h-[14px]' : 'h-[10px]',
      )}>
        <div className="h-full bg-slate-500 dark:bg-slate-400" style={{ width: `${share}%` }} />
      </div>
      {size !== 'sm' ? (
        <div className="mt-2">
          <Figure
            value={`${pct.toFixed(1)}%`}
            label={rank != null ? `${ordinal(rank)} largest of ${of}` : 'of the book'}
            size={size}
          />
        </div>
      ) : (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
          {pct.toFixed(1)}%{' '}
          <span className="font-sans">{rank != null ? `${ordinal(rank)} of ${of}` : 'of the book'}</span>
        </p>
      )}
    </div>
  )
}

const ordinal = (n: number) => {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/* ------------------------------------------------- the case, or its absence */

/**
 * Cases were written and nobody priced them.
 *
 * ── Why this is its own object ───────────────────────────────────────────
 *
 * The previous fallback drew a row of dimension dots and a "1 of 4" count,
 * which was a completeness score wearing different clothes -- and it treated
 * two completely different situations as one. An idea with three named cases
 * and no prices is not a thin idea; it is an idea where somebody did the
 * structural work and stopped one step short of the number that would make it
 * decidable. That gap is specific, common, and worth arguing about, and it
 * deserves to be stated rather than counted.
 *
 * The names come from scenario rows the scan already reads, so the card can
 * say WHICH cases exist. Nothing is invented: if a name is missing the cell is
 * simply unlabelled.
 */
export function CasesUnpriced({
  names, count, size = 'lg',
}: { names: string[]; count: number; size?: VisualSize }) {
  const cells = (names.length ? names : Array.from({ length: count }, () => '')).slice(0, 4)
  const small = size === 'sm'

  return (
    <div>
      {/* The relationship as the hero: this many written, this many priced.
          Two figures, never a fraction -- there is no denominator here, only
          a step somebody stopped at. */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={clsx('font-mono font-bold tabular-nums leading-none text-gray-900 dark:text-gray-100',
                               FIG[size])}>
            {count}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Cases written
          </div>
        </div>
        <span className={clsx('shrink-0 pb-1 text-gray-300 dark:text-white/25',
                              small ? 'text-[14px]' : 'text-[20px]')}>&rarr;</span>
        <div className="text-right">
          <div className={clsx('font-mono font-bold tabular-nums leading-none text-amber-600 dark:text-amber-400',
                               FIG[size])}>
            0
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Priced
          </div>
        </div>
      </div>

      {/* Each written case, and the empty place its number should occupy. */}
      <div className={clsx('mt-2.5 grid gap-1.5', small && 'mt-2')}
           style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((n, i) => (
          <div key={i} className={clsx(
            'flex flex-col items-center justify-center rounded-md bg-slate-100/80 dark:bg-white/[0.06]',
            size === 'lg' ? 'h-[40px]' : size === 'md' ? 'h-[34px]' : 'h-[22px]',
          )}>
            <span className={clsx('font-mono font-bold leading-none text-gray-400 dark:text-white/40',
                                  small ? 'text-[12px]' : 'text-[15px]')}>
              &mdash;
            </span>
            {n && !small && (
              <span className="mt-1 max-w-full truncate px-1 text-[9.5px] font-bold uppercase tracking-wide text-gray-500">
                {n}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Nothing has been modelled at all.
 *
 * The terminal state, and a real one: measured against production, several
 * open ideas have no scenario, no target, no position and no price history.
 * Four empty cells said that limply. A single blunt figure and the named
 * absences say it with the force it deserves -- the reaction should be "what
 * is actually behind this idea?", which is the most useful question the card
 * can provoke.
 *
 * Not a score. There is no denominator, because no strategy requires all of
 * these and the page has no view on how many an idea ought to have.
 */
export function ModelGap({
  gaps, size = 'lg',
}: { gaps: string[]; size?: VisualSize }) {
  const small = size === 'sm'
  /* Four stacked rows read as a table and cost a third of the card for four
     words. The same facts across one row say it faster and take a fifth of
     the space. */
  const cols = gaps.map(g => ({
    label: g.replace(/^No(t)? /, ''),
    value: g.startsWith('Not ') ? 'not held' : 'none',
  }))
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={clsx('font-mono font-bold tabular-nums leading-none text-amber-600 dark:text-amber-400',
                               FIG[size])}>
            0
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Modelled cases
          </div>
        </div>
      </div>

      <div className={clsx('grid gap-px overflow-hidden rounded-md bg-gray-200/70 dark:bg-white/10',
                           small ? 'mt-2' : 'mt-3')}
           style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
        {cols.map(c => (
          <div key={c.label}
               className={clsx('flex flex-col items-center bg-slate-50 dark:bg-[#161d29]',
                               small ? 'px-1 py-1.5' : 'px-1 py-2')}>
            <span className="max-w-full truncate text-[9.5px] font-bold uppercase tracking-wide text-gray-400">
              {c.label}
            </span>
            <span className={clsx('mt-0.5 font-semibold text-gray-500 dark:text-white/45',
                                  small ? 'text-[10px]' : 'text-[11px]')}>
              {c.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
