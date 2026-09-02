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

const BAND: Record<VisualSize, string> = { lg: 'h-[46px]', md: 'h-[34px]', sm: 'h-[22px]' }
const FIG: Record<VisualSize, string> = { lg: 'text-[17px]', md: 'text-[14px]', sm: 'text-[12px]' }
const CHIP: Record<VisualSize, string> = { lg: 'text-[13px]', md: 'text-[11px]', sm: 'text-[10px]' }

/** The 10px uppercase rubric every primitive wears. */
export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-400">
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
        'font-mono font-semibold tabular-nums',
        FIG[size], tone ?? 'text-gray-900 dark:text-gray-100',
      )}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
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

      <div className={clsx('relative mt-2 w-full', BAND[size])}>
        {/* Beyond the range, at either end. Quiet, but visibly not the range. */}
        <div className="absolute inset-y-0 left-0 rounded-l-[3px] bg-rose-50 dark:bg-rose-950/25"
             style={{ width: `${at(bear)}%` }} />
        <div className="absolute inset-y-0 right-0 rounded-r-[3px] bg-rose-50 dark:bg-rose-950/25"
             style={{ left: `${at(bull)}%` }} />

        {/* What the desk underwrote, and where it ends. The boundaries are
            drawn heavier than the fill so the band has edges, not a fade. */}
        <div
          className="absolute inset-y-0 bg-slate-200/80 dark:bg-white/[0.09]"
          style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }}
        />
        <div className="absolute inset-y-0 w-[1.5px] bg-slate-400 dark:bg-white/35"
             style={{ left: `${at(bear)}%` }} />
        <div className="absolute inset-y-0 w-[1.5px] bg-slate-400 dark:bg-white/35"
             style={{ left: `calc(${at(bull)}% - 1.5px)` }} />
        {/* Base is a reference, not a boundary: inset and dashed. */}
        {base != null && (
          <div className="absolute inset-y-[6px] w-px border-l border-dashed border-slate-400/80 dark:border-white/30"
               style={{ left: `${at(base)}%` }} />
        )}

        {/* Today. The one element allowed to dominate. */}
        <div
          className={clsx('absolute inset-y-0 z-[1] w-[3px]', outside ? 'bg-rose-600' : 'bg-blue-600')}
          style={{ left: `calc(${at(spot)}% - 1.5px)` }}
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
      <div className={clsx('flex items-baseline justify-between', big ? 'mt-2.5' : 'mt-1.5')}>
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
        size === 'lg' ? 'h-[18px]' : size === 'md' ? 'h-[14px]' : 'h-[10px]',
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
  const lo = Math.min(...path.map(p => p.close), anchor.price)
  const hi = Math.max(...path.map(p => p.close), anchor.price)
  const span = hi - lo || hi * 0.02
  const h = size === 'lg' ? 46 : size === 'md' ? 34 : 22
  const y = (v: number) => h - ((v - lo) / span) * h

  // One point per horizontal pixel is far more than the eye resolves, so the
  // path is thinned to a fixed budget. The endpoints always survive.
  const BUDGET = size === 'sm' ? 40 : 90
  const step = Math.max(1, Math.ceil(path.length / BUDGET))
  const pts = path.filter((_, i) => i % step === 0 || i === path.length - 1)
  const d = pts.map((pt, i) =>
    `${i ? 'L' : 'M'}${((i / Math.max(1, pts.length - 1)) * 100).toFixed(2)},${y(pt.close).toFixed(2)}`
  ).join(' ')

  return (
    <div>
      <Caption>
        <span>
          Idea opened
          <span className="ml-1 font-mono tracking-normal text-gray-500">
            {anchor.approximate ? '~' : ''}{anchor.price.toFixed(2)}
          </span>
        </span>
        <span className="font-mono tracking-normal text-gray-500">{spot.toFixed(2)} now</span>
      </Caption>

      <div className="relative mt-2 w-full" style={{ height: h }}>
        <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none"
             className="absolute inset-0 h-full w-full overflow-visible">
          {/* The line the idea was written at, carried across the whole path
              so every later point reads as above it or below it. */}
          <line x1="0" x2="100" y1={y(anchor.price)} y2={y(anchor.price)}
                className="stroke-slate-400/70" strokeWidth="1"
                strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <path d={d} fill="none" className="stroke-slate-700 dark:stroke-slate-200"
                strokeWidth="1.5" vectorEffect="non-scaling-stroke"
                strokeLinejoin="round" strokeLinecap="round" />
          {/* Where the idea starts. */}
          <circle cx="0" cy={y(anchor.price)} r="3"
                  className="fill-white stroke-slate-600 dark:fill-[#141a25] dark:stroke-slate-300"
                  strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <circle cx="100" cy={y(spot)} r="3"
                  className="fill-blue-600 stroke-white dark:stroke-[#141a25]"
                  strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      {size !== 'sm' ? (
        <div className="mt-2">
          <Figure
            value={`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
            label="since idea opened" size={size}
          />
        </div>
      ) : (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}% <span className="font-sans">since opened</span>
        </p>
      )}
    </div>
  )
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

/* ------------------------------------------------------------- the case */

export interface CaseDimension { label: string; present: boolean; note?: string }

/**
 * What actually exists behind an idea.
 *
 * The terminal visual, for names with no framework, no target, no sizing
 * question and no position -- which, measured against production, is a real
 * share of the page. It is not a score and not a completion bar: the
 * dimensions are not all required, no strategy needs every one of them, and
 * the page has no opinion about how many an idea "should" have. Presence and
 * absence, stated plainly, with a count where the count is the interesting
 * part.
 *
 * The most conversational thing it can say is a mismatch -- three cases named
 * and none of them priced is a real gap that nothing else on the card
 * surfaces. An idea with nothing at all is not a rendering failure either:
 * that emptiness is the finding, and it is drawn deliberately rather than
 * left as blank space.
 */
export function CaseMap({
  dimensions, size = 'lg',
}: { dimensions: CaseDimension[]; size?: VisualSize }) {
  const have = dimensions.filter(d => d.present).length
  const small = size === 'sm'
  const shown = small ? dimensions.filter(d => d.present).slice(0, 3) : dimensions

  return (
    <div>
      <Caption>
        <span>On the record</span>
        <span className={clsx(
          'font-mono tracking-normal',
          have === 0 ? 'text-amber-700 dark:text-amber-500' : 'text-gray-500',
        )}>
          {have === 0 ? 'nothing yet' : `${have} of ${dimensions.length}`}
        </span>
      </Caption>

      {have === 0 && small ? (
        <p className="mt-2 text-[11px] italic text-gray-500">
          Only the claim above exists.
        </p>
      ) : (
        <div className={clsx('mt-2 flex flex-wrap gap-x-3 gap-y-1', small && 'gap-y-0.5')}>
          {shown.map(d => (
            <span key={d.label} className="inline-flex items-baseline gap-1.5">
              <span
                className={clsx(
                  'relative top-[-1px] inline-block h-[5px] w-[5px] shrink-0 rounded-full',
                  d.present ? 'bg-slate-600 dark:bg-slate-300' : 'bg-transparent ring-1 ring-gray-300 dark:ring-white/25',
                )}
              />
              <span className={clsx(
                'text-[10px] uppercase tracking-wider',
                d.present ? 'font-semibold text-gray-700 dark:text-gray-300' : 'text-gray-400',
              )}>
                {d.label}
              </span>
              {d.note && (
                <span className="font-mono text-[10px] tabular-nums text-gray-500">{d.note}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* The gap worth arguing about, where there is one. */}
      {!small && (
        <p className="mt-2.5 text-[11px] text-gray-500">
          {gapLine(dimensions)}
        </p>
      )}
    </div>
  )
}

function gapLine(dims: CaseDimension[]): string {
  const by = (l: string) => dims.find(d => d.label === l)
  const cases = by('Cases'), priced = by('Priced')
  if (cases?.present && !priced?.present) return 'Cases named, none priced.'
  if (!by('Claim')?.present) return 'No claim written.'
  if (dims.every(d => d.label === 'Claim' || !d.present)) return 'Nothing on the record but the claim.'
  const missing = dims.filter(d => !d.present).map(d => d.label.toLowerCase())
  return missing.length ? `No ${missing.slice(0, 3).join(', ')}.` : 'The case is fully written.'
}
