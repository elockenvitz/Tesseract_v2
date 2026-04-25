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

import React, { useState, useMemo, useEffect } from 'react'
import {
  Target, Search, ChevronDown, ChevronRight, Clock,
  CheckCircle2, TrendingUp, TrendingDown, Briefcase,
  AlertCircle, XCircle, X, FileText,
  ArrowRight, HelpCircle, AlertTriangle,
  DollarSign, Activity, ArrowUpRight, ArrowDownRight,
  Percent, Zap, Camera, Timer, Scale,
  Lightbulb, MessageSquare, BookOpen, Pencil, User,
  Award, Users, Link2, Unlink, Sparkles,
} from 'lucide-react'
import { format, subDays, parseISO } from 'date-fns'
import {
  useDecisionAccountability,
  useDecisionStory,
  usePortfoliosForFilter,
  useUsersForFilter,
  useCandidateTradeEvents,
  useManualMatch,
  useUnlinkMatch,
  useMarkDecisionSkipped,
  useDecisionReflections,
  useAddReflection,
  useAddThesis,
} from '../hooks/useDecisionAccountability'
import {
  useDecisionReview,
  useDecisionReviewsByIds,
  useUpsertDecisionReview,
  type ThesisOutcome,
} from '../hooks/useDecisionReview'
import type { CandidateTradeEvent, Reflection } from '../hooks/useDecisionAccountability'
import { PositionChart } from '../components/outcomes/PositionChart'
import {
  inferDecisionIntelligence, buildProcessHealth, buildSmartChips,
  VERDICT_DISPLAY, VERDICT_EXPLANATIONS, HEALTH_DISPLAY,
  type DecisionIntelligence, type DecisionVerdict, type ProcessHealth, type SmartChip, type ProcessFlowStage,
} from '../lib/decision-intelligence'
import {
  buildSystemInsight, buildConsiderations, buildSuggestedActions, buildAssessment, buildStateSummary,
  magnitudeTier,
  type InsightTone, type SuggestedAction, type AssessmentLabel,
} from '../lib/decision-insights'
import { usePositionLifecycle, usePositionPriceHistory, useHoldingsTimeSeries } from '../hooks/usePositionLifecycle'
import { AnalystScorecardsView, PMScorecardsView } from '../components/outcomes/ScorecardViews'
import { useAuth } from '../hooks/useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { PilotOutcomesGetStarted } from '../components/pilot/PilotOutcomesGetStarted'
import { usePilotMode } from '../hooks/usePilotMode'
import { usePilotProgress } from '../hooks/usePilotProgress'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
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

// Dynamic grid — with or without Portfolio column
// Uses minmax + fr to fill the full screen width
const GRID_WITH_PORTFOLIO = 'grid-cols-[110px_50px_60px_72px_minmax(100px,1fr)_minmax(80px,0.8fr)_minmax(120px,1.5fr)_84px_64px_minmax(100px,1.2fr)_100px_64px]'
const GRID_WITHOUT_PORTFOLIO = 'grid-cols-[110px_50px_60px_76px_minmax(120px,1.2fr)_minmax(140px,1.8fr)_84px_64px_minmax(120px,1.5fr)_108px_64px]'

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
// Decision Table Row (mini scorecard)
// ============================================================

function DecisionRow({
  row,
  intel,
  isSelected,
  onSelect,
  gridClass,
  showPortfolio,
}: {
  row: AccountabilityRow
  intel: DecisionIntelligence
  isSelected: boolean
  onSelect: () => void
  gridClass: string
  showPortfolio: boolean
}) {
  const vd = VERDICT_DISPLAY[intel.verdict]
  const dirCfg = DIRECTION_CONFIG[row.direction] || { color: 'text-gray-600', bgColor: 'bg-gray-100' }

  // Selected rows get a strong primary-tinted treatment so the user
  // can scan back to the row that's driving the right pane without
  // re-finding it. Unselected rows keep urgency-based left-border
  // tinting so red-flag rows still stand out.
  const borderClass = isSelected
    ? 'bg-primary-50 border-l-[4px] border-l-primary-500 ring-1 ring-primary-200 shadow-sm'
    : intel.urgency === 'critical'
      ? `border-l-[4px] ${vd.borderColor} bg-red-50/60 hover:bg-red-50/80`
      : intel.urgency === 'high'
        ? `border-l-[3px] ${vd.borderColor} bg-amber-50/30 hover:bg-amber-50/50`
        : intel.urgency === 'medium'
          ? `border-l-[2px] ${vd.borderColor} hover:bg-gray-50/60`
          : `border-l-[2px] border-l-transparent hover:bg-gray-50/30`

  // Age label with escalation
  const ageDays = intel.ageDays ?? 0
  // Always surface the age, even at 0 days, so the PM can tell fresh
  // decisions apart from ones that simply don't have an age signal.
  // Zero reads as "today" rather than a bare "0d" which looks like
  // an empty-state glitch.
  const ageLabel = ageDays <= 0 ? 'today' : `${ageDays}d`
  const ageIntensity = ageDays >= 30 ? 'text-red-700 font-black' : ageDays >= 21 ? 'text-red-600 font-bold' : ageDays >= 14 ? 'text-amber-600 font-bold' : ageDays >= 7 ? 'text-amber-500' : 'text-gray-400'

  return (
    <div
      onClick={onSelect}
      className={`grid ${gridClass} cursor-pointer transition-colors border-b border-gray-100/80 ${borderClass}`}
    >
      {/* State badge — prefer the per-row `verdictLabel` when present so
          the engine can disambiguate overloaded verdicts (e.g.
          "Executed" vs "Working" both live under verdict='working'
          depending on whether there's a directional signal). */}
      <div className="px-2 py-2 flex items-center">
        <span
          className={`text-[9px] font-bold uppercase tracking-wide px-2 py-[3px] rounded whitespace-nowrap cursor-help ${vd.color} ${vd.bgColor}`}
          title={VERDICT_EXPLANATIONS[intel.verdict]}
        >
          {intel.verdictLabel || vd.label}
        </span>
      </div>

      {/* Age */}
      <div className="py-2 flex items-center">
        {ageLabel ? (
          <span className={`text-[9px] tabular-nums ${ageIntensity}`}>
            {ageLabel}
          </span>
        ) : (
          <span className="text-[9px] text-gray-300">—</span>
        )}
      </div>

      {/* Type (direction) */}
      <div className="px-1 py-2 flex items-center">
        <span className={`text-[9px] font-bold uppercase px-1.5 py-[2px] rounded ${dirCfg.color} ${dirCfg.bgColor}`}>
          {row.direction}
        </span>
      </div>

      {/* Ticker */}
      <div className="px-1 py-2 flex items-center">
        <span className="text-[12px] font-semibold text-gray-900">{row.asset_symbol || '?'}</span>
      </div>

      {/* Name */}
      <div className="px-1 py-2 flex items-center min-w-0">
        <span className="text-[10px] text-gray-400 truncate">{row.asset_name || ''}</span>
      </div>

      {/* Portfolio — only when viewing all */}
      {showPortfolio && (
        <div className="px-1 py-2 flex items-center min-w-0">
          <span className="text-[10px] text-gray-400 truncate">{row.portfolio_name || '—'}</span>
        </div>
      )}

      {/* Insight column — primaryIssue takes priority for flagged rows
          (so red-flag rationale still leads). For executed rows
          without an issue, the system insight headlines the cell.
          A small colour-coded dot precedes the text so the row's
          tone reads at a glance even before the words register:
          green = positive, red = negative, slate = neutral. */}
      <div className="px-1 py-2 flex items-center gap-1.5 min-w-0">
        {intel.primaryIssue ? (
          <>
            <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${
              intel.urgency === 'critical' ? 'bg-red-500'
              : intel.urgency === 'high' ? 'bg-amber-500'
              : 'bg-gray-300'
            }`} />
            <span
              className={`text-[10px] font-medium truncate ${
                intel.urgency === 'critical' ? 'text-red-600'
                : intel.urgency === 'high' ? 'text-amber-700'
                : 'text-gray-600'
              }`}
              title={intel.primaryIssue}
            >
              {intel.primaryIssue}
            </span>
          </>
        ) : row.execution_status === 'executed' ? (
          (() => {
            const insight = buildSystemInsight(row)
            const dotClass =
              insight.tone === 'positive' ? 'bg-emerald-500'
              : insight.tone === 'negative' ? 'bg-red-500'
              : 'bg-gray-300'
            const textClass =
              insight.tone === 'positive' ? 'text-emerald-700'
              : insight.tone === 'negative' ? 'text-red-600'
              : 'text-gray-500'
            return (
              <>
                <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${dotClass}`} />
                <span className={`text-[10px] font-medium truncate ${textClass}`} title={insight.text}>
                  {insight.text}
                </span>
              </>
            )
          })()
        ) : (
          <span className="text-[10px] text-gray-300">—</span>
        )}
      </div>

      {/* P&L (dollars) — split out from the prior combined Result column
          so cash impact has its own home and a PM can sort/scan by
          dollars without parsing a "+5.2% · +$1.2K" composite. */}
      <div className="pl-1 pr-2 py-2 flex items-center justify-end">
        {intel.pnlLabel ? (
          <span className={`text-[11px] font-semibold tabular-nums ${
            intel.resultDirection === 'positive' ? 'text-emerald-600' :
            intel.resultDirection === 'negative' ? 'text-red-600' :
            'text-gray-400'
          }`}>
            {intel.pnlLabel}
          </span>
        ) : (
          <span className="text-[10px] text-gray-300">—</span>
        )}
      </div>

      {/* Return (percent) */}
      <div className="pl-1 pr-2 py-2 flex items-center justify-end">
        {intel.returnLabel ? (
          <span className={`text-[11px] font-semibold tabular-nums ${
            intel.resultDirection === 'positive' ? 'text-emerald-600' :
            intel.resultDirection === 'negative' ? 'text-red-600' :
            'text-gray-400'
          }`}>
            {intel.returnLabel}
          </span>
        ) : (
          <span className="text-[10px] text-gray-300">—</span>
        )}
      </div>

      {/* Action cue */}
      <div className="px-1 py-2 flex items-center">
        {intel.actionNeeded ? (
          <span className={`text-[9px] font-semibold px-1.5 py-[3px] rounded ${
            intel.urgency === 'critical' ? 'text-red-700 bg-red-100 border border-red-200' :
            intel.urgency === 'high' ? 'text-amber-700 bg-amber-50 border border-amber-200' :
            'text-gray-600 bg-gray-100'
          }`}>
            {intel.actionNeeded}
          </span>
        ) : (
          <span className="text-[9px] text-gray-300">—</span>
        )}
      </div>

      {/* Owner */}
      <div className="px-1 py-2 flex items-center min-w-0">
        <span className="text-[10px] text-gray-400 truncate">{row.owner_name || '—'}</span>
      </div>

      {/* Date */}
      <div className="px-1 py-2 flex items-center">
        <span className="text-[9px] text-gray-400 tabular-nums">
          {row.approved_at ? format(new Date(row.approved_at), 'M/d/yy') : format(new Date(row.created_at), 'M/d/yy')}
        </span>
      </div>
    </div>
  )
}

// ============================================================
// Detail Panel
// ============================================================

/** Collapsible section for the Decision Story. Defaults to COLLAPSED
 *  so a freshly-opened detail pane shows a compact, scannable outline.
 *  When a section is missing info that the PM should act on (e.g. no
 *  rationale, no reflection) pass `needsAttention` — the header shows
 *  an amber dot + "Needs info" micro-label so the section surfaces
 *  itself without forcing every panel open by default. */
function StorySection({ icon: Icon, title, children, defaultOpen = false, badge, accentBorder, needsAttention, sectionId }: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: React.ReactNode
  accentBorder?: string
  needsAttention?: boolean
  /** Stable id used by the `outcomes:open-section` CustomEvent so the
   *  Primary Next-Action CTA can route the click into a specific
   *  collapsed section (open it + scroll into view). */
  sectionId?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const wrapperRef = React.useRef<HTMLDivElement>(null)

  // Listen for "open this specific section" events — fired by the
  // Primary CTA so a click on "Write initial reasoning" actually
  // expands the relevant section instead of feeling like a no-op.
  React.useEffect(() => {
    if (!sectionId) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.sectionId !== sectionId) return
      setOpen(true)
      requestAnimationFrame(() => {
        wrapperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
    window.addEventListener('outcomes:open-section', handler as EventListener)
    return () => window.removeEventListener('outcomes:open-section', handler as EventListener)
  }, [sectionId])

  return (
    <div
      ref={wrapperRef}
      data-section-id={sectionId}
      className={`border-b border-gray-100 dark:border-gray-800 ${accentBorder ? `border-l-2 ${accentBorder}` : ''}`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center gap-2 hover:bg-gray-50/50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
        <Icon className={`w-4 h-4 ${needsAttention ? 'text-amber-500' : 'text-gray-400'}`} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex-1">{title}</span>
        {needsAttention && (
          <span
            className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-[2px] rounded"
            title="This section is missing information you may want to add."
          >
            <span className="w-1 h-1 rounded-full bg-amber-500" />
            Needs info
          </span>
        )}
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

/** Inline composer for attaching a thesis to an idea after the fact.
 *  Shows a collapsed "+ Add thesis" button by default. Expanding reveals
 *  a direction selector (bull / bear / neutral), a rationale textarea,
 *  and a save button. Used to retrofit context onto discretionary trades
 *  where no thesis existed at commit time. */
function AddThesisForm({ decisionId }: { decisionId: string }) {
  const { user } = useAuth()
  const addThesis = useAddThesis()
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<'bull' | 'bear' | 'neutral'>('bull')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !!user && rationale.trim().length > 0 && !addThesis.isPending

  const handleSubmit = () => {
    if (!user) { setError('Sign in required'); return }
    if (!rationale.trim()) { setError('Add a rationale'); return }
    setError(null)
    addThesis.mutate(
      { decisionId, userId: user.id, direction, rationale: rationale.trim() },
      {
        onSuccess: () => { setRationale(''); setOpen(false) },
        onError: (e: any) => setError(e?.message || 'Failed to save thesis'),
      },
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-primary-600 hover:text-primary-700 transition-colors"
      >
        + Add thesis
      </button>
    )
  }

  const directions: Array<{ key: 'bull' | 'bear' | 'neutral'; label: string; cls: string }> = [
    { key: 'bull',    label: 'Bull',    cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
    { key: 'bear',    label: 'Bear',    cls: 'bg-red-100 text-red-700 border-red-300' },
    { key: 'neutral', label: 'Neutral', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  ]

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50/40 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        {directions.map(d => (
          <button
            key={d.key}
            onClick={() => setDirection(d.key)}
            className={`text-[9px] font-bold uppercase tracking-wider px-2 py-[3px] rounded border transition-colors ${
              direction === d.key
                ? d.cls
                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
            }`}
            type="button"
          >
            {d.label}
          </button>
        ))}
      </div>
      <textarea
        value={rationale}
        onChange={(e) => { setRationale(e.target.value); if (error) setError(null) }}
        rows={3}
        placeholder="Why this view? What drives the direction?"
        className="w-full px-2 py-1.5 rounded border border-gray-200 bg-white text-[11px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-300 resize-none"
        disabled={addThesis.isPending}
      />
      {error && (
        <p className="text-[10px] text-red-600">{error}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => { setOpen(false); setRationale(''); setError(null) }}
          className="text-[10px] text-gray-500 hover:text-gray-700"
          type="button"
          disabled={addThesis.isPending}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="text-[10px] font-semibold px-2.5 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40"
          type="button"
        >
          {addThesis.isPending ? 'Saving…' : 'Save thesis'}
        </button>
      </div>
    </div>
  )
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
// System-guided review surfaces.
//
// Replaces the previous manual-grading "Decision Quality" panel. Product
// principle: the system thinks, the user reacts. Tesseract observes
// what happened, suggests what to consider, and offers a light place
// for the PM to record their take — no Good/Mixed/Bad self-rating.
//
// Five components in this block:
//   - SystemInsightSection      → one-line interpretation of the outcome
//   - ConsiderationsSection     → 2–3 contextual prompts to think about
//   - YourReflectionSection     → minimal user input (thesis call + note)
//   - SuggestedActionsSection   → small CTAs (follow-up idea, prompt, etc.)
//
// All four sit between OutcomeSection and LessonsSection in DetailPanel.
// Persistence reuses `decision_reviews`: thesis_played_out + process_note.
// decision_quality and sizing_quality remain in the schema for future
// system-derived use but are no longer exposed as user inputs.
// =============================================================================

const TONE_RAIL: Record<InsightTone, { rail: string; bg: string; icon: string }> = {
  positive: { rail: 'border-l-emerald-400', bg: 'bg-emerald-50/40', icon: 'text-emerald-600' },
  negative: { rail: 'border-l-red-400',     bg: 'bg-red-50/40',     icon: 'text-red-600'     },
  neutral:  { rail: 'border-l-slate-300',   bg: 'bg-slate-50/40',   icon: 'text-slate-500'   },
}

/** Tone class lookup for the System Assessment badge. Keeps the
 *  pill colour tightly coupled to the assessment so green / red /
 *  slate signal at a glance which way the system reads the row. */
const ASSESSMENT_TONE: Record<AssessmentLabel, string> = {
  'Aligned with intent':     'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Conviction rewarded':     'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Risk reduced as planned': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Outcome diverged':        'bg-red-50 text-red-700 border-red-200',
  'Left upside on table':    'bg-red-50 text-red-700 border-red-200',
  'Potential timing issue':  'bg-amber-50 text-amber-700 border-amber-200',
  'Too early to assess':     'bg-slate-50 text-slate-600 border-slate-200',
}

/** System Insight banner — a compact, tone-coloured block used inside
 *  the Result section. Renders three things stacked:
 *    1. Observation (one sentence) — what happened.
 *    2. Conclusion (one sentence) — what the system thinks it means.
 *    3. Assessment badge — distilled 2–4 word verdict.
 *  The conclusion line is what gives the panel its "diagnostic" feel:
 *  the PM gets the system's takeaway, not just a description. */
function InsightBanner({ row }: { row: AccountabilityRow }) {
  const insight = useMemo(() => buildSystemInsight(row), [row])
  const assessment = useMemo(() => buildAssessment(row), [row])
  const tone = TONE_RAIL[insight.tone]
  return (
    <div className={`rounded-md border-l-2 ${tone.rail} ${tone.bg} px-2.5 py-2`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className={`w-3 h-3 ${tone.icon}`} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">System Insight</span>
      </div>
      <p className="text-[12px] leading-snug font-medium text-gray-800">{insight.text}</p>
      {insight.conclusion && (
        <p className="text-[11px] leading-snug text-gray-600 mt-1 flex gap-1">
          <span className="text-gray-400 flex-shrink-0">→</span>
          <span>{insight.conclusion}</span>
        </p>
      )}
      <div className="mt-1.5">
        <span
          className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded border ${ASSESSMENT_TONE[assessment]}`}
        >
          {assessment}
        </span>
      </div>
    </div>
  )
}

/** Things to Consider — 2–3 prompts tailored to action × result.
 *  Rendered as a quiet bulleted list, no card chrome, so it reads
 *  as a follow-up to the System Insight rail above rather than a
 *  separate section. */
function ConsiderationsSection({ row }: { row: AccountabilityRow }) {
  const items = useMemo(() => buildConsiderations(row), [row])
  if (items.length === 0) return null
  return (
    <div className="mx-4 mt-4 mb-1.5 px-2.5 pt-3 border-t border-gray-100">
      <div className="flex items-center gap-1.5 mb-1.5">
        <HelpCircle className="w-3 h-3 text-gray-400" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Things to consider</span>
      </div>
      <ul className="space-y-0.5">
        {items.map((q, i) => (
          <li key={i} className="text-[11px] leading-snug text-gray-600 flex gap-1.5">
            <span className="text-gray-300 mt-0.5">·</span>
            <span>{q}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "How did the thesis evolve?" — observational language, not
 *  grading. Schema values stay stable (yes / partial / no / unknown);
 *  only the user-facing labels change. */
const REFLECTION_THESIS_OPTIONS: Array<{ value: ThesisOutcome; label: string }> = [
  { value: 'yes', label: 'On track' },
  { value: 'partial', label: 'Partially on track' },
  { value: 'no', label: 'Off track' },
  { value: 'unknown', label: 'Too early' },
]

/** Your Reflection — the only user-input area. Two light fields:
 *  thesis-played-out (segmented) and a short reflection note. Both
 *  are optional; persisting any value flips the row's verdict to
 *  "Reviewed". */
function YourReflectionSection({ row, intel }: { row: AccountabilityRow; intel: DecisionIntelligence }) {
  const { user } = useAuth()
  const { data: review, isLoading } = useDecisionReview(row.decision_id)
  const upsert = useUpsertDecisionReview()

  const [draftNote, setDraftNote] = useState<string>('')
  const [noteDirty, setNoteDirty] = useState(false)

  React.useEffect(() => {
    setDraftNote(review?.process_note || '')
    setNoteDirty(false)
  }, [review?.process_note, row.decision_id])

  const hasReflected = !!review?.thesis_played_out || !!(review?.process_note || '').trim()
  // Surface the amber dot when the user hasn't reflected yet on a row
  // the engine flags as monitoring or needs_context.
  const needsReflection =
    !hasReflected && (intel.verdict === 'evaluate' || intel.verdict === 'needs_review' || intel.verdict === 'hurting')

  const persist = (patch: { thesis_played_out?: ThesisOutcome | null; process_note?: string | null }) => {
    if (!user?.id) return
    upsert.mutate({
      decisionId: row.decision_id,
      userId: user.id,
      patch: {
        decision_quality: review?.decision_quality ?? null,
        sizing_quality: review?.sizing_quality ?? null,
        thesis_played_out: patch.thesis_played_out !== undefined ? patch.thesis_played_out : (review?.thesis_played_out ?? null),
        process_note: patch.process_note !== undefined ? patch.process_note : (review?.process_note ?? null),
      },
    })
  }

  return (
    <StorySection
      icon={Pencil}
      title="Your Reflection"
      defaultOpen={false}
      needsAttention={needsReflection}
      badge={hasReflected ? (
        <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
          Reviewed
        </span>
      ) : undefined}
    >
      {isLoading ? (
        <p className="text-[10px] text-gray-300">Loading…</p>
      ) : (
        <div className="space-y-3">
          {/* Thesis evolution — single segmented row, four observational
              choices, auto-save on click. Frames the question as
              monitoring (how did things evolve?) rather than grading. */}
          <div className="space-y-1">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">How did the thesis evolve?</div>
            <div className="flex flex-wrap gap-1">
              {REFLECTION_THESIS_OPTIONS.map(opt => {
                const selected = review?.thesis_played_out === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={upsert.isPending}
                    onClick={() => persist({ thesis_played_out: opt.value })}
                    className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                      selected
                        ? 'border-primary-400 bg-primary-50 text-primary-700 ring-2 ring-primary-200'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    } ${upsert.isPending ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Reflection note — short textarea. Optional. */}
          <div className="space-y-1">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">Reflection note</div>
            <textarea
              value={draftNote}
              onChange={e => { setDraftNote(e.target.value); setNoteDirty(true) }}
              onBlur={() => {
                if (!noteDirty) return
                persist({ process_note: draftNote.trim() || null })
                setNoteDirty(false)
              }}
              rows={2}
              placeholder="Anything you'd want to remember about this decision…"
              className="w-full text-[11px] px-2 py-1.5 rounded border border-gray-200 bg-white text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-300 leading-relaxed resize-none"
            />
            {noteDirty && <p className="text-[9px] text-gray-400 italic">Saves on blur.</p>}
          </div>

          {upsert.isError && (
            <p className="text-[10px] text-red-600">Failed to save. {(upsert.error as any)?.message || ''}</p>
          )}
        </div>
      )}
    </StorySection>
  )
}

/** Map a SuggestedAction.key to the CustomEvent type the parent shell
 *  listens for. Keeping the mapping centralised so adding a new key
 *  in `decision-insights` is a one-spot change. */
const ACTION_EVENT: Record<SuggestedAction['key'], string> = {
  'create-followup': 'outcomes:create-followup-idea',
  'update-thesis':   'outcomes:update-thesis',
  'prompt-teammate': 'outcomes:prompt-from-outcome',
  'revisit-position': 'outcomes:revisit-position',
  'add-note':        'outcomes:add-note',
}

/** PrimaryNextActionCTA — the single highlighted "next move" button
 *  that lives in the always-visible primary block, directly under
 *  the System Insight. Pulls the first primary action from
 *  `buildSuggestedActions` so the PM sees one clear action without
 *  scanning the lifecycle. The fuller SuggestedActions list (with
 *  secondaries) still renders down in the tertiary block. */
/** Map a SuggestedAction.key to the section id the click should
 *  open as a fallback when no global listener is registered. Keeps
 *  the Primary CTA from feeling like a no-op even before downstream
 *  flows are wired. */
const ACTION_FALLBACK_SECTION: Partial<Record<SuggestedAction['key'], string>> = {
  'add-note': 'thesis',
  'update-thesis': 'thesis',
}

function PrimaryNextActionCTA({ row }: { row: AccountabilityRow }) {
  const actions = useMemo(() => buildSuggestedActions(row), [row])
  const primary = actions.find(a => a.primary) ?? actions[0]
  if (!primary) return null
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent(ACTION_EVENT[primary.key], {
      detail: {
        assetId: row.asset_id,
        assetSymbol: row.asset_symbol,
        sourceDecisionId: row.decision_id,
        label: primary.label,
      },
    }))
    // Fallback — open + scroll the most relevant collapsed section
    // so the click feels meaningful even when no downstream
    // listener is registered for the action's primary event.
    const sectionId = ACTION_FALLBACK_SECTION[primary.key]
    if (sectionId) {
      window.dispatchEvent(new CustomEvent('outcomes:open-section', {
        detail: { sectionId },
      }))
    }
  }
  return (
    <div className="px-4 pb-3">
      <button
        type="button"
        onClick={handleClick}
        className="w-full flex items-start gap-2 px-3 py-2 rounded-md border border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors text-left"
      >
        <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[8px] font-bold uppercase tracking-wider opacity-70 leading-tight">Next action</div>
          <div className="text-[12px] font-semibold leading-snug" title={primary.label}>
            {primary.label}
          </div>
        </div>
        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 opacity-70 mt-0.5" />
      </button>
    </div>
  )
}

/** Suggested next action — contextual CTAs sourced from
 *  `buildSuggestedActions(row)`. Labels are decision-specific
 *  ("Re-enter META on weakness", "Take partial gains on AAPL")
 *  instead of generic. Each click dispatches a CustomEvent on
 *  `window` so the dashboard shell can wire downstream flows. */
function SuggestedActionsSection({ row }: { row: AccountabilityRow }) {
  const actions = useMemo(() => buildSuggestedActions(row), [row])
  if (actions.length === 0) return null

  const fire = (a: SuggestedAction) => {
    window.dispatchEvent(new CustomEvent(ACTION_EVENT[a.key], {
      detail: {
        assetId: row.asset_id,
        assetSymbol: row.asset_symbol,
        sourceDecisionId: row.decision_id,
        label: a.label,
      },
    }))
  }

  return (
    <div className="mx-4 my-2 rounded-md border border-gray-100 bg-gray-50/50 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Zap className="w-3 h-3 text-primary-500" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Suggested next action</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            onClick={() => fire(a)}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded border transition-colors ${
              a.primary
                ? 'border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
            }`}
            title={a.label}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Lessons Section — unified outcome reflection for any decision.
// Replaces the old structured 8-field post-mortem with a simple narrative +
// reflection thread. Available on ALL decisions (acted and passed).
// =============================================================================

function LessonsSection({ row }: { row: AccountabilityRow }) {
  const { user } = useAuth()
  const { data, isLoading } = useDecisionReflections(row.decision_id)
  const addReflection = useAddReflection()
  const [draft, setDraft] = useState('')

  const reflections = data?.reflections || []
  const acceptedTradeId = data?.acceptedTradeId || null
  const decisionRequestId = data?.decisionRequestId || null
  const canAdd = !!(acceptedTradeId || decisionRequestId)
  const isPassed = row.category === 'passed'

  const handleSubmit = () => {
    if (!draft.trim() || !user?.id || !canAdd) return
    addReflection.mutate({
      acceptedTradeId,
      decisionRequestId,
      userId: user.id,
      content: draft.trim(),
    })
    setDraft('')
  }

  const placeholder = isPassed
    ? 'In hindsight, was passing the right call? What did you learn that would change the next decision?'
    : 'What did you learn? What should you do differently next time?'

  return (
    <StorySection
      icon={MessageSquare}
      title="What We Learned"
      defaultOpen={false}
      needsAttention={false}
      badge={reflections.length > 0 ? (
        <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600">{reflections.length}</span>
      ) : undefined}
    >
      {isLoading ? (
        <p className="text-[10px] text-gray-300">Loading...</p>
      ) : (
        <div className="space-y-2">
          {/* Existing reflections */}
          {reflections.length > 0 && (
            <div className="space-y-3">
              {reflections.map(r => (
                <div key={r.id} className="flex gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-3 h-3 text-indigo-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{r.content}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">
                      {r.user_name} &middot; {format(new Date(r.created_at), 'MMM d')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Decision note from rejection/deferral (for passed decisions) */}
          {isPassed && row.decision_note && reflections.length === 0 && (
            <div className="rounded-md bg-gray-50 border border-gray-100 px-3 py-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Decision note</div>
              <p className="text-[11px] text-gray-600 leading-relaxed">{row.decision_note}</p>
            </div>
          )}

          {/* Input */}
          {canAdd ? (
            <div className="pt-1">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
                placeholder={placeholder}
                rows={2}
                className="w-full text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 leading-relaxed resize-none"
              />
              {draft.trim() && (
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    onClick={handleSubmit}
                    disabled={addReflection.isPending}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {addReflection.isPending ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setDraft('')} className="text-[10px] text-gray-500 hover:text-gray-700">Cancel</button>
                  <span className="text-[9px] text-gray-300 ml-auto">Enter to save, Shift+Enter for new line</span>
                </div>
              )}
            </div>
          ) : reflections.length === 0 ? (
            <p className="text-[10px] text-gray-400 italic">
              {isPassed ? 'No linked decision record found.' : 'No learning captured yet.'}
            </p>
          ) : null}
        </div>
      )}
    </StorySection>
  )
}

/** Loop footer — small horizontal "Idea → Decision → Execution →
 *  Outcome" strip rendered at the bottom of the detail panel. The
 *  current row's stage is highlighted so the PM can see at a glance
 *  where this decision sits in the loop without parsing the full
 *  lifecycle stack above. Replaces the previous pilot-only italic
 *  hint with a structural cue everyone benefits from. */
function LoopFooter({ row }: { row: AccountabilityRow }) {
  // Map the row to a current loop stage. Outcome is "active" once
  // there's a result direction (positive / negative); if a reflection
  // exists we mark the loop ✓ to communicate "fully closed".
  const stages: Array<{ key: 'idea' | 'decision' | 'execution' | 'outcome'; label: string }> = [
    { key: 'idea',      label: 'Idea' },
    { key: 'decision',  label: 'Decision' },
    { key: 'execution', label: 'Execution' },
    { key: 'outcome',   label: 'Outcome' },
  ]

  let currentStage: 'idea' | 'decision' | 'execution' | 'outcome' = 'idea'
  if (row.stage === 'rejected') {
    currentStage = 'decision'
  } else if (row.execution_status === 'executed' || row.execution_status === 'possible_match') {
    currentStage = 'outcome'
  } else if (row.stage === 'approved') {
    currentStage = 'execution'
  } else if (row.rationale_text || row.stage) {
    currentStage = 'decision'
  }

  const closed =
    row.execution_status === 'executed' &&
    (row.result_direction === 'positive' || row.result_direction === 'negative')

  const stageIndex = stages.findIndex(s => s.key === currentStage)

  return (
    <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/40">
      <div className="flex items-center gap-1 text-[10px]">
        {stages.map((s, i) => {
          const passed = i < stageIndex
          const active = i === stageIndex
          return (
            <React.Fragment key={s.key}>
              <span
                className={`font-semibold ${
                  active ? 'text-gray-900' : passed ? 'text-gray-500' : 'text-gray-300'
                }`}
              >
                {s.label}
              </span>
              {i < stages.length - 1 && (
                <span className={passed || active ? 'text-gray-400' : 'text-gray-200'}>→</span>
              )}
            </React.Fragment>
          )
        })}
        {closed && <span className="text-emerald-600 font-bold ml-1">✓</span>}
      </div>
    </div>
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
  const baseIntel = inferDecisionIntelligence(row)

  // Read the user's reflection so the header verdict matches the
  // promoted state shown in the row — once a reflection is captured
  // (thesis call or note) the badge promotes "Monitoring" → "Reviewed"
  // without a refetch round-trip.
  const { data: review } = useDecisionReview(row.decision_id)
  const intel: DecisionIntelligence = useMemo(() => {
    const hasReflection = !!review?.thesis_played_out || !!(review?.process_note || '').trim()
    if (!hasReflection) return baseIntel
    if (baseIntel.verdict === 'evaluate' || baseIntel.verdict === 'working') {
      return { ...baseIntel, verdict: 'resolved', verdictLabel: 'Reviewed', actionNeeded: 'View review', urgency: 'none' }
    }
    if (baseIntel.verdict === 'hurting') {
      return { ...baseIntel, actionNeeded: 'View review', urgency: 'medium' }
    }
    return baseIntel
  }, [baseIntel, review?.thesis_played_out, review?.process_note])
  const vd = VERDICT_DISPLAY[intel.verdict]

  // Fetch the full decision story (theses, recommendation, acceptance, rationale, research)
  const firstExecId = row.matched_executions?.[0]?.event_id || null
  const { data: story, isLoading: storyLoading } = useDecisionStory(row.decision_id, firstExecId)

  // Header meta — computed once so the JSX stays clean. Age reads
  // "today" at 0 days rather than a glitchy "0d".
  const ageDays = intel.ageDays ?? 0
  const ageLabel = ageDays <= 0 ? 'today' : `${ageDays}d`
  const headerTone =
    intel.urgency === 'critical'
      ? 'border-red-300 bg-red-50/40'
      : intel.urgency === 'high'
        ? 'border-amber-200 bg-amber-50/30'
        : 'border-gray-200'
  const resultColor =
    intel.resultDirection === 'positive'
      ? 'text-emerald-600'
      : intel.resultDirection === 'negative'
        ? 'text-red-600'
        : 'text-gray-400'

  return (
    <div className="h-full flex flex-col bg-white">
      {/* ── Header: identity + verdict + result + action ─────────────
          Single dense block so the reader sees "what is this, how is
          it doing, what's next" without scanning through card chrome.
          Each element renders only when it carries information —
          blank fields don't reserve space. */}
      <div className={`px-4 pt-3 pb-3 border-b shrink-0 ${headerTone}`}>
        {/* Row 1 — identity + meta + result + close, all on one line.
            Age and portfolio now ride inline next to the asset name
            (separated by middle dots) instead of taking a second row
            that sat mostly empty when there was no result number. */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded flex-shrink-0 ${dirCfg.color} ${dirCfg.bgColor}`}>
              {row.direction}
            </span>
            <span className="text-[15px] font-semibold text-gray-900 truncate flex-shrink-0">{row.asset_symbol}</span>
            {row.asset_name && (
              <span className="text-[11px] text-gray-400 truncate min-w-0">{row.asset_name}</span>
            )}
            <span className="text-gray-300 text-[10px] flex-shrink-0">·</span>
            <span className="text-[10px] text-gray-500 whitespace-nowrap flex-shrink-0">{ageLabel}</span>
            {row.portfolio_name && (
              <>
                <span className="text-gray-300 text-[10px] flex-shrink-0">·</span>
                <span className="text-[10px] text-gray-500 truncate min-w-0">{row.portfolio_name}</span>
              </>
            )}
          </div>
          {intel.resultLabel && (
            <span className={`text-[17px] font-black tabular-nums ${resultColor} flex-shrink-0`}>
              {intel.resultLabel}
            </span>
          )}
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 flex-shrink-0"
            aria-label="Close detail"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Row 3 — STATE SUMMARY. Replaces the previous bare
            primaryIssue line with a stronger header block: an
            ALL-CAPS state category followed by one explanatory
            sentence covering why this matters and what to do next.
            Sourced from `buildStateSummary` so the copy varies by
            verdict + context (rationale presence, age, magnitude). */}
        {(() => {
          const summary = buildStateSummary(row, intel.verdict)
          return (
            <div className="mt-2.5 space-y-0.5">
              <div className={`text-[10px] font-black uppercase tracking-wider ${
                intel.urgency === 'critical' ? 'text-red-700'
                : intel.urgency === 'high' ? 'text-amber-700'
                : intel.verdict === 'resolved' ? 'text-emerald-700'
                : 'text-gray-500'
              }`}>
                {summary.category}
              </div>
              <p className={`text-[11px] leading-snug ${
                intel.urgency === 'critical' ? 'text-gray-900' : 'text-gray-600'
              }`}>
                {summary.explanation}
              </p>
            </div>
          )
        })()}

        {/* (Row 4 next-action chip removed — the highlighted Primary
            Next-Action CTA below the System Insight handles this so
            the header doesn't say "Add context" three times.) */}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ════════════════════════════════════════════════════════════
            PROGRESSIVE DISCLOSURE LAYOUT
            ────────────────────────────────────────────────────────────
            PRIMARY (always visible): System Insight + single Next Action
            SECONDARY (collapsed): Why made / Recommendation / Decision /
                                    What happened / How it's performing
            TERTIARY (conditional): Reflection + Learnings only on rows
                                    with a meaningful outcome
            ════════════════════════════════════════════════════════════ */}

        {/* ── PRIMARY 1 — System Insight (always visible, top of stack) */}
        <div className="px-4 pt-3 pb-1">
          <InsightBanner row={row} />
        </div>

        {/* ── PRIMARY 2 — Single highlighted next-action CTA. Pulls
            the first primary action from `buildSuggestedActions` and
            renders it big enough to read as "this is your next move".
            The full SuggestedActions tertiary list still surfaces
            additional CTAs further down. */}
        <PrimaryNextActionCTA row={row} />

        {/* ── 1. Why this decision was made ──
            Cleaner layout — lead with the rationale (the answer the
            section title actually asks), then a compact metadata
            line, then quote-style theses with a coloured side rail
            (drops the per-row uppercase badges that made the list
            feel chip-heavy). Recommendation sub-block uses the same
            quote style so the section reads as one consistent
            structure rather than three competing visual treatments. */}
        <StorySection
          sectionId="thesis"
          icon={Lightbulb}
          title="Why this decision was made"
          needsAttention={!row.rationale_text && !(story?.theses && story.theses.length > 0)}
        >
          {/* The reason — main paragraph. */}
          {row.rationale_text ? (
            <p className="text-[12px] text-gray-800 leading-relaxed whitespace-pre-wrap">{row.rationale_text}</p>
          ) : (
            <EmptyField text="No reasoning recorded yet." />
          )}

          {/* Compact metadata line — owner, date, conviction, horizon
              all on one row separated by middle dots. */}
          {(() => {
            const parts: string[] = []
            if (row.owner_name) parts.push(`by ${row.owner_name}`)
            parts.push(format(new Date(row.created_at), 'MMM d, yyyy'))
            if (story?.ideaExtras?.conviction) parts.push(`${story.ideaExtras.conviction} conviction`)
            if (story?.ideaExtras?.time_horizon) parts.push(`${story.ideaExtras.time_horizon} horizon`)
            return (
              <div className="text-[10px] text-gray-500 mt-1.5 capitalize">
                {parts.join(' · ')}
              </div>
            )
          })()}

          {/* Thesis text — left-rail quote, no filled box. */}
          {story?.ideaExtras?.thesis_text && (
            <div className="mt-2.5 border-l-2 border-gray-200 pl-2.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Thesis</div>
              <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                {story.ideaExtras.thesis_text}
              </p>
            </div>
          )}

          {/* Bull/Bear theses — coloured side rails replace per-row
              uppercase badges. The rail tells you the direction; the
              text reads as a clean quote. */}
          {story?.theses && story.theses.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {story.theses.map(t => (
                <div
                  key={t.id}
                  className={`border-l-2 pl-2.5 ${
                    t.direction === 'bull' ? 'border-emerald-300'
                    : t.direction === 'bear' ? 'border-red-300'
                    : 'border-gray-300'
                  }`}
                >
                  <div className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${
                    t.direction === 'bull' ? 'text-emerald-700'
                    : t.direction === 'bear' ? 'text-red-700'
                    : 'text-gray-500'
                  }`}>
                    {t.direction === 'bull' ? 'Bull case' : t.direction === 'bear' ? 'Bear case' : 'Neutral case'}
                  </div>
                  <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{t.rationale}</p>
                </div>
              ))}
            </div>
          )}

          {/* Linked research — quiet inline footer. */}
          {story && story.linkedResearchCount > 0 && (
            <div className="mt-2.5 text-[10px] text-primary-600 flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {story.linkedResearchCount} linked research item{story.linkedResearchCount !== 1 ? 's' : ''}
            </div>
          )}

          {/* Recommendation sub-block — same quote treatment as the
              theses above so the section is visually consistent. */}
          {(() => {
            const dr = story?.decisionRequest
            const snap = dr?.submission_snapshot || {}
            const snapNotes = typeof snap.notes === 'string' ? snap.notes.trim() : ''
            const contextNote = (dr?.context_note || '').trim()
            const hasSizing =
              snap.weight != null || snap.shares != null || !!snap.action
            const hasRecommendationContent =
              !!dr && (hasSizing || !!contextNote || snapNotes.length > 0)
            if (!hasRecommendationContent || !dr) return null

            // Compose the sizing strip inline: "ADD · 3.5% wt · 1,200 shs"
            const sizingParts: string[] = []
            if (snap.action) sizingParts.push(String(snap.action).toUpperCase())
            if (snap.weight != null) sizingParts.push(`${Number(snap.weight).toFixed(1)}% wt`)
            if (snap.shares != null) sizingParts.push(`${Number(snap.shares).toLocaleString()} shs`)

            // Pilot-seeded recommendations always read as "by Pilot"
            // — matches the same convention used by the row's owner
            // chip in the table and Trade Lab's author label.
            const recommenderLabel = row.owner_name === 'Pilot' ? 'Pilot' : dr.requester_name
            return (
              <div className="mt-3 border-l-2 border-amber-300 pl-2.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-amber-700 mb-0.5">
                  Recommendation
                  {recommenderLabel && (
                    <span className="font-medium normal-case tracking-normal text-[10px] text-gray-500 ml-1">
                      by {recommenderLabel}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-gray-500 mb-1">
                  {format(new Date(dr.created_at), 'MMM d, yyyy')}
                  {dr.urgency && <span className="capitalize"> · {dr.urgency} urgency</span>}
                </div>
                {sizingParts.length > 0 && (
                  <div className="text-[11px] text-gray-800 font-medium tabular-nums mb-1">
                    {sizingParts.join(' · ')}
                  </div>
                )}
                {contextNote && (
                  <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{contextNote}</p>
                )}
                {snapNotes && snapNotes !== contextNote && (
                  <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap mt-1">{snapNotes}</p>
                )}
              </div>
            )
          })()}

          {/* Add-thesis composer — lets a PM attach a thesis after the
              fact (e.g. for discretionary Trade Lab commits). */}
          <AddThesisForm decisionId={row.decision_id} />
        </StorySection>

        {/* ── 2. Decision ──
            Tight, scannable layout: one identity line (status badge +
            who + when), one fact line (decision price), and any
            notes rendered as quiet quotes with a colored side rail
            instead of heavy filled cards. Drops the vertical list of
            label/value pairs in favour of a single inline header. */}
        <StorySection icon={Target} title="Decision">
          {(() => {
            const stage = STAGE_CONFIG[row.stage] || STAGE_CONFIG.approved
            return (
              <div className="space-y-2.5">
                {/* Header — status + decision maker + date inline. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded ${stage.color} ${stage.bgColor}`}>
                    {stage.label}
                  </span>
                  {row.approver_name && (
                    <span className="text-[11px] text-gray-700">
                      by <span className="font-medium">{row.approver_name}</span>
                    </span>
                  )}
                  {row.approved_at && (
                    <span className="text-[11px] text-gray-500">{format(new Date(row.approved_at), 'MMM d, yyyy')}</span>
                  )}
                </div>

                {/* Optional fact — decision price. Renders inline so it
                    sits under the header without a label/value table. */}
                {row.has_decision_price && row.decision_price !== null && (
                  <div className="text-[11px] text-gray-500">
                    Price at decision <span className="text-gray-800 font-medium tabular-nums ml-1">{formatPrice(row.decision_price)}</span>
                  </div>
                )}

                {/* Notes — left-rail quotes. Quieter than filled cards
                    so the section reads as a clean summary instead of
                    two coloured callout panels stacked. */}
                {story?.decisionRequest?.decision_note && (
                  <div className="border-l-2 border-blue-300 pl-2.5 py-0.5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-blue-600 mb-0.5">PM note</div>
                    <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{story.decisionRequest.decision_note}</p>
                  </div>
                )}
                {story?.acceptedTrade?.acceptance_note && (
                  <div className="border-l-2 border-emerald-300 pl-2.5 py-0.5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 mb-0.5">Acceptance note</div>
                    <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{story.acceptedTrade.acceptance_note}</p>
                  </div>
                )}
              </div>
            )
          })()}
        </StorySection>

        {/* ── 3. Execution ──
            Cleaner layout — one identity line per execution (action +
            date + match method), one fact strip with the numeric
            deltas, and any rationale rendered as a quiet quote
            instead of an outlined card. The empty / pending states
            stay simple text + actions. */}
        <StorySection icon={ArrowRight} title="Execution" badge={<ExecStatusPill status={row.execution_status} interactive row={row} />}>
          {row.execution_status === 'not_applicable' ? (
            <EmptyField text={row.stage === 'rejected'
              ? `This idea was rejected — no trade was made.${row.move_since_decision_pct != null ? ` The stock has moved ${row.move_since_decision_pct > 0 ? '+' : ''}${row.move_since_decision_pct.toFixed(1)}% since then.` : ''}`
              : 'This idea was cancelled before reaching a decision.'
            } />
          ) : row.matched_executions.length === 0 ? (
            <div className="space-y-2.5">
              <p className="text-[11px] text-gray-500">
                {row.execution_status === 'pending'
                  ? `Not executed${row.days_since_decision !== null ? ` · ${row.days_since_decision}d since decision` : ''}`
                  : 'No matching execution found.'}
              </p>
              <div className="flex items-center gap-2">
                <ManualMatchPanel row={row} />
                <SkipDecisionButton decisionId={row.decision_id} />
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {row.matched_executions.map(exec => (
                <ExecutionCard key={exec.event_id} exec={exec} decisionId={row.decision_id} />
              ))}
              <ManualMatchPanel row={row} />
              {/* Section-level execution lag — quiet line at the
                  bottom so the time-from-decision-to-fill is visible
                  without scanning the per-execution facts. */}
              {row.execution_lag_days !== null && row.execution_lag_days >= 0 && (
                <div className="pt-1.5 border-t border-gray-100 flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">Execution lag</span>
                  <span className={`tabular-nums ${row.execution_lag_days > 7 ? 'text-amber-700 font-semibold' : 'text-gray-600'}`}>
                    {row.execution_lag_days}d
                  </span>
                </div>
              )}
            </div>
          )}
        </StorySection>

        {/* ── 5. Did It Work? — unified outcome + position ── */}
        <OutcomeSection row={row} />

        {/* ── TERTIARY (conditional) ──────────────────────────────────
            Gated on whether the row has a meaningful outcome — there's
            no point asking a PM to reflect on a 3-day-old position
            with no price movement. Once a directional signal exists
            (mild positive / negative onward), the reflection and
            learnings surfaces appear. Things-to-consider stays gated
            the same way so it shows up alongside reflection. */}
        {(() => {
          const tier = magnitudeTier(row)
          const hasMeaningfulOutcome =
            row.execution_status === 'executed' && tier !== 'noise' && tier !== 'no_data'
          if (!hasMeaningfulOutcome) return null
          return (
            <>
              <ConsiderationsSection row={row} />
              <YourReflectionSection row={row} intel={intel} />
              <LessonsSection row={row} />
              {/* More suggestions below the primary CTA. Renders the
                  full 1–2 button list so the secondary actions stay
                  reachable without crowding the primary block. */}
              <SuggestedActionsSection row={row} />
            </>
          )
        })()}

        {/* (Execution lag moved into the Execution section above so
            it sits with the other execution facts. The loop-footer
            strip and the heavy data-quality disclaimer were also
            removed — the disclaimer now rides as a hover tooltip on
            the result number in the header.) */}
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

  // Compose the fact strip — only include slots that have data so the
  // line never reads as "Price: — Shares: — …". Each slot is one
  // unit, joined inline with middle dots.
  const facts: React.ReactNode[] = []
  if (exec.quantity_delta !== null) {
    facts.push(
      <span key="shares" className={exec.quantity_delta > 0 ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
        {exec.quantity_delta > 0 ? '+' : ''}{exec.quantity_delta.toLocaleString()} shs
      </span>
    )
  }
  if (exec.execution_price !== null) {
    facts.push(<span key="price" className="text-gray-700 tabular-nums">{formatPrice(exec.execution_price)}</span>)
  }
  if (exec.weight_delta !== null) {
    facts.push(
      <span key="weight" className={exec.weight_delta > 0 ? 'text-emerald-700' : 'text-red-700'}>
        {exec.weight_delta > 0 ? '+' : ''}{exec.weight_delta.toFixed(2)}% wt
      </span>
    )
  }
  if (exec.lag_days !== null && exec.lag_days >= 0) {
    facts.push(
      <span key="lag" className={exec.lag_days > 7 ? 'text-amber-700' : 'text-gray-500'}>
        {exec.lag_days}d lag
      </span>
    )
  }

  return (
    <div className="border-l-2 border-teal-300 pl-2.5 py-1">
      {/* Header — action + date + match-method pill + unlink chip. */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-wider text-teal-700">
          {exec.action_type}
        </span>
        <span className="text-[10px] text-gray-500">{format(new Date(exec.event_date), 'MMM d, yyyy')}</span>
        <span className={`text-[9px] font-medium px-1 py-[1px] rounded ${
          exec.match_method === 'explicit_link' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
        }`}>
          {exec.match_method === 'explicit_link' ? 'Linked' : 'Fuzzy match'}
        </span>
        {exec.match_method === 'explicit_link' && decisionId && (
          <button
            onClick={() => unlinkM.mutate({ eventId: exec.event_id })}
            disabled={unlinkM.isPending}
            className="ml-auto text-[10px] text-gray-400 hover:text-red-500 transition-colors"
            title="Unlink this match"
          >
            <Unlink className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Fact strip — single inline line so the eye reads it as a
          tight summary instead of a 5-row label/value table. */}
      {facts.length > 0 && (
        <div className="text-[11px] flex items-center flex-wrap gap-x-2 gap-y-0.5">
          {facts.map((f, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-gray-300">·</span>}
              {f}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Position size on its own quiet line — auxiliary info. */}
      {exec.market_value_after !== null && (
        <div className="text-[10px] text-gray-500 mt-0.5">
          Position <span className="text-gray-700 tabular-nums ml-0.5">{formatPrice(exec.market_value_after)}</span>
        </div>
      )}

      {/* Rationale block removed — redundant with the rationale already
          surfaced in the "Why this decision was made" section above. */}
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
      <StorySection icon={TrendingUp} title="How it's performing" defaultOpen={false} badge={
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
      <StorySection icon={TrendingUp} title="How it's performing" defaultOpen={false} badge={
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
    <StorySection icon={TrendingUp} title="How it's performing" defaultOpen={false} badge={
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
          {/* Trade-level P&L — always renders when we have any usable
              data on the row itself (move %, impact proxy, notional).
              Doesn't depend on the position-lifecycle query, so a row
              that has good trade data but slow lifecycle still shows
              numbers. The position-level block below adds realized /
              unrealized once lifecycle resolves. */}
          <div className="space-y-1">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">This Decision</div>
            <PriceJourney row={row} />

            {/* Headline P&L row — Approx $ impact + Move % since
                decision, side by side. The dollar figure is the most
                visceral P&L stat for a single trade; the percent
                gives the move that produced it. */}
            {(row.impact_proxy != null || row.move_since_decision_pct !== null) && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                {row.impact_proxy != null && (
                  <DetailRow
                    label={<span title="Approximate dollar impact: trade size × directionalized price move. Not exact P&L.">P&amp;L (approx)</span>}
                    value={
                      <span className={`text-[12px] font-bold tabular-nums ${pnlColor(row.impact_proxy)}`}>
                        {fmtDollar(row.impact_proxy)}
                      </span>
                    }
                  />
                )}
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
                {row.trade_notional != null && (
                  <DetailRow label="Trade size" value={
                    <span className="text-[11px] text-gray-700 tabular-nums">
                      {fmtDollar(row.trade_notional).replace(/^[+-]/, '')}
                    </span>
                  } />
                )}
              </div>
            )}

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

          {/* ── Next steps — what to do with this analysis ─────────
              Closes the loop: every committed decision should
              produce one of these three follow-ons. Surfaces
              regardless of P&L state because reflection is the
              point — a flat trade still teaches you something.
              Each click fires `pilot-outcomes:next-action-viewed`
              so the pilot Get Started banner can tick step 2. */}
          <NextStepsFooter row={row} />
        </div>
      )}
    </StorySection>
  )
}

// ─── Next-step CTAs surfaced under "How it's performing" ──────────
// Each option is a one-click jump to the right next surface — open
// a new trade idea on the same asset, refresh the asset's research
// thread, or capture a reflection in this same Outcomes view. The
// goal is to make "what do I do with this" obvious instead of
// leaving the user staring at numbers.

function NextStepsFooter({ row }: { row: AccountabilityRow }) {
  const fireNextActionView = () => {
    try { window.dispatchEvent(new CustomEvent('pilot-outcomes:next-action-viewed')) } catch { /* ignore */ }
  }
  const handleNewIdea = () => {
    fireNextActionView()
    window.dispatchEvent(new CustomEvent('openThoughtsCapture', {
      detail: { captureType: 'trade_idea', assetId: row.asset_id, assetSymbol: row.asset_symbol },
    }))
  }
  const handleUpdateResearch = () => {
    fireNextActionView()
    if (!row.asset_id) return
    window.dispatchEvent(new CustomEvent('navigate-to-asset', {
      detail: {
        id: row.asset_id,
        title: row.asset_symbol || 'Asset',
        type: 'asset',
        data: { id: row.asset_id },
      },
    }))
  }
  const handleAddReflection = () => {
    fireNextActionView()
    window.dispatchEvent(new CustomEvent('outcomes:open-section', {
      detail: { sectionId: 'reflection' },
    }))
  }

  return (
    <div className="border-t border-gray-100 pt-2.5 mt-1 space-y-2">
      <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
        Where to next
      </div>
      <p className="text-[10px] text-gray-500 leading-snug">
        The loop runs continuously — pick the next move on this thesis.
      </p>
      <div className="grid grid-cols-1 gap-1.5 mt-1">
        <button
          type="button"
          onClick={handleNewIdea}
          className="w-full inline-flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 text-amber-800 dark:text-amber-200 text-[11px] font-semibold transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3" />
            Capture a new trade idea
          </span>
          <span className="text-[10px] font-normal text-amber-600/80 dark:text-amber-300/70">
            {row.asset_symbol ?? 'this asset'}
          </span>
        </button>
        <button
          type="button"
          onClick={handleUpdateResearch}
          className="w-full inline-flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-sky-200 bg-sky-50 hover:bg-sky-100 dark:border-sky-800/60 dark:bg-sky-950/30 dark:hover:bg-sky-950/50 text-sky-800 dark:text-sky-200 text-[11px] font-semibold transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            Update research on this asset
          </span>
          <ArrowRight className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={handleAddReflection}
          className="w-full inline-flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 text-[11px] font-semibold transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3" />
            Add a reflection on this decision
          </span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Bottom Chart Panel (shows below table when a row is selected)
// ============================================================

type PositionOverlay = 'none' | 'shares' | 'weight' | 'active_weight'

function BottomChartPanel({ row, onSelectDecision }: {
  row: AccountabilityRow
  onSelectDecision?: (decisionId: string) => void
}) {
  const [overlay, setOverlay] = useState<PositionOverlay>('shares')

  const { data: lifecycle, isLoading: lcLoading } = usePositionLifecycle({
    assetId: row.asset_id,
    portfolioId: row.portfolio_id,
  })
  const { data: priceHistory = [], isLoading: phLoading } = usePositionPriceHistory(row.asset_symbol)
  const { data: holdingsHistory = [] } = useHoldingsTimeSeries(row.portfolio_id, row.asset_symbol)

  // Per-asset benchmark weight, used for the active-weight overlay.
  // Missing row → null → chart treats as 0 (off-benchmark asset).
  const { data: benchmarkWeightPct } = useQuery({
    queryKey: ['position-chart-benchmark-weight', row.portfolio_id, row.asset_id],
    queryFn: async () => {
      if (!row.portfolio_id || !row.asset_id) return null
      const { data, error } = await supabase
        .from('portfolio_benchmark_weights')
        .select('weight')
        .eq('portfolio_id', row.portfolio_id)
        .eq('asset_id', row.asset_id)
        .maybeSingle()
      if (error) return null
      return data?.weight != null ? Number(data.weight) : null
    },
    enabled: !!row.portfolio_id && !!row.asset_id,
    staleTime: 5 * 60 * 1000,
  })

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
            benchmarkWeightPct={benchmarkWeightPct ?? null}
            symbol={row.asset_symbol}
            onSelectEvent={(sourceId, sourceType) => {
              if (!onSelectDecision) return
              // Only decisions map to rows in the accountability list —
              // execution events aren't first-class rows yet, so clicks
              // on fuzzy-match dots are a no-op for now.
              if (sourceType === 'trade_queue_item') onSelectDecision(sourceId)
            }}
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
// Scorecards View (redesigned)
// ============================================================

type ScorecardSection = 'analysts' | 'pms'

function ScorecardsView({ portfolioId }: { portfolioId: string | null }) {
  const [section, setSection] = useState<ScorecardSection>('analysts')

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-7xl mx-auto">
        {/* Section Toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4">
          <button
            onClick={() => setSection('analysts')}
            className={`px-4 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
              section === 'analysts'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Analyst Performance
          </button>
          <button
            onClick={() => setSection('pms')}
            className={`px-4 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
              section === 'pms'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            PM Performance
          </button>
        </div>

        {section === 'analysts' ? <AnalystScorecardsView portfolioId={portfolioId} /> : <PMScorecardsView portfolioId={portfolioId} />}
      </div>
    </div>
  )
}

// ============================================================
// Main Page
// ============================================================

export function DecisionAccountabilityPage({ onItemSelect }: DecisionAccountabilityPageProps) {
  const [activeTab, setActiveTab] = useState<OutcomesSubTab>('decisions')
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null)
  const { data: allPortfolios = [] } = usePortfoliosForFilter()
  const [filters, setFilters] = useState<Partial<AccountabilityFilters>>({
    showApproved: true,
    showRejected: true,
    showCancelled: true,
    resultFilter: 'all',
    directionFilter: [],
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeChipKey, setActiveChipKey] = useState<string>('all')
  const [colFilterOpen, setColFilterOpen] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [tickerSearch, setTickerSearch] = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const [portfolioFilter, setPortfolioFilter] = useState<string | null>(null)
  const [issueSearch, setIssueSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<string>('date')
  const [sortDesc, setSortDesc] = useState(true)

  // Reaching Outcomes is the graduation moment — the user has walked
  // the full pilot loop (capture → develop → decide → review → analyze)
  // and now gets the full app: full dashboard, all tabs, no banners.
  // Mark once, then `usePilotMode.effectiveIsPilot` flips to false on
  // the next render and the rest of the app reconfigures itself.
  const pilotMode = usePilotMode()
  const { mark: markPilotStage, hasGraduated } = usePilotProgress()
  const { user: pilotBannerUser } = useAuth()
  const { currentOrgId: pilotBannerOrgId } = useOrganization()
  // True only on the very first time the user lands here (before
  // graduation has been marked). After graduation, the org-pilot
  // gate flips off and `pilotMode.isPilot` may still be true (org
  // flag) but we no longer want to show this banner.
  const showPilotOutcomesBanner = pilotMode.isPilot && !pilotMode.isLoading
  useEffect(() => {
    if (hasGraduated) return
    if (!pilotMode.isPilot || pilotMode.isLoading) return
    markPilotStage('graduated')
  }, [pilotMode.isPilot, pilotMode.isLoading, hasGraduated, markPilotStage])

  // Merge portfolio selection into filters
  const effectiveFilters = useMemo(() => ({
    ...filters,
    portfolioIds: selectedPortfolioId ? [selectedPortfolioId] : [],
  }), [filters, selectedPortfolioId])

  const { rows, unmatchedExecutions, summary, isLoading, isError, refetch } = useDecisionAccountability({ filters: effectiveFilters })

  // Bulk-fetch structured Decision Quality reviews for every row in
  // view. The verdict engine downstream consults this map to promote
  // a row from `evaluate` → `resolved` once `decision_quality` has
  // been set on the corresponding decision_reviews row.
  const decisionIds = useMemo(() => rows.map(r => r.decision_id), [rows])
  const { data: reviewsById } = useDecisionReviewsByIds(decisionIds)

  /** Promote a row's intel from `evaluate` → `resolved` once the user
   *  has captured a reflection (thesis call OR reflection note). The
   *  presence of either signal is enough — Tesseract has the context
   *  it needed. Negative-outcome rows stay 'hurting' (impact signal
   *  still leads), but their actionNeeded shifts to "View review". */
  const promoteWithReview = (intel: DecisionIntelligence, decisionId: string): DecisionIntelligence => {
    const r = reviewsById?.get(decisionId)
    const hasReflection = !!r?.thesis_played_out || !!(r?.process_note || '').trim()
    if (!hasReflection) return intel
    if (intel.verdict === 'evaluate' || intel.verdict === 'working') {
      return {
        ...intel,
        verdict: 'resolved',
        verdictLabel: 'Reviewed',
        actionNeeded: 'View review',
        urgency: 'none',
      }
    }
    if (intel.verdict === 'hurting') {
      return { ...intel, actionNeeded: 'View review', urgency: 'medium' }
    }
    return intel
  }

  // Decision intelligence
  const rowIntels = useMemo(() =>
    rows.map(row => ({ row, intel: promoteWithReview(inferDecisionIntelligence(row), row.decision_id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, reviewsById]
  )
  const processHealth = useMemo(() => buildProcessHealth(rows), [rows])
  const smartChips = useMemo(() => buildSmartChips(processHealth.counts), [processHealth.counts])

  // Sort rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'lag': cmp = (a.days_since_decision ?? -1) - (b.days_since_decision ?? -1); break
        case 'ticker': cmp = (a.asset_symbol || '').localeCompare(b.asset_symbol || ''); break
        case 'name': cmp = (a.asset_name || '').localeCompare(b.asset_name || ''); break
        case 'portfolio': cmp = (a.portfolio_name || '').localeCompare(b.portfolio_name || ''); break
        case 'result': cmp = (a.move_since_decision_pct ?? -999) - (b.move_since_decision_pct ?? -999); break
        case 'pnl': cmp = (a.impact_proxy ?? -Infinity) - (b.impact_proxy ?? -Infinity); break
        case 'owner': cmp = (a.owner_name || '').localeCompare(b.owner_name || ''); break
        case 'state': cmp = (a.execution_status || '').localeCompare(b.execution_status || ''); break
        case 'type': cmp = (a.direction || '').localeCompare(b.direction || ''); break
        case 'date': default: {
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

  // Apply chip filter
  // Urgency ranking for sort
  const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }

  const displayRows = useMemo(() => {
    const activeChip = smartChips.find(c => c.key === activeChipKey)
    let mapped = sortedRows.map(row => {
      const match = rowIntels.find(ri => ri.row.decision_id === row.decision_id)
      return { row, intel: match?.intel ?? inferDecisionIntelligence(row) }
    })
    // Column filters
    if (activeChip && activeChip.key !== 'all') mapped = mapped.filter(({ intel }) => activeChip.filterFn(intel))
    if (typeFilter) mapped = mapped.filter(({ row }) => row.direction === typeFilter)
    if (tickerSearch) { const q = tickerSearch.toLowerCase(); mapped = mapped.filter(({ row }) => row.asset_symbol?.toLowerCase().includes(q)) }
    if (nameSearch) { const q = nameSearch.toLowerCase(); mapped = mapped.filter(({ row }) => row.asset_name?.toLowerCase().includes(q)) }
    if (portfolioFilter) mapped = mapped.filter(({ row }) => row.portfolio_name === portfolioFilter)
    if (issueSearch) {
      const q = issueSearch.toLowerCase()
      mapped = mapped.filter(({ row, intel }) => {
        if (intel.primaryIssue.toLowerCase().includes(q)) return true
        // Also match against the system insight so searches behave
        // consistently with what's actually rendered in the column.
        if (row.execution_status === 'executed') {
          return buildSystemInsight(row).text.toLowerCase().includes(q)
        }
        return false
      })
    }
    if (actionFilter) {
      if (actionFilter === 'has_action') mapped = mapped.filter(({ intel }) => intel.actionNeeded != null)
      else if (actionFilter === 'no_action') mapped = mapped.filter(({ intel }) => intel.actionNeeded == null)
    }
    if (ownerFilter) mapped = mapped.filter(({ row }) => row.owner_name === ownerFilter)
    // Sort by urgency (critical first) then by existing sort
    mapped.sort((a, b) => {
      const ua = URGENCY_RANK[a.intel.urgency] ?? 4
      const ub = URGENCY_RANK[b.intel.urgency] ?? 4
      if (ua !== ub) return ua - ub
      return 0
    })
    return mapped
  }, [sortedRows, rowIntels, activeChipKey, smartChips, typeFilter, tickerSearch, nameSearch, portfolioFilter, issueSearch, actionFilter, ownerFilter])

  const selectedRow = useMemo(
    () => sortedRows.find(r => r.decision_id === selectedId) || null,
    [sortedRows, selectedId],
  )

  const handleSort = (col: 'date' | 'lag' | 'ticker' | 'result' | 'pnl') => {
    if (sortBy === col) {
      setSortDesc(!sortDesc)
    } else {
      setSortBy(col)
      setSortDesc(true)
    }
  }

  // Column definitions — every column has sort + filter
  // Portfolio column only shows when viewing all portfolios
  type ColDef = { id: string; label: string; sortKey: string; filterType: 'dropdown' | 'search' }
  const columnHeaders: ColDef[] = useMemo(() => {
    const cols: ColDef[] = [
      { id: 'state', label: 'State', sortKey: 'state', filterType: 'dropdown' },
      { id: 'age', label: 'Age', sortKey: 'lag', filterType: 'dropdown' },
      { id: 'type', label: 'Type', sortKey: 'type', filterType: 'dropdown' },
      { id: 'ticker', label: 'Ticker', sortKey: 'ticker', filterType: 'search' },
      { id: 'name', label: 'Name', sortKey: 'name', filterType: 'search' },
    ]
    if (!selectedPortfolioId) {
      cols.push({ id: 'portfolio', label: 'Portfolio', sortKey: 'portfolio', filterType: 'dropdown' })
    }
    cols.push(
      { id: 'issue', label: 'Insight', sortKey: 'state', filterType: 'search' },
      { id: 'pnl', label: 'P&L', sortKey: 'pnl', filterType: 'dropdown' },
      { id: 'return', label: 'Return', sortKey: 'result', filterType: 'dropdown' },
      { id: 'action', label: 'Action', sortKey: 'state', filterType: 'dropdown' },
      { id: 'owner', label: 'Owner', sortKey: 'owner', filterType: 'dropdown' },
      { id: 'date', label: 'Date', sortKey: 'date', filterType: 'dropdown' },
    )
    return cols
  }, [selectedPortfolioId])

  const MAIN_GRID = selectedPortfolioId ? GRID_WITHOUT_PORTFOLIO : GRID_WITH_PORTFOLIO

  // Unique values for dropdown filters
  const uniquePortfolios = useMemo(() => [...new Set(rows.map(r => r.portfolio_name).filter(Boolean))].sort() as string[], [rows])
  const uniqueOwners = useMemo(() => [...new Set(rows.map(r => r.owner_name).filter(Boolean))].sort() as string[], [rows])

  return (
    <div className="h-full flex flex-col bg-white">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-5 shrink-0">
        {/* Row 1: Title + Tabs */}
        <div className="flex items-center gap-4 pt-2 pb-1.5">
          <div className="flex items-center gap-2 shrink-0">
            <Target className="w-4 h-4 text-teal-600" />
            <h1 className="text-[15px] font-semibold text-gray-900">Outcomes</h1>
          </div>

          {/* Segmented control — wrapped in a gray pill so users can
              tell at a glance these are toggleable buttons, not page
              titles. The active button gets a white "lifted" surface
              with a subtle shadow; inactive buttons stay in the
              recessed gray track. */}
          <div className="inline-flex items-center bg-gray-100 border border-gray-200 rounded-md p-0.5 shrink-0">
            <button onClick={() => setActiveTab('decisions')}
              className={`px-3.5 py-1 text-[12px] font-semibold rounded transition-all ${
                activeTab === 'decisions'
                  ? 'bg-white text-teal-700 shadow-sm border border-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}>
              Decisions
            </button>
            <button onClick={() => setActiveTab('scorecards')}
              className={`px-3.5 py-1 text-[12px] font-semibold rounded transition-all ${
                activeTab === 'scorecards'
                  ? 'bg-white text-indigo-700 shadow-sm border border-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}>
              Scorecards
            </button>
          </div>

          {/* Portfolio selector — shared across Decisions + Scorecards */}
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <select
              value={selectedPortfolioId || ''}
              onChange={e => setSelectedPortfolioId(e.target.value || null)}
              className="text-[12px] font-semibold border border-gray-300 rounded-md px-3 py-1.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 cursor-pointer"
            >
              <option value="">All Portfolios</option>
              {allPortfolios.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="flex-1" />
        </div>

        {/* Row 2: Diagnosis banner — compact single row.
            Label + headline live on one line so the banner isn't 3
            stacked rows of text. Narrative collapses into a single
            quiet sub-line only when it adds info. The previous
            recommendation-chips row was removed — those filters
            duplicated the column-header filter UI below the table. */}
        {activeTab === 'decisions' && processHealth.counts.total > 0 && (() => {
          const hd = HEALTH_DISPLAY[processHealth.level]
          const isSevere = processHealth.level === 'critical' || processHealth.level === 'degraded'
          const hasNarrative = processHealth.narrative && processHealth.narrative !== processHealth.headline
          return (
            <div className="pb-2">
              <div className={`flex items-center gap-3 rounded ${isSevere ? `border ${hd.borderColor} ${hd.bgColor} px-3 py-1.5` : 'py-0.5'}`}>
                <div className="flex-1 min-w-0">
                  {/* Single-line headline — label + breakdown + headline
                      all inline so the banner reads as one strip,
                      not three rows. */}
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={`text-[11px] font-black uppercase tracking-wide ${hd.color} flex-shrink-0`}>{hd.label}</span>
                    {processHealth.primaryBreakdown && (
                      <span className={`text-[10px] font-semibold ${isSevere ? 'text-gray-700' : 'text-gray-500'} flex-shrink-0`}>· {processHealth.primaryBreakdown}</span>
                    )}
                    <span className={`text-[11px] leading-snug ${isSevere ? 'text-gray-800' : 'text-gray-500'} truncate`}>
                      {processHealth.headline}
                    </span>
                  </div>
                  {hasNarrative && (
                    <p className={`text-[10px] leading-snug mt-0.5 ${isSevere ? 'text-gray-500' : 'text-gray-400'}`}>
                      {processHealth.narrative}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  <FilterBar filters={filters} onChange={setFilters} />
                </div>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Pilot Outcomes Get Started — graduation banner. Shown only
          on first arrival; auto-retires after all 3 step events fire
          or the user dismisses. The "Start research" CTA jumps to
          the asset page for the most-recent committed decision. */}
      {showPilotOutcomesBanner && (
        <PilotOutcomesGetStarted
          userId={pilotBannerUser?.id}
          orgId={pilotBannerOrgId}
          onStartResearch={() => {
            const top = displayRows[0]?.row
            if (top?.asset_id) {
              window.dispatchEvent(new CustomEvent('navigate-to-asset', {
                detail: {
                  id: top.asset_id,
                  title: top.asset_symbol || 'Asset',
                  type: 'asset',
                  data: { id: top.asset_id },
                },
              }))
            } else {
              // No decisions to anchor to yet — open the assets list.
              window.dispatchEvent(new CustomEvent('decision-engine-action', {
                detail: { id: 'assets', title: 'Assets', type: 'assets', data: null },
              }))
            }
          }}
        />
      )}

      {activeTab === 'scorecards' ? (
        <ScorecardsView portfolioId={selectedPortfolioId} />
      ) : (
      <>

      {/* ── CONTENT ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {(
          /* ── Main Decision Table + Detail + Bottom Chart ── */
          <div className="h-full flex border-t border-gray-200 overflow-hidden">
            {/* Left: Table rows + chart below */}
            <div className="flex-1 min-w-0 flex flex-col bg-white">
              {/* Column headers */}
              <div className={`grid ${MAIN_GRID} bg-gray-50 border-b border-gray-200 shrink-0`}>
                {columnHeaders.map(col => (
                  <TableColHeader
                    key={col.id} col={col}
                    sortBy={sortBy} sortDesc={sortDesc} onSort={handleSort}
                    colFilterOpen={colFilterOpen} setColFilterOpen={setColFilterOpen}
                    activeChipKey={activeChipKey} setActiveChipKey={setActiveChipKey} smartChips={smartChips}
                    typeFilter={typeFilter} setTypeFilter={setTypeFilter}
                    tickerSearch={tickerSearch} setTickerSearch={setTickerSearch}
                    nameSearch={nameSearch} setNameSearch={setNameSearch}
                    portfolioFilter={portfolioFilter} setPortfolioFilter={setPortfolioFilter}
                    issueSearch={issueSearch} setIssueSearch={setIssueSearch}
                    actionFilter={actionFilter} setActionFilter={setActionFilter}
                    ownerFilter={ownerFilter} setOwnerFilter={setOwnerFilter}
                    uniquePortfolios={uniquePortfolios} uniqueOwners={uniqueOwners}
                  />
                ))}
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
                  displayRows.map(({ row, intel }) => (
                    <DecisionRow
                      key={row.decision_id}
                      row={row}
                      intel={intel}
                      isSelected={row.decision_id === selectedId}
                      onSelect={() => {
                        setSelectedId(row.decision_id === selectedId ? null : row.decision_id)
                        // Tick step 1 of the pilot Outcomes Get Started banner —
                        // selecting a decision row counts as inspecting the result.
                        try { window.dispatchEvent(new CustomEvent('pilot-outcomes:result-inspected')) } catch { /* ignore */ }
                      }}
                      gridClass={MAIN_GRID}
                      showPortfolio={!selectedPortfolioId}
                    />
                  ))
                )}
              </div>

              {/* Bottom chart — below table, left of detail panel */}
              {selectedRow && (
                <BottomChartPanel
                  row={selectedRow}
                  onSelectDecision={(decisionId) => setSelectedId(decisionId)}
                />
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

function TableColHeader({ col, sortBy, sortDesc, onSort, colFilterOpen, setColFilterOpen,
  activeChipKey, setActiveChipKey, smartChips, typeFilter, setTypeFilter, tickerSearch, setTickerSearch,
  nameSearch, setNameSearch, portfolioFilter, setPortfolioFilter, issueSearch, setIssueSearch,
  actionFilter, setActionFilter, ownerFilter, setOwnerFilter, uniquePortfolios, uniqueOwners,
}: {
  col: { id: string; label: string; sortKey: string; filterType: string }
  sortBy: string; sortDesc: boolean; onSort: (col: any) => void
  colFilterOpen: string | null; setColFilterOpen: (v: string | null) => void
  activeChipKey: string; setActiveChipKey: (v: string) => void; smartChips: SmartChip[]
  typeFilter: string | null; setTypeFilter: (v: string | null) => void
  tickerSearch: string; setTickerSearch: (v: string) => void
  nameSearch: string; setNameSearch: (v: string) => void
  portfolioFilter: string | null; setPortfolioFilter: (v: string | null) => void
  issueSearch: string; setIssueSearch: (v: string) => void
  actionFilter: string | null; setActionFilter: (v: string | null) => void
  ownerFilter: string | null; setOwnerFilter: (v: string | null) => void
  uniquePortfolios: string[]; uniqueOwners: string[]
}) {
  const isSortActive = sortBy === col.sortKey
  const isFilterActive =
    (col.id === 'state' && activeChipKey !== 'all') ||
    (col.id === 'type' && typeFilter != null) ||
    (col.id === 'ticker' && tickerSearch !== '') ||
    (col.id === 'name' && nameSearch !== '') ||
    (col.id === 'portfolio' && portfolioFilter != null) ||
    (col.id === 'issue' && issueSearch !== '') ||
    (col.id === 'action' && actionFilter != null) ||
    (col.id === 'owner' && ownerFilter != null)
  const isOpen = colFilterOpen === col.id
  const isActive = isSortActive || isFilterActive

  return (
    <div className="px-1 py-2 relative flex items-center h-full">
      {/* Sort button */}
      <button
        onClick={() => onSort(col.sortKey)}
        className={`text-[10px] font-black uppercase tracking-wide select-none cursor-pointer ${isActive ? 'text-gray-800' : 'text-gray-500'} hover:text-gray-800`}
      >
        {col.label}
        {isSortActive ? <span className="ml-0.5 text-[8px]">{sortDesc ? '▼' : '▲'}</span> : <span className="ml-0.5 text-gray-300 text-[8px]">↕</span>}
      </button>

      {/* Filter button */}
      <button
        onClick={() => setColFilterOpen(isOpen ? null : col.id)}
        className={`ml-1 cursor-pointer ${isFilterActive ? 'text-gray-800' : 'text-gray-300'} hover:text-gray-600`}
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Filter dropdowns */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setColFilterOpen(null)} />
          <div className="absolute left-0 top-full mt-0.5 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[120px]">
            {/* State */}
            {col.id === 'state' && (
              <div className="py-1">
                {smartChips.map(chip => (
                  <button key={chip.key} onClick={() => { setActiveChipKey(chip.key); setColFilterOpen(null) }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-medium flex items-center justify-between ${
                      activeChipKey === chip.key ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                    } ${chip.count === 0 && chip.key !== 'all' ? 'opacity-40' : ''}`}>
                    <span className="capitalize">{chip.label}</span>
                    <span className="text-[9px] text-gray-400 tabular-nums">{chip.count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Age */}
            {col.id === 'age' && (
              <div className="py-1">
                {[{ k: 'all', l: 'All' }, { k: 'stalled', l: 'Stalled (>14d)' }, { k: 'hurting', l: 'Hurting' }].map(o => (
                  <button key={o.k} onClick={() => { setActiveChipKey(o.k); setColFilterOpen(null) }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-medium ${activeChipKey === o.k ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>{o.l}</button>
                ))}
              </div>
            )}

            {/* Type */}
            {col.id === 'type' && (
              <div className="py-1">
                <button onClick={() => { setTypeFilter(null); setColFilterOpen(null) }}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-medium ${!typeFilter ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>All</button>
                {['buy', 'sell', 'add', 'trim'].map(t => (
                  <button key={t} onClick={() => { setTypeFilter(t); setColFilterOpen(null) }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-medium capitalize ${typeFilter === t ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>{t}</button>
                ))}
              </div>
            )}

            {/* Search-based: ticker, name, issue */}
            {(col.id === 'ticker' || col.id === 'name' || col.id === 'issue') && (() => {
              const val = col.id === 'ticker' ? tickerSearch : col.id === 'name' ? nameSearch : issueSearch
              const setVal = col.id === 'ticker' ? setTickerSearch : col.id === 'name' ? setNameSearch : setIssueSearch
              return (
                <div className="p-2">
                  <input autoFocus type="text" placeholder={`Filter ${col.label.toLowerCase()}...`} value={val}
                    onChange={e => setVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setColFilterOpen(null) }}
                    className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400" />
                  {val && <button onClick={() => { setVal(''); setColFilterOpen(null) }} className="text-[9px] text-gray-400 hover:text-gray-600 mt-1">Clear</button>}
                </div>
              )
            })()}

            {/* Portfolio */}
            {col.id === 'portfolio' && (
              <div className="py-1 max-h-48 overflow-auto">
                <button onClick={() => { setPortfolioFilter(null); setColFilterOpen(null) }}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-medium ${!portfolioFilter ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>All</button>
                {uniquePortfolios.map(p => (
                  <button key={p} onClick={() => { setPortfolioFilter(p); setColFilterOpen(null) }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-medium truncate ${portfolioFilter === p ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>{p}</button>
                ))}
              </div>
            )}

            {/* P&L / Return — same positive/negative chip filter applies
                to both; the cell split is purely visual. */}
            {(col.id === 'result' || col.id === 'pnl' || col.id === 'return') && (
              <div className="py-1">
                {[{ k: 'all', l: 'All' }, { k: 'hurting', l: 'Negative' }, { k: 'working', l: 'Positive' }].map(o => (
                  <button key={o.k} onClick={() => { setActiveChipKey(o.k); setColFilterOpen(null) }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-medium ${activeChipKey === o.k ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>{o.l}</button>
                ))}
              </div>
            )}

            {/* Action */}
            {col.id === 'action' && (
              <div className="py-1">
                <button onClick={() => { setActionFilter(null); setColFilterOpen(null) }}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-medium ${!actionFilter ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>All</button>
                <button onClick={() => { setActionFilter('has_action'); setColFilterOpen(null) }}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-medium ${actionFilter === 'has_action' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>Has action</button>
                <button onClick={() => { setActionFilter('no_action'); setColFilterOpen(null) }}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-medium ${actionFilter === 'no_action' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>No action</button>
              </div>
            )}

            {/* Owner */}
            {col.id === 'owner' && (
              <div className="py-1 max-h-48 overflow-auto">
                <button onClick={() => { setOwnerFilter(null); setColFilterOpen(null) }}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-medium ${!ownerFilter ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>All</button>
                {uniqueOwners.map(o => (
                  <button key={o} onClick={() => { setOwnerFilter(o); setColFilterOpen(null) }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-medium truncate ${ownerFilter === o ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}>{o}</button>
                ))}
              </div>
            )}

            {/* Date */}
            {col.id === 'date' && (
              <div className="py-1">
                <p className="px-3 py-1 text-[9px] text-gray-400">Use date filters above</p>
              </div>
            )}
          </div>
        </>
      )}
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
