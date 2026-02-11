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
  Share2
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
import { ProposalEditorModal } from '../components/trading/ProposalEditorModal'
import { TradeIdeaDetailModal } from '../components/trading/TradeIdeaDetailModal'
import { ShareSimulationModal } from '../components/trading/ShareSimulationModal'
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
import { useTradePlans as useTradeLists, usePlanStats as useListStats, useWorkbench } from '../hooks/useTradeLab'
import type { TradePlanWithDetails as TradeListWithDetails } from '../lib/services/trade-plan-service'
import { upsertProposal, requestAnalystInput } from '../lib/services/trade-lab-service'
import { moveTradeIdea } from '../lib/services/trade-idea-service'
import { parseSizingInput, toSizingSpec, type SizingSpec } from '../lib/trade-lab/sizing-parser'
import { detectDirectionConflict } from '../lib/trade-lab/normalize-sizing'
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
import { useSharedSimulation } from '../hooks/useSimulationShare'
import { useSimulationSuggestions } from '../hooks/useSimulationSuggestions'
import { SuggestionReviewPanel } from '../components/trading/SuggestionReviewPanel'
import type { SimulationShareAccess, SimulationShareMode, SharedSimulationListItem } from '../hooks/useSimulationShare'
import type { SizingValidationError, AssetPrice, IntentVariant } from '../types/trading'

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
      }
    }
  }
  return {
    selectedSimulationId: propSimulationId || null,
    showIdeasPanel: true,
    impactView: 'simulation' as const,
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

  // New: Portfolio-first workflow state
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(initialPortfolioId || null)
  const [selectedViewType, setSelectedViewType] = useState<'private' | 'shared' | 'lists'>('private')
  const [portfolioDropdownOpen, setPortfolioDropdownOpen] = useState(false)
  const [portfolioSearchQuery, setPortfolioSearchQuery] = useState('')
  const portfolioDropdownRef = useRef<HTMLDivElement>(null)
  const portfolioSearchInputRef = useRef<HTMLInputElement>(null)

  // New simulation form state
  const [newSimName, setNewSimName] = useState('')
  const [newSimPortfolioId, setNewSimPortfolioId] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showAddTradeIdeaModal, setShowAddTradeIdeaModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showCreateSheetConfirm, setShowCreateSheetConfirm] = useState(false)
  const [proposalEditorIdea, setProposalEditorIdea] = useState<TradeQueueItemWithDetails | null>(null)
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [tradeModalInitialTab, setTradeModalInitialTab] = useState<'details' | 'discussion' | 'proposals' | 'activity'>('details')
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
  const [leftPaneStageFilter, setLeftPaneStageFilter] = useState<'all' | 'idea' | 'working_on' | 'modeling' | 'deciding'>('all')

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
      })
    }
  }, [tabId, selectedSimulationId, showIdeasPanel, impactView])

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

  // Fetch portfolios for filter
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, portfolio_id')
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
      // Only show active ideas (not in trash or archive)
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
        .in('status', ['idea', 'discussing', 'simulating', 'deciding'])
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

  // Fetch trade lists for the selected portfolio
  const { plans: lists, isLoading: listsLoading } = useTradeLists({
    portfolioId: selectedPortfolioId || undefined,
  })

  // Fetch list statistics
  const { data: listStats } = useListStats(selectedPortfolioId || undefined)

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

  // Handler for creating trade sheet + clearing simulation
  const handleCreateTradeSheet = async (name: string, description?: string) => {
    await v3CreateTradeSheet({ name, description })

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

  // PM decision mutation for proposals (Accept/Reject/Defer)
  const proposalDecisionMutation = useMutation({
    mutationFn: async ({
      proposalId,
      decision,
      reason
    }: {
      proposalId: string
      decision: 'accept' | 'reject' | 'defer'
      reason?: string
    }) => {
      const { data: proposal, error: fetchError } = await supabase
        .from('trade_proposals')
        .select('id, trade_queue_item_id, portfolio_id, weight, shares, user_id')
        .eq('id', proposalId)
        .single()

      if (fetchError || !proposal) throw fetchError || new Error('Proposal not found')

      if (decision === 'accept') {
        const { error: trackError } = await supabase
          .from('trade_idea_portfolios')
          .upsert({
            trade_queue_item_id: proposal.trade_queue_item_id,
            portfolio_id: proposal.portfolio_id,
            decision_outcome: 'accepted',
            decision_reason: reason || null,
            accepted_weight: proposal.weight,
            accepted_shares: proposal.shares,
            decided_by: user?.id,
            decided_at: new Date().toISOString(),
          }, { onConflict: 'trade_queue_item_id,portfolio_id' })
        if (trackError) throw trackError

        // Check if all portfolio tracks are decided
        const { data: allTracks } = await supabase
          .from('trade_idea_portfolios')
          .select('decision_outcome')
          .eq('trade_queue_item_id', proposal.trade_queue_item_id)

        const allDecided = allTracks?.every(t => t.decision_outcome !== null)
        const anyAccepted = allTracks?.some(t => t.decision_outcome === 'accepted')
        if (allDecided) {
          const newStatus = anyAccepted ? 'approved' : 'rejected'
          await supabase
            .from('trade_queue_items')
            .update({ status: newStatus, stage: newStatus, outcome: newStatus })
            .eq('id', proposal.trade_queue_item_id)
        }
      } else if (decision === 'reject') {
        const { error: trackError } = await supabase
          .from('trade_idea_portfolios')
          .upsert({
            trade_queue_item_id: proposal.trade_queue_item_id,
            portfolio_id: proposal.portfolio_id,
            decision_outcome: 'rejected',
            decision_reason: reason || null,
            decided_by: user?.id,
            decided_at: new Date().toISOString(),
          }, { onConflict: 'trade_queue_item_id,portfolio_id' })
        if (trackError) throw trackError

        // Deactivate the proposal
        await supabase
          .from('trade_proposals')
          .update({ is_active: false })
          .eq('id', proposalId)
      } else if (decision === 'defer') {
        const { error: trackError } = await supabase
          .from('trade_idea_portfolios')
          .upsert({
            trade_queue_item_id: proposal.trade_queue_item_id,
            portfolio_id: proposal.portfolio_id,
            decision_outcome: 'deferred',
            decision_reason: reason || null,
            decided_by: user?.id,
            decided_at: new Date().toISOString(),
          }, { onConflict: 'trade_queue_item_id,portfolio_id' })
        if (trackError) throw trackError
      }

      return { proposalId, decision }
    },
    onSuccess: (_data, { proposalId, decision }) => {
      // Optimistically remove rejected proposals from cache for instant dedup
      if (decision === 'reject') {
        queryClient.setQueryData<any[]>(
          ['trade-lab-proposals', selectedPortfolioId],
          (old) => old?.filter(p => p.id !== proposalId) ?? []
        )
      }
      queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals', selectedPortfolioId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-ideas', selectedPortfolioId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      showToast({
        type: 'success',
        title: decision === 'accept' ? 'Proposal accepted' : decision === 'reject' ? 'Proposal rejected' : 'Proposal deferred',
      })
    },
  })

  // Fast-track mutation: PM creates pm_initiated proposal + requests analyst input + moves to deciding
  const fastTrackMutation = useMutation({
    mutationFn: async (idea: TradeQueueItemWithDetails) => {
      if (!user?.id || !selectedPortfolioId) throw new Error('Missing user or portfolio')

      const actionContext = {
        actorId: user.id,
        actorName: user.email || 'Unknown',
        actorEmail: user.email,
        actorRole: 'pm' as const,
        requestId: crypto.randomUUID(),
      }

      // Get current variant sizing if the idea is checked
      const variant = intentVariants.find(v => v.asset_id === idea.asset_id)

      // Create PM-initiated proposal
      const proposal = await upsertProposal({
        trade_queue_item_id: idea.id,
        portfolio_id: selectedPortfolioId,
        lab_id: tradeLab?.id || null,
        weight: variant?.computed?.target_weight ?? null,
        shares: variant?.computed?.target_shares ?? null,
        sizing_mode: variant?.sizing_spec?.framework as any ?? null,
        sizing_context: variant?.sizing_input ? { input_value: variant.sizing_input } : {},
        proposal_type: 'pm_initiated',
      }, actionContext)

      // Request analyst input
      await requestAnalystInput(proposal.id, actionContext)

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
      // Optimistically add to proposals cache for instant dedup
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
      showToast({ type: 'success', title: 'Fast-tracked — awaiting analyst sizing' })
    },
    onError: (err: any) => {
      showToast({ type: 'error', title: 'Fast-track failed', description: err.message })
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

      // Fetch prices in parallel
      const fetchPromises = Array.from(symbolsToFetch.entries()).map(async ([assetId, symbol]) => {
        try {
          const quote = await financialDataService.getQuote(symbol)
          if (quote?.price) {
            return { assetId, price: quote.price }
          }
        } catch {
          // Fallback to baseline price
        }
        const baseline = baselineHoldings.find(h => h.asset_id === assetId)
        return { assetId, price: baseline?.price || 100 }
      })

      const results = await Promise.all(fetchPromises)
      results.forEach(r => {
        prices[r.assetId] = r.price
      })

      return prices
    },
    enabled: !!simulation,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: 60000, // Refetch every minute for updated prices
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

  // Effective data: switch between real data and shared snapshot data
  const effectiveBaselineHoldings = useMemo(() => {
    if (isSharedView && sharedSimData?.share_mode === 'snapshot' && sharedSimData.baseline_holdings) {
      return sharedSimData.baseline_holdings as BaselineHolding[]
    }
    return simulation?.baseline_holdings as BaselineHolding[] || []
  }, [isSharedView, sharedSimData, simulation])

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
    return simulation?.baseline_total_value || 0
  }, [isSharedView, sharedSimData, simulation])

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

  // Merge baseline + variants into simulation rows for the table
  const simulationRows = useSimulationRows({
    baselineHoldings: effectiveBaselineHoldings,
    variants: effectiveVariants,
    priceMap: priceMap || {},
    benchmarkWeightMap: benchmarkWeightMap || {},
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
        // Invalidate AFTER in-flight flag is cleared so the convergence effect
        // sees both the fresh trade AND the cleared flag in the same render.
        // (React Query v5 fires onSettled before async onSuccess completes,
        // so placing this in onSettled caused a race: the refetch would trigger
        // the convergence effect while variant creation was still pending.)
        queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
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
  }, [tradeLab?.id, queryClient, importTradeMutation])

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
      queryClient.invalidateQueries({ queryKey: ['trade-plans'] })
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
      // Prefer per-portfolio stage from trade_idea_portfolios over parent stage
      const portfolioTrack = (idea as any).trade_idea_portfolios?.find(
        (t: any) => t.portfolio_id === selectedPortfolioId
      )
      const effectiveStage = portfolioTrack?.stage || idea.stage || idea.status

      // Checkbox override takes precedence for instant feedback
      if (checkboxOverrides.has(idea.asset_id)) {
        return { ...idea, effectiveStage, isIncluded: includedIdeaIds?.has(idea.id) || false, isAdded: checkboxOverrides.get(idea.asset_id)! }
      }
      return {
        ...idea,
        effectiveStage,
        isIncluded: includedIdeaIds?.has(idea.id) || false,
        isAdded: expressedAssetIds.has(idea.asset_id)
          && !proposalAddedAssetIds.has(idea.asset_id),
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
        if (!idea.isAdded) entry.allAdded = false
        if (idea.isAdded) entry.someAdded = true
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
        if (!idea.isAdded) entry.allAdded = false
        if (idea.isAdded) entry.someAdded = true
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

    // Build set of trade_queue_item_ids that have active proposals for this portfolio
    const proposalTradeItemIds = new Set<string>()
    const seenPairTradeProposals = new Set<string>()

    activeProposals?.forEach(proposal => {
      if (proposal.trade_queue_item_id) {
        proposalTradeItemIds.add(proposal.trade_queue_item_id)
      }

      const sizingContext = proposal.sizing_context as any
      const isPairTrade = sizingContext?.isPairTrade === true
      const pairTradeId = sizingContext?.pairTradeId

      // For pair trade proposals, mark ALL leg IDs as having a proposal
      // (the proposal is linked to one trade_queue_item_id but covers all legs)
      if (isPairTrade && sizingContext?.legs?.length) {
        sizingContext.legs.forEach((leg: any) => {
          if (leg.legId) proposalTradeItemIds.add(leg.legId)
        })
      }

      // For pair trades, only add one proposal entry per pairTradeId
      if (isPairTrade && pairTradeId) {
        if (seenPairTradeProposals.has(pairTradeId)) return
        seenPairTradeProposals.add(pairTradeId)
      }

      groups.proposals.push({
        type: 'proposal',
        proposal,
        isPairTrade,
        legs: sizingContext?.legs || []
      })
    })

    // Ideas: only include items WITHOUT a proposal for this portfolio
    pairTradesGrouped.standalone.forEach(idea => {
      if (!proposalTradeItemIds.has(idea.id)) {
        groups.ideas.push({ type: 'single', idea })
      }
    })

    // Pair trades: exclude if a proposal covers this pair trade (by pairTradeId)
    // or if ALL legs have individual proposals
    pairTradesGrouped.pairTrades.forEach((entry, pairId) => {
      if (seenPairTradeProposals.has(pairId)) return // entire pair covered by a proposal
      const hasUnproposedLeg = entry.legs.some(leg => !proposalTradeItemIds.has(leg.id))
      if (hasUnproposedLeg) {
        groups.ideas.push({ type: 'pair', ...entry })
      }
    })

    return groups
  }, [pairTradesGrouped, activeProposals])

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

    const matchesStage = (item: TradeItem): boolean => {
      if (leftPaneStageFilter === 'all') return true
      if (item.type === 'single') {
        const stage = item.idea.effectiveStage || item.idea.stage || item.idea.status
        if (leftPaneStageFilter === 'idea') return stage === 'idea'
        if (leftPaneStageFilter === 'working_on') return stage === 'working_on' || stage === 'discussing'
        if (leftPaneStageFilter === 'modeling') return stage === 'modeling' || stage === 'simulating'
        if (leftPaneStageFilter === 'deciding') return stage === 'deciding'
      } else {
        // For pair trades, use the most-advanced leg's effectiveStage
        const legStages = item.legs.map(l => (l as any).effectiveStage || l.stage || l.status)
        const stageMatches = (s: string) => {
          if (leftPaneStageFilter === 'idea') return s === 'idea'
          if (leftPaneStageFilter === 'working_on') return s === 'working_on' || s === 'discussing'
          if (leftPaneStageFilter === 'modeling') return s === 'modeling' || s === 'simulating'
          if (leftPaneStageFilter === 'deciding') return s === 'deciding'
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
      if (s === 'deciding') return 0
      if (s === 'modeling' || s === 'simulating') return 1
      if (s === 'working_on' || s === 'discussing') return 2
      return 3 // idea
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

    // Stage-based left border color (prefer per-portfolio stage)
    const stageOfIdea = idea.effectiveStage || idea.stage || idea.status
    const stageBorderClass =
      (stageOfIdea === 'deciding') ? 'border-l-amber-500 dark:border-l-amber-400' :
      (stageOfIdea === 'modeling' || stageOfIdea === 'simulating') ? 'border-l-indigo-500 dark:border-l-indigo-400' :
      (stageOfIdea === 'working_on' || stageOfIdea === 'discussing') ? 'border-l-purple-500 dark:border-l-purple-400' :
      'border-l-blue-400 dark:border-l-blue-500'

    return (
      <div
        key={idea.id}
        onClick={() => setSelectedTradeId(idea.id)}
        className={clsx(
          "bg-white dark:bg-gray-800 rounded-lg p-2.5 border border-l-[3px] transition-colors cursor-pointer",
          stageBorderClass,
          idea.isAdded
            ? "border-green-300 dark:border-green-700 border-l-green-500 dark:border-l-green-400 bg-green-50/50 dark:bg-green-900/10"
            : "border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600"
        )}
      >
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
                  title="Edit your proposal"
                >
                  <Scale className="h-3 w-3" />
                </button>
              </div>
            )}

          </div>
          {/* Expand button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleExpand(e)
            }}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <ChevronDown className={clsx("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
          </button>
        </div>


        {/* Expanded content - rationale */}
        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            {idea.rationale ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">{idea.rationale}</p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No rationale provided</p>
            )}
            {/* Author and timestamp */}
            <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
              <span
                className="w-4 h-4 rounded-full bg-gray-100 dark:bg-gray-700 font-medium text-gray-600 dark:text-gray-300 flex items-center justify-center"
                title={idea.users?.first_name && idea.users?.last_name
                  ? `${idea.users.first_name} ${idea.users.last_name}`
                  : idea.users?.email || 'Unknown'}
              >
                {authorInitials}
              </span>
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
            </div>
            {/* Make Proposal + Fast-track buttons */}
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setProposalEditorIdea(idea)
                }}
                className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
              >
                <Scale className="h-3 w-3" />
                Make Proposal
              </button>
              {isCurrentUserPM && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    fastTrackMutation.mutate(idea)
                  }}
                  disabled={fastTrackMutation.isPending}
                  className="flex items-center gap-1 text-[11px] font-medium text-purple-700 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 transition-colors disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" />
                  Fast-track
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render a pair trade card (grouped unit with all legs)
  const renderPairTradeCard = (entry: { pairTrade: PairTrade; legs: typeof tradeIdeasWithStatus; allAdded: boolean; someAdded: boolean }) => {
    const { pairTrade, legs, allAdded, someAdded } = entry

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

    const handleTogglePairTrade = () => {
      if (allAdded) {
        legs.forEach(leg => handleRemoveAsset(leg.asset_id))
      } else {
        const legsToAdd = legs.filter(l => !l.isAdded)
        if (legsToAdd.length > 0) {
          // Optimistic: mark all legs as added + add temp variants
          legsToAdd.forEach(leg => {
            checkboxOverridesRef.current.set(leg.asset_id, true)
            if (tradeLab?.id) {
              const variantQueryKey = ['intent-variants', tradeLab.id, null]
              queryClient.setQueryData<IntentVariant[]>(variantQueryKey, (old) => {
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
          })
          setCheckboxOverrides(new Map(checkboxOverridesRef.current))
          importPairTradeMutation.mutate(legsToAdd)
        }
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

    return (
      <div
        key={pairTrade.id}
        className={clsx(
          "bg-white dark:bg-gray-800 rounded-lg p-2.5 border transition-colors relative",
          allAdded
            ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10"
            : someAdded
              ? "border-amber-400 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-900/10"
              : "border-purple-200 dark:border-purple-800 hover:border-purple-400 dark:hover:border-purple-600"
        )}
      >
        {/* Partial indicator */}
        {someAdded && !allAdded && (
          <span className="absolute -top-2 -right-2 text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white shadow-sm">
            Partial
          </span>
        )}

        {/* Pairs Trade Header */}
        <div className="flex items-center gap-2">
          {/* Checkbox for added status */}
          <button
            onClick={handleTogglePairTrade}
            disabled={false}
            className={clsx(
              "flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
              allAdded
                ? "bg-green-500 border-green-500 text-white"
                : someAdded
                  ? "bg-amber-500 border-amber-500 text-white"
                  : "border-purple-400 dark:border-purple-600 hover:border-purple-500"
            )}
          >
            {allAdded && <Check className="h-2.5 w-2.5" />}
            {someAdded && !allAdded && <Minus className="h-2.5 w-2.5" />}
          </button>
          <button
            onClick={toggleExpand}
            className="flex items-center gap-1.5 min-w-0 flex-1"
          >
            <ChevronDown className={clsx(
              "h-3 w-3 text-gray-400 transition-transform flex-shrink-0",
              !isExpanded && "-rotate-90"
            )} />
            <Link2 className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
            <span className="font-medium text-sm truncate">
              {buySymbols || sellSymbols ? (
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
              ) : (
                <span className="text-gray-900 dark:text-white">{allSymbols || 'Pairs Trade'}</span>
              )}
            </span>
          </button>
        </div>

        {/* Legs display - collapsible */}
        {isExpanded && (
        <div className="space-y-1.5 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              {/* Long legs */}
              {longLegs.map(leg => {
                const handleToggleLeg = (e: React.MouseEvent) => {
                  e.stopPropagation()
                  if (leg.isAdded) {
                    handleRemoveAsset(leg.asset_id)
                  } else {
                    handleAddAsset(leg)
                  }
                }
                // v3: Look up variant conflict status
                const trade = simulation?.simulation_trades?.find(t => t.asset_id === leg.asset_id)
                const variant = intentVariants.find(v => v.asset_id === leg.asset_id)
                const variantConflict = variant?.direction_conflict as SizingValidationError | null

                return (
                  <div key={leg.id} className="flex items-center gap-2 text-xs group">
                    <button
                      onClick={handleToggleLeg}
                      disabled={false}
                      className={clsx(
                        "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        leg.isAdded
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-300 dark:border-gray-600 hover:border-green-500 opacity-0 group-hover:opacity-100"
                      )}
                    >
                      {leg.isAdded && <Check className="h-2.5 w-2.5" />}
                    </button>
                    <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium uppercase">
                      buy
                    </span>
                    <span className={clsx(
                      "font-medium",
                      leg.isAdded ? "text-green-700 dark:text-green-400" : "text-gray-700 dark:text-gray-300"
                    )}>
                      {leg.assets?.symbol}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {leg.proposed_weight ? `${leg.proposed_weight}%` : ''}
                      {leg.proposed_weight && leg.proposed_shares ? ' · ' : ''}
                      {leg.proposed_shares ? `${leg.proposed_shares} sh` : ''}
                    </span>
                    {/* v3: Inline conflict badge for pair leg */}
                    {leg.isAdded && trade && (
                      <InlineConflictBadge
                        conflict={variantConflict}
                        onFixAction={(suggestedAction) => {
                          updateTradeMutation.mutate({
                            tradeId: trade.id,
                            action: suggestedAction,
                            assetId: trade.asset_id,
                            unlinkFromIdea: false,
                          })
                        }}
                        size="sm"
                      />
                    )}
                  </div>
                )
              })}

              {/* Short legs */}
              {shortLegs.map(leg => {
                const handleToggleLeg = (e: React.MouseEvent) => {
                  e.stopPropagation()
                  if (leg.isAdded) {
                    handleRemoveAsset(leg.asset_id)
                  } else {
                    handleAddAsset(leg)
                  }
                }
                // v3: Look up variant conflict status
                const trade = simulation?.simulation_trades?.find(t => t.asset_id === leg.asset_id)
                const variant = intentVariants.find(v => v.asset_id === leg.asset_id)
                const variantConflict = variant?.direction_conflict as SizingValidationError | null

                return (
                  <div key={leg.id} className="flex items-center gap-2 text-xs group">
                    <button
                      onClick={handleToggleLeg}
                      disabled={false}
                      className={clsx(
                        "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        leg.isAdded
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-300 dark:border-gray-600 hover:border-red-500 opacity-0 group-hover:opacity-100"
                      )}
                    >
                      {leg.isAdded && <Check className="h-2.5 w-2.5" />}
                    </button>
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium uppercase">
                      sell
                    </span>
                    <span className={clsx(
                      "font-medium",
                      leg.isAdded ? "text-green-700 dark:text-green-400" : "text-gray-700 dark:text-gray-300"
                    )}>
                      {leg.assets?.symbol}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {leg.proposed_weight ? `${leg.proposed_weight}%` : ''}
                      {leg.proposed_weight && leg.proposed_shares ? ' · ' : ''}
                      {leg.proposed_shares ? `${leg.proposed_shares} sh` : ''}
                    </span>
                    {/* v3: Inline conflict badge for pair leg */}
                    {leg.isAdded && trade && (
                      <InlineConflictBadge
                        conflict={variantConflict}
                        onFixAction={(suggestedAction) => {
                          updateTradeMutation.mutate({
                            tradeId: trade.id,
                            action: suggestedAction,
                            assetId: trade.asset_id,
                            unlinkFromIdea: false,
                          })
                        }}
                        size="sm"
                      />
                    )}
                  </div>
                )
              })}

              {/* Uncategorized legs (fallback) */}
              {uncategorizedLegs.map(leg => {
                const handleToggleLeg = (e: React.MouseEvent) => {
                  e.stopPropagation()
                  if (leg.isAdded) {
                    handleRemoveAsset(leg.asset_id)
                  } else {
                    handleAddAsset(leg)
                  }
                }
                const isBuyAction = leg.action === 'buy' || leg.action === 'add'
                // v3: Look up variant conflict status
                const trade = simulation?.simulation_trades?.find(t => t.asset_id === leg.asset_id)
                const variant = intentVariants.find(v => v.asset_id === leg.asset_id)
                const variantConflict = variant?.direction_conflict as SizingValidationError | null

                return (
                  <div key={leg.id} className="flex items-center gap-2 text-xs group">
                    <button
                      onClick={handleToggleLeg}
                      disabled={false}
                      className={clsx(
                        "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        leg.isAdded
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-300 dark:border-gray-600 hover:border-gray-500 opacity-0 group-hover:opacity-100"
                      )}
                    >
                      {leg.isAdded && <Check className="h-2.5 w-2.5" />}
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
                      leg.isAdded ? "text-green-700 dark:text-green-400" : "text-gray-700 dark:text-gray-300"
                    )}>
                      {leg.assets?.symbol}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {leg.proposed_weight ? `${leg.proposed_weight}%` : ''}
                      {leg.proposed_weight && leg.proposed_shares ? ' · ' : ''}
                      {leg.proposed_shares ? `${leg.proposed_shares} sh` : ''}
                    </span>
                    {/* v3: Inline conflict badge for pair leg */}
                    {leg.isAdded && trade && (
                      <InlineConflictBadge
                        conflict={variantConflict}
                        onFixAction={(suggestedAction) => {
                          updateTradeMutation.mutate({
                            tradeId: trade.id,
                            action: suggestedAction,
                            assetId: trade.asset_id,
                            unlinkFromIdea: false,
                          })
                        }}
                        size="sm"
                      />
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
            {/* Share Simulation Button — hidden in shared view */}
            {simulation && !isSharedView && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowShareModal(true)}
                title="Share this simulation"
              >
                <Share2 className="h-4 w-4 mr-1.5" />
                Share
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
                  {selectedViewType === 'private' && (
                    <span className="ml-1 text-xs text-gray-500 dark:text-gray-400 font-normal">Only you</span>
                  )}
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
                  Trade Sheets
                </button>
                <button
                  onClick={() => setSelectedViewType('shared')}
                  className={clsx(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    selectedViewType === 'shared'
                      ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  )}
                >
                  <Share2 className="h-4 w-4" />
                  Shared with me
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
              {/* Trade Sheets Header */}
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Trade Sheets</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Committed trade sheets for this portfolio
                </p>
              </div>

              {/* V3: Trade Sheet List */}
              <TradeSheetPanel
                tradeSheets={v3TradeSheets}
                assetSymbolMap={assetSymbolMap}
              />
            </div>
          </div>
        ) : selectedViewType === 'shared' ? (
          /* Shared with me Section */
          <div className="flex-1 bg-white dark:bg-gray-900 overflow-auto">
            <div className="p-6 max-w-3xl mx-auto">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Shared with me</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Simulations that other team members have shared with you.
                </p>
              </div>
              <SharedWithMeList
                onSelectShare={(share) => {
                  window.dispatchEvent(new CustomEvent('open-shared-simulation', { detail: { share } }))
                }}
              />
            </div>
          </div>
        ) : (
          /* Workbench View - always show for Workspace tab */
          <>
              {/* Trade Ideas Panel — hidden in shared view */}
              {!isSharedView && <div className={clsx(
                "border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex flex-col transition-all",
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
                          {tradeIdeasWithStatus.length > 0 && (
                            <Badge variant="default" className="text-xs">{tradeIdeasWithStatus.length}</Badge>
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
                  <div className="flex-1 overflow-y-auto p-2">
                    {(tradeIdeasLoading || tradeIdeasFetching || proposalsLoading) ? (
                      <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 text-gray-400 animate-spin" />
                      </div>
                    ) : tradeIdeasWithStatus.length === 0 && itemsByCategory.proposals.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        <p className="text-sm">No trade ideas available</p>
                        <p className="text-xs mt-1">Add ideas from the Trade Queue</p>
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
                          <div className="flex items-center gap-1">
                            {(['all', 'deciding', 'modeling', 'working_on', 'idea'] as const).map(stage => {
                              const dotColor =
                                stage === 'deciding' ? 'bg-amber-500' :
                                stage === 'modeling' ? 'bg-indigo-500' :
                                stage === 'working_on' ? 'bg-purple-500' :
                                stage === 'idea' ? 'bg-blue-400' : null
                              return (
                                <button
                                  key={stage}
                                  onClick={() => setLeftPaneStageFilter(stage)}
                                  className={clsx(
                                    "flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors",
                                    leftPaneStageFilter === stage
                                      ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                  )}
                                >
                                  {dotColor && <span className={clsx("w-1.5 h-1.5 rounded-full", dotColor)} />}
                                  {stage === 'all' ? 'All' : stage === 'idea' ? 'Idea' : stage === 'working_on' ? 'Working' : stage === 'deciding' ? 'Deciding' : 'Modeling'}
                                </button>
                              )
                            })}
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
                              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Proposals</span>
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

                                  // Enrich legs with asset_id from tradeIdeasWithStatus (legId = trade_queue_item.id)
                                  const enrichedLegs = isPairTrade && legs?.length
                                    ? legs.map((l: any) => {
                                        const tradeItem = tradeIdeasWithStatus.find(t => t.id === l.legId)
                                        return {
                                          ...l,
                                          assetId: tradeItem?.asset_id,
                                          tradeQueueItemId: l.legId,
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
                                      const tradeIdeaLike = {
                                        id: a.tradeQueueItemId || crypto.randomUUID(),
                                        asset_id: a.assetId,
                                        action: a.action,
                                        proposed_shares: null,
                                        proposed_weight: a.weight ?? proposal.weight ?? null,
                                        target_price: null,
                                        assets: { id: a.assetId, symbol: a.symbol, company_name: a.companyName, sector: a.sector },
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
                                            sizing_input: a.weight != null ? String(a.weight) : (proposal.weight != null ? String(proposal.weight) : null),
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
                                          title={isProposalApplied ? "Remove proposal from lab" : "Add proposal to lab"}
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
                                          <span className="font-semibold text-[13px] text-gray-900 dark:text-white truncate">
                                            {asset?.symbol || '???'}
                                          </span>
                                        ) : (
                                          <span className="text-[13px] font-medium truncate">
                                            {buySymbols && <span className="text-emerald-600 dark:text-emerald-400">{buySymbols}</span>}
                                            {buySymbols && sellSymbols && <span className="text-gray-400 mx-0.5">/</span>}
                                            {sellSymbols && <span className="text-red-600 dark:text-red-400">{sellSymbols}</span>}
                                          </span>
                                        )}

                                        {/* Weight (right-aligned) */}
                                        {!isPairTrade && proposal.weight != null && (
                                          <span className="ml-auto text-[12px] tabular-nums font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">
                                            {proposal.weight}%
                                          </span>
                                        )}

                                        {/* Proposer initials */}
                                        <span className={clsx(
                                          "flex-shrink-0 text-[9px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-full px-1.5 py-0.5",
                                          !isPairTrade && proposal.weight == null && "ml-auto"
                                        )}>
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
                                          {/* Pair trade legs */}
                                          {isPairTrade && sortedLegs.length > 0 && (
                                            <div className="space-y-1">
                                              {sortedLegs.map((leg: any) => (
                                                <div key={leg.legId} className="flex items-center gap-2 text-xs ml-5">
                                                  <span className={clsx(
                                                    "px-1 py-px rounded text-[9px] font-bold uppercase",
                                                    leg.action === 'buy' || leg.action === 'add'
                                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                  )}>
                                                    {leg.action}
                                                  </span>
                                                  <span className="font-semibold text-gray-900 dark:text-white">{leg.symbol}</span>
                                                  {leg.weight != null && (
                                                    <span className="text-gray-500 dark:text-gray-400 ml-auto tabular-nums">{leg.weight}%</span>
                                                  )}
                                                </div>
                                              ))}
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

                                          {/* PM Decision Actions */}
                                          {isCurrentUserPM && (
                                            <div className="flex items-center gap-1.5 ml-5 mt-1">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  proposalDecisionMutation.mutate({ proposalId: proposal.id, decision: 'accept' })
                                                }}
                                                disabled={proposalDecisionMutation.isPending}
                                                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50"
                                              >
                                                <Check className="h-3 w-3" />
                                                Accept
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  proposalDecisionMutation.mutate({ proposalId: proposal.id, decision: 'reject' })
                                                }}
                                                disabled={proposalDecisionMutation.isPending}
                                                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                                              >
                                                <X className="h-3 w-3" />
                                                Reject
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  proposalDecisionMutation.mutate({ proposalId: proposal.id, decision: 'defer' })
                                                }}
                                                disabled={proposalDecisionMutation.isPending}
                                                className="px-2 py-1 text-[10px] font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                                              >
                                                <Clock className="h-3 w-3" />
                                              </button>
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
                <div className="flex-1 overflow-hidden p-4">
                  {(simulation || (isSharedView && sharedSimData)) ? (
                  <>
                  {/* View Content */}
                  <div className="h-full">
                    {impactView === 'simulation' ? (
                      /* Holdings Simulation Table + Suggestion Review Panel */
                      <div className="h-full flex gap-0">
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
                          onFixConflict={(variantId, suggestedAction) => handleFixConflict(variantId, suggestedAction)}
                          onAddAsset={handleAddManualAsset}
                          assetSearchResults={phantomAssetResults ?? []}
                          onAssetSearchChange={setPhantomAssetSearch}
                          onCreateTradeSheet={!isSharedView ? () => {
                            setShowCreateSheetConfirm(true)
                          } : undefined}
                          canCreateTradeSheet={!isSharedView && simulation?.status === 'draft' && simulationRows.summary.tradedCount > 0 && !v3HasConflicts}
                          isCreatingTradeSheet={v3CreatingSheet}
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
        preselectedPortfolioId={simulation?.portfolio_id}
      />

      {/* Proposal Editor Modal */}
      {proposalEditorIdea && selectedPortfolioId && (
        <ProposalEditorModal
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
        />
      )}

      {/* Share Simulation Modal */}
      {simulation && (
        <ShareSimulationModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          simulationId={simulation.id}
          simulationName={simulation.name}
        />
      )}

      {/* Create Trade Sheet Confirmation Modal */}
      {showCreateSheetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCreateSheetConfirm(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Create Trade Sheet
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Are you sure? This will create a new trade sheet and clear the current simulation.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreateSheetConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowCreateSheetConfirm(false)
                  const name = `Trade Sheet — ${format(new Date(), 'MMM d, yyyy HH:mm')}`
                  await handleCreateTradeSheet(name)
                }}
                disabled={v3CreatingSheet}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {v3CreatingSheet ? 'Creating...' : 'Create & Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
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
