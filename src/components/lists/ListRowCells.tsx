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
import { RatingPill, ConvictionBars } from './ListRowAtoms'
import { WORK_TIER_RANK, stageLabel, type WorkTier } from '../../lib/lists/work-state'
import type { EntryToken } from './listRowModes'
import type { ListRowSignal } from '../../hooks/lists/useListRowSignals'
import type { RowMarket } from '../../hooks/lists/useListPriceHistory'
import type { WindowReturn } from '../../lib/lists/price-metrics'
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

  /*
   * ── The Research and Decide columns ────────────────────────────────────
   *
   * Off Monitor's line and on their own view's. Every one reads a field the
   * row signal already carries, so adding a view costs no query: `subject`
   * for the case and its evidence, `idea` for the recommendation's stage,
   * author, age and proposed weight.
   *
   * All sortable with a comparator below, which `list-row-cells.test.tsx`
   * asserts for every entry here.
   */
  /*
   * ── Monitor's market line, split ───────────────────────────────────────
   *
   * `list_market` composed price, change and the sparkline into one cell.
   * That reads well in isolation and badly in a watchlist: the three facts
   * cannot be sorted independently, the numbers cannot be scanned down a
   * column because each sits at a different offset, and the cell needed
   * ~270px to hold them. Four narrow columns put every figure on its own
   * axis, which is what a reader comparing twenty names actually does.
   *
   * `list_market` is kept, hidden, so a reader who preferred the composed
   * cell can turn it back on.
   */
  { id: 'list_last',      label: 'Last',            visible: false, width: 90,  minWidth: 78,  sortable: true, pinned: false, category: 'price' },
  { id: 'list_1m',        label: '1M',              visible: false, width: 85,  minWidth: 68,  sortable: true, pinned: false, category: 'price' },
  { id: 'list_6m',        label: '6M',              visible: false, width: 85,  minWidth: 68,  sortable: true, pinned: false, category: 'price' },
  { id: 'list_trend',     label: 'Trend',           visible: false, width: 135, minWidth: 96,  sortable: true, pinned: false, category: 'price' },

  { id: 'list_case',      label: 'Case',            visible: false, width: 124, minWidth: 104, sortable: true, pinned: false, category: 'research' },
  { id: 'list_evidence',  label: 'Evidence',        visible: false, width: 84,  minWidth: 72,  sortable: true, pinned: false, category: 'research' },
  { id: 'list_changed',   label: 'Changed since review', visible: false, width: 230, minWidth: 150, sortable: true, pinned: false, category: 'research' },
  { id: 'list_owner',     label: 'Owner',           visible: false, width: 112, minWidth: 92,  sortable: true, pinned: false, category: 'workflow' },
  { id: 'list_stage',     label: 'Stage',           visible: false, width: 138, minWidth: 112, sortable: true, pinned: false, category: 'workflow' },
  { id: 'list_age',       label: 'Age',             visible: false, width: 64,  minWidth: 56,  sortable: true, pinned: false, category: 'workflow' },
  { id: 'list_sizing',    label: 'Sizing change',   visible: false, width: 170, minWidth: 140, sortable: true, pinned: false, category: 'workflow' },
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
  /**
   * Cached-history metrics, so the split market columns sort by the figure
   * they display. Optional: a caller without history still gets every other
   * comparator, and the three price columns sort everything equal rather
   * than inventing an order.
   */
  marketFor?: (symbol?: string | null) => RowMarket,
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

    /* ── Monitor's split market columns ────────────────────────────────
     * Each sorts by the figure it shows, out of the same cached series the
     * cell draws from. A refused return (`short-lookback`, `not-comparable`)
     * sorts to the bottom of a descending click rather than as a zero —
     * "we cannot say" is not "it did not move". */
    list_last: (a, b) =>
      num(marketFor?.(a?.symbol)?.lastClose?.close ?? a?.current_price)
      - num(marketFor?.(b?.symbol)?.lastClose?.close ?? b?.current_price),
    list_1m: (a, b) => num(marketFor?.(a?.symbol)?.m1.pct) - num(marketFor?.(b?.symbol)?.m1.pct),
    list_6m: (a, b) => num(marketFor?.(a?.symbol)?.m6.pct) - num(marketFor?.(b?.symbol)?.m6.pct),
    // The shape sorts by the move it draws, which is the month.
    list_trend: (a, b) => num(marketFor?.(a?.symbol)?.m1.pct) - num(marketFor?.(b?.symbol)?.m1.pct),

    // ── Research ──────────────────────────────────────────────────────
    // Oldest case first on a descending click, which is what "sort by Case"
    // means to someone looking for stale work. A name with no case written
    // sorts below one that has one: an absent case is a gap, not an age.
    list_case: (a, b) => {
      const at = Date.parse(signalFor(a?.id).subject?.thesisUpdatedAt ?? '')
      const bt = Date.parse(signalFor(b?.id).subject?.thesisUpdatedAt ?? '')
      return (Number.isFinite(bt) ? bt : Infinity) - (Number.isFinite(at) ? at : Infinity)
    },
    list_evidence: (a, b) =>
      num(signalFor(a?.id).subject?.evidenceCount) - num(signalFor(b?.id).subject?.evidenceCount),
    // By how much is unanswered, not by the words.
    list_changed: (a, b) =>
      num(signalFor(a?.id).subject?.newSinceReview) - num(signalFor(b?.id).subject?.newSinceReview),
    list_owner: (a, b) => {
      const av = signalFor(a?.id).idea?.authorName ?? ''
      const bv = signalFor(b?.id).idea?.authorName ?? ''
      if (!av && !bv) return 0
      if (!av) return -1
      if (!bv) return 1
      return av.localeCompare(bv)
    },

    // ── Decide ────────────────────────────────────────────────────────
    // Stage by how far through the lifecycle, so "ready" outranks "exploring"
    // rather than sorting alphabetically into the middle.
    list_stage: (a, b) => STAGE_RANK(signalFor(a?.id)) - STAGE_RANK(signalFor(b?.id)),
    // Oldest outstanding first on a descending click — the thing that has been
    // waiting longest is the thing a PM is being asked about.
    list_age: (a, b) => {
      const at = Date.parse(signalFor(a?.id).idea?.createdAt ?? '')
      const bt = Date.parse(signalFor(b?.id).idea?.createdAt ?? '')
      return (Number.isFinite(bt) ? bt : Infinity) - (Number.isFinite(at) ? at : Infinity)
    },
    // By the SIZE of the change, signed — a 270bp add and a 270bp trim are
    // opposite answers to the same question and must not sort together.
    list_sizing: (a, b) => sizingDelta(signalFor(a?.id)) - sizingDelta(signalFor(b?.id)),
  }
}

/** How far through the idea lifecycle, for ordering Stage. */
function STAGE_RANK(s: ListRowSignal): number {
  const order = ['exploring', 'researching', 'developing', 'ready_to_recommend']
  const i = order.indexOf(String(s.idea?.stage ?? ''))
  return i < 0 ? -1 : i
}

/** Proposed minus current weight, in basis points. `-Infinity` when absent. */
function sizingDelta(s: ListRowSignal): number {
  const proposed = s.idea?.proposedWeight
  if (proposed == null || !Number.isFinite(proposed)) return -Infinity
  return (proposed - (s.weightPct ?? 0)) * 100
}

/*
 * The five-zone preset lived here.
 *
 * It has been replaced by `presetFor(view)` in `listViewPresets.ts`, which
 * expresses the same thing for each of Monitor, Research and Decide. Keeping
 * a second copy for Monitor alone would be two sources of truth for one
 * column order, and the version token that guards saved layouts can only
 * belong to one of them.
 */
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
 * A one-month path drawn on a domain it shares with every other row.
 *
 * Deliberately not `Sparkline`: that one fits its own min and max to the box,
 * which is right for a lone chart and wrong for a column. Here `domain` comes
 * from the list, zero sits on the same pixel in every row, and the amplitude
 * of a line is the size of the move.
 */
function ReturnSpark({ path, domain }: { path: number[]; domain: { lo: number; hi: number } }) {
  const span = domain.hi - domain.lo || 1
  const y = (v: number) => {
    const t = (v - domain.lo) / span
    // 1px inset so a line at the extreme is not clipped by the box edge.
    return (1 + (1 - Math.min(1, Math.max(0, t))) * (SPARK_HEIGHT - 2)).toFixed(2)
  }
  const d = path
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (path.length - 1)) * 100).toFixed(3)},${y(v)}`)
    .join('')
  const last = path[path.length - 1]
  const up = last >= 0
  const stroke = up ? 'rgb(21 128 61)' : 'rgb(185 28 28)'
  const zero = y(0)
  return (
    <svg
      className="block h-full w-full"
      viewBox={`0 0 100 ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* Flat, drawn once, so the eye has a baseline to read height against. */}
      <line x1="0" x2="100" y1={zero} y2={zero}
        stroke="currentColor" strokeWidth="0.5" className="text-gray-200 dark:text-gray-700" />
      {/* `vector-effect` because the viewBox is stretched non-uniformly; without
          it the stroke thins to nothing horizontally. */}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.25"
        strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

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
function SparkCell({ market, domain }: {
  market?: RowMarket
  domain?: { lo: number; hi: number }
}) {
  /*
   * The cached series wins over `signal.closes`.
   *
   * `signal.closes` comes from `useSparklines` → the `yahoo-chart-proxy` edge
   * function, which answers 502 in this deployment; `market.path` comes from
   * `price_history_cache`, the same table the inspector's chart draws. Where
   * both exist they are the same instrument and the cached one is the one the
   * panel below will show, so the row and the panel cannot disagree.
   *
   * And it is drawn in PERCENTAGE-RETURN space on a domain shared across the
   * visible rows — see `price-metrics`. In price space each row auto-scaled to
   * its own extremes, so every line filled its box and the column said nothing.
   *
   * There is deliberately NO fallback to the proxy series when the cache has
   * nothing. Drawing some rows on a shared return axis and others on their own
   * price extremes puts two scales in one column, which is worse than a gap:
   * the reader cannot see which rule a given line was drawn under. A name with
   * no cached history shows the quiet rule and no 1M figure, which is true.
   */
  const path = market?.path ?? []
  const drawn = path.length > 1 && !!domain

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
          <ReturnSpark path={path} domain={domain!} />
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
function MarketCell({ price, liveQuotePrice, changePct, market, domain }: {
  /** The stored `assets.current_price`. Undated, weakest source. */
  price: number | null
  /** A genuine live quote, where one exists. None do in this deployment. */
  liveQuotePrice: number | null
  changePct: number | null
  market?: RowMarket
  domain?: { lo: number; hi: number }
}) {
  /*
   * The price shown, and what it is allowed to be called.
   *
   * A live quote wins where there is one. Where there is not — which is every
   * row in this deployment, the provider being CSP-refused — the last cached
   * close stands in, and the cell says WHEN rather than implying "now". That
   * distinction is `price-snapshot.ts`'s rule and the reason a GOOGL card once
   * showed two prices 2.4x apart under one word.
   */
  const close = market?.lastClose ?? null
  /*
   * Precedence: live quote → cached close → stored `current_price`.
   *
   * The cached close outranks `assets.current_price` deliberately. The close
   * is a dated market observation from the table the chart below draws; the
   * stored field is of unknown vintage and has no date to show, and it is
   * exactly the kind of undated number that let a GOOGL target compute
   * "+360.9%" off a pre-split price. `price-snapshot.ts` draws the same order
   * for the rest of the product.
   */
  const live = liveQuotePrice
  const shown = live ?? close?.close ?? price ?? null
  const fromClose = live == null && close != null
  if (shown == null && !market?.points) return null

  /* The move the row quotes is the 1-month return out of the cached series —
     real, auditable, and refused outright when the lookback is not there.
     The day change stays separate: it needs a quote, and there isn't one. */
  const m1 = market?.m1

  return (
    // `flex-1 min-w-0` here, as a row-flex item in `.pro-table-cell`: the cell's
    // width is the column's, and nothing inside may size it. See `SparkCell`.
    <span className="flex flex-col flex-1 min-w-0 max-w-full gap-[3px] leading-none">
      <Hit entry="market">
        <span
          className="text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100 truncate"
          /* The provenance of the figure, on hover. A close is named as a
             close with its date; nothing here is ever called "current". */
          title={fromClose && close ? `Close of ${close.date}` : undefined}
        >
          {shown != null ? shown.toFixed(2) : '—'}
        </span>
        {/* A close more than a few days old is stated as such in the cell, not
            only on hover: a reader scanning a column of prices has no way to
            know the tape stopped unless the surface says so. Four days covers
            a long weekend without nagging. */}
        {fromClose && (market?.ageDays ?? 0) > 4 && (
          <span className="text-[10px] tabular-nums text-amber-700 dark:text-amber-500 flex-shrink-0">
            {market!.ageDays}d old
          </span>
        )}
        {changePct != null ? (
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
        ) : m1?.pct != null ? (
          <span className={clsx(
            'text-[11px] font-semibold tabular-nums flex-shrink-0',
            m1.pct >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400',
          )}>
            {m1.pct >= 0 ? '+' : ''}{m1.pct.toFixed(1)}%
            <span className="ml-1 font-medium text-gray-400 dark:text-gray-500">1M</span>
          </span>
        ) : m1?.refused === 'not-comparable' ? (
          /* A break in the series, not a move. `price_history_cache` records
             no split factor, so the two ends genuinely cannot be compared —
             which is a different statement from "the price fell". */
          <span className="text-[10px] text-amber-700 dark:text-amber-500 flex-shrink-0">
            not comparable
          </span>
        ) : null}
      </Hit>
      <Hit entry="market" block>
        <SparkCell market={market} domain={domain} />
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
// ── Monitor's split market cells ───────────────────────────────────────

/** LAST — the price, and what it is allowed to be called. */
function LastCell({ price, liveQuotePrice, market }: {
  price: number | null
  liveQuotePrice: number | null
  market?: RowMarket
}) {
  const close = market?.lastClose ?? null
  const shown = liveQuotePrice ?? close?.close ?? price ?? null
  if (shown == null) return null
  const fromClose = liveQuotePrice == null && close != null
  const stale = fromClose && (market?.ageDays ?? 0) > 4
  return (
    <Hit entry="market" block>
      <span
        className="text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100"
        title={fromClose && close ? `Close of ${close.date}` : undefined}
      >
        {shown.toFixed(2)}
      </span>
      {stale && (
        <span className="text-[10px] tabular-nums text-amber-700 dark:text-amber-500">
          {market!.ageDays}d old
        </span>
      )}
    </Hit>
  )
}

/**
 * A window return, or the reason there is not one.
 *
 * Refusals are rendered as a mark rather than a number: `price_history_cache`
 * records no split factor, so a window spanning a discontinuity genuinely
 * cannot be compared, and an em-dash would read as "flat". See `price-metrics`.
 */
function ReturnCell({ r }: { r?: WindowReturn }) {
  if (!r || r.refused === 'no-series') return null
  if (r.refused === 'short-lookback') {
    return <span className="text-[10.5px] text-gray-300 dark:text-gray-600">no history</span>
  }
  if (r.refused === 'not-comparable') {
    return (
      <span className="text-[10.5px] text-amber-700 dark:text-amber-500" title="A gap in the series — no split factor is recorded, so the ends cannot be compared">
        n/c
      </span>
    )
  }
  if (r.pct == null) return null
  return (
    <Hit entry="market">
      <span className={clsx(
        'text-[12.5px] font-semibold tabular-nums',
        r.pct >= 0
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400',
      )}>
        {r.pct >= 0 ? '+' : ''}{r.pct.toFixed(1)}%
      </span>
    </Hit>
  )
}

/**
 * TREND — the shape, subordinate to the numbers beside it.
 *
 * Six months rather than the month, because the two return columns already
 * state the short end and the shape is here to say what the path looked like.
 * Drawn on the list's shared return domain so two rows are comparable.
 */
function TrendCell({ market, domain }: { market?: RowMarket; domain?: { lo: number; hi: number } }) {
  const path = market?.path6 ?? []
  const drawn = path.length > 1 && !!domain
  /*
   * `flex-1 min-w-0` on the OUTER span, and the chart absolutely positioned
   * inside it.
   *
   * `.pro-table-cell` is a row flex, so this span is the flex item and is
   * the only thing allowed to take the column's width. Wrapping it in `Hit`
   * — which is `inline-flex` with no width — collapsed it to zero and the
   * sparkline rendered into nothing: present in the DOM, 0px wide, invisible.
   * The same shape of mistake as the rail behind the frozen column.
   */
  return (
    <span
      data-entry="market"
      className="list-hit relative block flex-1 min-w-0 self-center"
      style={{ height: SPARK_HEIGHT }}
      data-testid="spark-cell"
      data-state={drawn ? 'drawn' : 'quiet'}
    >
      {drawn
        ? <span className="absolute inset-0"><ReturnSpark path={path} domain={domain!} /></span>
        : <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dotted border-gray-200 dark:border-gray-700" />}
    </span>
  )
}

// ── Research and Decide cells ──────────────────────────────────────────

/** Whole months, then days. "10 mo" reads faster than "304d" at this size. */
function ago(iso?: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
  if (d < 1) return 'today'
  if (d < 31) return `${d}d`
  const mo = Math.round(d / 30.44)
  return mo < 18 ? `${mo} mo` : `${Math.round(d / 365)}y`
}

/** CASE — is there a written case, and how old is it. */
function CaseCell({ signal }: { signal: ListRowSignal }) {
  const written = ago(signal.subject?.thesisUpdatedAt)
  if (!written) {
    // An unwritten case is the most actionable state this column has, so it
    // is stated rather than left blank — but quietly, because it is an
    // absence and the row may have nothing wrong with it.
    return <Hit entry="case" block><Stack quiet lead="none written" /></Hit>
  }
  return (
    <Hit entry="case" block>
      <Stack lead={written} qualifier="since written" />
    </Hit>
  )
}

/** EVIDENCE — how much is behind the case. */
function EvidenceCell({ signal }: { signal: ListRowSignal }) {
  const n = signal.subject?.evidenceCount
  if (n == null) return null
  if (n === 0) return <Hit entry="case" block><Stack quiet lead="none" /></Hit>
  return (
    <Hit entry="case" block>
      <Stack lead={n} qualifier={n === 1 ? 'note' : 'notes'} />
    </Hit>
  )
}

/**
 * CHANGED SINCE REVIEW — the column Research exists for.
 *
 * A case nobody has revisited while the facts moved is the failure this
 * product is meant to catch, so the cell leads with WHAT landed rather than
 * a count. "Nothing since review" is said plainly: it is the good state and
 * a reader scanning for work needs to skip it without reading twice.
 */
function ChangedCell({ signal }: { signal: ListRowSignal }) {
  const n = signal.subject?.newSinceReview ?? 0
  const title = signal.subject?.newestEvidenceTitle
  if (n <= 0) {
    return <Hit entry="case" block><Stack quiet lead="nothing since review" /></Hit>
  }
  return (
    <Hit entry="case" block>
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-amber-500" aria-hidden />
        <Stack
          lead={title || `${n} new ${n === 1 ? 'note' : 'notes'}`}
          qualifier={title && n > 1 ? `and ${n - 1} more` : undefined}
          title={title ?? undefined}
        />
      </span>
    </Hit>
  )
}

/** OWNER — who raised the open recommendation. Not a coverage assignment. */
function OwnerCell({ signal }: { signal: ListRowSignal }) {
  const who = signal.idea?.authorName
  if (!who) return <Hit entry="work" block><Stack quiet lead="—" /></Hit>
  return <Hit entry="work" block><Stack lead={who} /></Hit>
}

/** STAGE — where the recommendation is, in the desk's own wording. */
function StageCell({ signal }: { signal: ListRowSignal }) {
  const stage = signal.idea?.stage
  if (!stage) return null
  const owed = signal.work.tier === 'decision'
  return (
    <Hit entry="work" block>
      <span
        className={clsx(
          'text-[12px] leading-none truncate',
          owed
            ? 'font-semibold text-amber-700 dark:text-amber-400'
            : 'font-medium text-gray-600 dark:text-gray-300',
        )}
        // The full label on hover, so a narrow pane still gives up the state.
        title={stageLabel(stage)}
      >
        {stageLabel(stage)}
      </span>
    </Hit>
  )
}

/** AGE — how long the outstanding item has been waiting. */
function AgeCell({ signal }: { signal: ListRowSignal }) {
  const a = ago(signal.idea?.createdAt)
  if (!a) return null
  const owed = signal.work.tier === 'decision'
  return (
    <Hit entry="work">
      {/* `whitespace-nowrap`: "8 mo" is one fact and wrapped onto two lines
          at the old width, which made the row taller than its neighbours. */}
      <span className={clsx(
        'text-[12px] tabular-nums leading-none whitespace-nowrap',
        owed
          ? 'font-semibold text-amber-700 dark:text-amber-400'
          : 'font-medium text-gray-500 dark:text-gray-400',
      )}>{a}</span>
    </Hit>
  )
}

/**
 * SIZING CHANGE — current weight against what the recommendation proposes.
 *
 * Both numbers are stored facts: the current weight from `portfolio_holdings`
 * via the book's own NAV, the proposed from `trade_queue_items.proposed_weight`.
 * The basis-point delta is the figure a PM is actually deciding on, so it
 * carries the colour; the bar is the same two numbers as a shape.
 */
function SizingCell({ signal }: { signal: ListRowSignal }) {
  const proposed = signal.idea?.proposedWeight
  if (proposed == null || !Number.isFinite(proposed)) return null
  const current = signal.weightPct ?? 0
  const bps = Math.round((proposed - current) * 100)
  const up = bps >= 0
  const scale = Math.max(current, proposed) * 1.3 || 1
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100).toFixed(1)}%`
  return (
    <Hit entry="position" block>
      <span className="flex items-baseline gap-1.5 text-[12px] tabular-nums leading-none">
        <span className="text-gray-500 dark:text-gray-400">{current.toFixed(2)}%</span>
        <span className="text-gray-300 dark:text-gray-600" aria-hidden>→</span>
        <span className="font-semibold text-gray-900 dark:text-gray-100">{proposed.toFixed(2)}%</span>
        <span className={clsx(
          'font-semibold',
          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
        )}>{up ? '+' : ''}{bps}bp</span>
      </span>
      <span className="relative mt-[3px] block h-[4px] w-full overflow-hidden rounded-sm bg-gray-150 dark:bg-gray-800">
        <span className="absolute inset-y-0 left-0 rounded-sm bg-gray-400 dark:bg-gray-500"
          style={{ width: pct(current) }} />
        <span
          className={clsx('absolute inset-y-0 rounded-sm', up ? 'bg-emerald-500/80' : 'bg-rose-500/80')}
          style={{ left: pct(Math.min(current, proposed)), width: pct(Math.abs(proposed - current)) }}
        />
      </span>
    </Hit>
  )
}

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
  /**
   * Cached history for this row, already reduced. From `useListPriceHistory`,
   * batched once for the list rather than fetched per row.
   */
  market?: RowMarket,
  /** The list's shared sparkline domain, so rows are comparable. */
  domain?: { lo: number; hi: number },
): React.ReactNode | undefined {
  const finite = (v: unknown) => {
    const n = v == null ? NaN : Number(v)
    return Number.isFinite(n) ? n : null
  }
  // Live where we have it, stored otherwise — the same precedence the table's
  // own price cell uses, so the two can never disagree.
  const price = finite(quote?.price) ?? finite(asset?.current_price)
  /*
   * A change of exactly zero is UNKNOWN, whatever claims to have measured it.
   *
   * Observed in the running app: every row read a green `+0.0%`. Neither
   * source is reporting a flat tape —
   *
   *   • `assets.change_percent` does not exist as a column at all (the REST
   *     API answers `42703 column assets.change_percent does not exist`), so
   *     the stored fallback is permanently undefined;
   *   • the live quote path is dead. The console shows `finnhub.io/...
   *     token=demo` refused by the page's own CSP, and the chart proxy
   *     answering 502. The provider hands back a zero-FILLED quote object
   *     rather than nothing, so `changePercent === 0` is a failure mode
   *     wearing the shape of a measurement.
   *
   * Two earlier attempts at this rule were too generous and both still
   * painted the zeros. Trusting a live zero failed because the live zero is
   * the failure. Trusting one that a previous close corroborated failed too:
   * the quote this deployment produces carries `previousClose === price`, so
   * the corroboration passed on exactly the rows it was meant to catch.
   *
   * So: a change of zero is never rendered, from any source. A genuinely flat
   * close is real but vanishingly rare, and showing nothing on that one day
   * costs a reader nothing — while a column that reads `+0.0%` on every row
   * costs them the column. `createPlaceholderQuote` was deleted from
   * `browser-client.ts` for the same reason; this is the display-side half of
   * that defect, and the quote layer feeding the table still has it.
   *
   * Keep this in step with `changePct` in `ListRowExpansion`.
   */
  const live = finite(quote?.changePercent)
  const stored = finite(asset?.change_percent ?? asset?.changePercent)
  const changePct = live != null && live !== 0
    ? live
    : (stored != null && stored !== 0 ? stored : null)

  switch (columnId) {
    case 'list_market':    return <MarketCell price={finite(asset?.current_price)} liveQuotePrice={finite(quote?.price)} changePct={changePct} market={market} domain={domain} />
    case 'list_exposure':  return <ExposureCell signal={signal} />
    case 'list_view':      return <ViewCell signal={signal} price={price} />
    case 'list_valuation': return <ValuationCell signal={signal} price={price} />
    case 'list_work':      return <WorkCell signal={signal} />
    case 'list_last':      return <LastCell price={finite(asset?.current_price)} liveQuotePrice={finite(quote?.price)} market={market} />
    case 'list_1m':        return <ReturnCell r={market?.m1} />
    case 'list_6m':        return <ReturnCell r={market?.m6} />
    case 'list_trend':     return <TrendCell market={market} domain={domain} />
    case 'list_case':      return <CaseCell signal={signal} />
    case 'list_evidence':  return <EvidenceCell signal={signal} />
    case 'list_changed':   return <ChangedCell signal={signal} />
    case 'list_owner':     return <OwnerCell signal={signal} />
    case 'list_stage':     return <StageCell signal={signal} />
    case 'list_age':       return <AgeCell signal={signal} />
    case 'list_sizing':    return <SizingCell signal={signal} />
    default: return undefined
  }
}
