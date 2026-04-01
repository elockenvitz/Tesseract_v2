/**
 * OutcomesPage
 *
 * Question-driven feedback loop: What happened after decisions were made?
 *
 * Sub-tabs:
 * 1. Decisions — Decision Ledger (approved/rejected trade ideas)
 * 2. Scorecards — Analyst & PM performance (hit rate, accuracy, leaderboard)
 */

import { useState, useMemo } from 'react'
import {
  Target, Search, Clock, User, Users,
  CheckCircle2, FileText, TrendingUp, TrendingDown, Briefcase,
  Calendar, Eye, AlertCircle, XCircle, Award
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { format, subDays } from 'date-fns'
import {
  useOutcomeDecisions,
  useOutcomeSummary,
  usePortfoliosForFilter,
  useUsersForFilter,
} from '../hooks/useOutcomes'
import { AnalystPerformanceCard } from '../components/outcomes/AnalystPerformanceCard'
import { PerformanceLeaderboard } from '../components/outcomes/PerformanceLeaderboard'
import type { PeriodType } from '../hooks/useAnalystPerformance'
import type { OutcomeFilters, OutcomeDecision, DecisionDirection } from '../types/outcomes'

type OutcomesSubTab = 'decisions' | 'scorecards'

interface OutcomesPageProps {
  onItemSelect?: (item: any) => void
}

// ============================================================
// Filter Bar Component
// ============================================================

interface FilterBarProps {
  filters: Partial<OutcomeFilters>
  onFiltersChange: (filters: Partial<OutcomeFilters>) => void
}

function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  const { data: portfolios = [] } = usePortfoliosForFilter()
  const { data: users = [] } = useUsersForFilter()

  const handleDateRangeChange = (days: number | null) => {
    if (days === null) {
      onFiltersChange({
        ...filters,
        dateRange: { start: null, end: null }
      })
    } else {
      onFiltersChange({
        ...filters,
        dateRange: {
          start: subDays(new Date(), days).toISOString(),
          end: new Date().toISOString()
        }
      })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Date Range Quick Filters */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => handleDateRangeChange(7)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            filters.dateRange?.start &&
            new Date(filters.dateRange.start).getTime() > subDays(new Date(), 8).getTime()
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          7 days
        </button>
        <button
          onClick={() => handleDateRangeChange(30)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            filters.dateRange?.start &&
            new Date(filters.dateRange.start).getTime() <= subDays(new Date(), 8).getTime() &&
            new Date(filters.dateRange.start).getTime() > subDays(new Date(), 31).getTime()
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          30 days
        </button>
        <button
          onClick={() => handleDateRangeChange(90)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            !filters.dateRange?.start ||
            new Date(filters.dateRange.start).getTime() <= subDays(new Date(), 31).getTime()
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          90 days
        </button>
      </div>

      {/* Portfolio Filter */}
      <select
        value={filters.portfolioIds?.[0] || ''}
        onChange={(e) => onFiltersChange({
          ...filters,
          portfolioIds: e.target.value ? [e.target.value] : []
        })}
        className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <option value="">All Portfolios</option>
        {portfolios.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {/* Owner Filter */}
      <select
        value={filters.ownerUserIds?.[0] || ''}
        onChange={(e) => onFiltersChange({
          ...filters,
          ownerUserIds: e.target.value ? [e.target.value] : []
        })}
        className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <option value="">All Analysts</option>
        {users.map(u => (
          <option key={u.id} value={u.id}>
            {u.first_name || u.last_name
              ? `${u.first_name || ''} ${u.last_name || ''}`.trim()
              : u.email.split('@')[0]}
          </option>
        ))}
      </select>

      {/* Asset Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search asset..."
          value={filters.assetSearch || ''}
          onChange={(e) => onFiltersChange({ ...filters, assetSearch: e.target.value })}
          className="pl-10 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Status Toggles */}
      <div className="flex items-center gap-2 ml-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={filters.showRejected || false}
            onChange={(e) => onFiltersChange({ ...filters, showRejected: e.target.checked })}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          Show Rejected
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={filters.showArchived || false}
            onChange={(e) => onFiltersChange({ ...filters, showArchived: e.target.checked })}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          Show Archived
        </label>
      </div>
    </div>
  )
}


// ============================================================
// Decision Card Component
// ============================================================

interface DecisionCardProps {
  decision: OutcomeDecision
  onSelect?: (decision: OutcomeDecision) => void
}

function DecisionCard({ decision, onSelect }: DecisionCardProps) {
  const getDirectionIcon = (direction: DecisionDirection) => {
    switch (direction) {
      case 'buy':
      case 'add':
      case 'long':
        return <TrendingUp className="w-4 h-4 text-green-500" />
      case 'sell':
      case 'trim':
      case 'short':
        return <TrendingDown className="w-4 h-4 text-red-500" />
      default:
        return <Target className="w-4 h-4 text-gray-400" />
    }
  }

  const getDirectionColor = (direction: DecisionDirection) => {
    switch (direction) {
      case 'buy':
      case 'add':
      case 'long':
        return 'bg-green-50 border-green-200 text-green-700'
      case 'sell':
      case 'trim':
      case 'short':
        return 'bg-red-50 border-red-200 text-red-700'
      default:
        return 'bg-gray-50 border-gray-200 text-gray-700'
    }
  }

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'approved':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200'
      case 'rejected':
        return 'bg-red-100 text-red-700 border-red-200'
      case 'cancelled':
        return 'bg-gray-100 text-gray-700 border-gray-200'
      default:
        return 'bg-blue-100 text-blue-700 border-blue-200'
    }
  }

  const formatUserName = (user?: { first_name: string | null; last_name: string | null; email: string }) => {
    if (!user) return 'Unknown'
    if (user.first_name || user.last_name) {
      return [user.first_name, user.last_name].filter(Boolean).join(' ')
    }
    return user.email.split('@')[0]
  }

  return (
    <Card
      className={`p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 ${getDirectionColor(decision.direction)}`}
      onClick={() => onSelect?.(decision)}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {getDirectionIcon(decision.direction)}
          <span className="font-semibold text-gray-900 uppercase text-sm">
            {decision.direction}
          </span>
          {decision.asset_symbol && (
            <span className="font-bold text-gray-900">{decision.asset_symbol}</span>
          )}
        </div>
        <Badge variant="default" className={getStageColor(decision.stage)}>
          {decision.stage.charAt(0).toUpperCase() + decision.stage.slice(1)}
        </Badge>
      </div>

      {/* Asset Info */}
      {decision.asset_name && (
        <p className="text-sm text-gray-600 mb-2">{decision.asset_name}</p>
      )}

      {/* Frozen Rationale */}
      {decision.has_rationale && decision.rationale_snapshot && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Decision Rationale</span>
          </div>
          <p className="text-sm text-gray-700 line-clamp-2">
            {decision.rationale_snapshot.summary || decision.rationale_snapshot.thesis}
          </p>
        </div>
      )}

      {/* Decision Details */}
      <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-3">
          {decision.approved_at && (
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{format(new Date(decision.approved_at), 'MMM d, yyyy')}</span>
            </div>
          )}
          {decision.approved_by_user && (
            <div className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>{formatUserName(decision.approved_by_user)}</span>
            </div>
          )}
          {decision.days_since_approved !== undefined && (
            <div className="flex items-center gap-1 text-amber-600">
              <Clock className="w-3 h-3" />
              <span>{decision.days_since_approved}d ago</span>
            </div>
          )}
        </div>
        {decision.portfolio_name && (
          <div className="flex items-center gap-1">
            <Briefcase className="w-3 h-3" />
            <span>{decision.portfolio_name}</span>
          </div>
        )}
      </div>

      {/* Execution Status */}
      <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Eye className="w-3.5 h-3.5" />
          <span>
            {decision.execution_status === 'pending'
              ? 'Awaiting position change detection'
              : decision.execution_status === 'executed'
              ? 'Position change detected'
              : decision.execution_status === 'missed'
              ? 'No position change detected'
              : 'Status unknown'}
          </span>
        </div>
      </div>
    </Card>
  )
}

// ============================================================
// Main Page Component
// ============================================================

// ============================================================
// Scorecards View Component
// ============================================================

function ScorecardsView() {
  const [periodType, setPeriodType] = useState<PeriodType>('all_time')
  const [selectedAnalystId, setSelectedAnalystId] = useState<string | null>(null)
  const { data: users = [] } = useUsersForFilter()

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Scorecards Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-900">Analyst Scorecards</h2>
        </div>

        <div className="flex items-center gap-3">
          {/* Period Selector */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {(['all_time', 'yearly', 'quarterly', 'monthly'] as PeriodType[]).map(pt => (
              <button
                key={pt}
                onClick={() => setPeriodType(pt)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  periodType === pt
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {pt === 'all_time' ? 'All Time' : pt.charAt(0).toUpperCase() + pt.slice(1)}
              </button>
            ))}
          </div>

          {/* Analyst Filter */}
          <select
            value={selectedAnalystId || ''}
            onChange={(e) => setSelectedAnalystId(e.target.value || null)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Analysts</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>
                {u.first_name || u.last_name
                  ? `${u.first_name || ''} ${u.last_name || ''}`.trim()
                  : u.email.split('@')[0]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* If a specific analyst is selected, show their detailed card */}
      {selectedAnalystId ? (
        <div className="space-y-6">
          <AnalystPerformanceCard
            userId={selectedAnalystId}
            periodType={periodType}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Leaderboard */}
          <PerformanceLeaderboard limit={20} />

          {/* Individual Cards for Top Analysts */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Users className="w-3.5 h-3.5" />
              Individual Performance
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {users.slice(0, 6).map(u => (
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
// Decisions View Component
// ============================================================

function DecisionsView({ onItemSelect }: { onItemSelect?: (item: any) => void }) {
  const [filters, setFilters] = useState<Partial<OutcomeFilters>>({
    showApproved: true,
    showRejected: false,
    showArchived: false,
  })

  const { data: decisions, isLoading, isError, refetch } = useOutcomeDecisions({ filters })
  const summary = useOutcomeSummary(decisions)

  const groupedDecisions = useMemo(() => {
    const approved = decisions.filter(d => d.stage === 'approved')
    const rejected = decisions.filter(d => d.stage === 'rejected')
    const archived = decisions.filter(d => d.stage === 'cancelled')
    return { approved, rejected, archived }
  }, [decisions])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Summary Stats + Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-semibold text-gray-900">Decision Ledger</h2>
            <Badge variant="secondary" className="ml-2">{decisions.length}</Badge>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-gray-600">
                <span className="font-semibold text-gray-900">{summary.approvedCount}</span> Approved
              </span>
            </div>
            {summary.rejectedCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="text-gray-600">
                  <span className="font-semibold text-gray-900">{summary.rejectedCount}</span> Rejected
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-gray-600">
                <span className="font-semibold text-gray-900">{summary.pendingExecutionCount}</span> Pending
              </span>
            </div>
          </div>
        </div>

        <FilterBar filters={filters} onFiltersChange={setFilters} />
      </div>

      {/* Decision Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
        </div>
      ) : isError ? (
        <Card className="p-6">
          <div className="flex items-center gap-3 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span>Failed to load decisions. Please try again.</span>
            <button onClick={() => refetch()} className="ml-2 text-sm underline">Retry</button>
          </div>
        </Card>
      ) : decisions.length === 0 ? (
        <Card className="p-6">
          <div className="flex flex-col items-center justify-center text-center py-8">
            <div className="p-4 bg-gray-100 rounded-full mb-4">
              <CheckCircle2 className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No decisions yet</h3>
            <p className="text-sm text-gray-500 max-w-md">
              When trade ideas are approved from the Deciding stage, they will appear here
              with their frozen rationale and decision details.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupedDecisions.approved.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                Approved ({groupedDecisions.approved.length})
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {groupedDecisions.approved.map(decision => (
                  <DecisionCard
                    key={decision.decision_id}
                    decision={decision}
                    onSelect={() => onItemSelect?.(decision)}
                  />
                ))}
              </div>
            </div>
          )}

          {groupedDecisions.rejected.length > 0 && (
            <div className="mt-6">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                <XCircle className="w-3.5 h-3.5 text-red-500" />
                Rejected ({groupedDecisions.rejected.length})
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {groupedDecisions.rejected.map(decision => (
                  <DecisionCard
                    key={decision.decision_id}
                    decision={decision}
                    onSelect={() => onItemSelect?.(decision)}
                  />
                ))}
              </div>
            </div>
          )}

          {groupedDecisions.archived.length > 0 && (
            <div className="mt-6">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-gray-400" />
                Archived ({groupedDecisions.archived.length})
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 opacity-60">
                {groupedDecisions.archived.map(decision => (
                  <DecisionCard
                    key={decision.decision_id}
                    decision={decision}
                    onSelect={() => onItemSelect?.(decision)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Main Page Component
// ============================================================

export function OutcomesPage({ onItemSelect }: OutcomesPageProps) {
  const [activeTab, setActiveTab] = useState<OutcomesSubTab>('decisions')

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Target className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Outcomes</h1>
              <p className="text-sm text-gray-500">What happened after decisions were made</p>
            </div>
          </div>
        </div>

        {/* Sub-Tab Navigation */}
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
        {activeTab === 'decisions' && <DecisionsView onItemSelect={onItemSelect} />}
        {activeTab === 'scorecards' && <ScorecardsView />}
      </div>
    </div>
  )
}
