import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Users, X, Search, Trash2, ChevronDown, ChevronRight, Upload, Download, FileText, AlertCircle, ChevronUp, Shield, Eye, History, Calendar, ArrowRightLeft, RefreshCw, Clock, Plus, List, LayoutGrid, Grid3X3, Star, UserCheck, User, TrendingUp, TrendingDown, BarChart3, CheckCircle, UserPlus, Building2, FolderOpen, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'

// Helper function to get local date in YYYY-MM-DD format (not UTC)
const getLocalDateString = (date: Date = new Date()): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface CoverageManagerProps {
  isOpen?: boolean
  onClose?: () => void
  initialView?: 'active' | 'history' | 'requests'
  mode?: 'modal' | 'page'
}

interface CoverageRecord {
  id: string
  asset_id: string
  user_id: string
  analyst_name: string
  created_at: string
  updated_at: string
  start_date: string
  end_date: string | null
  is_active: boolean
  changed_by: string | null
  role?: string | null
  notes?: string | null
  portfolio_id?: string | null
  team_id?: string | null
  visibility?: 'team' | 'division' | 'firm'
  is_lead?: boolean
  assets: {
    id: string
    symbol: string
    company_name: string
    sector?: string
  } | null
  portfolios?: {
    id: string
    name: string
  } | null
  teams?: {
    id: string
    name: string
    node_type: string
  } | null
}

export function CoverageManager({ isOpen, onClose, initialView = 'active', mode = 'modal' }: CoverageManagerProps) {
  const [activeView, setActiveView] = useState<'active' | 'history' | 'requests'>(initialView)
  const [viewMode, setViewMode] = useState<'list' | 'workload' | 'matrix' | 'calendar' | 'team'>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [selectedAnalystId, setSelectedAnalystId] = useState<string | null>(null)
  const [teamFilter, setTeamFilter] = useState<string | null>(null)
  const [selectedStatCard, setSelectedStatCard] = useState<'analysts' | 'covered' | 'gaps' | 'average' | null>(null)
  const [matrixGroupBy, setMatrixGroupBy] = useState<'sector' | 'analyst' | 'portfolio' | 'role' | 'team'>('sector')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Determine if the component should be visible (page mode is always visible)
  const isVisible = mode === 'page' || isOpen

  // Sync activeView with initialView when modal opens
  useEffect(() => {
    if (isVisible) {
      setActiveView(initialView)
    }
  }, [isVisible, initialView])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState<string | null>(null)
  const [editingCoverageId, setEditingCoverageId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    coverageId: string | null
    assetSymbol: string
    analystName: string
  }>({
    isOpen: false,
    coverageId: null,
    assetSymbol: '',
    analystName: ''
  })
  const [deleteTimelineConfirm, setDeleteTimelineConfirm] = useState<{
    isOpen: boolean
    coverageId: string | null
    analystName: string
    startDate: string
    endDate: string | null
    isActive: boolean
  }>({
    isOpen: false,
    coverageId: null,
    analystName: '',
    startDate: '',
    endDate: null,
    isActive: false
  })
  const [viewHistoryAssetId, setViewHistoryAssetId] = useState<string | null>(null)
  const [showAllChanges, setShowAllChanges] = useState(false)
  const [comparisonPeriod, setComparisonPeriod] = useState<'7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom'>('30d')
  const [customDateRange, setCustomDateRange] = useState<{ start: string; end: string }>({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  })
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(50)
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set())
  const [showAllTimelinePeriods, setShowAllTimelinePeriods] = useState(false)
  const [selectedHistoryEvent, setSelectedHistoryEvent] = useState<any | null>(null)
  const [pendingTimelineChanges, setPendingTimelineChanges] = useState<{
    [coverageId: string]: {
      analyst?: { userId: string; analystName: string }
      startDate?: string
      endDate?: string | null
      isActive?: boolean
    }
  }>({})
  const [pendingTimelineDeletes, setPendingTimelineDeletes] = useState<Set<string>>(new Set())
  const [pendingNewCoverages, setPendingNewCoverages] = useState<Array<{
    id: string
    asset_id: string
    user_id: string
    analyst_name: string
    start_date: string
    end_date: string | null
    is_active: boolean
    changed_by?: string
    fromCoverageId?: string
  }>>([])
  const [editingDateValue, setEditingDateValue] = useState<{
    coverageId: string
    field: 'start' | 'end'
    value: string
  } | null>(null)
  const [editingAnalyst, setEditingAnalyst] = useState<string | null>(null)
  const [addingTransition, setAddingTransition] = useState<{
    fromCoverageId: string
    transitionDate: string
    newAnalystId: string
  } | null>(null)
  const [addingHistoricalPeriod, setAddingHistoricalPeriod] = useState<{
    assetId: string
    startDate: string
    endDate: string
    analystId: string
  } | null>(null)
  const [changingCurrentCoverage, setChangingCurrentCoverage] = useState<{
    assetId: string
    currentCoverageId: string
    currentAnalystName: string
    newAnalystId: string
  } | null>(null)
  const [endingCoverage, setEndingCoverage] = useState<{
    coverageId: string
    assetSymbol: string
    analystName: string
    endDate: string
  } | null>(null)
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean
    title: string
    message: string
  }>({
    isOpen: false,
    title: '',
    message: ''
  })
  const [requestingChange, setRequestingChange] = useState<{
    assetId: string
    assetSymbol: string
    currentUserId: string | null
    currentAnalystName: string | null
    currentRole: string | null
    requestedUserId: string
    requestedRole: string
    requestType: 'add' | 'change' | 'remove' | 'role_change'
    reason: string
  } | null>(null)
  const [rescindingRequest, setRescindingRequest] = useState<{
    requestId: string
    assetSymbol: string
  } | null>(null)
  const [addingCoverage, setAddingCoverage] = useState<{
    assetId: string
    analystId: string
    startDate: string
    endDate: string
    role: string
    portfolioIds: string[]
    notes: string
    teamId: string | null
    visibility: 'team' | 'division' | 'firm'
    isLead: boolean
  } | null>(null)
  const [primaryExistsConfirm, setPrimaryExistsConfirm] = useState<{
    isOpen: boolean
    assetId: string
    assetSymbol: string
    existingPrimaryUserId: string
    existingPrimaryName: string
    existingPrimaryCoverageId: string
    newAnalystId: string
    newAnalystName: string
    startDate: string
    portfolioIds: string[]
    notes: string
  } | null>(null)
  const [existingCoverageConfirm, setExistingCoverageConfirm] = useState<{
    isOpen: boolean
    assetId: string
    assetSymbol: string
    existingCoverage: Array<{ id: string; user_id: string; analyst_name: string }>
    newAnalystId: string
    newAnalystName: string
    startDate: string
    endDate: string
    notes: string
    isLead: boolean
  } | null>(null)
  const [editingVisibility, setEditingVisibility] = useState<{
    coverageId: string
    currentVisibility: 'team' | 'division' | 'firm'
  } | null>(null)
  const [assetSearchQuery, setAssetSearchQuery] = useState('')
  const [analystSearchQuery, setAnalystSearchQuery] = useState('')
  const [showAssetDropdown, setShowAssetDropdown] = useState(false)
  const [showAnalystDropdown, setShowAnalystDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const adminBadgeRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const hasGlobalCoverageAdmin = user?.coverage_admin || false
  const [showAdminBadgeDropdown, setShowAdminBadgeDropdown] = useState(false)

  // Fetch all coverage records with asset details
  const { data: coverageRecords, isLoading: coverageLoading } = useQuery({
    queryKey: ['all-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('*, assets(*), portfolios(id, name), teams:org_chart_nodes!coverage_team_id_fkey(id, name, node_type)')
        .order('updated_at', { ascending: false })

      if (error) {
        console.error('Failed to fetch coverage:', error)
        throw error
      }

      return data as CoverageRecord[]
    },
    enabled: isVisible,
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // Fetch all assets for adding new coverage
  const { data: assets } = useQuery({
    queryKey: ['assets-for-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, country, exchange, market_cap')
        .order('symbol', { ascending: true })

      if (error) throw error
      return data || []
    },
    enabled: isVisible,
  })

  // Fetch coverage history for a specific asset
  const { data: assetCoverageHistory } = useQuery({
    queryKey: ['asset-coverage-history', viewHistoryAssetId],
    queryFn: async () => {
      if (!viewHistoryAssetId) return []
      const { data, error } = await supabase
        .from('coverage')
        .select('*, assets(*)')
        .eq('asset_id', viewHistoryAssetId)
        .order('start_date', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!viewHistoryAssetId
  })

  // Fetch coverage change history for a specific asset
  const { data: coverageChangeHistory } = useQuery({
    queryKey: ['coverage-change-history', viewHistoryAssetId],
    queryFn: async () => {
      if (!viewHistoryAssetId) return []
      const { data, error } = await supabase
        .from('coverage_history')
        .select(`
          *,
          changed_by_user:users!coverage_history_changed_by_fkey(id, first_name, last_name, email)
        `)
        .eq('asset_id', viewHistoryAssetId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!viewHistoryAssetId
  })

  // Fetch all users for analyst selection
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, coverage_admin')
        .order('first_name')

      if (error) throw error
      return data || []
    }
  })

  // Fetch org admin status for current user
  const { data: isOrgAdmin = false, isLoading: isLoadingOrgAdmin } = useQuery({
    queryKey: ['org-admin-status', user?.id],
    queryFn: async () => {
      if (!user?.id) return false
      const { data, error } = await supabase
        .from('organization_memberships')
        .select('is_org_admin')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (error) return false
      return data?.is_org_admin || false
    },
    enabled: !!user?.id
  })

  // Fetch team memberships to show what teams each analyst belongs to
  const { data: userTeamMemberships } = useQuery({
    queryKey: ['user-team-memberships'],
    queryFn: async () => {
      // Get org chart node members with their node info (teams are stored in org_chart_nodes)
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .select(`
          user_id,
          node:node_id (id, name, node_type),
          role
        `)

      if (error) throw error

      // Group by user_id, including all org chart node memberships
      const byUser = new Map<string, Array<{ id: string; name: string; type: string; role?: string }>>()
      ;(data || []).forEach((m: any) => {
        if (m.user_id && m.node) {
          if (!byUser.has(m.user_id)) {
            byUser.set(m.user_id, [])
          }
          byUser.get(m.user_id)!.push({
            id: m.node.id,
            name: m.node.name,
            type: m.node.node_type,
            role: m.role
          })
        }
      })
      return byUser
    },
    enabled: isVisible
  })

  // Fetch all org chart nodes for the team filter dropdown (with parent info for disambiguation)
  const { data: allOrgChartNodes } = useQuery({
    queryKey: ['org-chart-nodes-for-filter'],
    queryFn: async () => {
      // Fetch ALL nodes to build hierarchy (not just team/portfolio/division)
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id, is_non_investment')
        .order('node_type')
        .order('name')

      if (error) throw error

      // Fetch node links (for portfolios linked to multiple teams)
      const { data: links, error: linksError } = await supabase
        .from('org_chart_node_links')
        .select('node_id, linked_node_id')

      if (linksError) throw linksError

      // Build a map for quick parent lookup
      const nodeMap = new Map((data || []).map(n => [n.id, n]))

      // Build a map of node_id -> linked team names
      const nodeLinksMap = new Map<string, string[]>()
      for (const link of (links || [])) {
        const linkedNode = nodeMap.get(link.linked_node_id)
        if (linkedNode) {
          const existing = nodeLinksMap.get(link.node_id) || []
          existing.push(linkedNode.name)
          nodeLinksMap.set(link.node_id, existing)
        }
      }

      // Check if a node or any of its ancestors is marked as non-investment
      const isNonInvestmentNode = (node: any): boolean => {
        if (node.is_non_investment) return true
        if (node.parent_id) {
          const parent = nodeMap.get(node.parent_id)
          if (parent) return isNonInvestmentNode(parent)
        }
        return false
      }

      // Get display name - for portfolios with links, show all linked teams
      const getDisplayName = (node: any) => {
        const linkedTeams = nodeLinksMap.get(node.id)
        if (linkedTeams && linkedTeams.length > 0) {
          return `${node.name} (${linkedTeams.join(', ')})`
        }
        // Fallback to parent name
        if (node.parent_id) {
          const parent = nodeMap.get(node.parent_id)
          return parent?.name ? `${node.name} (${parent.name})` : node.name
        }
        return node.name
      }

      // Filter to only team/portfolio/division for the dropdown, excluding non-investment nodes
      const filteredNodes = (data || [])
        .filter(n => ['team', 'portfolio', 'division'].includes(n.node_type) && !isNonInvestmentNode(n))
        .map((node: any) => ({
          ...node,
          displayName: getDisplayName(node),
          linkedNodeIds: (links || []).filter(l => l.node_id === node.id).map(l => l.linked_node_id)
        }))

      return { nodes: filteredNodes, allNodes: data || [], nodeLinks: links || [] }
    },
    enabled: isVisible
  })

  // Helper function to get all descendant node IDs for hierarchical filtering
  const getDescendantNodeIds = (nodeId: string): Set<string> => {
    const result = new Set<string>([nodeId])
    const allNodes = allOrgChartNodes?.allNodes || []

    const findChildren = (parentId: string) => {
      allNodes.forEach(node => {
        if (node.parent_id === parentId && !result.has(node.id)) {
          result.add(node.id)
          findChildren(node.id) // Recursively find children
        }
      })
    }

    findChildren(nodeId)
    return result
  }

  // Helper function to get ancestor node IDs (going UP the tree)
  const getAncestorNodeIds = (nodeId: string): Set<string> => {
    const result = new Set<string>([nodeId])
    const allNodes = allOrgChartNodes?.allNodes || []
    const nodeMap = new Map(allNodes.map(n => [n.id, n]))

    let currentNode = nodeMap.get(nodeId)
    while (currentNode?.parent_id) {
      result.add(currentNode.parent_id)
      currentNode = nodeMap.get(currentNode.parent_id)
    }

    return result
  }

  // Helper function to check if user can manage coverage for a specific node
  // Returns true if:
  // 1. User has global coverage_admin AND node doesn't have override
  // 2. User is coverage admin for this specific node
  // 3. User is coverage admin for an ancestor node AND no override exists between them
  const canManageCoverageForNode = (nodeId: string | null | undefined): boolean => {
    // No node specified - check if user has any coverage admin rights
    if (!nodeId) {
      return !!hasAnyCoverageAdminRights || userCoverageAdminNodes.length > 0
    }

    const hasOverride = overrideNodes.includes(nodeId)

    // Global coverage admin can manage unless node has override
    if (hasAnyCoverageAdminRights && !hasOverride) {
      return true
    }

    // Check if user is explicitly a coverage admin for this node
    if (userCoverageAdminNodes.includes(nodeId)) {
      return true
    }

    // Check if user is coverage admin for any ancestor (cascading)
    // But stop if we hit an override node
    const allNodes = allOrgChartNodes?.allNodes || []
    const nodeMap = new Map(allNodes.map(n => [n.id, n]))
    let currentNode = nodeMap.get(nodeId)

    while (currentNode?.parent_id) {
      // If we hit an override node, stop checking ancestors
      if (overrideNodes.includes(currentNode.id)) {
        break
      }

      // Check if user is coverage admin for this ancestor
      if (userCoverageAdminNodes.includes(currentNode.parent_id)) {
        return true
      }

      currentNode = nodeMap.get(currentNode.parent_id)
    }

    return false
  }

  // Fetch all portfolios for the portfolio assignment feature
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')

      if (error) throw error
      return data || []
    },
    enabled: isVisible
  })

  // Fetch user's node-level coverage admin memberships (excluding blocked)
  const { data: userCoverageAdminNodes = [] } = useQuery({
    queryKey: ['user-coverage-admin-nodes', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .select('node_id')
        .eq('user_id', user.id)
        .eq('is_coverage_admin', true)
        .or('coverage_admin_blocked.is.null,coverage_admin_blocked.eq.false')

      if (error) throw error
      return (data || []).map(d => d.node_id)
    },
    enabled: !!user?.id && isVisible
  })

  // Fetch nodes with coverage_admin_override
  const { data: overrideNodes = [] } = useQuery({
    queryKey: ['coverage-admin-override-nodes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id')
        .eq('coverage_admin_override', true)

      if (error) throw error
      return (data || []).map(d => d.id)
    },
    enabled: isVisible
  })

  // Check if user has any coverage admin capability (global or node-level)
  const hasAnyCoverageAdminRights = hasGlobalCoverageAdmin || userCoverageAdminNodes.length > 0

  // Get the selected node details to check if it's a portfolio
  const selectedNode = allOrgChartNodes?.nodes?.find((n: any) => n.id === teamFilter)
  const isPortfolioSelected = selectedNode?.node_type === 'portfolio'

  // Get the portfolio ID from portfolios table when a portfolio node is selected
  const selectedPortfolioId = isPortfolioSelected && portfolios
    ? portfolios.find(p => p.name === selectedNode.name)?.id
    : null

  // Fetch investable universe assets for the selected portfolio
  const { data: portfolioUniverseAssets } = useQuery({
    queryKey: ['portfolio-universe-assets-coverage', selectedPortfolioId],
    enabled: !!selectedPortfolioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_universe_assets')
        .select('asset_id')
        .eq('portfolio_id', selectedPortfolioId)
      if (error) throw error
      return data?.map(ua => ua.asset_id) || []
    },
  })

  // Fetch investable universe filters for the selected portfolio
  const { data: portfolioUniverseFilters } = useQuery({
    queryKey: ['portfolio-universe-filters-coverage', selectedPortfolioId],
    enabled: !!selectedPortfolioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_universe_filters')
        .select('*')
        .eq('portfolio_id', selectedPortfolioId)
      if (error) throw error
      return data || []
    },
  })

  // Compute assets matching portfolio filters
  const portfolioFilteredAssetIds = React.useMemo(() => {
    if (!assets || !portfolioUniverseFilters || portfolioUniverseFilters.length === 0) return []

    return assets.filter(asset => {
      return portfolioUniverseFilters.every((filter: any) => {
        const { filter_type, filter_operator, filter_value } = filter

        switch (filter_type) {
          case 'sector':
            if (filter_operator === 'include') return asset.sector === filter_value
            if (filter_operator === 'exclude') return asset.sector !== filter_value
            return true

          case 'industry':
            if (filter_operator === 'include') return (asset as any).industry === filter_value
            if (filter_operator === 'exclude') return (asset as any).industry !== filter_value
            return true

          case 'country':
            if (filter_operator === 'include') return (asset as any).country === filter_value
            if (filter_operator === 'exclude') return (asset as any).country !== filter_value
            return true

          case 'exchange':
            if (filter_operator === 'include') return (asset as any).exchange === filter_value
            if (filter_operator === 'exclude') return (asset as any).exchange !== filter_value
            return true

          case 'market_cap':
            const marketCap = (asset as any).market_cap
            if (!marketCap) return false
            const marketCapInMillions = Number(marketCap) / 1000000

            if (filter_operator === 'gt') {
              const threshold = parseFloat(filter_value.replace(/[>M]/g, ''))
              return marketCapInMillions > threshold
            }
            if (filter_operator === 'lt') {
              const threshold = parseFloat(filter_value.replace(/[<M]/g, ''))
              return marketCapInMillions < threshold
            }
            if (filter_operator === 'between') {
              const [minStr, maxStr] = filter_value.split('-')
              const min = parseFloat(minStr.replace('M', ''))
              const max = parseFloat(maxStr.replace('M', ''))
              return marketCapInMillions >= min && marketCapInMillions <= max
            }
            return true

          default:
            return true
        }
      })
    }).map(a => a.id)
  }, [assets, portfolioUniverseFilters])

  // Check if the portfolio has any universe configuration (filters or manual assets)
  const hasUniverseConfiguration = React.useMemo(() => {
    const hasFilters = portfolioUniverseFilters && portfolioUniverseFilters.length > 0
    const hasManualAssets = portfolioUniverseAssets && portfolioUniverseAssets.length > 0
    return hasFilters || hasManualAssets
  }, [portfolioUniverseFilters, portfolioUniverseAssets])

  // Combined investable universe asset IDs (manual + filter-matched)
  const investableUniverseAssetIds = React.useMemo(() => {
    if (!isPortfolioSelected) return null
    const manualIds = portfolioUniverseAssets || []
    const filterIds = portfolioFilteredAssetIds || []
    return new Set([...manualIds, ...filterIds])
  }, [isPortfolioSelected, portfolioUniverseAssets, portfolioFilteredAssetIds])

  // Fetch all teams (org chart nodes of type 'team') for team-scoped coverage
  const { data: allTeams } = useQuery({
    queryKey: ['all-teams-for-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .eq('node_type', 'team')
        .order('name')

      if (error) throw error
      return data || []
    },
    enabled: isVisible
  })

  // Fetch organization-level coverage settings
  const { data: coverageSettings } = useQuery({
    queryKey: ['coverage-settings'],
    queryFn: async () => {
      // First get the organization from user's membership
      const { data: orgMembership, error: orgError } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user?.id)
        .single()

      if (orgError || !orgMembership?.organization_id) {
        return null
      }

      const { data, error } = await supabase
        .from('coverage_settings')
        .select('*')
        .eq('organization_id', orgMembership.organization_id)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data || null
    },
    enabled: isVisible && !!user?.id
  })

  // Fetch user's team memberships from org_chart_node_members
  // Users are typically members of portfolios, so we need to find the team through the hierarchy
  const { data: userTeams } = useQuery({
    queryKey: ['user-team-memberships', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Get the user's node memberships (they might be in portfolios, teams, etc.)
      const { data: memberships, error: membershipError } = await supabase
        .from('org_chart_node_members')
        .select('node_id, is_admin')
        .eq('user_id', user.id)

      if (membershipError) throw membershipError
      if (!memberships || memberships.length === 0) return []

      // Get the node details for these memberships
      const nodeIds = memberships.map(m => m.node_id)
      const { data: nodes, error: nodesError } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .in('id', nodeIds)

      if (nodesError) throw nodesError
      if (!nodes || nodes.length === 0) return []

      // Find teams - either directly if user is team member, or through parent hierarchy
      const teams: Array<{ id: string; name: string; node_type: string; parent_id: string | null; is_admin?: boolean }> = []
      const membershipMap = new Map(memberships.map(m => [m.node_id, m.is_admin]))

      for (const node of nodes) {
        if (node.node_type === 'team') {
          // User is directly a member of a team
          teams.push({ ...node, is_admin: membershipMap.get(node.id) })
        } else if (node.node_type === 'portfolio' && node.parent_id) {
          // User is a member of a portfolio - find the parent team
          const { data: parentTeam } = await supabase
            .from('org_chart_nodes')
            .select('id, name, node_type, parent_id')
            .eq('id', node.parent_id)
            .eq('node_type', 'team')
            .single()

          if (parentTeam && !teams.find(t => t.id === parentTeam.id)) {
            teams.push({ ...parentTeam, is_admin: membershipMap.get(node.id) })
          }
        }
      }

      return teams
    },
    enabled: isVisible && !!user?.id
  })

  // Fetch all major coverage events for history tab
  const { data: allCoverageEvents, isLoading: historyLoading, isFetching: historyFetching } = useQuery({
    queryKey: ['all-coverage-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage_history')
        .select(`
          *,
          assets(id, symbol, company_name)
        `)
        .in('change_type', ['created', 'analyst_changed', 'deleted', 'dates_changed', 'coverage_added', 'historical_added'])
        .limit(100)

      if (error) {
        console.error('Error fetching coverage events:', error)
        throw error
      }
      return data || []
    },
    enabled: isVisible && activeView === 'history'
  })

  // Fetch coverage requests
  const { data: coverageRequests, isLoading: requestsLoading, isFetching: requestsFetching } = useQuery({
    queryKey: ['coverage-requests', user?.id],
    queryFn: async () => {
      let query = supabase
        .from('coverage_requests')
        .select('*, assets(*), requested_by_user:users!coverage_requests_requested_by_fkey(id, email, first_name, last_name), reviewed_by_user:users!coverage_requests_reviewed_by_fkey(id, email, first_name, last_name)')
        .order('created_at', { ascending: false })

      // Non-admins can only see their own requests
      if (!hasAnyCoverageAdminRights && user?.id) {
        query = query.eq('requested_by', user.id)
      }

      const { data, error } = await query

      if (error) throw error
      return data || []
    },
    enabled: isVisible && activeView === 'requests'
  })

  // Set showAllChanges default based on user role
  // Non-admins see history expanded by default (they need to track changes they can't make)
  // Admins see it collapsed (they focus on making edits, can expand if needed)
  useEffect(() => {
    if (user) {
      setShowAllChanges(!user.coverage_admin)
    }
  }, [user])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(null)
        setEditingCoverageId(null)
      }
    }

    if (showUserDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserDropdown])

  // Close Add Coverage dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is outside both dropdowns
      if (!target.closest('.asset-search-container') && !target.closest('.analyst-search-container')) {
        setShowAssetDropdown(false)
        setShowAnalystDropdown(false)
      }
    }

    if (showAssetDropdown || showAnalystDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAssetDropdown, showAnalystDropdown])

  // Close admin badge dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (adminBadgeRef.current && !adminBadgeRef.current.contains(event.target as Node)) {
        setShowAdminBadgeDropdown(false)
      }
    }

    if (showAdminBadgeDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAdminBadgeDropdown])

  // Determine if admin badge is ready (both org admin and coverage admin status loaded)
  // Coverage admin can be global (user.coverage_admin) or node-level (userCoverageAdminNodes)
  const hasNodeLevelCoverageAdmin = userCoverageAdminNodes.length > 0
  const isCoverageAdmin = hasGlobalCoverageAdmin || hasNodeLevelCoverageAdmin
  const isAdminBadgeReady = !isLoadingOrgAdmin

  // Update coverage mutation
  const updateCoverageMutation = useMutation({
    mutationFn: async ({ coverageId, userId, analystName }: { coverageId: string; userId: string; analystName: string }) => {
      const updateData = {
        user_id: userId,
        analyst_name: analystName,
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('coverage')
        .update(updateData)
        .eq('id', coverageId)
        .select()

      if (error) {
        console.error('Failed to update coverage:', error)
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      setShowUserDropdown(null)
      setEditingCoverageId(null)
    },
    onError: (error) => {
      console.error('Coverage update error:', error)
    }
  })

  // Bulk upload coverage mutation
  const bulkUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setIsUploading(true)
      setUploadErrors([])
      setUploadSuccess(null)
      
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      
      if (lines.length === 0) {
        throw new Error('File is empty')
      }
      
      // Parse CSV (expecting: Symbol, Analyst Name, Email)
      const records = []
      const errors = []
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line || (i === 0 && line.toLowerCase().includes('symbol'))) continue // Skip header
        
        const [symbol, analystName, email] = line.split(',').map(s => s.trim().replace(/"/g, ''))
        
        if (!symbol || !analystName) {
          errors.push(`Line ${i + 1}: Missing symbol or analyst name`)
          continue
        }
        
        // Find asset by symbol
        const asset = assets?.find(a => a.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset) {
          errors.push(`Line ${i + 1}: Asset "${symbol}" not found`)
          continue
        }
        
        // Find user by email if provided, otherwise use analyst name as-is
        let userId = user?.id // Default to current user
        if (email) {
          const foundUser = users?.find(u => u.email?.toLowerCase() === email.toLowerCase())
          if (foundUser) {
            userId = foundUser.id
          } else {
            errors.push(`Line ${i + 1}: User with email "${email}" not found, using current user`)
          }
        }
        
        records.push({
          asset_id: asset.id,
          user_id: userId,
          analyst_name: analystName
        })
      }
      
      if (errors.length > 0) {
        setUploadErrors(errors)
      }
      
      if (records.length === 0) {
        throw new Error('No valid records to upload')
      }
      
      // Insert records
      const { error } = await supabase
        .from('coverage')
        .insert(records)
      
      if (error) throw error
      
      return { recordsCount: records.length, errorsCount: errors.length }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      setUploadSuccess(`Successfully uploaded ${result.recordsCount} coverage assignments${result.errorsCount > 0 ? ` with ${result.errorsCount} warnings` : ''}`)
      setUploadFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    onError: (error) => {
      setUploadErrors([error.message])
    },
    onSettled: () => {
      setIsUploading(false)
    }
  })

  // Delete coverage mutation
  const deleteCoverageMutation = useMutation({
    mutationFn: async (coverageId: string) => {
      const { error } = await supabase
        .from('coverage')
        .delete()
        .eq('id', coverageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
    }
  })

  // Update coverage visibility mutation
  const updateVisibilityMutation = useMutation({
    mutationFn: async ({ coverageId, visibility }: { coverageId: string; visibility: 'team' | 'division' | 'firm' }) => {
      const { error } = await supabase
        .from('coverage')
        .update({ visibility, updated_at: new Date().toISOString() })
        .eq('id', coverageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      setEditingVisibility(null)
    }
  })

  // Helper to check if user can change visibility based on settings
  const canChangeVisibility = (coverage: CoverageRecord): boolean => {
    const permission = coverageSettings?.visibility_change_permission || 'anyone'

    if (permission === 'anyone') return true
    if (permission === 'coverage_admin') return canManageCoverageForNode(coverage.team_id)
    if (permission === 'team_lead') {
      // Check if user is coverage admin for this team or team lead
      if (canManageCoverageForNode(coverage.team_id)) return true
      // Check if user is an admin of the team
      const isTeamLead = userTeams?.some(t => t.id === coverage.team_id && t.is_admin)
      return !!isTeamLead
    }
    return false
  }

  // Create coverage request mutation (for non-admins)
  const createCoverageRequestMutation = useMutation({
    mutationFn: async (request: {
      asset_id: string
      current_user_id: string | null
      current_analyst_name: string | null
      requested_user_id: string
      requested_analyst_name: string
      request_type: 'add' | 'change' | 'remove'
      reason: string
    }) => {
      const { error } = await supabase
        .from('coverage_requests')
        .insert({
          ...request,
          requested_by: user?.id,
          status: 'pending'
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
      setErrorModal({
        isOpen: true,
        title: 'Request Submitted',
        message: 'Your coverage change request has been submitted for admin approval.'
      })
    }
  })

  // Approve coverage request mutation (for admins)
  const approveCoverageRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const request = coverageRequests?.find(r => r.id === requestId)
      if (!request) throw new Error('Request not found')

      // First update the request status
      const { error: requestError } = await supabase
        .from('coverage_requests')
        .update({
          status: 'approved',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId)

      if (requestError) throw requestError

      // Then execute the requested action
      if (request.request_type === 'add') {
        const { error } = await supabase
          .from('coverage')
          .insert({
            asset_id: request.asset_id,
            user_id: request.requested_user_id,
            analyst_name: request.requested_analyst_name,
            start_date: getLocalDateString(),
            is_active: true
          })
        if (error) throw error
      } else if (request.request_type === 'change') {
        const { error } = await supabase
          .from('coverage')
          .update({
            user_id: request.requested_user_id,
            analyst_name: request.requested_analyst_name,
            changed_by: user?.id
          })
          .eq('asset_id', request.asset_id)
          .eq('is_active', true)
        if (error) throw error
      } else if (request.request_type === 'remove') {
        const { error } = await supabase
          .from('coverage')
          .delete()
          .eq('asset_id', request.asset_id)
          .eq('user_id', request.current_user_id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
    }
  })

  // Deny coverage request mutation (for admins)
  const denyCoverageRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from('coverage_requests')
        .update({
          status: 'denied',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
    }
  })

  // Rescind coverage request mutation (for users to cancel their own requests)
  const rescindCoverageRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase
        .from('coverage_requests')
        .update({
          status: 'rescinded',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .eq('requested_by', user?.id) // Ensure users can only rescind their own requests
        .select()

      if (error) {
        console.error('Rescind error:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
      setErrorModal({
        isOpen: true,
        title: 'Request Cancelled',
        message: 'Your coverage change request has been cancelled.'
      })
    },
    onError: (error) => {
      console.error('Rescind mutation error:', error)
      setErrorModal({
        isOpen: true,
        title: 'Error Cancelling Request',
        message: 'Failed to cancel the coverage request. Please try again.'
      })
    }
  })

  // Resubmit coverage request mutation (for users to resubmit rescinded requests)
  const resubmitCoverageRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase
        .from('coverage_requests')
        .update({
          status: 'pending',
          updated_at: new Date().toISOString(),
          reviewed_by: null,
          reviewed_at: null
        })
        .eq('id', requestId)
        .eq('requested_by', user?.id) // Ensure users can only resubmit their own requests
        .select()

      if (error) {
        console.error('Resubmit error:', error)
        throw error
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage-requests'] })
      setErrorModal({
        isOpen: true,
        title: 'Request Resubmitted',
        message: 'Your coverage change request has been resubmitted for admin review.'
      })
    },
    onError: (error) => {
      console.error('Resubmit mutation error:', error)
      setErrorModal({
        isOpen: true,
        title: 'Error Resubmitting Request',
        message: 'Failed to resubmit the coverage request. Please try again.'
      })
    }
  })

  // Mutation to save all pending timeline changes
  const saveTimelineChangesMutation = useMutation({
    mutationFn: async () => {
      const errors: string[] = []

      // Process analyst changes, date changes, deletions, and new coverages
      for (const [coverageId, changes] of Object.entries(pendingTimelineChanges)) {
        const updateData: any = {}
        if (changes.analyst) {
          updateData.user_id = changes.analyst.userId
          updateData.analyst_name = changes.analyst.analystName
        }
        if (changes.startDate !== undefined) updateData.start_date = changes.startDate
        if (changes.endDate !== undefined) updateData.end_date = changes.endDate
        if (changes.isActive !== undefined) updateData.is_active = changes.isActive

        if (Object.keys(updateData).length > 0) {
          updateData.changed_by = user?.id
          const { error } = await supabase.from('coverage').update(updateData).eq('id', coverageId)
          if (error) {
            console.error('Error updating coverage:', error)
            errors.push(`Update failed: ${error.message}`)
          }
        }
      }

      // Process deletions
      for (const coverageId of pendingTimelineDeletes) {
        const { error } = await supabase.from('coverage').delete().eq('id', coverageId)
        if (error) {
          console.error('Error deleting coverage:', error)
          errors.push(`Delete failed: ${error.message}`)
        }
      }

      // Process new coverages
      for (const newCoverage of pendingNewCoverages) {
        const { id, fromCoverageId, ...insertData } = newCoverage
        const { error } = await supabase.from('coverage').insert(insertData)
        if (error) {
          console.error('Error inserting coverage:', error)
          errors.push(`Insert failed: ${error.message}`)
        }
      }

      if (errors.length > 0) {
        throw new Error(errors.join('\n'))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage-change-history'] })
      queryClient.invalidateQueries({ queryKey: ['all-coverage-events'] })
      queryClient.invalidateQueries({ queryKey: ['asset-coverage-history'] })

      // Clear pending changes
      setPendingTimelineChanges({})
      setPendingTimelineDeletes(new Set())
      setPendingNewCoverages([])

      // Keep timeline open to show the result, just close modals
      setAddingTransition(null)
      setAddingHistoricalPeriod(null)
      setChangingCurrentCoverage(null)
    },
    onError: (error: Error) => {
      console.error('Failed to save timeline changes:', error)
      setErrorModal({
        isOpen: true,
        title: 'Failed to Save Changes',
        message: error.message || 'An error occurred while saving changes. Please try again.'
      })
    }
  })

  const handleEditCoverage = (coverageId: string) => {
    setEditingCoverageId(coverageId)
    setShowUserDropdown(coverageId)
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setUploadFile(file)
      setUploadErrors([])
      setUploadSuccess(null)
    }
  }
  
  const handleUpload = () => {
    if (uploadFile) {
      bulkUploadMutation.mutate(uploadFile)
    }
  }
  
  const downloadTemplate = () => {
    const csvContent = 'Symbol,Analyst Name,Email (optional)\nAAPL,John Smith,john.smith@company.com\nMSFT,Jane Doe,jane.doe@company.com\nGOOGL,Bob Johnson,'
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'coverage_template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  const handleDeleteCoverage = (coverageId: string, assetSymbol: string, analystName: string) => {
    setDeleteConfirm({
      isOpen: true,
      coverageId,
      assetSymbol,
      analystName
    })
  }

  const confirmDeleteCoverage = () => {
    if (deleteConfirm.coverageId) {
      deleteCoverageMutation.mutate(deleteConfirm.coverageId)
    }
  }

  const getUserDisplayName = (user: any) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email?.split('@')[0] || 'Unknown'
  }

  const filteredCoverage = (() => {
    let records = coverageRecords || []

    // Apply activeView filter
    if (activeView === 'active') {
      records = records.filter(coverage => coverage.is_active)

      // Filter to only include coverage that has already started (start_date <= today)
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD format

      records = records.filter(coverage => {
        const startDateStr = coverage.start_date.split('T')[0] // YYYY-MM-DD format
        // Only include coverage that has already started (start_date <= today)
        return startDateStr <= todayStr
      })

      // Sort by asset symbol, then by analyst name for consistent display
      records = records.sort((a, b) => {
        const symbolCompare = (a.assets?.symbol || '').localeCompare(b.assets?.symbol || '')
        if (symbolCompare !== 0) return symbolCompare
        return (a.analyst_name || '').localeCompare(b.analyst_name || '')
      })
    } else if (activeView === 'history') {
      // Only show coverage that was previously active (not future coverage that never became active)
      records = records.filter(coverage => !coverage.is_active && coverage.end_date !== null)
    } else if (activeView === 'requests') {
      return [] // Don't show coverage table in requests view
    }

    // Apply search filter
    if (searchQuery) {
      records = records.filter(coverage =>
        coverage.assets?.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coverage.assets?.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        coverage.analyst_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Apply team filter - show coverage where analyst is a member of the selected node OR any descendant
    // For portfolios, include all linked teams and their hierarchies
    if (teamFilter && userTeamMemberships) {
      let relevantNodeIds: Set<string>

      if (isPortfolioSelected) {
        // For portfolios: get all linked teams and their descendants
        const selectedNodeData = allOrgChartNodes?.nodes?.find((n: any) => n.id === teamFilter)
        const linkedTeamIds = selectedNodeData?.linkedNodeIds || []

        relevantNodeIds = new Set<string>([teamFilter])

        // Include all linked teams and their descendants/ancestors
        for (const linkedTeamId of linkedTeamIds) {
          // Add the linked team and all its descendants
          const descendants = getDescendantNodeIds(linkedTeamId)
          descendants.forEach(id => relevantNodeIds.add(id))
          // Add ancestors above the linked team
          const ancestors = getAncestorNodeIds(linkedTeamId)
          ancestors.forEach(id => relevantNodeIds.add(id))
        }

        // If no links, fallback to parent team
        if (linkedTeamIds.length === 0) {
          const allNodes = allOrgChartNodes?.allNodes || []
          const nodeData = allNodes.find(n => n.id === teamFilter)
          if (nodeData?.parent_id) {
            const descendants = getDescendantNodeIds(nodeData.parent_id)
            descendants.forEach(id => relevantNodeIds.add(id))
            const ancestors = getAncestorNodeIds(nodeData.parent_id)
            ancestors.forEach(id => relevantNodeIds.add(id))
          }
        }
      } else {
        // For teams/divisions: get all descendant node IDs for hierarchical filtering
        // e.g., selecting "Equity" division will include all teams/portfolios under it
        relevantNodeIds = getDescendantNodeIds(teamFilter)
      }

      records = records.filter(coverage => {
        const analystMemberships = userTeamMemberships.get(coverage.user_id) || []
        return analystMemberships.some(m => relevantNodeIds.has(m.id))
      })
    }

    // Apply investable universe filter when a portfolio is selected
    if (isPortfolioSelected && selectedPortfolioId) {
      if (hasUniverseConfiguration) {
        // Portfolio has universe filters/manual assets defined - apply filter
        if (investableUniverseAssetIds && investableUniverseAssetIds.size > 0) {
          records = records.filter(coverage => investableUniverseAssetIds.has(coverage.asset_id))
        } else {
          // Universe is configured but no assets match - show nothing
          records = []
        }
      }
      // If no universe configuration, show all assets (don't filter)
    }

    return records
  })()

  // Apply team filter to coverage history events
  const filteredCoverageEvents = (() => {
    if (!allCoverageEvents) return []
    if (!teamFilter || !userTeamMemberships) return allCoverageEvents

    const relevantNodeIds = getDescendantNodeIds(teamFilter)
    return allCoverageEvents.filter(event => {
      // Check if either old or new analyst is a member of the filtered team hierarchy
      // Note: fields are old_user_id and new_user_id in coverage_history table
      const oldAnalystMemberships = event.old_user_id ? userTeamMemberships.get(event.old_user_id) || [] : []
      const newAnalystMemberships = event.new_user_id ? userTeamMemberships.get(event.new_user_id) || [] : []

      const oldAnalystMatch = oldAnalystMemberships.some(m => relevantNodeIds.has(m.id))
      const newAnalystMatch = newAnalystMemberships.some(m => relevantNodeIds.has(m.id))

      return oldAnalystMatch || newAnalystMatch
    })
  })()

  // Apply team filter to coverage requests
  const filteredCoverageRequests = (() => {
    if (!coverageRequests) return []
    if (!teamFilter || !userTeamMemberships) return coverageRequests

    const relevantNodeIds = getDescendantNodeIds(teamFilter)
    return coverageRequests.filter(request => {
      // Filter by the user who made the request
      const requesterMemberships = request.requested_by ? userTeamMemberships.get(request.requested_by) || [] : []
      return requesterMemberships.some(m => relevantNodeIds.has(m.id))
    })
  })()

  // Get all covered asset IDs (within universe if portfolio selected with universe config)
  const coveredAssetIds = new Set(
    (coverageRecords || [])
      .filter(coverage => coverage.is_active)
      .filter(coverage => {
        // If a portfolio with universe config is selected, only count coverage within the universe
        if (hasUniverseConfiguration && investableUniverseAssetIds && investableUniverseAssetIds.size > 0) {
          return investableUniverseAssetIds.has(coverage.asset_id)
        }
        return true
      })
      .map(coverage => coverage.asset_id)
  )

  // Get all uncovered assets (respecting investable universe when portfolio selected with config)
  const allUncoveredAssets = (() => {
    // When a portfolio with an investable universe config is selected, show uncovered universe assets
    if (hasUniverseConfiguration && investableUniverseAssetIds && investableUniverseAssetIds.size > 0) {
      return (assets || []).filter(asset =>
        investableUniverseAssetIds.has(asset.id) && !coveredAssetIds.has(asset.id)
      )
    }
    // Otherwise show all uncovered assets
    return (assets || []).filter(asset => !coveredAssetIds.has(asset.id))
  })()

  // Get uncovered assets matching search (for list view display)
  const uncoveredAssets = (() => {
    // In list view with search, show uncovered assets matching the search
    if (activeView === 'active' && searchQuery) {
      return allUncoveredAssets.filter(asset => {
        const matchesSearch =
          asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          asset.company_name.toLowerCase().includes(searchQuery.toLowerCase())
        return matchesSearch
      })
    }
    // When a portfolio is selected, show all uncovered assets (with or without universe config)
    if (isPortfolioSelected) {
      return allUncoveredAssets
    }
    // For workload view, we use allUncoveredAssets.length in the stats card
    return []
  })()

  if (!isVisible) return null

  // Content that's shared between modal and page modes
  const content = (
    <>
          {/* Header */}
          <div className="border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center justify-between p-6">
              <div className="flex items-center gap-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {viewHistoryAssetId && assetCoverageHistory && assetCoverageHistory.length > 0
                        ? 'Coverage Timeline'
                        : 'Coverage Management'}
                    </h3>
                    {/* Admin Badge */}
                    <div className="relative" ref={adminBadgeRef}>
                      <button
                        onClick={() => isAdminBadgeReady && setShowAdminBadgeDropdown(!showAdminBadgeDropdown)}
                        disabled={!isAdminBadgeReady}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                          !isAdminBadgeReady
                            ? 'blur-sm opacity-50 bg-gray-100 text-gray-600'
                            : isOrgAdmin || isCoverageAdmin
                            ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        <Shield className="w-3 h-3 mr-1" />
                        {!isAdminBadgeReady
                          ? 'Permissions'
                          : isOrgAdmin && hasGlobalCoverageAdmin
                          ? 'Full Admin'
                          : isOrgAdmin
                          ? 'Org Admin'
                          : hasGlobalCoverageAdmin
                          ? 'Coverage Admin'
                          : hasNodeLevelCoverageAdmin
                          ? 'Coverage Admin (Limited)'
                          : 'Read Access'}
                      </button>

                      {/* Dropdown */}
                      {showAdminBadgeDropdown && (
                        <div className="absolute left-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                          <div className="p-3 border-b border-gray-100">
                            <h3 className="text-sm font-medium text-gray-900">Your Permissions</h3>
                          </div>
                          <div className="p-3 space-y-3">
                            {/* Org Admin Status */}
                            <div className="flex items-start space-x-3">
                              <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${
                                isOrgAdmin ? 'bg-green-100' : 'bg-gray-100'
                              }`}>
                                {isOrgAdmin ? (
                                  <Check className="w-3 h-3 text-green-600" />
                                ) : (
                                  <X className="w-3 h-3 text-gray-400" />
                                )}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">Organization Admin</p>
                                <p className="text-xs text-gray-500">
                                  {isOrgAdmin
                                    ? 'Can manage teams, members, and settings'
                                    : 'Cannot modify organization structure'}
                                </p>
                              </div>
                            </div>

                            {/* Coverage Admin Status */}
                            <div className="flex items-start space-x-3">
                              <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${
                                isCoverageAdmin ? 'bg-green-100' : 'bg-gray-100'
                              }`}>
                                {isCoverageAdmin ? (
                                  <Check className="w-3 h-3 text-green-600" />
                                ) : (
                                  <X className="w-3 h-3 text-gray-400" />
                                )}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  Coverage Admin
                                  {hasGlobalCoverageAdmin && hasNodeLevelCoverageAdmin ? '' :
                                   hasNodeLevelCoverageAdmin ? ' (Limited)' : ''}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {hasGlobalCoverageAdmin
                                    ? 'Can manage coverage assignments globally'
                                    : hasNodeLevelCoverageAdmin
                                    ? `Admin for ${userCoverageAdminNodes.length} node${userCoverageAdminNodes.length > 1 ? 's' : ''}`
                                    : 'Can only manage own coverage assignments'}
                                </p>
                              </div>
                            </div>

                            {/* Node-level coverage admin details */}
                            {hasNodeLevelCoverageAdmin && !hasGlobalCoverageAdmin && allOrgChartNodes && (
                              <div className="pt-2 border-t border-gray-100">
                                <p className="text-xs font-medium text-gray-500 mb-2">Coverage admin for:</p>
                                <div className="space-y-1 max-h-24 overflow-y-auto">
                                  {userCoverageAdminNodes.slice(0, 5).map(nodeId => {
                                    const node = allOrgChartNodes.allNodes?.find((n: any) => n.id === nodeId)
                                    return node ? (
                                      <div key={nodeId} className="flex items-center space-x-2 text-xs">
                                        <div
                                          className="w-2 h-2 rounded-full"
                                          style={{ backgroundColor: node.color }}
                                        />
                                        <span className="text-gray-700">{node.name}</span>
                                      </div>
                                    ) : null
                                  })}
                                  {userCoverageAdminNodes.length > 5 && (
                                    <p className="text-xs text-gray-400">
                                      +{userCoverageAdminNodes.length - 5} more
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Read Access (shown when no admin permissions) */}
                            {!isOrgAdmin && !isCoverageAdmin && (
                              <div className="flex items-start space-x-3 pt-2 border-t border-gray-100">
                                <div className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center bg-blue-100">
                                  <Check className="w-3 h-3 text-blue-600" />
                                </div>
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-gray-900">Read Access</p>
                                  <p className="text-xs text-gray-500">
                                    Can view coverage information and request changes
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    Manage analyst coverage assignments
                  </p>
                </div>

                {/* View Mode Buttons - only show for active view */}
                {!viewHistoryAssetId && activeView === 'active' && (
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setViewMode('list')}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'list' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="List View"
                    >
                      <List className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('workload')}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'workload' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="Workload View"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('matrix')}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'matrix' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="Matrix View"
                    >
                      <Grid3X3 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('calendar')}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'calendar' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="Calendar View"
                    >
                      <Calendar className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('team')}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'team' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="Team View"
                    >
                      <Building2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {!viewHistoryAssetId && hasAnyCoverageAdminRights && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        setAddingCoverage({
                          assetId: '',
                          analystId: '',
                          startDate: getLocalDateString(),
                          endDate: '',
                          role: '',
                          portfolioIds: [],
                          notes: '',
                          teamId: userTeams?.[0]?.id || null,
                          visibility: coverageSettings?.default_visibility || 'team',
                          isLead: false
                        })
                        setAssetSearchQuery('')
                        setAnalystSearchQuery('')
                        setShowAssetDropdown(false)
                        setShowAnalystDropdown(false)
                      }}
                      variant="outline"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Coverage
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setShowBulkUpload(!showBulkUpload)}
                      variant={showBulkUpload ? "primary" : "outline"}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Bulk Upload
                    </Button>
                  </>
                )}
                {!viewHistoryAssetId && !hasAnyCoverageAdminRights && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setRequestingChange({
                        assetId: '',
                        assetSymbol: '',
                        currentUserId: null,
                        currentAnalystName: null,
                        currentRole: null,
                        requestedUserId: '',
                        requestedRole: 'primary',
                        requestType: 'add',
                        reason: ''
                      })
                    }}
                    variant="outline"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Request Coverage
                  </Button>
                )}
                {mode === 'modal' && onClose && (
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-hidden flex-1 relative flex">
            {/* Show Timeline View - takes over full space */}
            {viewHistoryAssetId && assetCoverageHistory && assetCoverageHistory.length > 0 ? (
              <div className="absolute inset-0 bg-white flex flex-col z-10">
                  {/* Timeline Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900">{assetCoverageHistory[0]?.assets?.symbol}</h4>
                          {!hasAnyCoverageAdminRights && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                              <Eye className="w-3 h-3 mr-1" />
                              View Only
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{assetCoverageHistory[0]?.assets?.company_name}</p>
                      </div>
                      {/* Timeline Action Buttons */}
                      {hasAnyCoverageAdminRights && (() => {
                        const currentCoverage = assetCoverageHistory.find(c => !c.ended_at || c.ended_at >= getLocalDateString())
                        return currentCoverage ? (
                          <div className="flex items-center gap-1 ml-2 pl-4 border-l border-gray-300">
                            <button
                              onClick={() => {
                                setAddingTransition({
                                  fromCoverageId: currentCoverage.id,
                                  transitionDate: (() => {
                                    const tomorrow = new Date()
                                    tomorrow.setDate(tomorrow.getDate() + 1)
                                    return getLocalDateString(tomorrow)
                                  })(),
                                  newAnalystId: ''
                                })
                              }}
                              className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
                              title="Add Transition"
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                setChangingCurrentCoverage({
                                  coverageId: currentCoverage.id,
                                  newAnalystId: currentCoverage.user_id || '',
                                  effectiveDate: getLocalDateString()
                                })
                              }}
                              className="p-1.5 text-gray-500 hover:text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                              title="Change Current Coverage"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                const lastHistoricalCoverage = [...assetCoverageHistory]
                                  .filter(c => c.ended_at && c.ended_at < getLocalDateString())
                                  .sort((a, b) => (b.ended_at || '').localeCompare(a.ended_at || ''))[0]

                                const suggestedStartDate = lastHistoricalCoverage?.ended_at
                                  ? (() => {
                                    const [year, month, day] = lastHistoricalCoverage.ended_at.split('-').map(Number)
                                    const d = new Date(year, month - 1, day)
                                    d.setDate(d.getDate() + 1)
                                    return getLocalDateString(d)
                                  })()
                                  : ''

                                const suggestedEndDate = currentCoverage?.started_at
                                  ? (() => {
                                    const [year, month, day] = currentCoverage.started_at.split('-').map(Number)
                                    const d = new Date(year, month - 1, day)
                                    d.setDate(d.getDate() - 1)
                                    return getLocalDateString(d)
                                  })()
                                  : ''

                                setAddingHistoricalPeriod({
                                  assetId: viewHistoryAssetId!,
                                  analystId: '',
                                  startDate: suggestedStartDate,
                                  endDate: suggestedEndDate
                                })
                              }}
                              className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                              title="Add Historical Period"
                            >
                              <Clock className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                setEndingCoverage({
                                  coverageId: currentCoverage.id,
                                  endDate: getLocalDateString()
                                })
                              }}
                              className="p-1.5 text-gray-500 hover:text-error-600 hover:bg-error-50 rounded transition-colors"
                              title="End Coverage"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : null
                      })()}
                    </div>
                    <button
                      onClick={() => {
                        setPendingTimelineChanges({})
                        setPendingTimelineDeletes(new Set())
                        setPendingNewCoverages([])
                        setViewHistoryAssetId(null)
                        setAddingTransition(null)
                        setChangingCurrentCoverage(null)
                        setAddingHistoricalPeriod(null)
                        setShowAllChanges(false)
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                      title="Hide Timeline"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                  {/* Timeline Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Timeline Entries */}
                    <div className="space-y-0">
                      {/* Add Transition Form - Show as purple tile above current coverage */}
                      {addingTransition && (() => {
                        const today = getLocalDateString()
                        const isFuture = addingTransition.transitionDate > today
                        const selectedUser = users?.find(u => u.id === addingTransition.newAnalystId)
                        const newAnalystName = selectedUser
                          ? (selectedUser.first_name && selectedUser.last_name
                            ? `${selectedUser.first_name} ${selectedUser.last_name}`
                            : selectedUser.email?.split('@')[0] || 'Unknown')
                          : ''
                        const currentCoverage = assetCoverageHistory.find(c => c.id === addingTransition.fromCoverageId)

                        return (
                          <div className="relative border-l-4 pl-6 pb-4 border-purple-500">
                            <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-purple-500" />
                            <div className="p-4 rounded-md border border-purple-200 bg-purple-50">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <h5 className="text-sm font-semibold text-gray-900">
                                    {isFuture ? 'Schedule Future Transition' : 'Add Coverage Transition'}
                                  </h5>
                                  <Badge variant="purple" size="sm">Future</Badge>
                                </div>
                                <button
                                  onClick={() => setAddingTransition(null)}
                                  className="text-gray-400 hover:text-gray-600"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>

                              <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    New Analyst
                                  </label>
                                  <select
                                    value={addingTransition.newAnalystId}
                                    onChange={(e) => setAddingTransition({ ...addingTransition, newAnalystId: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  >
                                    <option value="">Select analyst...</option>
                                    {users?.filter(u => u.id !== currentCoverage?.user_id).map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.first_name && u.last_name
                                          ? `${u.first_name} ${u.last_name}`
                                          : u.email?.split('@')[0] || 'Unknown'}
                                      </option>
                                    ))}
                                  </select>
                                  <p className="text-xs text-gray-500 mt-1">
                                    Who will take over coverage
                                  </p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Start Date
                                  </label>
                                  <input
                                    type="date"
                                    value={addingTransition.transitionDate}
                                    onChange={(e) => setAddingTransition({ ...addingTransition, transitionDate: e.target.value })}
                                    min={(() => {
                                      const tomorrow = new Date()
                                      tomorrow.setDate(tomorrow.getDate() + 1)
                                      return getLocalDateString(tomorrow)
                                    })()}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    When {newAnalystName || 'new analyst'} starts covering
                                  </p>
                                </div>
                              </div>

                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setAddingTransition(null)}>
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    const { transitionDate, newAnalystId } = addingTransition

                                    if (!newAnalystId || !transitionDate) return

                                    // Validate transition date is in the future
                                    if (transitionDate <= today) {
                                      setErrorModal({
                                        isOpen: true,
                                        title: 'Invalid Transition Date',
                                        message: 'Coverage transitions must be scheduled for a future date (tomorrow or later). To change coverage effective today, please use the "Change Current Coverage" option instead.'
                                      })
                                      return
                                    }

                                    // Update the current coverage to end the day before transition
                                    const dayBefore = (() => {
                                      const [year, month, day] = transitionDate.split('-').map(Number)
                                      const d = new Date(year, month - 1, day)
                                      d.setDate(d.getDate() - 1)
                                      return getLocalDateString(d)
                                    })()

                                    setPendingTimelineChanges(prev => ({
                                      ...prev,
                                      [addingTransition.fromCoverageId]: {
                                        ...prev[addingTransition.fromCoverageId],
                                        endDate: dayBefore
                                      }
                                    }))

                                    // Create the new coverage record as pending
                                    const newCoverageId = `temp-${Date.now()}`
                                    const newCoverage = {
                                      id: newCoverageId,
                                      asset_id: currentCoverage!.asset_id,
                                      user_id: newAnalystId,
                                      analyst_name: newAnalystName,
                                      start_date: transitionDate,
                                      end_date: null,
                                      is_active: true,
                                      changed_by: user?.id,
                                      fromCoverageId: addingTransition.fromCoverageId
                                    }

                                    setPendingNewCoverages(prev => [...prev, newCoverage])
                                    setAddingTransition(null)
                                  }}
                                  disabled={!addingTransition.newAnalystId || !addingTransition.transitionDate}
                                >
                                  Add Transition
                                </Button>
                              </div>
                            </div>
                          </div>
                        )
                      })()}

                      {/* Render timeline entries */}
                      {(() => {
                        const sortedTimeline = [...assetCoverageHistory, ...pendingNewCoverages]
                          .sort((a, b) => b.start_date.localeCompare(a.start_date))

                        // Detect overlapping coverage periods
                        const getOverlaps = (recordId: string, startDate: string, endDate: string | null) => {
                          const overlappingRecords: string[] = []
                          for (const other of sortedTimeline) {
                            if (other.id === recordId) continue
                            if (pendingTimelineDeletes.has(other.id)) continue

                            // Apply pending changes to get actual dates
                            const otherPending = pendingTimelineChanges[other.id]
                            const otherStart = otherPending?.startDate ?? other.start_date
                            const otherEnd = otherPending?.endDate !== undefined ? otherPending.endDate : other.end_date

                            // Check for overlap: periods overlap if one starts before the other ends
                            const thisEnd = endDate || '9999-12-31' // Use far future for ongoing coverage
                            const thatEnd = otherEnd || '9999-12-31'

                            if (startDate <= thatEnd && thisEnd >= otherStart) {
                              overlappingRecords.push(other.id)
                            }
                          }
                          return overlappingRecords
                        }

                        const displayTimeline = showAllTimelinePeriods ? sortedTimeline : sortedTimeline.slice(0, 3)
                        const hasMore = sortedTimeline.length > 3

                        return (
                          <>
                            {displayTimeline.map((dbRecord, index, sortedArray) => {
                          const pendingChange = pendingTimelineChanges[dbRecord.id]
                          const record = {
                            ...dbRecord,
                            ...(pendingChange?.analyst && {
                              user_id: pendingChange.analyst.userId,
                              analyst_name: pendingChange.analyst.analystName
                            }),
                            ...(pendingChange?.startDate !== undefined && { start_date: pendingChange.startDate }),
                            ...(pendingChange?.endDate !== undefined && { end_date: pendingChange.endDate })
                          }

                          const isDeleted = pendingTimelineDeletes.has(dbRecord.id)
                          const today = getLocalDateString()
                          const isCurrent = record.start_date <= today && (!record.end_date || record.end_date > today)
                          const isFuture = record.start_date > today

                          // Apply pending changes to adjacent records for accurate validation
                          const prevRecord = index > 0 ? (() => {
                            const dbPrev = sortedArray[index - 1]
                            const pendingPrev = pendingTimelineChanges[dbPrev.id]
                            return {
                              ...dbPrev,
                              ...(pendingPrev?.analyst && {
                                user_id: pendingPrev.analyst.userId,
                                analyst_name: pendingPrev.analyst.analystName
                              }),
                              ...(pendingPrev?.startDate !== undefined && { start_date: pendingPrev.startDate }),
                              ...(pendingPrev?.endDate !== undefined && { end_date: pendingPrev.endDate })
                            }
                          })() : null

                          const nextRecord = index < sortedArray.length - 1 ? (() => {
                            const dbNext = sortedArray[index + 1]
                            const pendingNext = pendingTimelineChanges[dbNext.id]
                            return {
                              ...dbNext,
                              ...(pendingNext?.analyst && {
                                user_id: pendingNext.analyst.userId,
                                analyst_name: pendingNext.analyst.analystName
                              }),
                              ...(pendingNext?.startDate !== undefined && { start_date: pendingNext.startDate }),
                              ...(pendingNext?.endDate !== undefined && { end_date: pendingNext.endDate })
                            }
                          })() : null

                          if (isDeleted) return null

                          // Check if this coverage is being ended (has a pending end date change)
                          const isEnding = isCurrent && pendingChange?.endDate !== undefined

                          // Check for overlaps with other coverage periods
                          const overlappingIds = getOverlaps(record.id, record.start_date, record.end_date)
                          const hasOverlap = overlappingIds.length > 0
                          const overlappingAnalysts = overlappingIds
                            .map(id => {
                              const rec = sortedTimeline.find(r => r.id === id)
                              return rec?.analyst_name
                            })
                            .filter(Boolean)

                          const borderColor = isEnding ? 'border-red-500' : isCurrent ? 'border-green-500' : isFuture ? 'border-purple-500' : 'border-gray-300'
                          const dotColor = isEnding ? 'bg-red-500' : isCurrent ? 'bg-green-500' : isFuture ? 'bg-purple-500' : 'bg-gray-300'
                          const bgColor = isEnding ? 'bg-red-50 border-red-200' : isCurrent ? 'bg-green-50 border-green-200' : 'bg-white'

                          return (
                            <div key={record.id} className={`relative pl-4 pb-2`}>
                              <div className={`absolute left-0 top-[10px] bottom-2 w-1 ${dotColor}`} />
                              <div className={`absolute left-[-4px] top-[2px] w-[9px] h-[9px] rounded-full ${dotColor}`} />

                              <div className={`p-4 rounded-lg border shadow-sm hover:shadow-md transition-shadow ${bgColor} ${hasOverlap ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}>
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    {/* Analyst Name */}
                                    <div className="flex items-center gap-2 mb-1.5">
                                    {editingAnalyst === record.id && hasAnyCoverageAdminRights ? (
                                      <div className="relative" ref={dropdownRef}>
                                        <button
                                          onClick={() => setEditingAnalyst(null)}
                                          className="text-sm font-semibold text-gray-900 hover:text-blue-600 flex items-center gap-1"
                                        >
                                          {record.analyst_name}
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[200px]">
                                          {users?.map((u) => {
                                            const displayName = u.first_name && u.last_name
                                              ? `${u.first_name} ${u.last_name}`
                                              : u.email?.split('@')[0] || 'Unknown'

                                            return (
                                              <button
                                                key={u.id}
                                                onClick={() => {
                                                  setPendingTimelineChanges(prev => ({
                                                    ...prev,
                                                    [dbRecord.id]: {
                                                      ...prev[dbRecord.id],
                                                      analyst: { userId: u.id, analystName: displayName }
                                                    }
                                                  }))
                                                  setEditingAnalyst(null)
                                                }}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-blue-50 transition-colors"
                                              >
                                                {displayName}
                                              </button>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    ) : hasAnyCoverageAdminRights ? (
                                      <button
                                        onClick={() => setEditingAnalyst(record.id)}
                                        className="text-sm font-semibold text-gray-900 hover:text-blue-600 flex items-center gap-1"
                                      >
                                        {record.analyst_name}
                                        <ChevronDown className="h-3 w-3" />
                                      </button>
                                    ) : (
                                      <span className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                                        {record.analyst_name}
                                      </span>
                                    )}
                                    {isEnding ? (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white shadow-sm">
                                        ● ENDING
                                      </span>
                                    ) : isCurrent && (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-500 text-white shadow-sm">
                                        ● CURRENT
                                      </span>
                                    )}
                                    {isFuture && <Badge variant="purple" size="sm">Future</Badge>}
                                    {hasOverlap && (
                                      <span
                                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300"
                                        title={`Overlaps with: ${overlappingAnalysts.join(', ')}`}
                                      >
                                        <span className="mr-1">⚠</span> Overlap
                                      </span>
                                    )}
                                  </div>


                                  {/* Date Range */}
                                  <div className="text-sm text-gray-600 flex items-center gap-2">
                                    {/* Start Date */}
                                    {editingDateValue?.coverageId === record.id && editingDateValue?.field === 'start' && hasAnyCoverageAdminRights ? (
                                      <input
                                        type="date"
                                        value={editingDateValue.value}
                                        autoFocus
                                        onChange={(e) => {
                                          setEditingDateValue({
                                            coverageId: record.id,
                                            field: 'start',
                                            value: e.target.value
                                          })
                                        }}
                                        onBlur={(e) => {
                                          const newDate = e.target.value
                                          if (!newDate || newDate === record.start_date) {
                                            setEditingDateValue(null)
                                            return
                                          }

                                          const today = getLocalDateString()

                                          if (newDate > today) {
                                            setErrorModal({
                                              isOpen: true,
                                              title: 'Invalid Start Date',
                                              message: 'Start date cannot be in the future.'
                                            })
                                            setEditingDateValue(null)
                                            return
                                          }

                                          if (record.end_date && newDate > record.end_date) {
                                            setErrorModal({
                                              isOpen: true,
                                              title: 'Invalid Start Date',
                                              message: 'Start date cannot be after end date.'
                                            })
                                            setEditingDateValue(null)
                                            return
                                          }

                                          // Validate start date doesn't overlap with previous period
                                          if (nextRecord && nextRecord.end_date && newDate <= nextRecord.end_date) {
                                            const prevEndFormatted = (() => {
                                              const [year, month, day] = nextRecord.end_date.split('T')[0].split('-')
                                              const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                            })()
                                            setErrorModal({
                                              isOpen: true,
                                              title: 'Invalid Start Date',
                                              message: `Start date must be after the previous period ends (${prevEndFormatted}).`
                                            })
                                            setEditingDateValue(null)
                                            return
                                          }

                                          setPendingTimelineChanges(prev => ({
                                            ...prev,
                                            [dbRecord.id]: {
                                              ...prev[dbRecord.id],
                                              startDate: newDate
                                            }
                                          }))
                                          setEditingDateValue(null)
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.currentTarget.blur()
                                          } else if (e.key === 'Escape') {
                                            setEditingDateValue(null)
                                            e.currentTarget.blur()
                                          }
                                        }}
                                        className="inline-block w-[110px] h-[20px] px-1 py-0 text-sm leading-5 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white align-baseline"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    ) : hasAnyCoverageAdminRights ? (
                                      <button
                                        onClick={() => setEditingDateValue({ coverageId: record.id, field: 'start', value: record.start_date.split('T')[0] })}
                                        className="text-gray-900 hover:text-blue-600 hover:underline cursor-pointer"
                                      >
                                        {(() => {
                                          const [year, month, day] = record.start_date.split('T')[0].split('-')
                                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        })()}
                                      </button>
                                    ) : (
                                      <span className="text-gray-900">
                                        {(() => {
                                          const [year, month, day] = record.start_date.split('T')[0].split('-')
                                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        })()}
                                      </span>
                                    )}

                                    <span>→</span>

                                    {/* End Date */}
                                    {editingDateValue?.coverageId === record.id && editingDateValue?.field === 'end' && hasAnyCoverageAdminRights ? (
                                      <input
                                        type="date"
                                        value={editingDateValue.value !== null
                                          ? editingDateValue.value
                                          : undefined
                                        }
                                        autoFocus
                                        onChange={(e) => {
                                          setEditingDateValue({
                                            coverageId: record.id,
                                            field: 'end',
                                            value: e.target.value
                                          })
                                        }}
                                        onBlur={(e) => {
                                          const newDate = e.target.value

                                          if (!newDate) {
                                            setPendingTimelineChanges(prev => ({
                                              ...prev,
                                              [dbRecord.id]: {
                                                ...prev[dbRecord.id],
                                                endDate: null
                                              }
                                            }))
                                            setEditingDateValue(null)
                                            return
                                          }

                                          if (newDate === record.end_date) {
                                            setEditingDateValue(null)
                                            return
                                          }

                                          if (newDate < record.start_date) {
                                            setErrorModal({
                                              isOpen: true,
                                              title: 'Invalid End Date',
                                              message: 'End date cannot be before start date.'
                                            })
                                            setEditingDateValue(null)
                                            return
                                          }

                                          // Validate end date doesn't overlap with future periods
                                          if (prevRecord) {
                                            const nextStartDate = prevRecord.start_date.includes('T') ? prevRecord.start_date.split('T')[0] : prevRecord.start_date
                                            if (newDate >= nextStartDate) {
                                              const [year, month, day] = nextStartDate.split('-').map(Number)
                                              const nextStartDateObj = new Date(year, month - 1, day)
                                              const nextStartFormatted = nextStartDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                              setErrorModal({
                                                isOpen: true,
                                                title: 'Invalid End Date',
                                                message: `End date must be before the next period starts (${nextStartFormatted}).`
                                              })
                                              setEditingDateValue(null)
                                              return
                                            }
                                          }

                                          setPendingTimelineChanges(prev => ({
                                            ...prev,
                                            [dbRecord.id]: {
                                              ...prev[dbRecord.id],
                                              endDate: newDate
                                            }
                                          }))
                                          setEditingDateValue(null)
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.currentTarget.blur()
                                          } else if (e.key === 'Escape') {
                                            setEditingDateValue(null)
                                            e.currentTarget.blur()
                                          }
                                        }}
                                        className="inline-block w-[110px] h-[20px] px-1 py-0 text-sm leading-5 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white align-baseline"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    ) : hasAnyCoverageAdminRights ? (
                                      <button
                                        onClick={() => setEditingDateValue({ coverageId: record.id, field: 'end', value: record.end_date ? record.end_date.split('T')[0] : null })}
                                        className="text-gray-900 hover:text-blue-600 hover:underline cursor-pointer"
                                      >
                                        {record.end_date ? (() => {
                                          const [year, month, day] = record.end_date.split('T')[0].split('-')
                                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        })() : (
                                          <span className="flex items-center gap-2">
                                            <span className="text-gray-500 italic">Unspecified</span>
                                          </span>
                                        )}
                                      </button>
                                    ) : (
                                      <span className="text-gray-900">
                                        {record.end_date ? (() => {
                                          const [year, month, day] = record.end_date.split('T')[0].split('-')
                                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        })() : (
                                          <span className="text-gray-500 italic">Unspecified</span>
                                        )}
                                      </span>
                                    )}

                                    {/* No End Date checkbox - only for current period when editing end date and not already unspecified */}
                                    {hasAnyCoverageAdminRights && isCurrent && (editingDateValue?.coverageId === record.id && editingDateValue?.field === 'end') && record.end_date && (
                                      <label className="flex items-center gap-1.5 ml-2 cursor-pointer group">
                                        <input
                                          type="checkbox"
                                          checked={false}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setPendingTimelineChanges(prev => ({
                                                ...prev,
                                                [dbRecord.id]: {
                                                  ...prev[dbRecord.id],
                                                  endDate: null
                                                }
                                              }))
                                              setEditingDateValue(null)
                                            }
                                          }}
                                          className="w-3.5 h-3.5 text-green-600 border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:ring-offset-0 cursor-pointer"
                                        />
                                        <span className="text-sm text-gray-600 group-hover:text-gray-900">No End Date</span>
                                      </label>
                                    )}
                                  </div>
                                </div>

                                {/* Delete button */}
                                {hasAnyCoverageAdminRights && (
                                  <button
                                    onClick={() => {
                                      setPendingTimelineDeletes(prev => new Set([...prev, record.id]))
                                    }}
                                    className="text-red-600 hover:bg-red-50 p-1.5 rounded transition-colors"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                                </div>

                                {/* Overlap details */}
                                {hasOverlap && overlappingAnalysts.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-700 flex items-start gap-1.5">
                                    <span className="text-amber-500">⚠</span>
                                    <span>
                                      Overlaps with: {overlappingAnalysts.join(', ')}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}

                            {/* Show More Button */}
                            {hasMore && !showAllTimelinePeriods && (
                              <div className="flex justify-center pt-4 pb-2">
                                <button
                                  onClick={() => setShowAllTimelinePeriods(true)}
                                  className="px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors flex items-center gap-2"
                                >
                                  <ChevronDown className="h-4 w-4" />
                                  Show {sortedTimeline.length - 3} More Coverage Period{sortedTimeline.length - 3 !== 1 ? 's' : ''}
                                </button>
                              </div>
                            )}

                            {/* Show Less Button */}
                            {showAllTimelinePeriods && hasMore && (
                              <div className="flex justify-center pt-4 pb-2">
                                <button
                                  onClick={() => setShowAllTimelinePeriods(false)}
                                  className="px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors flex items-center gap-2"
                                >
                                  <ChevronUp className="h-4 w-4" />
                                  Show Less
                                </button>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>

                    {/* All Changes Section */}
                    <div className="border-t border-gray-200 mt-4">
                      <button
                        onClick={() => setShowAllChanges(!showAllChanges)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <History className="h-5 w-5 text-gray-600" />
                          <span className="font-medium text-gray-900">All Changes</span>
                          <span className="text-sm text-gray-500">
                            ({coverageChangeHistory?.length || 0} {coverageChangeHistory?.length === 1 ? 'change' : 'changes'})
                          </span>
                        </div>
                        <ChevronDown className={`h-5 w-5 text-gray-600 transition-transform ${showAllChanges ? 'rotate-180' : ''}`} />
                      </button>

                      {showAllChanges && coverageChangeHistory && coverageChangeHistory.length > 0 && (
                        <div className="px-6 pb-4">
                          {/* Timeline View */}
                          <div className="max-h-[400px] overflow-y-auto pt-3">
                            {(() => {
                              // Filter changes
                              const filteredChanges = coverageChangeHistory.filter((change) => {
                                if (change.change_type === 'created') {
                                  const startDate = new Date(change.new_start_date)
                                  const today = new Date()
                                  today.setHours(0, 0, 0, 0)
                                  return startDate <= today
                                }
                                return true
                              })

                              // Group changes by date
                              const groupedByDate = filteredChanges.reduce((acc, change) => {
                                const changeDate = new Date(change.changed_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })
                                if (!acc[changeDate]) {
                                  acc[changeDate] = []
                                }
                                acc[changeDate].push(change)
                                return acc
                              }, {} as Record<string, typeof filteredChanges>)

                              const formatDate = (dateStr: string | null) => {
                                if (!dateStr) return 'Unspecified'
                                const [year, month, day] = dateStr.split('T')[0].split('-')
                                const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              }

                              return Object.entries(groupedByDate).map(([date, changes], dateIndex, dateArray) => {
                                const isLastDate = dateIndex === dateArray.length - 1

                                return (
                                  <div key={date} className="mb-4 last:mb-0">
                                    {/* Date Header */}
                                    <div className="flex items-center gap-2 mb-2 pl-6">
                                      <div className="text-sm font-semibold text-gray-700">{date}</div>
                                      <div className="flex-1 h-px bg-gray-200" />
                                    </div>

                                    {/* Changes for this date */}
                                    <div className="space-y-1">
                                      {changes.map((change, changeIndex) => {
                                        const changedByName = change.changed_by_user
                                          ? (change.changed_by_user.first_name && change.changed_by_user.last_name
                                            ? `${change.changed_by_user.first_name} ${change.changed_by_user.last_name}`
                                            : change.changed_by_user.email?.split('@')[0] || 'Unknown')
                                          : 'System'

                                        const changeTime = new Date(change.changed_at).toLocaleTimeString('en-US', {
                                          hour: 'numeric',
                                          minute: '2-digit'
                                        })

                                        const isLastChange = isLastDate && changeIndex === changes.length - 1
                                        const isExpanded = expandedChanges.has(change.id)

                                        return (
                                          <div key={change.id} className="relative pl-6">
                                            {/* Timeline dot and line */}
                                            <div className="absolute left-0 top-1.5 flex flex-col items-center">
                                              <div className={`w-2.5 h-2.5 rounded-full border-2 border-white ${
                                                change.change_type === 'created' ? 'bg-green-500' :
                                                change.change_type === 'coverage_added' ? 'bg-purple-500' :
                                                change.change_type === 'historical_added' ? 'bg-gray-500' :
                                                change.change_type === 'analyst_changed' ? 'bg-blue-500' :
                                                change.change_type === 'dates_changed' ? 'bg-yellow-500' :
                                                'bg-red-500'
                                              } shadow`} />
                                              {!isLastChange && <div className="w-0.5 h-full bg-gray-200 mt-1" />}
                                            </div>

                                            {/* Content */}
                                            <div className="pb-2">
                                              {/* Main content - Clickable */}
                                              <button
                                                onClick={() => {
                                                  const newExpanded = new Set(expandedChanges)
                                                  if (isExpanded) {
                                                    newExpanded.delete(change.id)
                                                  } else {
                                                    newExpanded.add(change.id)
                                                  }
                                                  setExpandedChanges(newExpanded)
                                                }}
                                                className="w-full text-left bg-gray-50 border border-gray-200 rounded-lg p-2.5 hover:bg-gray-100 transition-colors"
                                              >
                                                {change.change_type === 'created' && (
                                                  <p className="text-sm text-gray-900">
                                                    <span className="font-semibold text-green-700">{change.new_analyst_name}</span> started covering this stock <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {change.change_type === 'analyst_changed' && (
                                                  <p className="text-sm text-gray-900">
                                                    Coverage transitioned from <span className="font-semibold text-gray-700">{change.old_analyst_name}</span> to <span className="font-semibold text-blue-700">{change.new_analyst_name}</span> <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {change.change_type === 'dates_changed' && (
                                                  <p className="text-sm text-gray-900">
                                                    <span className="font-semibold text-yellow-700">{change.new_analyst_name}</span>'s coverage period adjusted <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {change.change_type === 'deleted' && (
                                                  <p className="text-sm text-gray-900">
                                                    <span className="font-semibold text-red-700">{change.old_analyst_name}</span>'s coverage ended <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {change.change_type === 'coverage_added' && (
                                                  <p className="text-sm text-gray-900">
                                                    <span className="font-semibold text-purple-700">{change.new_analyst_name}</span> added as additional coverage <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {change.change_type === 'historical_added' && (
                                                  <p className="text-sm text-gray-900">
                                                    Historical period added for <span className="font-semibold text-gray-700">{change.new_analyst_name}</span> <span className="text-xs text-gray-500 font-normal ml-1">at {changeTime}</span>
                                                  </p>
                                                )}

                                                {/* Expand/collapse indicator */}
                                                <div className="flex items-center justify-end mt-1">
                                                  <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                </div>
                                              </button>

                                              {/* Expanded details */}
                                              {isExpanded && (
                                                <div className="mt-1 bg-white border border-gray-200 rounded-lg p-3 text-xs">
                                                  {change.change_type === 'created' && (
                                                    <div className="text-gray-600">
                                                      Period: {formatDate(change.new_start_date)} {change.new_end_date ? `— ${formatDate(change.new_end_date)}` : '— Present'}
                                                    </div>
                                                  )}

                                                  {change.change_type === 'analyst_changed' && (
                                                    <div className="text-gray-600">
                                                      Effective date: {formatDate(change.new_start_date)}
                                                    </div>
                                                  )}

                                                  {change.change_type === 'dates_changed' && (
                                                    <div className="text-gray-600 space-y-0.5">
                                                      {change.old_start_date !== change.new_start_date && (
                                                        <p>Start date: {formatDate(change.old_start_date)} → {formatDate(change.new_start_date)}</p>
                                                      )}
                                                      {change.old_end_date !== change.new_end_date && (
                                                        <p>End date: {formatDate(change.old_end_date)} → {formatDate(change.new_end_date)}</p>
                                                      )}
                                                    </div>
                                                  )}

                                                  {change.change_type === 'deleted' && (
                                                    <div className="text-gray-600">
                                                      Previously: {formatDate(change.old_start_date)} {change.old_end_date ? `— ${formatDate(change.old_end_date)}` : '— Present'}
                                                    </div>
                                                  )}

                                                  {change.change_type === 'coverage_added' && (
                                                    <div className="text-gray-600">
                                                      Period: {formatDate(change.new_start_date)} {change.new_end_date ? `— ${formatDate(change.new_end_date)}` : '— Present'}
                                                      <p className="mt-1 text-purple-600">Added alongside existing coverage</p>
                                                    </div>
                                                  )}

                                                  {change.change_type === 'historical_added' && (
                                                    <div className="text-gray-600">
                                                      Period: {formatDate(change.new_start_date)} — {formatDate(change.new_end_date)}
                                                      <p className="mt-1 text-gray-500">Added as historical record</p>
                                                    </div>
                                                  )}

                                                  {/* Who made the change */}
                                                  <div className="mt-2 pt-2 border-t border-gray-200 text-gray-500">
                                                    Change made by {changedByName}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })
                            })()}
                          </div>
                        </div>
                      )}

                      {showAllChanges && (!coverageChangeHistory || coverageChangeHistory.length === 0) && (
                        <div className="px-6 pb-4">
                          <p className="text-sm text-gray-500 text-center py-4">No changes recorded yet</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Timeline Footer */}
                  {hasAnyCoverageAdminRights ? (
                    <div className="flex justify-between items-center p-6 border-t border-gray-200 flex-shrink-0">
                      <div className="text-sm text-gray-600">
                        {(Object.keys(pendingTimelineChanges).length > 0 || pendingTimelineDeletes.size > 0 || pendingNewCoverages.length > 0) && (
                          <span className="text-warning-600 font-medium">
                            You have unsaved changes
                          </span>
                        )}
                      </div>
                      <div className="flex gap-3">
                        <Button variant="outline" onClick={() => {
                          setPendingTimelineChanges({})
                          setPendingTimelineDeletes(new Set())
                          setPendingNewCoverages([])
                          setViewHistoryAssetId(null)
                          setAddingTransition(null)
                          setChangingCurrentCoverage(null)
                          setAddingHistoricalPeriod(null)
                          setShowAllChanges(false)
                        }}>
                          Cancel
                        </Button>
                        <Button
                          onClick={() => saveTimelineChangesMutation.mutate()}
                          loading={saveTimelineChangesMutation.isPending}
                          disabled={Object.keys(pendingTimelineChanges).length === 0 && pendingTimelineDeletes.size === 0 && pendingNewCoverages.length === 0}
                        >
                          Save Changes
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end items-center p-6 border-t border-gray-200 flex-shrink-0">
                      <Button
                        onClick={() => {
                          const asset = assets?.find(a => a.id === viewHistoryAssetId)
                          const today = getLocalDateString()
                          // Find the current coverage using the same logic as the timeline view
                          const currentCoverage = assetCoverageHistory?.find(c => {
                            return c.start_date <= today && (!c.end_date || c.end_date >= today)
                          })
                          setRequestingChange({
                            assetId: viewHistoryAssetId || '',
                            assetSymbol: asset?.symbol || '',
                            currentUserId: currentCoverage?.user_id || null,
                            currentAnalystName: currentCoverage?.analyst_name || null,
                            currentRole: currentCoverage?.role || null,
                            requestedUserId: '',
                            requestedRole: currentCoverage?.role || 'primary',
                            requestType: currentCoverage ? 'change' : 'add',
                            reason: ''
                          })
                        }}
                      >
                        Request Coverage Change
                      </Button>
                    </div>
                  )}
                </div>
            ) : (
            /* Main Content Area - List View (hidden when timeline is open) */
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className={clsx(
                "p-6 flex-1 flex flex-col",
                viewMode === 'workload' ? "overflow-hidden" : "overflow-y-auto space-y-6"
              )}>
            {/* Bulk Upload Coverage */}
            {showBulkUpload && (
              <Card>
                <h4 className="text-sm font-semibold text-gray-900 mb-4">Bulk Upload Coverage</h4>
              
              <div className="space-y-4">
                {/* Template Download */}
                <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-blue-900">Download CSV Template</p>
                      <p className="text-xs text-blue-700">Get the correct format for bulk upload</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={downloadTemplate}>
                    <Download className="h-4 w-4 mr-2" />
                    Download Template
                  </Button>
                </div>
                
                {/* File Upload */}
                <div className="space-y-3">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={handleFileSelect}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                      />
                    </div>
                    <Button
                      onClick={handleUpload}
                      disabled={!uploadFile || isUploading}
                      loading={isUploading}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload
                    </Button>
                  </div>
                  
                  {uploadFile && (
                    <div className="text-sm text-gray-600">
                      Selected: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                    </div>
                  )}
                </div>
                
                {/* Upload Results */}
                {uploadSuccess && (
                  <div className="p-3 bg-success-50 border border-success-200 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 bg-success-500 rounded-full flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-success-900">{uploadSuccess}</p>
                    </div>
                  </div>
                )}
                
                {uploadErrors.length > 0 && (
                  <div className="p-3 bg-warning-50 border border-warning-200 rounded-lg">
                    <div className="flex items-start space-x-2">
                      <AlertCircle className="h-4 w-4 text-warning-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-warning-900 mb-2">Upload Warnings:</p>
                        <ul className="text-xs text-warning-800 space-y-1">
                          {uploadErrors.map((error, index) => (
                            <li key={index}>• {error}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Format Instructions */}
                <div className="text-xs text-gray-500 space-y-1">
                  <p className="font-medium">CSV Format:</p>
                  <p>• Column 1: Asset Symbol (e.g., AAPL, MSFT)</p>
                  <p>• Column 2: Analyst Name (e.g., John Smith)</p>
                  <p>• Column 3: Email (optional - if not provided, assigns to current user)</p>
                </div>
              </div>
            </Card>
            )}

            {/* Search and Filter Buttons */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by asset symbol, company name, or analyst..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                {/* Team/Group Filter Dropdown */}
                <div className="relative">
                  <select
                    value={teamFilter || ''}
                    onChange={(e) => setTeamFilter(e.target.value || null)}
                    className={clsx(
                      "pl-3 pr-8 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm appearance-none cursor-pointer min-w-[220px]",
                      teamFilter ? "border-primary-500 bg-primary-50 text-primary-700" : "border-gray-300 bg-white text-gray-700"
                    )}
                  >
                    <option value="">All Teams & Portfolios</option>
                    {/* Group by type */}
                    {allOrgChartNodes?.nodes && allOrgChartNodes.nodes.filter(n => n.node_type === 'division').length > 0 && (
                      <optgroup label="Divisions">
                        {allOrgChartNodes.nodes.filter(n => n.node_type === 'division').map(node => (
                          <option key={node.id} value={node.id}>{node.displayName}</option>
                        ))}
                      </optgroup>
                    )}
                    {allOrgChartNodes?.nodes && allOrgChartNodes.nodes.filter(n => n.node_type === 'team').length > 0 && (
                      <optgroup label="Teams">
                        {allOrgChartNodes.nodes.filter(n => n.node_type === 'team').map(node => (
                          <option key={node.id} value={node.id}>{node.displayName}</option>
                        ))}
                      </optgroup>
                    )}
                    {allOrgChartNodes?.nodes && allOrgChartNodes.nodes.filter(n => n.node_type === 'portfolio').length > 0 && (
                      <optgroup label="Portfolios">
                        {allOrgChartNodes.nodes.filter(n => n.node_type === 'portfolio').map(node => (
                          <option key={node.id} value={node.id}>{node.displayName}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>

                <div className="inline-flex rounded-lg border border-gray-200 p-1 bg-gray-100">
                <button
                  onClick={() => setActiveView('active')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    activeView === 'active'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                  }`}
                >
                  Active
                </button>
                <button
                  onClick={() => setActiveView('history')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    activeView === 'history'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                  }`}
                >
                  History
                </button>
                <button
                  onClick={() => setActiveView('requests')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all relative ${
                    activeView === 'requests'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                  }`}
                >
                  Requests
                  {coverageRequests && coverageRequests.filter(r => r.status === 'pending').length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                      {coverageRequests.filter(r => r.status === 'pending').length}
                    </span>
                  )}
                </button>
              </div>
              </div>

              {/* Investable Universe Indicator - below search bar, only when universe is configured */}
              {isPortfolioSelected && hasUniverseConfiguration && investableUniverseAssetIds && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-sm w-fit">
                  <span className="text-indigo-600 font-medium">Universe:</span>
                  <span className="text-indigo-900">
                    {investableUniverseAssetIds.size} assets
                  </span>
                  <span className="text-indigo-400">•</span>
                  <span className="text-green-600">
                    {coveredAssetIds.size} covered
                  </span>
                  <span className="text-indigo-400">•</span>
                  <span className="text-amber-600">
                    {allUncoveredAssets.length} gaps
                  </span>
                </div>
              )}
            </div>

            {/* Coverage List - Active View */}
            {activeView === 'active' && (
              <>
              {/* List View */}
              {viewMode === 'list' && (
              <Card padding="none" className="min-h-[400px]">
              {coverageLoading ? (
                <div className="p-6">
                  <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="animate-pulse">
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 bg-gray-200 rounded-lg"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                          </div>
                          <div className="w-24 h-8 bg-gray-200 rounded"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : filteredCoverage.length > 0 || uncoveredAssets.length > 0 ? (
                <>
                  {/* Table Header */}
                  <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <div className="col-span-3">Asset</div>
                      <div className="col-span-3">Analyst</div>
                      <div className="col-span-2">Visibility</div>
                      <div className="col-span-2">Sector</div>
                      <div className="col-span-2 text-right">Actions</div>
                    </div>
                  </div>

                  {/* Scrollable Content */}
                  <div className="overflow-y-auto divide-y divide-gray-200 max-h-[calc(90vh-330px)]">
                    {/* Active Coverage Rows */}
                    {filteredCoverage.map((coverage) => (
                      <div key={coverage.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                        <div className="grid grid-cols-12 gap-4 items-center">
                          {/* Asset Info */}
                          <div className="col-span-3">
                            <div className="flex items-center space-x-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-gray-900 truncate">
                                  {coverage.assets?.symbol || 'Unknown Symbol'}
                                </p>
                                <p className="text-xs text-gray-500 truncate" title={coverage.assets?.company_name || 'Unknown Company'}>
                                  {coverage.assets?.company_name || 'Unknown Company'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Analyst with Role Badge */}
                          <div className="col-span-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm text-gray-700 truncate">
                                {coverage.analyst_name}
                              </span>
                              {coverageSettings?.enable_hierarchy && coverage.role && (
                                <span className={clsx(
                                  'inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded w-fit',
                                  coverage.role === 'primary' && 'bg-yellow-100 text-yellow-800',
                                  coverage.role === 'secondary' && 'bg-blue-100 text-blue-800',
                                  coverage.role === 'tertiary' && 'bg-gray-100 text-gray-700'
                                )}>
                                  {coverage.role === 'primary' && <Star className="h-2.5 w-2.5" />}
                                  {coverage.role === 'secondary' && <Shield className="h-2.5 w-2.5" />}
                                  {coverage.role === 'tertiary' && <UserCheck className="h-2.5 w-2.5" />}
                                  {coverage.role.charAt(0).toUpperCase() + coverage.role.slice(1)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Visibility */}
                          <div className="col-span-2">
                            <div className="relative inline-block">
                              <button
                                onClick={() => canChangeVisibility(coverage) && setEditingVisibility(
                                  editingVisibility?.coverageId === coverage.id
                                    ? null
                                    : { coverageId: coverage.id, currentVisibility: coverage.visibility || 'team' }
                                )}
                                disabled={!canChangeVisibility(coverage)}
                                className={clsx(
                                  'inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full transition-all',
                                  coverage.visibility === 'firm' && 'bg-purple-100 text-purple-800',
                                  coverage.visibility === 'division' && 'bg-blue-100 text-blue-800',
                                  (!coverage.visibility || coverage.visibility === 'team') && 'bg-green-100 text-green-700',
                                  canChangeVisibility(coverage) && 'hover:ring-2 hover:ring-primary-300 cursor-pointer',
                                  !canChangeVisibility(coverage) && 'cursor-default opacity-75'
                                )}
                                title={canChangeVisibility(coverage) ? 'Click to change visibility' : 'You do not have permission to change visibility'}
                              >
                                {coverage.visibility === 'firm' ? (
                                  <Building2 className="h-2.5 w-2.5" />
                                ) : coverage.visibility === 'division' ? (
                                  <FolderOpen className="h-2.5 w-2.5" />
                                ) : (
                                  <Users className="h-2.5 w-2.5" />
                                )}
                                {coverage.visibility === 'firm' ? 'Firm' : coverage.visibility === 'division' ? 'Div' : 'Team'}
                                {canChangeVisibility(coverage) && (
                                  <ChevronDown className={clsx(
                                    'h-2.5 w-2.5 transition-transform',
                                    editingVisibility?.coverageId === coverage.id && 'rotate-180'
                                  )} />
                                )}
                              </button>

                              {/* Custom visibility dropdown */}
                              {editingVisibility?.coverageId === coverage.id && (
                                <>
                                  {/* Backdrop to close dropdown */}
                                  <div
                                    className="fixed inset-0 z-30"
                                    onClick={() => setEditingVisibility(null)}
                                  />
                                  <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px] animate-in fade-in slide-in-from-top-1 duration-150">
                                    {[
                                      { value: 'team', label: 'Team Only', desc: 'Only your team can see', icon: Users, color: 'text-green-600 bg-green-50' },
                                      { value: 'division', label: 'Division', desc: 'Teams in your division', icon: FolderOpen, color: 'text-blue-600 bg-blue-50' },
                                      { value: 'firm', label: 'Firm-wide', desc: 'Everyone in the org', icon: Building2, color: 'text-purple-600 bg-purple-50' },
                                    ].map((option) => (
                                      <button
                                        key={option.value}
                                        onClick={() => {
                                          updateVisibilityMutation.mutate({
                                            coverageId: coverage.id,
                                            visibility: option.value as 'team' | 'division' | 'firm'
                                          })
                                        }}
                                        className={clsx(
                                          'w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors flex items-center gap-3',
                                          coverage.visibility === option.value && 'bg-gray-50'
                                        )}
                                      >
                                        <div className={clsx('p-1.5 rounded-md', option.color)}>
                                          <option.icon className="h-3.5 w-3.5" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium text-gray-900">{option.label}</div>
                                          <div className="text-xs text-gray-500">{option.desc}</div>
                                        </div>
                                        {coverage.visibility === option.value && (
                                          <Check className="h-4 w-4 text-primary-600 flex-shrink-0" />
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Sector */}
                          <div className="col-span-2">
                            <span className="text-xs text-gray-600 truncate block">
                              {coverage.assets?.sector || '—'}
                            </span>
                          </div>

                          {/* Actions */}
                          <div className="col-span-2">
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => setViewHistoryAssetId(coverage.assets?.id || null)}
                                className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                title="View Coverage Timeline"
                              >
                                <History className="h-4 w-4" />
                              </button>
                              {!hasAnyCoverageAdminRights && (
                                <button
                                  onClick={() => setRequestingChange({
                                    assetId: coverage.asset_id,
                                    assetSymbol: coverage.assets?.symbol || 'Unknown',
                                    currentUserId: coverage.user_id,
                                    currentAnalystName: coverage.analyst_name,
                                    currentRole: coverage.role || null,
                                    requestedUserId: '',
                                    requestedRole: coverage.role || 'primary',
                                    requestType: 'change',
                                    reason: ''
                                  })}
                                  className="p-1 text-gray-400 hover:text-warning-600 transition-colors"
                                  title="Request Coverage Change"
                                >
                                  <AlertCircle className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Not Covered Section */}
                    {uncoveredAssets.length > 0 && (
                      <>
                        {/* Section Divider */}
                        <div className="px-6 py-3 bg-amber-50 border-t-2 border-amber-200">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                            <span className="text-xs font-semibold text-amber-900 uppercase tracking-wider">
                              Not Covered ({uncoveredAssets.length})
                            </span>
                          </div>
                        </div>

                        {/* Uncovered Assets */}
                        {uncoveredAssets.map((asset) => (
                          <div key={asset.id} className="px-6 py-4 bg-amber-50/30 hover:bg-amber-50 transition-colors">
                            <div className="grid grid-cols-12 gap-4 items-center">
                              {/* Asset Info */}
                              <div className="col-span-3">
                                <div className="flex items-center space-x-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900 truncate">
                                      {asset.symbol}
                                    </p>
                                    <p className="text-xs text-gray-500 truncate" title={asset.company_name}>
                                      {asset.company_name}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {/* No Analyst */}
                              <div className="col-span-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                  No Coverage
                                </span>
                              </div>

                              {/* Visibility - empty for uncovered */}
                              <div className="col-span-2">
                                <span className="text-xs text-gray-400">—</span>
                              </div>

                              {/* Sector */}
                              <div className="col-span-2">
                                <span className="text-xs text-gray-600 truncate block">
                                  {asset.sector || '—'}
                                </span>
                              </div>

                              {/* Actions */}
                              <div className="col-span-2">
                                <div className="flex items-center gap-2 justify-end">
                                  {hasAnyCoverageAdminRights ? (
                                    <button
                                      onClick={() => {
                                        setAddingCoverage({
                                          assetId: asset.id,
                                          analystId: '',
                                          startDate: getLocalDateString(),
                                          endDate: '',
                                          role: '',
                                          portfolioIds: [],
                                          notes: '',
                                          teamId: userTeams?.[0]?.id || null,
                                          visibility: coverageSettings?.default_visibility || 'team',
                                          isLead: false
                                        })
                                        setAssetSearchQuery(`${asset.symbol} - ${asset.company_name}`)
                                        setAnalystSearchQuery('')
                                        setShowAssetDropdown(false)
                                        setShowAnalystDropdown(false)
                                      }}
                                      className="px-3 py-1 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                                      title="Add Coverage"
                                    >
                                      Add Coverage
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => setRequestingChange({
                                        assetId: asset.id,
                                        assetSymbol: asset.symbol,
                                        currentUserId: null,
                                        currentAnalystName: null,
                                        currentRole: null,
                                        requestedUserId: '',
                                        requestedRole: 'primary',
                                        requestType: 'add',
                                        reason: ''
                                      })}
                                      className="px-3 py-1 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                                      title="Request Coverage"
                                    >
                                      Request Coverage
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-8">
                  {/* Check if there are matching uncovered assets when searching */}
                  {searchQuery && (() => {
                    const matchingUncoveredAssets = assets?.filter(asset => {
                      const isMatch = asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        asset.company_name.toLowerCase().includes(searchQuery.toLowerCase())
                      const hasCoverage = coverageRecords?.some(c => c.asset_id === asset.id)
                      return isMatch && !hasCoverage
                    }) || []

                    if (matchingUncoveredAssets.length > 0) {
                      return (
                        <div>
                          <div className="text-center mb-6">
                            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                              <AlertCircle className="h-6 w-6 text-amber-600" />
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 mb-1">
                              No coverage found for "{searchQuery}"
                            </h3>
                            <p className="text-sm text-gray-500">
                              The following assets match your search but have no coverage assigned
                            </p>
                          </div>
                          <div className="space-y-2 max-w-md mx-auto">
                            {matchingUncoveredAssets.slice(0, 5).map(asset => (
                              <div
                                key={asset.id}
                                className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg"
                              >
                                <div>
                                  <span className="font-medium text-gray-900">{asset.symbol}</span>
                                  <span className="text-gray-500 ml-2 text-sm">{asset.company_name}</span>
                                </div>
                                {hasAnyCoverageAdminRights ? (
                                  <button
                                    onClick={() => {
                                      setAddingCoverage({
                                        assetId: asset.id,
                                        analystId: '',
                                        startDate: getLocalDateString(),
                                        endDate: '',
                                        role: '',
                                        portfolioIds: [],
                                        notes: '',
                                        teamId: userTeams?.[0]?.id || null,
                                        visibility: coverageSettings?.default_visibility || 'team',
                                        isLead: false
                                      })
                                      setAssetSearchQuery(`${asset.symbol} - ${asset.company_name}`)
                                      setAnalystSearchQuery('')
                                      setShowAssetDropdown(false)
                                      setShowAnalystDropdown(false)
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                                  >
                                    Add Coverage
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setRequestingChange({
                                      assetId: asset.id,
                                      assetSymbol: asset.symbol,
                                      currentUserId: null,
                                      currentAnalystName: null,
                                      currentRole: null,
                                      requestedUserId: '',
                                      requestedRole: 'primary',
                                      requestType: 'add',
                                      reason: ''
                                    })}
                                    className="px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                                  >
                                    Request Coverage
                                  </button>
                                )}
                              </div>
                            ))}
                            {matchingUncoveredAssets.length > 5 && (
                              <p className="text-xs text-gray-500 text-center mt-2">
                                And {matchingUncoveredAssets.length - 5} more matching assets...
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    }
                    return null
                  })()}

                  {/* Default empty state */}
                  {(!searchQuery || !(assets?.some(asset => {
                    const isMatch = asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      asset.company_name.toLowerCase().includes(searchQuery.toLowerCase())
                    const hasCoverage = coverageRecords?.some(c => c.asset_id === asset.id)
                    return isMatch && !hasCoverage
                  }))) && (
                    <div className="text-center">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Users className="h-8 w-8 text-gray-400" />
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        {coverageRecords?.length === 0 ? 'No coverage assignments yet' : 'No coverage matches your search'}
                      </h3>
                      <p className="text-gray-500 mb-4">
                        {coverageRecords?.length === 0
                          ? 'Start by assigning analysts to cover specific assets.'
                          : 'Try adjusting your search criteria.'
                        }
                      </p>
                    </div>
                  )}
                </div>
              )}
              </Card>
              )}

              {/* Workload View */}
              {viewMode === 'workload' && (
                <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 mt-4">
                  {/* Analyst Tiles */}
                  <div className="col-span-12 lg:col-span-4 flex flex-col min-h-0">
                    <Card className="flex flex-col h-full overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
                        <h3 className="text-sm font-semibold text-gray-900">Analysts</h3>
                      </div>
                      <div className="p-3 space-y-2 flex-1 overflow-y-auto">
                        {(() => {
                          // Group coverage by analyst with more details
                          const analystWorkload = new Map<string, {
                            id: string
                            name: string
                            count: number
                            primaryCount: number
                            secondaryCount: number
                            tertiaryCount: number
                            assets: { symbol: string; role: string | null; sector: string | null }[]
                            sectors: Set<string>
                          }>()

                          filteredCoverage.forEach(coverage => {
                            const analystId = coverage.user_id || 'unknown'
                            const existing = analystWorkload.get(analystId)
                            const role = coverage.role || null
                            const assetInfo = {
                              symbol: coverage.assets?.symbol || 'Unknown',
                              role,
                              sector: coverage.assets?.sector || null
                            }

                            if (existing) {
                              existing.count++
                              if (role === 'primary') existing.primaryCount++
                              else if (role === 'secondary') existing.secondaryCount++
                              else if (role === 'tertiary') existing.tertiaryCount++
                              existing.assets.push(assetInfo)
                              if (coverage.assets?.sector) existing.sectors.add(coverage.assets.sector)
                            } else {
                              analystWorkload.set(analystId, {
                                id: analystId,
                                name: coverage.analyst_name,
                                count: 1,
                                primaryCount: role === 'primary' ? 1 : 0,
                                secondaryCount: role === 'secondary' ? 1 : 0,
                                tertiaryCount: role === 'tertiary' ? 1 : 0,
                                assets: [assetInfo],
                                sectors: new Set(coverage.assets?.sector ? [coverage.assets.sector] : [])
                              })
                            }
                          })

                          // Calculate average coverage for workload levels
                          const analystEntries = Array.from(analystWorkload.entries())
                          const totalAnalysts = analystEntries.length
                          const avgCoverage = totalAnalysts > 0
                            ? analystEntries.reduce((sum, [, a]) => sum + a.count, 0) / totalAnalysts
                            : 0
                          const maxCoverage = totalAnalysts > 0
                            ? Math.max(...analystEntries.map(([, a]) => a.count))
                            : 0

                          // Workload level thresholds (relative to average)
                          const getWorkloadLevel = (count: number) => {
                            if (avgCoverage === 0) return { level: 'normal', color: 'bg-green-500', label: 'Normal' }
                            const ratio = count / avgCoverage
                            if (ratio <= 0.8) return { level: 'light', color: 'bg-blue-400', label: 'Light' }
                            if (ratio <= 1.2) return { level: 'normal', color: 'bg-green-500', label: 'Normal' }
                            if (ratio <= 1.5) return { level: 'moderate', color: 'bg-yellow-500', label: 'Moderate' }
                            return { level: 'extended', color: 'bg-red-500', label: 'Extended' }
                          }

                          return analystEntries
                            .sort((a, b) => b[1].count - a[1].count)
                            .map(([analystId, analyst]) => {
                              const workload = getWorkloadLevel(analyst.count)
                              // Bar is centered at 50% for average workload
                              // Below average: less than 50%, Above average: more than 50%
                              // Scale: 0 = 0%, average = 50%, 2x average = 100%
                              const barPercentage = avgCoverage > 0
                                ? Math.min(100, (analyst.count / (avgCoverage * 2)) * 100)
                                : 50

                              return (
                                <div
                                  key={analystId}
                                  onClick={() => setSelectedAnalystId(selectedAnalystId === analystId ? null : analystId)}
                                  className={clsx(
                                    'p-4 rounded-lg border cursor-pointer transition-all',
                                    selectedAnalystId === analystId
                                      ? 'bg-primary-50 border-primary-500 ring-2 ring-primary-200'
                                      : 'bg-gray-50 border-gray-200 hover:border-gray-300 hover:bg-gray-100'
                                  )}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                                        <span className="text-sm font-semibold text-primary-700">
                                          {analyst.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                        </span>
                                      </div>
                                      <span className="font-medium text-gray-900">{analyst.name}</span>
                                    </div>
                                    <span className={clsx(
                                      'px-2 py-0.5 text-[10px] font-semibold rounded-full',
                                      workload.level === 'light' && 'bg-blue-100 text-blue-700',
                                      workload.level === 'normal' && 'bg-green-100 text-green-700',
                                      workload.level === 'moderate' && 'bg-yellow-100 text-yellow-700',
                                      workload.level === 'extended' && 'bg-red-100 text-red-700'
                                    )}>
                                      {workload.label}
                                    </span>
                                  </div>

                                  {/* Workload Bar - centered at 50% for average */}
                                  <div className="mb-3">
                                    <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                                      {/* Center line marker for average */}
                                      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-400 z-10" />
                                      <div
                                        className={clsx('h-full rounded-full transition-all', workload.color)}
                                        style={{ width: `${barPercentage}%` }}
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 text-xs">
                                    {analyst.primaryCount > 0 && (
                                      <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full">
                                        <Star className="h-3 w-3" />
                                        {analyst.primaryCount}
                                      </span>
                                    )}
                                    {analyst.secondaryCount > 0 && (
                                      <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                                        <Shield className="h-3 w-3" />
                                        {analyst.secondaryCount}
                                      </span>
                                    )}
                                    {analyst.tertiaryCount > 0 && (
                                      <span className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full">
                                        <UserCheck className="h-3 w-3" />
                                        {analyst.tertiaryCount}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )
                            })
                        })()}
                        {filteredCoverage.length === 0 && (
                          <div className="text-center py-8 text-gray-500">
                            No analysts with coverage
                          </div>
                        )}
                      </div>
                    </Card>
                  </div>

                  {/* Analytics Panel */}
                  <div className="col-span-12 lg:col-span-8 flex flex-col min-h-0 gap-4">
                    {/* Summary Stats - Clickable Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
                      <Card
                        className={clsx(
                          "p-4 cursor-pointer transition-all hover:shadow-md",
                          selectedStatCard === 'analysts' && !selectedAnalystId && "ring-2 ring-primary-500 bg-primary-50"
                        )}
                        onClick={() => {
                          setSelectedAnalystId(null)
                          setSelectedStatCard(selectedStatCard === 'analysts' ? null : 'analysts')
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary-100 rounded-lg">
                            <Users className="h-5 w-5 text-primary-600" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-gray-900">
                              {new Set(filteredCoverage.map(c => c.user_id)).size}
                            </p>
                            <p className="text-xs text-gray-500">Total Analysts</p>
                          </div>
                        </div>
                      </Card>
                      <Card
                        className={clsx(
                          "p-4 cursor-pointer transition-all hover:shadow-md",
                          selectedStatCard === 'covered' && !selectedAnalystId && "ring-2 ring-green-500 bg-green-50"
                        )}
                        onClick={() => {
                          setSelectedAnalystId(null)
                          setSelectedStatCard(selectedStatCard === 'covered' ? null : 'covered')
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-100 rounded-lg">
                            <CheckCircle className="h-5 w-5 text-green-600" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-gray-900">{filteredCoverage.length}</p>
                            <p className="text-xs text-gray-500">Covered Assets</p>
                          </div>
                        </div>
                      </Card>
                      <Card
                        className={clsx(
                          "p-4 cursor-pointer transition-all hover:shadow-md",
                          selectedStatCard === 'gaps' && !selectedAnalystId && "ring-2 ring-amber-500 bg-amber-50"
                        )}
                        onClick={() => {
                          setSelectedAnalystId(null)
                          setSelectedStatCard(selectedStatCard === 'gaps' ? null : 'gaps')
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-amber-100 rounded-lg">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-gray-900">{allUncoveredAssets.length}</p>
                            <p className="text-xs text-gray-500">Coverage Gaps</p>
                          </div>
                        </div>
                      </Card>
                      <Card
                        className={clsx(
                          "p-4 cursor-pointer transition-all hover:shadow-md",
                          selectedStatCard === 'average' && !selectedAnalystId && "ring-2 ring-blue-500 bg-blue-50"
                        )}
                        onClick={() => {
                          setSelectedAnalystId(null)
                          setSelectedStatCard(selectedStatCard === 'average' ? null : 'average')
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 rounded-lg">
                            <BarChart3 className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-gray-900">
                              {filteredCoverage.length > 0
                                ? (filteredCoverage.length / new Set(filteredCoverage.map(c => c.user_id)).size).toFixed(1)
                                : '0'}
                            </p>
                            <p className="text-xs text-gray-500">Avg per Analyst</p>
                          </div>
                        </div>
                      </Card>
                    </div>

                    {/* Detail Panel - Shows based on selection */}
                    {selectedAnalystId ? (
                      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        {(() => {
                          const analystCoverage = filteredCoverage.filter(c => c.user_id === selectedAnalystId)
                          const analystName = analystCoverage[0]?.analyst_name || 'Selected Analyst'

                          // Calculate breakdown stats
                          const sectorBreakdown = new Map<string, number>()
                          const portfolioBreakdown = new Map<string, { name: string; count: number }>()
                          const teamBreakdown = new Map<string, { name: string; count: number }>()
                          let primaryCount = 0, secondaryCount = 0, tertiaryCount = 0

                          analystCoverage.forEach(c => {
                            // Sector
                            const sector = c.assets?.sector || 'Uncategorized'
                            sectorBreakdown.set(sector, (sectorBreakdown.get(sector) || 0) + 1)

                            // Portfolio
                            if (c.portfolio_id && c.portfolios) {
                              const existing = portfolioBreakdown.get(c.portfolio_id)
                              if (existing) existing.count++
                              else portfolioBreakdown.set(c.portfolio_id, { name: c.portfolios.name, count: 1 })
                            }

                            // Team
                            if (c.team_id && c.teams) {
                              const existing = teamBreakdown.get(c.team_id)
                              if (existing) existing.count++
                              else teamBreakdown.set(c.team_id, { name: c.teams.name, count: 1 })
                            }

                            // Roles
                            if (c.role === 'primary') primaryCount++
                            else if (c.role === 'secondary') secondaryCount++
                            else if (c.role === 'tertiary') tertiaryCount++
                          })

                          const sortedSectors = Array.from(sectorBreakdown.entries()).sort((a, b) => b[1] - a[1])
                          const maxSectorCount = sortedSectors.length > 0 ? sortedSectors[0][1] : 1
                          const sortedPortfolios = Array.from(portfolioBreakdown.entries()).sort((a, b) => b[1].count - a[1].count)
                          const sortedTeams = Array.from(teamBreakdown.entries()).sort((a, b) => b[1].count - a[1].count)

                          return (
                            <>
                              {/* Header with analyst info and key metrics */}
                              <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0 bg-gradient-to-r from-primary-50 to-white">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                                      <span className="text-sm font-bold text-primary-700">
                                        {analystName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                      </span>
                                    </div>
                                    <div>
                                      <h3 className="text-sm font-semibold text-gray-900">{analystName}</h3>
                                      <p className="text-xs text-gray-500">{analystCoverage.length} assets covered</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {primaryCount > 0 && (
                                      <span className="flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
                                        <Star className="h-3 w-3" /> {primaryCount} Primary
                                      </span>
                                    )}
                                    {secondaryCount > 0 && (
                                      <span className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                                        <Shield className="h-3 w-3" /> {secondaryCount} Secondary
                                      </span>
                                    )}
                                    {tertiaryCount > 0 && (
                                      <span className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full">
                                        <UserCheck className="h-3 w-3" /> {tertiaryCount} Tertiary
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Distribution Breakdowns */}
                              <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 bg-gray-50/50">
                                <div className="grid grid-cols-3 gap-4">
                                  {/* Sector Distribution */}
                                  <div>
                                    <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                                      <BarChart3 className="h-3 w-3" /> Sector Distribution
                                    </h4>
                                    <div className="space-y-1.5 max-h-24 overflow-y-auto">
                                      {sortedSectors.slice(0, 5).map(([sector, count]) => (
                                        <div key={sector} className="flex items-center gap-2">
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-0.5">
                                              <span className="text-[10px] text-gray-600 truncate">{sector}</span>
                                              <span className="text-[10px] font-medium text-gray-900">{count}</span>
                                            </div>
                                            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                              <div
                                                className="h-full bg-primary-500 rounded-full"
                                                style={{ width: `${(count / maxSectorCount) * 100}%` }}
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                      {sortedSectors.length > 5 && (
                                        <span className="text-[10px] text-gray-400">+{sortedSectors.length - 5} more</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Portfolio Distribution */}
                                  <div>
                                    <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                                      <FolderOpen className="h-3 w-3" /> By Portfolio
                                    </h4>
                                    {sortedPortfolios.length > 0 ? (
                                      <div className="space-y-1 max-h-24 overflow-y-auto">
                                        {sortedPortfolios.map(([id, { name, count }]) => (
                                          <div key={id} className="flex items-center justify-between px-2 py-1 bg-white rounded border border-gray-100">
                                            <span className="text-[10px] text-gray-600 truncate">{name}</span>
                                            <span className="text-[10px] font-semibold text-primary-600">{count}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-[10px] text-gray-400 italic">No portfolio assignments</p>
                                    )}
                                  </div>

                                  {/* Team Distribution */}
                                  <div>
                                    <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                                      <Building2 className="h-3 w-3" /> By Team
                                    </h4>
                                    {sortedTeams.length > 0 ? (
                                      <div className="space-y-1 max-h-24 overflow-y-auto">
                                        {sortedTeams.map(([id, { name, count }]) => (
                                          <div key={id} className="flex items-center justify-between px-2 py-1 bg-white rounded border border-gray-100">
                                            <span className="text-[10px] text-gray-600 truncate">{name}</span>
                                            <span className="text-[10px] font-semibold text-green-600">{count}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-[10px] text-gray-400 italic">No team assignments</p>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Assets Table */}
                              <div className="flex-1 overflow-auto">
                                <table className="w-full">
                                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                                    <tr>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                                      {coverageSettings?.enable_hierarchy && (
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                      )}
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sector</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Portfolio</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Since</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {analystCoverage
                                      .sort((a, b) => {
                                        const roleOrder: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2 }
                                        const aOrder = a.role ? (roleOrder[a.role] ?? 3) : 4
                                        const bOrder = b.role ? (roleOrder[b.role] ?? 3) : 4
                                        if (aOrder !== bOrder) return aOrder - bOrder
                                        return (a.assets?.symbol || '').localeCompare(b.assets?.symbol || '')
                                      })
                                      .map(coverage => (
                                        <tr key={coverage.id} className="hover:bg-gray-50">
                                          <td className="px-4 py-2.5">
                                            <span className="font-medium text-gray-900">{coverage.assets?.symbol}</span>
                                          </td>
                                          <td className="px-4 py-2.5">
                                            <span className="text-sm text-gray-600 truncate max-w-[120px] block">{coverage.assets?.company_name}</span>
                                          </td>
                                          {coverageSettings?.enable_hierarchy && (
                                            <td className="px-4 py-2.5">
                                              {coverage.role ? (
                                                <span className={clsx(
                                                  "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full",
                                                  coverage.role === 'primary' && "bg-yellow-100 text-yellow-800",
                                                  coverage.role === 'secondary' && "bg-blue-100 text-blue-800",
                                                  coverage.role === 'tertiary' && "bg-gray-100 text-gray-700"
                                                )}>
                                                  {coverage.role === 'primary' && <Star className="h-3 w-3" />}
                                                  {coverage.role === 'secondary' && <Shield className="h-3 w-3" />}
                                                  {coverage.role === 'tertiary' && <UserCheck className="h-3 w-3" />}
                                                  {coverage.role.charAt(0).toUpperCase() + coverage.role.slice(1)}
                                                </span>
                                              ) : (
                                                <span className="text-xs text-gray-400">—</span>
                                              )}
                                            </td>
                                          )}
                                          <td className="px-4 py-2.5">
                                            <span className="text-sm text-gray-500">{coverage.assets?.sector || '—'}</span>
                                          </td>
                                          <td className="px-4 py-2.5">
                                            <span className="text-sm text-gray-500">{coverage.portfolios?.name || '—'}</span>
                                          </td>
                                          <td className="px-4 py-2.5">
                                            <span className="text-sm text-gray-500">
                                              {coverage.start_date ? new Date(coverage.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                                {analystCoverage.length === 0 && (
                                  <div className="p-8 text-center text-gray-500 text-sm">
                                    No coverage records found
                                  </div>
                                )}
                              </div>
                            </>
                          )
                        })()}
                      </Card>
                    ) : selectedStatCard === 'analysts' ? (
                      /* Analysts Detail Panel */
                      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary-600" />
                            <h3 className="text-sm font-semibold text-gray-900">All Analysts</h3>
                          </div>
                        </div>
                        <div className="flex-1 overflow-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Analyst</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Coverage</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Primary</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Secondary</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sectors</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {(() => {
                                const analystStats = new Map<string, { name: string; count: number; primary: number; secondary: number; sectors: Set<string> }>()
                                filteredCoverage.forEach(c => {
                                  const existing = analystStats.get(c.user_id)
                                  if (existing) {
                                    existing.count++
                                    if (c.role === 'primary') existing.primary++
                                    if (c.role === 'secondary') existing.secondary++
                                    if (c.assets?.sector) existing.sectors.add(c.assets.sector)
                                  } else {
                                    analystStats.set(c.user_id, {
                                      name: c.analyst_name,
                                      count: 1,
                                      primary: c.role === 'primary' ? 1 : 0,
                                      secondary: c.role === 'secondary' ? 1 : 0,
                                      sectors: new Set(c.assets?.sector ? [c.assets.sector] : [])
                                    })
                                  }
                                })
                                return Array.from(analystStats.entries())
                                  .sort((a, b) => b[1].count - a[1].count)
                                  .map(([id, stats]) => (
                                    <tr key={id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedAnalystId(id)}>
                                      <td className="px-4 py-2.5 font-medium text-gray-900">{stats.name}</td>
                                      <td className="px-4 py-2.5 text-sm text-gray-600">{stats.count}</td>
                                      <td className="px-4 py-2.5">
                                        {stats.primary > 0 && <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">{stats.primary}</span>}
                                      </td>
                                      <td className="px-4 py-2.5">
                                        {stats.secondary > 0 && <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full">{stats.secondary}</span>}
                                      </td>
                                      <td className="px-4 py-2.5 text-xs text-gray-500">{Array.from(stats.sectors).slice(0, 3).join(', ')}{stats.sectors.size > 3 ? '...' : ''}</td>
                                    </tr>
                                  ))
                              })()}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    ) : selectedStatCard === 'covered' ? (
                      /* Covered Assets Detail Panel */
                      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <h3 className="text-sm font-semibold text-gray-900">Covered Assets ({filteredCoverage.length})</h3>
                          </div>
                        </div>
                        <div className="flex-1 overflow-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Analyst</th>
                                {coverageSettings?.enable_hierarchy && (
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                                )}
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Since</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {filteredCoverage
                                .sort((a, b) => (a.assets?.symbol || '').localeCompare(b.assets?.symbol || ''))
                                .map(coverage => (
                                  <tr key={coverage.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-2.5 font-medium text-gray-900">{coverage.assets?.symbol}</td>
                                    <td className="px-4 py-2.5 text-sm text-gray-600 truncate max-w-[150px]">{coverage.assets?.company_name}</td>
                                    <td className="px-4 py-2.5 text-sm text-gray-600">{coverage.analyst_name}</td>
                                    {coverageSettings?.enable_hierarchy && (
                                      <td className="px-4 py-2.5">
                                        {coverage.role ? (
                                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                                            {coverage.role.charAt(0).toUpperCase() + coverage.role.slice(1)}
                                          </span>
                                        ) : null}
                                      </td>
                                    )}
                                    <td className="px-4 py-2.5 text-sm text-gray-500">
                                      {coverage.start_date ? new Date(coverage.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    ) : selectedStatCard === 'gaps' ? (
                      /* Coverage Gaps Detail Panel - Enhanced with Sector/Team Breakdown */
                      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        {(() => {
                          // Group uncovered assets by sector
                          const sectorGaps = new Map<string, typeof allUncoveredAssets>()
                          allUncoveredAssets.forEach(asset => {
                            const sector = asset.sector || 'Uncategorized'
                            if (!sectorGaps.has(sector)) sectorGaps.set(sector, [])
                            sectorGaps.get(sector)!.push(asset)
                          })

                          // Find which teams typically cover each sector (based on existing coverage)
                          const sectorTeams = new Map<string, Map<string, { name: string; count: number }>>()
                          filteredCoverage.forEach(c => {
                            if (c.assets?.sector && c.team_id && c.teams) {
                              const sector = c.assets.sector
                              if (!sectorTeams.has(sector)) sectorTeams.set(sector, new Map())
                              const teams = sectorTeams.get(sector)!
                              const existing = teams.get(c.team_id)
                              if (existing) existing.count++
                              else teams.set(c.team_id, { name: c.teams.name, count: 1 })
                            }
                          })

                          const sortedSectors = Array.from(sectorGaps.entries())
                            .sort((a, b) => b[1].length - a[1].length)

                          return (
                            <>
                              <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 text-amber-600" />
                                    <h3 className="text-sm font-semibold text-gray-900">Coverage Gaps ({allUncoveredAssets.length})</h3>
                                  </div>
                                  <span className="text-xs text-gray-500">{sectorGaps.size} sectors affected</span>
                                </div>
                              </div>

                              {allUncoveredAssets.length > 0 ? (
                                <>
                                  {/* Sector Summary */}
                                  <div className="px-4 py-3 border-b border-gray-100 bg-amber-50/30 flex-shrink-0">
                                    <h4 className="text-xs font-semibold text-gray-700 mb-2">Gap Breakdown by Sector</h4>
                                    <div className="flex flex-wrap gap-1.5">
                                      {sortedSectors.slice(0, 8).map(([sector, assets]) => {
                                        const teamsForSector = sectorTeams.get(sector)
                                        const topTeam = teamsForSector ? Array.from(teamsForSector.values()).sort((a, b) => b.count - a.count)[0] : null
                                        return (
                                          <div
                                            key={sector}
                                            className="px-2.5 py-1.5 bg-white rounded-lg border border-amber-200 shadow-sm"
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs font-medium text-gray-900">{sector}</span>
                                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded">
                                                {assets.length}
                                              </span>
                                            </div>
                                            {topTeam && (
                                              <p className="text-[9px] text-gray-500 mt-0.5 flex items-center gap-1">
                                                <Building2 className="h-2.5 w-2.5" />
                                                Typically: {topTeam.name}
                                              </p>
                                            )}
                                          </div>
                                        )
                                      })}
                                      {sortedSectors.length > 8 && (
                                        <span className="px-2 py-1 text-xs text-gray-500">+{sortedSectors.length - 8} more</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Grouped Asset List */}
                                  <div className="flex-1 overflow-y-auto">
                                    {sortedSectors.map(([sector, assets]) => {
                                      const teamsForSector = sectorTeams.get(sector)
                                      const suggestedTeams = teamsForSector
                                        ? Array.from(teamsForSector.values()).sort((a, b) => b.count - a.count).slice(0, 2)
                                        : []

                                      return (
                                        <div key={sector} className="border-b border-gray-100 last:border-b-0">
                                          {/* Sector Header */}
                                          <div className="px-4 py-2 bg-gray-50 flex items-center justify-between sticky top-0">
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs font-semibold text-gray-700">{sector}</span>
                                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded">
                                                {assets.length} gaps
                                              </span>
                                            </div>
                                            {suggestedTeams.length > 0 && (
                                              <div className="flex items-center gap-1">
                                                <span className="text-[9px] text-gray-400">Suggested teams:</span>
                                                {suggestedTeams.map(team => (
                                                  <span key={team.name} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] bg-primary-50 text-primary-700 rounded">
                                                    <Building2 className="h-2 w-2" />
                                                    {team.name}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </div>

                                          {/* Assets in this sector */}
                                          <div className="px-4 py-2 space-y-1.5">
                                            {assets.map(asset => (
                                              <div key={asset.id} className="flex items-center justify-between p-2 bg-amber-50/50 rounded border border-amber-100 hover:bg-amber-50 transition-colors">
                                                <div className="min-w-0 flex-1">
                                                  <p className="text-sm font-medium text-gray-900 truncate">{asset.symbol}</p>
                                                  <p className="text-[10px] text-gray-500 truncate">{asset.company_name}</p>
                                                </div>
                                                {hasAnyCoverageAdminRights && (
                                                  <button
                                                    onClick={() => {
                                                      setAddingCoverage({
                                                        assetId: asset.id,
                                                        analystId: '',
                                                        startDate: getLocalDateString(),
                                                        endDate: '',
                                                        role: '',
                                                        portfolioIds: [],
                                                        notes: '',
                                                        teamId: userTeams?.[0]?.id || null,
                                                        visibility: coverageSettings?.default_visibility || 'team',
                                                        isLead: false
                                                      })
                                                      setAssetSearchQuery(`${asset.symbol} - ${asset.company_name}`)
                                                    }}
                                                    className="ml-2 px-2 py-1 text-[10px] font-medium text-primary-600 bg-white border border-primary-200 hover:bg-primary-50 rounded transition-colors flex-shrink-0"
                                                  >
                                                    Assign
                                                  </button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </>
                              ) : (
                                <div className="flex flex-col items-center justify-center py-12 text-center flex-1">
                                  <CheckCircle className="h-12 w-12 text-green-400 mb-3" />
                                  <p className="text-gray-600 font-medium">All assets are covered!</p>
                                  <p className="text-xs text-gray-500">No coverage gaps detected</p>
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </Card>
                    ) : selectedStatCard === 'average' ? (
                      /* Average Coverage Analytics Panel */
                      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-blue-600" />
                            <h3 className="text-sm font-semibold text-gray-900">Coverage Distribution</h3>
                          </div>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto">
                          {(() => {
                            const analystCounts = new Map<string, { name: string; count: number }>()
                            filteredCoverage.forEach(c => {
                              const existing = analystCounts.get(c.user_id)
                              if (existing) existing.count++
                              else analystCounts.set(c.user_id, { name: c.analyst_name, count: 1 })
                            })
                            const counts = Array.from(analystCounts.values())
                            const avgCount = counts.length > 0 ? counts.reduce((s, c) => s + c.count, 0) / counts.length : 0
                            const maxCount = counts.length > 0 ? Math.max(...counts.map(c => c.count)) : 0
                            const minCount = counts.length > 0 ? Math.min(...counts.map(c => c.count)) : 0

                            return (
                              <div className="space-y-6">
                                {/* Stats Summary */}
                                <div className="grid grid-cols-3 gap-4">
                                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                                    <p className="text-2xl font-bold text-gray-900">{avgCount.toFixed(1)}</p>
                                    <p className="text-xs text-gray-500">Average</p>
                                  </div>
                                  <div className="text-center p-3 bg-green-50 rounded-lg">
                                    <p className="text-2xl font-bold text-green-700">{maxCount}</p>
                                    <p className="text-xs text-gray-500">Highest</p>
                                  </div>
                                  <div className="text-center p-3 bg-amber-50 rounded-lg">
                                    <p className="text-2xl font-bold text-amber-700">{minCount}</p>
                                    <p className="text-xs text-gray-500">Lowest</p>
                                  </div>
                                </div>

                                {/* Distribution Chart */}
                                <div>
                                  <h4 className="text-sm font-medium text-gray-700 mb-3">Coverage by Analyst</h4>
                                  <div className="space-y-2">
                                    {counts
                                      .sort((a, b) => b.count - a.count)
                                      .map((analyst, idx) => (
                                        <div key={idx} className="flex items-center gap-3">
                                          <span className="text-sm text-gray-600 w-32 truncate">{analyst.name}</span>
                                          <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                              className={clsx(
                                                'h-full rounded-full transition-all',
                                                analyst.count >= avgCount * 1.5 ? 'bg-red-500' :
                                                analyst.count >= avgCount * 1.2 ? 'bg-yellow-500' :
                                                analyst.count >= avgCount * 0.8 ? 'bg-green-500' : 'bg-blue-400'
                                              )}
                                              style={{ width: `${maxCount > 0 ? (analyst.count / maxCount) * 100 : 0}%` }}
                                            />
                                          </div>
                                          <span className="text-sm font-medium text-gray-900 w-8 text-right">{analyst.count}</span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      </Card>
                    ) : (
                      /* Default - Select a stat card prompt */
                      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        <div className="flex-1 flex items-center justify-center text-center p-8">
                          <div>
                            <BarChart3 className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                            <p className="text-gray-500 font-medium">Select a stat card above</p>
                            <p className="text-xs text-gray-400 mt-1">Or click an analyst on the left to view their coverage</p>
                          </div>
                        </div>
                      </Card>
                    )}
                  </div>
                </div>
              )}

              {/* Matrix View - Grouped */}
              {viewMode === 'matrix' && (
                <div className="space-y-4">
                  {/* Grouping Selector */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Group by:</span>
                      <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                        {[
                          { value: 'sector', label: 'Sector' },
                          { value: 'analyst', label: 'Analyst' },
                          { value: 'portfolio', label: 'Portfolio' },
                          { value: 'team', label: 'Team' },
                          { value: 'role', label: 'Role' }
                        ].map(option => (
                          <button
                            key={option.value}
                            onClick={() => {
                              setMatrixGroupBy(option.value as typeof matrixGroupBy)
                              setCollapsedGroups(new Set())
                            }}
                            className={clsx(
                              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                              matrixGroupBy === option.value
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCollapsedGroups(new Set())}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Expand all
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => {
                          // Collapse all groups
                          const allGroupKeys = new Set<string>()
                          // This will be populated based on current grouping
                          filteredCoverage.forEach(c => {
                            if (matrixGroupBy === 'sector') allGroupKeys.add(c.assets?.sector || 'Uncategorized')
                            else if (matrixGroupBy === 'analyst') allGroupKeys.add(c.analyst_name)
                            else if (matrixGroupBy === 'portfolio') allGroupKeys.add(c.portfolios?.name || 'No Portfolio')
                            else if (matrixGroupBy === 'team') allGroupKeys.add(c.teams?.name || 'Firm-wide')
                            else if (matrixGroupBy === 'role') allGroupKeys.add(c.role || 'Unassigned')
                          })
                          setCollapsedGroups(allGroupKeys)
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Collapse all
                      </button>
                    </div>
                  </div>

                  {(() => {
                    // Get unique analysts for column headers
                    const analysts = [...new Set(filteredCoverage.map(c => c.analyst_name))].sort()

                    // Build groups based on selected grouping
                    const groups = new Map<string, {
                      assets: { id: string; symbol: string; name: string; sector: string; analyst?: string; role?: string }[]
                      coveredCount: number
                      totalCount: number
                    }>()

                    // Helper to get group key based on grouping type
                    const getGroupKey = (coverage: typeof filteredCoverage[0]) => {
                      switch (matrixGroupBy) {
                        case 'sector': return coverage.assets?.sector || 'Uncategorized'
                        case 'analyst': return coverage.analyst_name
                        case 'portfolio': return coverage.portfolios?.name || 'No Portfolio'
                        case 'team': return coverage.teams?.name || 'Firm-wide'
                        case 'role': return coverage.role || 'Unassigned'
                        default: return 'Uncategorized'
                      }
                    }

                    // Add covered assets
                    filteredCoverage.forEach(c => {
                      if (!c.assets) return
                      const groupKey = getGroupKey(c)
                      if (!groups.has(groupKey)) {
                        groups.set(groupKey, { assets: [], coveredCount: 0, totalCount: 0 })
                      }
                      const group = groups.get(groupKey)!
                      if (!group.assets.find(a => a.id === c.assets!.id)) {
                        group.assets.push({
                          id: c.assets.id,
                          symbol: c.assets.symbol,
                          name: c.assets.company_name,
                          sector: c.assets.sector || 'Uncategorized',
                          analyst: c.analyst_name,
                          role: c.role || undefined
                        })
                        group.coveredCount++
                        group.totalCount++
                      }
                    })

                    // Add uncovered assets (only for sector grouping)
                    if (matrixGroupBy === 'sector') {
                      allUncoveredAssets.forEach(asset => {
                        const groupKey = asset.sector || 'Uncategorized'
                        if (!groups.has(groupKey)) {
                          groups.set(groupKey, { assets: [], coveredCount: 0, totalCount: 0 })
                        }
                        const group = groups.get(groupKey)!
                        if (!group.assets.find(a => a.id === asset.id)) {
                          group.assets.push({
                            id: asset.id,
                            symbol: asset.symbol,
                            name: asset.company_name,
                            sector: asset.sector || 'Uncategorized'
                          })
                          group.totalCount++
                        }
                      })
                    }

                    // Sort groups by name
                    const sortedGroups = Array.from(groups.entries())
                      .sort((a, b) => {
                        // For role grouping, sort by priority
                        if (matrixGroupBy === 'role') {
                          const roleOrder: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2, Unassigned: 3 }
                          return (roleOrder[a[0]] ?? 99) - (roleOrder[b[0]] ?? 99)
                        }
                        return a[0].localeCompare(b[0])
                      })

                    if (sortedGroups.length === 0) {
                      return (
                        <Card className="p-8 text-center">
                          <Grid3X3 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                          <p className="text-gray-500">No coverage data to display</p>
                        </Card>
                      )
                    }

                    const toggleGroup = (groupKey: string) => {
                      const newCollapsed = new Set(collapsedGroups)
                      if (newCollapsed.has(groupKey)) {
                        newCollapsed.delete(groupKey)
                      } else {
                        newCollapsed.add(groupKey)
                      }
                      setCollapsedGroups(newCollapsed)
                    }

                    return sortedGroups.map(([groupKey, group]) => {
                      const isCollapsed = collapsedGroups.has(groupKey)
                      const coveragePercent = group.totalCount > 0
                        ? Math.round((group.coveredCount / group.totalCount) * 100)
                        : 0

                      return (
                        <Card key={groupKey} className="overflow-hidden">
                          {/* Group Header */}
                          <button
                            onClick={() => toggleGroup(groupKey)}
                            className="w-full px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <ChevronDown className={clsx(
                                'h-4 w-4 text-gray-500 transition-transform',
                                isCollapsed && '-rotate-90'
                              )} />
                              <h3 className="text-sm font-semibold text-gray-900">{groupKey}</h3>
                              <span className="text-xs text-gray-500">
                                {group.assets.length} {group.assets.length === 1 ? 'asset' : 'assets'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className={clsx(
                                      'h-full rounded-full',
                                      coveragePercent === 100 ? 'bg-green-500' :
                                      coveragePercent >= 75 ? 'bg-blue-500' :
                                      coveragePercent >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                                    )}
                                    style={{ width: `${coveragePercent}%` }}
                                  />
                                </div>
                                <span className={clsx(
                                  'text-xs font-medium',
                                  coveragePercent === 100 ? 'text-green-600' :
                                  coveragePercent >= 75 ? 'text-blue-600' :
                                  coveragePercent >= 50 ? 'text-yellow-600' : 'text-red-600'
                                )}>
                                  {coveragePercent}% covered
                                </span>
                              </div>
                            </div>
                          </button>

                          {/* Matrix Table - Collapsible */}
                          {!isCollapsed && (
                            <div className="overflow-x-auto">
                              <table className="min-w-full border-collapse">
                                <thead>
                                  <tr className="bg-gray-50 border-b border-gray-200">
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 min-w-[180px]">
                                      Asset
                                    </th>
                                    {analysts.map(analyst => (
                                      <th key={analyst} className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px]">
                                        <div className="truncate max-w-[70px] mx-auto" title={analyst}>
                                          {analyst.split(' ').map(n => n[0]).join('')}
                                        </div>
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {group.assets
                                    .sort((a, b) => a.symbol.localeCompare(b.symbol))
                                    .map(asset => {
                                      const assetCoverage = filteredCoverage.filter(c => c.assets?.id === asset.id)
                                      const isUncovered = assetCoverage.length === 0

                                      return (
                                        <tr key={asset.id} className={clsx(
                                          'hover:bg-gray-50',
                                          isUncovered && 'bg-red-50/50'
                                        )}>
                                          <td className={clsx(
                                            'px-3 py-2 sticky left-0',
                                            isUncovered ? 'bg-red-50/50' : 'bg-white'
                                          )}>
                                            <div className="flex items-center gap-2">
                                              {isUncovered && (
                                                <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                                              )}
                                              <div className="flex flex-col min-w-0">
                                                <span className="text-sm font-medium text-gray-900">{asset.symbol}</span>
                                                <span className="text-xs text-gray-500 truncate max-w-[140px]" title={asset.name}>
                                                  {asset.name}
                                                </span>
                                              </div>
                                            </div>
                                          </td>
                                          {analysts.map(analyst => {
                                            const coverage = assetCoverage.find(c => c.analyst_name === analyst)
                                            return (
                                              <td key={analyst} className="px-2 py-2 text-center">
                                                {coverage ? (
                                                  <div className="flex justify-center">
                                                    {/* When hierarchy is enabled, show role badge */}
                                                    {coverageSettings?.enable_hierarchy && coverage.role ? (
                                                      <span className="inline-flex items-center justify-center w-6 h-6 bg-purple-100 text-purple-700 rounded-full" title={`${coverage.role} - ${analyst}`}>
                                                        <User className="h-3.5 w-3.5" />
                                                      </span>
                                                    ) : (
                                                      /* When hierarchy is disabled, show simple checkmark - no differentiation */
                                                      <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 text-green-700 rounded-full" title={`Assigned - ${analyst}`}>
                                                        <CheckCircle className="h-3.5 w-3.5" />
                                                      </span>
                                                    )}
                                                  </div>
                                                ) : (
                                                  <span className="text-gray-200">·</span>
                                                )}
                                              </td>
                                            )
                                          })}
                                        </tr>
                                      )
                                    })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </Card>
                      )
                    })
                  })()}

                  {/* Legend */}
                  <div className="flex items-center justify-center gap-6 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-green-100 text-green-700 rounded-full">
                        <CheckCircle className="h-3 w-3" />
                      </span>
                      <span className="text-xs text-gray-600">Assigned</span>
                    </div>
                    {coverageSettings?.enable_hierarchy && (
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-5 h-5 bg-purple-100 text-purple-700 rounded-full">
                          <User className="h-3 w-3" />
                        </span>
                        <span className="text-xs text-gray-600">Role Assigned</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <span className="text-xs text-gray-600">Uncovered</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Calendar View - Gantt-style Coverage Changes Timeline */}
              {viewMode === 'calendar' && (
                <div className="space-y-4">
                  {(() => {
                    const today = new Date()
                    const DAYS_BACK = 30
                    const DAYS_FORWARD = 30
                    const TOTAL_DAYS = DAYS_BACK + DAYS_FORWARD + 1

                    const startDate = new Date(today.getTime() - DAYS_BACK * 24 * 60 * 60 * 1000)
                    const endDate = new Date(today.getTime() + DAYS_FORWARD * 24 * 60 * 60 * 1000)

                    // Build coverage events from all coverage records
                    type CoverageEvent = {
                      id: string
                      type: 'started' | 'ended' | 'upcoming_end' | 'transition' | 'role_change' | 'dates_changed'
                      date: Date
                      dayIndex: number
                      assetSymbol: string
                      assetName: string
                      assetId: string
                      analystName: string
                      role: string | null
                      // For transitions
                      fromAnalyst?: string
                      toAnalyst?: string
                      // For role changes
                      oldRole?: string
                      newRole?: string
                    }

                    const events: CoverageEvent[] = []

                    const getDayIndex = (date: Date) => {
                      const diffTime = date.getTime() - startDate.getTime()
                      return Math.floor(diffTime / (1000 * 60 * 60 * 24))
                    }

                    // Get starts (from active coverage)
                    filteredCoverage.forEach(c => {
                      if (!c.start_date || !c.assets) return
                      const eventDate = new Date(c.start_date)

                      if (eventDate >= startDate && eventDate <= endDate) {
                        events.push({
                          id: `start-${c.id}`,
                          type: 'started',
                          date: eventDate,
                          dayIndex: getDayIndex(eventDate),
                          assetSymbol: c.assets.symbol,
                          assetName: c.assets.company_name,
                          assetId: c.assets.id,
                          analystName: c.analyst_name,
                          role: c.role || null
                        })
                      }

                      // Upcoming ends
                      if (c.end_date) {
                        const eventEndDate = new Date(c.end_date)
                        if (eventEndDate >= startDate && eventEndDate <= endDate) {
                          events.push({
                            id: `upcoming-end-${c.id}`,
                            type: eventEndDate <= today ? 'ended' : 'upcoming_end',
                            date: eventEndDate,
                            dayIndex: getDayIndex(eventEndDate),
                            assetSymbol: c.assets.symbol,
                            assetName: c.assets.company_name,
                            assetId: c.assets.id,
                            analystName: c.analyst_name,
                            role: c.role || null
                          })
                        }
                      }
                    })

                    // Get historical events from coverage history
                    if (filteredCoverageEvents) {
                      // First pass: detect transitions by finding created + dates_changed pairs
                      const transitionPairs = new Set<string>()

                      filteredCoverageEvents.forEach(createdEvent => {
                        if (createdEvent.change_type !== 'created' || !createdEvent.assets) return

                        // Look for matching end event (dates_changed that sets end_date)
                        const matchingEnd = filteredCoverageEvents.find(endEvent =>
                          endEvent.change_type === 'dates_changed' &&
                          endEvent.asset_id === createdEvent.asset_id &&
                          endEvent.old_analyst_name !== createdEvent.new_analyst_name &&
                          endEvent.new_end_date &&
                          Math.abs(new Date(createdEvent.changed_at).getTime() - new Date(endEvent.changed_at).getTime()) < 10000
                        )

                        if (matchingEnd) {
                          transitionPairs.add(createdEvent.id)
                          transitionPairs.add(matchingEnd.id)

                          const eventDate = new Date(createdEvent.changed_at)
                          if (eventDate >= startDate && eventDate <= endDate) {
                            events.push({
                              id: `transition-${createdEvent.id}`,
                              type: 'transition',
                              date: eventDate,
                              dayIndex: getDayIndex(eventDate),
                              assetSymbol: createdEvent.assets.symbol,
                              assetName: createdEvent.assets.company_name,
                              assetId: createdEvent.asset_id,
                              analystName: createdEvent.new_analyst_name,
                              role: createdEvent.new_role || null,
                              fromAnalyst: matchingEnd.old_analyst_name,
                              toAnalyst: createdEvent.new_analyst_name
                            })
                          }
                        }
                      })

                      // Second pass: add other events that aren't part of transitions
                      filteredCoverageEvents.forEach(event => {
                        if (!event.assets || transitionPairs.has(event.id)) return

                        const eventDate = new Date(event.changed_at)
                        if (eventDate < startDate || eventDate > endDate) return

                        // Handle analyst_changed (handoffs recorded directly)
                        if (event.change_type === 'analyst_changed') {
                          events.push({
                            id: `analyst-change-${event.id}`,
                            type: 'transition',
                            date: eventDate,
                            dayIndex: getDayIndex(eventDate),
                            assetSymbol: event.assets.symbol,
                            assetName: event.assets.company_name,
                            assetId: event.asset_id,
                            analystName: event.new_analyst_name || event.old_analyst_name,
                            role: event.new_role || event.old_role || null,
                            fromAnalyst: event.old_analyst_name,
                            toAnalyst: event.new_analyst_name
                          })
                        }

                        // Handle role changes
                        if (event.change_type === 'role_changed' ||
                            (event.old_role && event.new_role && event.old_role !== event.new_role)) {
                          events.push({
                            id: `role-change-${event.id}`,
                            type: 'role_change',
                            date: eventDate,
                            dayIndex: getDayIndex(eventDate),
                            assetSymbol: event.assets.symbol,
                            assetName: event.assets.company_name,
                            assetId: event.asset_id,
                            analystName: event.new_analyst_name || event.old_analyst_name,
                            role: event.new_role || null,
                            oldRole: event.old_role,
                            newRole: event.new_role
                          })
                        }

                        // Handle deletions (coverage ended)
                        if (event.change_type === 'deleted' && event.end_date) {
                          const endDate = new Date(event.end_date)
                          if (endDate >= startDate && endDate <= today) {
                            const exists = events.some(e =>
                              e.assetId === event.asset_id &&
                              e.analystName === event.analyst_name &&
                              e.type === 'ended' &&
                              Math.abs(e.date.getTime() - endDate.getTime()) < 24 * 60 * 60 * 1000
                            )
                            if (!exists) {
                              events.push({
                                id: `ended-${event.id}`,
                                type: 'ended',
                                date: endDate,
                                dayIndex: getDayIndex(endDate),
                                assetSymbol: event.assets.symbol,
                                assetName: event.assets.company_name,
                                assetId: event.asset_id,
                                analystName: event.analyst_name,
                                role: event.role || null
                              })
                            }
                          }
                        }

                        // Handle dates_changed that set end dates (not part of transitions)
                        if (event.change_type === 'dates_changed' && event.new_end_date) {
                          const endDate = new Date(event.new_end_date)
                          if (endDate >= startDate && endDate <= today) {
                            const exists = events.some(e =>
                              e.assetId === event.asset_id &&
                              e.analystName === event.old_analyst_name &&
                              (e.type === 'ended' || e.type === 'upcoming_end') &&
                              Math.abs(e.date.getTime() - endDate.getTime()) < 24 * 60 * 60 * 1000
                            )
                            if (!exists) {
                              events.push({
                                id: `dates-ended-${event.id}`,
                                type: endDate <= today ? 'ended' : 'upcoming_end',
                                date: endDate,
                                dayIndex: getDayIndex(endDate),
                                assetSymbol: event.assets.symbol,
                                assetName: event.assets.company_name,
                                assetId: event.asset_id,
                                analystName: event.old_analyst_name,
                                role: event.old_role || null
                              })
                            }
                          }
                        }
                      })
                    }

                    // Group events by asset for the Gantt rows
                    const eventsByAsset = new Map<string, CoverageEvent[]>()
                    events.forEach(event => {
                      const key = event.assetId
                      if (!eventsByAsset.has(key)) {
                        eventsByAsset.set(key, [])
                      }
                      eventsByAsset.get(key)!.push(event)
                    })

                    // Sort assets by most recent event
                    const sortedAssets = Array.from(eventsByAsset.entries())
                      .map(([assetId, assetEvents]) => ({
                        assetId,
                        symbol: assetEvents[0].assetSymbol,
                        name: assetEvents[0].assetName,
                        events: assetEvents.sort((a, b) => a.date.getTime() - b.date.getTime()),
                        latestEventDate: Math.max(...assetEvents.map(e => e.date.getTime()))
                      }))
                      .sort((a, b) => b.latestEventDate - a.latestEventDate)

                    // Generate date labels for the timeline header
                    const dateLabels: { date: Date; label: string; isToday: boolean; isWeekStart: boolean }[] = []
                    for (let i = 0; i < TOTAL_DAYS; i++) {
                      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)
                      const isToday = d.toDateString() === today.toDateString()
                      const isWeekStart = d.getDay() === 1 // Monday
                      dateLabels.push({
                        date: d,
                        label: d.getDate().toString(),
                        isToday,
                        isWeekStart
                      })
                    }

                    // Group by weeks for header
                    const weeks: { start: Date; end: Date; label: string }[] = []
                    let currentWeekStart = new Date(startDate)
                    while (currentWeekStart <= endDate) {
                      const weekEnd = new Date(currentWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000)
                      weeks.push({
                        start: new Date(currentWeekStart),
                        end: weekEnd > endDate ? endDate : weekEnd,
                        label: currentWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      })
                      currentWeekStart = new Date(currentWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
                    }

                    const todayIndex = getDayIndex(today)

                    // Find potential coverage gaps
                    const potentialGaps = events.filter(e => {
                      if (e.type !== 'upcoming_end') return false
                      const otherCoverage = filteredCoverage.filter(c =>
                        c.assets?.id === e.assetId &&
                        c.analyst_name !== e.analystName &&
                        c.is_active
                      )
                      return otherCoverage.length === 0
                    })

                    if (events.length === 0) {
                      return (
                        <Card className="p-8 text-center">
                          <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                          <p className="text-gray-600 font-medium">No coverage changes in this period</p>
                          <p className="text-sm text-gray-500 mt-1">Coverage starts, ends, and transitions will appear here</p>
                        </Card>
                      )
                    }

                    return (
                      <>
                        {/* Summary Stats */}
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                          <Card className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-green-100 rounded">
                                <Plus className="h-4 w-4 text-green-600" />
                              </div>
                              <div>
                                <p className="text-lg font-bold text-gray-900">
                                  {events.filter(e => e.type === 'started').length}
                                </p>
                                <p className="text-xs text-gray-500">Started</p>
                              </div>
                            </div>
                          </Card>
                          <Card className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-gray-100 rounded">
                                <X className="h-4 w-4 text-gray-600" />
                              </div>
                              <div>
                                <p className="text-lg font-bold text-gray-900">
                                  {events.filter(e => e.type === 'ended').length}
                                </p>
                                <p className="text-xs text-gray-500">Ended</p>
                              </div>
                            </div>
                          </Card>
                          <Card className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-blue-100 rounded">
                                <ArrowRightLeft className="h-4 w-4 text-blue-600" />
                              </div>
                              <div>
                                <p className="text-lg font-bold text-gray-900">
                                  {events.filter(e => e.type === 'transition').length}
                                </p>
                                <p className="text-xs text-gray-500">Transitions</p>
                              </div>
                            </div>
                          </Card>
                          <Card className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-purple-100 rounded">
                                <Shield className="h-4 w-4 text-purple-600" />
                              </div>
                              <div>
                                <p className="text-lg font-bold text-gray-900">
                                  {events.filter(e => e.type === 'role_change').length}
                                </p>
                                <p className="text-xs text-gray-500">Role Changes</p>
                              </div>
                            </div>
                          </Card>
                          <Card className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-orange-100 rounded">
                                <Clock className="h-4 w-4 text-orange-600" />
                              </div>
                              <div>
                                <p className="text-lg font-bold text-gray-900">
                                  {events.filter(e => e.type === 'upcoming_end').length}
                                </p>
                                <p className="text-xs text-gray-500">Upcoming Ends</p>
                              </div>
                            </div>
                          </Card>
                          <Card className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-amber-100 rounded">
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                              </div>
                              <div>
                                <p className="text-lg font-bold text-gray-900">
                                  {potentialGaps.length}
                                </p>
                                <p className="text-xs text-gray-500">Gap Risks</p>
                              </div>
                            </div>
                          </Card>
                        </div>

                        {/* Gantt Timeline */}
                        <Card className="overflow-hidden">
                          {/* Legend at top */}
                          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-600" />
                                <span className="text-xs text-gray-600">Started</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-gray-500" />
                                <span className="text-xs text-gray-600">Ended</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-blue-600" />
                                <span className="text-xs text-gray-600">Transition</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-purple-500 border-2 border-purple-600" />
                                <span className="text-xs text-gray-600">Role Change</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-orange-400 border-2 border-orange-500" />
                                <span className="text-xs text-gray-600">Upcoming End</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-amber-400 border-2 border-amber-500 ring-2 ring-amber-200" />
                                <span className="text-xs text-gray-600">Gap Risk</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1.5">
                                <div className="w-0.5 h-4 bg-primary-500" />
                                <span className="text-xs text-gray-600">Today</span>
                              </div>
                              <span className="text-xs text-gray-400 ml-4">Scroll horizontally to navigate timeline</span>
                            </div>
                          </div>

                          {/* Scrollable Timeline Container */}
                          <div className="overflow-x-auto overflow-y-auto max-h-[500px]" style={{ scrollbarWidth: 'thin' }}>
                            <table className="border-collapse" style={{ minWidth: `${160 + TOTAL_DAYS * 32}px` }}>
                              {/* Table Header */}
                              <thead className="sticky top-0 z-20 bg-gray-50">
                                <tr>
                                  {/* Asset Column Header */}
                                  <th className="sticky left-0 z-30 w-[160px] min-w-[160px] px-3 py-2 bg-gray-50 border-b border-r border-gray-200 text-left">
                                    <span className="text-xs font-medium text-gray-500 uppercase">Asset</span>
                                  </th>
                                  {/* Date Column Headers */}
                                  {dateLabels.map((dl, i) => (
                                    <th
                                      key={i}
                                      className={clsx(
                                        'w-8 min-w-[32px] px-0 py-1 border-b border-r text-center',
                                        dl.isToday ? 'bg-primary-100 border-primary-200' : 'bg-gray-50 border-gray-100',
                                        dl.isWeekStart && !dl.isToday && 'border-l-2 border-l-gray-300'
                                      )}
                                    >
                                      <div className="flex flex-col items-center">
                                        <span className={clsx(
                                          'text-[9px] uppercase leading-tight',
                                          dl.isToday ? 'text-primary-600 font-medium' : 'text-gray-400'
                                        )}>
                                          {dl.date.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)}
                                        </span>
                                        <span className={clsx(
                                          'text-xs leading-tight',
                                          dl.isToday ? 'font-bold text-primary-700' : 'text-gray-600'
                                        )}>
                                          {dl.label}
                                        </span>
                                        {dl.date.getDate() === 1 && (
                                          <span className="text-[8px] text-gray-400 uppercase leading-tight">
                                            {dl.date.toLocaleDateString('en-US', { month: 'short' })}
                                          </span>
                                        )}
                                      </div>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sortedAssets.slice(0, 50).map(({ assetId, symbol, name, events: assetEvents }) => (
                                  <tr key={assetId} className="hover:bg-gray-50/50">
                                    {/* Asset Label - Sticky */}
                                    <td className="sticky left-0 z-10 w-[160px] min-w-[160px] px-3 py-2 bg-white border-r border-b border-gray-200">
                                      <div className="flex flex-col min-w-0">
                                        <span className="text-sm font-medium text-gray-900 truncate">{symbol}</span>
                                        <span className="text-[10px] text-gray-500 truncate" title={name}>{name}</span>
                                      </div>
                                    </td>
                                    {/* Timeline Cells */}
                                    {dateLabels.map((dl, i) => {
                                      // Find events on this day
                                      const dayEvents = assetEvents.filter(e => e.dayIndex === i)
                                      const isToday = dl.isToday

                                      return (
                                        <td
                                          key={i}
                                          className={clsx(
                                            'w-8 min-w-[32px] h-12 border-r border-b relative',
                                            isToday ? 'bg-primary-50/30 border-primary-100' : 'border-gray-100',
                                            dl.isWeekStart && !isToday && 'border-l-2 border-l-gray-200'
                                          )}
                                        >
                                          {/* Today line */}
                                          {isToday && (
                                            <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-primary-500 -translate-x-1/2 z-10" />
                                          )}
                                          {/* Event Markers */}
                                          {dayEvents.map((event, eventIdx) => {
                                            const isGap = potentialGaps.some(g => g.id === event.id)
                                            return (
                                              <div
                                                key={event.id}
                                                className="absolute left-1/2 -translate-x-1/2 z-20 group"
                                                style={{ top: dayEvents.length > 1 ? `${25 + (eventIdx - (dayEvents.length - 1) / 2) * 14}%` : '50%', transform: `translateX(-50%) translateY(-50%)` }}
                                              >
                                                {/* Event Marker */}
                                                <div className={clsx(
                                                  'w-4 h-4 rounded-full border-2 cursor-pointer transition-all hover:scale-125 shadow-sm',
                                                  event.type === 'started' && 'bg-green-500 border-green-600',
                                                  event.type === 'ended' && 'bg-gray-400 border-gray-500',
                                                  event.type === 'transition' && 'bg-blue-500 border-blue-600',
                                                  event.type === 'role_change' && 'bg-purple-500 border-purple-600',
                                                  event.type === 'upcoming_end' && !isGap && 'bg-orange-400 border-orange-500',
                                                  event.type === 'upcoming_end' && isGap && 'bg-amber-400 border-amber-500 ring-2 ring-amber-200'
                                                )} />
                                                {/* Tooltip */}
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
                                                  <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                                                    <div className="font-medium">
                                                      {event.type === 'started' && 'Coverage Started'}
                                                      {event.type === 'ended' && 'Coverage Ended'}
                                                      {event.type === 'transition' && 'Analyst Transition'}
                                                      {event.type === 'role_change' && 'Role Changed'}
                                                      {event.type === 'upcoming_end' && (isGap ? 'Ending (Gap Risk!)' : 'Coverage Ending')}
                                                    </div>
                                                    <div className="text-gray-300 mt-1">
                                                      {event.type === 'transition' && event.fromAnalyst && event.toAnalyst ? (
                                                        <>{event.fromAnalyst} → {event.toAnalyst}</>
                                                      ) : event.type === 'role_change' && event.oldRole && event.newRole ? (
                                                        <>{event.analystName}: {event.oldRole} → {event.newRole}</>
                                                      ) : (
                                                        <>{event.analystName}{event.role && ` (${event.role})`}</>
                                                      )}
                                                    </div>
                                                    <div className="text-gray-400 mt-0.5">
                                                      {event.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                                    </div>
                                                    {/* Tooltip arrow */}
                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                                                  </div>
                                                </div>
                                              </div>
                                            )
                                          })}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {sortedAssets.length > 50 && (
                            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-center">
                              <span className="text-sm text-gray-500">
                                Showing 50 of {sortedAssets.length} assets with changes
                              </span>
                            </div>
                          )}
                        </Card>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Team View - Team-centric coverage dashboard */}
              {viewMode === 'team' && (
                <div className="space-y-4">
                  {(() => {
                    // Group coverage by team
                    type TeamStats = {
                      id: string
                      name: string
                      analysts: Map<string, { name: string; count: number; primaryCount: number }>
                      assets: Set<string>
                      coveredAssets: Set<string>
                      primaryCount: number
                      secondaryCount: number
                      tertiaryCount: number
                      portfolios: Map<string, { name: string; count: number }>
                      sectors: Map<string, number>
                    }

                    const teamStats = new Map<string, TeamStats>()
                    const noTeamStats: TeamStats = {
                      id: 'no-team',
                      name: 'Unassigned',
                      analysts: new Map(),
                      assets: new Set(),
                      coveredAssets: new Set(),
                      primaryCount: 0,
                      secondaryCount: 0,
                      tertiaryCount: 0,
                      portfolios: new Map(),
                      sectors: new Map()
                    }

                    // Process all coverage records
                    filteredCoverage.forEach(c => {
                      const teamId = c.team_id || 'no-team'
                      const teamName = c.teams?.name || 'Unassigned'

                      if (!teamStats.has(teamId) && teamId !== 'no-team') {
                        teamStats.set(teamId, {
                          id: teamId,
                          name: teamName,
                          analysts: new Map(),
                          assets: new Set(),
                          coveredAssets: new Set(),
                          primaryCount: 0,
                          secondaryCount: 0,
                          tertiaryCount: 0,
                          portfolios: new Map(),
                          sectors: new Map()
                        })
                      }

                      const stats = teamId === 'no-team' ? noTeamStats : teamStats.get(teamId)!

                      // Track analysts
                      const existingAnalyst = stats.analysts.get(c.user_id)
                      if (existingAnalyst) {
                        existingAnalyst.count++
                        if (c.role === 'primary') existingAnalyst.primaryCount++
                      } else {
                        stats.analysts.set(c.user_id, {
                          name: c.analyst_name,
                          count: 1,
                          primaryCount: c.role === 'primary' ? 1 : 0
                        })
                      }

                      // Track assets
                      if (c.asset_id) {
                        stats.assets.add(c.asset_id)
                        stats.coveredAssets.add(c.asset_id)
                      }

                      // Track roles
                      if (c.role === 'primary') stats.primaryCount++
                      else if (c.role === 'secondary') stats.secondaryCount++
                      else if (c.role === 'tertiary') stats.tertiaryCount++

                      // Track portfolios
                      if (c.portfolio_id && c.portfolios) {
                        const existingPortfolio = stats.portfolios.get(c.portfolio_id)
                        if (existingPortfolio) {
                          existingPortfolio.count++
                        } else {
                          stats.portfolios.set(c.portfolio_id, { name: c.portfolios.name, count: 1 })
                        }
                      }

                      // Track sectors
                      if (c.assets?.sector) {
                        stats.sectors.set(c.assets.sector, (stats.sectors.get(c.assets.sector) || 0) + 1)
                      }
                    })

                    // Add no-team stats if it has data
                    if (noTeamStats.analysts.size > 0) {
                      teamStats.set('no-team', noTeamStats)
                    }

                    const sortedTeams = Array.from(teamStats.values()).sort((a, b) => {
                      if (a.id === 'no-team') return 1
                      if (b.id === 'no-team') return -1
                      return b.assets.size - a.assets.size
                    })

                    return (
                      <>
                        {/* Team Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {sortedTeams.map(team => {
                            const avgCoverage = team.analysts.size > 0 ? team.assets.size / team.analysts.size : 0
                            const sortedAnalysts = Array.from(team.analysts.values()).sort((a, b) => b.count - a.count)
                            const topSectors = Array.from(team.sectors.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)

                            return (
                              <Card key={team.id} className="overflow-hidden">
                                {/* Team Header */}
                                <div className={clsx(
                                  "px-4 py-3 border-b",
                                  team.id === 'no-team' ? "bg-gray-100 border-gray-200" : "bg-gradient-to-r from-primary-50 to-white border-primary-100"
                                )}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Building2 className={clsx("h-5 w-5", team.id === 'no-team' ? "text-gray-400" : "text-primary-600")} />
                                      <h3 className="font-semibold text-gray-900">{team.name}</h3>
                                    </div>
                                    <span className="text-xs text-gray-500">{team.analysts.size} analysts</span>
                                  </div>
                                </div>

                                {/* Team Stats */}
                                <div className="p-4 space-y-4">
                                  {/* Coverage Stats */}
                                  <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="p-2 bg-gray-50 rounded-lg">
                                      <p className="text-lg font-bold text-gray-900">{team.assets.size}</p>
                                      <p className="text-[10px] text-gray-500">Assets</p>
                                    </div>
                                    <div className="p-2 bg-yellow-50 rounded-lg">
                                      <p className="text-lg font-bold text-yellow-700">{team.primaryCount}</p>
                                      <p className="text-[10px] text-gray-500">Primary</p>
                                    </div>
                                    <div className="p-2 bg-blue-50 rounded-lg">
                                      <p className="text-lg font-bold text-blue-700">{team.secondaryCount}</p>
                                      <p className="text-[10px] text-gray-500">Secondary</p>
                                    </div>
                                  </div>

                                  {/* Analyst Workload */}
                                  <div>
                                    <h4 className="text-xs font-semibold text-gray-700 mb-2">Analyst Workload</h4>
                                    <div className="space-y-1.5">
                                      {sortedAnalysts.slice(0, 4).map(analyst => {
                                        const loadPercent = avgCoverage > 0 ? Math.min(100, (analyst.count / (avgCoverage * 2)) * 100) : 50
                                        return (
                                          <div key={analyst.name} className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-600 w-20 truncate">{analyst.name.split(' ')[0]}</span>
                                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                              <div
                                                className={clsx(
                                                  "h-full rounded-full",
                                                  loadPercent > 75 ? "bg-red-400" : loadPercent > 50 ? "bg-yellow-400" : "bg-green-400"
                                                )}
                                                style={{ width: `${loadPercent}%` }}
                                              />
                                            </div>
                                            <span className="text-[10px] font-medium text-gray-700 w-6 text-right">{analyst.count}</span>
                                          </div>
                                        )
                                      })}
                                      {sortedAnalysts.length > 4 && (
                                        <p className="text-[10px] text-gray-400">+{sortedAnalysts.length - 4} more</p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Top Sectors */}
                                  {topSectors.length > 0 && (
                                    <div>
                                      <h4 className="text-xs font-semibold text-gray-700 mb-2">Top Sectors</h4>
                                      <div className="flex flex-wrap gap-1">
                                        {topSectors.map(([sector, count]) => (
                                          <span key={sector} className="inline-flex items-center px-2 py-0.5 text-[10px] bg-gray-100 text-gray-700 rounded-full">
                                            {sector} <span className="ml-1 font-semibold">{count}</span>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Portfolios */}
                                  {team.portfolios.size > 0 && (
                                    <div>
                                      <h4 className="text-xs font-semibold text-gray-700 mb-2">Portfolios</h4>
                                      <div className="flex flex-wrap gap-1">
                                        {Array.from(team.portfolios.values()).slice(0, 3).map(portfolio => (
                                          <span key={portfolio.name} className="inline-flex items-center px-2 py-0.5 text-[10px] bg-primary-50 text-primary-700 rounded-full">
                                            <FolderOpen className="h-2.5 w-2.5 mr-1" />
                                            {portfolio.name}
                                          </span>
                                        ))}
                                        {team.portfolios.size > 3 && (
                                          <span className="text-[10px] text-gray-400">+{team.portfolios.size - 3} more</span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </Card>
                            )
                          })}
                        </div>

                        {/* Empty State */}
                        {sortedTeams.length === 0 && (
                          <Card className="p-12 text-center">
                            <Building2 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-900 mb-2">No team coverage data</h3>
                            <p className="text-gray-500">Coverage records don't have team assignments yet</p>
                          </Card>
                        )}
                      </>
                    )
                  })()}
                </div>
              )}
              </>
            )}

            {/* History View - Coverage Events */}
            {activeView === 'history' && (
              <Card padding="none" className={`min-h-[500px] max-h-[calc(100vh-200px)] flex flex-col overflow-hidden relative ${!filteredCoverageEvents || filteredCoverageEvents.length === 0 ? 'flex items-center justify-center' : ''}`}>
                {/* Loading overlay with blur */}
                {(historyFetching) && (
                  <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  </div>
                )}
                {!filteredCoverageEvents || filteredCoverageEvents.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <History className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No coverage history yet</h3>
                    <p className="text-gray-500">Coverage events will appear here</p>
                  </div>
                ) : (
                  <>
                    {/* Period Comparison Summary */}
                    <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-primary-600" />
                          Coverage Changes
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Period:</span>
                          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                            {[
                              { value: '7d', label: '7d' },
                              { value: '30d', label: '30d' },
                              { value: '90d', label: '90d' },
                              { value: 'ytd', label: 'YTD' },
                              { value: 'all', label: 'All' },
                              { value: 'custom', label: 'Custom' }
                            ].map(period => (
                              <button
                                key={period.value}
                                onClick={() => {
                                  setComparisonPeriod(period.value as '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom')
                                  setVisibleHistoryCount(50) // Reset visible count when changing period
                                }}
                                className={clsx(
                                  "px-2 py-1 text-xs font-medium rounded-md transition-all",
                                  comparisonPeriod === period.value
                                    ? "bg-white text-primary-700 shadow-sm"
                                    : "text-gray-600 hover:text-gray-900"
                                )}
                              >
                                {period.label}
                              </button>
                            ))}
                          </div>
                          {comparisonPeriod === 'custom' && (
                            <div className="flex items-center gap-1.5 ml-2">
                              <input
                                type="date"
                                value={customDateRange.start}
                                onChange={(e) => {
                                  setCustomDateRange(prev => ({ ...prev, start: e.target.value }))
                                  setVisibleHistoryCount(50)
                                }}
                                className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                              />
                              <span className="text-xs text-gray-400">to</span>
                              <input
                                type="date"
                                value={customDateRange.end}
                                onChange={(e) => {
                                  setCustomDateRange(prev => ({ ...prev, end: e.target.value }))
                                  setVisibleHistoryCount(50)
                                }}
                                className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Comparison Stats */}
                      {(() => {
                        const now = new Date()
                        let periodStart: Date | null = null
                        let periodEnd: Date = now
                        switch (comparisonPeriod) {
                          case '7d':
                            periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
                            break
                          case '30d':
                            periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
                            break
                          case '90d':
                            periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
                            break
                          case 'ytd':
                            periodStart = new Date(now.getFullYear(), 0, 1)
                            break
                          case 'all':
                            periodStart = null // No start date filter
                            break
                          case 'custom':
                            periodStart = new Date(customDateRange.start)
                            periodEnd = new Date(customDateRange.end + 'T23:59:59') // Include full end day
                            break
                        }

                        const periodEvents = filteredCoverageEvents.filter(e => {
                          const eventDate = new Date(e.changed_at)
                          if (periodStart && eventDate < periodStart) return false
                          if (comparisonPeriod === 'custom' && eventDate > periodEnd) return false
                          return true
                        })
                        const addedCount = periodEvents.filter(e => e.change_type === 'created' || e.change_type === 'coverage_added').length
                        const removedCount = periodEvents.filter(e => e.change_type === 'deleted').length
                        const changedCount = periodEvents.filter(e => e.change_type === 'analyst_changed' || e.change_type === 'dates_changed').length
                        const netChange = addedCount - removedCount

                        // Get unique analysts affected
                        const analystsAffected = new Set<string>()
                        periodEvents.forEach(e => {
                          if (e.new_analyst_name) analystsAffected.add(e.new_analyst_name)
                          if (e.old_analyst_name) analystsAffected.add(e.old_analyst_name)
                        })

                        // Get unique assets affected
                        const assetsAffected = new Set<string>()
                        periodEvents.forEach(e => {
                          if (e.asset_id) assetsAffected.add(e.asset_id)
                        })

                        return (
                          <div className="grid grid-cols-5 gap-3">
                            <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                              <div className="flex items-center gap-2">
                                <Plus className="h-4 w-4 text-green-600" />
                                <div>
                                  <p className="text-lg font-bold text-green-700">{addedCount}</p>
                                  <p className="text-[10px] text-green-600">Added</p>
                                </div>
                              </div>
                            </div>
                            <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                              <div className="flex items-center gap-2">
                                <X className="h-4 w-4 text-red-600" />
                                <div>
                                  <p className="text-lg font-bold text-red-700">{removedCount}</p>
                                  <p className="text-[10px] text-red-600">Removed</p>
                                </div>
                              </div>
                            </div>
                            <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                              <div className="flex items-center gap-2">
                                <ArrowRightLeft className="h-4 w-4 text-blue-600" />
                                <div>
                                  <p className="text-lg font-bold text-blue-700">{changedCount}</p>
                                  <p className="text-[10px] text-blue-600">Changed</p>
                                </div>
                              </div>
                            </div>
                            <div className={clsx(
                              "p-3 rounded-lg border",
                              netChange > 0 ? "bg-emerald-50 border-emerald-100" : netChange < 0 ? "bg-amber-50 border-amber-100" : "bg-gray-50 border-gray-100"
                            )}>
                              <div className="flex items-center gap-2">
                                {netChange > 0 ? (
                                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                                ) : netChange < 0 ? (
                                  <TrendingDown className="h-4 w-4 text-amber-600" />
                                ) : (
                                  <ArrowRightLeft className="h-4 w-4 text-gray-500" />
                                )}
                                <div>
                                  <p className={clsx(
                                    "text-lg font-bold",
                                    netChange > 0 ? "text-emerald-700" : netChange < 0 ? "text-amber-700" : "text-gray-600"
                                  )}>
                                    {netChange > 0 ? '+' : ''}{netChange}
                                  </p>
                                  <p className={clsx(
                                    "text-[10px]",
                                    netChange > 0 ? "text-emerald-600" : netChange < 0 ? "text-amber-600" : "text-gray-500"
                                  )}>Net Change</p>
                                </div>
                              </div>
                            </div>
                            <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                              <div className="flex items-center gap-2">
                                <Users className="h-4 w-4 text-purple-600" />
                                <div>
                                  <p className="text-lg font-bold text-purple-700">{assetsAffected.size}</p>
                                  <p className="text-[10px] text-purple-600">Assets Affected</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                    </div>

                    {/* Table Header */}
                    <div className="flex-shrink-0 px-6 py-3 bg-gray-50 border-b border-gray-200">
                      <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <div className="col-span-2">Event</div>
                        <div className="col-span-2">Asset</div>
                        <div className="col-span-5">Details</div>
                        <div className="col-span-3 text-right">Date</div>
                      </div>
                    </div>

                    {/* Coverage Events - Scrollable */}
                    <div className="flex-1 overflow-y-auto divide-y divide-gray-200">
                      {(() => {
                        // First, deduplicate events by creating a unique key for each logical event
                        const uniqueEvents = new Map()

                        filteredCoverageEvents.forEach((event) => {
                          // Create a unique key based on asset, change type, and the actual data that changed
                          let key = ''
                          if (event.change_type === 'created') {
                            key = `${event.asset_id}-created-${event.new_analyst_name}-${event.new_start_date}`
                          } else if (event.change_type === 'analyst_changed') {
                            key = `${event.asset_id}-changed-${event.old_analyst_name}-${event.new_analyst_name}-${event.new_start_date}`
                          } else if (event.change_type === 'deleted') {
                            key = `${event.asset_id}-deleted-${event.old_analyst_name}-${event.old_end_date}`
                          } else if (event.change_type === 'dates_changed') {
                            // For dates_changed events that SET an end date (transition), use a unique key that won't collide
                            // We want to keep these separate so we can match them with created events
                            if (event.old_end_date === null && event.new_end_date !== null) {
                              // This is setting an end date - likely part of a transition
                              key = `${event.asset_id}-transition-end-${event.old_analyst_name}-${event.new_end_date}-${event.changed_at}`
                            } else {
                              // Regular date change
                              key = `${event.asset_id}-dates-${event.old_analyst_name}-${event.old_start_date}-${event.new_end_date}`
                            }
                          }

                          // Keep the most recent version of each unique event
                          if (!uniqueEvents.has(key) || event.changed_at > uniqueEvents.get(key).changed_at) {
                            uniqueEvents.set(key, event)
                          }
                        })

                        // Convert to array
                        const deduplicatedEvents = Array.from(uniqueEvents.values())

                        // Now detect transitions: when a "created" event is close in time to a "dates_changed" event
                        // that set an end_date for a different analyst on the same asset
                        const transitionMap = new Map()
                        const processedEvents = new Set()

                        deduplicatedEvents.forEach((createdEvent) => {
                          if (createdEvent.change_type === 'created' && !processedEvents.has(createdEvent.id)) {
                            // Look for a corresponding dates_changed event around the same time
                            const matchingEndEvent = deduplicatedEvents.find((endEvent) => {
                              if (endEvent.change_type === 'dates_changed' &&
                                  endEvent.asset_id === createdEvent.asset_id &&
                                  endEvent.old_analyst_name !== createdEvent.new_analyst_name &&
                                  endEvent.new_end_date && // Make sure an end date was set
                                  !processedEvents.has(endEvent.id)) {

                                // Check if they happened within a few seconds of each other
                                const timeDiff = Math.abs(
                                  new Date(createdEvent.changed_at).getTime() -
                                  new Date(endEvent.changed_at).getTime()
                                )
                                return timeDiff < 10000 // Within 10 seconds
                              }
                              return false
                            })

                            if (matchingEndEvent) {
                              // This is a transition! Create a synthetic analyst_changed event
                              transitionMap.set(createdEvent.id, {
                                ...createdEvent,
                                change_type: 'analyst_changed',
                                old_analyst_name: matchingEndEvent.old_analyst_name,
                                old_user_id: matchingEndEvent.old_user_id,
                                old_start_date: matchingEndEvent.old_start_date,
                                old_end_date: matchingEndEvent.new_end_date
                              })
                              processedEvents.add(createdEvent.id)
                              processedEvents.add(matchingEndEvent.id)
                            }
                          }
                        })

                        // Build final events list: use transitions where detected, otherwise use original events
                        const finalEvents = deduplicatedEvents
                          .filter(event => !processedEvents.has(event.id))
                          .concat(Array.from(transitionMap.values()))
                          .sort((a, b) => {
                            // Sort by effective date (when the coverage actually changed)
                            const dateA = a.change_type === 'deleted' ? a.old_end_date : a.new_start_date
                            const dateB = b.change_type === 'deleted' ? b.old_end_date : b.new_start_date

                            // First compare by date
                            const dateComparison = (dateB || '').localeCompare(dateA || '')

                            // If dates are the same, sort by timestamp (changed_at)
                            if (dateComparison === 0) {
                              return (b.changed_at || '').localeCompare(a.changed_at || '')
                            }

                            return dateComparison
                          })

                        // Apply search filter if there's a query
                        const filteredEvents = searchQuery
                          ? finalEvents.filter(event => {
                              const query = searchQuery.toLowerCase()
                              return (
                                event.assets?.symbol?.toLowerCase().includes(query) ||
                                event.assets?.company_name?.toLowerCase().includes(query) ||
                                event.new_analyst_name?.toLowerCase().includes(query) ||
                                event.old_analyst_name?.toLowerCase().includes(query)
                              )
                            })
                          : finalEvents

                        // Apply period filter
                        const now2 = new Date()
                        let periodStart2: Date | null = null
                        let periodEnd2: Date = now2
                        switch (comparisonPeriod) {
                          case '7d':
                            periodStart2 = new Date(now2.getTime() - 7 * 24 * 60 * 60 * 1000)
                            break
                          case '30d':
                            periodStart2 = new Date(now2.getTime() - 30 * 24 * 60 * 60 * 1000)
                            break
                          case '90d':
                            periodStart2 = new Date(now2.getTime() - 90 * 24 * 60 * 60 * 1000)
                            break
                          case 'ytd':
                            periodStart2 = new Date(now2.getFullYear(), 0, 1)
                            break
                          case 'all':
                            periodStart2 = null
                            break
                          case 'custom':
                            periodStart2 = new Date(customDateRange.start)
                            periodEnd2 = new Date(customDateRange.end + 'T23:59:59')
                            break
                        }

                        const periodFilteredEvents = filteredEvents.filter(e => {
                          const eventDate = new Date(e.changed_at)
                          if (periodStart2 && eventDate < periodStart2) return false
                          if (comparisonPeriod === 'custom' && eventDate > periodEnd2) return false
                          return true
                        })

                        const totalEventsCount = periodFilteredEvents.length
                        const visibleEvents = periodFilteredEvents.slice(0, visibleHistoryCount)

                        const formatDate = (dateStr: string | null) => {
                          if (!dateStr) return 'N/A'
                          const [year, month, day] = dateStr.split('T')[0].split('-')
                          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        }

                        return (
                          <>
                            {visibleEvents.map((event) => {
                              let eventType = ''
                              let details = ''
                              let badgeColor = 'bg-gray-100 text-gray-700'
                              let eventDate = ''
                              let dateToDisplay: string | null = null

                              if (event.change_type === 'created') {
                                eventType = 'Coverage Started'
                                details = `${event.new_analyst_name} started covering`
                                dateToDisplay = event.new_start_date
                                eventDate = formatDate(event.new_start_date)
                                badgeColor = 'bg-green-100 text-green-700'
                              } else if (event.change_type === 'analyst_changed') {
                                eventType = 'Analyst Changed'
                                details = `${event.old_analyst_name} → ${event.new_analyst_name}`
                                dateToDisplay = event.new_start_date
                                eventDate = formatDate(event.new_start_date)
                                badgeColor = 'bg-blue-100 text-blue-700'
                              } else if (event.change_type === 'deleted') {
                                eventType = 'Coverage Ended'
                                details = `${event.old_analyst_name} stopped covering`
                                dateToDisplay = event.old_end_date
                                eventDate = formatDate(event.old_end_date)
                                badgeColor = 'bg-red-100 text-red-700'
                              } else if (event.change_type === 'dates_changed') {
                                const startDateChanged = event.old_start_date !== event.new_start_date
                                const endDateChanged = event.old_end_date !== event.new_end_date
                                if (!startDateChanged && !endDateChanged) return null
                                if (!startDateChanged && endDateChanged && event.old_end_date === null && event.new_end_date !== null) return null
                                if (event.old_is_active === false && event.new_is_active === false) return null
                                eventType = 'Dates Updated'
                                if (startDateChanged && endDateChanged) {
                                  details = `${event.old_analyst_name}'s coverage dates changed`
                                } else if (startDateChanged) {
                                  details = `${event.old_analyst_name}'s start date changed`
                                } else if (endDateChanged) {
                                  details = `${event.old_analyst_name}'s end date changed`
                                }
                                dateToDisplay = event.new_start_date || event.old_start_date
                                eventDate = formatDate(dateToDisplay)
                                badgeColor = 'bg-gray-100 text-gray-700'
                              } else if (event.change_type === 'coverage_added') {
                                eventType = 'Coverage Added'
                                details = `${event.new_analyst_name} added as additional analyst`
                                dateToDisplay = event.new_start_date
                                eventDate = formatDate(event.new_start_date)
                                badgeColor = 'bg-purple-100 text-purple-700'
                              } else if (event.change_type === 'historical_added') {
                                eventType = 'Historical Added'
                                details = `${event.new_analyst_name} (${formatDate(event.new_start_date)} — ${formatDate(event.new_end_date)})`
                                dateToDisplay = event.new_start_date
                                eventDate = formatDate(event.new_start_date)
                                badgeColor = 'bg-gray-100 text-gray-700'
                              }

                              if (!dateToDisplay) return null

                              return (
                                <div
                                  key={event.id}
                                  className="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                                  onClick={() => setSelectedHistoryEvent(event)}
                                >
                                  <div className="grid grid-cols-12 gap-4 items-center">
                                    <div className="col-span-2">
                                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${badgeColor} whitespace-nowrap`}>
                                        {eventType}
                                      </span>
                                    </div>
                                    <div className="col-span-2">
                                      <div>
                                        <p className="text-sm font-semibold text-gray-900">
                                          {event.assets?.symbol || 'Unknown'}
                                        </p>
                                        <p className="text-xs text-gray-500 truncate" title={event.assets?.company_name}>
                                          {event.assets?.company_name || '—'}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="col-span-5">
                                      <p className="text-sm text-gray-900 font-medium">{details}</p>
                                    </div>
                                    <div className="col-span-3 text-right">
                                      <p className="text-sm font-medium text-gray-900">{eventDate}</p>
                                    </div>
                                  </div>
                                </div>
                              )
                            }).filter(Boolean)}

                            {/* Load More Button */}
                            {visibleHistoryCount < totalEventsCount && (
                              <div className="px-6 py-4 text-center border-t border-gray-100">
                                <button
                                  onClick={() => setVisibleHistoryCount(prev => prev + 50)}
                                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                                >
                                  Load more ({totalEventsCount - visibleHistoryCount} remaining)
                                </button>
                              </div>
                            )}

                            {/* No results message */}
                            {totalEventsCount === 0 && (
                              <div className="px-6 py-12 text-center">
                                <p className="text-gray-500">
                                  {searchQuery ? `No history found for "${searchQuery}"` : 'No coverage changes in this period'}
                                </p>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  </>
                )}
              </Card>
            )}

            {/* Requests View */}
            {activeView === 'requests' && (
              <Card padding="none" className={`min-h-[500px] relative ${!filteredCoverageRequests || filteredCoverageRequests.length === 0 ? 'flex items-center justify-center' : ''}`}>
                {/* Loading overlay with blur */}
                {(requestsFetching) && (
                  <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  </div>
                )}
                {!filteredCoverageRequests || filteredCoverageRequests.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Shield className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      {hasAnyCoverageAdminRights ? 'No coverage requests' : 'No requests from you'}
                    </h3>
                    <p className="text-gray-500 max-w-md mx-auto">
                      {hasAnyCoverageAdminRights
                        ? 'There are no pending or historical coverage change requests to review.'
                        : 'You haven\'t submitted any coverage change requests. Use the "Request Change" button in the Active tab to request coverage modifications.'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200 w-full">
                    {/* Table Header */}
                    <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                      <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <div className="col-span-2">Asset</div>
                        <div className="col-span-1">Type</div>
                        <div className="col-span-2">Current Analyst</div>
                        <div className="col-span-2">Requested Analyst</div>
                        <div className="col-span-2">Requested By</div>
                        <div className="col-span-1">Status</div>
                        <div className="col-span-2">Actions</div>
                      </div>
                    </div>

                    {/* Request Rows */}
                    {filteredCoverageRequests.filter((request) => {
                      if (!searchQuery) return true
                      const query = searchQuery.toLowerCase()
                      return (
                        request.assets?.symbol?.toLowerCase().includes(query) ||
                        request.assets?.company_name?.toLowerCase().includes(query) ||
                        request.current_analyst_name?.toLowerCase().includes(query) ||
                        request.requested_analyst_name?.toLowerCase().includes(query) ||
                        request.requester_name?.toLowerCase().includes(query)
                      )
                    }).map((request) => (
                      <div key={request.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                        <div className="grid grid-cols-12 gap-4 items-center">
                          {/* Asset Info */}
                          <div className="col-span-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">
                                {request.assets?.symbol || 'Unknown'}
                              </p>
                              <p className="text-xs text-gray-600 truncate">
                                {request.assets?.company_name || ''}
                              </p>
                            </div>
                          </div>

                          {/* Request Type */}
                          <div className="col-span-1">
                            <Badge
                              variant={
                                request.request_type === 'add' ? 'blue' :
                                request.request_type === 'change' ? 'purple' :
                                'slate'
                              }
                              size="sm"
                            >
                              {request.request_type.charAt(0).toUpperCase() + request.request_type.slice(1)}
                            </Badge>
                          </div>

                          {/* Current Analyst */}
                          <div className="col-span-2">
                            <span className="text-sm text-gray-600">
                              {request.current_analyst_name || '—'}
                            </span>
                          </div>

                          {/* Requested Analyst */}
                          <div className="col-span-2">
                            <span className="text-sm text-gray-900 font-medium">
                              {request.requested_analyst_name}
                            </span>
                          </div>

                          {/* Requested By */}
                          <div className="col-span-2">
                            <div className="min-w-0">
                              <p className="text-sm text-gray-900 truncate">
                                {request.requested_by_user?.first_name && request.requested_by_user?.last_name
                                  ? `${request.requested_by_user.first_name} ${request.requested_by_user.last_name}`
                                  : request.requested_by_user?.email?.split('@')[0] || 'Unknown'}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
                              </p>
                            </div>
                          </div>

                          {/* Status */}
                          <div className="col-span-1">
                            <Badge
                              variant={
                                request.status === 'pending' ? 'orange' :
                                request.status === 'approved' ? 'green' :
                                request.status === 'rescinded' ? 'slate' :
                                'error'
                              }
                              size="sm"
                            >
                              {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                            </Badge>
                          </div>

                          {/* Actions */}
                          <div className="col-span-2">
                            {request.status === 'pending' ? (
                              hasAnyCoverageAdminRights ? (
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => approveCoverageRequestMutation.mutate(request.id)}
                                    disabled={approveCoverageRequestMutation.isPending}
                                    className="!text-green-600 !border-green-300 hover:!bg-green-50"
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => denyCoverageRequestMutation.mutate(request.id)}
                                    disabled={denyCoverageRequestMutation.isPending}
                                    className="!text-red-600 !border-red-300 hover:!bg-red-50"
                                  >
                                    Deny
                                  </Button>
                                </div>
                              ) : request.requested_by === user?.id ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRescindingRequest({
                                    requestId: request.id,
                                    assetSymbol: request.assets?.symbol || 'Unknown'
                                  })}
                                  disabled={rescindCoverageRequestMutation.isPending}
                                  className="!text-orange-600 !border-orange-300 hover:!bg-orange-50"
                                >
                                  Cancel
                                </Button>
                              ) : (
                                <span className="text-xs text-gray-500">Pending</span>
                              )
                            ) : request.status === 'rescinded' && request.requested_by === user?.id ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => resubmitCoverageRequestMutation.mutate(request.id)}
                                disabled={resubmitCoverageRequestMutation.isPending}
                                className="!text-blue-600 !border-blue-300 hover:!bg-blue-50"
                              >
                                Resubmit
                              </Button>
                            ) : (
                              <div className="text-xs text-gray-500">
                                <div>
                                  {request.status === 'approved' ? 'Approved' :
                                   request.status === 'denied' ? 'Denied' :
                                   request.status === 'rescinded' ? 'Cancelled' : '—'}
                                </div>
                                {(request.status === 'approved' || request.status === 'denied') && request.reviewed_by_user && (
                                  <div className="text-[10px] text-gray-400 mt-0.5">
                                    by {request.reviewed_by_user.first_name} {request.reviewed_by_user.last_name}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Reason */}
                        {request.reason && (
                          <div className="mt-2 pl-0">
                            <p className="text-xs text-gray-500">
                              <span className="font-medium">Reason:</span> {request.reason}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                    {/* No results message when search filters out all requests */}
                    {searchQuery && !filteredCoverageRequests.some((request) => {
                      const query = searchQuery.toLowerCase()
                      return (
                        request.assets?.symbol?.toLowerCase().includes(query) ||
                        request.assets?.company_name?.toLowerCase().includes(query) ||
                        request.current_analyst_name?.toLowerCase().includes(query) ||
                        request.requested_analyst_name?.toLowerCase().includes(query) ||
                        request.requester_name?.toLowerCase().includes(query)
                      )
                    }) && (
                      <div className="px-6 py-12 text-center">
                        <p className="text-gray-500">No requests found for "{searchQuery}"</p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )}
              </div>
            </div>
            )}
          </div>

          {/* Footer - only shown for main view in modal mode */}
          {mode !== 'page' && !viewHistoryAssetId && (
            <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          )}

      {/* Add Historical Period Modal */}
      {addingHistoricalPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setAddingHistoricalPeriod(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Add Historical Coverage</h3>
              <button
                onClick={() => setAddingHistoricalPeriod(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Add a historical coverage period that occurred in the past.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Analyst
                </label>
                <select
                  value={addingHistoricalPeriod.analystId}
                  onChange={(e) => setAddingHistoricalPeriod({
                    ...addingHistoricalPeriod,
                    analystId: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select analyst...</option>
                  {users?.map((u) => {
                    const displayName = u.first_name && u.last_name
                      ? `${u.first_name} ${u.last_name}`
                      : u.email?.split('@')[0] || 'Unknown'
                    return (
                      <option key={u.id} value={u.id}>
                        {displayName}
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={addingHistoricalPeriod.startDate}
                  max={addingHistoricalPeriod.endDate || getLocalDateString()}
                  onChange={(e) => setAddingHistoricalPeriod({
                    ...addingHistoricalPeriod,
                    startDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={addingHistoricalPeriod.endDate}
                  min={addingHistoricalPeriod.startDate}
                  max={getLocalDateString()}
                  onChange={(e) => setAddingHistoricalPeriod({
                    ...addingHistoricalPeriod,
                    endDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Historical periods must end in the past or today
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setAddingHistoricalPeriod(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const { startDate, endDate, analystId, assetId } = addingHistoricalPeriod

                  if (!startDate || !endDate || !analystId) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Missing Information',
                      message: 'Please fill in all required fields.'
                    })
                    return
                  }

                  const today = getLocalDateString()
                  if (endDate > today) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Invalid Date Range',
                      message: 'Historical periods cannot extend into the future. Use "Coverage Transition" to schedule future changes.'
                    })
                    return
                  }

                  if (startDate > endDate) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Invalid Date Range',
                      message: 'Start date must be before end date.'
                    })
                    return
                  }

                  const selectedUser = users?.find(u => u.id === analystId)
                  if (!selectedUser) return

                  const analystName = selectedUser.first_name && selectedUser.last_name
                    ? `${selectedUser.first_name} ${selectedUser.last_name}`
                    : selectedUser.email?.split('@')[0] || 'Unknown'

                  // Create new historical coverage
                  const newCoverageId = `temp-${Date.now()}`
                  const newCoverage = {
                    id: newCoverageId,
                    asset_id: assetId,
                    user_id: analystId,
                    analyst_name: analystName,
                    start_date: startDate,
                    end_date: endDate,
                    is_active: false,
                    changed_by: user?.id
                  }

                  setPendingNewCoverages(prev => [...prev, newCoverage])
                  setAddingHistoricalPeriod(null)
                }}
                disabled={!addingHistoricalPeriod.analystId || !addingHistoricalPeriod.startDate || !addingHistoricalPeriod.endDate}
              >
                Add Historical Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Change Current Coverage Modal */}
      {changingCurrentCoverage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setChangingCurrentCoverage(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Change Current Coverage</h3>
              <button
                onClick={() => setChangingCurrentCoverage(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              This will immediately replace <span className="font-medium">{changingCurrentCoverage.currentAnalystName}</span> with a new analyst for active coverage.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Analyst
              </label>
              <select
                value={changingCurrentCoverage.newAnalystId}
                onChange={(e) => setChangingCurrentCoverage({
                  ...changingCurrentCoverage,
                  newAnalystId: e.target.value
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select analyst...</option>
                {users?.map((u) => {
                  const displayName = u.first_name && u.last_name
                    ? `${u.first_name} ${u.last_name}`
                    : u.email?.split('@')[0] || 'Unknown'
                  return (
                    <option key={u.id} value={u.id}>
                      {displayName}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setChangingCurrentCoverage(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const selectedUser = users?.find(u => u.id === changingCurrentCoverage.newAnalystId)
                  if (!selectedUser) return

                  const newAnalystName = selectedUser.first_name && selectedUser.last_name
                    ? `${selectedUser.first_name} ${selectedUser.last_name}`
                    : selectedUser.email?.split('@')[0] || 'Unknown'

                  const today = getLocalDateString()

                  // Check if the current coverage started today
                  const currentCoverage = assetCoverageHistory?.find(c => c.id === changingCurrentCoverage.currentCoverageId)
                  const coverageStartedToday = currentCoverage?.start_date === today

                  if (coverageStartedToday) {
                    // Just update the analyst for the existing coverage
                    setPendingTimelineChanges(prev => ({
                      ...prev,
                      [changingCurrentCoverage.currentCoverageId]: {
                        ...prev[changingCurrentCoverage.currentCoverageId],
                        analyst: {
                          userId: changingCurrentCoverage.newAnalystId,
                          analystName: newAnalystName
                        }
                      }
                    }))
                  } else {
                    // End the current coverage and create a new one
                    setPendingTimelineChanges(prev => ({
                      ...prev,
                      [changingCurrentCoverage.currentCoverageId]: {
                        ...prev[changingCurrentCoverage.currentCoverageId],
                        endDate: today,
                        isActive: false
                      }
                    }))

                    // Stage creating new coverage starting today
                    const newCoverageId = `temp-${Date.now()}`
                    const newCoverage = {
                      id: newCoverageId,
                      asset_id: changingCurrentCoverage.assetId,
                      user_id: changingCurrentCoverage.newAnalystId,
                      analyst_name: newAnalystName,
                      start_date: today,
                      end_date: null,
                      is_active: true,
                      changed_by: user?.id,
                      fromCoverageId: changingCurrentCoverage.currentCoverageId
                    }

                    setPendingNewCoverages(prev => [...prev, newCoverage])
                  }

                  setChangingCurrentCoverage(null)
                }}
                disabled={!changingCurrentCoverage.newAnalystId}
              >
                Change Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Coverage Modal */}
      {addingCoverage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setAddingCoverage(null)} />
          <div className="relative bg-white rounded-lg max-w-lg w-full max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Add Coverage</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Add a new coverage record for an asset
                </p>
              </div>
              <button
                onClick={() => setAddingCoverage(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="relative asset-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Asset *
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={assetSearchQuery}
                    onChange={(e) => {
                      setAssetSearchQuery(e.target.value)
                      setShowAssetDropdown(true)
                    }}
                    onFocus={() => setShowAssetDropdown(true)}
                    placeholder="Search for an asset..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                {showAssetDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto asset-dropdown">
                    {assets
                      ?.filter((asset) => {
                        const query = assetSearchQuery.toLowerCase()
                        return (
                          asset.symbol.toLowerCase().includes(query) ||
                          asset.company_name.toLowerCase().includes(query)
                        )
                      })
                      .map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => {
                            setAddingCoverage({
                              ...addingCoverage,
                              assetId: asset.id
                            })
                            setAssetSearchQuery(`${asset.symbol} - ${asset.company_name}`)
                            setShowAssetDropdown(false)
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                        >
                          <div className="font-medium text-gray-900">{asset.symbol}</div>
                          <div className="text-sm text-gray-600">{asset.company_name}</div>
                        </button>
                      ))}
                    {assets?.filter((asset) => {
                      const query = assetSearchQuery.toLowerCase()
                      return (
                        asset.symbol.toLowerCase().includes(query) ||
                        asset.company_name.toLowerCase().includes(query)
                      )
                    }).length === 0 && (
                      <div className="px-4 py-2 text-sm text-gray-500">No assets found</div>
                    )}
                  </div>
                )}
              </div>

              <div className="relative analyst-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Analyst *
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={analystSearchQuery}
                    onChange={(e) => {
                      setAnalystSearchQuery(e.target.value)
                      setShowAnalystDropdown(true)
                    }}
                    onFocus={() => setShowAnalystDropdown(true)}
                    placeholder="Search for an analyst..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                {showAnalystDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto analyst-dropdown">
                    {users
                      ?.filter((user) => {
                        const query = analystSearchQuery.toLowerCase()
                        const displayName = user.first_name && user.last_name
                          ? `${user.first_name} ${user.last_name}`
                          : user.email?.split('@')[0] || 'Unknown'
                        const email = user.email || ''
                        return (
                          displayName.toLowerCase().includes(query) ||
                          email.toLowerCase().includes(query)
                        )
                      })
                      .map((user) => {
                        const displayName = user.first_name && user.last_name
                          ? `${user.first_name} ${user.last_name}`
                          : user.email?.split('@')[0] || 'Unknown'
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => {
                              setAddingCoverage({
                                ...addingCoverage,
                                analystId: user.id
                              })
                              setAnalystSearchQuery(displayName)
                              setShowAnalystDropdown(false)
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                          >
                            <div className="font-medium text-gray-900">{displayName}</div>
                            {user.email && (
                              <div className="text-sm text-gray-600">{user.email}</div>
                            )}
                          </button>
                        )
                      })}
                    {users?.filter((user) => {
                      const query = analystSearchQuery.toLowerCase()
                      const displayName = user.first_name && user.last_name
                        ? `${user.first_name} ${user.last_name}`
                        : user.email?.split('@')[0] || 'Unknown'
                      const email = user.email || ''
                      return (
                        displayName.toLowerCase().includes(query) ||
                        email.toLowerCase().includes(query)
                      )
                    }).length === 0 && (
                      <div className="px-4 py-2 text-sm text-gray-500">No analysts found</div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={addingCoverage.startDate}
                  onChange={(e) => setAddingCoverage({
                    ...addingCoverage,
                    startDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Date (Optional)
                </label>
                <input
                  type="date"
                  value={addingCoverage.endDate}
                  min={addingCoverage.startDate}
                  onChange={(e) => setAddingCoverage({
                    ...addingCoverage,
                    endDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave empty for ongoing coverage
                </p>
              </div>


              {/* Lead Analyst Toggle - Only show when hierarchy is enabled */}
              {coverageSettings?.enable_hierarchy && (
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addingCoverage.isLead}
                      onChange={(e) => setAddingCoverage({
                        ...addingCoverage,
                        isLead: e.target.checked
                      })}
                      className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">Lead Analyst</span>
                      <p className="text-xs text-gray-500">Mark as the primary analyst for this coverage</p>
                    </div>
                  </label>
                </div>
              )}


              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes (Optional)
                </label>
                <textarea
                  value={addingCoverage.notes}
                  onChange={(e) => setAddingCoverage({
                    ...addingCoverage,
                    notes: e.target.value
                  })}
                  placeholder="Add any notes about this coverage assignment..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 pt-4 border-t border-gray-200 flex-shrink-0">
              <Button
                variant="outline"
                onClick={() => setAddingCoverage(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  if (!addingCoverage.assetId || !addingCoverage.analystId || !addingCoverage.startDate) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Missing Required Fields',
                      message: 'Please select an asset, analyst, and start date.'
                    })
                    return
                  }

                  try {
                    // Get analyst name
                    const selectedUser = users?.find(u => u.id === addingCoverage.analystId)
                    const analystName = selectedUser
                      ? (selectedUser.first_name && selectedUser.last_name
                        ? `${selectedUser.first_name} ${selectedUser.last_name}`
                        : selectedUser.email?.split('@')[0] || 'Unknown')
                      : 'Unknown'

                    // Check for any existing active coverage on this asset (by other analysts)
                    const existingActiveCoverage = coverageRecords?.filter(
                      c => c.asset_id === addingCoverage.assetId &&
                           c.is_active &&
                           c.user_id !== addingCoverage.analystId
                    ) || []

                    if (existingActiveCoverage.length > 0) {
                      // Get the asset symbol for display
                      const assetSymbol = existingActiveCoverage[0].assets?.symbol ||
                        assets?.find(a => a.id === addingCoverage.assetId)?.symbol ||
                        'this asset'

                      // Show confirmation dialog asking if user wants to transition or add additional
                      setExistingCoverageConfirm({
                        isOpen: true,
                        assetId: addingCoverage.assetId,
                        assetSymbol,
                        existingCoverage: existingActiveCoverage.map(c => ({
                          id: c.id,
                          user_id: c.user_id,
                          analyst_name: c.analyst_name
                        })),
                        newAnalystId: addingCoverage.analystId,
                        newAnalystName: analystName,
                        startDate: addingCoverage.startDate,
                        endDate: addingCoverage.endDate,
                        notes: addingCoverage.notes,
                        isLead: addingCoverage.isLead
                      })
                      return
                    }

                    // Check if adding as lead analyst and a lead already exists for this team/asset combo (when hierarchy is enabled)
                    if (coverageSettings?.enable_hierarchy && addingCoverage.isLead) {
                      const existingLead = coverageRecords?.find(
                        c => c.asset_id === addingCoverage.assetId &&
                             c.is_active &&
                             (c.is_lead || c.role === 'primary') &&
                             c.user_id !== addingCoverage.analystId &&
                             c.team_id === addingCoverage.teamId
                      )

                      if (existingLead) {
                        // Get the asset symbol for display
                        const assetSymbol = existingLead.assets?.symbol ||
                          assets?.find(a => a.id === addingCoverage.assetId)?.symbol ||
                          'this asset'

                        // Show confirmation dialog
                        setPrimaryExistsConfirm({
                          isOpen: true,
                          assetId: addingCoverage.assetId,
                          assetSymbol,
                          existingPrimaryUserId: existingLead.user_id,
                          existingPrimaryName: existingLead.analyst_name,
                          existingPrimaryCoverageId: existingLead.id,
                          newAnalystId: addingCoverage.analystId,
                          newAnalystName: analystName,
                          startDate: addingCoverage.startDate,
                          portfolioIds: addingCoverage.portfolioIds,
                          notes: addingCoverage.notes
                        })
                        return
                      }
                    }

                    // Insert coverage record - visibility is based on organization settings
                    const baseRecord = {
                      asset_id: addingCoverage.assetId,
                      user_id: addingCoverage.analystId,
                      analyst_name: analystName,
                      start_date: addingCoverage.startDate,
                      end_date: addingCoverage.endDate || null,
                      is_active: !addingCoverage.endDate || addingCoverage.endDate >= getLocalDateString(),
                      changed_by: user?.id,
                      role: coverageSettings?.enable_hierarchy ? (addingCoverage.role || null) : null,
                      notes: addingCoverage.notes || null,
                      team_id: userTeams?.[0]?.id || null,
                      visibility: coverageSettings?.default_visibility || 'team',
                      is_lead: coverageSettings?.enable_hierarchy ? addingCoverage.isLead : false
                    }

                    const { error } = await supabase
                      .from('coverage')
                      .insert(baseRecord)
                    if (error) throw error

                    // Refresh the coverage data
                    queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['asset-coverage-history'] })

                    setAddingCoverage(null)
                  } catch (error: any) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Error Adding Coverage',
                      message: error.message || 'Failed to add coverage record. Please try again.'
                    })
                  }
                }}
                disabled={!addingCoverage.assetId || !addingCoverage.analystId || !addingCoverage.startDate}
              >
                Add Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* End Coverage Modal */}
      {endingCoverage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setEndingCoverage(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">End Coverage</h3>
              <button
                onClick={() => setEndingCoverage(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              End coverage for <span className="font-medium">{endingCoverage.assetSymbol}</span> by <span className="font-medium">{endingCoverage.analystName}</span> on the selected date.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={endingCoverage.endDate}
                  min={getLocalDateString()}
                  onChange={(e) => setEndingCoverage({
                    ...endingCoverage,
                    endDate: e.target.value
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Coverage will end on this date
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setEndingCoverage(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  // Find all future coverage periods for this asset
                  const futureCoverages = assetCoverageHistory.filter(c =>
                    c.start_date > endingCoverage.endDate
                  )

                  // Calculate the day before the end date
                  const endDateObj = new Date(endingCoverage.endDate)
                  const dayBefore = new Date(endDateObj)
                  dayBefore.setDate(dayBefore.getDate() - 1)
                  const dayBeforeStr = getLocalDateString(dayBefore)

                  // Handle the current coverage end date and future coverages
                  setPendingTimelineChanges(prev => {
                    const newChanges = {
                      ...prev,
                      [endingCoverage.coverageId]: {
                        ...prev[endingCoverage.coverageId],
                        endDate: endingCoverage.endDate
                      }
                    }

                    // Handle each future coverage based on the end date
                    futureCoverages.forEach(futureCov => {
                      // If the future coverage starts on or before the day before end date,
                      // set its end date to the day before
                      if (futureCov.start_date <= dayBeforeStr) {
                        newChanges[futureCov.id] = {
                          ...newChanges[futureCov.id],
                          endDate: dayBeforeStr
                        }
                      }
                    })

                    return newChanges
                  })

                  // Delete future coverages that start after the end date
                  const coveragesToDelete = futureCoverages
                    .filter(futureCov => futureCov.start_date > dayBeforeStr)
                    .map(c => c.id)

                  if (coveragesToDelete.length > 0) {
                    setPendingTimelineDeletes(prevDeletes => {
                      const newDeletes = new Set(prevDeletes)
                      coveragesToDelete.forEach(id => newDeletes.add(id))
                      return newDeletes
                    })
                  }

                  setEndingCoverage(null)
                }}
                disabled={!endingCoverage.endDate}
              >
                End Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {errorModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setErrorModal({ isOpen: false, title: '', message: '' })} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{errorModal.title}</h3>
            <p className="text-gray-600 mb-4">{errorModal.message}</p>
            <Button onClick={() => setErrorModal({ isOpen: false, title: '', message: '' })}>OK</Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, coverageId: null, assetSymbol: '', analystName: '' })}
        onConfirm={confirmDeleteCoverage}
        title="Remove Coverage Assignment"
        message={`Are you sure you want to remove ${deleteConfirm.analystName}'s coverage of ${deleteConfirm.assetSymbol}?`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
        isLoading={deleteCoverageMutation.isPending}
      />

      {/* Rescind Request Confirmation */}
      <ConfirmDialog
        isOpen={!!rescindingRequest}
        onClose={() => setRescindingRequest(null)}
        onConfirm={() => {
          if (rescindingRequest) {
            rescindCoverageRequestMutation.mutate(rescindingRequest.requestId)
            setRescindingRequest(null)
          }
        }}
        title="Cancel Coverage Request"
        message={`Are you sure you want to cancel your coverage change request for ${rescindingRequest?.assetSymbol}?`}
        confirmText="Yes, Cancel Request"
        cancelText="No, Keep Request"
        variant="warning"
        isLoading={rescindCoverageRequestMutation.isPending}
      />

      {/* Request Coverage Change Modal */}
      {requestingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setRequestingChange(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {requestingChange.requestType === 'add' ? 'Request New Coverage' :
                 requestingChange.requestType === 'role_change' ? 'Request Role Change' :
                 'Request Coverage Change'}
              </h3>
              <button
                onClick={() => setRequestingChange(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Request Type Selector */}
            {requestingChange.currentAnalystName && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Request Type
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRequestingChange({
                      ...requestingChange,
                      requestType: 'change'
                    })}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      requestingChange.requestType === 'change'
                        ? 'bg-primary-50 border-primary-300 text-primary-700'
                        : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    Change Analyst
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestingChange({
                      ...requestingChange,
                      requestType: 'role_change',
                      requestedUserId: requestingChange.currentUserId || ''
                    })}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      requestingChange.requestType === 'role_change'
                        ? 'bg-primary-50 border-primary-300 text-primary-700'
                        : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    Change Role
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {/* Asset Selection - Only show if no asset is pre-selected */}
              {!requestingChange.assetSymbol && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Asset
                  </label>
                  <select
                    value={requestingChange.assetId}
                    onChange={(e) => {
                      const selectedAsset = assets?.find(a => a.id === e.target.value)
                      setRequestingChange({
                        ...requestingChange,
                        assetId: e.target.value,
                        assetSymbol: selectedAsset?.symbol || ''
                      })
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select asset...</option>
                    {assets?.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.symbol} - {asset.company_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Show selected asset if pre-selected */}
              {requestingChange.assetSymbol && (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm text-gray-500">Asset:</span>
                  <span className="ml-2 text-sm font-medium text-gray-900">{requestingChange.assetSymbol}</span>
                </div>
              )}

              {/* Current Coverage Info - Only show if there's current coverage */}
              {requestingChange.currentAnalystName && (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-sm text-gray-500">Current Analyst:</span>
                      <span className="ml-2 text-sm font-medium text-gray-900">{requestingChange.currentAnalystName}</span>
                    </div>
                    {requestingChange.currentRole && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-700 rounded capitalize">
                        {requestingChange.currentRole}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Analyst Selection - Show for 'add' and 'change' types */}
              {(requestingChange.requestType === 'add' || requestingChange.requestType === 'change') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {requestingChange.requestType === 'add' ? 'Assign Analyst' : 'New Analyst'}
                  </label>
                  <select
                    value={requestingChange.requestedUserId}
                    onChange={(e) => setRequestingChange({
                      ...requestingChange,
                      requestedUserId: e.target.value
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select analyst...</option>
                    {users?.map((u) => {
                      const displayName = u.first_name && u.last_name
                        ? `${u.first_name} ${u.last_name}`
                        : u.email?.split('@')[0] || 'Unknown'
                      return (
                        <option key={u.id} value={u.id}>
                          {displayName}
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}

              {/* Role Selection - Only show when hierarchy is enabled in coverage settings */}
              {coverageSettings?.enable_hierarchy && (requestingChange.requestType === 'add' || requestingChange.requestType === 'role_change') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {requestingChange.requestType === 'role_change' ? 'New Role' : 'Role'}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(coverageSettings.hierarchy_levels || [{ name: 'Lead Analyst', exclusive: true }, { name: 'Analyst', exclusive: false }]).map((level: { name: string; exclusive: boolean } | string) => {
                      // Handle both old string format and new object format
                      const roleName = typeof level === 'string' ? level : level.name
                      return (
                        <button
                          key={roleName}
                          type="button"
                          onClick={() => setRequestingChange({
                            ...requestingChange,
                            requestedRole: roleName.toLowerCase()
                          })}
                          className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                            requestingChange.requestedRole === roleName.toLowerCase()
                              ? 'bg-primary-50 border-primary-300 text-primary-700'
                              : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {roleName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for Request
                </label>
                <textarea
                  value={requestingChange.reason}
                  onChange={(e) => setRequestingChange({
                    ...requestingChange,
                    reason: e.target.value
                  })}
                  placeholder={
                    requestingChange.requestType === 'add'
                      ? "Explain why this coverage is needed..."
                      : requestingChange.requestType === 'role_change'
                      ? "Explain why the role change is needed..."
                      : "Explain why this change is needed..."
                  }
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setRequestingChange(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  // Validation
                  if (!requestingChange.assetId) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Missing Information',
                      message: 'Please select an asset.'
                    })
                    return
                  }

                  if ((requestingChange.requestType === 'add' || requestingChange.requestType === 'change') && !requestingChange.requestedUserId) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Missing Information',
                      message: 'Please select an analyst.'
                    })
                    return
                  }

                  if (!requestingChange.reason) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Missing Information',
                      message: 'Please provide a reason for the request.'
                    })
                    return
                  }

                  // Get analyst name
                  let requestedAnalystName = requestingChange.currentAnalystName || 'Unknown'
                  if (requestingChange.requestType !== 'role_change') {
                    const selectedUser = users?.find(u => u.id === requestingChange.requestedUserId)
                    if (selectedUser) {
                      requestedAnalystName = selectedUser.first_name && selectedUser.last_name
                        ? `${selectedUser.first_name} ${selectedUser.last_name}`
                        : selectedUser.email?.split('@')[0] || 'Unknown'
                    }
                  }

                  // Build reason with role info for role changes
                  let fullReason = requestingChange.reason
                  if (requestingChange.requestType === 'role_change') {
                    fullReason = `Role change from "${requestingChange.currentRole || 'none'}" to "${requestingChange.requestedRole}". ${requestingChange.reason}`
                  } else if (requestingChange.requestType === 'add') {
                    fullReason = `New coverage as ${requestingChange.requestedRole}. ${requestingChange.reason}`
                  }

                  createCoverageRequestMutation.mutate({
                    asset_id: requestingChange.assetId,
                    current_user_id: requestingChange.currentUserId,
                    current_analyst_name: requestingChange.currentAnalystName,
                    requested_user_id: requestingChange.requestType === 'role_change'
                      ? requestingChange.currentUserId
                      : requestingChange.requestedUserId,
                    requested_analyst_name: requestedAnalystName,
                    request_type: requestingChange.requestType,
                    reason: fullReason
                  })

                  setRequestingChange(null)
                }}
                disabled={
                  !requestingChange.assetId ||
                  !requestingChange.reason ||
                  ((requestingChange.requestType === 'add' || requestingChange.requestType === 'change') && !requestingChange.requestedUserId)
                }
              >
                Submit Request
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* History Event Detail Modal */}
      {selectedHistoryEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setSelectedHistoryEvent(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Coverage Change Details</h3>
              <button
                onClick={() => setSelectedHistoryEvent(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Event Type */}
              <div>
                <label className="text-sm font-medium text-gray-500">Event Type</label>
                <p className="text-base text-gray-900 mt-1 capitalize">{selectedHistoryEvent.change_type.replace('_', ' ')}</p>
              </div>

              {/* Asset */}
              <div>
                <label className="text-sm font-medium text-gray-500">Asset</label>
                <p className="text-base text-gray-900 mt-1">
                  {selectedHistoryEvent.assets?.symbol} - {selectedHistoryEvent.assets?.company_name}
                </p>
              </div>

              {/* Changed At */}
              <div>
                <label className="text-sm font-medium text-gray-500">Changed At</label>
                <p className="text-base text-gray-900 mt-1">
                  {new Date(selectedHistoryEvent.changed_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}
                </p>
              </div>

              {/* Changed By */}
              {selectedHistoryEvent.changed_by && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Changed By</label>
                  <p className="text-base text-gray-900 mt-1">
                    {users?.find(u => u.id === selectedHistoryEvent.changed_by)?.first_name} {users?.find(u => u.id === selectedHistoryEvent.changed_by)?.last_name || 'Unknown User'}
                  </p>
                </div>
              )}

              {/* Old Values */}
              {(selectedHistoryEvent.old_analyst_name || selectedHistoryEvent.old_start_date || selectedHistoryEvent.old_end_date !== undefined) && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Previous State</h4>
                  <div className="space-y-2 bg-red-50 p-3 rounded">
                    {selectedHistoryEvent.old_analyst_name && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Analyst</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.old_analyst_name}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.old_start_date && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Start Date</label>
                        <p className="text-sm text-gray-900">{new Date(selectedHistoryEvent.old_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.old_end_date !== undefined && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">End Date</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.old_end_date ? new Date(selectedHistoryEvent.old_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'None (Open-ended)'}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.old_is_active !== undefined && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Status</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.old_is_active ? 'Active' : 'Inactive'}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* New Values */}
              {(selectedHistoryEvent.new_analyst_name || selectedHistoryEvent.new_start_date || selectedHistoryEvent.new_end_date !== undefined) && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">New State</h4>
                  <div className="space-y-2 bg-green-50 p-3 rounded">
                    {selectedHistoryEvent.new_analyst_name && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Analyst</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.new_analyst_name}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.new_start_date && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Start Date</label>
                        <p className="text-sm text-gray-900">{new Date(selectedHistoryEvent.new_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.new_end_date !== undefined && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">End Date</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.new_end_date ? new Date(selectedHistoryEvent.new_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'None (Open-ended)'}</p>
                      </div>
                    )}
                    {selectedHistoryEvent.new_is_active !== undefined && (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Status</label>
                        <p className="text-sm text-gray-900">{selectedHistoryEvent.new_is_active ? 'Active' : 'Inactive'}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <Button
                variant="outline"
                onClick={() => setSelectedHistoryEvent(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Primary Already Exists Confirmation Modal */}
      {primaryExistsConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setPrimaryExistsConfirm(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Primary Analyst Already Exists</h3>
              <button
                onClick={() => setPrimaryExistsConfirm(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-6">
              <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                <div className="text-sm text-amber-800">
                  <span className="font-medium">{primaryExistsConfirm.existingPrimaryName}</span> is currently the primary analyst for <span className="font-medium">{primaryExistsConfirm.assetSymbol}</span>.
                </div>
              </div>

              <p className="text-sm text-gray-600">
                Would you like to transition coverage from <span className="font-medium">{primaryExistsConfirm.existingPrimaryName}</span> to <span className="font-medium">{primaryExistsConfirm.newAnalystName}</span>?
              </p>
              <p className="text-xs text-gray-500 mt-2">
                This will end the current primary's coverage on {primaryExistsConfirm.startDate} and start {primaryExistsConfirm.newAnalystName}'s coverage as primary on the same date.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setPrimaryExistsConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    // Calculate the day before the new start date for ending the old coverage
                    const startDateObj = new Date(primaryExistsConfirm.startDate)
                    const dayBefore = new Date(startDateObj)
                    dayBefore.setDate(dayBefore.getDate() - 1)
                    const dayBeforeStr = getLocalDateString(dayBefore)

                    // End the existing primary coverage
                    const { error: endError } = await supabase
                      .from('coverage')
                      .update({
                        end_date: dayBeforeStr,
                        is_active: dayBeforeStr >= getLocalDateString() ? true : false,
                        changed_by: user?.id
                      })
                      .eq('id', primaryExistsConfirm.existingPrimaryCoverageId)

                    if (endError) throw endError

                    // Create the new primary coverage - visibility is based on organization settings
                    const baseRecord = {
                      asset_id: primaryExistsConfirm.assetId,
                      user_id: primaryExistsConfirm.newAnalystId,
                      analyst_name: primaryExistsConfirm.newAnalystName,
                      start_date: primaryExistsConfirm.startDate,
                      end_date: null,
                      is_active: true,
                      changed_by: user?.id,
                      role: 'primary',
                      notes: primaryExistsConfirm.notes || null,
                      team_id: userTeams?.[0]?.id || null,
                      visibility: coverageSettings?.default_visibility || 'team'
                    }

                    const { error } = await supabase
                      .from('coverage')
                      .insert(baseRecord)
                    if (error) throw error

                    // Refresh the coverage data
                    queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['asset-coverage-history'] })
                    queryClient.invalidateQueries({ queryKey: ['all-coverage-events'] })

                    setPrimaryExistsConfirm(null)
                    setAddingCoverage(null)
                  } catch (error: any) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Error Transitioning Coverage',
                      message: error.message || 'Failed to transition coverage. Please try again.'
                    })
                  }
                }}
              >
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                Transition Coverage
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Existing Coverage Confirmation Modal - Transition vs Add Additional */}
      {existingCoverageConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setExistingCoverageConfirm(null)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Existing Coverage Found</h3>
              <button
                onClick={() => setExistingCoverageConfirm(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-6">
              <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">{existingCoverageConfirm.assetSymbol} is currently covered by:</p>
                  <ul className="list-disc list-inside">
                    {existingCoverageConfirm.existingCoverage.map((c) => (
                      <li key={c.id}>{c.analyst_name}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-2">
                How would you like to add <span className="font-medium">{existingCoverageConfirm.newAnalystName}</span> to cover <span className="font-medium">{existingCoverageConfirm.assetSymbol}</span>?
              </p>
            </div>

            <div className="space-y-3">
              {/* Transition Coverage Option */}
              <button
                onClick={async () => {
                  try {
                    // Calculate the day before the new start date for ending existing coverage
                    const startDateObj = new Date(existingCoverageConfirm.startDate)
                    const dayBefore = new Date(startDateObj)
                    dayBefore.setDate(dayBefore.getDate() - 1)
                    const dayBeforeStr = getLocalDateString(dayBefore)

                    // End all existing active coverage for this asset
                    for (const existing of existingCoverageConfirm.existingCoverage) {
                      const { error: endError } = await supabase
                        .from('coverage')
                        .update({
                          end_date: dayBeforeStr,
                          is_active: dayBeforeStr >= getLocalDateString() ? true : false,
                          changed_by: user?.id
                        })
                        .eq('id', existing.id)

                      if (endError) throw endError
                    }

                    // Create the new coverage record
                    const baseRecord = {
                      asset_id: existingCoverageConfirm.assetId,
                      user_id: existingCoverageConfirm.newAnalystId,
                      analyst_name: existingCoverageConfirm.newAnalystName,
                      start_date: existingCoverageConfirm.startDate,
                      end_date: existingCoverageConfirm.endDate || null,
                      is_active: !existingCoverageConfirm.endDate || existingCoverageConfirm.endDate >= getLocalDateString(),
                      changed_by: user?.id,
                      role: coverageSettings?.enable_hierarchy ? (existingCoverageConfirm.isLead ? 'primary' : null) : null,
                      notes: existingCoverageConfirm.notes || null,
                      team_id: userTeams?.[0]?.id || null,
                      visibility: coverageSettings?.default_visibility || 'team',
                      is_lead: coverageSettings?.enable_hierarchy ? existingCoverageConfirm.isLead : false
                    }

                    const { error } = await supabase
                      .from('coverage')
                      .insert(baseRecord)
                    if (error) throw error

                    // Refresh the coverage data
                    queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['asset-coverage-history'] })
                    queryClient.invalidateQueries({ queryKey: ['all-coverage-events'] })

                    setExistingCoverageConfirm(null)
                    setAddingCoverage(null)
                  } catch (error: any) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Error Transitioning Coverage',
                      message: error.message || 'Failed to transition coverage. Please try again.'
                    })
                  }
                }}
                className="w-full p-4 text-left border border-gray-200 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-100 rounded-lg group-hover:bg-primary-200 transition-colors">
                    <ArrowRightLeft className="h-5 w-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Transition Coverage</p>
                    <p className="text-sm text-gray-500">End existing coverage and start new</p>
                  </div>
                </div>
              </button>

              {/* Add Additional Coverage Option */}
              <button
                onClick={async () => {
                  try {
                    // Just add the new coverage without ending existing
                    const baseRecord = {
                      asset_id: existingCoverageConfirm.assetId,
                      user_id: existingCoverageConfirm.newAnalystId,
                      analyst_name: existingCoverageConfirm.newAnalystName,
                      start_date: existingCoverageConfirm.startDate,
                      end_date: existingCoverageConfirm.endDate || null,
                      is_active: !existingCoverageConfirm.endDate || existingCoverageConfirm.endDate >= getLocalDateString(),
                      changed_by: user?.id,
                      role: coverageSettings?.enable_hierarchy ? (existingCoverageConfirm.isLead ? 'primary' : null) : null,
                      notes: existingCoverageConfirm.notes || null,
                      team_id: userTeams?.[0]?.id || null,
                      visibility: coverageSettings?.default_visibility || 'team',
                      is_lead: coverageSettings?.enable_hierarchy ? existingCoverageConfirm.isLead : false
                    }

                    const { error } = await supabase
                      .from('coverage')
                      .insert(baseRecord)
                    if (error) throw error

                    // Refresh the coverage data
                    queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['coverage'] })
                    queryClient.invalidateQueries({ queryKey: ['asset-coverage-history'] })
                    queryClient.invalidateQueries({ queryKey: ['all-coverage-events'] })

                    setExistingCoverageConfirm(null)
                    setAddingCoverage(null)
                  } catch (error: any) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Error Adding Coverage',
                      message: error.message || 'Failed to add coverage. Please try again.'
                    })
                  }
                }}
                className="w-full p-4 text-left border border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg group-hover:bg-green-200 transition-colors">
                    <UserPlus className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Add Additional Coverage</p>
                    <p className="text-sm text-gray-500">Keep existing coverage alongside new</p>
                  </div>
                </div>
              </button>

              {/* Cancel */}
              <button
                onClick={() => setExistingCoverageConfirm(null)}
                className="w-full p-3 text-center text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // Page mode - simple full-height container
  if (mode === 'page') {
    return (
      <div className="h-full flex flex-col bg-white">
        <div className="h-full flex flex-col">
          {content}
        </div>
      </div>
    )
  }

  // Modal mode - with backdrop and centered dialog
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-7xl w-full mx-auto transform transition-all h-[90vh] overflow-hidden flex flex-col">
          {content}
        </div>
      </div>
    </div>
  )
}