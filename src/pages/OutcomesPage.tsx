import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Target, Search, Filter, ChevronDown, Clock, User, Users,
  CheckCircle2, FileText, TrendingUp, TrendingDown, Briefcase,
  Calendar, Eye, AlertCircle, BarChart3
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { formatDistanceToNow, format } from 'date-fns'
import type { TradeQueueItemWithDetails } from '../types/trading'

interface OutcomesPageProps {
  onItemSelect?: (item: any) => void
}

type ViewFilter = 'all' | 'recent' | 'pending'

export function OutcomesPage({ onItemSelect }: OutcomesPageProps) {
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Query approved trade ideas (decisions that have been made)
  const { data: approvedTrades = [], isLoading } = useQuery({
    queryKey: ['outcomes', 'approved-trades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          approved_by_user:approved_by (id, email, first_name, last_name)
        `)
        .eq('status', 'approved')
        .order('approved_at', { ascending: false })

      if (error) throw error
      return data as (TradeQueueItemWithDetails & { approved_by_user?: { id: string; email: string; first_name: string | null; last_name: string | null } })[]
    }
  })

  const filteredTrades = approvedTrades.filter(trade => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        trade.assets?.symbol?.toLowerCase().includes(query) ||
        trade.assets?.company_name?.toLowerCase().includes(query) ||
        trade.rationale?.toLowerCase().includes(query) ||
        trade.thesis_summary?.toLowerCase().includes(query)
      )
    }
    return true
  })

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'buy':
      case 'add':
        return <TrendingUp className="w-4 h-4 text-green-500" />
      case 'sell':
      case 'trim':
        return <TrendingDown className="w-4 h-4 text-red-500" />
      default:
        return <Target className="w-4 h-4 text-gray-400" />
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'buy':
      case 'add':
        return 'bg-green-50 border-green-200 text-green-700'
      case 'sell':
      case 'trim':
        return 'bg-red-50 border-red-200 text-red-700'
      default:
        return 'bg-gray-50 border-gray-200 text-gray-700'
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
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-2">
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

        {/* Filters */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center space-x-2">
            {/* View Filter */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewFilter('all')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  viewFilter === 'all'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All Decisions
              </button>
              <button
                onClick={() => setViewFilter('recent')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  viewFilter === 'recent'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Recent
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search outcomes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        ) : filteredTrades.length === 0 ? (
          <div className="space-y-6">
            {/* Empty state for Decision Summary */}
            <Card className="p-6">
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className="p-4 bg-gray-100 rounded-full mb-4">
                  <CheckCircle2 className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-1">No approved decisions yet</h3>
                <p className="text-sm text-gray-500 max-w-md">
                  When trade ideas are approved from the Deciding stage, they will appear here with their frozen rationale and decision details.
                </p>
              </div>
            </Card>

            {/* Execution Placeholder */}
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-50 rounded-lg flex-shrink-0">
                  <Eye className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Execution</h3>
                  <p className="text-sm text-gray-500">
                    Execution details will appear here when position changes are detected.
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Tesseract observes position changes from your portfolio data - it does not execute trades directly.
                  </p>
                </div>
              </div>
            </Card>

            {/* Results / Learning Placeholder */}
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-purple-50 rounded-lg flex-shrink-0">
                  <BarChart3 className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Results & Learning</h3>
                  <p className="text-sm text-gray-500">
                    Performance and post-trade analysis will appear here.
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Track how decisions played out and capture lessons for future reference.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Decision Summary Section */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <h2 className="text-lg font-semibold text-gray-900">Approved Decisions</h2>
                <Badge variant="secondary" className="ml-2">{filteredTrades.length}</Badge>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredTrades.map(trade => (
                  <Card
                    key={trade.id}
                    className={`p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 ${getActionColor(trade.action)}`}
                    onClick={() => onItemSelect?.(trade)}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {getActionIcon(trade.action)}
                        <span className="font-semibold text-gray-900 uppercase text-sm">
                          {trade.action}
                        </span>
                        {trade.assets && (
                          <span className="font-bold text-gray-900">{trade.assets.symbol}</span>
                        )}
                      </div>
                      <Badge variant="default" className="bg-emerald-100 text-emerald-700 border-emerald-200">
                        Approved
                      </Badge>
                    </div>

                    {/* Asset Info */}
                    {trade.assets && (
                      <p className="text-sm text-gray-600 mb-2">{trade.assets.company_name}</p>
                    )}

                    {/* Frozen Rationale */}
                    {trade.thesis_summary && (
                      <div className="mb-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <FileText className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Decision Rationale</span>
                        </div>
                        <p className="text-sm text-gray-700 line-clamp-2">{trade.thesis_summary}</p>
                      </div>
                    )}

                    {/* Decision Details */}
                    <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-3">
                        {/* Approval timestamp */}
                        {trade.approved_at && (
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            <span>{format(new Date(trade.approved_at), 'MMM d, yyyy')}</span>
                          </div>
                        )}
                        {/* Decision owner */}
                        {trade.approved_by_user && (
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            <span>{formatUserName(trade.approved_by_user)}</span>
                          </div>
                        )}
                      </div>
                      {/* Portfolio */}
                      {trade.portfolios && (
                        <div className="flex items-center gap-1">
                          <Briefcase className="w-3 h-3" />
                          <span>{trade.portfolios.name}</span>
                        </div>
                      )}
                    </div>

                    {/* Execution Status Placeholder */}
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <Eye className="w-3.5 h-3.5" />
                        <span>Awaiting position change detection</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {/* Execution Section Placeholder */}
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-50 rounded-lg flex-shrink-0">
                  <Eye className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Execution</h3>
                  <p className="text-sm text-gray-500">
                    Execution details will appear here when position changes are detected.
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Tesseract observes position changes from your portfolio data - it does not execute trades directly.
                  </p>
                </div>
              </div>
            </Card>

            {/* Results / Learning Section Placeholder */}
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-purple-50 rounded-lg flex-shrink-0">
                  <BarChart3 className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Results & Learning</h3>
                  <p className="text-sm text-gray-500">
                    Performance and post-trade analysis will appear here.
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Track how decisions played out and capture lessons for future reference.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
