/**
 * The Ideas browse field.
 *
 * ── Why the previous version still felt haphazard ─────────────────────────
 *
 * Stage 3J fixed the cards. It did not fix the page. By the end there were
 * four separate layout grammars stacked down one surface: a bespoke editorial
 * cluster that put the lead and two stacked cells inside a single bordered
 * shell, a 7/5 second tier on a nine-then-twelve column grid, an even 4-up
 * scan row on a four-column grid, and a tail on a third grid behind a
 * hairline. Seven rank slots, four grids, three different sets of column
 * edges. Every one of those was defensible on its own; together they made the
 * eye relearn the page at every scroll position, which is what reads as
 * collage rather than workstation.
 *
 * ── One grid, three densities ─────────────────────────────────────────────
 *
 * Everything now sits on a single twelve-column grid, in rank order, sized by
 * one of three densities and nothing else:
 *
 *   FEATURED   ranks 1-2. Strongest type, the richest truthful visual, the
 *              most context. Eight columns then four.
 *   STANDARD   ranks 3-5. Ticker, claim, one real setup relationship, book
 *              and next action. Four columns each: three across.
 *   COMPACT    rank 6 and below. Ticker, stance, a clipped claim, one useful
 *              fact. Four columns, narrowing to three at the widest desktop.
 *
 * Eight is two of the four-column tracks below it, so the featured row's inner
 * edge lands exactly on a standard column edge. Every vertical line on the
 * page is a twelfth, and most are thirds. That invisible grid is what the
 * bespoke shapes were destroying.
 *
 * Height is never granted, only earned: the grid is `items-start`, no card
 * pushes its footer to the bottom of space it was given, and a card with no
 * framework to draw omits the slot rather than reserving it. Rank buys
 * position, width, type size and information depth. It does not buy blank
 * space, and it does not buy a new component type.
 *
 * ── One surface language ──────────────────────────────────────────────────
 *
 * All three densities are the same object: same radius, same border, same
 * internal order (stance and maturity, ticker, claim, setup, footer). Density
 * changes padding, type size, how much is said, and how deep the visual goes.
 * It does not change the design language. Featured is tinted; standard and
 * compact are white; that is the whole difference in ground.
 *
 * ── Colour is spent in three places ──────────────────────────────────────
 *
 *   amber   a decision nobody has taken
 *   blue    today's price, inside the range
 *   rose    price outside the range the desk wrote
 *
 * Direction gets none of it: a sell is a stance, not a warning.
 *
 * ── Not a button ─────────────────────────────────────────────────────────
 *
 * Quick actions sit inside every cell, and a button inside a button is invalid
 * and unreachable by keyboard. Each cell is a container with a stretched
 * open-affordance behind its content, so reading order, tab order and rank
 * order are the same order.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { Sparkles } from 'lucide-react'
import { MATURITY_LABEL, type IdeaRow } from '../../lib/desktop-ideas'
import type { ScanFrame } from '../../hooks/useDesktopIdeas'
import { DirectionPill } from './IdeaChrome'
import {
  MaturityTrack, RangeChart, TargetBar, SizingBar, asymmetry, type Range,
} from './IdeaVisuals'

/**
 * How much of the page an idea gets to be.
 *
 * Three, deliberately. The previous seven slots each had their own geometry,
 * which meant priority was expressed by making every rank a different kind of
 * object. Priority is expressed here by position, width, type and depth --
 * inside one system a reader only has to learn once.
 */
export type IdeaDensity = 'featured' | 'standard' | 'compact'

export function densityForRank(index: number): IdeaDensity {
  if (index <= 1) return 'featured'
  if (index <= 4) return 'standard'
  return 'compact'
}

/**
 * The span each rank claims on the page's single twelve-column grid.
 *
 * 8 + 4 across the top, then 4 / 4 / 4, then 4 / 4 / 4 narrowing to
 * 3 / 3 / 3 / 3 at the widest desktop. Eight is two four-column tracks, so the
 * featured row divides on a line the tiers below also divide on.
 */
export function spanForRank(index: number): string {
  if (index === 0) return 'col-span-12 lg:col-span-8'
  if (index === 1) return 'col-span-12 lg:col-span-4'
  if (index <= 4) return 'col-span-12 md:col-span-6 lg:col-span-4'
  return 'col-span-6 md:col-span-4 2xl:col-span-3'
}

export interface IdeaCardProps {
  idea: IdeaRow
  density: IdeaDensity
  /** Position in the ranking. Scales type and depth; never changes geometry. */
  rank: number
  frame?: ScanFrame
  weightPct?: number
  onOpen: () => void
  onAskAI: () => void
}

/** Everything a card needs to say, derived once. */
function read(idea: IdeaRow, frame?: ScanFrame, weightPct?: number) {
  const rung = (n: string) => frame?.ladder?.find(c => c.name === n)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull'), base = rung('Base')
  const spot = frame?.spot ?? null
  const range: Range | null =
    bear != null && bull != null && spot != null ? { bear, bull, base, spot } : null

  const deciding = idea.maturity === 'deciding' || idea.maturity === 'decision_ready'
  return {
    range,
    spot,
    target: frame?.target ?? null,
    deciding,
    /** What the setup actually is, which is not the same as its maturity. */
    setup: range ? 'framework' : frame?.target != null && spot != null ? 'target'
      : idea.proposedWeight != null || weightPct != null ? 'sizing' : 'claim',
    next: deciding ? 'Assess decision'
      : idea.maturity === 'thesis_forming' ? 'Develop the thesis'
      : 'Continue research',
    whyNow: [
      MATURITY_LABEL[idea.maturity],
      idea.portfolioName ? `in ${idea.portfolioName}` : 'no book assigned',
      weightPct != null ? `${weightPct.toFixed(1)}% held` : null,
      idea.proposedWeight != null ? `${idea.proposedWeight.toFixed(1)}% proposed` : null,
      range && asymmetry(range).outside ? 'price outside the range' : null,
    ].filter(Boolean).join(' · '),
    context: [
      idea.portfolioName,
      idea.conviction === 'high' ? 'High conviction' : null,
      weightPct != null ? `${weightPct.toFixed(1)}% held` : null,
    ].filter(Boolean).join(' · '),
  }
}

export function IdeaCard(props: IdeaCardProps) {
  switch (props.density) {
    case 'featured': return <FeaturedCard {...props} />
    case 'standard': return <StandardCard {...props} />
    default: return <CompactCard {...props} />
  }
}

/* ============================================================== featured */

/**
 * Ranks one and two.
 *
 * One composition, used by both. The lead does not get a two-column internal
 * split the second lacks -- that was a second layout family wearing the same
 * name, and it also meant the two cards' internal anchors never lined up.
 * Stacked in the same order at both widths, the ticker, the claim and the
 * chart of #1 sit on the same lines as #2's.
 *
 * #1 wins on position, on eight columns against four, on a larger ticker and a
 * deeper claim, and on having the richer setup to draw. It does not win by
 * being dramatically taller.
 */
function FeaturedCard(props: IdeaCardProps) {
  const { idea, rank, frame, weightPct } = props
  const d = read(idea, frame, weightPct)
  const first = rank === 0

  return (
    <Shell
      {...props}
      className={clsx(
        'bg-slate-50/80 dark:bg-white/[0.035]',
        d.deciding && 'border-l-[3px] border-l-amber-400',
      )}
      pad="p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DirectionPill direction={idea.direction} />
        <MaturityTrack maturity={idea.maturity} size="lg" />
      </div>

      <div className="mt-3.5 flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={clsx(
          'font-black leading-none tracking-[-0.04em]',
          first ? 'text-[34px]' : 'text-[26px]',
        )}>
          {idea.symbol ?? '—'}
        </span>
        {idea.companyName && (
          <span className="min-w-0 truncate text-[13px] font-medium text-gray-500">
            {idea.companyName}
          </span>
        )}
      </div>

      {idea.thesis ? (
        <p className={clsx(
          'mt-3 line-clamp-4 text-gray-900 dark:text-gray-100',
          first ? 'text-[17px] leading-[1.45]' : 'text-[14px] leading-[1.5]',
        )}>
          {idea.thesis}
        </p>
      ) : (
        <p className="mt-3 text-[13px] italic text-gray-500">No claim written yet.</p>
      )}

      {/* The setup, drawn on the card's own ground. No inner panel: a bordered
          white widget sitting on the featured tint read as a chart pasted onto
          the briefing rather than part of it. */}
      <Setup d={d} idea={idea} weightPct={weightPct} height={first ? 'lg' : 'sm'} />

      <div className="pt-4"><Footer {...props} d={d} size="featured" /></div>
    </Shell>
  )
}

/* ============================================================== standard */

/**
 * Ranks three to five: one coherent tier, three equal columns.
 *
 * They used to be a 7/5 pair and then a 4-up row on two different grids. Equal
 * width is the point -- priority among them comes from reading order and from
 * how much each actually has to say, not from a bespoke width ladder nobody
 * perceives as ranking anyway.
 */
function StandardCard(props: IdeaCardProps) {
  const { idea, frame, weightPct } = props
  const d = read(idea, frame, weightPct)

  return (
    <Shell
      {...props}
      className={clsx(
        'bg-white dark:bg-[#141a25]',
        d.deciding && 'border-l-[3px] border-l-amber-400',
      )}
      pad="p-4"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <DirectionPill direction={idea.direction} />
        <MaturityTrack maturity={idea.maturity} />
      </div>

      <div className="mt-2.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-black text-[20px] leading-none tracking-[-0.035em]">
          {idea.symbol ?? '—'}
        </span>
        {idea.companyName && (
          <span className="min-w-0 truncate text-[11.5px] font-medium text-gray-500">
            {idea.companyName}
          </span>
        )}
      </div>

      {idea.thesis ? (
        <p className="mt-2 line-clamp-3 text-[13px] leading-[1.5] text-gray-900 dark:text-gray-100">
          {idea.thesis}
        </p>
      ) : (
        <p className="mt-2 text-[12px] italic text-gray-500">No claim written yet.</p>
      )}

      <Setup d={d} idea={idea} weightPct={weightPct} height="sm" />

      <div className="pt-3"><Footer {...props} d={d} size="standard" /></div>
    </Shell>
  )
}

/* =============================================================== compact */

/**
 * Rank six and below: the same object, quieter.
 *
 * There is no tail. The bottom of the page is not a queue, a watchlist, a
 * ledger or a second list of work -- it is simply more ideas, in the same
 * grammar, at the density their rank earns. That continuity is the whole
 * simplification: the page stops having a phase transition in it.
 *
 * A full chart would not be readable at this width, so the framework arrives
 * as the concise relationship instead -- spot, then the two distances -- which
 * is the same intelligence the chart draws, at a size that fits.
 */
function CompactCard(props: IdeaCardProps) {
  const { idea, frame, weightPct } = props
  const d = read(idea, frame, weightPct)

  return (
    <Shell
      {...props}
      className={clsx(
        'bg-white dark:bg-[#141a25]',
        d.deciding && 'border-l-[3px] border-l-amber-400',
      )}
      pad="p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <DirectionPill direction={idea.direction} />
        <MaturityTrack maturity={idea.maturity} />
      </div>

      <div className="mt-2 font-black text-[16px] leading-none tracking-[-0.03em]">
        {idea.symbol ?? '—'}
      </div>

      <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.45] text-gray-900 dark:text-gray-100">
        {idea.thesis ?? 'No claim written yet.'}
      </p>

      <CompactFact d={d} idea={idea} weightPct={weightPct} />

      <div className="pt-2.5"><Footer {...props} d={d} size="compact" /></div>
    </Shell>
  )
}

/* ================================================================ pieces */

type Read = ReturnType<typeof read>

/**
 * The setup, drawn with whichever primitive the data actually supports.
 *
 * A range gets the chart, a lone target gets the bar, a real sizing question
 * gets the two weights, and an idea that is still only a belief gets nothing
 * at all -- not an empty wrapper, and nothing decorative standing in for the
 * absent one. An early-stage idea is not a broken late-stage one, and reserving
 * a visual slot it can never fill is what makes it look like one.
 */
function Setup({
  d, idea, weightPct, height,
}: { d: Read; idea: IdeaRow; weightPct?: number; height: 'lg' | 'sm' }) {
  if (d.range) {
    return <div className="mt-4"><RangeChart range={d.range} height={height} /></div>
  }
  if (d.target != null && d.spot != null) {
    return <div className="mt-4"><TargetBar spot={d.spot} target={d.target} /></div>
  }
  if (d.setup === 'sizing') {
    return (
      <div className="mt-4">
        <SizingBar held={weightPct ?? null} proposed={idea.proposedWeight} />
      </div>
    )
  }
  return null
}

/**
 * The compact form of the same intelligence: one fact, never a chart.
 *
 * Sizing appears only when both weights are real. A proposal against a dash is
 * not a relationship, and drawing it as one invents a comparison.
 */
function CompactFact({
  d, idea, weightPct,
}: { d: Read; idea: IdeaRow; weightPct?: number }) {
  if (d.range) {
    return (
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] tabular-nums">
        <span className="font-semibold">{d.range.spot.toFixed(2)}</span>
        <Legs range={d.range} />
      </p>
    )
  }
  if (d.target != null && d.spot != null) {
    const gap = ((d.target - d.spot) / d.spot) * 100
    return (
      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
        {gap >= 0 ? '+' : ''}{gap.toFixed(0)}% <span className="font-sans">to target</span>
      </p>
    )
  }
  if (weightPct != null && idea.proposedWeight != null) {
    return (
      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-gray-500">
        {weightPct.toFixed(1)}% <span className="font-sans">held</span>
        {' → '}
        {idea.proposedWeight.toFixed(1)}% <span className="font-sans">proposed</span>
      </p>
    )
  }
  return null
}

/**
 * The two distances, compactly, where a chart will not fit.
 *
 * Both legs carry their own sign. The bull leg is only positive while spot is
 * below the bull case -- once price has run past it the distance is negative,
 * and hard-coding a plus produced "+-10%": a broken figure on exactly the
 * ideas where the framework has been breached and the number matters most.
 */
function Legs({ range }: { range: Range }) {
  const { toBear, toBull, outside } = asymmetry(range)
  const signed = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`
  return (
    <span className={clsx('font-sans text-[11px]', outside ? 'text-rose-700 dark:text-rose-400' : 'text-gray-500')}>
      {signed(toBear)} / {signed(toBull)}
      <span className="ml-1 text-gray-400">bear / bull</span>
    </span>
  )
}

/**
 * The reserved strip: context and a next step, or why-now and two actions.
 *
 * Both layers are absolutely positioned inside one fixed height, so revealing
 * depth cannot move a neighbour or shift the grid — and it only ever covers
 * metadata, never the ticker, the claim or the chart. Every density carries
 * it, so Ask AI reaches every idea on the page regardless of rank.
 */
function Footer({
  d, onOpen, onAskAI, size,
}: IdeaCardProps & { d: Read; size: IdeaDensity }) {
  const compact = size === 'compact'
  return (
    <div className={clsx(
      'relative shrink-0',
      size === 'featured' ? 'h-[40px]' : compact ? 'h-[30px]' : 'h-[36px]',
    )}>
      <div className="absolute inset-0 flex flex-col justify-end gap-1 overflow-hidden opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
        <p className="truncate text-[11px] text-gray-500">{d.context || '—'}</p>
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Next · {d.next}
        </p>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col justify-end opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        {!compact && (
          <p className="truncate text-[11px] text-gray-700 dark:text-gray-300">
            <span className="mr-1.5 text-[9px] font-semibold uppercase tracking-widest text-gray-400">
              Why now
            </span>
            {d.whyNow}
          </p>
        )}
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            data-testid="idea-quick-open"
            onClick={e => { e.stopPropagation(); onOpen() }}
            className="relative z-[2] rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            {d.deciding ? 'Assess decision' : 'Open idea'}
          </button>
          <button
            type="button"
            data-testid="idea-quick-ai"
            onClick={e => { e.stopPropagation(); onAskAI() }}
            className="relative z-[2] inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-50 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:text-amber-400 dark:hover:bg-amber-950/30"
          >
            <Sparkles className="h-3 w-3" />
            Ask AI
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The interactive container every density shares.
 *
 * Same radius, same border, same hover response, same stretched
 * open-affordance. The span it claims on the page grid is the only thing rank
 * changes about it.
 */
function Shell({
  idea, density, rank, onOpen, className, pad, children,
}: IdeaCardProps & { className?: string; pad: string; children?: React.ReactNode }) {
  const [, setFocused] = useState(false)
  return (
    <div
      data-testid="idea-tile"
      data-density={density}
      data-rank={rank}
      data-maturity={idea.maturity}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={clsx(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-150 hover:border-gray-300 hover:shadow-md focus-within:border-gray-300 focus-within:shadow-md dark:border-white/[0.07]',
        spanForRank(rank),
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
      >
        <span className="sr-only">Open {idea.symbol ?? 'idea'}</span>
      </button>
      <div className={clsx('pointer-events-none relative z-[1] flex min-h-0 flex-1 flex-col', pad)}>
        {children}
      </div>
    </div>
  )
}
