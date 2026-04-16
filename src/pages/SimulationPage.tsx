import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Beaker,
  Users,
  RefreshCw,
  X,
  Edit2,
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Sparkles,
  Layers,
  BarChart3,
  Table2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Briefcase,
  Clock,
  Search,
  TrendingUp,
  TrendingDown,
  FolderOpen,
  AlertCircle,
  MessageSquare,
  CheckCircle2,
  DollarSign,
  List,
  Link2,
  Eye,
  FileText,
  Scale,
  Wrench,
  AlertTriangle,
  User,
  Share2,
  RotateCcw
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { financialDataService } from '../lib/financial-data/browser-client'
import { TabStateManager } from '../lib/tabStateManager'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/common/EmptyState'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { PortfolioImpactView } from '../components/trading/PortfolioImpactView'
import { AddTradeIdeaModal } from '../components/trading/AddTradeIdeaModal'
import { RecommendationEditorModal } from '../components/trading/RecommendationEditorModal'
import { TradeIdeaDetailModal } from '../components/trading/TradeIdeaDetailModal'
import type {
  SimulationWithDetails,
  SimulationTradeWithDetails,
  SimulationMetrics,
  SimulatedHolding,
  BaselineHolding,
  TradeAction,
  TradeQueueItemWithDetails,
  SimulationVisibility,
  SimulationPermission,
  SimulationCollaboratorWithUser,
  PairTrade,
  TradeSizingMode,
  TradeSizing
} from '../types/trading'
import { clsx } from 'clsx'
import { formatDistanceToNow, format } from 'date-fns'
import { useToast } from '../components/common/Toast'
import { useWorkbench } from '../hooks/useTradeLab'
import { submitRecommendation } from '../lib/services/recommendation-service'
import { shareTradeSheetSnapshot } from '../lib/services/simulation-share-service'
import { moveTradeIdea } from '../lib/services/trade-idea-service'
import { executeSimVariants } from '../lib/services/execute-sim-variants-service'
import { parseSizingInput, toSizingSpec, type SizingSpec } from '../lib/trade-lab/sizing-parser'
import { detectDirectionConflict, normalizeSizing } from '../lib/trade-lab/normalize-sizing'
import { buildPairInfoByAsset } from '../lib/trade-lab/pair-info'
import { ConflictBadgeV3 } from '../components/trading/VariantStatusBadges'
import { TradeSheetPanel } from '../components/trading/TradeSheetPanel'
import { TradeSheetReadinessPanel } from '../components/trading/TradeSheetReadinessPanel'
import { UnifiedSizingInput, type CurrentPosition as UnifiedCurrentPosition } from '../components/trading/UnifiedSizingInput'
import { InlineConflictBadge, SummaryBarConflicts, CardConflictRow } from '../components/trading/TradeCardConflictBadge'
import { HoldingsSimulationTable } from '../components/trading/HoldingsSimulationTable'
import { SharedSimulationBanner } from '../components/trading/SharedSimulationBanner'
import { SharedWithMeList } from '../components/trading/SharedWithMeList'
import { useIntentVariants } from '../hooks/useIntentVariants'
import { useSimulationRows } from '../hooks/useSimulationRows'
import { useAcceptedTrades } from '../hooks/useAcceptedTrades'
import { useSharedSimulation } from '../hooks/useSimulationShare'
import { useSimulationSuggestions } from '../hooks/useSimulationSuggestions'
import { SuggestionReviewPanel } from '../components/trading/SuggestionReviewPanel'
import type { SimulationShareAccess, SimulationShareMode, SharedSimulationListItem } from '../hooks/useSimulationShare'
import type { SizingValidationError, AssetPrice, IntentVariant } from '../types/trading'
import { OrgBadge } from '../components/common/OrgBadge'
import { DebateIndicatorBadge } from '../components/trading/DebateIndicatorBadge'

interface SimulationPageProps {
  simulationId?: string
  tabId?: string
  onClose?: () => void
  initialPortfolioId?: string
  shareId?: string
}

// Load persisted state or use defaults
function getInitialState(propSimulationId?: string, tabId?: string) {
  if (tabId) {
    const savedState = TabStateManager.loadTabState(tabId)
    if (savedState) {
      // Remap legacy tab names to new ones
      let impactView = savedState.impactView || 'simulation'
      if (impactView === 'summary' || impactView === 'intent' || impactView === 'holdings') {
        impactView = 'simulation'
      }
      return {
        selectedSimulationId: savedState.selectedSimulationId || propSimulationId || null,
        showIdeasPanel: savedState.showIdeasPanel ?? true,
        impactView,
        savedPortfolioId: savedState.selectedPortfolioId || null,
      }
    }
  }
  return {
    selectedSimulationId: propSimulationId || null,
    showIdeasPanel: true,
    impactView: 'simulation' as const,
    savedPortfolioId: null as string | null,
  }
}

// Simplified sizing mode options - delta is auto-detected from +/- prefix
// v3: weight mode now accepts full sizing syntax: 2.5, +0.5, -0.25, #500, @t0.5, @d+0.5
type SimpleSizingMode = 'weight' | 'shares' | 'vs_benchmark'
const SIZING_MODE_OPTIONS: { value: SimpleSizingMode; label: string; unit: string; placeholder: string; disabled?: boolean }[] = [
  { value: 'weight', label: 'Weight', unit: '%', placeholder: '' },
  { value: 'shares', label: 'Shares', unit: 'sh', placeholder: '' },
  { value: 'vs_benchmark', label: '± Bench', unit: '%', placeholder: '', disabled: true },
]

// =============================================================================
// V3 SIZING PARSER INTEGRATION
// =============================================================================

interface V3ParseResult {
  mode: TradeSizingMode
  numValue: number | null
  sizingSpec: SizingSpec | null
  isValid: boolean
  error?: string
}

/**
 * Parse sizing value using v3 sizing-parser.
 * Supports full v3 syntax:
 * - Weight: 2.5, +0.5, -0.25
 * - Shares: #500, #+100, #-50
 * - Active Target: @t0.5, @t-0.5 (if benchmark)
 * - Active Delta: @d+0.5, @d-0.25 (if benchmark)
 *
 * Falls back to legacy mode-based parsing for backward compatibility.
 */
const parseEditingValueV3 = (
  value: string,
  baseMode: SimpleSizingMode,
  hasBenchmark: boolean = false
): V3ParseResult => {
  // Legacy vs_benchmark mode (not yet implemented in v3)
  if (baseMode === 'vs_benchmark') {
    return { mode: 'delta_benchmark', numValue: null, sizingSpec: null, isValid: false }
  }

  if (!value || value.trim() === '') {
    return {
      mode: baseMode === 'weight' ? 'weight' : 'shares',
      numValue: null,
      sizingSpec: null,
      isValid: false
    }
  }

  const trimmed = value.trim()

  // Use v3 parser for # and @ prefixes, or if in weight mode
  // In shares mode without #, treat as raw share count
  if (trimmed.startsWith('#') || trimmed.startsWith('@') || baseMode === 'weight') {
    // For weight mode, if user types a number without prefix, parse as weight
    // For shares mode with # prefix, parse as shares
    const parseInput = baseMode === 'shares' && !trimmed.startsWith('#') && !trimmed.startsWith('@')
      ? `#${trimmed}`  // Add # prefix for shares mode
      : trimmed

    const parseResult = parseSizingInput(parseInput, { has_benchmark: hasBenchmark })

    if (parseResult.is_valid && parseResult.framework && parseResult.value !== undefined) {
      const sizingSpec = toSizingSpec(trimmed, parseResult)

      // Map framework to TradeSizingMode
      let mode: TradeSizingMode
      switch (parseResult.framework) {
        case 'weight_target':
          mode = 'weight'
          break
        case 'weight_delta':
          mode = 'delta_weight'
          break
        case 'shares_target':
          mode = 'shares'
          break
        case 'shares_delta':
          mode = 'delta_shares'
          break
        case 'active_target':
        case 'active_delta':
          mode = 'delta_benchmark'
          break
        default:
          mode = baseMode === 'weight' ? 'weight' : 'shares'
      }

      return {
        mode,
        numValue: parseResult.value,
        sizingSpec,
        isValid: true
      }
    }

    // Parse failed - return with error
    return {
      mode: baseMode === 'weight' ? 'weight' : 'shares',
      numValue: null,
      sizingSpec: null,
      isValid: false,
      error: parseResult.error
    }
  }

  // Legacy shares mode parsing (numbers without # prefix)
  const numValue = parseFloat(trimmed)
  if (isNaN(numValue)) {
    return {
      mode: 'shares',
      numValue: null,
      sizingSpec: null,
      isValid: false,
      error: 'Invalid number'
    }
  }

  const isDelta = trimmed.startsWith('+') || (trimmed.startsWith('-') && trimmed !== '-')
  return {
    mode: isDelta ? 'delta_shares' : 'shares',
    numValue,
    sizingSpec: null,
    isValid: true
  }
}

// Legacy wrapper for backward compatibility
const parseEditingValue = (value: string, baseMode: SimpleSizingMode): { mode: TradeSizingMode; numValue: number | null } => {
  const result = parseEditingValueV3(value, baseMode, false)
  return { mode: result.mode, numValue: result.numValue }
}

// Get current sizing mode option
const getSizingModeOption = (mode: SimpleSizingMode) =>
  SIZING_MODE_OPTIONS.find(opt => opt.value === mode) || SIZING_MODE_OPTIONS[0]

// Get user initials from user object
const getUserInitials = (user?: { first_name?: string | null; last_name?: string | null; email?: string } | null): string => {
  if (!user) return '?'
  if (user.first_name && user.last_name) {
    return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
  }
  if (user.first_name) return user.first_name[0].toUpperCase()
  if (user.email) return user.email[0].toUpperCase()
  return '?'
}

// Get time pressure info (days until expiry/alert)
const getTimePressure = (idea: { expires_at?: string | null; alert_at?: string | null; revisit_at?: string | null }): { label: string; urgent: boolean } | null => {
  const now = new Date()
  const dates = [
    { date: idea.expires_at, label: 'expires' },
    { date: idea.alert_at, label: 'alert' },
    { date: idea.revisit_at, label: 'revisit' },
  ].filter(d => d.date).map(d => ({ ...d, parsed: new Date(d.date!) }))

  if (dates.length === 0) return null

  // Find the nearest date
  const nearest = dates.reduce((a, b) => a.parsed < b.parsed ? a : b)
  const diffMs = nearest.parsed.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { label: 'overdue', urgent: true }
  if (diffDays === 0) return { label: 'today', urgent: true }
  if (diffDays === 1) return { label: '1d', urgent: true }
  if (diffDays <= 7) return { label: `${diffDays}d`, urgent: diffDays <= 3 }
  return { label: `${diffDays}d`, urgent: false }
}

// Resolve sizing mode to absolute shares/weight values
function resolveSizing(
  sizing: TradeSizing,
  baseline: BaselineHolding | undefined,
  currentHolding: SimulatedHolding | undefined,
  totalPortfolioValue: number,
  currentPrice: number
): { shares: number | null; weight: number | null } {
  const { mode, value } = sizing
  if (value === null || value === undefined) {
    return { shares: null, weight: null }
  }

  switch (mode) {
    case 'weight':
      return { shares: null, weight: value }

    case 'shares':
      return { shares: value, weight: null }

    case 'delta_weight': {
      const currentWeight = currentHolding?.weight ?? baseline?.weight ?? 0
      return { shares: null, weight: currentWeight + value }
    }

    case 'delta_shares': {
      const currentShares = currentHolding?.shares ?? baseline?.shares ?? 0
      return { shares: currentShares + value, weight: null }
    }

    case 'delta_benchmark':
      // Future: when benchmark data exists
      return { shares: null, weight: null }

    default:
      return { shares: null, weight: null }
  }
}

export function SimulationPage({ simulationId: propSimulationId, tabId, onClose, initialPortfolioId, shareId: propShareId }: SimulationPageProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

  // Share context — when viewing a shared simulation
  const [activeShareId, setActiveShareId] = useState<string | null>(propShareId || null)
  const { data: sharedSimData, isLoading: sharedSimLoading } = useSharedSimulation(activeShareId || undefined)
  const isSharedView = !!activeShareId
  const isReadOnly = isSharedView && sharedSimData?.access_level === 'view'
  const canSuggest = isSharedView && sharedSimData?.access_level === 'suggest' && sharedSimData?.share_mode === 'live'
  const canCollaborate = isSharedView && sharedSimData?.access_level === 'collaborate' && sharedSimData?.share_mode === 'live'
  // Suggest mode = read-only table + suggest overlay; Collaborate = full editing
  const tableReadOnly = isReadOnly || canSuggest

  // Suggestion review panel state (owner-side)
  const [suggestionReviewOpen, setSuggestionReviewOpen] = useState(false)

  // Save/restore context when entering/exiting a shared view
  const prevContextRef = useRef<{ portfolioId: string | null; simulationId: string | null } | null>(null)

  // Listen for open-shared-simulation events from Header dropdown
  useEffect(() => {
    const handler = (e: CustomEvent<{ share: SharedSimulationListItem }>) => {
      const share = e.detail.share
      setActiveShareId(share.share_id)
      // For live shares, navigate to the simulation
      if (share.share_mode === 'live') {
        setSelectedSimulationId(share.simulation_id)
      }
    }
    window.addEventListener('open-shared-simulation', handler as EventListener)
    return () => window.removeEventListener('open-shared-simulation', handler as EventListener)
  }, [])

  // Get initial state from persisted storage or props
  const initialState = useRef(getInitialState(propSimulationId, tabId))

  const [selectedSimulationId, setSelectedSimulationId] = useState<string | null>(initialState.current.selectedSimulationId)
  const [showCreatePanel, setShowCreatePanel] = useState(false)
  const [showIdeasPanel, setShowIdeasPanel] = useState(initialState.current.showIdeasPanel)
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const [editingSizingMode, setEditingSizingMode] = useState<SimpleSizingMode>('weight')
  const [editingValue, setEditingValue] = useState<string>('')
  const [impactView, setImpactView] = useState<'simulation' | 'impact' | 'trades'>(
    initialState.current.impactView as any || 'simulation'
  )
  // Baseline view mode: 'proforma' folds pending accepted_trades into the
  // baseline so the Lab shows "where the portfolio is heading"; 'actual'
  // shows the raw holdings from the simulation template. Defaults to
  // 'proforma' — the toggle only appears when there are pending trades to
  // fold (i.e. live_feed portfolios, since paper/manual_eod auto-apply on
  // accept). See Phase 2 in project memory.
  const [baselineMode, setBaselineMode] = useState<'actual' | 'proforma'>('proforma')

  // New: Portfolio-first workflow state — restore from tab state, then prop, then null
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(
    initialPortfolioId || initialState.current.savedPortfolioId || null
  )
  const [selectedViewType, setSelectedViewType] = useState<'private' | 'lists'>('private')
  const [portfolioDropdownOpen, setPortfolioDropdownOpen] = useState(false)
  const [portfolioSearchQuery, setPortfolioSearchQuery] = useState('')
  const portfolioDropdownRef = useRef<HTMLDivElement>(null)
  const portfolioSearchInputRef = useRef<HTMLInputElement>(null)

  // New simulation form state
  const [newSimName, setNewSimName] = useState('')
  const [newSimPortfolioId, setNewSimPortfolioId] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showAddTradeIdeaModal, setShowAddTradeIdeaModal] = useState(false)
  const [showCreateSheetConfirm, setShowCreateSheetConfirm] = useState(false)
  const [snapshotSubView, setSnapshotSubView] = useState<'mine' | 'shared'>('mine')
  const [proposalEditorIdea, setProposalEditorIdea] = useState<TradeQueueItemWithDetails | null>(null)
  const [confirmExecuteIdea, setConfirmExecuteIdea] = useState<TradeQueueItemWithDetails | null>(null)
  const [confirmRecommendIdea, setConfirmRecommendIdea] = useState<TradeQueueItemWithDetails | null>(null)
  const [confirmLoadSnapshot, setConfirmLoadSnapshot] = useState<import('../types/trading').TradeSheet | null>(null)
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false)
  const [shareSnapshotSheet, setShareSnapshotSheet] = useState<import('../types/trading').TradeSheet | null>(null)
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [tradeModalInitialTab, setTradeModalInitialTab] = useState<'details' | 'discussion' | 'decisions' | 'activity'>('details')
  const [holdingsGroupBy, setHoldingsGroupBy] = useState<'none' | 'sector' | 'action' | 'change'>('none')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Auto-create workbench tracking
  const autoCreatingRef = useRef(false)
  const lastAutoCreatePortfolioRef = useRef<string | null>(null)
  const [isAutoCreating, setIsAutoCreating] = useState(false)

  // Phantom row asset search (inline Add Trade in HoldingsSimulationTable)
  const [phantomAssetSearch, setPhantomAssetSearch] = useState('')

  // Track expanded trade idea cards
  const [expandedTradeIds, setExpandedTradeIds] = useState<Set<string>>(new Set())

  // Left pane search and filter
  const [leftPaneSearch, setLeftPaneSearch] = useState('')
  const [leftPaneStageFilter, setLeftPaneStageFilter] = useState<'all' | 'investigate' | 'deep_research' | 'thesis_forming' | 'ready_for_decision'>('all')

  // Track which proposals have been applied to the simulation
  const [appliedProposalIds, setAppliedProposalIds] = useState<Set<string>>(new Set())

  // Track asset_ids that were added via proposals (not via idea checkbox)
  const [proposalAddedAssetIds, setProposalAddedAssetIds] = useState<Set<string>>(new Set())

  // Local optimistic state for instant checkbox feedback (avoids full re-render through React Query)
  // Single override map for instant checkbox feedback.
  // Map<assetId, boolean> — true = user wants added, false = user wants removed.
  // Cleared when server state matches desired state.
  const [checkboxOverrides, setCheckboxOverrides] = useState<Map<string, boolean>>(new Map())
  const checkboxOverridesRef = useRef<Map<string, boolean>>(new Map())

  // Track in-flight imports so handleRemoveAsset knows whether to fire removal
  // directly or let importTradeMutation.onSuccess handle it.
  const importsInFlightRef = useRef<Set<string>>(new Set())

  // Track in-flight convergence removals to prevent the convergence effect from
  // re-firing removals that are already pending.
  const convergenceRemovalsInFlightRef = useRef<Set<string>>(new Set())

  // Pending sizing edits made on temp variants. When the real variant arrives
  // (in importTradeMutation.onSuccess), the pending sizing overrides the trade idea's default.
  const pendingSizingRef = useRef<Map<string, string>>(new Map())

  // Persist state when it changes
  useEffect(() => {
    if (tabId) {
      TabStateManager.saveTabState(tabId, {
        selectedSimulationId,
        showIdeasPanel,
        impactView,
        selectedPortfolioId,
      })
    }
  }, [tabId, selectedSimulationId, showIdeasPanel, impactView, selectedPortfolioId])

  // Listen for navigation events
  useEffect(() => {
    const handleNavigate = (e: CustomEvent<{ simulationId: string }>) => {
      setSelectedSimulationId(e.detail.simulationId)
    }
    window.addEventListener('navigate-to-simulation', handleNavigate as EventListener)
    return () => window.removeEventListener('navigate-to-simulation', handleNavigate as EventListener)
  }, [])

  // Set portfolio + simulation context when a live share loads.
  // This makes all downstream hooks (trade lab, variants, prices) work for the recipient.
  useEffect(() => {
    if (isSharedView && sharedSimData?.share_mode === 'live' && sharedSimData.portfolio_id) {
      // Save previous context on first entry so we can restore on exit
      if (!prevContextRef.current) {
        prevContextRef.current = {
          portfolioId: selectedPortfolioId,
          simulationId: selectedSimulationId,
        }
      }
      setSelectedPortfolioId(sharedSimData.portfolio_id)
      setSelectedSimulationId(sharedSimData.simulation_id)
    }
  }, [isSharedView, sharedSimData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Exit handler — restore previous context
  const handleExitSharedView = useCallback(() => {
    if (prevContextRef.current) {
      setSelectedPortfolioId(prevContextRef.current.portfolioId)
      setSelectedSimulationId(prevContextRef.current.simulationId)
      prevContextRef.current = null
    }
    setActiveShareId(null)
  }, [])

  // Fetch portfolios for filter.
  // holdings_source is needed so the Lab can decide whether the pro-forma
  // baseline toggle is meaningful — for paper/manual_eod portfolios Phase 1
  // already auto-applies accepted trades to holdings, so pending trades
  // should be ~empty and the toggle stays hidden.
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, portfolio_id, holdings_source')
        .order('name')

      if (error) throw error
      return data
    },
  })

  // Auto-select first portfolio if none selected (and no initialPortfolioId provided)
  useEffect(() => {
    if (portfolios && portfolios.length > 0 && !selectedPortfolioId && !initialPortfolioId) {
      setSelectedPortfolioId(portfolios[0].id)
    }
  }, [portfolios, selectedPortfolioId, initialPortfolioId])

  // Update selectedPortfolioId when initialPortfolioId changes (e.g., when navigating from Trade Labs section)
  useEffect(() => {
    if (initialPortfolioId && initialPortfolioId !== selectedPortfolioId) {
      setSelectedPortfolioId(initialPortfolioId)
    }
  }, [initialPortfolioId])

  // Filter portfolios by search query
  const filteredPortfolios = useMemo(() => {
    if (!portfolios) return []
    if (!portfolioSearchQuery.trim()) return portfolios
    const query = portfolioSearchQuery.toLowerCase()
    return portfolios.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.portfolio_id?.toLowerCase().includes(query)
    )
  }, [portfolios, portfolioSearchQuery])

  // Close portfolio dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (portfolioDropdownRef.current && !portfolioDropdownRef.current.contains(event.target as Node)) {
        setPortfolioDropdownOpen(false)
        setPortfolioSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (portfolioDropdownOpen && portfolioSearchInputRef.current) {
      portfolioSearchInputRef.current.focus()
    }
  }, [portfolioDropdownOpen])

  // Get or create trade lab for selected portfolio
  const { data: tradeLab, isLoading: tradeLabLoading } = useQuery({
    queryKey: ['trade-lab', selectedPortfolioId],
    queryFn: async () => {
      if (!selectedPortfolioId) return null

      // First try to get existing lab
      const { data: existingLab, error: fetchError } = await supabase
        .from('trade_labs')
        .select('*')
        .eq('portfolio_id', selectedPortfolioId)
        .single()

      if (existingLab) return existingLab

      // Share recipients should never auto-create a trade lab
      if (isSharedView) return null

      // If not found, create one
      if (fetchError?.code === 'PGRST116') {
        const portfolio = portfolios?.find(p => p.id === selectedPortfolioId)
        const { data: newLab, error: createError } = await supabase
          .from('trade_labs')
          .insert({
            portfolio_id: selectedPortfolioId,
            name: `${portfolio?.name || 'Portfolio'} Trade Lab`,
            settings: {},
            created_by: user?.id
          })
          .select()
          .single()

        if (createError) throw createError
        return newLab
      }

      if (fetchError) throw fetchError
      return null
    },
    enabled: !!selectedPortfolioId && !!portfolios,
    staleTime: 60000, // Cache for 1 minute
  })

  // Fetch all simulations
  const { data: simulations, isLoading: simulationsLoading } = useQuery({
    queryKey: ['simulations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('simulations')
        .select(`
          *,
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as SimulationWithDetails[]
    },
    staleTime: 30000, // Cache for 30 seconds
  })

  // Get simulations for the selected portfolio
  const portfolioSimulations = useMemo(() => {
    if (!selectedPortfolioId || !simulations) return []
    return simulations.filter(s => s.portfolio_id === selectedPortfolioId && s.status !== 'archived' && s.status !== 'completed')
  }, [selectedPortfolioId, simulations])

  // Auto-select or auto-create simulation when portfolio changes
  useEffect(() => {
    if (!selectedPortfolioId || !tradeLab || simulationsLoading) return
    if (isSharedView) return // Share recipients use the shared simulation, never auto-create

    // If we already have a simulation selected for this portfolio, keep it
    if (selectedSimulationId) {
      const currentSim = simulations?.find(s => s.id === selectedSimulationId)
      if (currentSim?.portfolio_id === selectedPortfolioId) return
    }

    // Try to select an existing simulation for this portfolio
    if (portfolioSimulations.length > 0) {
      setSelectedSimulationId(portfolioSimulations[0].id)
      return
    }

    // No simulations exist - auto-create a workbench
    // Only auto-create once per portfolio
    if (!autoCreatingRef.current && user?.id && lastAutoCreatePortfolioRef.current !== selectedPortfolioId) {
      autoCreatingRef.current = true
      lastAutoCreatePortfolioRef.current = selectedPortfolioId

      // Create workbench simulation directly
      const createWorkbench = async () => {
        setIsAutoCreating(true)
        try {
          // Get portfolio holdings for baseline
          const { data: holdings } = await supabase
            .from('portfolio_holdings')
            .select(`
              asset_id,
              shares,
              price,
              assets (id, symbol, company_name, sector)
            `)
            .eq('portfolio_id', selectedPortfolioId)

          // Calculate baseline
          const totalValue = (holdings || []).reduce((sum, h) => sum + (h.shares * h.price), 0)
          const baselineHoldings: BaselineHolding[] = (holdings || []).map(h => ({
            asset_id: h.asset_id,
            symbol: (h.assets as any)?.symbol || '',
            company_name: (h.assets as any)?.company_name || '',
            sector: (h.assets as any)?.sector || null,
            shares: h.shares,
            price: h.price,
            value: h.shares * h.price,
            weight: totalValue > 0 ? ((h.shares * h.price) / totalValue) * 100 : 0,
          }))

          const { data, error } = await supabase
            .from('simulations')
            .insert({
              portfolio_id: selectedPortfolioId,
              name: 'Workbench',
              description: 'Auto-created workbench for drafting trades',
              status: 'draft',
              baseline_holdings: baselineHoldings,
              baseline_total_value: totalValue,
              result_metrics: {},
              is_collaborative: false,
              visibility: 'private',
              created_by: user.id,
            })
            .select()
            .single()

          if (error) {
            console.error('Failed to auto-create workbench:', error)
            autoCreatingRef.current = false
            return
          }

          // Select the newly created simulation
          queryClient.invalidateQueries({ queryKey: ['simulations'] })
          setSelectedSimulationId(data.id)
        } catch (err) {
          console.error('Failed to auto-create workbench:', err)
        } finally {
          autoCreatingRef.current = false
          setIsAutoCreating(false)
        }
      }

      createWorkbench()
    }
  }, [selectedPortfolioId, tradeLab, portfolioSimulations, selectedSimulationId, simulations, simulationsLoading, user?.id, queryClient])

  // Fetch selected simulation details
  const { data: simulation, isLoading: simulationLoading } = useQuery({
    queryKey: ['simulation', selectedSimulationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('simulations')
        .select(`
          *,
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          simulation_trades (
            *,
            assets (id, symbol, company_name, sector),
            trade_queue_items (id, rationale, proposed_shares, proposed_weight)
          ),
          simulation_collaborators (
            *,
            users:user_id (id, email, first_name, last_name)
          )
        `)
        .eq('id', selectedSimulationId)
        .single()

      if (error) throw error
      return data as SimulationWithDetails
    },
    enabled: !!selectedSimulationId,
  })

  // Fetch included idea IDs from trade_lab_idea_links for this simulation's portfolio
  const { data: includedIdeaIds } = useQuery({
    queryKey: ['simulation-included-ideas', simulation?.portfolio_id],
    queryFn: async () => {
      if (!simulation?.portfolio_id) return new Set<string>()

      // First get the trade_lab for this portfolio
      const { data: tradeLab, error: labError } = await supabase
        .from('trade_labs')
        .select('id')
        .eq('portfolio_id', simulation.portfolio_id)
        .single()

      if (labError || !tradeLab) return new Set<string>()

      // Then get linked ideas for this trade_lab
      const { data, error } = await supabase
        .from('trade_lab_idea_links')
        .select('trade_queue_item_id')
        .eq('trade_lab_id', tradeLab.id)

      if (error) throw error
      return new Set((data || []).map(d => d.trade_queue_item_id))
    },
    enabled: !!simulation?.portfolio_id,
  })

  // Fetch trade ideas from queue for the selected portfolio
  // Include ideas with direct portfolio_id match OR linked via trade_lab_idea_links
  const { data: tradeIdeas, isLoading: tradeIdeasLoading, isFetching: tradeIdeasFetching, refetch: refetchTradeIdeas } = useQuery({
    queryKey: ['trade-queue-ideas', selectedPortfolioId],
    queryFn: async () => {
      // First, get idea IDs linked to this portfolio via trade_lab_idea_links
      const { data: linkedIds } = await supabase
        .from('trade_lab_idea_links')
        .select('trade_queue_item_id, trade_labs!inner(portfolio_id)')
        .eq('trade_labs.portfolio_id', selectedPortfolioId)

      const linkedIdeaIds = linkedIds?.map(l => l.trade_queue_item_id) || []

      // Fetch ideas that either have direct portfolio_id match or are linked via trade_lab
      // Only show active ideas (not in trash or archive).
      //
      // NOTE: `executed` is intentionally included. Standalone executed
      // ideas get filtered out later by committedTradeItemIds, but pair
      // trades need their committed legs in the tradeIdeas set so the
      // pair group in the Lab can display all legs (including committed
      // ones) as part of the same basket. Without `executed` here, a 4-leg
      // pair with one committed leg would only render 3 legs.
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name),
          pair_trades (id, name, description, rationale, urgency, status),
          users:created_by (id, email, first_name, last_name),
          trade_idea_portfolios (stage, portfolio_id)
        `)
        .eq('visibility_tier', 'active')
        .in('status', ['idea', 'discussing', 'simulating', 'deciding', 'executed'])
        .or(`portfolio_id.eq.${selectedPortfolioId}${linkedIdeaIds.length > 0 ? `,id.in.(${linkedIdeaIds.join(',')})` : ''}`)
        .order('priority', { ascending: false })

      if (error) throw error

      return data as TradeQueueItemWithDetails[]
    },
    enabled: !!selectedPortfolioId,
    staleTime: 30000, // Consider data stale after 30 seconds
    refetchOnWindowFocus: true, // Refetch when user comes back to tab
  })

  // Fetch active proposals for this portfolio (for Proposals section)
  const { data: activeProposals, isLoading: proposalsLoading } = useQuery({
    queryKey: ['trade-lab-proposals', selectedPortfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_proposals')
        .select(`
          id,
          trade_queue_item_id,
          user_id,
          portfolio_id,
          weight,
          shares,
          notes,
          is_active,
          created_at,
          updated_at,
          sizing_context,
          proposal_type,
          users:user_id (id, email, first_name, last_name),
          trade_queue_items:trade_queue_item_id (
            id,
            action,
            rationale,
            status,
            stage,
            pair_id,
            pair_leg_type,
            assets:asset_id (id, symbol, company_name, sector)
          )
        `)
        .eq('is_active', true)
        .eq('portfolio_id', selectedPortfolioId)
        .order('updated_at', { ascending: false })

      if (error) throw error

      // Active proposals fetched
      return data || []
    },
    enabled: !!selectedPortfolioId,
    staleTime: 30000,
  })

  // Check if current user is PM for this portfolio
  const { data: isCurrentUserPM } = useQuery({
    queryKey: ['user-is-pm', user?.id, selectedPortfolioId],
    queryFn: async () => {
      if (!user?.id || !selectedPortfolioId) return false
      const { data } = await supabase
        .from('portfolio_team')
        .select('role')
        .eq('user_id', user.id)
        .eq('portfolio_id', selectedPortfolioId)
        .maybeSingle()
      return data?.role === 'Portfolio Manager'
    },
    enabled: !!user?.id && !!selectedPortfolioId,
    staleTime: 60000,
  })

  // Workbench hook for auto-save
  const {
    isSaving: workbenchSaving,
    lastSavedAt: workbenchLastSaved,
    hasUnsavedChanges: workbenchHasUnsavedChanges,
    queueChange: workbenchQueueChange,
    saveNow: workbenchSaveNow,
    clearDraftsAsync: workbenchClearDrafts,
  } = useWorkbench({
    viewId: simulation?.id, // Using simulation ID as view ID for now
    labId: tradeLab?.id,
  })

  // ==========================================================================
  // TRADE LAB V3: Intent Variants
  // ==========================================================================
  const {
    variants: intentVariants,
    conflictSummary: v3ConflictSummary,
    tradeSheets: v3TradeSheets,
    hasConflicts: v3HasConflicts,
    canCreateTradeSheet: v3CanCreateTradeSheet,
    isLoading: v3Loading,
    isCreatingTradeSheet: v3CreatingSheet,
    createVariant: v3CreateVariant,
    createVariantAsync: v3CreateVariantAsync,
    updateVariant: v3UpdateVariant,
    deleteVariant: v3DeleteVariant,
    deleteVariantsByAsset: v3DeleteVariantsByAsset,
    createTradeSheet: v3CreateTradeSheet,
  } = useIntentVariants({
    labId: tradeLab?.id,
    viewId: null, // Not using trade_lab_views, variants are lab-wide
    portfolioId: selectedPortfolioId,
  })

  // ==========================================================================
  // SUGGESTIONS (suggest access level + owner review)
  // ==========================================================================
  const {
    suggestions,
    pendingCount: pendingSuggestionCount,
    pendingSuggestionsByAsset,
    submitSuggestion,
    acceptSuggestion: handleAcceptSuggestion,
    rejectSuggestion: handleRejectSuggestion,
    isAccepting: isSuggestionAccepting,
  } = useSimulationSuggestions({
    simulationId: selectedSimulationId,
    shareId: activeShareId,
    portfolioId: selectedPortfolioId,
    labId: tradeLab?.id,
    enabled: canSuggest || (!isSharedView && !!selectedSimulationId),
  })

  // Hydrate appliedProposalIds + proposalAddedAssetIds from DB on mount/refresh.
  // Cross-references simulation_trades (by trade_queue_item_id) with activeProposals
  // so proposal checkboxes reflect what's already in the simulation.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) return
    if (!simulation?.simulation_trades?.length || !activeProposals?.length) return
    hydratedRef.current = true

    const tradeItemIds = new Set(
      simulation.simulation_trades.map((t: any) => t.trade_queue_item_id).filter(Boolean)
    )

    const proposalIds = new Set<string>()
    const assetIds = new Set<string>()

    for (const proposal of activeProposals) {
      if (tradeItemIds.has(proposal.trade_queue_item_id)) {
        proposalIds.add(proposal.id)
        const assetId = (proposal.trade_queue_items as any)?.assets?.id
        if (assetId) assetIds.add(assetId)
      }
    }

    if (proposalIds.size > 0) {
      setAppliedProposalIds(proposalIds)
      setProposalAddedAssetIds(assetIds)
    }
  }, [simulation?.simulation_trades, activeProposals])

  // Handler for fixing conflicts via one-click action change
  const handleFixConflict = async (variantId: string, suggestedAction: string) => {
    if (variantId.startsWith('temp-')) return
    const variant = intentVariants.find(v => v.id === variantId)
    if (!variant) return

    // Build a mock price for the update
    const price: AssetPrice = {
      asset_id: variant.asset_id,
      price: priceMap?.[variant.asset_id] || 100,
      timestamp: new Date().toISOString(),
      source: 'realtime',
    }

    await v3UpdateVariant({
      variantId,
      updates: { action: suggestedAction as any },
      currentPosition: variant.current_position,
      price,
      portfolioTotalValue: simulation?.baseline_total_value || 0,
      roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
      activeWeightConfig: getActiveWeightConfig(variant.asset_id),
      hasBenchmark,
    })
  }

  // Wipe every in-progress trade from the current simulation without
  // creating a snapshot first. Used by the "Clear all" button in the
  // sim table's summary bar — gives the PM a one-click escape hatch
  // when they want to start a fresh working set. Confirmation happens
  // at the UI layer (this function executes unconditionally).
  const handleClearAllTrades = useCallback(async () => {
    if (!selectedSimulationId && !tradeLab?.id) return
    try {
      if (selectedSimulationId) {
        await supabase
          .from('simulation_trades')
          .delete()
          .eq('simulation_id', selectedSimulationId)
      }
      if (tradeLab?.id) {
        await supabase
          .from('lab_variants')
          .delete()
          .eq('lab_id', tradeLab.id)
      }
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      queryClient.invalidateQueries({ queryKey: ['intent-variants', tradeLab?.id] })
      toast.success('Cleared all trades from the simulation')
    } catch (err: any) {
      toast.error('Failed to clear trades', err?.message)
    }
  }, [selectedSimulationId, tradeLab?.id, queryClient])

  // Handler for creating snapshot + clearing simulation
  const handleSaveSnapshotAndClear = async (name: string, description?: string) => {
    const sheet = await v3CreateTradeSheet({ name, description })
    // Auto-finalize so snapshot appears as saved (not draft)
    if (sheet?.id) {
      await supabase.from('trade_sheets').update({ status: 'committed', committed_at: new Date().toISOString(), committed_by: user?.id }).eq('id', sheet.id)
    }

    // Clear all simulation trades
    if (selectedSimulationId) {
      await supabase
        .from('simulation_trades')
        .delete()
        .eq('simulation_id', selectedSimulationId)
    }

    // Clear all variants
    if (tradeLab?.id) {
      await supabase
        .from('lab_variants')
        .delete()
        .eq('lab_id', tradeLab.id)
    }

    // Invalidate caches so UI refreshes
    queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
    queryClient.invalidateQueries({ queryKey: ['intent-variants', tradeLab?.id] })
  }

  // Handler for creating snapshot WITHOUT clearing simulation
  const handleSaveSnapshotAndKeep = async (name: string, description?: string) => {
    const sheet = await v3CreateTradeSheet({ name, description })
    // Auto-finalize so snapshot appears as saved (not draft)
    if (sheet?.id) {
      await supabase.from('trade_sheets').update({ status: 'committed', committed_at: new Date().toISOString(), committed_by: user?.id }).eq('id', sheet.id)
    }
    queryClient.invalidateQueries({ queryKey: ['trade-sheets'] })
  }

  // Handler for loading a snapshot back into Trade Lab.
  // Replaces the current simulation state with the snapshot's variants.
  // Snapshots remain immutable — this only writes to the live lab_variants + simulation_trades.
  const handleLoadSnapshot = async (sheet: import('../types/trading').TradeSheet) => {
    if (!tradeLab?.id || !selectedSimulationId) return
    setIsLoadingSnapshot(true)
    try {
      const variants = (sheet.variants_snapshot || []) as any[]

      // 1. Clear current live state
      await supabase.from('simulation_trades').delete().eq('simulation_id', selectedSimulationId)
      await supabase.from('lab_variants').delete().eq('lab_id', tradeLab.id)

      // 2. Rebuild simulation_trades from snapshot
      if (variants.length > 0) {
        const simTrades = variants.map((v: any, idx: number) => ({
          simulation_id: selectedSimulationId,
          trade_queue_item_id: v.trade_queue_item_id || null,
          asset_id: v.asset_id,
          action: v.action,
          shares: v.computed?.target_shares ?? null,
          weight: v.computed?.target_weight ?? null,
          price: v.computed?.price_used ?? null,
          sort_order: v.sort_order ?? idx,
        }))
        await supabase.from('simulation_trades').upsert(simTrades, { onConflict: 'simulation_id,asset_id' })
      }

      // 3. Rebuild lab_variants from snapshot
      if (variants.length > 0) {
        const labVariants = variants.map((v: any) => ({
          lab_id: tradeLab.id,
          asset_id: v.asset_id,
          action: v.action,
          sizing_input: v.sizing_input || '',
          sizing_spec: v.sizing_spec || null,
          computed: v.computed || null,
          direction_conflict: v.direction_conflict || null,
          below_lot_warning: v.below_lot_warning || false,
          portfolio_id: v.portfolio_id || sheet.portfolio_id,
          current_position: v.current_position || null,
          active_weight_config: v.active_weight_config || null,
          trade_queue_item_id: v.trade_queue_item_id || null,
          proposal_id: v.proposal_id || null,
          notes: v.notes || null,
          sort_order: v.sort_order ?? 0,
          created_by: user?.id || null,
        }))
        await supabase.from('lab_variants').insert(labVariants)
      }

      // 4. Invalidate all relevant caches so UI updates
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      queryClient.invalidateQueries({ queryKey: ['intent-variants', tradeLab.id] })
      queryClient.invalidateQueries({ queryKey: ['trade-sheets'] })

      toast.success(`Loaded snapshot: ${sheet.name}`)
    } catch (err: any) {
      toast.error('Failed to load snapshot', err.message)
    } finally {
      setIsLoadingSnapshot(false)
      setConfirmLoadSnapshot(null)
    }
  }

  // ── PM Action: Execute Trade ──────────────────────────────────────────
  // Commits a single idea's variant to Trade Book (accepted_trades).
  // This is POST-DECISION: creates an accepted_trade, deletes the variant,
  // and advances the idea outcome. Uses the same canonical path as bulk promote.
  const executeTradeM = useMutation({
    mutationFn: async (idea: TradeQueueItemWithDetails) => {
      if (!user?.id || !selectedPortfolioId) throw new Error('Missing user or portfolio')
      const variant = intentVariants.find(v => v.asset_id === idea.asset_id && !v.id.startsWith('temp-'))
      if (!variant) throw new Error('No sized variant — enter sizing in the simulation before executing')
      if (!variant.sizing_input) throw new Error('No sizing entered for this trade')

      // Route through the unified executeSimVariants pipeline. It handles the
      // three variant-source buckets (linked-DR / queue-item-no-DR / ad-hoc),
      // creates the trade_batch, and delegates holdings_source finalization
      // (paper auto-applies, live_feed stays pending) to createAcceptedTrade.
      const result = await executeSimVariants({
        variants: [variant],
        portfolioId: selectedPortfolioId,
        batchName: null,
        context: {
          actorId: user.id,
          actorName: (user as any)?.first_name || user.email || 'PM',
          actorRole: 'pm',
          requestId: `execute-${Date.now()}`,
        },
      })

      if (result.trades.length === 0) {
        const reason = result.failures[0]?.reason || 'Execute failed with no committed trades'
        throw new Error(reason)
      }
      return result
    },
    onSuccess: (_data, idea) => {
      toast.success(`${idea.assets?.symbol || 'Trade'} committed to Trade Book`)
      // Refresh simulation data so the promoted trade disappears from the sim.
      // Invalidate accepted_trades + the pending pro-forma baseline so the
      // sim immediately shows the new trade folded into the baseline.
      queryClient.invalidateQueries({ queryKey: ['simulation'] })
      queryClient.invalidateQueries({ queryKey: ['intent-variants'] })
      queryClient.invalidateQueries({ queryKey: ['accepted-trades'] })
      queryClient.invalidateQueries({ queryKey: ['trade-batches'] })
    },
    onError: (err: any) => {
      toast.error('Execute failed', err.message)
    },
  })

  // ── PM Action: Bulk Execute Trades ────────────────────────────────
  // The Execute Trades confirmation modal calls this with a list of
  // variant IDs + an optional batch name. Routes through the unified
  // executeSimVariants pipeline (same as single-trade executeTradeM)
  // so we get: baseline fold for paper/manual_eod, hard-delete of
  // simulation_trades, deactivation of orphan proposals, and
  // resolution of sibling pending DRs.
  //
  // Safety model: we do NOT optimistically remove variants from the
  // cache. If the execute fails partway, the working set stays
  // visible exactly as it was. Only after a successful commit do we
  // surgically remove the variants that actually made it into the
  // Trade Book (by asset_id match against result.trades).
  //
  // Resolution model: cache is the authoritative source for user
  // intent (sizing_input, action, computed). DB is the authoritative
  // source for real variant IDs that executeSimVariants can insert
  // into accepted_trades.lab_variant_id (FK). We bridge them by
  // matching on (lab_id, asset_id). That handles the case where
  // pro-rata rebalance has inserted temp-* cache placeholders whose
  // underlying v3CreateVariant mutations are still in-flight against
  // the DB.
  const bulkExecuteM = useMutation({
    mutationFn: async (params: {
      variantIds: string[]
      batchName?: string | null
      /** Batch-level rationale — lands on trade_batch.description. */
      batchDescription?: string | null
      /** Per-variant PM rationale typed in the Execute modal. Keys are
       *  variant IDs. Passed through to executeSimVariants which writes
       *  them onto each accepted_trade.acceptance_note. */
      reasons?: Record<string, string>
    }) => {
      if (!user?.id || !selectedPortfolioId || !tradeLab?.id || !simulation) {
        throw new Error('Missing user, portfolio, lab, or simulation')
      }

      // 1. Pull the cache snapshot — it reflects the user's LATEST
      // intent, including optimistic rebalances that haven't persisted.
      const cacheVariants = queryClient.getQueryData<IntentVariant[]>(
        ['intent-variants', tradeLab.id, null],
      ) || []
      const idSet = new Set(params.variantIds)
      const selected = cacheVariants.filter(v => idSet.has(v.id) && !!v.sizing_input)
      if (selected.length === 0) {
        throw new Error('No sized variants found (did you enter sizing before executing?)')
      }

      // 2. Resolve real DB rows by (lab_id, asset_id). Matching on
      // asset_id instead of variant id bridges temp-* → real UUIDs
      // when an optimistic create hasn't yet landed.
      const assetIds = Array.from(new Set(selected.map(v => v.asset_id)))
      const { data: dbRows, error: fetchErr } = await supabase
        .from('lab_variants')
        .select('*, asset:assets(id, symbol, company_name, sector)')
        .eq('lab_id', tradeLab.id)
        .in('asset_id', assetIds)
      if (fetchErr) {
        throw new Error(`Failed to load variants: ${fetchErr.message}`)
      }
      const dbByAsset = new Map<string, any>((dbRows || []).map((r: any) => [r.asset_id, r]))

      // 3. Build the variant list passed to executeSimVariants.
      // For each selected cache variant:
      //   - Find its real DB row by asset_id. If not present, the
      //     underlying create is still in flight — skip + collect.
      //   - Overlay the cache sizing_input / action onto the DB row
      //     so the execute uses the LATEST intent, not whatever the
      //     DB happened to have when an older update was persisted.
      //   - If `computed` is null (common right after an optimistic
      //     cache patch), run normalizeSizing client-side to produce
      //     the ComputedValues shape executeSimVariants expects.
      const baselineHoldings = (simulation.baseline_holdings as BaselineHolding[] | undefined) || []
      const baselineByAsset = new Map(baselineHoldings.map(h => [h.asset_id, h]))
      const variantsToExecute: any[] = []
      const stillSaving: string[] = []

      for (const cacheV of selected) {
        const dbRow = dbByAsset.get(cacheV.asset_id)
        if (!dbRow) {
          stillSaving.push((cacheV as any).asset?.symbol || `asset:${cacheV.asset_id.slice(0, 8)}`)
          continue
        }

        // Use the cache's computed if it already has one; otherwise
        // run the client-side normalizer so executeSimVariants doesn't
        // reject with "No sizing entered".
        let computed = cacheV.computed
        if (!computed) {
          const baseline = baselineByAsset.get(cacheV.asset_id)
          const price = priceMap?.[cacheV.asset_id] || baseline?.price || 100
          const normResult = normalizeSizing({
            action: cacheV.action,
            sizing_input: cacheV.sizing_input!,
            current_position: baseline ? {
              shares: baseline.shares,
              weight: baseline.weight,
              cost_basis: null,
              active_weight: null,
            } : null,
            portfolio_total_value: simulation.baseline_total_value || 0,
            price: {
              asset_id: cacheV.asset_id,
              price,
              timestamp: new Date().toISOString(),
              source: 'realtime',
            },
            rounding_config: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
            active_weight_config: cacheV.active_weight_config,
            has_benchmark: hasBenchmark,
          })
          if (!normResult.is_valid || !normResult.computed) {
            stillSaving.push((cacheV as any).asset?.symbol || `asset:${cacheV.asset_id.slice(0, 8)}`)
            continue
          }
          computed = normResult.computed
        }

        variantsToExecute.push({
          ...dbRow,
          sizing_input: cacheV.sizing_input,
          action: cacheV.action,
          computed,
        })
      }

      if (variantsToExecute.length === 0) {
        throw new Error(
          stillSaving.length > 0
            ? `${stillSaving.length} variant${stillSaving.length !== 1 ? 's' : ''} still saving (${stillSaving.slice(0, 4).join(', ')}${stillSaving.length > 4 ? '…' : ''}). Try again in a moment.`
            : 'No sized variants resolved for execute',
        )
      }

      const result = await executeSimVariants({
        variants: variantsToExecute as any,
        portfolioId: selectedPortfolioId,
        batchName: params.batchName ?? null,
        batchDescription: params.batchDescription ?? null,
        reasonsByVariantId: params.reasons,
        context: {
          actorId: user.id,
          actorName: (user as any)?.first_name || user.email || 'PM',
          actorRole: 'pm',
          requestId: `bulk-execute-${Date.now()}`,
        },
      })
      return { ...result, stillSaving }
    },
    // Intentionally NO onMutate: we want the Sim table to keep showing
    // the trades the user is executing until we actually know which
    // ones committed successfully. If the execute fails mid-flight,
    // the working set stays exactly as it was — nothing to roll back.
    onSuccess: (result) => {
      const committed = result.trades.length
      const failed = result.failures.length
      const stillSaving = result.stillSaving || []

      // Surgically remove ONLY the successfully committed variants
      // from the cache (by asset_id match against the returned
      // accepted_trades). Failed variants stay in place so the PM
      // can retry them without re-entering sizing.
      //
      // CRUCIAL: patch BOTH the `intent-variants` cache AND the
      // nested `simulation.simulation_trades` cache together. The
      // bidirectional sync effect (syncVariants in this file) watches
      // both — if one says "AZO gone" and the other still has an AZO
      // sim_trade, the forward sync will treat it as an unsynced
      // trade and recreate a ghost variant a few ms later. Keeping the
      // two caches aligned prevents that race until the real refetches
      // land.
      if (committed > 0) {
        const committedAssetIds = new Set(result.trades.map(t => t.asset_id))
        if (tradeLab?.id) {
          queryClient.setQueryData<IntentVariant[]>(
            ['intent-variants', tradeLab.id, null],
            (old) => (old || []).filter(v => !committedAssetIds.has(v.asset_id)),
          )
        }
        if (selectedSimulationId) {
          queryClient.setQueryData<any>(
            ['simulation', selectedSimulationId],
            (old: any) => {
              if (!old) return old
              return {
                ...old,
                simulation_trades: Array.isArray(old.simulation_trades)
                  ? old.simulation_trades.filter((t: any) => !committedAssetIds.has(t.asset_id))
                  : old.simulation_trades,
              }
            },
          )
        }
      }

      // Toast with a clickable Trade Book link.
      const openTradeBook = () => {
        window.dispatchEvent(new CustomEvent('navigate-to-asset', {
          detail: {
            id: 'trade-book',
            title: 'Trade Book',
            type: 'trade-book',
            data: { portfolioId: selectedPortfolioId },
          },
        }))
      }
      if (committed > 0 && failed === 0 && stillSaving.length === 0) {
        toast.success(`Committed ${committed} trade${committed !== 1 ? 's' : ''}`, {
          description: 'Added to the Trade Book and folded into the baseline.',
          action: { label: 'Open Trade Book', onClick: openTradeBook },
        })
      } else if (committed > 0) {
        const descParts: string[] = []
        if (failed > 0) descParts.push(`${failed} failed: ${result.failures.map(f => `${f.symbol}: ${f.reason}`).join('; ')}`)
        if (stillSaving.length > 0) descParts.push(`${stillSaving.length} still saving: ${stillSaving.slice(0, 4).join(', ')}${stillSaving.length > 4 ? '…' : ''}`)
        toast.success(`Committed ${committed}${failed > 0 ? `, ${failed} failed` : ''}`, {
          description: descParts.join(' · '),
          action: { label: 'Open Trade Book', onClick: openTradeBook },
        })
      } else {
        toast.error('Execute failed', result.failures.map(f => `${f.symbol}: ${f.reason}`).join('; ') || 'No trades committed')
      }

      // Refresh downstream queries. The variants cache was already
      // patched above — invalidating it triggers a background refetch
      // that reconciles with the server's authoritative state.
      queryClient.invalidateQueries({ queryKey: ['simulation'] })
      queryClient.invalidateQueries({ queryKey: ['intent-variants'] })
      queryClient.invalidateQueries({ queryKey: ['accepted-trades'] })
      queryClient.invalidateQueries({ queryKey: ['trade-batches'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-ideas'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['decision-requests'] })
    },
    onError: (err: any) => {
      // Nothing to roll back — we never removed variants optimistically.
      toast.error('Bulk execute failed', err.message)
    },
  })

  // ── PM Action: Request Recommendation ───────────────────────────────
  // Creates a PM-initiated proposal from current variant sizing and moves
  // the idea to deciding. This is PRE-COMMIT: no accepted_trade is created.
  const requestRecommendationM = useMutation({
    mutationFn: async (idea: TradeQueueItemWithDetails) => {
      if (!user?.id || !selectedPortfolioId) throw new Error('Missing user or portfolio')

      const actionContext = {
        actorId: user.id,
        actorName: user.email || 'Unknown',
        actorEmail: user.email,
        actorRole: 'pm' as const,
        requestId: crypto.randomUUID(),
      }

      const variant = intentVariants.find(v => v.asset_id === idea.asset_id)

      const { proposal } = await submitRecommendation({
        tradeQueueItemId: idea.id,
        portfolioId: selectedPortfolioId,
        labId: tradeLab?.id || null,
        weight: variant?.computed?.target_weight ?? null,
        shares: variant?.computed?.target_shares ?? null,
        sizingMode: variant?.sizing_spec?.framework as any ?? null,
        sizingContext: variant?.sizing_input ? { input_value: variant.sizing_input, source: 'trade_lab' } : { source: 'trade_lab' },
        proposalType: 'pm_initiated',
        requestedAction: idea.action || null,
        assetSymbol: (idea as any).asset?.symbol || idea.assets?.symbol || null,
        assetCompanyName: (idea as any).asset?.company_name || idea.assets?.company_name || null,
        portfolioName: portfolios?.find(p => p.id === selectedPortfolioId)?.name || null,
      }, actionContext)

      // Move to deciding if not already there
      const stage = idea.stage || idea.status
      if (stage !== 'deciding' && stage !== 'approved') {
        await moveTradeIdea({
          tradeId: idea.id,
          target: { stage: 'deciding' as any },
          context: actionContext,
        })
      }

      return proposal
    },
    onSuccess: (proposal, idea) => {
      if (proposal) {
        queryClient.setQueryData<any[]>(
          ['trade-lab-proposals', selectedPortfolioId],
          (old) => {
            const enriched = {
              ...proposal,
              users: user ? { id: user.id, email: user.email, first_name: (user as any).first_name, last_name: (user as any).last_name } : null,
              trade_queue_items: {
                id: idea.id,
                action: idea.action,
                rationale: idea.rationale,
                status: 'deciding',
                stage: 'deciding',
                pair_id: idea.pair_id,
                pair_leg_type: idea.pair_leg_type,
                assets: idea.assets,
              },
            }
            if (!old) return [enriched]
            const idx = old.findIndex((p: any) => p.trade_queue_item_id === proposal.trade_queue_item_id)
            if (idx >= 0) {
              const next = [...old]
              next[idx] = enriched
              return next
            }
            return [...old, enriched]
          }
        )
      }
      queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals', selectedPortfolioId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-ideas', selectedPortfolioId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      toast.success('Recommendation requested')
    },
    onError: (err: any) => {
      toast.error('Request failed', err.message)
    },
  })

  // v3: Guard to prevent concurrent sync runs
  const syncingRef = useRef(false)
  // Reverse sync (orphan detection) only runs on initial load for each simulation.
  // During active editing the user may create variants without trades (via direct
  // click on baseline position). Continuous orphan detection would delete those.
  const initialSyncDoneRef = useRef(false)

  // Reset sync guards when simulation changes
  useEffect(() => {
    syncingRef.current = false
    initialSyncDoneRef.current = false
  }, [selectedSimulationId])

  // Search assets for phantom row (inline Add Trade)
  const { data: phantomAssetResults } = useQuery({
    queryKey: ['assets-search-phantom', phantomAssetSearch],
    queryFn: async () => {
      if (!phantomAssetSearch || phantomAssetSearch.length < 1) return []

      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${phantomAssetSearch}%,company_name.ilike.%${phantomAssetSearch}%`)
        .limit(8)

      if (error) throw error
      return data
    },
    enabled: phantomAssetSearch.length >= 1,
  })

  // Fetch current prices for all assets in the simulation (for live calculations)
  const { data: priceMap, isLoading: pricesLoading, refetch: refetchPrices } = useQuery({
    queryKey: ['simulation-prices', selectedSimulationId],
    queryFn: async () => {
      if (!simulation) return {}

      const prices: Record<string, number> = {}
      const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]

      // Collect all symbols we need prices for
      const symbolsToFetch = new Map<string, string>() // asset_id -> symbol
      baselineHoldings.forEach(h => symbolsToFetch.set(h.asset_id, h.symbol))
      simulation.simulation_trades?.forEach(t => {
        if (t.assets?.symbol) symbolsToFetch.set(t.asset_id, t.assets.symbol)
      })

      // Circuit breaker: if every live-quote provider has been blocked by
      // CSP (dev-mode case) or is down, calling getQuote on every refetch
      // floods the console with ~4 failed requests per symbol and makes
      // the page feel stuck. Once we've seen a full-failure pass, skip the
      // provider chain for the rest of the session and fall straight back
      // to baseline prices. A page reload resets the flag.
      const quotesDisabled = typeof window !== 'undefined'
        && window.sessionStorage?.getItem('tesseract_live_quotes_disabled') === '1'

      let anyQuoteSucceeded = false
      const fetchPromises = Array.from(symbolsToFetch.entries()).map(async ([assetId, symbol]) => {
        if (!quotesDisabled) {
          try {
            const quote = await financialDataService.getQuote(symbol)
            if (quote?.price) {
              anyQuoteSucceeded = true
              return { assetId, price: quote.price }
            }
          } catch {
            // Fallback to baseline price
          }
        }
        const baseline = baselineHoldings.find(h => h.asset_id === assetId)
        return { assetId, price: baseline?.price || 100 }
      })

      const results = await Promise.all(fetchPromises)
      results.forEach(r => {
        prices[r.assetId] = r.price
      })

      // If this pass tried the live providers and not a single quote came
      // back, disable live quotes for the rest of the session.
      if (!quotesDisabled && !anyQuoteSucceeded && symbolsToFetch.size > 0) {
        try {
          window.sessionStorage?.setItem('tesseract_live_quotes_disabled', '1')
          console.info('[SimulationPage] Live price providers unreachable — using baseline prices for the rest of the session. Reload to retry.')
        } catch {
          // sessionStorage unavailable — harmless; next refetch will retry.
        }
      }

      return prices
    },
    enabled: !!simulation,
    staleTime: 60_000, // Cache for 1 minute
    // Don't refetch on a timer. The original 60s interval refetches even
    // when the circuit breaker has disabled live quotes, which doesn't
    // save anything. Users can manually refresh the page for new prices.
    refetchInterval: false,
    retry: false,
  })

  // Fetch benchmark weights for the selected portfolio
  const { data: benchmarkWeightMap } = useQuery({
    queryKey: ['benchmark-weights', selectedPortfolioId],
    queryFn: async () => {
      if (!selectedPortfolioId) return {}
      const { data, error } = await supabase
        .from('portfolio_benchmark_weights')
        .select('asset_id, weight')
        .eq('portfolio_id', selectedPortfolioId)
      if (error) throw error
      const map: Record<string, number> = {}
      data?.forEach(row => { map[row.asset_id] = Number(row.weight) })
      return map
    },
    enabled: !!selectedPortfolioId,
    staleTime: 300000, // Cache for 5 minutes
  })

  const hasBenchmark = useMemo(
    () => !!benchmarkWeightMap && Object.keys(benchmarkWeightMap).length > 0,
    [benchmarkWeightMap],
  )

  const getActiveWeightConfig = useCallback(
    (assetId: string) => {
      const bw = benchmarkWeightMap?.[assetId]
      if (bw == null) return null
      return { source: 'portfolio_benchmark' as const, benchmark_weight: bw }
    },
    [benchmarkWeightMap],
  )

  // Fetch accepted trades for the selected portfolio. Consumed by both the
  // pro-forma baseline useMemo below AND useSimulationRows (further down),
  // so this hook call has to happen BEFORE proformaBaseline.
  const { trades: acceptedTrades, bulkPromoteM } = useAcceptedTrades(selectedPortfolioId || undefined)

  // Pending accepted_trades for the selected portfolio — the ones that have
  // been committed but not yet executed (or executed and not yet reflected in
  // baseline holdings). For paper/manual_eod portfolios Phase 1 auto-completes
  // on accept, so this set should be empty in practice. For live_feed
  // portfolios this is where real pending trades sit waiting for fills.
  const pendingAcceptedTrades = useMemo(() => {
    return (acceptedTrades || []).filter(
      t => t.execution_status !== 'complete' && t.execution_status !== 'cancelled',
    )
  }, [acceptedTrades])

  // Pro-forma fold: take the raw baseline holdings and apply each pending
  // accepted_trade as if it had settled — adjusting shares, inserting new
  // positions, and removing full exits. Weights are recomputed against the
  // pro-forma total so the table stays internally consistent.
  //
  // Returns both the folded holdings array and the pro-forma total value so
  // downstream effectiveTotalValue can stay in sync when in pro-forma mode.
  const proformaBaseline = useMemo(() => {
    const rawBaseline = (simulation?.baseline_holdings as BaselineHolding[]) || []
    if (pendingAcceptedTrades.length === 0) {
      return {
        holdings: rawBaseline,
        totalValue: simulation?.baseline_total_value || 0,
      }
    }

    // Clone baseline entries into a mutable map keyed by asset_id
    const byAsset = new Map<string, BaselineHolding>(
      rawBaseline.map(h => [h.asset_id, { ...h }]),
    )

    for (const trade of pendingAcceptedTrades) {
      const existing = byAsset.get(trade.asset_id)
      let newShares: number | null = null
      if (trade.target_shares != null) {
        newShares = trade.target_shares
      } else if (trade.delta_shares != null) {
        newShares = (existing?.shares ?? 0) + trade.delta_shares
      }
      if (newShares == null) continue

      const price = trade.price_at_acceptance || existing?.price || 0

      if (newShares <= 0) {
        byAsset.delete(trade.asset_id)
        continue
      }

      if (existing) {
        existing.shares = newShares
        existing.price = price || existing.price
        existing.value = newShares * (price || existing.price)
      } else {
        // New position from a pending trade that didn't exist in baseline.
        // Pull display fields from the joined asset on the trade if present.
        const asset = (trade as any).asset || {}
        byAsset.set(trade.asset_id, {
          asset_id: trade.asset_id,
          symbol: asset.symbol || '',
          company_name: asset.company_name || '',
          sector: asset.sector || null,
          shares: newShares,
          price,
          value: newShares * price,
          weight: 0,
        })
      }
    }

    // Recompute weights against the pro-forma total
    const folded = Array.from(byAsset.values())
    const total = folded.reduce((s, h) => s + h.value, 0)
    const withWeights = folded.map(h => ({
      ...h,
      weight: total > 0 ? (h.value / total) * 100 : 0,
    }))

    return { holdings: withWeights, totalValue: total }
  }, [simulation?.baseline_holdings, simulation?.baseline_total_value, pendingAcceptedTrades])

  // Effective data: switch between real data and shared snapshot data.
  // In non-shared views, the 'proforma' baseline mode folds pending trades
  // into baseline; 'actual' shows raw holdings.
  const effectiveBaselineHoldings = useMemo(() => {
    if (isSharedView && sharedSimData?.share_mode === 'snapshot' && sharedSimData.baseline_holdings) {
      return sharedSimData.baseline_holdings as BaselineHolding[]
    }
    if (baselineMode === 'proforma') return proformaBaseline.holdings
    return (simulation?.baseline_holdings as BaselineHolding[]) || []
  }, [isSharedView, sharedSimData, simulation, baselineMode, proformaBaseline])

  const effectiveVariants = useMemo(() => {
    if (isSharedView && sharedSimData?.share_mode === 'snapshot' && sharedSimData.snapshot_variants) {
      return sharedSimData.snapshot_variants as IntentVariant[]
    }
    return intentVariants
  }, [isSharedView, sharedSimData, intentVariants])

  const effectiveTotalValue = useMemo(() => {
    if (isSharedView && sharedSimData?.share_mode === 'snapshot' && sharedSimData.baseline_total_value != null) {
      return sharedSimData.baseline_total_value
    }
    // In pro-forma mode, use the pro-forma total so weights computed against
    // this value stay internally consistent with the folded holdings.
    if (baselineMode === 'proforma') return proformaBaseline.totalValue
    return simulation?.baseline_total_value || 0
  }, [isSharedView, sharedSimData, simulation, baselineMode, proformaBaseline])

  // Realtime: subscribe to variant changes for live shared views
  useEffect(() => {
    if (!isSharedView || sharedSimData?.share_mode !== 'live' || !tradeLab?.id) return

    const channel = supabase
      .channel(`live-share-variants-${tradeLab.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'lab_variants',
        filter: `lab_id=eq.${tradeLab.id}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['intent-variants', tradeLab.id] })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isSharedView, sharedSimData?.share_mode, tradeLab?.id, queryClient])

  // Realtime: subscribe to simulation_trades changes for live shared views
  useEffect(() => {
    if (!isSharedView || sharedSimData?.share_mode !== 'live' || !selectedSimulationId) return

    const channel = supabase
      .channel(`live-share-sim-${selectedSimulationId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'simulation_trades',
        filter: `simulation_id=eq.${selectedSimulationId}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isSharedView, sharedSimData?.share_mode, selectedSimulationId, queryClient])

  // Build asset_id → idea action map for direction conflict detection.
  // The variant's action may be auto-derived from deltas and differ from
  // the originating idea's intended direction (e.g., idea=SELL but variant=ADD).
  // Only includes assets with actual trade ideas — direct edits on baseline
  // positions (no trade_queue_item_id) should not trigger idea-direction conflicts.
  //
  // EXCLUDE executed/terminal ideas. tradeIdeas intentionally keeps
  // `status='executed'` rows around so pair trades can render their
  // committed legs alongside pending ones, but an executed idea has been
  // satisfied — its direction should no longer constrain new variants
  // on the same asset. Otherwise the PM gets a false "conflicts with
  // idea direction" error when they try to reduce a position they just
  // committed a buy for.
  const ideaActionByAsset = useMemo(() => {
    const map: Record<string, import('../types/trading').TradeAction> = {}
    tradeIdeas?.forEach(idea => {
      const status = (idea as any).status as string | undefined
      if (status === 'executed' || status === 'rejected' || status === 'cancelled') return
      if (idea.asset_id && idea.action) map[idea.asset_id] = idea.action as import('../types/trading').TradeAction
    })
    // Include simulation_trades only if they are linked to an actual trade idea
    simulation?.simulation_trades?.forEach((t: any) => {
      if (t.asset_id && t.action && t.trade_queue_item_id && !map[t.asset_id]) {
        map[t.asset_id] = t.action
      }
    })
    return map
  }, [tradeIdeas, simulation?.simulation_trades])

  // Pair info map derived from tradeIdeas. Enables the Lab to render a
  // "↔ pair" badge on rows whose originating trade idea is part of a pair.
  const pairInfoByAsset = useMemo(() => {
    return buildPairInfoByAsset(
      (tradeIdeas || []).map(idea => ({
        asset_id: idea.asset_id || '',
        symbol: idea.assets?.symbol,
        pair_id: (idea as any).pair_id ?? null,
        pair_trade_id: (idea as any).pair_trade_id ?? null,
        pair_leg_type: (idea as any).pair_leg_type ?? null,
        action: idea.action,
      })),
    )
  }, [tradeIdeas])

  // Merge baseline + variants into simulation rows for the table
  const simulationRows = useSimulationRows({
    baselineHoldings: effectiveBaselineHoldings,
    variants: effectiveVariants,
    priceMap: priceMap || {},
    benchmarkWeightMap: benchmarkWeightMap || {},
    acceptedTrades,
    ideaActionByAsset,
  })

  // Build asset_id → symbol map for trade sheet display
  const assetSymbolMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const row of simulationRows.rows) {
      if (row.asset_id && row.symbol) map[row.asset_id] = row.symbol
    }
    return map
  }, [simulationRows.rows])

  // Handler for creating a variant from an untraded holding row.
  // Inserts an optimistic temp variant into cache for instant editor opening.
  const handleCreateVariantForHolding = useCallback((assetId: string, action: TradeAction) => {
    if (!simulation) return
    const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]
    const holding = baselineHoldings.find(h => h.asset_id === assetId)
    const currentPosition = holding ? {
      shares: holding.shares,
      weight: holding.weight,
      cost_basis: null,
      active_weight: null,
    } : null

    // Optimistic: insert temp variant so the editor can open immediately
    if (tradeLab?.id) {
      const variantQueryKey = ['intent-variants', tradeLab.id, null]
      queryClient.setQueryData<IntentVariant[]>(variantQueryKey, (old) => {
        if (old?.some(v => v.asset_id === assetId)) return old
        const tempVariant = {
          id: `temp-${assetId}`,
          asset_id: assetId,
          trade_lab_id: tradeLab.id,
          action,
          sizing_input: null,
          sizing_spec: null,
          computed: null,
          direction_conflict: null,
          below_lot_warning: false,
          active_weight_config: null,
          asset: holding
            ? { id: assetId, symbol: holding.symbol, company_name: holding.company_name, sector: holding.sector }
            : undefined,
        } as IntentVariant
        return [...(old || []), tempVariant]
      })
    }

    v3CreateVariant({
      assetId,
      action,
      sizingInput: '',
      currentPosition,
      price: {
        asset_id: assetId,
        price: priceMap?.[assetId] || holding?.price || 100,
        timestamp: new Date().toISOString(),
        source: 'realtime' as const,
      },
      portfolioTotalValue: simulation.baseline_total_value || 0,
      roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
      activeWeightConfig: getActiveWeightConfig(assetId),
      hasBenchmark,
    })
  }, [simulation, priceMap, tradeLab?.id, queryClient, v3CreateVariant, getActiveWeightConfig, hasBenchmark])

  // Pro-rata cash rebalance. User clicks the CASH_USD sim wt cell and
  // enters a target cash weight (0-100). We then scale every non-cash
  // baseline position proportionally so the residual hits the target.
  //
  // Formula: for each existing holding with current weight w_i (summing
  // to w_total across all positions, where w_total ≈ 100 − current_cash),
  // its new target weight is:
  //
  //     w_i_new = w_i * (100 − targetCash) / w_total
  //
  // This preserves the relative distribution of positions while making
  // room for (or deploying) cash. Each scaled position becomes a variant
  // with framework='weight_target'.
  const handleSetCashTarget = useCallback((targetCashWeightPct: number) => {
    if (!simulation || !tradeLab?.id || !effectiveBaselineHoldings) return
    const holdings = (effectiveBaselineHoldings || []) as BaselineHolding[]
    const nonCash = holdings.filter(h => {
      const s = (h.symbol || '').toUpperCase()
      return s !== 'CASH' && s !== '$CASH' && s !== 'CASH_USD'
    })
    if (nonCash.length === 0) return

    const totalNonCashWeight = nonCash.reduce((s, h) => s + (h.weight || 0), 0)
    if (totalNonCashWeight <= 0) return

    const scale = (100 - targetCashWeightPct) / totalNonCashWeight
    if (!Number.isFinite(scale) || scale < 0) return

    // Target: after rebalance, non-cash positions must sum to exactly
    // (100 - targetCashWeightPct). Naive per-row rounding accumulates
    // residue: 27 rows × ~0.001% drift = ~0.03% off, which is what the
    // user hits when asking for "1% cash" and getting 1.03% instead.
    //
    // Approach: round each row to 4 decimal places (well below display
    // precision), then adjust the LAST row to absorb whatever residue
    // is left over so the sum is exact.
    const targetNonCashTotal = 100 - targetCashWeightPct
    const scaledWeights = nonCash.map(h => Math.round(((h.weight || 0) * scale) * 10000) / 10000)
    const currentSum = scaledWeights.reduce((s, w) => s + w, 0)
    const residue = targetNonCashTotal - currentSum
    if (scaledWeights.length > 0) {
      scaledWeights[scaledWeights.length - 1] = Math.round((scaledWeights[scaledWeights.length - 1] + residue) * 10000) / 10000
    }

    // ── 1. Optimistic cache update (synchronous, single render) ────────
    // Apply every new sizing_input to the intent-variants cache in ONE
    // setQueryData call so useSimulationRows rerenders once with the
    // full rebalance in place. The quickEstimate fallback in the hook
    // computes preview target_weight / target_shares / notional from
    // sizing_input when computed is null, so the table shows the
    // rebalanced state instantly even before any server round-trip.
    //
    // Without this, firing 27 mutations back-to-back means the user
    // watches each row land one by one over 1-2 seconds. With it, the
    // whole sim snaps to the new weights on the next frame.
    const variantQueryKey = ['intent-variants', tradeLab.id, null]
    queryClient.setQueryData<IntentVariant[]>(variantQueryKey, (old) => {
      const base = (old || []).slice()
      const byAsset = new Map(base.map(v => [v.asset_id, v] as const))
      for (let i = 0; i < nonCash.length; i++) {
        const h = nonCash[i]
        const targetWeight = scaledWeights[i]
        const sizingInput = String(targetWeight)
        const initialAction: TradeAction = targetWeight < (h.weight || 0) ? 'trim' : 'add'
        const existing = byAsset.get(h.asset_id)
        if (existing) {
          // Mutate in place via a shallow clone so useMemo deps in the
          // hook pick up the change. Reset computed/direction_conflict
          // so quickEstimate takes over until the server re-computes.
          const updated = {
            ...existing,
            sizing_input: sizingInput,
            computed: null,
            direction_conflict: null,
            below_lot_warning: false,
            action: existing.action || initialAction,
          } as IntentVariant
          const idx = base.findIndex(v => v.id === existing.id)
          if (idx >= 0) base[idx] = updated
        } else {
          // Create a temp variant placeholder. The real create fires
          // below and replaces it once the server responds.
          const tempVariant = {
            id: `temp-${h.asset_id}`,
            asset_id: h.asset_id,
            lab_id: tradeLab.id,
            view_id: null,
            trade_queue_item_id: null,
            proposal_id: null,
            decision_request_id: null,
            action: initialAction,
            sizing_input: sizingInput,
            sizing_spec: null,
            computed: null,
            direction_conflict: null,
            below_lot_warning: false,
            portfolio_id: simulation.portfolio_id,
            current_position: {
              shares: h.shares,
              weight: h.weight,
              cost_basis: null,
              active_weight: null,
            },
            active_weight_config: null,
            notes: null,
            sort_order: base.length + 1,
            touched_in_lab_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            created_by: user?.id ?? null,
            asset: {
              id: h.asset_id,
              symbol: h.symbol,
              company_name: h.company_name,
              sector: h.sector,
            },
          } as unknown as IntentVariant
          base.push(tempVariant)
        }
      }
      return base
    })

    // ── 2. Fire the real mutations in the background ──────────────────
    // The cache is already in the final shape; these just persist it
    // and pull back server-computed values (price_used, target_shares,
    // etc.) which will merge in via updateVariantM.onSuccess.
    for (let i = 0; i < nonCash.length; i++) {
      const h = nonCash[i]
      const targetWeight = scaledWeights[i]
      const sizingInput = String(targetWeight)
      const existing = intentVariants.find(
        v => v.asset_id === h.asset_id && !v.id.startsWith('temp-'),
      )
      const currentPosition = {
        shares: h.shares,
        weight: h.weight,
        cost_basis: null,
        active_weight: null,
      }
      const price = priceMap?.[h.asset_id] || h.price || 100
      const assetPrice = {
        asset_id: h.asset_id,
        price,
        timestamp: new Date().toISOString(),
        source: 'realtime' as const,
      }
      const common = {
        currentPosition,
        price: assetPrice,
        portfolioTotalValue: simulation.baseline_total_value || 0,
        roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' as const },
        activeWeightConfig: getActiveWeightConfig(h.asset_id),
        hasBenchmark,
      }
      if (existing) {
        v3UpdateVariant({
          variantId: existing.id,
          updates: { sizingInput },
          ...common,
        })
      } else {
        const initialAction: TradeAction = targetWeight < (h.weight || 0) ? 'trim' : 'add'
        v3CreateVariant({
          assetId: h.asset_id,
          action: initialAction,
          sizingInput,
          ...common,
        })
      }
    }
  }, [
    simulation,
    tradeLab?.id,
    effectiveBaselineHoldings,
    intentVariants,
    priceMap,
    getActiveWeightConfig,
    hasBenchmark,
    v3CreateVariant,
    v3UpdateVariant,
    queryClient,
    user?.id,
  ])

  // Track assets whose direct-edit was cancelled before the server responded.
  // When the real variant arrives (replacing the temp), delete it immediately.
  const cancelledDirectEditsRef = useRef<Set<string>>(new Set())

  // Follow-up effect: when a real variant replaces a temp variant created by
  // handleCreateVariantForHolding, check for pending sizing or cancellation.
  const prevVariantIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const currentIds = new Set(intentVariants.map(v => v.id))
    const prevIds = prevVariantIdsRef.current
    prevVariantIdsRef.current = currentIds

    if (!simulation) return

    // Find real variants that just appeared (weren't in previous set)
    for (const variant of intentVariants) {
      if (variant.id.startsWith('temp-')) continue
      if (prevIds.has(variant.id)) continue

      const assetId = variant.asset_id

      // If user cancelled the edit before server responded, delete the real variant
      if (cancelledDirectEditsRef.current.has(assetId)) {
        cancelledDirectEditsRef.current.delete(assetId)
        v3DeleteVariant({ variantId: variant.id })
        continue
      }

      // If user typed sizing on the temp variant, fire a follow-up update on the real one
      const pendingSizing = pendingSizingRef.current.get(assetId)
      if (pendingSizing !== undefined) {
        pendingSizingRef.current.delete(assetId)
        const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]
        const holding = baselineHoldings.find(h => h.asset_id === assetId)
        const currentPosition = holding ? {
          shares: holding.shares,
          weight: holding.weight,
          cost_basis: null,
          active_weight: null,
        } : null
        v3UpdateVariant({
          variantId: variant.id,
          updates: { sizingInput: pendingSizing },
          currentPosition,
          price: {
            asset_id: assetId,
            price: priceMap?.[assetId] || holding?.price || 100,
            timestamp: new Date().toISOString(),
            source: 'realtime' as const,
          },
          portfolioTotalValue: simulation.baseline_total_value || 0,
          roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
          activeWeightConfig: getActiveWeightConfig(assetId),
          hasBenchmark,
        })
      }
    }
  }, [intentVariants, simulation, priceMap, v3UpdateVariant, v3DeleteVariant, getActiveWeightConfig, hasBenchmark])

  // v3: Bidirectional sync between simulation_trades and lab_variants on load.
  // Forward: creates variants for trades that don't have one.
  // Reverse: deletes orphaned variants whose asset has no simulation_trade.
  // Optimistic temp trades/variants (id starts with "temp-") are skipped.
  const realTradeIds = useMemo(() => {
    if (!simulation?.simulation_trades?.length) return ''
    return simulation.simulation_trades
      .filter(t => !t.id.startsWith('temp-'))
      .map(t => t.id)
      .sort()
      .join(',')
  }, [simulation?.simulation_trades])

  useEffect(() => {
    const syncVariants = async () => {
      if (
        !tradeLab?.id ||
        !priceMap ||
        v3Loading ||
        syncingRef.current ||
        importsInFlightRef.current.size > 0
      ) {
        return
      }

      const persistedTrades = (simulation?.simulation_trades || []).filter(t => !t.id.startsWith('temp-'))
      const tradeAssetIds = new Set(persistedTrades.map(t => t.asset_id))
      const variantAssetIds = new Set(intentVariants.map(v => v.asset_id))

      // Forward: trades without variants
      const unsyncedTrades = persistedTrades.filter(
        t => !variantAssetIds.has(t.asset_id) && checkboxOverridesRef.current.get(t.asset_id) !== false
      )

      // Reverse: delete orphaned variants (no matching trade). Only run during
      // initial sync — during active editing users may create variants without
      // trades via direct click on baseline positions. Those are cleaned up by
      // cleanupEmptyVariant in HoldingsSimulationTable when the edit is abandoned.
      const orphanedVariants = initialSyncDoneRef.current
        ? []
        : intentVariants.filter(
            v => !v.id.startsWith('temp-') && !tradeAssetIds.has(v.asset_id)
              && checkboxOverridesRef.current.get(v.asset_id) !== true
          )

      if (unsyncedTrades.length === 0 && orphanedVariants.length === 0) {
        initialSyncDoneRef.current = true
        return
      }

      syncingRef.current = true

      // Clean up orphaned variants
      for (const variant of orphanedVariants) {
        try {
          v3DeleteVariant({ variantId: variant.id })
        } catch (err) {
          console.warn('⚠️ Failed to clean up orphaned variant:', err)
        }
      }

      // Create missing variants
      if (unsyncedTrades.length > 0 && simulation) {
        const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]
        for (const trade of unsyncedTrades) {
          try {
            const currentHolding = baselineHoldings.find(h => h.asset_id === trade.asset_id)
            const currentPosition = currentHolding ? {
              shares: currentHolding.shares,
              weight: currentHolding.weight,
              cost_basis: null,
              active_weight: null,
            } : null

            const tradePrice = priceMap[trade.asset_id] || trade.price || 100
            const sizingInput = trade.weight != null
              ? String(trade.weight)
              : trade.shares != null
                ? `#${trade.shares}`
                : ''

            await v3CreateVariantAsync({
              assetId: trade.asset_id,
              action: trade.action as any,
              sizingInput,
              tradeQueueItemId: trade.trade_queue_item_id,
              currentPosition,
              price: {
                asset_id: trade.asset_id,
                price: tradePrice,
                timestamp: new Date().toISOString(),
                source: 'realtime',
              },
              portfolioTotalValue: simulation.baseline_total_value || 0,
              roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
              activeWeightConfig: getActiveWeightConfig(trade.asset_id),
              hasBenchmark,
              uiSource: 'simulation_page',
            })
          } catch (err) {
            console.warn('⚠️ Failed to sync trade to variant:', err)
          }
        }
      }

      initialSyncDoneRef.current = true
      syncingRef.current = false
    }

    syncVariants()
  }, [realTradeIds, tradeLab?.id, priceMap, v3Loading, intentVariants, simulation?.baseline_holdings, simulation?.baseline_total_value, v3CreateVariantAsync, v3DeleteVariant, simulation?.simulation_trades, getActiveWeightConfig, hasBenchmark])

  // Create simulation mutation
  const createSimulationMutation = useMutation({
    mutationFn: async () => {
      if (!newSimPortfolioId) throw new Error('Portfolio required')

      // Get portfolio holdings for baseline
      const { data: holdings, error: holdingsError } = await supabase
        .from('portfolio_holdings')
        .select(`
          asset_id,
          shares,
          price,
          assets (id, symbol, company_name, sector)
        `)
        .eq('portfolio_id', newSimPortfolioId)

      if (holdingsError) throw holdingsError

      // Calculate baseline
      const totalValue = (holdings || []).reduce((sum, h) => sum + (h.shares * h.price), 0)
      const baselineHoldings: BaselineHolding[] = (holdings || []).map(h => ({
        asset_id: h.asset_id,
        symbol: (h.assets as any)?.symbol || '',
        company_name: (h.assets as any)?.company_name || '',
        sector: (h.assets as any)?.sector || null,
        shares: h.shares,
        price: h.price,
        value: h.shares * h.price,
        weight: totalValue > 0 ? ((h.shares * h.price) / totalValue) * 100 : 0,
      }))

      const { data, error } = await supabase
        .from('simulations')
        .insert({
          portfolio_id: newSimPortfolioId,
          name: newSimName || `Simulation ${new Date().toLocaleDateString()}`,
          description: '',
          status: 'draft',
          baseline_holdings: baselineHoldings,
          baseline_total_value: totalValue,
          result_metrics: {},
          is_collaborative: newSimIsCollab,
          visibility: newSimIsCollab ? 'team' : 'private',
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['simulations'] })
      setSelectedSimulationId(data.id)
      setShowCreatePanel(false)
      setNewSimName('')
      setNewSimPortfolioId('')
      setNewSimIsCollab(false)
    },
  })

  // Import trade idea to simulation
  const importTradeMutation = useMutation({
    mutationFn: async (tradeIdea: TradeQueueItemWithDetails) => {
      if (!simulation) throw new Error('No simulation selected')

      const price = priceMap?.[tradeIdea.asset_id] || tradeIdea.target_price || 100

      // Upsert: if the trade already exists (from a rapid toggle race), just return it
      const { data, error } = await supabase
        .from('simulation_trades')
        .upsert({
          simulation_id: simulation.id,
          trade_queue_item_id: tradeIdea.id,
          asset_id: tradeIdea.asset_id,
          action: tradeIdea.action,
          shares: tradeIdea.proposed_shares,
          weight: tradeIdea.proposed_weight,
          price,
          sort_order: (simulation.simulation_trades?.length || 0),
        }, { onConflict: 'simulation_id,asset_id' })
        .select()
        .single()

      if (error) {
        console.error('❌ Import trade error:', error)
        throw error
      }
      return data
    },
    onSuccess: async (data, tradeIdea) => {
      try {
        // Check override AFTER the import completes — this is the definitive moment
        if (checkboxOverridesRef.current.get(tradeIdea.asset_id) === false) {
          // User toggled OFF while import was in-flight — undo immediately
          removeTradeMutation.mutate({ tradeId: data.id, assetId: tradeIdea.asset_id })
          if (tradeLab?.id) {
            queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
            queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null] as any, (old) =>
              old?.filter(v => v.asset_id !== tradeIdea.asset_id) ?? []
            )
          }
          return
        }

        // User still wants this trade — sync lab_variant
        if (tradeLab?.id && simulation) {
          try {
            const price = priceMap?.[tradeIdea.asset_id] || tradeIdea.target_price || 100
            const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]
            const currentHolding = baselineHoldings.find(h => h.asset_id === tradeIdea.asset_id)
            const currentPosition = currentHolding ? {
              shares: currentHolding.shares,
              weight: currentHolding.weight,
              cost_basis: null,
              active_weight: null,
            } : null

            // Use pending sizing from user edit (if they typed into the temp variant),
            // otherwise fall back to the trade idea's proposed sizing.
            const pendingSizing = pendingSizingRef.current.get(tradeIdea.asset_id)
            pendingSizingRef.current.delete(tradeIdea.asset_id)
            const sizingInput = pendingSizing
              ?? (tradeIdea.proposed_weight != null
                ? String(tradeIdea.proposed_weight)
                : tradeIdea.proposed_shares != null
                  ? `#${tradeIdea.proposed_shares}`
                  : '')

            const existingVariant = intentVariants.find(v => v.asset_id === tradeIdea.asset_id && !v.id.startsWith('temp-'))
            const assetPrice = { asset_id: tradeIdea.asset_id, price, timestamp: new Date().toISOString(), source: 'realtime' as const }

            if (existingVariant) {
              v3UpdateVariant({
                variantId: existingVariant.id,
                updates: { action: tradeIdea.action, sizingInput },
                currentPosition,
                price: assetPrice,
                portfolioTotalValue: simulation.baseline_total_value || 0,
                roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
                activeWeightConfig: getActiveWeightConfig(tradeIdea.asset_id),
                hasBenchmark,
              })
            } else {
              // Re-check override right before creating (narrow race window)
              if (checkboxOverridesRef.current.get(tradeIdea.asset_id) === false) return
              const createdVariant = await v3CreateVariantAsync({
                assetId: tradeIdea.asset_id,
                action: tradeIdea.action,
                sizingInput,
                tradeQueueItemId: tradeIdea.id,
                proposalId: (tradeIdea as any)._proposalId ?? null,
                currentPosition,
                price: assetPrice,
                portfolioTotalValue: simulation.baseline_total_value || 0,
                roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
                activeWeightConfig: getActiveWeightConfig(tradeIdea.asset_id),
                hasBenchmark,
                uiSource: 'simulation_page',
              })

              // If user typed sizing while we were creating the variant (editing the
              // temp placeholder), the pending sizing wasn't used above because it
              // didn't exist yet. Pick it up now and fire a follow-up update so the
              // real variant gets the user's intended value.
              const laterPending = pendingSizingRef.current.get(tradeIdea.asset_id)
              if (laterPending !== undefined && createdVariant?.id) {
                pendingSizingRef.current.delete(tradeIdea.asset_id)
                queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
                queryClient.setQueryData<IntentVariant[]>(
                  ['intent-variants', tradeLab.id, null] as any,
                  (old) => old?.map(v =>
                    v.id === createdVariant.id
                      ? { ...v, sizing_input: laterPending, sizing_spec: null, computed: null }
                      : v.id === `temp-${tradeIdea.asset_id}` ? null! : v
                  ).filter(Boolean) ?? []
                )
                v3UpdateVariant({
                  variantId: createdVariant.id,
                  updates: { sizingInput: laterPending },
                  currentPosition,
                  price: assetPrice,
                  portfolioTotalValue: simulation.baseline_total_value || 0,
                  roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
                  activeWeightConfig: getActiveWeightConfig(tradeIdea.asset_id),
                  hasBenchmark,
                })
              }

              // Post-creation guard: if user toggled off during await, clean up immediately
              if (checkboxOverridesRef.current.get(tradeIdea.asset_id) === false) {
                queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
                queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null] as any, (old) =>
                  old?.filter(v => v.asset_id !== tradeIdea.asset_id) ?? []
                )
                const cached = queryClient.getQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null] as any) || []
                const created = cached.find(v => v.asset_id === tradeIdea.asset_id && !v.id.startsWith('temp-'))
                if (created) v3DeleteVariant({ variantId: created.id })
              }
            }
          } catch (variantError) {
            console.warn('⚠️ Failed to sync lab variant (non-blocking):', variantError)
          }
        }
      } finally {
        // Clear in-flight flag AFTER all async variant work completes.
        // This prevents the sync effect from racing with this import flow.
        importsInFlightRef.current.delete(tradeIdea.asset_id)
        // Surgically merge the new trade into the cached simulation instead of
        // refetching immediately. A synchronous invalidate triggers a refetch that
        // causes rows to flicker (the variant cache and simulation data briefly
        // disagree during the refetch window).
        queryClient.setQueryData(
          ['simulation', selectedSimulationId],
          (old: any) => {
            if (!old || !data) return old
            const existingTrades = old.simulation_trades || []
            const alreadyPresent = existingTrades.some((t: any) => t.id === data.id)
            if (alreadyPresent) return old
            return { ...old, simulation_trades: [...existingTrades, { ...data, assets: tradeIdea.assets }] }
          }
        )
        // Background sync: refetch after a longer delay so the full simulation
        // data (with server-computed fields) is eventually consistent.
        // Long delay avoids interference with the user's sizing edits.
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
        }, 8000)
      }
    },
    onError: (_err, tradeIdea) => {
      // Clear in-flight flag on error (onSuccess finally handles the success path)
      importsInFlightRef.current.delete(tradeIdea.asset_id)
      // Only clear override if user still wants the add (hasn't toggled off)
      if (checkboxOverridesRef.current.get(tradeIdea.asset_id) === true) {
        checkboxOverridesRef.current.delete(tradeIdea.asset_id)
        setCheckboxOverrides(new Map(checkboxOverridesRef.current))
      }
      // Remove temp variant from cache
      if (tradeLab?.id) {
        queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null], (old) =>
          old?.filter(v => v.asset_id !== tradeIdea.asset_id) ?? []
        )
      }
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
    },
  })

  // Import entire pair trade (all legs) to simulation
  const importPairTradeMutation = useMutation({
    mutationFn: async (pairTradeLegs: TradeQueueItemWithDetails[]) => {
      if (!simulation) throw new Error('No simulation selected')

      // Import pair trade legs

      // Insert all legs as simulation trades
      const inserts = pairTradeLegs.map((leg, index) => ({
        simulation_id: simulation.id,
        trade_queue_item_id: leg.id,
        asset_id: leg.asset_id,
        action: leg.action,
        shares: leg.proposed_shares,
        weight: leg.proposed_weight,
        price: priceMap?.[leg.asset_id] || leg.target_price || 100,
        sort_order: (simulation.simulation_trades?.length || 0) + index,
      }))

      const { data, error } = await supabase
        .from('simulation_trades')
        .upsert(inserts, { onConflict: 'simulation_id,asset_id' })
        .select()

      if (error) {
        console.error('❌ Import pair trade error:', error)
        throw error
      }
      // Pair trade import success

      // v3: Create lab_variants in background (fire-and-forget to keep checkbox snappy)
      if (tradeLab?.id) {
        const syncVariants = async () => {
          const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]
          for (const leg of pairTradeLegs) {
            try {
              // If user has since toggled this leg off, skip variant creation
              if (checkboxOverridesRef.current.get(leg.asset_id) === false) continue

              const currentHolding = baselineHoldings.find(h => h.asset_id === leg.asset_id)
              const currentPosition = currentHolding ? {
                shares: currentHolding.shares,
                weight: currentHolding.weight,
                cost_basis: null,
                active_weight: null,
              } : null

              const legPrice = priceMap?.[leg.asset_id] || leg.target_price || 100
              const sizingInput = leg.proposed_weight != null
                ? String(leg.proposed_weight)
                : leg.proposed_shares != null
                  ? `#${leg.proposed_shares}`
                  : ''

              const existingVariant = intentVariants.find(v => v.asset_id === leg.asset_id && !v.id.startsWith('temp-'))

              if (existingVariant) {
                v3UpdateVariant({
                  variantId: existingVariant.id,
                  updates: { action: leg.action, sizingInput },
                  currentPosition,
                  price: { asset_id: leg.asset_id, price: legPrice, timestamp: new Date().toISOString(), source: 'realtime' },
                  portfolioTotalValue: simulation.baseline_total_value || 0,
                  roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
                  activeWeightConfig: getActiveWeightConfig(leg.asset_id),
                  hasBenchmark,
                })
              } else {
                await v3CreateVariantAsync({
                  assetId: leg.asset_id,
                  action: leg.action,
                  sizingInput,
                  tradeQueueItemId: leg.id,
                  currentPosition,
                  price: { asset_id: leg.asset_id, price: legPrice, timestamp: new Date().toISOString(), source: 'realtime' },
                  portfolioTotalValue: simulation.baseline_total_value || 0,
                  roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
                  activeWeightConfig: getActiveWeightConfig(leg.asset_id),
                  hasBenchmark,
                  uiSource: 'simulation_page',
                })
              }
            } catch (variantError) {
              console.warn('⚠️ Failed to sync lab variant for leg (non-blocking):', variantError)
            }
          }
        }
        // Don't await — let mutation settle quickly so checkboxes re-enable
        syncVariants()
      }

      return data
    },
    onSuccess: (data, pairTradeLegs) => {
      // Rapid toggle reconciliation for each leg
      if (data) {
        (data as any[]).forEach((trade: any) => {
          if (checkboxOverridesRef.current.get(trade.asset_id) === false) {
            removeTradeMutation.mutate({ tradeId: trade.id, assetId: trade.asset_id })
            // Also clean up variant
            if (tradeLab?.id) {
              const cached = queryClient.getQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null])
              const variant = cached?.find(v => v.asset_id === trade.asset_id)
              if (variant) v3DeleteVariant({ variantId: variant.id })
            }
          }
        })
      }
    },
    onError: (_err, pairTradeLegs) => {
      // Only clear overrides that are still 'true' (user hasn't toggled off)
      let anyCleared = false
      pairTradeLegs.forEach(leg => {
        if (checkboxOverridesRef.current.get(leg.asset_id) === true) {
          checkboxOverridesRef.current.delete(leg.asset_id)
          anyCleared = true
        }
      })
      if (anyCleared) setCheckboxOverrides(new Map(checkboxOverridesRef.current))
      // Remove temp variants from cache
      if (tradeLab?.id) {
        queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null], (old) => {
          const legAssetIds = new Set(pairTradeLegs.map(l => l.asset_id))
          return old?.filter(v => !legAssetIds.has(v.asset_id) || !v.id.startsWith('temp-')) ?? []
        })
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
    },
  })

  // Update trade in simulation (sandbox edit - unlinking from idea/proposal makes it manual)
  const updateTradeMutation = useMutation({
    mutationFn: async ({ tradeId, shares, weight, action, assetId, unlinkFromIdea = true }: { tradeId: string; shares?: number; weight?: number; action?: TradeAction; assetId?: string; unlinkFromIdea?: boolean }) => {
      const updateData: Record<string, any> = {
        shares: shares ?? null,
        weight: weight ?? null,
      }

      // v3: Support action updates for conflict resolution
      if (action !== undefined) {
        updateData.action = action
      }

      // When user manually edits a trade, unlink it from the idea/proposal
      // This moves it to the "Manual Trades" section
      if (unlinkFromIdea) {
        updateData.trade_queue_item_id = null
      }

      const { error } = await supabase
        .from('simulation_trades')
        .update(updateData)
        .eq('id', tradeId)

      if (error) throw error

      // Return assetId for onSuccess to clear from proposal tracking
      return { assetId, unlinkFromIdea }
    },
    onSuccess: (result) => {
      // Clear from proposal tracking if unlinked
      if (result?.unlinkFromIdea && result?.assetId) {
        setProposalAddedAssetIds(prev => {
          const next = new Set(prev)
          next.delete(result.assetId)
          return next
        })
      }
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      setEditingTradeId(null)
    },
  })

  // Remove trade from simulation (variant deletion handled by onClick handlers for instant optimistic removal)
  const removeTradeMutation = useMutation({
    mutationFn: async ({ tradeId }: { tradeId: string; assetId: string }) => {
      const { error } = await supabase
        .from('simulation_trades')
        .delete()
        .eq('id', tradeId)

      if (error) throw error
    },
    onError: (_err, { assetId }) => {
      // Only clear override if user still wants the removal (hasn't toggled back on)
      if (checkboxOverridesRef.current.get(assetId) === false) {
        checkboxOverridesRef.current.delete(assetId)
        setCheckboxOverrides(new Map(checkboxOverridesRef.current))
      }
    },
    onSettled: async (_data, _err, { assetId }) => {
      convergenceRemovalsInFlightRef.current.delete(assetId)
      // Await refetch so reconciliation effect sees fresh data
      await queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      // The reconciliation effect will clear the FALSE override once the trade is gone
    },
  })

  // Stable refs for mutation functions used in the convergence effect
  // (avoids the effect re-triggering when mutation state changes)
  const removeTradeMutateRef = useRef(removeTradeMutation.mutate)
  removeTradeMutateRef.current = removeTradeMutation.mutate
  const v3DeleteVariantRef = useRef(v3DeleteVariant)
  v3DeleteVariantRef.current = v3DeleteVariant
  const v3DeleteVariantsByAssetRef = useRef(v3DeleteVariantsByAsset)
  v3DeleteVariantsByAssetRef.current = v3DeleteVariantsByAsset

  // ==========================================================================
  // CHECKBOX HELPERS — immediate mutations with instant optimistic UI
  // ==========================================================================

  // Convergence effect: clears overrides once server state matches desired state.
  // Also catches stale variants that reappear from refetches after uncheck.
  // Uses stable refs for mutation functions to avoid re-triggering on mutation state changes.
  useEffect(() => {
    const tradeAssetIds = new Set(
      (simulation?.simulation_trades || [])
        .filter((t: any) => !t.id?.startsWith('temp-'))
        .map((t: any) => t.asset_id)
    )
    setCheckboxOverrides(prev => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Map(prev)
      prev.forEach((desired, assetId) => {
        // Don't converge while import is still in-flight — server state is in flux
        if (importsInFlightRef.current.has(assetId)) return
        const exists = tradeAssetIds.has(assetId)
        if ((desired && exists) || (!desired && !exists)) {
          // Server matches desired state — safe to clear override
          next.delete(assetId)
          checkboxOverridesRef.current.delete(assetId)
          convergenceRemovalsInFlightRef.current.delete(assetId)
          changed = true
        }
      })
      return changed ? next : prev
    })

    // Guard: if override is false but variant still exists (from async creation race),
    // remove it from cache and fire DB delete.
    if (tradeLab?.id) {
      checkboxOverridesRef.current.forEach((desired, assetId) => {
        if (desired === false) {
          // Skip if a removal is already in-flight for this asset
          if (convergenceRemovalsInFlightRef.current.has(assetId)) return
          // Skip if an import is in-flight (asset is being added by proposal/idea)
          if (importsInFlightRef.current.has(assetId)) return

          const hasVariant = intentVariants.some(v => v.asset_id === assetId)
          if (hasVariant) {
            queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
            queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null] as any, (old) =>
              old?.filter(v => v.asset_id !== assetId) ?? []
            )
            // Delete ALL variants for this asset (handles duplicates)
            v3DeleteVariantsByAssetRef.current({ assetId })
          }
          // Also ensure trade is removed if it reappeared
          if (tradeAssetIds.has(assetId)) {
            convergenceRemovalsInFlightRef.current.add(assetId)
            const trades = (simulation?.simulation_trades || []).filter(
              (t: any) => t.asset_id === assetId && !t.id?.startsWith('temp-')
            )
            trades.forEach((trade: any) => {
              removeTradeMutateRef.current({ tradeId: trade.id, assetId })
            })
          }
        }
      })
    }
  }, [simulation?.simulation_trades, intentVariants, tradeLab?.id, queryClient])

  /** Remove an asset from simulation */
  const handleRemoveAsset = useCallback((assetId: string) => {
    // Instant UI feedback
    checkboxOverridesRef.current.set(assetId, false)
    setCheckboxOverrides(new Map(checkboxOverridesRef.current))

    // Cancel in-flight variant AND simulation fetches so pending refetches
    // can't overwrite our optimistic removal with stale data
    if (tradeLab?.id) {
      queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
    }
    queryClient.cancelQueries({ queryKey: ['simulation', selectedSimulationId] })

    // Optimistic: remove ALL variants (temp AND real) from cache (table row disappears)
    if (tradeLab?.id) {
      queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null] as any, (old) =>
        old?.filter(v => v.asset_id !== assetId) ?? []
      )
    }

    // Optimistic: remove the simulation_trade from cache so expressedAssetIds
    // is immediately consistent. Prevents the convergence effect from seeing
    // a stale trade and firing redundant removals that cause checkbox flicker.
    queryClient.setQueryData(
      ['simulation', selectedSimulationId],
      (old: any) => {
        if (!old?.simulation_trades) return old
        return {
          ...old,
          simulation_trades: old.simulation_trades.filter(
            (t: any) => t.asset_id !== assetId
          ),
        }
      }
    )

    // If an import is in-flight for this asset, don't fire removal now —
    // importTradeMutation.onSuccess will handle it when the import lands.
    if (importsInFlightRef.current.has(assetId)) return

    // Find trades to remove from current simulation data
    const trades = (simulation?.simulation_trades || []).filter(
      (t: any) => t.asset_id === assetId && !t.id?.startsWith('temp-')
    )
    // Fire removal for each trade found
    trades.forEach((trade: any) => {
      removeTradeMutation.mutate({ tradeId: trade.id, assetId })
    })
    // Delete ALL variants for this asset from DB (handles duplicates from rapid toggling)
    if (tradeLab?.id) {
      v3DeleteVariantsByAsset({ assetId })
    }
  }, [simulation?.simulation_trades, tradeLab?.id, queryClient, removeTradeMutation, v3DeleteVariantsByAsset, selectedSimulationId])

  /** Remove any other checked source for the same asset_id to enforce exclusivity */
  const uncheckOtherSourcesForAsset = useCallback((assetId: string, source: 'idea' | 'proposal') => {
    if (source === 'idea') {
      // If checking an idea, unapply any proposal for the same asset
      const appliedProposal = activeProposals?.find(p => {
        const tradeItem = p.trade_queue_items as any
        return tradeItem?.assets?.id === assetId && appliedProposalIds.has(p.id)
      })
      if (appliedProposal) {
        setAppliedProposalIds(prev => {
          const next = new Set(prev)
          next.delete(appliedProposal.id)
          return next
        })
        setProposalAddedAssetIds(prev => {
          const next = new Set(prev)
          next.delete(assetId)
          return next
        })
        // Remove the simulation trade for this asset
        const trade = simulation?.simulation_trades?.find(t => t.asset_id === assetId)
        if (trade && !trade.id.startsWith('temp-')) {
          supabase.from('simulation_trades').delete().eq('id', trade.id).then(() => {
            queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
          })
        }
      }
    } else {
      // If checking a proposal, remove any idea-sourced trade for the same asset
      const existingTrade = simulation?.simulation_trades?.find(t => t.asset_id === assetId)
      if (existingTrade && !proposalAddedAssetIds.has(assetId)) {
        handleRemoveAsset(assetId)
      }
    }
  }, [activeProposals, appliedProposalIds, proposalAddedAssetIds, simulation?.simulation_trades, selectedSimulationId, queryClient, handleRemoveAsset])

  /** Add an asset to simulation */
  const handleAddAsset = useCallback((idea: TradeQueueItemWithDetails) => {
    const assetId = idea.asset_id

    // Per-asset exclusivity: uncheck any proposal-sourced trade for this asset
    uncheckOtherSourcesForAsset(assetId, 'idea')

    // Instant UI feedback
    checkboxOverridesRef.current.set(assetId, true)
    setCheckboxOverrides(new Map(checkboxOverridesRef.current))

    // Prime priceMap with a price hint for this asset so quickEstimate in
    // useSimulationRows can compute a non-zero notional immediately. Without
    // this the new-position row has price=0 → shares=0 → notional=0, which
    // keeps netTradeNotional=0 and hides the synthetic CASH_USD row until
    // the simulation query refetches (hundreds of ms later). Use the idea's
    // target_price when available, fall back to $100 as a placeholder —
    // real price arrives on the next simulation-prices refetch.
    if (selectedSimulationId && (priceMap?.[assetId] == null)) {
      const priceHint = (idea as any).target_price || 100
      queryClient.setQueryData<Record<string, number>>(
        ['simulation-prices', selectedSimulationId],
        (old) => ({ ...(old || {}), [assetId]: priceHint }),
      )
    }

    // Optimistic: add temp variant to cache for instant table row
    // Include proposed sizing so quickEstimate can compute deltas + cash immediately
    const tempSizing = idea.proposed_weight != null
      ? String(idea.proposed_weight)
      : idea.proposed_shares != null
        ? `#${idea.proposed_shares}`
        : null
    if (tradeLab?.id) {
      const variantQueryKey = ['intent-variants', tradeLab.id, null]
      queryClient.setQueryData<IntentVariant[]>(variantQueryKey, (old) => {
        if (old?.some(v => v.asset_id === assetId)) return old
        const tempVariant = {
          id: `temp-${assetId}`,
          asset_id: assetId,
          trade_lab_id: tradeLab.id,
          action: idea.action || 'buy',
          sizing_input: tempSizing,
          sizing_spec: null,
          computed: null,
          direction_conflict: null,
          below_lot_warning: false,
          active_weight_config: null,
          asset: idea.assets ? { symbol: idea.assets.symbol, company_name: idea.assets.company_name, sector: idea.assets.sector } : undefined,
        } as IntentVariant
        return [...(old || []), tempVariant]
      })
    }

    // Fire import immediately
    importsInFlightRef.current.add(assetId)
    importTradeMutation.mutate(idea)
  }, [tradeLab?.id, queryClient, importTradeMutation, selectedSimulationId, priceMap])

  // Override-aware trade count: filters out trades the user has toggled OFF.
  // This keeps the header count and tab badge in sync with checkbox state instantly.


  // Calculate metrics dynamically based on current trades + variants (LIVE!)
  const liveMetrics = useMemo(() => {
    if (!simulation || !priceMap || Object.keys(priceMap).length === 0) return null

    const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]
    const trades = simulation.simulation_trades || []

    return calculateSimulationMetrics(baselineHoldings, trades, priceMap, intentVariants)
  }, [simulation, priceMap, intentVariants])

  // Add quick trade (sandbox-only, no trade idea created)
  /** Add a manual asset from the phantom row (inline Add Trade in the table) */
  const handleAddManualAsset = useCallback((asset: { id: string; symbol: string; company_name: string; sector: string | null }) => {
    if (!simulation || !tradeLab?.id) return
    const assetId = asset.id

    // Optimistic: add temp variant to cache for instant table row
    const variantQueryKey = ['intent-variants', tradeLab.id, null]
    queryClient.setQueryData<IntentVariant[]>(variantQueryKey, (old) => {
      if (old?.some(v => v.asset_id === assetId)) return old
      const tempVariant = {
        id: `temp-${assetId}`,
        asset_id: assetId,
        trade_lab_id: tradeLab.id,
        action: 'buy' as const,
        sizing_input: null,
        sizing_spec: null,
        computed: null,
        direction_conflict: null,
        below_lot_warning: false,
        active_weight_config: null,
        asset: { id: assetId, symbol: asset.symbol, company_name: asset.company_name, sector: asset.sector },
      } as IntentVariant
      return [...(old || []), tempVariant]
    })

    // Track import
    importsInFlightRef.current.add(assetId)

    // Build a minimal TradeQueueItemWithDetails-shaped object for importTradeMutation.
    // id is null so the FK on trade_queue_item_id doesn't fail (no trade idea source).
    const tradeIdea = {
      id: null,
      asset_id: assetId,
      action: 'buy' as TradeAction,
      proposed_shares: null,
      proposed_weight: null,
      target_price: null,
      assets: { symbol: asset.symbol, company_name: asset.company_name, sector: asset.sector },
    } as unknown as TradeQueueItemWithDetails

    importTradeMutation.mutate(tradeIdea)
  }, [simulation, tradeLab?.id, queryClient, importTradeMutation])

  // Create Trade List mutation - saves, snapshots, and clears workbench
  const createTradeListMutation = useMutation({
    mutationFn: async () => {
      if (!simulation) throw new Error('No simulation selected')
      if (!user) throw new Error('Not authenticated')

      // 1. Save any pending changes first
      await workbenchSaveNow()

      // 2. Capture snapshot
      const snapshot = {
        trades: simulation.simulation_trades,
        metrics: liveMetrics,
        committed_at: new Date().toISOString(),
        committed_by: user.id
      }

      // 3. Update simulation to completed status (creates immutable trade list)
      const { error: simError } = await supabase
        .from('simulations')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result_metrics: snapshot
        })
        .eq('id', simulation.id)

      if (simError) throw simError

      // 4. Update linked trade ideas to committed (executed outcome)
      const linkedIds = simulation.simulation_trades
        ?.filter(t => t.trade_queue_item_id)
        .map(t => t.trade_queue_item_id)
        .filter((id): id is string => id !== null)

      if (linkedIds && linkedIds.length > 0) {
        const now = new Date().toISOString()
        const { error: ideaError } = await supabase
          .from('trade_queue_items')
          .update({
            // New workflow fields
            stage: 'deciding',
            outcome: 'executed',
            outcome_at: now,
            outcome_by: user.id,
            outcome_note: `Trade List: ${simulation.name} - ${format(new Date(), 'MMM d, yyyy HH:mm')}`,
            // Legacy fields for backwards compatibility
            status: 'approved',
            approved_at: now,
            approved_by: user.id,
            executed_at: now
          })
          .in('id', linkedIds)

        if (ideaError) throw ideaError
      }

      // 5. Clear workbench drafts (for fresh start)
      try {
        await workbenchClearDrafts()
      } catch (clearError) {
        // Non-fatal - log but don't fail the operation
        console.warn('Failed to clear workbench drafts:', clearError)
      }

      return { linkedIdeaCount: linkedIds?.length || 0, listName: simulation.name }
    },
    onSuccess: (data) => {
      toast.success('Trade List Created', `Ready for approval`)
      queryClient.invalidateQueries({ queryKey: ['simulations'] })
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
      queryClient.invalidateQueries({ queryKey: ['simulation-included-ideas'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-drafts'] })
      // Navigate back to dashboard
      setSelectedSimulationId(null)
    },
    onError: (error) => {
      toast.error('Failed to Create Trade List', error.message)
    }
  })

  // Use live metrics instead of stored result_metrics
  const metrics = liveMetrics

  // Permission helpers
  const isOwner = simulation?.created_by === user?.id
  const currentUserCollab = simulation?.simulation_collaborators?.find(c => c.user_id === user?.id)
  const currentUserPermission = currentUserCollab?.permission as SimulationPermission | undefined
  const canEdit = isOwner || currentUserPermission === 'edit' || currentUserPermission === 'admin'
  const collaboratorCount = (simulation?.simulation_collaborators?.length || 0)

  // Get all trade ideas with their inclusion/expression status
  // isIncluded = linked via trade_lab_idea_links (part of this lab)
  // isAdded = has a simulation_trade for this asset (checkbox state is decoupled from variants)
  // checkboxOverrides give instant feedback before React Query re-renders
  const tradeIdeasWithStatus = useMemo(() => {
    if (!tradeIdeas) return []
    const expressedAssetIds = new Set(simulation?.simulation_trades?.map(t => t.asset_id) || [])
    return tradeIdeas.map(idea => {
      // Use the more advanced stage between portfolio track and idea itself.
      // Portfolio tracks can be stale (e.g., from a rejection) while the idea has moved forward.
      const portfolioTrack = (idea as any).trade_idea_portfolios?.find(
        (t: any) => t.portfolio_id === selectedPortfolioId
      )
      const stageRankMap: Record<string, number> = {
        idea: 0, aware: 0, discussing: 1, working_on: 1, investigate: 1,
        simulating: 2, modeling: 2, deep_research: 2,
        thesis_forming: 3, deciding: 4, ready_for_decision: 4, approved: 5, executed: 5,
      }
      const ideaStage = idea.stage || idea.status
      const trackStage = portfolioTrack?.stage
      const effectiveStage = trackStage && (stageRankMap[trackStage] ?? 0) > (stageRankMap[ideaStage] ?? 0)
        ? trackStage
        : ideaStage

      // Checkbox override takes precedence for instant feedback
      if (checkboxOverrides.has(idea.asset_id)) {
        return { ...idea, effectiveStage, isIncluded: includedIdeaIds?.has(idea.id) || false, isAdded: checkboxOverrides.get(idea.asset_id)!, isExpressed: expressedAssetIds.has(idea.asset_id) }
      }
      return {
        ...idea,
        effectiveStage,
        isIncluded: includedIdeaIds?.has(idea.id) || false,
        // For standalone ideas, suppress isAdded when a proposal owns this asset.
        // For pair-grouped ideas, isExpressed is the true source of checked state
        // (pair groups use isExpressed to avoid partial-state from proposal dedup).
        isAdded: expressedAssetIds.has(idea.asset_id)
          && !proposalAddedAssetIds.has(idea.asset_id),
        isExpressed: expressedAssetIds.has(idea.asset_id),
      }
    })
  }, [tradeIdeas, simulation?.simulation_trades, includedIdeaIds, proposalAddedAssetIds, checkboxOverrides, selectedPortfolioId])

  // Show all trade ideas for the portfolio (not just included ones)
  // This lets users see all available ideas and add them to the workbench
  const includedIdeasWithStatus = tradeIdeasWithStatus

  // Group pair trades and check their added status (for included ideas only)
  // Supports both legacy pair_trade_id (FK to pair_trades) and newer pair_id (shared UUID)
  const pairTradesGrouped = useMemo(() => {
    if (!includedIdeasWithStatus.length) return { pairTrades: new Map<string, { pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>(), standalone: includedIdeasWithStatus }

    const pairTradesMap = new Map<string, { pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>()
    const standalone: typeof includedIdeasWithStatus = []

    includedIdeasWithStatus.forEach(idea => {
      // Check for legacy pair_trade_id (FK to pair_trades table)
      if (idea.pair_trade_id && idea.pair_trades) {
        if (!pairTradesMap.has(idea.pair_trade_id)) {
          pairTradesMap.set(idea.pair_trade_id, {
            pairTrade: idea.pair_trades as PairTrade,
            legs: [],
            allAdded: true,
            someAdded: false
          })
        }
        const entry = pairTradesMap.get(idea.pair_trade_id)!
        entry.legs.push(idea)
        // Use isExpressed (raw simulation_trades presence) for pair group state,
        // ignoring proposal dedup — a leg is "added" if it's expressed in the sim.
        const legExpressed = (idea as any).isExpressed ?? idea.isAdded
        if (!legExpressed) entry.allAdded = false
        if (legExpressed) entry.someAdded = true
      }
      // Check for newer pair_id (shared UUID grouping)
      else if (idea.pair_id) {
        if (!pairTradesMap.has(idea.pair_id)) {
          // Create a synthetic pair trade object for pair_id grouped trades
          // Name is generated from legs in renderPairTradeCard, so we just need basic metadata
          const syntheticPairTrade: PairTrade = {
            id: idea.pair_id,
            portfolio_id: idea.portfolio_id || '',
            name: '', // Will be generated from legs
            description: '',
            rationale: idea.rationale || '',
            urgency: idea.urgency as any || 'medium',
            status: idea.status as any || 'idea',
            created_by: idea.created_by,
            created_at: idea.created_at,
            updated_at: idea.updated_at || idea.created_at
          }
          pairTradesMap.set(idea.pair_id, {
            pairTrade: syntheticPairTrade,
            legs: [],
            allAdded: true,
            someAdded: false
          })
        }
        const entry = pairTradesMap.get(idea.pair_id)!
        entry.legs.push(idea)
        // Use isExpressed for pair group state (see comment above)
        const legExpressed = (idea as any).isExpressed ?? idea.isAdded
        if (!legExpressed) entry.allAdded = false
        if (legExpressed) entry.someAdded = true
        // Update the synthetic pair trade status based on the legs
        // Use the most advanced stage among the legs
        const stageOrder = ['idea', 'discussing', 'working_on', 'simulating', 'modeling', 'deciding', 'approved']
        const currentStageIdx = stageOrder.indexOf(entry.pairTrade.status)
        const effectiveIdeaStage = idea.effectiveStage || idea.stage || idea.status
        const ideaStageIdx = stageOrder.indexOf(effectiveIdeaStage)
        if (ideaStageIdx > currentStageIdx) {
          entry.pairTrade.status = effectiveIdeaStage as any
        }
      } else {
        standalone.push(idea)
      }
    })

    return { pairTrades: pairTradesMap, standalone }
  }, [includedIdeasWithStatus])

  // Combined type for rendering both single trades and pair trades
  type TradeItem =
    | { type: 'single'; idea: typeof includedIdeasWithStatus[0] }
    | { type: 'pair'; pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }

  // Type for proposals from trade_proposals table
  type ProposalItem = {
    type: 'proposal'
    proposal: NonNullable<typeof activeProposals>[0]
    isPairTrade: boolean
    legs?: Array<{
      legId: string
      symbol: string
      action: string
    }>
  }

  // Group items by: Proposals (has active proposal) vs Ideas (no proposal)
  // Per-trade-idea dedup: same trade_queue_item → Proposals if it has a proposal, else Ideas. Never both.
  const itemsByCategory = useMemo(() => {
    const groups = {
      proposals: [] as ProposalItem[],  // From trade_proposals table
      ideas: [] as TradeItem[],         // Trade queue items WITHOUT proposals
    }

    // Wait for proposals to load before categorizing — otherwise ALL items
    // go into Ideas first, then shuffle to Proposals when the query arrives.
    if (!activeProposals) return groups

    // Build set of trade_queue_item_ids already committed to Trade Book for this portfolio.
    // Ideas with accepted_trades should not appear in Trade Lab — they are resolved.
    const committedTradeItemIds = new Set<string>()
    acceptedTrades?.forEach(at => {
      if (at.trade_queue_item_id) committedTradeItemIds.add(at.trade_queue_item_id)
    })

    // Build set of trade_queue_item_ids that have active proposals for this portfolio
    const proposalTradeItemIds = new Set<string>()
    const seenPairTradeProposals = new Set<string>()

    activeProposals?.forEach(proposal => {
      if (proposal.trade_queue_item_id) {
        proposalTradeItemIds.add(proposal.trade_queue_item_id)
      }

      const sizingContext = proposal.sizing_context as any
      const isPairTrade = sizingContext?.isPairTrade === true

      if (isPairTrade) {
        // Mark ALL leg IDs as having a proposal.
        // Try legId first, then fall back to matching by symbol against trade ideas.
        if (sizingContext?.legs?.length) {
          sizingContext.legs.forEach((leg: any) => {
            if (leg.legId) {
              proposalTradeItemIds.add(leg.legId)
            } else if (leg.symbol) {
              // Match by symbol — find the trade idea for this symbol in any pair group
              const match = tradeIdeas?.find(i =>
                i.assets?.symbol === leg.symbol &&
                (i.pair_id || i.pair_trade_id)
              )
              if (match) proposalTradeItemIds.add(match.id)
            }
          })
        }

        // Resolve the pair group ID: try sizing_context.pairTradeId first,
        // then look up from the linked trade_queue_item's pair_id or pair_trade_id.
        let resolvedPairId = sizingContext?.pairTradeId as string | undefined
        if (!resolvedPairId && proposal.trade_queue_item_id) {
          const linkedIdea = tradeIdeas?.find(i => i.id === proposal.trade_queue_item_id)
          resolvedPairId = linkedIdea?.pair_id || linkedIdea?.pair_trade_id || undefined
        }

        if (resolvedPairId) {
          if (seenPairTradeProposals.has(resolvedPairId)) return
          seenPairTradeProposals.add(resolvedPairId)
        }
      }

      groups.proposals.push({
        type: 'proposal',
        proposal,
        isPairTrade,
        legs: sizingContext?.legs || []
      })
    })

    // Filter out proposals for ideas already fully committed to Trade Book.
    // For SINGLE proposals: drop if the linked idea is committed.
    // For PAIR proposals: drop only if ALL pair legs are committed — a
    // partially-committed pair should still show its recommendation so the
    // PM can act on the remaining uncommitted legs.
    groups.proposals = groups.proposals.filter(p => {
      if (!p.proposal.trade_queue_item_id) return true // ad-hoc proposal, keep
      if (!p.isPairTrade) {
        return !committedTradeItemIds.has(p.proposal.trade_queue_item_id)
      }
      // Pair proposal: resolve pair id and check all legs
      const sizingContext = p.proposal.sizing_context as any
      let resolvedPairId = sizingContext?.pairTradeId as string | undefined
      if (!resolvedPairId) {
        const linkedIdea = tradeIdeas?.find(i => i.id === p.proposal.trade_queue_item_id)
        resolvedPairId = linkedIdea?.pair_id || linkedIdea?.pair_trade_id || undefined
      }
      if (!resolvedPairId) {
        // Can't resolve the pair — fall back to the single-item check
        return !committedTradeItemIds.has(p.proposal.trade_queue_item_id)
      }
      // Find all legs for this pair and check if ALL are committed
      const pairEntry = pairTradesGrouped.pairTrades.get(resolvedPairId)
      if (!pairEntry) return true // no group data yet, keep proposal visible
      return !pairEntry.legs.every(leg => committedTradeItemIds.has(leg.id))
    })

    // Rebuild the "pair covered by proposal" set from the POST-FILTER
    // proposal list. Previously seenPairTradeProposals was computed up-front
    // from every proposal, which meant a pair proposal linked to a leg that
    // then got committed (e.g. CLOV) was filtered out of Proposals but still
    // suppressed the pair from Ideas — the pair vanished from both sections.
    // Only proposals that actually survive the committed filter should
    // suppress their corresponding Ideas entry.
    const renderedPairProposals = new Set<string>()
    groups.proposals.forEach(p => {
      if (!p.isPairTrade) return
      const sizingContext = p.proposal.sizing_context as any
      let resolvedPairId = sizingContext?.pairTradeId as string | undefined
      if (!resolvedPairId && p.proposal.trade_queue_item_id) {
        const linkedIdea = tradeIdeas?.find(i => i.id === p.proposal.trade_queue_item_id)
        resolvedPairId = linkedIdea?.pair_id || linkedIdea?.pair_trade_id || undefined
      }
      if (resolvedPairId) renderedPairProposals.add(resolvedPairId)
    })

    // Similarly, rebuild the per-leg "has proposal" set from surviving
    // proposals only, so a committed leg's proposal doesn't prevent the
    // other legs from showing in Ideas.
    const renderedProposalTradeItemIds = new Set<string>()
    groups.proposals.forEach(p => {
      if (p.proposal.trade_queue_item_id) renderedProposalTradeItemIds.add(p.proposal.trade_queue_item_id)
      if (p.isPairTrade) {
        const sizingContext = p.proposal.sizing_context as any
        if (sizingContext?.legs?.length) {
          sizingContext.legs.forEach((leg: any) => {
            if (leg.legId) {
              renderedProposalTradeItemIds.add(leg.legId)
            } else if (leg.symbol) {
              const match = tradeIdeas?.find(i =>
                i.assets?.symbol === leg.symbol &&
                (i.pair_id || i.pair_trade_id)
              )
              if (match) renderedProposalTradeItemIds.add(match.id)
            }
          })
        }
      }
    })

    // Ideas: only include items WITHOUT a surviving proposal AND not already committed
    pairTradesGrouped.standalone.forEach(idea => {
      if (committedTradeItemIds.has(idea.id)) return // already in Trade Book
      if (!renderedProposalTradeItemIds.has(idea.id)) {
        groups.ideas.push({ type: 'single', idea })
      }
    })

    // Pair trades: exclude if ALL legs committed, or if a surviving proposal
    // covers this pair, or if all uncommitted legs have proposals
    pairTradesGrouped.pairTrades.forEach((entry, pairId) => {
      const allLegsCommitted = entry.legs.every(leg => committedTradeItemIds.has(leg.id))
      if (allLegsCommitted) return
      if (renderedPairProposals.has(pairId)) return // entire pair covered by a surviving proposal
      // At least one uncommitted leg that isn't covered by a surviving proposal → show the pair
      const hasUnproposedUncommittedLeg = entry.legs.some(leg =>
        !committedTradeItemIds.has(leg.id) && !renderedProposalTradeItemIds.has(leg.id)
      )
      if (hasUnproposedUncommittedLeg) {
        groups.ideas.push({ type: 'pair', ...entry })
      }
    })

    return groups
  }, [pairTradesGrouped, activeProposals, tradeIdeas, acceptedTrades])

  // Filter items by search query and stage
  const filteredItems = useMemo(() => {
    const searchLower = leftPaneSearch.toLowerCase().trim()

    const matchesSearch = (item: TradeItem): boolean => {
      if (!searchLower) return true
      if (item.type === 'single') {
        return (item.idea.assets?.symbol?.toLowerCase().includes(searchLower) || false) ||
          (item.idea.assets?.company_name?.toLowerCase().includes(searchLower) || false)
      } else {
        return item.legs.some(leg =>
          (leg.assets?.symbol?.toLowerCase().includes(searchLower) || false) ||
          (leg.assets?.company_name?.toLowerCase().includes(searchLower) || false)
        )
      }
    }

    // Exclude aware/idea stage from Trade Lab — too early in research to simulate
    const isAwareStage = (s: string) => s === 'aware' || s === 'idea'

    const matchesStage = (item: TradeItem): boolean => {
      if (item.type === 'single') {
        const stage = item.idea.effectiveStage || item.idea.stage || item.idea.status
        if (isAwareStage(stage)) return false // never show aware in Trade Lab
        if (leftPaneStageFilter === 'all') return true
        if (leftPaneStageFilter === 'investigate') return stage === 'investigate' || stage === 'working_on' || stage === 'discussing'
        if (leftPaneStageFilter === 'deep_research') return stage === 'deep_research' || stage === 'modeling' || stage === 'simulating'
        if (leftPaneStageFilter === 'thesis_forming') return stage === 'thesis_forming'
        if (leftPaneStageFilter === 'ready_for_decision') return stage === 'ready_for_decision' || stage === 'deciding'
      } else {
        const legStages = item.legs.map(l => (l as any).effectiveStage || l.stage || l.status)
        if (legStages.every(isAwareStage)) return false // all legs are aware — hide
        if (leftPaneStageFilter === 'all') return true
        const stageMatches = (s: string) => {
          if (leftPaneStageFilter === 'investigate') return s === 'investigate' || s === 'working_on' || s === 'discussing'
          if (leftPaneStageFilter === 'deep_research') return s === 'deep_research' || s === 'modeling' || s === 'simulating'
          if (leftPaneStageFilter === 'thesis_forming') return s === 'thesis_forming'
          if (leftPaneStageFilter === 'ready_for_decision') return s === 'ready_for_decision' || s === 'deciding'
          return false
        }
        return legStages.some(stageMatches)
      }
      return true
    }

    // Proposals filtered by search only; ideas by search + stage
    const filteredProposals = searchLower
      ? itemsByCategory.proposals.filter(p => {
          const tradeItem = p.proposal.trade_queue_items as any
          const asset = tradeItem?.assets
          if (asset?.symbol?.toLowerCase().includes(searchLower)) return true
          if (asset?.company_name?.toLowerCase().includes(searchLower)) return true
          if (p.isPairTrade && p.legs?.length) {
            return p.legs.some((l: any) => l.symbol?.toLowerCase().includes(searchLower))
          }
          return false
        })
      : itemsByCategory.proposals

    const stageRank = (item: TradeItem): number => {
      const s = item.type === 'single'
        ? (item.idea.effectiveStage || item.idea.stage || item.idea.status)
        : item.pairTrade.status
      if (s === 'ready_for_decision' || s === 'deciding') return 0
      if (s === 'thesis_forming') return 1
      if (s === 'deep_research' || s === 'modeling' || s === 'simulating') return 2
      if (s === 'investigate' || s === 'working_on' || s === 'discussing') return 3
      return 4
    }

    const filteredIdeas = itemsByCategory.ideas
      .filter(item => matchesSearch(item) && matchesStage(item))
      .sort((a, b) => stageRank(a) - stageRank(b))

    return { proposals: filteredProposals, ideas: filteredIdeas }
  }, [itemsByCategory, leftPaneSearch, leftPaneStageFilter])

  // Count sandbox trade stats
  const tradeStats = useMemo(() => {
    // Use simulationRows.tradedRows for accurate action breakdown
    // (simulation_trades.action may be stale; derivedAction from variants is truth)
    const traded = simulationRows.tradedRows
    const buys = traded.filter(r => r.derivedAction === 'buy' || r.derivedAction === 'add').length
    const sells = traded.filter(r => r.derivedAction === 'sell' || r.derivedAction === 'trim').length
    return { total: traded.length, buys, sells }
  }, [simulationRows.tradedRows])

  // Group trades by action with detailed metrics for Trades view
  const tradesGroupedByAction = useMemo(() => {
    // Use simulationRows.tradedRows which already has computed deltas from
    // lab_variants (v3). simulation_trades.shares/weight are often null in v3
    // since sizing lives on variants, not on the trade link records.
    const traded = simulationRows.tradedRows
    if (!traded || traded.length === 0) return null

    const totalPortfolioValue = simulation?.baseline_total_value || 0

    // Group trades by derived action
    const groups: Record<string, {
      action: TradeAction
      trades: Array<{
        id: string
        symbol: string
        company_name: string
        sector: string | null
        shares: number
        price: number
        value: number
        weight: number
        currentHolding: number
        currentWeight: number
        cashImpact: number
      }>
      totalValue: number
      totalCashImpact: number
      totalWeight: number
      count: number
    }> = {}

    const actionLabels: Record<TradeAction, string> = {
      buy: 'Buys',
      add: 'Adds',
      sell: 'Sells',
      trim: 'Trims'
    }

    traded.forEach(row => {
      const action = row.derivedAction
      const price = priceMap?.[row.asset_id] || row.baseline?.price || 100
      const tradeShares = Math.abs(row.deltaShares)
      const tradeWeight = Math.abs(row.deltaWeight)
      const tradeValue = Math.abs(row.notional)

      // Cash impact: buys/adds are cash outflows (positive), sells/trims are inflows (negative)
      const cashImpact = (action === 'buy' || action === 'add') ? tradeValue : -tradeValue

      const label = actionLabels[action]
      if (!groups[label]) {
        groups[label] = {
          action,
          trades: [],
          totalValue: 0,
          totalCashImpact: 0,
          totalWeight: 0,
          count: 0
        }
      }

      groups[label].trades.push({
        id: row.variant?.id || row.asset_id,
        symbol: row.symbol,
        company_name: row.company_name,
        sector: row.sector,
        shares: tradeShares,
        price,
        value: tradeValue,
        weight: tradeWeight,
        currentHolding: row.currentShares,
        currentWeight: row.currentWeight,
        cashImpact
      })

      groups[label].totalValue += tradeValue
      groups[label].totalCashImpact += cashImpact
      groups[label].totalWeight += tradeWeight
      groups[label].count++
    })

    // Sort trades within each group by value (largest first)
    Object.values(groups).forEach(group => {
      group.trades.sort((a, b) => b.value - a.value)
    })

    // Calculate totals
    const totalCashImpact = Object.values(groups).reduce((sum, g) => sum + g.totalCashImpact, 0)
    const totalBuyValue = (groups['Buys']?.totalValue || 0) + (groups['Adds']?.totalValue || 0)
    const totalSellValue = (groups['Sells']?.totalValue || 0) + (groups['Trims']?.totalValue || 0)

    return {
      groups: Object.values(groups).sort((a, b) => {
        // Sort: Buys, Adds, Trims, Sells
        const order: Record<string, number> = { 'Buys': 1, 'Adds': 2, 'Trims': 3, 'Sells': 4 }
        return (order[actionLabels[a.action]] || 5) - (order[actionLabels[b.action]] || 5)
      }),
      totalCashImpact,
      totalBuyValue,
      totalSellValue,
      netCashFlow: totalSellValue - totalBuyValue,
      totalPortfolioValue
    }
  }, [simulationRows.tradedRows, simulation?.baseline_total_value, priceMap])

  // Group holdings based on selected grouping
  const groupedHoldings = useMemo(() => {
    if (!metrics?.holdings_after) return null
    if (holdingsGroupBy === 'none') return null

    const holdings = metrics.holdings_after
    const baseline = simulation?.baseline_holdings as BaselineHolding[] || []
    const groups: Record<string, typeof holdings> = {}

    holdings.forEach(holding => {
      let groupKey: string

      switch (holdingsGroupBy) {
        case 'sector':
          groupKey = holding.sector || 'Other'
          break
        case 'action': {
          const trade = simulation?.simulation_trades?.find(t => t.asset_id === holding.asset_id)
          if (holding.is_removed) {
            groupKey = 'Sold'
          } else if (holding.is_new) {
            groupKey = 'New Positions'
          } else if (trade) {
            groupKey = trade.action === 'buy' || trade.action === 'add' ? 'Adding' : 'Trimming'
          } else {
            groupKey = 'Unchanged'
          }
          break
        }
        case 'change': {
          const baselineHolding = baseline.find(b => b.asset_id === holding.asset_id)
          const baseWeight = baselineHolding?.weight || 0
          const change = holding.weight - baseWeight
          if (holding.is_removed || change < -1) {
            groupKey = 'Decreasing (>1%)'
          } else if (change < -0.1) {
            groupKey = 'Slightly Decreasing'
          } else if (change > 1) {
            groupKey = 'Increasing (>1%)'
          } else if (change > 0.1) {
            groupKey = 'Slightly Increasing'
          } else {
            groupKey = 'No Change'
          }
          break
        }
        default:
          groupKey = 'All'
      }

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(holding)
    })

    // Sort groups by total weight
    const sortedGroups = Object.entries(groups)
      .map(([name, items]) => ({
        name,
        holdings: items,
        totalWeight: items.reduce((sum, h) => sum + h.weight, 0),
        count: items.length
      }))
      .sort((a, b) => b.totalWeight - a.totalWeight)

    return sortedGroups
  }, [metrics?.holdings_after, holdingsGroupBy, simulation?.baseline_holdings, simulation?.simulation_trades])

  const toggleGroupCollapse = useCallback((groupName: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }, [])

  // Group simulations by portfolio for dashboard view
  // IMPORTANT: Include ALL portfolios, even those without labs
  const simulationsByPortfolio = useMemo(() => {
    if (!portfolios) return { active: [], archived: [], activeCount: 0, archivedCount: 0 }

    const active = simulations?.filter(s => s.status !== 'archived' && s.status !== 'completed') || []
    const archived = simulations?.filter(s => s.status === 'archived' || s.status === 'completed') || []

    // Start with all portfolios (each portfolio should have a Trade Lab workspace)
    const allPortfolios: Record<string, { name: string; simulations: SimulationWithDetails[] }> = {}
    portfolios.forEach(p => {
      allPortfolios[p.id] = { name: p.name, simulations: [] }
    })

    // Group active simulations by portfolio
    active.forEach(sim => {
      const portfolioId = sim.portfolio_id
      if (allPortfolios[portfolioId]) {
        allPortfolios[portfolioId].simulations.push(sim)
      } else {
        // Portfolio might have been deleted, still show it
        allPortfolios[portfolioId] = {
          name: sim.portfolios?.name || 'Unknown Portfolio',
          simulations: [sim]
        }
      }
    })

    // Group archived by portfolio (only portfolios with archived labs)
    const archivedByPortfolio = archived.reduce((acc, sim) => {
      const portfolioId = sim.portfolio_id
      const portfolioName = sim.portfolios?.name || 'Unknown Portfolio'
      if (!acc[portfolioId]) {
        acc[portfolioId] = { name: portfolioName, simulations: [] }
      }
      acc[portfolioId].simulations.push(sim)
      return acc
    }, {} as Record<string, { name: string; simulations: SimulationWithDetails[] }>)

    return {
      active: Object.entries(allPortfolios).sort((a, b) => a[1].name.localeCompare(b[1].name)),
      archived: Object.entries(archivedByPortfolio).sort((a, b) => a[1].name.localeCompare(b[1].name)),
      activeCount: active.length,
      archivedCount: archived.length,
    }
  }, [simulations, portfolios])

  const startEditingTrade = (trade: SimulationTradeWithDetails) => {
    setEditingTradeId(trade.id)
    // Determine initial sizing mode based on trade's current values
    if (trade.weight != null) {
      setEditingSizingMode('weight')
      setEditingValue(trade.weight.toString())
    } else if (trade.shares != null) {
      setEditingSizingMode('shares')
      setEditingValue(trade.shares.toString())
    } else {
      // Default to weight mode with empty value
      setEditingSizingMode('weight')
      setEditingValue('')
    }
  }

  // Queue trade change for auto-save using current sizing mode
  // v3: Skips queueing if there's a direction conflict
  const queueTradeChange = useCallback((baseMode: SimpleSizingMode, value: string) => {
    if (!editingTradeId || !simulation?.simulation_trades) return
    const trade = simulation.simulation_trades.find(t => t.id === editingTradeId)
    if (!trade) return

    // v3: Parse with full sizing syntax support
    const v3Result = parseEditingValueV3(value, baseMode, hasBenchmark)
    const { mode, numValue, sizingSpec } = v3Result

    // Get baseline and current holding for delta calculations
    const baseline = (simulation.baseline_holdings as BaselineHolding[])
      ?.find(b => b.asset_id === trade.asset_id)
    const currentHolding = metrics?.holdings_after
      ?.find(h => h.asset_id === trade.asset_id)

    // v3: Calculate delta for conflict detection
    const currentWeight = currentHolding?.weight ?? baseline?.weight ?? 0
    const currentShares = currentHolding?.shares ?? baseline?.shares ?? 0
    let deltaValue = 0
    if (numValue !== null) {
      if (mode === 'delta_weight' || mode === 'delta_shares') {
        deltaValue = numValue
      } else if (mode === 'weight') {
        deltaValue = numValue - currentWeight
      } else if (mode === 'shares') {
        deltaValue = numValue - currentShares
      }
    }

    // v3: Conflicts are allowed to persist - we only block Trade Sheet creation, not individual saves
    // Direction conflict is computed for display but does NOT block auto-save

    const resolved = resolveSizing(
      { mode, value: numValue },
      baseline,
      currentHolding,
      simulation.baseline_total_value || 0,
      priceMap?.[trade.asset_id] || trade.price || 100
    )

    workbenchQueueChange(trade.id, {
      id: trade.id,
      assetId: trade.asset_id,
      action: trade.action,
      shares: resolved.shares,
      weight: resolved.weight,
      price: trade.price,
      tradeQueueItemId: trade.trade_queue_item_id,
    })
  }, [editingTradeId, simulation?.simulation_trades, simulation?.baseline_holdings, simulation?.baseline_total_value, metrics?.holdings_after, priceMap, workbenchQueueChange])

  // Handler for value changes that triggers auto-save
  const handleEditingValueChange = useCallback((value: string) => {
    setEditingValue(value)
    queueTradeChange(editingSizingMode, value)
  }, [editingSizingMode, queueTradeChange])

  // Handler for sizing mode changes
  const handleSizingModeChange = useCallback((mode: SimpleSizingMode) => {
    setEditingSizingMode(mode)
    // Clear value when switching modes to avoid confusion
    setEditingValue('')
  }, [])

  const saveTradeEdit = () => {
    if (!editingTradeId || !simulation) return

    const trade = simulation.simulation_trades?.find(t => t.id === editingTradeId)
    if (!trade) return

    // v3: Parse with full sizing syntax support
    const v3Result = parseEditingValueV3(editingValue, editingSizingMode, hasBenchmark)
    const { mode, numValue, sizingSpec } = v3Result

    // Get baseline and current holding for delta calculations
    const baseline = (simulation.baseline_holdings as BaselineHolding[])
      ?.find(b => b.asset_id === trade.asset_id)
    const currentHolding = metrics?.holdings_after
      ?.find(h => h.asset_id === trade.asset_id)

    // v3: Calculate delta for conflict detection
    const currentWeight = currentHolding?.weight ?? baseline?.weight ?? 0
    const currentShares = currentHolding?.shares ?? baseline?.shares ?? 0
    let deltaValue = 0
    if (numValue !== null) {
      if (mode === 'delta_weight' || mode === 'delta_shares') {
        deltaValue = numValue
      } else if (mode === 'weight') {
        deltaValue = numValue - currentWeight
      } else if (mode === 'shares') {
        deltaValue = numValue - currentShares
      }
    }

    // v3: Conflicts are allowed to persist - we only block Trade Sheet creation, not individual saves
    // Conflict is computed for display but does NOT block save

    const resolved = resolveSizing(
      { mode, value: numValue },
      baseline,
      currentHolding,
      simulation.baseline_total_value || 0,
      priceMap?.[trade.asset_id] || trade.price || 100
    )

    // Force immediate save of any pending changes
    workbenchSaveNow()
    // Also update via the direct mutation for immediate UI feedback
    // This unlinks the trade from ideas/proposals, making it a "manual" trade
    updateTradeMutation.mutate({
      tradeId: editingTradeId,
      shares: resolved.shares ?? undefined,
      weight: resolved.weight ?? undefined,
      assetId: trade.asset_id,
    })
  }

  // Render a trade idea card (used in grouped sections)
  const renderTradeIdeaCard = (idea: typeof tradeIdeasWithStatus[0]) => {
    const sandboxTrade = idea.isAdded
      ? simulation?.simulation_trades?.find(t => t.asset_id === idea.asset_id)
      : null
    const isEditingThis = sandboxTrade && editingTradeId === sandboxTrade.id

    const isExpanded = expandedTradeIds.has(idea.id)
    const toggleExpand = (e: React.MouseEvent) => {
      e.stopPropagation()
      setExpandedTradeIds(prev => {
        const next = new Set(prev)
        if (next.has(idea.id)) {
          next.delete(idea.id)
        } else {
          next.add(idea.id)
        }
        return next
      })
    }

    const timePressure = getTimePressure(idea)
    const authorInitials = getUserInitials(idea.users)

    // Stage-based left border + subtle background tint
    const stageOfIdea = idea.effectiveStage || idea.stage || idea.status
    const stageBorderClass =
      (stageOfIdea === 'ready_for_decision' || stageOfIdea === 'deciding') ? 'border-l-amber-500 dark:border-l-amber-400' :
      (stageOfIdea === 'thesis_forming') ? 'border-l-purple-500 dark:border-l-purple-400' :
      (stageOfIdea === 'deep_research' || stageOfIdea === 'modeling' || stageOfIdea === 'simulating') ? 'border-l-indigo-500 dark:border-l-indigo-400' :
      (stageOfIdea === 'investigate' || stageOfIdea === 'working_on' || stageOfIdea === 'discussing') ? 'border-l-blue-500 dark:border-l-blue-400' :
      'border-l-gray-400 dark:border-l-gray-500'
    const stageBgClass =
      (stageOfIdea === 'ready_for_decision' || stageOfIdea === 'deciding') ? 'bg-amber-50/40 dark:bg-amber-900/5 hover:bg-amber-50/80 dark:hover:bg-amber-900/15' :
      (stageOfIdea === 'thesis_forming') ? 'bg-purple-50/40 dark:bg-purple-900/5 hover:bg-purple-50/80 dark:hover:bg-purple-900/15' :
      (stageOfIdea === 'deep_research' || stageOfIdea === 'modeling' || stageOfIdea === 'simulating') ? 'bg-indigo-50/40 dark:bg-indigo-900/5 hover:bg-indigo-50/80 dark:hover:bg-indigo-900/15' :
      (stageOfIdea === 'investigate' || stageOfIdea === 'working_on' || stageOfIdea === 'discussing') ? 'bg-blue-50/40 dark:bg-blue-900/5 hover:bg-blue-50/80 dark:hover:bg-blue-900/15' :
      'hover:bg-gray-50 dark:hover:bg-gray-800'

    // Direction conflict for single-name ideas (computed once, used for badge + card border)
    const singleIdeaConflict = idea.isAdded ? (() => {
      const variant = intentVariants.find(v => v.asset_id === idea.asset_id)
      if (!variant?.sizing_input) return false
      const ds = variant?.computed?.delta_shares ?? 0
      if (ds === 0) return false
      const a = idea.action as string
      return ((a === 'buy' || a === 'add') && ds < 0) || ((a === 'sell' || a === 'trim') && ds > 0)
    })() : false

    return (
      <div
        key={idea.id}
        onClick={() => setSelectedTradeId(idea.id)}
        className={clsx(
          "rounded-lg p-2.5 border border-l-[3px] transition-colors cursor-pointer relative",
          stageBorderClass,
          singleIdeaConflict
            ? "border-red-300 dark:border-red-700 border-l-red-500 dark:border-l-red-400 bg-red-50/30 dark:bg-red-900/10"
            : clsx("border-gray-200 dark:border-gray-700", stageBgClass || "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800")
        )}
      >
        {/* Conflict indication is contained within the card body (sizing box).
            No floating external badge — keeps card bounds clean and avoids crowding adjacent tiles. */}
        <div className="flex items-start gap-2">
          {/* Checkbox for added status */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (idea.isAdded) {
                handleRemoveAsset(idea.asset_id)
              } else {
                handleAddAsset(idea)
              }
            }}
            className={clsx(
              "flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mt-0.5",
              idea.isAdded
                ? "bg-green-500 border-green-500 text-white"
                : "border-gray-300 dark:border-gray-600 hover:border-primary-500"
            )}
          >
            {idea.isAdded && <Check className="h-3 w-3" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={clsx(
                "text-xs font-medium uppercase px-1.5 py-0.5 rounded flex-shrink-0",
                idea.action === 'buy' || idea.action === 'add'
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              )}>
                {idea.action}
              </span>
              <span className={clsx(
                "font-semibold text-sm flex-shrink-0",
                idea.isAdded ? "text-green-700 dark:text-green-400" : "text-gray-900 dark:text-white"
              )}>
                {idea.assets?.symbol}
              </span>
              {idea.assets?.company_name && (
                <span
                  className="text-xs text-gray-500 dark:text-gray-400 truncate min-w-0"
                  title={idea.assets.company_name}
                >
                  {idea.assets.company_name}
                </span>
              )}
              <DebateIndicatorBadge
                tradeIdeaId={idea.id}
                onClick={() => setSelectedTradeId(idea.id)}
              />
            </div>

            {/* Proposed size + propose button */}
            {!idea.isAdded && (idea.proposed_weight || idea.proposed_shares) && (
              <div className="mt-1 flex items-center gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {idea.proposed_weight ? `${idea.proposed_weight}%` : ''}
                  {idea.proposed_weight && idea.proposed_shares ? ' · ' : ''}
                  {idea.proposed_shares ? `${idea.proposed_shares} shares` : ''}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setProposalEditorIdea(idea)
                  }}
                  className="text-[10px] text-gray-400 hover:text-primary-600 dark:text-gray-500 dark:hover:text-primary-400 transition-colors"
                  title="Edit your recommendation"
                >
                  <Scale className="h-3 w-3" />
                </button>
              </div>
            )}

          </div>
          {/* Author name + Expand button */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <span
              className="text-[9px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-full px-1.5 py-0.5 flex-shrink-0"
              title={idea.users?.first_name && idea.users?.last_name
                ? `${idea.users.first_name} ${idea.users.last_name}`
                : idea.users?.email || 'Unknown'}
            >
              {idea.users?.first_name && idea.users?.last_name
                ? `${idea.users.first_name} ${idea.users.last_name.charAt(0)}.`
                : idea.users?.first_name || idea.users?.email?.split('@')[0] || '?'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleExpand(e)
              }}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <ChevronDown className={clsx("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
            </button>
          </div>
        </div>


        {/* Expanded content - rationale */}
        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            {idea.rationale ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">{idea.rationale}</p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No rationale provided</p>
            )}
            {/* Stage, timestamp, and actions */}
            <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
              {(() => {
                const stageConfig: Record<string, { label: string; dot: string; text: string }> = {
                  ready_for_decision: { label: 'Deciding', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
                  deciding:           { label: 'Deciding', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
                  thesis_forming:     { label: 'Thesis', dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-400' },
                  deep_research:      { label: 'Research', dot: 'bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-400' },
                  investigate:        { label: 'Investigate', dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-400' },
                  aware:              { label: 'Aware', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-gray-400' },
                  idea:               { label: 'Aware', dot: 'bg-gray-400', text: 'text-gray-500 dark:text-gray-400' },
                }
                const cfg = stageConfig[stageOfIdea] || { label: stageOfIdea, dot: 'bg-gray-400', text: 'text-gray-500 dark:text-gray-400' }
                return (
                  <span className={clsx('flex items-center gap-1 text-[10px] font-medium', cfg.text)}>
                    <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                    {cfg.label}
                  </span>
                )
              })()}
              <span>·</span>
              {timePressure ? (
                <span className={clsx(
                  timePressure.urgent ? "text-red-600 dark:text-red-400" : ""
                )}>
                  <Clock className="h-3 w-3 inline mr-0.5" />
                  {timePressure.label}
                </span>
              ) : (
                <span>{formatDistanceToNow(new Date(idea.updated_at), { addSuffix: false })}</span>
              )}
              {/* Analyst action: Make Recommendation */}
              {!isCurrentUserPM && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setProposalEditorIdea(idea)
                  }}
                  className="ml-auto flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                  title="Create a recommendation without committing the trade"
                >
                  <Scale className="h-3 w-3" />
                  Make Recommendation
                </button>
              )}
            </div>
            {/* PM actions: Execute Trade + Request Recommendation */}
            {isCurrentUserPM && idea.isAdded && (() => {
              const v = intentVariants.find(vr => vr.asset_id === idea.asset_id)
              const hasSizing = !!v?.sizing_input
              const c = v?.computed
              // Compact number formatting
              const fmtNotional = (val: number) => {
                const abs = Math.abs(val)
                if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`
                if (abs >= 1_000) return `$${(abs / 1_000).toFixed(0)}K`
                return `$${abs.toFixed(0)}`
              }
              const fmtShares = (val: number) => {
                const abs = Math.abs(val)
                return `${val > 0 ? '+' : val < 0 ? '-' : ''}${abs.toLocaleString()}`
              }
              // Conflict explanation
              const ideaAction = idea.action as string
              const ds = c?.delta_shares ?? 0
              const hasConflict = hasSizing && ds !== 0 && (
                ((ideaAction === 'buy' || ideaAction === 'add') && ds < 0) ||
                ((ideaAction === 'sell' || ideaAction === 'trim') && ds > 0)
              )
              const conflictExplanation = hasConflict
                ? `Idea: ${ideaAction.toUpperCase()} · Simulation ${ds > 0 ? 'increases' : 'decreases'} exposure`
                : null
              return (
                <>
                  {/* Simulation result */}
                  {hasSizing && c && (
                    <div className={clsx(
                      "mt-2 rounded-md border",
                      hasConflict
                        ? "bg-red-50/50 dark:bg-red-950/10 border-red-200 dark:border-red-800/50"
                        : "bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700/50"
                    )}>
                      {/* Label */}
                      <div className="px-2.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        Simulation Result
                      </div>
                      {/* Derived outputs */}
                      <div className="px-2.5 pt-1 pb-2 flex items-baseline gap-3 text-[12px]">
                        {c.target_weight != null && (
                          <span className="font-semibold text-gray-900 dark:text-white">{c.target_weight.toFixed(2)}%</span>
                        )}
                        {c.notional_value != null && c.notional_value !== 0 && (
                          <span className="font-medium text-gray-600 dark:text-gray-300">{fmtNotional(c.notional_value)}</span>
                        )}
                        {ds !== 0 && (
                          <span className={clsx('font-mono text-[11px]', ds > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                            {fmtShares(ds)} shrs
                          </span>
                        )}
                        {c.delta_weight != null && c.delta_weight !== 0 && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            Δ {c.delta_weight > 0 ? '+' : ''}{c.delta_weight.toFixed(2)}%
                          </span>
                        )}
                      </div>
                      {/* Conflict explanation */}
                      {hasConflict && (
                        <div className="px-2.5 pb-2 flex items-start gap-1.5 text-[10px] text-red-600 dark:text-red-400">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span>
                            <span className="font-semibold">Direction conflict:</span>{' '}
                            Idea is {ideaAction.toUpperCase()}, but sizing {ds > 0 ? 'adds' : 'reduces'} exposure ({fmtShares(ds)} shrs)
                          </span>
                        </div>
                      )}
                      {/* Entered sizing — separated by border, readable description */}
                      <div className="px-2.5 py-1.5 border-t border-gray-100 dark:border-gray-700/50 text-[10px] text-gray-400 dark:text-gray-500">
                        {(() => {
                          const fw = (v.sizing_spec as any)?.framework as string | undefined
                          const raw = v.sizing_input
                          switch (fw) {
                            case 'weight_target': return <><span className="font-mono">{raw}%</span> sim weight entered</>
                            case 'weight_delta': return <><span className="font-mono">{raw}%</span> weight change entered</>
                            case 'shares_target': return <><span className="font-mono">{raw}</span> target shares entered</>
                            case 'shares_delta': return <><span className="font-mono">{raw}</span> share change entered</>
                            case 'active_target': return <><span className="font-mono">{raw}%</span> active weight entered</>
                            case 'active_delta': return <><span className="font-mono">{raw}%</span> active weight change entered</>
                            default: return <><span className="font-mono">{raw}</span> entered</>
                          }
                        })()}
                      </div>
                    </div>
                  )}
                  {!hasSizing && (
                    <div className="mt-2 text-[10px] text-gray-400 dark:text-gray-500 italic">No simulation sizing entered</div>
                  )}

                  {/* Action buttons */}
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmExecuteIdea(idea) }}
                      disabled={!hasSizing || executeTradeM.isPending}
                      className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={hasSizing ? 'Commit this trade to Trade Book for execution' : 'Enter sizing in simulation first'}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Execute Trade
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmRecommendIdea(idea) }}
                      disabled={requestRecommendationM.isPending}
                      className="flex items-center gap-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors disabled:opacity-50"
                      title="Create a PM proposal from current sizing"
                    >
                      <Scale className="h-3 w-3" />
                      Request Recommendation
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        )}
      </div>
    )
  }

  // Render a pair trade card (grouped unit with all legs)
  const renderPairTradeCard = (entry: { pairTrade: PairTrade; legs: typeof tradeIdeasWithStatus; allAdded: boolean; someAdded: boolean }) => {
    const { pairTrade, legs } = entry

    // A leg is "already committed to Trade Book" when it has a corresponding
    // accepted_trade for this portfolio. Rather than re-fetch or plumb a set
    // through props, we derive it from acceptedTrades (already in scope).
    const committedLegIds = new Set<string>(
      (acceptedTrades || [])
        .filter(at => at.trade_queue_item_id && legs.some(l => l.id === at.trade_queue_item_id))
        .map(at => at.trade_queue_item_id as string)
    )
    const isCommittedLeg = (l: typeof legs[0]) => committedLegIds.has(l.id)

    // Recompute allAdded/someAdded over the NON-committed legs only. The
    // upstream grouping treats committed legs as "not added" (because they're
    // in accepted_trades, not simulation_trades), which would make the
    // top-level "Add all" button misleading — it would always look unchecked
    // even when every uncommitted leg is actually in the simulation.
    const nonCommittedLegs = legs.filter(l => !isCommittedLeg(l))
    const allAdded = nonCommittedLegs.length > 0 && nonCommittedLegs.every(l => ((l as any).isExpressed ?? l.isAdded))
    const someAdded = nonCommittedLegs.some(l => ((l as any).isExpressed ?? l.isAdded))

    // Categorize legs as long or short
    // Check pair_leg_type first, fall back to action if not set
    const isLongLeg = (l: typeof legs[0]) =>
      l.pair_leg_type === 'long' ||
      (!l.pair_leg_type && (l.action === 'buy' || l.action === 'add'))

    const isShortLeg = (l: typeof legs[0]) =>
      l.pair_leg_type === 'short' ||
      (!l.pair_leg_type && (l.action === 'sell' || l.action === 'reduce' || l.action === 'short'))

    const longLegs = legs.filter(isLongLeg)
    const shortLegs = legs.filter(isShortLeg)
    // Fallback: legs that don't match either category
    const uncategorizedLegs = legs.filter(l => !isLongLeg(l) && !isShortLeg(l))

    // Generate display parts from legs (e.g., "Buy AAPL, GOOG / Sell MSFT")
    const buySymbols = longLegs.map(l => l.assets?.symbol).filter(Boolean).join(', ')
    const sellSymbols = shortLegs.map(l => l.assets?.symbol).filter(Boolean).join(', ')
    // If no categorization, just list all symbols
    const allSymbols = legs.map(l => l.assets?.symbol).filter(Boolean).join(', ')

    // Toggle only operates on NON-committed legs — committed legs are
    // already in the Trade Book and can't be added/removed from the Lab.
    const toggleableLegs = legs.filter(l => !isCommittedLeg(l))
    const handleTogglePairTrade = () => {
      if (allAdded) {
        // Remove ALL toggleable legs atomically
        toggleableLegs.forEach(leg => handleRemoveAsset(leg.asset_id))
      } else {
        // Add ALL not-yet-added toggleable legs atomically.
        // Set override=true for every toggleable leg so the group reads as
        // fully checked immediately, preventing partial-state flicker.
        toggleableLegs.forEach(leg => {
          checkboxOverridesRef.current.set(leg.asset_id, true)
        })

        const legsToAdd = toggleableLegs.filter(l => !(l as any).isExpressed && !l.isAdded)
        if (legsToAdd.length > 0) {
          // Optimistic: add temp variants + simulation trades to cache
          legsToAdd.forEach(leg => {
            if (tradeLab?.id) {
              queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null], (old) => {
                if (old?.some(v => v.asset_id === leg.asset_id)) return old
                return [...(old || []), {
                  id: `temp-${leg.asset_id}`, asset_id: leg.asset_id, trade_lab_id: tradeLab.id,
                  direction: leg.action || 'buy', sizing_input: null, sizing_spec: null,
                  computed: null, direction_conflict: null, below_lot_warning: false,
                  active_weight_config: null,
                  asset: leg.assets ? { symbol: leg.assets.symbol, company_name: leg.assets.company_name, sector: leg.assets.sector } : undefined,
                } as IntentVariant]
              })
            }
            // Also optimistically add to simulation_trades cache so expressedAssetIds
            // includes this leg immediately (prevents partial-state on re-render)
            queryClient.setQueryData(
              ['simulation', selectedSimulationId],
              (old: any) => {
                if (!old) return old
                const trades = old.simulation_trades || []
                if (trades.some((t: any) => t.asset_id === leg.asset_id)) return old
                return {
                  ...old,
                  simulation_trades: [...trades, {
                    id: `temp-pair-${leg.asset_id}`,
                    simulation_id: simulation?.id,
                    trade_queue_item_id: leg.id,
                    asset_id: leg.asset_id,
                    action: leg.action,
                  }],
                }
              }
            )
          })
          importPairTradeMutation.mutate(legsToAdd)
        }
        setCheckboxOverrides(new Map(checkboxOverridesRef.current))
      }
    }

    const isExpanded = expandedTradeIds.has(pairTrade.id)
    const toggleExpand = (e: React.MouseEvent) => {
      e.stopPropagation()
      setExpandedTradeIds(prev => {
        const next = new Set(prev)
        if (next.has(pairTrade.id)) {
          next.delete(pairTrade.id)
        } else {
          next.add(pairTrade.id)
        }
        return next
      })
    }

    // Stage-based tint for pair trade tile
    const pairStage = pairTrade.status || 'idea'
    const pairStageBgClass =
      (pairStage === 'ready_for_decision' || pairStage === 'deciding') ? 'bg-amber-50/40 dark:bg-amber-900/5' :
      (pairStage === 'thesis_forming') ? 'bg-purple-50/40 dark:bg-purple-900/5' :
      (pairStage === 'deep_research' || pairStage === 'modeling' || pairStage === 'simulating') ? 'bg-indigo-50/40 dark:bg-indigo-900/5' :
      (pairStage === 'investigate' || pairStage === 'working_on' || pairStage === 'discussing') ? 'bg-blue-50/40 dark:bg-blue-900/5' :
      ''

    return (
      <div
        key={pairTrade.id}
        className={clsx(
          "rounded-lg p-2.5 border transition-colors relative",
          allAdded
            ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10"
            : someAdded
              ? "border-amber-400 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-900/10"
              : clsx("border-purple-200 dark:border-purple-800 hover:border-purple-400 dark:hover:border-purple-600", pairStageBgClass || "bg-white dark:bg-gray-800")
        )}
      >
        {/* Badge: conflicts take priority over partial indicator */}
        {(() => {
          // Check for idea-direction conflicts on any added leg
          const conflictLegs = someAdded ? legs.filter(leg => {
            const legExp = (leg as any).isExpressed ?? leg.isAdded
            if (!legExp) return false
            const variant = intentVariants.find(v => v.asset_id === leg.asset_id)
            if (!variant?.sizing_input) return false
            const ds = variant?.computed?.delta_shares ?? 0
            if (ds === 0) return false
            const a = leg.action as string
            return ((a === 'buy' || a === 'add') && ds < 0) || ((a === 'sell' || a === 'trim') && ds > 0)
          }) : []

          if (conflictLegs.length > 0) {
            return (
              <span className="absolute -top-2 -right-2 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-red-500 text-white shadow-sm flex items-center gap-0.5">
                <AlertTriangle className="w-2.5 h-2.5" /> {conflictLegs.length} conflict{conflictLegs.length !== 1 ? 's' : ''}
              </span>
            )
          }
          if (someAdded && !allAdded) {
            return (
              <span className="absolute -top-2 -right-2 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white shadow-sm">
                Partial
              </span>
            )
          }
          return null
        })()}

        {/* Pairs Trade Header — layout matches singleton cards:
            [checkbox] [content spans flex-1] [author badge] [chevron] */}
        {(() => {
          // Pick an author from the first leg that has user info. Legs of a
          // pair are normally created together by one person, but we fall
          // back through all legs in case some don't have the join populated.
          const author = (legs.find(l => (l as any).users)?.users) as
            | { first_name?: string | null; last_name?: string | null; email?: string | null }
            | undefined
          const authorFull = author
            ? (author.first_name && author.last_name
                ? `${author.first_name} ${author.last_name}`
                : author.email || 'Unknown')
            : 'Unknown'
          const authorShort = author
            ? (author.first_name && author.last_name
                ? `${author.first_name} ${author.last_name.charAt(0)}.`
                : author.first_name || author.email?.split('@')[0] || '?')
            : '?'
          return (
            <div className="flex items-start gap-2">
              {/* Checkbox for added status */}
              <button
                onClick={handleTogglePairTrade}
                disabled={false}
                className={clsx(
                  "flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors mt-0.5",
                  allAdded
                    ? "bg-green-500 border-green-500 text-white"
                    : someAdded
                      ? "bg-amber-500 border-amber-500 text-white"
                      : "border-purple-400 dark:border-purple-600 hover:border-purple-500"
                )}
              >
                {allAdded && <Check className="h-3 w-3" />}
                {someAdded && !allAdded && <Minus className="h-3 w-3" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Link2 className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                  {(() => {
                    // Compact summary when the full symbol list would overflow:
                    // any basket with more than 1 leg on either side is shown
                    // as "Buy N / Sell M" with the full list in a hover title.
                    // Classic 1-long / 1-short pairs still show the full symbols.
                    const useCompact = longLegs.length > 1 || shortLegs.length > 1
                    const fullTooltip = [
                      buySymbols ? `Buy ${buySymbols}` : null,
                      sellSymbols ? `Sell ${sellSymbols}` : null,
                    ].filter(Boolean).join(' / ')
                    return (
                      <span className="font-medium text-sm truncate" title={useCompact ? fullTooltip : undefined}>
                        {buySymbols || sellSymbols ? (
                          useCompact ? (
                            <>
                              {longLegs.length > 0 && (
                                <>
                                  <span className="text-green-600 dark:text-green-400">Buy</span>
                                  <span className="text-gray-900 dark:text-white"> {longLegs.length}</span>
                                </>
                              )}
                              {longLegs.length > 0 && shortLegs.length > 0 && <span className="text-gray-500"> / </span>}
                              {shortLegs.length > 0 && (
                                <>
                                  <span className="text-red-600 dark:text-red-400">Sell</span>
                                  <span className="text-gray-900 dark:text-white"> {shortLegs.length}</span>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              {buySymbols && (
                                <>
                                  <span className="text-green-600 dark:text-green-400">Buy</span>
                                  <span className="text-gray-900 dark:text-white"> {buySymbols}</span>
                                </>
                              )}
                              {buySymbols && sellSymbols && <span className="text-gray-500"> / </span>}
                              {sellSymbols && (
                                <>
                                  <span className="text-red-600 dark:text-red-400">Sell</span>
                                  <span className="text-gray-900 dark:text-white"> {sellSymbols}</span>
                                </>
                              )}
                            </>
                          )
                        ) : (
                          <span className="text-gray-900 dark:text-white">{allSymbols || 'Pairs Trade'}</span>
                        )}
                      </span>
                    )
                  })()}
                </div>
              </div>
              {/* Author name + Expand button — right-side cluster to match singleton cards */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <span
                  className="text-[9px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-full px-1.5 py-0.5 flex-shrink-0"
                  title={authorFull}
                >
                  {authorShort}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpand(e) }}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <ChevronDown className={clsx("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                </button>
              </div>
            </div>
          )
        })()}

        {/* Legs display - collapsible */}
        {isExpanded && (
        <div className="space-y-1.5 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              {/* Long legs */}
              {/* Pair trade legs toggle atomically — individual leg checkboxes
                  toggle the entire group to preserve grouped idea integrity. */}
              {longLegs.map(leg => {
                const isCommitted = isCommittedLeg(leg)
                const legChecked = (leg as any).isExpressed ?? leg.isAdded
                const handleToggleLeg = (e: React.MouseEvent) => {
                  e.stopPropagation()
                  if (isCommitted) return // committed legs can't be toggled from the Lab
                  if (legChecked) { handleRemoveAsset(leg.asset_id) } else { handleAddAsset(leg) }
                }
                const variant = intentVariants.find(v => v.asset_id === leg.asset_id)
                const variantConflict = variant?.direction_conflict as SizingValidationError | null
                const ideaAction = leg.action as string
                const deltaShares = variant?.computed?.delta_shares ?? 0
                const hasIdeaConflict = variant?.sizing_input && deltaShares !== 0 && (
                  ((ideaAction === 'buy' || ideaAction === 'add') && deltaShares < 0) ||
                  ((ideaAction === 'sell' || ideaAction === 'trim') && deltaShares > 0)
                )

                return (
                  <div key={leg.id} className={clsx("flex items-center gap-2 text-xs group", isCommitted && "opacity-75")}>
                    <button
                      onClick={handleToggleLeg}
                      disabled={isCommitted}
                      className={clsx(
                        "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        isCommitted
                          ? "bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-400 cursor-not-allowed"
                          : legChecked
                            ? "bg-green-500 border-green-500 text-white"
                            : "border-gray-300 dark:border-gray-600 hover:border-green-500 opacity-0 group-hover:opacity-100"
                      )}
                      title={isCommitted ? 'Committed to Trade Book — revert from Trade Book to edit' : undefined}
                    >
                      {(legChecked || isCommitted) && <Check className="h-2.5 w-2.5" />}
                    </button>
                    <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium uppercase">
                      buy
                    </span>
                    <span className={clsx(
                      "font-medium",
                      isCommitted ? "text-gray-500 dark:text-gray-400" :
                      legChecked ? "text-green-700 dark:text-green-400" : "text-gray-700 dark:text-gray-300"
                    )}>
                      {leg.assets?.symbol}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {leg.proposed_weight ? `${leg.proposed_weight}%` : ''}
                      {leg.proposed_weight && leg.proposed_shares ? ' · ' : ''}
                      {leg.proposed_shares ? `${leg.proposed_shares} shrs` : ''}
                    </span>
                    {isCommitted && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" title="Already in Trade Book">
                        Committed
                      </span>
                    )}
                    {!isCommitted && legChecked && variantConflict && (
                      <InlineConflictBadge conflict={variantConflict} size="sm" />
                    )}
                    {!isCommitted && legChecked && !variantConflict && hasIdeaConflict && (
                      <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400" title={`Idea direction is ${ideaAction.toUpperCase()} but sizing reduces exposure`}>
                        <AlertTriangle className="w-3 h-3" /> Conflicts with idea
                      </span>
                    )}
                  </div>
                )
              })}

              {/* Short legs */}
              {shortLegs.map(leg => {
                const isCommitted = isCommittedLeg(leg)
                const legChecked = (leg as any).isExpressed ?? leg.isAdded
                const handleToggleLeg = (e: React.MouseEvent) => {
                  e.stopPropagation()
                  if (isCommitted) return
                  if (legChecked) { handleRemoveAsset(leg.asset_id) } else { handleAddAsset(leg) }
                }
                const variant = intentVariants.find(v => v.asset_id === leg.asset_id)
                const variantConflict = variant?.direction_conflict as SizingValidationError | null
                const ideaAction = leg.action as string
                const deltaShares = variant?.computed?.delta_shares ?? 0
                const hasIdeaConflict = variant?.sizing_input && deltaShares !== 0 && (
                  ((ideaAction === 'buy' || ideaAction === 'add') && deltaShares < 0) ||
                  ((ideaAction === 'sell' || ideaAction === 'trim') && deltaShares > 0)
                )

                return (
                  <div key={leg.id} className={clsx("flex items-center gap-2 text-xs group", isCommitted && "opacity-75")}>
                    <button
                      onClick={handleToggleLeg}
                      disabled={isCommitted}
                      className={clsx(
                        "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        isCommitted
                          ? "bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-400 cursor-not-allowed"
                          : legChecked
                            ? "bg-green-500 border-green-500 text-white"
                            : "border-gray-300 dark:border-gray-600 hover:border-red-500 opacity-0 group-hover:opacity-100"
                      )}
                      title={isCommitted ? 'Committed to Trade Book — revert from Trade Book to edit' : undefined}
                    >
                      {(legChecked || isCommitted) && <Check className="h-2.5 w-2.5" />}
                    </button>
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium uppercase">
                      sell
                    </span>
                    <span className={clsx(
                      "font-medium",
                      isCommitted ? "text-gray-500 dark:text-gray-400" :
                      legChecked ? "text-green-700 dark:text-green-400" : "text-gray-700 dark:text-gray-300"
                    )}>
                      {leg.assets?.symbol}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {leg.proposed_weight ? `${leg.proposed_weight}%` : ''}
                      {leg.proposed_weight && leg.proposed_shares ? ' · ' : ''}
                      {leg.proposed_shares ? `${leg.proposed_shares} shrs` : ''}
                    </span>
                    {isCommitted && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" title="Already in Trade Book">
                        Committed
                      </span>
                    )}
                    {!isCommitted && legChecked && variantConflict && (
                      <InlineConflictBadge conflict={variantConflict} size="sm" />
                    )}
                    {!isCommitted && legChecked && !variantConflict && hasIdeaConflict && (
                      <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400" title={`Idea direction is ${ideaAction.toUpperCase()} but sizing increases exposure`}>
                        <AlertTriangle className="w-3 h-3" /> Conflicts with idea
                      </span>
                    )}
                  </div>
                )
              })}

              {/* Uncategorized legs (fallback) */}
              {uncategorizedLegs.map(leg => {
                const legChecked = (leg as any).isExpressed ?? leg.isAdded
                const handleToggleLeg = (e: React.MouseEvent) => {
                  e.stopPropagation()
                  if (legChecked) { handleRemoveAsset(leg.asset_id) } else { handleAddAsset(leg) }
                }
                const isBuyAction = leg.action === 'buy' || leg.action === 'add'
                const variant = intentVariants.find(v => v.asset_id === leg.asset_id)
                const variantConflict = variant?.direction_conflict as SizingValidationError | null
                const ideaAction = leg.action as string
                const deltaShares = variant?.computed?.delta_shares ?? 0
                const hasIdeaConflict = variant?.sizing_input && deltaShares !== 0 && (
                  ((ideaAction === 'buy' || ideaAction === 'add') && deltaShares < 0) ||
                  ((ideaAction === 'sell' || ideaAction === 'trim') && deltaShares > 0)
                )

                return (
                  <div key={leg.id} className="flex items-center gap-2 text-xs group">
                    <button
                      onClick={handleToggleLeg}
                      className={clsx(
                        "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        legChecked
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-300 dark:border-gray-600 hover:border-gray-500 opacity-0 group-hover:opacity-100"
                      )}
                    >
                      {legChecked && <Check className="h-2.5 w-2.5" />}
                    </button>
                    <span className={clsx(
                      "px-1.5 py-0.5 rounded font-medium uppercase",
                      isBuyAction
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    )}>
                      {leg.action}
                    </span>
                    <span className={clsx(
                      "font-medium",
                      legChecked ? "text-green-700 dark:text-green-400" : "text-gray-700 dark:text-gray-300"
                    )}>
                      {leg.assets?.symbol}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {leg.proposed_weight ? `${leg.proposed_weight}%` : ''}
                      {leg.proposed_weight && leg.proposed_shares ? ' · ' : ''}
                      {leg.proposed_shares ? `${leg.proposed_shares} shrs` : ''}
                    </span>
                    {legChecked && variantConflict && (
                      <InlineConflictBadge conflict={variantConflict} size="sm" />
                    )}
                    {legChecked && !variantConflict && hasIdeaConflict && (
                      <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400" title={`Idea direction is ${ideaAction.toUpperCase()} but sizing conflicts`}>
                        <AlertTriangle className="w-3 h-3" /> Conflicts with idea
                      </span>
                    )}
                  </div>
                )
              })}
        </div>
        )}
      </div>
    )
  }

  // Helper to render a trade item (single or pair trade)
  const renderTradeItem = (item: TradeItem) => {
    if (item.type === 'single') {
      return renderTradeIdeaCard(item.idea)
    } else {
      return renderPairTradeCard(item)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Create Trade Lab Modal */}
      {showCreatePanel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Beaker className="h-5 w-5" />
                New Trade Lab
              </h2>
              <button
                onClick={() => setShowCreatePanel(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name
                </label>
                <Input
                  placeholder="e.g., Q4 Rebalance Test"
                  value={newSimName}
                  onChange={(e) => setNewSimName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Portfolio
                </label>
                <select
                  value={newSimPortfolioId}
                  onChange={(e) => setNewSimPortfolioId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select portfolio...</option>
                  {portfolios?.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <input
                  type="checkbox"
                  checked={newSimIsCollab}
                  onChange={(e) => setNewSimIsCollab(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <Users className="h-4 w-4" />
                <div>
                  <div className="font-medium">Collaborative</div>
                  <div className="text-xs text-gray-500">Allow team members to view and edit</div>
                </div>
              </label>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => setShowCreatePanel(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => createSimulationMutation.mutate()}
                  disabled={!newSimPortfolioId || createSimulationMutation.isPending}
                  loading={createSimulationMutation.isPending}
                  className="flex-1"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header Bar - Portfolio Selector + View Tabs */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {/* Top row: Portfolio selector and actions */}
        <div className="px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Beaker className="h-5 w-5 text-primary-600" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isSharedView ? 'Shared Simulation' : 'Trade Lab'}
            </h1>
            <OrgBadge />
            {isSharedView && sharedSimData && (
              <>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{sharedSimData.name}</span>
              </>
            )}
            {!isSharedView && <span className="text-gray-300 dark:text-gray-600">|</span>}
            {/* Portfolio Selector - Searchable Dropdown — hidden in shared view */}
            {!isSharedView && <div className="relative" ref={portfolioDropdownRef}>
              <button
                onClick={() => setPortfolioDropdownOpen(!portfolioDropdownOpen)}
                className={clsx(
                  "flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors min-w-[200px]",
                  portfolioDropdownOpen
                    ? "border-primary-500 ring-2 ring-primary-500/20"
                    : "border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
                )}
              >
                <Briefcase className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <span className="flex-1 text-left truncate">
                  {portfolios?.find(p => p.id === selectedPortfolioId)?.name || 'Select portfolio...'}
                </span>
                <ChevronDown className={clsx(
                  "h-4 w-4 text-gray-400 transition-transform flex-shrink-0",
                  portfolioDropdownOpen && "rotate-180"
                )} />
              </button>

              {/* Dropdown Panel */}
              {portfolioDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 overflow-hidden">
                  {/* Search Input */}
                  <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        ref={portfolioSearchInputRef}
                        type="text"
                        value={portfolioSearchQuery}
                        onChange={(e) => setPortfolioSearchQuery(e.target.value)}
                        placeholder="Search portfolios..."
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  </div>

                  {/* Portfolio List */}
                  <div className="max-h-64 overflow-y-auto">
                    {filteredPortfolios.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
                        No portfolios found
                      </div>
                    ) : (
                      filteredPortfolios.map(p => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedPortfolioId(p.id)
                            setSelectedSimulationId(null)
                            setPortfolioDropdownOpen(false)
                            setPortfolioSearchQuery('')
                          }}
                          className={clsx(
                            "w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors",
                            p.id === selectedPortfolioId
                              ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          )}
                        >
                          <Briefcase className={clsx(
                            "h-4 w-4 flex-shrink-0",
                            p.id === selectedPortfolioId ? "text-primary-500" : "text-gray-400"
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{p.name}</div>
                            {p.portfolio_id && (
                              <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{p.portfolio_id}</div>
                            )}
                          </div>
                          {p.id === selectedPortfolioId && (
                            <Check className="h-4 w-4 text-primary-500 flex-shrink-0" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>}
            {!isSharedView && tradeLabLoading && (
              <RefreshCw className="h-4 w-4 text-gray-400 animate-spin" />
            )}
            {!isSharedView && tradeLab && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {simulationRows.summary.tradedCount} trades
              </span>
            )}
          </div>

          {/* Right side controls */}
          <div className="flex items-center gap-2">
            {/* Workbench Status Indicator */}
            {simulation && (
              <>
                {workbenchHasUnsavedChanges && !workbenchSaving && (
                  <div className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-xs">Unsaved</span>
                  </div>
                )}
                {workbenchSaving && (
                  <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span className="text-xs">Saving...</span>
                  </div>
                )}
                {workbenchLastSaved && !workbenchHasUnsavedChanges && !workbenchSaving && (
                  <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                    <Check className="h-3.5 w-3.5" />
                    <span className="text-xs">Saved {formatDistanceToNow(workbenchLastSaved, { addSuffix: true })}</span>
                  </div>
                )}
              </>
            )}
            {/* Save Snapshot — hidden in shared view and snapshots tab */}
            {simulation && !isSharedView && selectedViewType !== 'lists' && simulationRows.summary.tradedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCreateSheetConfirm(true)}
                title="Save a snapshot of this simulation"
              >
                <FileText className="h-4 w-4 mr-1.5" />
                Save Snapshot
              </Button>
            )}
            {/* Exit shared view button */}
            {isSharedView && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExitSharedView}
              >
                <X className="h-4 w-4 mr-1.5" />
                Exit shared view
              </Button>
            )}
            {/* Create Trade List button moved to bottom bar of HoldingsSimulationTable */}
          </div>
        </div>

        {/* View Tabs Row */}
        {(selectedPortfolioId || isSharedView) && (
          <div className="px-6 pb-2 flex items-center justify-between">
            {/* Left: View Type Tabs — hidden in shared view */}
            {!isSharedView ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSelectedViewType('private')}
                  className={clsx(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    selectedViewType === 'private'
                      ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  )}
                >
                  <FileText className="h-4 w-4" />
                  Workspace
                </button>
                <button
                  onClick={() => setSelectedViewType('lists')}
                  className={clsx(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    selectedViewType === 'lists'
                      ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  )}
                >
                  <List className="h-4 w-4" />
                  Snapshots
                </button>
              </div>
            ) : <div />}

            {/* Right: View Toggle (only show for workbench views, not Trade Sheets) */}
            {selectedViewType !== 'lists' && (simulation || isSharedView) && (
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <button
                    onClick={() => setImpactView('simulation')}
                    className={clsx(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      impactView === 'simulation'
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    Simulation
                    {simulationRows.summary.conflictCount > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full">
                        {simulationRows.summary.conflictCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setImpactView('impact')}
                    className={clsx(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      impactView === 'impact'
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    Portfolio Impact
                  </button>
                  <button
                    onClick={() => setImpactView('trades')}
                    className={clsx(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      impactView === 'trades'
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                  >
                    <List className="h-3.5 w-3.5" />
                    Trades
                    {simulationRows.summary.tradedCount > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
                        {simulationRows.summary.tradedCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Loading state - unified loading for all initial data */}
        {(sharedSimLoading || tradeLabLoading || simulationsLoading || isAutoCreating || (selectedPortfolioId && !simulation && simulationLoading && !isSharedView)) ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900/50">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 text-gray-400 animate-spin mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Loading workbench...</p>
            </div>
          </div>
        ) : !selectedPortfolioId && !isSharedView ? (
          /* No portfolio selected state */
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900/50">
            <div className="text-center max-w-md">
              <Briefcase className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Select a Portfolio
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Choose a portfolio from the dropdown above to start working in the Trade Lab.
              </p>
            </div>
          </div>
        ) : selectedViewType === 'lists' ? (
          /* Trade Sheets Section */
          <div className="flex-1 bg-white dark:bg-gray-900 overflow-auto">
            <div className="p-6">
              {/* Snapshots Header + Toggle */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Snapshots</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Save and revisit simulation scenarios. Snapshots do not commit trades.
                  </p>
                </div>
                <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                  <button
                    onClick={() => setSnapshotSubView('mine')}
                    className={clsx(
                      'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                      snapshotSubView === 'mine'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    )}
                  >
                    My Snapshots
                  </button>
                  <button
                    onClick={() => setSnapshotSubView('shared')}
                    className={clsx(
                      'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                      snapshotSubView === 'shared'
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    )}
                  >
                    Shared with me
                  </button>
                </div>
              </div>

              {snapshotSubView === 'mine' ? (
                <TradeSheetPanel
                  tradeSheets={v3TradeSheets}
                  assetSymbolMap={assetSymbolMap}
                  onLoadSnapshot={(sheet) => setConfirmLoadSnapshot(sheet)}
                  onShareSnapshot={(sheet) => setShareSnapshotSheet(sheet)}
                  isLoadingSnapshot={isLoadingSnapshot}
                />
              ) : (
                <SharedWithMeList
                  onSelectShare={(share) => {
                    window.dispatchEvent(new CustomEvent('open-shared-simulation', { detail: { share } }))
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          /* Workbench View - always show for Workspace tab */
          <>
              {/* Trade Ideas Panel — hidden in shared view */}
              {!isSharedView && <div className={clsx(
                "border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex flex-col overflow-hidden",
                showIdeasPanel ? "w-80" : "w-12"
              )}>
                <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setShowIdeasPanel(!showIdeasPanel)}
                    className="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 -ml-1"
                  >
                    {showIdeasPanel ? (
                      <>
                        <span className="font-medium text-gray-900 dark:text-white text-sm flex items-center gap-2">
                          <Layers className="h-4 w-4" />
                          Trade Ideas
                          {(filteredItems.proposals.length + filteredItems.ideas.length) > 0 && (
                            <Badge variant="default" className="text-xs">{filteredItems.proposals.length + filteredItems.ideas.length}</Badge>
                          )}
                        </span>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <Layers className="h-4 w-4 text-gray-500" />
                        <ChevronRight className="h-4 w-4 text-gray-500" />
                      </div>
                    )}
                  </button>
                  {showIdeasPanel && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setShowAddTradeIdeaModal(true)}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                        title="Add trade idea"
                      >
                        <Plus className="h-3.5 w-3.5 text-gray-500" />
                      </button>
                      <button
                        onClick={() => setShowIdeasPanel(false)}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                      >
                        <ChevronRight className="h-4 w-4 text-gray-500 rotate-180" />
                      </button>
                    </div>
                  )}
                </div>

                {showIdeasPanel && (
                  <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
                    {(tradeIdeasLoading || tradeIdeasFetching || proposalsLoading) ? (
                      <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 text-gray-400 animate-spin" />
                      </div>
                    ) : tradeIdeasWithStatus.length === 0 && itemsByCategory.proposals.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        <p className="text-sm">No trade ideas available</p>
                        <p className="text-xs mt-1">Add ideas from the Idea Pipeline</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Search and Filter Bar */}
                        <div className="space-y-1.5">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                            <input
                              type="text"
                              value={leftPaneSearch}
                              onChange={(e) => setLeftPaneSearch(e.target.value)}
                              placeholder="Filter by ticker or name..."
                              className="w-full pl-7 pr-7 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 placeholder:text-gray-400"
                            />
                            {leftPaneSearch && (
                              <button
                                onClick={() => setLeftPaneSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5">
                            {([
                              { value: 'all' as const, label: 'All', dot: null },
                              { value: 'ready_for_decision' as const, label: 'Deciding', dot: 'bg-amber-500' },
                              { value: 'thesis_forming' as const, label: 'Thesis', dot: 'bg-purple-500' },
                              { value: 'deep_research' as const, label: 'Research', dot: 'bg-indigo-500' },
                              { value: 'investigate' as const, label: 'Investigate', dot: 'bg-blue-500' },
                            ]).map(({ value, label, dot }) => (
                              <button
                                key={value}
                                onClick={() => setLeftPaneStageFilter(value)}
                                className={clsx(
                                  "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full transition-colors whitespace-nowrap",
                                  leftPaneStageFilter === value
                                    ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                )}
                              >
                                {dot && <span className={clsx("w-1.5 h-1.5 rounded-full", dot)} />}
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Proposals Section - Items with active proposals */}
                        {filteredItems.proposals.length > 0 && (
                          <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-2 -mx-1">
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedGroups)
                                if (newCollapsed.has('category-proposals')) {
                                  newCollapsed.delete('category-proposals')
                                } else {
                                  newCollapsed.add('category-proposals')
                                }
                                setCollapsedGroups(newCollapsed)
                              }}
                              className="flex items-center gap-2 w-full text-left mb-2 group"
                            >
                              <ChevronDown className={clsx(
                                "h-3 w-3 text-amber-500 transition-transform",
                                collapsedGroups.has('category-proposals') && "-rotate-90"
                              )} />
                              <Scale className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Recommendations</span>
                              <Badge className="text-[10px] py-0 px-1.5 bg-amber-100 dark:bg-amber-800 text-amber-700 dark:text-amber-300">{filteredItems.proposals.length}</Badge>
                            </button>
                            {!collapsedGroups.has('category-proposals') && (
                              <div className="space-y-2">
                                {filteredItems.proposals.map((proposalItem) => {
                                  const { proposal, isPairTrade, legs } = proposalItem
                                  const tradeItem = proposal.trade_queue_items as any
                                  const asset = tradeItem?.assets
                                  const proposerUser = proposal.users as any

                                  // Get proposer display name
                                  const proposerName = proposerUser?.first_name && proposerUser?.last_name
                                    ? `${proposerUser.first_name} ${proposerUser.last_name.charAt(0)}.`
                                    : proposerUser?.email?.split('@')[0] || 'Unknown'

                                  // Generate display parts for pair trades
                                  const buyLegs = isPairTrade && legs?.length
                                    ? legs.filter((l: any) => l.action === 'buy' || l.action === 'add')
                                    : []
                                  const sellLegs = isPairTrade && legs?.length
                                    ? legs.filter((l: any) => l.action === 'sell' || l.action === 'reduce' || l.action === 'short')
                                    : []
                                  const buySymbols = buyLegs.map((l: any) => l.symbol).join(', ')
                                  const sellSymbols = sellLegs.map((l: any) => l.symbol).join(', ')

                                  // Sort legs: buys first, then sells
                                  const sortedLegs = legs ? [...legs].sort((a: any, b: any) => {
                                    const aIsBuy = a.action === 'buy' || a.action === 'add'
                                    const bIsBuy = b.action === 'buy' || b.action === 'add'
                                    if (aIsBuy && !bIsBuy) return -1
                                    if (!aIsBuy && bIsBuy) return 1
                                    return 0
                                  }) : []

                                  // Enrich legs with asset_id from tradeIdeasWithStatus
                                  // Try legId first, fall back to matching by symbol
                                  const enrichedLegs = isPairTrade && legs?.length
                                    ? legs.map((l: any) => {
                                        const tradeItem = l.legId
                                          ? tradeIdeasWithStatus.find(t => t.id === l.legId)
                                          : tradeIdeasWithStatus.find(t =>
                                              t.assets?.symbol === l.symbol && (t.pair_id || t.pair_trade_id)
                                            )
                                        return {
                                          ...l,
                                          assetId: tradeItem?.asset_id,
                                          tradeQueueItemId: tradeItem?.id || l.legId,
                                          companyName: tradeItem?.assets?.company_name || '',
                                          sector: tradeItem?.assets?.sector || null,
                                        }
                                      })
                                    : []

                                  // Check if this proposal has been applied
                                  const isProposalApplied = appliedProposalIds.has(proposal.id)

                                  // Get asset IDs for this proposal
                                  const proposalAssetIds = isPairTrade && enrichedLegs.length
                                    ? enrichedLegs.map((l: any) => l.assetId).filter(Boolean)
                                    : asset?.id ? [asset.id] : []

                                  // Handle applying/unapplying proposal to simulation.
                                  // Delegates to the same handleAddAsset / handleRemoveAsset flow
                                  // used by ideas, so proposals get the exact same optimistic-UI,
                                  // importsInFlightRef guards, and importTradeMutation lifecycle.
                                  const handleAddProposal = (e: React.MouseEvent) => {
                                    e.stopPropagation()

                                    if (isProposalApplied) {
                                      // === UNCHECK: remove proposal from simulation ===
                                      setAppliedProposalIds(prev => {
                                        const next = new Set(prev)
                                        next.delete(proposal.id)
                                        return next
                                      })
                                      setProposalAddedAssetIds(prev => {
                                        const next = new Set(prev)
                                        proposalAssetIds.forEach((id: string) => next.delete(id))
                                        return next
                                      })
                                      // Reuse the battle-tested remove path (optimistic variant removal,
                                      // cancelQueries, DB delete via removeTradeMutation, convergence cleanup)
                                      proposalAssetIds.forEach((aid: string) => handleRemoveAsset(aid))
                                      return
                                    }

                                    // === CHECK: add proposal to simulation ===

                                    // Per-asset exclusivity: uncheck any idea-sourced trade first
                                    proposalAssetIds.forEach((aid: string) => uncheckOtherSourcesForAsset(aid, 'proposal'))

                                    // Clear any stale false overrides that handleRemoveAsset
                                    // (from uncheckOtherSourcesForAsset) may have set
                                    proposalAssetIds.forEach((aid: string) => {
                                      checkboxOverridesRef.current.delete(aid)
                                      convergenceRemovalsInFlightRef.current.delete(aid)
                                    })

                                    // Track proposal-level state
                                    setAppliedProposalIds(prev => {
                                      const next = new Set(prev)
                                      next.add(proposal.id)
                                      return next
                                    })
                                    setProposalAddedAssetIds(prev => {
                                      const next = new Set(prev)
                                      proposalAssetIds.forEach((id: string) => next.add(id))
                                      return next
                                    })

                                    // Build per-asset info for the import
                                    const assetsToAdd = isPairTrade && enrichedLegs.length
                                      ? enrichedLegs.map((l: any) => ({
                                          assetId: l.assetId as string,
                                          tradeQueueItemId: l.tradeQueueItemId as string,
                                          action: (l.action || 'buy') as TradeAction,
                                          symbol: l.symbol as string,
                                          companyName: (l.companyName || '') as string,
                                          sector: (l.sector || null) as string | null,
                                          weight: l.weight as number | null,
                                        })).filter((l: any) => l.assetId)
                                      : asset?.id ? [{
                                          assetId: asset.id,
                                          tradeQueueItemId: tradeItem?.id,
                                          action: (tradeItem?.action || 'buy') as TradeAction,
                                          symbol: asset.symbol || '',
                                          companyName: asset.company_name || '',
                                          sector: asset.sector || null,
                                          weight: proposal.weight as number | null,
                                        }] : []

                                    // Reuse the exact handleAddAsset pattern for each asset:
                                    // checkboxOverride=true → temp variant → importsInFlight → importTradeMutation
                                    for (const a of assetsToAdd) {
                                      // Build a TradeQueueItemWithDetails-shaped object
                                      // For sell/trim actions, negate the weight so the sizing parser
                                      // treats it as a reduction (e.g., sell 10% → sizing_input "-10")
                                      const rawWeight = a.weight ?? proposal.weight ?? null
                                      const isSellAction = a.action === 'sell' || a.action === 'trim'
                                      const signedWeight = rawWeight != null && isSellAction && rawWeight > 0 ? -rawWeight : rawWeight

                                      const tradeIdeaLike = {
                                        id: a.tradeQueueItemId || crypto.randomUUID(),
                                        asset_id: a.assetId,
                                        action: a.action,
                                        proposed_shares: null,
                                        proposed_weight: signedWeight,
                                        target_price: null,
                                        assets: { id: a.assetId, symbol: a.symbol, company_name: a.companyName, sector: a.sector },
                                        _proposalId: proposal.id, // Provenance: which recommendation this came from
                                      } as unknown as TradeQueueItemWithDetails

                                      // Instant UI: override + temp variant + in-flight + mutation
                                      checkboxOverridesRef.current.set(a.assetId, true)

                                      if (tradeLab?.id) {
                                        const variantQueryKey = ['intent-variants', tradeLab.id, null]
                                        queryClient.setQueryData<IntentVariant[]>(variantQueryKey, (old) => {
                                          if (old?.some(v => v.asset_id === a.assetId)) return old
                                          return [...(old || []), {
                                            id: `temp-${a.assetId}`,
                                            asset_id: a.assetId,
                                            trade_lab_id: tradeLab.id,
                                            action: a.action,
                                            sizing_input: signedWeight != null ? String(signedWeight) : null,
                                            sizing_spec: null,
                                            computed: null,
                                            direction_conflict: null,
                                            below_lot_warning: false,
                                            active_weight_config: null,
                                            asset: { id: a.assetId, symbol: a.symbol, company_name: a.companyName, sector: a.sector },
                                          } as IntentVariant]
                                        })
                                      }

                                      importsInFlightRef.current.add(a.assetId)
                                      importTradeMutation.mutate(tradeIdeaLike)
                                    }

                                    setCheckboxOverrides(new Map(checkboxOverridesRef.current))
                                  }

                                  // Expand/collapse state for this proposal
                                  const isProposalExpanded = expandedTradeIds.has(`proposal-${proposal.id}`)
                                  const toggleProposalExpand = (e: React.MouseEvent) => {
                                    e.stopPropagation()
                                    setExpandedTradeIds(prev => {
                                      const next = new Set(prev)
                                      const key = `proposal-${proposal.id}`
                                      if (next.has(key)) {
                                        next.delete(key)
                                      } else {
                                        next.add(key)
                                      }
                                      return next
                                    })
                                  }

                                  const action = tradeItem?.action || 'buy'
                                  const isBuy = action === 'buy' || action === 'add'
                                  const rationale = tradeItem?.rationale || ''

                                  return (
                                    <div
                                      key={proposal.id}
                                      className="bg-white dark:bg-gray-800 rounded-lg border border-amber-200/80 dark:border-amber-800/60 transition-colors"
                                    >
                                      {/* Main row: checkbox | action | ticker | weight | proposer | expand */}
                                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                                        <button
                                          onClick={handleAddProposal}
                                          className={clsx(
                                            "flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                                            isProposalApplied
                                              ? "bg-amber-500 border-amber-500 text-white"
                                              : "border-amber-400 dark:border-amber-600 hover:border-amber-500"
                                          )}
                                          title={isProposalApplied ? "Remove recommendation from lab" : "Add recommendation to lab"}
                                        >
                                          {isProposalApplied && <Check className="h-2.5 w-2.5" />}
                                        </button>

                                        {/* Action badge */}
                                        {!isPairTrade ? (
                                          <span className={clsx(
                                            "flex-shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                                            isBuy
                                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                                              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                          )}>
                                            {action}
                                          </span>
                                        ) : (
                                          <Link2 className="h-3 w-3 text-purple-500 dark:text-purple-400 flex-shrink-0" />
                                        )}

                                        {/* Ticker */}
                                        {!isPairTrade ? (
                                          <>
                                            <span className="font-semibold text-sm text-gray-900 dark:text-white flex-shrink-0">
                                              {asset?.symbol || '???'}
                                            </span>
                                            {asset?.company_name && (
                                              <span
                                                className="text-xs text-gray-500 dark:text-gray-400 truncate min-w-0"
                                                title={asset.company_name}
                                              >
                                                {asset.company_name}
                                              </span>
                                            )}
                                          </>
                                        ) : (
                                          <span className="text-sm font-medium truncate">
                                            {buySymbols && <span className="text-emerald-600 dark:text-emerald-400">{buySymbols}</span>}
                                            {buySymbols && sellSymbols && <span className="text-gray-400 mx-0.5">/</span>}
                                            {sellSymbols && <span className="text-red-600 dark:text-red-400">{sellSymbols}</span>}
                                          </span>
                                        )}

                                        {/* Weight (right-aligned) — amber + bold when PM adjusted from recommendation */}
                                        {!isPairTrade && proposal.weight != null && (() => {
                                          let isModified = false
                                          let currentSizing: string | null = null
                                          if (isProposalApplied) {
                                            const variant = intentVariants.find(v => v.proposal_id === proposal.id)
                                              || (asset?.id ? intentVariants.find(v => v.asset_id === asset.id) : null)
                                            if (variant) {
                                              const isSell = (tradeItem?.action === 'sell' || tradeItem?.action === 'trim')
                                              const expectedWeight = isSell && proposal.weight > 0 ? -proposal.weight : proposal.weight
                                              const variantSizing = variant.sizing_input ? parseFloat(variant.sizing_input) : null
                                              isModified = variantSizing != null && expectedWeight != null && Math.abs(variantSizing - expectedWeight) > 0.01
                                              if (isModified && variantSizing != null) currentSizing = `${variantSizing}%`
                                            }
                                          }
                                          return isModified ? (
                                            <span className="ml-auto flex-shrink-0 relative group">
                                              <span className="text-[12px] tabular-nums font-bold text-amber-600 dark:text-amber-400 cursor-pointer underline decoration-dotted underline-offset-2">
                                                {currentSizing}
                                              </span>
                                              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-[11px] leading-snug whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 shadow-lg">
                                                <span className="block font-medium">Sizing adjusted</span>
                                                <span className="block text-gray-300 dark:text-gray-400 mt-0.5">Rec: {proposal.weight}% → Sim: {currentSizing}</span>
                                              </span>
                                            </span>
                                          ) : (
                                            <span className="ml-auto text-[12px] tabular-nums font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">
                                              {proposal.weight}%
                                            </span>
                                          )
                                        })()}

                                        {/* Spacer pushes proposer + chevron to right */}
                                        <div className="flex-1" />

                                        {/* Proposer initials */}
                                        <span className="flex-shrink-0 text-[9px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-full px-1.5 py-0.5">
                                          {proposerName}
                                        </span>

                                        {/* Expand toggle */}
                                        <button
                                          onClick={toggleProposalExpand}
                                          className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500"
                                        >
                                          <ChevronDown className={clsx(
                                            "h-3 w-3 transition-transform",
                                            !isProposalExpanded && "-rotate-90"
                                          )} />
                                        </button>
                                      </div>

                                      {/* Expanded details */}
                                      {isProposalExpanded && (
                                        <div className="px-2 pb-2 pt-0.5 border-t border-gray-100 dark:border-gray-700/50 space-y-1.5">
                                          {/* Pair trade legs with per-leg checkboxes */}
                                          {isPairTrade && enrichedLegs.length > 0 && (
                                            <div className="space-y-1">
                                              {enrichedLegs.map((leg: any) => {
                                                const legAssetId = leg.assetId as string | undefined
                                                const legInSim = legAssetId ? !!(simulation?.simulation_trades?.some((t: any) => t.asset_id === legAssetId) || checkboxOverrides.get(legAssetId)) : false
                                                const handleToggleLeg = (e: React.MouseEvent) => {
                                                  e.stopPropagation()
                                                  if (!legAssetId) return
                                                  if (legInSim) {
                                                    handleRemoveAsset(legAssetId)
                                                  } else {
                                                    const rawWeight = leg.weight ?? null
                                                    const isSell = leg.action === 'sell' || leg.action === 'trim'
                                                    const signedWeight = rawWeight != null && isSell && rawWeight > 0 ? -rawWeight : rawWeight
                                                    const ideaLike = {
                                                      id: leg.tradeQueueItemId || crypto.randomUUID(),
                                                      asset_id: legAssetId,
                                                      action: leg.action || 'buy',
                                                      proposed_shares: null,
                                                      proposed_weight: signedWeight,
                                                      target_price: null,
                                                      assets: { id: legAssetId, symbol: leg.symbol, company_name: leg.companyName || '', sector: leg.sector || null },
                                                    } as unknown as TradeQueueItemWithDetails
                                                    checkboxOverridesRef.current.set(legAssetId, true)
                                                    // Temp variant for instant table row + quickEstimate
                                                    if (tradeLab?.id) {
                                                      queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null], (old) => {
                                                        if (old?.some(vr => vr.asset_id === legAssetId)) return old
                                                        return [...(old || []), {
                                                          id: `temp-${legAssetId}`, asset_id: legAssetId, trade_lab_id: tradeLab.id,
                                                          action: leg.action || 'buy',
                                                          sizing_input: signedWeight != null ? String(signedWeight) : null,
                                                          sizing_spec: null, computed: null, direction_conflict: null,
                                                          below_lot_warning: false, active_weight_config: null,
                                                          asset: { id: legAssetId, symbol: leg.symbol, company_name: leg.companyName || '', sector: leg.sector || null },
                                                        } as IntentVariant]
                                                      })
                                                    }
                                                    // Temp simulation_trade so expressedAssetIds is consistent
                                                    queryClient.setQueryData(['simulation', selectedSimulationId], (old: any) => {
                                                      if (!old) return old
                                                      const trades = old.simulation_trades || []
                                                      if (trades.some((t: any) => t.asset_id === legAssetId)) return old
                                                      return { ...old, simulation_trades: [...trades, { id: `temp-leg-${legAssetId}`, simulation_id: simulation?.id, trade_queue_item_id: ideaLike.id, asset_id: legAssetId, action: leg.action }] }
                                                    })
                                                    importsInFlightRef.current.add(legAssetId)
                                                    importTradeMutation.mutate(ideaLike)
                                                    setCheckboxOverrides(new Map(checkboxOverridesRef.current))
                                                  }
                                                }
                                                return (
                                                  <div key={leg.legId || leg.symbol} className="flex items-center gap-2 text-xs group">
                                                    <button
                                                      onClick={handleToggleLeg}
                                                      className={clsx(
                                                        "flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ml-5",
                                                        legInSim
                                                          ? "bg-amber-500 border-amber-500 text-white"
                                                          : "border-gray-300 dark:border-gray-600 hover:border-amber-500 opacity-0 group-hover:opacity-100"
                                                      )}
                                                    >
                                                      {legInSim && <Check className="h-2 w-2" />}
                                                    </button>
                                                    <span className={clsx(
                                                      "px-1 py-px rounded text-[9px] font-bold uppercase",
                                                      leg.action === 'buy' || leg.action === 'add'
                                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                    )}>
                                                      {leg.action}
                                                    </span>
                                                    <span className="font-semibold text-gray-900 dark:text-white">{leg.symbol}</span>
                                                    {leg.companyName && (
                                                      <span className="text-gray-400 dark:text-gray-500 truncate max-w-[8rem]">{leg.companyName}</span>
                                                    )}
                                                    {leg.weight != null && (
                                                      <span className="text-gray-500 dark:text-gray-400 ml-auto tabular-nums flex-shrink-0">{leg.weight}%</span>
                                                    )}
                                                  </div>
                                                )
                                              })}
                                            </div>
                                          )}

                                          {/* Notes */}
                                          {proposal.notes && (
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400 ml-5 line-clamp-3">
                                              {proposal.notes}
                                            </p>
                                          )}

                                          {/* Rationale from the trade idea */}
                                          {rationale && !proposal.notes && (
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400 ml-5 line-clamp-3">
                                              {rationale}
                                            </p>
                                          )}

                                          {/* Shares if available */}
                                          {!isPairTrade && proposal.shares != null && (
                                            <div className="text-[11px] text-gray-500 dark:text-gray-400 ml-5">
                                              Shares: {proposal.shares.toLocaleString()}
                                            </div>
                                          )}

                                          {/* View full idea link */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              const tradeQueueItemId = proposal.trade_queue_item_id
                                              if (tradeQueueItemId) {
                                                setTradeModalInitialTab('proposals')
                                                setSelectedTradeId(tradeQueueItemId)
                                              }
                                            }}
                                            className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline underline-offset-2 ml-5"
                                          >
                                            View full idea
                                          </button>

                                          {/* Decision status — decisions flow through Trade Sheet commit */}
                                          {isProposalApplied && (
                                            <div className="text-[10px] text-teal-600 dark:text-teal-400 ml-5 mt-1 flex items-center gap-1">
                                              <Check className="h-3 w-3" />
                                              In simulation — will resolve when Trade Sheet is committed
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Ideas Section - Trade ideas without proposals */}
                        {filteredItems.ideas.length > 0 && (
                          <div>
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedGroups)
                                if (newCollapsed.has('category-ideas')) {
                                  newCollapsed.delete('category-ideas')
                                } else {
                                  newCollapsed.add('category-ideas')
                                }
                                setCollapsedGroups(newCollapsed)
                              }}
                              className="flex items-center gap-2 w-full text-left mb-2 group"
                            >
                              <ChevronDown className={clsx(
                                "h-3 w-3 text-gray-400 transition-transform",
                                collapsedGroups.has('category-ideas') && "-rotate-90"
                              )} />
                              <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Ideas</span>
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{filteredItems.ideas.length}</Badge>
                            </button>
                            {!collapsedGroups.has('category-ideas') && (
                              <div className="space-y-2">
                                {filteredItems.ideas.map((item) => (
                                  <div key={item.type === 'single' ? item.idea.id : item.pairTrade.id}>
                                    {renderTradeItem(item)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                )}
              </div>}

              {/* Simulation Workspace */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {/* Shared Simulation Banner */}
                {isSharedView && sharedSimData && (
                  <div className="px-4 pt-4">
                    <SharedSimulationBanner
                      sharedBy={sharedSimData.shared_by}
                      accessLevel={sharedSimData.access_level}
                      shareMode={sharedSimData.share_mode}
                      sharedAt={sharedSimData.shared_at}
                      message={sharedSimData.message}
                    />
                  </div>
                )}
                {/* Main Content Area */}
                <div className="flex-1 overflow-hidden px-4 pt-4 pb-2">
                  {(simulation || (isSharedView && sharedSimData)) ? (
                  <>
                  {/* View Content */}
                  <div className="h-full">
                    {impactView === 'simulation' ? (
                      /* Holdings Simulation Table + Suggestion Review Panel */
                      <div className="h-full flex flex-col gap-0">
                      {/* Pro-forma toolbar pill — shown only when there are pending
                          committed trades to fold. For paper/manual_eod portfolios
                          Phase 1 auto-completes on accept, so this is usually empty. */}
                      {pendingAcceptedTrades.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 text-[11px]">
                          <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                            {baselineMode === 'proforma' ? 'Pro-forma' : 'Actual'}
                          </span>
                          <span className="text-indigo-500 dark:text-indigo-400">
                            · {pendingAcceptedTrades.length} committed pending ({pendingAcceptedTrades.map(t => (t as any).asset?.symbol || '?').join(', ')})
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            {/* Segmented toggle: proforma vs actual */}
                            <div className="inline-flex rounded-md border border-indigo-200 dark:border-indigo-800 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setBaselineMode('proforma')}
                                className={clsx(
                                  'px-2 py-0.5 text-[11px] font-medium transition-colors',
                                  baselineMode === 'proforma'
                                    ? 'bg-indigo-600 text-white'
                                    : 'text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40',
                                )}
                              >
                                Pro-forma
                              </button>
                              <button
                                type="button"
                                onClick={() => setBaselineMode('actual')}
                                className={clsx(
                                  'px-2 py-0.5 text-[11px] font-medium transition-colors border-l border-indigo-200 dark:border-indigo-800',
                                  baselineMode === 'actual'
                                    ? 'bg-indigo-600 text-white'
                                    : 'text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40',
                                )}
                              >
                                Actual
                              </button>
                            </div>
                            <button
                              onClick={() => window.dispatchEvent(new CustomEvent('navigate-to-asset', {
                                detail: { id: 'trade-book', title: 'Trade Book', type: 'trade-book', data: { portfolioId: selectedPortfolioId } }
                              }))}
                              className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-100 transition-colors"
                            >
                              Trade Book →
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="flex-1 min-w-0 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
                        <HoldingsSimulationTable
                          rows={simulationRows.rows}
                          cashRow={simulationRows.cashRow}
                          tradedRows={simulationRows.tradedRows}
                          untradedRows={simulationRows.untradedRows}
                          newPositionRows={simulationRows.newPositionRows}
                          summary={simulationRows.summary}
                          portfolioTotalValue={effectiveTotalValue}
                          readOnly={tableReadOnly}
                          hasBenchmark={hasBenchmark}
                          priceMap={priceMap || {}}
                          pairInfoByAsset={pairInfoByAsset}
                          suggestMode={canSuggest || false}
                          onSubmitSuggestion={canSuggest ? submitSuggestion : undefined}
                          pendingSuggestionsByAsset={pendingSuggestionsByAsset}
                          pendingSuggestionCount={!isSharedView ? pendingSuggestionCount : undefined}
                          onOpenSuggestionReview={!isSharedView ? () => setSuggestionReviewOpen(true) : undefined}
                          onUpdateVariant={(variantId, updates) => {
                            // Temp variants: apply cache update for instant display, store
                            // pending sizing so it's used when the real variant arrives.
                            if (variantId.startsWith('temp-')) {
                              const tempAssetId = variantId.replace('temp-', '')
                              if (updates.sizingInput !== undefined) {
                                pendingSizingRef.current.set(tempAssetId, updates.sizingInput)
                              }
                              if (tradeLab?.id) {
                                // Cancel in-flight refetches so they don't overwrite our optimistic update
                                queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
                                queryClient.setQueryData<IntentVariant[]>(
                                  ['intent-variants', tradeLab.id, null],
                                  (old) => old?.map(v => v.id === variantId
                                    ? {
                                        ...v,
                                        ...(updates.sizingInput !== undefined ? {
                                          sizing_input: updates.sizingInput,
                                          sizing_spec: null,
                                          computed: null,
                                        } : {}),
                                        ...(updates.action !== undefined ? { action: updates.action } : {}),
                                      }
                                    : v
                                  ) ?? []
                                )
                              }
                              return
                            }
                            const variant = intentVariants.find(v => v.id === variantId)
                            const assetId = variant?.asset_id || ''
                            const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]
                            const holding = baselineHoldings.find(h => h.asset_id === assetId)
                            const currentPosition = holding ? {
                              shares: holding.shares,
                              weight: holding.weight,
                              cost_basis: null,
                              active_weight: null,
                            } : null
                            const assetPrice = {
                              asset_id: assetId,
                              price: priceMap?.[assetId] || holding?.price || 100,
                              timestamp: new Date().toISOString(),
                              source: 'realtime' as const,
                            }

                            // Optimistic: update variant in cache immediately so the row
                            // shows the new value before the server round-trip completes.
                            // This also prevents cleanupEmptyVariant from deleting a variant
                            // whose sizing_input was '' in the stale cache.
                            if (tradeLab?.id) {
                              // Cancel in-flight refetches so they don't overwrite our optimistic update
                              queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
                              queryClient.setQueryData<IntentVariant[]>(
                                ['intent-variants', tradeLab.id, null],
                                (old) => old?.map(v => v.id === variantId
                                  ? {
                                      ...v,
                                      ...(updates.sizingInput !== undefined ? {
                                        sizing_input: updates.sizingInput,
                                        sizing_spec: null,  // Clear stale spec so hook uses quick estimate
                                        computed: null,     // Clear stale computed so deltas recompute
                                      } : {}),
                                      ...(updates.action !== undefined ? { action: updates.action } : {}),
                                    }
                                  : v
                                ) ?? []
                              )
                            }

                            v3UpdateVariant({
                              variantId,
                              updates,
                              currentPosition,
                              price: assetPrice,
                              portfolioTotalValue: simulation.baseline_total_value || 0,
                              roundingConfig: { lot_size: 1, min_lot_behavior: 'round', round_direction: 'toward_zero' },
                              activeWeightConfig: getActiveWeightConfig(assetId),
                              hasBenchmark,
                            })

                            // If this variant has no matching simulation_trade (created via
                            // direct click on baseline position), create one so the dual-write
                            // invariant holds and the trade appears in the Trades tab.
                            if (updates.sizingInput && assetId && simulation?.simulation_trades) {
                              const hasTrade = simulation.simulation_trades.some(t => t.asset_id === assetId)
                              if (!hasTrade) {
                                supabase.from('simulation_trades')
                                  .upsert({
                                    simulation_id: simulation.id,
                                    asset_id: assetId,
                                    action: updates.action || variant?.action || 'add',
                                    price: priceMap?.[assetId] || holding?.price || 100,
                                    sort_order: simulation.simulation_trades.length,
                                  }, { onConflict: 'simulation_id,asset_id' })
                                  .select()
                                  .single()
                                  .then(({ error }) => {
                                    if (!error) queryClient.invalidateQueries({ queryKey: ['simulation', simulation.id] })
                                  })
                              }
                            }
                          }}
                          onRemoveAsset={handleRemoveAsset}
                          onDeleteVariant={(variantId) => {
                            // If deleting a temp variant from a direct edit (user escaped
                            // before server responded), track the cancellation so the
                            // follow-up effect can delete the real variant when it arrives.
                            if (variantId.startsWith('temp-')) {
                              const assetId = variantId.replace('temp-', '')
                              cancelledDirectEditsRef.current.add(assetId)
                              // Also clear any pending sizing for this asset
                              pendingSizingRef.current.delete(assetId)
                            }
                            v3DeleteVariant({ variantId })
                          }}
                          onCreateVariant={handleCreateVariantForHolding}
                          onSetCashTarget={!isSharedView ? handleSetCashTarget : undefined}
                          onClearAllTrades={!isSharedView ? handleClearAllTrades : undefined}
                          onFixConflict={(variantId, suggestedAction) => handleFixConflict(variantId, suggestedAction)}
                          onAddAsset={handleAddManualAsset}
                          assetSearchResults={phantomAssetResults ?? []}
                          onAssetSearchChange={setPhantomAssetSearch}
                          onCreateTradeSheet={!isSharedView ? () => {
                            setShowCreateSheetConfirm(true)
                          } : undefined}
                          canCreateTradeSheet={!isSharedView && simulation?.status === 'draft' && simulationRows.summary.tradedCount > 0 && !v3HasConflicts}
                          isCreatingTradeSheet={v3CreatingSheet}
                          // Execute is PM-only. Non-PM users (analysts,
                          // traders, viewers) can still build a simulation
                          // and save it as a snapshot to share with the
                          // PM — they just can't commit trades to the
                          // Trade Book themselves. Omitting the handler
                          // hides the Execute button in the table.
                          onBulkPromote={!isSharedView && selectedPortfolioId && isCurrentUserPM ? (variantIds, opts) => {
                            bulkExecuteM.mutate({
                              variantIds,
                              batchName: opts?.batchName ?? null,
                              batchDescription: opts?.batchDescription ?? null,
                              reasons: opts?.reasons,
                            })
                          } : undefined}
                          isBulkPromoting={bulkExecuteM.isPending}
                        />
                      </div>
                      {/* Suggestion Review Panel (owner-side) */}
                      {suggestionReviewOpen && !isSharedView && (
                        <SuggestionReviewPanel
                          suggestions={suggestions}
                          onAccept={handleAcceptSuggestion}
                          onReject={handleRejectSuggestion}
                          onClose={() => setSuggestionReviewOpen(false)}
                          baselineHoldings={simulation?.baseline_holdings as BaselineHolding[] | undefined}
                          priceMap={priceMap || {}}
                          portfolioTotalValue={effectiveTotalValue}
                          hasBenchmark={hasBenchmark}
                          isAccepting={isSuggestionAccepting}
                        />
                      )}
                      </div>
                    ) : metrics ? (
                      <div className="h-full overflow-y-auto space-y-3">
                        {impactView === 'impact' ? (
                          <PortfolioImpactView
                            metrics={metrics}
                            baseline={simulation.baseline_holdings as BaselineHolding[]}
                            simulationRows={simulationRows.rows}
                          />
                        ) : (
                          /* Trades View - Grouped by Action with Cash Impact */
                          <div className="space-y-6">
                            {tradesGroupedByAction && tradesGroupedByAction.groups.length > 0 ? (
                              <>
                                {/* Cash Impact Summary Cards */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                  {/* Total Trades Card */}
                                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Trades</span>
                                      <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                                        <List className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                      </div>
                                    </div>
                                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{tradeStats.total}</div>
                                    <div className="mt-2 flex items-center gap-2 text-xs">
                                      {tradeStats.buys > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
                                          <ArrowUpRight className="h-3 w-3" />{tradeStats.buys} buy{tradeStats.buys !== 1 ? 's' : ''}
                                        </span>
                                      )}
                                      {tradeStats.sells > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                                          <ArrowDownRight className="h-3 w-3" />{tradeStats.sells} sell{tradeStats.sells !== 1 ? 's' : ''}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Buy Value Card */}
                                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Buy Value</span>
                                      <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                                        <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-400" />
                                      </div>
                                    </div>
                                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                                      ${tradesGroupedByAction.totalBuyValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </div>
                                    {tradesGroupedByAction.totalPortfolioValue > 0 && (
                                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        {((tradesGroupedByAction.totalBuyValue / tradesGroupedByAction.totalPortfolioValue) * 100).toFixed(1)}% of portfolio
                                      </div>
                                    )}
                                  </div>

                                  {/* Sell Value Card */}
                                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sell Value</span>
                                      <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                                        <ArrowDownRight className="h-4 w-4 text-red-600 dark:text-red-400" />
                                      </div>
                                    </div>
                                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                                      ${tradesGroupedByAction.totalSellValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </div>
                                    {tradesGroupedByAction.totalPortfolioValue > 0 && (
                                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        {((tradesGroupedByAction.totalSellValue / tradesGroupedByAction.totalPortfolioValue) * 100).toFixed(1)}% of portfolio
                                      </div>
                                    )}
                                  </div>

                                  {/* Net Cash Flow Card */}
                                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Net Cash</span>
                                      <div className={clsx(
                                        "w-8 h-8 rounded-lg flex items-center justify-center",
                                        tradesGroupedByAction.netCashFlow >= 0
                                          ? "bg-green-50 dark:bg-green-900/20"
                                          : "bg-red-50 dark:bg-red-900/20"
                                      )}>
                                        <DollarSign className={clsx(
                                          "h-4 w-4",
                                          tradesGroupedByAction.netCashFlow >= 0
                                            ? "text-green-600 dark:text-green-400"
                                            : "text-red-600 dark:text-red-400"
                                        )} />
                                      </div>
                                    </div>
                                    <div className={clsx(
                                      "text-2xl font-bold",
                                      tradesGroupedByAction.netCashFlow >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                                    )}>
                                      {tradesGroupedByAction.netCashFlow >= 0 ? '+' : ''}${tradesGroupedByAction.netCashFlow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </div>
                                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                      {tradesGroupedByAction.netCashFlow >= 0 ? 'Cash generated' : 'Cash needed'}
                                    </div>
                                  </div>
                                </div>

                                {/* Trades Grouped by Action */}
                                <div className="space-y-4">
                                  {tradesGroupedByAction.groups.map(group => (
                                    <Card key={group.action} className="overflow-hidden">
                                      {/* Group Header */}
                                      <div className={clsx(
                                        "px-4 py-3 border-b",
                                        group.action === 'buy' || group.action === 'add'
                                          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                                          : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                                      )}>
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-3">
                                            <div className={clsx(
                                              "w-8 h-8 rounded-full flex items-center justify-center",
                                              group.action === 'buy' || group.action === 'add'
                                                ? "bg-green-100 dark:bg-green-900/40"
                                                : "bg-red-100 dark:bg-red-900/40"
                                            )}>
                                              {group.action === 'buy' || group.action === 'add' ? (
                                                <TrendingUp className={clsx(
                                                  "h-4 w-4",
                                                  group.action === 'buy' || group.action === 'add'
                                                    ? "text-green-600 dark:text-green-400"
                                                    : "text-red-600 dark:text-red-400"
                                                )} />
                                              ) : (
                                                <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                                              )}
                                            </div>
                                            <div>
                                              <h3 className="font-semibold text-gray-900 dark:text-white">
                                                {group.action === 'buy' ? 'Buys' : group.action === 'add' ? 'Adds' : group.action === 'sell' ? 'Sells' : 'Trims'}
                                              </h3>
                                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                                {group.count} trade{group.count !== 1 ? 's' : ''}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="text-right">
                                            <div className={clsx(
                                              "text-lg font-bold",
                                              group.action === 'buy' || group.action === 'add' ? "text-green-600" : "text-red-600"
                                            )}>
                                              ${group.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </div>
                                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                              {group.totalWeight.toFixed(1)}% weight
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Trades Table */}
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                          <thead>
                                            <tr className="border-b border-gray-100 dark:border-gray-700">
                                              <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Symbol</th>
                                              <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Company</th>
                                              <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Sector</th>
                                              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Current</th>
                                              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Trade Shares</th>
                                              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Price</th>
                                              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Value</th>
                                              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Weight</th>
                                              <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Cash Impact</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {group.trades.map(trade => (
                                              <tr key={trade.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                                                <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                                                  {trade.symbol}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 max-w-[180px] truncate">
                                                  {trade.company_name}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-500 dark:text-gray-500">
                                                  {trade.sector || '—'}
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-gray-500 dark:text-gray-400 font-mono text-xs">
                                                  {trade.currentHolding > 0 ? (
                                                    <span>{trade.currentHolding.toLocaleString()} ({trade.currentWeight.toFixed(1)}%)</span>
                                                  ) : (
                                                    <span className="text-gray-400">New</span>
                                                  )}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono text-gray-900 dark:text-white">
                                                  {trade.shares > 0 ? trade.shares.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono text-gray-600 dark:text-gray-400">
                                                  ${trade.price.toFixed(2)}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono font-medium text-gray-900 dark:text-white">
                                                  ${trade.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono text-gray-600 dark:text-gray-400">
                                                  {trade.weight.toFixed(2)}%
                                                </td>
                                                <td className={clsx(
                                                  "px-4 py-2.5 text-right font-mono font-medium",
                                                  trade.cashImpact > 0 ? "text-red-600" : "text-green-600"
                                                )}>
                                                  {trade.cashImpact > 0 ? '-' : '+'}${Math.abs(trade.cashImpact).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                          <tfoot className="bg-gray-50 dark:bg-gray-800/50">
                                            <tr>
                                              <td colSpan={6} className="px-4 py-2 font-medium text-gray-700 dark:text-gray-300">
                                                Subtotal
                                              </td>
                                              <td className="px-4 py-2 text-right font-mono font-bold text-gray-900 dark:text-white">
                                                ${group.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                              </td>
                                              <td className="px-4 py-2 text-right font-mono font-medium text-gray-700 dark:text-gray-300">
                                                {group.totalWeight.toFixed(2)}%
                                              </td>
                                              <td className={clsx(
                                                "px-4 py-2 text-right font-mono font-bold",
                                                group.totalCashImpact > 0 ? "text-red-600" : "text-green-600"
                                              )}>
                                                {group.totalCashImpact > 0 ? '-' : '+'}${Math.abs(group.totalCashImpact).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                              </td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                    </Card>
                                  ))}
                                </div>

                                {/* Net Cash Summary */}
                                <Card className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200 dark:border-blue-800">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                                        <DollarSign className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                      </div>
                                      <div>
                                        <h3 className="font-semibold text-gray-900 dark:text-white">Net Cash Impact</h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">
                                          {tradesGroupedByAction.netCashFlow >= 0
                                            ? 'These trades will generate cash for redeployment'
                                            : 'These trades require additional cash investment'}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className={clsx(
                                        "text-2xl font-bold",
                                        tradesGroupedByAction.netCashFlow >= 0 ? "text-green-600" : "text-red-600"
                                      )}>
                                        {tradesGroupedByAction.netCashFlow >= 0 ? '+' : ''}${tradesGroupedByAction.netCashFlow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                      </div>
                                      <div className="text-sm text-gray-500 dark:text-gray-400">
                                        {tradesGroupedByAction.totalPortfolioValue > 0 && (
                                          <span>
                                            {((Math.abs(tradesGroupedByAction.netCashFlow) / tradesGroupedByAction.totalPortfolioValue) * 100).toFixed(1)}% of portfolio
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </Card>
                              </>
                            ) : (
                              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
                                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                                  <List className="h-8 w-8 text-gray-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                  No Trades Yet
                                </h3>
                                <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                                  Add trades from the Ideas panel or use Quick Trade to see the trades view.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center">
                        <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-primary-50 dark:from-primary-900/30 dark:to-primary-900/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                          <Layers className="h-10 w-10 text-primary-600 dark:text-primary-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                          Add Trades to See Impact
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                          Switch to the Intent Board to add and size your trades.
                          Portfolio impact will appear here once trades are active.
                        </p>
                        <button
                          onClick={() => setImpactView('intent')}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
                        >
                          <Beaker className="h-4 w-4" />
                          Go to Intent Board
                        </button>
                      </div>
                    )}
                  </div>
                  </>
                  ) : (
                    /* Fallback - should not normally be reached */
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <RefreshCw className="h-8 w-8 text-gray-400 animate-spin mx-auto mb-4" />
                        <p className="text-gray-500">Preparing workbench...</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
          </>
        )}
      </div>

      {/* Add Trade Idea Modal */}
      <AddTradeIdeaModal
        isOpen={showAddTradeIdeaModal}
        onClose={() => setShowAddTradeIdeaModal(false)}
        onSuccess={() => {
          setShowAddTradeIdeaModal(false)
          refetchTradeIdeas()
        }}
      />

      {/* Proposal Editor Modal */}
      {proposalEditorIdea && selectedPortfolioId && (
        <RecommendationEditorModal
          isOpen={!!proposalEditorIdea}
          onClose={() => setProposalEditorIdea(null)}
          tradeIdea={proposalEditorIdea}
          baseline={(simulation?.baseline_holdings as BaselineHolding[])?.find(
            b => b.asset_id === proposalEditorIdea.asset_id
          )}
          currentHolding={metrics?.holdings_after?.find(
            h => h.asset_id === proposalEditorIdea.asset_id
          )}
          labId={tradeLab?.id || null}
          portfolioId={selectedPortfolioId}
          availablePortfolios={portfolios?.map(p => ({ id: p.id, name: p.name })) || []}
          initialSizingInput={intentVariants.find(v => v.asset_id === proposalEditorIdea.asset_id)?.sizing_input || ''}
          onSaved={(savedProposal) => {
            // Capture before clearing for optimistic cache update
            const tradeIdea = proposalEditorIdea
            setProposalEditorIdea(null)

            // Optimistically add to proposals cache for instant dedup
            // (prevents LRCX-in-both-sections flash during refetch)
            if (savedProposal && tradeIdea) {
              queryClient.setQueryData<any[]>(
                ['trade-lab-proposals', selectedPortfolioId],
                (old) => {
                  const enriched = {
                    ...savedProposal,
                    users: user ? { id: user.id, email: user.email, first_name: (user as any).first_name, last_name: (user as any).last_name } : null,
                    trade_queue_items: {
                      id: tradeIdea.id,
                      action: tradeIdea.action,
                      rationale: tradeIdea.rationale,
                      status: tradeIdea.status,
                      stage: tradeIdea.stage,
                      pair_id: tradeIdea.pair_id,
                      pair_leg_type: tradeIdea.pair_leg_type,
                      assets: tradeIdea.assets,
                    },
                  }
                  if (!old) return [enriched]
                  // Upsert: replace existing proposal for same trade item, or append
                  const idx = old.findIndex(p => p.trade_queue_item_id === savedProposal.trade_queue_item_id)
                  if (idx >= 0) {
                    const next = [...old]
                    next[idx] = enriched
                    return next
                  }
                  return [...old, enriched]
                }
              )
            }

            queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals', selectedPortfolioId] })
            queryClient.invalidateQueries({ queryKey: ['trade-queue-ideas', selectedPortfolioId] })
          }}
        />
      )}

      {/* Execute Trade Confirmation Modal */}
      {confirmExecuteIdea && (() => {
        const v = intentVariants.find(vr => vr.asset_id === confirmExecuteIdea.asset_id)
        const c = v?.computed
        return (
          <div className="fixed inset-0 z-50 overflow-y-auto" onClick={() => setConfirmExecuteIdea(null)}>
            <div className="fixed inset-0 bg-black/50" />
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-auto" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-1">Execute Trade</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-4">
                    This will commit the trade to Trade Book and remove it from the simulation.
                  </p>

                  {/* Trade preview */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={clsx(
                        'text-xs font-semibold uppercase px-1.5 py-0.5 rounded',
                        confirmExecuteIdea.action === 'buy' || confirmExecuteIdea.action === 'add'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      )}>
                        {confirmExecuteIdea.action}
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{confirmExecuteIdea.assets?.symbol}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{confirmExecuteIdea.assets?.company_name}</span>
                    </div>
                    {v?.sizing_input && c && (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        {c.target_weight != null && <>
                          <div className="text-gray-500 dark:text-gray-400">Target weight</div>
                          <div className="font-semibold text-gray-900 dark:text-white">{c.target_weight.toFixed(2)}%</div>
                        </>}
                        {c.notional_value != null && c.notional_value !== 0 && <>
                          <div className="text-gray-500 dark:text-gray-400">Notional</div>
                          <div className="font-medium text-gray-700 dark:text-gray-200">
                            {Math.abs(c.notional_value) >= 1_000_000 ? `$${(Math.abs(c.notional_value) / 1_000_000).toFixed(1)}M` : Math.abs(c.notional_value) >= 1_000 ? `$${(Math.abs(c.notional_value) / 1_000).toFixed(0)}K` : `$${Math.abs(c.notional_value).toFixed(0)}`}
                          </div>
                        </>}
                        {c.delta_shares != null && c.delta_shares !== 0 && <>
                          <div className="text-gray-500 dark:text-gray-400">Share change</div>
                          <div className={clsx('font-mono font-medium', c.delta_shares > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                            {c.delta_shares > 0 ? '+' : ''}{c.delta_shares.toLocaleString()}
                          </div>
                        </>}
                        <div className="text-gray-400 dark:text-gray-500">Input</div>
                        <div className="font-mono text-gray-400 dark:text-gray-500">{v.sizing_input}</div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => setConfirmExecuteIdea(null)} className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={() => { executeTradeM.mutate(confirmExecuteIdea); setConfirmExecuteIdea(null) }}
                      disabled={executeTradeM.isPending}
                      className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-colors disabled:opacity-50"
                    >
                      Execute Trade
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Request Recommendation Confirmation Modal */}
      {confirmRecommendIdea && (() => {
        const v = intentVariants.find(vr => vr.asset_id === confirmRecommendIdea.asset_id)
        const c = v?.computed
        return (
          <div className="fixed inset-0 z-50 overflow-y-auto" onClick={() => setConfirmRecommendIdea(null)}>
            <div className="fixed inset-0 bg-black/50" />
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-auto" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
                      <Scale className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-1">Request Recommendation</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-4">
                    This creates a PM proposal from the current simulation sizing and moves the idea into the decision workflow. It does not commit the trade.
                  </p>

                  {/* Trade preview */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={clsx(
                        'text-xs font-semibold uppercase px-1.5 py-0.5 rounded',
                        confirmRecommendIdea.action === 'buy' || confirmRecommendIdea.action === 'add'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      )}>
                        {confirmRecommendIdea.action}
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{confirmRecommendIdea.assets?.symbol}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{confirmRecommendIdea.assets?.company_name}</span>
                    </div>
                    {v?.sizing_input && c ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        {c.target_weight != null && <>
                          <div className="text-gray-500 dark:text-gray-400">Target weight</div>
                          <div className="font-semibold text-gray-900 dark:text-white">{c.target_weight.toFixed(2)}%</div>
                        </>}
                        {c.notional_value != null && c.notional_value !== 0 && <>
                          <div className="text-gray-500 dark:text-gray-400">Notional</div>
                          <div className="font-medium text-gray-700 dark:text-gray-200">
                            {Math.abs(c.notional_value) >= 1_000_000 ? `$${(Math.abs(c.notional_value) / 1_000_000).toFixed(1)}M` : Math.abs(c.notional_value) >= 1_000 ? `$${(Math.abs(c.notional_value) / 1_000).toFixed(0)}K` : `$${Math.abs(c.notional_value).toFixed(0)}`}
                          </div>
                        </>}
                        <div className="text-gray-400 dark:text-gray-500">Input</div>
                        <div className="font-mono text-gray-400 dark:text-gray-500">{v.sizing_input}</div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">No sizing entered — recommendation will use idea defaults</p>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => setConfirmRecommendIdea(null)} className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={() => { requestRecommendationM.mutate(confirmRecommendIdea); setConfirmRecommendIdea(null) }}
                      disabled={requestRecommendationM.isPending}
                      className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 shadow-sm transition-colors disabled:opacity-50"
                    >
                      Request Recommendation
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Trade Idea Detail Modal */}
      {selectedTradeId && (
        <TradeIdeaDetailModal
          isOpen={!!selectedTradeId}
          tradeId={selectedTradeId}
          initialTab={tradeModalInitialTab}
          onClose={() => {
            setSelectedTradeId(null)
            setTradeModalInitialTab('details') // Reset to default tab
          }}
          onNavigateToIdea={(ideaId) => {
            setSelectedTradeId(ideaId)
            setTradeModalInitialTab('details')
          }}
        />
      )}


      {/* Share Snapshot Modal */}
      {shareSnapshotSheet && simulation && (() => {
        const ShareSnapshotModal = () => {
          const [searchQuery, setSearchQuery] = React.useState('')
          const [selectedUsers, setSelectedUsers] = React.useState<string[]>([])
          const [shareMessage, setShareMessage] = React.useState('')
          const [isSending, setIsSending] = React.useState(false)

          const { data: teamMembers } = useQuery({
            queryKey: ['portfolio-team-members', selectedPortfolioId],
            queryFn: async () => {
              const { data } = await supabase
                .from('portfolio_team')
                .select('user_id, role, users:user_id(id, email, first_name, last_name)')
                .eq('portfolio_id', selectedPortfolioId)
                .neq('user_id', user?.id)
              return data || []
            },
            enabled: !!selectedPortfolioId && !!user?.id,
          })

          const filtered = teamMembers?.filter((m: any) => {
            if (!searchQuery) return true
            const u = m.users
            const q = searchQuery.toLowerCase()
            return u?.email?.toLowerCase().includes(q) || u?.first_name?.toLowerCase().includes(q) || u?.last_name?.toLowerCase().includes(q)
          }) || []

          const handleSend = async () => {
            if (selectedUsers.length === 0) return
            setIsSending(true)
            try {
              await shareTradeSheetSnapshot({
                tradeSheet: shareSnapshotSheet,
                simulationId: simulation.id,
                recipientIds: selectedUsers,
                message: shareMessage || undefined,
                actorId: user!.id,
              })
              toast.success(`Snapshot shared with ${selectedUsers.length} team member${selectedUsers.length !== 1 ? 's' : ''}`)
              setShareSnapshotSheet(null)
            } catch (err: any) {
              toast.error('Failed to share', err.message)
            } finally {
              setIsSending(false)
            }
          }

          const variants = (shareSnapshotSheet.variants_snapshot || []) as any[]

          return (
            <div className="fixed inset-0 z-50 overflow-y-auto" onClick={() => setShareSnapshotSheet(null)}>
              <div className="fixed inset-0 bg-black/50" />
              <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-auto" onClick={e => e.stopPropagation()}>
                  <div className="p-6">
                    <div className="flex items-center justify-center mb-4">
                      <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                        <Share2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-1">Share Snapshot</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-4">
                      {shareSnapshotSheet.name} · {variants.length} trade{variants.length !== 1 ? 's' : ''}
                    </p>

                    {/* Team member selector */}
                    <div className="mb-3">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search team members..."
                        className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto mb-3 space-y-1">
                      {filtered.map((m: any) => {
                        const u = m.users
                        const isSelected = selectedUsers.includes(u.id)
                        const name = u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email
                        return (
                          <button
                            key={u.id}
                            onClick={() => setSelectedUsers(prev => isSelected ? prev.filter(id => id !== u.id) : [...prev, u.id])}
                            className={clsx(
                              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                              isSelected ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                            )}
                          >
                            <span className={clsx(
                              'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                              isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300 dark:border-gray-600'
                            )}>
                              {isSelected && <Check className="w-2.5 h-2.5" />}
                            </span>
                            <span className="truncate">{name}</span>
                            <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{m.role}</span>
                          </button>
                        )
                      })}
                      {filtered.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-3">No team members found</p>
                      )}
                    </div>

                    {/* Optional message */}
                    <input
                      type="text"
                      value={shareMessage}
                      onChange={e => setShareMessage(e.target.value)}
                      placeholder="Add a message (optional)"
                      className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 mb-4"
                    />

                    <div className="flex gap-3">
                      <button onClick={() => setShareSnapshotSheet(null)} className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        Cancel
                      </button>
                      <button
                        onClick={handleSend}
                        disabled={selectedUsers.length === 0 || isSending}
                        className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 shadow-sm transition-colors disabled:opacity-50"
                      >
                        {isSending ? 'Sending...' : `Share${selectedUsers.length > 0 ? ` (${selectedUsers.length})` : ''}`}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        }
        return <ShareSnapshotModal />
      })()}

      {/* Load Snapshot Confirmation Modal */}
      {confirmLoadSnapshot && (() => {
        const variants = (confirmLoadSnapshot.variants_snapshot || []) as any[]
        const hasCurrentWork = simulationRows.summary.tradedCount > 0
        return (
          <div className="fixed inset-0 z-50 overflow-y-auto" onClick={() => setConfirmLoadSnapshot(null)}>
            <div className="fixed inset-0 bg-black/50" />
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-auto" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
                      <RotateCcw className="h-6 w-6 text-primary-600 dark:text-primary-400" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-1">Load into Trade Lab?</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-4">
                    {hasCurrentWork
                      ? `Your current simulation has ${simulationRows.summary.tradedCount} trade${simulationRows.summary.tradedCount !== 1 ? 's' : ''} that will be replaced.`
                      : 'This will load the snapshot into your active workspace.'}
                  </p>

                  {/* Snapshot being loaded */}
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 mb-4">
                    <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">{confirmLoadSnapshot.name}</div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span>{variants.length} trade{variants.length !== 1 ? 's' : ''}</span>
                      {confirmLoadSnapshot.total_notional != null && confirmLoadSnapshot.total_notional !== 0 && (
                        <span>${Math.abs(confirmLoadSnapshot.total_notional).toLocaleString()} notional</span>
                      )}
                      <span>{formatDistanceToNow(new Date(confirmLoadSnapshot.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center mb-4">
                    The snapshot itself will not be changed. No trades will be committed.
                  </p>

                  <div className="space-y-2">
                    {/* Save current work first, then load */}
                    {hasCurrentWork && (
                      <button
                        onClick={async () => {
                          const name = `Snapshot — ${format(new Date(), 'MMM d, yyyy HH:mm')}`
                          await handleSaveSnapshotAndKeep(name)
                          await handleLoadSnapshot(confirmLoadSnapshot)
                        }}
                        disabled={isLoadingSnapshot}
                        className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 shadow-sm transition-colors disabled:opacity-50 flex items-center justify-between"
                      >
                        <span>{isLoadingSnapshot ? 'Loading...' : 'Save Current & Load'}</span>
                        <span className="text-[10px] font-normal text-primary-200">Saves a snapshot first</span>
                      </button>
                    )}

                    {/* Load without saving — discard current work */}
                    <button
                      onClick={() => handleLoadSnapshot(confirmLoadSnapshot)}
                      disabled={isLoadingSnapshot}
                      className={clsx(
                        "w-full px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-between",
                        hasCurrentWork
                          ? "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          : "bg-primary-600 text-white hover:bg-primary-700 shadow-sm"
                      )}
                    >
                      <span>{isLoadingSnapshot ? 'Loading...' : hasCurrentWork ? 'Discard & Load' : 'Load Snapshot'}</span>
                      {hasCurrentWork && <span className="text-[10px] font-normal text-gray-400">Current work will be lost</span>}
                    </button>

                    {/* Cancel */}
                    <button
                      onClick={() => setConfirmLoadSnapshot(null)}
                      className="w-full px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Save Snapshot Modal — with optional sharing */}
      {showCreateSheetConfirm && simulation && (() => {
        const SaveSnapshotModal = () => {
          const [snapshotName, setSnapshotName] = React.useState('')
          const [shareWith, setShareWith] = React.useState<string[]>([])
          const [shareMessage, setShareMessage] = React.useState('')
          const [shareSearch, setShareSearch] = React.useState('')
          const [showShareSection, setShowShareSection] = React.useState(false)

          const { data: teamMembers } = useQuery({
            queryKey: ['portfolio-team-members', selectedPortfolioId],
            queryFn: async () => {
              const { data } = await supabase
                .from('portfolio_team')
                .select('user_id, role, users:user_id(id, email, first_name, last_name)')
                .eq('portfolio_id', selectedPortfolioId)
                .neq('user_id', user?.id)
              return data || []
            },
            enabled: !!selectedPortfolioId && !!user?.id && showShareSection,
          })

          const filteredMembers = teamMembers?.filter((m: any) => {
            if (!shareSearch) return true
            const u = m.users
            const q = shareSearch.toLowerCase()
            return u?.email?.toLowerCase().includes(q) || u?.first_name?.toLowerCase().includes(q) || u?.last_name?.toLowerCase().includes(q)
          }) || []

          const handleSave = async (clearAfter: boolean) => {
            const name = snapshotName.trim() || `Snapshot — ${format(new Date(), 'MMM d, yyyy HH:mm')}`
            setShowCreateSheetConfirm(false)

            if (clearAfter) {
              await handleSaveSnapshotAndClear(name)
            } else {
              await handleSaveSnapshotAndKeep(name)
            }

            // Share if recipients selected
            if (shareWith.length > 0 && simulation) {
              try {
                // Get the just-created sheet to share it
                const { data: sheets } = await supabase
                  .from('trade_sheets')
                  .select('id, name, description, portfolio_id, variants_snapshot, total_notional')
                  .eq('name', name)
                  .order('created_at', { ascending: false })
                  .limit(1)
                if (sheets?.[0]) {
                  await shareTradeSheetSnapshot({
                    tradeSheet: sheets[0],
                    simulationId: simulation.id,
                    recipientIds: shareWith,
                    message: shareMessage || undefined,
                    actorId: user!.id,
                  })
                  toast.success(`Shared with ${shareWith.length} team member${shareWith.length !== 1 ? 's' : ''}`)
                }
              } catch (err: any) {
                toast.error('Saved but sharing failed', err.message)
              }
            }
          }

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowCreateSheetConfirm(false)}>
              <div className="fixed inset-0 bg-black/50" />
              <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-1">Save Snapshot</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-4">
                    {simulationRows.summary.tradedCount} trade{simulationRows.summary.tradedCount !== 1 ? 's' : ''} · Does not commit trades
                  </p>

                  {/* Snapshot name */}
                  <input
                    type="text"
                    value={snapshotName}
                    onChange={e => setSnapshotName(e.target.value)}
                    placeholder="Name this snapshot (optional)"
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 mb-4"
                    autoFocus
                  />

                  {/* Share toggle */}
                  {!showShareSection ? (
                    <button
                      onClick={() => setShowShareSection(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 mb-4"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Share with team members
                    </button>
                  ) : (
                    <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Share with</span>
                        <button onClick={() => { setShowShareSection(false); setShareWith([]) }} className="text-xs text-gray-400 hover:text-gray-600">Remove</button>
                      </div>
                      <input
                        type="text"
                        value={shareSearch}
                        onChange={e => setShareSearch(e.target.value)}
                        placeholder="Search team..."
                        className="w-full text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 mb-2"
                      />
                      <div className="max-h-28 overflow-y-auto space-y-0.5">
                        {filteredMembers.map((m: any) => {
                          const u = m.users
                          const isSelected = shareWith.includes(u.id)
                          const name = u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.email
                          return (
                            <button
                              key={u.id}
                              onClick={() => setShareWith(prev => isSelected ? prev.filter(id => id !== u.id) : [...prev, u.id])}
                              className={clsx(
                                'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors',
                                isSelected ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                              )}
                            >
                              <span className={clsx('w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0', isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300 dark:border-gray-600')}>
                                {isSelected && <Check className="w-2 h-2" />}
                              </span>
                              <span className="truncate">{name}</span>
                            </button>
                          )
                        })}
                      </div>
                      {shareWith.length > 0 && (
                        <input
                          type="text"
                          value={shareMessage}
                          onChange={e => setShareMessage(e.target.value)}
                          placeholder="Add a message (optional)"
                          className="w-full text-xs px-2 py-1.5 mt-2 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-2">
                    <button
                      onClick={() => handleSave(false)}
                      disabled={v3CreatingSheet}
                      className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 shadow-sm transition-colors disabled:opacity-50 flex items-center justify-between"
                    >
                      <span>{v3CreatingSheet ? 'Saving...' : shareWith.length > 0 ? 'Save & Share' : 'Save Snapshot'}</span>
                      <span className="text-[10px] font-normal text-primary-200">Continue working</span>
                    </button>
                    <button
                      onClick={() => handleSave(true)}
                      disabled={v3CreatingSheet}
                      className="w-full px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center justify-between"
                    >
                      <span>{v3CreatingSheet ? 'Saving...' : shareWith.length > 0 ? 'Save, Share & Clear' : 'Save & Clear'}</span>
                      <span className="text-[10px] font-normal text-gray-400 dark:text-gray-500">Resets workspace</span>
                    </button>
                    <button
                      onClick={() => setShowCreateSheetConfirm(false)}
                      className="w-full px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        }
        return <SaveSnapshotModal />
      })()}
    </div>
  )
}

// Helper function to calculate simulation metrics
/** Minimal variant shape needed for metrics computation */
type MetricsVariant = Pick<IntentVariant, 'asset_id' | 'sizing_input' | 'computed' | 'action'> & {
  asset?: { symbol: string; company_name: string; sector: string | null }
}

function calculateSimulationMetrics(
  baselineHoldings: BaselineHolding[],
  trades: SimulationTradeWithDetails[],
  priceMap: Record<string, number>,
  variants?: MetricsVariant[]
): SimulationMetrics {
  const holdingsMap = new Map<string, SimulatedHolding>()

  // Build variant lookup: asset_id → variant (only variants with computed values)
  const variantByAsset = new Map<string, MetricsVariant>()
  if (variants) {
    for (const v of variants) {
      if (v.sizing_input && v.computed) {
        variantByAsset.set(v.asset_id, v)
      }
    }
  }

  let totalValueBefore = 0
  baselineHoldings.forEach(h => {
    const currentPrice = priceMap[h.asset_id] || h.price
    const value = h.shares * currentPrice
    totalValueBefore += value

    holdingsMap.set(h.asset_id, {
      asset_id: h.asset_id,
      symbol: h.symbol,
      company_name: h.company_name,
      sector: h.sector,
      shares: h.shares,
      price: currentPrice,
      value,
      weight: 0,
      change_from_baseline: 0,
      is_new: false,
      is_removed: false,
      is_short: false,
    })
  })

  holdingsMap.forEach(h => {
    h.weight = totalValueBefore > 0 ? (h.value / totalValueBefore) * 100 : 0
  })

  let positionsAdded = 0
  let positionsRemoved = 0
  let positionsAdjusted = 0

  // Track which positions have been affected by trades
  const tradedAssetIds = new Set<string>()

  // Collect asset IDs from both trades and variants so we process every traded asset
  const allTradedAssetIds = new Set<string>()
  trades.forEach(t => allTradedAssetIds.add(t.asset_id))
  variantByAsset.forEach((_, assetId) => allTradedAssetIds.add(assetId))

  allTradedAssetIds.forEach(assetId => {
    const trade = trades.find(t => t.asset_id === assetId)
    const variant = variantByAsset.get(assetId)
    const existing = holdingsMap.get(assetId)
    const price = priceMap[assetId] || trade?.price || 100

    // Determine the action: prefer variant's derived action, then trade's action
    const action = trade?.action || variant?.action || 'add'

    // Determine shares delta from variant computed values (authoritative) or trade fields
    let deltaShares: number | null = null
    if (variant?.computed) {
      deltaShares = variant.computed.delta_shares
    } else if (trade) {
      // Fallback to simulation_trade fields (legacy path)
      if (action === 'buy' || action === 'add') {
        deltaShares = trade.shares || (trade.weight ? (trade.weight / 100 * totalValueBefore) / price : 0)
      } else if (action === 'sell') {
        const sellShares = trade.shares || (trade.weight ? (trade.weight / 100 * totalValueBefore) / price : 0)
        deltaShares = sellShares > 0 ? -sellShares : 0
      } else if (action === 'trim') {
        const sellShares = trade.shares || (existing ? existing.shares * 0.5 : 0)
        deltaShares = sellShares > 0 ? -sellShares : 0
      }
    }

    // Skip if no computable impact
    if (deltaShares == null || deltaShares === 0) return
    tradedAssetIds.add(assetId)

    if (existing) {
      existing.shares += deltaShares
      existing.value = existing.shares * existing.price

      if (existing.shares <= 0 && deltaShares < 0) {
        if (existing.shares === 0) {
          existing.is_removed = true
          existing.is_short = false
          positionsRemoved++
        } else {
          existing.is_short = true
          existing.is_removed = false
          positionsAdjusted++
        }
      } else {
        existing.is_short = false
        positionsAdjusted++
      }
    } else if (deltaShares > 0) {
      // New position (buy into something not in baseline)
      const assetData = variant?.asset || trade?.assets
      holdingsMap.set(assetId, {
        asset_id: assetId,
        symbol: assetData?.symbol || '',
        company_name: assetData?.company_name || '',
        sector: assetData?.sector || null,
        shares: deltaShares,
        price,
        value: deltaShares * price,
        weight: 0,
        change_from_baseline: 0,
        is_new: true,
        is_removed: false,
        is_short: false,
      })
      positionsAdded++
    } else {
      // Selling without owning = short position
      const assetData = variant?.asset || trade?.assets
      holdingsMap.set(assetId, {
        asset_id: assetId,
        symbol: assetData?.symbol || '',
        company_name: assetData?.company_name || '',
        sector: assetData?.sector || null,
        shares: deltaShares,
        price,
        value: deltaShares * price,
        weight: 0,
        change_from_baseline: 0,
        is_new: true,
        is_removed: false,
        is_short: true,
      })
      positionsAdded++
    }
  })

  // Calculate total portfolio value (use absolute values for proper weighting)
  // Long positions add value, short positions are liabilities (negative value)
  let totalLongValue = 0
  let totalShortValue = 0
  holdingsMap.forEach(h => {
    if (h.shares >= 0) {
      totalLongValue += h.value
    } else {
      totalShortValue += Math.abs(h.value) // Short value as positive for weighting
    }
  })
  // Net portfolio value = longs - shorts (shorts reduce portfolio value)
  const totalValueAfter = totalLongValue - totalShortValue
  // For weight calculation, use gross exposure (longs + shorts)
  const grossExposure = totalLongValue + totalShortValue

  holdingsMap.forEach(h => {
    // Weight is value / gross exposure, negative for shorts
    const newWeight = grossExposure > 0 ? (h.value / grossExposure) * 100 : 0
    h.weight = newWeight

    // Only show change_from_baseline for positions affected by trades
    // This avoids showing "changes" due to market price movements
    if (tradedAssetIds.has(h.asset_id) || h.is_new || h.is_removed) {
      const baseline = baselineHoldings.find(b => b.asset_id === h.asset_id)
      const baselineWeight = baseline?.weight || 0
      h.change_from_baseline = newWeight - baselineWeight
    } else {
      h.change_from_baseline = 0
    }
  })

  const sectorExposureBefore: Record<string, number> = {}
  const sectorExposureAfter: Record<string, number> = {}

  baselineHoldings.forEach(h => {
    const sector = h.sector || 'Other'
    sectorExposureBefore[sector] = (sectorExposureBefore[sector] || 0) + h.weight
  })

  holdingsMap.forEach(h => {
    if (!h.is_removed && h.shares !== 0) {
      const sector = h.sector || 'Other'
      // Short positions contribute negative exposure
      sectorExposureAfter[sector] = (sectorExposureAfter[sector] || 0) + h.weight
    }
  })

  const sectorChanges: Record<string, number> = {}
  const allSectors = new Set([...Object.keys(sectorExposureBefore), ...Object.keys(sectorExposureAfter)])

  // Only show sector changes if there are actual trades
  // This avoids showing "changes" due to market price movements
  if (tradedAssetIds.size > 0) {
    allSectors.forEach(sector => {
      sectorChanges[sector] = (sectorExposureAfter[sector] || 0) - (sectorExposureBefore[sector] || 0)
    })
  } else {
    // No trades = no sector changes
    allSectors.forEach(sector => {
      sectorChanges[sector] = 0
    })
  }

  const sortedBefore = [...baselineHoldings].sort((a, b) => b.weight - a.weight)

  // For concentration metrics, only count active long positions
  const activeHoldings = [...holdingsMap.values()]
    .filter(h => !h.is_removed && h.shares > 0)
    .sort((a, b) => b.weight - a.weight)

  // Short positions for display
  const shortPositions = [...holdingsMap.values()]
    .filter(h => h.is_short && h.shares < 0)
    .sort((a, b) => a.weight - b.weight) // Most negative first

  // For display, include all holdings (longs, shorts, and removed)
  const allHoldings = [...holdingsMap.values()]
    .sort((a, b) => {
      // Sort: active longs first (by weight desc), then shorts (by weight asc), then removed
      if (a.is_removed && !b.is_removed) return 1
      if (!a.is_removed && b.is_removed) return -1
      if (a.is_short && !b.is_short) return 1
      if (!a.is_short && b.is_short) return -1
      if (a.is_short && b.is_short) return a.weight - b.weight // Most negative first for shorts
      return b.weight - a.weight // Highest weight first for longs
    })

  const top5Before = sortedBefore.slice(0, 5).reduce((sum, h) => sum + h.weight, 0)
  const top10Before = sortedBefore.slice(0, 10).reduce((sum, h) => sum + h.weight, 0)
  const hhiBefore = baselineHoldings.reduce((sum, h) => sum + Math.pow(h.weight / 100, 2), 0)

  // Only show different "after" values if there are actual trades
  // This avoids showing "changes" due to market price movements
  let top5After: number
  let top10After: number
  let hhiAfter: number

  if (tradedAssetIds.size > 0) {
    top5After = activeHoldings.slice(0, 5).reduce((sum, h) => sum + h.weight, 0)
    top10After = activeHoldings.slice(0, 10).reduce((sum, h) => sum + h.weight, 0)
    hhiAfter = activeHoldings.reduce((sum, h) => sum + Math.pow(h.weight / 100, 2), 0)
  } else {
    // No trades = use baseline values (no changes)
    top5After = top5Before
    top10After = top10Before
    hhiAfter = hhiBefore
  }

  return {
    total_value_before: totalValueBefore,
    total_value_after: totalValueAfter,
    value_change: totalValueAfter - totalValueBefore,
    value_change_pct: totalValueBefore > 0 ? ((totalValueAfter - totalValueBefore) / totalValueBefore) * 100 : 0,
    positions_added: positionsAdded,
    positions_removed: positionsRemoved,
    positions_adjusted: positionsAdjusted,
    sector_exposure_before: sectorExposureBefore,
    // When no trades, use baseline values to avoid showing price-drift as "changes"
    sector_exposure_after: tradedAssetIds.size > 0 ? sectorExposureAfter : sectorExposureBefore,
    sector_changes: sectorChanges,
    top_5_concentration_before: top5Before,
    top_5_concentration_after: top5After,
    top_10_concentration_before: top10Before,
    top_10_concentration_after: top10After,
    herfindahl_index_before: hhiBefore,
    herfindahl_index_after: hhiAfter,
    position_count_before: baselineHoldings.length,
    position_count_after: activeHoldings.length,
    avg_position_size_before: baselineHoldings.length > 0 ? 100 / baselineHoldings.length : 0,
    avg_position_size_after: activeHoldings.length > 0 ? 100 / activeHoldings.length : 0,
    holdings_after: allHoldings,
  }
}
