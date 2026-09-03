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

import { clsx } from 'clsx'
import { MessageSquare, Sparkles } from 'lucide-react'
import {
  MATURITY_LABEL, primaryActionFor, type IdeaFocus, type IdeaRow,
} from '../../lib/desktop-ideas'
import type { ScanFrame } from '../../hooks/useDesktopIdeas'
import { DirectionPill } from './IdeaChrome'
import { CreateMenu } from '../dashboard/CreateMenu'
import {
  StagePill, RangeChart, TargetBar, SizingBar, SinceOpen, ExposureRank,
  CasesUnpriced, ModelGap,
  asymmetry, type Range, type VisualSize, type OpenAnchor,
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
export type IdeaVisualKind =
  | 'range' | 'target' | 'sizing' | 'since' | 'exposure' | 'cases' | 'gap'

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
  if (index <= 4) return 'standard'
  return 'compact'
}

/**
 * Where each rank sits on the page's single twelve-column grid.
 *
 * 8 + 4 across the top, one row of three, then the compact field. That is all.
 *
 * Three standard cards rather than four, so every row divides evenly: 8+4,
 * then 4+4+4, then the compact field's own rhythm from a clean start. A fourth
 * standard card left two columns hanging at the end of its row, because a
 * 4-column card and the 3-column compact cards do not add to twelve.
 *
 * There was briefly a two-row lead with #3 pinned beneath #2 on the right,
 * which existed for one reason: #2 was a short text card, so a plain top row
 * left a card-sized hole beside the lead. The pin moved that hole rather than
 * removing it -- the space under the lead became empty page instead.
 *
 * The condition that motivated it is gone. #2 now carries a real chart and
 * earns a height close to the lead's, so the ordinary row works and the void
 * has nowhere left to appear. No row span, no column pinning, no dense flow:
 * every card is a direct child placed by normal flow in rank order.
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
  exposure?: ScanExposure
  /** The price the desk recorded when this idea was created, where it has one. */
  openPrice?: number
  /**
   * Open the idea, optionally at the part the reader reached for.
   *
   * The vocabulary is `IdeaFocus`, which the workspace already understands and
   * already applies -- `IdeaDetail` has keyed its `focused` module treatment
   * off it since before this stage. Reusing it means a card click and a typed
   * arrival land the same way, and no second intent system exists for Ideas.
   */
  onOpen: (focus?: IdeaFocus) => void
  onAskAI: () => void
  /** Omitted when the seam says this object cannot hold a thread. */
  onDiscuss?: () => void
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

  /**
   * Every primitive this idea's data genuinely supports, richest first.
   *
   * This was one ternary chain returning only the winner, which was the right
   * shape while a card had exactly one visual slot. The featured slot now has
   * two -- see `Visual` -- and the second has to be chosen by the same rule as
   * the first, or the widest card on the page shows its runner-up by a
   * different standard of truth than the card beside it.
   *
   * Selection is unchanged: same order, same conditions, and `visual` is still
   * the head of this list. `gap` is deliberately not a member -- it is the
   * statement that there is nothing to draw, so it can be the only thing on a
   * card but never the second thing.
   */
  const available = ([
    range ? 'range' : null,
    frame?.target != null && spot != null ? 'target' : null,
    weightPct != null && idea.proposedWeight != null ? 'sizing' : null,
    anchor && spot != null ? 'since' : null,
    weightPct != null ? 'exposure' : null,
    // Two different situations, and they were being drawn as one. Cases
    // written but never priced is somebody stopping one step short of a
    // decidable idea; nothing modelled at all is a different finding.
    (frame?.casesNamed ?? 0) > 0 ? 'cases' : null,
  ].filter(Boolean) as IdeaVisualKind[])

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
    visual: (available[0] ?? 'gap') as IdeaVisualKind,
    /**
     * The runner-up, for the one density wide enough to hold two.
     *
     * Null on all but a handful of ideas, and that is correct: a second
     * primitive is drawn only where a second set of inputs genuinely exists.
     * Nothing here reserves the slot, so a featured card with one honest
     * visual is one honest visual wide, not a chart beside an empty panel.
     */
    secondVisual: (available[1] ?? null) as IdeaVisualKind | null,
    caseNames: frame?.caseNames ?? [],
    casesNamed: frame?.casesNamed ?? 0,
    /**
     * The absences worth naming, when there is nothing modelled at all. Only
     * facts the client is authorised to read: the written case lives behind
     * column-level grants the scan does not hold.
     */
    gaps: [
      'No cases',
      frame?.target != null ? null : 'No target',
      spot != null ? null : 'No price',
      weightPct != null ? null : 'Not held',
    ].filter(Boolean) as string[],
    /**
     * What this idea is asking someone to do.
     *
     * Three hand-written strings keyed off maturity used to live here, and a
     * separate two-way ternary decided the button's label a few hundred lines
     * below, so the quiet next step and the action offered for it could — and
     * did — say different things about the same card. Both now read
     * `primaryActionFor`, which is the desk's verb list and is already what
     * the Idea, Position and Research detail panes show.
     *
     * `canDecide` is false: it is a fact about whether the surface can record
     * a decision, and a tile in a browse field cannot, so the verb stays
     * "Review decision" rather than promising "Decide".
     *
     * It also brings the one verb no maturity can express — a framework whose
     * price has run past every case it wrote wants "Review scenarios", not
     * more research — onto the browse field for the first time.
     */
    next: primaryActionFor(idea, {
      ladder: frame?.ladder ? { cases: frame.ladder, updatedAt: '' } : undefined,
      spot: spot ?? undefined,
      target: frame?.target,
      weightPct,
    }, false) ?? 'Open idea',
    whyNow: [
      MATURITY_LABEL[idea.maturity],
      idea.portfolioName ? `in ${idea.portfolioName}` : 'no book assigned',
      weightPct != null ? `${weightPct.toFixed(1)}% held` : null,
      idea.proposedWeight != null ? `${idea.proposedWeight.toFixed(1)}% proposed` : null,
      range && asymmetry(range).outside ? 'price outside the range' : null,
    ].filter(Boolean).join(' · '),
    /**
     * The one metadata line, and everything that belongs on it.
     *
     * Age used to own a separate block under the visual, which cost a standard
     * card roughly 25px to say four words the context line had room for.
     * Urgency joins it only when it is above the default -- it is set on
     * nearly every row in production, so printing it everywhere would be
     * chrome rather than signal.
     */
    context: [
      idea.portfolioName,
      days < 45 ? `${days}d open` : `open ${Math.round(days / 30)} months`,
      idea.conviction === 'high' ? 'High conviction' : null,
      idea.urgency === 'urgent' || idea.urgency === 'high'
        ? `${idea.urgency === 'urgent' ? 'Urgent' : 'High'} urgency` : null,
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
      pad="p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DirectionPill direction={idea.direction} />
        <StagePill maturity={idea.maturity} />
      </div>

      <div className="mt-2.5 flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={clsx(
          'font-black leading-none tracking-[-0.04em]',
          first ? 'text-[30px]' : 'text-[24px]',
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
        <ClaimPortal
          onOpen={props.onOpen}
          className={clsx(
            'mt-2 font-medium text-gray-900 dark:text-gray-100',
            first ? 'line-clamp-3 text-[17px] leading-[1.4]' : 'line-clamp-3 text-[14px] leading-[1.45]',
          )}
        >
          {idea.thesis}
        </ClaimPortal>
      ) : (
        <p className="mt-2 text-[13px] italic text-gray-500">No claim written yet.</p>
      )}

      {/* The setup, drawn on the card's own ground. No inner panel: a bordered
          white widget sitting on the featured tint read as a chart pasted onto
          the briefing rather than part of it. */}
      <Visual d={d} idea={idea} exposure={exposure} onOpen={props.onOpen} size="lg" />

      <div className="pt-3"><Footer {...props} d={d} size="featured" /></div>
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
    <Shell {...props} className="bg-white dark:bg-[#141a25]" pad="p-3.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <DirectionPill direction={idea.direction} />
        <StagePill maturity={idea.maturity} />
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-black text-[19px] leading-none tracking-[-0.035em]">
          {idea.symbol ?? '—'}
        </span>
        {idea.companyName && (
          <span className="min-w-0 truncate text-[11.5px] font-medium text-gray-500">
            {idea.companyName}
          </span>
        )}
      </div>

      {idea.thesis ? (
        <ClaimPortal
          onOpen={props.onOpen}
          className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-[1.45] text-gray-900 dark:text-gray-100"
        >
          {idea.thesis}
        </ClaimPortal>
      ) : (
        <p className="mt-2 text-[13px] italic text-gray-500">No claim written yet.</p>
      )}

      <Visual d={d} idea={idea} exposure={exposure} onOpen={props.onOpen} size="md" />

      <div className="pt-2"><Footer {...props} d={d} size="standard" /></div>
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
    <Shell {...props} className="bg-white dark:bg-[#141a25]" pad="p-2.5">
      {/* At this density the ticker shares the chrome line. A dedicated row
          for four characters cost every compact card its own line plus a
          margin, which is a lot of page for something that fits here. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-black text-[16px] leading-none tracking-[-0.03em]">
          {idea.symbol ?? '—'}
        </span>
        <DirectionPill direction={idea.direction} />
        <StagePill maturity={idea.maturity} />
      </div>

      {idea.thesis ? (
        <ClaimPortal
          onOpen={props.onOpen}
          className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-[1.4] text-gray-900 dark:text-gray-100"
        >
          {idea.thesis}
        </ClaimPortal>
      ) : (
        <p className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-[1.4] text-gray-500">
          No claim written yet.
        </p>
      )}

      <Visual d={d} idea={idea} exposure={exposure} onOpen={props.onOpen} size="sm" />

      <div className="pt-1.5"><Footer {...props} d={d} size="compact" /></div>
    </Shell>
  )
}

/**
 * The written claim, as its own way in.
 *
 * A reader who reaches for the thesis is asking about the thesis, so this
 * opens the idea with the claim foregrounded rather than at the top. It is a
 * button so the keyboard reaches it independently of the card, and it is
 * styled as the text it is: a pointer and a hover underline are the whole
 * affordance. A blue sentence in the middle of every card would make the field
 * read as a web page.
 *
 * `text-left` and `block` because a button is neither by default, and the
 * claim has to keep the measure and the clamping the card gave it.
 */
function ClaimPortal({
  onOpen, className, children,
}: {
  onOpen: (focus?: IdeaFocus) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-testid="idea-claim-portal"
      onClick={e => { e.stopPropagation(); onOpen('thesis') }}
      className={clsx(
        'block w-full text-left decoration-gray-400 underline-offset-2',
        'hover:underline focus-visible:outline focus-visible:outline-2',
        'focus-visible:outline-offset-2 focus-visible:outline-blue-600',
        className,
      )}
    >
      {children}
    </button>
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
 *   cases     the framework was written -- why was it never priced?
 *   gap       what is actually behind this idea?
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
  d, idea, exposure, size, onOpen,
}: {
  d: Read; idea: IdeaRow; exposure?: ScanExposure; size: VisualSize
  /** Where activating a case leads. Inspection never calls it. */
  onOpen: (focus?: IdeaFocus) => void
}) {
  /**
   * The intelligence zone.
   *
   * On the phone the pane that carries the actual relationship sits on its own
   * quiet ground, which is what makes it read as the reason the tile exists.
   * Desktop had the chart floating in the card body among the metadata, so
   * nothing announced where the thinking was. A soft tint and real padding --
   * not another bordered widget nested inside a bordered card, which is the
   * clutter this replaces.
   */
  /*
   * The intelligence zone, unboxed.
   *
   * It was a tinted rounded rectangle inside a bordered rounded card — two
   * radii and two grounds nested on every tile in the field, which is most of
   * what made the surface read as an infographic. What the zone actually needs
   * to do is separate the analysis from the prose above it, and a hairline
   * does that without a second container.
   *
   * The tint goes with the box. On the featured density it was invisible
   * anyway, because the card's own ground is the same slate.
   */
  const zone = clsx(
    'border-t border-gray-200/70 dark:border-white/[0.07]',
    size === 'lg' ? 'mt-3 pt-3' : size === 'md' ? 'mt-2.5 pt-2.5' : 'mt-2 pt-2',
  )

  const draw = (kind: IdeaVisualKind, at: VisualSize) =>
    // Activating a case is a request to work on the framework, and opening the
    // idea is where that work happens. Inspection routes nowhere and needs no
    // handler — hovering three cases must never be a navigation.
    kind === 'range' ? <RangeChart range={d.range!} size={at} onCase={() => onOpen('framework')} />
      : kind === 'target' ? <TargetBar spot={d.spot!} target={d.target!} size={at} />
      : kind === 'sizing'
        ? <SizingBar held={exposure!.pct} proposed={idea.proposedWeight!} size={at} />
      : kind === 'since'
        ? <SinceOpen series={d.closes} anchor={d.anchor!} spot={d.spot!} size={at} />
      : kind === 'exposure'
        ? <ExposureRank
            pct={exposure!.pct} rank={exposure!.rank} of={exposure!.of}
            largestPct={exposure!.largestPct} size={at} />
      : kind === 'cases'
        ? <CasesUnpriced names={d.caseNames} count={d.casesNamed} size={at} />
        : <ModelGap gaps={d.gaps} size={at} />

  /**
   * The featured slot answers two questions, because it is wide enough to.
   *
   * Measured at 1920, an eight-column featured card gave its one primitive
   * 1,200px of width. No primitive on this page encodes anything in its
   * length beyond about 500 -- an exposure bar pinned at 100% because the
   * position IS the largest in the book was spending the widest area on the
   * page to say one number. The rest was white.
   *
   * So the second-richest primitive the idea's data genuinely supports is
   * drawn beside the first. It is not a filler panel: `secondVisual` is null
   * for most ideas, and where it is null the primary keeps a readable measure
   * instead of stretching to the full width it cannot use.
   *
   * Both featured cards use the same rule, so #1 and #2 stay one composition
   * -- the split is a property of the density, not a bespoke layout for the
   * lead, which is the thing 3S.1 removed and this must not reintroduce.
   */
  const pair = size === 'lg' && d.secondVisual != null
  if (pair) {
    /*
     * Both halves are drawn at `md`, not `lg`.
     *
     * Primitive size follows the measure it is drawn into, not the density
     * label of the card around it. Half of an eight-column featured card is
     * ~590px at 1920 -- within a few pixels of the 613px a standard card
     * gets -- so `md` is the size that column actually is. Drawing two `lg`
     * primitives here took the featured row to 412px, past the 350-400 the
     * density pass budgeted, and bought nothing: the plots were larger than
     * their column warranted, not more legible.
     */
    return (
      <div className={clsx(zone, 'grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4')} data-visual={d.visual}>
        <div className="min-w-0">{draw(d.visual, 'md')}</div>
        <div
          className="min-w-0 lg:border-l lg:border-gray-200/70 lg:pl-4 dark:lg:border-white/[0.07]"
          data-visual-second={d.secondVisual}
        >
          {draw(d.secondVisual!, 'md')}
        </div>
      </div>
    )
  }

  return (
    <div className={zone} data-visual={d.visual}>
      {/* A lone primitive stops at the width it can actually encode in. */}
      <div className={clsx('min-w-0', size === 'lg' && 'lg:max-w-[620px]')}>
        {draw(d.visual, size)}
      </div>
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
  d, idea, onOpen, onAskAI, onDiscuss, size,
}: IdeaCardProps & { d: Read; size: IdeaDensity }) {
  const compact = size === 'compact'
  return (
    <div className={clsx(
      'relative shrink-0',
      // Tall enough for a real button and its focus ring, and no taller.
      // The strip is reserved height, so every pixel here is spent on every
      // card whether the actions are showing or not.
      size === 'featured' ? 'h-[40px]' : compact ? 'h-[28px]' : 'h-[34px]',
    )}>
      {/*
        Explicit line boxes, because the reserved height is smaller than these
        two lines naturally occupy.

        At standard the pair wants 38.5px against 34 reserved, and at compact
        38.5 against 28. Flex did what flex does and shrank the line boxes to
        fit — 16.5px down to 11.5 for an 11px face — so the glyphs no longer
        fitted inside their own lines and `overflow-hidden` cut the descenders
        off every context line on the page. It was legible enough to survive
        review and wrong at every standard and compact card.

        Stating the leading makes the two lines genuinely fit the strip the
        density pass budgeted, rather than appearing to. No height is returned
        and none is spent: 15+15+4 = 34 and 13+14+0 = 27.
      */}
      {/*
        The resting layer is a display, never a control.
        
        `opacity-0` hides it but does NOT stop it receiving the pointer, so
        while the card body was inert this did not matter and the moment the
        body became interactive it started swallowing clicks meant for the
        actions underneath it. It is `pointer-events-none` unconditionally
        because there is nothing here to click at any point in its life.
      */}
      <div className={clsx(
        'pointer-events-none absolute inset-0 flex flex-col justify-end overflow-hidden opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0',
        compact ? 'gap-0' : 'gap-1',
      )}>
        <p className={clsx(
          'truncate text-gray-500',
          compact ? 'text-[10.5px] leading-[13px]' : size === 'featured' ? 'text-[11px] leading-[16px]' : 'text-[11px] leading-[15px]',
        )}>{d.context || '—'}</p>
        {/* The next step read as metadata because it was styled as metadata.
            It is the thing the card is asking for, so it is set as one. */}
        <p className={clsx(
          'flex items-center gap-1.5 truncate font-semibold text-gray-700 dark:text-gray-300',
          compact ? 'text-[12px] leading-[14px]' : size === 'featured' ? 'text-[12px] leading-[18px]' : 'text-[12px] leading-[15px]',
        )}>
          <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-blue-600" />
          {d.next}
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
          {/*
            Respond, and it says what responding to THIS idea means.

            It used to read `deciding ? 'Assess decision' : 'Open idea'`, so
            two thirds of the field offered the one verb the engagement seam
            exists to prevent — `primary-action.ts` says in as many words that
            an item with no meaningful next step shows no button "rather than a
            generic Open". The verb now comes from `primaryActionFor`, the same
            function the Idea, Position and Research detail panes already use,
            so browse and detail cannot disagree about what an idea is asking
            for. `canDecide` is false here on purpose: a tile cannot record a
            decision, so it never offers to.
          */}
          <button
            type="button"
            data-testid="idea-quick-open"
            onClick={e => { e.stopPropagation(); onOpen() }}
            className="relative z-[2] rounded-md bg-blue-600 px-2.5 py-[3px] text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
          >
            {d.next}
          </button>
          <button
            type="button"
            data-testid="idea-quick-ai"
            onClick={e => { e.stopPropagation(); onAskAI() }}
            className="relative z-[2] inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-[3px] text-[12px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5"
          >
            <Sparkles className="h-3 w-3" />
            Ask AI
          </button>
          {/*
            Discuss is the third slot of the shared grammar, and it was the one
            the browse field never offered — `IdeaDetail` has had it since D1,
            so an idea could only be taken to the team by opening it first.
            Same seam, same target, no second messaging system: `discuss()`
            raises the engagement request and the existing CommunicationPane
            answers it. Shown only where the seam says a thread can exist.
          */}
          {/*
            Create, from the same menu the Dashboard and the workbench use.
            The object supplies the asset; the menu decides what can honestly
            be made from it. Nothing new is built here.
          */}
          <CreateMenu
            compact
            context={{ assetId: idea.assetId, symbol: idea.symbol }}
          />
          {onDiscuss && (
            <button
              type="button"
              data-testid="idea-quick-discuss"
              onClick={e => { e.stopPropagation(); onDiscuss() }}
              className="relative z-[2] inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-[3px] text-[12px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5"
            >
              <MessageSquare className="h-3 w-3" />
              Discuss
            </button>
          )}
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
  /*
   * The card is the entrance, and nothing is layered over its own contents.
   *
   * ── What this replaces, and why ──────────────────────────────────────────
   *
   * The open-affordance used to be a stretched `<button>` pinned across the
   * card at `z-0`, with the whole body set `pointer-events-none` above it.
   * Every real control then had to opt back in by hand — and the framework
   * case buttons did not, so the affordance sat over them and swallowed the
   * pointer. They were unreachable, and it took driving a real browser to find
   * it. That layer is a trap: any control added later inherits the same bug
   * silently, and only a pointer test catches it.
   *
   * Today settled this with event semantics instead of a layer. A click that
   * originated inside a control IS that control's click, `closest` on the
   * event target is the whole test, and nothing covers anything. Ideas now
   * uses the same contract, so the failure mode cannot recur and no future
   * control has to remember to opt in.
   *
   * Not a `<button>`: it contains buttons, and nesting them is invalid markup
   * and unreachable by keyboard. `tabIndex={0}` with an explicit Enter/Space
   * handler gives the keyboard the portal the pointer has, and the handler
   * checks the target so a key pressed inside a child never opens the card
   * underneath it.
   */
  const portalClick = (e: React.MouseEvent<HTMLElement>) => {
    const t = e.target as HTMLElement
    if (t.closest('button,a,input,select,textarea,[role="button"],[data-no-portal]')) return
    // A drag that selected text is a read, not a decision to leave.
    if (window.getSelection()?.toString()) return
    onOpen()
  }

  return (
    <div
      data-testid="idea-tile"
      data-density={density}
      data-rank={rank}
      data-maturity={idea.maturity}
      tabIndex={0}
      role="group"
      aria-label={`${idea.symbol ?? 'Idea'}, ${MATURITY_LABEL[idea.maturity]}. Open idea.`}
      onClick={portalClick}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onOpen()
      }}
      className={clsx(
        'group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border border-gray-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-150 hover:border-gray-300 hover:shadow-md focus-within:border-gray-300 focus-within:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/[0.07]',
        spanForRank(rank),
        className,
      )}
    >
      <div className={clsx('relative z-[1] flex min-h-0 flex-1 flex-col', pad)}>
        {children}
      </div>
    </div>
  )
}
