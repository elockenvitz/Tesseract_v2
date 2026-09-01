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

/* ----------------------------------------------------------- state map */

/**
 * Where an idea sits in its lifecycle, and how long it has sat there.
 *
 * The fourth primitive, for the ideas that have no framework, no target and no
 * sizing question -- which, measured against production, is most of them. Those
 * cards used to be prose and metadata while the ones beside them carried real
 * geometry, so the page split into investment objects and text records.
 *
 * It answers a question the others cannot: an idea that has been decision-ready
 * for seven months is not the same object as one that reached decision-ready
 * last week, and nothing on the card said so.
 *
 * ── What it must not become ───────────────────────────────────────────────
 *
 * Not a progress bar. Maturity is a position among four named states, not a
 * percentage: `decision_ready` is the start of the decision, not the end of
 * anything, and filling the stations up to the current one would assert a
 * completion the data never claims. Exactly one station is ever marked.
 *
 * Every field here is already loaded and already true. It invents no price, no
 * target and no weight -- if it had any of those, a different primitive would
 * have been selected.
 */
const STATIONS: { m: IdeaMaturity; short: string }[] = [
  { m: 'researching', short: 'Research' },
  { m: 'thesis_forming', short: 'Thesis' },
  { m: 'deciding', short: 'Deciding' },
  { m: 'decision_ready', short: 'Ready' },
]

export function DecisionState({
  maturity, days, size = 'lg',
}: { maturity: IdeaMaturity; days: number; size?: VisualSize }) {
  const at = Math.max(0, STATIONS.findIndex(s => s.m === maturity))
  const ready = maturity === 'deciding' || maturity === 'decision_ready'
  const small = size === 'sm'
  const age = days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`

  return (
    <div>
      {!small && (
        <Caption>
          <span>Decision state</span>
          <span className="font-mono tracking-normal text-gray-500">{MATURITY_LABEL[maturity]}</span>
        </Caption>
      )}

      <div className={clsx('grid grid-cols-4', small ? 'mt-0' : 'mt-2.5')}>
        {STATIONS.map((st, i) => (
          <div key={st.m} className="relative flex min-w-0 flex-col items-center gap-1.5">
            {/* The run in from the station before, so the four read as a
                sequence without a rail passing under the marks. */}
            {i > 0 && (
              <span
                className={clsx(
                  'absolute right-1/2 h-px w-full bg-gray-200 dark:bg-white/15',
                  small ? 'top-[3px]' : 'top-[4px]',
                )}
              />
            )}
            <span
              className={clsx(
                'relative block rounded-full',
                i === at
                  ? clsx(
                      small ? 'h-[7px] w-[7px]' : 'h-[9px] w-[9px]',
                      ready ? 'bg-amber-500' : 'bg-slate-600 dark:bg-slate-300',
                    )
                  : clsx(
                      small ? 'h-[3px] w-[3px] translate-y-[2px]' : 'h-[4px] w-[4px] translate-y-[2.5px]',
                      'bg-gray-300 dark:bg-white/25',
                    ),
              )}
            />
            {!small && (
              <span className={clsx(
                'truncate text-[9.5px] uppercase tracking-wider',
                i === at
                  ? ready ? 'font-semibold text-amber-700 dark:text-amber-500'
                    : 'font-semibold text-gray-700 dark:text-gray-300'
                  : 'text-gray-400',
              )}>
                {st.short}
              </span>
            )}
          </div>
        ))}
      </div>

      {small ? (
        <p className="mt-2 font-mono text-[11px] tabular-nums text-gray-500">
          {age} <span className="font-sans">open</span>
        </p>
      ) : (
        <div className="mt-3">
          <Figure value={age} label="open" size={size} />
        </div>
      )}
    </div>
  )
}
