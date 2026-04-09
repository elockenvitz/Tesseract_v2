import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { BarChart3, TrendingUp, Briefcase, Users, RefreshCw, Globe, BookOpen, BookText, Settings } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { supabase } from '../../lib/supabase'
import { AddTeamMemberModal } from '../portfolios/AddTeamMemberModal'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { TabStateManager } from '../../lib/tabStateManager'
import { useOrganization } from '../../contexts/OrganizationContext'
import { logOrgActivity } from '../../lib/org-activity-log'
import { getUserDisplayName } from '../portfolio/tabs/portfolio-tab-types'
import type { PortfolioTabType } from '../portfolio/tabs/portfolio-tab-types'

// Tab components
import { OverviewTab } from '../portfolio/tabs/OverviewTab'
import { PositionsTab } from '../portfolio/tabs/PositionsTab'
import { PerformanceTab } from '../portfolio/tabs/PerformanceTab'
import { PortfolioLogTab } from '../portfolio/tabs/PortfolioLogTab'
import { TeamTab } from '../portfolio/tabs/TeamTab'
import { ProcessesTab } from '../portfolio/tabs/ProcessesTab'
import { InvestableUniverseSection } from '../portfolio/InvestableUniverseSection'
import { TradeJournalTab } from '../portfolio/tabs/TradeJournalTab'
import { HoldingsUploadPanel } from '../portfolio/HoldingsUploadPanel'
import { usePendingRationaleCount } from '../../hooks/useTradeJournal'

interface PortfolioTabProps {
  portfolio: any
  onNavigate?: (tab: { id: string; title: string; type: string; data?: any }) => void
}

// Map old tab names to new ones for migration
const MIGRATE_TAB: Record<string, PortfolioTabType> = {
  holdings: 'positions',
  notes: 'log',
  research: 'log',
  projects: 'processes',
  workflows: 'processes',
}

const TABS: { key: PortfolioTabType; label: string; icon: React.ElementType; badgeKey?: string }[] = [
  { key: 'overview', label: 'Overview', icon: Briefcase },
  { key: 'positions', label: 'Positions', icon: TrendingUp, badgeKey: 'holdings' },
  { key: 'performance', label: 'Performance', icon: BarChart3 },
  { key: 'log', label: 'Portfolio Log', icon: BookOpen },
  { key: 'journal', label: 'Trade Journal', icon: BookText, badgeKey: 'pendingRationale' },
  { key: 'team', label: 'Team', icon: Users, badgeKey: 'team' },
  { key: 'processes', label: 'Process', icon: RefreshCw },
  { key: 'universe', label: 'Universe', icon: Globe },
  { key: 'settings', label: 'Settings', icon: Settings },
]

export function PortfolioTab({ portfolio, onNavigate }: PortfolioTabProps) {
  const [activeTab, setActiveTab] = useState<PortfolioTabType>(() => {
    if (portfolio.initialTab) return portfolio.initialTab
    const savedState = TabStateManager.loadTabState(portfolio.id)
    const raw = savedState?.activeTab || 'overview'
    return MIGRATE_TAB[raw] || raw
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
  }>({ isOpen: false, teamMemberId: null, userName: '', role: '' })
  const [sortColumn, setSortColumn] = useState<string>('symbol')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const queryClient = useQueryClient()
  const { currentOrgId } = useOrganization()

  // Trade Journal pending rationale count
  const { data: pendingRationaleCount } = usePendingRationaleCount(portfolio.id)

  // Update local state when switching to a different portfolio
  useEffect(() => {
    if (portfolio.id) {
      const savedState = TabStateManager.loadTabState(portfolio.id)
      if (savedState?.activeTab) {
        const raw = savedState.activeTab
        setActiveTab(MIGRATE_TAB[raw] || raw)
      } else {
        setActiveTab('overview')
      }
      setHasLocalChanges(false)
    }
  }, [portfolio.id])

  // Navigate to a specific tab when requested externally
  useEffect(() => {
    if (portfolio.initialTab) {
      setActiveTab(portfolio.initialTab)
    }
  }, [portfolio._navTs])

  useEffect(() => { setIsTabStateInitialized(true) }, [])

  // Save tab state whenever it changes
  useEffect(() => {
    if (isTabStateInitialized && portfolio.id) {
      TabStateManager.saveTabState(portfolio.id, { activeTab })
    }
  }, [portfolio.id, activeTab, isTabStateInitialized])

  // ── Queries ──────────────────────────────────────────────

  const { data: notes } = useQuery({
    queryKey: ['portfolio-notes', portfolio.id],
    enabled: !!portfolio.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_notes')
        .select('*, author:users!portfolio_notes_updated_by_fkey(id, email, first_name, last_name)')
        .eq('portfolio_id', portfolio.id)
        .neq('is_deleted', true)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: holdings } = useQuery({
    queryKey: ['portfolio-holdings', portfolio.id],
    enabled: !!portfolio.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          *,
          assets(
            id, symbol, company_name, sector, industry, thesis, where_different,
            risks_to_thesis, priority, process_stage, created_at, updated_at,
            created_by, workflow_id,
            price_targets(type, price, timeframe, reasoning)
          )
        `)
        .eq('portfolio_id', portfolio.id)
        .order('date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

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
          id, portfolio_id, user_id, role, focus, created_at,
          user:users!inner (id, email, first_name, last_name)
        `)
        .eq('portfolio_id', portfolio.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data || []).filter(r => r.user !== null)
    },
  })

  const { data: universeAssets } = useQuery({
    queryKey: ['portfolio-universe-assets', portfolio.id],
    enabled: !!portfolio.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_universe_assets')
        .select(`
          id, asset_id, notes, added_at,
          asset:assets!inner (id, symbol, company_name, sector, industry)
        `)
        .eq('portfolio_id', portfolio.id)
        .order('added_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: universeFilters } = useQuery({
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

  // ── Derived data ─────────────────────────────────────────

  const filteredUniverseAssets = useMemo(() => {
    if (!allAssets || !universeFilters || universeFilters.length === 0) return []
    return allAssets.filter(asset =>
      universeFilters.every((filter: any) => {
        const { filter_type, filter_operator, filter_value } = filter
        switch (filter_type) {
          case 'sector': return filter_operator === 'include' ? asset.sector === filter_value : asset.sector !== filter_value
          case 'industry': return filter_operator === 'include' ? asset.industry === filter_value : asset.industry !== filter_value
          case 'country': return filter_operator === 'include' ? asset.country === filter_value : asset.country !== filter_value
          case 'exchange': return filter_operator === 'include' ? asset.exchange === filter_value : asset.exchange !== filter_value
          case 'market_cap': {
            if (!asset.market_cap) return false
            const mcM = Number(asset.market_cap) / 1000000
            if (filter_operator === 'gt') return mcM > parseFloat(filter_value.replace(/[>M]/g, ''))
            if (filter_operator === 'lt') return mcM < parseFloat(filter_value.replace(/[<M]/g, ''))
            if (filter_operator === 'between') {
              const [minS, maxS] = filter_value.split('-')
              return mcM >= parseFloat(minS.replace('M', '')) && mcM <= parseFloat(maxS.replace('M', ''))
            }
            return true
          }
          default: return true
        }
      })
    )
  }, [allAssets, universeFilters])

  const combinedUniverseAssets = useMemo(() => {
    const manualIds = new Set(universeAssets?.map(ua => ua.asset_id) || [])
    const filtered = filteredUniverseAssets.filter(a => !manualIds.has(a.id))
    return { manual: universeAssets || [], filtered, total: (universeAssets?.length || 0) + filtered.length }
  }, [universeAssets, filteredUniverseAssets])

  const teamMembersByRole = useMemo(() => {
    if (!teamWithUsers) return {}
    const grouped: Record<string, any[]> = {}
    for (const row of teamWithUsers as any[]) {
      const role = row.role as string
      if (!grouped[role]) grouped[role] = []
      const existing = grouped[role].findIndex(m => m.user.id === row.user.id)
      if (existing !== -1) {
        grouped[role][existing].teamRecordIds.push(row.id)
      } else {
        grouped[role].push({
          id: row.id,
          teamRecordIds: [row.id],
          user: row.user,
          focus: row.focus ? (row.focus as string).split(', ').filter(Boolean) : [],
          created_at: row.created_at,
        })
      }
    }
    return grouped
  }, [teamWithUsers])

  const sortedHoldings = useMemo(() => {
    if (!holdings) return []
    return [...holdings].sort((a, b) => {
      let aValue: any, bValue: any
      switch (sortColumn) {
        case 'symbol': aValue = a.assets?.symbol || ''; bValue = b.assets?.symbol || ''; break
        case 'company': aValue = a.assets?.company_name || ''; bValue = b.assets?.company_name || ''; break
        case 'sector': aValue = a.assets?.sector || ''; bValue = b.assets?.sector || ''; break
        case 'shares': aValue = parseFloat(a.shares) || 0; bValue = parseFloat(b.shares) || 0; break
        case 'avgCost': aValue = parseFloat(a.cost) || 0; bValue = parseFloat(b.cost) || 0; break
        case 'weight': {
          aValue = (parseFloat(a.shares) || 0) * (parseFloat(a.price) || 0)
          bValue = (parseFloat(b.shares) || 0) * (parseFloat(b.price) || 0)
          break
        }
        case 'updated': {
          aValue = a.assets?.updated_at ? new Date(a.assets.updated_at).getTime() : 0
          bValue = b.assets?.updated_at ? new Date(b.assets.updated_at).getTime() : 0
          break
        }
        case 'gainLoss': {
          const aS = parseFloat(a.shares) || 0, aP = parseFloat(a.price) || 0, aC = parseFloat(a.cost) || 0
          const bS = parseFloat(b.shares) || 0, bP = parseFloat(b.price) || 0, bC = parseFloat(b.cost) || 0
          aValue = (aS * aP) - (aS * aC); bValue = (bS * bP) - (bS * bC); break
        }
        case 'returnPercent': {
          const aS = parseFloat(a.shares) || 0, aP = parseFloat(a.price) || 0, aC = parseFloat(a.cost) || 0
          const bS = parseFloat(b.shares) || 0, bP = parseFloat(b.price) || 0, bC = parseFloat(b.cost) || 0
          const aCB = aS * aC, bCB = bS * bC
          aValue = aCB > 0 ? ((aS * aP - aCB) / aCB) * 100 : 0
          bValue = bCB > 0 ? ((bS * bP - bCB) / bCB) * 100 : 0
          break
        }
        default: return 0
      }
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const c = aValue.localeCompare(bValue); return sortDirection === 'asc' ? c : -c
      }
      const c = aValue - bValue; return sortDirection === 'asc' ? c : -c
    })
  }, [holdings, sortColumn, sortDirection])

  const totalValue = holdings?.reduce((sum: number, h: any) => sum + (parseFloat(h.shares) || 0) * (parseFloat(h.price) || 0), 0) || 0
  const totalCost = holdings?.reduce((sum: number, h: any) => sum + (parseFloat(h.shares) || 0) * (parseFloat(h.cost) || 0), 0) || 0
  const totalReturn = totalValue - totalCost
  const returnPercentage = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

  const teamCount = teamWithUsers
    ? new Set(teamWithUsers.map(t => `${t.user_id}-${t.role}`)).size
    : 0

  // ── Mutations ────────────────────────────────────────────

  const deleteTeamMemberMutation = useMutation({
    mutationFn: async (teamMemberIds: string) => {
      const ids = teamMemberIds.split(',')
      const { error } = await supabase.from('portfolio_team').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-with-users', portfolio.id] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team', portfolio.id] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-team-all'] })
      if (currentOrgId && deleteConfirm.teamMemberId) {
        logOrgActivity({
          organizationId: currentOrgId,
          action: 'portfolio_team.removed',
          targetType: 'portfolio',
          targetId: portfolio.id,
          entityType: 'portfolio_membership',
          actionType: 'role_revoked',
          details: { portfolio_name: portfolio.name, user_name: deleteConfirm.userName, role: deleteConfirm.role },
        })
      }
      setDeleteConfirm({ isOpen: false, teamMemberId: null, userName: '', role: '' })
    },
    onError: (error) => {
      console.error('Failed to delete team member:', error)
      alert(`Error deleting team member: ${error.message}`)
    },
  })

  // ── Handlers ─────────────────────────────────────────────

  const handleSort = (column: string) => {
    if (sortColumn === column) setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortColumn(column); setSortDirection('asc') }
  }

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-shrink-0">
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

      {/* Tabs Card */}
      <Card padding="none" className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {TABS.map(({ key, label, icon: Icon, badgeKey }) => {
              const isActive = activeTab === key
              let badge: number | null = null
              if (badgeKey === 'holdings' && holdings && holdings.length > 0) badge = holdings.length
              if (badgeKey === 'team' && teamCount > 0) badge = teamCount
              if (badgeKey === 'pendingRationale' && pendingRationaleCount && pendingRationaleCount > 0) badge = pendingRationaleCount

              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    isActive
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                    {badge !== null && (
                      <Badge
                        variant={badgeKey === 'pendingRationale' ? 'warning' : 'default'}
                        size="sm"
                      >
                        {badge}
                      </Badge>
                    )}
                  </div>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className={`flex-1 min-h-0 p-6 ${activeTab === 'universe' ? 'flex flex-col' : 'overflow-y-auto'}`}>
          {activeTab === 'overview' && (
            <OverviewTab
              portfolio={portfolio}
              holdings={holdings}
              notes={notes}
              totalValue={totalValue}
              totalReturn={totalReturn}
              returnPercentage={returnPercentage}
              teamCount={teamCount}
              combinedUniverseAssets={combinedUniverseAssets}
              onNavigate={onNavigate}
              onNavigateToTab={(tab) => setActiveTab(tab as PortfolioTabType)}
            />
          )}

          {activeTab === 'positions' && (
            <PositionsTab
              portfolioId={portfolio.id}
              holdings={holdings}
              sortedHoldings={sortedHoldings}
              totalValue={totalValue}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              onNavigate={onNavigate}
            />
          )}

          {activeTab === 'performance' && (
            <PerformanceTab
              portfolioId={portfolio.id}
              holdings={holdings}
              totalValue={totalValue}
              totalReturn={totalReturn}
              returnPercentage={returnPercentage}
            />
          )}

          {activeTab === 'log' && (
            <PortfolioLogTab
              portfolio={portfolio}
              portfolioId={portfolio.id}
            />
          )}

          {activeTab === 'journal' && (
            <TradeJournalTab
              portfolioId={portfolio.id}
              portfolio={portfolio}
            />
          )}

          {activeTab === 'team' && (
            <TeamTab
              portfolioId={portfolio.id}
              teamMembersByRole={teamMembersByRole}
              teamLoading={teamLoading}
              teamError={teamError}
              teamWithUsers={teamWithUsers}
              onEditMember={(member, role) => {
                setEditingTeamMember({
                  id: member.id,
                  user_id: member.user.id,
                  role,
                  focus: member.focus?.join(', ') || '',
                })
                setShowAddTeamMemberModal(true)
              }}
              onDeleteMember={(member, role) => {
                setDeleteConfirm({
                  isOpen: true,
                  teamMemberId: member.teamRecordIds.join(','),
                  userName: getUserDisplayName(member.user),
                  role,
                })
              }}
              onAddMember={() => {
                setEditingTeamMember(null)
                setShowAddTeamMemberModal(true)
              }}
            />
          )}

          {activeTab === 'processes' && (
            <ProcessesTab
              portfolio={portfolio}
              onNavigate={onNavigate}
            />
          )}

          {activeTab === 'universe' && (
            <InvestableUniverseSection portfolioId={portfolio.id} defaultExpanded collapsible={false} />
          )}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <HoldingsUploadPanel portfolioId={portfolio.id} portfolioName={portfolio.name} />
            </div>
          )}
        </div>
      </Card>

      {showAddTeamMemberModal && (
        <AddTeamMemberModal
          isOpen={showAddTeamMemberModal}
          onClose={() => { setShowAddTeamMemberModal(false); setEditingTeamMember(null) }}
          portfolioId={portfolio.id}
          portfolioName={portfolio.name}
          editingMember={editingTeamMember}
          onMemberAdded={async () => { await refetchTeamWithUsers() }}
        />
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, teamMemberId: null, userName: '', role: '' })}
        onConfirm={() => { if (deleteConfirm.teamMemberId) deleteTeamMemberMutation.mutate(deleteConfirm.teamMemberId) }}
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
