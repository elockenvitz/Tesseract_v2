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
import { STATE_LABEL, type ResearchState } from '../../lib/desktop-research/model'
import type { ListRowMode } from './listRowModes'
import type { ListRowSignal } from '../../hooks/lists/useListRowSignals'
import type { ColumnConfig } from '../table/AssetTableView'

/** Investment-signal columns. Apply to curated lists and screens alike. */
export const LIST_SIGNAL_COLUMNS: ColumnConfig[] = [
  // All sortable: a watchlist whose columns cannot be ordered is a report. The
  // comparators live with the surface that owns the data — see
  // `listSortComparators`, handed to the table as `extraSortComparators`.
  { id: 'list_spark',    label: '1M',       visible: true, width: 64,  minWidth: 48, sortable: true, pinned: false, category: 'price' },
  { id: 'list_position', label: 'Position', visible: true, width: 68,  minWidth: 56, sortable: true, pinned: false, category: 'price' },
  // "View" rather than "Rating": the cell carries the rating AND the conviction
  // behind it, which together are the house view, and two columns for one
  // judgement is what pushed this line into horizontal scroll.
  { id: 'list_rating',   label: 'View',     visible: true, width: 76,  minWidth: 64, sortable: true, pinned: false, category: 'research' },
  { id: 'list_target',   label: 'Target',   visible: true, width: 92,  minWidth: 76, sortable: true, pinned: false, category: 'research' },
  { id: 'list_work',     label: 'Work',     visible: true, width: 132, minWidth: 96, sortable: true, pinned: false, category: 'workflow' },
]

/**
 * How urgent each research state is, for ordering the Work column.
 *
 * Highest first when sorted descending, which is what a reader wants on the
 * first click: unanswered research leads, because it is the one state where the
 * written case may already be wrong. "Current" is last and `null` — no subject
 * at all — is below it, since an absent case is a gap rather than a verdict.
 */
const WORK_URGENCY: Record<ResearchState, number> = {
  'evidence-since-review': 6,
  'moved-since-review': 5,
  stale: 4,
  'incomplete-thesis': 3,
  'no-thesis': 2,
  thin: 1,
  current: 0,
}

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
      const sa = signalFor(a?.id)
      const sb = signalFor(b?.id)
      const ua = sa.state ? WORK_URGENCY[sa.state] : -1
      const ub = sb.state ? WORK_URGENCY[sb.state] : -1
      if (ua !== ub) return ua - ub
      // Within the same state, more unreviewed notes is more urgent.
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
const WIDTH: Readonly<Record<string, number>> = {
  ticker: 88,
  companyName: 150,
  price: 80,
  change: 68,
  coverage: 110,
}

/**
 * Bumped whenever ORDER, HIDDEN or WIDTH change.
 *
 * `AssetTableView` stores this alongside the saved column layout; a mismatch
 * re-seeds from the preset once. Without it a saved layout pins the old
 * default forever — which is exactly what happened to the first version of
 * this preset, and why the columns it hid were still on screen.
 */
export const LIST_COLUMN_PRESET_VERSION = 'lists-2026-10-05b'

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
    if (HIDDEN.has(col.id)) return { ...col, visible: false, width }
    return width === col.width ? col : { ...col, width }
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
  return (
    <Sparkline
      points={signal.closes}
      className="h-5 w-full max-w-[64px]"
      reference={signal.targetPrice}
    />
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
const WORK_TONE: Partial<Record<ResearchState, string>> = {
  'evidence-since-review': 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30',
  'moved-since-review':    'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30',
  'no-thesis':             'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800',
  'incomplete-thesis':     'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800',
  stale:                   'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800',
}

function WorkCell({ signal }: { signal: ListRowSignal }) {
  const { state, subject } = signal
  if (!state) return null
  // Named so the count is legible without opening the row: "New research · 3".
  const count = state === 'evidence-since-review' ? subject?.newSinceReview ?? 0 : 0
  const tone = WORK_TONE[state]
  if (!tone) {
    return (
      <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
        {STATE_LABEL[state]}
      </span>
    )
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded max-w-full',
        'text-[11px] font-medium leading-none truncate',
        tone,
      )}
    >
      <span className="truncate">{STATE_LABEL[state]}</span>
      {count > 0 && <span className="tabular-nums flex-shrink-0 opacity-70">{count}</span>}
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
