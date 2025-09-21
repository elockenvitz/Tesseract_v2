import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Search, Filter, Plus, Calendar, Target, FileText, ArrowUpDown, ChevronDown, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { financialDataService } from '../lib/financial-data/browser-client'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Select } from '../components/ui/Select'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface AssetsListPageProps {
  onAssetSelect?: (asset: any) => void
}

export function AssetsListPage({ onAssetSelect }: AssetsListPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [sectorFilter, setSectorFilter] = useState('all')
  const [sortBy, setSortBy] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)

  // Fetch all assets
  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['all-assets'],
    queryFn: async () => {
      console.log('🔍 Fetching all assets from database...')
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) {
        console.error('❌ Failed to fetch all assets:', error)
        throw error
      }

      console.log('✅ All assets fetched:', data?.length || 0, 'records')
      return data || []
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on focus
  })

  // Fetch financial data for all assets (lazy load)
  const { data: financialData, isLoading: financialDataLoading } = useQuery({
    queryKey: ['assets-financial-data', assets?.map(a => a.symbol)],
    queryFn: async () => {
      return {} // Return empty initially, load on demand
    },
    enabled: false, // Disable automatic fetching
    staleTime: 60000, // Cache for 1 minute
  })

  // Get unique sectors for filter
  const sectors = useMemo(() => {
    if (!assets) return []
    const uniqueSectors = [...new Set(assets.map(asset => asset.sector).filter(Boolean))]
    return uniqueSectors.sort()
  }, [assets])

  // Filter and sort assets
  const filteredAssets = useMemo(() => {
    if (!assets) return []

    let filtered = assets

    // Apply filters only if they're set (avoid unnecessary work)
    if (searchQuery || priorityFilter !== 'all' || stageFilter !== 'all' || sectorFilter !== 'all') {
      filtered = assets.filter(asset => {
        // Search filter
        if (searchQuery) {
          const searchLower = searchQuery.toLowerCase()
          const matchesSearch =
            asset.symbol.toLowerCase().includes(searchLower) ||
            asset.company_name.toLowerCase().includes(searchLower) ||
            (asset.sector && asset.sector.toLowerCase().includes(searchLower))
          if (!matchesSearch) return false
        }

        // Priority filter
        if (priorityFilter !== 'all' && asset.priority !== priorityFilter) return false

        // Stage filter
        if (stageFilter !== 'all' && asset.process_stage !== stageFilter) return false

        // Sector filter
        if (sectorFilter !== 'all' && asset.sector !== sectorFilter) return false

        return true
      })
    }

    // Sort assets only if not default sort
    if (sortBy !== 'updated_at' || sortOrder !== 'desc') {
      filtered = [...filtered].sort((a, b) => {
        let aValue, bValue

        switch (sortBy) {
          case 'symbol':
            aValue = a.symbol
            bValue = b.symbol
            break
          case 'company_name':
            aValue = a.company_name
            bValue = b.company_name
            break
          case 'current_price':
            aValue = a.current_price || 0
            bValue = b.current_price || 0
            break
          case 'priority':
            const priorityOrder = { high: 4, medium: 3, low: 2, none: 1 }
            aValue = priorityOrder[a.priority as keyof typeof priorityOrder] || 0
            bValue = priorityOrder[b.priority as keyof typeof priorityOrder] || 0
            break
          case 'process_stage':
            const stageOrder = {
              outdated: 1, prioritized: 2, in_progress: 3,
              recommend: 4, review: 5, action: 6, monitor: 7
            }
            aValue = stageOrder[a.process_stage as keyof typeof stageOrder] || 0
            bValue = stageOrder[b.process_stage as keyof typeof stageOrder] || 0
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
          return sortOrder === 'asc'
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue)
        }

        return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
      })
    }

    return filtered
  }, [assets, searchQuery, priorityFilter, stageFilter, sectorFilter, sortBy, sortOrder])

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case 'high': return 'error'
      case 'medium': return 'warning'
      case 'low': return 'success'
      case 'none': return 'default'
      default: return 'default'
    }
  }

  const getStageColor = (stage: string | null) => {
    switch (stage) {
      case 'outdated': return 'default'
      case 'prioritized': return 'warning'
      case 'in_progress': return 'primary'
      case 'recommend': return 'warning'
      case 'review': return 'success'
      case 'action': return 'success'
      case 'monitor': return 'default'
      // Legacy mappings
      case 'research': return 'primary'
      case 'analysis': return 'warning'
      case 'monitoring': return 'success'
      case 'archived': return 'default'
      default: return 'default'
    }
  }

  const getStageLabel = (stage: string | null) => {
    switch (stage) {
      case 'outdated': return 'Outdated'
      case 'prioritized': return 'Prioritize'
      case 'in_progress': return 'Research'
      case 'recommend': return 'Recommend'
      case 'review': return 'Review'
      case 'action': return 'Action'
      case 'monitor': return 'Monitor'
      // Legacy mappings
      case 'research': return 'Prioritize'
      case 'analysis': return 'Prioritize'
      case 'monitoring': return 'Monitor'
      case 'archived': return 'Action'
      default: return stage || 'Research'
    }
  }

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const handleAssetClick = (asset: any) => {
    if (onAssetSelect) {
      onAssetSelect({
        id: asset.id,
        title: asset.symbol,
        type: 'asset',
        data: asset
      })
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setPriorityFilter('all')
    setStageFilter('all')
    setSectorFilter('all')
    setSortBy('updated_at')
    setSortOrder('desc')
  }

  const activeFiltersCount = [
    searchQuery,
    priorityFilter !== 'all' ? priorityFilter : null,
    stageFilter !== 'all' ? stageFilter : null,
    sectorFilter !== 'all' ? sectorFilter : null
  ].filter(Boolean).length

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Assets</h1>
          <p className="text-gray-600">
            {filteredAssets.length} of {assets?.length || 0} assets
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
              placeholder="Search by symbol, company name, or sector..."
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
              <ChevronDown className={clsx(
                'h-4 w-4 transition-transform',
                showFilters && 'rotate-180'
              )} />
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
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
              <Select
                label="Priority"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Priorities' },
                  { value: 'none', label: 'No Priority Set' },
                  { value: 'high', label: 'High Priority' },
                  { value: 'medium', label: 'Medium Priority' },
                  { value: 'low', label: 'Low Priority' }
                ]}
              />

              <Select
                label="Stage"
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Stages' },
                  { value: 'outdated', label: 'Outdated' },
                  { value: 'prioritized', label: 'Prioritize' },
                  { value: 'in_progress', label: 'Research' },
                  { value: 'recommend', label: 'Recommend' },
                  { value: 'review', label: 'Review' },
                  { value: 'action', label: 'Action' },
                  { value: 'monitor', label: 'Monitor' }
                ]}
              />

              <Select
                label="Sector"
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Sectors' },
                  ...sectors.map(sector => ({ value: sector, label: sector }))
                ]}
              />

              <Select
                label="Sort by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                options={[
                  { value: 'updated_at', label: 'Last Updated' },
                  { value: 'created_at', label: 'Date Created' },
                  { value: 'symbol', label: 'Symbol' },
                  { value: 'company_name', label: 'Company Name' },
                  { value: 'current_price', label: 'Price' },
                  { value: 'priority', label: 'Priority' },
                  { value: 'process_stage', label: 'Stage' }
                ]}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Assets List */}
      <Card padding="none">
        {assetsLoading ? (
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
        ) : filteredAssets.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {/* Table Header */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-4">
                  <button
                    onClick={() => handleSort('symbol')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Asset</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('current_price')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Price</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('priority')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Priority</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('process_stage')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Stage</span>
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

            {/* Assets Rows */}
            {filteredAssets.map((asset) => (
              <div
                key={asset.id}
                onClick={() => handleAssetClick(asset)}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="grid grid-cols-12 gap-4 items-center">
                  {/* Asset Info */}
                  <div className="col-span-4">
                    <div className="flex items-center space-x-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {asset.symbol}
                          </p>
                          {asset.price_targets?.length > 0 && (
                            <Target className="h-3 w-3 text-gray-400" />
                          )}
                          {asset.asset_notes?.length > 0 && (
                            <div className="flex items-center">
                              <FileText className="h-3 w-3 text-gray-400" />
                              <span className="text-xs text-gray-500 ml-1">
                                {asset.asset_notes.length}
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 truncate">
                          {asset.company_name}
                        </p>
                        {asset.sector && (
                          <p className="text-xs text-gray-500 truncate">
                            {asset.sector}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="col-span-2">
                    {asset.current_price ? (
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          ${asset.current_price}
                        </p>
                        <p className="text-xs text-gray-500">
                          Last saved
                        </p>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </div>

                  {/* Priority */}
                  <div className="col-span-2">
                    <Badge variant={getPriorityColor(asset.priority)} size="sm">
                      {asset.priority || 'medium'}
                    </Badge>
                  </div>

                  {/* Stage */}
                  <div className="col-span-2">
                    <Badge variant={getStageColor(asset.process_stage)} size="sm">
                      {getStageLabel(asset.process_stage)}
                    </Badge>
                  </div>

                  {/* Last Updated */}
                  <div className="col-span-2">
                    <div className="flex items-center text-sm text-gray-500">
                      <Calendar className="h-3 w-3 mr-1" />
                      {formatDistanceToNow(new Date(asset.updated_at || 0), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <TrendingUp className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {assets?.length === 0 ? 'No assets yet' : 'No assets match your filters'}
            </h3>
            <p className="text-gray-500 mb-4">
              {assets?.length === 0 
                ? 'Start by adding your first investment idea.'
                : 'Try adjusting your search criteria or clearing filters.'
              }
            </p>
            {assets?.length === 0 && (
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add First Asset
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}