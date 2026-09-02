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

/* -------------------------------------------------------- exposure, age */

/**
 * What the book already holds, where there is no proposal to compare it with.
 *
 * A weaker statement than the sizing question -- there is no intent to measure
 * against -- but it is still an investment fact rather than a workflow one:
 * this name is already a real position, and how big it is changes what the
 * idea means. Drawn against the largest single stake in the book so the bars
 * are comparable between cards.
 */
export function ExposureBar({ held, size = 'lg' }: { held: number; size?: VisualSize }) {
  const SCALE = 30
  return (
    <div>
      <Caption>
        <span>Held in book</span>
        <span className="font-mono tracking-normal text-gray-500">{SCALE}% scale</span>
      </Caption>
      <div className={clsx(
        'mt-2 w-full overflow-hidden rounded-[3px] bg-slate-200/70 dark:bg-white/[0.09]',
        size === 'lg' ? 'h-[18px]' : size === 'md' ? 'h-[14px]' : 'h-[10px]',
      )}>
        <div className="h-full bg-slate-500 dark:bg-slate-400"
             style={{ width: `${Math.min(100, (held / SCALE) * 100)}%` }} />
      </div>
      {size !== 'sm' ? (
        <div className="mt-2"><Figure value={`${held.toFixed(1)}%`} label="of the book" size={size} /></div>
      ) : (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
          {held.toFixed(1)}% <span className="font-sans">of the book</span>
        </p>
      )}
    </div>
  )
}

/**
 * How long the idea has been open.
 *
 * The last fallback, and the only fact that is true of every idea. It is worth
 * drawing because it answers something a reader genuinely wants at scan speed
 * and cannot get from the prose: which of these has been sitting unresolved
 * the longest. Two cards side by side are comparable by bar length alone.
 *
 * ── What it is not ────────────────────────────────────────────────────────
 *
 * Not progress, and not time-in-stage. `created_at` says when the idea was
 * opened and nothing else -- it does not know when the idea reached its
 * current stage, so "decision ready for seven months" would be a claim the
 * data cannot support. The bar is a magnitude on a fixed twelve-month scale
 * with no end state to reach: a longer bar is an older idea, not a more
 * finished one. Past a year it simply pins full.
 */
export function AgeBar({
  days, opened, size = 'lg',
}: { days: number; opened: string; size?: VisualSize }) {
  const MONTHS = 12
  const months = days / 30.44
  const long = days >= 180
  return (
    <div>
      <Caption>
        <span>Open since <span className="ml-0.5 font-mono tracking-normal text-gray-500">{opened}</span></span>
        <span className="font-mono tracking-normal text-gray-400">{MONTHS}M</span>
      </Caption>
      <div className={clsx(
        'relative mt-2 w-full overflow-hidden rounded-[3px] bg-slate-200/70 dark:bg-white/[0.09]',
        size === 'lg' ? 'h-[18px]' : size === 'md' ? 'h-[14px]' : 'h-[10px]',
      )}>
        <div
          className={clsx('h-full', long ? 'bg-slate-600 dark:bg-slate-300' : 'bg-slate-400')}
          style={{ width: `${Math.min(100, (months / MONTHS) * 100)}%` }}
        />
        {/* Quarter marks, so a length can be read as a duration. */}
        {[25, 50, 75].map(q => (
          <span key={q} className="absolute inset-y-0 w-px bg-white/70 dark:bg-black/40"
                style={{ left: `${q}%` }} />
        ))}
      </div>
      {size !== 'sm' ? (
        <div className="mt-2">
          <Figure
            value={days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`}
            label="open, unresolved" size={size}
          />
        </div>
      ) : (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
          {days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`}{' '}
          <span className="font-sans">open</span>
        </p>
      )}
    </div>
  )
}
