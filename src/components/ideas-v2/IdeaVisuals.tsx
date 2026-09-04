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

import { useRef, useState } from 'react'
import { indexAtClientX } from '../../lib/charts/scrub'
import { clsx } from 'clsx'
import { MATURITY_LABEL, type IdeaMaturity } from '../../lib/desktop-ideas'
// The one label treatment. These primitives predate the system file and had
// been carrying their own; a chart axis is a label like any other.
import { LABEL } from './ideas-system'

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
 * Brought down again from 128 / 88 / 54 once the range band came down to
 * 44 / 36 / 24. A row is as tall as its tallest card, so a plot twice the
 * height of the band beside it set the height for every card in the row and
 * left the shorter ones with a void above their rail. The move still reads at
 * 96 -- the floor this rule exists to defend was 46 / 34 / 22, which is where
 * a plot becomes a hairline, and these are well clear of it.
 *
 * A range band is smaller than a price plot on purpose. It is horizontally
 * informative -- where spot sits between two written prices -- and height past
 * about 70px adds nothing to that.
 */
const BAND: Record<VisualSize, string> = { lg: 'h-[44px]', md: 'h-[36px]', sm: 'h-[24px]' }
const PLOT: Record<VisualSize, number> = { lg: 96, md: 68, sm: 44 }
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
/**
 * Figures are read, not admired.
 *
 * These were 26 / 21 / 16px black mono -- larger than the ticker, which made
 * every card lead with a percentage instead of with the name it is about. On a
 * terminal the object is the headline and the numbers are dense, tabular and
 * subordinate; a 26px "+8%" is a consumer app's hero stat.
 */
const FIG: Record<VisualSize, string> = {
  lg: 'text-[19px]', md: 'text-[17px]', sm: 'text-[14px]',
}

/** The 10px rubric every primitive wears. Bold, as on the phone. */
export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
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
      <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        {label}
      </div>
    </div>
  )
}

/**
 * A named part of a primitive, made inspectable.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Every primitive is built the same way: a caption naming its parts, a piece
 * of geometry, and a figure under it. `RangeChart` proved that turning the
 * caption's names into controls -- hover or focus a part, its geometry
 * foregrounds and the figure row states that part exactly -- is what turns a
 * picture into something a reader can ask questions of.
 *
 * This is that one control, shared, so the other primitives get the same
 * behaviour without four copies of it. It is deliberately NOT a chart
 * abstraction: it owns a label, a selected flag and the affordance, and every
 * primitive still decides for itself what foregrounding means and what the
 * read-out says.
 *
 * `data-no-portal` and `pointer-events-auto` because these live inside cards
 * that are themselves portals -- inspecting a part must never be a navigation.
 */
export function CaptionPart({
  name, value, on, onEnter, onLeave, className,
}: {
  name: string
  /** The number beside the name, where the part has one. */
  value?: string
  on: boolean
  onEnter: () => void
  onLeave: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      data-no-portal
      data-testid={`part-${name.toLowerCase().replace(/\s+/g, '-')}`}
      data-selected={on || undefined}
      aria-pressed={on}
      aria-label={value ? `${name}, ${value}` : name}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={e => e.stopPropagation()}
      className={clsx(
        'pointer-events-auto relative z-[2] rounded-sm px-0.5 transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
        'focus-visible:outline-blue-600',
        on ? 'text-gray-900 dark:text-gray-100' : 'hover:text-gray-700 dark:hover:text-gray-300',
        className,
      )}
    >
      {name}
      {value && (
        <span className={clsx(
          'ml-0.5 font-mono tracking-normal',
          on ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500',
        )}>
          {value}
        </span>
      )}
    </button>
  )
}

/**
 * The read-out that replaces a figure row while a part is inspected.
 *
 * Same row, same height, so foregrounding never moves the card -- the rule the
 * reserved-strip work established and every primitive here now follows.
 */
export function PartReadout({ value, note }: { value: string; note: string }) {
  return (
    <span
      data-testid="part-readout"
      className="flex items-baseline gap-2 font-mono text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100"
    >
      {value}
      <span className="font-sans text-[11px] font-medium text-gray-500">{note}</span>
    </span>
  )
}

/* ---------------------------------------------------------------- stage */

/**
 * The stage, as type rather than as a badge.
 *
 * An amber capsule on every decision-ready idea put four filled warnings on
 * one screen for what is a workflow state, not a fault — and the card already
 * carries an amber edge where a decision is genuinely outstanding. The colour
 * survives on the word, which is where it is a label; the fill and the capsule
 * go, because they were what made a stage read louder than the claim beside it.
 *
 * A thin rule separates it from the direction it follows, so the two remain
 * two facts without either wearing a border.
 */
export function StagePill({ maturity }: { maturity: IdeaMaturity }) {
  const open = maturity === 'deciding' || maturity === 'decision_ready'
  return (
    <span
      className={clsx(
        'shrink-0 border-l pl-2 text-[10px] font-semibold uppercase tracking-[0.12em]',
        open
          ? 'border-gray-300 text-amber-700 dark:border-white/15 dark:text-amber-400'
          : 'border-gray-300 text-gray-500 dark:border-white/15 dark:text-gray-400',
      )}
    >
      {MATURITY_LABEL[maturity]}
    </span>
  )
}

/**
 * The performance figure, as its own way in.
 *
 * A plain block when nothing is listening, a button when something is. The
 * affordance is a pointer and a hover underline on the figure -- the card's
 * established treatment for text that opens something -- and never a chip or a
 * link colour.
 */
function FigureOpen({
  onOpen, children,
}: { onOpen?: () => void; children: React.ReactNode }) {
  if (!onOpen) return <div className="min-w-0">{children}</div>
  return (
    <button
      type="button"
      data-testid="performance-portal"
      onClick={e => { e.stopPropagation(); onOpen() }}
      className="min-w-0 rounded-sm text-left decoration-gray-400 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      {children}
    </button>
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
/** The three names a desk writes, in the order it writes them. */
const CASES = ['Bear', 'Base', 'Bull'] as const
export type CaseName = (typeof CASES)[number]

export function RangeChart({
  range, size = 'lg', onCase,
}: {
  range: Range
  size?: VisualSize
  /** Activating a case routes to framework work. Inspection needs no handler. */
  onCase?: (name: CaseName) => void
}) {
  const [picked, setPicked] = useState<CaseName | null>(null)
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
      {/*
        Each name is now the control for its own case.

        Resting, this is the same quiet row of words it was. Pointing at or
        tabbing to a case foregrounds it: its boundary thickens on the band
        below, and the row underneath states that case and its distance from
        today. Nothing is permanently expanded to say it, which is what keeps a
        field of ten cards calm while making each framework answerable.

        Buttons, so the keyboard reaches each case in reading order and Enter
        activates the same routing a click does. `data-no-portal` stops a
        reader inspecting cases from being navigated away by the card.
      */}
      <Caption>
        {CASES.map(c => {
          const value = c === 'Bear' ? bear : c === 'Base' ? base : bull
          if (value == null) return null
          const on = picked === c
          return (
            <button
              key={c}
              type="button"
              data-no-portal
              data-testid={`case-${c.toLowerCase()}`}
              data-selected={on || undefined}
              aria-pressed={on}
              aria-label={`${c} case at ${value.toFixed(2)}`}
              onPointerEnter={() => setPicked(c)}
              onPointerLeave={() => setPicked(null)}
              onFocus={() => setPicked(c)}
              onBlur={() => setPicked(null)}
              onClick={e => { e.stopPropagation(); onCase?.(c) }}
              className={clsx(
                // The card makes its whole body inert behind a stretched
                // open-affordance, so every real control must opt back in.
                // Without this the case buttons are unreachable: the
                // affordance sits above them and swallows the pointer.
                'pointer-events-auto relative z-[2]',
                'rounded-sm px-0.5 transition-colors focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-offset-1 focus-visible:outline-blue-600',
                c === 'Base' && 'hidden sm:inline',
                on ? 'text-gray-900 dark:text-gray-100' : 'hover:text-gray-700 dark:hover:text-gray-300',
              )}
            >
              {c}{' '}
              <span className={clsx(
                'ml-0.5 font-mono tracking-normal',
                on ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500',
              )}>
                {value.toFixed(0)}
              </span>
            </button>
          )
        })}
      </Caption>

      <div className={clsx('relative mt-1.5 w-full', BAND[size])}>
        {/* Beyond the range, at either end. Quiet, but visibly not the range. */}
        {/* Outside the desk's own range. Marked, not painted: a wash this
            faint reads as "not underwritten" without turning the card pink. */}
        <div className="absolute inset-y-0 left-0 bg-rose-500/[0.07] dark:bg-rose-400/[0.10]"
             style={{ width: `${at(bear)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-rose-500/[0.07] dark:bg-rose-400/[0.10]"
             style={{ left: `${at(bull)}%` }} />

        {/* What the desk underwrote, and where it ends. The boundaries are
            drawn heavier than the fill so the band has edges, not a fade. */}
        <div
          className="absolute inset-y-0 bg-slate-500/[0.07] dark:bg-white/[0.06]"
          style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }}
        />
        {/* The inspected boundary thickens. Colour and width only — the band
            never moves, so foregrounding a case cannot shift the card. */}
        <div className={clsx(
               'absolute inset-y-0 motion-safe:transition-[width,background-color] motion-safe:duration-100',
               picked === 'Bear' ? 'w-[3px] bg-slate-700 dark:bg-white/70' : 'w-[2px] bg-slate-400 dark:bg-white/35',
             )}
             style={{ left: `${at(bear)}%` }} />
        <div className={clsx(
               'absolute inset-y-0 motion-safe:transition-[width,background-color] motion-safe:duration-100',
               picked === 'Bull' ? 'w-[3px] bg-slate-700 dark:bg-white/70' : 'w-[2px] bg-slate-400 dark:bg-white/35',
             )}
             style={{ left: `calc(${at(bull)}% - 2px)` }} />
        {/* Base is a reference, not a boundary: inset and dashed. */}
        {base != null && (
          <div className={clsx(
                 'absolute inset-y-[6px] w-px border-l motion-safe:transition-colors',
                 picked === 'Base'
                   ? 'border-solid border-slate-700 dark:border-white/70'
                   : 'border-dashed border-slate-400/80 dark:border-white/30',
               )}
               style={{ left: `${at(base)}%` }} />
        )}

        {/* Today. The one element allowed to dominate.
            Drawn the way the phone draws it: an ink bar with a ring of the
            card's own ground around it, so it reads as sitting ON the range
            rather than as another tick beside the boundaries. */}
        <div
          className={clsx(
            'absolute inset-y-[-4px] z-[1] w-[2px]',
            outside ? 'bg-rose-600' : 'bg-blue-600',
          )}
          style={{ left: `calc(${at(spot)}% - 1px)` }}
        />
        {/*
          Today's price, as a reading rather than a badge.
          
          This was a filled, rounded, shadowed chip in white-on-blue floating
          over the band -- the single most consumer-looking mark on the card,
          and the one a reader's eye went to before the ticker. An instrument
          states a price in tabular type against the surface, next to the rule
          that locates it. The rule keeps the colour, because WHERE the price
          sits relative to the desk's own range is the fact worth colouring;
          the number itself is just a number.
        */}
        <span
          className={clsx(
            'absolute top-1/2 z-[2] -translate-y-1/2 whitespace-nowrap font-mono font-semibold tabular-nums',
            outside ? 'text-rose-700 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100',
            CHIP[size],
            at(spot) > 62 ? '-translate-x-[calc(100%+8px)]' : 'translate-x-[8px]',
          )}
          style={{ left: `${at(spot)}%` }}
        >
          {spot.toFixed(2)}
        </span>
      </div>

      {/*
        The asymmetry, or the case under inspection.

        One row, one height, either way: foregrounding a case swaps what this
        line says and never what it occupies, so nothing below a card moves
        while a reader runs across three cases.
      */}
      <div className={clsx('flex items-baseline justify-between', big ? 'mt-2' : 'mt-1.5')}>
        {picked ? (
          <span
            data-testid="case-readout"
            className="flex items-baseline gap-2 font-mono text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100"
          >
            {(picked === 'Bear' ? bear : picked === 'Base' ? base! : bull).toFixed(2)}
            <span className="font-sans text-[11px] font-medium text-gray-500">
              {picked.toLowerCase()} · {signed(
                (((picked === 'Bear' ? bear : picked === 'Base' ? base! : bull) - spot) / spot) * 100,
              )} from today
            </span>
          </span>
        ) : (
          <>
            <Figure value={signed(toBear)} label="to bear" size={size} />
            {outside && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                outside
              </span>
            )}
            <Figure value={signed(toBull)} label="to bull" size={size} align="right" />
          </>
        )}
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
  const [on, setOn] = useState<'Spot' | 'Target' | null>(null)

  // A padded domain, so neither mark ever sits on the edge of its own axis.
  const lo = Math.min(spot, target)
  const hi = Math.max(spot, target)
  const pad = Math.max((hi - lo) * 0.14, hi * 0.005) || 1
  const at = (v: number) => ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100
  const atSpot = at(spot)
  const atTarget = at(target)
  return (
    <div>
      <Caption>
        <CaptionPart
          name="Spot" value={spot.toFixed(2)} on={on === 'Spot'}
          onEnter={() => setOn('Spot')} onLeave={() => setOn(null)}
        />
        <CaptionPart
          name="Target" value={target.toFixed(2)} on={on === 'Target'}
          onEnter={() => setOn('Target')} onLeave={() => setOn(null)}
        />
      </Caption>
      {/*
        A price axis, not a meter.

        The filled bar this replaces was `width: |gap|%` -- a return
        percentage poured into a width fraction, which is a fraction of
        nothing. A 35% upside filled 35% of the track, a 140% upside filled
        all of it and clipped, and a downside filled from the right, so the
        same picture meant three unrelated things. It also read as a progress
        meter, which is the one thing a distance to an objective is not.

        Both marks now sit at their real prices on a shared, padded domain, so
        the space between them is the distance and the side the target falls
        on is the direction.
      */}
      <div
        data-testid="target-axis"
        className={clsx('relative mt-2 w-full', size === 'lg' ? 'h-[22px]' : size === 'md' ? 'h-[18px]' : 'h-[14px]')}
      >
        <div className={clsx(
          'absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors',
          on ? 'bg-slate-300 dark:bg-white/20' : 'bg-slate-200 dark:bg-white/[0.10]',
        )} />
        {/* The travel: spot to objective, drawn as the segment it is. */}
        <div
          className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-slate-800 dark:bg-slate-100"
          style={{ left: `${Math.min(atSpot, atTarget)}%`, width: `${Math.abs(atTarget - atSpot)}%` }}
        />
        {/* Spot: the open ring the price chart uses for "where we started". */}
        <span
          className={clsx(
            'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-slate-500 bg-white dark:border-slate-400 dark:bg-[#141a25]',
            size === 'sm' ? 'h-[8px] w-[8px]' : 'h-[10px] w-[10px]',
          )}
          style={{ left: `${atSpot}%` }}
        />
        {/* The objective: a rule, because it is a level somebody wrote down
            rather than a mark the market printed. */}
        <span
          className={clsx(
            'absolute top-1/2 w-[2px] -translate-x-1/2 -translate-y-1/2',
            on === 'Target' ? 'bg-slate-900 dark:bg-white' : 'bg-slate-600 dark:bg-slate-300',
            size === 'sm' ? 'h-[11px]' : 'h-[15px]',
          )}
          style={{ left: `${atTarget}%` }}
        />
      </div>
      {size !== 'sm' && (
        <div className="mt-2 flex items-baseline justify-between">
          {on ? (
            <PartReadout
              value={(on === 'Spot' ? spot : target).toFixed(2)}
              note={on === 'Spot' ? 'today' : `the objective · ${signed(gap)} away`}
            />
          ) : (
            <Figure value={signed(gap)} label="to target" size={size} />
          )}
        </div>
      )}
      {size === 'sm' && (
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
          {on ? (
            <span data-testid="part-readout" className="text-gray-900 dark:text-gray-100">
              {(on === 'Spot' ? spot : target).toFixed(2)}{' '}
              <span className="font-sans font-medium text-gray-500">
                {on === 'Spot' ? 'today' : `objective · ${signed(gap)}`}
              </span>
            </span>
          ) : (
            <>{signed(gap)} <span className="font-sans">to target</span></>
          )}
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
  const h = size === 'lg' ? 'h-[8px]' : size === 'md' ? 'h-[7px]' : 'h-[6px]'
  const [on, setOn] = useState<'Held' | 'Proposed' | null>(null)
  const row = (v: number, tone: string, lit: boolean) => (
    <div className={clsx(
      'w-full overflow-hidden rounded-[3px] transition-colors',
      lit ? 'bg-slate-300/80 dark:bg-white/[0.16]' : 'bg-slate-200/70 dark:bg-white/[0.09]',
      h,
    )}>
      <div
        className={clsx('h-full transition-[filter]', tone, lit && 'brightness-90')}
        style={{ width: `${(v / max) * 100}%` }}
      />
    </div>
  )
  return (
    <div>
      <Caption>
        <CaptionPart
          name="Held" on={on === 'Held'}
          onEnter={() => setOn('Held')} onLeave={() => setOn(null)}
        />
        <CaptionPart
          name="Proposed" on={on === 'Proposed'}
          onEnter={() => setOn('Proposed')} onLeave={() => setOn(null)}
        />
      </Caption>
      <div className="mt-2 flex flex-col gap-1">
        {row(held, 'bg-slate-400 dark:bg-slate-500', on === 'Held')}
        {row(proposed, 'bg-blue-600', on === 'Proposed')}
      </div>
      {size !== 'sm' ? (
        <div className="mt-2 flex items-baseline justify-between">
          {on ? (
            <PartReadout
              value={`${(on === 'Held' ? held : proposed).toFixed(1)}%`}
              note={on === 'Held' ? 'of the book today' : `proposed · ${signed(proposed - held)}`}
            />
          ) : (
            <>
              <Figure value={`${held.toFixed(1)}%`} label="held" size={size} tone="text-gray-600 dark:text-gray-400" />
              <Figure value={signed(proposed - held)} label="change" size={size} align="right" />
            </>
          )}
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
  series, anchor, spot, size = 'lg', onOpen,
}: {
  series: { date: string; close: number }[]
  anchor: OpenAnchor
  spot: number
  size?: VisualSize
  /**
   * Open the idea at its performance.
   *
   * Deliberately NOT the plot. The plot is scrubbed, and a pointer-down that
   * navigates would make inspecting the price a way to lose the field. The
   * figure beside it -- the move since the idea was raised -- is the summary
   * of what the plot shows, so it is the thing that opens it. It costs no
   * extra height, which a control under the chart would.
   */
  onOpen?: () => void
}) {
  /*
   * The plot answers a question when you point at it.
   *
   * The same contract Today's chart got: `indexAtClientX` from
   * `lib/charts/scrub`, which is the mapping `PriceContext` uses on the phone,
   * so a point picked here and a point picked there resolve identically. Mouse
   * only -- the touch path arbitrates against a scrolling feed, which a
   * desktop pointer does not have.
   *
   * One integer of local state. No query, no fetch, and the read-out swaps the
   * existing figures in place rather than adding a row, so scrubbing across a
   * card never moves the card or anything under it.
   */
  const plot = useRef<HTMLDivElement | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
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

  // The point under the pointer, and its move from the price the idea was
  // written at -- the same anchor the resting figure is measured from, so the
  // two can never disagree about their origin.
  const at = picked != null ? pts[picked] : null
  const atPct = at ? ((at.close - anchor.price) / anchor.price) * 100 : null

  /*
   * What makes this a chart rather than a sparkline.
   *
   * A bare line states a shape and refuses every question a reader actually
   * has: how high, how low, over what period, and where is the level I care
   * about. All four are already in the series -- nothing here is fetched or
   * invented -- and answering them is what a chart is FOR.
   *
   * The answers go in a scale gutter beside the plot rather than in labels
   * floating on it. Floated labels were the first attempt and they collided
   * with the current-price readout on the very first card, because the high of
   * a rising series is exactly where that readout already sits. A gutter can't
   * collide with anything: the series never enters it.
   *
   * Actual observations, not the padded domain bounds. "The high was 144.30"
   * is a fact about the position; "the axis tops out at 145.10" is a fact
   * about the drawing.
   */
  const hi = pts.reduce((m, q) => (q.close > m.close ? q : m), pts[0])
  const lo = pts.reduce((m, q) => (q.close < m.close ? q : m), pts[0])
  const frame = size !== 'sm'
  const day = (d: string) => d.slice(5).replace('-', '/')

  /*
   * Three levels, deduplicated.
   *
   * The anchor is very often the low -- an idea opened at its worst mark is
   * the ordinary case for anything that has worked -- and printing 131.80
   * twice, once as "since opened" and once as the low, is noise pretending to
   * be information. Anything within a couple of pixels of a level already
   * drawn is dropped instead.
   */
  // The tags are not printed. An axis does not label its own top tick "H" --
  // the position says that -- and "OPEN 133.14" was wider than the gutter, so
  // it hung back over the series it was meant to sit clear of. They survive as
  // keys, as the dedupe identity, and as the reason the open tick is inked
  // like the dashed rule it belongs to.
  const ticks: { v: number; tag: string }[] = []
  for (const t of [
    { v: hi.close, tag: 'H' },
    { v: anchor.price, tag: 'open' },
    { v: lo.close, tag: 'L' },
  ]) {
    if (ticks.some(u => Math.abs(y(u.v) - y(t.v)) < 11)) continue
    ticks.push(t)
  }

  return (
    <div>
      {/* Open on the left, now on the right, with the move between them as the
          hero. The return used to sit under the chart as unrelated text. */}
      <div className="flex items-end justify-between gap-3">
        <FigureOpen onOpen={onOpen}>
          <div className={clsx(
            'font-mono font-bold tabular-nums leading-none text-gray-900 dark:text-gray-100',
            FIG[size],
          )}>
            {at ? (
              <>{atPct! >= 0 ? '+' : ''}{atPct!.toFixed(1)}%</>
            ) : (
              <>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</>
            )}
          </div>
          {/* The opening price rides with the figure it is measured from,
              which is what let the separate axis row underneath the plot go. */}
          <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
            Since opened
            <span className="ml-1.5 font-mono tracking-normal text-gray-500">
              {anchor.approximate ? '~' : ''}{anchor.price.toFixed(2)}
            </span>
          </div>
        </FigureOpen>
        <div className="shrink-0 text-right">
          <div className={clsx('font-mono font-bold tabular-nums leading-none text-gray-900 dark:text-gray-100',
                               CHIP[size])}>
            {(at?.close ?? spot).toFixed(2)}
          </div>
          <div
            data-testid="since-readout"
            data-picked={picked ?? undefined}
            className="mt-1 whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400"
          >
            {at ? at.date.slice(5) : 'Now'}
          </div>
        </div>
      </div>

      <div className={clsx('flex items-start gap-2', size === 'sm' ? 'mt-1.5' : 'mt-2')}>
      <div className="min-w-0 flex-1">
      <div
        ref={plot}
        data-no-portal
        data-testid="since-plot"
        className="relative w-full cursor-crosshair"
        style={{ height: h }}
        onPointerMove={e => {
          if (e.pointerType !== 'mouse' || !plot.current) return
          setPicked(indexAtClientX(e.clientX, plot.current.getBoundingClientRect(), pts.length))
        }}
        onPointerLeave={() => setPicked(null)}
      >
        <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none"
             className="absolute inset-0 h-full w-full overflow-visible">
          {/* The frame. Faint enough to read behind the series, present
              enough that the eye can place a value on it. */}
          {frame && [0.25, 0.5, 0.75].map(f => (
            <line
              key={f} x1="0" x2="100" y1={h * f} y2={h * f}
              className="stroke-gray-200/70 dark:stroke-white/[0.07]"
              strokeWidth="1" vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} className="fill-slate-500/[0.10] dark:fill-slate-300/[0.08]" />
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

        {/* The inspected point, drawn only while it is inspected. */}
        {at && picked != null && (
          <>
            <span
              className="absolute inset-y-0 z-[1] w-px bg-slate-400 dark:bg-slate-500"
              style={{ left: `${x(picked)}%` }}
            />
            <span
              className={clsx(
                'absolute z-[2] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600 ring-[2.5px] ring-white dark:ring-[#141a25]',
                size === 'sm' ? 'h-[8px] w-[8px]' : 'h-[10px] w-[10px]',
              )}
              style={{ left: `${x(picked)}%`, top: `${(y(at.close) / h) * 100}%` }}
            />
          </>
        )}
      </div>

      {/*
        The window, stated, under the plot it belongs to -- which is why it
        lives inside this column rather than beside the scale. A price path
        with no period is a shape with no claim: the rule mobile's
        `TileSparkline` established, and the reason every visual here names its
        own window.
      */}
      {frame && pts.length > 1 && (
        <div className={clsx('mt-1 flex items-baseline justify-between', LABEL)}>
          <span>{day(pts[0].date)}</span>
          <span className="font-mono tracking-normal normal-case text-gray-400">
            {pts.length}d
          </span>
          <span>{day(pts[pts.length - 1].date)}</span>
        </div>
      )}
      </div>

      {/*
        The price scale.
        Narrow, quiet, and outside the plot, so a level can be read off the
        gridline it sits on without anything overlapping the series.
      */}
      {frame && (
        <div className="relative w-[38px] shrink-0" style={{ height: h }} aria-hidden>
          {ticks.map(t => (
            <div
              key={t.tag}
              data-tick={t.tag}
              className={clsx(
                'absolute right-0 -translate-y-1/2 font-mono text-[10px] tabular-nums',
                // The open level is the one the return is measured from, and
                // it is already drawn as a dashed rule across the plot. Same
                // slate as that rule, so the number and the line read as one
                // statement rather than two.
                t.tag === 'open'
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-gray-400 dark:text-gray-500',
              )}
              // Clamped inside the band: a tick at the very top or bottom is
              // half outside the plot it is labelling, and the bottom one
              // landed on the date row.
              style={{ top: `${Math.min(93, Math.max(7, (y(t.v) / h) * 100))}%` }}
            >
              {t.v.toFixed(2)}
            </div>
          ))}
        </div>
      )}
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
/**
 * Where this position sits in the shape of the book that holds it.
 *
 * ── What was here, and why it said nothing ───────────────────────────────
 *
 * A single bar filled to `pct / largestPct`. For the largest position in any
 * book that is a bar filled to 100%, which is the exact moment a reader most
 * wants to know something and the exact moment the visual had least to say.
 * It was a progress bar for something that is not progress.
 *
 * ── What it draws now ────────────────────────────────────────────────────
 *
 * Every position in the book, largest first, one hairline each, with this one
 * inked. The reader gets three answers from one shape they could not get from
 * the bar: how big this stake is, how big it is RELATIVE TO the rest, and
 * whether the book is concentrated or flat. A 7.4% top position in a book
 * that decays to 0.3% is a different fact from a 7.4% top position in a book
 * where nine names sit above 6%, and the old bar drew both identically.
 *
 * Nothing is invented. The weights are the same sorted array the hook already
 * built to compute `rank`; it simply stopped throwing them away.
 */
export function ExposureRank({
  pct, rank, of, largestPct, weights, size = 'lg',
}: {
  pct: number; rank: number | null; of: number; largestPct: number
  /** The book's weights, largest first. Empty falls back to the lone stake. */
  weights?: number[]
  size?: VisualSize
}) {
  const [on, setOn] = useState<'Held in book' | 'Rank' | null>(null)

  // The scale is the book's own biggest stake, so a bar's height is a real
  // proportion rather than a normalised one.
  const bars = weights?.length ? weights : [pct]
  const ceil = Math.max(largestPct, ...bars, pct) || 1
  // `rank` is 1-based and may exceed the cap the hook applies to the array.
  const mine = rank != null && rank - 1 < bars.length ? rank - 1 : -1
  return (
    <div>
      <Caption>
        <CaptionPart
          name="Held in book" on={on === 'Held in book'}
          onEnter={() => setOn('Held in book')} onLeave={() => setOn(null)}
        />
        <CaptionPart
          name="Rank"
          value={rank != null ? `#${rank} of ${of}` : `${of} positions`}
          on={on === 'Rank'}
          onEnter={() => setOn('Rank')} onLeave={() => setOn(null)}
        />
      </Caption>
      {/*
        One column per position. Gaps come from `gap-px` rather than from
        per-bar margins, so a 40-name book and a 6-name book both fill the
        width without either being stretched into a different visual.
      */}
      <div
        data-testid="exposure-book"
        className={clsx(
          'mt-2 flex w-full items-end gap-px',
          size === 'lg' ? 'h-[38px]' : size === 'md' ? 'h-[28px]' : 'h-[18px]',
        )}
      >
        {bars.map((w, i) => (
          <div
            key={i}
            data-mine={i === mine || undefined}
            className={clsx(
              'min-w-0 flex-1 rounded-t-[1px] transition-colors',
              i === mine
                ? 'bg-slate-800 dark:bg-slate-100'
                : on
                  ? 'bg-slate-400/70 dark:bg-white/25'
                  : 'bg-slate-300 dark:bg-white/[0.16]',
            )}
            // A floor of 2%: a 0.1% tail position is still a position, and a
            // bar of zero height reads as a book that ends early.
            style={{ height: `${Math.max(2, (w / ceil) * 100)}%` }}
          />
        ))}
      </div>
      {size !== 'sm' ? (
        <div className="mt-2">
          {on ? (
            <PartReadout
              value={on === 'Rank' && rank != null ? ordinal(rank) : `${pct.toFixed(1)}%`}
              note={on === 'Rank'
                ? `of ${of} positions · largest is ${largestPct.toFixed(1)}%`
                : `of the book · every position drawn, largest ${largestPct.toFixed(1)}%`}
            />
          ) : (
            <Figure
              value={`${pct.toFixed(1)}%`}
              label={rank != null ? `${ordinal(rank)} largest of ${of}` : 'of the book'}
              size={size}
            />
          )}
        </div>
      ) : (
        /* The compact card inspects too. It says less, not nothing -- a
           reader on a small tile is asking the same question. */
        <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
          {on ? (
            <span data-testid="part-readout" className="text-gray-900 dark:text-gray-100">
              {on === 'Rank' && rank != null ? ordinal(rank) : `${pct.toFixed(1)}%`}{' '}
              <span className="font-sans font-medium text-gray-500">
                {on === 'Rank' ? `of ${of} · largest ${largestPct.toFixed(1)}%` : 'of the book'}
              </span>
            </span>
          ) : (
            <>
              {pct.toFixed(1)}%{' '}
              <span className="font-sans">{rank != null ? `${ordinal(rank)} of ${of}` : 'of the book'}</span>
            </>
          )}
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
          <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
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
          <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
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
              <span className="mt-1 max-w-full truncate px-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-500">
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
          <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
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
            <span className="max-w-full truncate text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
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
