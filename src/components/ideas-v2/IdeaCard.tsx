/**
 * The Ideas browse field.
 *
 * ── Why the previous versions read as a card wall ────────────────────────
 *
 * Stage 3G varied column spans. Stage 3H composed a cluster. Both left the
 * same underlying object on screen at four widths: white rectangle, grey
 * label, ticker, claim, hairline. Every card had the same silhouette, the same
 * ground, the same weight of ink, and the only visual was a 4px track that
 * told a reader nothing the numbers beside it did not.
 *
 * The fix is not more span arithmetic. Four things change here:
 *
 *   1. The ground differs by band. The lead sits on a tinted surface, the
 *      cluster's right column on plain white, the second tier on cards, and
 *      the tail on the page itself with hairline rules and no card at all. A
 *      wall of white rectangles stops being a wall when a third of it is not
 *      a rectangle.
 *   2. Each band is a different composition, not a scaled one. The lead is a
 *      two-column briefing. The second tier is claim-over-chart. The tail is
 *      a row.
 *   3. Maturity is drawn, not labelled. A four-step track shows how far an
 *      idea has come, so "what kind of idea is this" is answerable at a
 *      glance and decision-ready work is visibly different from research.
 *   4. The framework became a real chart: a filled range, tinted where price
 *      has left it, and the asymmetry -- how far to the bear against how far
 *      to the bull -- stated in figures a reader actually wants.
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
 * Where an idea sits in the field.
 *
 * From rank alone -- never tone, stance, book, claim length, or whether there
 * is a chart to draw. Three subtly different spans in the second tier did not
 * read at all, so that tier is now two cells of clearly different size and the
 * field flattens one rank earlier. A difference nobody perceives is not a
 * hierarchy.
 */
export type IdeaSlot = 'lead' | 'second' | 'third' | 'major' | 'minor' | 'scan' | 'dense'

export function slotForRank(index: number): IdeaSlot {
  switch (index) {
    case 0: return 'lead'
    case 1: return 'second'
    case 2: return 'third'
    case 3: return 'major'
    case 4: return 'minor'
    default: return index <= 8 ? 'scan' : 'dense'
  }
}

export interface IdeaCardProps {
  idea: IdeaRow
  slot: IdeaSlot
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
  switch (props.slot) {
    case 'lead': return <LeadCard {...props} />
    case 'second':
    case 'third': return <ClusterCard {...props} />
    case 'major':
    case 'minor': return <TierCard {...props} />
    case 'scan': return <ScanCard {...props} />
    default: return <DenseRow {...props} />
  }
}

/* ================================================================== lead */

/**
 * The briefing object.
 *
 * Two columns: the belief on the left, the setup on the right. The old
 * vertical stack put the chart at the bottom of a tall card with air above it,
 * which is how a lead ends up feeling empty at any height.
 */
function LeadCard(props: IdeaCardProps) {
  const { idea, frame, weightPct } = props
  const d = read(idea, frame, weightPct)

  return (
    <Shell
      {...props}
      className={clsx(
        'bg-slate-50/80 dark:bg-white/[0.03]',
        d.deciding && 'border-l-[3px] border-l-amber-400',
      )}
      pad="p-6"
    >
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(230px,0.85fr)]">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <DirectionPill direction={idea.direction} />
            <MaturityTrack maturity={idea.maturity} size="lg" />
          </div>

          <div className="mt-4 flex min-w-0 items-baseline gap-2.5">
            <span className="font-black text-[38px] leading-none tracking-[-0.04em]">
              {idea.symbol ?? '—'}
            </span>
            {idea.companyName && (
              <span className="min-w-0 truncate text-[13px] font-medium text-gray-500">
                {idea.companyName}
              </span>
            )}
          </div>

          {idea.thesis ? (
            <p className="mt-3 line-clamp-4 text-[19px] leading-[1.45] text-gray-900 dark:text-gray-100">
              {idea.thesis}
            </p>
          ) : (
            <p className="mt-3 text-[14px] italic text-gray-500">No claim written yet.</p>
          )}

          <div className="mt-auto pt-5">
            <Footer {...props} d={d} tall />
          </div>
        </div>

        {/* The setup, given a column of its own rather than a strip at the
            bottom. Each kind of setup gets the picture that fits it. */}
        <div className="flex min-w-0 flex-col justify-center rounded-lg border border-gray-200/80 bg-white p-4 dark:border-white/[0.07] dark:bg-[#141a25]">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            {d.setup === 'framework' ? 'Spot against the range'
              : d.setup === 'target' ? 'Spot against target'
              : d.setup === 'sizing' ? 'Position' : 'Setup'}
          </div>
          {d.range ? <RangeChart range={d.range} />
            : d.target != null && d.spot != null ? <TargetBar spot={d.spot} target={d.target} />
            : d.setup === 'sizing'
              ? <SizingBar held={weightPct ?? null} proposed={idea.proposedWeight} />
              : <p className="text-[12px] text-gray-500">
                  No price framework has been written for this idea yet.
                </p>}
        </div>
      </div>
    </Shell>
  )
}

/* =============================================================== cluster */

/** Second and third: the claim, then whichever picture the setup allows. */
function ClusterCard(props: IdeaCardProps) {
  const { idea, slot, frame, weightPct } = props
  const d = read(idea, frame, weightPct)
  const second = slot === 'second'

  return (
    <Shell {...props} className={clsx(d.deciding && 'border-l-[3px] border-l-amber-400')} pad="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <DirectionPill direction={idea.direction} />
        <MaturityTrack maturity={idea.maturity} />
      </div>

      <div className="mt-2.5 flex min-w-0 items-baseline gap-2">
        <span className={clsx(
          'font-black leading-none tracking-[-0.035em]',
          second ? 'text-[24px]' : 'text-[20px]',
        )}>
          {idea.symbol ?? '—'}
        </span>
        {second && idea.companyName && (
          <span className="min-w-0 truncate text-[12px] font-medium text-gray-500">
            {idea.companyName}
          </span>
        )}
      </div>

      {idea.thesis ? (
        <p className={clsx(
          'mt-2 text-gray-900 dark:text-gray-100',
          second ? 'line-clamp-3 text-[14px] leading-[1.5]' : 'line-clamp-2 text-[13px] leading-[1.45]',
        )}>
          {idea.thesis}
        </p>
      ) : (
        <p className="mt-2 text-[12px] italic text-gray-500">No claim written yet.</p>
      )}

      <div className="mt-3">
        {d.range ? <RangeChart range={d.range} height="sm" />
          : d.target != null && d.spot != null ? <TargetBar spot={d.spot} target={d.target} />
          : d.setup === 'sizing'
            ? <SizingBar held={weightPct ?? null} proposed={idea.proposedWeight} />
            : null}
      </div>

      <div className="mt-auto pt-3"><Footer {...props} d={d} /></div>
    </Shell>
  )
}

/* ============================================================ second tier */

/** Ranks four and five: a card, with the chart where the setup has one. */
function TierCard(props: IdeaCardProps) {
  const { idea, slot, frame, weightPct } = props
  const d = read(idea, frame, weightPct)
  const major = slot === 'major'

  return (
    <Shell
      {...props}
      card
      className={clsx(
        major ? 'md:col-span-6 xl:col-span-5 2xl:col-span-7' : 'md:col-span-6 xl:col-span-4 2xl:col-span-5',
        d.deciding && 'border-l-[3px] border-l-amber-400',
      )}
      pad={major ? 'p-4' : 'p-3.5'}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <DirectionPill direction={idea.direction} />
        <MaturityTrack maturity={idea.maturity} />
      </div>

      <div className="mt-2.5 flex min-w-0 items-baseline gap-2">
        <span className={clsx('font-black leading-none tracking-[-0.035em]', major ? 'text-[20px]' : 'text-[18px]')}>
          {idea.symbol ?? '—'}
        </span>
      </div>

      {idea.thesis ? (
        <p className={clsx(
          'mt-2 text-gray-900 dark:text-gray-100',
          major ? 'line-clamp-3 text-[13px] leading-[1.5]' : 'line-clamp-2 text-[12px] leading-[1.45]',
        )}>
          {idea.thesis}
        </p>
      ) : (
        <p className="mt-2 text-[12px] italic text-gray-500">No claim written yet.</p>
      )}

      {major && (
        <div className="mt-3">
          {d.range ? <RangeChart range={d.range} height="sm" />
            : d.target != null && d.spot != null ? <TargetBar spot={d.spot} target={d.target} />
            : null}
        </div>
      )}
      {!major && d.range && (
        <p className="mt-2.5 flex items-baseline gap-2 font-mono text-[12px] tabular-nums">
          <span className="font-semibold">{d.range.spot.toFixed(2)}</span>
          <Legs range={d.range} />
        </p>
      )}

      <div className="mt-auto pt-3"><Footer {...props} d={d} /></div>
    </Shell>
  )
}

/* ================================================================== scan */

/** Ranks six through nine: compact, still with one real relationship. */
function ScanCard(props: IdeaCardProps) {
  const { idea, frame, weightPct } = props
  const d = read(idea, frame, weightPct)

  return (
    <Shell {...props} card className={clsx(d.deciding && 'border-l-[3px] border-l-amber-400')} pad="p-3">
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
      {d.range && (
        <p className="mt-2 flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
          <span className="font-semibold">{d.range.spot.toFixed(2)}</span>
          <Legs range={d.range} />
        </p>
      )}
      <div className="mt-auto pt-2.5"><Footer {...props} d={d} compact /></div>
    </Shell>
  )
}

/* ================================================================= dense */

/**
 * The tail: rows on the page, not cards.
 *
 * Fifteen more bordered rectangles is what made the field read as a wall. A
 * hairline-separated list recedes the way a tail should, and still carries the
 * ticker, the stance, a line of claim and one figure.
 */
function DenseRow(props: IdeaCardProps) {
  const { idea, frame, weightPct } = props
  const d = read(idea, frame, weightPct)

  return (
    <Shell {...props} pad="px-3 py-2.5" className="border-t border-gray-200/70 dark:border-white/[0.06]">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="w-[54px] shrink-0 font-black text-[14px] leading-none tracking-[-0.03em]">
          {idea.symbol ?? '—'}
        </span>
        <span className="shrink-0"><DirectionPill direction={idea.direction} /></span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-300">
          {idea.thesis ?? 'No claim written yet.'}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-gray-500">
          {d.range ? `${d.range.spot.toFixed(2)}`
            : weightPct != null ? `${weightPct.toFixed(1)}%`
            : idea.proposedWeight != null ? `${idea.proposedWeight.toFixed(1)}%` : ''}
        </span>
      </div>
    </Shell>
  )
}

/* =============================================================== pieces */

/** The two distances, compactly, where a chart will not fit. */
function Legs({ range }: { range: Range }) {
  const { toBear, toBull, outside } = asymmetry(range)
  return (
    <span className={clsx('font-sans text-[11px]', outside ? 'text-rose-700 dark:text-rose-400' : 'text-gray-500')}>
      {toBear.toFixed(0)}% / +{toBull.toFixed(0)}%
      <span className="ml-1 text-gray-400">bear / bull</span>
    </span>
  )
}

/**
 * The reserved strip: context and a next step, or why-now and two actions.
 *
 * Both layers are absolutely positioned inside one fixed height, so revealing
 * depth cannot move a neighbour or shift the grid — and it only ever covers
 * metadata, never the ticker, the claim or the chart.
 */
function Footer({
  d, onOpen, onAskAI, tall, compact,
}: IdeaCardProps & { d: ReturnType<typeof read>; tall?: boolean; compact?: boolean }) {
  return (
    <div className={clsx('relative shrink-0', tall ? 'h-[40px]' : compact ? 'h-[32px]' : 'h-[36px]')}>
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

/** The interactive container every band shares. */
function Shell({
  idea, slot, onOpen, card, className, pad, children,
}: IdeaCardProps & { card?: boolean; className?: string; pad: string; children?: React.ReactNode }) {
  const [, setFocused] = useState(false)
  return (
    <div
      data-testid="idea-tile"
      data-slot={slot}
      data-maturity={idea.maturity}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={clsx(
        'group relative flex min-w-0 flex-col overflow-hidden',
        card && 'rounded-lg border border-gray-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-150 hover:border-gray-300 hover:shadow-md focus-within:border-gray-300 focus-within:shadow-md dark:border-white/[0.07] dark:bg-[#141a25]',
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
