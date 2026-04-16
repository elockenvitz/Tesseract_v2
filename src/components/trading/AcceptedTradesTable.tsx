/**
 * AcceptedTradesTable — Reusable table component for the Trade Book.
 *
 * Displays accepted trades with sorting, filtering, expandable comment threads,
 * and role-based actions.
 */

import { useState, useMemo, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ChevronRight,
  MessageSquare,
  Undo2,
  Wrench,
  Inbox,
  FlaskConical,
  Plus,
  ArrowUpDown,
  Layers,
  Search,
  X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { ExecutionStatusDropdown } from './ExecutionStatusDropdown'
import { PairBadge } from './PairBadge'
import { buildPairInfoByAsset } from '../../lib/trade-lab/pair-info'
import { useAcceptedTradeComments } from '../../hooks/useAcceptedTrades'
import { useAuth } from '../../hooks/useAuth'
import {
  tradeLifecyclePhase,
  nextActionCopy,
  PHASE_META,
  SEVERITY_META,
  type LifecyclePhase,
} from '../../lib/trade-book/lifecycle'
import type {
  AcceptedTradeWithJoins,
  AcceptedTradeComment,
  TradeBatch,
  ExecutionStatus,
  ActionContext,
  TradeAction,
} from '../../types/trading'
import type { HoldingsSource } from '../../types/organization'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_COLORS: Record<string, string> = {
  buy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  add: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  sell: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  trim: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const SOURCE_ICONS: Record<string, React.ElementType> = {
  inbox: Inbox,
  simulation: FlaskConical,
  adhoc: Plus,
}

const SOURCE_LABELS: Record<string, string> = {
  inbox: 'Inbox',
  simulation: 'Sim',
  adhoc: 'Ad-hoc',
}

type SortKey = 'symbol' | 'action' | 'target_weight' | 'delta_weight' | 'delta_shares' | 'notional_value' | 'state' | 'created_at'
type SortDir = 'asc' | 'desc'

/**
 * Directional notional for display. `accepted_trades.notional_value` is
 * stored as an unsigned magnitude; we apply the sign at render time
 * using the trade's action. Sells/trims render as negative dollars so a
 * PM skimming the Trade Book can tell at a glance which rows are adds
 * and which are reductions without reading the action column.
 */
function signedNotional(
  notional: number | null | undefined,
  action: string,
): number | null {
  if (notional == null) return null
  const mag = Math.abs(notional)
  return action === 'sell' || action === 'trim' ? -mag : mag
}

/**
 * Format a signed notional into "$120,000" or "-$120,000". Returns "—"
 * when the value is nullish, which is how empty cells render across
 * the Trade Book.
 */
function fmtSignedNotional(val: number | null): string {
  if (val == null) return '—'
  const abs = Math.abs(val).toLocaleString()
  return val < 0 ? `-$${abs}` : `$${abs}`
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AcceptedTradesTableProps {
  trades: AcceptedTradeWithJoins[]
  batches?: TradeBatch[]
  /**
   * Optional initial search query. Used when the parent navigates
   * in via an explicit action (e.g., the Batches detail panel's
   * "Open in Trades" button) that wants to pre-filter the list.
   * One-shot — only applied at mount via the useState initializer.
   * The parent should NOT persist this across tab switches; a
   * transient signal is enough to carry intent across the view
   * toggle without contaminating unrelated re-mounts.
   */
  initialSearchQuery?: string | null
  /**
   * Portfolio's holdings_source. Controls whether the execution_status cell
   * shows the full trader dropdown ('live_feed'/'manual_eod') or an inert
   * "Auto" badge ('paper' — trades auto-complete on accept and there is no
   * trader workflow). Undefined falls back to dropdown for safety.
   */
  holdingsSource?: HoldingsSource
  /**
   * Optional override for pair info. When the parent fetches full pair
   * context (trade_queue_items joined by pair_id) this lets the badge
   * render even when only one leg of a pair has been committed to
   * accepted_trades. If omitted, pair info is built from the trades array
   * alone — which means singleton-committed pairs won't get a badge.
   */
  pairInfoByAsset?: Map<string, import('../../lib/trade-lab/pair-info').PairLegInfo>
  onUpdateExecutionStatus: (id: string, status: ExecutionStatus, note: string | null, context: ActionContext) => void
  onUpdateSizing?: (id: string, updates: { sizing_input?: string; action?: TradeAction }, context: ActionContext) => void
  onRevert?: (id: string, reason: string, context: ActionContext) => void
  /** Post-reconciliation correction flow. Takes an existing accepted_trade
   *  and a new sizing_input, creates a second accepted_trade pointing back
   *  at the original via corrects_accepted_trade_id. The original stays
   *  visible with a "→ corrected by" link. */
  onCreateCorrection?: (
    originalTradeId: string,
    sizingInput: string,
    note: string,
    context: ActionContext,
  ) => void
  onAddComment?: (tradeId: string, content: string) => void
  canEdit?: boolean
  canUpdateExecution?: boolean
  canRevert?: boolean
}

// Batches are pure grouping objects — no review/approval semantics.
const BATCH_STATUS_STYLES: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  cancelled: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
}

// ---------------------------------------------------------------------------
// Reason Block
// ---------------------------------------------------------------------------

/**
 * Render the PM rationale for a single committed trade. The reason is
 * persisted on `accepted_trades.acceptance_note` with this precedence
 * (set at execute time by buildAcceptedTradeInput):
 *
 *   1. Per-trade reason typed in the Execute modal
 *   2. Batch rationale / description (inherited — common for cash
 *      raises and rebalances where every trade shares one overall why)
 *   3. Variant notes from earlier editing
 *   4. null
 *
 * When the acceptance_note exactly equals the parent batch's
 * description, we label it "From batch rationale" so the PM can tell
 * whether a reason was trade-specific or inherited. Otherwise it's
 * shown as a trade-level note.
 */
export function ReasonBlock({
  acceptanceNote,
  batchDescription,
}: {
  acceptanceNote: string | null | undefined
  batchDescription?: string | null
}) {
  const note = (acceptanceNote || '').trim()
  const batchDesc = (batchDescription || '').trim()

  if (!note) {
    return (
      <div className="rounded-md border border-dashed border-gray-200 dark:border-gray-700 px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500 italic">
        No reason was captured for this trade.
      </div>
    )
  }

  const isInherited = batchDesc.length > 0 && note === batchDesc

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1 text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {isInherited ? 'From batch rationale' : 'Why'}
      </div>
      <div className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
        {note}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comment Thread
// ---------------------------------------------------------------------------

function CommentThread({ tradeId, onAddComment }: { tradeId: string; onAddComment?: (tradeId: string, content: string) => void }) {
  const { data: comments = [] } = useAcceptedTradeComments(tradeId)
  const [draft, setDraft] = useState('')
  const { user } = useAuth()

  const handleSubmit = () => {
    if (!draft.trim() || !onAddComment) return
    onAddComment(tradeId, draft.trim())
    setDraft('')
  }

  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
        Comments
      </div>
      {comments.length > 0 ? (
        <div className="space-y-1.5 mb-2">
          {comments.map((c: AcceptedTradeComment) => (
            <div key={c.id} className="flex gap-2 text-xs">
              <span className="font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">
                {c.user?.first_name || c.user?.email?.split('@')[0] || 'User'}
              </span>
              <span className="text-gray-500 dark:text-gray-500 flex-1">{c.content}</span>
              <span className="text-gray-400 dark:text-gray-600 whitespace-nowrap">
                {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-600 mb-2">No comments yet</p>
      )}
      {onAddComment && (
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Add a comment..."
            className="flex-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400"
          />
          <button
            onClick={handleSubmit}
            disabled={!draft.trim()}
            className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 transition-colors"
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function AcceptedTradesTable({
  trades,
  batches,
  initialSearchQuery,
  onUpdateExecutionStatus,
  onUpdateSizing,
  onRevert,
  onCreateCorrection,
  onAddComment,
  canEdit = false,
  canUpdateExecution = false,
  canRevert = false,
  holdingsSource,
  pairInfoByAsset: externalPairInfo,
}: AcceptedTradesTableProps) {
  const { user } = useAuth()
  // `selectedTradeId` drives the right-side detail pane. Clicking
  // the chevron, the row, or the comment icon all open the pane for
  // that trade. The pane shows the reason (acceptance_note) and the
  // comment thread together — previously both lived in an inline
  // expanded row underneath the trade which crowded the table and
  // pushed other trades out of view.
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filterPhase, setFilterPhase] = useState<LifecyclePhase | 'all'>('all')
  const [filterSource, setFilterSource] = useState<string | 'all'>('all')
  // Free-text search — matches against symbol, company name, batch
  // name, and the trade's acceptance_note (the "why"). One-shot
  // pre-fill from `initialSearchQuery` (captured here in the
  // useState initializer so later prop changes don't clobber the
  // user's edits). That prop is set by the parent ONLY when an
  // explicit navigation wants to carry intent — tab-switch
  // re-mounts with a null initialSearchQuery and the search stays
  // blank.
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '')

  // Tag every trade with its lifecycle phase ONCE. Every downstream
  // consumer (filter, sort, cell render, next-action column) reads
  // from this cached field via `phaseByTradeId.get(trade.id)` so the
  // derivation never happens more than once per trade per render and
  // the State pill + Next action + phase filter all stay in lock-step.
  const phaseByTradeId = useMemo(() => {
    const m = new Map<string, ReturnType<typeof tradeLifecyclePhase>>()
    for (const t of trades) {
      m.set(t.id, tradeLifecyclePhase(t as any, holdingsSource))
    }
    return m
  }, [trades, holdingsSource])

  // Build batch lookup
  const batchMap = useMemo(() => {
    const m = new Map<string, TradeBatch>()
    batches?.forEach(b => m.set(b.id, b))
    return m
  }, [batches])

  // Pair info lookup. Prefer the external map passed in by the parent
  // (TradeBookPage fetches full trade_queue_items context so pairs with
  // only some legs committed still get a badge). Fall back to building
  // from the trades array alone for callers that haven't wired full context.
  const pairInfoByAsset = useMemo(() => {
    if (externalPairInfo) return externalPairInfo
    return buildPairInfoByAsset(
      trades.map(t => ({
        asset_id: t.asset_id,
        symbol: t.asset?.symbol,
        pair_id: t.trade_queue_item?.pair_id ?? null,
        pair_trade_id: t.trade_queue_item?.pair_trade_id ?? null,
        pair_leg_type: t.trade_queue_item?.pair_leg_type ?? null,
        action: t.trade_queue_item?.action ?? t.action,
      })),
    )
  }, [trades, externalPairInfo])

  // Correction chain lookup. Walks the current trades array and builds a
  // map from a trade id to its corrected-by successor (the newer trade
  // that points at it via corrects_accepted_trade_id). Used for the inline
  // "→ corrected by" / "← corrects" links in the symbol cell.
  const correctionLinks = useMemo(() => {
    // forward: originalId → { symbol, id } of the correction that replaces it
    // backward: correctionId → { symbol, id } of the original it corrects
    const forward = new Map<string, { id: string; symbol: string }>()
    const backward = new Map<string, { id: string; symbol: string }>()
    const byId = new Map<string, AcceptedTradeWithJoins>()
    for (const t of trades) byId.set(t.id, t)
    for (const t of trades) {
      const originalId = (t as any).corrects_accepted_trade_id as string | null
      if (!originalId) continue
      const original = byId.get(originalId)
      forward.set(originalId, { id: t.id, symbol: t.asset?.symbol || '?' })
      if (original) {
        backward.set(t.id, { id: original.id, symbol: original.asset?.symbol || '?' })
      }
    }
    return { forward, backward }
  }, [trades])

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }, [sortKey])

  const filtered = useMemo(() => {
    let list = trades
    if (filterPhase !== 'all') {
      list = list.filter(t => phaseByTradeId.get(t.id)?.phase === filterPhase)
    }
    if (filterSource !== 'all') {
      list = list.filter(t => t.source === filterSource)
    }
    // Free-text search. Lowercased single-pass match across the four
    // fields that a PM is likely to scan for: symbol, company name,
    // the parent batch name, and the trade's acceptance_note (the
    // "why"). Empty query is a no-op so the filter is transparent
    // when the user hasn't typed anything.
    const q = searchQuery.trim().toLowerCase()
    if (q.length > 0) {
      list = list.filter(t => {
        const batchName = t.batch_id ? batchMap.get(t.batch_id)?.name || '' : ''
        const symbol = t.asset?.symbol || ''
        const company = t.asset?.company_name || ''
        const note = (t as any).acceptance_note || ''
        return (
          symbol.toLowerCase().includes(q)
          || company.toLowerCase().includes(q)
          || batchName.toLowerCase().includes(q)
          || note.toLowerCase().includes(q)
        )
      })
    }
    return list
  }, [trades, filterPhase, filterSource, searchQuery, phaseByTradeId, batchMap])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    type T = typeof filtered[number]

    // Extract the user's primary sort key as a comparable number or string.
    // Returning a tuple keeps the comparator simple.
    const primaryKey = (t: T): [number | string, 'num' | 'str'] => {
      switch (sortKey) {
        case 'symbol': return [t.asset?.symbol || '', 'str']
        case 'action': return [t.action, 'str']
        case 'target_weight': return [t.target_weight ?? 0, 'num']
        case 'delta_weight': return [t.delta_weight ?? 0, 'num']
        case 'delta_shares': return [t.delta_shares ?? 0, 'num']
        case 'notional_value': return [t.notional_value ?? 0, 'num']
        case 'state': return [PHASE_META[phaseByTradeId.get(t.id)?.phase ?? 'queued'].order, 'num']
        case 'created_at': return [t.created_at, 'str']
        default: return [0, 'num']
      }
    }
    const comparePrimary = (a: T, b: T): number => {
      const [ka, kind] = primaryKey(a)
      const [kb] = primaryKey(b)
      if (kind === 'num') return dir * ((ka as number) - (kb as number))
      return dir * (ka as string).localeCompare(kb as string)
    }

    // Group trades so that pair legs stay adjacent. Singleton trades live in
    // their own group of one. Pair groups preserve their legs in a stable
    // order (long first, then by symbol) so CLOV always renders the same way.
    interface Group { anchor: string; members: T[]; representative: T }
    const groupMap = new Map<string, Group>()
    for (const t of filtered) {
      const pid = t.trade_queue_item?.pair_id || t.trade_queue_item?.pair_trade_id
      const info = pid ? pairInfoByAsset.get(t.asset_id) : null
      const anchor = info ? `pair:${pid}` : `single:${t.id}`
      const existing = groupMap.get(anchor)
      if (existing) {
        existing.members.push(t)
      } else {
        groupMap.set(anchor, { anchor, members: [t], representative: t })
      }
    }

    // Sort each pair group's members by direction (long → short) then symbol
    for (const g of groupMap.values()) {
      if (g.members.length <= 1) continue
      g.members.sort((a, b) => {
        const da = pairInfoByAsset.get(a.asset_id)?.direction || 'z'
        const db = pairInfoByAsset.get(b.asset_id)?.direction || 'z'
        if (da !== db) return da.localeCompare(db)
        return (a.asset?.symbol || '').localeCompare(b.asset?.symbol || '')
      })
      // Use the first member as the group's sort representative so the whole
      // cluster travels together when the user re-sorts.
      g.representative = g.members[0]
    }

    // Sort groups by the user's primary key (applied to the representative)
    const groups = Array.from(groupMap.values())
    groups.sort((ga, gb) => comparePrimary(ga.representative, gb.representative))
    return groups.flatMap(g => g.members)
  }, [filtered, sortKey, sortDir, pairInfoByAsset])

  const totalNotional = useMemo(() => trades.reduce((s, t) => s + (t.notional_value ?? 0), 0), [trades])

  const getContext = useCallback((): ActionContext => ({
    actorId: user!.id,
    actorName: (user as any)?.first_name || user?.email || 'User',
    actorRole: 'pm',
    requestId: `trade-book-${Date.now()}`,
  }), [user])

  const SortHeader = ({ label, k, align }: { label: string; k: SortKey; align?: string }) => (
    <th
      className={clsx(
        'py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none',
        align === 'right' ? 'text-right' : 'text-left'
      )}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && (
          <ArrowUpDown className="w-3 h-3 opacity-60" />
        )}
      </span>
    </th>
  )

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
          <Inbox className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No accepted trades</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Accept recommendations from the Decision Inbox or promote trades from the simulation
        </p>
      </div>
    )
  }

  const selectedTrade = selectedTradeId ? trades.find(t => t.id === selectedTradeId) : null

  return (
    <div className="flex h-full min-h-0">
      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <select
          value={filterPhase}
          onChange={e => setFilterPhase(e.target.value as any)}
          className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option value="all">All States</option>
          <option value="queued">{PHASE_META.queued.label}</option>
          <option value="working">{PHASE_META.working.label}</option>
          <option value="awaiting_recon">{PHASE_META.awaiting_recon.label}</option>
          <option value="needs_review">{PHASE_META.needs_review.label}</option>
          <option value="settled">{PHASE_META.settled.label}</option>
          <option value="cancelled">{PHASE_META.cancelled.label}</option>
        </select>
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value)}
          className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option value="all">All Sources</option>
          <option value="inbox">Inbox</option>
          <option value="simulation">Simulation</option>
          <option value="adhoc">Ad-hoc</option>
        </select>
        {/* Free-text search. Matches symbol, company name, batch
            name, or reason. Replaces the old per-batch dropdown —
            batch-name is still searchable, and the PM can also find
            trades by ticker, reason keyword, or company without
            opening a dropdown. */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search symbol, batch, reason..."
            className="w-full text-xs pl-7 pr-7 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex-1" />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {filtered.length} trade{filtered.length !== 1 ? 's' : ''}
          {totalNotional !== 0 && ` · $${Math.abs(totalNotional).toLocaleString()} total notional`}
        </span>
      </div>

      {/* Table — Trade Book is the sole canonical committed-trade surface */}
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            {/* expand column */}
            <th className="w-8" />
            <SortHeader label="Symbol" k="symbol" />
            <SortHeader label="Action" k="action" />
            {/* Sizing column merged into Tgt Wt: target weight is the
                canonical display and the raw sizing_input is only shown
                as a secondary hint when the framework differs (shares,
                delta, active). For plain weight-target inputs like "2.5"
                the two were identical so we drop the duplicate. */}
            <SortHeader label="Tgt Wt" k="target_weight" align="right" />
            <SortHeader label="Δ Wt" k="delta_weight" align="right" />
            <SortHeader label="Δ Shrs" k="delta_shares" align="right" />
            <SortHeader label="Notional" k="notional_value" align="right" />
            <SortHeader label="State" k="state" />
            <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left">Next action</th>
            <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left">Source</th>
            <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((trade, idx) => {
            const isSelected = selectedTradeId === trade.id
            const SourceIcon = SOURCE_ICONS[trade.source] || Plus
            return (
              <React.Fragment key={trade.id}>
                <tr
                  onClick={() => setSelectedTradeId(isSelected ? null : trade.id)}
                  className={clsx(
                    'border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors',
                    isSelected
                      ? 'bg-primary-50/80 dark:bg-primary-950/30'
                      : idx % 2 === 0
                      ? 'bg-gray-50/30 dark:bg-gray-800/10 hover:bg-gray-50/70 dark:hover:bg-gray-800/40'
                      : 'hover:bg-gray-50/70 dark:hover:bg-gray-800/40',
                  )}
                >
                  <td className="pl-2 py-2">
                    <ChevronRight
                      className={clsx(
                        'w-3.5 h-3.5 text-gray-400 transition-transform',
                        isSelected && 'rotate-90',
                      )}
                    />
                  </td>
                  <td className="py-2 px-3 text-sm font-medium text-gray-900 dark:text-white">
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span>{trade.asset?.symbol || 'Unknown'}</span>
                      {pairInfoByAsset.get(trade.asset_id) && (
                        <PairBadge info={pairInfoByAsset.get(trade.asset_id)!} />
                      )}
                      {/* Correction chain: if this row was later corrected,
                          show "→ corrected"; if this row IS a correction,
                          show "corrects ←". Both badges scroll the peer
                          row into view on click. */}
                      {correctionLinks.forward.get(trade.id) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            const peer = correctionLinks.forward.get(trade.id)
                            if (peer) setSelectedTradeId(peer.id)
                          }}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50"
                          title="This trade was corrected by a later trade"
                        >
                          → corrected
                        </button>
                      )}
                      {correctionLinks.backward.get(trade.id) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            const peer = correctionLinks.backward.get(trade.id)
                            if (peer) setSelectedTradeId(peer.id)
                          }}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-900/50"
                          title={`Corrects earlier trade (${correctionLinks.backward.get(trade.id)?.symbol})`}
                        >
                          corrects ←
                        </button>
                      )}
                      {/* Staleness flag — set by the sweeper when a pending
                          trade crosses the portfolio inactivity window. */}
                      {(trade as any).staleness_flagged_at && trade.reconciliation_status === 'pending' && (
                        <span
                          className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          title={`Flagged stale ${formatDistanceToNow(new Date((trade as any).staleness_flagged_at), { addSuffix: true })} — exceeded portfolio inactivity window`}
                        >
                          stale
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span className={clsx(
                      'inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded',
                      ACTION_COLORS[trade.action] || 'bg-gray-100 text-gray-600'
                    )}>
                      {trade.action}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-sm font-mono text-right text-gray-600 dark:text-gray-300">
                    <div className="flex flex-col items-end leading-tight">
                      <span>
                        {trade.target_weight != null ? `${trade.target_weight.toFixed(2)}%` : '—'}
                      </span>
                      {(() => {
                        // Show the raw sizing_input as a muted secondary
                        // line only when the PM's framework wasn't a plain
                        // weight-target (i.e. when it carries information
                        // not captured by the target_weight figure alone).
                        //
                        //   #500       shares-based → show "#500"
                        //   @t0.5      active target → show "@t0.5"
                        //   +0.5 / -1  weight delta → show "+0.5%"
                        //   2.5        plain weight target → hide (redundant)
                        const raw = (trade.sizing_input || '').trim()
                        if (!raw) return null
                        const isShares = raw.startsWith('#')
                        const isActive = raw.startsWith('@')
                        const isDelta = raw.startsWith('+') || raw.startsWith('-')
                        if (!isShares && !isActive && !isDelta) return null
                        return (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                            {raw}
                          </span>
                        )
                      })()}
                    </div>
                  </td>
                  {/* Δ Wt — directional color. */}
                  <td className="py-2 px-3 text-sm font-mono text-right">
                    {trade.delta_weight != null ? (
                      <span
                        className={clsx(
                          'font-semibold',
                          trade.delta_weight > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : trade.delta_weight < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-500 dark:text-gray-400',
                        )}
                      >
                        {trade.delta_weight > 0 ? '+' : ''}
                        {trade.delta_weight.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </td>
                  {/* Δ Shrs — directional color. */}
                  <td className="py-2 px-3 text-sm font-mono text-right">
                    {trade.delta_shares != null ? (
                      <span
                        className={clsx(
                          trade.delta_shares > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : trade.delta_shares < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-500 dark:text-gray-400',
                        )}
                      >
                        {trade.delta_shares > 0 ? '+' : ''}
                        {trade.delta_shares.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </td>
                  {/* Notional — signed by action. Sells/trims render
                      with a leading minus so reductions are visually
                      distinct from adds. Source magnitude comes from
                      accepted_trades.notional_value which is unsigned. */}
                  <td className={clsx(
                    'py-2 px-3 text-sm font-mono text-right',
                    trade.action === 'sell' || trade.action === 'trim'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-600 dark:text-gray-300',
                  )}>
                    {fmtSignedNotional(signedNotional(trade.notional_value, trade.action))}
                  </td>
                  <td className="py-2 px-3">
                    {/* State pill — single source of truth derived from
                        (execution_status, reconciliation_status, stale flag)
                        by tradeLifecyclePhase(). Replaces the old
                        Exec Status + Recon columns. For needs_review rows
                        a secondary severity badge distinguishes a fill
                        mismatch from missing/stale fills. The raw
                        reconciliation detail lives in the tooltip so PMs
                        can eyeball the diff without opening a panel. */}
                    {(() => {
                      const result = phaseByTradeId.get(trade.id) || { phase: 'queued' as const }
                      const meta = PHASE_META[result.phase]
                      const detail = trade.reconciliation_detail
                      const reconTooltip = detail
                        ? [
                            detail.expected_shares != null && `Expected: ${detail.expected_shares.toLocaleString()}`,
                            detail.actual_shares != null && `Actual: ${detail.actual_shares.toLocaleString()}`,
                            detail.delta_shares != null && `Δ: ${detail.delta_shares > 0 ? '+' : ''}${detail.delta_shares.toLocaleString()} sh`,
                            detail.deviation_pct != null && `${(detail.deviation_pct * 100).toFixed(1)}% off`,
                          ].filter(Boolean).join(' · ')
                        : undefined
                      return (
                        <div className="flex flex-col items-start gap-0.5">
                          <span
                            className={clsx(
                              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold',
                              meta.pillClass,
                            )}
                            title={reconTooltip}
                          >
                            <span className={clsx('w-1.5 h-1.5 rounded-full', meta.dotClass)} />
                            {meta.label}
                          </span>
                          {result.phase === 'needs_review' && result.severity && (
                            <span
                              className={clsx(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider',
                                SEVERITY_META[result.severity].pillClass,
                              )}
                            >
                              {SEVERITY_META[result.severity].label}
                            </span>
                          )}
                          {(result.phase === 'needs_review' || result.phase === 'awaiting_recon') &&
                            detail?.delta_shares != null && (
                              <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                                {(detail.delta_shares > 0 ? '+' : '')}
                                {detail.delta_shares.toLocaleString()} sh
                              </span>
                            )}
                        </div>
                      )
                    })()}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-300">
                    {nextActionCopy(phaseByTradeId.get(trade.id) || { phase: 'queued' })}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <SourceIcon className="w-3 h-3" />
                        {SOURCE_LABELS[trade.source]}
                      </span>
                      {/* Batch chip — clicking it drops the batch name
                          into the search, which narrows the result
                          set to that batch's trades (same end state
                          the old dropdown produced). */}
                      {trade.batch_id && batchMap.get(trade.batch_id) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setSearchQuery(batchMap.get(trade.batch_id!)?.name || '')
                          }}
                          className={clsx(
                            'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded w-fit cursor-pointer hover:ring-1 hover:ring-indigo-300 dark:hover:ring-indigo-600 transition-shadow',
                            BATCH_STATUS_STYLES[batchMap.get(trade.batch_id)!.status] || BATCH_STATUS_STYLES.active
                          )}
                          title="Search for this batch"
                        >
                          <Layers className="w-2.5 h-2.5" />
                          {batchMap.get(trade.batch_id)!.name || 'Batch'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td
                    className="py-2 px-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {/* Trader workflow: advance execution_status. Only
                          shown on non-paper portfolios for users with
                          permission, and only while the trade is still
                          in a phase where the dropdown has meaning
                          (cancelled / settled rows don't get one). Paper
                          portfolios auto-complete on accept so the
                          dropdown is irrelevant there. */}
                      {holdingsSource !== 'paper' && canUpdateExecution && (() => {
                        const phase = phaseByTradeId.get(trade.id)?.phase
                        if (phase === 'settled' || phase === 'cancelled') return null
                        return (
                          <ExecutionStatusDropdown
                            status={trade.execution_status}
                            onChange={(status) => onUpdateExecutionStatus(trade.id, status, null, getContext())}
                          />
                        )
                      })()}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedTradeId(isSelected ? null : trade.id)
                        }}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600"
                        title="Reason & comments"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                      {canRevert && trade.execution_status === 'not_started' && (
                        <button
                          onClick={() => {
                            if (onRevert && window.confirm('Revert this trade? It will be removed from the Trade Book.')) {
                              onRevert(trade.id, 'Reverted by PM', getContext())
                            }
                          }}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-600"
                          title="Revert"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {/* Correction flow. Only makes sense once execution has
                          started or finished — pre-execution, the PM should
                          edit sizing in place. Also hidden if this row is
                          already a correction or has already been corrected
                          (no chains of chains for now). */}
                      {onCreateCorrection
                        && canRevert
                        && trade.execution_status !== 'not_started'
                        && !correctionLinks.forward.get(trade.id)
                        && !correctionLinks.backward.get(trade.id) && (
                        <button
                          onClick={() => {
                            const sizing = window.prompt(
                              `Correct ${trade.asset?.symbol}: enter new sizing (e.g. "2.5", "+0.5", "#500")`,
                              trade.sizing_input || '',
                            )
                            if (!sizing || !sizing.trim()) return
                            const note = window.prompt('Reason for correction:', '')
                            if (note == null) return
                            onCreateCorrection(trade.id, sizing.trim(), note.trim() || 'PM correction', getContext())
                          }}
                          className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/20 text-gray-400 hover:text-amber-600"
                          title="Create correction trade"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

              </React.Fragment>
            )
          })}
        </tbody>
      </table>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <span>{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
        <span>${Math.abs(totalNotional).toLocaleString()} total notional</span>
      </div>
      </div>

      {/* Right-side detail pane — reason + comments. Opens when a row
          is clicked or the comment icon is pressed. Fixed-width column
          next to the table so the main list stays visible while the
          user reads context. Close via the × button or by re-clicking
          the same row. */}
      {selectedTrade && (
        <TradeDetailPane
          trade={selectedTrade}
          batchDescription={selectedTrade.batch_id ? batchMap.get(selectedTrade.batch_id)?.description : null}
          onClose={() => setSelectedTradeId(null)}
          onAddComment={onAddComment}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Right-side detail pane
// ---------------------------------------------------------------------------

/**
 * Fixed-width column that opens on the right when the PM selects a
 * trade row. Shows the reason (acceptance_note) and the comment
 * thread together — the two things a PM reads when they want to
 * remember or discuss a specific commit. Replaces the old inline
 * expand-row pattern which crowded the table and pushed other trades
 * out of view.
 */
function TradeDetailPane({
  trade,
  batchDescription,
  onClose,
  onAddComment,
}: {
  trade: AcceptedTradeWithJoins
  batchDescription?: string | null
  onClose: () => void
  onAddComment?: (tradeId: string, content: string) => void
}) {
  return (
    <aside className="w-96 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Trade detail
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {trade.asset?.symbol || 'Unknown'}
            </span>
            <span
              className={clsx(
                'inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded',
                ACTION_COLORS[trade.action] || 'bg-gray-100 text-gray-600',
              )}
            >
              {trade.action}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 flex-shrink-0"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body — reason + comments. Scrolls independently of the main
          table so long comment threads don't lock up the list. */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
        <section>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
            {/* Header label is inside ReasonBlock too, but keep a
                section heading here for rhythm with the Comments
                section below. */}
          </div>
          <ReasonBlock
            acceptanceNote={trade.acceptance_note}
            batchDescription={batchDescription ?? null}
          />
        </section>

        <section>
          <CommentThread tradeId={trade.id} onAddComment={onAddComment} />
        </section>
      </div>
    </aside>
  )
}

// Need React import for JSX fragments
import React from 'react'
