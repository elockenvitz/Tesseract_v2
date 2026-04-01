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
  Award, Users, Link2, Unlink,
} from 'lucide-react'
import { format, subDays, parseISO } from 'date-fns'
import {
  useDecisionAccountability,
  useDecisionStory,
  useSavePostMortem,
  useMarkAsReviewed,
  usePortfoliosForFilter,
  useUsersForFilter,
  useCandidateTradeEvents,
  useManualMatch,
  useUnlinkMatch,
  useMarkDecisionSkipped,
} from '../hooks/useDecisionAccountability'
import type { CandidateTradeEvent } from '../hooks/useDecisionAccountability'
import { AnalystScorecardCard } from '../components/outcomes/AnalystScorecardCard'
import { PositionChart } from '../components/outcomes/PositionChart'
import { usePositionLifecycle, usePositionPriceHistory, useHoldingsTimeSeries } from '../hooks/usePositionLifecycle'
import { PMScorecardCard } from '../components/outcomes/PMScorecardCard'
import { useScorecardVisibility, useTeamMembers } from '../hooks/useScorecards'
import { useAuth } from '../hooks/useAuth'
import { MultiSelectFilter } from '../components/ui/MultiSelectFilter'
import type {
  AccountabilityFilters,
  AccountabilityRow,
  AccountabilitySummary,
  ExecutionMatchStatus,
  MatchedExecution,
  ResultDirection,
  ReviewFilter,
  SizeBasis,
} from '../types/decision-accountability'

type OutcomesSubTab = 'decisions' | 'scorecards'

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
  not_applicable: { label: 'No trade',       color: 'text-gray-500',    bgColor: 'bg-gray-100',    icon: XCircle },
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

// Date | Symbol | Name | Type | Decision | Execution | Lag | Review | Portfolio | Owner
const MAIN_GRID = 'grid-cols-[72px_72px_minmax(100px,220px)_64px_80px_88px_48px_76px_132px_112px]'

/** Derive the review state for a row. Used consistently for borders, dots, and filters. */
function getRowReviewState(row: AccountabilityRow): 'needs_review' | 'in_progress' | 'captured' | 'reviewed' | null {
  if (row.execution_status !== 'executed') return null
  if (row.matched_executions.some(e => e.rationale_status === 'reviewed')) return 'reviewed'
  if (row.matched_executions.some(e => e.rationale_status === 'complete')) return 'captured'
  if (row.matched_executions.some(e => e.has_rationale)) return 'in_progress'
  return 'needs_review'
}
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

  const [showCustom, setShowCustom] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  type DatePreset = '7d' | '30d' | '90d' | 'QTD' | 'YTD' | '1Y' | '2Y' | 'ALL' | 'custom'

  const handlePreset = (preset: DatePreset) => {
    const now = new Date()
    let start: Date | null = null

    switch (preset) {
      case '7d': start = subDays(now, 7); break
      case '30d': start = subDays(now, 30); break
      case '90d': start = subDays(now, 90); break
      case 'QTD': {
        const qMonth = Math.floor(now.getMonth() / 3) * 3
        start = new Date(now.getFullYear(), qMonth, 1)
        break
      }
      case 'YTD': start = new Date(now.getFullYear(), 0, 1); break
      case '1Y': start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break
      case '2Y': start = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()); break
      case 'ALL': start = null; break
      case 'custom': setShowCustom(true); return
    }

    setShowCustom(false)
    onChange({
      ...filters,
      dateRange: {
        start: start ? start.toISOString() : null,
        end: now.toISOString(),
      },
    })
  }

  const applyCustomRange = () => {
    if (customStart) {
      onChange({
        ...filters,
        dateRange: {
          start: new Date(customStart).toISOString(),
          end: customEnd ? new Date(customEnd + 'T23:59:59').toISOString() : new Date().toISOString(),
        },
      })
      setShowCustom(false)
    }
  }

  const activePreset = useMemo((): DatePreset => {
    if (!filters.dateRange?.start) return 'ALL'
    const startDate = new Date(filters.dateRange.start)
    const diff = (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    const now = new Date()
    // Check QTD
    const qMonth = Math.floor(now.getMonth() / 3) * 3
    const qtdStart = new Date(now.getFullYear(), qMonth, 1)
    if (Math.abs(startDate.getTime() - qtdStart.getTime()) < 86400000) return 'QTD'
    // Check YTD
    const ytdStart = new Date(now.getFullYear(), 0, 1)
    if (Math.abs(startDate.getTime() - ytdStart.getTime()) < 86400000) return 'YTD'
    if (diff < 10) return '7d'
    if (diff < 40) return '30d'
    if (diff < 100) return '90d'
    if (diff < 400) return '1Y'
    if (diff < 800) return '2Y'
    return 'custom'
  }, [filters.dateRange?.start])

  const toggleExecStatus = (status: ExecutionMatchStatus) => {
    const current = filters.executionStatus || []
    const next = current.includes(status)
      ? current.filter(s => s !== status)
      : [...current, status]
    onChange({ ...filters, executionStatus: next })
  }

  return (
    <div className="flex items-center gap-2.5">
      {/* Date range */}
      <div className="relative">
        <div className="inline-flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
          {(['7d', '30d', '90d', 'QTD', 'YTD', '1Y', 'ALL'] as DatePreset[]).map(p => (
            <button
              key={p}
              onClick={() => handlePreset(p)}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                activePreset === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => handlePreset('custom')}
            className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
              showCustom || activePreset === 'custom' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Custom
          </button>
        </div>

        {showCustom && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowCustom(false)} />
            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="text-[11px] border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
              <span className="text-[11px] text-gray-400">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="text-[11px] border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
              <button
                onClick={applyCustomRange}
                disabled={!customStart}
                className="px-3 py-1 text-[11px] font-medium bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          </>
        )}
      </div>

      {/* Portfolio */}
      <MultiSelectFilter
        label="Portfolios"
        options={portfolios.map(p => ({ value: p.id, label: p.name }))}
        selected={filters.portfolioIds || []}
        onChange={ids => onChange({ ...filters, portfolioIds: ids })}
      />

      {/* Analyst */}
      <MultiSelectFilter
        label="Analysts"
        options={users.map(u => ({
          value: u.id,
          label: u.first_name || u.last_name
            ? `${u.first_name || ''} ${u.last_name || ''}`.trim()
            : u.email.split('@')[0],
        }))}
        selected={filters.ownerUserIds || []}
        onChange={ids => onChange({ ...filters, ownerUserIds: ids })}
      />

      {/* Asset search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          type="text"
          placeholder="Asset..."
          value={filters.assetSearch || ''}
          onChange={e => onChange({ ...filters, assetSearch: e.target.value })}
          className="pl-7 pr-2.5 py-1 text-[11px] border border-gray-200 rounded-md w-28 bg-white text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
        />
      </div>

      <div className="w-px h-4 bg-gray-200" />

      {/* Direction */}
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
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Include rejected/cancelled */}
      <div className="flex items-center gap-2.5">
        <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.showRejected || false}
            onChange={e => onChange({ ...filters, showRejected: e.target.checked })}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
          />
          Rejected
        </label>
        <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.showCancelled || false}
            onChange={e => onChange({ ...filters, showCancelled: e.target.checked })}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
          />
          Cancelled
        </label>
      </div>
    </div>
  )
}

// ============================================================
// Summary Strip
// ============================================================

function SummaryStrip({ summary }: { summary: AccountabilitySummary }) {
  const reviewQueueCount = summary.needsReviewCount + summary.reviewInProgressCount
  const hasReviewWork = reviewQueueCount > 0

  const tiles: Array<{
    label: string
    value: string | number
    color: string
    icon: typeof CheckCircle2
    tooltip?: string
    highlight?: boolean
    sub?: string
  }> = [
    // Review Queue — first position, visually primary when actionable
    {
      label: 'Review Queue',
      value: reviewQueueCount,
      icon: Pencil,
      color: hasReviewWork ? 'text-red-600' : 'text-gray-400',
      tooltip: `${summary.needsReviewCount} missing, ${summary.reviewInProgressCount} draft`,
      highlight: hasReviewWork,
      sub: hasReviewWork ? `${summary.needsReviewCount} missing \u00B7 ${summary.reviewInProgressCount} draft` : undefined,
    },
    { label: 'Decisions', value: summary.approvedCount, icon: Target, color: 'text-gray-700' },
    {
      label: 'Exec Rate',
      value: summary.executionRate !== null ? `${summary.executionRate}%` : '\u2014',
      icon: Percent,
      color: summary.executionRate !== null && summary.executionRate >= 80 ? 'text-emerald-600' : 'text-amber-600',
      tooltip: 'Executed or matched / approved decisions',
    },
    {
      label: 'Avg Lag',
      value: summary.avgLagDays !== null ? `${summary.avgLagDays}d` : '\u2014',
      icon: Timer,
      color: summary.avgLagDays !== null && summary.avgLagDays > 7 ? 'text-amber-600' : 'text-gray-600',
    },
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
      tooltip: `Size-weighted net impact proxy (${summary.sizedDecisionCount} sized). Not exact P&L.`,
    },
    {
      label: 'Delay Cost',
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

  return (
    <div className="grid grid-cols-8 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
      {tiles.map((t, i) => {
        const Icon = t.icon
        return (
          <div
            key={t.label}
            className={`px-3 py-2.5 ${
              t.highlight ? 'bg-red-50/60' : 'bg-white'
            } ${i === 0 ? 'border-r-2 border-r-gray-300' : ''}`}
            title={t.tooltip}
          >
            <div className="flex items-center gap-1">
              <Icon className={`w-3.5 h-3.5 ${t.color} opacity-60`} />
              <span className={`text-[9px] font-bold uppercase tracking-wider ${t.highlight ? 'text-red-400' : 'text-gray-400'}`}>{t.label}</span>
            </div>
            <p className={`text-[18px] font-semibold mt-0.5 tabular-nums leading-none ${t.color}`}>
              {t.value}
            </p>
            {t.sub && (
              <p className="text-[9px] text-red-400/80 mt-0.5 leading-none tabular-nums">{t.sub}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// Execution Status Pill (clickable with explanation)
// ============================================================

/**
 * Build a context-specific explanation for why a decision has its execution status.
 */
function getExecStatusExplanation(row: AccountabilityRow): string {
  const sym = row.asset_symbol || 'this asset'
  const portfolio = row.portfolio_name ? ` in ${row.portfolio_name}` : ''
  const daysAgo = row.days_since_decision != null ? `${row.days_since_decision} days ago` : 'recently'
  const approvedDate = row.approved_at ? format(new Date(row.approved_at), 'MMM d') : null

  switch (row.execution_status) {
    case 'executed': {
      const exec = row.matched_executions[0]
      if (!exec) return `Matched to a trade event for ${sym}${portfolio}.`
      const method = exec.match_method === 'explicit_link'
        ? 'directly linked'
        : `auto-matched by asset, direction, and timing (${exec.lag_days != null ? `${exec.lag_days}d after approval` : 'fuzzy'})`
      const execDate = format(new Date(exec.event_date), 'MMM d')
      const actionPast: Record<string, string> = {
        initiate: 'bought', add: 'added to', trim: 'trimmed', exit: 'sold',
        reduce: 'reduced', buy: 'bought', sell: 'sold',
        cover: 'covered', short_initiate: 'shorted', rebalance: 'rebalanced', hedge: 'hedged',
      }
      const actionLabel = actionPast[exec.action_type] || exec.action_type
      return `${sym} was ${actionLabel} on ${execDate}${portfolio}. This trade was ${method}.`
    }

    case 'pending': {
      const window = 30 - (row.days_since_decision ?? 0)
      return `${row.direction.toUpperCase()} ${sym} was approved${approvedDate ? ` on ${approvedDate}` : ''} (${daysAgo}). No position change has been detected${portfolio} yet. The system will keep looking for ${window > 0 ? `another ${window} days` : 'a matching trade'}.`
    }

    case 'possible_match': {
      const exec = row.matched_executions[0]
      if (!exec) return `A possible trade was found for ${sym} but needs confirmation.`
      const execDate = format(new Date(exec.event_date), 'MMM d')
      return `A ${exec.action_type} of ${sym} was detected on ${execDate}${portfolio} that looks like it could be this decision, but there's no explicit link. Review and confirm if this is the right trade.`
    }

    case 'unmatched':
      return `${row.direction.toUpperCase()} ${sym} was approved${approvedDate ? ` on ${approvedDate}` : ''} (${daysAgo}), but no matching position change has been found${portfolio} after 30 days. This trade may have been skipped, executed outside the system, or in a different portfolio. You can manually link it to a trade below.`

    case 'not_applicable':
      if (row.stage === 'rejected') {
        const moveNote = row.move_since_decision_pct != null
          ? ` Since then, ${sym} has moved ${row.move_since_decision_pct > 0 ? '+' : ''}${row.move_since_decision_pct.toFixed(1)}%.`
          : ''
        return `This ${row.direction} idea for ${sym} was rejected${approvedDate ? ` on ${approvedDate}` : ''}. No trade was made.${moveNote}`
      }
      return `This ${row.direction} idea for ${sym} was cancelled${approvedDate ? ` on ${approvedDate}` : ''} before a decision was reached. No trade was made.`

    default:
      return ''
  }
}

function ExecStatusPill({ status, interactive = false, row }: {
  status: ExecutionMatchStatus
  interactive?: boolean
  row?: AccountabilityRow
}) {
  const [showTip, setShowTip] = useState(false)
  const cfg = EXEC_STATUS_CONFIG[status]

  // For not_applicable, show the actual reason instead of generic "No trade"
  let displayLabel = cfg.label
  let displayColor = cfg.color
  let displayBg = cfg.bgColor
  if (status === 'not_applicable' && row) {
    if (row.stage === 'rejected') {
      displayLabel = 'Not traded'
      displayColor = 'text-gray-500'
      displayBg = 'bg-gray-100'
    } else if (row.stage === 'cancelled') {
      displayLabel = 'Withdrawn'
      displayColor = 'text-gray-400'
      displayBg = 'bg-gray-50'
    }
  }

  if (!interactive) {
    return (
      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded ${displayColor} ${displayBg}`}>
        {displayLabel}
      </span>
    )
  }

  const explanation = row ? getExecStatusExplanation(row) : ''

  return (
    <span className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setShowTip(!showTip) }}
        className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded cursor-pointer hover:ring-1 hover:ring-gray-300 transition-shadow ${displayColor} ${displayBg}`}
      >
        {displayLabel}
      </button>
      {showTip && explanation && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowTip(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
            <div className="flex items-start gap-2">
              <cfg.icon className={`w-4 h-4 mt-0.5 shrink-0 ${displayColor}`} />
              <div>
                <p className="text-[11px] font-semibold text-gray-900 mb-1">{displayLabel}</p>
                <p className="text-[10px] text-gray-500 leading-relaxed">{explanation}</p>
              </div>
            </div>
          </div>
        </>
      )}
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
  const reviewState = getRowReviewState(row)

  // Determine unselected border + bg, then brighten the border when selected
  let unselectedBorder: string
  let unselectedBg: string
  if (row.source === 'discretionary') {
    unselectedBorder = 'border-l-violet-300'
    unselectedBg = `${isEven ? 'bg-violet-50/15' : 'bg-violet-50/8'} hover:bg-violet-50/25`
  } else if (reviewState === 'needs_review') {
    unselectedBorder = 'border-l-red-400'
    unselectedBg = `${isEven ? 'bg-red-50/20' : 'bg-red-50/10'} hover:bg-red-50/30`
  } else if (reviewState === 'in_progress') {
    unselectedBorder = 'border-l-amber-400'
    unselectedBg = `${isEven ? 'bg-amber-50/15' : 'bg-amber-50/8'} hover:bg-amber-50/25`
  } else if (row.execution_status === 'unmatched') {
    unselectedBorder = 'border-l-red-300'
    unselectedBg = `${isEven ? 'bg-red-50/15' : 'bg-red-50/8'} hover:bg-red-50/30`
  } else if (row.execution_status === 'pending') {
    unselectedBorder = 'border-l-amber-300'
    unselectedBg = `${isEven ? 'bg-amber-50/10' : 'bg-amber-50/5'} hover:bg-amber-50/20`
  } else {
    unselectedBorder = 'border-l-transparent'
    unselectedBg = `${isEven ? 'bg-white' : 'bg-gray-50/40'} hover:bg-gray-50`
  }

  // Selected: widen the border and intensify the color
  const selectedBorderMap: Record<string, string> = {
    'border-l-violet-300': 'border-l-violet-500',
    'border-l-red-400': 'border-l-red-500',
    'border-l-red-300': 'border-l-red-400',
    'border-l-amber-400': 'border-l-yellow-500',
    'border-l-amber-300': 'border-l-yellow-500',
    'border-l-transparent': 'border-l-gray-400',
  }

  const borderClass = isSelected
    ? `bg-gray-50/80 border-l-[4px] ${selectedBorderMap[unselectedBorder] || 'border-l-gray-400'}`
    : `border-l-[3px] ${unselectedBorder} ${unselectedBg}`

  // Lag display value
  const lagValue = row.execution_lag_days !== null && row.execution_lag_days >= 0
    ? row.execution_lag_days
    : row.days_since_decision !== null && row.execution_status === 'pending'
      ? row.days_since_decision
      : null
  const lagWarn = lagValue !== null && (
    (row.execution_status === 'pending' && lagValue > 14) ||
    (row.execution_status !== 'pending' && lagValue > 7)
  )

  return (
    <div
      onClick={onSelect}
      className={`grid ${MAIN_GRID} cursor-pointer transition-colors border-b border-gray-100 ${borderClass}`}
    >
      {/* Date */}
      <div className="px-2 py-2 flex items-center">
        <span className="text-[11px] text-gray-500 tabular-nums">
          {row.approved_at ? format(new Date(row.approved_at), 'MMM d') : format(new Date(row.created_at), 'MMM d')}
        </span>
      </div>

      {/* Symbol */}
      <div className="px-2 py-2 flex items-center">
        <span className="text-[12px] font-semibold text-gray-900">{row.asset_symbol || '?'}</span>
      </div>

      {/* Name */}
      <div className="px-2 py-2 flex items-center min-w-0">
        <span className="text-[11px] text-gray-400 truncate">{row.asset_name || ''}</span>
      </div>

      {/* Type */}
      <div className="px-2 py-2 flex items-center">
        <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded ${dirCfg.color} ${dirCfg.bgColor}`}>
          {row.direction}
        </span>
      </div>

      {/* Decision */}
      <div className="px-2 py-2 flex items-center">
        {row.source === 'discretionary' ? (
          <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded text-violet-700 bg-violet-50">
            Ad hoc
          </span>
        ) : (
          <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded ${stageCfg.color} ${stageCfg.bgColor}`}>
            {stageCfg.label}
          </span>
        )}
      </div>

      {/* Execution */}
      <div className="px-2 py-2 flex items-center">
        <ExecStatusPill status={row.execution_status} interactive row={row} />
      </div>

      {/* Lag */}
      <div className="px-2 py-2 flex items-center justify-end">
        {lagValue !== null ? (
          <span className={`text-[11px] tabular-nums ${lagWarn ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
            {lagValue}d
          </span>
        ) : (
          <span className="text-[11px] text-gray-300">{'\u2014'}</span>
        )}
      </div>

      {/* Review */}
      <div className="px-2 py-2 flex items-center">
        {reviewState === 'reviewed' ? (
          <span className="inline-flex items-center text-[9px] font-medium text-blue-600 px-1.5 py-0.5 rounded-full bg-blue-50" title="Reviewed">
            <CheckCircle2 className="w-3 h-3" />
          </span>
        ) : reviewState === 'captured' ? (
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Captured" />
        ) : reviewState === 'in_progress' ? (
          <button
            onClick={e => { e.stopPropagation(); onSelect() }}
            className="text-[9px] font-semibold text-amber-700 hover:text-amber-800 px-1.5 py-[3px] rounded bg-amber-50 hover:bg-amber-100 transition-colors leading-none"
            title="Continue draft review"
          >
            Draft
          </button>
        ) : reviewState === 'needs_review' ? (
          <button
            onClick={e => { e.stopPropagation(); onSelect() }}
            className="text-[9px] font-semibold text-red-600 hover:text-red-700 px-1.5 py-[3px] rounded bg-red-50 hover:bg-red-100 transition-colors leading-none"
            title="Start post-mortem review"
          >
            Review
          </button>
        ) : null}
      </div>

      {/* Portfolio */}
      <div className="px-2 py-2 flex items-center min-w-0">
        <span className="text-[11px] text-gray-400 truncate">{row.portfolio_name || '\u2014'}</span>
      </div>

      {/* Owner */}
      <div className="px-2 py-2 flex items-center min-w-0">
        <span className="text-[11px] text-gray-400 truncate">{row.owner_name || '\u2014'}</span>
      </div>
    </div>
  )
}

// ============================================================
// Detail Panel
// ============================================================

/** Collapsible section for the Decision Story */
function StorySection({ icon: Icon, title, children, defaultOpen = true, badge, accentBorder }: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: React.ReactNode
  accentBorder?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`border-b border-gray-100 dark:border-gray-800 ${accentBorder ? `border-l-2 ${accentBorder}` : ''}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center gap-2 hover:bg-gray-50/50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
        <Icon className="w-4 h-4 text-gray-400" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex-1">{title}</span>
        {badge}
      </button>
      {open && <div className="px-4 pb-3.5">{children}</div>}
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

// Primary prompts — always visible, the core of the retrospective
const PM_PRIMARY: Array<{ key: string; label: string; placeholder: string; rows?: number }> = [
  { key: 'reason_for_action', label: 'Outcome Assessment', placeholder: 'What happened? How did this trade perform?', rows: 3 },
  { key: 'thesis_context', label: 'Thesis vs Reality', placeholder: 'Was the thesis correct? What played out differently?', rows: 2 },
  { key: 'what_changed', label: 'What Changed', placeholder: 'What shifted between the decision and the outcome?', rows: 2 },
  { key: 'risk_context', label: 'Lessons Learned', placeholder: 'Key takeaway. What to repeat or avoid.', rows: 2 },
]

// Secondary prompts — available but collapsed by default for deeper reflection
const PM_SECONDARY: Array<{ key: string; label: string; placeholder: string; rows?: number }> = [
  { key: 'sizing_logic', label: 'Sizing Reflection', placeholder: 'Was the size appropriate?', rows: 2 },
  { key: 'execution_context', label: 'Execution Reflection', placeholder: 'Timing, fills, process issues?', rows: 2 },
  { key: 'why_now', label: 'What Was Right', placeholder: 'What to repeat?', rows: 2 },
  { key: 'catalyst_trigger', label: 'What Was Wrong', placeholder: 'What to avoid?', rows: 2 },
]

const PM_ALL_FIELDS = [...PM_PRIMARY, ...PM_SECONDARY]

function PostMortemSection({ story, row, executionEventId }: {
  story: import('../hooks/useDecisionAccountability').DecisionStory | null | undefined
  row: AccountabilityRow
  executionEventId: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [diverged, setDiverged] = useState(false)
  const [divergeExplanation, setDivergeExplanation] = useState('')

  const saveM = useSavePostMortem(row.decision_id, executionEventId)
  const markReviewedM = useMarkAsReviewed(row.decision_id, executionEventId)
  const existing = story?.executionRationale

  const startEdit = () => {
    const init: Record<string, string> = {}
    if (existing) {
      PM_ALL_FIELDS.forEach(f => { init[f.key] = (existing as any)[f.key] || '' })
    }
    setDraft(init)
    setDiverged(existing?.divergence_from_plan ?? false)
    setDivergeExplanation(existing?.divergence_explanation || '')
    // Auto-expand "more" if secondary fields have content
    setShowMore(PM_SECONDARY.some(f => (existing as any)?.[f.key]))
    setEditing(true)
  }

  const handleSave = (status: 'draft' | 'complete') => {
    const params: any = {
      status,
      divergence_from_plan: diverged,
      divergence_explanation: diverged ? divergeExplanation : null,
    }
    PM_ALL_FIELDS.forEach(f => { params[f.key] = draft[f.key]?.trim() || null })
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
    <StorySection
      icon={Pencil}
      title="Post-Mortem"
      defaultOpen={reviewStatus === 'missing' || reviewStatus === 'draft' || editing}
      badge={statusBadge}
      accentBorder={reviewStatus === 'missing' ? 'border-l-red-300' : reviewStatus === 'draft' ? 'border-l-amber-300' : undefined}
    >
      {row.execution_status !== 'executed' ? (
        <EmptyField text="Available after execution" />
      ) : !executionEventId ? (
        <EmptyField text="No matched execution — review requires an execution record" />
      ) : editing ? (
        /* ── Edit Mode ── */
        <div className="space-y-2.5">
          {/* Primary prompts — always visible */}
          {PM_PRIMARY.map(f => (
            <div key={f.key}>
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">{f.label}</label>
              <textarea
                value={draft[f.key] || ''}
                onChange={e => setDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                rows={f.rows || 2}
                className="w-full text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 leading-relaxed resize-none"
              />
            </div>
          ))}

          {/* Secondary prompts — expandable */}
          <button
            onClick={() => setShowMore(!showMore)}
            className="flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            {showMore ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {showMore ? 'Less detail' : 'More detail'}
          </button>
          {showMore && (
            <div className="space-y-2.5 pl-1 border-l-2 border-gray-100 dark:border-gray-700 ml-1">
              {PM_SECONDARY.map(f => (
                <div key={f.key}>
                  <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">{f.label}</label>
                  <textarea
                    value={draft[f.key] || ''}
                    onChange={e => setDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    rows={f.rows || 2}
                    className="w-full text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 leading-relaxed resize-none"
                  />
                </div>
              ))}
              {/* Divergence */}
              <div className="flex items-start gap-2">
                <input type="checkbox" checked={diverged} onChange={e => setDiverged(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                <div className="flex-1">
                  <span className="text-[10px] font-medium text-gray-600">Diverged from plan</span>
                  {diverged && (
                    <textarea value={divergeExplanation} onChange={e => setDivergeExplanation(e.target.value)}
                      placeholder="How and why..." rows={2}
                      className="w-full mt-1 text-[11px] px-2.5 py-1.5 rounded-md border border-amber-200 bg-amber-50/50 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-500 leading-relaxed resize-none" />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={() => handleSave('complete')} disabled={saveM.isPending}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 shadow-sm transition-colors disabled:opacity-50">
              {saveM.isPending ? 'Saving...' : 'Save Review'}
            </button>
            <button onClick={() => handleSave('draft')} disabled={saveM.isPending}
              className="px-3 py-1.5 text-[11px] font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
              Save Draft
            </button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      ) : existing ? (
        /* ── View Mode (content exists) ── */
        <div>
          {/* Primary fields */}
          {PM_PRIMARY.map(f => {
            const val = (existing as any)[f.key]
            if (!val) return null
            return (
              <div key={f.key} className="mb-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{f.label}</div>
                <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{val}</p>
              </div>
            )
          })}
          {/* Secondary fields — only show if any have content */}
          {PM_SECONDARY.some(f => (existing as any)[f.key]) && (
            <>
              <div className="my-2 border-t border-gray-100" />
              {PM_SECONDARY.map(f => {
                const val = (existing as any)[f.key]
                if (!val) return null
                return (
                  <div key={f.key} className="mb-2">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{f.label}</div>
                    <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap">{val}</p>
                  </div>
                )
              })}
            </>
          )}
          {existing.divergence_from_plan && (
            <div className="mt-2 px-2.5 py-2 rounded bg-amber-50 border border-amber-200">
              <div className="text-[9px] font-semibold text-amber-700 mb-1">Diverged from plan</div>
              <p className="text-[11px] text-gray-700">{existing.divergence_explanation || 'No explanation provided'}</p>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px] text-gray-400">
              {existing.authored_by_name && <span>by {existing.authored_by_name}</span>}
              {reviewStatus === 'reviewed' && existing.reviewed_by_name && (
                <span>reviewed by {existing.reviewed_by_name}</span>
              )}
              <span className="capitalize">{existing.status}</span>
            </div>
            <div className="flex items-center gap-2">
              {reviewStatus === 'complete' && (
                <button
                  onClick={() => markReviewedM.mutate()}
                  disabled={markReviewedM.isPending}
                  className="flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:text-blue-700 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {markReviewedM.isPending ? 'Saving...' : 'Mark as Reviewed'}
                </button>
              )}
              <button
                onClick={startEdit}
                className="flex items-center gap-1 text-[10px] font-medium text-primary-600 hover:text-primary-700 transition-colors"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ── Empty State (no review yet) ── */
        <div className="rounded-md bg-red-50/40 border border-red-100 px-3 py-3">
          <p className="text-[11px] font-medium text-gray-700 mb-0.5">Post-mortem needed</p>
          <p className="text-[10px] text-gray-400 mb-2.5 leading-relaxed">
            Decision executed. Capture what happened and lessons learned.
          </p>
          <button
            onClick={startEdit}
            className="px-3 py-1.5 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 shadow-sm transition-colors"
          >
            Start Review
          </button>
        </div>
      )}
    </StorySection>
  )
}

function DetailPanel({
  row,
  onClose,
}: {
  row: AccountabilityRow
  onClose: () => void
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
      <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-[3px] rounded ${dirCfg.color} ${dirCfg.bgColor}`}>
            {row.direction}
          </span>
          <span className="text-[14px] font-semibold text-gray-900 truncate">{row.asset_symbol}</span>
          <span className="text-[12px] text-gray-400 truncate">{row.asset_name}</span>
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
        <StorySection icon={Lightbulb} title="Idea & Thesis" defaultOpen={false} badge={
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
        <StorySection icon={ArrowRight} title="Execution" badge={<ExecStatusPill status={row.execution_status} interactive row={row} />}>
          {row.execution_status === 'not_applicable' ? (
            <EmptyField text={row.stage === 'rejected'
              ? `This idea was rejected — no trade was made.${row.move_since_decision_pct != null ? ` The stock has moved ${row.move_since_decision_pct > 0 ? '+' : ''}${row.move_since_decision_pct.toFixed(1)}% since then.` : ''}`
              : 'This idea was cancelled before reaching a decision.'
            } />
          ) : row.matched_executions.length === 0 ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <ExecStatusPill status={row.execution_status} interactive row={row} />
                <p className="text-[11px] text-gray-500">
                  {row.execution_status === 'pending'
                    ? `Not executed${row.days_since_decision !== null ? ` \u00B7 ${row.days_since_decision}d since decision` : ''}`
                    : 'No matching execution found'}
                </p>
              </div>
              {/* Actions: match to trade or mark as skipped */}
              <div className="flex items-center gap-2">
                <ManualMatchPanel row={row} />
                <SkipDecisionButton decisionId={row.decision_id} />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {row.matched_executions.map(exec => (
                <ExecutionCard key={exec.event_id} exec={exec} decisionId={row.decision_id} />
              ))}
              {/* Allow matching additional trade events */}
              <ManualMatchPanel row={row} />
            </div>
          )}
        </StorySection>

        {/* ── 5. Did It Work? — unified outcome + position ── */}
        <OutcomeSection row={row} />

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

function ExecutionCard({ exec, decisionId }: { exec: MatchedExecution; decisionId?: string }) {
  const unlinkM = useUnlinkMatch()

  return (
    <div className="border border-gray-200 rounded p-2.5 bg-gray-50/50">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded bg-teal-50 text-teal-700">
            {exec.action_type}
          </span>
          <span className="text-[10px] text-gray-500">{format(new Date(exec.event_date), 'MMM d, yyyy')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[8px] font-medium uppercase tracking-wide px-1 py-[1px] rounded ${
            exec.match_method === 'explicit_link' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
          }`}>
            {exec.match_method === 'explicit_link' ? 'Linked' : 'Fuzzy'}
          </span>
          {exec.match_method === 'explicit_link' && decisionId && (
            <button
              onClick={() => unlinkM.mutate({ eventId: exec.event_id })}
              disabled={unlinkM.isPending}
              className="text-[9px] text-gray-400 hover:text-red-500 transition-colors"
              title="Unlink this match"
            >
              <Unlink className="w-3 h-3" />
            </button>
          )}
        </div>
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
// Manual Match Panel
// ============================================================

// ============================================================
// Outcome Section — unified "Result"
// ============================================================

const ACTION_SYMBOL: Record<string, { color: string; symbol: string }> = {
  buy: { color: '#22c55e', symbol: '▲' },
  add: { color: '#22c55e', symbol: '+' },
  sell: { color: '#ef4444', symbol: '▼' },
  trim: { color: '#ef4444', symbol: '−' },
  initiate: { color: '#22c55e', symbol: '▲' },
  exit: { color: '#ef4444', symbol: '▼' },
}
const getActionCfg = (a: string) => ACTION_SYMBOL[a] || { color: '#6b7280', symbol: '●' }

function OutcomeSection({ row }: { row: AccountabilityRow }) {
  const hasExecution = row.execution_status === 'executed' || row.execution_status === 'possible_match'
  const isPending = row.execution_status === 'pending' || row.execution_status === 'unmatched'
  const isNotApplicable = row.execution_status === 'not_applicable'

  const { data: lifecycle, isLoading: lcLoading } = usePositionLifecycle({
    assetId: row.asset_id,
    portfolioId: row.portfolio_id,
  })

  const pnlColor = (v: number | null) => v == null ? 'text-gray-400' : v >= 0 ? 'text-emerald-600' : 'text-red-600'
  const fmtDollar = (v: number | null) => {
    if (v == null) return '—'
    const sign = v >= 0 ? '+' : '-'
    return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
  const fmtPct = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  // Determine the directional move for badge
  const isBullish = row.direction === 'buy' || row.direction === 'add' || row.direction === 'long'
  const rawMove = row.move_since_decision_pct
  // Directionalize: for a buy, positive stock move = positive; for a sell, negative stock move = positive
  const directionalMove = rawMove != null ? (isBullish ? rawMove : -rawMove) : null

  // Badge
  const badgeValue = lifecycle?.totalReturnPct ?? directionalMove
  const badgeLabel = lifecycle?.totalReturnPct != null ? fmtPct(lifecycle.totalReturnPct)
    : directionalMove != null ? fmtPct(directionalMove)
    : null

  // ── Not applicable (rejected/cancelled) ──
  if (isNotApplicable) {
    return (
      <StorySection icon={TrendingUp} title="Result" defaultOpen badge={
        rawMove != null ? (
          <span className={`text-[8px] font-bold uppercase px-1.5 py-[2px] rounded ${
            directionalMove != null && directionalMove >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
          }`}>{fmtPct(rawMove)} since</span>
        ) : undefined
      }>
        <div className="space-y-2.5">
          <p className="text-[11px] text-gray-500">
            {row.stage === 'rejected'
              ? 'This idea was rejected — no trade was made.'
              : 'This idea was cancelled before a decision was reached.'}
          </p>

          {rawMove != null && (
            <div className="space-y-1">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">What would have happened</div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-600">{row.asset_symbol} moved</span>
                <span className={`text-[12px] font-bold tabular-nums ${pnlColor(rawMove)}`}>{fmtPct(rawMove)}</span>
              </div>
              <p className="text-[9px] text-gray-400">
                {directionalMove != null && directionalMove > 0.5
                  ? row.stage === 'rejected'
                    ? `The ${row.direction} would have been the right call.`
                    : 'This would have worked in your favor.'
                  : directionalMove != null && directionalMove < -0.5
                    ? row.stage === 'rejected'
                      ? 'Rejecting this was the right call.'
                      : 'Cancelling avoided a loss.'
                    : 'Minimal movement — no material impact either way.'}
              </p>
            </div>
          )}

        </div>
      </StorySection>
    )
  }

  // ── Pending / Unmatched — approved but no trade yet ──
  if (isPending) {
    return (
      <StorySection icon={TrendingUp} title="Result" defaultOpen badge={
        rawMove != null ? (
          <span className={`text-[8px] font-bold uppercase px-1.5 py-[2px] rounded bg-amber-50 text-amber-700`}>
            {fmtPct(rawMove)} missed
          </span>
        ) : undefined
      }>
        <div className="space-y-2.5">
          {rawMove != null ? (
            <>
              <div className="space-y-1">
                <div className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Performance not captured</div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-600">{row.asset_symbol} has moved since decision</span>
                  <span className={`text-[12px] font-bold tabular-nums ${pnlColor(rawMove)}`}>{fmtPct(rawMove)}</span>
                </div>
                {row.decision_price != null && row.currentPrice != null && (
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span>${row.decision_price.toFixed(2)} at decision</span>
                    <span>→</span>
                    <span>${row.currentPrice.toFixed(2)} now</span>
                  </div>
                )}
              </div>

              <p className="text-[9px] text-gray-400">
                {directionalMove != null && directionalMove > 1
                  ? `This ${row.direction} was approved ${row.days_since_decision}d ago but hasn't been executed. The stock has moved ${fmtPct(rawMove)} — this return is not being captured.`
                  : directionalMove != null && directionalMove < -1
                    ? `This ${row.direction} was approved ${row.days_since_decision}d ago but hasn't been executed. The stock has moved against the thesis — delay may have saved the position.`
                    : `Approved ${row.days_since_decision}d ago, not yet executed. Minimal price movement so far.`}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-gray-500">
              Approved {row.days_since_decision}d ago — awaiting execution. No price data available to measure missed return.
            </p>
          )}

        </div>
      </StorySection>
    )
  }

  // ── Executed — has matched trade ──
  return (
    <StorySection icon={TrendingUp} title="Result" defaultOpen badge={
      badgeLabel ? (
        <span className={`text-[8px] font-bold uppercase px-1.5 py-[2px] rounded ${
          (badgeValue || 0) >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
        }`}>{badgeLabel}</span>
      ) : undefined
    }>
      {lcLoading ? (
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* This decision */}
          <div className="space-y-1">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">This Decision</div>
            <PriceJourney row={row} />
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {row.move_since_decision_pct !== null && (
                <DetailRow label="Since decision" value={
                  <span className={`text-[11px] font-semibold tabular-nums ${pnlColor(row.move_since_decision_pct)}`}>
                    {fmtPct(row.move_since_decision_pct)}
                  </span>
                } />
              )}
              {row.move_since_execution_pct !== null && (
                <DetailRow label="Since execution" value={
                  <span className={`text-[11px] font-semibold tabular-nums ${pnlColor(row.move_since_execution_pct)}`}>
                    {fmtPct(row.move_since_execution_pct)}
                  </span>
                } />
              )}
            </div>
            {row.result_direction && (
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[9px] font-bold uppercase px-1.5 py-[2px] rounded ${
                  row.result_direction === 'positive' ? 'text-emerald-700 bg-emerald-50' :
                  row.result_direction === 'negative' ? 'text-red-700 bg-red-50' :
                  'text-gray-500 bg-gray-100'
                }`}>{RESULT_CONFIG[row.result_direction].label}</span>
                {row.delay_cost_pct !== null && Math.abs(row.delay_cost_pct) > 0.1 && (
                  <span className={`text-[9px] tabular-nums ${row.delay_cost_pct > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                    {row.delay_cost_pct > 0 ? 'Delay cost' : 'Delay saved'} {formatDelayCost(row.delay_cost_pct)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Position-level P&L */}
          {lifecycle && (lifecycle.realizedPnl != null || lifecycle.unrealizedPnl != null) && (
            <div className="space-y-1 border-t border-gray-100 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                  Position — {row.asset_symbol}
                </span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-[2px] rounded ${
                  lifecycle.isOpen ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                }`}>{lifecycle.isOpen ? 'Open' : 'Closed'}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {lifecycle.avgEntryPrice != null && (
                  <DetailRow label="Avg entry" value={`$${lifecycle.avgEntryPrice.toFixed(2)}`} />
                )}
                {lifecycle.currentPrice != null && (
                  <DetailRow label="Current" value={`$${lifecycle.currentPrice.toFixed(2)}`} />
                )}
                {lifecycle.currentShares > 0 && (
                  <DetailRow label="Shares" value={lifecycle.currentShares.toLocaleString()} />
                )}
                {lifecycle.holdingDays != null && (
                  <DetailRow label="Held" value={
                    lifecycle.holdingDays >= 365 ? `${(lifecycle.holdingDays / 365).toFixed(1)}y` : `${lifecycle.holdingDays}d`
                  } />
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-gray-100 pt-1 mt-1">
                {lifecycle.realizedPnl != null && (
                  <DetailRow label="Realized" value={
                    <span className={`text-[11px] font-semibold tabular-nums ${pnlColor(lifecycle.realizedPnl)}`}>
                      {fmtDollar(lifecycle.realizedPnl)}
                    </span>
                  } />
                )}
                {lifecycle.unrealizedPnl != null && (
                  <DetailRow label="Unrealized" value={
                    <span className={`text-[11px] font-semibold tabular-nums ${pnlColor(lifecycle.unrealizedPnl)}`}>
                      {fmtDollar(lifecycle.unrealizedPnl)}
                    </span>
                  } />
                )}
                {lifecycle.totalReturnPct != null && (
                  <DetailRow label="Total return" value={
                    <span className={`text-[11px] font-bold tabular-nums ${pnlColor(lifecycle.totalReturnPct)}`}>
                      {fmtPct(lifecycle.totalReturnPct)}
                    </span>
                  } />
                )}
                {lifecycle.annualizedReturnPct != null && (
                  <DetailRow label="Annualized" value={
                    <span className={`text-[11px] font-semibold tabular-nums ${pnlColor(lifecycle.annualizedReturnPct)}`}>
                      {fmtPct(lifecycle.annualizedReturnPct)}
                    </span>
                  } />
                )}
              </div>
            </div>
          )}

          {/* All decisions on this position */}
          {lifecycle && lifecycle.decisionScores.length > 1 && (
            <div className="space-y-1 border-t border-gray-100 pt-2">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                All Decisions on {row.asset_symbol}
              </div>
              {lifecycle.decisionScores.map(ds => {
                const cfg = getActionCfg(ds.action)
                const isThis = ds.decisionId === row.decision_id
                return (
                  <div key={ds.decisionId} className={`flex items-center justify-between text-[10px] py-0.5 px-1 rounded ${isThis ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold" style={{ color: cfg.color }}>{cfg.symbol}</span>
                      <span className="text-gray-600 capitalize">{ds.action}</span>
                      <span className="text-gray-400">@ ${ds.decisionPrice?.toFixed(2) || '—'}</span>
                      <span className="text-gray-300">{format(parseISO(ds.decisionDate), 'MMM d')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-semibold tabular-nums ${pnlColor(ds.movePct)}`}>
                        {ds.movePct != null ? fmtPct(ds.movePct) : '—'}
                      </span>
                      {ds.correct != null && (
                        <span className={`text-[8px] font-bold px-1 rounded ${
                          ds.correct ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                        }`}>{ds.correct ? '✓' : '✗'}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* No data */}
          {row.move_since_decision_pct === null && row.move_since_execution_pct === null && !lifecycle && (
            <EmptyField text="Outcome not yet measurable — no price data available" />
          )}
        </div>
      )}
    </StorySection>
  )
}

// ============================================================
// Bottom Chart Panel (shows below table when a row is selected)
// ============================================================

type PositionOverlay = 'none' | 'shares' | 'weight' | 'active_weight'

function BottomChartPanel({ row }: { row: AccountabilityRow }) {
  const [overlay, setOverlay] = useState<PositionOverlay>('shares')

  const { data: lifecycle, isLoading: lcLoading } = usePositionLifecycle({
    assetId: row.asset_id,
    portfolioId: row.portfolio_id,
  })
  const { data: priceHistory = [], isLoading: phLoading } = usePositionPriceHistory(row.asset_symbol)
  const { data: holdingsHistory = [] } = useHoldingsTimeSeries(row.portfolio_id, row.asset_symbol)

  const isLoading = lcLoading || phLoading
  const hasHoldings = holdingsHistory.length > 0

  return (
    <div className="shrink-0 border-t border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-[11px] font-semibold text-gray-700">
              {row.asset_symbol || 'Price'}
            </span>
            {row.portfolio_name && (
              <span className="text-[10px] text-gray-400">in {row.portfolio_name}</span>
            )}
          </div>

          {/* Position overlay toggle */}
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-200/60 rounded-md">
            {([
              { value: 'none' as PositionOverlay, label: 'Price Only' },
              { value: 'shares' as PositionOverlay, label: 'Shares' },
              { value: 'weight' as PositionOverlay, label: 'Weight' },
              { value: 'active_weight' as PositionOverlay, label: 'Active Wt' },
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => setOverlay(opt.value)}
                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                  overlay === opt.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {lifecycle && (
          <div className="flex items-center gap-3 text-[10px]">
            {lifecycle.avgEntryPrice != null && (
              <span className="text-gray-500">Entry <span className="font-medium text-gray-700">${lifecycle.avgEntryPrice.toFixed(2)}</span></span>
            )}
            {lifecycle.currentPrice != null && (
              <span className="text-gray-500">Now <span className="font-medium text-gray-700">${lifecycle.currentPrice.toFixed(2)}</span></span>
            )}
            {lifecycle.totalReturnPct != null && (
              <span className={`font-semibold ${lifecycle.totalReturnPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {lifecycle.totalReturnPct >= 0 ? '+' : ''}{lifecycle.totalReturnPct.toFixed(1)}%
              </span>
            )}
          </div>
        )}
      </div>
      <div className="px-2 py-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-[240px]">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
          </div>
        ) : priceHistory.length > 0 && lifecycle ? (
          <PositionChart
            lifecycle={lifecycle}
            priceHistory={priceHistory}
            holdingsHistory={hasHoldings && overlay !== 'none' ? holdingsHistory : undefined}
            overlayField={overlay !== 'none' ? overlay : undefined}
            height={240}
          />
        ) : (
          <div className="flex items-center justify-center h-[240px] text-[11px] text-gray-400">
            No price history available for {row.asset_symbol || 'this asset'}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Manual Match Panel
// ============================================================

// ============================================================
// Skip Decision Button (mark as intentionally not executed)
// ============================================================

function SkipDecisionButton({ decisionId }: { decisionId: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [reason, setReason] = useState('')
  const skipM = useMarkDecisionSkipped()

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
      >
        <XCircle className="w-3 h-3" />
        Mark as skipped
      </button>
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <div className="text-[11px] font-semibold text-gray-700 mb-2">Why was this not executed?</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {['Market moved away', 'Thesis changed', 'Risk limits', 'Sizing constraint', 'Superseded by another trade'].map(r => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
              reason === r
                ? 'border-gray-400 bg-gray-100 text-gray-900'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Or type a reason..."
        value={reason}
        onChange={e => setReason(e.target.value)}
        className="w-full text-[11px] border border-gray-200 rounded-md px-2.5 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-primary-400"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => { if (reason.trim()) skipM.mutate({ decisionId, reason: reason.trim() }) }}
          disabled={!reason.trim() || skipM.isPending}
          className="px-3 py-1 text-[11px] font-medium bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:opacity-40"
        >
          {skipM.isPending ? 'Saving...' : 'Confirm Skip'}
        </button>
        <button
          onClick={() => { setIsOpen(false); setReason('') }}
          className="px-3 py-1 text-[11px] text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Manual Match Panel
// ============================================================

function ManualMatchPanel({ row }: { row: AccountabilityRow }) {
  const [isOpen, setIsOpen] = useState(false)
  const { data: candidates = [], isLoading } = useCandidateTradeEvents(isOpen ? row : null)
  const matchM = useManualMatch()

  // Exclude already-matched events
  const matchedIds = new Set(row.matched_executions.map(m => m.event_id))
  const available = candidates.filter(c => !matchedIds.has(c.id))

  if (row.execution_status === 'not_applicable') return null

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-teal-600 transition-colors mt-1"
      >
        <Link2 className="w-3 h-3" />
        Match to trade
      </button>
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white mt-1">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-teal-600" />
          <span className="text-[11px] font-semibold text-gray-700">Match to a trade event</span>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-600" />
        </div>
      ) : available.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[11px] text-gray-400">No unlinked trade events found for {row.asset_symbol || 'this asset'}</p>
          <p className="text-[10px] text-gray-400 mt-1">Trade events are detected from portfolio holdings changes</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-auto">
          {available.map(evt => (
            <div
              key={evt.id}
              className="flex items-center justify-between p-2 rounded border border-gray-100 hover:border-teal-300 hover:bg-teal-50/30 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded bg-gray-100 text-gray-600 shrink-0">
                  {evt.action_type}
                </span>
                <span className="text-[10px] text-gray-500">{format(new Date(evt.event_date), 'MMM d, yyyy')}</span>
                {evt.quantity_delta != null && (
                  <span className={`text-[10px] font-medium ${evt.quantity_delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {evt.quantity_delta > 0 ? '+' : ''}{evt.quantity_delta.toLocaleString()} shs
                  </span>
                )}
                {evt.linked_trade_idea_id && (
                  <span className="text-[8px] text-amber-600 bg-amber-50 px-1 py-[1px] rounded">linked elsewhere</span>
                )}
              </div>
              <button
                onClick={() => matchM.mutate({ eventId: evt.id, decisionId: row.decision_id })}
                disabled={matchM.isPending || !!evt.linked_trade_idea_id}
                className="text-[10px] font-medium text-teal-600 hover:text-teal-700 disabled:text-gray-300 shrink-0 ml-2"
              >
                {matchM.isPending ? '...' : 'Link'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Main Page
// ============================================================

// ============================================================
// Scorecards View
// ============================================================

type ScorecardSection = 'analysts' | 'pms'

function ScorecardsView() {
  const [section, setSection] = useState<ScorecardSection>('analysts')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const access = useScorecardVisibility()
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers()

  const analysts = useMemo(() => teamMembers.filter(m => m.role === 'analyst'), [teamMembers])
  const pms = useMemo(() => teamMembers.filter(m => m.role === 'pm' || m.role === 'both'), [teamMembers])

  // Find current user in team
  const { user } = useAuth()
  const currentMember = teamMembers.find(m => m.userId === user?.id)

  if (access.isLoading || membersLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-5 max-w-7xl mx-auto">
        {/* Section Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => { setSection('analysts'); setSelectedUserId(null) }}
              className={`px-4 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                section === 'analysts'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Analyst Performance
            </button>
            <button
              onClick={() => { setSection('pms'); setSelectedUserId(null) }}
              className={`px-4 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                section === 'pms'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              PM Performance
            </button>
          </div>

          {/* Visibility indicator */}
          <div className="text-[10px] text-gray-400 flex items-center gap-1.5">
            {access.visibility === 'open' && 'Visible to all'}
            {access.visibility === 'role_scoped' && (
              access.currentUserRole === 'pm'
                ? 'Showing all analysts (PM view)'
                : 'Showing your scorecard only'
            )}
            {access.visibility === 'private' && 'Private — your scorecard only'}
          </div>
        </div>

        {/* ── Analyst Section ── */}
        {section === 'analysts' && (
          <>
            {selectedUserId ? (
              <div className="space-y-4">
                <button
                  onClick={() => setSelectedUserId(null)}
                  className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  ← Back to all
                </button>
                <AnalystScorecardCard userId={selectedUserId} />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Current user's own card always shown */}
                {currentMember && (
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Your Performance</div>
                    <AnalystScorecardCard
                      userId={currentMember.userId}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                    />
                  </div>
                )}

                {/* Team members — filtered by visibility */}
                {access.canViewLeaderboard && analysts.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Team ({analysts.length} analyst{analysts.length !== 1 ? 's' : ''})
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {analysts
                        .filter(a => a.userId !== user?.id) // exclude current user (shown above)
                        .map(a => (
                          <div key={a.userId} onClick={() => setSelectedUserId(a.userId)} className="cursor-pointer">
                            <AnalystScorecardCard
                              userId={a.userId}
                              compact
                              anonymize={access.anonymize}
                              className="hover:shadow-md transition-shadow"
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {!access.canViewLeaderboard && access.visibility !== 'open' && (
                  <div className="text-center py-8 text-gray-400">
                    <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">Team scorecards are visible to portfolio managers</p>
                    <p className="text-[10px] mt-1">Your individual scorecard is shown above</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── PM Section ── */}
        {section === 'pms' && (
          <>
            {selectedUserId ? (
              <div className="space-y-4">
                <button
                  onClick={() => setSelectedUserId(null)}
                  className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  ← Back to all
                </button>
                <PMScorecardCard userId={selectedUserId} />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Current user if they're a PM */}
                {currentMember && (currentMember.role === 'pm' || currentMember.role === 'both') && (
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Your PM Performance</div>
                    <PMScorecardCard userId={currentMember.userId} />
                  </div>
                )}

                {/* Other PMs — only visible if canViewLeaderboard or open */}
                {(access.canViewLeaderboard || access.visibility === 'open') && pms.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Portfolio Managers ({pms.length})
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {pms
                        .filter(pm => pm.userId !== user?.id)
                        .map(pm => (
                          <div key={pm.userId} onClick={() => setSelectedUserId(pm.userId)} className="cursor-pointer">
                            <PMScorecardCard
                              userId={pm.userId}
                              compact
                              className="hover:shadow-md transition-shadow"
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {pms.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <Briefcase className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">No portfolio managers found</p>
                    <p className="text-[10px] mt-1">PM performance tracks decisions made by portfolio managers</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Main Page
// ============================================================

export function DecisionAccountabilityPage({ onItemSelect }: DecisionAccountabilityPageProps) {
  const [activeTab, setActiveTab] = useState<OutcomesSubTab>('decisions')
  const [filters, setFilters] = useState<Partial<AccountabilityFilters>>({
    showApproved: true,
    showRejected: false,
    showCancelled: false,
    resultFilter: 'all',
    directionFilter: [],
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [showDiscretionaryOnly, setShowDiscretionaryOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'date' | 'lag'>('date')
  const [sortDesc, setSortDesc] = useState(true)

  const { rows, unmatchedExecutions, summary, isLoading, isError, refetch } = useDecisionAccountability({ filters })

  // Count decisions that need attention
  const pendingDecisionCount = useMemo(
    () => rows.filter(r => r.execution_status === 'pending').length,
    [rows]
  )
  const unmatchedDecisionCount = useMemo(
    () => rows.filter(r => r.execution_status === 'unmatched').length,
    [rows]
  )
  const needsPostMortemCount = useMemo(
    () => rows.filter(r => {
      if (r.execution_status !== 'executed') return false
      return !r.matched_executions.some(e => e.has_rationale)
    }).length,
    [rows]
  )
  const executedDecisionCount = useMemo(
    () => rows.filter(r => r.execution_status === 'executed' && r.source !== 'discretionary').length,
    [rows]
  )
  const discretionaryTradeCount = useMemo(
    () => rows.filter(r => r.source === 'discretionary').length,
    [rows]
  )

  // Sort rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
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

  const handleSort = (col: 'date' | 'lag') => {
    if (sortBy === col) {
      setSortDesc(!sortDesc)
    } else {
      setSortBy(col)
      setSortDesc(true)
    }
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 shrink-0">
        {/* Row 1: Title + Stats */}
        <div className="flex items-center justify-between pt-2 pb-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-teal-100 rounded-lg">
              <Target className="w-4 h-4 text-teal-600" />
            </div>
            <h1 className="text-lg font-semibold text-gray-900">Outcomes</h1>
          </div>

          {activeTab === 'decisions' && (() => {
            const noFilter = (!filters.executionStatus || filters.executionStatus.length === 0)
              && (filters.reviewFilter || 'all') === 'all'
              && !showDiscretionaryOnly
            const isActive = (key: string) => {
              if (key === 'all') return noFilter
              if (key === 'executed') return (filters.executionStatus || []).length === 1 && filters.executionStatus![0] === 'executed' && filters.reviewFilter !== 'needs_review'
              if (key === 'pending') return (filters.executionStatus || []).length === 1 && filters.executionStatus![0] === 'pending'
              if (key === 'unmatched') return (filters.executionStatus || []).length === 1 && filters.executionStatus![0] === 'unmatched'
              if (key === 'review') return filters.reviewFilter === 'needs_review'
              if (key === 'discretionary') return showDiscretionaryOnly
              return false
            }
            const clearAll = () => {
              setShowDiscretionaryOnly(false)
              setFilters({ ...filters, executionStatus: [], reviewFilter: 'all' })
            }
            const selectFilter = (key: string) => {
              if (isActive(key)) { clearAll(); return }
              setShowDiscretionaryOnly(key === 'discretionary')
              if (key === 'discretionary') {
                setFilters({ ...filters, executionStatus: [], reviewFilter: 'all' })
              } else if (key === 'review') {
                setFilters({ ...filters, executionStatus: ['executed'], reviewFilter: 'needs_review' })
              } else if (key === 'all') {
                clearAll()
              } else {
                setFilters({ ...filters, executionStatus: [key as ExecutionMatchStatus], reviewFilter: 'all' })
              }
            }

            const badges: { key: string; count: number; label: string; icon: typeof CheckCircle2; activeClass: string; defaultClass: string }[] = [
              { key: 'all', count: rows.length, label: 'all', icon: Target, activeClass: 'border-gray-400 bg-gray-100 text-gray-800', defaultClass: 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50' },
              { key: 'executed', count: executedDecisionCount, label: 'executed', icon: CheckCircle2, activeClass: 'border-emerald-300 bg-emerald-100 text-emerald-800', defaultClass: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
              { key: 'pending', count: pendingDecisionCount, label: 'pending', icon: Clock, activeClass: 'border-amber-300 bg-amber-100 text-amber-800', defaultClass: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' },
              { key: 'unmatched', count: unmatchedDecisionCount, label: 'unmatched', icon: AlertTriangle, activeClass: 'border-red-300 bg-red-100 text-red-800', defaultClass: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' },
              { key: 'review', count: needsPostMortemCount, label: 'need review', icon: Pencil, activeClass: 'border-blue-300 bg-blue-100 text-blue-800', defaultClass: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' },
              { key: 'discretionary', count: discretionaryTradeCount, label: 'discretionary', icon: Zap, activeClass: 'border-violet-300 bg-violet-100 text-violet-800', defaultClass: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100' },
            ]

            return (
              <div className="flex items-center gap-1.5">
                {badges.map(b => {
                  const active = isActive(b.key)
                  const Icon = b.icon
                  return (
                    <button
                      key={b.key}
                      onClick={() => selectFilter(b.key)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                        active ? b.activeClass : b.defaultClass
                      } ${b.count === 0 && b.key !== 'all' ? 'opacity-40' : ''}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {b.count} {b.label}
                    </button>
                  )
                })}
              </div>
            )
          })()}
        </div>

        {/* Row 2: Tabs + Filters on same line */}
        <div className="flex items-center gap-4 pb-2.5">
          {/* Tabs */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setActiveTab('decisions')}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${
                activeTab === 'decisions'
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              Decisions
            </button>
            <button
              onClick={() => setActiveTab('scorecards')}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${
                activeTab === 'scorecards'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              Scorecards
            </button>
          </div>

          {/* Filters inline — invisible (not removed) when on scorecards */}
          <div className={`flex items-center gap-4 ${activeTab !== 'decisions' ? 'invisible' : ''}`}>
            <div className="w-px h-5 bg-gray-200" />
            <FilterBar filters={filters} onChange={setFilters} />
          </div>
        </div>
      </div>

      {activeTab === 'scorecards' ? (
        <ScorecardsView />
      ) : (
      <>

      {/* ── CONTENT ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {showUnmatched ? (
          /* ── Discretionary Trades View ── */
          <div className="h-full flex flex-col border-t border-gray-200 overflow-hidden bg-white">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-violet-50/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-violet-600" />
                <span className="text-[12px] font-semibold text-gray-800">
                  Discretionary Trades
                </span>
                <span className="text-[10px] text-gray-400">
                  Position changes with no linked decision — add context
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
          /* ── Main Decision Table + Detail + Bottom Chart ── */
          <div className="h-full flex border-t border-gray-200 overflow-hidden">
            {/* Left: Table rows + chart below */}
            <div className="flex-1 min-w-0 flex flex-col bg-white">
              {/* Column headers */}
              <div className={`grid ${MAIN_GRID} bg-gray-50 border-b border-gray-200 shrink-0`}>
                <ColHeader sortable sortActive={sortBy === 'date'} sortDesc={sortDesc} onSort={() => handleSort('date')}>Date</ColHeader>
                <ColHeader>Symbol</ColHeader>
                <ColHeader>Name</ColHeader>
                <ColHeader>Type</ColHeader>
                <ColHeader>Decision</ColHeader>
                <ColHeader>Execution</ColHeader>
                <ColHeader sortable sortActive={sortBy === 'lag'} sortDesc={sortDesc} onSort={() => handleSort('lag')}>Lag</ColHeader>
                <ColHeader>Review</ColHeader>
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
                  (showDiscretionaryOnly ? sortedRows.filter(r => r.source === 'discretionary') : sortedRows).map((row, idx) => (
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

              {/* Bottom chart — below table, left of detail panel */}
              {selectedRow && (
                <BottomChartPanel row={selectedRow} />
              )}
            </div>

            {/* Detail Panel */}
            {selectedRow && (
              <div className="w-[440px] shrink-0 border-l-2 border-l-primary-500 overflow-hidden">
                <DetailPanel
                  row={selectedRow}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  )
}

// ============================================================
// Column headers
// ============================================================

function ColHeader({ children, align = 'left', sortable, sortActive, sortDesc, onSort }: {
  children: React.ReactNode
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  sortActive?: boolean
  sortDesc?: boolean
  onSort?: () => void
}) {
  return (
    <div
      onClick={sortable ? onSort : undefined}
      className={`px-2 py-2 ${sortable ? 'cursor-pointer' : ''} ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
      }`}
    >
      <span className={`text-[9px] font-bold uppercase tracking-wider select-none ${sortActive ? 'text-gray-700' : 'text-gray-400'}`}>
        {children}
        {sortActive && <span className="ml-0.5">{sortDesc ? '\u25BC' : '\u25B2'}</span>}
      </span>
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
      className={`px-2 py-2 cursor-pointer select-none ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
      }`}
    >
      <span className={`text-[9px] font-bold uppercase tracking-wider ${
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
