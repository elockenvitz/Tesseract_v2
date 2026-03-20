/**
 * DecisionAccountabilityPage — "Decision Outcomes"
 *
 * Portfolio decision intelligence surface:
 * What did we decide → was it executed → what happened after?
 *
 * Three layers:
 * 1. Summary strip — process metrics + snapshot-backed impact metrics
 * 2. Decision ledger (main table) — decision, execution, result per row
 * 3. Detail panel — full decision → execution → result → delay analysis
 *
 * Data sources:
 * - Decisions from trade_queue_items (terminal stages)
 * - Executions from portfolio_trade_events (explicit + fuzzy matching)
 * - Decision-time prices from decision_price_snapshots
 * - Current prices from assets table (DB-cached)
 * - Rationale content from trade_event_rationales
 */

import { useState, useMemo } from 'react'
import {
  Target, Search, ChevronDown, ChevronRight, Clock,
  CheckCircle2, TrendingUp, TrendingDown, Briefcase,
  AlertCircle, XCircle, X, FileText,
  ArrowRight, HelpCircle, AlertTriangle,
  DollarSign, Activity, ArrowUpRight, ArrowDownRight,
  Percent, Zap, Camera, Timer, Scale,
  Lightbulb, MessageSquare, BookOpen, Pencil, User,
} from 'lucide-react'
import { format, subDays } from 'date-fns'
import {
  useDecisionAccountability,
  useDecisionStory,
  useSavePostMortem,
  usePortfoliosForFilter,
  useUsersForFilter,
} from '../hooks/useDecisionAccountability'
import type {
  AccountabilityFilters,
  AccountabilityRow,
  AccountabilitySummary,
  ExecutionMatchStatus,
  MatchedExecution,
  ResultDirection,
  SizeBasis,
} from '../types/decision-accountability'

// ============================================================
// Constants
// ============================================================

const EXEC_STATUS_CONFIG: Record<ExecutionMatchStatus, {
  label: string
  color: string
  bgColor: string
  icon: typeof CheckCircle2
}> = {
  executed:       { label: 'Executed',       color: 'text-emerald-700', bgColor: 'bg-emerald-50',  icon: CheckCircle2 },
  pending:        { label: 'Pending',        color: 'text-amber-700',   bgColor: 'bg-amber-50',    icon: Clock },
  possible_match: { label: 'Possible',       color: 'text-blue-700',    bgColor: 'bg-blue-50',     icon: HelpCircle },
  unmatched:      { label: 'Unmatched',      color: 'text-red-700',     bgColor: 'bg-red-50',      icon: AlertTriangle },
  not_applicable: { label: 'N/A',            color: 'text-gray-500',    bgColor: 'bg-gray-100',    icon: XCircle },
}

const DIRECTION_CONFIG: Record<string, { color: string; bgColor: string }> = {
  buy:  { color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  add:  { color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  long: { color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  sell: { color: 'text-red-700',     bgColor: 'bg-red-50' },
  trim: { color: 'text-red-700',     bgColor: 'bg-red-50' },
  short:{ color: 'text-violet-700',  bgColor: 'bg-violet-50' },
}

const STAGE_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  approved:  { label: 'Approved',  color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  rejected:  { label: 'Rejected',  color: 'text-red-700',     bgColor: 'bg-red-50' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500',    bgColor: 'bg-gray-100' },
}

const RESULT_CONFIG: Record<ResultDirection, { color: string; icon: typeof TrendingUp; label: string }> = {
  positive: { color: 'text-emerald-600', icon: ArrowUpRight, label: 'Helping' },
  negative: { color: 'text-red-600',     icon: ArrowDownRight, label: 'Hurting' },
  neutral:  { color: 'text-gray-400',    icon: Activity, label: 'Flat' },
}

// ============================================================
// Formatting helpers
// ============================================================

function formatPrice(price: number | null): string {
  if (price === null) return '\u2014'
  return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatMovePct(pct: number | null): string {
  if (pct === null) return '\u2014'
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function formatDelayCost(pct: number | null): string {
  if (pct === null) return '\u2014'
  if (Math.abs(pct) < 0.05) return '0.0%'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function formatDollarCompact(value: number | null): string {
  if (value === null) return '\u2014'
  const abs = Math.abs(value)
  const sign = value >= 0 ? '+' : '-'
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function formatNotional(value: number | null): string {
  if (value === null) return '\u2014'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

const SIZE_BASIS_LABEL: Record<string, string> = {
  market_value_delta: 'from position values',
  qty_times_price: 'from qty \u00D7 price (proxy)',
  weight_only: 'weight only (no $ sizing)',
}

// ============================================================
// Grid template constants
// ============================================================

// Date | Asset | Dir | Decision | Execution | Move | Impact | Delay | Lag | Portfolio | Owner
const MAIN_GRID = 'grid-cols-[64px_1fr_42px_62px_70px_56px_58px_50px_36px_64px_54px]'
const UNMATCHED_GRID = 'grid-cols-[88px_1fr_72px_110px_80px_80px]'

// ============================================================
// Page Props
// ============================================================

interface DecisionAccountabilityPageProps {
  onItemSelect?: (item: any) => void
}

// ============================================================
// Filter Bar
// ============================================================

function FilterBar({
  filters,
  onChange,
}: {
  filters: Partial<AccountabilityFilters>
  onChange: (f: Partial<AccountabilityFilters>) => void
}) {
  const { data: portfolios = [] } = usePortfoliosForFilter()
  const { data: users = [] } = useUsersForFilter()

  const handleDateRange = (days: number | null) => {
    if (days === null) {
      onChange({ ...filters, dateRange: { start: null, end: null } })
    } else {
      onChange({
        ...filters,
        dateRange: {
          start: subDays(new Date(), days).toISOString(),
          end: new Date().toISOString(),
        },
      })
    }
  }

  const activeDays = useMemo(() => {
    if (!filters.dateRange?.start) return 90
    const diff = (Date.now() - new Date(filters.dateRange.start).getTime()) / (1000 * 60 * 60 * 24)
    if (diff < 10) return 7
    if (diff < 40) return 30
    return 90
  }, [filters.dateRange?.start])

  const toggleExecStatus = (status: ExecutionMatchStatus) => {
    const current = filters.executionStatus || []
    const next = current.includes(status)
      ? current.filter(s => s !== status)
      : [...current, status]
    onChange({ ...filters, executionStatus: next })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Date pills */}
      <div className="inline-flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => handleDateRange(d)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              activeDays === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Portfolio */}
      <div className="relative">
        <select
          value={filters.portfolioIds?.[0] || ''}
          onChange={e => onChange({ ...filters, portfolioIds: e.target.value ? [e.target.value] : [] })}
          className="text-[11px] border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 appearance-none pr-6 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="">All Portfolios</option>
          {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
      </div>

      {/* Analyst */}
      <div className="relative">
        <select
          value={filters.ownerUserIds?.[0] || ''}
          onChange={e => onChange({ ...filters, ownerUserIds: e.target.value ? [e.target.value] : [] })}
          className="text-[11px] border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 appearance-none pr-6 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="">All Analysts</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>
              {u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : u.email.split('@')[0]}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
      </div>

      {/* Asset search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          type="text"
          placeholder="Search asset..."
          value={filters.assetSearch || ''}
          onChange={e => onChange({ ...filters, assetSearch: e.target.value })}
          className="pl-7 pr-3 py-1 text-[11px] border border-gray-200 rounded w-32 bg-white text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
        />
      </div>

      <div className="w-px h-4 bg-gray-200" />

      {/* Stage toggles */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-gray-500">
          <input
            type="checkbox"
            checked={filters.showRejected || false}
            onChange={e => onChange({ ...filters, showRejected: e.target.checked })}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3 h-3"
          />
          Rejected
        </label>
        <label className="flex items-center gap-1 text-[11px] text-gray-500">
          <input
            type="checkbox"
            checked={filters.showCancelled || false}
            onChange={e => onChange({ ...filters, showCancelled: e.target.checked })}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3 h-3"
          />
          Cancelled
        </label>
      </div>

      <div className="w-px h-4 bg-gray-200" />

      {/* Execution status pills */}
      <div className="inline-flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
        {([
          { status: null as ExecutionMatchStatus | null, label: 'All' },
          { status: 'executed' as ExecutionMatchStatus, label: 'Exec' },
          { status: 'pending' as ExecutionMatchStatus, label: 'Pend' },
          { status: 'unmatched' as ExecutionMatchStatus, label: 'Miss' },
        ]).map(opt => {
          const isAll = opt.status === null
          const active = isAll
            ? !filters.executionStatus || filters.executionStatus.length === 0
            : (filters.executionStatus || []).includes(opt.status!)
          return (
            <button
              key={opt.label}
              onClick={() => {
                if (isAll) {
                  onChange({ ...filters, executionStatus: [] })
                } else {
                  toggleExecStatus(opt.status!)
                }
              }}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Direction filter */}
      <div className="inline-flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
        {([
          { dirs: [] as string[], label: 'All' },
          { dirs: ['buy', 'add', 'long'], label: 'Buy' },
          { dirs: ['sell', 'trim', 'short'], label: 'Sell' },
        ]).map(opt => {
          const isAll = opt.dirs.length === 0
          const active = isAll
            ? !filters.directionFilter || filters.directionFilter.length === 0
            : JSON.stringify(filters.directionFilter?.sort()) === JSON.stringify(opt.dirs.sort())
          return (
            <button
              key={opt.label}
              onClick={() => onChange({ ...filters, directionFilter: opt.dirs as any })}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Result filter */}
      <div className="inline-flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
        {([
          { value: 'all', label: 'All' },
          { value: 'positive', label: '\u2191' },
          { value: 'negative', label: '\u2193' },
        ] as const).map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange({ ...filters, resultFilter: opt.value })}
            className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
              (filters.resultFilter || 'all') === opt.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ============================================================
// Summary Strip
// ============================================================

function SummaryStrip({ summary }: { summary: AccountabilitySummary }) {
  // Two sections: Process (4 tiles) + Result (4 tiles)
  const processTiles: Array<{
    label: string
    value: string | number
    color: string
    icon: typeof CheckCircle2
    tooltip?: string
  }> = [
    { label: 'Decisions', value: summary.approvedCount, icon: Target, color: 'text-gray-700' },
    {
      label: 'Exec Rate',
      value: summary.executionRate !== null ? `${summary.executionRate}%` : '\u2014',
      icon: Percent,
      color: summary.executionRate !== null && summary.executionRate >= 80 ? 'text-emerald-600' : 'text-amber-600',
      tooltip: 'Executed or matched / approved decisions',
    },
    { label: 'Pending', value: summary.pendingCount, icon: Clock, color: summary.pendingCount > 0 ? 'text-amber-600' : 'text-gray-400' },
    {
      label: 'Avg Lag',
      value: summary.avgLagDays !== null ? `${summary.avgLagDays}d` : '\u2014',
      icon: Timer,
      color: summary.avgLagDays !== null && summary.avgLagDays > 7 ? 'text-amber-600' : 'text-gray-600',
    },
  ]

  const resultTiles: Array<{
    label: string
    value: string | number
    color: string
    icon: typeof CheckCircle2
    tooltip?: string
  }> = [
    {
      label: 'Since Decision',
      value: summary.avgMoveSinceDecision !== null ? formatMovePct(summary.avgMoveSinceDecision) : '\u2014',
      icon: Camera,
      color: summary.avgMoveSinceDecision !== null
        ? summary.avgMoveSinceDecision >= 0 ? 'text-emerald-600' : 'text-red-600'
        : 'text-gray-400',
      tooltip: 'Avg directionalized move since decision (where snapshot exists)',
    },
    {
      label: 'Net Impact',
      value: summary.netImpactProxy !== null ? formatDollarCompact(summary.netImpactProxy) : '\u2014',
      icon: Scale,
      color: summary.netImpactProxy !== null
        ? summary.netImpactProxy >= 0 ? 'text-emerald-600' : 'text-red-600'
        : 'text-gray-400',
      tooltip: `Size-weighted net impact proxy (${summary.sizedDecisionCount} sized decisions). Not exact P&L.`,
    },
    {
      label: 'Delay Cost $',
      value: summary.totalWeightedDelayCost !== null ? formatDollarCompact(-summary.totalWeightedDelayCost) : '\u2014',
      icon: Timer,
      color: summary.totalWeightedDelayCost !== null
        ? summary.totalWeightedDelayCost > 500 ? 'text-red-600' : 'text-gray-600'
        : 'text-gray-400',
      tooltip: 'Total dollar-equivalent delay cost across sized decisions (proxy)',
    },
    {
      label: 'Result',
      value: summary.positiveResultCount > 0 || summary.negativeResultCount > 0
        ? `${summary.positiveResultCount}\u2191 ${summary.negativeResultCount}\u2193`
        : '\u2014',
      icon: TrendingUp,
      color: summary.positiveResultCount >= summary.negativeResultCount ? 'text-emerald-600' : 'text-red-600',
      tooltip: 'Decisions helping vs hurting (directional proxy)',
    },
  ]

  const allTiles = [...processTiles, ...resultTiles]

  return (
    <div className="space-y-0">
      <div className="grid grid-cols-8 gap-px bg-gray-200 rounded overflow-hidden border border-gray-200">
        {allTiles.map((t, i) => {
          const Icon = t.icon
          return (
            <div key={t.label} className={`bg-white px-2.5 py-2 ${i === 3 ? 'border-r-2 border-r-gray-300' : ''}`} title={t.tooltip}>
              <div className="flex items-center gap-1">
                <Icon className={`w-3 h-3 ${t.color} opacity-60`} />
                <span className="text-[8px] font-bold uppercase tracking-wider text-gray-400">{t.label}</span>
              </div>
              <p className={`text-[16px] font-semibold mt-0.5 tabular-nums leading-none ${t.color}`}>
                {t.value}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// Execution Status Pill
// ============================================================

function ExecStatusPill({ status }: { status: ExecutionMatchStatus }) {
  const cfg = EXEC_STATUS_CONFIG[status]
  return (
    <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded ${cfg.color} ${cfg.bgColor}`}>
      {cfg.label}
    </span>
  )
}

// ============================================================
// Decision Table Row
// ============================================================

function DecisionRow({
  row,
  isSelected,
  isEven,
  onSelect,
}: {
  row: AccountabilityRow
  isSelected: boolean
  isEven: boolean
  onSelect: () => void
}) {
  const dirCfg = DIRECTION_CONFIG[row.direction] || { color: 'text-gray-600', bgColor: 'bg-gray-100' }
  const stageCfg = STAGE_CONFIG[row.stage] || STAGE_CONFIG.approved
  const resultCfg = row.result_direction ? RESULT_CONFIG[row.result_direction] : null

  // Move since decision takes priority, falls back to move since execution
  const displayMove = row.move_since_decision_pct ?? row.move_since_execution_pct
  const hasMove = displayMove !== null

  return (
    <div
      onClick={onSelect}
      className={`grid ${MAIN_GRID} cursor-pointer transition-colors border-b border-gray-100 ${
        isSelected
          ? 'bg-primary-50/60 border-l-2 border-l-primary-500'
          : row.execution_status === 'unmatched'
            ? `${isEven ? 'bg-red-50/20' : 'bg-red-50/10'} hover:bg-red-50/40 border-l-2 border-l-red-300`
            : row.execution_status === 'pending'
              ? `${isEven ? 'bg-amber-50/15' : 'bg-amber-50/8'} hover:bg-amber-50/30 border-l-2 border-l-amber-300`
              : `${isEven ? 'bg-white' : 'bg-gray-50/40'} hover:bg-gray-50 border-l-2 border-l-transparent`
      }`}
    >
      {/* Date */}
      <div className="px-2 py-[7px] flex items-center">
        <span className="text-[10px] text-gray-500 tabular-nums">
          {row.approved_at ? format(new Date(row.approved_at), 'MMM d') : format(new Date(row.created_at), 'MMM d')}
        </span>
      </div>

      {/* Asset */}
      <div className="px-2 py-[7px] flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] font-semibold text-gray-900">{row.asset_symbol || '?'}</span>
        <span className="text-[9px] text-gray-400 truncate">{row.asset_name || ''}</span>
      </div>

      {/* Direction */}
      <div className="px-1 py-[7px] flex items-center">
        <span className={`text-[7px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded ${dirCfg.color} ${dirCfg.bgColor}`}>
          {row.direction}
        </span>
      </div>

      {/* Decision Stage */}
      <div className="px-1.5 py-[7px] flex items-center">
        <span className={`text-[7px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded ${stageCfg.color} ${stageCfg.bgColor}`}>
          {stageCfg.label}
        </span>
      </div>

      {/* Execution Status */}
      <div className="px-1.5 py-[7px] flex items-center gap-1">
        <ExecStatusPill status={row.execution_status} />
      </div>

      {/* Move (since decision or execution) */}
      <div className="px-1.5 py-[7px] flex items-center justify-end gap-0.5">
        {hasMove && resultCfg ? (
          <>
            <resultCfg.icon className={`w-3 h-3 ${resultCfg.color}`} />
            <span className={`text-[10px] font-semibold tabular-nums ${resultCfg.color}`}>
              {formatMovePct(displayMove)}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-gray-300">{'\u2014'}</span>
        )}
      </div>

      {/* Impact (size-weighted proxy) */}
      <div className="px-1 py-[7px] flex items-center justify-end">
        {row.impact_proxy !== null ? (
          <span className={`text-[10px] font-semibold tabular-nums ${
            row.impact_proxy >= 0 ? 'text-emerald-600' : 'text-red-600'
          }`} title={row.size_basis ? SIZE_BASIS_LABEL[row.size_basis] : undefined}>
            {formatDollarCompact(row.impact_proxy)}
          </span>
        ) : row.trade_notional !== null ? (
          <span className="text-[9px] text-gray-300" title="Trade sized but no price move data">{'\u2014'}</span>
        ) : (
          <span className="text-[10px] text-gray-300">{'\u2014'}</span>
        )}
      </div>

      {/* Delay Cost */}
      <div className="px-1 py-[7px] flex items-center justify-end">
        {row.delay_cost_pct !== null ? (
          <span className={`text-[10px] font-medium tabular-nums ${
            row.delay_cost_pct > 0.5 ? 'text-red-600' : row.delay_cost_pct < -0.5 ? 'text-emerald-600' : 'text-gray-400'
          }`}>
            {formatDelayCost(row.delay_cost_pct)}
          </span>
        ) : (
          <span className="text-[10px] text-gray-300">{'\u2014'}</span>
        )}
      </div>

      {/* Lag */}
      <div className="px-1 py-[7px] flex items-center justify-end">
        {row.execution_lag_days !== null && row.execution_lag_days >= 0 ? (
          <span className={`text-[10px] tabular-nums ${
            row.execution_lag_days > 7 ? 'text-amber-600 font-semibold' : 'text-gray-400'
          }`}>
            {row.execution_lag_days}d
          </span>
        ) : row.days_since_decision !== null && row.execution_status === 'pending' ? (
          <span className={`text-[10px] tabular-nums ${
            row.days_since_decision > 14 ? 'text-amber-600 font-semibold' : 'text-gray-400'
          }`}>
            {row.days_since_decision}d
          </span>
        ) : (
          <span className="text-[10px] text-gray-300">{'\u2014'}</span>
        )}
      </div>

      {/* Portfolio */}
      <div className="px-1.5 py-[7px] flex items-center">
        <span className="text-[9px] text-gray-400 truncate">{row.portfolio_name || '\u2014'}</span>
      </div>

      {/* Owner */}
      <div className="px-1.5 py-[7px] flex items-center">
        <span className="text-[9px] text-gray-400 truncate">{row.owner_name || '\u2014'}</span>
      </div>
    </div>
  )
}

// ============================================================
// Detail Panel
// ============================================================

/** Collapsible section for the Decision Story */
function StorySection({ icon: Icon, title, children, defaultOpen = true, badge }: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-gray-100 dark:border-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-50/50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
        <Icon className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex-1">{title}</span>
        {badge}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  )
}

/** Empty state for missing data */
function EmptyField({ text }: { text: string }) {
  return <p className="text-[10px] text-gray-300 italic">{text}</p>
}

/** Rationale field row */
function RationaleField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="mb-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{label}</div>
      <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  )
}

// =============================================================================
// Post-Mortem Section — inline retrospective editor for Outcomes.
// Canonical post-mortem authoring surface. Stores in trade_event_rationales.
//
// Field mapping (DB field → retrospective UI label):
//   reason_for_action → Outcome assessment (what happened overall)
//   thesis_context    → Thesis vs reality (was the thesis right/wrong)
//   what_changed      → What changed (between decision and outcome)
//   sizing_logic      → Sizing reflection (was the size right)
//   execution_context → Execution reflection (timing, fills, process)
//   why_now           → What was right (what to repeat)
//   catalyst_trigger  → What was wrong (what to avoid)
//   risk_context      → Lessons learned (key takeaway)
// =============================================================================

const PM_FIELDS: Array<{ key: string; label: string; placeholder: string; rows?: number }> = [
  { key: 'reason_for_action', label: 'Outcome Assessment', placeholder: 'What happened with this trade? How did it perform?', rows: 3 },
  { key: 'thesis_context', label: 'Thesis vs Reality', placeholder: 'Was the original thesis correct? What played out differently?', rows: 2 },
  { key: 'what_changed', label: 'What Changed', placeholder: 'What information or circumstances changed between the decision and the outcome?', rows: 2 },
  { key: 'sizing_logic', label: 'Sizing Reflection', placeholder: 'Was the position size appropriate? Would you size it differently?', rows: 2 },
  { key: 'execution_context', label: 'Execution Reflection', placeholder: 'Was the timing and execution quality adequate? Any process issues?', rows: 2 },
  { key: 'why_now', label: 'What Was Right', placeholder: 'What should be repeated in future decisions?', rows: 2 },
  { key: 'catalyst_trigger', label: 'What Was Wrong', placeholder: 'What should be avoided or done differently?', rows: 2 },
  { key: 'risk_context', label: 'Lessons Learned', placeholder: 'Key takeaway from this decision.', rows: 2 },
]

function PostMortemSection({ story, row, executionEventId }: {
  story: import('../hooks/useDecisionAccountability').DecisionStory | null | undefined
  row: AccountabilityRow
  executionEventId: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [diverged, setDiverged] = useState(false)
  const [divergeExplanation, setDivergeExplanation] = useState('')

  const saveM = useSavePostMortem(row.decision_id, executionEventId)
  const existing = story?.executionRationale

  const startEdit = () => {
    // Prefill from existing rationale if any
    const init: Record<string, string> = {}
    if (existing) {
      PM_FIELDS.forEach(f => { init[f.key] = (existing as any)[f.key] || '' })
    }
    setDraft(init)
    setDiverged(existing?.divergence_from_plan ?? false)
    setDivergeExplanation(existing?.divergence_explanation || '')
    setEditing(true)
  }

  const handleSave = (status: 'draft' | 'complete') => {
    const params: any = {
      status,
      divergence_from_plan: diverged,
      divergence_explanation: diverged ? divergeExplanation : null,
    }
    PM_FIELDS.forEach(f => { params[f.key] = draft[f.key]?.trim() || null })
    saveM.mutate(params, { onSuccess: () => setEditing(false) })
  }

  // Determine review status
  const reviewStatus: 'missing' | 'draft' | 'complete' | 'reviewed' | 'not_applicable' =
    row.execution_status !== 'executed' ? 'not_applicable' :
    !existing ? 'missing' :
    existing.status === 'reviewed' ? 'reviewed' :
    existing.status === 'complete' ? 'complete' :
    'draft'

  const statusBadge = {
    missing: <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Missing</span>,
    draft: <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">In Progress</span>,
    complete: <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Captured</span>,
    reviewed: <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Reviewed</span>,
    not_applicable: undefined,
  }[reviewStatus]

  return (
    <StorySection icon={Pencil} title="Post-Mortem" defaultOpen={reviewStatus === 'missing' || editing} badge={statusBadge}>
      {row.execution_status !== 'executed' ? (
        <EmptyField text="Post-mortem available after execution" />
      ) : !executionEventId ? (
        <EmptyField text="No matched execution event — post-mortem requires an execution record" />
      ) : editing ? (
        /* ── Edit Mode ── */
        <div className="space-y-3">
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Retrospective review: look back at the decision and capture what happened, what you learned, and what to do differently.
          </p>
          {PM_FIELDS.map(f => (
            <div key={f.key}>
              <label className="block text-[10px] font-semibold text-gray-600 mb-1">{f.label}</label>
              <textarea
                value={draft[f.key] || ''}
                onChange={e => setDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                rows={f.rows || 2}
                className="w-full text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 leading-relaxed resize-none"
              />
            </div>
          ))}

          {/* Divergence checkbox */}
          <div className="flex items-start gap-2 mt-1">
            <input
              type="checkbox"
              checked={diverged}
              onChange={e => setDiverged(e.target.checked)}
              className="mt-0.5 w-3.5 h-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <div className="flex-1">
              <span className="text-[10px] font-medium text-gray-600">Diverged from original plan</span>
              {diverged && (
                <textarea
                  value={divergeExplanation}
                  onChange={e => setDivergeExplanation(e.target.value)}
                  placeholder="Explain how and why the execution diverged..."
                  rows={2}
                  className="w-full mt-1 text-[11px] px-2.5 py-1.5 rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-500 leading-relaxed resize-none"
                />
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => handleSave('complete')}
              disabled={saveM.isPending}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 shadow-sm transition-colors disabled:opacity-50"
            >
              {saveM.isPending ? 'Saving...' : 'Save Review'}
            </button>
            <button
              onClick={() => handleSave('draft')}
              disabled={saveM.isPending}
              className="px-3 py-1.5 text-[11px] font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Save as Draft
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : existing ? (
        /* ── View Mode (content exists) ── */
        <div>
          {PM_FIELDS.map(f => {
            const val = (existing as any)[f.key]
            if (!val) return null
            return (
              <div key={f.key} className="mb-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{f.label}</div>
                <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{val}</p>
              </div>
            )
          })}
          {existing.divergence_from_plan && (
            <div className="mt-2 px-2.5 py-2 rounded bg-amber-50 border border-amber-200">
              <div className="text-[9px] font-semibold text-amber-700 mb-1">Diverged from plan</div>
              <p className="text-[11px] text-gray-700">{existing.divergence_explanation || 'No explanation provided'}</p>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px] text-gray-400">
              {existing.authored_by_name && <span>by {existing.authored_by_name}</span>}
              <span className="capitalize">{existing.status}</span>
            </div>
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-[10px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit Review
            </button>
          </div>
        </div>
      ) : (
        /* ── Empty State (no review yet) ── */
        <div className="text-center py-5">
          <Pencil className="w-7 h-7 text-gray-300 mx-auto mb-2" />
          <p className="text-[12px] font-medium text-gray-600 mb-1">No post-mortem captured</p>
          <p className="text-[10px] text-gray-400 mb-3 max-w-xs mx-auto leading-relaxed">
            Review what happened with this decision and capture lessons for future reference.
          </p>
          <button
            onClick={startEdit}
            className="px-4 py-2 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 shadow-sm transition-colors"
          >
            Add Post-Mortem
          </button>
        </div>
      )}
    </StorySection>
  )
}

function DetailPanel({
  row,
  onClose,
  onNavigate,
}: {
  row: AccountabilityRow
  onClose: () => void
  onNavigate?: (item: any) => void
}) {
  const dirCfg = DIRECTION_CONFIG[row.direction] || { color: 'text-gray-600', bgColor: 'bg-gray-100' }

  // Fetch the full decision story (theses, recommendation, acceptance, rationale, research)
  const firstExecId = row.matched_executions?.[0]?.event_id || null
  const { data: story, isLoading: storyLoading } = useDecisionStory(row.decision_id, firstExecId)

  // Review status badge (mirrors PostMortemSection logic)
  const reviewBadge = row.execution_status !== 'executed' ? null
    : !story?.executionRationale ? <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">No review</span>
    : story.executionRationale.status === 'reviewed' ? <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Reviewed</span>
    : story.executionRationale.status === 'complete' ? <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Captured</span>
    : <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">In Progress</span>

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded ${dirCfg.color} ${dirCfg.bgColor}`}>
            {row.direction}
          </span>
          <span className="text-[13px] font-semibold text-gray-900 truncate">{row.asset_symbol}</span>
          <span className="text-[11px] text-gray-400 truncate">{row.asset_name}</span>
          {reviewBadge}
        </div>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ════════════════════════════════════════════════════════════
            DECISION STORY — chronological lifecycle review
            Outcomes is the canonical post-mortem workspace.
            ════════════════════════════════════════════════════════════ */}

        {/* ── 1. Idea & Thesis ── */}
        <StorySection icon={Lightbulb} title="Idea & Thesis" badge={
          story?.theses && story.theses.length > 0
            ? <span className="text-[8px] text-gray-400">{story.theses.length} thesis{story.theses.length !== 1 ? 'es' : ''}</span>
            : undefined
        }>
          {/* Original rationale */}
          {row.rationale_text ? (
            <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap mb-2">{row.rationale_text}</p>
          ) : (
            <EmptyField text="No idea rationale captured" />
          )}

          {/* Idea metadata */}
          <div className="flex items-center gap-3 text-[10px] text-gray-500 mb-2">
            {row.owner_name && <span>by {row.owner_name}</span>}
            <span>{format(new Date(row.created_at), 'MMM d, yyyy')}</span>
            {story?.ideaExtras?.conviction && <span className="capitalize">Conviction: {story.ideaExtras.conviction}</span>}
            {story?.ideaExtras?.time_horizon && <span className="capitalize">{story.ideaExtras.time_horizon} horizon</span>}
          </div>

          {/* Thesis text */}
          {story?.ideaExtras?.thesis_text && (
            <div className="mb-2 px-2.5 py-2 rounded bg-gray-50 border border-gray-100 text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap">
              {story.ideaExtras.thesis_text}
            </div>
          )}

          {/* Bull/Bear theses */}
          {story?.theses && story.theses.length > 0 && (
            <div className="space-y-1.5 mt-2">
              {story.theses.map(t => (
                <div key={t.id} className="flex items-start gap-2 text-[10px]">
                  <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase flex-shrink-0 ${
                    t.direction === 'bull' ? 'bg-emerald-100 text-emerald-700' :
                    t.direction === 'bear' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{t.direction}</span>
                  <span className="text-gray-600 leading-relaxed">{t.rationale}</span>
                </div>
              ))}
            </div>
          )}

          {/* Linked research */}
          {story && story.linkedResearchCount > 0 && (
            <div className="mt-2 text-[10px] text-primary-600 flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {story.linkedResearchCount} linked research item{story.linkedResearchCount !== 1 ? 's' : ''}
            </div>
          )}
        </StorySection>

        {/* ── 2. Recommendation ── */}
        <StorySection icon={MessageSquare} title="Recommendation" defaultOpen={!!story?.decisionRequest}>
          {story?.decisionRequest ? (() => {
            const dr = story.decisionRequest
            const snap = dr.submission_snapshot || {}
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-[10px] text-gray-500">
                  {dr.requester_name && <span>by {dr.requester_name}</span>}
                  <span>{format(new Date(dr.created_at), 'MMM d, yyyy')}</span>
                  {dr.urgency && <span className="capitalize">{dr.urgency} urgency</span>}
                </div>
                {/* Proposed sizing */}
                {(snap.weight || snap.shares || snap.action) && (
                  <div className="px-2.5 py-2 rounded bg-amber-50/50 border border-amber-200/60 text-[11px]">
                    <div className="flex items-center gap-3">
                      {snap.action && <span className="font-semibold uppercase text-[10px]">{snap.action as string}</span>}
                      {snap.weight != null && <span>Weight: <span className="font-medium">{Number(snap.weight).toFixed(1)}%</span></span>}
                      {snap.shares != null && <span>Shares: <span className="font-medium">{Number(snap.shares).toLocaleString()}</span></span>}
                    </div>
                  </div>
                )}
                {/* Analyst context note */}
                {dr.context_note && (
                  <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap">{dr.context_note}</p>
                )}
                {(snap.notes as string) && (
                  <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap">{snap.notes as string}</p>
                )}
              </div>
            )
          })() : (
            <EmptyField text="No formal recommendation — direct PM decision" />
          )}
        </StorySection>

        {/* ── 3. Decision ── */}
        <StorySection icon={Target} title="Decision">
          <div className="space-y-1.5">
            <DetailRow label="Status" value={
              <span className={`text-[9px] font-bold uppercase px-1.5 py-[2px] rounded ${
                (STAGE_CONFIG[row.stage] || STAGE_CONFIG.approved).color
              } ${(STAGE_CONFIG[row.stage] || STAGE_CONFIG.approved).bgColor}`}>
                {(STAGE_CONFIG[row.stage] || STAGE_CONFIG.approved).label}
              </span>
            } />
            {row.approved_at && <DetailRow label="Decided" value={format(new Date(row.approved_at), 'MMM d, yyyy')} />}
            {row.approver_name && <DetailRow label="Decided by" value={row.approver_name} />}
            {row.portfolio_name && <DetailRow label="Portfolio" value={row.portfolio_name} />}
            {row.has_decision_price && row.decision_price !== null && (
              <DetailRow label="Price at decision" value={
                <span className="text-[11px] font-medium text-gray-700 tabular-nums">{formatPrice(row.decision_price)}</span>
              } />
            )}
          </div>

          {/* PM decision note */}
          {story?.decisionRequest?.decision_note && (
            <div className="mt-2 px-2.5 py-2 rounded bg-blue-50/50 border border-blue-200/60">
              <div className="text-[9px] font-semibold text-blue-600 mb-1">PM Decision Note</div>
              <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{story.decisionRequest.decision_note}</p>
            </div>
          )}

          {/* Acceptance note */}
          {story?.acceptedTrade?.acceptance_note && (
            <div className="mt-2 px-2.5 py-2 rounded bg-emerald-50/50 border border-emerald-200/60">
              <div className="text-[9px] font-semibold text-emerald-600 mb-1">Acceptance Note</div>
              <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{story.acceptedTrade.acceptance_note}</p>
            </div>
          )}
        </StorySection>

        {/* ── 4. Execution ── */}
        <StorySection icon={ArrowRight} title="Execution" badge={<ExecStatusPill status={row.execution_status} />}>
          {row.execution_status === 'not_applicable' ? (
            <p className="text-[11px] text-gray-400">
              Decision was {row.stage} — execution not expected.
            </p>
          ) : row.matched_executions.length === 0 ? (
            <div className="flex items-start gap-2">
              <ExecStatusPill status={row.execution_status} />
              <p className="text-[11px] text-gray-500">
                {row.execution_status === 'pending'
                  ? `No matching trade event yet. ${row.days_since_decision !== null ? `${row.days_since_decision}d since decision.` : ''}`
                  : 'No matching trade event found within the expected window.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {row.matched_executions.map(exec => (
                <ExecutionCard key={exec.event_id} exec={exec} />
              ))}
            </div>
          )}
        </StorySection>

        {/* ── 5. Outcome ── */}
        <StorySection icon={DollarSign} title="Outcome" badge={
          row.result_direction ? (
            <span className={`text-[8px] font-bold uppercase px-1.5 py-[2px] rounded ${
              row.result_direction === 'positive' ? 'text-emerald-700 bg-emerald-50' :
              row.result_direction === 'negative' ? 'text-red-700 bg-red-50' :
              'text-gray-500 bg-gray-100'
            }`}>{RESULT_CONFIG[row.result_direction].label}</span>
          ) : undefined
        }>
          {row.execution_status === 'not_applicable' ? (
            <p className="text-[11px] text-gray-400">Not applicable for {row.stage} decisions.</p>
          ) : (
            <div className="space-y-1.5">
              {/* Price journey: decision → execution → current */}
              <PriceJourney row={row} />

              {/* Move since decision */}
              {row.move_since_decision_pct !== null && (
                <DetailRow
                  label="Move since decision"
                  value={
                    <span className={`text-[11px] font-semibold tabular-nums ${
                      row.move_since_decision_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {formatMovePct(row.move_since_decision_pct)}
                    </span>
                  }
                />
              )}

              {/* Move since execution */}
              {row.move_since_execution_pct !== null && (
                <DetailRow
                  label="Move since execution"
                  value={
                    <span className={`text-[11px] font-semibold tabular-nums ${
                      row.move_since_execution_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {formatMovePct(row.move_since_execution_pct)}
                    </span>
                  }
                />
              )}

              {/* Result direction */}
              {row.result_direction && (
                <DetailRow
                  label="Decision result"
                  value={
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-[2px] rounded ${
                      row.result_direction === 'positive'
                        ? 'text-emerald-700 bg-emerald-50'
                        : row.result_direction === 'negative'
                          ? 'text-red-700 bg-red-50'
                          : 'text-gray-500 bg-gray-100'
                    }`}>
                      {RESULT_CONFIG[row.result_direction].label}
                    </span>
                  }
                />
              )}

              {/* Delay cost / impact */}
              {row.delay_cost_pct !== null ? (
                <div className="mt-2 px-2.5 py-2 rounded bg-gray-50 border border-gray-200">
                  <div className="flex items-center gap-1 mb-1">
                    <Timer className="w-3 h-3 text-gray-400" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Delay Impact</span>
                  </div>
                  <DetailRow label="Decision \u2192 Execution" value={
                    row.execution_lag_days !== null ? `${row.execution_lag_days}d` : '\u2014'
                  } />
                  <DetailRow label="Delay cost" value={
                    <span className={`text-[11px] font-semibold tabular-nums ${
                      row.delay_cost_pct > 0.5 ? 'text-red-600' : row.delay_cost_pct < -0.5 ? 'text-emerald-600' : 'text-gray-600'
                    }`}>
                      {formatDelayCost(row.delay_cost_pct)}
                    </span>
                  } />
                  <p className="text-[9px] text-gray-400 mt-1 leading-relaxed">
                    {row.delay_cost_pct > 0.5
                      ? 'Waiting to execute moved price against the decision direction.'
                      : row.delay_cost_pct < -0.5
                        ? 'Waiting to execute resulted in a better entry price.'
                        : 'Minimal price movement during the lag period.'}
                  </p>
                  {row.execution_lag_days !== null && row.execution_lag_days > 7 && row.delay_cost_pct > 0.5 && (
                    <p className="text-[9px] text-amber-600 mt-0.5">
                      Lag exceeds 7 days with material delay cost — review execution process.
                    </p>
                  )}
                </div>
              ) : row.execution_lag_days !== null && row.execution_lag_days > 0 && !row.has_decision_price ? (
                <div className="mt-2 px-2.5 py-2 rounded bg-gray-50 border border-gray-200">
                  <div className="flex items-center gap-1 mb-1">
                    <Timer className="w-3 h-3 text-gray-400" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Delay Impact</span>
                  </div>
                  <DetailRow label="Decision \u2192 Execution" value={`${row.execution_lag_days}d`} />
                  <p className="text-[9px] text-gray-400 mt-1 leading-relaxed">
                    No decision-time price snapshot available (legacy decision).
                    Future decisions will capture price at approval for delay cost analysis.
                  </p>
                </div>
              ) : null}

              {/* ── Size-aware impact proxy ── */}
              {(row.trade_notional !== null || row.impact_proxy !== null) && (
                <div className="mt-2 px-2.5 py-2 rounded bg-blue-50/50 border border-blue-200/60">
                  <div className="flex items-center gap-1 mb-1">
                    <Scale className="w-3 h-3 text-blue-400" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-blue-400">Size-Aware Impact</span>
                    <span className="text-[7px] text-blue-300 ml-auto">proxy</span>
                  </div>

                  {row.trade_notional !== null && (
                    <DetailRow label="Trade size" value={
                      <span className="text-[11px] font-medium text-gray-700 tabular-nums">
                        {formatNotional(row.trade_notional)}
                        {row.size_basis && (
                          <span className="text-[8px] text-gray-400 ml-1">
                            ({SIZE_BASIS_LABEL[row.size_basis]})
                          </span>
                        )}
                      </span>
                    } />
                  )}

                  {row.weight_impact !== null && (
                    <DetailRow label="Weight change" value={
                      <span className={`text-[11px] font-medium tabular-nums ${
                        row.weight_impact > 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {row.weight_impact > 0 ? '+' : ''}{row.weight_impact.toFixed(2)}%
                      </span>
                    } />
                  )}

                  {row.impact_proxy !== null && (
                    <DetailRow label="Impact proxy" value={
                      <span className={`text-[11px] font-semibold tabular-nums ${
                        row.impact_proxy >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {formatDollarCompact(row.impact_proxy)}
                      </span>
                    } />
                  )}

                  {row.weighted_delay_cost !== null && (
                    <DetailRow label="Delay cost $" value={
                      <span className={`text-[11px] font-medium tabular-nums ${
                        row.weighted_delay_cost > 0 ? 'text-red-600' : row.weighted_delay_cost < 0 ? 'text-emerald-600' : 'text-gray-600'
                      }`}>
                        {formatDollarCompact(row.weighted_delay_cost)}
                      </span>
                    } />
                  )}

                  <p className="text-[8px] text-blue-300 mt-1 leading-relaxed">
                    Directional proxy. Not exact P&L. Ignores fees, partial fills, and benchmark.
                  </p>
                </div>
              )}

              {/* No price data at all */}
              {row.move_since_decision_pct === null && row.move_since_execution_pct === null && (
                <div className="text-[10px] text-gray-400 italic mt-1">
                  {row.current_price === null && row.execution_price === null && !row.has_decision_price
                    ? 'Price data not available for this asset.'
                    : row.matched_executions.length === 0
                      ? 'No execution yet — result pending.'
                      : 'Execution price could not be derived from trade event data.'}
                </div>
              )}
            </div>
          )}
        </StorySection>

        {/* ── 6. Post-Mortem / Lessons ── */}
        <PostMortemSection
          story={story}
          row={row}
          executionEventId={firstExecId}
        />

        {/* ── Navigation & Metadata ── */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-3 text-[10px] text-gray-400 mb-2">
            <DetailRow label="Decision age" value={row.days_since_decision !== null ? `${row.days_since_decision}d` : '—'} />
            {row.execution_lag_days !== null && row.execution_lag_days >= 0 && (
              <DetailRow label="Exec lag" value={`${row.execution_lag_days}d`} />
            )}
          </div>

          {onNavigate && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => onNavigate({ id: row.decision_id, title: `${row.direction} ${row.asset_symbol}`, type: 'trade-queue' })}
                className="text-[10px] text-primary-600 hover:text-primary-700 hover:underline"
              >
                View source idea
              </button>
            </div>
          )}

          <div className="mt-3 text-[8px] text-gray-300 leading-relaxed">
            Moves are directionalized proxies. Impact proxy = trade size × directionalized move. Not exact P&L.
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Price Journey — visual representation of decision→execution→current
// ============================================================

function PriceJourney({ row }: { row: AccountabilityRow }) {
  const prices = [
    { label: 'Decision', price: row.decision_price, qualifier: row.has_decision_price ? '(snapshot)' : null },
    { label: 'Execution', price: row.execution_price, qualifier: row.execution_price !== null ? '(proxy)' : null },
    { label: 'Current', price: row.current_price, qualifier: row.current_price !== null ? '(cached)' : null },
  ].filter(p => p.price !== null)

  if (prices.length === 0) return null

  return (
    <div className="flex items-center gap-1 py-1.5">
      {prices.map((p, i) => (
        <div key={p.label} className="flex items-center gap-1">
          {i > 0 && <ArrowRight className="w-3 h-3 text-gray-300 shrink-0" />}
          <div className="text-center">
            <div className="text-[8px] text-gray-400 uppercase tracking-wide">{p.label}</div>
            <div className="text-[11px] font-semibold text-gray-800 tabular-nums">{formatPrice(p.price)}</div>
            {p.qualifier && <div className="text-[7px] text-gray-300">{p.qualifier}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// Supporting Components
// ============================================================

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-gray-400">{label}</span>
      <span className="text-[11px] text-gray-700 text-right">{value}</span>
    </div>
  )
}

function ExecutionCard({ exec }: { exec: MatchedExecution }) {
  return (
    <div className="border border-gray-200 rounded p-2.5 bg-gray-50/50">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded bg-teal-50 text-teal-700">
            {exec.action_type}
          </span>
          <span className="text-[10px] text-gray-500">{format(new Date(exec.event_date), 'MMM d, yyyy')}</span>
        </div>
        <span className={`text-[8px] font-medium uppercase tracking-wide px-1 py-[1px] rounded ${
          exec.match_method === 'explicit_link' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
        }`}>
          {exec.match_method === 'explicit_link' ? 'Linked' : 'Fuzzy'}
        </span>
      </div>

      <div className="space-y-0.5">
        {exec.execution_price !== null && (
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-400">Price:</span>
            <span className="text-gray-700 font-medium tabular-nums">{formatPrice(exec.execution_price)}</span>
          </div>
        )}
        {exec.quantity_delta !== null && (
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-400">Shares:</span>
            <span className={exec.quantity_delta > 0 ? 'text-emerald-600' : 'text-red-600'}>
              {exec.quantity_delta > 0 ? '+' : ''}{exec.quantity_delta.toLocaleString()}
            </span>
          </div>
        )}
        {exec.weight_delta !== null && (
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-400">Weight:</span>
            <span className={exec.weight_delta > 0 ? 'text-emerald-600' : 'text-red-600'}>
              {exec.weight_delta > 0 ? '+' : ''}{exec.weight_delta.toFixed(2)}%
            </span>
          </div>
        )}
        {exec.market_value_after !== null && (
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-400">Position:</span>
            <span className="text-gray-600 tabular-nums">{formatPrice(exec.market_value_after)}</span>
          </div>
        )}
        {exec.lag_days !== null && exec.lag_days >= 0 && (
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-400">Lag:</span>
            <span className={`text-gray-600 ${exec.lag_days > 7 ? 'text-amber-600 font-semibold' : ''}`}>
              {exec.lag_days}d
            </span>
          </div>
        )}
      </div>

      {/* Execution rationale summary */}
      {exec.execution_rationale_summary ? (
        <div className="mt-1.5 pt-1.5 border-t border-gray-200">
          <div className="flex items-center gap-1 text-[10px] text-emerald-600 mb-0.5">
            <CheckCircle2 className="w-3 h-3" />
            <span className="font-medium">Rationale</span>
          </div>
          <p className="text-[10px] text-gray-600 leading-relaxed line-clamp-3">
            {exec.execution_rationale_summary}
          </p>
        </div>
      ) : exec.has_rationale ? (
        <div className="flex items-center gap-1 text-[10px] text-emerald-600 mt-1.5">
          <CheckCircle2 className="w-3 h-3" />
          <span>Rationale captured</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-[10px] text-amber-500 mt-1.5">
          <AlertCircle className="w-3 h-3" />
          <span>No rationale</span>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Main Page
// ============================================================

export function DecisionAccountabilityPage({ onItemSelect }: DecisionAccountabilityPageProps) {
  const [filters, setFilters] = useState<Partial<AccountabilityFilters>>({
    showApproved: true,
    showRejected: false,
    showCancelled: false,
    resultFilter: 'all',
    directionFilter: [],
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [sortBy, setSortBy] = useState<'date' | 'move' | 'impact' | 'lag' | 'delay'>('date')
  const [sortDesc, setSortDesc] = useState(true)

  const { rows, unmatchedExecutions, summary, isLoading, isError, refetch } = useDecisionAccountability({ filters })

  // Sort rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'move':
          cmp = (a.move_since_decision_pct ?? a.move_since_execution_pct ?? -999) -
                (b.move_since_decision_pct ?? b.move_since_execution_pct ?? -999)
          break
        case 'impact':
          cmp = (a.impact_proxy ?? -Infinity) - (b.impact_proxy ?? -Infinity)
          break
        case 'delay':
          cmp = (a.delay_cost_pct ?? -999) - (b.delay_cost_pct ?? -999)
          break
        case 'lag':
          cmp = (a.execution_lag_days ?? a.days_since_decision ?? -1) - (b.execution_lag_days ?? b.days_since_decision ?? -1)
          break
        case 'date':
        default: {
          const aDate = a.approved_at || a.created_at
          const bDate = b.approved_at || b.created_at
          cmp = aDate.localeCompare(bDate)
          break
        }
      }
      return sortDesc ? -cmp : cmp
    })
    return sorted
  }, [rows, sortBy, sortDesc])

  const selectedRow = useMemo(
    () => sortedRows.find(r => r.decision_id === selectedId) || null,
    [sortedRows, selectedId],
  )

  const handleSort = (col: 'date' | 'move' | 'impact' | 'lag' | 'delay') => {
    if (sortBy === col) {
      setSortDesc(!sortDesc)
    } else {
      setSortBy(col)
      setSortDesc(true)
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-teal-100 rounded-lg">
              <Target className="w-4 h-4 text-teal-600" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-gray-900">Decision Outcomes</h1>
              <p className="text-[10px] text-gray-400">Decisions, execution, and what happened after</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Snapshot coverage indicator */}
            {summary.snapshotCoverage > 0 && (
              <span className="text-[9px] text-gray-400 flex items-center gap-1" title="Decisions with price snapshot">
                <Camera className="w-3 h-3" />
                {summary.snapshotCoverage}/{summary.totalDecisions} snapshots
              </span>
            )}

            {/* Unmatched executions toggle */}
            {summary.unmatchedExecutionCount > 0 && (
              <button
                onClick={() => setShowUnmatched(!showUnmatched)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors ${
                  showUnmatched
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {summary.unmatchedExecutionCount} unmatched
              </button>
            )}
          </div>
        </div>

        <FilterBar filters={filters} onChange={setFilters} />
      </div>

      {/* ── SUMMARY ────────────────────────────────────────── */}
      <div className="px-6 py-2.5 shrink-0">
        <SummaryStrip summary={summary} />
      </div>

      {/* ── CONTENT ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 px-6 pb-4">
        {showUnmatched ? (
          /* ── Unmatched Executions View ── */
          <div className="h-full flex flex-col border border-gray-200 rounded overflow-hidden bg-white">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-amber-50/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-[12px] font-semibold text-gray-800">
                  Unmatched Executions
                </span>
                <span className="text-[10px] text-gray-400">
                  Trade events with no linked decision
                </span>
              </div>
              <button onClick={() => setShowUnmatched(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className={`grid ${UNMATCHED_GRID} bg-gray-50 border-b border-gray-200 shrink-0`}>
              <ColHeader>Date</ColHeader>
              <ColHeader>Asset</ColHeader>
              <ColHeader>Action</ColHeader>
              <ColHeader align="right">Position Delta</ColHeader>
              <ColHeader>Source</ColHeader>
              <ColHeader>Portfolio</ColHeader>
            </div>

            <div className="flex-1 overflow-y-auto">
              {unmatchedExecutions.length > 0 ? (
                unmatchedExecutions.map((evt, idx) => (
                  <div
                    key={evt.event_id}
                    className={`grid ${UNMATCHED_GRID} border-b border-gray-100 ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                    }`}
                  >
                    <div className="px-2.5 py-[7px] text-[11px] text-gray-500 tabular-nums">
                      {format(new Date(evt.event_date), 'MMM d')}
                    </div>
                    <div className="px-2.5 py-[7px] flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] font-semibold text-gray-900">{evt.asset_symbol || '?'}</span>
                      <span className="text-[10px] text-gray-400 truncate">{evt.asset_name || ''}</span>
                    </div>
                    <div className="px-2.5 py-[7px]">
                      <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded bg-gray-100 text-gray-600">
                        {evt.action_type}
                      </span>
                    </div>
                    <div className="px-2.5 py-[7px] text-right">
                      {evt.quantity_delta !== null ? (
                        <span className={`text-[10px] font-semibold tabular-nums ${
                          evt.quantity_delta > 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {evt.quantity_delta > 0 ? '+' : ''}{evt.quantity_delta.toLocaleString()} shr
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">{'\u2014'}</span>
                      )}
                    </div>
                    <div className="px-2.5 py-[7px]">
                      <span className="text-[9px] text-gray-400 uppercase tracking-wide">{evt.source_type}</span>
                    </div>
                    <div className="px-2.5 py-[7px]">
                      <span className="text-[10px] text-gray-400 truncate">{evt.portfolio_name || '\u2014'}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-10 text-center text-[11px] text-gray-400">
                  No unmatched executions.
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Main Decision Table + Detail ── */
          <div className="h-full flex border border-gray-200 rounded overflow-hidden">
            {/* Table */}
            <div className="flex-1 min-w-0 flex flex-col bg-white">
              {/* Column headers */}
              <div className={`grid ${MAIN_GRID} bg-gray-50 border-b border-gray-200 shrink-0`}>
                <SortableColHeader active={sortBy === 'date'} desc={sortDesc} onClick={() => handleSort('date')}>
                  Date
                </SortableColHeader>
                <ColHeader>Asset</ColHeader>
                <ColHeader>Dir</ColHeader>
                <ColHeader>Decision</ColHeader>
                <ColHeader>Execution</ColHeader>
                <SortableColHeader active={sortBy === 'move'} desc={sortDesc} onClick={() => handleSort('move')} align="right">
                  Move
                </SortableColHeader>
                <SortableColHeader active={sortBy === 'impact'} desc={sortDesc} onClick={() => handleSort('impact')} align="right">
                  Impact
                </SortableColHeader>
                <SortableColHeader active={sortBy === 'delay'} desc={sortDesc} onClick={() => handleSort('delay')} align="right">
                  Delay
                </SortableColHeader>
                <SortableColHeader active={sortBy === 'lag'} desc={sortDesc} onClick={() => handleSort('lag')} align="right">
                  Lag
                </SortableColHeader>
                <ColHeader>Portfolio</ColHeader>
                <ColHeader>Owner</ColHeader>
              </div>

              {/* Rows */}
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-48">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
                  </div>
                ) : isError ? (
                  <div className="flex items-center justify-center h-48 gap-2 text-red-500">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-[11px]">Failed to load. </span>
                    <button onClick={refetch} className="text-[11px] underline">Retry</button>
                  </div>
                ) : sortedRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center">
                    <Target className="w-7 h-7 text-gray-300 mb-2" />
                    <p className="text-[12px] font-medium text-gray-600 mb-0.5">No decisions yet</p>
                    <p className="text-[10px] text-gray-400 max-w-xs">
                      When trade ideas reach a terminal stage (approved, rejected, cancelled),
                      they will appear here with execution matching and result tracking.
                    </p>
                  </div>
                ) : (
                  sortedRows.map((row, idx) => (
                    <DecisionRow
                      key={row.decision_id}
                      row={row}
                      isSelected={row.decision_id === selectedId}
                      isEven={idx % 2 === 0}
                      onSelect={() => setSelectedId(row.decision_id === selectedId ? null : row.decision_id)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Detail Panel */}
            {selectedRow && (
              <div className="w-[380px] shrink-0 border-l border-gray-200 overflow-hidden">
                <DetailPanel
                  row={selectedRow}
                  onClose={() => setSelectedId(null)}
                  onNavigate={onItemSelect}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Column headers
// ============================================================

function ColHeader({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <div className={`px-1.5 py-[7px] ${
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
    }`}>
      <span className="text-[8px] font-bold uppercase tracking-wider text-gray-400 select-none">{children}</span>
    </div>
  )
}

function SortableColHeader({
  children,
  active,
  desc,
  onClick,
  align = 'left',
}: {
  children: React.ReactNode
  active: boolean
  desc: boolean
  onClick: () => void
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <div
      onClick={onClick}
      className={`px-1.5 py-[7px] cursor-pointer select-none ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
      }`}
    >
      <span className={`text-[8px] font-bold uppercase tracking-wider ${
        active ? 'text-gray-700' : 'text-gray-400'
      }`}>
        {children}
        {active && (
          <span className="ml-0.5">{desc ? '\u25BC' : '\u25B2'}</span>
        )}
      </span>
    </div>
  )
}
