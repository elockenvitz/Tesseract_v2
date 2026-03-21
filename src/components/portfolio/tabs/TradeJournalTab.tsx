import React, { useState, useMemo } from 'react'
import {
  BookText, AlertCircle, CheckCircle2, FileEdit, Eye,
  ChevronDown, Search, Clock,
  ArrowUpRight, ArrowDownRight, Link2, X, Minus,
} from 'lucide-react'
import {
  useTradeJournalEvents,
  useTradeJournalSummary,
  useUpdateTradeEventStatus,
} from '../../../hooks/useTradeJournal'
import type {
  TradeEventWithDetails,
  TradeEventAction,
  TradeEventStatus,
} from '../../../types/trade-journal'
import { ACTION_CONFIG, STATUS_CONFIG, SOURCE_LABELS } from '../../../types/trade-journal'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TradeJournalTabProps {
  portfolioId: string
  portfolio: any
}

// ---------------------------------------------------------------------------
// Filter config
// ---------------------------------------------------------------------------

interface FilterDef { key: string; label: string; match?: TradeEventStatus[] }

const STATUS_FILTERS: FilterDef[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending', match: ['pending_rationale'] },
  { key: 'draft', label: 'Draft', match: ['draft_rationale'] },
  { key: 'complete', label: 'Complete', match: ['complete'] },
  { key: 'reviewed', label: 'Reviewed', match: ['reviewed'] },
]

const ACTION_FILTERS: { key: string; label: string; actions: TradeEventAction[] }[] = [
  { key: 'all', label: 'All Actions', actions: [] },
  { key: 'initiates', label: 'Initiates', actions: ['initiate', 'short_initiate'] },
  { key: 'adds', label: 'Adds', actions: ['add'] },
  { key: 'trims', label: 'Trims / Reduces', actions: ['trim', 'reduce'] },
  { key: 'exits', label: 'Exits / Covers', actions: ['exit', 'cover'] },
  { key: 'other', label: 'Other', actions: ['rebalance', 'hedge', 'other'] },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDelta(v: number | null, suffix = '') {
  if (v == null) return '\u2014'
  const sign = v > 0 ? '+' : ''
  return `${sign}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtShortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TradeJournalTab({ portfolioId, portfolio }: TradeJournalTabProps) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)

  // Data
  const { data: events, isLoading } = useTradeJournalEvents({ portfolioId })
  const { data: summary } = useTradeJournalSummary(portfolioId)
  const updateStatusMutation = useUpdateTradeEventStatus(portfolioId)

  // Filtered events
  const filteredEvents = useMemo(() => {
    if (!events) return []
    let result = events

    // Status filter
    if (statusFilter !== 'all') {
      const filter = STATUS_FILTERS.find(f => f.key === statusFilter)
      if (filter?.match) {
        result = result.filter(e => filter.match!.includes(e.status))
      }
    }

    // Action filter
    if (actionFilter !== 'all') {
      const filter = ACTION_FILTERS.find(f => f.key === actionFilter)
      if (filter?.actions.length) {
        result = result.filter(e => filter.actions.includes(e.action_type))
      }
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(e =>
        e.asset?.symbol?.toLowerCase().includes(q) ||
        e.asset?.company_name?.toLowerCase().includes(q)
      )
    }

    return result
  }, [events, statusFilter, actionFilter, searchQuery])

  // Selected event for rationale editor
  const selectedEvent = useMemo(
    () => events?.find(e => e.id === selectedEventId) || null,
    [events, selectedEventId],
  )

  // ── Loading ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <p className="text-[11px] text-gray-400">Loading trade journal...</p>
      </div>
    )
  }

  // ── Empty ──────────────────────────────────────────────────
  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <BookText className="w-4 h-4 text-gray-400" />
            <h3 className="text-[13px] font-semibold text-gray-900">Trade Journal</h3>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 ml-6">
            Portfolio trade events and execution history
          </p>
        </div>
        <div className="border border-dashed border-gray-200 rounded-lg py-16 px-6">
          <div className="max-w-md mx-auto text-center">
            <BookText className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-[13px] font-semibold text-gray-700 mb-1">No trade events recorded</p>
            <p className="text-[11px] text-gray-400 leading-relaxed mb-3">
              Trade events appear here when holdings change or trades are recorded.
              Use <span className="font-medium text-gray-500">Outcomes</span> to review decisions and capture post-mortems.
            </p>
            <p className="text-[10px] text-gray-400">
              Looking for ideas, research, or portfolio commentary? See the <span className="font-medium text-gray-500">Portfolio Log</span> tab.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Main ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <BookText className="w-4 h-4 text-gray-400" />
            <h3 className="text-[13px] font-semibold text-gray-900">Trade Journal</h3>
            <span className="text-[10px] text-gray-400 tabular-nums">{events.length} events</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 ml-6">
            Portfolio trade events and execution history
          </p>
        </div>
      </div>

      {/* Post-mortem redirect — Outcomes is the canonical review workspace */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 mb-3 shrink-0 text-[10px]">
        <BookText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
        <span className="text-blue-700 dark:text-blue-400">
          Post-mortem reviews are now captured in <span className="font-semibold">Outcomes</span>. This tab shows trade event history.
        </span>
      </div>

      {/* ── SUMMARY STRIP ──────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-5 gap-px bg-gray-200 rounded overflow-hidden border border-gray-200 mb-3 shrink-0">
          <SummaryTile
            label="Pending"
            value={summary.pendingRationale}
            color={summary.pendingRationale > 0 ? 'text-amber-600' : 'text-gray-400'}
            icon={<AlertCircle className="w-3 h-3" />}
            highlight={summary.pendingRationale > 0}
          />
          <SummaryTile
            label="Draft"
            value={summary.draftRationale}
            color="text-blue-600"
            icon={<FileEdit className="w-3 h-3" />}
          />
          <SummaryTile
            label="Complete"
            value={summary.complete}
            color="text-emerald-600"
            icon={<CheckCircle2 className="w-3 h-3" />}
          />
          <SummaryTile
            label="Reviewed"
            value={summary.reviewed}
            color="text-violet-600"
            icon={<Eye className="w-3 h-3" />}
          />
          <SummaryTile
            label="Last 30d"
            value={summary.recentTradesCount}
            color="text-gray-700"
            icon={<Clock className="w-3 h-3" />}
          />
        </div>
      )}

      {/* ── FILTERS ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        {/* Status filter pills */}
        <div className="inline-flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
          {STATUS_FILTERS.map(f => {
            const isActive = statusFilter === f.key
            const count = f.key === 'pending' ? summary?.pendingRationale :
                          f.key === 'draft' ? summary?.draftRationale :
                          f.key === 'complete' ? summary?.complete :
                          f.key === 'reviewed' ? summary?.reviewed : null
            return (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`text-[11px] px-2 py-1 rounded-md font-medium transition-all duration-100 flex items-center gap-1 ${
                  isActive
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f.label}
                {count != null && count > 0 && (
                  <span className={`text-[9px] tabular-nums ${isActive ? 'text-gray-500' : 'text-gray-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Action filter */}
        <div className="relative">
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="text-[11px] border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 appearance-none pr-6 focus:outline-none focus:ring-1 focus:ring-primary-400"
          >
            {ACTION_FILTERS.map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
        </div>

        {/* Search toggle */}
        <button
          onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery('') }}
          className={`p-1.5 rounded transition-colors ${showSearch ? 'bg-primary-50 text-primary-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
        >
          <Search className="w-3.5 h-3.5" />
        </button>

        {showSearch && (
          <div className="relative flex-1 max-w-xs">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by symbol or name..."
              autoFocus
              className="w-full text-[11px] border border-gray-200 rounded pl-2 pr-6 py-1 bg-white text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <X className="w-3 h-3 text-gray-400" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── TABLE + EDITOR LAYOUT ──────────────────────────────── */}
      <div className="flex-1 min-h-0 flex border border-gray-200 rounded overflow-hidden">
        {/* Table */}
        <div className={`flex-1 min-w-0 overflow-hidden flex flex-col`}>
          {/* Column headers */}
          <div className="grid grid-cols-[88px_1fr_72px_110px_80px_76px_68px] bg-gray-50 border-b border-gray-200 shrink-0">
            <ColHeader>Date</ColHeader>
            <ColHeader>Asset</ColHeader>
            <ColHeader>Action</ColHeader>
            <ColHeader align="right">Position \u0394</ColHeader>
            <ColHeader>Source</ColHeader>
            <ColHeader>Status</ColHeader>
            <ColHeader align="center">Rationale</ColHeader>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto bg-white">
            {filteredEvents.length > 0 ? (
              filteredEvents.map((event, idx) => (
                <TradeEventRow
                  key={event.id}
                  event={event}
                  isSelected={event.id === selectedEventId}
                  isEven={idx % 2 === 0}
                  onSelect={() => setSelectedEventId(event.id === selectedEventId ? null : event.id)}
                  onIgnore={() => updateStatusMutation.mutate({ eventId: event.id, status: 'ignored' })}
                />
              ))
            ) : (
              <div className="py-10 text-center">
                <p className="text-[11px] text-gray-400">No events match current filters.</p>
              </div>
            )}
          </div>
        </div>

        {/* Event Detail Panel (read-only — post-mortem authoring is in Outcomes) */}
        {selectedEvent && (
          <div className="w-[380px] shrink-0 border-l border-gray-200 flex flex-col bg-white">
            <div className="px-3 py-2.5 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  ACTION_CONFIG[selectedEvent.action_type]?.color || 'bg-gray-100 text-gray-600'
                }`}>{selectedEvent.action_type}</span>
                <span className="text-[12px] font-semibold text-gray-900 truncate">{selectedEvent.asset_symbol || '?'}</span>
              </div>
              <button onClick={() => setSelectedEventId(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2.5">
              {/* Event details */}
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="text-gray-700">{fmtDate(selectedEvent.event_date)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Source</span><span className="text-gray-700">{SOURCE_LABELS[selectedEvent.source_type] || selectedEvent.source_type}</span></div>
                {selectedEvent.quantity_delta != null && (
                  <div className="flex justify-between"><span className="text-gray-500">Shares Δ</span><span className="text-gray-700 tabular-nums">{fmtDelta(selectedEvent.quantity_delta)}</span></div>
                )}
                {selectedEvent.weight_delta != null && (
                  <div className="flex justify-between"><span className="text-gray-500">Weight Δ</span><span className="text-gray-700 tabular-nums">{fmtDelta(selectedEvent.weight_delta, '%')}</span></div>
                )}
              </div>

              {/* Existing rationale (read-only) */}
              {selectedEvent.rationale ? (
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Rationale</div>
                  {selectedEvent.rationale.reason_for_action && (
                    <div><div className="text-[9px] text-gray-400 mb-0.5">Assessment</div><p className="text-[11px] text-gray-600 leading-relaxed">{selectedEvent.rationale.reason_for_action}</p></div>
                  )}
                  {selectedEvent.rationale.what_changed && (
                    <div><div className="text-[9px] text-gray-400 mb-0.5">What changed</div><p className="text-[11px] text-gray-600 leading-relaxed">{selectedEvent.rationale.what_changed}</p></div>
                  )}
                  {selectedEvent.rationale.risk_context && (
                    <div><div className="text-[9px] text-gray-400 mb-0.5">Lessons</div><p className="text-[11px] text-gray-600 leading-relaxed">{selectedEvent.rationale.risk_context}</p></div>
                  )}
                  <div className="text-[10px] text-gray-400 capitalize">{selectedEvent.rationale.status}</div>
                </div>
              ) : (
                <div className="pt-2 border-t border-gray-100 text-center py-4">
                  <p className="text-[10px] text-gray-400">No rationale captured for this event.</p>
                </div>
              )}

              {/* Direct to Outcomes */}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 mb-1.5">Post-mortem reviews are authored in Outcomes.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column Header
// ---------------------------------------------------------------------------

function ColHeader({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <div className={`px-2.5 py-[7px] ${
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
    }`}>
      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 select-none">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary Tile
// ---------------------------------------------------------------------------

function SummaryTile({
  label, value, color, icon, highlight,
}: {
  label: string
  value: number
  color: string
  icon: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className={`px-3 py-2 ${highlight ? 'bg-amber-50/50' : 'bg-white'}`}>
      <div className="flex items-center gap-1">
        <span className={`${color} opacity-60`}>{icon}</span>
        <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider leading-none">{label}</p>
      </div>
      <p className={`text-[17px] font-semibold mt-1 tabular-nums leading-none ${color}`}>
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Trade Event Row
// ---------------------------------------------------------------------------

function TradeEventRow({
  event,
  isSelected,
  isEven,
  onSelect,
  onIgnore,
}: {
  event: TradeEventWithDetails
  isSelected: boolean
  isEven: boolean
  onSelect: () => void
  onIgnore: () => void
}) {
  const actionCfg = ACTION_CONFIG[event.action_type]
  const statusCfg = STATUS_CONFIG[event.status]
  const hasRationale = !!event.latest_rationale
  const isPending = event.status === 'pending_rationale'
  const hasUpstreamLink = !!event.linked_trade_idea_id || !!event.linked_trade_sheet_id

  return (
    <div
      onClick={onSelect}
      className={`grid grid-cols-[88px_1fr_72px_110px_80px_76px_68px] cursor-pointer transition-colors border-b border-gray-100 ${
        isSelected
          ? 'bg-primary-50/60 border-l-2 border-l-primary-500'
          : isPending
            ? `${isEven ? 'bg-amber-50/20' : 'bg-amber-50/10'} hover:bg-amber-50/40 border-l-2 border-l-amber-400`
            : `${isEven ? 'bg-white' : 'bg-gray-50/40'} hover:bg-gray-50 border-l-2 border-l-transparent`
      }`}
    >
      {/* Date */}
      <div className="px-2.5 py-[7px] flex items-center">
        <span className="text-[11px] text-gray-500 tabular-nums">{fmtShortDate(event.event_date)}</span>
      </div>

      {/* Asset */}
      <div className="px-2.5 py-[7px] flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] font-semibold text-gray-900">{event.asset?.symbol || '?'}</span>
        <span className="text-[10px] text-gray-400 truncate">{event.asset?.company_name || ''}</span>
        {hasUpstreamLink && <Link2 className="w-2.5 h-2.5 text-blue-400 shrink-0" />}
      </div>

      {/* Action */}
      <div className="px-2.5 py-[7px] flex items-center">
        <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded ${actionCfg.color} ${actionCfg.bgColor}`}>
          {actionCfg.label}
        </span>
      </div>

      {/* Position Delta */}
      <div className="px-2.5 py-[7px] flex items-center justify-end gap-1">
        {event.quantity_delta != null && event.quantity_delta !== 0 ? (
          <>
            {event.quantity_delta > 0
              ? <ArrowUpRight className="w-3 h-3 text-emerald-500 shrink-0" />
              : <ArrowDownRight className="w-3 h-3 text-red-500 shrink-0" />
            }
            <div className="text-right">
              <span className="text-[10px] font-semibold text-gray-700 tabular-nums leading-tight block">
                {fmtDelta(event.quantity_delta)} shr
              </span>
              {event.weight_delta != null && (
                <span className="text-[9px] text-gray-400 tabular-nums leading-tight block">
                  {fmtDelta(event.weight_delta, '%')}
                </span>
              )}
            </div>
          </>
        ) : (
          <Minus className="w-3 h-3 text-gray-300" />
        )}
      </div>

      {/* Source */}
      <div className="px-2.5 py-[7px] flex items-center">
        <span className="text-[9px] text-gray-400 uppercase tracking-wide">{SOURCE_LABELS[event.source_type]}</span>
      </div>

      {/* Status */}
      <div className="px-2.5 py-[7px] flex items-center">
        <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded ${statusCfg.color} ${statusCfg.bgColor}`}>
          {statusCfg.label}
        </span>
      </div>

      {/* Rationale indicator */}
      <div className="px-2.5 py-[7px] flex items-center justify-center">
        {hasRationale ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
        ) : isPending ? (
          <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
        ) : (
          <span className="w-3.5 h-3.5 rounded-full border border-gray-200" />
        )}
      </div>
    </div>
  )
}
