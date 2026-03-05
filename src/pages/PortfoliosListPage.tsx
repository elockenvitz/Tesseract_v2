import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Briefcase, Search, Filter, Plus, Calendar, ArrowUpDown, ChevronDown, Users, Star, ShieldAlert, Archive, ArchiveRestore, Ban, RotateCcw, MoreHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Select } from '../components/ui/Select'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { EmptyState } from '../components/common/EmptyState'
import { NewPortfolioModal } from '../components/portfolios/NewPortfolioModal'
import { DiscardPortfolioModal } from '../components/portfolios/DiscardPortfolioModal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { useToast } from '../components/common/Toast'
import { logOrgActivity } from '../lib/org-activity-log'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

type ArchiveFilter = 'active' | 'archived' | 'discarded' | 'all'

interface PortfoliosListPageProps {
  onPortfolioSelect?: (portfolio: any) => void
}

export function PortfoliosListPage({ onPortfolioSelect }: PortfoliosListPageProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>('active')

  // Action menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Archive confirm
  const [archiveConfirm, setArchiveConfirm] = useState<{ isOpen: boolean; portfolio: any | null; action: 'archive' | 'unarchive' }>({
    isOpen: false, portfolio: null, action: 'archive',
  })

  // Discard modal
  const [discardTarget, setDiscardTarget] = useState<{ id: string; name: string } | null>(null)

  // Close menu on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null)
      }
    }
    if (openMenuId) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [openMenuId])

  // Check if user is Org Admin or Coverage Admin (can create portfolios)
  const { data: canCreate = false } = useQuery({
    queryKey: ['can-create-portfolio', currentOrgId, user?.id],
    queryFn: async () => {
      if (!user?.id || !currentOrgId) return false

      const { data: membership } = await supabase
        .from('organization_memberships')
        .select('is_org_admin')
        .eq('organization_id', currentOrgId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()

      if (membership?.is_org_admin) return true

      const { data: userData } = await supabase
        .from('users')
        .select('coverage_admin')
        .eq('id', user.id)
        .maybeSingle()

      return userData?.coverage_admin === true
    },
    enabled: !!user?.id && !!currentOrgId,
  })

  // Check if user is Org Admin (can archive/delete)
  const { data: isOrgAdmin = false } = useQuery({
    queryKey: ['is-org-admin', currentOrgId, user?.id],
    queryFn: async () => {
      if (!user?.id || !currentOrgId) return false
      const { data } = await supabase
        .from('organization_memberships')
        .select('is_org_admin')
        .eq('organization_id', currentOrgId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()
      return data?.is_org_admin === true
    },
    enabled: !!user?.id && !!currentOrgId,
  })

  // Fetch all portfolios with team links and member counts
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

  // Fetch team links for all portfolios
  const { data: teamLinks = [] } = useQuery({
    queryKey: ['portfolio-team-links', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_team_links')
        .select('portfolio_id, team_node_id, is_lead, team_node:org_chart_nodes(id, name, color)')
      if (error) throw error
      return data || []
    },
    enabled: !!currentOrgId,
  })

  // Fetch portfolio_team member counts
  const { data: memberCounts = [] } = useQuery({
    queryKey: ['portfolio-team-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_team')
        .select('portfolio_id, role')
      if (error) throw error
      return data || []
    },
  })

  // Archive / Unarchive mutation
  const archiveMutation = useMutation({
    mutationFn: async ({ portfolioId, action }: { portfolioId: string; action: 'archive' | 'unarchive' }) => {
      const rpc = action === 'archive' ? 'archive_portfolio' : 'unarchive_portfolio'
      const { error } = await supabase.rpc(rpc, { p_portfolio_id: portfolioId })
      if (error) throw error
    },
    onSuccess: (_, { portfolioId, action }) => {
      toast.success(action === 'archive' ? 'Portfolio archived' : 'Portfolio unarchived')
      queryClient.invalidateQueries({ queryKey: ['all-portfolios'] })
      queryClient.invalidateQueries({ queryKey: ['portfolios-org'] })
      setArchiveConfirm({ isOpen: false, portfolio: null, action: 'archive' })
      if (currentOrgId) {
        logOrgActivity({
          organizationId: currentOrgId,
          action: action === 'archive' ? 'portfolio.archived' : 'portfolio.restored',
          targetType: 'portfolio',
          targetId: portfolioId,
          entityType: 'portfolio',
          actionType: action === 'archive' ? 'archived' : 'restored',
        })
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Operation failed')
    },
  })

  // Restore mutation (discarded → active)
  const restoreMutation = useMutation({
    mutationFn: async (portfolioId: string) => {
      const { error } = await supabase.rpc('restore_portfolio', { p_portfolio_id: portfolioId })
      if (error) throw error
    },
    onSuccess: (_, portfolioId) => {
      toast.success('Portfolio restored')
      queryClient.invalidateQueries({ queryKey: ['all-portfolios'] })
      queryClient.invalidateQueries({ queryKey: ['portfolios-org'] })
      if (currentOrgId) {
        logOrgActivity({
          organizationId: currentOrgId,
          action: 'portfolio.restored',
          targetType: 'portfolio',
          targetId: portfolioId,
          entityType: 'portfolio',
          actionType: 'restored',
        })
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to restore portfolio')
    },
  })

  // Build lookup maps
  const teamLinksByPortfolio = useMemo(() => {
    const map: Record<string, typeof teamLinks> = {}
    for (const link of teamLinks) {
      ;(map[link.portfolio_id] ??= []).push(link)
    }
    return map
  }, [teamLinks])

  const memberCountsByPortfolio = useMemo(() => {
    const map: Record<string, { total: number; pms: number; analysts: number }> = {}
    for (const m of memberCounts) {
      const entry = (map[m.portfolio_id] ??= { total: 0, pms: 0, analysts: 0 })
      entry.total++
      if (m.role === 'Portfolio Manager') entry.pms++
      if (m.role === 'Analyst') entry.analysts++
    }
    return map
  }, [memberCounts])

  // Status counts for pills
  const archiveCounts = useMemo(() => {
    if (!portfolios) return { active: 0, archived: 0, discarded: 0, all: 0 }
    const active = portfolios.filter(p => p.status === 'active' || (!p.status && !p.archived_at)).length
    const archived = portfolios.filter(p => p.status === 'archived' || (!p.status && p.archived_at)).length
    const discarded = portfolios.filter(p => p.status === 'discarded').length
    return { active, archived, discarded, all: portfolios.length }
  }, [portfolios])

  // Filter and sort portfolios
  const filteredPortfolios = useMemo(() => {
    if (!portfolios) return []

    let filtered = portfolios.filter((portfolio) => {
      // Status filter
      const pStatus = portfolio.status || (portfolio.archived_at ? 'archived' : 'active')
      if (archiveFilter === 'active' && pStatus !== 'active') return false
      if (archiveFilter === 'archived' && pStatus !== 'archived') return false
      if (archiveFilter === 'discarded' && pStatus !== 'discarded') return false

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
  }, [portfolios, searchQuery, sortBy, sortOrder, archiveFilter])

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
      title: portfolio.name,
      type: 'portfolio',
      data: portfolio,
    })
  }

  const handlePortfolioCreated = (_portfolioId: string) => {
    // List will refresh via query invalidation; don't navigate since we
    // don't have the full portfolio object and PortfolioTab needs it.
  }

  const clearFilters = () => {
    setSearchQuery('')
    setSortBy('updated_at')
    setSortOrder('desc')
    setArchiveFilter('active')
  }

  const activeFiltersCount = [searchQuery, archiveFilter !== 'active' ? archiveFilter : ''].filter(Boolean).length

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Portfolios</h1>
          <p className="text-gray-600">
            {filteredPortfolios.length} of {portfolios?.length || 0} portfolios
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate ? (
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Portfolio
            </button>
          ) : (
            <div className="relative group">
              <button
                disabled
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-400 bg-gray-100 rounded-lg cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                New Portfolio
              </button>
              <div className="absolute right-0 top-full mt-1 w-64 p-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                <div className="flex items-start gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                  Only Org Admins and Coverage Admins can create portfolios.
                </div>
              </div>
            </div>
          )}
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

          {/* Status Filter Pills */}
          <div className="flex items-center gap-2">
            {(['active', 'archived', ...(isOrgAdmin ? ['discarded'] as const : []), 'all'] as ArchiveFilter[]).map((filter) => {
              const count = archiveCounts[filter]
              const isSelected = archiveFilter === filter
              return (
                <button
                  key={filter}
                  onClick={() => setArchiveFilter(filter)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
                    isSelected
                      ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  )}
                >
                  {filter === 'active' && 'Active'}
                  {filter === 'archived' && 'Archived'}
                  {filter === 'discarded' && 'Discarded'}
                  {filter === 'all' && 'All'}
                  <span className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded-full',
                    isSelected ? 'bg-indigo-200/70 text-indigo-800' : 'bg-gray-200 text-gray-500',
                  )}>
                    {count}
                  </span>
                </button>
              )
            })}
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
            <ListSkeleton count={5} />
          </div>
        ) : filteredPortfolios.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {/* Table Header */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-4">
                  <button
                    onClick={() => handleSort('name')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Portfolio</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('benchmark')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Benchmark</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <span>Teams</span>
                </div>
                <div className="col-span-2">
                  <span>Members</span>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('updated_at')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Updated</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Portfolio Rows */}
            {filteredPortfolios.map((portfolio) => {
              const links = teamLinksByPortfolio[portfolio.id] || []
              const counts = memberCountsByPortfolio[portfolio.id] || { total: 0, pms: 0, analysts: 0 }
              const leadTeam = links.find((l: any) => l.is_lead)
              const pStatus = portfolio.status || (portfolio.archived_at ? 'archived' : 'active')
              const isArchived = pStatus === 'archived'
              const isDiscarded = pStatus === 'discarded'
              const isInactive = isArchived || isDiscarded

              return (
                <div
                  key={portfolio.id}
                  onClick={() => handlePortfolioClick(portfolio)}
                  className={clsx(
                    'px-6 py-4 cursor-pointer transition-colors group/row',
                    isDiscarded
                      ? 'bg-gray-100/60 hover:bg-gray-100'
                      : isArchived
                        ? 'bg-gray-50/50 hover:bg-gray-100/70'
                        : 'hover:bg-gray-50',
                  )}
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Portfolio Info */}
                    <div className="col-span-4">
                      <div className="flex items-center space-x-3">
                        <div className={clsx(
                          'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                          isDiscarded
                            ? 'bg-gray-300'
                            : isArchived
                              ? 'bg-gray-300'
                              : 'bg-gradient-to-br from-success-500 to-success-600',
                        )}>
                          {isDiscarded
                            ? <Ban className="h-5 w-5 text-white" />
                            : isArchived
                              ? <Archive className="h-5 w-5 text-white" />
                              : <Briefcase className="h-5 w-5 text-white" />
                          }
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className={clsx(
                              'text-sm font-semibold truncate',
                              isInactive ? 'text-gray-500' : 'text-gray-900',
                            )}>
                              {portfolio.name}
                            </p>
                            {isDiscarded && (
                              <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">
                                Discarded
                              </span>
                            )}
                            {isArchived && (
                              <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded">
                                Archived
                              </span>
                            )}
                          </div>
                          {portfolio.description && (
                            <p className={clsx('text-xs truncate', isInactive ? 'text-gray-400' : 'text-gray-500')}>
                              {portfolio.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Benchmark */}
                    <div className="col-span-2">
                      {portfolio.benchmark ? (
                        <span className={clsx('text-sm', isInactive ? 'text-gray-400' : 'text-gray-900')}>
                          {portfolio.benchmark}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">&mdash;</span>
                      )}
                    </div>

                    {/* Teams */}
                    <div className="col-span-2">
                      {links.length > 0 ? (
                        <div className="relative group/teams">
                          <div className={clsx('flex items-center gap-1.5 text-sm', isInactive ? 'text-gray-400' : 'text-gray-600')}>
                            <Users className="h-3.5 w-3.5 text-gray-400" />
                            <span>{links.length}</span>
                            {leadTeam && (
                              <Star className="h-3 w-3 text-amber-400 fill-current" />
                            )}
                          </div>
                          {/* Tooltip */}
                          <div className="absolute left-0 bottom-full mb-1 w-48 p-2 text-xs bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 group-hover/teams:opacity-100 transition-opacity pointer-events-none z-10">
                            {links.map((l: any) => (
                              <div key={l.team_node_id} className="flex items-center gap-1.5 py-0.5">
                                {l.is_lead && <Star className="w-3 h-3 text-amber-400 fill-current shrink-0" />}
                                <span className="truncate">{(l.team_node as any)?.name || 'Unknown'}</span>
                                {l.is_lead && <span className="text-amber-600 shrink-0">Lead</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">&mdash;</span>
                      )}
                    </div>

                    {/* Members */}
                    <div className="col-span-2">
                      {counts.total > 0 ? (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          {counts.pms > 0 && (
                            <span className={clsx(
                              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded',
                              isInactive ? 'bg-gray-100 text-gray-400' : 'bg-sky-50 text-sky-700',
                            )}>
                              {counts.pms} PM{counts.pms > 1 ? 's' : ''}
                            </span>
                          )}
                          {counts.analysts > 0 && (
                            <span className={clsx(
                              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded',
                              isInactive ? 'bg-gray-100 text-gray-400' : 'bg-gray-100 text-gray-600',
                            )}>
                              {counts.analysts} A
                            </span>
                          )}
                          {counts.total - counts.pms - counts.analysts > 0 && (
                            <span className="text-gray-400">
                              +{counts.total - counts.pms - counts.analysts}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">&mdash;</span>
                      )}
                    </div>

                    {/* Last Updated + Actions */}
                    <div className="col-span-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center text-sm text-gray-500">
                          <Calendar className="h-3 w-3 mr-1" />
                          {formatDistanceToNow(new Date(portfolio.updated_at || ''), { addSuffix: true })}
                        </div>

                        {/* Row action menu (Org Admin only) */}
                        {isOrgAdmin && (
                          <div className="relative" ref={openMenuId === portfolio.id ? menuRef : undefined}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenMenuId(openMenuId === portfolio.id ? null : portfolio.id)
                              }}
                              className="p-1 rounded hover:bg-gray-200 opacity-0 group-hover/row:opacity-100 transition-opacity"
                            >
                              <MoreHorizontal className="w-4 h-4 text-gray-500" />
                            </button>

                            {openMenuId === portfolio.id && (
                              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                                {isDiscarded ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setOpenMenuId(null)
                                      restoreMutation.mutate(portfolio.id)
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                    Restore
                                  </button>
                                ) : (
                                  <>
                                    {isArchived ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setOpenMenuId(null)
                                          setArchiveConfirm({ isOpen: true, portfolio, action: 'unarchive' })
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <ArchiveRestore className="w-4 h-4" />
                                        Unarchive
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setOpenMenuId(null)
                                          setArchiveConfirm({ isOpen: true, portfolio, action: 'archive' })
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Archive className="w-4 h-4" />
                                        Archive
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setOpenMenuId(null)
                                        setDiscardTarget({ id: portfolio.id, name: portfolio.name })
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                    >
                                      <Ban className="w-4 h-4" />
                                      Discard
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : portfolios?.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No portfolios yet"
            description={canCreate
              ? 'Create your first portfolio to get started.'
              : 'No portfolios have been created for this organization yet.'
            }
            action={canCreate ? {
              label: 'New Portfolio',
              icon: Plus,
              onClick: () => setShowNewModal(true),
            } : undefined}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="No portfolios match your filters"
            description="Try adjusting your search criteria or clearing filters."
            action={{
              label: 'Clear Filters',
              onClick: clearFilters
            }}
          />
        )}
      </Card>

      {/* New Portfolio Modal */}
      <NewPortfolioModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={handlePortfolioCreated}
      />

      {/* Archive / Unarchive Confirmation */}
      <ConfirmDialog
        isOpen={archiveConfirm.isOpen}
        onClose={() => setArchiveConfirm({ isOpen: false, portfolio: null, action: 'archive' })}
        onConfirm={() => {
          if (archiveConfirm.portfolio) {
            archiveMutation.mutate({
              portfolioId: archiveConfirm.portfolio.id,
              action: archiveConfirm.action,
            })
          }
        }}
        title={archiveConfirm.action === 'archive' ? 'Archive Portfolio' : 'Unarchive Portfolio'}
        message={
          archiveConfirm.action === 'archive'
            ? `"${archiveConfirm.portfolio?.name}" will be hidden from active views and become read-only. You can unarchive it later.`
            : `"${archiveConfirm.portfolio?.name}" will be restored to active status.`
        }
        confirmText={archiveConfirm.action === 'archive' ? 'Archive' : 'Unarchive'}
        variant={archiveConfirm.action === 'archive' ? 'warning' : 'info'}
        isLoading={archiveMutation.isPending}
      />

      {/* Discard Portfolio Modal */}
      <DiscardPortfolioModal
        isOpen={!!discardTarget}
        onClose={() => setDiscardTarget(null)}
        portfolio={discardTarget}
        organizationId={currentOrgId ?? undefined}
        onArchiveInstead={discardTarget ? () => {
          setArchiveConfirm({ isOpen: true, portfolio: discardTarget, action: 'archive' })
        } : undefined}
      />
    </div>
  )
}
