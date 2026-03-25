import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Users, X, Search, Trash2, ChevronDown, ChevronRight, Upload, Download, FileText, AlertCircle, ChevronUp, Shield, Eye, EyeOff, History, ArrowRightLeft, RefreshCw, Clock, Plus, List, LayoutGrid, Grid3X3, UserCheck, User, TrendingUp, TrendingDown, BarChart3, CheckCircle, UserPlus, Building2, FolderOpen, Check, Briefcase, Minimize2, Maximize2, Scale, Network } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'
import { CoverageListView } from './views/CoverageListView'
import { CoverageGapsView } from './views/CoverageGapsView'
import { CoverageMatrixView } from './views/CoverageMatrixView'
import { CoverageWorkloadView } from './views/CoverageWorkloadView'
import type { ListColumnId as ExtListColumnId } from '../../lib/coverage/coverage-types'

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
    parent_id?: string | null
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
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [groupRefSearch, setGroupRefSearch] = useState('')
  const [uploadPreview, setUploadPreview] = useState<{
    rows: Array<{
      line: number
      asset_symbol: string
      analyst_email: string
      group: string
      start_date: string
      end_date: string
      notes: string
      // resolved
      asset: { id: string; symbol: string; company_name: string } | null
      user: { id: string; name: string; email: string } | null
      orgNode: { id: string; name: string; node_type: string } | null
      isFirm: boolean
      errors: string[]
      isDuplicate: boolean
    }>
    fileName: string
    rowCount: number
  } | null>(null)
  const [selectedAnalystId, setSelectedAnalystId] = useState<string | null>(null)
  const [selectedStatCard, setSelectedStatCard] = useState<'analysts' | 'covered' | 'gaps' | 'average' | null>(null)
  const [matrixGroupBy, setMatrixGroupBy] = useState<'sector' | 'analyst' | 'portfolio' | 'team' | 'holdings'>(() => getInitialState('matrixGroupBy', 'sector'))
  const [matrixSelectedAnalysts, setMatrixSelectedAnalysts] = useState<Set<string>>(() => new Set()) // Empty = show all
  // Matrix analyst picker / overlap / context menu state now managed internally by CoverageMatrixView
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => getInitialState('collapsedGroups', new Set()))
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(() => getInitialState('hiddenGroups', new Set()))
  const [hideEmptyGroups, setHideEmptyGroups] = useState(() => getInitialState('hideEmptyGroups', false))
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupKey: string; groupName: string } | null>(null)
  const [selectedOrgGroup, setSelectedOrgGroup] = useState<string | null>(null)
  const [scopeDropdownOpen, setScopeDropdownOpen] = useState(false)
  const [scopeExpandedSections, setScopeExpandedSections] = useState<Set<string>>(() => new Set())
  const scopeDropdownRef = useRef<HTMLDivElement>(null)
  const [collapsedGapsGroups, setCollapsedGapsGroups] = useState<Set<string>>(() => getInitialState('collapsedGapsGroups', new Set()))

  // List View Configuration - Columns, Sorting, Filtering, Grouping
  type ListColumnId = ExtListColumnId
  type ListGroupByLevel = 'division' | 'department' | 'team' | 'portfolio' | 'sector' | 'industry' | 'analyst'
  const [listVisibleColumns, setListVisibleColumns] = useState<ListColumnId[]>(() => {
    const raw = getInitialState<ListColumnId[]>('listVisibleColumns', ['asset', 'analyst', 'coversFor', 'sector'])
    // Migrate legacy column IDs: visibility → scope → coversFor, defaultOwner → owner → coveredBy
    return raw.map(c => {
      const s = c as string
      if (s === 'visibility' || s === 'scope') return 'coversFor' as ListColumnId
      if (s === 'defaultOwner' || s === 'owner') return 'coveredBy' as ListColumnId
      return c
    })
  })
  const [listGroupBy, setListGroupBy] = useState<'asset' | 'none'>(() => getInitialState('listGroupBy', 'asset'))
  const [listGroupByLevels, setListGroupByLevels] = useState<ListGroupByLevel[]>(() => getInitialState('listGroupByLevels', [])) // Multi-level grouping
  const [listGroupFilter, setListGroupFilter] = useState<string | null>(null) // Filter to specific group
  const [showGroupByDropdown, setShowGroupByDropdown] = useState(false)
  const groupByRef = useRef<HTMLDivElement>(null)
  const [listSortColumn, setListSortColumn] = useState<ListColumnId | null>(() => {
    const raw = getInitialState<ListColumnId | null>('listSortColumn', 'asset')
    const s = raw as string
    if (s === 'visibility' || s === 'scope') return 'coversFor' as ListColumnId
    if (s === 'defaultOwner' || s === 'owner') return 'coveredBy' as ListColumnId
    return raw
  })
  const [listSortDirection, setListSortDirection] = useState<'asc' | 'desc'>(() => getInitialState('listSortDirection', 'asc'))
  const [listColumnFilters, setListColumnFilters] = useState<Partial<Record<ListColumnId, string>>>({})
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
      listGroupBy,
      listGroupByLevels,
      listSortColumn,
      listSortDirection
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      console.warn('Failed to save coverage settings:', e)
    }
  }, [activeView, viewMode, matrixGroupBy, collapsedGroups, hiddenGroups, hideEmptyGroups, collapsedGapsGroups, listVisibleColumns, listGroupBy, listGroupByLevels, listSortColumn, listSortDirection])

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

  // Close scope dropdown on click outside
  useEffect(() => {
    if (!scopeDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(e.target as Node)) {
        setScopeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [scopeDropdownOpen])

  // Matrix analyst picker click-outside now managed internally by CoverageMatrixView

  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
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
  const [requestStatusFilter, setRequestStatusFilter] = useState<'pending' | 'approved' | 'denied' | 'rescinded' | 'all'>('pending')
  const [expandedReasonIds, setExpandedReasonIds] = useState<Set<string>>(new Set())
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
    /** When set, modal is in edit mode — updates this record instead of inserting */
    editingCoverageId?: string
  } | null>(null)
  const [coversForDropdownOpen, setCoversForDropdownOpen] = useState(false)
  const [coversForExpandedSections, setCoversForExpandedSections] = useState<Set<string>>(() => new Set())
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
    existingCoverage: Array<{
      id: string
      user_id: string
      analyst_name: string
      visibility?: 'team' | 'division' | 'firm'
      team_name?: string
      role?: string | null
      is_lead?: boolean
    }>
    newAnalystId: string
    newAnalystName: string
    startDate: string
    endDate: string
    notes: string
    isLead: boolean
    // Pass through the scope the user selected so inserts use correct values
    teamId: string | null
    visibility: 'team' | 'division' | 'firm'
    role: string | null
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
  const { currentOrgId } = useOrganization()
  const hasGlobalCoverageAdmin = user?.coverage_admin || false
  const [showAdminBadgeDropdown, setShowAdminBadgeDropdown] = useState(false)
  // columnManagerRef and filterDropdownRef now managed internally by CoverageListView

  // List View Column Definitions
  const listColumnDefinitions: Record<ListColumnId, { label: string; width: number; filterable: boolean; sortable: boolean }> = {
    asset: { label: 'Asset', width: 3, filterable: true, sortable: true },
    analyst: { label: 'Analyst', width: 2, filterable: true, sortable: true },
    coversFor: { label: 'Covers For', width: 1, filterable: true, sortable: true },
    coveredBy: { label: 'Covered By', width: 2, filterable: false, sortable: true },
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
    if (!listColumnDefinitions[columnId]?.sortable) return
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
    if (!listColumnDefinitions[columnId]?.filterable) return
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
        case 'coversFor': value = coverage.teams?.name || (coverage.visibility === 'firm' ? 'Firm' : coverage.visibility === 'division' ? 'Division' : 'Team'); break
        case 'sector': value = coverage.assets?.sector; break
        case 'industry': value = (coverage.assets as any)?.industry; break
      }
      if (value) values.add(value)
    })
    return Array.from(values).sort()
  }

  // totalColumnWidth now calculated internally by CoverageListView

  // Fetch all coverage records with asset details
  const { data: coverageRecords, isLoading: coverageLoading } = useQuery({
    queryKey: ['all-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('*, assets(*), portfolios(id, name, team_id), teams:org_chart_nodes!coverage_team_id_fkey(id, name, node_type, parent_id)')
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
        .select('*, assets(*), teams:org_chart_nodes!coverage_team_id_fkey(id, name, node_type, parent_id)')
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

  // Fetch org admin status for current user in current org
  const { data: isOrgAdmin = false, isLoading: isLoadingOrgAdmin } = useQuery({
    queryKey: ['org-admin-status', user?.id, currentOrgId],
    queryFn: async () => {
      if (!user?.id || !currentOrgId) return false
      const { data, error } = await supabase
        .from('organization_memberships')
        .select('is_org_admin')
        .eq('user_id', user.id)
        .eq('organization_id', currentOrgId)
        .eq('status', 'active')
        .maybeSingle()

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
        .from('org_org_chart_nodes_v')
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
    enabled: isVisible,
    structuralSharing: false,
  })

  // Build portfolio name → ID map from the same membership data
  const { data: portfolioNameToIdMap } = useQuery({
    queryKey: ['portfolio-name-to-id-map'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
      if (error) throw error
      const map = new Map<string, string>()
      ;(data || []).forEach((p: any) => { if (p.name) map.set(p.name, p.id) })
      return map
    },
    enabled: isVisible,
    structuralSharing: false,
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
        .from('org_org_chart_nodes_v')
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

  // Scope dropdown options for workload view
  const scopeOrgGroupOptions = useMemo(() => {
    const nodes = allOrgChartNodes?.nodes || []
    const groups: Array<{ id: string; name: string; type: string }> = []
    for (const n of nodes) {
      if (['department', 'division', 'team', 'portfolio'].includes(n.node_type)) {
        groups.push({ id: n.id, name: n.name, type: n.node_type })
      }
    }
    return groups
  }, [allOrgChartNodes])

  const scopeSelectedGroupLabel = useMemo(() => {
    if (!selectedOrgGroup) return null
    const node = (allOrgChartNodes?.allNodes || []).find((n: any) => n.id === selectedOrgGroup)
    return node ? node.name : null
  }, [selectedOrgGroup, allOrgChartNodes])

  const toggleScopeSection = (type: string) => {
    setScopeExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

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
        .from('org_org_chart_nodes_v')
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
        .from('org_org_chart_nodes_v')
        .select('id, name, node_type, parent_id')
        .eq('node_type', 'team')
        .order('name')

      if (error) throw error
      return data || []
    },
    enabled: isVisible
  })

  // Fetch organization-level coverage settings for current org
  const { data: coverageSettings } = useQuery({
    queryKey: ['coverage-settings', currentOrgId],
    queryFn: async () => {
      if (!currentOrgId) return null

      const { data, error } = await supabase
        .from('coverage_settings')
        .select('*')
        .eq('organization_id', currentOrgId)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data || null
    },
    enabled: isVisible && !!currentOrgId
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
        .select('node_id, is_coverage_admin')
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
      const teams: Array<{ id: string; name: string; node_type: string; parent_id: string | null; is_coverage_admin?: boolean }> = []
      const membershipMap = new Map(memberships.map(m => [m.node_id, m.is_coverage_admin]))

      for (const node of nodes) {
        if (node.node_type === 'team') {
          // User is directly a member of a team
          teams.push({ ...node, is_coverage_admin: membershipMap.get(node.id) })
        } else if (node.node_type === 'portfolio' && node.parent_id) {
          // User is a member of a portfolio - find the parent team
          const { data: parentTeam } = await supabase
            .from('org_chart_nodes')
            .select('id, name, node_type, parent_id')
            .eq('id', node.parent_id)
            .eq('node_type', 'team')
            .single()

          if (parentTeam && !teams.find(t => t.id === parentTeam.id)) {
            teams.push({ ...parentTeam, is_coverage_admin: membershipMap.get(node.id) })
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
          assets(id, symbol, company_name),
          changed_by_user:users!coverage_history_changed_by_fkey(id, first_name, last_name, email),
          coverage:coverage!coverage_history_coverage_id_fkey(id, team_id, visibility, teams:org_chart_nodes!coverage_team_id_fkey(id, name, node_type))
        `)
        .in('change_type', ['created', 'analyst_changed', 'deleted', 'dates_changed', 'coverage_added', 'historical_added', 'role_change', 'scope_changed'])
        .order('changed_at', { ascending: false })
        .limit(200)

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
    enabled: isVisible && viewMode === 'gaps'
  })

  // Set showAllChanges default based on user role
  // Non-admins see history expanded by default (they need to track changes they can't make)
  // Admins see it collapsed (they focus on making edits, can expand if needed)
  useEffect(() => {
    if (user) {
      setShowAllChanges(!user.coverage_admin)
    }
  }, [user])


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

  // Bulk upload coverage mutation — accepts pre-validated rows from preview
  const bulkUploadMutation = useMutation({
    mutationFn: async (validRows: Array<{
      asset: { id: string; symbol: string }
      user: { id: string; name: string }
      orgNode: { id: string; node_type: string } | null
      isFirm: boolean
      start_date: string
      end_date: string
      notes: string
    }>) => {
      setIsUploading(true)
      setUploadErrors([])
      setUploadSuccess(null)
      setUploadProgress('Preparing records...')

      const records = validRows.map(row => ({
        asset_id: row.asset.id,
        user_id: row.user.id,
        analyst_name: row.user.name,
        team_id: row.isFirm ? null : row.orgNode?.id || null,
        visibility: row.isFirm ? 'firm' : (row.orgNode?.node_type === 'division' || row.orgNode?.node_type === 'department' ? 'division' : 'team'),
        start_date: row.start_date || new Date().toISOString().split('T')[0],
        end_date: row.end_date || null,
        notes: row.notes || null,
        changed_by: user?.id,
      }))

      setUploadProgress(`Importing ${records.length} assignment${records.length !== 1 ? 's' : ''}...`)

      const { error } = await supabase
        .from('coverage')
        .insert(records)

      if (error) throw error

      setUploadProgress(null)
      return { recordsCount: records.length }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
      setUploadSuccess(`Successfully imported ${result.recordsCount} coverage assignment${result.recordsCount !== 1 ? 's' : ''}.`)
      setUploadFile(null)
      setUploadPreview(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    onError: (error) => {
      setUploadErrors([error.message])
    },
    onSettled: () => {
      setIsUploading(false)
      setUploadProgress(null)
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

  // Update assignment fields (role, is_lead, visibility) — used by inline edit in list view
  const updateAssignmentMutation = useMutation({
    mutationFn: async ({ coverageId, updates }: { coverageId: string; updates: { role?: string; is_lead?: boolean; visibility?: string } }) => {
      const { error } = await supabase
        .from('coverage')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', coverageId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
      queryClient.invalidateQueries({ queryKey: ['coverage'] })
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
      // Check if user is a coverage admin of the team
      const isTeamLead = userTeams?.some(t => t.id === coverage.team_id && t.is_coverage_admin)
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
          status: 'pending',
          organization_id: currentOrgId,
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
            is_active: true,
            organization_id: currentOrgId,
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
        const { error } = await supabase.from('coverage').insert({ ...insertData, organization_id: currentOrgId })
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


  const processUploadFile = async (file: File) => {
    setUploadFile(file)
    setUploadErrors([])
    setUploadSuccess(null)
    setUploadPreview(null)

    // File size check (5 MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadErrors(['File exceeds the 5 MB size limit.'])
      return
    }

    // Parse rows from CSV or XLSX
    let dataRows: string[][]
    const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')

    if (isExcel) {
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      // Use the first sheet (Template sheet)
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) { setUploadPreview(null); return }
      const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      dataRows = raw.filter(r => r.some(cell => String(cell).trim()))
    } else {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      // Filter out comment lines (group reference section)
      dataRows = lines
        .filter(line => !line.trimStart().startsWith('#'))
        .map(line => line.split(',').map(s => s.trim().replace(/^"|"$/g, '')))
    }

    if (dataRows.length === 0) {
      setUploadPreview(null)
      return
    }

    const orgNodes = allOrgChartNodes?.nodes || []
    const previewRows: NonNullable<typeof uploadPreview>['rows'] = []
    // Track seen (asset_symbol + analyst_email + group) for duplicate detection
    const seen = new Set<string>()

    for (let i = 0; i < dataRows.length; i++) {
      // Skip header row
      if (i === 0 && String(dataRows[i][0]).toLowerCase().includes('asset_symbol')) continue

      const parts = dataRows[i].map(s => String(s).trim())
      const [assetSymbol, analystEmail, group, startDate, endDate, notes] = parts
      const errors: string[] = []

      // Resolve asset
      const asset = assets?.find(a => a.symbol.toLowerCase() === (assetSymbol || '').toLowerCase()) || null
      if (!assetSymbol) errors.push('Missing asset symbol')
      else if (!asset) errors.push(`Asset "${assetSymbol}" not found`)

      // Resolve analyst by email
      const foundUser = analystEmail ? users?.find(u => u.email?.toLowerCase() === analystEmail.toLowerCase()) : null
      const resolvedUser = foundUser ? {
        id: foundUser.id,
        name: foundUser.first_name && foundUser.last_name ? `${foundUser.first_name} ${foundUser.last_name}` : foundUser.email?.split('@')[0] || 'Unknown',
        email: foundUser.email || ''
      } : null
      if (!analystEmail) errors.push('Missing analyst email')
      else if (!resolvedUser) errors.push(`Analyst "${analystEmail}" not found`)

      // Resolve group
      const isFirm = (group || '').toLowerCase() === 'firm'
      const orgNode = !isFirm && group
        ? orgNodes.find((n: any) => n.name.toLowerCase() === group.toLowerCase() || n.displayName?.toLowerCase() === group.toLowerCase()) || null
        : null
      if (!group) errors.push('Missing group')
      else if (!isFirm && !orgNode) errors.push(`Group "${group}" not found`)

      // Check duplicate
      const dupeKey = `${(assetSymbol || '').toLowerCase()}:${(analystEmail || '').toLowerCase()}:${(group || '').toLowerCase()}`
      const isDuplicate = seen.has(dupeKey)
      if (isDuplicate) errors.push('Duplicate row in file')
      seen.add(dupeKey)

      // Check if assignment already exists
      if (asset && resolvedUser && !isDuplicate) {
        const existingCoverage = coverageRecords?.find(c =>
          c.asset_id === asset.id && c.user_id === resolvedUser.id && c.is_active &&
          (isFirm ? c.visibility === 'firm' : c.team_id === orgNode?.id)
        )
        if (existingCoverage) errors.push('Assignment already exists')
      }

      previewRows.push({
        line: i + 1,
        asset_symbol: assetSymbol || '',
        analyst_email: analystEmail || '',
        group: group || '',
        start_date: startDate || '',
        end_date: endDate || '',
        notes: notes || '',
        asset,
        user: resolvedUser,
        orgNode,
        isFirm,
        errors,
        isDuplicate,
      })
    }

    setUploadPreview({ rows: previewRows, fileName: file.name, rowCount: previewRows.length })
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    processUploadFile(file)
  }

  const handleFileDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setIsDraggingFile(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      setUploadErrors(['Please drop a CSV or Excel (.xlsx) file.'])
      return
    }
    // Clear the file input to stay in sync
    if (fileInputRef.current) fileInputRef.current.value = ''
    processUploadFile(file)
  }

  const handleUpload = () => {
    if (uploadPreview) {
      // Only upload valid rows
      const validRows = uploadPreview.rows.filter(r => r.errors.length === 0 && r.asset && r.user)
      if (validRows.length === 0) {
        setUploadErrors(['No valid rows to upload.'])
        return
      }
      bulkUploadMutation.mutate(validRows as any)
    }
  }
  
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')

    // Sheet 1: Template (header + example rows)
    const templateData = [
      ['asset_symbol', 'analyst_email', 'group', 'start_date', 'end_date', 'notes'],
      ['AAPL', 'john.smith@company.com', 'Growth Team', '2026-01-15', '', ''],
      ['MSFT', 'jane.doe@company.com', 'Firm', '', '', 'Initial coverage'],
      ['GOOGL', 'bob.johnson@company.com', 'Value Team', '2026-03-01', '2026-12-31', 'Temporary assignment'],
    ]
    const templateSheet = XLSX.utils.aoa_to_sheet(templateData)
    templateSheet['!cols'] = [
      { wch: 16 }, { wch: 30 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
    ]

    // Sheet 2: Available Groups (reference)
    const orgNodes = allOrgChartNodes?.nodes || []
    const groupData: (string | undefined)[][] = [
      ['Group Name (use this in "group" column)', 'Type', 'Parent'],
      ['Firm', 'firm-wide', '—'],
      ...orgNodes
        .slice()
        .sort((a: any, b: any) => a.node_type.localeCompare(b.node_type) || a.name.localeCompare(b.name))
        .map((n: any) => {
          const parent = n.parent_id
            ? orgNodes.find((p: any) => p.id === n.parent_id)?.name
              || allOrgChartNodes?.allNodes?.find((p: any) => p.id === n.parent_id)?.name
              || '—'
            : '—'
          return [n.name, n.node_type, parent]
        }),
    ]
    const groupSheet = XLSX.utils.aoa_to_sheet(groupData)
    groupSheet['!cols'] = [{ wch: 40 }, { wch: 14 }, { wch: 24 }]

    // Build workbook with two sheets
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, templateSheet, 'Template')
    XLSX.utils.book_append_sheet(wb, groupSheet, 'Available Groups')

    XLSX.writeFile(wb, 'coverage_template.xlsx')
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
            case 'coversFor': {
              const groupName = coverage.teams?.name || (coverage.visibility === 'firm' ? 'Firm' : coverage.visibility === 'division' ? 'Division' : 'Team')
              if (!groupName.toLowerCase().includes(lowerFilter)) return false
              break
            }
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
          case 'coversFor':
            aVal = a.teams?.name || (a.visibility === 'firm' ? 'Firm' : a.visibility === 'division' ? 'Division' : 'Team')
            bVal = b.teams?.name || (b.visibility === 'firm' ? 'Firm' : b.visibility === 'division' ? 'Division' : 'Team')
            break
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

  // Viewer node IDs for coverage resolver scope matching
  const viewerNodeIds = useMemo(() => {
    if (!user?.id || !userTeamMemberships) return [] as string[]
    const memberships = userTeamMemberships.get(user.id) || []
    return memberships.map(m => m.id)
  }, [user?.id, userTeamMemberships])

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
                                    : 'Read-only — contact a coverage admin to make changes'}
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
                          teamId: null,
                          visibility: 'firm',
                          isLead: false
                        })
                        setAssetSearchQuery('')
                        setAnalystSearchQuery('')
                        setShowAssetDropdown(false)
                        setShowAnalystDropdown(false)
                        setCoversForDropdownOpen(false)
                        const defaultNode = allOrgChartNodes?.nodes.find((n: any) => n.id === userTeams?.[0]?.id)
                        setCoversForExpandedSections(new Set(defaultNode ? [defaultNode.node_type] : ['team']))
                      }}
                      variant="outline"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Coverage
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setShowBulkUpload(true)}
                      variant="outline"
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

                      {/* Render timeline entries — Scope → Analyst → Periods */}
                      {(() => {
                        const allTimeline = [...assetCoverageHistory, ...pendingNewCoverages]

                        // Apply pending changes to a record
                        const applyPending = (r: any) => {
                          const pc = pendingTimelineChanges[r.id]
                          if (!pc) return r
                          return {
                            ...r,
                            ...(pc.analyst && { user_id: pc.analyst.userId, analyst_name: pc.analyst.analystName }),
                            ...(pc.startDate !== undefined && { start_date: pc.startDate }),
                            ...(pc.endDate !== undefined && { end_date: pc.endDate }),
                          }
                        }

                        // Format a date string for display
                        const fmtDate = (d: string) => {
                          const [year, month, day] = d.split('T')[0].split('-')
                          return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        }

                        // Derive scope key / label
                        const scopeKeyOf = (r: any) => r.visibility === 'firm' ? 'firm' : r.team_id ? `node:${r.team_id}` : 'unknown'
                        const scopeLabelOf = (r: any) => r.visibility === 'firm' ? 'Firm' : r.teams?.name || (r.team_id ? 'Team' : 'No scope')

                        // ── Build three-level structure: Scope → Analyst → Periods ──
                        type PeriodEntry = typeof allTimeline[number]
                        type AnalystGroup = { userId: string; analystName: string; role: string | null; periods: PeriodEntry[] }
                        type ScopeGroup = { label: string; scopeKey: string; analysts: AnalystGroup[] }

                        const scopeMap = new Map<string, { label: string; analystMap: Map<string, AnalystGroup> }>()
                        for (const r of allTimeline) {
                          if (pendingTimelineDeletes.has(r.id)) continue
                          const effective = applyPending(r)
                          const sk = scopeKeyOf(r)
                          if (!scopeMap.has(sk)) scopeMap.set(sk, { label: scopeLabelOf(r), analystMap: new Map() })
                          const scope = scopeMap.get(sk)!
                          const ak = effective.user_id
                          if (!scope.analystMap.has(ak)) {
                            scope.analystMap.set(ak, { userId: ak, analystName: effective.analyst_name, role: effective.role || null, periods: [] })
                          }
                          scope.analystMap.get(ak)!.periods.push(r)
                        }

                        // Sort scopes: org_node (alpha) → firm → unknown
                        const scopeOrder = (key: string) => key === 'unknown' ? 2 : key === 'firm' ? 1 : 0
                        const sortedScopes: ScopeGroup[] = [...scopeMap.entries()]
                          .sort((a, b) => {
                            const d = scopeOrder(a[0]) - scopeOrder(b[0])
                            return d !== 0 ? d : a[1].label.localeCompare(b[1].label)
                          })
                          .map(([sk, s]) => ({
                            label: s.label,
                            scopeKey: sk,
                            analysts: [...s.analystMap.values()].map(ag => ({
                              ...ag,
                              // Sort periods: current/future first, then by start_date desc
                              periods: ag.periods.sort((a, b) => b.start_date.localeCompare(a.start_date)),
                            })),
                          }))

                        const multipleScopes = sortedScopes.length > 1
                        const today = getLocalDateString()

                        // Overlap: same scope + same analyst + overlapping dates
                        const getOverlaps = (recordId: string, startDate: string, endDate: string | null, analystPeriods: PeriodEntry[]) => {
                          const ids: string[] = []
                          for (const other of analystPeriods) {
                            if (other.id === recordId) continue
                            if (pendingTimelineDeletes.has(other.id)) continue
                            const oe = applyPending(other)
                            const thisEnd = endDate || '9999-12-31'
                            const thatEnd = oe.end_date || '9999-12-31'
                            if (startDate <= thatEnd && thisEnd >= oe.start_date) ids.push(other.id)
                          }
                          return ids
                        }

                        // Count total visible periods for show more/less
                        const totalPeriods = sortedScopes.reduce((n, s) => n + s.analysts.reduce((m, a) => m + a.periods.length, 0), 0)
                        const hasMore = totalPeriods > 6
                        let periodCount = 0

                        return (
                          <>
                            {sortedScopes.map((scope, scopeIdx) => (
                              <div key={scope.scopeKey} className={scopeIdx > 0 ? 'mt-4' : ''}>
                                {/* Scope header */}
                                {multipleScopes && (
                                  <div className="flex items-center gap-2 mb-2 ml-1">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${
                                      scope.scopeKey === 'firm' ? 'bg-gray-100 text-gray-600' :
                                      scope.scopeKey === 'unknown' ? 'bg-amber-50 text-amber-700' :
                                      'bg-emerald-50 text-emerald-700'
                                    }`}>
                                      {scope.label}
                                    </span>
                                  </div>
                                )}

                                {/* Analyst groups within this scope */}
                                {scope.analysts.map((analyst, analystIdx) => {
                                  // Role from current (most recent) period
                                  const currentPeriod = analyst.periods.find(p => {
                                    const eff = applyPending(p)
                                    return eff.start_date <= today && (!eff.end_date || eff.end_date > today)
                                  })
                                  const displayRole = currentPeriod ? (applyPending(currentPeriod).role || null) : analyst.role

                                  return (
                                    <div key={analyst.userId} className={analystIdx > 0 ? 'mt-3' : ''}>
                                      {/* Analyst header */}
                                      <div className="flex items-center gap-2 pl-4 mb-1">
                                        <span className="text-sm font-semibold text-gray-900">{analyst.analystName}</span>
                                        {/* Scope badge when single scope */}
                                        {!multipleScopes && (
                                          <span className={`inline-flex items-center px-1.5 py-px text-[10px] font-medium rounded-full leading-tight ${
                                            scope.scopeKey === 'firm' ? 'bg-gray-100 text-gray-600' :
                                            scope.scopeKey === 'unknown' ? 'bg-amber-50 text-amber-700' :
                                            'bg-emerald-50 text-emerald-700'
                                          }`}>
                                            {scope.label}
                                          </span>
                                        )}
                                        {/* Role badge */}
                                        {displayRole && (
                                          <span className={`inline-flex items-center px-1.5 py-px text-[10px] font-medium rounded-full border leading-tight ${
                                            displayRole === 'primary' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                            displayRole === 'secondary' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                            displayRole === 'tertiary' ? 'bg-gray-50 text-gray-500 border-gray-200' :
                                            'bg-gray-50 text-gray-500 border-gray-200'
                                          }`}>
                                            {displayRole.charAt(0).toUpperCase() + displayRole.slice(1)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Period rows for this analyst */}
                                      {analyst.periods.map((dbRecord) => {
                                        if (!showAllTimelinePeriods && periodCount >= 6) return null
                                        periodCount++

                                        const pendingChange = pendingTimelineChanges[dbRecord.id]
                                        const record = applyPending(dbRecord)
                                        const isCurrent = record.start_date <= today && (!record.end_date || record.end_date > today)
                                        const isFuture = record.start_date > today
                                        const isEnding = isCurrent && pendingChange?.endDate !== undefined

                                        // Adjacent records for date validation (within same analyst's periods)
                                        const analystFiltered = analyst.periods
                                        const pIdx = analystFiltered.findIndex(r => r.id === dbRecord.id)
                                        const prevRecord = pIdx > 0 ? applyPending(analystFiltered[pIdx - 1]) : null
                                        const nextRecord = pIdx < analystFiltered.length - 1 ? applyPending(analystFiltered[pIdx + 1]) : null

                                        // Overlap check — same scope + same analyst
                                        const overlappingIds = getOverlaps(record.id, record.start_date, record.end_date, analyst.periods)
                                        const hasOverlap = overlappingIds.length > 0

                                        const dotColor = isEnding ? 'bg-red-500' : isCurrent ? 'bg-green-500' : isFuture ? 'bg-purple-500' : 'bg-gray-300'

                                        return (
                                          <div key={record.id} className="relative pl-4 pb-1.5">
                                            {/* Timeline connector */}
                                            <div className={`absolute left-0 top-[8px] bottom-1 w-0.5 ${dotColor}`} />
                                            <div className={`absolute left-[-2.5px] top-[4px] w-[6px] h-[6px] rounded-full ${dotColor}`} />

                                            <div className={`group/period flex items-center gap-2 py-1.5 px-3 rounded-md border transition-colors ${
                                              isEnding ? 'bg-red-50/60 border-red-200' :
                                              isCurrent ? 'bg-green-50/60 border-green-100' :
                                              'bg-white border-gray-100 hover:border-gray-200'
                                            }`}>
                                              {/* Date range */}
                                              <div className="flex items-center gap-1.5 text-sm text-gray-600 flex-1 min-w-0">
                                                {/* Start date */}
                                                {editingDateValue?.coverageId === record.id && editingDateValue?.field === 'start' && hasAnyCoverageAdminRights ? (
                                                  <input
                                                    type="date"
                                                    value={editingDateValue.value}
                                                    autoFocus
                                                    onChange={(e) => setEditingDateValue({ coverageId: record.id, field: 'start', value: e.target.value })}
                                                    onBlur={(e) => {
                                                      const newDate = e.target.value
                                                      if (!newDate || newDate === record.start_date) { setEditingDateValue(null); return }
                                                      if (newDate > today) { setErrorModal({ isOpen: true, title: 'Invalid Start Date', message: 'Start date cannot be in the future.' }); setEditingDateValue(null); return }
                                                      if (record.end_date && newDate > record.end_date) { setErrorModal({ isOpen: true, title: 'Invalid Start Date', message: 'Start date cannot be after end date.' }); setEditingDateValue(null); return }
                                                      if (nextRecord && nextRecord.end_date && newDate <= nextRecord.end_date) {
                                                        setErrorModal({ isOpen: true, title: 'Invalid Start Date', message: `Start date must be after the previous period ends (${fmtDate(nextRecord.end_date)}).` })
                                                        setEditingDateValue(null); return
                                                      }
                                                      setPendingTimelineChanges(prev => ({ ...prev, [dbRecord.id]: { ...prev[dbRecord.id], startDate: newDate } }))
                                                      setEditingDateValue(null)
                                                    }}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setEditingDateValue(null); e.currentTarget.blur() } }}
                                                    className="inline-block w-[110px] h-[20px] px-1 py-0 text-sm leading-5 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                                    onClick={(e) => e.stopPropagation()}
                                                  />
                                                ) : hasAnyCoverageAdminRights ? (
                                                  <button
                                                    onClick={() => setEditingDateValue({ coverageId: record.id, field: 'start', value: record.start_date.split('T')[0] })}
                                                    className="text-gray-900 hover:text-blue-600 hover:underline cursor-pointer"
                                                  >
                                                    {fmtDate(record.start_date)}
                                                  </button>
                                                ) : (
                                                  <span className="text-gray-900">{fmtDate(record.start_date)}</span>
                                                )}

                                                <span className="text-gray-400">—</span>

                                                {/* End date */}
                                                {editingDateValue?.coverageId === record.id && editingDateValue?.field === 'end' && hasAnyCoverageAdminRights ? (
                                                  <input
                                                    type="date"
                                                    value={editingDateValue.value !== null ? editingDateValue.value : undefined}
                                                    autoFocus
                                                    onChange={(e) => setEditingDateValue({ coverageId: record.id, field: 'end', value: e.target.value })}
                                                    onBlur={(e) => {
                                                      const newDate = e.target.value
                                                      if (!newDate) { setPendingTimelineChanges(prev => ({ ...prev, [dbRecord.id]: { ...prev[dbRecord.id], endDate: null } })); setEditingDateValue(null); return }
                                                      if (newDate === record.end_date) { setEditingDateValue(null); return }
                                                      if (newDate < record.start_date) { setErrorModal({ isOpen: true, title: 'Invalid End Date', message: 'End date cannot be before start date.' }); setEditingDateValue(null); return }
                                                      if (prevRecord) {
                                                        const nextStart = prevRecord.start_date.includes('T') ? prevRecord.start_date.split('T')[0] : prevRecord.start_date
                                                        if (newDate >= nextStart) {
                                                          setErrorModal({ isOpen: true, title: 'Invalid End Date', message: `End date must be before the next period starts (${fmtDate(nextStart)}).` })
                                                          setEditingDateValue(null); return
                                                        }
                                                      }
                                                      setPendingTimelineChanges(prev => ({ ...prev, [dbRecord.id]: { ...prev[dbRecord.id], endDate: newDate } }))
                                                      setEditingDateValue(null)
                                                    }}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setEditingDateValue(null); e.currentTarget.blur() } }}
                                                    className="inline-block w-[110px] h-[20px] px-1 py-0 text-sm leading-5 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                                                    onClick={(e) => e.stopPropagation()}
                                                  />
                                                ) : hasAnyCoverageAdminRights ? (
                                                  <button
                                                    onClick={() => setEditingDateValue({ coverageId: record.id, field: 'end', value: record.end_date ? record.end_date.split('T')[0] : null })}
                                                    className="text-gray-900 hover:text-blue-600 hover:underline cursor-pointer"
                                                  >
                                                    {record.end_date ? fmtDate(record.end_date) : <span className="text-green-600 font-medium">Present</span>}
                                                  </button>
                                                ) : (
                                                  <span className="text-gray-900">
                                                    {record.end_date ? fmtDate(record.end_date) : <span className="text-green-600 font-medium">Present</span>}
                                                  </span>
                                                )}

                                                {/* No End Date checkbox */}
                                                {hasAnyCoverageAdminRights && isCurrent && editingDateValue?.coverageId === record.id && editingDateValue?.field === 'end' && record.end_date && (
                                                  <label className="flex items-center gap-1 ml-1 cursor-pointer">
                                                    <input
                                                      type="checkbox"
                                                      checked={false}
                                                      onChange={(e) => {
                                                        if (e.target.checked) {
                                                          setPendingTimelineChanges(prev => ({ ...prev, [dbRecord.id]: { ...prev[dbRecord.id], endDate: null } }))
                                                          setEditingDateValue(null)
                                                        }
                                                      }}
                                                      className="w-3 h-3 text-green-600 border-gray-300 rounded"
                                                    />
                                                    <span className="text-xs text-gray-500">No end</span>
                                                  </label>
                                                )}
                                              </div>

                                              {/* Status badges */}
                                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                                {isEnding && (
                                                  <span className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-bold bg-red-500 text-white">ENDING</span>
                                                )}
                                                {!isEnding && isCurrent && (
                                                  <span className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-bold bg-green-500 text-white">CURRENT</span>
                                                )}
                                                {isFuture && <Badge variant="purple" size="sm">Future</Badge>}
                                                {hasOverlap && (
                                                  <span
                                                    className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-200"
                                                    title="Overlapping coverage period detected"
                                                  >
                                                    Overlap
                                                  </span>
                                                )}
                                              </div>

                                              {/* Delete */}
                                              {hasAnyCoverageAdminRights && (
                                                <button
                                                  onClick={() => setPendingTimelineDeletes(prev => new Set([...prev, record.id]))}
                                                  className="opacity-0 group-hover/period:opacity-100 text-gray-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-all flex-shrink-0"
                                                >
                                                  <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )
                                })}
                              </div>
                            ))}

                            {/* Show More / Less */}
                            {hasMore && !showAllTimelinePeriods && (
                              <div className="flex justify-center pt-3 pb-1">
                                <button
                                  onClick={() => setShowAllTimelinePeriods(true)}
                                  className="px-3 py-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors flex items-center gap-1.5"
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                  Show {totalPeriods - 6} more period{totalPeriods - 6 !== 1 ? 's' : ''}
                                </button>
                              </div>
                            )}
                            {showAllTimelinePeriods && hasMore && (
                              <div className="flex justify-center pt-3 pb-1">
                                <button
                                  onClick={() => setShowAllTimelinePeriods(false)}
                                  className="px-3 py-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors flex items-center gap-1.5"
                                >
                                  <ChevronUp className="h-3.5 w-3.5" />
                                  Show less
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
            {/* Bulk Upload is now a modal — triggered by the Upload button in the toolbar */}

            {/* Search and Filter Buttons */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by asset symbol, company name, or analyst..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                {/* Scope Dropdown — workload view only */}
                {viewMode === 'workload' && (
                  <div ref={scopeDropdownRef} className="relative">
                    <button
                      onClick={() => setScopeDropdownOpen(prev => !prev)}
                      className={clsx(
                        'flex items-center gap-2 text-sm border rounded-lg px-3 py-2 bg-white text-gray-700 transition-colors min-w-[200px]',
                        scopeDropdownOpen
                          ? 'border-primary-500 ring-2 ring-primary-500'
                          : selectedOrgGroup
                            ? 'border-primary-500 bg-primary-50 text-primary-700'
                            : 'border-gray-300 hover:border-gray-400'
                      )}
                    >
                      {selectedOrgGroup && scopeSelectedGroupLabel ? (
                        <span className="flex items-center gap-1.5 flex-1 min-w-0">
                          {(() => {
                            const t = scopeOrgGroupOptions.find(o => o.id === selectedOrgGroup)?.type || ''
                            const cls = 'h-3.5 w-3.5 text-gray-400 flex-shrink-0'
                            if (t === 'department') return <Building2 className={cls} />
                            if (t === 'division') return <Network className={cls} />
                            if (t === 'team') return <Briefcase className={cls} />
                            if (t === 'portfolio') return <FolderOpen className={cls} />
                            return null
                          })()}
                          <span className="truncate font-medium">{scopeSelectedGroupLabel}</span>
                        </span>
                      ) : (
                        <span className="flex-1 text-left text-gray-500">Scope: All Analysts</span>
                      )}
                      <ChevronDown className={clsx('h-4 w-4 text-gray-400 flex-shrink-0 transition-transform', scopeDropdownOpen && 'rotate-180')} />
                    </button>

                    {scopeDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                        <button
                          onClick={() => { setSelectedOrgGroup(null); setScopeDropdownOpen(false) }}
                          className={clsx(
                            'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors border-b border-gray-100',
                            !selectedOrgGroup ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                          )}
                        >
                          <Users className="h-3.5 w-3.5 flex-shrink-0" />
                          <span>All Analysts</span>
                          {!selectedOrgGroup && <span className="ml-auto text-[10px] text-primary-500">Selected</span>}
                        </button>

                        {([
                          { type: 'department', label: 'Departments', Icon: Building2 },
                          { type: 'division', label: 'Divisions', Icon: Network },
                          { type: 'team', label: 'Teams', Icon: Briefcase },
                          { type: 'portfolio', label: 'Portfolios', Icon: FolderOpen },
                        ] as const).map(({ type, label, Icon }) => {
                          const items = scopeOrgGroupOptions.filter(o => o.type === type)
                          if (items.length === 0) return null
                          const isExpanded = scopeExpandedSections.has(type)
                          return (
                            <div key={type} className="border-b border-gray-100 last:border-b-0">
                              <button
                                onClick={() => toggleScopeSection(type)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                              >
                                {isExpanded
                                  ? <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                  : <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                }
                                <Icon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
                                <span className="ml-auto text-[10px] text-gray-400">{items.length}</span>
                              </button>
                              {isExpanded && (
                                <div className="pb-1">
                                  {items.map(item => {
                                    const isItemSelected = selectedOrgGroup === item.id
                                    return (
                                      <button
                                        key={item.id}
                                        onClick={() => { setSelectedOrgGroup(item.id); setScopeDropdownOpen(false) }}
                                        className={clsx(
                                          'w-full flex items-center gap-2 pl-9 pr-3 py-1.5 text-sm text-left transition-colors',
                                          isItemSelected
                                            ? 'bg-primary-50 text-primary-700 font-medium'
                                            : 'text-gray-700 hover:bg-gray-50'
                                        )}
                                      >
                                        <span className="truncate flex-1">{item.name}</span>
                                        {isItemSelected && <span className="text-[10px] text-primary-500 flex-shrink-0">Selected</span>}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Clear scope */}
                {viewMode === 'workload' && selectedOrgGroup && (
                  <button
                    onClick={() => setSelectedOrgGroup(null)}
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Clear</span>
                  </button>
                )}

                {/* Group By Dropdown - Multi-level (hidden for Workload, Matrix, History, and Requests views) */}
                {viewMode !== 'workload' && viewMode !== 'matrix' && viewMode !== 'gaps' && activeView !== 'history' && activeView !== 'requests' && (
                <div className="relative" ref={groupByRef}>
                  <button
                    onClick={() => setShowGroupByDropdown(!showGroupByDropdown)}
                    className={clsx(
                      "pl-3 pr-8 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm cursor-pointer min-w-[180px] text-left truncate",
                      ((viewMode === 'list' && listGroupBy === 'asset') || listGroupByLevels.length > 0) ? "border-primary-500 bg-primary-50 text-primary-700" : "border-gray-300 bg-white text-gray-700"
                    )}
                  >
                    {(() => {
                      const parts: string[] = []
                      if (viewMode === 'list' && listGroupBy === 'asset') parts.push('Asset')
                      if (listGroupByLevels.length > 0) parts.push(`${listGroupByLevels.length} level${listGroupByLevels.length > 1 ? 's' : ''}`)
                      return parts.length > 0 ? `Group by: ${parts.join(' + ')}` : 'Group by'
                    })()}
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
                    const isAssetMode = viewMode === 'list' && listGroupBy === 'asset'

                    return (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowGroupByDropdown(false)} />
                        <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                          {/* View mode options — only shown for list view */}
                          {viewMode === 'list' && (
                            <div className="border-b border-gray-200">
                              <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">View Mode</div>
                              <button
                                onClick={() => { setListGroupBy('asset'); setShowGroupByDropdown(false) }}
                                className={clsx(
                                  "w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors",
                                  isAssetMode ? "bg-primary-50 text-primary-700" : "hover:bg-gray-50 text-gray-700"
                                )}
                              >
                                <LayoutGrid className="h-4 w-4 text-gray-400" />
                                <span className="font-medium flex-1">Asset</span>
                                <span className="text-xs text-gray-400">Grouped by asset</span>
                                {isAssetMode && <Check className="h-4 w-4 text-primary-600 ml-1" />}
                              </button>
                              <button
                                onClick={() => { setListGroupBy('none'); setShowGroupByDropdown(false) }}
                                className={clsx(
                                  "w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors",
                                  !isAssetMode ? "bg-primary-50 text-primary-700" : "hover:bg-gray-50 text-gray-700"
                                )}
                              >
                                <List className="h-4 w-4 text-gray-400" />
                                <span className="font-medium flex-1">None</span>
                                <span className="text-xs text-gray-400">Flat rows</span>
                                {!isAssetMode && <Check className="h-4 w-4 text-primary-600 ml-1" />}
                              </button>
                            </div>
                          )}

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
                            {listGroupByLevels.length === 0 && !isAssetMode && (
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

                <div className="inline-flex rounded-lg border border-gray-200 p-1 bg-gray-100 ml-auto">
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
                <CoverageListView
                  filteredCoverage={filteredCoverage}
                  coverageRecords={coverageRecords}
                  uncoveredAssets={uncoveredAssets}
                  assets={assets}
                  coverageLoading={coverageLoading}
                  searchQuery={searchQuery}
                  viewerNodeIds={viewerNodeIds}
                  userTeamMemberships={userTeamMemberships}
                  portfolioTeamMemberships={portfolioTeamMemberships}
                  allOrgChartNodes={allOrgChartNodes}
                  allOrgChartNodeMembers={allOrgChartNodeMembers}
                  listVisibleColumns={listVisibleColumns}
                  setListVisibleColumns={setListVisibleColumns}
                  listGroupBy={listGroupBy}
                  listGroupByLevels={listGroupByLevels}
                  listSortColumn={listSortColumn}
                  listSortDirection={listSortDirection}
                  listColumnFilters={listColumnFilters}
                  setListColumnFilters={setListColumnFilters}
                  collapsedGroups={collapsedGroups}
                  setCollapsedGroups={setCollapsedGroups}
                  hiddenGroups={hiddenGroups}
                  setHiddenGroups={setHiddenGroups}
                  hideEmptyGroups={hideEmptyGroups}
                  setHideEmptyGroups={setHideEmptyGroups}
                  handleColumnSort={handleColumnSort}
                  handleFilterClick={handleFilterClick}
                  activeFilterColumn={activeFilterColumn}
                  setActiveFilterColumn={setActiveFilterColumn}
                  getUniqueFilterValues={getUniqueFilterValues}
                  setGroupContextMenu={setGroupContextMenu}
                  setViewHistoryAssetId={setViewHistoryAssetId}
                  setDeleteConfirm={setDeleteConfirm}
                  setAddingCoverage={setAddingCoverage}
                  setAssetSearchQuery={setAssetSearchQuery}
                  setAnalystSearchQuery={setAnalystSearchQuery}
                  setShowAssetDropdown={setShowAssetDropdown}
                  setShowAnalystDropdown={setShowAnalystDropdown}
                  setRequestingChange={setRequestingChange}
                  hasAnyCoverageAdminRights={hasAnyCoverageAdminRights}
                  canChangeVisibility={canChangeVisibility}
                  editingVisibility={editingVisibility}
                  setEditingVisibility={setEditingVisibility}
                  updateVisibilityMutation={updateVisibilityMutation}
                  coverageSettings={coverageSettings}
                  userTeams={userTeams}
                  getLocalDateString={getLocalDateString}
                  renderFlatGroupedContent={null}
                  onUpdateAssignment={(coverageId, updates) => updateAssignmentMutation.mutate({ coverageId, updates })}
                />
              )}
              {/* Gaps View */}
              {viewMode === 'gaps' && (
                <CoverageGapsView
                  gapsData={gapsData}
                  gapsLoading={gapsLoading}
                  searchQuery={searchQuery}
                  allAssetsWithStatus={allAssetsWithStatus}
                  portfolioUniverseData={portfolioUniverseData}
                  portfolioHoldings={portfolioHoldings}
                  filteredCoverage={filteredCoverage}
                  listGroupByLevels={listGroupByLevels}
                  collapsedGapsGroups={collapsedGapsGroups}
                  setCollapsedGapsGroups={setCollapsedGapsGroups}
                  setAddingCoverage={setAddingCoverage}
                  setAssetSearchQuery={setAssetSearchQuery}
                  hasAnyCoverageAdminRights={hasAnyCoverageAdminRights}
                  coverageSettings={coverageSettings}
                  userTeams={userTeams}
                  getLocalDateString={getLocalDateString}
                  addCoverageMutation={{ mutate: () => {} }}
                  users={users}
                  allOrgChartNodes={allOrgChartNodes}
                  currentUserId={user?.id}
                />
              )}
              {/* Workload View */}
              {viewMode === 'workload' && (
                <CoverageWorkloadView
                  filteredCoverage={filteredCoverage}
                  portfolioTeamMemberships={portfolioTeamMemberships}
                  portfolioNameToIdMap={portfolioNameToIdMap}
                  userTeamMemberships={userTeamMemberships}
                  allOrgChartNodes={allOrgChartNodes}
                  portfolioHoldings={portfolioHoldings}
                  userProfilesExtended={userProfilesExtended}
                  selectedAnalystId={selectedAnalystId}
                  setSelectedAnalystId={setSelectedAnalystId}
                  selectedStatCard={selectedStatCard}
                  setSelectedStatCard={setSelectedStatCard}
                  selectedOrgGroup={selectedOrgGroup}
                />
              )}

              {/* Matrix View */}
              {viewMode === 'matrix' && (
                <CoverageMatrixView
                  filteredCoverage={filteredCoverage}
                  allUncoveredAssets={allUncoveredAssets}
                  viewerNodeIds={viewerNodeIds}
                  userTeamMemberships={userTeamMemberships}
                  portfolioTeamMemberships={portfolioTeamMemberships}
                  allOrgChartNodes={allOrgChartNodes}
                  portfolioUniverseAssets={portfolioUniverseAssets}
                  portfolioHoldings={portfolioHoldings}
                  matrixGroupBy={matrixGroupBy}
                  setMatrixGroupBy={setMatrixGroupBy}
                  matrixSelectedAnalysts={matrixSelectedAnalysts}
                  setMatrixSelectedAnalysts={setMatrixSelectedAnalysts}
                  collapsedGroups={collapsedGroups}
                  setCollapsedGroups={setCollapsedGroups}
                  coverageSettings={coverageSettings}
                  userId={user?.id}
                />
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
                    <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 bg-gray-50/80">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-gray-900">
                          Coverage Activity
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
                        // Count structural events only (analyst_changed counts as both an end + an assign)
                        const assignedCount = periodEvents.filter(e => e.change_type === 'created' || e.change_type === 'coverage_added' || e.change_type === 'historical_added' || e.change_type === 'analyst_changed').length
                        const endedCount = periodEvents.filter(e => e.change_type === 'deleted' || e.change_type === 'analyst_changed').length
                        const scopeChangeCount = periodEvents.filter(e => e.change_type === 'scope_changed').length

                        // Get unique assets affected
                        const assetsAffected = new Set<string>()
                        periodEvents.forEach(e => {
                          if (e.asset_id) assetsAffected.add(e.asset_id)
                        })

                        return (
                          <div className="grid grid-cols-4 gap-3">
                            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
                              <p className="text-lg font-bold text-gray-900">{assignedCount}</p>
                              <p className="text-[10px] text-gray-500">Assignments Added</p>
                            </div>
                            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
                              <p className="text-lg font-bold text-gray-900">{endedCount}</p>
                              <p className="text-[10px] text-gray-500">Assignments Ended</p>
                            </div>
                            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
                              <p className="text-lg font-bold text-gray-900">{scopeChangeCount}</p>
                              <p className="text-[10px] text-gray-500">Scope Changes</p>
                            </div>
                            <div className="p-2.5 bg-white rounded-lg border border-gray-200">
                              <p className="text-lg font-bold text-gray-900">{assetsAffected.size}</p>
                              <p className="text-[10px] text-gray-500">Assets Affected</p>
                            </div>
                          </div>
                        )
                      })()}
                    </div>

                    {/* Table Header */}
                    <div className="flex-shrink-0 px-6 py-2 bg-white border-b border-gray-200">
                      <div className="grid gap-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider"
                        style={{ gridTemplateColumns: '120px 1fr 1.2fr 1fr 2fr 1fr 90px' }}
                      >
                        <div>Event</div>
                        <div>Asset</div>
                        <div>Analyst</div>
                        <div>Covers For</div>
                        <div>Change</div>
                        <div>Changed By</div>
                        <div className="text-right">Date</div>
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

                        // Detect transitions: "created" + "dates_changed" (end date set) close in time
                        // for same asset but different analyst → emit separate Ended + Assigned rows.
                        // Also split DB `analyst_changed` events into two rows.
                        const processedEvents = new Set<string>()
                        const syntheticEvents: any[] = []

                        // Detect created+dates_changed transition pairs
                        deduplicatedEvents.forEach((createdEvent) => {
                          if (createdEvent.change_type === 'created' && !processedEvents.has(createdEvent.id)) {
                            const matchingEndEvent = deduplicatedEvents.find((endEvent) => {
                              if (endEvent.change_type === 'dates_changed' &&
                                  endEvent.asset_id === createdEvent.asset_id &&
                                  endEvent.old_analyst_name !== createdEvent.new_analyst_name &&
                                  endEvent.new_end_date &&
                                  !processedEvents.has(endEvent.id)) {
                                const timeDiff = Math.abs(
                                  new Date(createdEvent.changed_at).getTime() -
                                  new Date(endEvent.changed_at).getTime()
                                )
                                return timeDiff < 10000
                              }
                              return false
                            })

                            if (matchingEndEvent) {
                              // Emit as two separate events: Coverage Ended + Coverage Assigned
                              processedEvents.add(createdEvent.id)
                              processedEvents.add(matchingEndEvent.id)
                              syntheticEvents.push({
                                ...matchingEndEvent,
                                id: `${matchingEndEvent.id}-ended`,
                                change_type: 'deleted',
                                old_analyst_name: matchingEndEvent.old_analyst_name,
                                old_end_date: matchingEndEvent.new_end_date,
                              })
                              syntheticEvents.push({
                                ...createdEvent,
                                id: `${createdEvent.id}-assigned`,
                                change_type: 'created',
                              })
                            }
                          }
                        })

                        // Split DB analyst_changed events into Ended + Assigned pair
                        deduplicatedEvents.forEach((event) => {
                          if (event.change_type === 'analyst_changed' && !processedEvents.has(event.id)) {
                            processedEvents.add(event.id)
                            syntheticEvents.push({
                              ...event,
                              id: `${event.id}-ended`,
                              change_type: 'deleted',
                              old_analyst_name: event.old_analyst_name,
                              new_analyst_name: null,
                              old_end_date: event.new_start_date || event.changed_at,
                            })
                            syntheticEvents.push({
                              ...event,
                              id: `${event.id}-assigned`,
                              change_type: 'created',
                              old_analyst_name: null,
                              new_analyst_name: event.new_analyst_name,
                            })
                          }
                        })

                        // Build final events list: keep unprocessed originals + synthetic replacements
                        const finalEvents = deduplicatedEvents
                          .filter(event => !processedEvents.has(event.id))
                          .concat(syntheticEvents)
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
                              let eventLabel = ''
                              let changeText = ''
                              let badgeColor = 'bg-gray-100 text-gray-600'
                              let dateToDisplay: string | null = null
                              const analystName = event.new_analyst_name || event.old_analyst_name || '—'
                              const assetSymbol = event.assets?.symbol || 'Unknown'

                              // Derive group name from joined coverage record
                              const cov = event.coverage
                              const groupName = cov?.visibility === 'firm'
                                ? 'Firm'
                                : cov?.teams?.name
                                  ? cov.teams.name
                                  : null
                              const isMissingGroup = !groupName

                              // Changed by — fallback to "System" for automated changes
                              const changedByUser = event.changed_by_user
                              const changedByName = changedByUser
                                ? (changedByUser.first_name && changedByUser.last_name
                                  ? `${changedByUser.first_name} ${changedByUser.last_name}`
                                  : changedByUser.email?.split('@')[0] || 'System')
                                : 'System'

                              const groupLabel = groupName || 'Missing group'

                              // Only 3 structural event types: Coverage Assigned, Coverage Ended, Scope Changed
                              if (event.change_type === 'created' || event.change_type === 'coverage_added' || event.change_type === 'historical_added') {
                                eventLabel = 'Coverage Assigned'
                                changeText = `${analystName} now covers ${assetSymbol} for ${groupLabel}`
                                dateToDisplay = event.new_start_date || event.changed_at
                                badgeColor = 'bg-emerald-50 text-emerald-700'
                              } else if (event.change_type === 'deleted') {
                                eventLabel = 'Coverage Ended'
                                const endAnalyst = event.old_analyst_name || event.new_analyst_name || '—'
                                changeText = `${endAnalyst} stopped covering ${assetSymbol} for ${groupLabel}`
                                dateToDisplay = event.old_end_date || event.changed_at
                                badgeColor = 'bg-red-50 text-red-700'
                              } else if (event.change_type === 'scope_changed') {
                                eventLabel = 'Scope Changed'
                                changeText = event.change_reason || `Scope updated for ${assetSymbol}`
                                dateToDisplay = event.changed_at
                                badgeColor = 'bg-blue-50 text-blue-700'
                              } else {
                                // dates_changed, role_change, etc. — skip non-structural events
                                return null
                              }

                              if (!dateToDisplay) return null
                              const eventDate = formatDate(dateToDisplay)

                              return (
                                <div
                                  key={event.id}
                                  className="px-6 py-2.5 hover:bg-gray-50/80 transition-colors cursor-pointer border-b border-gray-100"
                                  onClick={() => setSelectedHistoryEvent(event)}
                                >
                                  <div className="grid gap-3 items-center"
                                    style={{ gridTemplateColumns: '120px 1fr 1.2fr 1fr 2fr 1fr 90px' }}
                                  >
                                    {/* Event */}
                                    <div>
                                      <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap', badgeColor)}>
                                        {eventLabel}
                                      </span>
                                    </div>
                                    {/* Asset — clickable to filter */}
                                    <div className="min-w-0">
                                      <button
                                        className="text-[12px] font-semibold text-gray-900 truncate hover:text-primary-600 hover:underline transition-colors text-left"
                                        title={`View coverage for ${assetSymbol}`}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setSearchQuery(assetSymbol)
                                          setActiveView('active')
                                        }}
                                      >
                                        {assetSymbol}
                                      </button>
                                    </div>
                                    {/* Analyst */}
                                    <div className="min-w-0">
                                      <p className="text-[12px] text-gray-700 truncate">{analystName}</p>
                                    </div>
                                    {/* Covers For */}
                                    <div className="min-w-0">
                                      {isMissingGroup ? (
                                        <span
                                          className="inline-flex items-center gap-1 text-[12px] text-amber-600"
                                          title="This coverage assignment was created before group scope was required."
                                        >
                                          <AlertCircle className="h-3 w-3 flex-shrink-0" />
                                          <span className="truncate">Missing group</span>
                                        </span>
                                      ) : (
                                        <p className="text-[12px] text-gray-600 truncate">{groupName}</p>
                                      )}
                                    </div>
                                    {/* Change */}
                                    <div className="min-w-0">
                                      <p className="text-[12px] text-gray-700 truncate" title={changeText}>{changeText}</p>
                                    </div>
                                    {/* Changed By */}
                                    <div className="min-w-0">
                                      <p className={clsx('text-[12px] truncate', changedByName === 'System' ? 'text-gray-400 italic' : 'text-gray-500')}>{changedByName}</p>
                                    </div>
                                    {/* Date */}
                                    <div className="text-right">
                                      <p className="text-[12px] text-gray-600">{eventDate}</p>
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
            {activeView === 'requests' && (() => {
              // Derive group name for a request from active coverage records
              const deriveRequestGroup = (request: any): string => {
                if (!coverageRecords) return 'Unknown'
                // For change requests, find the current analyst's coverage for this asset
                if (request.request_type === 'change' && request.current_user_id) {
                  const match = coverageRecords.find(c => c.asset_id === request.asset_id && c.user_id === request.current_user_id && c.is_active)
                  if (match?.visibility === 'firm') return 'Firm'
                  if (match?.teams?.name) return match.teams.name
                }
                // For add requests or fallback, find any active coverage for the asset
                const assetCoverage = coverageRecords.filter(c => c.asset_id === request.asset_id && c.is_active)
                if (assetCoverage.length > 0) {
                  const first = assetCoverage[0]
                  if (first.visibility === 'firm') return 'Firm'
                  if (first.teams?.name) return first.teams.name
                }
                return 'Unknown'
              }

              // Status filter
              const statusFilters = [
                { value: 'pending', label: 'Pending' },
                { value: 'approved', label: 'Approved' },
                { value: 'denied', label: 'Denied' },
                { value: 'rescinded', label: 'Cancelled' },
                { value: 'all', label: 'All' },
              ] as const

              // Filter requests by status and search
              const statusFilteredRequests = filteredCoverageRequests.filter(request => {
                if (requestStatusFilter !== 'all' && request.status !== requestStatusFilter) return false
                if (!searchQuery) return true
                const query = searchQuery.toLowerCase()
                return (
                  request.assets?.symbol?.toLowerCase().includes(query) ||
                  request.assets?.company_name?.toLowerCase().includes(query) ||
                  request.current_analyst_name?.toLowerCase().includes(query) ||
                  request.requested_analyst_name?.toLowerCase().includes(query) ||
                  request.requester_name?.toLowerCase().includes(query)
                )
              })

              // No longer needed — request content is rendered inline in the column

              // Reviewed-by display helper
              const reviewerName = (request: any): string | null => {
                if (!request.reviewed_by_user) return null
                const u = request.reviewed_by_user
                return u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email?.split('@')[0] || null
              }

              return (
              <Card padding="none" className={`min-h-[500px] relative ${filteredCoverageRequests.length === 0 && !requestsFetching ? 'flex items-center justify-center' : ''}`}>
                {/* Loading overlay with blur */}
                {(requestsFetching) && (
                  <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  </div>
                )}
                {filteredCoverageRequests.length === 0 && !requestsFetching ? (
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
                  <div className="w-full">
                    {/* Status Filter Bar */}
                    <div className="flex-shrink-0 px-6 py-3 bg-gray-50/80 border-b border-gray-200">
                      <div className="flex items-center gap-1">
                        {statusFilters.map(sf => {
                          const count = sf.value === 'all'
                            ? filteredCoverageRequests.length
                            : filteredCoverageRequests.filter(r => r.status === sf.value).length
                          return (
                            <button
                              key={sf.value}
                              onClick={() => setRequestStatusFilter(sf.value as any)}
                              className={clsx(
                                'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                                requestStatusFilter === sf.value
                                  ? 'bg-white text-primary-700 shadow-sm'
                                  : 'text-gray-600 hover:text-gray-900'
                              )}
                            >
                              {sf.label}
                              {count > 0 && (
                                <span className={clsx(
                                  'ml-1.5 text-[10px] tabular-nums',
                                  requestStatusFilter === sf.value ? 'text-primary-500' : 'text-gray-400'
                                )}>
                                  {count}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Table Header */}
                    <div className="flex-shrink-0 px-6 py-2 bg-white border-b border-gray-200">
                      <div className="grid gap-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider"
                        style={{ gridTemplateColumns: '100px 1fr 1.2fr 1fr 1fr 1fr 100px' }}
                      >
                        <div>Type</div>
                        <div>Asset</div>
                        <div>Analyst</div>
                        <div>Covers For</div>
                        <div>Requested By</div>
                        <div>Status</div>
                        <div className="text-right">Date</div>
                      </div>
                    </div>

                    {/* Request Rows */}
                    <div className="divide-y divide-gray-100">
                      {statusFilteredRequests.length === 0 && (
                        <div className="px-6 py-12 text-center">
                          <p className="text-sm text-gray-500">
                            {requestStatusFilter === 'pending'
                              ? 'No pending requests. All coverage requests have been reviewed.'
                              : `No ${requestStatusFilter === 'all' ? '' : requestStatusFilter + ' '}requests found.`}
                          </p>
                        </div>
                      )}
                      {statusFilteredRequests.map((request) => {
                        const groupName = deriveRequestGroup(request)
                        const reviewer = reviewerName(request)
                        const isReasonExpanded = expandedReasonIds.has(request.id)
                        const statusLabel = request.status === 'rescinded' ? 'Cancelled' : request.status.charAt(0).toUpperCase() + request.status.slice(1)
                        const statusColor =
                          request.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                          request.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                          request.status === 'denied' ? 'bg-red-50 text-red-700' :
                          'bg-gray-100 text-gray-600'

                        return (
                          <div key={request.id} className="px-6 py-3 hover:bg-gray-50/80 transition-colors overflow-hidden">
                            <div className="grid gap-3 items-start"
                              style={{ gridTemplateColumns: '100px 1fr 1.2fr 1fr 1fr 1fr 100px' }}
                            >
                              {/* Type */}
                              <div>
                                <span className={clsx(
                                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap',
                                  request.request_type === 'add' ? 'bg-emerald-50 text-emerald-700' :
                                  request.request_type === 'change' ? 'bg-blue-50 text-blue-700' :
                                  'bg-gray-100 text-gray-600'
                                )}>
                                  {request.request_type === 'add' ? 'Add coverage' : request.request_type === 'change' ? 'Change coverage' : request.request_type.charAt(0).toUpperCase() + request.request_type.slice(1)}
                                </span>
                              </div>

                              {/* Asset — clickable to filter */}
                              <div className="min-w-0">
                                <button
                                  className="text-[12px] font-semibold text-gray-900 truncate hover:text-primary-600 hover:underline transition-colors text-left"
                                  title={`View coverage for ${request.assets?.symbol || 'Unknown'}`}
                                  onClick={() => {
                                    setSearchQuery(request.assets?.symbol || '')
                                    setActiveView('active')
                                  }}
                                >
                                  {request.assets?.symbol || 'Unknown'}
                                </button>
                                <p className="text-[10px] text-gray-500 truncate">
                                  {request.assets?.company_name || ''}
                                </p>
                              </div>

                              {/* Request — compact inline description */}
                              <div className="min-w-0 overflow-hidden">
                                {request.request_type === 'add' ? (
                                  <p className="text-[12px] text-gray-700 truncate">
                                    Assign <span className="font-medium text-gray-900">{request.requested_analyst_name}</span>
                                  </p>
                                ) : request.request_type === 'change' ? (
                                  <p className="text-[12px] text-gray-700 truncate">
                                    <span className="text-gray-500">{request.current_analyst_name || 'No current coverage'}</span>
                                    <span className="mx-1 text-gray-400">&rarr;</span>
                                    <span className="font-medium text-gray-900">{request.requested_analyst_name}</span>
                                  </p>
                                ) : (
                                  <p className="text-[12px] text-gray-700 truncate">
                                    {request.requested_analyst_name}
                                  </p>
                                )}
                                {request.reason && (
                                  <button
                                    onClick={() => setExpandedReasonIds(prev => {
                                      const next = new Set(prev)
                                      if (next.has(request.id)) next.delete(request.id)
                                      else next.add(request.id)
                                      return next
                                    })}
                                    className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                                  >
                                    <ChevronRight className={clsx('h-2.5 w-2.5 transition-transform', isReasonExpanded && 'rotate-90')} />
                                    Reason
                                  </button>
                                )}
                                {request.reason && isReasonExpanded && (
                                  <div className="mt-1 pl-2 border-l-2 border-gray-100" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                                    <p className="text-[11px] text-gray-600 line-clamp-3" title={request.reason}>{request.reason}</p>
                                  </div>
                                )}
                              </div>

                              {/* Covers For */}
                              <div className="min-w-0">
                                {groupName === 'Unknown' ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-[12px] text-amber-600"
                                    title="This request was created before group scope was required."
                                  >
                                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">Missing scope</span>
                                  </span>
                                ) : (
                                  <p className="text-[12px] text-gray-600 truncate">{groupName}</p>
                                )}
                              </div>

                              {/* Requested By */}
                              <div className="min-w-0">
                                <p className="text-[12px] text-gray-900 truncate">
                                  {request.requested_by_user?.first_name && request.requested_by_user?.last_name
                                    ? `${request.requested_by_user.first_name} ${request.requested_by_user.last_name}`
                                    : request.requested_by_user?.email?.split('@')[0] || 'Unknown'}
                                </p>
                                <p className="text-[10px] text-gray-400">
                                  {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
                                </p>
                              </div>

                              {/* Status — includes approval metadata and actions */}
                              <div className="min-w-0">
                                {request.status === 'pending' ? (
                                  <div>
                                    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', statusColor)}>
                                      Pending
                                    </span>
                                    <div className="flex items-center gap-1.5 mt-1.5">
                                      {hasAnyCoverageAdminRights ? (
                                        <>
                                          <button
                                            onClick={() => approveCoverageRequestMutation.mutate(request.id)}
                                            disabled={approveCoverageRequestMutation.isPending}
                                            className="px-2 py-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors disabled:opacity-50"
                                          >
                                            Approve
                                          </button>
                                          <button
                                            onClick={() => denyCoverageRequestMutation.mutate(request.id)}
                                            disabled={denyCoverageRequestMutation.isPending}
                                            className="px-2 py-0.5 text-[10px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors disabled:opacity-50"
                                          >
                                            Deny
                                          </button>
                                        </>
                                      ) : request.requested_by === user?.id ? (
                                        <button
                                          onClick={() => setRescindingRequest({
                                            requestId: request.id,
                                            assetSymbol: request.assets?.symbol || 'Unknown'
                                          })}
                                          disabled={rescindCoverageRequestMutation.isPending}
                                          className="px-2 py-0.5 text-[10px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
                                        >
                                          Cancel
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', statusColor)}>
                                      {statusLabel}
                                    </span>
                                    {reviewer && (
                                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">by {reviewer}</p>
                                    )}
                                    {request.reviewed_at && (
                                      <p className="text-[10px] text-gray-400 truncate">
                                        {new Date(request.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                      </p>
                                    )}
                                    {request.status === 'rescinded' && request.requested_by === user?.id && (
                                      <button
                                        onClick={() => resubmitCoverageRequestMutation.mutate(request.id)}
                                        disabled={resubmitCoverageRequestMutation.isPending}
                                        className="mt-1 px-2 py-0.5 text-[10px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors disabled:opacity-50"
                                      >
                                        Resubmit
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Date */}
                              <div className="text-right">
                                <p className="text-[12px] text-gray-600">
                                  {new Date(request.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </Card>
              )
            })()}
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
            <div className="flex items-center justify-between p-5 pb-3 border-b border-gray-200 flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{addingCoverage.editingCoverageId ? 'Edit Assignment' : 'Add Coverage Assignment'}</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {addingCoverage.editingCoverageId ? 'Update role, dates, or notes for this assignment.' : 'Assign an analyst to cover an asset for a specific org group.'}
                </p>
              </div>
              <button
                onClick={() => setAddingCoverage(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {/* ── Edit mode: assignment identity (read-only) ── */}
              {addingCoverage.editingCoverageId && (() => {
                const editAsset = assets?.find(a => a.id === addingCoverage.assetId)
                const editScopeLabel = addingCoverage.visibility === 'firm'
                  ? 'Firm-wide'
                  : addingCoverage.teamId
                    ? allOrgChartNodes?.nodes.find((n: any) => n.id === addingCoverage.teamId)?.displayName || 'Unknown group'
                    : '—'
                return (
                  <div className="bg-gray-50 border border-gray-200 border-l-2 border-l-primary-400 rounded-lg px-4 py-3">
                    <div className="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-1.5">
                      <span className="text-xs font-medium text-gray-400">Asset</span>
                      <span className="text-sm text-gray-800">
                        <span className="font-semibold">{editAsset?.symbol || '—'}</span>
                        {editAsset?.company_name && (
                          <span className="text-gray-500 ml-1.5">{editAsset.company_name}</span>
                        )}
                      </span>
                      <span className="text-xs font-medium text-gray-400">Scope</span>
                      <span className="text-sm text-gray-800">{editScopeLabel}</span>
                      <span className="text-xs font-medium text-gray-400">Analyst</span>
                      <span className="text-sm text-gray-800">{analystSearchQuery}</span>
                    </div>
                  </div>
                )
              })()}

              {/* ── Asset (add mode only) ──────────────────── */}
              {!addingCoverage.editingCoverageId && (
              <div className="relative asset-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Asset *
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={assetSearchQuery}
                    onChange={(e) => {
                      if (addingCoverage.editingCoverageId) return
                      setAssetSearchQuery(e.target.value)
                      setShowAssetDropdown(true)
                    }}
                    onFocus={() => { if (!addingCoverage.editingCoverageId) setShowAssetDropdown(true) }}
                    readOnly={!!addingCoverage.editingCoverageId}
                    placeholder="Search for an asset..."
                    className={clsx(
                      'w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500',
                      addingCoverage.editingCoverageId && 'bg-gray-50 text-gray-500 cursor-not-allowed',
                    )}
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
              )}

              {/* ── Current Coverage roster ── */}
              {coverageSettings?.enable_hierarchy && addingCoverage.assetId && (() => {
                const isEditMode = !!addingCoverage.editingCoverageId

                // ── Helpers ──
                const scopeSelected =
                  (addingCoverage.visibility === 'firm' && addingCoverage.teamId === null)
                  || !!addingCoverage.teamId

                const isSameScope = (c: CoverageRecord) => {
                  if (addingCoverage.visibility === 'firm' && addingCoverage.teamId === null) {
                    return c.visibility === 'firm'
                  }
                  return c.team_id === addingCoverage.teamId
                }

                const roleBadge = (c: CoverageRecord) => {
                  if (c.is_lead) return 'Lead'
                  if (c.role) return c.role.charAt(0).toUpperCase() + c.role.slice(1)
                  return null
                }

                const roleValue = (c: CoverageRecord) =>
                  c.is_lead ? 'lead' : c.role || ''

                const scopeLabel = (c: CoverageRecord) =>
                  c.visibility === 'firm' ? 'Firm-wide' : c.teams?.name || '—'

                // ── Records ──
                const allOtherRecords = coverageRecords?.filter(
                  c => c.asset_id === addingCoverage.assetId
                    && c.is_active
                    && c.id !== addingCoverage.editingCoverageId
                ) || []

                if (allOtherRecords.length === 0) return null

                const selectedAsset = assets?.find(a => a.id === addingCoverage.assetId)
                const currentScopeLabel =
                  addingCoverage.visibility === 'firm' && addingCoverage.teamId === null
                    ? 'Firm-wide'
                    : allOrgChartNodes?.nodes.find((n: any) => n.id === addingCoverage.teamId)?.displayName || 'Group'
                const currentScopeHasRoles = addingCoverage.visibility !== 'firm'

                // ────────────────────────────────────────────
                // Add mode: single read-only list of all existing coverage
                // ────────────────────────────────────────────
                if (!isEditMode) {
                  return (
                    <div className="border border-dashed border-gray-200 rounded-lg overflow-hidden bg-gray-50/30">
                      <div className="px-3 py-1.5 border-b border-gray-100">
                        <span className="text-xs font-medium text-gray-500">
                          Current coverage · {selectedAsset?.symbol || ''}
                        </span>
                      </div>
                      <div className="divide-y divide-gray-100/50">
                        {allOtherRecords.map(c => (
                          <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                            <span className="text-xs text-gray-600 truncate min-w-0 flex-1">
                              {c.analyst_name}
                            </span>
                            {roleBadge(c) && (
                              <span className="text-[11px] text-gray-400 bg-gray-100/70 px-1.5 py-0.5 rounded">
                                {roleBadge(c)}
                              </span>
                            )}
                            <span className="text-[11px] text-gray-400 bg-gray-100/70 px-1.5 py-0.5 rounded shrink-0">
                              {scopeLabel(c)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }

                // ────────────────────────────────────────────
                // Edit mode: scope-partitioned with inline role editing for same-scope
                // ────────────────────────────────────────────
                const sameScope = scopeSelected ? allOtherRecords.filter(isSameScope) : []
                const otherScope = scopeSelected ? allOtherRecords.filter(c => !isSameScope(c)) : allOtherRecords

                const sameScopeUserIds = new Set(sameScope.map(c => c.user_id))
                const duplicateUserIds = new Set(
                  otherScope.filter(c => sameScopeUserIds.has(c.user_id)).map(c => c.user_id)
                )

                return (
                  <div className="space-y-2">
                    {/* ── Same-scope section (editable) ── */}
                    {scopeSelected && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
                          <span className="text-xs font-medium text-gray-600">
                            {currentScopeLabel} coverage
                          </span>
                        </div>
                        {sameScope.length > 0 ? (
                          <div className="divide-y divide-gray-100">
                            {sameScope.map(c => (
                              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50/60 transition-colors">
                                <span className="text-xs text-gray-800 truncate min-w-0 flex-1">
                                  {c.analyst_name}
                                </span>
                                {currentScopeHasRoles ? (
                                  <select
                                    value={roleValue(c)}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      updateAssignmentMutation.mutate({
                                        coverageId: c.id,
                                        updates: {
                                          role: v === 'lead' || v === '' ? null : v,
                                          is_lead: v === 'lead',
                                        },
                                      })
                                    }}
                                    className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
                                  >
                                    <option value="">(None)</option>
                                    <option value="lead">Lead</option>
                                    <option value="primary">Primary</option>
                                    <option value="secondary">Secondary</option>
                                    <option value="tertiary">Tertiary</option>
                                  </select>
                                ) : roleBadge(c) ? (
                                  <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                    {roleBadge(c)}
                                  </span>
                                ) : null}
                                <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                  {currentScopeLabel}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2.5">
                            <p className="text-xs text-gray-400">
                              No {currentScopeLabel.toLowerCase()} coverage yet for {selectedAsset?.symbol || 'this asset'}.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Other-scope section (read-only context) ── */}
                    {otherScope.length > 0 && (
                      <div className="border border-dashed border-gray-200 rounded-lg overflow-hidden bg-gray-50/30">
                        <div className="px-3 py-1.5 border-b border-gray-100 flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-400">
                            {scopeSelected ? 'Also covered in other scopes' : `All current coverage · ${selectedAsset?.symbol || ''}`}
                          </span>
                          {scopeSelected && (
                            <span className="text-[10px] text-gray-300 italic">Context only</span>
                          )}
                        </div>
                        <div className="divide-y divide-gray-100/50">
                          {otherScope.map(c => (
                            <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                              <span className="text-xs text-gray-500 truncate min-w-0 flex-1">
                                {c.analyst_name}
                                {duplicateUserIds.has(c.user_id) && (
                                  <span className="text-[10px] text-gray-300 ml-1">
                                    (also in {currentScopeLabel})
                                  </span>
                                )}
                              </span>
                              {roleBadge(c) && (
                                <span className="text-[11px] text-gray-400 bg-gray-100/70 px-1.5 py-0.5 rounded">
                                  {roleBadge(c)}
                                </span>
                              )}
                              <span className="text-[11px] text-gray-400 bg-gray-100/70 px-1.5 py-0.5 rounded shrink-0">
                                {scopeLabel(c)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── Covers For (add mode only) ─────────────── */}
              {!addingCoverage.editingCoverageId && (() => {
                const selectedValue = addingCoverage.visibility === 'firm' && addingCoverage.teamId === null
                  ? '__firm__'
                  : addingCoverage.teamId || ''
                const selectedLabel = selectedValue === '__firm__'
                  ? 'Firm-wide'
                  : selectedValue
                    ? allOrgChartNodes?.nodes.find((n: any) => n.id === selectedValue)?.displayName || 'Select a group…'
                    : 'Select a group…'

                const NODE_TYPE_SECTIONS: Array<{ type: string; label: string }> = [
                  { type: 'division',   label: 'Divisions' },
                  { type: 'department', label: 'Departments' },
                  { type: 'team',       label: 'Teams' },
                  { type: 'portfolio',  label: 'Portfolios' },
                ]

                const handleSelect = (val: string) => {
                  if (val === '__firm__') {
                    setAddingCoverage({ ...addingCoverage, teamId: null, visibility: 'firm' })
                  } else {
                    const node = allOrgChartNodes?.nodes.find((n: any) => n.id === val)
                    const vis = node?.node_type === 'division' || node?.node_type === 'department' ? 'division' : 'team'
                    setAddingCoverage({ ...addingCoverage, teamId: val, visibility: vis as 'team' | 'division' | 'firm' })
                  }
                  setCoversForDropdownOpen(false)
                }

                return (
                  <div className="relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Covers For *
                    </label>
                    <button
                      type="button"
                      onClick={() => setCoversForDropdownOpen(prev => !prev)}
                      className={clsx(
                        'w-full flex items-center justify-between px-3 py-2 border rounded-lg text-sm text-left',
                        'focus:outline-none focus:ring-2 focus:ring-primary-500',
                        coversForDropdownOpen ? 'border-primary-400 ring-2 ring-primary-500/20' : 'border-gray-300',
                      )}
                    >
                      <span className={selectedValue ? 'text-gray-900' : 'text-gray-400'}>{selectedLabel}</span>
                      <ChevronDown size={14} className={clsx('text-gray-400 transition-transform', coversForDropdownOpen && 'rotate-180')} />
                    </button>

                    {coversForDropdownOpen && (
                      <>
                      <div className="fixed inset-0 z-40" onClick={() => setCoversForDropdownOpen(false)} />
                      <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                        {/* Firm-wide */}
                        <button
                          type="button"
                          onClick={() => handleSelect('__firm__')}
                          className={clsx(
                            'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors',
                            selectedValue === '__firm__' && 'bg-primary-50 text-primary-700 font-medium',
                          )}
                        >
                          Firm-wide
                          {selectedValue === '__firm__' && <Check size={13} className="ml-auto text-primary-500" />}
                        </button>
                        <div className="border-t border-gray-100" />

                        {/* Grouped by type */}
                        {NODE_TYPE_SECTIONS.map(section => {
                          const nodes = (allOrgChartNodes?.nodes || []).filter((n: any) => n.node_type === section.type)
                          if (nodes.length === 0) return null
                          const sectionKey = `coversFor-section-${section.type}`
                          const isExpanded = coversForExpandedSections.has(section.type)

                          return (
                            <div key={sectionKey}>
                              <button
                                type="button"
                                onClick={() => setCoversForExpandedSections(prev => {
                                  const next = new Set(prev)
                                  if (next.has(section.type)) next.delete(section.type)
                                  else next.add(section.type)
                                  return next
                                })}
                                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                              >
                                {isExpanded
                                  ? <ChevronDown size={12} className="text-gray-400" />
                                  : <ChevronRight size={12} className="text-gray-400" />}
                                {section.label}
                                <span className="ml-auto text-[10px] text-gray-400">{nodes.length}</span>
                              </button>
                              {isExpanded && nodes.map((n: any) => (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => handleSelect(n.id)}
                                  className={clsx(
                                    'w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-sm text-left hover:bg-gray-50 transition-colors',
                                    selectedValue === n.id && 'bg-primary-50 text-primary-700 font-medium',
                                  )}
                                >
                                  {n.displayName}
                                  {selectedValue === n.id && <Check size={13} className="ml-auto text-primary-500 shrink-0" />}
                                </button>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                      </>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Determines coverage scope. The same analyst can cover an asset in multiple scopes with different roles.
                    </p>
                  </div>
                )
              })()}

              {/* ── Analyst (add mode only) ─────────────────── */}
              {!addingCoverage.editingCoverageId && (
              <div className="relative analyst-search-container">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Analyst *
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={analystSearchQuery}
                    onChange={(e) => {
                      if (addingCoverage.editingCoverageId) return
                      setAnalystSearchQuery(e.target.value)
                      setShowAnalystDropdown(true)
                    }}
                    onFocus={() => { if (!addingCoverage.editingCoverageId) setShowAnalystDropdown(true) }}
                    readOnly={!!addingCoverage.editingCoverageId}
                    placeholder="Search for an analyst..."
                    className={clsx(
                      'w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500',
                      addingCoverage.editingCoverageId && 'bg-gray-50 text-gray-500 cursor-not-allowed',
                    )}
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
              )}

              {/* Edit mode: visual divider between context and editable fields */}
              {addingCoverage.editingCoverageId && (
                <div className="border-t border-gray-100" />
              )}

              {/* ── Start Date ─────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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

                {/* ── End Date ──────────────────────────────── */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
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
                    Leave blank if coverage is active.
                  </p>
                </div>
              </div>

              {/* ── Role (scope-aware) ────────────────────── */}
              {coverageSettings?.enable_hierarchy && (() => {
                const scopeHasRoles = addingCoverage.visibility !== 'firm'
                const scopeName = addingCoverage.visibility === 'firm' && addingCoverage.teamId === null
                  ? 'firm-wide'
                  : allOrgChartNodes?.nodes.find((n: any) => n.id === addingCoverage.teamId)?.displayName || 'this scope'

                if (!scopeHasRoles) {
                  // In edit mode, explain why no role control is shown
                  // In add mode, skip entirely — user may still change scope
                  return addingCoverage.editingCoverageId ? (
                    <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="text-xs text-gray-400 italic">
                        Roles are not used for firm-wide coverage.
                      </p>
                    </div>
                  ) : null
                }

                return (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Role
                    </label>
                    <select
                      value={
                        addingCoverage.isLead ? 'lead'
                        : addingCoverage.role || ''
                      }
                      onChange={(e) => {
                        const v = e.target.value
                        setAddingCoverage({
                          ...addingCoverage,
                          role: v === 'lead' || v === '' ? null : v,
                          isLead: v === 'lead',
                        })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">(None)</option>
                      <option value="lead">Lead</option>
                      <option value="primary">Primary</option>
                      <option value="secondary">Secondary</option>
                      <option value="tertiary">Tertiary</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      This role applies only within {scopeName} coverage.
                    </p>
                  </div>
                )
              })()}

              {/* ── Notes ──────────────────────────────────── */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={addingCoverage.notes}
                  onChange={(e) => setAddingCoverage({
                    ...addingCoverage,
                    notes: e.target.value
                  })}
                  placeholder="Optional notes about this assignment..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>

              {/* ── Assignment preview (add mode) ─────────── */}
              {!addingCoverage.editingCoverageId && (() => {
                const previewAnalyst = analystSearchQuery && addingCoverage.analystId ? analystSearchQuery : null
                const previewAsset = assetSearchQuery && addingCoverage.assetId ? assetSearchQuery.split(' - ')[0] : null
                const previewGroup = addingCoverage.visibility === 'firm' && addingCoverage.teamId === null
                  ? 'Firm-wide'
                  : addingCoverage.teamId
                    ? allOrgChartNodes?.nodes.find((n: any) => n.id === addingCoverage.teamId)?.displayName || null
                    : null
                const previewDate = addingCoverage.startDate
                  ? new Date(addingCoverage.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : null
                const previewRole = addingCoverage.visibility !== 'firm' && coverageSettings?.enable_hierarchy
                  ? (addingCoverage.isLead ? 'Lead' : addingCoverage.role ? addingCoverage.role.charAt(0).toUpperCase() + addingCoverage.role.slice(1) : null)
                  : null

                if (!previewAnalyst && !previewAsset) return null

                // Detect if analyst already covers this asset in another scope
                const existingOtherScopes = previewAnalyst && addingCoverage.analystId
                  ? (coverageRecords || []).filter(c =>
                      c.asset_id === addingCoverage.assetId
                      && c.user_id === addingCoverage.analystId
                      && c.is_active
                      && !(addingCoverage.visibility === 'firm' && addingCoverage.teamId === null
                        ? c.visibility === 'firm'
                        : c.team_id === addingCoverage.teamId)
                    )
                  : []

                return (
                  <div className="space-y-1.5">
                    <div className="px-3 py-2 bg-primary-50/30 border border-primary-100 rounded-lg">
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">{previewAnalyst || '___'}</span> will cover{' '}
                        <span className="font-semibold text-gray-900">{previewAsset || '___'}</span>
                        {previewGroup ? <> for <span className="font-medium">{previewGroup}</span></> : null}
                        {previewDate ? <>, starting {previewDate}</> : null}
                        {previewRole ? <> as <span className="font-medium">{previewRole}</span></> : null}
                        .
                      </p>
                    </div>
                    {existingOtherScopes.length > 0 && (
                      <p className="text-[11px] text-gray-400 px-1">
                        {previewAnalyst} already covers this asset
                        {existingOtherScopes.length === 1
                          ? ` for ${existingOtherScopes[0].visibility === 'firm' ? 'Firm-wide' : existingOtherScopes[0].teams?.name || 'another scope'}`
                          : ` in ${existingOtherScopes.length} other scopes`
                        }. This creates a separate scoped assignment.
                      </p>
                    )}
                  </div>
                )
              })()}
            </div>

            <div className="flex justify-end gap-3 p-5 pt-3 border-t border-gray-200 flex-shrink-0">
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

                    // ── Edit mode: update existing record ──
                    if (addingCoverage.editingCoverageId) {
                      const { error } = await supabase
                        .from('coverage')
                        .update({
                          team_id: addingCoverage.teamId,
                          visibility: addingCoverage.visibility,
                          role: coverageSettings?.enable_hierarchy && addingCoverage.visibility !== 'firm' ? (addingCoverage.role || null) : null,
                          notes: addingCoverage.notes || null,
                          is_lead: coverageSettings?.enable_hierarchy && addingCoverage.visibility !== 'firm' ? addingCoverage.isLead : false,
                          start_date: addingCoverage.startDate,
                          end_date: addingCoverage.endDate || null,
                          changed_by: user?.id,
                        })
                        .eq('id', addingCoverage.editingCoverageId)
                      if (error) throw error

                      queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
                      queryClient.invalidateQueries({ queryKey: ['coverage'] })
                      queryClient.invalidateQueries({ queryKey: ['asset-coverage-history'] })
                      setAddingCoverage(null)
                      return
                    }

                    // ── Add mode: check for conflicts then insert ──

                    // Check for any existing active coverage on this asset (all analysts, all scopes)
                    const existingActiveCoverage = coverageRecords?.filter(
                      c => c.asset_id === addingCoverage.assetId &&
                           c.is_active
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
                          analyst_name: c.analyst_name,
                          visibility: c.visibility,
                          team_name: c.visibility === 'firm' ? undefined : (c.teams?.name || undefined),
                          role: c.role,
                          is_lead: c.is_lead
                        })),
                        newAnalystId: addingCoverage.analystId,
                        newAnalystName: analystName,
                        startDate: addingCoverage.startDate,
                        endDate: addingCoverage.endDate,
                        notes: addingCoverage.notes,
                        isLead: addingCoverage.isLead,
                        teamId: addingCoverage.teamId,
                        visibility: addingCoverage.visibility,
                        role: coverageSettings?.enable_hierarchy && addingCoverage.visibility !== 'firm'
                          ? (addingCoverage.role || null) : null
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

                    // Insert coverage record - visibility and team_id from modal selector
                    const baseRecord = {
                      asset_id: addingCoverage.assetId,
                      user_id: addingCoverage.analystId,
                      analyst_name: analystName,
                      start_date: addingCoverage.startDate,
                      end_date: addingCoverage.endDate || null,
                      is_active: !addingCoverage.endDate || addingCoverage.endDate >= getLocalDateString(),
                      changed_by: user?.id,
                      role: coverageSettings?.enable_hierarchy && addingCoverage.visibility !== 'firm' ? (addingCoverage.role || null) : null,
                      notes: addingCoverage.notes || null,
                      team_id: addingCoverage.teamId,
                      visibility: addingCoverage.visibility,
                      is_lead: coverageSettings?.enable_hierarchy && addingCoverage.visibility !== 'firm' ? addingCoverage.isLead : false,
                      organization_id: currentOrgId
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
                      title: addingCoverage.editingCoverageId ? 'Error Updating Assignment' : 'Error Adding Assignment',
                      message: error.message || 'Failed to save the assignment. Please try again.'
                    })
                  }
                }}
                disabled={!addingCoverage.assetId || !addingCoverage.analystId || !addingCoverage.startDate}
              >
                {addingCoverage.editingCoverageId ? 'Save Changes' : 'Add Assignment'}
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
      {/* Bulk Upload Modal */}
      {showBulkUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => {
            setShowBulkUpload(false)
            setUploadFile(null)
            setUploadPreview(null)
            setUploadErrors([])
            setUploadSuccess(null)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }} />
          <div className="relative bg-white rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Bulk Upload Coverage</h3>
                <p className="text-xs text-gray-500 mt-0.5">Import coverage assignments from a CSV file.</p>
              </div>
              <button onClick={() => {
                setShowBulkUpload(false)
                setUploadFile(null)
                setUploadPreview(null)
                setUploadErrors([])
                setUploadSuccess(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Template Download + Column Reference */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Template</p>
                      <p className="text-[10px] text-gray-400">Includes available groups reference tab</p>
                    </div>
                  </div>
                  <button onClick={downloadTemplate} className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1.5 flex-shrink-0">
                    <Download className="h-3 w-3" />
                    Download
                  </button>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Required</p>
                    <div className="space-y-0.5">
                      <div><span className="font-mono font-medium text-gray-700">asset_symbol</span><span className="text-gray-400 ml-1.5">— ticker symbol (e.g. NVDA)</span></div>
                      <div><span className="font-mono font-medium text-gray-700">analyst_email</span><span className="text-gray-400 ml-1.5">— must match an existing user</span></div>
                      <div><span className="font-mono font-medium text-gray-700">group</span><span className="text-gray-400 ml-1.5">— org group name or &quot;Firm&quot;</span></div>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Optional</p>
                    <div className="space-y-0.5">
                      <div><span className="font-mono text-gray-400">start_date</span><span className="text-gray-300 ml-1.5">— YYYY-MM-DD, defaults to today</span></div>
                      <div><span className="font-mono text-gray-400">end_date</span><span className="text-gray-300 ml-1.5">— YYYY-MM-DD, leave blank for ongoing</span></div>
                      <div><span className="font-mono text-gray-400">notes</span><span className="text-gray-300 ml-1.5">— free-text notes</span></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Available Groups Reference */}
              {allOrgChartNodes?.nodes && allOrgChartNodes.nodes.length > 0 && (() => {
                const q = groupRefSearch.toLowerCase()
                const sortedNodes = allOrgChartNodes.nodes
                  .slice()
                  .sort((a: any, b: any) => a.node_type.localeCompare(b.node_type) || a.name.localeCompare(b.name))
                const resolveParent = (n: any) => n.parent_id
                  ? allOrgChartNodes.nodes.find((p: any) => p.id === n.parent_id)?.name
                    || allOrgChartNodes.allNodes?.find((p: any) => p.id === n.parent_id)?.name
                    || '—'
                  : '—'
                const showFirm = !q || 'firm'.includes(q)
                const filteredNodes = q
                  ? sortedNodes.filter((n: any) => n.name.toLowerCase().includes(q) || n.node_type.toLowerCase().includes(q) || resolveParent(n).toLowerCase().includes(q))
                  : sortedNodes
                const matchCount = filteredNodes.length + (showFirm ? 1 : 0)

                return (
                  <details className="group border border-gray-200 rounded-lg overflow-hidden" onToggle={() => setGroupRefSearch('')}>
                    <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-gray-50 transition-colors text-xs font-medium text-gray-700 list-none [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-3.5 w-3.5 text-gray-400 transition-transform group-open:rotate-90" />
                      Available groups
                      <span className="text-[10px] text-gray-400 font-normal ml-auto">{allOrgChartNodes.nodes.length + 1} options</span>
                    </summary>
                    <div className="border-t border-gray-200">
                      <div className="px-3 py-2 border-b border-gray-100">
                        <input
                          type="text"
                          value={groupRefSearch}
                          onChange={(e) => setGroupRefSearch(e.target.value)}
                          placeholder="Search groups..."
                          className="w-full text-[11px] px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-300 focus:border-primary-300 placeholder:text-gray-300"
                        />
                      </div>
                      <div className="max-h-[180px] overflow-y-auto">
                        <table className="w-full text-[11px]">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                              <th className="px-3 py-1.5 text-left">Group name</th>
                              <th className="px-3 py-1.5 text-left">Type</th>
                              <th className="px-3 py-1.5 text-left">Parent</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {showFirm && (
                              <tr>
                                <td className="px-3 py-1.5 font-medium text-gray-700">Firm</td>
                                <td className="px-3 py-1.5 text-gray-400">firm-wide</td>
                                <td className="px-3 py-1.5 text-gray-300">—</td>
                              </tr>
                            )}
                            {filteredNodes.map((n: any) => (
                              <tr key={n.id}>
                                <td className="px-3 py-1.5 font-medium text-gray-700">{n.name}</td>
                                <td className="px-3 py-1.5 text-gray-400">{n.node_type}</td>
                                <td className="px-3 py-1.5 text-gray-400">{resolveParent(n)}</td>
                              </tr>
                            ))}
                            {matchCount === 0 && (
                              <tr>
                                <td colSpan={3} className="px-3 py-3 text-center text-gray-400">No matching groups</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                )
              })()}

              {/* File Selection — drag-and-drop zone */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Upload file</label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true) }}
                  onDragEnter={(e) => { e.preventDefault(); setIsDraggingFile(true) }}
                  onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingFile(false) }}
                  onDrop={handleFileDrop}
                  className={`relative rounded-lg border-2 border-dashed transition-colors ${
                    isDraggingFile
                      ? 'border-primary-400 bg-primary-50/50'
                      : 'border-gray-200 hover:border-gray-300'
                  } px-4 py-5 text-center`}
                >
                  <Upload className={`mx-auto h-6 w-6 mb-2 ${isDraggingFile ? 'text-primary-500' : 'text-gray-300'}`} />
                  <p className="text-xs text-gray-500">
                    {isDraggingFile ? (
                      <span className="font-medium text-primary-600">Drop file here</span>
                    ) : (
                      <>
                        Drag &amp; drop a CSV or Excel file, or{' '}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="font-medium text-primary-600 hover:text-primary-700 underline underline-offset-2"
                        >
                          browse
                        </button>
                      </>
                    )}
                  </p>
                  {!isDraggingFile && (
                    <p className="text-[10px] text-gray-300 mt-1">Max file size 5 MB</p>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileSelect}
                    className="sr-only"
                  />
                </div>
                {uploadFile && !uploadPreview && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                    <div className="animate-spin rounded-full h-3 w-3 border-b border-gray-400" />
                    Parsing {uploadFile.name}...
                  </div>
                )}
                {uploadPreview && (
                  <div className="mt-2.5 space-y-2">
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">{uploadPreview.fileName}</span>
                    </p>
                    {/* Validation summary counters */}
                    {(() => {
                      const totalRows = uploadPreview.rowCount
                      const validCount = uploadPreview.rows.filter(r => r.errors.length === 0).length
                      const warnCount = uploadPreview.rows.filter(r => r.errors.length > 0 && r.errors.every(e => e.includes('Duplicate') || e.includes('already exists'))).length
                      const errorCount = uploadPreview.rows.filter(r => r.errors.some(e => !e.includes('Duplicate') && !e.includes('already exists'))).length
                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 rounded text-[11px]">
                            <span className="font-medium text-gray-700">{totalRows}</span>
                            <span className="text-gray-500">detected</span>
                          </div>
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded text-[11px]">
                            <Check className="h-3 w-3 text-emerald-600" />
                            <span className="font-medium text-emerald-700">{validCount}</span>
                            <span className="text-emerald-600">valid</span>
                          </div>
                          {warnCount > 0 && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded text-[11px]">
                              <AlertCircle className="h-3 w-3 text-amber-600" />
                              <span className="font-medium text-amber-700">{warnCount}</span>
                              <span className="text-amber-600">{warnCount === 1 ? 'warning' : 'warnings'}</span>
                            </div>
                          )}
                          {errorCount > 0 && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50 rounded text-[11px]">
                              <X className="h-3 w-3 text-red-600" />
                              <span className="font-medium text-red-700">{errorCount}</span>
                              <span className="text-red-600">{errorCount === 1 ? 'error' : 'errors'}</span>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>

              {/* Preview Table */}
              {uploadPreview && uploadPreview.rows.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Import Preview</p>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                          <th className="px-3 py-2 text-left">Asset</th>
                          <th className="px-3 py-2 text-left">Analyst</th>
                          <th className="px-3 py-2 text-left">Group</th>
                          <th className="px-3 py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {uploadPreview.rows.map((row, idx) => {
                          const hasErrors = row.errors.length > 0
                          const isWarningOnly = hasErrors && row.errors.every(e => e.includes('Duplicate') || e.includes('already exists'))
                          const isHardError = hasErrors && !isWarningOnly
                          return (
                            <tr key={idx} className={isHardError ? 'bg-red-50/40' : isWarningOnly ? 'bg-amber-50/40' : ''}>
                              <td className="px-3 py-2">
                                {row.asset ? (
                                  <span className="font-medium text-gray-900">{row.asset.symbol}</span>
                                ) : (
                                  <span className="text-red-600">{row.asset_symbol || '—'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {row.user ? (
                                  <span className="text-gray-700">{row.user.name}</span>
                                ) : (
                                  <span className="text-red-600">{row.analyst_email || '—'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {row.isFirm ? (
                                  <span className="text-gray-600">Firm</span>
                                ) : row.orgNode ? (
                                  <span className="text-gray-600">{row.orgNode.name}</span>
                                ) : (
                                  <span className="text-red-600">{row.group || '—'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {isHardError ? (
                                  <span className="inline-flex items-center gap-1 text-red-700" title={row.errors.join(', ')}>
                                    <X className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate max-w-[140px]">{row.errors.find(e => !e.includes('Duplicate') && !e.includes('already exists')) || row.errors[0]}</span>
                                  </span>
                                ) : isWarningOnly ? (
                                  <span className="inline-flex items-center gap-1 text-amber-600" title={row.errors.join(', ')}>
                                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate max-w-[140px]">{row.errors[0]}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-emerald-600">
                                    <Check className="h-3 w-3" />
                                    Valid
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Progress indicator */}
              {isUploading && uploadProgress && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-200 border-t-blue-600 flex-shrink-0" />
                    <p className="text-sm text-blue-800">{uploadProgress}</p>
                  </div>
                  <div className="mt-2 h-1 bg-blue-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                </div>
              )}

              {/* Success message */}
              {uploadSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  <p className="text-sm text-emerald-800">{uploadSuccess}</p>
                </div>
              )}

              {/* Errors */}
              {uploadErrors.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    {uploadErrors.map((err, i) => (
                      <p key={i} className="text-sm text-red-800">{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 flex-shrink-0 bg-gray-50/50">
              <div className="text-[11px] text-gray-400">
                {isUploading
                  ? 'Importing assignments...'
                  : uploadPreview
                    ? `${uploadPreview.rows.filter(r => r.errors.length === 0).length} of ${uploadPreview.rowCount} assignments will be imported`
                    : 'Select a CSV file to begin'}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => {
                  setShowBulkUpload(false)
                  setUploadFile(null)
                  setUploadPreview(null)
                  setUploadErrors([])
                  setUploadSuccess(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}>
                  {uploadSuccess ? 'Done' : 'Cancel'}
                </Button>
                {!uploadSuccess && (() => {
                  const validCount = uploadPreview?.rows.filter(r => r.errors.length === 0).length || 0
                  return (
                    <Button
                      size="sm"
                      onClick={handleUpload}
                      disabled={!uploadPreview || validCount === 0 || isUploading}
                      loading={isUploading}
                    >
                      {isUploading ? (
                        'Importing...'
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5 mr-1.5" />
                          Import {validCount} assignment{validCount !== 1 ? 's' : ''}
                        </>
                      )}
                    </Button>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

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
                  {requestingChange.requestType === 'change' && requestingChange.requestedUserId && requestingChange.currentUserId && requestingChange.requestedUserId === requestingChange.currentUserId && (
                    <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 flex-shrink-0" />
                      This analyst already covers this asset. Select a different analyst.
                    </p>
                  )}
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

                  if (requestingChange.requestType === 'change' && requestingChange.requestedUserId && requestingChange.currentUserId && requestingChange.requestedUserId === requestingChange.currentUserId) {
                    setErrorModal({
                      isOpen: true,
                      title: 'Invalid Request',
                      message: 'The requested analyst is already the current analyst. Please select a different analyst.'
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
                  ((requestingChange.requestType === 'add' || requestingChange.requestType === 'change') && !requestingChange.requestedUserId) ||
                  (requestingChange.requestType === 'change' && !!requestingChange.requestedUserId && !!requestingChange.currentUserId && requestingChange.requestedUserId === requestingChange.currentUserId)
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
                      visibility: coverageSettings?.default_visibility || 'team',
                      organization_id: currentOrgId
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
                <div className="text-sm text-blue-800 w-full">
                  <p className="font-medium mb-2">{existingCoverageConfirm.assetSymbol} is currently covered by:</p>
                  <div className="space-y-1.5">
                    {existingCoverageConfirm.existingCoverage.map((c) => {
                      const scopeLabel = c.visibility === 'firm'
                        ? 'Firm-wide'
                        : c.team_name || 'Unknown group'
                      const roleLabel = c.is_lead
                        ? 'Lead'
                        : c.role
                          ? c.role.charAt(0).toUpperCase() + c.role.slice(1)
                          : null
                      return (
                        <div key={c.id} className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{c.analyst_name}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {roleLabel && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                {roleLabel}
                              </span>
                            )}
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/60 text-blue-600">
                              {scopeLabel}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
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
                      role: existingCoverageConfirm.role || null,
                      notes: existingCoverageConfirm.notes || null,
                      team_id: existingCoverageConfirm.teamId,
                      visibility: existingCoverageConfirm.visibility,
                      is_lead: coverageSettings?.enable_hierarchy ? existingCoverageConfirm.isLead : false,
                      organization_id: currentOrgId
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
                      role: existingCoverageConfirm.role || null,
                      notes: existingCoverageConfirm.notes || null,
                      team_id: existingCoverageConfirm.teamId,
                      visibility: existingCoverageConfirm.visibility,
                      is_lead: coverageSettings?.enable_hierarchy ? existingCoverageConfirm.isLead : false,
                      organization_id: currentOrgId
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