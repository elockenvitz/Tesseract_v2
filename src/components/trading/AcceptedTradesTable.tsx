/**
 * AcceptedTradesTable — Reusable table component for the Trade Book.
 *
 * Displays accepted trades with sorting, filtering, expandable comment threads,
 * and role-based actions.
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Undo2,
  Pencil,
  Inbox,
  FlaskConical,
  Plus,
  ArrowUpDown,
  Layers,
} from 'lucide-react'
import { clsx } from 'clsx'
import { ExecutionStatusDropdown } from './ExecutionStatusDropdown'
import { useAcceptedTradeComments } from '../../hooks/useAcceptedTrades'
import { useAuth } from '../../hooks/useAuth'
import type {
  AcceptedTradeWithJoins,
  AcceptedTradeComment,
  TradeBatch,
  ExecutionStatus,
  ActionContext,
  TradeAction,
} from '../../types/trading'

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

const RECON_STYLES: Record<string, string> = {
  pending: 'text-gray-500',
  matched: 'text-green-600 dark:text-green-400',
  partial: 'text-amber-600 dark:text-amber-400',
  deviated: 'text-red-600 dark:text-red-400',
  unmatched: 'text-gray-400',
}

type SortKey = 'symbol' | 'action' | 'target_weight' | 'delta_shares' | 'notional_value' | 'execution_status' | 'created_at'
type SortDir = 'asc' | 'desc'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AcceptedTradesTableProps {
  trades: AcceptedTradeWithJoins[]
  batches?: TradeBatch[]
  initialBatchFilter?: string | null
  onUpdateExecutionStatus: (id: string, status: ExecutionStatus, note: string | null, context: ActionContext) => void
  onUpdateSizing?: (id: string, updates: { sizing_input?: string; action?: TradeAction }, context: ActionContext) => void
  onRevert?: (id: string, reason: string, context: ActionContext) => void
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
    <div className="px-4 py-2 bg-gray-50/50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-800">
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
  initialBatchFilter,
  onUpdateExecutionStatus,
  onUpdateSizing,
  onRevert,
  onAddComment,
  canEdit = false,
  canUpdateExecution = false,
  canRevert = false,
}: AcceptedTradesTableProps) {
  const { user } = useAuth()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filterExecStatus, setFilterExecStatus] = useState<ExecutionStatus | 'all'>('all')
  const [filterSource, setFilterSource] = useState<string | 'all'>('all')
  const [filterBatchId, setFilterBatchId] = useState<string | 'all'>(initialBatchFilter || 'all')

  // Sync batch filter when parent changes it (e.g., "View Trades" from Batches view)
  useEffect(() => {
    if (initialBatchFilter) setFilterBatchId(initialBatchFilter)
  }, [initialBatchFilter])

  // Build batch lookup
  const batchMap = useMemo(() => {
    const m = new Map<string, TradeBatch>()
    batches?.forEach(b => m.set(b.id, b))
    return m
  }, [batches])

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
    if (filterExecStatus !== 'all') {
      list = list.filter(t => t.execution_status === filterExecStatus)
    }
    if (filterSource !== 'all') {
      list = list.filter(t => t.source === filterSource)
    }
    if (filterBatchId !== 'all') {
      if (filterBatchId === 'none') {
        list = list.filter(t => !t.batch_id)
      } else {
        list = list.filter(t => t.batch_id === filterBatchId)
      }
    }
    return list
  }, [trades, filterExecStatus, filterSource, filterBatchId])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'symbol': return dir * (a.asset?.symbol || '').localeCompare(b.asset?.symbol || '')
        case 'action': return dir * a.action.localeCompare(b.action)
        case 'target_weight': return dir * ((a.target_weight ?? 0) - (b.target_weight ?? 0))
        case 'delta_shares': return dir * ((a.delta_shares ?? 0) - (b.delta_shares ?? 0))
        case 'notional_value': return dir * ((a.notional_value ?? 0) - (b.notional_value ?? 0))
        case 'execution_status': return dir * a.execution_status.localeCompare(b.execution_status)
        case 'created_at': return dir * a.created_at.localeCompare(b.created_at)
        default: return 0
      }
    })
    return arr
  }, [filtered, sortKey, sortDir])

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

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <select
          value={filterExecStatus}
          onChange={e => setFilterExecStatus(e.target.value as any)}
          className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option value="all">All Statuses</option>
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="complete">Complete</option>
          <option value="cancelled">Cancelled</option>
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
        {batches && batches.length > 0 && (
          <select
            value={filterBatchId}
            onChange={e => setFilterBatchId(e.target.value)}
            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option value="all">All Batches</option>
            <option value="none">Ungrouped</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>
                {b.name || `Batch ${b.created_at.slice(0, 10)}`}
              </option>
            ))}
          </select>
        )}
        {/* Clear batch filter pill */}
        {filterBatchId !== 'all' && (
          <button
            onClick={() => setFilterBatchId('all')}
            className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 flex items-center gap-1"
          >
            {filterBatchId === 'none' ? 'Ungrouped' : batchMap.get(filterBatchId)?.name || 'Batch'}
            <span className="text-indigo-400 dark:text-indigo-500">&times;</span>
          </button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {filtered.length} trade{filtered.length !== 1 ? 's' : ''}
          {totalNotional !== 0 && ` · $${Math.abs(totalNotional).toLocaleString()} total notional`}
        </span>
      </div>

      {/* Batch summary strip */}
      {filterBatchId !== 'all' && filterBatchId !== 'none' && batchMap.get(filterBatchId) && (() => {
        const batch = batchMap.get(filterBatchId)!
        const batchTradeCount = trades.filter(t => t.batch_id === filterBatchId).length
        return (
          <div className="flex items-center gap-3 px-4 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-indigo-50/40 dark:bg-indigo-950/10">
            <Layers className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
            <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
              {batch.name || 'Batch'}
            </span>
            <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded', BATCH_STATUS_STYLES[batch.status])}>
              {batch.status.replace('_', ' ')}
            </span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {batchTradeCount} trade{batchTradeCount !== 1 ? 's' : ''}
            </span>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })}
            </span>
          </div>
        )
      })()}

      {/* Table — Trade Book is the sole canonical committed-trade surface */}
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th className="w-8" /> {/* expand */}
            <SortHeader label="Symbol" k="symbol" />
            <SortHeader label="Action" k="action" />
            <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left">Sizing</th>
            <SortHeader label="Tgt Wt" k="target_weight" align="right" />
            <SortHeader label="Δ Shrs" k="delta_shares" align="right" />
            <SortHeader label="Notional" k="notional_value" align="right" />
            <SortHeader label="Exec Status" k="execution_status" />
            <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left">Source</th>
            <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left">Recon</th>
            <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((trade, idx) => {
            const isExpanded = expandedId === trade.id
            const SourceIcon = SOURCE_ICONS[trade.source] || Plus
            return (
              <React.Fragment key={trade.id}>
                <tr
                  className={clsx(
                    'border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition-colors',
                    idx % 2 === 0 && 'bg-gray-50/30 dark:bg-gray-800/10'
                  )}
                >
                  <td className="pl-2 py-2">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : trade.id)}
                      className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      {isExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                    </button>
                  </td>
                  <td className="py-2 px-3 text-sm font-medium text-gray-900 dark:text-white">
                    {trade.asset?.symbol || 'Unknown'}
                  </td>
                  <td className="py-2 px-3">
                    <span className={clsx(
                      'inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded',
                      ACTION_COLORS[trade.action] || 'bg-gray-100 text-gray-600'
                    )}>
                      {trade.action}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-sm font-mono text-gray-600 dark:text-gray-300">
                    {trade.sizing_input || '—'}
                  </td>
                  <td className="py-2 px-3 text-sm font-mono text-right text-gray-600 dark:text-gray-300">
                    {trade.target_weight != null ? `${trade.target_weight.toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-2 px-3 text-sm font-mono text-right text-gray-600 dark:text-gray-300">
                    {trade.delta_shares != null ? `${trade.delta_shares > 0 ? '+' : ''}${trade.delta_shares.toLocaleString()}` : '—'}
                  </td>
                  <td className="py-2 px-3 text-sm font-mono text-right text-gray-600 dark:text-gray-300">
                    {trade.notional_value != null ? `$${Math.abs(trade.notional_value).toLocaleString()}` : '—'}
                  </td>
                  <td className="py-2 px-3">
                    {/* Trade Book is post-decision — execution is always actionable.
                        Batch status is oversight/review only, never blocks execution. */}
                    {canUpdateExecution ? (
                      <ExecutionStatusDropdown
                        status={trade.execution_status}
                        onChange={(status) => onUpdateExecutionStatus(trade.id, status, null, getContext())}
                      />
                    ) : (
                      <ExecutionStatusDropdown
                        status={trade.execution_status}
                        onChange={() => {}}
                        disabled
                      />
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <SourceIcon className="w-3 h-3" />
                        {SOURCE_LABELS[trade.source]}
                      </span>
                      {trade.batch_id && batchMap.get(trade.batch_id) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setFilterBatchId(trade.batch_id!) }}
                          className={clsx(
                            'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded w-fit cursor-pointer hover:ring-1 hover:ring-indigo-300 dark:hover:ring-indigo-600 transition-shadow',
                            BATCH_STATUS_STYLES[batchMap.get(trade.batch_id)!.status] || BATCH_STATUS_STYLES.active
                          )}
                          title="Filter to this batch"
                        >
                          <Layers className="w-2.5 h-2.5" />
                          {batchMap.get(trade.batch_id)!.name || 'Batch'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <span className={clsx('text-xs font-medium capitalize', RECON_STYLES[trade.reconciliation_status])}>
                      {trade.reconciliation_status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : trade.id)}
                        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600"
                        title="Comments"
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
                    </div>
                  </td>
                </tr>

                {/* Expanded comment thread */}
                {isExpanded && (
                  <tr>
                    <td colSpan={11} className="p-0">
                      <CommentThread tradeId={trade.id} onAddComment={onAddComment} />
                    </td>
                  </tr>
                )}
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
  )
}

// Need React import for JSX fragments
import React from 'react'
