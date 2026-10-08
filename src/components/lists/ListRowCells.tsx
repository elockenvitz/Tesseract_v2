/**
 * The collapsed list row: what a reader needs before deciding to open anything.
 *
 * A list is read top-to-bottom at speed, so the order of the line is the whole
 * design — security, what the market did, what we own, what we think, what it
 * is worth, and what work is open on it. Generic task metadata (priority,
 * process, assignee, tags) is still available in the column picker and still
 * shown in the expansion; it just no longer leads, because it answers a
 * question about the list rather than about the investment.
 *
 * Work state is the research lifecycle — `stateOf` over a `ResearchSubject` —
 * not a list status field. "New research" / "Review due" / "No thesis on file"
 * are facts about the case; `list_status` is a fact about this list's process,
 * and both are worth seeing, so both are here and they are not merged.
 */
import React from 'react'
import { clsx } from 'clsx'
import { Sparkline } from '../signals/Sparkline'
import { RatingPill, ConvictionBars } from './ListRowAtoms'
import { WORK_TIER_RANK, type WorkTier } from '../../lib/lists/work-state'
import type { EntryToken } from './listRowModes'
import type { ListRowSignal } from '../../hooks/lists/useListRowSignals'
import type { ColumnConfig } from '../table/AssetTableView'

/**
 * The six things a monitor is for.
 *
 * ── Why these are conceptual, not atomic ──────────────────────────────────
 *
 * The line used to be ten columns of one field each: price, change, 1M,
 * position, view, target, work, coverage, and two identity columns. Every one
 * carried a 9px grey heading of equal weight, so the reader had to assemble
 * "what has the market done" out of three adjacent cells and "what is it worth"
 * out of two — and the result read as a database grid, because that is what a
 * row of equally-weighted scalar columns IS.
 *
 * A security is four questions beyond its identity, so the line is five
 * columns:
 *
 *   SECURITY         who is this        (the table's own identity cell)
 *   MARKET           what has the market done
 *   INVESTMENT VIEW  what do we think, how strongly, and what is it worth
 *   POSITION         what do we own, and of what
 *   WORK             what needs to happen
 *
 * Each composes its own fields with internal hierarchy — a figure and a
 * qualifier, not two equal values — which is what lets a calm name recede and
 * an urgent one stand out without a single badge or pill being added.
 *
 * ── Why the target lives inside Investment View ───────────────────────────
 *
 * It had its own Valuation column, which split one judgement across two
 * headings: a rating is what we think and a target is the same thought priced.
 * Read together they are a sentence — "BUY, medium conviction, worth $178" —
 * and read apart they are two numbers the eye has to join. Valuation is still
 * a MODE, reached by clicking the target itself; it is no longer a column.
 *
 * ── Entry points are sub-elements, not whole cells ────────────────────────
 *
 * Each datum carries `data-entry`, and the table opens the inspector on the
 * mode that datum names: the rating opens Case, the target beneath it opens
 * Valuation, the price opens Market. A cell-level map could not express that,
 * and clicking a target to be shown a rating is the kind of near-miss that
 * teaches a reader the surface does not understand them. See `ENTRY_MODE`.
 *
 * All sortable: a watchlist whose columns cannot be ordered is a report. The
 * comparators live with the surface that owns the data — see
 * `listSortComparators`, handed to the table as `extraSortComparators`.
 */
export const LIST_SIGNAL_COLUMNS: ColumnConfig[] = [
  { id: 'list_market',    label: 'Market',          visible: true, width: 148, minWidth: 118, sortable: true, pinned: false, category: 'price' },
  { id: 'list_view',      label: 'Investment view', visible: true, width: 140, minWidth: 116, sortable: true, pinned: false, category: 'research' },
  { id: 'list_exposure',  label: 'Position',        visible: true, width: 122, minWidth: 96,  sortable: true, pinned: false, category: 'price' },
  // Work grows most: it is the only column whose job is to say WHY a name needs
  // attention, and "Recommendation re…" says nothing.
  { id: 'list_work',      label: 'Work',            visible: true, width: 196, minWidth: 156, sortable: true, pinned: false, category: 'workflow' },
  /*
   * Off the default line, kept for anyone who wants the scalar back.
   *
   * Investment View carries the target now. This column still sorts and still
   * opens Valuation, so turning it on costs nothing.
   */
  { id: 'list_valuation', label: 'Target',          visible: true, width: 104, minWidth: 88,  sortable: true, pinned: false, category: 'research' },
]

/**
 * How urgent each research state is, for ordering the Work column.
 *
 * Highest first when sorted descending, which is what a reader wants on the
 * first click: unanswered research leads, because it is the one state where the
 * written case may already be wrong. "Current" is last and `null` — no subject
 * at all — is below it, since an absent case is a gap rather than a verdict.
 */

/**
 * Comparators for the signal columns, ascending.
 *
 * Module scope because `extraSortComparators` is a memo dependency. They close
 * over nothing: the signal lookup is passed in by `ListTableView`, which owns
 * the batch.
 */
export function listSortComparators(
  signalFor: (assetId?: string | null) => ListRowSignal,
): Record<string, (a: any, b: any) => number> {
  // Absent values sort to the BOTTOM of a descending sort rather than the top,
  // which is what "sort by Position" means to a reader: show me what we own.
  const num = (v: number | null | undefined) => (v == null ? -Infinity : v)
  const oneMonth = (s: ListRowSignal) => {
    const c = s.closes
    if (!c || c.length < 2 || !c[0]) return -Infinity
    return ((c[c.length - 1] - c[0]) / c[0]) * 100
  }
  return {
    // Each conceptual column sorts by the figure it LEADS with, which is the
    // one a reader is pointing at when they click the heading.
    list_market: (a, b) => oneMonth(signalFor(a?.id)) - oneMonth(signalFor(b?.id)),
    list_exposure: (a, b) => num(signalFor(a?.id).weightPct) - num(signalFor(b?.id).weightPct),
    list_valuation: (a, b) => num(signalFor(a?.id).targetPrice) - num(signalFor(b?.id).targetPrice),
    list_view: (a, b) => {
      // Alphabetical by the recorded value: rating scales are per-organisation,
      // so there is no universal Buy-beats-Hold order to assume.
      const av = signalFor(a?.id).ratingValue ?? ''
      const bv = signalFor(b?.id).ratingValue ?? ''
      if (!av && !bv) return 0
      if (!av) return -1
      if (!bv) return 1
      return av.localeCompare(bv)
    },
    list_work: (a, b) => {
      // Ranked by the same tiers the cell renders — a pending decision above a
      // live idea above unreviewed research above a review clock above a gap.
      const sa = signalFor(a?.id)
      const sb = signalFor(b?.id)
      const ua = WORK_TIER_RANK[sa.work.tier]
      const ub = WORK_TIER_RANK[sb.work.tier]
      if (ua !== ub) return ua - ub
      // Within a tier, more unreviewed notes is more urgent.
      return (sa.subject?.newSinceReview ?? 0) - (sb.subject?.newSinceReview ?? 0)
    },
  }
}


/**
 * The curated list presentation.
 *
 * Ordered, not merely filtered: the point is the reading order. Columns absent
 * from `ORDER` keep their own relative position after it, so a caller-supplied
 * or AI column still appears rather than vanishing.
 *
 * Nothing is removed — `HIDDEN` only clears `visible`, so every column stays
 * one click away in the picker and a user who turns Processes back on keeps it
 * (saved column state is layered over this baseline, not replaced by it).
 */
const ORDER = [
  'select', 'ticker',
  'list_market',
  'list_view',
  'list_exposure',
  'list_work',
  'list_valuation',
]

/**
 * Narrower than the table's own defaults, because the default List must fit.
 *
 * The first version of this preset hid five columns and still came to 1316px,
 * which scrolls horizontally in any normal pane — hiding columns was the wrong
 * lever once the remaining ones were this wide. These widths bring the curated
 * set to ~960px. The user can still drag any of them wider; this is only where
 * they start.
 */
/**
 * The FLOOR, not the final size.
 *
 * These widths are what the line collapses to on a narrow pane; `GROW` below
 * spends everything a wider one offers. So the number to keep small is this
 * total — it decides whether a 1280px laptop scrolls — while the look on a
 * 1600px screen is decided by the growth weights.
 */
const WIDTH: Readonly<Record<string, number>> = {
  // One identity cell: chevron, ticker, and the company beneath it.
  ticker: 196,
  coverage: 112,
}

/**
 * Who takes the pane's leftover width, and in what proportion.
 *
 * The identity gets the most: a truncated company name is the one thing on the
 * line a reader cannot reconstruct from context. Work next, because it carries
 * the reason for attention. Everything else holds a number whose width is the
 * number's own.
 */
/**
 * Who takes the pane's leftover width.
 *
 * Work takes the most: it is the column that says what is happening to the
 * investment, and "BUY · Recommendation ready" over "Thin evidence" needs room
 * to be two legible lines rather than two truncations. Identity next, because a
 * clipped company name is the one thing on the line a reader cannot reconstruct.
 * Everything else holds a number whose width is the number's own.
 */
const GROW: Readonly<Record<string, number>> = {
  list_work: 3,
  ticker: 3,
  // Market earns slack because it contains the sparkline, and this is the only
  // column whose value IS partly its width: a month of movement in 100px is a
  // texture, in 180px it is a shape.
  list_market: 2,
  list_exposure: 1,
  list_view: 1,
  list_valuation: 1,
}

/**
 * Shorter headings, for this surface only.
 *
 * "Change %" wrapped to two lines in a column sized for the number rather than
 * for the word, which put a two-line heading over a one-line table. The shared
 * default keeps its full label everywhere else.
 */
const LABEL: Readonly<Record<string, string>> = {
  coverage: 'Coverage',
}

/**
 * Columns of figures, right-aligned so they can be read down.
 *
 * Price and Change are the table's own columns and are left-aligned everywhere
 * else; the preset only changes them HERE, which is the point of alignment
 * being per-column rather than a global style. With Position and Target they
 * form one numeric band whose decimals line up — the single biggest difference
 * between this reading as a watchlist and as a CRUD grid.
 */
const RIGHT_ALIGNED = new Set<string>([])

/**
 * Bumped whenever ORDER, HIDDEN or WIDTH change.
 *
 * `AssetTableView` stores this alongside the saved column layout; a mismatch
 * re-seeds from the preset once. Without it a saved layout pins the old
 * default forever — which is exactly what happened to the first version of
 * this preset, and why the columns it hid were still on screen.
 */
export const LIST_COLUMN_PRESET_VERSION = 'lists-five-zone-2026-10-07'

/**
 * Hidden by default, not deleted.
 *
 * `priority` (My Priority) and `workflows` (Processes) are generic
 * project-management columns that were dominating a line about securities.
 * `updated`, `list_assignee` and `list_tags` are real but secondary — the
 * expansion shows all three in its right rail.
 */
const HIDDEN = new Set([
  'priority', 'workflows', 'updated', 'list_assignee', 'list_tags',
  /*
   * Company is not dropped — it moves INTO the ticker cell as a second line.
   * `AssetTableView` composes it there whenever this column is hidden, so the
   * identity reads as one object instead of two columns of equal weight, and
   * the width it was using goes to the investment state.
   */
  'companyName',
  // The list's own process state. Real, but it answers a question about this
  // list rather than about the security, and the inspector's Overview shows it.
  'list_status',
  /*
   * Absorbed into MARKET, which now carries price, the day's move and the month
   * as one answer. Still in the picker for anyone who wants the scalar back.
   */
  'price', 'change',
  /*
   * Coverage is off the default line.
   *
   * Not because it does not matter, but because it is empty for almost every
   * name in practice — and a 112px column of em-dashes is the clearest possible
   * signal that a table is a database grid. One click away in the picker, and
   * the inspector shows it wherever it exists.
   */
  'coverage',
  // Folded into Investment View — see `LIST_SIGNAL_COLUMNS`. Still sortable and
  // still opens Valuation when a reader turns it back on.
  'list_valuation',
])

/** Module scope: `columnPreset` is memoised on identity. */
export function listColumnPreset(base: ColumnConfig[]): ColumnConfig[] {
  const rank = new Map(ORDER.map((id, i) => [id, i]))
  const adjusted = base.map(col => {
    const width = WIDTH[col.id] ?? col.width
    const align = RIGHT_ALIGNED.has(col.id) ? ('right' as const) : col.align
    const grow = GROW[col.id] ?? col.grow
    const label = LABEL[col.id] ?? col.label
    if (HIDDEN.has(col.id)) return { ...col, visible: false, width, align, grow, label }
    if (width === col.width && align === col.align && grow === col.grow && label === col.label) return col
    return { ...col, width, align, grow, label }
  })
  // Stable: equal ranks (everything off the list) keep their incoming order.
  return adjusted
    .map((col, i) => ({ col, i }))
    .sort((a, b) => {
      const ra = rank.get(a.col.id) ?? ORDER.length + a.i
      const rb = rank.get(b.col.id) ?? ORDER.length + b.i
      return ra - rb
    })
    .map(x => x.col)
}

// ── Cells ──────────────────────────────────────────────────────────────
//
// Each renders nothing when it knows nothing. A column of "—" makes a thin
// list look broken, and on a dense surface absence reads faster than a
// placeholder does.

/**
 * The sparkline's box, which exists before its data does.
 *
 * Height is deliberately well under the row: at 28px in a 44px row the gradient
 * fills of consecutive rows nearly touched and the column read as one
 * continuous ribbon down the table rather than one chart per name.
 */
export const SPARK_HEIGHT = 20

/**
 * A price path in a box whose geometry never depends on the price path.
 *
 * ── The first-paint defect this fixes ─────────────────────────────────────
 *
 * Three things combined to make every sparkline render tiny and then snap to
 * size seconds later, which is the single worst thing a financial table can do:
 *
 *   1. the cell returned `null` until its closes arrived, so there was no box
 *      at all — the chart POPPED IN rather than filling a reserved space;
 *   2. `.pro-table-cell` is `display:flex`, so the wrapper was a flex item with
 *      `flex-basis:auto`. Its base size therefore came from its CONTENT, and
 *      its content was an `<svg>` whose own width is `100%` — an indeterminate
 *      cycle the browser breaks using the element's intrinsic size, then
 *      corrects on a later layout pass. That correction is the visible snap;
 *   3. `useSparklines` issues one edge-function call per symbol, so those
 *      corrections land one row at a time over several seconds.
 *
 * (3) is a fetch shape and is left alone deliberately — it is invisible once the
 * geometry is right. (1) and (2) are fixed here, together:
 *
 *   • the box always renders, at a fixed height and `flex-1 min-w-0`, so its
 *     size is resolved from the COLUMN and never from its content;
 *   • the chart is absolutely positioned inside it, so an `<svg>` sized in
 *     percentages is out of flow and cannot contribute an intrinsic size to
 *     that calculation at all.
 *
 * Loading, empty and resolved therefore occupy byte-identical geometry, and no
 * state here animates a dimension.
 */
function SparkCell({ signal }: { signal: ListRowSignal }) {
  const closes = signal.closes
  const drawn = !!closes && closes.length > 1

  return (
    <span
      /*
       * `w-full`, never `flex-1`.
       *
       * This box's own parent is a COLUMN flex (`MarketCell`), where `flex-1`
       * means `flex-basis: 0%` on the main axis — which is the height. The
       * declared `height: 20px` then loses to the basis and the box computes to
       * 0px: the chart was mounted, measured zero, and was invisible. Width is
       * taken from the column through `MarketCell`'s own `flex-1 min-w-0`,
       * which IS a row-flex item and is the right place for it.
       */
      className="relative block w-full min-w-0 overflow-hidden"
      style={{ height: SPARK_HEIGHT }}
      data-testid="spark-cell"
      data-state={drawn ? 'drawn' : 'quiet'}
    >
      {drawn ? (
        <span className="absolute inset-0">
          <Sparkline points={closes!} reference={signal.targetPrice} />
        </span>
      ) : (
        /*
         * A dotted rule, not a flat line.
         *
         * A solid horizontal line is a claim that the price did not move. A
         * dotted one reads as "no path here", which is true both while the
         * month is still loading and when the name has no history on file —
         * and the two must look the same, because the cell cannot tell them
         * apart without a second signal it has no reason to carry.
         */
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 border-t border-dotted border-gray-200 dark:border-gray-700"
        />
      )}
    </span>
  )
}

/**
 * The shape every conceptual cell takes.
 *
 * A LEAD — the figure the column is about, at the size of an answer — and a
 * QUALIFIER under it that says what the figure is of. The hierarchy is the whole
 * point: two values of equal weight in one cell is just two columns wearing a
 * disguise, and that is what made the old line read as a grid.
 *
 * Renders nothing at all when there is no lead. A column of em-dashes makes a
 * thin list look broken, and on a dense surface absence reads faster than a
 * placeholder does.
 */
/**
 * One clickable datum, and the mode it opens.
 *
 * The selection ring sits on THIS, not on the cell, so the inspector reads as
 * having unfolded from the exact figure the reader pointed at. `data-entry` is
 * what the table reads on click — see `ENTRY_MODE` and `AssetTableView`'s cell
 * handler, which prefers the nearest `[data-entry]` over the column id.
 */
export function Hit({
  entry, children, block, title,
}: {
  entry: EntryToken
  children: React.ReactNode
  /** Stack the contents instead of sitting them on one baseline. */
  block?: boolean
  title?: string
}) {
  return (
    <span
      data-entry={entry}
      title={title}
      /*
       * The ring is applied by CSS, not by a prop.
       *
       * `AssetTableView` stamps `data-open-entry` on the expanded row, and
       * `lists-surface.css` matches the row's token against each datum's own.
       * That keeps the cells pure — no cell has to be told whether its row is
       * open — and costs one rule per entry instead of threading expansion
       * state through `renderExtraCell`.
       */
      className={clsx(
        'list-hit rounded-[3px] -mx-1.5 px-1.5 max-w-full min-w-0',
        block ? 'flex flex-col gap-[2px]' : 'inline-flex items-center gap-1.5',
      )}
    >
      {children}
    </span>
  )
}

function Stack({
  lead, qualifier, title, quiet,
}: {
  lead: React.ReactNode
  qualifier?: React.ReactNode
  title?: string
  /** For a figure that is real but not news — it should recede, not shout. */
  quiet?: boolean
}) {
  if (lead == null || lead === false) return null
  return (
    <span className="flex flex-col min-w-0 max-w-full gap-[2px] leading-none" title={title}>
      <span className={clsx(
        'text-[13px] leading-none truncate tabular-nums',
        quiet
          ? 'font-medium text-gray-500 dark:text-gray-400'
          : 'font-semibold text-gray-900 dark:text-gray-100',
      )}>
        {lead}
      </span>
      {qualifier != null && qualifier !== false && (
        <span className="text-[10.5px] leading-none text-gray-400 dark:text-gray-500 truncate">
          {qualifier}
        </span>
      )}
    </span>
  )
}

/**
 * MARKET — what has the market done.
 *
 * Price leads with the day's move beside it, and the month sits underneath as a
 * shape rather than a number. Three former columns, one answer: a reader
 * scanning for "what moved" reads one cell instead of assembling three.
 */
function MarketCell({ signal, price, changePct }: {
  signal: ListRowSignal
  price: number | null
  changePct: number | null
}) {
  if (price == null && !signal.closes) return null
  return (
    // `flex-1 min-w-0` here, as a row-flex item in `.pro-table-cell`: the cell's
    // width is the column's, and nothing inside may size it. See `SparkCell`.
    <span className="flex flex-col flex-1 min-w-0 max-w-full gap-[3px] leading-none">
      <Hit entry="market">
        <span className="text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100 truncate">
          {price != null ? price.toFixed(2) : '—'}
        </span>
        {changePct != null && (
          <span className={clsx(
            'text-[11px] font-semibold tabular-nums flex-shrink-0',
            // The one place colour is unconditional: the direction of a move is
            // what the number MEANS, and a grey one has to be read twice.
            changePct >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400',
          )}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
          </span>
        )}
      </Hit>
      {/* The month is the same question as the price, so it opens the same
          mode — but it is its own target, because it is what a reader is
          pointing at when they click the shape rather than the number. */}
      <Hit entry="market" block>
        <SparkCell signal={signal} />
      </Hit>
    </span>
  )
}

/**
 * EXPOSURE — what we own, and of what.
 *
 * "1.9%" alone is not an exposure; "1.9% / Vision Fund" is. Where the name holds
 * in more than one book the qualifier says so, because the largest stake is not
 * the whole position.
 */
function ExposureCell({ signal }: { signal: ListRowSignal }) {
  if (signal.weightPct == null) {
    // Held somewhere but un-weighable (the book's NAV did not resolve) is a
    // different fact from not held, and only the first deserves ink.
    return signal.bookCount > 0
      ? <Hit entry="position" block><Stack quiet lead="held" qualifier={signal.bookName} /></Hit>
      : null
  }
  const w = signal.weightPct
  const extra = signal.bookCount - 1
  return (
    <Hit entry="position" block title="Largest single-portfolio weight">
      <Stack
        lead={`${w.toFixed(w >= 10 ? 1 : 2)}%`}
        qualifier={
          signal.bookName
            ? extra > 0 ? `${signal.bookName} +${extra}` : signal.bookName
            : signal.bookCount > 1 ? `${signal.bookCount} books` : null
        }
      />
    </Hit>
  )
}

/**
 * INVESTMENT VIEW — what we think, how strongly, and what it is worth.
 *
 * One judgement on two lines: the rating and the conviction behind it share a
 * baseline, and the price that thought implies sits beneath. They were two
 * columns, which made a reader assemble "BUY, medium, worth $178" out of two
 * headings.
 *
 * TWO entry points, because they are two questions. The rating opens Case —
 * what do we believe and has anything challenged it. The target opens
 * Valuation — what do we think it is worth. Sending both to the same mode is
 * the near-miss this whole scheme exists to avoid.
 */
function ViewCell({ signal, price }: { signal: ListRowSignal; price: number | null }) {
  const upside = signal.targetPrice != null && price != null && price > 0
    ? (signal.targetPrice - price) / price * 100
    : null
  if (!signal.ratingValue && signal.targetPrice == null) return null

  return (
    <span className="flex flex-col min-w-0 max-w-full gap-[3px] leading-none">
      {signal.ratingValue ? (
        <Hit entry="case" title={signal.conviction ? `${signal.conviction} conviction` : undefined}>
          <RatingPill value={signal.ratingValue} color={signal.ratingColor} />
          {signal.conviction && <ConvictionBars level={signal.conviction} />}
        </Hit>
      ) : (
        <span className="text-[10.5px] leading-none text-gray-300 dark:text-gray-600">not rated</span>
      )}

      {signal.targetPrice != null ? (
        <Hit
          entry="valuation"
          title={price != null ? `Against the last stored price of ${price.toFixed(2)}` : undefined}
        >
          <span className="text-[11.5px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">
            ${signal.targetPrice.toFixed(2)}
          </span>
          {upside != null && (
            <span className={clsx(
              'text-[11.5px] font-semibold tabular-nums',
              upside >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400',
            )}>
              {upside >= 0 ? '+' : ''}{upside.toFixed(1)}%
            </span>
          )}
        </Hit>
      ) : (
        <span className="text-[10.5px] leading-none text-gray-300 dark:text-gray-600">no target</span>
      )}
    </span>
  )
}

/**
 * VALUATION — what we think it is worth.
 *
 * The target leads and the upside sits under it, coloured, because the distance
 * is the point and the absolute number is the evidence for it. Computed here
 * rather than read from a column so both inputs can be named in the tooltip:
 * the asset's stored `current_price` and the official (else newest) target. The
 * table's live quote is not available to a cell renderer, so this is the stored
 * price and the tooltip says so.
 */
function ValuationCell({ signal, price }: { signal: ListRowSignal; price: number | null }) {
  if (signal.targetPrice == null) return null
  const upside = price != null && price > 0
    ? (signal.targetPrice - price) / price * 100
    : null
  return (
    <Hit
      entry="valuation"
      block
      title={price != null ? `Against the last stored price of ${price.toFixed(2)}` : undefined}
    >
      <Stack
        lead={`$${signal.targetPrice.toFixed(2)}`}
        qualifier={upside != null && (
          <span className={clsx(
            'font-semibold tabular-nums',
            upside >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400',
          )}>
            {upside >= 0 ? '+' : ''}{upside.toFixed(1)}%
          </span>
        )}
      />
    </Hit>
  )
}

/**
 * Which research states earn ink.
 *
 * Only the ones that mean somebody should do something. "Current" is the
 * desired state and gets no badge at all — a list where every row is decorated
 * tells the reader nothing about where to look.
 */
/**
 * How loudly each state speaks.
 *
 * Three levels, carried by WEIGHT and a single dot — not by a filled badge. A
 * list where every row that needs attention wears a coloured pill turns into a
 * wall of pills, and the reader stops seeing any of them. `urgent` gets the one
 * amber mark on the line; `open` is simply darker and heavier than the rest;
 * `calm` recedes.
 */
const WORK_LEVEL: Record<WorkTier, 'decision' | 'urgent' | 'open' | 'calm'> = {
  decision: 'decision',
  idea: 'urgent',
  evidence: 'urgent',
  review: 'open',
  gap: 'open',
  clear: 'calm',
}

/**
 * The highest-value thing happening on this name, with hygiene underneath.
 *
 * Two lines rather than one: a name with a decision pending AND a thin file is
 * two true facts of very different weight, and flattening them to one lost the
 * decision. The second line is deliberately small and grey — it is a footnote,
 * not a second badge.
 */
function WorkCell({ signal }: { signal: ListRowSignal }) {
  const { work } = signal
  if (!work.label) return null
  const level = WORK_LEVEL[work.tier]

  return (
    <Hit entry="work" block>
      <span className="inline-flex items-center gap-1.5 min-w-0">
        {/* One mark, and only for the two tiers that mean somebody owes an
            action. A dot on every row is a column of dots. */}
        {(level === 'decision' || level === 'urgent') && (
          <span className={clsx(
            'h-1.5 w-1.5 rounded-full flex-shrink-0',
            level === 'decision' ? 'bg-primary-600 dark:bg-primary-400' : 'bg-amber-500',
          )} />
        )}
        <span className={clsx(
          'text-[11.5px] leading-none truncate',
          level === 'decision' && 'font-semibold text-gray-900 dark:text-gray-50',
          level === 'urgent' && 'font-semibold text-gray-900 dark:text-gray-50',
          level === 'open' && 'font-medium text-gray-600 dark:text-gray-300',
          level === 'calm' && 'text-gray-400 dark:text-gray-500',
        )}>
          {work.label}
        </span>
        {work.count > 0 && (
          <span className="text-[11.5px] font-semibold tabular-nums text-amber-700 dark:text-amber-300 flex-shrink-0">
            {work.count}
          </span>
        )}
      </span>
      {work.secondary && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
          {work.secondary}
        </span>
      )}
    </Hit>
  )
}

/**
 * Dispatch for the signal columns.
 *
 * Returns `undefined` — not `null` — for ids it does not own, so the caller can
 * distinguish "not mine" from "mine, and empty".
 */
export function renderSignalCell(
  columnId: string,
  asset: {
    current_price?: number | string | null
    change_percent?: number | string | null
    changePercent?: number | string | null
  },
  signal: ListRowSignal,
  /**
   * The table's own live quote for this symbol, where it has one.
   *
   * MARKET and VALUATION must agree about the price or the upside is nonsense:
   * computing a target against the STORED price while the row displays the live
   * one produced a visible "+1024%". So one price is resolved here and both
   * cells read it.
   */
  quote?: { price?: number | null; changePercent?: number | null } | null,
): React.ReactNode | undefined {
  const finite = (v: unknown) => {
    const n = v == null ? NaN : Number(v)
    return Number.isFinite(n) ? n : null
  }
  // Live where we have it, stored otherwise — the same precedence the table's
  // own price cell uses, so the two can never disagree.
  const price = finite(quote?.price) ?? finite(asset?.current_price)
  const changePct = finite(quote?.changePercent)
    ?? finite(asset?.change_percent ?? asset?.changePercent)

  switch (columnId) {
    case 'list_market':    return <MarketCell signal={signal} price={price} changePct={changePct} />
    case 'list_exposure':  return <ExposureCell signal={signal} />
    case 'list_view':      return <ViewCell signal={signal} price={price} />
    case 'list_valuation': return <ValuationCell signal={signal} price={price} />
    case 'list_work':      return <WorkCell signal={signal} />
    default: return undefined
  }
}
