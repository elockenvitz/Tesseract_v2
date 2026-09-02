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
  StagePill, RangeChart, TargetBar, SizingBar, SinceOpen, ExposureRank, CaseMap,
  asymmetry, type Range, type VisualSize, type OpenAnchor, type CaseDimension,
} from './IdeaVisuals'
import type { ScanExposure } from '../../hooks/useDesktopIdeas'

/**
 * How much of the page an idea gets to be.
 *
 * Three, deliberately. The previous seven slots each had their own geometry,
 * which meant priority was expressed by making every rank a different kind of
 * object. Priority is expressed here by position, width, type and depth --
 * inside one system a reader only has to learn once.
 */
export type IdeaDensity = 'featured' | 'standard' | 'compact'

/** Which primitive a card's data earns. */
export type IdeaVisualKind = 'range' | 'target' | 'sizing' | 'since' | 'exposure' | 'case'

/**
 * The price the idea was written at.
 *
 * ── The rule, in order, with no interpolation and no synthesis ───────────
 *
 *   1. An explicit snapshot taken in the creation/decision context, where one
 *      exists. That is the price the desk actually recorded.
 *   2. Otherwise the latest close ON OR BEFORE the idea's creation date, and
 *      only if it falls within the preceding seven days. A close from before
 *      the idea was written is the price the author could have seen.
 *   3. Otherwise the first close AFTER creation, within the same short window,
 *      flagged `approximate` so the card can mark it and never present it as
 *      the exact opening price. This exists because an idea written on a
 *      Saturday for a name whose history starts on the Monday has no prior
 *      observation, and refusing it would lose the whole visual over a weekend.
 *   4. Otherwise nothing. The rung is skipped and a weaker visual is chosen.
 *
 * A nearest-by-absolute-distance match was rejected: it silently prefers a
 * close from three days AFTER the idea over one from four days before, which
 * reports a price the author could not have seen as the price they wrote at.
 */
export function openAnchor(
  createdAt: string,
  series: { date: string; close: number }[] | undefined,
  snapshot?: number | null,
): OpenAnchor | null {
  const day = createdAt.slice(0, 10)
  if (snapshot != null && snapshot > 0) {
    return { price: snapshot, date: day, approximate: false }
  }
  if (!series?.length) return null

  const window = ANCHOR_DAYS * 86_400_000
  const opened = new Date(day).getTime()
  const within = (d: string) => Math.abs(new Date(d).getTime() - opened) <= window

  // Latest close at or before the day it was written.
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= day && within(series[i].date)) {
      return { price: series[i].close, date: series[i].date, approximate: false }
    }
  }
  // Failing that, the first one after -- marked, never silently.
  for (const p of series) {
    if (p.date > day && within(p.date)) {
      return { price: p.close, date: p.date, approximate: true }
    }
  }
  return null
}

const ANCHOR_DAYS = 7


export function densityForRank(index: number): IdeaDensity {
  if (index <= 1) return 'featured'
  if (index <= 5) return 'standard'
  return 'compact'
}

/**
 * Where each rank sits on the page's single twelve-column grid.
 *
 * ── Why rank 0 spans two rows ─────────────────────────────────────────────
 *
 * The lead earns far more height than the card beside it, and a CSS grid row
 * cannot end until its tallest item does. So even with `items-start` stopping
 * #2 from stretching, nothing could begin underneath #2 until #1 had finished
 * -- and the top right of the page was a card-sized hole that read as a failed
 * render rather than as whitespace.
 *
 * The fix is placement, not height. #1 spans two grid rows in the left eight
 * columns; #2 takes the upper right; #3 is placed directly beneath it. Ranks
 * four to six then form a full row of three, and the compact field follows.
 * Rank still buys prominence -- it just no longer buys a synchronised
 * horizontal band that everything else has to wait for.
 *
 * No card is ever padded to fill its allotment. The lead briefly stretched
 * across its two rows, which looked right while the cards beside it were thin
 * prose -- but once every card gained a visual those two grew taller than the
 * lead, and the stretch turned into a large empty tinted surface, which is the
 * same failure as an empty page gap wearing a card's colour. Every card is
 * exactly as tall as what it has to say.
 *
 * Every span here is a function of the index alone, so placement stays
 * deterministic: no reflow by content height, no dense backfill, and reading
 * order, tab order and rank order remain the same order.
 *
 *   lg+     ┌───────────────┬───────┐
 *           │ 0             │ 1     │
 *           │  (spans two)  ├───────┤
 *           │               │ 2     │
 *           ├───────┬───────┼───────┤
 *           │ 3     │ 4     │ 5     │
 *           └───────┴───────┴───────┘   then compact, 3-up, 4-up at 2xl
 */
export function spanForRank(index: number): string {
  if (index === 0) return 'col-span-12 lg:col-span-8 lg:row-span-2'
  if (index === 1) return 'col-span-12 lg:col-span-4 lg:col-start-9'
  if (index === 2) return 'col-span-12 md:col-span-6 lg:col-span-4 lg:col-start-9'
  if (index <= 5) return 'col-span-12 md:col-span-6 lg:col-span-4'
  return 'col-span-6 md:col-span-4 2xl:col-span-3'
}

export interface IdeaCardProps {
  idea: IdeaRow
  density: IdeaDensity
  /** Position in the ranking. Scales type and depth; never changes geometry. */
  rank: number
  frame?: ScanFrame
  exposure?: ScanExposure
  /** The price the desk recorded when this idea was created, where it has one. */
  openPrice?: number
  onOpen: () => void
  onAskAI: () => void
}

/** Everything a card needs to say, derived once. */
function read(
  idea: IdeaRow, frame?: ScanFrame, exposure?: ScanExposure, openPrice?: number,
) {
  const weightPct = exposure?.pct
  const rung = (n: string) => frame?.ladder?.find(c => c.name === n)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull'), base = rung('Base')
  const spot = frame?.spot ?? null
  const range: Range | null =
    bear != null && bull != null && spot != null ? { bear, bull, base, spot } : null

  const deciding = idea.maturity === 'deciding' || idea.maturity === 'decision_ready'
  const anchor = openAnchor(idea.createdAt, frame?.closes, openPrice)
  const days = Math.max(
    0, Math.floor((Date.now() - new Date(idea.createdAt).getTime()) / 86_400_000))
  return {
    range,
    spot,
    closes: frame?.closes ?? [],
    target: frame?.target ?? null,
    deciding,
    /**
     * How long this has been open. Always true, and the one fact that
     * separates an idea written last week from one that has been
     * "decision ready" since February. Never a fabricated review date --
     * there is no reviewed_at column anywhere in the schema.
     */
    days,
    /** When it was opened, for the age visual's caption. */
    opened: new Date(idea.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
    age: days < 45 ? `${days}d open` : `open ${Math.round(days / 30)} months`,
    stale: days >= 120,
    /**
     * Which visual this card gets. One deterministic choice, in one order,
     * and every card gets one -- there is no text-only idea.
     *
     * Ordered by how much each says about the investment, and each selected
     * only when its own inputs genuinely exist: a range needs all three rungs
     * and a recent price, a target needs a price to measure against, a sizing
     * question needs both weights (a proposal against a dash is not a
     * relationship), and exposure needs a real position.
     *
     * Age is last because it is the weakest of these -- but it is the only
     * one true of every idea, and "this has been sitting unresolved for seven
     * months" is a fact about the investment rather than about the workflow.
     * Stage is deliberately not in this list: it is metadata, it wears a pill
     * in the card's chrome, and drawing it here would put process state in the
     * one place on the card that is supposed to be about the position.
     */
    anchor,
    visual: (range ? 'range'
      : frame?.target != null && spot != null ? 'target'
      : weightPct != null && idea.proposedWeight != null ? 'sizing'
      : anchor && spot != null ? 'since'
      : weightPct != null ? 'exposure'
      : 'case') as IdeaVisualKind,
    /**
     * What is actually on the record behind this idea. Not a score: the
     * dimensions are not all required and the page has no view on how many an
     * idea should have.
     */
    dimensions: [
      { label: 'Claim', present: !!idea.thesis?.trim() },
      {
        label: 'Cases', present: (frame?.casesNamed ?? 0) > 0,
        note: frame?.casesNamed ? `${frame.casesNamed} named` : undefined,
      },
      { label: 'Priced', present: frame?.target != null || !!range },
      { label: 'Position', present: weightPct != null },
    ] as CaseDimension[],
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
  const { idea, rank, frame, exposure } = props
  const d = read(idea, frame, exposure, props.openPrice)
  const first = rank === 0

  return (
    <Shell
      {...props}
      /*
       * The amber edge is a page-level signal and lives only here.
       *
       * It marks a decision nobody has taken. But the ranking already sorts
       * decision-ready work to the top, so putting the edge on every card that
       * qualifies meant the first five cards all carried it -- at page scale
       * that stops reading as "these need a decision" and starts reading as
       * structural chrome, or worse, as five simultaneous warnings for what is
       * a workflow state rather than a fault. Below the fold the amber
       * maturity mark and its label already say the same thing, once.
       */
      className={clsx(
        'bg-slate-50/80 dark:bg-white/[0.035]',
        d.deciding && 'border-l-[3px] border-l-amber-400',
      )}
      pad="p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DirectionPill direction={idea.direction} />
        <StagePill maturity={idea.maturity} />
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
          'mt-3 text-gray-900 dark:text-gray-100',
          first ? 'line-clamp-5 text-[17px] leading-[1.45]' : 'line-clamp-4 text-[14px] leading-[1.5]',
        )}>
          {idea.thesis}
        </p>
      ) : (
        <p className="mt-3 text-[13px] italic text-gray-500">No claim written yet.</p>
      )}

      {/* The setup, drawn on the card's own ground. No inner panel: a bordered
          white widget sitting on the featured tint read as a chart pasted onto
          the briefing rather than part of it. */}
      <Visual d={d} idea={idea} exposure={exposure} size="lg" />

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
  const { idea, frame, exposure } = props
  const d = read(idea, frame, exposure, props.openPrice)

  return (
    <Shell {...props} className="bg-white dark:bg-[#141a25]" pad="p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <DirectionPill direction={idea.direction} />
        <StagePill maturity={idea.maturity} />
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
        <p className="mt-2.5 line-clamp-4 text-[14.5px] leading-[1.5] text-gray-900 dark:text-gray-100">
          {idea.thesis}
        </p>
      ) : (
        <p className="mt-2.5 text-[13px] italic text-gray-500">No claim written yet.</p>
      )}

      <Visual d={d} idea={idea} exposure={exposure} size="md" />
      <StandardMeta d={d} idea={idea} />

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
  const { idea, frame, exposure } = props
  const d = read(idea, frame, exposure, props.openPrice)

  return (
    <Shell {...props} className="bg-white dark:bg-[#141a25]" pad="p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <DirectionPill direction={idea.direction} />
        <StagePill maturity={idea.maturity} />
      </div>

      <div className="mt-2 font-black text-[16px] leading-none tracking-[-0.03em]">
        {idea.symbol ?? '—'}
      </div>

      <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.45] text-gray-900 dark:text-gray-100">
        {idea.thesis ?? 'No claim written yet.'}
      </p>

      <Visual d={d} idea={idea} exposure={exposure} size="sm" />

      <div className="pt-2.5"><Footer {...props} d={d} size="compact" /></div>
    </Shell>
  )
}

/* ================================================================ pieces */

type Read = ReturnType<typeof read>

/**
 * The middle of every card: what the page has to say about this idea.
 *
 * ── Why every card has one ────────────────────────────────────────────────
 *
 * Ideas with a framework read as investment objects; ideas without read as
 * text records, and the page split in two down the middle. That split was not
 * a design choice, it was a data accident -- measured against production, most
 * ideas have no scenario cases and no recent close, so most cards had nothing
 * to draw and fell back to prose.
 *
 * The answer is a fourth primitive, not a fabricated chart. Nothing here
 * invents a price, a target or a weight: each of the first three is selected
 * only when its own inputs are genuinely present, and the state map is drawn
 * from maturity and elapsed time, which are always true.
 *
 * Every primitive answers one real question:
 *
 *   range     where is price against the framework the desk wrote?
 *   target    how far is price from the objective?
 *   sizing    how does the book's exposure compare with the intent?
 *   exposure  how big is this position already?
 *   age       how long has this been sitting unresolved?
 *
 * What is deliberately absent is stage. It is workflow state, it belongs in
 * the chrome as a pill, and putting it here spent the card's one visual slot
 * telling a reader which queue an idea is in rather than anything about the
 * investment.
 *
 * All four are built the same way -- caption, geometry, figure over label --
 * so the middle band of a card is recognisable as the place that answers
 * something before any of it is read.
 */
function Visual({
  d, idea, exposure, size,
}: { d: Read; idea: IdeaRow; exposure?: ScanExposure; size: VisualSize }) {
  const gap = size === 'lg' ? 'mt-4' : size === 'md' ? 'mt-3.5' : 'mt-2.5'
  return (
    <div className={gap} data-visual={d.visual}>
      {d.visual === 'range' ? <RangeChart range={d.range!} size={size} />
        : d.visual === 'target' ? <TargetBar spot={d.spot!} target={d.target!} size={size} />
        : d.visual === 'sizing'
          ? <SizingBar held={exposure!.pct} proposed={idea.proposedWeight!} size={size} />
        : d.visual === 'since'
          ? <SinceOpen series={d.closes} anchor={d.anchor!} spot={d.spot!} size={size} />
        : d.visual === 'exposure'
          ? <ExposureRank
              pct={exposure!.pct} rank={exposure!.rank} of={exposure!.of}
              largestPct={exposure!.largestPct} size={size} />
          : <CaseMap dimensions={d.dimensions} size={size} />}
      {/* The range is the one primitive whose compact form still wants words:
          the two distances are the whole reason to look at a framework, and
          a 22px band cannot label itself. */}
      {size === 'sm' && d.visual === 'range' && (
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] tabular-nums">
          <span className="font-semibold">{d.range!.spot.toFixed(2)}</span>
          <Legs range={d.range!} />
        </p>
      )}
    </div>
  )
}

/**
 * What a standard idea has to say when there is no framework to draw.
 *
 * Measured against production rather than assumed: of the ideas that reach
 * this tier, most have no scenario cases and no recent close, so there is
 * simply no chart to draw. Reserving a slot for one is what made the middle
 * tier read as a stretched compact card with whitespace where the information
 * should be.
 *
 * Everything here is already loaded and already true. Age is unconditional --
 * an idea that has been decision-ready for seven months is a different object
 * from one opened last week, and that distinction was nowhere on the page.
 * Urgency appears only when it is above the default: it is set on every row in
 * production, but two thirds of those are `medium`, so printing it everywhere
 * would be chrome rather than signal.
 */
function StandardMeta({ d, idea }: { d: Read; idea: IdeaRow }) {
  const urgent = idea.urgency === 'urgent' || idea.urgency === 'high'
  const facts = [
    idea.conviction === 'high' ? 'High conviction' : null,
    urgent ? `${idea.urgency === 'urgent' ? 'Urgent' : 'High'} urgency` : null,
  ].filter(Boolean)

  // Age is metadata now and nothing draws it, so it always reads here.
  const parts = [d.age, ...facts]
  if (!parts.length) return null

  return (
    <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2 text-[11px] text-gray-500">
      {parts.map((f, i) => (
        <span key={f}>
          {i > 0 && <span className="mr-2 text-gray-300 dark:text-white/20">·</span>}
          {f}
        </span>
      ))}
    </p>
  )
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
