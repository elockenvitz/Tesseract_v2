import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, Search, Filter, Plus, Calendar, ArrowUpDown, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Select } from '../components/ui/Select'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface PortfoliosListPageProps {
  onPortfolioSelect?: (portfolio: any) => void
}

export function PortfoliosListPage({ onPortfolioSelect }: PortfoliosListPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)

  // Fetch all portfolios (notes removed from select)
  const { data: portfolios, isLoading } = useQuery({
    queryKey: ['all-portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select(`
          *,
          portfolio_holdings(id, shares, cost)
        `)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // Filter and sort portfolios
  const filteredPortfolios = useMemo(() => {
    if (!portfolios) return []

    let filtered = portfolios.filter((portfolio) => {
      const matchesSearch =
        !searchQuery ||
        portfolio.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (portfolio.description && portfolio.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (portfolio.benchmark && portfolio.benchmark.toLowerCase().includes(searchQuery.toLowerCase()))
      return matchesSearch
    })

    filtered.sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortBy) {
        case 'name':
          aValue = a.name
          bValue = b.name
          break
        case 'benchmark':
          aValue = a.benchmark || ''
          bValue = b.benchmark || ''
          break
        case 'holdings_count':
          aValue = a.portfolio_holdings?.length || 0
          bValue = b.portfolio_holdings?.length || 0
          break
        case 'created_at':
          aValue = new Date(a.created_at || 0).getTime()
          bValue = new Date(b.created_at || 0).getTime()
          break
        case 'updated_at':
        default:
          aValue = new Date(a.updated_at || 0).getTime()
          bValue = new Date(b.updated_at || 0).getTime()
          break
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
      }
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    })

    return filtered
  }, [portfolios, searchQuery, sortBy, sortOrder])

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const handlePortfolioClick = (portfolio: any) => {
    onPortfolioSelect?.({
      id: portfolio.id,
      title: portfolio.portfolio_id || portfolio.name,
      type: 'portfolio',
      data: portfolio,
    })
  }

  const clearFilters = () => {
    setSearchQuery('')
    setSortBy('updated_at')
    setSortOrder('desc')
  }

  const activeFiltersCount = [searchQuery].filter(Boolean).length

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Portfolios</h1>
          <p className="text-gray-600">
            {filteredPortfolios.length} of {portfolios?.length || 0} portfolios
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by portfolio name, description, or benchmark..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Filter Toggle */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <Badge variant="primary" size="sm">
                  {activeFiltersCount}
                </Badge>
              )}
              <ChevronDown
                className={clsx('h-4 w-4 transition-transform', showFilters && 'rotate-180')}
              />
            </button>

            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-primary-600 hover:text-primary-700 transition-colors"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Filter Controls */}
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
              <Select
                label="Sort by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                options={[
                  { value: 'updated_at', label: 'Last Updated' },
                  { value: 'created_at', label: 'Date Created' },
                  { value: 'name', label: 'Portfolio Name' },
                  { value: 'benchmark', label: 'Benchmark' },
                  { value: 'holdings_count', label: 'Holdings Count' },
                ]}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Portfolios List */}
      <Card padding="none">
        {isLoading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-16"></div>
                      <div className="h-3 bg-gray-200 rounded w-12"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : filteredPortfolios.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {/* Table Header */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-5">
                  <button
                    onClick={() => handleSort('name')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Portfolio</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-3">
                  <button
                    onClick={() => handleSort('benchmark')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Benchmark</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('holdings_count')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Holdings</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('updated_at')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Last Updated</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Portfolio Rows */}
            {filteredPortfolios.map((portfolio) => (
              <div
                key={portfolio.id}
                onClick={() => handlePortfolioClick(portfolio)}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="grid grid-cols-12 gap-4 items-center">
                  {/* Portfolio Info */}
                  <div className="col-span-5">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-success-500 to-success-600 rounded-lg flex items-center justify-center">
                        <Briefcase className="h-5 w-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {portfolio.name}
                        </p>
                        {portfolio.description && (
                          <p className="text-sm text-gray-600 truncate">
                            {portfolio.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Benchmark */}
                  <div className="col-span-3">
                    {portfolio.benchmark ? (
                      <span className="text-sm text-gray-900">{portfolio.benchmark}</span>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </div>

                  {/* Holdings Count */}
                  <div className="col-span-2">
                    <div className="flex items-center text-sm text-gray-500">
                      <Briefcase className="h-3 w-3 mr-1" />
                      {portfolio.portfolio_holdings?.length || 0}
                    </div>
                  </div>

                  {/* Last Updated */}
                  <div className="col-span-2">
                    <div className="flex items-center text-sm text-gray-500">
                      <Calendar className="h-3 w-3 mr-1" />
                      {formatDistanceToNow(new Date(portfolio.updated_at || ''), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Briefcase className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {portfolios?.length === 0 ? 'No portfolios yet' : 'No portfolios match your filters'}
            </h3>
            <p className="text-gray-500 mb-4">
              {portfolios?.length === 0
                ? 'Start by creating your first portfolio to track your investments.'
                : 'Try adjusting your search criteria or clearing filters.'}
            </p>
            {portfolios?.length === 0 && (
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add First Portfolio
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
