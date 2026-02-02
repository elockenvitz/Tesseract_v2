/**
 * Trade Plan History Page
 *
 * Comprehensive view of Trade Plans with filtering and discovery.
 * - Portfolio selector
 * - Date range filter (default last 30 days)
 * - Status/Creator/Source view filters
 * - Tabs: All Plans, Created by Me, Collaborative, Pending My Approval
 */

import React, { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FileText,
  Search,
  Filter,
  Calendar,
  User,
  Briefcase,
  ChevronDown,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  AlertCircle,
  Eye,
  Layers,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/common/Toast'
import {
  useTradePlans,
  useTradePlanHistory,
  usePlanStats,
  useTradePlan,
} from '../hooks/useTradeLab'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/common/EmptyState'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { clsx } from 'clsx'
import type { TradePlanWithDetails, TradePlanStatus } from '../lib/services/trade-plan-service'

// ============================================================================
// Status Configuration
// ============================================================================

const STATUS_CONFIG: Record<TradePlanStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft: {
    label: 'Draft',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    icon: FileText,
  },
  pending_approval: {
    label: 'Pending Approval',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    icon: Clock,
  },
  approved: {
    label: 'Approved',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    icon: CheckCircle2,
  },
  rejected: {
    label: 'Rejected',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    icon: XCircle,
  },
  sent_to_desk: {
    label: 'Sent to Desk',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    icon: Send,
  },
  acknowledged: {
    label: 'Acknowledged',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    icon: CheckCircle2,
  },
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateInput(date: Date): string {
  return date.toISOString().split('T')[0]
}

function getDefaultDateRange(): { startDate: string; endDate: string } {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    startDate: formatDateInput(thirtyDaysAgo),
    endDate: formatDateInput(now),
  }
}

function getUserDisplayName(user: { first_name: string | null; last_name: string | null; email: string } | undefined): string {
  if (!user) return 'Unknown'
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return name || user.email
}

// ============================================================================
// Components
// ============================================================================

interface PlanCardProps {
  plan: TradePlanWithDetails
  onSelect: (planId: string) => void
}

function PlanCard({ plan, onSelect }: PlanCardProps) {
  const statusConfig = STATUS_CONFIG[plan.status]
  const StatusIcon = statusConfig.icon
  const itemCount = plan.trade_plan_items?.length || 0

  return (
    <Card
      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
      onClick={() => onSelect(plan.id)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
              {plan.name}
            </h3>
            <Badge className={clsx('flex items-center gap-1', statusConfig.color)}>
              <StatusIcon className="h-3 w-3" />
              {statusConfig.label}
            </Badge>
          </div>

          {/* Description */}
          {plan.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
              {plan.description}
            </p>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              {plan.portfolios?.name || 'Unknown Portfolio'}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {getUserDisplayName(plan.users)}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(plan.created_at)}
            </span>
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {itemCount} trade{itemCount !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Desk Reference if sent */}
          {plan.desk_reference && (
            <div className="mt-2">
              <Badge variant="outline" className="text-xs">
                Ref: {plan.desk_reference}
              </Badge>
            </div>
          )}
        </div>

        {/* Value Summary */}
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            ${((plan.snapshot_total_value || 0) / 1000000).toFixed(2)}M
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Total Value
          </div>
        </div>
      </div>

      {/* Trade Preview */}
      {plan.trade_plan_items && plan.trade_plan_items.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex flex-wrap gap-2">
            {plan.trade_plan_items.slice(0, 5).map((item) => (
              <Badge
                key={item.id}
                variant="outline"
                className={clsx(
                  'text-xs',
                  item.action === 'buy' || item.action === 'add'
                    ? 'border-green-300 text-green-700 dark:border-green-600 dark:text-green-400'
                    : item.action === 'sell' || item.action === 'trim'
                    ? 'border-red-300 text-red-700 dark:border-red-600 dark:text-red-400'
                    : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-400'
                )}
              >
                {item.action === 'buy' || item.action === 'add' ? (
                  <ArrowUpRight className="h-3 w-3 mr-1" />
                ) : item.action === 'sell' || item.action === 'trim' ? (
                  <ArrowDownRight className="h-3 w-3 mr-1" />
                ) : (
                  <Minus className="h-3 w-3 mr-1" />
                )}
                {item.asset_symbol}
              </Badge>
            ))}
            {plan.trade_plan_items.length > 5 && (
              <Badge variant="outline" className="text-xs text-gray-500">
                +{plan.trade_plan_items.length - 5} more
              </Badge>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

interface PlanDetailPanelProps {
  planId: string
  onClose: () => void
}

function PlanDetailPanel({ planId, onClose }: PlanDetailPanelProps) {
  const { data: plan, isLoading } = useTradePlan(planId)

  if (isLoading) {
    return (
      <div className="p-6">
        <ListSkeleton count={3} />
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FileText}
          title="Plan not found"
          description="This plan may have been deleted or you don't have access."
        />
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[plan.status]
  const StatusIcon = statusConfig.icon

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {plan.name}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ×
          </Button>
        </div>
        <Badge className={clsx('mt-2 flex items-center gap-1 w-fit', statusConfig.color)}>
          <StatusIcon className="h-3 w-3" />
          {statusConfig.label}
        </Badge>
      </div>

      {/* Content */}
      <div className="p-4 space-y-6">
        {/* Description */}
        {plan.description && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {plan.description}
            </p>
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Portfolio
            </h4>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              {plan.portfolios?.name || 'Unknown'}
            </p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Created By
            </h4>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              {getUserDisplayName(plan.users)}
            </p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Created
            </h4>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              {formatDate(plan.created_at)}
            </p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Total Value
            </h4>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              ${((plan.snapshot_total_value || 0) / 1000000).toFixed(2)}M
            </p>
          </div>
        </div>

        {/* Approval Info */}
        {plan.status === 'pending_approval' && plan.trade_plan_approvers && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Pending Approvers
            </h4>
            <div className="space-y-2">
              {plan.trade_plan_approvers.map((approver) => (
                <div
                  key={approver.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <User className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-600 dark:text-gray-400">
                    {getUserDisplayName(approver.users)}
                  </span>
                  {approver.decision && (
                    <Badge
                      className={clsx(
                        'ml-auto',
                        approver.decision === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      )}
                    >
                      {approver.decision}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Desk Reference */}
        {plan.desk_reference && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Desk Reference
            </h4>
            <Badge variant="outline">{plan.desk_reference}</Badge>
          </div>
        )}

        {/* Trade Items */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Trades ({plan.trade_plan_items?.length || 0})
          </h4>
          <div className="space-y-2">
            {plan.trade_plan_items?.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={clsx(
                      'text-xs',
                      item.action === 'buy' || item.action === 'add'
                        ? 'border-green-300 text-green-700'
                        : 'border-red-300 text-red-700'
                    )}
                  >
                    {item.action.toUpperCase()}
                  </Badge>
                  <span className="font-medium text-sm">
                    {item.asset_symbol}
                  </span>
                  {item.asset_name && (
                    <span className="text-xs text-gray-500 truncate max-w-[150px]">
                      {item.asset_name}
                    </span>
                  )}
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium">
                    {item.shares.toLocaleString()} shares
                  </div>
                  <div className="text-xs text-gray-500">
                    ${item.estimated_value.toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Page Component
// ============================================================================

type TabType = 'all' | 'mine' | 'collaborative' | 'pending'

export function TradePlanHistoryPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  // State
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  // Date range state (default last 30 days)
  const defaultRange = getDefaultDateRange()
  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)

  // Filter state
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<TradePlanStatus | 'all'>('all')
  const [selectedCreatorId, setSelectedCreatorId] = useState<string>('all')

  // Fetch portfolios for filter
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-for-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data || []
    },
  })

  // Fetch users for creator filter
  const { data: users } = useQuery({
    queryKey: ['users-for-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')
      if (error) throw error
      return data || []
    },
  })

  // Build filter params
  const filterParams = useMemo(() => ({
    portfolioId: selectedPortfolioId !== 'all' ? selectedPortfolioId : undefined,
    status: selectedStatus !== 'all' ? selectedStatus : undefined,
    creatorId: selectedCreatorId !== 'all' ? selectedCreatorId : undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  }), [selectedPortfolioId, selectedStatus, selectedCreatorId, startDate, endDate])

  // Fetch plans based on active tab
  const { plans: allPlans, isLoading: isLoadingAll } = useTradePlans(filterParams)
  const { myPlans, collaborativePlans, pendingApprovals, isLoading: isLoadingHistory } = useTradePlanHistory(filterParams)

  // Get stats for selected portfolio
  const { data: stats } = usePlanStats(selectedPortfolioId !== 'all' ? selectedPortfolioId : undefined)

  // Select plans based on tab
  const displayPlans = useMemo(() => {
    let plans: TradePlanWithDetails[] = []
    switch (activeTab) {
      case 'all':
        plans = allPlans
        break
      case 'mine':
        plans = myPlans
        break
      case 'collaborative':
        plans = collaborativePlans
        break
      case 'pending':
        plans = pendingApprovals
        break
    }

    // Apply search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      plans = plans.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.desk_reference?.toLowerCase().includes(q) ||
          p.portfolios?.name.toLowerCase().includes(q)
      )
    }

    return plans
  }, [activeTab, allPlans, myPlans, collaborativePlans, pendingApprovals, searchQuery])

  const isLoading = activeTab === 'all' ? isLoadingAll : isLoadingHistory

  const handleResetFilters = () => {
    const defaultRange = getDefaultDateRange()
    setStartDate(defaultRange.startDate)
    setEndDate(defaultRange.endDate)
    setSelectedPortfolioId('all')
    setSelectedStatus('all')
    setSelectedCreatorId('all')
    setSearchQuery('')
  }

  const tabs: { key: TabType; label: string; count?: number }[] = [
    { key: 'all', label: 'All Plans', count: allPlans.length },
    { key: 'mine', label: 'Created by Me', count: myPlans.length },
    { key: 'collaborative', label: 'Collaborative', count: collaborativePlans.length },
    { key: 'pending', label: 'Pending My Approval', count: pendingApprovals.length },
  ]

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className={clsx('flex-1 overflow-hidden flex flex-col', selectedPlanId && 'pr-96')}>
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <FileText className="h-6 w-6 text-blue-600" />
                Trade Plans
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                View and track trade plan history across portfolios
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
                {(selectedPortfolioId !== 'all' || selectedStatus !== 'all' || selectedCreatorId !== 'all') && (
                  <Badge className="ml-2 bg-blue-100 text-blue-700">Active</Badge>
                )}
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search plans by name, description, or reference..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filters Panel */}
          {showFilters && (
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg mb-4 space-y-4">
              <div className="grid grid-cols-5 gap-4">
                {/* Portfolio Filter */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Portfolio
                  </label>
                  <select
                    value={selectedPortfolioId}
                    onChange={(e) => setSelectedPortfolioId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                  >
                    <option value="all">All Portfolios</option>
                    {portfolios?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Filter */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Status
                  </label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value as TradePlanStatus | 'all')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                  >
                    <option value="all">All Statuses</option>
                    {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                      <option key={status} value={status}>
                        {config.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Creator Filter */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Created By
                  </label>
                  <select
                    value={selectedCreatorId}
                    onChange={(e) => setSelectedCreatorId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                  >
                    <option value="all">All Users</option>
                    {users?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {getUserDisplayName(u)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    From Date
                  </label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="text-sm"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    To Date
                  </label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={handleResetFilters}>
                  Reset Filters
                </Button>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                )}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={clsx(
                      'ml-2 px-2 py-0.5 text-xs rounded-full',
                      activeTab === tab.key
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Bar (when portfolio selected) */}
        {selectedPortfolioId !== 'all' && stats && (
          <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-6 text-sm">
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-900 dark:text-gray-100">{stats.total}</span> Total
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-medium text-amber-600">{stats.pending}</span> Pending
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-medium text-green-600">{stats.approved}</span> Approved
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-medium text-blue-600">{stats.sent}</span> Sent
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-medium text-purple-600">{stats.acknowledged}</span> Acknowledged
              </span>
            </div>
          </div>
        )}

        {/* Plan List */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <ListSkeleton count={5} />
          ) : displayPlans.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No trade plans found"
              description={
                activeTab === 'pending'
                  ? 'No plans are awaiting your approval.'
                  : activeTab === 'mine'
                  ? 'You haven\'t created any trade plans yet.'
                  : activeTab === 'collaborative'
                  ? 'No collaborative plans found.'
                  : 'No trade plans match your filters. Try adjusting the date range or filters.'
              }
            />
          ) : (
            <div className="space-y-4">
              {displayPlans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onSelect={setSelectedPlanId}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedPlanId && (
        <div className="w-96 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 fixed right-0 top-0 bottom-0 z-20 shadow-xl">
          <PlanDetailPanel
            planId={selectedPlanId}
            onClose={() => setSelectedPlanId(null)}
          />
        </div>
      )}
    </div>
  )
}
