import React, { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { BarChart3, FileText, TrendingUp, Plus, Calendar, User, ArrowLeft, Briefcase, DollarSign, Percent, Users, Trash2, ChevronUp, ChevronDown, MoreVertical, Edit, X, FolderKanban, Globe, Search, Upload, Filter, Check, AlertCircle } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { StockQuote } from '../financial/StockQuote'
import { PortfolioNoteEditor } from '../notes/PortfolioNoteEditorUnified'
import { RelatedProjects } from '../projects/RelatedProjects'
import { supabase } from '../../lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { AddTeamMemberModal } from '../portfolios/AddTeamMemberModal'
import { getContentPreview } from '../../utils/stripHtml'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { TabStateManager } from '../../lib/tabStateManager'

interface PortfolioTabProps {
  portfolio: any
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
}

export function PortfolioTab({ portfolio, onNavigate }: PortfolioTabProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'holdings' | 'performance' | 'notes' | 'team' | 'projects'>(() => {
    const savedState = TabStateManager.loadTabState(portfolio.id)
    return savedState?.activeTab || 'overview'
  })
  const [showNoteEditor, setShowNoteEditor] = useState(() => {
    const savedState = TabStateManager.loadTabState(portfolio.id)
    return savedState?.showNoteEditor || false
  })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(portfolio.id)
    return savedState?.selectedNoteId || null
  })
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const [showAddTeamMemberModal, setShowAddTeamMemberModal] = useState(false)
  const [editingTeamMember, setEditingTeamMember] = useState<any | null>(null)
  const [isTabStateInitialized, setIsTabStateInitialized] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    teamMemberId: string | null
    userName: string
    role: string
  }>({
    isOpen: false,
    teamMemberId: null,
    userName: '',
    role: ''
  })
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null)
  const [selectedDetailTopic, setSelectedDetailTopic] = useState<string | null>(null)
  const [sortColumn, setSortColumn] = useState<string>('symbol')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  // Investable Universe state
  const [universeSearchQuery, setUniverseSearchQuery] = useState('')
  const [showUniverseAssetSearch, setShowUniverseAssetSearch] = useState(false)
  const [showAddFilterModal, setShowAddFilterModal] = useState(false)
  const [newFilterType, setNewFilterType] = useState('sector')
  const [newFilterOperator, setNewFilterOperator] = useState('include')
  const [newFilterValue, setNewFilterValue] = useState('')
  const [marketCapMin, setMarketCapMin] = useState('')
  const [marketCapMax, setMarketCapMax] = useState('')
  const [marketCapOperator, setMarketCapOperator] = useState<'gt' | 'lt' | 'between'>('gt')
  const queryClient = useQueryClient()

  // Update local state when switching to a different portfolio
  useEffect(() => {
    if (portfolio.id) {
      // Restore saved tab state if available
      const savedState = TabStateManager.loadTabState(portfolio.id)
      if (savedState?.activeTab) {
        setActiveTab(savedState.activeTab)
      } else {
        setActiveTab('overview')
      }
      setHasLocalChanges(false)
    }
  }, [portfolio.id])

  // Mark as initialized once portfolio is loaded
  useEffect(() => {
    setIsTabStateInitialized(true)
  }, [])

  // Handle noteId from navigation (e.g., from dashboard note click)
  useEffect(() => {
    if (portfolio.noteId && portfolio.id) {
      console.log('📝 PortfolioTab: Opening note from navigation:', portfolio.noteId)
      setActiveTab('notes')
      setShowNoteEditor(true)
      setSelectedNoteId(portfolio.noteId)
    }
  }, [portfolio.id, portfolio.noteId])

  // Save tab state whenever it changes
  useEffect(() => {
    if (isTabStateInitialized && portfolio.id) {
      const stateToSave = {
        activeTab,
        showNoteEditor,
        selectedNoteId
      }
      TabStateManager.saveTabState(portfolio.id, stateToSave)
    }
  }, [portfolio.id, activeTab, showNoteEditor, selectedNoteId, isTabStateInitialized])

  // NOTES
  const { data: notes } = useQuery({
    queryKey: ['portfolio-notes', portfolio.id],
    enabled: !!portfolio.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_notes')
        .select('*')
        .eq('portfolio_id', portfolio.id)
        .neq('is_deleted', true)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // HOLDINGS
  const { data: holdings } = useQuery({
    queryKey: ['portfolio-holdings', portfolio.id],
    enabled: !!portfolio.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          *,
          assets(
            id,
            symbol,
            company_name,
            sector,
            thesis,
            where_different,
            risks_to_thesis,
            priority,
            process_stage,
            created_at,
            updated_at,
            created_by,
            workflow_id,
            price_targets(type, price, timeframe, reasoning)
          )
        `)
        .eq('portfolio_id', portfolio.id)
        .order('date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // TEAM — inner join to users
  const {
    data: teamWithUsers,
    isLoading: teamLoading,
    refetch: refetchTeamWithUsers,
    error: teamError,
  } = useQuery({
    queryKey: ['portfolio-team-with-users', portfolio.id],
    enabled: !!portfolio.id,
    refetchOnMount: 'always',
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_team')
        .select(`
          id,
          portfolio_id,
          user_id,
          role,
          created_at,
          user:users!inner (
            id,
            email,
            first_name,
            last_name
          )
        `)
        .eq('portfolio_id', portfolio.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data || []).filter(r => r.user !== null)
    },
  })

  // Fetch user profile extended data for team members (sector_focus, investment_style)
  const { data: teamMemberProfiles } = useQuery({
    queryKey: ['team-member-profiles', portfolio.id],
    enabled: !!teamWithUsers && teamWithUsers.length > 0,
    queryFn: async () => {
      const userIds = teamWithUsers?.map((t: any) => t.user_id) || []
      if (userIds.length === 0) return new Map()

      const { data, error } = await supabase
        .from('user_profile_extended')
        .select('user_id, sector_focus, investment_style')
        .in('user_id', userIds)

      if (error) throw error

      // Return as a Map for easy lookup
      const profileMap = new Map<string, { sector_focus: string[], investment_style: string[] }>()
      data?.forEach(profile => {
        profileMap.set(profile.user_id, {
          sector_focus: profile.sector_focus || [],
          investment_style: profile.investment_style || []
        })
      })
      return profileMap
    },
  })

  // INVESTABLE UNIVERSE - Assets explicitly added to universe
  const { data: universeAssets, refetch: refetchUniverseAssets } = useQuery({
    queryKey: ['portfolio-universe-assets', portfolio.id],
    enabled: !!portfolio.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_universe_assets')
        .select(`
          id,
          asset_id,
          notes,
          added_at,
          asset:assets!inner (
            id,
            symbol,
            company_name,
            sector,
            industry
          )
        `)
        .eq('portfolio_id', portfolio.id)
        .order('added_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // UNIVERSE FILTERS - Rule-based inclusion
  const { data: universeFilters, refetch: refetchUniverseFilters } = useQuery({
    queryKey: ['portfolio-universe-filters', portfolio.id],
    enabled: !!portfolio.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_universe_filters')
        .select('*')
        .eq('portfolio_id', portfolio.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // ALL ASSETS - for searching/adding to universe
  const { data: allAssets } = useQuery({
    queryKey: ['all-assets-for-universe'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, country, exchange, market_cap')
        .order('symbol')
      if (error) throw error
      return data || []
    },
  })

  // Compute unique filter options from assets
  const filterOptions = useMemo(() => {
    if (!allAssets) return { sectors: [], industries: [], countries: [], exchanges: [] }

    const sectors = [...new Set(allAssets.map(a => a.sector).filter(Boolean))].sort()
    const industries = [...new Set(allAssets.map(a => a.industry).filter(Boolean))].sort()
    const countries = [...new Set(allAssets.map(a => a.country).filter(Boolean))].sort()
    const exchanges = [...new Set(allAssets.map(a => a.exchange).filter(Boolean))].sort()

    return { sectors, industries, countries, exchanges }
  }, [allAssets])

  // Index options (hardcoded for now)
  const indexOptions = ['S&P 500', 'NASDAQ 100', 'Dow Jones', 'Russell 1000', 'Russell 2000', 'Russell 3000']

  // Compute assets that match filter rules
  const filteredUniverseAssets = useMemo(() => {
    if (!allAssets || !universeFilters || universeFilters.length === 0) return []

    return allAssets.filter(asset => {
      // Asset must pass ALL filters (AND logic)
      return universeFilters.every((filter: any) => {
        const { filter_type, filter_operator, filter_value } = filter

        switch (filter_type) {
          case 'sector':
            if (filter_operator === 'include') return asset.sector === filter_value
            if (filter_operator === 'exclude') return asset.sector !== filter_value
            return true

          case 'industry':
            if (filter_operator === 'include') return asset.industry === filter_value
            if (filter_operator === 'exclude') return asset.industry !== filter_value
            return true

          case 'country':
            if (filter_operator === 'include') return asset.country === filter_value
            if (filter_operator === 'exclude') return asset.country !== filter_value
            return true

          case 'exchange':
            if (filter_operator === 'include') return asset.exchange === filter_value
            if (filter_operator === 'exclude') return asset.exchange !== filter_value
            return true

          case 'market_cap':
            if (!asset.market_cap) return false
            const marketCapInMillions = Number(asset.market_cap) / 1000000 // Convert to millions

            if (filter_operator === 'gt') {
              // Value is like ">500M" - extract number
              const threshold = parseFloat(filter_value.replace(/[>M]/g, ''))
              return marketCapInMillions > threshold
            }
            if (filter_operator === 'lt') {
              const threshold = parseFloat(filter_value.replace(/[<M]/g, ''))
              return marketCapInMillions < threshold
            }
            if (filter_operator === 'between') {
              // Value is like "500M-1000M"
              const [minStr, maxStr] = filter_value.split('-')
              const min = parseFloat(minStr.replace('M', ''))
              const max = parseFloat(maxStr.replace('M', ''))
              return marketCapInMillions >= min && marketCapInMillions <= max
            }
            return true

          case 'index':
            // Index membership would need a separate data source - skip for now
            return true

          default:
            return true
        }
      })
    })
  }, [allAssets, universeFilters])

  // Combined universe: manually added assets + filter-matched assets
  const combinedUniverseAssets = useMemo(() => {
    const manualAssetIds = new Set(universeAssets?.map(ua => ua.asset_id) || [])
    const filterMatchedAssets = filteredUniverseAssets.filter(a => !manualAssetIds.has(a.id))

    return {
      manual: universeAssets || [],
      filtered: filterMatchedAssets,
      total: (universeAssets?.length || 0) + filterMatchedAssets.length
    }
  }, [universeAssets, filteredUniverseAssets])

  // Group team members by role, then by user
  const teamMembersByRole = useMemo(() => {
    if (!teamWithUsers) return {}
    const grouped: { [role: string]: Array<any> } = {}

    for (const row of teamWithUsers as any[]) {
      const role = row.role as string
      if (!grouped[role]) {
        grouped[role] = []
      }

      // Check if this user already exists in this role
      const existingUserIndex = grouped[role].findIndex(
        member => member.user.id === row.user.id
      )

      if (existingUserIndex !== -1) {
        // Keep track of all team record IDs for deletion purposes
        grouped[role][existingUserIndex].teamRecordIds.push(row.id)
      } else {
        // Get profile data for this user
        const profile = teamMemberProfiles?.get(row.user.id)

        // New user for this role
        grouped[role].push({
          id: row.id, // Primary team record ID
          teamRecordIds: [row.id], // Array of all team record IDs
          user: row.user,
          sectorFocus: profile?.sector_focus || [],
          investmentStyle: profile?.investment_style || [],
          created_at: row.created_at,
        })
      }
    }
    return grouped
  }, [teamWithUsers, teamMemberProfiles])

  // Delete team member mutation
  const deleteTeamMemberMutation = useMutation({
    mutationFn: async (teamMemberIds: string) => {
      const ids = teamMemberIds.split(',') // Split comma-separated IDs

      const { error } = await supabase
        .from('portfolio_team')
        .delete()
        .in('id', ids) // Delete all records with these IDs

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users', portfolio.id] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team', portfolio.id] })
      // Also invalidate the org-wide query used by OrganizationPage
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
      setDeleteConfirm({ isOpen: false, teamMemberId: null, userName: '', role: '' })
    },
    onError: (error) => {
      console.error('Failed to delete team member:', error)
      alert(`Error deleting team member: ${error.message}`)
    }
  })

  // Update portfolio (unchanged)
  const updatePortfolioMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase
        .from('portfolios')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', portfolio.id)
      if (error) throw error
      return { ...updates, updated_at: new Date().toISOString() }
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ['all-portfolios'] })
      const previousPortfolios = queryClient.getQueryData(['all-portfolios'])
      queryClient.setQueryData(['all-portfolios'], (oldData: any) => {
        if (!oldData) return oldData
        return oldData.map((p: any) =>
          p.id === portfolio.id ? { ...p, ...updates, updated_at: new Date().toISOString() } : p
        )
      })
      return { previousPortfolios }
    },
    onError: (_err, _updates, context) => {
      if (context?.previousPortfolios) {
        queryClient.setQueryData(['all-portfolios'], context.previousPortfolios)
      }
    },
    onSuccess: (result) => {
      Object.assign(portfolio, result)
      setHasLocalChanges(false)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-portfolios'] })
    },
  })

  // UNIVERSE MUTATIONS
  const addUniverseAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const { error } = await supabase
        .from('portfolio_universe_assets')
        .insert({
          portfolio_id: portfolio.id,
          asset_id: assetId,
        })
      if (error) throw error
    },
    onSuccess: () => {
      refetchUniverseAssets()
    },
  })

  const removeUniverseAssetMutation = useMutation({
    mutationFn: async (universeAssetId: string) => {
      const { error } = await supabase
        .from('portfolio_universe_assets')
        .delete()
        .eq('id', universeAssetId)
      if (error) throw error
    },
    onSuccess: () => {
      refetchUniverseAssets()
    },
  })

  const addUniverseFilterMutation = useMutation({
    mutationFn: async (filter: { filter_type: string; filter_operator: string; filter_value: string }) => {
      const { error } = await supabase
        .from('portfolio_universe_filters')
        .insert({
          portfolio_id: portfolio.id,
          ...filter,
        })
      if (error) throw error
    },
    onSuccess: () => {
      refetchUniverseFilters()
    },
  })

  const removeUniverseFilterMutation = useMutation({
    mutationFn: async (filterId: string) => {
      const { error } = await supabase
        .from('portfolio_universe_filters')
        .delete()
        .eq('id', filterId)
      if (error) throw error
    },
    onSuccess: () => {
      refetchUniverseFilters()
    },
  })

  const handleNoteClick = (noteId: string) => {
    setSelectedNoteId(noteId)
    setShowNoteEditor(true)
  }
  const handleCreateNote = () => {
    setSelectedNoteId(null)
    setShowNoteEditor(true)
  }
  const handleCloseNoteEditor = () => {
    setShowNoteEditor(false)
    setSelectedNoteId(null)
    queryClient.invalidateQueries({ queryKey: ['portfolio-notes', portfolio.id] })
  }

  const handleConfirmDelete = () => {
    if (deleteConfirm.teamMemberId) {
      deleteTeamMemberMutation.mutate(deleteConfirm.teamMemberId)
    }
  }

  const handleCancelDelete = () => {
    setDeleteConfirm({ isOpen: false, teamMemberId: null, userName: '', role: '' });
  }

  const handleAssetRowClick = (assetId: string, event: React.MouseEvent) => {
    if (expandedAssetId === assetId) {
      setExpandedAssetId(null)
      setSelectedDetailTopic(null)
    } else {
      setExpandedAssetId(assetId)
      setSelectedDetailTopic(null)
    }
  }

  const handleDetailTopicSelect = (topic: string) => {
    setSelectedDetailTopic(selectedDetailTopic === topic ? null : topic)
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getUserDisplayName = (user: any) => {
    if (!user) return 'Unknown User'
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email || 'Unknown User'
  }

  const getUserInitials = (user: any) => {
    if (!user) return 'UU'
    if (user.first_name && user.last_name) {
      return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
    }
    const nameParts = user.email?.split('@')[0].split('.')
    if (nameParts && nameParts.length > 1) {
      return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
    }
    return user.email?.substring(0, 2).toUpperCase() || 'UU'
  }

  // Sorted holdings
  const sortedHoldings = useMemo(() => {
    if (!holdings) return []

    return [...holdings].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortColumn) {
        case 'symbol':
          aValue = a.assets?.symbol || ''
          bValue = b.assets?.symbol || ''
          break
        case 'company':
          aValue = a.assets?.company_name || ''
          bValue = b.assets?.company_name || ''
          break
        case 'sector':
          aValue = a.assets?.sector || ''
          bValue = b.assets?.sector || ''
          break
        case 'shares':
          aValue = parseFloat(a.shares) || 0
          bValue = parseFloat(b.shares) || 0
          break
        case 'avgCost':
          aValue = parseFloat(a.cost) || 0
          bValue = parseFloat(b.cost) || 0
          break
        case 'gainLoss':
          const aShares = parseFloat(a.shares) || 0
          const aCurrentPrice = parseFloat(a.price) || 0
          const aAvgCost = parseFloat(a.cost) || 0
          const aGainLoss = (aShares * aCurrentPrice) - (aShares * aAvgCost)

          const bShares = parseFloat(b.shares) || 0
          const bCurrentPrice = parseFloat(b.price) || 0
          const bAvgCost = parseFloat(b.cost) || 0
          const bGainLoss = (bShares * bCurrentPrice) - (bShares * bAvgCost)

          aValue = aGainLoss
          bValue = bGainLoss
          break
        case 'returnPercent':
          const aSharesRet = parseFloat(a.shares) || 0
          const aCurrentPriceRet = parseFloat(a.price) || 0
          const aAvgCostRet = parseFloat(a.cost) || 0
          const aTotalCostBasis = aSharesRet * aAvgCostRet
          const aMarketValue = aSharesRet * aCurrentPriceRet
          const aGainLossRet = aMarketValue - aTotalCostBasis
          const aReturnPercent = aTotalCostBasis > 0 ? (aGainLossRet / aTotalCostBasis) * 100 : 0

          const bSharesRet = parseFloat(b.shares) || 0
          const bCurrentPriceRet = parseFloat(b.price) || 0
          const bAvgCostRet = parseFloat(b.cost) || 0
          const bTotalCostBasis = bSharesRet * bAvgCostRet
          const bMarketValue = bSharesRet * bCurrentPriceRet
          const bGainLossRet = bMarketValue - bTotalCostBasis
          const bReturnPercent = bTotalCostBasis > 0 ? (bGainLossRet / bTotalCostBasis) * 100 : 0

          aValue = aReturnPercent
          bValue = bReturnPercent
          break
        default:
          return 0
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comparison = aValue.localeCompare(bValue)
        return sortDirection === 'asc' ? comparison : -comparison
      } else {
        const comparison = aValue - bValue
        return sortDirection === 'asc' ? comparison : -comparison
      }
    })
  }, [holdings, sortColumn, sortDirection])

  // Metrics
  const totalValue =
    holdings?.reduce((sum: number, h: any) => sum + h.shares * h.price, 0) || 0
  const totalCost = holdings?.reduce((sum: number, h: any) => sum + h.cost, 0) || 0
  const totalReturn = totalValue - totalCost
  const returnPercentage = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-8 flex-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              {portfolio.name}
              {portfolio.portfolio_id && (
                <span className="font-normal text-gray-600"> - {portfolio.portfolio_id}</span>
              )}
            </h1>
            {portfolio.description && (
              <p className="text-lg text-gray-600 mb-1">{portfolio.description}</p>
            )}
            {portfolio.benchmark && (
              <p className="text-sm text-gray-500">Benchmark: {portfolio.benchmark}</p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Card padding="none">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'overview'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Briefcase className="h-4 w-4" />
                <span>Overview</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('holdings')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'holdings'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-4 w-4" />
                <span>Holdings</span>
                {holdings && holdings.length > 0 && (
                  <Badge variant="default" size="sm">
                    {holdings.length}
                  </Badge>
                )}
              </div>
            </button>

            <button
              onClick={() => setActiveTab('performance')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'performance'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <BarChart3 className="h-4 w-4" />
                <span>Performance</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('notes')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'notes'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <FileText className="h-4 w-4" />
                <span>Notes</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('team')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'team'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Users className="h-4 w-4" />
                <span>Team</span>
                {teamWithUsers && teamWithUsers.length > 0 && (
                  <Badge variant="default" size="sm">
                    {new Set(teamWithUsers.map(t => `${t.user_id}-${t.role}`)).size}
                  </Badge>
                )}
              </div>
            </button>

            <button
              onClick={() => setActiveTab('projects')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'projects'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <FolderKanban className="h-4 w-4" />
                <span>Projects</span>
              </div>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <div className="flex items-center">
                    <div className="p-2 bg-primary-100 rounded-lg">
                      <DollarSign className="h-5 w-5 text-primary-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-600">Total Value</p>
                      <p className="text-lg font-semibold text-gray-900">
                        ${totalValue.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center">
                    <div className="p-2 bg-success-100 rounded-lg">
                      <TrendingUp className="h-5 w-5 text-success-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-600">Total Return</p>
                      <p className={`text-lg font-semibold ${totalReturn >= 0 ? 'text-success-600' : 'text-error-600'}`}>
                        {totalReturn >= 0 ? '+' : ''}${totalReturn.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center">
                    <div className="p-2 bg-warning-100 rounded-lg">
                      <Percent className="h-5 w-5 text-warning-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-600">Return %</p>
                      <p className={`text-lg font-semibold ${returnPercentage >= 0 ? 'text-success-600' : 'text-error-600'}`}>
                        {returnPercentage >= 0 ? '+' : ''}{returnPercentage.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <Briefcase className="h-5 w-5 text-gray-600" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-600">Positions</p>
                      <p className="text-lg font-semibold text-gray-900">{holdings?.length || 0}</p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Investable Universe Section */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-indigo-100 rounded-lg">
                      <Globe className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Investable Universe</h3>
                      <p className="text-sm text-gray-500">
                        {combinedUniverseAssets.total} assets • {(universeFilters?.length || 0)} filters
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddFilterModal(true)}
                    >
                      <Filter className="h-4 w-4 mr-1" />
                      Add Filter
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowUniverseAssetSearch(!showUniverseAssetSearch)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Assets
                    </Button>
                  </div>
                </div>

                {/* Asset Search */}
                {showUniverseAssetSearch && (
                  <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center space-x-2 mb-3">
                      <Search className="h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search assets by symbol or name..."
                        value={universeSearchQuery}
                        onChange={(e) => setUniverseSearchQuery(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowUniverseAssetSearch(false)
                          setUniverseSearchQuery('')
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {universeSearchQuery.length >= 1 && (
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {allAssets
                          ?.filter(asset =>
                            asset.symbol.toLowerCase().includes(universeSearchQuery.toLowerCase()) ||
                            asset.company_name?.toLowerCase().includes(universeSearchQuery.toLowerCase())
                          )
                          .filter(asset => !universeAssets?.some(ua => ua.asset_id === asset.id))
                          .slice(0, 10)
                          .map(asset => (
                            <div
                              key={asset.id}
                              className="flex items-center justify-between p-2 hover:bg-white rounded cursor-pointer"
                              onClick={() => {
                                addUniverseAssetMutation.mutate(asset.id)
                                setUniverseSearchQuery('')
                              }}
                            >
                              <div>
                                <span className="font-medium text-gray-900">{asset.symbol}</span>
                                <span className="text-gray-500 ml-2 text-sm">{asset.company_name}</span>
                              </div>
                              <Plus className="h-4 w-4 text-indigo-600" />
                            </div>
                          ))}
                        {allAssets?.filter(asset =>
                          asset.symbol.toLowerCase().includes(universeSearchQuery.toLowerCase()) ||
                          asset.company_name?.toLowerCase().includes(universeSearchQuery.toLowerCase())
                        ).filter(asset => !universeAssets?.some(ua => ua.asset_id === asset.id)).length === 0 && (
                          <p className="text-sm text-gray-500 p-2">No matching assets found</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Add Filter Modal */}
                {showAddFilterModal && (
                  <div className="mb-4 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-indigo-900">Add Filter Rule</h4>
                      <Button variant="ghost" size="sm" onClick={() => setShowAddFilterModal(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {/* All controls on one line */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Filter Type */}
                      <select
                        value={newFilterType}
                        onChange={(e) => {
                          setNewFilterType(e.target.value)
                          setNewFilterValue('')
                          setMarketCapMin('')
                          setMarketCapMax('')
                        }}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="sector">Sector</option>
                        <option value="industry">Industry</option>
                        <option value="market_cap">Market Cap</option>
                        <option value="index">Index Membership</option>
                        <option value="country">Country</option>
                        <option value="exchange">Exchange</option>
                      </select>

                      {/* Market Cap: Condition + Value(s) */}
                      {newFilterType === 'market_cap' && (
                        <>
                          <select
                            value={marketCapOperator}
                            onChange={(e) => setMarketCapOperator(e.target.value as 'gt' | 'lt' | 'between')}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="gt">Greater than</option>
                            <option value="lt">Less than</option>
                            <option value="between">Between</option>
                          </select>
                          <input
                            type="number"
                            value={marketCapMin}
                            onChange={(e) => setMarketCapMin(e.target.value)}
                            placeholder={marketCapOperator === 'between' ? 'Min ($M)' : 'Value ($M)'}
                            className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                          {marketCapOperator === 'between' && (
                            <>
                              <span className="text-gray-500 text-sm">and</span>
                              <input
                                type="number"
                                value={marketCapMax}
                                onChange={(e) => setMarketCapMax(e.target.value)}
                                placeholder="Max ($M)"
                                className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                              />
                            </>
                          )}
                        </>
                      )}

                      {/* Other filters: Operator + Value dropdown */}
                      {newFilterType !== 'market_cap' && (
                        <>
                          <select
                            value={newFilterOperator}
                            onChange={(e) => setNewFilterOperator(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="include">Include</option>
                            <option value="exclude">Exclude</option>
                          </select>
                          <select
                            value={newFilterValue}
                            onChange={(e) => setNewFilterValue(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 min-w-[150px]"
                          >
                            <option value="">Select...</option>
                            {newFilterType === 'sector' && filterOptions.sectors.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                            {newFilterType === 'industry' && filterOptions.industries.map(i => (
                              <option key={i} value={i}>{i}</option>
                            ))}
                            {newFilterType === 'country' && filterOptions.countries.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                            {newFilterType === 'exchange' && filterOptions.exchanges.map(e => (
                              <option key={e} value={e}>{e}</option>
                            ))}
                            {newFilterType === 'index' && indexOptions.map(idx => (
                              <option key={idx} value={idx}>{idx}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                    <div className="flex justify-end mt-3">
                      <Button
                        size="sm"
                        onClick={() => {
                          if (newFilterType === 'market_cap') {
                            // Build market cap filter value
                            let filterValue = ''
                            if (marketCapOperator === 'gt' && marketCapMin) {
                              filterValue = `>${marketCapMin}M`
                            } else if (marketCapOperator === 'lt' && marketCapMin) {
                              filterValue = `<${marketCapMin}M`
                            } else if (marketCapOperator === 'between' && marketCapMin && marketCapMax) {
                              filterValue = `${marketCapMin}M-${marketCapMax}M`
                            }
                            if (filterValue) {
                              addUniverseFilterMutation.mutate({
                                filter_type: 'market_cap',
                                filter_operator: marketCapOperator,
                                filter_value: filterValue,
                              })
                              setMarketCapMin('')
                              setMarketCapMax('')
                              setShowAddFilterModal(false)
                            }
                          } else if (newFilterValue.trim()) {
                            addUniverseFilterMutation.mutate({
                              filter_type: newFilterType,
                              filter_operator: newFilterOperator,
                              filter_value: newFilterValue.trim(),
                            })
                            setNewFilterValue('')
                            setShowAddFilterModal(false)
                          }
                        }}
                        disabled={
                          newFilterType === 'market_cap'
                            ? (marketCapOperator === 'between' ? !marketCapMin || !marketCapMax : !marketCapMin)
                            : !newFilterValue.trim()
                        }
                      >
                        Add Filter
                      </Button>
                    </div>
                  </div>
                )}

                {/* Active Filters */}
                {universeFilters && universeFilters.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Active Filters</h4>
                    <div className="flex flex-wrap gap-2">
                      {universeFilters.map((filter: any) => {
                        const isMarketCap = filter.filter_type === 'market_cap'
                        const isExclude = filter.filter_operator === 'exclude'

                        // Format the display based on filter type
                        const getFilterLabel = () => {
                          switch (filter.filter_type) {
                            case 'market_cap': return 'Market Cap'
                            case 'sector': return 'Sector'
                            case 'industry': return 'Industry'
                            case 'country': return 'Country'
                            case 'exchange': return 'Exchange'
                            case 'index': return 'Index'
                            default: return filter.filter_type
                          }
                        }

                        // Format the value display - market cap already has operator in value
                        const getDisplayValue = () => {
                          if (isMarketCap) {
                            // Parse market cap values like ">500M", "<1000M", "500M-1000M"
                            const val = filter.filter_value
                            if (val.startsWith('>')) return `> $${val.slice(1)}`
                            if (val.startsWith('<')) return `< $${val.slice(1)}`
                            if (val.includes('-')) {
                              const [min, max] = val.split('-')
                              return `$${min} - $${max}`
                            }
                            return `$${val}`
                          }
                          return filter.filter_value
                        }

                        const getOperatorLabel = () => {
                          if (isMarketCap) return '' // Operator is in the value for market cap
                          return filter.filter_operator === 'include' ? 'is' : 'is not'
                        }

                        return (
                          <div
                            key={filter.id}
                            className={`inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg text-sm border ${
                              isExclude
                                ? 'bg-red-50 border-red-200 text-red-700'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            }`}
                          >
                            <span className="font-medium">{getFilterLabel()}</span>
                            {getOperatorLabel() && (
                              <span className={`${isExclude ? 'text-red-500' : 'text-indigo-400'}`}>{getOperatorLabel()}</span>
                            )}
                            <span className={`font-semibold ${isExclude ? 'text-red-800' : 'text-indigo-900'}`}>
                              {getDisplayValue()}
                            </span>
                            <button
                              onClick={() => removeUniverseFilterMutation.mutate(filter.id)}
                              className={`ml-1 p-1 rounded-md transition-colors ${
                                isExclude
                                  ? 'hover:bg-red-200 text-red-500'
                                  : 'hover:bg-indigo-200 text-indigo-500'
                              }`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Universe Assets List */}
                {combinedUniverseAssets.total > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      Included Assets ({combinedUniverseAssets.total})
                      {combinedUniverseAssets.manual.length > 0 && combinedUniverseAssets.filtered.length > 0 && (
                        <span className="font-normal text-gray-400 ml-2">
                          ({combinedUniverseAssets.manual.length} manual + {combinedUniverseAssets.filtered.length} from filters)
                        </span>
                      )}
                    </h4>
                    <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sector</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {/* Manually added assets */}
                          {combinedUniverseAssets.manual.map((ua: any) => (
                            <tr key={`manual-${ua.id}`} className="hover:bg-gray-50">
                              <td className="px-4 py-2 text-sm font-medium text-gray-900">{ua.asset?.symbol}</td>
                              <td className="px-4 py-2 text-sm text-gray-500">{ua.asset?.company_name}</td>
                              <td className="px-4 py-2 text-sm text-gray-500">{ua.asset?.sector || '-'}</td>
                              <td className="px-4 py-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                  Manual
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  onClick={() => removeUniverseAssetMutation.mutate(ua.id)}
                                  className="text-red-600 hover:text-red-800"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {/* Filter-matched assets */}
                          {combinedUniverseAssets.filtered.map((asset: any) => (
                            <tr key={`filter-${asset.id}`} className="hover:bg-gray-50 bg-indigo-50/30">
                              <td className="px-4 py-2 text-sm font-medium text-gray-900">{asset.symbol}</td>
                              <td className="px-4 py-2 text-sm text-gray-500">{asset.company_name}</td>
                              <td className="px-4 py-2 text-sm text-gray-500">{asset.sector || '-'}</td>
                              <td className="px-4 py-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                                  Filter
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right text-gray-400">
                                -
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Globe className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No assets in universe</p>
                    <p className="text-sm">Add assets manually or create filter rules to define your investable universe</p>
                  </div>
                )}
              </Card>
            </div>
          )}

          {activeTab === 'holdings' && (
            <div className="space-y-6">
              {holdings && holdings.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('symbol')}
                        >
                          <div className="flex items-center gap-1">
                            Asset
                            {sortColumn === 'symbol' ? (
                              sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            ) : <ChevronUp className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('sector')}
                        >
                          <div className="flex items-center gap-1">
                            Sector
                            {sortColumn === 'sector' ? (
                              sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            ) : <ChevronUp className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Current Price
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Daily Change
                        </th>
                        <th
                          className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('shares')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Shares
                            {sortColumn === 'shares' ? (
                              sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            ) : <ChevronUp className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('avgCost')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Avg Cost
                            {sortColumn === 'avgCost' ? (
                              sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            ) : <ChevronUp className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('gainLoss')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Gain/Loss
                            {sortColumn === 'gainLoss' ? (
                              sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            ) : <ChevronUp className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                        <th
                          className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('returnPercent')}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Return %
                            {sortColumn === 'returnPercent' ? (
                              sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            ) : <ChevronUp className="h-3 w-3 opacity-30" />}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedHoldings.map((holding: any) => {
                        const shares = parseFloat(holding.shares) || 0
                        const currentPrice = parseFloat(holding.price) || 0 // This appears to be current price
                        const avgCostPerShare = parseFloat(holding.cost) || 0 // This appears to be avg cost per share

                        const totalCostBasis = shares * avgCostPerShare
                        const marketValue = shares * currentPrice
                        const gainLoss = marketValue - totalCostBasis
                        const returnPercent = totalCostBasis > 0 ? (gainLoss / totalCostBasis) * 100 : 0
                        const isExpanded = expandedAssetId === holding.asset_id

                        return (
                          <React.Fragment key={holding.id}>
                            <tr
                              className={`hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-blue-50' : ''}`}
                            >
                              <td className="pl-2 pr-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="relative mr-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (onNavigate && holding.assets) {
                                          onNavigate({
                                            id: holding.assets.id || holding.asset_id,
                                            title: holding.assets.symbol || 'Unknown',
                                            type: 'asset',
                                            data: holding.assets
                                          })
                                        }
                                      }}
                                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                                      title="Go to Asset"
                                    >
                                      <MoreVertical className="h-4 w-4 text-gray-500" />
                                    </button>
                                  </div>
                                  <div
                                    className="flex items-center cursor-pointer flex-1"
                                    onClick={(e) => handleAssetRowClick(holding.asset_id, e)}
                                  >
                                    <div className="flex-shrink-0 mr-3">
                                      <div className={`w-2 h-2 rounded-full transition-transform duration-200 ${isExpanded ? 'bg-blue-500 rotate-90' : 'bg-gray-300'}`}></div>
                                    </div>
                                    <div>
                                      <div className="text-sm font-semibold text-gray-900">{holding.assets?.symbol}</div>
                                      <div className="text-sm text-gray-600 max-w-xs truncate">{holding.assets?.company_name}</div>
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-gray-900">{holding.assets?.sector || '—'}</span>
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                <StockQuote symbol={holding.assets?.symbol} showOnlyPrice={true} />
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex justify-end">
                                  <StockQuote symbol={holding.assets?.symbol} showOnlyChange={true} />
                                </div>
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                <span className="text-sm font-medium text-gray-900">{shares.toLocaleString()}</span>
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                <span className="text-sm text-gray-900">${avgCostPerShare.toFixed(2)}</span>
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                <span className={`text-sm font-medium ${gainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)}
                                </span>
                              </td>

                              <td className="px-6 py-4 whitespace-nowrap text-right">
                                <span className={`text-sm font-medium ${returnPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {returnPercent >= 0 ? '+' : ''}{returnPercent.toFixed(1)}%
                                </span>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr>
                                <td colSpan={8} className="px-0 py-0">
                                  <div className="bg-gray-50 border-l-4 border-blue-500 px-6 py-2">
                                    {/* Compact Tile Grid */}
                                    <div className="grid grid-cols-3 gap-2 mb-2">
                                      {/* Thesis Tile */}
                                      <button
                                        onClick={() => handleDetailTopicSelect('thesis')}
                                        className={`p-2 rounded border text-left text-xs ${
                                          selectedDetailTopic === 'thesis'
                                            ? 'border-blue-500 bg-blue-50'
                                            : 'border-gray-200 bg-white hover:border-gray-300'
                                        }`}
                                      >
                                        <div className="font-semibold text-gray-700">Thesis</div>
                                      </button>

                                      {/* Combined Stage & Priority Tile */}
                                      <button
                                        onClick={() => handleDetailTopicSelect('stage-priority')}
                                        className={`p-2 rounded border text-left text-xs ${
                                          selectedDetailTopic === 'stage-priority'
                                            ? 'border-blue-500 bg-blue-50'
                                            : 'border-gray-200 bg-white hover:border-gray-300'
                                        }`}
                                      >
                                        <div className="font-semibold text-gray-700">Stage & Priority</div>
                                        <div className="flex items-center gap-2 mt-1">
                                          <span className="text-gray-600 capitalize text-xs">
                                            {holding.assets?.process_stage || 'Unknown'}
                                          </span>
                                          <span className="text-gray-400">•</span>
                                          <span className={`font-medium capitalize text-xs ${
                                            holding.assets?.priority === 'critical' ? 'text-red-600' :
                                            holding.assets?.priority === 'high' ? 'text-orange-500' :
                                            holding.assets?.priority === 'medium' ? 'text-blue-500' :
                                            holding.assets?.priority === 'low' ? 'text-green-500' : 'text-gray-600'
                                          }`}>
                                            {holding.assets?.priority || 'None'}
                                          </span>
                                        </div>
                                      </button>

                                      {/* Outcomes Tile */}
                                      <button
                                        onClick={() => handleDetailTopicSelect('outcomes')}
                                        className={`p-2 rounded border text-left text-xs ${
                                          selectedDetailTopic === 'outcomes'
                                            ? 'border-blue-500 bg-blue-50'
                                            : 'border-gray-200 bg-white hover:border-gray-300'
                                        }`}
                                      >
                                        <div className="font-semibold text-gray-700">Outcomes</div>
                                      </button>
                                    </div>

                                    {/* Detailed View */}
                                    {selectedDetailTopic && (
                                      <div className="mt-2">
                                        <div className="bg-white rounded border border-gray-200 p-3 shadow-sm">
                                        <div className="flex items-start justify-between">
                                          <div className="text-xs text-gray-700 space-y-1 flex-1">
                                          {selectedDetailTopic === 'thesis' && (
                                            <div className="space-y-2">
                                              <div>
                                                <h5 className="text-xs font-semibold text-gray-600 mb-1">Investment Thesis</h5>
                                                <p className="text-xs">{holding.assets?.thesis || 'No thesis has been defined for this asset.'}</p>
                                              </div>
                                              <div>
                                                <h5 className="text-xs font-semibold text-gray-600 mb-1">Where Different</h5>
                                                <p className="text-xs">{holding.assets?.where_different || 'No differentiation factors have been specified.'}</p>
                                              </div>
                                              <div>
                                                <h5 className="text-xs font-semibold text-gray-600 mb-1">Risks to Thesis</h5>
                                                <p className="text-xs">{holding.assets?.risks_to_thesis || 'No risks to the thesis have been identified.'}</p>
                                              </div>
                                            </div>
                                          )}
                                          {selectedDetailTopic === 'stage-priority' && (
                                            <div className="space-y-2">
                                              <div>
                                                <h5 className="text-xs font-semibold text-gray-600 mb-1">Current Stage</h5>
                                                <p className="text-xs mb-1">
                                                  <span className="font-medium capitalize">{holding.assets?.process_stage || 'Unknown'}</span>
                                                </p>
                                                <p className="text-xs text-gray-500">Current research and analysis stage for this asset.</p>
                                              </div>
                                              <div>
                                                <h5 className="text-xs font-semibold text-gray-600 mb-1">Priority Level</h5>
                                                <p className="text-xs mb-1">
                                                  <span className={`font-medium capitalize ${
                                                    holding.assets?.priority === 'critical' ? 'text-red-600' :
                                                    holding.assets?.priority === 'high' ? 'text-orange-500' :
                                                    holding.assets?.priority === 'medium' ? 'text-blue-500' :
                                                    holding.assets?.priority === 'low' ? 'text-green-500' : 'text-gray-600'
                                                  }`}>{holding.assets?.priority || 'None'}</span>
                                                </p>
                                                <p className="text-xs text-gray-500">Relative importance and urgency of this asset in the portfolio.</p>
                                              </div>
                                            </div>
                                          )}
                                          {selectedDetailTopic === 'outcomes' && (
                                            <div className="space-y-1">
                                              <h5 className="text-xs font-semibold text-gray-600 mb-1">Price Targets</h5>
                                              {holding.assets?.price_targets && holding.assets.price_targets.length > 0 ? (
                                                <div className="space-y-1">
                                                  {['bull', 'base', 'bear'].map(caseType => {
                                                    const target = holding.assets.price_targets.find((pt: any) => pt.type === caseType)
                                                    if (!target) return null

                                                    const getCaseColor = (type: string) => {
                                                      switch(type) {
                                                        case 'bull': return 'text-green-600'
                                                        case 'base': return 'text-blue-600'
                                                        case 'bear': return 'text-red-600'
                                                        default: return 'text-gray-600'
                                                      }
                                                    }

                                                    return (
                                                      <div key={caseType} className="flex items-center gap-2 text-xs">
                                                        <span className={`font-medium capitalize ${getCaseColor(caseType)}`}>
                                                          {caseType}: ${target.price || '—'}
                                                        </span>
                                                        {target.timeframe && (
                                                          <span className="text-gray-500">
                                                            {target.timeframe}
                                                          </span>
                                                        )}
                                                        {target.reasoning && (
                                                          <span className="text-gray-600 flex-1">
                                                            - {target.reasoning}
                                                          </span>
                                                        )}
                                                      </div>
                                                    )
                                                  })}
                                                </div>
                                              ) : (
                                                <p className="text-xs text-gray-500">No price targets have been set for this asset.</p>
                                              )}
                                            </div>
                                          )}
                                          </div>
                                          <button
                                            onClick={() => setSelectedDetailTopic(null)}
                                            className="text-gray-400 hover:text-gray-600 text-xs ml-2"
                                          >
                                            ×
                                          </button>
                                        </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No holdings yet</h3>
                  <p className="text-gray-500 mb-4">Add holdings to track your portfolio performance.</p>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Holding
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'performance' && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-12 text-center">
                <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Performance Charts Coming Soon</h3>
                <p className="text-gray-500">Interactive performance charts and analytics will be available here.</p>
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            showNoteEditor ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <Button variant="ghost" size="sm" onClick={handleCloseNoteEditor} className="flex items-center">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Notes
                  </Button>
                </div>
                <PortfolioNoteEditor
                  portfolioId={portfolio.id}
                  portfolioName={portfolio.name}
                  selectedNoteId={selectedNoteId ?? undefined}
                  onNoteSelect={setSelectedNoteId}
                  onClose={handleCloseNoteEditor}
                />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <Button size="sm" onClick={handleCreateNote}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Note
                  </Button>
                </div>

                {notes && notes.length > 0 ? (
                  <div className="space-y-4">
                    {notes.map((note: any) => (
                      <Card key={note.id} padding="sm" className="cursor-pointer hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between" onClick={() => handleNoteClick(note.id)}>
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <h4 className="font-semibold text-gray-900">{note.title}</h4>
                              {note.note_type && (
                                <Badge variant="default" size="sm">
                                  {note.note_type}
                                </Badge>
                              )}
                              {note.is_shared && (
                                <Badge variant="primary" size="sm">
                                  Shared
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                              {getContentPreview(note.content || '', 150)}
                            </p>
                            <div className="flex items-center space-x-4 text-xs text-gray-500">
                              <div className="flex items-center">
                                <Calendar className="h-3 w-3 mr-1" />
                                {formatDistanceToNow(new Date(note.updated_at || 0), { addSuffix: true })}
                              </div>
                              <div className="flex items-center">
                                <User className="h-3 w-3 mr-1" />
                                You
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No related notes</h3>
                    <p className="text-gray-500 mb-4">Create notes to document your thoughts about this portfolio.</p>
                    <Button size="sm" onClick={handleCreateNote}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Note
                    </Button>
                  </div>
                )}
              </div>
            )
          )}

          {activeTab === 'team' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Portfolio Team</h2>
                <Button size="sm" onClick={() => {
                  setEditingTeamMember(null)
                  setShowAddTeamMemberModal(true)
                }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Team Member
                </Button>
              </div>

              {teamError && (
                <div className="text-sm text-red-600">Error loading team: {(teamError as any)?.message || 'Unknown error'}</div>
              )}

              {teamLoading && !teamWithUsers ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <Card padding="sm">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                            <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                          </div>
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              ) : Object.keys(teamMembersByRole).length > 0 ? ( // Check if there are any roles with members
                <div className="space-y-6">
                  {Object.entries(teamMembersByRole).map(([role, members]) => (
                    <div key={role}>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">{role}</h3>
                      <div className="space-y-4">
                        {members.map((member: any, idx: number) => {
                          const u = member.user
                          const initials = getUserInitials(u)
                          const displayName = getUserDisplayName(u)
                          return (
                            <Card key={`${member.id}-${idx}`} padding="sm"> {/* Use member.id for unique key */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                                    <span className="text-primary-600 font-semibold text-sm">{initials}</span>
                                  </div>
                                  <div>
                                    <h4 className="font-semibold text-gray-900">{displayName}</h4>
                                    <p className="text-sm text-gray-600">{u?.email || '—'}</p>
                                    {(member.sectorFocus?.length > 0 || member.investmentStyle?.length > 0) && (
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {member.sectorFocus?.map((sector: string) => (
                                          <span key={sector} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gradient-to-r from-blue-50 to-indigo-50 text-indigo-700 border border-indigo-200/60 shadow-sm capitalize">
                                            {sector}
                                          </span>
                                        ))}
                                        {member.investmentStyle?.map((style: string) => (
                                          <span key={style} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gradient-to-r from-purple-50 to-fuchsia-50 text-purple-700 border border-purple-200/60 shadow-sm capitalize">
                                            {style}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingTeamMember({
                                        id: member.id,
                                        user_id: member.user.id,
                                        role: role,
                                      })
                                      setShowAddTeamMemberModal(true)
                                    }}
                                  >
                                    <Edit className="h-4 w-4 text-primary-600" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDeleteConfirm({
                                      isOpen: true,
                                      teamMemberId: member.teamRecordIds.join(','), // Pass all record IDs
                                      userName: displayName,
                                      role: role
                                    })}
                                  >
                                    <Trash2 className="h-4 w-4 text-error-600" />
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No team members yet</h3>
                  <p className="text-gray-500 mb-4">Add team members to this portfolio.</p>
                  <Button size="sm" onClick={() => setShowAddTeamMemberModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Team Member
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="space-y-6">
              <RelatedProjects
                contextType="portfolio"
                contextId={portfolio.id}
                contextTitle={portfolio.name}
                onProjectClick={(projectId) => {
                  if (onNavigate) {
                    onNavigate({
                      id: projectId,
                      title: 'Project',
                      type: 'project',
                      data: { id: projectId }
                    })
                  }
                }}
              />
            </div>
          )}
        </div>
      </Card>

      {showAddTeamMemberModal && (
        <AddTeamMemberModal
          isOpen={showAddTeamMemberModal}
          onClose={() => {
            setShowAddTeamMemberModal(false)
            setEditingTeamMember(null)
          }}
          portfolioId={portfolio.id}
          portfolioName={portfolio.name}
          editingMember={editingTeamMember}
          onMemberAdded={async () => {
            await refetchTeamWithUsers()
          }}
        />
      )}


      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Remove Team Member"
        message={`Are you sure you want to remove ${deleteConfirm.userName} as "${deleteConfirm.role}" from this portfolio?`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
        isLoading={deleteTeamMemberMutation.isPending}
      />
    </div>
  )
}
