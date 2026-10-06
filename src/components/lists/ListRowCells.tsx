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
import type { ListRowSignal } from '../../hooks/lists/useListRowSignals'
import type { ColumnConfig } from '../table/AssetTableView'

/** Investment-signal columns. Apply to curated lists and screens alike. */
export const LIST_SIGNAL_COLUMNS: ColumnConfig[] = [
  // All sortable: a watchlist whose columns cannot be ordered is a report. The
  // comparators live with the surface that owns the data — see
  // `listSortComparators`, handed to the table as `extraSortComparators`.
  // The sparkline grows: a month of movement in 64px flattens everything but
  // the extremes, which is how every name ends up looking like the same gentle
  // slope.
  { id: 'list_spark',    label: '1M',       visible: true, width: 80,  minWidth: 64, sortable: true, pinned: false, category: 'price', grow: 1 },
  { id: 'list_position', label: 'Position', visible: true, width: 72,  minWidth: 60, sortable: true, pinned: false, category: 'price', align: 'right' },
  // "View" rather than "Rating": the cell carries the rating AND the conviction
  // behind it, which together are the house view, and two columns for one
  // judgement is what pushed this line into horizontal scroll.
  { id: 'list_rating',   label: 'View',     visible: true, width: 84,  minWidth: 72, sortable: true, pinned: false, category: 'research' },
  { id: 'list_target',   label: 'Target',   visible: true, width: 98,  minWidth: 84, sortable: true, pinned: false, category: 'research', align: 'right' },
  // Work grows most: it is the only column whose job is to say WHY a name needs
  // attention, and "New research" truncated to "New rese…" says nothing.
  { id: 'list_work',     label: 'Work',     visible: true, width: 140, minWidth: 110, sortable: true, pinned: false, category: 'workflow', grow: 2 },
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
    list_spark: (a, b) => oneMonth(signalFor(a?.id)) - oneMonth(signalFor(b?.id)),
    list_position: (a, b) => num(signalFor(a?.id).weightPct) - num(signalFor(b?.id).weightPct),
    list_target: (a, b) => num(signalFor(a?.id).targetPrice) - num(signalFor(b?.id).targetPrice),
    list_rating: (a, b) => {
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
  'select', 'ticker', 'companyName',
  'price', 'change', 'list_spark',
  'list_position',
  'list_rating', 'list_target',
  'list_work',
  'coverage',
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
  ticker: 90,
  companyName: 160,
  price: 84,
  change: 72,
  coverage: 110,
}

/**
 * Who takes the pane's leftover width, and in what proportion.
 *
 * The identity gets the most: a truncated company name is the one thing on the
 * line a reader cannot reconstruct from context. Work next, because it carries
 * the reason for attention. Everything else holds a number whose width is the
 * number's own.
 */
const GROW: Readonly<Record<string, number>> = {
  companyName: 3,
  coverage: 1,
}

/**
 * Shorter headings, for this surface only.
 *
 * "Change %" wrapped to two lines in a column sized for the number rather than
 * for the word, which put a two-line heading over a one-line table. The shared
 * default keeps its full label everywhere else.
 */
const LABEL: Readonly<Record<string, string>> = {
  change: 'Chg %',
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
const RIGHT_ALIGNED = new Set(['price', 'change'])

/**
 * Bumped whenever ORDER, HIDDEN or WIDTH change.
 *
 * `AssetTableView` stores this alongside the saved column layout; a mismatch
 * re-seeds from the preset once. Without it a saved layout pins the old
 * default forever — which is exactly what happened to the first version of
 * this preset, and why the columns it hid were still on screen.
 */
export const LIST_COLUMN_PRESET_VERSION = 'lists-2026-10-06a'

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
  // The list's own process state. Real, but it answers a question about this
  // list rather than about the security, and the expansion's Overview shows it.
  'list_status',
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

function SparkCell({ signal }: { signal: ListRowSignal }) {
  if (!signal.closes || signal.closes.length < 2) return null
  /*
   * Fills whatever width the column grew to — capped at 64px it read as a
   * texture rather than a chart.
   *
   * Height is deliberately well under the row: at 28px in a 44px row the
   * gradient fills of consecutive rows nearly touched and the column read as
   * one continuous ribbon down the table rather than as one chart per name.
   */
  /*
   * The height lives on a WRAPPER, not on the chart.
   *
   * `Sparkline` bakes `h-full w-full` into its own svg, so a height passed
   * through `className` loses to it and the chart grew to fill the whole row —
   * which is what made consecutive rows' gradient fills touch and read as one
   * continuous ribbon down the column instead of one chart per name.
   */
  return (
    <span className="block h-[18px] w-full">
      <Sparkline points={signal.closes} reference={signal.targetPrice} />
    </span>
  )
}

function PositionCell({ signal }: { signal: ListRowSignal }) {
  if (signal.weightPct == null) return null
  return (
    <span
      className="text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100"
      title="Largest single-portfolio weight"
    >
      {signal.weightPct.toFixed(signal.weightPct >= 10 ? 1 : 2)}%
    </span>
  )
}

function RatingCell({ signal }: { signal: ListRowSignal }) {
  if (!signal.ratingValue) return null
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <RatingPill value={signal.ratingValue} color={signal.ratingColor} />
      {signal.conviction && <ConvictionBars level={signal.conviction} />}
    </span>
  )
}

/**
 * Target, with upside against the stored price.
 *
 * Upside is computed here rather than read from a column so its two inputs are
 * named in the tooltip — `current_price` on the asset and the official (else
 * newest) price target. The table's live quote is not available to a cell
 * renderer, so this is the stored price and says so.
 */
function TargetCell({ signal, price }: { signal: ListRowSignal; price: number | null }) {
  if (signal.targetPrice == null) return null
  const upside = price != null && price > 0
    ? (signal.targetPrice - price) / price * 100
    : null
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0 tabular-nums">
      <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
        {signal.targetPrice.toFixed(2)}
      </span>
      {upside != null && (
        <span
          className={clsx(
            'text-[11px] font-semibold',
            upside >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400',
          )}
          title={`Against the last stored price of ${price!.toFixed(2)}`}
        >
          {upside >= 0 ? '+' : ''}{upside.toFixed(0)}%
        </span>
      )}
    </span>
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
    <span className="inline-flex flex-col min-w-0 max-w-full gap-[1px] leading-none">
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
    </span>
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
  asset: { current_price?: number | string | null },
  signal: ListRowSignal,
): React.ReactNode | undefined {
  const price = asset?.current_price == null ? null : Number(asset.current_price)
  switch (columnId) {
    case 'list_spark':    return <SparkCell signal={signal} />
    case 'list_position': return <PositionCell signal={signal} />
    case 'list_rating':   return <RatingCell signal={signal} />
    case 'list_target':
      return <TargetCell signal={signal} price={Number.isFinite(price) ? price : null} />
    case 'list_work':     return <WorkCell signal={signal} />
    default: return undefined
  }
}
