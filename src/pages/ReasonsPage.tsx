import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  MessageSquareText, Search, Filter, Plus, ChevronDown,
  TrendingUp, TrendingDown, Minus, Calendar, User, Tag,
  ThumbsUp, ThumbsDown, MoreHorizontal, Clock, Target,
  Briefcase, ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { formatDistanceToNow } from 'date-fns'

interface ReasonsPageProps {
  onItemSelect?: (item: any) => void
}

interface Reason {
  id: string
  asset_id?: string
  asset?: {
    symbol: string
    company_name: string
  }
  portfolio_id?: string
  portfolio?: {
    name: string
  }
  direction: 'bull' | 'bear' | 'neutral'
  category: 'fundamental' | 'technical' | 'macro' | 'sentiment' | 'catalyst'
  title: string
  content: string
  conviction: 'high' | 'medium' | 'low'
  created_by: string
  created_at: string
  updated_at: string
  tags?: string[]
  user?: {
    first_name: string
    last_name: string
  }
}

type ViewType = 'all' | 'bull' | 'bear'
type CategoryFilter = 'all' | 'fundamental' | 'technical' | 'macro' | 'sentiment' | 'catalyst'

export function ReasonsPage({ onItemSelect }: ReasonsPageProps) {
  const [activeView, setActiveView] = useState<ViewType>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)

  // Query reasons from database (placeholder - table needs to be created)
  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ['reasons', activeView, categoryFilter],
    queryFn: async () => {
      // TODO: Implement once reasons table is created
      // For now, return empty array
      return [] as Reason[]
    }
  })

  const filteredReasons = reasons.filter(reason => {
    if (activeView !== 'all' && reason.direction !== activeView) return false
    if (categoryFilter !== 'all' && reason.category !== categoryFilter) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        reason.title.toLowerCase().includes(query) ||
        reason.content.toLowerCase().includes(query) ||
        reason.asset?.symbol?.toLowerCase().includes(query) ||
        reason.asset?.company_name?.toLowerCase().includes(query)
      )
    }
    return true
  })

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case 'bull':
        return <TrendingUp className="w-4 h-4 text-green-500" />
      case 'bear':
        return <TrendingDown className="w-4 h-4 text-red-500" />
      default:
        return <Minus className="w-4 h-4 text-gray-400" />
    }
  }

  const getDirectionColor = (direction: string) => {
    switch (direction) {
      case 'bull':
        return 'bg-green-50 border-green-200 text-green-700'
      case 'bear':
        return 'bg-red-50 border-red-200 text-red-700'
      default:
        return 'bg-gray-50 border-gray-200 text-gray-700'
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'fundamental':
        return 'bg-blue-100 text-blue-700'
      case 'technical':
        return 'bg-purple-100 text-purple-700'
      case 'macro':
        return 'bg-orange-100 text-orange-700'
      case 'sentiment':
        return 'bg-pink-100 text-pink-700'
      case 'catalyst':
        return 'bg-yellow-100 text-yellow-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const getConvictionBadge = (conviction: string) => {
    switch (conviction) {
      case 'high':
        return <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">High</span>
      case 'medium':
        return <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">Medium</span>
      case 'low':
        return <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Low</span>
      default:
        return null
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <MessageSquareText className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Reasons</h1>
              <p className="text-sm text-gray-500">Document and track investment theses</p>
            </div>
          </div>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Reason
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {/* Direction Filter */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setActiveView('all')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeView === 'all'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setActiveView('bull')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center space-x-1 ${
                  activeView === 'bull'
                    ? 'bg-white text-green-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Bull</span>
              </button>
              <button
                onClick={() => setActiveView('bear')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center space-x-1 ${
                  activeView === 'bear'
                    ? 'bg-white text-red-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                <span>Bear</span>
              </button>
            </div>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Categories</option>
              <option value="fundamental">Fundamental</option>
              <option value="technical">Technical</option>
              <option value="macro">Macro</option>
              <option value="sentiment">Sentiment</option>
              <option value="catalyst">Catalyst</option>
            </select>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search reasons..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : filteredReasons.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="p-4 bg-gray-100 rounded-full mb-4">
              <MessageSquareText className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No reasons yet</h3>
            <p className="text-sm text-gray-500 mb-4">
              Start documenting your investment theses and reasoning
            </p>
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Reason
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredReasons.map(reason => (
              <Card
                key={reason.id}
                className={`p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 ${getDirectionColor(reason.direction)}`}
                onClick={() => onItemSelect?.(reason)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    {getDirectionIcon(reason.direction)}
                    {reason.asset && (
                      <span className="font-semibold text-gray-900">{reason.asset.symbol}</span>
                    )}
                    {reason.portfolio && (
                      <span className="flex items-center text-sm text-gray-600">
                        <Briefcase className="w-3.5 h-3.5 mr-1" />
                        {reason.portfolio.name}
                      </span>
                    )}
                  </div>
                  {getConvictionBadge(reason.conviction)}
                </div>

                <h3 className="font-medium text-gray-900 mb-2">{reason.title}</h3>
                <p className="text-sm text-gray-600 line-clamp-3 mb-3">{reason.content}</p>

                <div className="flex items-center justify-between">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${getCategoryColor(reason.category)}`}>
                    {reason.category}
                  </span>
                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatDistanceToNow(new Date(reason.created_at), { addSuffix: true })}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add Reason Modal - Placeholder */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowAddModal(false)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Reason</h2>
              <p className="text-sm text-gray-500 mb-4">
                This feature is coming soon. You'll be able to document your investment theses here.
              </p>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setShowAddModal(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
