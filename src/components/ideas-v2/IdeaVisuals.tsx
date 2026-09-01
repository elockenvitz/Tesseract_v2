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

/* ------------------------------------------------------------ lifecycle */

/**
 * Where an idea has got to, drawn as a position rather than a quantity.
 *
 * The first attempt filled every step up to the current one. That is a progress
 * bar, and it said something false: four of four filled reads as complete,
 * three of four reads as 75%. Maturity is not a percentage. An idea that is
 * `deciding` has not finished three quarters of anything, and one that is
 * `decision_ready` is at the start of the work rather than the end of it.
 *
 * So: four fixed positions, exactly one of them marked. The unmarked ones are
 * hairline ticks, not empty track, so nothing reads as waiting to fill.
 */
const ORDER: IdeaMaturity[] = ['researching', 'thesis_forming', 'deciding', 'decision_ready']

export function MaturityTrack({
  maturity, size = 'sm',
}: { maturity: IdeaMaturity; size?: 'sm' | 'lg' }) {
  const at = Math.max(0, ORDER.indexOf(maturity))
  const ready = maturity === 'deciding' || maturity === 'decision_ready'
  const lg = size === 'lg'
  return (
    <div className="flex items-center gap-2" title={MATURITY_LABEL[maturity]}>
      <span className="flex items-center gap-[5px]">
        {ORDER.map((_, i) => (
          <span
            key={i}
            className={clsx(
              'block rounded-full',
              i === at
                ? clsx(
                    lg ? 'h-[7px] w-[7px]' : 'h-[6px] w-[6px]',
                    ready ? 'bg-amber-500' : 'bg-slate-600 dark:bg-slate-300',
                  )
                : clsx(
                    lg ? 'h-[3px] w-[3px]' : 'h-[2.5px] w-[2.5px]',
                    'bg-gray-300 dark:bg-white/25',
                  ),
            )}
          />
        ))}
      </span>
      <span className={clsx(
        'font-semibold uppercase tracking-wider',
        lg ? 'text-[11px]' : 'text-[10px]',
        ready ? 'text-amber-700 dark:text-amber-500' : 'text-gray-500',
      )}>
        {MATURITY_LABEL[maturity]}
      </span>
    </div>
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
export function RangeChart({ range, height = 'lg' }: { range: Range; height?: 'lg' | 'sm' }) {
  const { bear, bull, base, spot } = range
  const { toBear, toBull, outside } = asymmetry(range)
  const lo = Math.min(bear, spot), hi = Math.max(bull, spot)
  const pad = (hi - lo) * 0.16 || hi * 0.06
  const min = lo - pad, max = hi + pad
  const at = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))
  const big = height === 'lg'

  return (
    <div>
      {/* The ends are named once, above the band, so the geometry underneath
          carries no labels of its own. One row of words, not five. */}
      <div className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        <span>Bear <span className="ml-0.5 font-mono tracking-normal text-gray-500">{bear.toFixed(0)}</span></span>
        {base != null && (
          <span className="hidden sm:inline">
            Base <span className="ml-0.5 font-mono tracking-normal text-gray-500">{base.toFixed(0)}</span>
          </span>
        )}
        <span>Bull <span className="ml-0.5 font-mono tracking-normal text-gray-500">{bull.toFixed(0)}</span></span>
      </div>

      <div className={clsx('relative mt-2 w-full', big ? 'h-[46px]' : 'h-[30px]')}>
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
            big ? 'text-[13px]' : 'text-[11px]',
            at(spot) > 62 ? '-translate-x-[calc(100%+7px)]' : 'translate-x-[7px]',
          )}
          style={{ left: `${at(spot)}%` }}
        >
          {spot.toFixed(2)}
        </span>
      </div>

      {/* The asymmetry: the reason to look at a framework at all. */}
      <div className={clsx('flex items-baseline justify-between', big ? 'mt-2.5' : 'mt-2')}>
        <Leg label="to bear" pct={toBear} big={big} />
        {outside && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
            outside
          </span>
        )}
        <Leg label="to bull" pct={toBull} big={big} align="right" />
      </div>
    </div>
  )
}

function Leg({
  label, pct, big, align,
}: { label: string; pct: number; big: boolean; align?: 'right' }) {
  return (
    <div className={align === 'right' ? 'text-right' : undefined}>
      <div className={clsx(
        'font-mono font-semibold tabular-nums text-gray-900 dark:text-gray-100',
        big ? 'text-[17px]' : 'text-[13px]',
      )}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(0)}%
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  )
}

/**
 * A single stated target, where there is no full range.
 *
 * A weaker statement of intent than a ladder, and drawn as one: a bar from
 * today to the target with the gap on it. Never dressed up to look like a
 * framework the desk has not written.
 */
export function TargetBar({ spot, target }: { spot: number; target: number }) {
  const gap = ((target - spot) / spot) * 100
  const up = gap >= 0
  return (
    <div>
      <div className="relative h-[10px] w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.07]">
        <div
          className={clsx('absolute inset-y-0 rounded-full', up ? 'bg-blue-500' : 'bg-slate-400')}
          style={{ width: `${Math.min(100, Math.abs(gap))}%`, ...(up ? { left: 0 } : { right: 0 }) }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="font-mono text-[12px] tabular-nums text-gray-600 dark:text-gray-400">
          {spot.toFixed(2)}
        </span>
        <span className="font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
          {up ? '+' : ''}{gap.toFixed(0)}%
        </span>
        <span className="font-mono text-[12px] tabular-nums text-gray-600 dark:text-gray-400">
          {target.toFixed(2)} <span className="font-sans text-[10px] text-gray-400">target</span>
        </span>
      </div>
    </div>
  )
}

/**
 * What the book already holds against what is proposed.
 *
 * For an idea with no price framework but a real sizing question, which is a
 * different kind of setup and deserves its own picture rather than a blank.
 */
export function SizingBar({ held, proposed }: { held: number | null; proposed: number | null }) {
  const max = Math.max(held ?? 0, proposed ?? 0, 1)
  const row = (label: string, v: number | null, tone: string) => (
    <div className="flex items-center gap-2">
      <span className="w-[52px] shrink-0 text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
      <div className="h-[8px] min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.07]">
        {v != null && <div className={clsx('h-full rounded-full', tone)} style={{ width: `${(v / max) * 100}%` }} />}
      </div>
      <span className="w-[42px] shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums">
        {v != null ? `${v.toFixed(1)}%` : '—'}
      </span>
    </div>
  )
  return (
    <div className="flex flex-col gap-1.5">
      {row('Held', held, 'bg-slate-400')}
      {row('Proposed', proposed, 'bg-blue-500')}
    </div>
  )
}
