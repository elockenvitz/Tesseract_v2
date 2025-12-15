import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Users, X, Search, Trash2, ChevronDown, ChevronRight, Upload, Download, FileText, AlertCircle, ChevronUp, Shield, Eye, EyeOff, History, ArrowRightLeft, RefreshCw, Clock, Plus, List, LayoutGrid, Grid3X3, Star, UserCheck, User, TrendingUp, TrendingDown, BarChart3, CheckCircle, UserPlus, Building2, FolderOpen, Check, Briefcase, Minimize2, Maximize2, Scale } from 'lucide-react'
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
    team_id?: string | null
  } | null
  teams?: {
    id: string
    name: string
    node_type: string
  } | null
}

export function CoverageManager({ isOpen, onClose, initialView = 'active', mode = 'modal' }: CoverageManagerProps) {
  // localStorage key for persisting settings
  const STORAGE_KEY = 'coverage-manager-settings'

  // Load initial state from localStorage
  const getInitialState = <T,>(key: string, defaultValue: T): T => {
    if (typeof window === 'undefined') return defaultValue
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (key in parsed) {
          // Handle Set conversion
          if (defaultValue instanceof Set) {
            return new Set(parsed[key]) as T
          }
          return parsed[key]
        }
      }
    } catch (e) {
      console.warn('Failed to load coverage settings:', e)
    }
    return defaultValue
  }

  const [activeView, setActiveView] = useState<'active' | 'history' | 'requests'>(() => getInitialState('activeView', initialView))
  const [viewMode, setViewMode] = useState<'list' | 'gaps' | 'workload' | 'matrix'>(() => getInitialState('viewMode', 'list'))
  const [searchQuery, setSearchQuery] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [selectedAnalystId, setSelectedAnalystId] = useState<string | null>(null)
  const [selectedStatCard, setSelectedStatCard] = useState<'analysts' | 'covered' | 'gaps' | 'average' | null>(null)
  const [matrixGroupBy, setMatrixGroupBy] = useState<'sector' | 'analyst' | 'portfolio' | 'team' | 'holdings'>(() => getInitialState('matrixGroupBy', 'sector'))
  const [matrixSelectedAnalysts, setMatrixSelectedAnalysts] = useState<Set<string>>(() => new Set()) // Empty = show all
  const [showMatrixAnalystPicker, setShowMatrixAnalystPicker] = useState(false)
  const matrixAnalystPickerRef = useRef<HTMLDivElement>(null)
  const [matrixShowOverlapsOnly, setMatrixShowOverlapsOnly] = useState(false)
  const [matrixGroupContextMenu, setMatrixGroupContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => getInitialState('collapsedGroups', new Set()))
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(() => getInitialState('hiddenGroups', new Set()))
  const [hideEmptyGroups, setHideEmptyGroups] = useState(() => getInitialState('hideEmptyGroups', false))
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupKey: string; groupName: string } | null>(null)
  const [collapsedGapsGroups, setCollapsedGapsGroups] = useState<Set<string>>(() => getInitialState('collapsedGapsGroups', new Set()))

  // List View Configuration - Columns, Sorting, Filtering, Grouping
  type ListColumnId = 'asset' | 'analyst' | 'visibility' | 'sector' | 'startDate' | 'tenure' | 'industry' | 'marketCap'
  type ListGroupByLevel = 'division' | 'department' | 'team' | 'portfolio' | 'sector' | 'industry' | 'analyst'
  const [listVisibleColumns, setListVisibleColumns] = useState<ListColumnId[]>(() => getInitialState('listVisibleColumns', ['asset', 'analyst', 'visibility', 'sector']))
  const [listGroupByLevels, setListGroupByLevels] = useState<ListGroupByLevel[]>(() => getInitialState('listGroupByLevels', [])) // Multi-level grouping
  const [listGroupFilter, setListGroupFilter] = useState<string | null>(null) // Filter to specific group
  const [showGroupByDropdown, setShowGroupByDropdown] = useState(false)
  const groupByRef = useRef<HTMLDivElement>(null)
  const [listSortColumn, setListSortColumn] = useState<ListColumnId | null>(() => getInitialState('listSortColumn', 'asset'))
  const [listSortDirection, setListSortDirection] = useState<'asc' | 'desc'>(() => getInitialState('listSortDirection', 'asc'))
  const [listColumnFilters, setListColumnFilters] = useState<Partial<Record<ListColumnId, string>>>({})
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [activeFilterColumn, setActiveFilterColumn] = useState<ListColumnId | null>(null)

  // Determine if the component should be visible (page mode is always visible)
  const isVisible = mode === 'page' || isOpen

  // Save settings to localStorage when they change
  useEffect(() => {
    const settings = {
      activeView,
      viewMode,
      matrixGroupBy,
      collapsedGroups: Array.from(collapsedGroups),
      hiddenGroups: Array.from(hiddenGroups),
      hideEmptyGroups,
      collapsedGapsGroups: Array.from(collapsedGapsGroups),
      listVisibleColumns,
      listGroupByLevels,
      listSortColumn,
      listSortDirection
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      console.warn('Failed to save coverage settings:', e)
    }
  }, [activeView, viewMode, matrixGroupBy, collapsedGroups, hiddenGroups, hideEmptyGroups, collapsedGapsGroups, listVisibleColumns, listGroupByLevels, listSortColumn, listSortDirection])

  // Sync activeView with initialView when modal first opens or when initialView changes
  const hasInitialized = useRef(false)
  const prevInitialView = useRef(initialView)
  useEffect(() => {
    if (isVisible && !hasInitialized.current) {
      // Only sync with initialView if coming from a specific navigation (e.g., clicking Requests tab)
      if (initialView !== 'active') {
        setActiveView(initialView)
      }
      hasInitialized.current = true
      prevInitialView.current = initialView
    } else if (isVisible && initialView !== prevInitialView.current) {
      // Handle navigation to a different view while tab is already open
      // (e.g., clicking a coverage request notification when coverage tab is already open)
      setActiveView(initialView)
      prevInitialView.current = initialView
    }
    if (!isVisible) {
      hasInitialized.current = false
    }
  }, [isVisible, initialView])

  // Close group by dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (groupByRef.current && !groupByRef.current.contains(event.target as Node)) {
        setShowGroupByDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close matrix analyst picker on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (matrixAnalystPickerRef.current && !matrixAnalystPickerRef.current.contains(event.target as Node)) {
        setShowMatrixAnalystPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
  const columnManagerRef = useRef<HTMLDivElement>(null)
  const filterDropdownRef = useRef<HTMLDivElement>(null)

  // List View Column Definitions
  const listColumnDefinitions: Record<ListColumnId, { label: string; width: number; filterable: boolean; sortable: boolean }> = {
    asset: { label: 'Asset', width: 3, filterable: true, sortable: true },
    analyst: { label: 'Analyst', width: 2, filterable: true, sortable: true },
    visibility: { label: 'Visibility', width: 1, filterable: true, sortable: true },
    sector: { label: 'Sector', width: 2, filterable: true, sortable: true },
    startDate: { label: 'Start Date', width: 1, filterable: false, sortable: true },
    tenure: { label: 'Tenure', width: 1, filterable: false, sortable: true },
    industry: { label: 'Industry', width: 2, filterable: true, sortable: true },
    marketCap: { label: 'Market Cap', width: 1, filterable: false, sortable: true }
  }

  // Calculate tenure from start date
  const calculateTenure = (startDate: string | null): { days: number; label: string } => {
    if (!startDate) return { days: 0, label: '—' }
    const start = new Date(startDate)
    const now = new Date()
    const diffTime = now.getTime() - start.getTime()
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    if (diffDays < 30) return { days: diffDays, label: `${diffDays}d` }
    if (diffDays < 365) return { days: diffDays, label: `${Math.floor(diffDays / 30)}mo` }
    const years = Math.floor(diffDays / 365)
    const months = Math.floor((diffDays % 365) / 30)
    return { days: diffDays, label: months > 0 ? `${years}y ${months}mo` : `${years}y` }
  }

  // Format market cap
  const formatMarketCap = (marketCap: number | null | undefined): string => {
    if (!marketCap) return '—'
    if (marketCap >= 1e12) return `$${(marketCap / 1e12).toFixed(1)}T`
    if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(1)}B`
    if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(1)}M`
    return `$${marketCap.toLocaleString()}`
  }

  // Toggle column sort
  const handleColumnSort = (columnId: ListColumnId) => {
    if (!listColumnDefinitions[columnId].sortable) return
    if (listSortColumn === columnId) {
      setListSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setListSortColumn(columnId)
      setListSortDirection('asc')
    }
  }

  // Toggle column filter dropdown
  const handleFilterClick = (columnId: ListColumnId, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!listColumnDefinitions[columnId].filterable) return
    setActiveFilterColumn(prev => prev === columnId ? null : columnId)
  }

  // Get team name from user's org chart membership (since team_id on coverage is often null)
  const getAnalystTeamName = (userId: string): string | null => {
    if (!userTeamMemberships) return null
    const memberships = userTeamMemberships.get(userId)
    if (!memberships || memberships.length === 0) return null
    // Prefer team type nodes, then any other membership
    const teamNode = memberships.find(m => m.type === 'team')
    if (teamNode) return teamNode.name
    // Fall back to first membership if no team found
    return memberships[0]?.name || null
  }

  // Get unique values for filter dropdown
  const getUniqueFilterValues = (columnId: ListColumnId, records: CoverageRecord[]): string[] => {
    const values = new Set<string>()
    records.forEach(coverage => {
      let value: string | undefined
      switch (columnId) {
        case 'analyst': value = coverage.analyst_name; break
        case 'visibility': value = coverage.visibility || 'team'; break
        case 'sector': value = coverage.assets?.sector; break
        case 'industry': value = (coverage.assets as any)?.industry; break
      }
      if (value) values.add(value)
    })
    return Array.from(values).sort()
  }

  // Calculate total width for visible columns
  const totalColumnWidth = listVisibleColumns.reduce((sum, colId) => sum + listColumnDefinitions[colId].width, 0) + 1 // +1 for actions

  // Fetch all coverage records with asset details
  const { data: coverageRecords, isLoading: coverageLoading } = useQuery({
    queryKey: ['all-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('*, assets(*), portfolios(id, name, team_id), teams:org_chart_nodes!coverage_team_id_fkey(id, name, node_type)')
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

  // Fetch teams for team name lookups
  const { data: teamsData } = useQuery({
    queryKey: ['teams-for-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name')

      if (error) throw error
      return data || []
    },
    enabled: isVisible,
  })

  // Create a map for quick team lookups by id
  const teamsMap = React.useMemo(() => {
    const map = new Map<string, string>()
    teamsData?.forEach(team => map.set(team.id, team.name))
    return map
  }, [teamsData])

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

  // Fetch user profile extended data for sector focus
  const { data: userProfilesExtended } = useQuery({
    queryKey: ['user-profiles-extended'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profile_extended')
        .select('user_id, sector_focus')

      if (error) throw error
      // Return as a Map for easy lookup by user_id
      const profileMap = new Map<string, string[]>()
      data?.forEach(profile => {
        profileMap.set(profile.user_id, profile.sector_focus || [])
      })
      return profileMap
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
    queryKey: ['user-team-memberships-coverage'],
    queryFn: async () => {
      // Get team memberships from team_memberships table (links users to teams)
      const { data: teamMemberships, error: tmError } = await supabase
        .from('team_memberships')
        .select(`
          user_id,
          team:team_id (id, name)
        `)

      if (tmError) throw tmError

      // Get all org chart nodes to find the hierarchy
      const { data: orgNodes, error: orgError } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id, settings')

      if (orgError) throw orgError

      // Build a map of team_id -> org chart node (nodes with settings.team_id)
      const teamIdToOrgNode = new Map<string, any>()
      ;(orgNodes || []).forEach((node: any) => {
        if (node.settings?.team_id) {
          teamIdToOrgNode.set(node.settings.team_id, node)
        }
      })

      // Build node lookup map
      const nodeMap = new Map((orgNodes || []).map((n: any) => [n.id, n]))

      // Group by user_id, finding the org chart node for each team membership
      const byUser = new Map<string, Array<{ id: string; name: string; type: string; role?: string }>>()
      ;(teamMemberships || []).forEach((m: any) => {
        if (m.user_id && m.team) {
          if (!byUser.has(m.user_id)) {
            byUser.set(m.user_id, [])
          }

          // Find org chart node linked to this team
          const orgNode = teamIdToOrgNode.get(m.team.id)
          if (orgNode) {
            byUser.get(m.user_id)!.push({
              id: orgNode.id,
              name: orgNode.name,
              type: orgNode.node_type,
              role: undefined
            })
          } else {
            // Fallback: use team directly
            byUser.get(m.user_id)!.push({
              id: m.team.id,
              name: m.team.name,
              type: 'team',
              role: undefined
            })
          }
        }
      })
      return byUser
    },
    enabled: isVisible
  })

  // Fetch portfolio team memberships (portfolio members are in portfolio_team table, not org_chart_node_members)
  const { data: portfolioTeamMemberships } = useQuery({
    queryKey: ['portfolio-team-memberships-for-grouping'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_team')
        .select(`
          user_id,
          portfolio_id,
          role,
          portfolios:portfolio_id (id, name)
        `)

      if (error) throw error

      // Group by user_id -> portfolio names
      const byUser = new Map<string, string[]>()
      ;(data || []).forEach((m: any) => {
        if (m.user_id && m.portfolios?.name) {
          if (!byUser.has(m.user_id)) {
            byUser.set(m.user_id, [])
          }
          const portfolioName = m.portfolios.name
          if (!byUser.get(m.user_id)!.includes(portfolioName)) {
            byUser.get(m.user_id)!.push(portfolioName)
          }
        }
      })
      return byUser
    },
    enabled: isVisible
  })

  // Fetch portfolio holdings (for holdings grouping in matrix view)
  const { data: portfolioHoldings } = useQuery({
    queryKey: ['portfolio-holdings-for-matrix'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select(`
          portfolio_id,
          asset_id,
          portfolios:portfolio_id (id, name),
          assets:asset_id (id, symbol, company_name, sector)
        `)

      if (error) throw error

      // Group by portfolio name -> assets
      const byPortfolio = new Map<string, Array<{ id: string; symbol: string; name: string; sector: string }>>()
      ;(data || []).forEach((h: any) => {
        if (h.portfolios?.name && h.assets) {
          const portfolioName = h.portfolios.name
          if (!byPortfolio.has(portfolioName)) {
            byPortfolio.set(portfolioName, [])
          }
          const existing = byPortfolio.get(portfolioName)!
          if (!existing.find(a => a.id === h.assets.id)) {
            existing.push({
              id: h.assets.id,
              symbol: h.assets.symbol,
              name: h.assets.company_name,
              sector: h.assets.sector || 'Uncategorized'
            })
          }
        }
      })
      return byPortfolio
    },
    enabled: isVisible
  })

  // Fetch portfolio universe data (for portfolio grouping based on investable universe filters)
  const { data: portfolioUniverseAssets } = useQuery({
    queryKey: ['portfolio-universe-assets-for-matrix'],
    queryFn: async () => {
      // Get all portfolios
      const { data: portfolios, error: portfoliosError } = await supabase
        .from('portfolios')
        .select('id, name')

      if (portfoliosError) throw portfoliosError

      // Get direct universe asset assignments
      const { data: directAssets, error: directError } = await supabase
        .from('portfolio_universe_assets')
        .select(`
          portfolio_id,
          asset_id,
          assets:asset_id (id, symbol, company_name, sector, industry, market_cap)
        `)

      if (directError) throw directError

      // Get portfolio universe filters
      const { data: filters, error: filtersError } = await supabase
        .from('portfolio_universe_filters')
        .select('*')

      if (filtersError) throw filtersError

      // Get all assets for filter evaluation
      const { data: allAssets, error: assetsError } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, country, exchange, market_cap')

      if (assetsError) throw assetsError

      // Helper to check if asset matches a filter (matches PortfolioTab.tsx logic)
      const assetMatchesFilter = (asset: any, filter: any): boolean => {
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
      }

      // Build universe by portfolio name
      const byPortfolio = new Map<string, Array<{ id: string; symbol: string; name: string; sector: string }>>()
      const portfolioIdToName = new Map<string, string>()
      ;(portfolios || []).forEach(p => portfolioIdToName.set(p.id, p.name))

      // Add direct asset assignments
      ;(directAssets || []).forEach((da: any) => {
        const portfolioName = portfolioIdToName.get(da.portfolio_id)
        if (!portfolioName || !da.assets) return

        if (!byPortfolio.has(portfolioName)) {
          byPortfolio.set(portfolioName, [])
        }
        const existing = byPortfolio.get(portfolioName)!
        if (!existing.find(a => a.id === da.assets.id)) {
          existing.push({
            id: da.assets.id,
            symbol: da.assets.symbol,
            name: da.assets.company_name,
            sector: da.assets.sector || 'Uncategorized'
          })
        }
      })

      // Group filters by portfolio
      const filtersByPortfolio = new Map<string, any[]>()
      ;(filters || []).forEach((f: any) => {
        if (!filtersByPortfolio.has(f.portfolio_id)) {
          filtersByPortfolio.set(f.portfolio_id, [])
        }
        filtersByPortfolio.get(f.portfolio_id)!.push(f)
      })

      // Apply filters to find matching assets
      filtersByPortfolio.forEach((portfolioFilters, portfolioId) => {
        const portfolioName = portfolioIdToName.get(portfolioId)
        if (!portfolioName) return

        if (!byPortfolio.has(portfolioName)) {
          byPortfolio.set(portfolioName, [])
        }
        const existing = byPortfolio.get(portfolioName)!
        const existingIds = new Set(existing.map(a => a.id))

        ;(allAssets || []).forEach((asset: any) => {
          if (existingIds.has(asset.id)) return

          // Asset must match ALL filters for this portfolio
          const matchesAll = portfolioFilters.every(f => assetMatchesFilter(asset, f))
          if (matchesAll) {
            existing.push({
              id: asset.id,
              symbol: asset.symbol,
              name: asset.company_name,
              sector: asset.sector || 'Uncategorized'
            })
          }
        })
      })

      return byPortfolio
    },
    enabled: isVisible
  })

  // Fetch all org chart node members (for team grouping - teams derive members from child portfolio nodes)
  const { data: allOrgChartNodeMembers } = useQuery({
    queryKey: ['all-org-chart-node-members-for-grouping'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_chart_node_members')
        .select('node_id, user_id, role')

      if (error) throw error

      // Build a map of node_id -> user_ids
      const byNode = new Map<string, string[]>()
      ;(data || []).forEach((m: any) => {
        if (!byNode.has(m.node_id)) {
          byNode.set(m.node_id, [])
        }
        if (!byNode.get(m.node_id)!.includes(m.user_id)) {
          byNode.get(m.node_id)!.push(m.user_id)
        }
      })
      return byNode
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

      // Filter to only department/division/team/portfolio for the dropdown, excluding non-investment nodes
      const filteredNodes = (data || [])
        .filter(n => ['department', 'division', 'team', 'portfolio'].includes(n.node_type) && !isNonInvestmentNode(n))
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

  // Fetch uncovered assets (gaps) - assets without active coverage
  const { data: gapsQueryResult, isLoading: gapsLoading } = useQuery({
    queryKey: ['coverage-gaps'],
    queryFn: async () => {
      // Get all assets with active coverage
      const { data: coveredAssetIds, error: coverageError } = await supabase
        .from('coverage')
        .select('asset_id')
        .eq('is_active', true)

      if (coverageError) throw coverageError

      const coveredIds = new Set((coveredAssetIds || []).map(c => c.asset_id))

      // Get all assets
      const { data: allAssets, error: assetsError } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, market_cap')
        .order('symbol')

      if (assetsError) throw assetsError

      // Return both uncovered (gaps) and all assets with coverage status
      const uncoveredAssets = (allAssets || []).filter(a => !coveredIds.has(a.id))
      const allWithStatus = (allAssets || []).map(a => ({
        ...a,
        isCovered: coveredIds.has(a.id)
      }))

      return {
        uncovered: uncoveredAssets,
        allWithStatus
      }
    },
    enabled: isVisible && viewMode === 'gaps'
  })

  // Extract gaps data for backward compatibility
  const gapsData = gapsQueryResult?.uncovered
  const allAssetsWithStatus = gapsQueryResult?.allWithStatus

  // Fetch portfolio universe assets for portfolio-based gap analysis
  const { data: portfolioUniverseData } = useQuery({
    queryKey: ['portfolio-universe-gaps'],
    queryFn: async () => {
      // First, get ALL portfolios
      const { data: allPortfolios, error: portfoliosError } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')

      if (portfoliosError) throw portfoliosError

      // Get portfolio universe assets (direct assignments)
      const { data: universeAssets, error: universeError } = await supabase
        .from('portfolio_universe_assets')
        .select(`
          portfolio_id,
          asset_id,
          assets!inner(id, symbol, company_name, sector, industry, market_cap)
        `)

      if (universeError) throw universeError

      // Get portfolio universe filters (rule-based)
      const { data: universeFilters, error: filtersError } = await supabase
        .from('portfolio_universe_filters')
        .select('*')

      if (filtersError) throw filtersError

      // Get all assets for filter evaluation
      const { data: allAssets, error: assetsError } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, market_cap')

      if (assetsError) throw assetsError

      // Get all assets with active coverage
      const { data: coveredAssetIds, error: coverageError } = await supabase
        .from('coverage')
        .select('asset_id')
        .eq('is_active', true)

      if (coverageError) throw coverageError

      const coveredIds = new Set((coveredAssetIds || []).map(c => c.asset_id))

      // Helper to parse market cap filter value (e.g., ">75000M" -> 75000000000)
      const parseMarketCapValue = (value: string): number => {
        const match = value.match(/[><=]*(\d+)([BMK])?/i)
        if (!match) return 0
        let num = parseInt(match[1], 10)
        const suffix = match[2]?.toUpperCase()
        if (suffix === 'B') num *= 1e9
        else if (suffix === 'M') num *= 1e6
        else if (suffix === 'K') num *= 1e3
        return num
      }

      // Helper to check if asset matches a filter
      const assetMatchesFilter = (asset: any, filter: any): boolean => {
        if (filter.filter_type === 'market_cap' && asset.market_cap != null) {
          const threshold = parseMarketCapValue(filter.filter_value)
          const op = filter.filter_operator
          if (op === 'gt' || filter.filter_value.startsWith('>')) return asset.market_cap > threshold
          if (op === 'lt' || filter.filter_value.startsWith('<')) return asset.market_cap < threshold
          if (op === 'gte') return asset.market_cap >= threshold
          if (op === 'lte') return asset.market_cap <= threshold
          if (op === 'eq') return asset.market_cap === threshold
        }
        if (filter.filter_type === 'sector' && asset.sector) {
          return asset.sector.toLowerCase() === filter.filter_value.toLowerCase()
        }
        if (filter.filter_type === 'industry' && asset.industry) {
          return asset.industry.toLowerCase() === filter.filter_value.toLowerCase()
        }
        return false
      }

      // Build universe data per portfolio
      const universeByPortfolio = new Map<string, Array<{ id: string; symbol: string; company_name: string; sector: string | null; industry: string | null; market_cap: number | null }>>()
      const hasUniverseDefinition = new Set<string>()

      // Add direct asset assignments
      ;(universeAssets || []).forEach((ua: any) => {
        const pId = ua.portfolio_id
        hasUniverseDefinition.add(pId)
        if (!universeByPortfolio.has(pId)) {
          universeByPortfolio.set(pId, [])
        }
        universeByPortfolio.get(pId)!.push({
          id: ua.assets.id,
          symbol: ua.assets.symbol,
          company_name: ua.assets.company_name,
          sector: ua.assets.sector,
          industry: ua.assets.industry,
          market_cap: ua.assets.market_cap
        })
      })

      // Group filters by portfolio
      const filtersByPortfolio = new Map<string, any[]>()
      ;(universeFilters || []).forEach((filter: any) => {
        hasUniverseDefinition.add(filter.portfolio_id)
        if (!filtersByPortfolio.has(filter.portfolio_id)) {
          filtersByPortfolio.set(filter.portfolio_id, [])
        }
        filtersByPortfolio.get(filter.portfolio_id)!.push(filter)
      })

      // Apply filters to find matching assets
      filtersByPortfolio.forEach((filters, portfolioId) => {
        if (!universeByPortfolio.has(portfolioId)) {
          universeByPortfolio.set(portfolioId, [])
        }
        const existingIds = new Set(universeByPortfolio.get(portfolioId)!.map(a => a.id))

        ;(allAssets || []).forEach((asset: any) => {
          // Skip if already in universe from direct assignment
          if (existingIds.has(asset.id)) return

          // Asset must match ALL filters for this portfolio
          const matchesAll = filters.every((filter: any) => assetMatchesFilter(asset, filter))
          if (matchesAll) {
            universeByPortfolio.get(portfolioId)!.push({
              id: asset.id,
              symbol: asset.symbol,
              company_name: asset.company_name,
              sector: asset.sector,
              industry: asset.industry,
              market_cap: asset.market_cap
            })
          }
        })
      })

      // Build result for ALL portfolios
      return (allPortfolios || []).map(portfolio => {
        const universeAssetsList = universeByPortfolio.get(portfolio.id) || []
        const uncoveredAssets = universeAssetsList.filter(asset => !coveredIds.has(asset.id))
        const hasDefinition = hasUniverseDefinition.has(portfolio.id)

        return {
          portfolio: { id: portfolio.id, name: portfolio.name },
          assets: uncoveredAssets,
          universeSize: universeAssetsList.length,
          hasUniverseDefinition: hasDefinition
        }
      })
    },
    enabled: isVisible && viewMode === 'gaps' && listGroupByLevels.includes('portfolio')
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

    // Apply list view column filters (only in list view mode)
    if (viewMode === 'list' && Object.keys(listColumnFilters).length > 0) {
      records = records.filter(coverage => {
        for (const [columnId, filterValue] of Object.entries(listColumnFilters)) {
          if (!filterValue) continue
          const lowerFilter = filterValue.toLowerCase()
          switch (columnId) {
            case 'asset':
              if (!(coverage.assets?.symbol?.toLowerCase().includes(lowerFilter) ||
                    coverage.assets?.company_name?.toLowerCase().includes(lowerFilter))) return false
              break
            case 'analyst':
              if (!coverage.analyst_name?.toLowerCase().includes(lowerFilter)) return false
              break
            case 'visibility':
              if (!(coverage.visibility || 'team').toLowerCase().includes(lowerFilter)) return false
              break
            case 'sector':
              if (!coverage.assets?.sector?.toLowerCase().includes(lowerFilter)) return false
              break
            case 'industry':
              if (!(coverage.assets as any)?.industry?.toLowerCase().includes(lowerFilter)) return false
              break
          }
        }
        return true
      })
    }

    // Apply list view sorting (only in list view mode)
    if (viewMode === 'list' && listSortColumn) {
      records = [...records].sort((a, b) => {
        let aVal: any, bVal: any
        switch (listSortColumn) {
          case 'asset':
            aVal = a.assets?.symbol || ''
            bVal = b.assets?.symbol || ''
            break
          case 'analyst':
            aVal = a.analyst_name || ''
            bVal = b.analyst_name || ''
            break
          case 'visibility':
            const visOrder: Record<string, number> = { team: 0, division: 1, firm: 2 }
            aVal = visOrder[a.visibility || 'team'] ?? 0
            bVal = visOrder[b.visibility || 'team'] ?? 0
            return listSortDirection === 'asc' ? aVal - bVal : bVal - aVal
          case 'sector':
            aVal = a.assets?.sector || ''
            bVal = b.assets?.sector || ''
            break
          case 'startDate':
            aVal = a.start_date || ''
            bVal = b.start_date || ''
            break
          case 'tenure':
            aVal = calculateTenure(a.start_date).days
            bVal = calculateTenure(b.start_date).days
            return listSortDirection === 'asc' ? aVal - bVal : bVal - aVal
          case 'industry':
            aVal = (a.assets as any)?.industry || ''
            bVal = (b.assets as any)?.industry || ''
            break
          case 'marketCap':
            aVal = (a.assets as any)?.market_cap || 0
            bVal = (b.assets as any)?.market_cap || 0
            return listSortDirection === 'asc' ? aVal - bVal : bVal - aVal
          default:
            return 0
        }
        const comparison = String(aVal).localeCompare(String(bVal))
        return listSortDirection === 'asc' ? comparison : -comparison
      })
    }

    return records
  })()

  // Coverage history events
  const filteredCoverageEvents = allCoverageEvents || []

  // Coverage requests
  const filteredCoverageRequests = coverageRequests || []

  // Get all covered asset IDs
  const coveredAssetIds = new Set(
    (coverageRecords || [])
      .filter(coverage => coverage.is_active)
      .map(coverage => coverage.asset_id)
  )

  // Get all uncovered assets
  const allUncoveredAssets = (assets || []).filter(asset => !coveredAssetIds.has(asset.id))

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
                      onClick={() => { setViewMode('list'); setMatrixShowOverlapsOnly(false) }}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'list' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="List"
                    >
                      <List className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { setViewMode('gaps'); setMatrixShowOverlapsOnly(false) }}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'gaps' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="Gaps"
                    >
                      <AlertCircle className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { setViewMode('workload'); setMatrixShowOverlapsOnly(false) }}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'workload' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="Workload"
                    >
                      <Scale className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('matrix')}
                      className={clsx(
                        "p-2 rounded-md transition-colors",
                        viewMode === 'matrix' ? "bg-white shadow-sm text-primary-600" : "text-gray-500 hover:text-gray-700"
                      )}
                      title="Matrix"
                    >
                      <Grid3X3 className="h-4 w-4" />
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

                {/* Group By Dropdown - Multi-level (hidden for Workload and Matrix views) */}
                {viewMode !== 'workload' && viewMode !== 'matrix' && (
                <div className="relative" ref={groupByRef}>
                  <button
                    onClick={() => setShowGroupByDropdown(!showGroupByDropdown)}
                    className={clsx(
                      "pl-3 pr-8 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm cursor-pointer min-w-[180px] text-left truncate",
                      listGroupByLevels.length > 0 ? "border-primary-500 bg-primary-50 text-primary-700" : "border-gray-300 bg-white text-gray-700"
                    )}
                  >
                    {listGroupByLevels.length === 0
                      ? 'Groupings'
                      : `Groupings (${listGroupByLevels.length})`}
                  </button>
                  <ChevronDown className="absolute right-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />

                  {showGroupByDropdown && (() => {
                    const allOptions: Array<{ value: ListGroupByLevel; label: string; icon: typeof FolderOpen; category: 'org' | 'other' }> = [
                      { value: 'division', label: 'Division', icon: FolderOpen, category: 'org' },
                      { value: 'department', label: 'Department', icon: Building2, category: 'org' },
                      { value: 'team', label: 'Team', icon: Users, category: 'org' },
                      { value: 'portfolio', label: 'Portfolio', icon: Briefcase, category: 'org' },
                      { value: 'sector', label: 'Sector', icon: BarChart3, category: 'other' },
                      { value: 'industry', label: 'Industry', icon: TrendingUp, category: 'other' },
                      { value: 'analyst', label: 'Analyst', icon: User, category: 'other' },
                    ]
                    const getOptionDetails = (value: ListGroupByLevel) => allOptions.find(o => o.value === value)!
                    const moveLevel = (fromIdx: number, toIdx: number) => {
                      setListGroupByLevels(prev => {
                        const arr = [...prev]
                        const [item] = arr.splice(fromIdx, 1)
                        arr.splice(toIdx, 0, item)
                        return arr
                      })
                    }
                    const availableOptions = allOptions.filter(o => !listGroupByLevels.includes(o.value))

                    return (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowGroupByDropdown(false)} />
                        <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                          {/* Current Order Section */}
                          {listGroupByLevels.length > 0 && (
                            <div className="bg-gray-50 border-b border-gray-200">
                              <div className="px-3 py-2 flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Grouping Order</span>
                                <button
                                  onClick={() => setListGroupByLevels([])}
                                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                                >
                                  Clear
                                </button>
                              </div>
                              <div className="px-2 pb-2 space-y-1">
                                {listGroupByLevels.map((level, idx) => {
                                  const opt = getOptionDetails(level)
                                  return (
                                    <div
                                      key={level}
                                      className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-md border border-gray-200 shadow-sm"
                                    >
                                      <span className="w-5 h-5 flex items-center justify-center rounded bg-primary-100 text-primary-700 text-xs font-bold">
                                        {idx + 1}
                                      </span>
                                      <opt.icon className="h-4 w-4 text-gray-400" />
                                      <span className="text-sm font-medium text-gray-700 flex-1">{opt.label}</span>
                                      <div className="flex items-center gap-0.5">
                                        <button
                                          onClick={() => idx > 0 && moveLevel(idx, idx - 1)}
                                          disabled={idx === 0}
                                          className={clsx(
                                            "p-1 rounded transition-colors",
                                            idx === 0 ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                          )}
                                          title="Move up"
                                        >
                                          <ChevronUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          onClick={() => idx < listGroupByLevels.length - 1 && moveLevel(idx, idx + 1)}
                                          disabled={idx === listGroupByLevels.length - 1}
                                          className={clsx(
                                            "p-1 rounded transition-colors",
                                            idx === listGroupByLevels.length - 1 ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                          )}
                                          title="Move down"
                                        >
                                          <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          onClick={() => setListGroupByLevels(prev => prev.filter(l => l !== level))}
                                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                          title="Remove"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {/* Available Options */}
                          <div className="max-h-64 overflow-y-auto">
                            {availableOptions.length > 0 && (
                              <>
                                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 bg-white border-b border-gray-100">
                                  {listGroupByLevels.length === 0 ? 'Select grouping' : 'Add level'}
                                </div>
                                {/* Organization options */}
                                {availableOptions.filter(o => o.category === 'org').length > 0 && (
                                  <div className="py-1">
                                    <div className="px-3 py-1 text-[10px] font-medium text-gray-400 uppercase">Organization</div>
                                    {availableOptions.filter(o => o.category === 'org').map(opt => (
                                      <button
                                        key={opt.value}
                                        onClick={() => setListGroupByLevels(prev => [...prev, opt.value])}
                                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors"
                                      >
                                        <opt.icon className="h-4 w-4 text-gray-400" />
                                        <span className="text-gray-700">{opt.label}</span>
                                        <Plus className="h-3.5 w-3.5 text-gray-300 ml-auto" />
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {/* Other options */}
                                {availableOptions.filter(o => o.category === 'other').length > 0 && (
                                  <div className="py-1 border-t border-gray-100">
                                    <div className="px-3 py-1 text-[10px] font-medium text-gray-400 uppercase">Other</div>
                                    {availableOptions.filter(o => o.category === 'other').map(opt => (
                                      <button
                                        key={opt.value}
                                        onClick={() => setListGroupByLevels(prev => [...prev, opt.value])}
                                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors"
                                      >
                                        <opt.icon className="h-4 w-4 text-gray-400" />
                                        <span className="text-gray-700">{opt.label}</span>
                                        <Plus className="h-3.5 w-3.5 text-gray-300 ml-auto" />
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                            {availableOptions.length === 0 && listGroupByLevels.length > 0 && (
                              <div className="px-3 py-4 text-center text-sm text-gray-500">
                                All grouping options selected
                              </div>
                            )}
                            {listGroupByLevels.length === 0 && (
                              <div className="px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                                Select fields to group by. Add multiple levels for nested grouping.
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
                )}

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

            </div>

            {/* Coverage List - Active View */}
            {activeView === 'active' && (
              <>
              {/* List View */}
              {viewMode === 'list' && (
              <Card padding="none" className="h-[calc(90vh-280px)] flex flex-col overflow-hidden">
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
                  <div className="px-6 py-2 bg-gray-50 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {Object.keys(listColumnFilters).length > 0 && (
                          <button
                            onClick={() => setListColumnFilters({})}
                            className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1"
                          >
                            <X className="w-3 h-3" />
                            Clear filters
                          </button>
                        )}
                        {hiddenGroups.size > 0 && (
                          <button
                            onClick={() => setHiddenGroups(new Set())}
                            className="text-xs text-amber-600 hover:text-amber-700 bg-amber-50 px-2 py-1 rounded flex items-center gap-1"
                          >
                            <EyeOff className="w-3 h-3" />
                            {hiddenGroups.size} hidden group{hiddenGroups.size !== 1 ? 's' : ''} - Show all
                          </button>
                        )}
                        {listGroupByLevels.length > 0 && (
                          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer hover:text-gray-800">
                            <input
                              type="checkbox"
                              checked={hideEmptyGroups}
                              onChange={(e) => setHideEmptyGroups(e.target.checked)}
                              className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            Hide empty groups
                          </label>
                        )}
                      </div>
                      <div className="relative">
                        <button
                          onClick={() => setShowColumnManager(!showColumnManager)}
                          className="text-xs text-gray-500 hover:text-primary-600 flex items-center gap-1"
                        >
                          <Grid3X3 className="w-3.5 h-3.5" />
                          Columns
                        </button>
                        {/* Column Manager Dropdown */}
                        {showColumnManager && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setShowColumnManager(false)} />
                            <div ref={columnManagerRef} className="absolute right-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 p-3 min-w-[200px]">
                          <p className="text-xs font-semibold text-gray-700 mb-2">Visible Columns</p>
                          <div className="space-y-1 max-h-64 overflow-y-auto">
                            {(Object.keys(listColumnDefinitions) as ListColumnId[]).map(colId => (
                              <label key={colId} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={listVisibleColumns.includes(colId)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setListVisibleColumns(prev => [...prev, colId])
                                    } else {
                                      setListVisibleColumns(prev => prev.filter(c => c !== colId))
                                    }
                                  }}
                                  disabled={colId === 'asset'} // Asset column always visible
                                  className="rounded text-primary-600 focus:ring-primary-500"
                                />
                                <span className="text-sm text-gray-700">{listColumnDefinitions[colId].label}</span>
                              </label>
                            ))}
                          </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={`grid gap-2 text-xs font-medium text-gray-500 uppercase tracking-wider`} style={{ gridTemplateColumns: `repeat(${totalColumnWidth}, minmax(0, 1fr))` }}>
                      {listVisibleColumns.map(colId => {
                        const col = listColumnDefinitions[colId]
                        const isFiltered = !!listColumnFilters[colId]
                        const isSorted = listSortColumn === colId
                        return (
                          <div
                            key={colId}
                            className="relative"
                            style={{ gridColumn: `span ${col.width}` }}
                          >
                            <div
                              className={clsx(
                                "flex items-center gap-1 cursor-pointer hover:text-gray-700 select-none py-1",
                                isSorted && "text-primary-600"
                              )}
                              onClick={() => handleColumnSort(colId)}
                            >
                              <span className="truncate">{col.label}</span>
                              {col.sortable && (
                                <span className="flex flex-col">
                                  <ChevronUp className={clsx("w-3 h-3 -mb-1", isSorted && listSortDirection === 'asc' ? "text-primary-600" : "text-gray-300")} />
                                  <ChevronDown className={clsx("w-3 h-3 -mt-1", isSorted && listSortDirection === 'desc' ? "text-primary-600" : "text-gray-300")} />
                                </span>
                              )}
                              {col.filterable && (
                                <button
                                  onClick={(e) => handleFilterClick(colId, e)}
                                  className={clsx(
                                    "p-0.5 rounded hover:bg-gray-200",
                                    isFiltered && "bg-primary-100 text-primary-600"
                                  )}
                                >
                                  <Search className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            {/* Filter Dropdown */}
                            {activeFilterColumn === colId && (
                              <>
                                <div className="fixed inset-0 z-30" onClick={() => setActiveFilterColumn(null)} />
                                <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 p-2 min-w-[180px]">
                                  <input
                                    type="text"
                                    placeholder={`Filter ${col.label}...`}
                                    value={listColumnFilters[colId] || ''}
                                    onChange={(e) => setListColumnFilters(prev => ({ ...prev, [colId]: e.target.value }))}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                                    autoFocus
                                  />
                                  {getUniqueFilterValues(colId, coverageRecords || []).length > 0 && (
                                    <div className="mt-2 max-h-32 overflow-y-auto">
                                      {getUniqueFilterValues(colId, coverageRecords || []).slice(0, 10).map(val => (
                                        <button
                                          key={val}
                                          onClick={() => {
                                            setListColumnFilters(prev => ({ ...prev, [colId]: val }))
                                            setActiveFilterColumn(null)
                                          }}
                                          className="block w-full text-left px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded truncate"
                                        >
                                          {val}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  {listColumnFilters[colId] && (
                                    <button
                                      onClick={() => {
                                        setListColumnFilters(prev => {
                                          const next = { ...prev }
                                          delete next[colId]
                                          return next
                                        })
                                        setActiveFilterColumn(null)
                                      }}
                                      className="mt-2 w-full text-xs text-red-600 hover:text-red-700"
                                    >
                                      Clear filter
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                      <div style={{ gridColumn: 'span 1' }} className="text-right">Actions</div>
                    </div>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto divide-y divide-gray-200">
                    {/* Active Coverage Rows - Grouped by selected grouping levels */}
                    {(() => {
                      // Helper function to get group key for a coverage record at a specific level
                      // Helper to get all portfolios a user is a member of (from portfolio_team table)
                      const getPortfoliosForUser = (userId: string): string[] => {
                        return portfolioTeamMemberships?.get(userId) || []
                      }

                      // Helper to get org node (team/division/department) for a user
                      const getOrgNodeForUser = (userId: string, nodeType: 'team' | 'division' | 'department'): string[] => {
                        const memberships = userTeamMemberships?.get(userId) || []
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const result: string[] = []

                        for (const membership of memberships) {
                          // Skip portfolio-type memberships
                          if (membership.type === 'portfolio') continue

                          // If direct match, add it
                          if (membership.type === nodeType) {
                            if (!result.includes(membership.name)) {
                              result.push(membership.name)
                            }
                            continue
                          }

                          // Walk up the tree to find matching node type
                          let current = allNodes.find(n => n.id === membership.id)
                          while (current) {
                            if (current.node_type === nodeType) {
                              if (!result.includes(current.name)) {
                                result.push(current.name)
                              }
                              break
                            }
                            current = allNodes.find(n => n.id === current?.parent_id)
                          }
                        }

                        return result
                      }

                      // Helper to get all descendant node IDs for a given node (including the node itself)
                      const getAllDescendantNodeIds = (nodeId: string): string[] => {
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const result: string[] = [nodeId]
                        const findChildren = (parentId: string) => {
                          allNodes.forEach(node => {
                            if (node.parent_id === parentId) {
                              result.push(node.id)
                              findChildren(node.id)
                            }
                          })
                        }
                        findChildren(nodeId)
                        return result
                      }

                      // Helper to get all user IDs who are members of a team (via descendant AND linked portfolio memberships)
                      const getTeamMemberUserIds = (teamNodeId: string): string[] => {
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const nodeLinks = allOrgChartNodes?.nodeLinks || []
                        const userIds = new Set<string>()

                        // 1. Get members from descendant nodes (via parent hierarchy)
                        const descendantIds = getAllDescendantNodeIds(teamNodeId)
                        descendantIds.forEach(nodeId => {
                          const members = allOrgChartNodeMembers?.get(nodeId) || []
                          members.forEach(userId => userIds.add(userId))
                        })

                        // 2. Get members from LINKED portfolios (via org_chart_node_links)
                        nodeLinks.forEach((link: { node_id: string; linked_node_id: string }) => {
                          if (link.linked_node_id === teamNodeId) {
                            const node = allNodes.find(n => n.id === link.node_id)
                            if (node?.node_type === 'portfolio') {
                              const members = allOrgChartNodeMembers?.get(link.node_id) || []
                              members.forEach(userId => userIds.add(userId))
                            }
                          }
                        })

                        return Array.from(userIds)
                      }

                      // Helper to get teams a user belongs to via portfolio memberships
                      const getTeamsForUser = (userId: string): string[] => {
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const teamNodes = allNodes.filter(n => n.node_type === 'team')
                        const result: string[] = []

                        teamNodes.forEach(teamNode => {
                          const memberUserIds = getTeamMemberUserIds(teamNode.id)
                          if (memberUserIds.includes(userId)) {
                            result.push(teamNode.name)
                          }
                        })

                        return result
                      }

                      // Helper to find ancestor of a specific type by walking up the tree
                      const findAncestorOfType = (nodeId: string, targetType: string): string | null => {
                        const allNodes = allOrgChartNodes?.allNodes || []
                        let current = allNodes.find(n => n.id === nodeId)
                        while (current) {
                          if (current.node_type === targetType) {
                            return current.name
                          }
                          if (!current.parent_id) break
                          current = allNodes.find(n => n.id === current?.parent_id)
                        }
                        return null
                      }

                      // Helper to get division/department for a user based on their portfolio memberships
                      const getOrgNodeForUserFromPortfolios = (userId: string, nodeType: 'division' | 'department'): string[] => {
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const nodeLinks = allOrgChartNodes?.nodeLinks || []
                        const result: string[] = []

                        // Check all portfolio memberships for this user
                        allOrgChartNodeMembers?.forEach((userIds, nodeId) => {
                          if (!userIds.includes(userId)) return

                          const ancestorName = findAncestorOfType(nodeId, nodeType)
                          if (ancestorName && !result.includes(ancestorName)) {
                            result.push(ancestorName)
                          }
                        })

                        // Also check linked portfolios
                        nodeLinks.forEach((link: { node_id: string; linked_node_id: string }) => {
                          const portfolioNode = allNodes.find(n => n.id === link.node_id && n.node_type === 'portfolio')
                          if (!portfolioNode) return

                          // Check if user is member of this linked portfolio
                          const userIds = allOrgChartNodeMembers?.get(link.node_id) || []
                          if (!userIds.includes(userId)) return

                          // Find ancestor of target type from the LINKED node
                          const ancestorName = findAncestorOfType(link.linked_node_id, nodeType)
                          if (ancestorName && !result.includes(ancestorName)) {
                            result.push(ancestorName)
                          }
                        })

                        return result
                      }

                      const getGroupKeyForLevel = (coverage: typeof filteredCoverage[0], level: ListGroupByLevel): string => {
                        switch (level) {
                          case 'team': {
                            // Teams are derived from portfolio memberships
                            const teams = getTeamsForUser(coverage.user_id)
                            return teams.length > 0 ? teams[0] : 'Unknown Team'
                          }
                          case 'division':
                          case 'department': {
                            // Division/department derived from portfolio memberships by walking up tree
                            const nodes = getOrgNodeForUserFromPortfolios(coverage.user_id, level)
                            return nodes.length > 0 ? nodes[0] : `Unknown ${level.charAt(0).toUpperCase() + level.slice(1)}`
                          }
                          case 'portfolio': {
                            const userPortfolios = getPortfoliosForUser(coverage.user_id)
                            return userPortfolios.length > 0 ? userPortfolios[0] : 'No Portfolio'
                          }
                          case 'sector':
                            return coverage.assets?.sector || 'Unknown Sector'
                          case 'industry':
                            return (coverage.assets as any)?.industry || 'Unknown Industry'
                          case 'analyst':
                            return coverage.analyst_name || 'Unknown Analyst'
                          default:
                            return 'Other'
                        }
                      }

                      // Special grouping for org nodes (team/division/department) - only shows investment-related nodes
                      const groupByOrgNode = (coverages: typeof filteredCoverage, nodeType: 'team' | 'division' | 'department'): Map<string, typeof filteredCoverage> => {
                        const grouped = new Map<string, typeof filteredCoverage>()
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const nodesOfType = allNodes.filter(n => n.node_type === nodeType)

                        // Helper to check if a node is in the investment hierarchy
                        // A node is investment-related if it's under a division that contains portfolios
                        const isInvestmentNode = (nodeId: string): boolean => {
                          const portfolios = allNodes.filter(n => n.node_type === 'portfolio')
                          const nodeLinks = allOrgChartNodes?.nodeLinks || []

                          // Find all divisions that have portfolios (directly or via links)
                          const investmentDivisionIds = new Set<string>()

                          for (const portfolio of portfolios) {
                            // Walk up from portfolio to find its division
                            let current = portfolio
                            while (current) {
                              if (current.node_type === 'division') {
                                investmentDivisionIds.add(current.id)
                                break
                              }
                              if (!current.parent_id) break
                              current = allNodes.find(n => n.id === current.parent_id) as typeof current
                            }
                          }

                          // Also check linked portfolios
                          for (const link of nodeLinks) {
                            const portfolio = allNodes.find(n => n.id === link.node_id && n.node_type === 'portfolio')
                            if (!portfolio) continue
                            let current = allNodes.find(n => n.id === link.linked_node_id)
                            while (current) {
                              if (current.node_type === 'division') {
                                investmentDivisionIds.add(current.id)
                                break
                              }
                              if (!current.parent_id) break
                              current = allNodes.find(n => n.id === current?.parent_id)
                            }
                          }

                          // Check if the given node is under an investment division
                          const node = allNodes.find(n => n.id === nodeId)
                          if (!node) return false

                          // If it IS a division, check if it's an investment division
                          if (node.node_type === 'division') {
                            return investmentDivisionIds.has(nodeId)
                          }

                          // Otherwise, walk up to find its division
                          let current = node
                          while (current) {
                            if (current.node_type === 'division') {
                              return investmentDivisionIds.has(current.id)
                            }
                            if (!current.parent_id) break
                            current = allNodes.find(n => n.id === current?.parent_id) as typeof current
                          }

                          return false
                        }

                        // Initialize only investment-related nodes of this type
                        nodesOfType.forEach(node => {
                          if (isInvestmentNode(node.id)) {
                            grouped.set(node.name, [])
                          }
                        })

                        // For teams, find members via descendant portfolio memberships
                        if (nodeType === 'team') {
                          // Build a map of user_id -> team names they belong to
                          const userToTeams = new Map<string, string[]>()
                          nodesOfType.forEach(teamNode => {
                            const memberUserIds = getTeamMemberUserIds(teamNode.id)
                            memberUserIds.forEach(userId => {
                              if (!userToTeams.has(userId)) {
                                userToTeams.set(userId, [])
                              }
                              if (!userToTeams.get(userId)!.includes(teamNode.name)) {
                                userToTeams.get(userId)!.push(teamNode.name)
                              }
                            })
                          })

                          // Group coverage by the teams their analysts belong to
                          coverages.forEach(coverage => {
                            const userTeamNames = userToTeams.get(coverage.user_id) || []
                            if (userTeamNames.length > 0) {
                              userTeamNames.forEach(teamName => {
                                if (!grouped.has(teamName)) {
                                  grouped.set(teamName, [])
                                }
                                grouped.get(teamName)?.push(coverage)
                              })
                            } else {
                              if (!grouped.has('Unknown Team')) grouped.set('Unknown Team', [])
                              grouped.get('Unknown Team')?.push(coverage)
                            }
                          })
                          return grouped
                        }

                        // For division/department, derive membership by walking UP from portfolio memberships
                        // Build a map of user_id -> division/department names
                        const userToOrgNodes = new Map<string, string[]>()

                        // For each user's portfolio membership, walk up to find division/department
                        allOrgChartNodeMembers?.forEach((userIds, nodeId) => {
                          const node = allNodes.find(n => n.id === nodeId)
                          if (!node) return

                          // Find the ancestor of the target type
                          const ancestorName = findAncestorOfType(nodeId, nodeType)
                          if (ancestorName) {
                            userIds.forEach(userId => {
                              if (!userToOrgNodes.has(userId)) {
                                userToOrgNodes.set(userId, [])
                              }
                              if (!userToOrgNodes.get(userId)!.includes(ancestorName)) {
                                userToOrgNodes.get(userId)!.push(ancestorName)
                              }
                            })
                          }
                        })

                        // Also check linked portfolios - walk up from linked nodes
                        const nodeLinks = allOrgChartNodes?.nodeLinks || []
                        nodeLinks.forEach((link: { node_id: string; linked_node_id: string }) => {
                          const portfolioNode = allNodes.find(n => n.id === link.node_id && n.node_type === 'portfolio')
                          if (!portfolioNode) return

                          // Find ancestor of target type starting from the LINKED node
                          const ancestorName = findAncestorOfType(link.linked_node_id, nodeType)
                          if (ancestorName) {
                            const userIds = allOrgChartNodeMembers?.get(link.node_id) || []
                            userIds.forEach(userId => {
                              if (!userToOrgNodes.has(userId)) {
                                userToOrgNodes.set(userId, [])
                              }
                              if (!userToOrgNodes.get(userId)!.includes(ancestorName)) {
                                userToOrgNodes.get(userId)!.push(ancestorName)
                              }
                            })
                          }
                        })

                        // Group coverage by the division/department their analysts belong to
                        coverages.forEach(coverage => {
                          const userOrgNodeNames = userToOrgNodes.get(coverage.user_id) || []
                          if (userOrgNodeNames.length > 0) {
                            userOrgNodeNames.forEach(nodeName => {
                              if (!grouped.has(nodeName)) {
                                grouped.set(nodeName, [])
                              }
                              grouped.get(nodeName)?.push(coverage)
                            })
                          } else {
                            const unknownKey = `Unknown ${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}`
                            if (!grouped.has(unknownKey)) grouped.set(unknownKey, [])
                            grouped.get(unknownKey)?.push(coverage)
                          }
                        })

                        return grouped
                      }

                      // Helper to get portfolio node IDs that are under a team (via hierarchy OR links)
                      const getPortfolioNodesUnderTeam = (teamNodeId: string): Set<string> => {
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const nodeLinks = allOrgChartNodes?.nodeLinks || []
                        const portfolioNodeIds = new Set<string>()

                        // 1. Get portfolios that are descendants via parent hierarchy
                        const descendantIds = getAllDescendantNodeIds(teamNodeId)
                        descendantIds.forEach(nodeId => {
                          const node = allNodes.find(n => n.id === nodeId)
                          if (node?.node_type === 'portfolio') {
                            portfolioNodeIds.add(nodeId)
                          }
                        })

                        // 2. Get portfolios that are LINKED to this team (via org_chart_node_links)
                        // Links where linked_node_id is the team - the node_id is the portfolio
                        nodeLinks.forEach((link: { node_id: string; linked_node_id: string }) => {
                          if (link.linked_node_id === teamNodeId) {
                            const node = allNodes.find(n => n.id === link.node_id)
                            if (node?.node_type === 'portfolio') {
                              portfolioNodeIds.add(link.node_id)
                            }
                          }
                        })

                        return portfolioNodeIds
                      }

                      // Helper to get portfolio names that are descendants of a team
                      const getPortfolioNamesUnderTeam = (teamNodeId: string): Set<string> => {
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const portfolioNodeIds = getPortfolioNodesUnderTeam(teamNodeId)
                        const portfolioNames = new Set<string>()

                        portfolioNodeIds.forEach(nodeId => {
                          const node = allNodes.find(n => n.id === nodeId)
                          if (node) {
                            portfolioNames.add(node.name)
                          }
                        })

                        return portfolioNames
                      }

                      // Special grouping for portfolio - shows portfolios with their members' coverage
                      // If teamContext is provided, only show portfolios that are descendants of that team
                      const groupByPortfolio = (coverages: typeof filteredCoverage, teamContext?: string): Map<string, typeof filteredCoverage> => {
                        const grouped = new Map<string, typeof filteredCoverage>()
                        const allNodes = allOrgChartNodes?.allNodes || []

                        // If we have a team context, only show portfolios under that team
                        // Otherwise show all portfolios
                        let relevantPortfolioNames: Set<string>
                        if (teamContext) {
                          relevantPortfolioNames = getPortfolioNamesUnderTeam(teamContext)
                        } else {
                          // Get all portfolio names from org chart nodes
                          relevantPortfolioNames = new Set(
                            allNodes.filter(n => n.node_type === 'portfolio').map(n => n.name)
                          )
                        }

                        // Initialize all relevant portfolios
                        relevantPortfolioNames.forEach(name => {
                          grouped.set(name, [])
                        })

                        // For each coverage, find which portfolios the analyst belongs to (filtered by context)
                        coverages.forEach(coverage => {
                          const userPortfolios = getPortfoliosForUser(coverage.user_id)
                          // Filter to only portfolios relevant to this context
                          const relevantUserPortfolios = userPortfolios.filter(p => relevantPortfolioNames.has(p))

                          if (relevantUserPortfolios.length > 0) {
                            relevantUserPortfolios.forEach(portfolioName => {
                              if (!grouped.has(portfolioName)) {
                                grouped.set(portfolioName, [])
                              }
                              grouped.get(portfolioName)?.push(coverage)
                            })
                          } else if (!teamContext) {
                            // Only add to "No Portfolio" if we're not in a team context
                            // (In team context, the coverage is already filtered to team members)
                            if (!grouped.has('No Portfolio')) grouped.set('No Portfolio', [])
                            grouped.get('No Portfolio')?.push(coverage)
                          }
                        })

                        return grouped
                      }

                      // Sort groups function
                      const sortGroups = (entries: [string, any][]): [string, any][] => {
                        return entries.sort((a, b) => {
                          const aIsUnknown = a[0].startsWith('Unknown') || a[0].startsWith('No ')
                          const bIsUnknown = b[0].startsWith('Unknown') || b[0].startsWith('No ')
                          if (aIsUnknown && !bIsUnknown) return 1
                          if (!aIsUnknown && bIsUnknown) return -1
                          return a[0].localeCompare(b[0])
                        })
                      }

                      // Render a coverage row
                      const renderCoverageRow = (coverage: typeof filteredCoverage[0], keyPrefix: string, indent: number) => (
                        <div key={`${keyPrefix}-${coverage.id}`} className="px-6 py-3 hover:bg-gray-50 transition-colors" style={{ paddingLeft: `${24 + indent * 16}px` }}>
                          <div className="grid gap-2 items-center" style={{ gridTemplateColumns: `repeat(${totalColumnWidth}, minmax(0, 1fr))` }}>
                            {listVisibleColumns.map(colId => {
                              const col = listColumnDefinitions[colId]
                              return (
                                <div key={colId} style={{ gridColumn: `span ${col.width}` }} className="min-w-0">
                                  {colId === 'asset' && (
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-gray-900 truncate">{coverage.assets?.symbol || 'Unknown'}</p>
                                      <p className="text-xs text-gray-500 truncate" title={coverage.assets?.company_name}>{coverage.assets?.company_name || 'Unknown'}</p>
                                    </div>
                                  )}
                                  {colId === 'analyst' && <span className="text-sm text-gray-700 truncate block">{coverage.analyst_name}</span>}
                                  {colId === 'visibility' && (
                                    <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full',
                                      coverage.visibility === 'firm' && 'bg-purple-100 text-purple-800',
                                      coverage.visibility === 'division' && 'bg-blue-100 text-blue-800',
                                      (!coverage.visibility || coverage.visibility === 'team') && 'bg-green-100 text-green-700'
                                    )}>
                                      {coverage.visibility === 'firm' ? <Building2 className="h-2.5 w-2.5" /> : coverage.visibility === 'division' ? <FolderOpen className="h-2.5 w-2.5" /> : <Users className="h-2.5 w-2.5" />}
                                      {coverage.visibility === 'firm' ? 'Firm' : coverage.visibility === 'division' ? 'Div' : 'Team'}
                                    </span>
                                  )}
                                  {colId === 'sector' && <span className="text-xs text-gray-600 truncate block">{coverage.assets?.sector || '—'}</span>}
                                  {colId === 'startDate' && <span className="text-xs text-gray-600">{coverage.start_date ? new Date(coverage.start_date).toLocaleDateString() : '—'}</span>}
                                  {colId === 'tenure' && (
                                    <span className={clsx('text-xs px-1.5 py-0.5 rounded',
                                      calculateTenure(coverage.start_date).days < 90 && 'bg-yellow-50 text-yellow-700',
                                      calculateTenure(coverage.start_date).days >= 90 && calculateTenure(coverage.start_date).days < 365 && 'bg-blue-50 text-blue-700',
                                      calculateTenure(coverage.start_date).days >= 365 && 'bg-green-50 text-green-700'
                                    )}>{calculateTenure(coverage.start_date).label}</span>
                                  )}
                                  {colId === 'industry' && <span className="text-xs text-gray-600 truncate block">{(coverage.assets as any)?.industry || '—'}</span>}
                                  {colId === 'marketCap' && <span className="text-xs text-gray-600">{formatMarketCap((coverage.assets as any)?.market_cap)}</span>}
                                </div>
                              )
                            })}
                            <div style={{ gridColumn: 'span 1' }} className="text-right">
                              <button onClick={() => setViewHistoryAssetId(coverage.assets?.id || null)} className="p-1 text-gray-400 hover:text-primary-600 transition-colors" title="View Coverage Timeline">
                                <History className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )

                      // Helper to find team node ID by name
                      const getTeamNodeIdByName = (teamName: string): string | undefined => {
                        const allNodes = allOrgChartNodes?.allNodes || []
                        const teamNode = allNodes.find(n => n.node_type === 'team' && n.name === teamName)
                        return teamNode?.id
                      }

                      // Render nested groups recursively
                      // teamContext: when we're inside a team group, this is the team node ID for filtering portfolios
                      const renderNestedGroups = (
                        coverages: typeof filteredCoverage,
                        levels: ListGroupByLevel[],
                        depth: number,
                        keyPrefix: string,
                        teamContext?: string
                      ): React.ReactNode => {
                        if (levels.length === 0) {
                          // No more levels - render coverage items
                          return coverages.map(coverage => renderCoverageRow(coverage, keyPrefix, depth))
                        }

                        const currentLevel = levels[0]
                        const remainingLevels = levels.slice(1)

                        // Group coverages by current level
                        // Use special grouping functions for org nodes and portfolios to show ALL groups
                        const grouped = (() => {
                          if (currentLevel === 'portfolio') {
                            // Pass team context to filter portfolios to only those under the current team
                            return groupByPortfolio(coverages, teamContext)
                          }
                          if (currentLevel === 'team' || currentLevel === 'division' || currentLevel === 'department') {
                            return groupByOrgNode(coverages, currentLevel)
                          }
                          // Default grouping for sector, industry, analyst
                          const map = new Map<string, typeof filteredCoverage>()
                          coverages.forEach(coverage => {
                            const key = getGroupKeyForLevel(coverage, currentLevel)
                            if (!map.has(key)) map.set(key, [])
                            map.get(key)?.push(coverage)
                          })
                          return map
                        })()

                        const sortedGroups = sortGroups(Array.from(grouped.entries()))

                        // Calculate total count including nested items
                        const getTotalCount = (items: typeof filteredCoverage): number => items.length

                        // Filter out hidden groups and optionally empty groups
                        const visibleGroups = sortedGroups.filter(([groupKey, groupCoverages]) => {
                          const fullKey = `${keyPrefix}-${groupKey}`
                          if (hiddenGroups.has(`list-${fullKey}`)) return false
                          if (hideEmptyGroups && groupCoverages.length === 0) return false
                          return true
                        })

                        return visibleGroups.map(([groupKey, groupCoverages]) => {
                          const fullKey = `${keyPrefix}-${groupKey}`
                          const isCollapsed = collapsedGroups.has(`list-${fullKey}`)
                          const bgColors = ['bg-gray-100', 'bg-gray-50', 'bg-white']
                          const bgColor = bgColors[Math.min(depth, bgColors.length - 1)]

                          return (
                            <div key={fullKey}>
                              <button
                                onClick={() => {
                                  setCollapsedGroups(prev => {
                                    const next = new Set(prev)
                                    const k = `list-${fullKey}`
                                    if (next.has(k)) next.delete(k)
                                    else next.add(k)
                                    return next
                                  })
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  setGroupContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    groupKey: `list-${fullKey}`,
                                    groupName: groupKey
                                  })
                                }}
                                className={clsx("w-full py-2 border-b border-gray-200 hover:bg-gray-150 transition-colors cursor-pointer text-left", bgColor)}
                                style={{ paddingLeft: `${24 + depth * 16}px`, paddingRight: '24px' }}
                              >
                                <div className="flex items-center gap-2">
                                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
                                  <span className={clsx("font-semibold", depth === 0 ? "text-sm text-gray-700" : "text-xs text-gray-600")}>
                                    {groupKey}
                                  </span>
                                  <span className="text-xs text-gray-500">({getTotalCount(groupCoverages)})</span>
                                </div>
                              </button>
                              {!isCollapsed && groupCoverages.length === 0 && (
                                <div className="py-4 text-sm text-gray-500 italic" style={{ paddingLeft: `${24 + (depth + 1) * 16}px` }}>
                                  No coverage
                                </div>
                              )}
                              {!isCollapsed && (() => {
                                // If we just grouped by team, pass the team node ID as context for portfolio filtering
                                let newTeamContext = teamContext
                                if (currentLevel === 'team') {
                                  newTeamContext = getTeamNodeIdByName(groupKey)
                                }
                                return renderNestedGroups(groupCoverages, remainingLevels, depth + 1, fullKey, newTeamContext)
                              })()}
                            </div>
                          )
                        })
                      }

                      // Multi-level grouping
                      if (listGroupByLevels.length > 0) {
                        return renderNestedGroups(filteredCoverage, listGroupByLevels, 0, 'root', undefined)
                      }

                      // Default: no grouping (flat list)
                      return filteredCoverage.map((coverage) => (
                        <div key={coverage.id} className="px-6 py-3 hover:bg-gray-50 transition-colors">
                          <div className="grid gap-2 items-center" style={{ gridTemplateColumns: `repeat(${totalColumnWidth}, minmax(0, 1fr))` }}>
                            {listVisibleColumns.map(colId => {
                              const col = listColumnDefinitions[colId]
                              return (
                                <div key={colId} style={{ gridColumn: `span ${col.width}` }} className="min-w-0">
                                  {colId === 'asset' && (
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-gray-900 truncate">
                                        {coverage.assets?.symbol || 'Unknown'}
                                      </p>
                                      <p className="text-xs text-gray-500 truncate" title={coverage.assets?.company_name}>
                                        {coverage.assets?.company_name || 'Unknown'}
                                      </p>
                                    </div>
                                  )}
                                {colId === 'analyst' && (
                                  <span className="text-sm text-gray-700 truncate block">
                                    {coverage.analyst_name}
                                  </span>
                                )}
                                {colId === 'visibility' && (
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
                                    >
                                      {coverage.visibility === 'firm' ? <Building2 className="h-2.5 w-2.5" /> : coverage.visibility === 'division' ? <FolderOpen className="h-2.5 w-2.5" /> : <Users className="h-2.5 w-2.5" />}
                                      {coverage.visibility === 'firm' ? 'Firm' : coverage.visibility === 'division' ? 'Div' : 'Team'}
                                    </button>
                                    {editingVisibility?.coverageId === coverage.id && (
                                      <>
                                        <div className="fixed inset-0 z-30" onClick={() => setEditingVisibility(null)} />
                                        <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px]">
                                          {[
                                            { value: 'team', label: 'Team Only', icon: Users, color: 'text-green-600 bg-green-50' },
                                            { value: 'division', label: 'Division', icon: FolderOpen, color: 'text-blue-600 bg-blue-50' },
                                            { value: 'firm', label: 'Firm-wide', icon: Building2, color: 'text-purple-600 bg-purple-50' },
                                          ].map((option) => (
                                            <button
                                              key={option.value}
                                              onClick={() => updateVisibilityMutation.mutate({ coverageId: coverage.id, visibility: option.value as 'team' | 'division' | 'firm' })}
                                              className={clsx('w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-3', coverage.visibility === option.value && 'bg-gray-50')}
                                            >
                                              <div className={clsx('p-1.5 rounded-md', option.color)}><option.icon className="h-3.5 w-3.5" /></div>
                                              <span className="text-sm font-medium text-gray-900">{option.label}</span>
                                              {coverage.visibility === option.value && <Check className="h-4 w-4 text-primary-600 ml-auto" />}
                                            </button>
                                          ))}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                                {colId === 'sector' && (
                                  <span className="text-xs text-gray-600 truncate block">{coverage.assets?.sector || '—'}</span>
                                )}
                                {colId === 'startDate' && (
                                  <span className="text-xs text-gray-600">{coverage.start_date ? new Date(coverage.start_date).toLocaleDateString() : '—'}</span>
                                )}
                                {colId === 'tenure' && (
                                  <span className={clsx(
                                    'text-xs px-1.5 py-0.5 rounded',
                                    calculateTenure(coverage.start_date).days < 90 && 'bg-yellow-50 text-yellow-700',
                                    calculateTenure(coverage.start_date).days >= 90 && calculateTenure(coverage.start_date).days < 365 && 'bg-blue-50 text-blue-700',
                                    calculateTenure(coverage.start_date).days >= 365 && 'bg-green-50 text-green-700'
                                  )}>
                                    {calculateTenure(coverage.start_date).label}
                                  </span>
                                )}
                                {colId === 'industry' && (
                                  <span className="text-xs text-gray-600 truncate block">{(coverage.assets as any)?.industry || '—'}</span>
                                )}
                                {colId === 'marketCap' && (
                                  <span className="text-xs text-gray-600">{formatMarketCap((coverage.assets as any)?.market_cap)}</span>
                                )}
                              </div>
                            )
                          })}
                          {/* Actions Column */}
                          <div style={{ gridColumn: 'span 1' }} className="text-right">
                            <button
                              onClick={() => setViewHistoryAssetId(coverage.assets?.id || null)}
                              className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                              title="View Coverage Timeline"
                            >
                              <History className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                    })()}

                    {/* Not Covered Section - Hidden when filtering by team/portfolio */}
                    {uncoveredAssets.length > 0 && listGroupByLevels.length === 0 && (
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
                          <div key={asset.id} className="px-6 py-3 bg-amber-50/30 hover:bg-amber-50 transition-colors">
                            <div className="grid gap-2 items-center" style={{ gridTemplateColumns: `repeat(${totalColumnWidth}, minmax(0, 1fr))` }}>
                              {listVisibleColumns.map(colId => {
                                const col = listColumnDefinitions[colId]
                                return (
                                  <div key={colId} style={{ gridColumn: `span ${col.width}` }} className="min-w-0">
                                    {colId === 'asset' && (
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-gray-900 truncate">{asset.symbol}</p>
                                        <p className="text-xs text-gray-500 truncate" title={asset.company_name}>{asset.company_name}</p>
                                      </div>
                                    )}
                                    {colId === 'analyst' && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                        No Coverage
                                      </span>
                                    )}
                                    {colId === 'visibility' && <span className="text-xs text-gray-400">—</span>}
                                    {colId === 'sector' && <span className="text-xs text-gray-600 truncate block">{asset.sector || '—'}</span>}
                                    {colId === 'portfolio' && <span className="text-xs text-gray-400">—</span>}
                                    {colId === 'team' && <span className="text-xs text-gray-400">—</span>}
                                    {colId === 'startDate' && <span className="text-xs text-gray-400">—</span>}
                                    {colId === 'tenure' && <span className="text-xs text-gray-400">—</span>}
                                    {colId === 'industry' && <span className="text-xs text-gray-600 truncate block">{(asset as any)?.industry || '—'}</span>}
                                    {colId === 'marketCap' && <span className="text-xs text-gray-600">{formatMarketCap((asset as any)?.market_cap)}</span>}
                                  </div>
                                )
                              })}
                              {/* Actions Column */}
                              <div style={{ gridColumn: 'span 1' }} className="text-right">
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
                                    }}
                                    className="px-2 py-1 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md"
                                  >
                                    Add
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
                                    className="px-2 py-1 text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-md"
                                  >
                                    Request
                                  </button>
                                )}
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

              {/* Gaps View - Shows uncovered assets */}
              {viewMode === 'gaps' && (
              <Card padding="none" className="h-[calc(90vh-280px)] flex flex-col overflow-hidden">
                {gapsLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : (
                  <>
                    {/* Header */}
                    <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-gray-900">
                          Coverage Gaps
                        </h3>
                        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                          {listGroupByLevels.includes('portfolio')
                            ? (() => {
                                const totalGaps = portfolioUniverseData?.reduce((sum, p) => sum + p.assets.length, 0) || 0
                                if (searchQuery && portfolioUniverseData) {
                                  const filteredGaps = portfolioUniverseData.reduce((sum, p) => {
                                    return sum + p.assets.filter(a =>
                                      a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                      a.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                      (a.sector && a.sector.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                      (a.industry && a.industry.toLowerCase().includes(searchQuery.toLowerCase()))
                                    ).length
                                  }, 0)
                                  return `${filteredGaps}/${totalGaps} uncovered in universes`
                                }
                                return `${totalGaps} uncovered in universes`
                              })()
                            : (() => {
                                const totalGaps = gapsData?.length || 0
                                if (searchQuery && gapsData) {
                                  const filteredGaps = gapsData.filter((a: any) =>
                                    a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                    a.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                    (a.sector && a.sector.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                    (a.industry && a.industry.toLowerCase().includes(searchQuery.toLowerCase()))
                                  ).length
                                  if (filteredGaps !== totalGaps) {
                                    return `${filteredGaps}/${totalGaps} uncovered`
                                  }
                                }
                                return `${totalGaps} uncovered`
                              })()}
                        </span>
                      </div>
                    </div>

                    {/* Portfolio-based gaps view */}
                    {listGroupByLevels.includes('portfolio') ? (
                      <div className="flex-1 overflow-y-auto">
                        {!portfolioUniverseData || portfolioUniverseData.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <Briefcase className="h-12 w-12 text-gray-300 mb-3" />
                            <p className="text-sm font-medium">No portfolio universes defined</p>
                            <p className="text-xs text-gray-400 mt-1">
                              Define investable universes in portfolios to see coverage gaps.
                            </p>
                          </div>
                        ) : (
                          <div>
                            {portfolioUniverseData.map((portfolioData) => {
                              // Filter assets by search query
                              const filteredAssets = searchQuery
                                ? portfolioData.assets.filter(asset =>
                                    asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                    asset.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                    (asset.sector && asset.sector.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                    (asset.industry && asset.industry.toLowerCase().includes(searchQuery.toLowerCase()))
                                  )
                                : portfolioData.assets
                              const isCollapsed = collapsedGapsGroups.has(portfolioData.portfolio.id)
                              const gapCount = filteredAssets.length
                              const totalGapCount = portfolioData.assets.length
                              const coveragePercent = portfolioData.universeSize > 0
                                ? Math.round(((portfolioData.universeSize - totalGapCount) / portfolioData.universeSize) * 100)
                                : 100
                              return (
                                <div key={portfolioData.portfolio.id} className="border-b border-gray-200 last:border-b-0">
                                  <button
                                    onClick={() => {
                                      setCollapsedGapsGroups(prev => {
                                        const next = new Set(prev)
                                        if (next.has(portfolioData.portfolio.id)) next.delete(portfolioData.portfolio.id)
                                        else next.add(portfolioData.portfolio.id)
                                        return next
                                      })
                                    }}
                                    className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-150 flex items-center gap-2 text-left"
                                  >
                                    {isCollapsed ? (
                                      <ChevronRight className="h-4 w-4 text-gray-500" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4 text-gray-500" />
                                    )}
                                    <Briefcase className="h-4 w-4 text-gray-500" />
                                    <span className="text-sm font-medium text-gray-900">{portfolioData.portfolio.name}</span>
                                    {totalGapCount === 0 ? (
                                      <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                        <CheckCircle className="h-3 w-3" />
                                        100% covered
                                      </span>
                                    ) : (
                                      <>
                                        <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                                          {searchQuery && gapCount !== totalGapCount
                                            ? `${gapCount}/${totalGapCount} gaps`
                                            : `${totalGapCount} gap${totalGapCount !== 1 ? 's' : ''}`}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                          ({coveragePercent}% covered of {portfolioData.universeSize})
                                        </span>
                                      </>
                                    )}
                                  </button>
                                  {!isCollapsed && (
                                    !portfolioData.hasUniverseDefinition ? (
                                      <div className="px-6 py-4 text-center text-gray-500">
                                        <p className="text-sm">No investable universe defined for this portfolio</p>
                                      </div>
                                    ) : gapCount === 0 ? (
                                      <div className="px-6 py-4 text-center text-gray-500">
                                        <p className="text-sm text-green-600">
                                          {searchQuery
                                            ? `No gaps matching "${searchQuery}"`
                                            : `All ${portfolioData.universeSize} assets in the investable universe are covered!`}
                                        </p>
                                      </div>
                                    ) : (
                                      <div className="divide-y divide-gray-100">
                                        {filteredAssets.map((asset) => (
                                          <div
                                            key={asset.id}
                                            className="px-6 py-3 hover:bg-gray-50 grid grid-cols-12 gap-4 items-center"
                                          >
                                            <div className="col-span-4">
                                              <div className="flex items-center gap-2">
                                                <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                                <div>
                                                  <p className="text-sm font-medium text-gray-900">{asset.symbol}</p>
                                                  <p className="text-xs text-gray-500 truncate">{asset.company_name}</p>
                                                </div>
                                              </div>
                                            </div>
                                            <div className="col-span-3">
                                              <span className="text-sm text-gray-600">{asset.sector || '-'}</span>
                                            </div>
                                            <div className="col-span-2">
                                              <span className="text-sm text-gray-600">
                                                {asset.market_cap ? `$${(asset.market_cap / 1e9).toFixed(1)}B` : '-'}
                                              </span>
                                            </div>
                                            <div className="col-span-3">
                                              {hasAnyCoverageAdminRights && (
                                                <Button
                                                  size="sm"
                                                  variant="outline"
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
                                                    setAssetSearchQuery(asset.symbol)
                                                  }}
                                                  className="text-xs"
                                                >
                                                  <Plus className="h-3 w-3 mr-1" />
                                                  Add Coverage
                                                </Button>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                    <>
                    {/* Derive gaps grouping from main groupings - only sector/industry apply to uncovered assets */}
                    {(() => {
                      const gapsGrouping = listGroupByLevels.find(level => level === 'sector' || level === 'industry') || null
                      // Filter gaps data by search query
                      const filteredGapsData = searchQuery && gapsData
                        ? gapsData.filter((asset: any) =>
                            asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            asset.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (asset.sector && asset.sector.toLowerCase().includes(searchQuery.toLowerCase())) ||
                            (asset.industry && asset.industry.toLowerCase().includes(searchQuery.toLowerCase()))
                          )
                        : gapsData || []

                      // When searching, also find covered assets that match
                      const matchingCoveredAssets = searchQuery && allAssetsWithStatus
                        ? allAssetsWithStatus.filter((asset: any) =>
                            asset.isCovered && (
                              asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              asset.company_name.toLowerCase().includes(searchQuery.toLowerCase())
                            )
                          )
                        : []

                      return (
                        <>
                    {/* Table Header - only show when not grouped */}
                    {!gapsGrouping && (
                      <div className="px-6 py-2 bg-gray-50 border-b border-gray-200">
                        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                          <div className="col-span-3">Asset</div>
                          <div className="col-span-2">Sector</div>
                          <div className="col-span-2">Industry</div>
                          <div className="col-span-2">Market Cap</div>
                          <div className="col-span-3">Status</div>
                        </div>
                      </div>
                    )}

                    {/* Table Body */}
                    <div className="flex-1 overflow-y-auto">
                      {!gapsData || gapsData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                          <CheckCircle className="h-12 w-12 text-green-400 mb-3" />
                          <p className="text-sm font-medium">All assets are covered!</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Every asset in the system has active coverage.
                          </p>
                        </div>
                      ) : filteredGapsData.length === 0 && matchingCoveredAssets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                          <Search className="h-12 w-12 text-gray-300 mb-3" />
                          <p className="text-sm font-medium">No assets matching "{searchQuery}"</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Try a different search term.
                          </p>
                        </div>
                      ) : !gapsGrouping ? (
                        <div className="divide-y divide-gray-100">
                          {filteredGapsData.map((asset: any) => (
                            <div
                              key={asset.id}
                              className="px-6 py-3 hover:bg-gray-50 grid grid-cols-12 gap-4 items-center"
                            >
                              <div className="col-span-3">
                                <div className="flex items-center gap-2">
                                  <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">{asset.symbol}</p>
                                    <p className="text-xs text-gray-500 truncate">{asset.company_name}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="col-span-2">
                                <span className="text-sm text-gray-600">{asset.sector || '-'}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-sm text-gray-600">{asset.industry || '-'}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-sm text-gray-600">
                                  {asset.market_cap ? `$${(asset.market_cap / 1e9).toFixed(1)}B` : '-'}
                                </span>
                              </div>
                              <div className="col-span-3">
                                {hasAnyCoverageAdminRights && (
                                  <Button
                                    size="sm"
                                    variant="outline"
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
                                      setAssetSearchQuery(asset.symbol)
                                    }}
                                    className="text-xs"
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Coverage
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                          {/* Show covered assets that match search */}
                          {matchingCoveredAssets.map((asset: any) => (
                            <div
                              key={asset.id}
                              className="px-6 py-3 hover:bg-gray-50 grid grid-cols-12 gap-4 items-center bg-green-50/50"
                            >
                              <div className="col-span-3">
                                <div className="flex items-center gap-2">
                                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">{asset.symbol}</p>
                                    <p className="text-xs text-gray-500 truncate">{asset.company_name}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="col-span-2">
                                <span className="text-sm text-gray-600">{asset.sector || '-'}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-sm text-gray-600">{asset.industry || '-'}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-sm text-gray-600">
                                  {asset.market_cap ? `$${(asset.market_cap / 1e9).toFixed(1)}B` : '-'}
                                </span>
                              </div>
                              <div className="col-span-3">
                                <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full">
                                  Covered
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        // Grouped view
                        <div>
                          {(() => {
                            // Group filtered assets by selected field
                            const grouped = new Map<string, typeof filteredGapsData>()
                            filteredGapsData.forEach((asset: any) => {
                              const key = asset[gapsGrouping!] || `Unknown ${gapsGrouping!.charAt(0).toUpperCase() + gapsGrouping!.slice(1)}`
                              if (!grouped.has(key)) grouped.set(key, [])
                              grouped.get(key)!.push(asset)
                            })

                            // Sort groups by name
                            const sortedGroups = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))

                            return sortedGroups.map(([groupName, assets]) => {
                              const isCollapsed = collapsedGapsGroups.has(groupName)
                              return (
                                <div key={groupName} className="border-b border-gray-200 last:border-b-0">
                                  <button
                                    onClick={() => {
                                      setCollapsedGapsGroups(prev => {
                                        const next = new Set(prev)
                                        if (next.has(groupName)) next.delete(groupName)
                                        else next.add(groupName)
                                        return next
                                      })
                                    }}
                                    className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-150 flex items-center gap-2 text-left"
                                  >
                                    {isCollapsed ? (
                                      <ChevronRight className="h-4 w-4 text-gray-500" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4 text-gray-500" />
                                    )}
                                    <span className="text-sm font-medium text-gray-900">{groupName}</span>
                                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                                      {assets.length}
                                    </span>
                                  </button>
                                  {!isCollapsed && (
                                    <div className="divide-y divide-gray-100">
                                      {assets.map((asset: any) => (
                                        <div
                                          key={asset.id}
                                          className="px-6 py-3 hover:bg-gray-50 grid grid-cols-12 gap-4 items-center"
                                        >
                                          <div className="col-span-4">
                                            <div className="flex items-center gap-2">
                                              <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                              <div>
                                                <p className="text-sm font-medium text-gray-900">{asset.symbol}</p>
                                                <p className="text-xs text-gray-500 truncate">{asset.company_name}</p>
                                              </div>
                                            </div>
                                          </div>
                                          <div className="col-span-3">
                                            <span className="text-sm text-gray-600">
                                              {gapsGrouping === 'sector' ? (asset.industry || '-') : (asset.sector || '-')}
                                            </span>
                                          </div>
                                          <div className="col-span-2">
                                            <span className="text-sm text-gray-600">
                                              {asset.market_cap ? `$${(asset.market_cap / 1e9).toFixed(1)}B` : '-'}
                                            </span>
                                          </div>
                                          <div className="col-span-3">
                                            {hasAnyCoverageAdminRights && (
                                              <Button
                                                size="sm"
                                                variant="outline"
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
                                                  setAssetSearchQuery(asset.symbol)
                                                }}
                                                className="text-xs"
                                              >
                                                <Plus className="h-3 w-3 mr-1" />
                                                Add Coverage
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })
                          })()}
                        </div>
                      )}
                    </div>
                        </>
                      )
                    })()}
                    </>
                    )}
                  </>
                )}
              </Card>
              )}

              {/* Workload View */}
              {viewMode === 'workload' && (
                <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 mt-4">
                  {(() => {
                    // Calculate workload data once for the entire view
                    const analystWorkload = new Map<string, {
                      id: string
                      name: string
                      count: number
                      primaryCount: number
                      secondaryCount: number
                      tertiaryCount: number
                      portfolios: Map<string, { name: string; count: number }>
                      teams: Map<string, { name: string; count: number }>
                      sectors: string[] // From user profile settings
                    }>()

                    // Helper to get portfolios for a user from portfolio_team memberships
                    const getAnalystPortfolios = (userId: string): Array<{id: string, name: string}> => {
                      const portfolioNames = portfolioTeamMemberships?.get(userId) || []
                      const allNodes = allOrgChartNodes?.allNodes || []
                      return portfolioNames.map(name => {
                        const node = allNodes.find(n => n.node_type === 'portfolio' && n.name === name)
                        return { id: node?.id || name, name }
                      })
                    }

                    // Helper to get teams for a user from org chart
                    const getAnalystTeams = (userId: string): Array<{id: string, name: string}> => {
                      const allNodes = allOrgChartNodes?.allNodes || []
                      const teamNodes = allNodes.filter(n => n.node_type === 'team')
                      const result: Array<{id: string, name: string}> = []

                      teamNodes.forEach(teamNode => {
                        // Check if user is a member of this team (direct membership)
                        const directMembers = userTeamMemberships?.get(userId) || []
                        const isDirectMember = directMembers.some(m => m.nodeId === teamNode.id)

                        // Check if user is in any portfolio linked to this team
                        const nodeLinks = allOrgChartNodes?.nodeLinks || []
                        const linkedPortfolios = nodeLinks
                          .filter(link => link.linked_node_id === teamNode.id)
                          .map(link => {
                            const portfolioNode = allNodes.find(n => n.id === link.node_id && n.node_type === 'portfolio')
                            return portfolioNode?.name
                          })
                          .filter(Boolean)

                        const userPortfolioNames = portfolioTeamMemberships?.get(userId) || []
                        const isViaPortfolio = linkedPortfolios.some(pName => userPortfolioNames.includes(pName!))

                        if (isDirectMember || isViaPortfolio) {
                          result.push({ id: teamNode.id, name: teamNode.name })
                        }
                      })

                      return result
                    }

                    filteredCoverage.forEach(coverage => {
                      const analystId = coverage.user_id || 'unknown'
                      const existing = analystWorkload.get(analystId)
                      const role = coverage.role || null

                      // Get analyst's portfolios and teams from org chart memberships
                      const analystPortfolios = getAnalystPortfolios(analystId)
                      const analystTeams = getAnalystTeams(analystId)

                      if (existing) {
                        existing.count++
                        if (role === 'primary') existing.primaryCount++
                        else if (role === 'secondary') existing.secondaryCount++
                        else if (role === 'tertiary') existing.tertiaryCount++
                        // Add coverage to all analyst's portfolios
                        analystPortfolios.forEach(portfolio => {
                          const p = existing.portfolios.get(portfolio.id)
                          if (p) p.count++
                          else existing.portfolios.set(portfolio.id, { name: portfolio.name, count: 1 })
                        })
                        // Add coverage to all analyst's teams
                        analystTeams.forEach(team => {
                          const t = existing.teams.get(team.id)
                          if (t) t.count++
                          else existing.teams.set(team.id, { name: team.name, count: 1 })
                        })
                      } else {
                        const portfolios = new Map<string, { name: string; count: number }>()
                        const teams = new Map<string, { name: string; count: number }>()
                        analystPortfolios.forEach(portfolio => {
                          portfolios.set(portfolio.id, { name: portfolio.name, count: 1 })
                        })
                        analystTeams.forEach(team => {
                          teams.set(team.id, { name: team.name, count: 1 })
                        })
                        analystWorkload.set(analystId, {
                          id: analystId,
                          name: coverage.analyst_name,
                          count: 1,
                          primaryCount: role === 'primary' ? 1 : 0,
                          secondaryCount: role === 'secondary' ? 1 : 0,
                          tertiaryCount: role === 'tertiary' ? 1 : 0,
                          portfolios,
                          teams,
                          sectors: userProfilesExtended?.get(analystId) || []
                        })
                      }
                    })

                    const analystEntries = Array.from(analystWorkload.entries())
                    const totalAnalysts = analystEntries.length
                    const avgCoverage = totalAnalysts > 0
                      ? analystEntries.reduce((sum, [, a]) => sum + a.count, 0) / totalAnalysts
                      : 0
                    const maxCoverage = totalAnalysts > 0
                      ? Math.max(...analystEntries.map(([, a]) => a.count))
                      : 0

                    // Calculate total assets in each portfolio/team for percentage calculations
                    const totalByPortfolio = new Map<string, { name: string; count: number }>()
                    const totalByTeam = new Map<string, { name: string; count: number }>()
                    filteredCoverage.forEach(c => {
                      // Get analyst's portfolios and teams from org chart memberships
                      const analystPortfolios = getAnalystPortfolios(c.user_id)
                      const analystTeams = getAnalystTeams(c.user_id)

                      analystPortfolios.forEach(portfolio => {
                        const p = totalByPortfolio.get(portfolio.id)
                        if (p) p.count++
                        else totalByPortfolio.set(portfolio.id, { name: portfolio.name, count: 1 })
                      })

                      analystTeams.forEach(team => {
                        const t = totalByTeam.get(team.id)
                        if (t) t.count++
                        else totalByTeam.set(team.id, { name: team.name, count: 1 })
                      })
                    })

                    const getWorkloadLevel = (count: number) => {
                      if (avgCoverage === 0) return { level: 'normal', color: 'bg-green-500', label: 'Balanced', textColor: 'text-green-700', bgColor: 'bg-green-100' }
                      const ratio = count / avgCoverage
                      if (ratio <= 0.7) return { level: 'light', color: 'bg-blue-400', label: 'Below Average', textColor: 'text-blue-700', bgColor: 'bg-blue-100' }
                      if (ratio <= 1.2) return { level: 'normal', color: 'bg-green-500', label: 'Balanced', textColor: 'text-green-700', bgColor: 'bg-green-100' }
                      if (ratio <= 1.5) return { level: 'moderate', color: 'bg-amber-500', label: 'Above Average', textColor: 'text-amber-700', bgColor: 'bg-amber-100' }
                      return { level: 'extended', color: 'bg-red-500', label: 'Above Average', textColor: 'text-red-700', bgColor: 'bg-red-100' }
                    }

                    // Count analysts in each workload category
                    const workloadCounts = { light: 0, normal: 0, moderate: 0, extended: 0 }
                    analystEntries.forEach(([, a]) => {
                      const wl = getWorkloadLevel(a.count)
                      workloadCounts[wl.level as keyof typeof workloadCounts]++
                    })

                    const sortedAnalysts = analystEntries.sort((a, b) => b[1].count - a[1].count)

                    // Get analysts by workload category
                    const analystsByCategory = {
                      light: sortedAnalysts.filter(([, a]) => getWorkloadLevel(a.count).level === 'light'),
                      normal: sortedAnalysts.filter(([, a]) => getWorkloadLevel(a.count).level === 'normal'),
                      moderate: sortedAnalysts.filter(([, a]) => getWorkloadLevel(a.count).level === 'moderate'),
                      extended: sortedAnalysts.filter(([, a]) => getWorkloadLevel(a.count).level === 'extended')
                    }

                    return (
                      <>
                        {/* Analyst List - Left Panel (Compact) */}
                        <div className="col-span-12 lg:col-span-2 flex flex-col min-h-0">
                          <Card className="flex flex-col h-full overflow-hidden">
                            <div className="px-3 py-2 border-b border-gray-200 flex-shrink-0 bg-gray-50">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Analysts ({totalAnalysts})</p>
                            </div>
                            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                              {sortedAnalysts.map(([analystId, analyst]) => {
                                const workload = getWorkloadLevel(analyst.count)

                                return (
                                  <div
                                    key={analystId}
                                    onClick={() => {
                                      setSelectedAnalystId(selectedAnalystId === analystId ? null : analystId)
                                      setSelectedStatCard(null)
                                    }}
                                    className={clsx(
                                      'px-3 py-2 cursor-pointer transition-all flex items-center justify-between',
                                      selectedAnalystId === analystId
                                        ? 'bg-primary-50 border-l-2 border-l-primary-500'
                                        : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                                    )}
                                  >
                                    <p className={clsx('text-sm font-medium truncate flex-1', workload.textColor)}>{analyst.name}</p>
                                    <span className={clsx(
                                      'text-sm font-bold ml-2 flex-shrink-0',
                                      workload.textColor
                                    )}>
                                      {analyst.count}
                                    </span>
                                  </div>
                                )
                              })}
                              {filteredCoverage.length === 0 && (
                                <div className="text-center py-4 text-gray-400 text-xs">
                                  No data
                                </div>
                              )}
                            </div>
                          </Card>
                        </div>

                        {/* Right Panel (Wider) */}
                        <div className="col-span-12 lg:col-span-10 flex flex-col min-h-0 gap-4">
                          {/* Summary Stats - Larger, Clickable */}
                          <div className="grid grid-cols-3 gap-3 flex-shrink-0">
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
                                <div className="p-2 bg-gray-100 rounded-lg">
                                  <Users className="h-5 w-5 text-gray-600" />
                                </div>
                                <div>
                                  <p className="text-3xl font-bold text-gray-900">{totalAnalysts}</p>
                                  <p className="text-xs text-gray-500">Total Analysts</p>
                                </div>
                              </div>
                            </Card>
                            <Card
                              className={clsx(
                                "p-4 cursor-pointer transition-all hover:shadow-md",
                                selectedStatCard === 'average' && !selectedAnalystId && "ring-2 ring-primary-500 bg-primary-50"
                              )}
                              onClick={() => {
                                setSelectedAnalystId(null)
                                setSelectedStatCard(selectedStatCard === 'average' ? null : 'average')
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary-100 rounded-lg">
                                  <BarChart3 className="h-5 w-5 text-primary-600" />
                                </div>
                                <div>
                                  <p className="text-3xl font-bold text-primary-600">{avgCoverage.toFixed(1)}</p>
                                  <p className="text-xs text-gray-500">Avg Names</p>
                                </div>
                              </div>
                            </Card>
                            <Card
                              className={clsx(
                                "p-4 cursor-pointer transition-all hover:shadow-md",
                                selectedStatCard === 'bandwidth' && !selectedAnalystId && "ring-2 ring-purple-500 bg-purple-50"
                              )}
                              onClick={() => {
                                setSelectedAnalystId(null)
                                setSelectedStatCard(selectedStatCard === 'bandwidth' ? null : 'bandwidth')
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-purple-100 rounded-lg">
                                  <BarChart3 className="h-5 w-5 text-purple-600" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-gray-900 mb-1">Bandwidth</p>
                                  <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1">
                                      <span className="text-lg font-bold text-blue-600">{workloadCounts.light}</span>
                                      <span className="text-[10px] text-gray-500">below</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-lg font-bold text-green-600">{workloadCounts.normal}</span>
                                      <span className="text-[10px] text-gray-500">balanced</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-lg font-bold text-amber-600">{workloadCounts.moderate + workloadCounts.extended}</span>
                                      <span className="text-[10px] text-gray-500">above</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </Card>
                          </div>

                          {/* Detail Panel - Changes based on selection */}
                          {selectedAnalystId ? (
                            /* Analyst Detail View */
                            <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                              {(() => {
                                const analyst = analystWorkload.get(selectedAnalystId)
                                if (!analyst) return null

                                const workload = getWorkloadLevel(analyst.count)
                                const diff = analyst.count - avgCoverage
                                const analystCoverage = filteredCoverage.filter(c => c.user_id === selectedAnalystId)

                                // Get sectors from profile, portfolios and teams sorted by count
                                const profileSectors = analyst.sectors // Already an array from profile settings
                                const sortedPortfolios = Array.from(analyst.portfolios.entries()).sort((a, b) => b[1].count - a[1].count)
                                const sortedTeams = Array.from(analyst.teams.entries()).sort((a, b) => b[1].count - a[1].count)

                                return (
                                  <>
                                    {/* Compact Analyst Header */}
                                    <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0 bg-white">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <div className={clsx(
                                            'w-10 h-10 rounded-full flex items-center justify-center',
                                            workload.bgColor
                                          )}>
                                            <span className={clsx('text-sm font-bold', workload.textColor)}>
                                              {analyst.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                            </span>
                                          </div>
                                          <div>
                                            <h3 className="text-base font-semibold text-gray-900">{analyst.name}</h3>
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm text-gray-600">
                                                <span className="font-bold text-gray-900">{analyst.count}</span> names
                                              </span>
                                              <span className={clsx(
                                                'px-2 py-0.5 text-xs font-medium rounded-full',
                                                workload.bgColor, workload.textColor
                                              )}>
                                                {workload.label}
                                              </span>
                                              {diff !== 0 && (
                                                <span className={clsx(
                                                  'text-xs',
                                                  diff > 0 ? 'text-amber-600' : 'text-blue-600'
                                                )}>
                                                  ({diff > 0 ? '+' : ''}{diff.toFixed(1)} vs avg)
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Distribution Cards - Main Focus */}
                                    <div className="flex-1 overflow-auto p-4">
                                      <div className="grid grid-cols-3 gap-4 h-full">
                                        {/* Sector Distribution Card */}
                                        <div className="bg-gradient-to-br from-indigo-50 to-white rounded-xl border border-indigo-100 p-4 flex flex-col">
                                          <div className="flex items-center gap-2 mb-4">
                                            <div className="p-2 bg-indigo-100 rounded-lg">
                                              <BarChart3 className="h-5 w-5 text-indigo-600" />
                                            </div>
                                            <div>
                                              <h4 className="text-sm font-semibold text-gray-900">Sector Focus</h4>
                                              <p className="text-xs text-gray-500">{profileSectors.length} sector{profileSectors.length !== 1 ? 's' : ''}</p>
                                            </div>
                                          </div>
                                          <div className="flex-1 overflow-auto space-y-2">
                                            {profileSectors.map((sector) => (
                                              <div key={sector} className="bg-white rounded-lg px-3 py-2 border border-indigo-100 shadow-sm">
                                                <span className="text-sm font-medium text-gray-900">{sector}</span>
                                              </div>
                                            ))}
                                            {profileSectors.length === 0 && (
                                              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm py-4">
                                                No sector focus set
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {/* Portfolio Card */}
                                        <div className="bg-gradient-to-br from-purple-50 to-white rounded-xl border border-purple-100 p-4 flex flex-col">
                                          <div className="flex items-center gap-2 mb-4">
                                            <div className="p-2 bg-purple-100 rounded-lg">
                                              <FolderOpen className="h-5 w-5 text-purple-600" />
                                            </div>
                                            <div>
                                              <h4 className="text-sm font-semibold text-gray-900">By Portfolio</h4>
                                              <p className="text-xs text-gray-500">{sortedPortfolios.length} portfolio{sortedPortfolios.length !== 1 ? 's' : ''}</p>
                                            </div>
                                          </div>
                                          <div className="flex-1 overflow-auto space-y-3">
                                            {sortedPortfolios.map(([id, { name, count }]) => {
                                              const coveragePercent = ((count / analyst.count) * 100)
                                              const totalInPortfolio = totalByPortfolio.get(id)?.count || count
                                              const portfolioPercent = ((count / totalInPortfolio) * 100)
                                              return (
                                                <div key={id} className="bg-white rounded-lg p-3 border border-purple-100 shadow-sm">
                                                  <div className="flex items-center justify-between mb-2">
                                                    <span className="text-sm font-medium text-gray-900 truncate flex-1" title={name}>{name}</span>
                                                    <span className="text-lg font-bold text-purple-600 ml-2">{count}</span>
                                                  </div>
                                                  <div className="h-2 bg-purple-100 rounded-full overflow-hidden mb-1">
                                                    <div
                                                      className="h-full bg-purple-500 rounded-full transition-all"
                                                      style={{ width: `${coveragePercent}%` }}
                                                    />
                                                  </div>
                                                  <div className="flex justify-between text-[10px] text-gray-500">
                                                    <span>{coveragePercent.toFixed(0)}% of {analyst.name.split(' ')[0]}'s coverage</span>
                                                    <span>{portfolioPercent.toFixed(0)}% of {name}</span>
                                                  </div>
                                                </div>
                                              )
                                            })}
                                            {sortedPortfolios.length === 0 && (
                                              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                                                Not assigned to any portfolios
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {/* Team Card */}
                                        <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl border border-emerald-100 p-4 flex flex-col">
                                          <div className="flex items-center gap-2 mb-4">
                                            <div className="p-2 bg-emerald-100 rounded-lg">
                                              <Building2 className="h-5 w-5 text-emerald-600" />
                                            </div>
                                            <div>
                                              <h4 className="text-sm font-semibold text-gray-900">By Team</h4>
                                              <p className="text-xs text-gray-500">{sortedTeams.length} team{sortedTeams.length !== 1 ? 's' : ''}</p>
                                            </div>
                                          </div>
                                          <div className="flex-1 overflow-auto space-y-3">
                                            {sortedTeams.map(([id, { name, count }]) => {
                                              const coveragePercent = ((count / analyst.count) * 100)
                                              const totalInTeam = totalByTeam.get(id)?.count || count
                                              const teamPercent = ((count / totalInTeam) * 100)
                                              return (
                                                <div key={id} className="bg-white rounded-lg p-3 border border-emerald-100 shadow-sm">
                                                  <div className="flex items-center justify-between mb-2">
                                                    <span className="text-sm font-medium text-gray-900 truncate flex-1" title={name}>{name}</span>
                                                    <span className="text-lg font-bold text-emerald-600 ml-2">{count}</span>
                                                  </div>
                                                  <div className="h-2 bg-emerald-100 rounded-full overflow-hidden mb-1">
                                                    <div
                                                      className="h-full bg-emerald-500 rounded-full transition-all"
                                                      style={{ width: `${coveragePercent}%` }}
                                                    />
                                                  </div>
                                                  <div className="flex justify-between text-[10px] text-gray-500">
                                                    <span>{coveragePercent.toFixed(0)}% of {analyst.name.split(' ')[0]}'s coverage</span>
                                                    <span>{teamPercent.toFixed(0)}% of {name}</span>
                                                  </div>
                                                </div>
                                              )
                                            })}
                                            {sortedTeams.length === 0 && (
                                              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                                                Not assigned to any teams
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                )
                              })()}
                            </Card>
                          ) : selectedStatCard === 'analysts' ? (
                            /* All Analysts Table */
                            <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                              <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0 bg-gray-50">
                                <div className="flex items-center gap-2">
                                  <Users className="h-5 w-5 text-gray-600" />
                                  <h3 className="text-sm font-semibold text-gray-900">All Analysts ({totalAnalysts})</h3>
                                </div>
                              </div>
                              <div className="flex-1 overflow-auto">
                                <table className="w-full">
                                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                                    <tr>
                                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Analyst</th>
                                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Coverage</th>
                                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sectors</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {sortedAnalysts.map(([id, analyst]) => {
                                      const workload = getWorkloadLevel(analyst.count)
                                      const diff = analyst.count - avgCoverage
                                      return (
                                        <tr key={id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setSelectedAnalystId(id); setSelectedStatCard(null) }}>
                                          <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                              <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center', workload.bgColor)}>
                                                <span className={clsx('text-xs font-semibold', workload.textColor)}>
                                                  {analyst.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                                </span>
                                              </div>
                                              <span className="font-medium text-gray-900">{analyst.name}</span>
                                            </div>
                                          </td>
                                          <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                              <span className="text-lg font-bold text-gray-900">{analyst.count}</span>
                                              {diff !== 0 && (
                                                <span className={clsx('text-sm', diff > 0 ? 'text-amber-600' : 'text-blue-600')}>
                                                  ({diff > 0 ? '+' : ''}{diff.toFixed(1)})
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-4 py-3">
                                            <span className={clsx('px-2 py-1 text-xs font-semibold rounded-full', workload.bgColor, workload.textColor)}>
                                              {workload.label}
                                            </span>
                                          </td>
                                          <td className="px-4 py-3 text-sm text-gray-500">
                                            {analyst.sectors.slice(0, 2).join(', ')}{analyst.sectors.length > 2 ? '...' : ''}{analyst.sectors.length === 0 && '—'}
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </Card>
                          ) : selectedStatCard === 'average' ? (
                            /* Coverage Distribution */
                            <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                              <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0 bg-primary-50">
                                <div className="flex items-center gap-2">
                                  <BarChart3 className="h-5 w-5 text-primary-600" />
                                  <h3 className="text-sm font-semibold text-gray-900">Coverage Distribution</h3>
                                </div>
                              </div>
                              <div className="flex-1 overflow-auto p-5">
                                {/* Stats Row */}
                                <div className="grid grid-cols-3 gap-4 mb-6">
                                  <div className="text-center p-4 bg-gray-50 rounded-xl">
                                    <p className="text-3xl font-bold text-gray-900">{avgCoverage.toFixed(1)}</p>
                                    <p className="text-sm text-gray-500">Average</p>
                                  </div>
                                  <div className="text-center p-4 bg-green-50 rounded-xl">
                                    <p className="text-3xl font-bold text-green-700">{maxCoverage}</p>
                                    <p className="text-sm text-gray-500">Highest</p>
                                  </div>
                                  <div className="text-center p-4 bg-blue-50 rounded-xl">
                                    <p className="text-3xl font-bold text-blue-700">{sortedAnalysts.length > 0 ? sortedAnalysts[sortedAnalysts.length - 1][1].count : 0}</p>
                                    <p className="text-sm text-gray-500">Lowest</p>
                                  </div>
                                </div>
                                {/* Distribution Bars */}
                                <h4 className="text-sm font-semibold text-gray-700 mb-3">Coverage by Analyst</h4>
                                <div className="space-y-3">
                                  {sortedAnalysts.map(([id, analyst]) => {
                                    const workload = getWorkloadLevel(analyst.count)
                                    const barWidth = maxCoverage > 0 ? (analyst.count / maxCoverage) * 100 : 0
                                    return (
                                      <div key={id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded-lg" onClick={() => { setSelectedAnalystId(id); setSelectedStatCard(null) }}>
                                        <span className="text-sm text-gray-700 w-36 truncate">{analyst.name}</span>
                                        <div className="flex-1 h-7 bg-gray-100 rounded-lg overflow-hidden relative">
                                          <div className="absolute top-0 bottom-0 w-1 bg-gray-700 z-10 shadow-sm" style={{ left: `${maxCoverage > 0 ? (avgCoverage / maxCoverage) * 100 : 50}%` }} />
                                          <div className={clsx('h-full rounded-lg flex items-center justify-end pr-2', workload.color)} style={{ width: `${barWidth}%` }}>
                                            <span className="text-xs font-bold text-white">{analyst.count}</span>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            </Card>
                          ) : selectedStatCard === 'bandwidth' ? (
                            /* Bandwidth Overview - All Categories */
                            <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                              <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0 bg-purple-50">
                                <div className="flex items-center gap-2">
                                  <BarChart3 className="h-5 w-5 text-purple-600" />
                                  <h3 className="text-sm font-semibold text-gray-900">Bandwidth Distribution</h3>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">Analysts categorized by workload relative to the team average ({avgCoverage.toFixed(1)} names)</p>
                              </div>
                              <div className="flex-1 overflow-auto p-4">
                                <div className="space-y-6">
                                  {/* Below Average Section */}
                                  <div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <div className="w-3 h-3 rounded bg-blue-500" />
                                      <h4 className="text-sm font-semibold text-gray-700">Below Average ({workloadCounts.light})</h4>
                                      <span className="text-xs text-gray-400">≤70% of average</span>
                                    </div>
                                    {analystsByCategory.light.length > 0 ? (
                                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                                        {analystsByCategory.light.map(([id, analyst]) => {
                                          const capacity = Math.round(avgCoverage - analyst.count)
                                          return (
                                            <div key={id} className="p-3 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setSelectedAnalystId(id); setSelectedStatCard(null) }}>
                                              <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                                  <span className="text-xs font-bold text-blue-700">{analyst.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                  <p className="text-sm font-medium text-gray-900 truncate">{analyst.name}</p>
                                                  <p className="text-xs text-gray-500">{analyst.count} names <span className="text-blue-600">(+{capacity} capacity)</span></p>
                                                </div>
                                              </div>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-gray-400 italic">No analysts below average</p>
                                    )}
                                  </div>

                                  {/* Balanced Section */}
                                  <div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <div className="w-3 h-3 rounded bg-green-500" />
                                      <h4 className="text-sm font-semibold text-gray-700">Balanced ({workloadCounts.normal})</h4>
                                      <span className="text-xs text-gray-400">70-120% of average</span>
                                    </div>
                                    {analystsByCategory.normal.length > 0 ? (
                                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                                        {analystsByCategory.normal.map(([id, analyst]) => {
                                          const diff = analyst.count - avgCoverage
                                          return (
                                            <div key={id} className="p-3 bg-green-50 rounded-lg border border-green-200 cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setSelectedAnalystId(id); setSelectedStatCard(null) }}>
                                              <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                                                  <span className="text-xs font-bold text-green-700">{analyst.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                  <p className="text-sm font-medium text-gray-900 truncate">{analyst.name}</p>
                                                  <p className="text-xs text-gray-500">{analyst.count} names {diff !== 0 && <span className="text-green-600">({diff > 0 ? '+' : ''}{diff.toFixed(1)})</span>}</p>
                                                </div>
                                              </div>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-gray-400 italic">No balanced analysts</p>
                                    )}
                                  </div>

                                  {/* Above Average Section */}
                                  <div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <div className="w-3 h-3 rounded bg-amber-500" />
                                      <h4 className="text-sm font-semibold text-gray-700">Above Average ({workloadCounts.moderate + workloadCounts.extended})</h4>
                                      <span className="text-xs text-gray-400">&gt;120% of average</span>
                                    </div>
                                    {(analystsByCategory.moderate.length > 0 || analystsByCategory.extended.length > 0) ? (
                                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                                        {[...analystsByCategory.extended, ...analystsByCategory.moderate].map(([id, analyst]) => {
                                          const workload = getWorkloadLevel(analyst.count)
                                          const overload = Math.round(analyst.count - avgCoverage)
                                          return (
                                            <div key={id} className={clsx('p-3 rounded-lg border cursor-pointer hover:shadow-md transition-shadow', workload.level === 'extended' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')} onClick={() => { setSelectedAnalystId(id); setSelectedStatCard(null) }}>
                                              <div className="flex items-center gap-2">
                                                <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', workload.bgColor)}>
                                                  <span className={clsx('text-xs font-bold', workload.textColor)}>{analyst.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                  <p className="text-sm font-medium text-gray-900 truncate">{analyst.name}</p>
                                                  <p className="text-xs text-gray-500">{analyst.count} names <span className={workload.textColor}>(+{overload})</span></p>
                                                </div>
                                              </div>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-gray-400 italic">No analysts above average</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </Card>
                          ) : (
                            /* Default - Comparative Overview */
                            <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
                              <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold text-gray-900">Workload Comparison</h3>
                                  <span className="text-xs text-gray-500">Click a metric above or an analyst to see details</span>
                                </div>
                              </div>
                              <div className="flex-1 overflow-auto p-4">
                                <div className="space-y-2">
                                  {sortedAnalysts.map(([analystId, analyst]) => {
                                    const workload = getWorkloadLevel(analyst.count)
                                    const barWidth = maxCoverage > 0 ? (analyst.count / maxCoverage) * 100 : 0
                                    const avgPosition = maxCoverage > 0 ? (avgCoverage / maxCoverage) * 100 : 50

                                    return (
                                      <div
                                        key={analystId}
                                        onClick={() => setSelectedAnalystId(analystId)}
                                        className="flex items-center gap-4 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group"
                                      >
                                        <div className="w-36 flex-shrink-0">
                                          <p className="text-sm font-medium text-gray-900 truncate group-hover:text-primary-600">{analyst.name}</p>
                                        </div>
                                        <div className="flex-1 relative">
                                          <div className="h-7 bg-gray-100 rounded relative overflow-hidden">
                                            <div className="absolute top-0 bottom-0 w-1 bg-gray-700 z-10 shadow-sm" style={{ left: `${avgPosition}%` }} />
                                            <div className={clsx('h-full rounded transition-all flex items-center justify-end pr-2', workload.color)} style={{ width: `${barWidth}%` }}>
                                              <span className="text-xs font-bold text-white drop-shadow">{analyst.count}</span>
                                            </div>
                                          </div>
                                        </div>
                                        <div className="w-28 flex-shrink-0 text-right">
                                          <span className={clsx('px-2 py-1 text-xs font-semibold rounded-full', workload.bgColor, workload.textColor)}>
                                            {workload.label}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                                {totalAnalysts === 0 && (
                                  <div className="text-center py-12 text-gray-500">
                                    <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                                    <p>No coverage data available</p>
                                  </div>
                                )}
                              </div>
                              <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
                                <div className="flex items-center justify-center gap-4">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-3 h-3 rounded bg-blue-400" />
                                    <span className="text-xs text-gray-600">Below Average</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-3 h-3 rounded bg-green-500" />
                                    <span className="text-xs text-gray-600">Balanced</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-3 h-3 rounded bg-amber-500" />
                                    <span className="text-xs text-gray-600">Above Average</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 ml-4">
                                    <div className="w-0.5 h-4 bg-gray-400" />
                                    <span className="text-xs text-gray-600">Avg ({avgCoverage.toFixed(1)})</span>
                                  </div>
                                </div>
                              </div>
                            </Card>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Matrix View - Grouped */}
              {viewMode === 'matrix' && (
                <div className="space-y-4">
                  {/* Controls Row */}
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    {/* Grouping Selector */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Group by:</span>
                      <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                        {[
                          { value: 'sector', label: 'Sector' },
                          { value: 'analyst', label: 'Analyst' },
                          { value: 'portfolio', label: 'Portfolio' },
                          { value: 'team', label: 'Team' },
                          { value: 'holdings', label: 'Holdings' }
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

                    {/* Analyst Selector - Right aligned */}
                    <div className="relative" ref={matrixAnalystPickerRef}>
                      <button
                        onClick={() => setShowMatrixAnalystPicker(!showMatrixAnalystPicker)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                      >
                        <Users className="h-4 w-4 text-gray-500" />
                        <span className="text-gray-700">
                          {matrixSelectedAnalysts.size === 0
                            ? 'All Analysts'
                            : `${matrixSelectedAnalysts.size} Selected`}
                        </span>
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      </button>
                      {showMatrixAnalystPicker && (
                        <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-80 overflow-auto">
                          <div className="p-2 border-b border-gray-100">
                            <button
                              onClick={() => setMatrixSelectedAnalysts(new Set())}
                              className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                            >
                              Show All Analysts
                            </button>
                          </div>
                          <div className="p-1">
                            {[...new Set(filteredCoverage.map(c => c.analyst_name))].sort().map(analyst => {
                              const isSelected = matrixSelectedAnalysts.size === 0 || matrixSelectedAnalysts.has(analyst)
                              return (
                                <label
                                  key={analyst}
                                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      const newSelected = new Set(matrixSelectedAnalysts)
                                      if (matrixSelectedAnalysts.size === 0) {
                                        // First selection - add all except this one
                                        [...new Set(filteredCoverage.map(c => c.analyst_name))].forEach(a => {
                                          if (a !== analyst) newSelected.add(a)
                                        })
                                      } else if (newSelected.has(analyst)) {
                                        newSelected.delete(analyst)
                                        if (newSelected.size === 0) {
                                          // If none selected, show all
                                          setMatrixSelectedAnalysts(new Set())
                                          return
                                        }
                                      } else {
                                        newSelected.add(analyst)
                                      }
                                      setMatrixSelectedAnalysts(newSelected)
                                    }}
                                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                  />
                                  <span className="text-sm text-gray-700">{analyst}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {(() => {
                    // Get unique analysts for column headers - filter by selection
                    const allAnalysts = [...new Set(filteredCoverage.map(c => c.analyst_name))].sort()
                    const analysts = matrixSelectedAnalysts.size === 0
                      ? allAnalysts
                      : allAnalysts.filter(a => matrixSelectedAnalysts.has(a))

                    // Build groups based on selected grouping
                    const groups = new Map<string, {
                      assets: { id: string; symbol: string; name: string; sector: string; analyst?: string; role?: string }[]
                      coveredCount: number
                      totalCount: number
                    }>()

                    // Helper to get analyst's teams (via direct membership, portfolio parent, or portfolio links)
                    const getAnalystTeamsForMatrix = (userId: string): string[] => {
                      const allNodes = allOrgChartNodes?.allNodes || []
                      const teamNodes = allNodes.filter(n => n.node_type === 'team')
                      const result: string[] = []
                      const userPortfolioNames = portfolioTeamMemberships?.get(userId) || []

                      teamNodes.forEach(teamNode => {
                        // Check if user is a member of this team (direct membership)
                        const directMembers = userTeamMemberships?.get(userId) || []
                        const isDirectMember = directMembers.some(m => m.nodeId === teamNode.id)

                        // Check if user is in any portfolio that has this team as parent (primary relationship)
                        const childPortfolios = allNodes
                          .filter(n => n.node_type === 'portfolio' && n.parent_id === teamNode.id)
                          .map(n => n.name)
                        const isViaParent = childPortfolios.some(pName => userPortfolioNames.includes(pName))

                        // Check if user is in any portfolio linked to this team (secondary relationship via org_chart_node_links)
                        const nodeLinks = allOrgChartNodes?.nodeLinks || []
                        const linkedPortfolios = nodeLinks
                          .filter(link => link.linked_node_id === teamNode.id)
                          .map(link => {
                            const portfolioNode = allNodes.find(n => n.id === link.node_id && n.node_type === 'portfolio')
                            return portfolioNode?.name
                          })
                          .filter(Boolean)
                        const isViaLink = linkedPortfolios.some(pName => userPortfolioNames.includes(pName!))

                        if (isDirectMember || isViaParent || isViaLink) {
                          result.push(teamNode.name)
                        }
                      })

                      return result
                    }

                    // Helper to get group key based on grouping type (for sector/analyst groupings only)
                    const getGroupKey = (coverage: typeof filteredCoverage[0]) => {
                      switch (matrixGroupBy) {
                        case 'sector': return coverage.assets?.sector || 'Uncategorized'
                        case 'analyst': return coverage.analyst_name
                        default: return 'Uncategorized'
                      }
                    }

                    // Helper to get analyst's portfolios (from their portfolio_team memberships)
                    const getAnalystPortfoliosForMatrix = (userId: string): string[] => {
                      return portfolioTeamMemberships?.get(userId) || []
                    }

                    // For team/portfolio grouping, we need special handling:
                    // Show coverage under each team/portfolio the ANALYST belongs to (based on their memberships)
                    if (matrixGroupBy === 'team') {
                      filteredCoverage.forEach(c => {
                        if (!c.assets) return
                        // Get all teams this analyst belongs to
                        const analystTeams = getAnalystTeamsForMatrix(c.user_id)
                        const teamsToAdd = analystTeams.length > 0 ? analystTeams : ['Firm-wide']

                        // Add this coverage to EACH team the analyst belongs to
                        teamsToAdd.forEach(teamName => {
                          if (!groups.has(teamName)) {
                            groups.set(teamName, { assets: [], coveredCount: 0, totalCount: 0 })
                          }
                          const group = groups.get(teamName)!
                          if (!group.assets.find(a => a.id === c.assets!.id)) {
                            group.assets.push({
                              id: c.assets!.id,
                              symbol: c.assets!.symbol,
                              name: c.assets!.company_name,
                              sector: c.assets!.sector || 'Uncategorized',
                              analyst: c.analyst_name,
                              role: c.role || undefined
                            })
                            group.coveredCount++
                            group.totalCount++
                          }
                        })
                      })
                    } else if (matrixGroupBy === 'portfolio') {
                      // Portfolio grouping: based on portfolio investable universe filters
                      // Create a set of covered asset IDs for quick lookup
                      const coveredAssetIds = new Set<string>()
                      filteredCoverage.forEach(c => {
                        if (c.assets?.id) coveredAssetIds.add(c.assets.id)
                      })

                      // For each portfolio with a defined universe, add its assets to the group
                      portfolioUniverseAssets?.forEach((universeAssets, portfolioName) => {
                        if (universeAssets.length === 0) return

                        if (!groups.has(portfolioName)) {
                          groups.set(portfolioName, { assets: [], coveredCount: 0, totalCount: 0 })
                        }
                        const group = groups.get(portfolioName)!

                        universeAssets.forEach(asset => {
                          if (!group.assets.find(a => a.id === asset.id)) {
                            const isCovered = coveredAssetIds.has(asset.id)
                            // Find analyst if covered
                            const coveringRecord = isCovered
                              ? filteredCoverage.find(c => c.assets?.id === asset.id)
                              : null

                            group.assets.push({
                              id: asset.id,
                              symbol: asset.symbol,
                              name: asset.name,
                              sector: asset.sector,
                              analyst: coveringRecord?.analyst_name,
                              role: coveringRecord?.role || undefined
                            })
                            group.totalCount++
                            if (isCovered) group.coveredCount++
                          }
                        })
                      })
                    } else if (matrixGroupBy === 'holdings') {
                      // Holdings grouping: show portfolio holdings for portfolios the selected analysts are members of
                      // First, get all portfolios that selected analysts are members of
                      const relevantPortfolios = new Set<string>()
                      const selectedAnalystIds = new Set<string>()

                      // Get user IDs of selected analysts
                      filteredCoverage.forEach(c => {
                        selectedAnalystIds.add(c.user_id)
                      })

                      // Find all portfolios these analysts belong to
                      selectedAnalystIds.forEach(userId => {
                        const userPortfolios = getAnalystPortfoliosForMatrix(userId)
                        userPortfolios.forEach(p => relevantPortfolios.add(p))
                      })

                      // Create a set of covered asset IDs for quick lookup
                      const coveredAssetIds = new Set<string>()
                      filteredCoverage.forEach(c => {
                        if (c.assets?.id) coveredAssetIds.add(c.assets.id)
                      })

                      // For each relevant portfolio, add its holdings to the group
                      relevantPortfolios.forEach(portfolioName => {
                        const holdings = portfolioHoldings?.get(portfolioName) || []
                        if (holdings.length === 0) return

                        if (!groups.has(portfolioName)) {
                          groups.set(portfolioName, { assets: [], coveredCount: 0, totalCount: 0 })
                        }
                        const group = groups.get(portfolioName)!

                        holdings.forEach(holding => {
                          if (!group.assets.find(a => a.id === holding.id)) {
                            const isCovered = coveredAssetIds.has(holding.id)
                            // Find analyst if covered
                            const coveringRecord = isCovered
                              ? filteredCoverage.find(c => c.assets?.id === holding.id)
                              : null

                            group.assets.push({
                              id: holding.id,
                              symbol: holding.symbol,
                              name: holding.name,
                              sector: holding.sector,
                              analyst: coveringRecord?.analyst_name,
                              role: coveringRecord?.role || undefined
                            })
                            group.totalCount++
                            if (isCovered) group.coveredCount++
                          }
                        })
                      })
                    } else {
                      // Sector/Analyst groupings: add covered assets normally
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
                    }

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
                      .sort((a, b) => a[0].localeCompare(b[0]))

                    if (sortedGroups.length === 0) {
                      return (
                        <Card className="p-8 text-center">
                          <Grid3X3 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                          <p className="text-gray-500">No coverage data to display</p>
                        </Card>
                      )
                    }

                    // Calculate overlap statistics for the summary
                    const allAssetIds = new Set<string>()
                    const assetCoverageCount = new Map<string, { count: number; symbol: string; analysts: string[] }>()
                    filteredCoverage.forEach(c => {
                      if (!c.assets) return
                      if (!analysts.includes(c.analyst_name)) return // Only count selected analysts
                      allAssetIds.add(c.assets.id)
                      const existing = assetCoverageCount.get(c.assets.id)
                      if (existing) {
                        existing.count++
                        if (!existing.analysts.includes(c.analyst_name)) {
                          existing.analysts.push(c.analyst_name)
                        }
                      } else {
                        assetCoverageCount.set(c.assets.id, {
                          count: 1,
                          symbol: c.assets.symbol,
                          analysts: [c.analyst_name]
                        })
                      }
                    })
                    const overlapAssets = Array.from(assetCoverageCount.entries())
                      .filter(([_, data]) => data.analysts.length > 1)
                      .map(([id, data]) => ({ id, ...data }))
                      .sort((a, b) => b.analysts.length - a.analysts.length)

                    const toggleGroup = (groupKey: string) => {
                      const newCollapsed = new Set(collapsedGroups)
                      if (newCollapsed.has(groupKey)) {
                        newCollapsed.delete(groupKey)
                      } else {
                        newCollapsed.add(groupKey)
                      }
                      setCollapsedGroups(newCollapsed)
                    }

                    return (
                      <>
                        {/* Overlap Summary - Clickable to filter */}
                        {overlapAssets.length > 0 && (
                          <button
                            onClick={() => setMatrixShowOverlapsOnly(!matrixShowOverlapsOnly)}
                            className={clsx(
                              'w-full p-4 rounded-lg border text-left transition-all',
                              matrixShowOverlapsOnly
                                ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-400'
                                : 'bg-amber-50 border-amber-200 hover:bg-amber-100 hover:border-amber-300'
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={clsx(
                                  'flex items-center justify-center w-10 h-10 rounded-lg',
                                  matrixShowOverlapsOnly ? 'bg-amber-200' : 'bg-amber-100'
                                )}>
                                  <Users className="h-5 w-5 text-amber-600" />
                                </div>
                                <div>
                                  <h3 className="text-sm font-semibold text-amber-900">
                                    {matrixShowOverlapsOnly ? 'Showing Overlaps Only' : 'Coverage Overlap Detected'}
                                  </h3>
                                  <p className="text-xs text-amber-700">
                                    {overlapAssets.length} {overlapAssets.length === 1 ? 'asset is' : 'assets are'} covered by multiple analysts
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {matrixShowOverlapsOnly ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-200 text-amber-800 rounded text-xs font-medium">
                                    <X className="h-3 w-3" />
                                    Clear Filter
                                  </span>
                                ) : (
                                  <span className="text-xs text-amber-600">Click to filter</span>
                                )}
                              </div>
                            </div>
                          </button>
                        )}

                        {sortedGroups.map(([groupKey, group]) => {
                          const isCollapsed = collapsedGroups.has(groupKey)
                          const coveragePercent = group.totalCount > 0
                            ? Math.round((group.coveredCount / group.totalCount) * 100)
                            : 0

                          // Calculate filtered assets when overlap filter is active
                          const displayedAssets = matrixShowOverlapsOnly
                            ? group.assets.filter(asset => {
                                const assetCov = filteredCoverage.filter(c => c.assets?.id === asset.id)
                                const displayedCovering = assetCov.filter(c => analysts.includes(c.analyst_name))
                                return displayedCovering.length > 1
                              })
                            : group.assets

                          // Skip groups with no assets when filtering
                          if (matrixShowOverlapsOnly && displayedAssets.length === 0) return null

                          return (
                          <Card key={groupKey} className="overflow-hidden">
                            {/* Group Header */}
                          <button
                            onClick={() => toggleGroup(groupKey)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setMatrixGroupContextMenu({ x: e.clientX, y: e.clientY })
                            }}
                            className="w-full px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <ChevronDown className={clsx(
                                'h-4 w-4 text-gray-500 transition-transform',
                                isCollapsed && '-rotate-90'
                              )} />
                              <h3 className="text-sm font-semibold text-gray-900">{groupKey}</h3>
                              <span className="text-xs text-gray-500">
                                {displayedAssets.length} {displayedAssets.length === 1 ? 'asset' : 'assets'}
                                {matrixShowOverlapsOnly && <span className="text-amber-600 ml-1">(overlaps)</span>}
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
                                    .filter(asset => {
                                      // When showing overlaps only, filter to assets with multiple analysts
                                      if (!matrixShowOverlapsOnly) return true
                                      const assetCov = filteredCoverage.filter(c => c.assets?.id === asset.id)
                                      const displayedCovering = assetCov.filter(c => analysts.includes(c.analyst_name))
                                      return displayedCovering.length > 1
                                    })
                                    .sort((a, b) => a.symbol.localeCompare(b.symbol))
                                    .map(asset => {
                                      const assetCoverage = filteredCoverage.filter(c => c.assets?.id === asset.id)
                                      const isUncovered = assetCoverage.length === 0
                                      // Count how many of the selected/displayed analysts cover this asset
                                      const displayedAnalystsCovering = assetCoverage.filter(c => analysts.includes(c.analyst_name))
                                      const hasOverlap = displayedAnalystsCovering.length > 1

                                      return (
                                        <tr key={asset.id} className={clsx(
                                          'hover:bg-gray-50',
                                          isUncovered && 'bg-red-50/50',
                                          hasOverlap && 'bg-amber-50/70'
                                        )}>
                                          <td className={clsx(
                                            'px-3 py-2 sticky left-0',
                                            isUncovered ? 'bg-red-50/50' : hasOverlap ? 'bg-amber-50/70' : 'bg-white'
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
                                              <td key={analyst} className={clsx(
                                                'px-2 py-2 text-center',
                                                coverage && hasOverlap && 'bg-amber-100/50'
                                              )}>
                                                {coverage ? (
                                                  <div className="flex justify-center">
                                                    {/* When hierarchy is enabled, show role badge */}
                                                    {coverageSettings?.enable_hierarchy && coverage.role ? (
                                                      <span className={clsx(
                                                        'inline-flex items-center justify-center w-6 h-6 rounded-full',
                                                        hasOverlap
                                                          ? 'bg-amber-200 text-amber-800 ring-2 ring-amber-400'
                                                          : 'bg-purple-100 text-purple-700'
                                                      )} title={`${coverage.role} - ${analyst}${hasOverlap ? ' (overlap)' : ''}`}>
                                                        <User className="h-3.5 w-3.5" />
                                                      </span>
                                                    ) : (
                                                      /* When hierarchy is disabled, show simple checkmark - no differentiation */
                                                      <span className={clsx(
                                                        'inline-flex items-center justify-center w-6 h-6 rounded-full',
                                                        hasOverlap
                                                          ? 'bg-amber-200 text-amber-800 ring-2 ring-amber-400'
                                                          : 'bg-green-100 text-green-700'
                                                      )} title={`Assigned - ${analyst}${hasOverlap ? ' (overlap)' : ''}`}>
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
                      })}
                      </>
                    )
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
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-amber-200 text-amber-800 rounded-full ring-2 ring-amber-400">
                        <Users className="h-3 w-3" />
                      </span>
                      <span className="text-xs text-gray-600">Overlap</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <span className="text-xs text-gray-600">Uncovered</span>
                    </div>
                  </div>

                  {/* Matrix Group Context Menu */}
                  {matrixGroupContextMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setMatrixGroupContextMenu(null)}
                      />
                      <div
                        className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px]"
                        style={{
                          left: matrixGroupContextMenu.x,
                          top: matrixGroupContextMenu.y,
                        }}
                      >
                        <button
                          onClick={() => {
                            setCollapsedGroups(new Set())
                            setMatrixGroupContextMenu(null)
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                        >
                          <Maximize2 className="h-4 w-4 text-gray-400" />
                          <span className="text-gray-700">Expand All</span>
                        </button>
                        <button
                          onClick={() => {
                            // Collapse all groups - get all group keys
                            const allGroupKeys = new Set<string>()
                            const getTeamsForUser = (userId: string): string[] => {
                              const allNodes = allOrgChartNodes?.allNodes || []
                              const teamNodes = allNodes.filter(n => n.node_type === 'team')
                              const userPortfolioNames = portfolioTeamMemberships?.get(userId) || []
                              const result: string[] = []
                              for (const teamNode of teamNodes) {
                                const directMembers = userTeamMemberships?.get(userId) || []
                                const isDirectMember = directMembers.some(m => m.nodeId === teamNode.id)
                                const childPortfolios = allNodes
                                  .filter(n => n.node_type === 'portfolio' && n.parent_id === teamNode.id)
                                  .map(n => n.name)
                                const isViaParent = childPortfolios.some(pName => userPortfolioNames.includes(pName))
                                const nodeLinks = allOrgChartNodes?.nodeLinks || []
                                const linkedPortfolios = nodeLinks
                                  .filter(link => link.linked_node_id === teamNode.id)
                                  .map(link => {
                                    const portfolioNode = allNodes.find(n => n.id === link.node_id && n.node_type === 'portfolio')
                                    return portfolioNode?.name
                                  })
                                  .filter(Boolean)
                                const isViaLink = linkedPortfolios.some(pName => userPortfolioNames.includes(pName!))
                                if (isDirectMember || isViaParent || isViaLink) result.push(teamNode.name)
                              }
                              return result
                            }
                            filteredCoverage.forEach(c => {
                              if (matrixGroupBy === 'sector') allGroupKeys.add(c.assets?.sector || 'Uncategorized')
                              else if (matrixGroupBy === 'analyst') allGroupKeys.add(c.analyst_name)
                              else if (matrixGroupBy === 'portfolio') {
                                // Portfolio grouping: based on portfolio universe filters
                                portfolioUniverseAssets?.forEach((_, portfolioName) => {
                                  allGroupKeys.add(portfolioName)
                                })
                              }
                              else if (matrixGroupBy === 'team') {
                                const teams = getTeamsForUser(c.user_id)
                                if (teams.length > 0) {
                                  teams.forEach(t => allGroupKeys.add(t))
                                } else {
                                  allGroupKeys.add('Firm-wide')
                                }
                              }
                              else if (matrixGroupBy === 'holdings') {
                                // Holdings grouping: based on analyst's portfolio memberships
                                const portfolios = portfolioTeamMemberships?.get(c.user_id) || []
                                portfolios.forEach(p => {
                                  if (portfolioHoldings?.has(p)) allGroupKeys.add(p)
                                })
                              }
                            })
                            setCollapsedGroups(allGroupKeys)
                            setMatrixGroupContextMenu(null)
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                        >
                          <Minimize2 className="h-4 w-4 text-gray-400" />
                          <span className="text-gray-700">Collapse All</span>
                        </button>
                      </div>
                    </>
                  )}
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

      {/* Group Context Menu */}
      {groupContextMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setGroupContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px]"
            style={{
              left: groupContextMenu.x,
              top: groupContextMenu.y,
            }}
          >
            <button
              onClick={() => {
                setCollapsedGroups(new Set())
                setGroupContextMenu(null)
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <Maximize2 className="h-4 w-4 text-gray-400" />
              <span className="text-gray-700">Expand All</span>
            </button>
            <button
              onClick={() => {
                // Collapse all groups - collect all possible group keys
                const allGroupKeys = new Set<string>()
                const collectGroupKeys = (prefix: string, depth: number) => {
                  if (depth >= listGroupByLevels.length) return
                  const level = listGroupByLevels[depth]
                  // Add all org chart nodes of this type
                  if (['team', 'division', 'department', 'portfolio'].includes(level)) {
                    (allOrgChartNodes?.allNodes || []).forEach((n: any) => {
                      if (n.node_type === level) {
                        const key = `list-${prefix}-${n.name}`
                        allGroupKeys.add(key)
                        collectGroupKeys(`${prefix}-${n.name}`, depth + 1)
                      }
                    })
                  }
                  // Add coverage-based keys
                  filteredCoverage.forEach(c => {
                    let key = ''
                    switch (level) {
                      case 'sector': key = c.assets?.sector || 'Unknown Sector'; break
                      case 'industry': key = (c.assets as any)?.industry || 'Unknown Industry'; break
                      case 'analyst': key = c.analyst_name || 'Unknown Analyst'; break
                    }
                    if (key) {
                      const fullKey = `list-${prefix}-${key}`
                      allGroupKeys.add(fullKey)
                      collectGroupKeys(`${prefix}-${key}`, depth + 1)
                    }
                  })
                }
                collectGroupKeys('root', 0)
                setCollapsedGroups(allGroupKeys)
                setGroupContextMenu(null)
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <Minimize2 className="h-4 w-4 text-gray-400" />
              <span className="text-gray-700">Collapse All</span>
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => {
                setHiddenGroups(prev => {
                  const next = new Set(prev)
                  next.add(groupContextMenu.groupKey)
                  return next
                })
                setGroupContextMenu(null)
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <EyeOff className="h-4 w-4 text-gray-400" />
              <span className="text-gray-700">Hide "{groupContextMenu.groupName}"</span>
            </button>
          </div>
        </>
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