/**
 * OutcomesPage
 *
 * Unified decision ledger: every deliberate choice — trades committed AND ideas
 * explicitly passed on — with post-mortem reflections added at any time.
 *
 * Sub-tabs:
 * 1. Decisions — Unified ledger (acted + passed)
 * 2. Scorecards — Analyst & PM performance
 */

import { useState, useRef, useCallback } from 'react'
import {
  Target, Search, Clock, User, Users,
  CheckCircle2, TrendingUp, TrendingDown, Briefcase,
  Calendar, AlertCircle, Award, RefreshCw,
  ArrowUpRight, ArrowDownRight, Zap, XCircle,
  PauseCircle, MessageSquare, Send, CornerDownRight,
} from 'lucide-react'
import { format, subDays } from 'date-fns'
import {
  useOutcomeDecisions,
  useOutcomeSummary,
  useAddReflection,
  usePortfoliosForFilter,
  useUsersForFilter,
  type OutcomeDecision,
  type OutcomeFilters,
  type DecisionDirection,
} from '../hooks/useOutcomes'
import { useAuth } from '../hooks/useAuth'
import { AnalystPerformanceCard } from '../components/outcomes/AnalystPerformanceCard'
import { PerformanceLeaderboard } from '../components/outcomes/PerformanceLeaderboard'
import type { PeriodType } from '../hooks/useAnalystPerformance'

type OutcomesSubTab = 'decisions' | 'scorecards'

// ============================================================
// Filter Bar
// ============================================================

function FilterBar({ filters, onChange }: {
  filters: Partial<OutcomeFilters>
  onChange: (f: Partial<OutcomeFilters>) => void
}) {
  const { data: portfolios = [] } = usePortfoliosForFilter()
  const { data: users = [] } = useUsersForFilter()

  const activeDays = (() => {
    if (!filters.dateRange?.start) return 90
    const diff = Math.round((Date.now() - new Date(filters.dateRange.start).getTime()) / 86400000)
    if (diff <= 8) return 7
    if (diff <= 31) return 30
    return 90
  })()

  const setDays = (d: number) => onChange({
    ...filters,
    dateRange: { start: subDays(new Date(), d).toISOString(), end: new Date().toISOString() },
  })

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Date range */}
      <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              activeDays === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Category */}
      <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
        {[
          { key: 'all', label: 'All' },
          { key: 'acted', label: 'Acted' },
          { key: 'passed', label: 'Passed' },
        ].map(c => (
          <button
            key={c.key}
            onClick={() => onChange({ ...filters, category: c.key as any })}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              (filters.category || 'all') === c.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Portfolio */}
      <select
        value={filters.portfolioIds?.[0] || ''}
        onChange={e => onChange({ ...filters, portfolioIds: e.target.value ? [e.target.value] : [] })}
        className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <option value="">All Portfolios</option>
        {portfolios.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {/* Owner */}
      <select
        value={filters.ownerUserIds?.[0] || ''}
        onChange={e => onChange({ ...filters, ownerUserIds: e.target.value ? [e.target.value] : [] })}
        className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <option value="">All Users</option>
        {users.map((u: any) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          type="text"
          placeholder="Search ticker..."
          value={filters.assetSearch || ''}
          onChange={e => onChange({ ...filters, assetSearch: e.target.value })}
          className="pl-8 pr-3 py-1 text-xs border border-gray-200 rounded-lg w-36 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>
    </div>
  )
}

// ============================================================
// Decision Card
// ============================================================

const DIR_STYLE: Record<string, { Icon: typeof TrendingUp; color: string; border: string; bg: string }> = {
  buy:  { Icon: ArrowUpRight, color: 'text-emerald-600', border: 'border-l-emerald-500', bg: 'bg-emerald-50' },
  add:  { Icon: ArrowUpRight, color: 'text-emerald-600', border: 'border-l-emerald-500', bg: 'bg-emerald-50' },
  sell: { Icon: ArrowDownRight, color: 'text-red-600', border: 'border-l-red-400', bg: 'bg-red-50' },
  trim: { Icon: ArrowDownRight, color: 'text-red-600', border: 'border-l-red-400', bg: 'bg-red-50' },
}

const EXEC_BADGE: Record<string, { label: string; cls: string }> = {
  executed: { label: 'Executed', cls: 'bg-emerald-100 text-emerald-700' },
  pending:  { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  partial:  { label: 'Partial', cls: 'bg-blue-100 text-blue-700' },
  missed:   { label: 'Failed', cls: 'bg-red-100 text-red-700' },
}

function DecisionCard({ decision }: { decision: OutcomeDecision }) {
  const { user } = useAuth()
  const addReflection = useAddReflection()
  const [draft, setDraft] = useState('')
  const [showReflections, setShowReflections] = useState(decision.reflections.length > 0)
  const inputRef = useRef<HTMLInputElement>(null)

  const dir = DIR_STYLE[decision.direction] || DIR_STYLE.buy
  const DirIcon = dir.Icon
  const isActed = decision.category === 'acted'
  const isPassed = decision.category === 'passed'

  const handleSubmit = useCallback(() => {
    if (!draft.trim() || !user?.id) return
    addReflection.mutate({
      decision,
      content: draft.trim(),
      userId: user.id,
    })
    setDraft('')
  }, [draft, user?.id, decision, addReflection])

  // The narrative: "We [acted/passed] on [symbol] because [reason]"
  const narrative = isPassed
    ? decision.decision_note || decision.rationale
    : decision.decision_note || decision.rationale

  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${
      isPassed ? 'border-l-gray-400' : dir.border
    } overflow-hidden`}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            {isPassed ? (
              decision.passed_reason === 'deferred' ? (
                <PauseCircle className="w-4 h-4 text-amber-500" />
              ) : (
                <XCircle className="w-4 h-4 text-gray-400" />
              )
            ) : (
              <DirIcon className={`w-4 h-4 ${dir.color}`} />
            )}
            <span className={`text-xs font-semibold uppercase ${isPassed ? 'text-gray-500' : dir.color}`}>
              {isPassed ? (decision.passed_reason === 'deferred' ? 'Deferred' : 'Passed') : decision.direction}
            </span>
            <span className="font-bold text-gray-900 text-sm">{decision.asset_symbol || '—'}</span>
            {decision.sizing_input && (
              <span className="text-xs text-gray-400 font-mono">{decision.sizing_input}</span>
            )}
          </div>

          {/* Status badge */}
          {isActed && EXEC_BADGE[decision.execution_status] && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${EXEC_BADGE[decision.execution_status].cls}`}>
              {EXEC_BADGE[decision.execution_status].label}
            </span>
          )}
          {isPassed && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
              decision.passed_reason === 'deferred' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {decision.passed_reason === 'deferred' ? 'Deferred' : 'Rejected'}
            </span>
          )}
        </div>

        {/* Company name */}
        {decision.asset_name && (
          <p className="text-xs text-gray-400 mb-2">{decision.asset_name}</p>
        )}

        {/* Narrative — the why */}
        {narrative && (
          <p className="text-sm text-gray-700 leading-relaxed line-clamp-3 mb-3">
            {narrative}
          </p>
        )}

        {/* Deferred until */}
        {decision.deferred_until && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 mb-3">
            <Clock className="w-3 h-3" />
            Revisit {format(new Date(decision.deferred_until), 'MMM d, yyyy')}
          </div>
        )}

        {/* Footer: who, when, where */}
        <div className="flex items-center justify-between text-[11px] text-gray-400 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {format(new Date(decision.decided_at), 'MMM d')}
            </span>
            {decision.decided_by_name && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {decision.decided_by_name}
              </span>
            )}
            {decision.source && (
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {decision.source}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {decision.portfolio_name && (
              <span className="flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                {decision.portfolio_name}
              </span>
            )}
            <button
              onClick={() => { setShowReflections(!showReflections); setTimeout(() => inputRef.current?.focus(), 50) }}
              className={`flex items-center gap-1 hover:text-gray-600 transition-colors ${
                decision.reflections.length > 0 ? 'text-indigo-500' : ''
              }`}
              title="Reflections"
            >
              <MessageSquare className="w-3 h-3" />
              {decision.reflections.length > 0 && decision.reflections.length}
            </button>
          </div>
        </div>
      </div>

      {/* Reflections thread */}
      {showReflections && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
          {decision.reflections.length > 0 && (
            <div className="space-y-2 mb-3">
              {decision.reflections.map(r => (
                <div key={r.id} className="flex gap-2">
                  <CornerDownRight className="w-3 h-3 text-gray-300 mt-1 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700">{r.content}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {r.user_name} &middot; {format(new Date(r.created_at), 'MMM d')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reflection input */}
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Add a reflection..."
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              className="flex-1 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder:text-gray-400"
            />
            <button
              onClick={handleSubmit}
              disabled={!draft.trim() || addReflection.isPending}
              className="p-1.5 text-indigo-500 hover:text-indigo-700 disabled:text-gray-300 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Decisions View
// ============================================================

function DecisionsView() {
  const [filters, setFilters] = useState<Partial<OutcomeFilters>>({})
  const { decisions, isLoading, isError, refetch } = useOutcomeDecisions(filters)
  const summary = useOutcomeSummary(decisions)

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Summary + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Decision Ledger</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 bg-gray-100 rounded-md font-medium text-gray-700">
              {summary.total} total
            </span>
            {summary.acted > 0 && (
              <span className="px-2 py-0.5 bg-emerald-50 rounded-md font-medium text-emerald-700">
                {summary.acted} acted
              </span>
            )}
            {summary.passed > 0 && (
              <span className="px-2 py-0.5 bg-gray-100 rounded-md font-medium text-gray-600">
                {summary.passed} passed
              </span>
            )}
            {summary.executed > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 rounded-md font-medium text-emerald-600">
                <CheckCircle2 className="w-3 h-3" /> {summary.executed}
              </span>
            )}
            {summary.pending > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 rounded-md font-medium text-amber-600">
                <Clock className="w-3 h-3" /> {summary.pending}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {/* Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-emerald-600" />
        </div>
      ) : isError ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">Failed to load decisions.</span>
            <button onClick={() => refetch()} className="text-sm underline ml-1">Retry</button>
          </div>
        </div>
      ) : decisions.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <div className="flex flex-col items-center text-center py-4">
            <div className="p-3 bg-gray-100 rounded-full mb-3">
              <Target className="w-7 h-7 text-gray-400" />
            </div>
            <h3 className="font-medium text-gray-900 mb-1">No decisions yet</h3>
            <p className="text-sm text-gray-500 max-w-sm">
              Committed trades and explicit pass/reject decisions will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {decisions.map(d => (
            <DecisionCard key={d.id} decision={d} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Scorecards View
// ============================================================

function ScorecardsView() {
  const [periodType, setPeriodType] = useState<PeriodType>('all_time')
  const [selectedAnalystId, setSelectedAnalystId] = useState<string | null>(null)
  const { data: users = [] } = useUsersForFilter()

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-900">Analyst Scorecards</h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {(['all_time', 'yearly', 'quarterly', 'monthly'] as PeriodType[]).map(pt => (
              <button
                key={pt}
                onClick={() => setPeriodType(pt)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  periodType === pt ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {pt === 'all_time' ? 'All Time' : pt.charAt(0).toUpperCase() + pt.slice(1)}
              </button>
            ))}
          </div>

          <select
            value={selectedAnalystId || ''}
            onChange={e => setSelectedAnalystId(e.target.value || null)}
            className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Analysts</option>
            {users.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedAnalystId ? (
        <AnalystPerformanceCard userId={selectedAnalystId} periodType={periodType} />
      ) : (
        <div className="space-y-6">
          <PerformanceLeaderboard limit={20} />
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Users className="w-3.5 h-3.5" />
              Individual Performance
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {users.slice(0, 6).map((u: any) => (
                <AnalystPerformanceCard
                  key={u.id}
                  userId={u.id}
                  periodType={periodType}
                  compact
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Main Page
// ============================================================

export function OutcomesPage() {
  const [activeTab, setActiveTab] = useState<OutcomesSubTab>('decisions')

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Target className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Outcomes</h1>
              <p className="text-sm text-gray-500">Every decision — what you did, what you passed on, and what you learned</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('decisions')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === 'decisions'
                ? 'border-emerald-500 text-emerald-700 bg-emerald-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Decisions
            </span>
          </button>
          <button
            onClick={() => setActiveTab('scorecards')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === 'scorecards'
                ? 'border-indigo-500 text-indigo-700 bg-indigo-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <Award className="w-4 h-4" />
              Scorecards
            </span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'decisions' && <DecisionsView />}
        {activeTab === 'scorecards' && <ScorecardsView />}
      </div>
    </div>
  )
}
