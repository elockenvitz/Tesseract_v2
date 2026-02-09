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
import { SectorExposureChart } from '../components/trading/SectorExposureChart'
import { ConcentrationMetrics } from '../components/trading/ConcentrationMetrics'
import { HoldingsComparison } from '../components/trading/HoldingsComparison'
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
import { parseSizingInput, toSizingSpec, type SizingSpec } from '../lib/trade-lab/sizing-parser'
import { detectDirectionConflict } from '../lib/trade-lab/normalize-sizing'
import { ConflictBadgeV3 } from '../components/trading/VariantStatusBadges'
import { TradeSheetPanel } from '../components/trading/TradeSheetPanel'
import { TradeSheetReadinessPanel } from '../components/trading/TradeSheetReadinessPanel'
import { UnifiedSizingInput, type CurrentPosition as UnifiedCurrentPosition } from '../components/trading/UnifiedSizingInput'
import { InlineConflictBadge, SummaryBarConflicts, CardConflictRow } from '../components/trading/TradeCardConflictBadge'
import { HoldingsSimulationTable } from '../components/trading/HoldingsSimulationTable'
import { useIntentVariants } from '../hooks/useIntentVariants'
import { useSimulationRows } from '../hooks/useSimulationRows'
import type { SizingValidationError, AssetPrice } from '../types/trading'

interface SimulationPageProps {
  simulationId?: string
  tabId?: string
  onClose?: () => void
  initialPortfolioId?: string
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

export function SimulationPage({ simulationId: propSimulationId, tabId, onClose, initialPortfolioId }: SimulationPageProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()

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
  const [proposalEditorIdea, setProposalEditorIdea] = useState<TradeQueueItemWithDetails | null>(null)
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [tradeModalInitialTab, setTradeModalInitialTab] = useState<'details' | 'discussion' | 'proposals' | 'activity'>('details')
  const [holdingsGroupBy, setHoldingsGroupBy] = useState<'none' | 'sector' | 'action' | 'change'>('none')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Auto-create workbench tracking
  const autoCreatingRef = useRef(false)
  const lastAutoCreatePortfolioRef = useRef<string | null>(null)
  const [isAutoCreating, setIsAutoCreating] = useState(false)

  // Quick trade state (for adding sandbox trades directly)
  const [showQuickTrade, setShowQuickTrade] = useState(false)
  const [quickTradeSearch, setQuickTradeSearch] = useState('')
  const [quickTradeAsset, setQuickTradeAsset] = useState<{ id: string; symbol: string; company_name: string; sector: string | null } | null>(null)
  const [quickTradeAction, setQuickTradeAction] = useState<TradeAction>('buy')
  const [quickTradeShares, setQuickTradeShares] = useState('')
  const [quickTradeWeight, setQuickTradeWeight] = useState('')

  // Track expanded trade idea cards
  const [expandedTradeIds, setExpandedTradeIds] = useState<Set<string>>(new Set())

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
          users:created_by (id, email, first_name, last_name)
        `)
        .eq('visibility_tier', 'active')
        .in('status', ['idea', 'discussing', 'simulating'])
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
    createTradeSheet: v3CreateTradeSheet,
  } = useIntentVariants({
    labId: tradeLab?.id,
    viewId: null, // Not using trade_lab_views, variants are lab-wide
    portfolioId: selectedPortfolioId,
  })

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
      hasBenchmark: false,
    })
  }

  // Handler for creating trade sheet
  const handleCreateTradeSheet = async (name: string, description?: string) => {
    await v3CreateTradeSheet({ name, description })
  }

  // v3: Guard to prevent concurrent sync runs
  const syncingRef = useRef(false)

  // Reset sync guard when simulation changes
  useEffect(() => {
    syncingRef.current = false
  }, [selectedSimulationId])

  // Search assets for quick trade
  const { data: quickTradeAssets } = useQuery({
    queryKey: ['assets-search-quick', quickTradeSearch],
    queryFn: async () => {
      if (!quickTradeSearch || quickTradeSearch.length < 1) return []

      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${quickTradeSearch}%,company_name.ilike.%${quickTradeSearch}%`)
        .limit(8)

      if (error) throw error
      return data
    },
    enabled: showQuickTrade && quickTradeSearch.length >= 1,
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

  // Merge baseline + variants into simulation rows for the table
  const simulationRows = useSimulationRows({
    baselineHoldings: simulation?.baseline_holdings as BaselineHolding[] || [],
    variants: intentVariants,
    priceMap: priceMap || {},
  })

  // Handler for creating a variant from an untraded holding row
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
      hasBenchmark: false,
    })
  }, [simulation, priceMap, v3CreateVariant])

  // v3: Sync simulation_trades → lab_variants on load and when real (non-temp) trades change.
  // Only syncs persisted trades that don't have a matching variant.
  // Optimistic temp trades (id starts with "temp-") are skipped — the import mutation handles those.
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
        !simulation?.simulation_trades?.length ||
        !tradeLab?.id ||
        !priceMap ||
        v3Loading ||
        syncingRef.current
      ) {
        return
      }

      // Only consider persisted (non-temp) trades
      const persistedTrades = simulation.simulation_trades.filter(t => !t.id.startsWith('temp-'))
      const variantAssetIds = new Set(intentVariants.map(v => v.asset_id))
      const unsyncedTrades = persistedTrades.filter(
        t => !variantAssetIds.has(t.asset_id) && checkboxOverridesRef.current.get(t.asset_id) !== false
      )

      if (unsyncedTrades.length === 0) return

      syncingRef.current = true
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
            hasBenchmark: false,
            uiSource: 'simulation_page',
          })
        } catch (err) {
          console.warn('⚠️ Failed to sync trade to variant:', err)
        }
      }

      syncingRef.current = false
    }

    syncVariants()
  }, [realTradeIds, tradeLab?.id, priceMap, v3Loading, intentVariants, simulation?.baseline_holdings, simulation?.baseline_total_value, v3CreateVariantAsync, simulation?.simulation_trades])

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
              hasBenchmark: false,
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
              hasBenchmark: false,
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
                hasBenchmark: false,
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
    },
    onError: (_err, tradeIdea) => {
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
    },
    onSettled: (_data, _error, tradeIdea) => {
      importsInFlightRef.current.delete(tradeIdea.asset_id)
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
                  hasBenchmark: false,
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
                  hasBenchmark: false,
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
    onSettled: async () => {
      // Await refetch so reconciliation effect sees fresh data
      await queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      // The reconciliation effect will clear the FALSE override once the trade is gone
    },
  })

  // ==========================================================================
  // CHECKBOX HELPERS — immediate mutations with instant optimistic UI
  // ==========================================================================

  // Convergence effect: clears overrides once server state matches desired state.
  // Also catches stale variants that reappear from refetches after uncheck.
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
        const exists = tradeAssetIds.has(assetId)
        if ((desired && exists) || (!desired && !exists)) {
          // Server matches desired state — safe to clear override
          next.delete(assetId)
          checkboxOverridesRef.current.delete(assetId)
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
          const variant = intentVariants.find(v => v.asset_id === assetId)
          if (variant) {
            queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
            queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null] as any, (old) =>
              old?.filter(v => v.asset_id !== assetId) ?? []
            )
            if (!variant.id.startsWith('temp-')) {
              v3DeleteVariant({ variantId: variant.id })
            }
          }
          // Also ensure trade is removed if it reappeared
          if (tradeAssetIds.has(assetId)) {
            const trades = (simulation?.simulation_trades || []).filter(
              (t: any) => t.asset_id === assetId && !t.id?.startsWith('temp-')
            )
            trades.forEach((trade: any) => {
              removeTradeMutation.mutate({ tradeId: trade.id, assetId })
            })
          }
        }
      })
    }
  }, [simulation?.simulation_trades, intentVariants, tradeLab?.id, queryClient, v3DeleteVariant, removeTradeMutation])

  /** Remove an asset from simulation */
  const handleRemoveAsset = useCallback((assetId: string) => {
    // Instant UI feedback
    checkboxOverridesRef.current.set(assetId, false)
    setCheckboxOverrides(new Map(checkboxOverridesRef.current))

    // Cancel in-flight variant fetches so a pending refetch can't overwrite our removal
    if (tradeLab?.id) {
      queryClient.cancelQueries({ queryKey: ['intent-variants', tradeLab.id] })
    }

    // Optimistic: remove ALL variants (temp AND real) from cache (table row disappears)
    if (tradeLab?.id) {
      queryClient.setQueryData<IntentVariant[]>(['intent-variants', tradeLab.id, null] as any, (old) =>
        old?.filter(v => v.asset_id !== assetId) ?? []
      )
    }

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
    // Delete real variant from DB
    if (tradeLab?.id) {
      const variant = intentVariants.find(v => v.asset_id === assetId && !v.id.startsWith('temp-'))
      if (variant) v3DeleteVariant({ variantId: variant.id })
    }
  }, [simulation?.simulation_trades, intentVariants, tradeLab?.id, queryClient, removeTradeMutation, v3DeleteVariant])

  /** Add an asset to simulation */
  const handleAddAsset = useCallback((idea: TradeQueueItemWithDetails) => {
    const assetId = idea.asset_id

    // Instant UI feedback
    checkboxOverridesRef.current.set(assetId, true)
    setCheckboxOverrides(new Map(checkboxOverridesRef.current))

    // Optimistic: add temp variant to cache for instant table row
    if (tradeLab?.id) {
      const variantQueryKey = ['intent-variants', tradeLab.id, null]
      queryClient.setQueryData<IntentVariant[]>(variantQueryKey, (old) => {
        if (old?.some(v => v.asset_id === assetId)) return old
        const tempVariant = {
          id: `temp-${assetId}`,
          asset_id: assetId,
          trade_lab_id: tradeLab.id,
          action: idea.action || 'buy',
          sizing_input: null,
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
  const effectiveTradeCount = useMemo(() => {
    const trades = simulation?.simulation_trades || []
    return trades.filter((t: any) => checkboxOverrides.get(t.asset_id) !== false).length
  }, [simulation?.simulation_trades, checkboxOverrides])

  // Calculate metrics dynamically based on current trades (LIVE!)
  const liveMetrics = useMemo(() => {
    if (!simulation || !priceMap || Object.keys(priceMap).length === 0) return null

    const baselineHoldings = simulation.baseline_holdings as BaselineHolding[]
    const trades = simulation.simulation_trades || []

    return calculateSimulationMetrics(baselineHoldings, trades, priceMap)
  }, [simulation, priceMap])

  // Add quick trade (sandbox-only, no trade idea created)
  const addQuickTradeMutation = useMutation({
    mutationFn: async ({ asset, action, shares, weight }: {
      asset: { id: string; symbol: string; company_name: string; sector: string | null }
      action: TradeAction
      shares?: number
      weight?: number
    }) => {
      if (!simulation) throw new Error('No simulation selected')

      // Get current price for the asset
      let price = 100
      try {
        const quote = await financialDataService.getQuote(asset.symbol)
        if (quote?.price) price = quote.price
      } catch {
        // Use default price
      }

      const { data, error } = await supabase
        .from('simulation_trades')
        .insert({
          simulation_id: simulation.id,
          trade_queue_item_id: null, // No trade idea linked
          asset_id: asset.id,
          action,
          shares: shares ?? null,
          weight: weight ?? null,
          price,
          sort_order: (simulation.simulation_trades?.length || 0),
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      refetchPrices()
      // Reset quick trade form
      setShowQuickTrade(false)
      setQuickTradeSearch('')
      setQuickTradeAsset(null)
      setQuickTradeAction('buy')
      setQuickTradeShares('')
      setQuickTradeWeight('')
    },
  })

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
      // Checkbox override takes precedence for instant feedback
      if (checkboxOverrides.has(idea.asset_id)) {
        return { ...idea, isIncluded: includedIdeaIds?.has(idea.id) || false, isAdded: checkboxOverrides.get(idea.asset_id)! }
      }
      return {
        ...idea,
        isIncluded: includedIdeaIds?.has(idea.id) || false,
        isAdded: expressedAssetIds.has(idea.asset_id)
          && !proposalAddedAssetIds.has(idea.asset_id),
      }
    })
  }, [tradeIdeas, simulation?.simulation_trades, includedIdeaIds, proposalAddedAssetIds, checkboxOverrides])

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
        const ideaStageIdx = stageOrder.indexOf(idea.stage || idea.status)
        if (ideaStageIdx > currentStageIdx) {
          entry.pairTrade.status = (idea.stage || idea.status) as any
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
    | { type: 'manual'; trade: SimulationTradeWithDetails }

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

  // Group items by: Proposals, Ideas, Manual Trades
  const itemsByCategory = useMemo(() => {
    const groups = {
      proposals: [] as ProposalItem[],  // From trade_proposals table
      ideas: [] as TradeItem[],         // All trade queue items (idea, working_on, modeling)
      manual: [] as TradeItem[]         // Simulation trades not from queue
    }

    // Proposals come from trade_proposals table, not trade_queue_items
    // Group proposals - pair trade proposals have sizing_context.isPairTrade = true
    const seenPairTradeProposals = new Set<string>()
    activeProposals?.forEach(proposal => {
      const sizingContext = proposal.sizing_context as any
      const isPairTrade = sizingContext?.isPairTrade === true
      const pairTradeId = sizingContext?.pairTradeId

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

    // All trade ideas go into Ideas (they never have status='deciding')
    pairTradesGrouped.standalone.forEach(idea => {
      groups.ideas.push({ type: 'single', idea })
    })

    // All pair trades from trade_queue_items go into Ideas
    pairTradesGrouped.pairTrades.forEach(entry => {
      groups.ideas.push({ type: 'pair', ...entry })
    })

    // Find manual trades (simulation_trades not linked to any trade_queue_item)
    const queueAssetIds = new Set(tradeIdeasWithStatus.map(i => i.asset_id))
    simulation?.simulation_trades?.forEach(trade => {
      if (!queueAssetIds.has(trade.asset_id)) {
        groups.manual.push({ type: 'manual', trade })
      }
    })

    return groups
  }, [pairTradesGrouped, tradeIdeasWithStatus, simulation?.simulation_trades, activeProposals])

  // Keep legacy references for backwards compatibility with other code
  const tradeIdeasByStatus = useMemo(() => ({
    idea: pairTradesGrouped.standalone.filter(i => (i.stage || i.status) === 'idea'),
    workingOn: pairTradesGrouped.standalone.filter(i => ['working_on', 'discussing'].includes(i.stage || i.status)),
    modeling: pairTradesGrouped.standalone.filter(i => ['modeling', 'simulating'].includes(i.stage || i.status)),
    deciding: pairTradesGrouped.standalone.filter(i => ['deciding', 'approved'].includes(i.stage || i.status))
  }), [pairTradesGrouped.standalone])

  const pairTradesByStatus = useMemo(() => {
    const groups = {
      idea: [] as Array<{ pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>,
      workingOn: [] as Array<{ pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>,
      modeling: [] as Array<{ pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>,
      deciding: [] as Array<{ pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>
    }
    pairTradesGrouped.pairTrades.forEach(entry => {
      const status = entry.pairTrade.status
      if (status === 'idea') groups.idea.push(entry)
      else if (status === 'discussing' || status === 'working_on') groups.workingOn.push(entry)
      else if (status === 'simulating' || status === 'modeling') groups.modeling.push(entry)
      else if (status === 'approved' || status === 'deciding') groups.deciding.push(entry)
    })
    return groups
  }, [pairTradesGrouped.pairTrades])

  // Count sandbox trade stats
  const tradeStats = useMemo(() => {
    const trades = simulation?.simulation_trades || []
    const buys = trades.filter(t => t.action === 'buy' || t.action === 'add').length
    const sells = trades.filter(t => t.action === 'sell' || t.action === 'trim').length
    return { total: trades.length, buys, sells }
  }, [simulation?.simulation_trades])

  // Group trades by action with detailed metrics for Trades view
  const tradesGroupedByAction = useMemo(() => {
    if (!simulation?.simulation_trades || !priceMap) return null

    const trades = simulation.simulation_trades
    const baseline = simulation.baseline_holdings as BaselineHolding[] || []
    const totalPortfolioValue = simulation.baseline_total_value || 0

    // Group trades by action
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
        cashImpact: number // positive = cash outflow (buy), negative = cash inflow (sell)
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

    trades.forEach(trade => {
      const action = trade.action
      const price = priceMap[trade.asset_id] || trade.price || 100
      const baselineHolding = baseline.find(h => h.asset_id === trade.asset_id)
      const currentShares = baselineHolding?.shares || 0
      const currentValue = currentShares * price
      const currentWeight = totalPortfolioValue > 0 ? (currentValue / totalPortfolioValue) * 100 : 0

      // Calculate trade value
      let tradeShares = trade.shares || 0
      let tradeWeight = trade.weight || 0

      // If weight is specified, calculate shares
      if (!tradeShares && tradeWeight && totalPortfolioValue > 0) {
        tradeShares = (tradeWeight / 100 * totalPortfolioValue) / price
      }
      // If shares specified, calculate weight
      if (tradeShares && !tradeWeight && totalPortfolioValue > 0) {
        tradeWeight = (tradeShares * price / totalPortfolioValue) * 100
      }

      const tradeValue = tradeShares * price

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
        id: trade.id,
        symbol: trade.assets?.symbol || '',
        company_name: trade.assets?.company_name || '',
        sector: trade.assets?.sector || null,
        shares: tradeShares,
        price,
        value: tradeValue,
        weight: tradeWeight,
        currentHolding: currentShares,
        currentWeight,
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
      netCashFlow: totalSellValue - totalBuyValue, // positive = net cash in, negative = net cash out
      totalPortfolioValue
    }
  }, [simulation?.simulation_trades, simulation?.baseline_holdings, simulation?.baseline_total_value, priceMap])

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
    const hasBenchmark = false // TODO: wire up benchmark config
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
    const hasBenchmark = false // TODO: wire up benchmark config
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

    return (
      <div
        key={idea.id}
        onClick={() => setSelectedTradeId(idea.id)}
        className={clsx(
          "bg-white dark:bg-gray-800 rounded-lg p-2.5 border transition-colors cursor-pointer",
          idea.isAdded
            ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10"
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

  // Helper to render a trade item (single, pair, or manual trade)
  const renderTradeItem = (item: TradeItem) => {
    if (item.type === 'single') {
      return renderTradeIdeaCard(item.idea)
    } else if (item.type === 'pair') {
      return renderPairTradeCard(item)
    } else {
      // Manual trade card
      const trade = item.trade
      const asset = trade.assets
      // v3: Look up variant conflict status for this trade
      const variant = intentVariants.find(v => v.asset_id === trade.asset_id)
      const variantConflict = variant?.direction_conflict as SizingValidationError | null
      const variantBelowLot = variant?.below_lot_warning ?? false

      return (
        <div
          key={trade.id}
          className={clsx(
            "bg-white dark:bg-gray-800 rounded-lg p-2.5 border transition-colors",
            variantConflict
              ? "border-red-300 dark:border-red-700"
              : "border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600"
          )}
        >
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-5 h-5 rounded border-2 border-green-500 bg-green-500 text-white flex items-center justify-center mt-0.5">
              <Check className="h-3 w-3" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={clsx(
                  "text-xs font-medium uppercase px-1.5 py-0.5 rounded flex-shrink-0",
                  trade.action === 'buy' || trade.action === 'add'
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}>
                  {trade.action}
                </span>
                <span className="font-semibold text-sm text-green-700 dark:text-green-400">
                  {asset?.symbol}
                </span>
                {asset?.company_name && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {asset.company_name}
                  </span>
                )}
                {/* v3: Inline conflict badge */}
                <InlineConflictBadge
                  conflict={variantConflict}
                  belowLotWarning={variantBelowLot}
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
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {trade.weight != null && `${trade.weight}%`}
                {trade.weight != null && trade.shares != null && ' · '}
                {trade.shares != null && `${trade.shares.toLocaleString()} sh`}
              </div>
            </div>
            <button
              onClick={() => removeTradeMutation.mutate({ tradeId: trade.id, assetId: trade.asset_id })}
              disabled={false}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 hover:text-red-500"
              title="Remove trade"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )
    }
  }

  // Legacy helper for backwards compatibility
  const renderStageItem = (item: TradeItem) => renderTradeItem(item)

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
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Trade Lab</h1>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            {/* Portfolio Selector - Searchable Dropdown */}
            <div className="relative" ref={portfolioDropdownRef}>
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
            </div>
            {tradeLabLoading && (
              <RefreshCw className="h-4 w-4 text-gray-400 animate-spin" />
            )}
            {tradeLab && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {effectiveTradeCount} trades
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
            {/* Share Simulation Button */}
            {simulation && (
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
            {/* Create Trade List button moved to bottom bar of HoldingsSimulationTable */}
          </div>
        </div>

        {/* View Tabs Row */}
        {selectedPortfolioId && (
          <div className="px-6 pb-2 flex items-center justify-between">
            {/* Left: View Type Tabs */}
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
            </div>

            {/* Right: View Toggle (only show for workbench views, not Trade Sheets) */}
            {selectedViewType !== 'lists' && simulation && (
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
                    {v3ConflictSummary.conflicts > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full">
                        {v3ConflictSummary.conflicts}
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
                    {effectiveTradeCount > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
                        {effectiveTradeCount}
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
        {(tradeLabLoading || simulationsLoading || isAutoCreating || (selectedPortfolioId && !simulation && simulationLoading)) ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900/50">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 text-gray-400 animate-spin mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Loading workbench...</p>
            </div>
          </div>
        ) : !selectedPortfolioId ? (
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
              {/* Trade Sheets Header with Stats */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Trade Sheets</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Browse and manage trade sheets for this portfolio
                    <span className="mx-1.5 text-gray-300 dark:text-gray-600">|</span>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('openTradePlans'))}
                      className="text-primary-600 dark:text-primary-400 hover:underline underline-offset-2"
                    >
                      View Trade Plans
                    </button>
                  </p>
                </div>
                {listStats && (
                  <div className="flex items-center gap-4">
                    <div className="text-center px-3">
                      <div className="text-lg font-semibold text-gray-900 dark:text-white">{listStats.total}</div>
                      <div className="text-xs text-gray-500">Total</div>
                    </div>
                    {listStats.pending > 0 && (
                      <div className="text-center px-3 border-l border-gray-200 dark:border-gray-700">
                        <div className="text-lg font-semibold text-amber-600">{listStats.pending}</div>
                        <div className="text-xs text-gray-500">Pending</div>
                      </div>
                    )}
                    {listStats.sent > 0 && (
                      <div className="text-center px-3 border-l border-gray-200 dark:border-gray-700">
                        <div className="text-lg font-semibold text-blue-600">{listStats.sent}</div>
                        <div className="text-xs text-gray-500">Sent</div>
                      </div>
                    )}
                    {listStats.acknowledged > 0 && (
                      <div className="text-center px-3 border-l border-gray-200 dark:border-gray-700">
                        <div className="text-lg font-semibold text-green-600">{listStats.acknowledged}</div>
                        <div className="text-xs text-gray-500">Complete</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* V3: Trade Sheet Creation Panel with Conflict Summary */}
              <TradeSheetPanel
                variants={intentVariants}
                conflictSummary={v3ConflictSummary}
                tradeSheets={v3TradeSheets}
                onCreateTradeSheet={handleCreateTradeSheet}
                onFixConflict={handleFixConflict}
                isCreating={v3CreatingSheet}
                className="mb-6"
              />

              {/* Trade Sheets List */}
              {listsLoading ? (
                <ListSkeleton count={3} />
              ) : lists.length === 0 ? (
                <EmptyState
                  icon={List}
                  title="No Trade Sheets Yet"
                  description="When you commit trades from your workspace, they'll appear here as trade sheets."
                />
              ) : (
                <div className="space-y-3">
                  {lists.map((tradeList) => (
                    <div
                      key={tradeList.id}
                      className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-gray-900 dark:text-white truncate">
                              {tradeList.name}
                            </h3>
                            <Badge
                              variant={
                                tradeList.status === 'acknowledged' ? 'success' :
                                tradeList.status === 'sent_to_desk' ? 'info' :
                                tradeList.status === 'approved' ? 'success' :
                                tradeList.status === 'pending_approval' ? 'warning' :
                                tradeList.status === 'rejected' ? 'error' :
                                'default'
                              }
                              className="text-xs"
                            >
                              {tradeList.status === 'pending_approval' ? 'Pending' :
                               tradeList.status === 'sent_to_desk' ? 'Sent' :
                               tradeList.status.charAt(0).toUpperCase() + tradeList.status.slice(1)}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {tradeList.trade_plan_items?.length || 0} trades •
                            Created {new Date(tradeList.created_at).toLocaleDateString()}
                            {tradeList.desk_reference && ` • Ref: ${tradeList.desk_reference}`}
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0 mt-1" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Workbench View - always show for Workspace tab */
          <>
              {/* Trade Ideas Panel */}
              <div className={clsx(
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
                    ) : tradeIdeasWithStatus.length === 0 && itemsByCategory.manual.length === 0 && itemsByCategory.proposals.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        <p className="text-sm">No trade ideas available</p>
                        <p className="text-xs mt-1">Add ideas from the Trade Queue</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Proposals Section - Items in deciding/approved stage */}
                        {itemsByCategory.proposals.length > 0 && (
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
                              <Badge className="text-[10px] py-0 px-1.5 bg-amber-100 dark:bg-amber-800 text-amber-700 dark:text-amber-300">{itemsByCategory.proposals.length}</Badge>
                            </button>
                            {!collapsedGroups.has('category-proposals') && (
                              <div className="space-y-2">
                                {itemsByCategory.proposals.map((proposalItem) => {
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

                                  // Handle applying/unapplying proposal to simulation
                                  const handleAddProposal = (e: React.MouseEvent) => {
                                    e.stopPropagation()

                                    if (isProposalApplied) {
                                      // Get trade IDs to remove
                                      const tradeIdsToRemove = proposalAssetIds
                                        .map((assetId: string) => simulation?.simulation_trades?.find(t => t.asset_id === assetId)?.id)
                                        .filter(Boolean) as string[]

                                      // Optimistically update ALL state at once
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

                                      // Optimistically remove trades from cache immediately
                                      queryClient.setQueryData(['simulation', selectedSimulationId], (old: any) => {
                                        if (!old) return old
                                        return {
                                          ...old,
                                          simulation_trades: old.simulation_trades?.filter(
                                            (t: any) => !tradeIdsToRemove.includes(t.id)
                                          ) || []
                                        }
                                      })

                                      // Then do the async delete
                                      if (tradeIdsToRemove.length > 0) {
                                        supabase
                                          .from('simulation_trades')
                                          .delete()
                                          .in('id', tradeIdsToRemove)
                                          .then(() => {
                                            queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
                                          })
                                      }
                                      return
                                    }

                                    // Optimistically update state FIRST
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

                                    // Then do the async work
                                    if (isPairTrade && enrichedLegs.length) {
                                      const inserts: any[] = []
                                      const updates: { id: string; weight: number | null }[] = []

                                      for (const leg of enrichedLegs) {
                                        if (!leg.assetId) continue
                                        const existingTrade = simulation?.simulation_trades?.find(t => t.asset_id === leg.assetId)
                                        if (existingTrade) {
                                          updates.push({ id: existingTrade.id, weight: leg.weight ?? null })
                                        } else {
                                          inserts.push({
                                            simulation_id: simulation?.id,
                                            trade_queue_item_id: leg.tradeQueueItemId,
                                            asset_id: leg.assetId,
                                            action: leg.action,
                                            weight: leg.weight ?? null,
                                            price: priceMap?.[leg.assetId] || 100,
                                            sort_order: (simulation?.simulation_trades?.length || 0) + inserts.length,
                                          })
                                        }
                                      }

                                      Promise.all([
                                        inserts.length > 0 ? supabase.from('simulation_trades').insert(inserts) : Promise.resolve(),
                                        ...updates.map(u => supabase.from('simulation_trades').update({ weight: u.weight }).eq('id', u.id))
                                      ]).then(() => {
                                        queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
                                      })
                                    } else if (tradeItem) {
                                      const assetId = tradeItem.assets?.id || asset?.id
                                      const existingTrade = simulation?.simulation_trades?.find(t => t.asset_id === assetId)

                                      if (existingTrade) {
                                        supabase
                                          .from('simulation_trades')
                                          .update({ weight: proposal.weight ?? null })
                                          .eq('id', existingTrade.id)
                                          .then(() => {
                                            queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
                                          })
                                      } else {
                                        supabase
                                          .from('simulation_trades')
                                          .insert({
                                            simulation_id: simulation?.id,
                                            trade_queue_item_id: tradeItem.id,
                                            asset_id: assetId,
                                            action: tradeItem.action,
                                            weight: proposal.weight ?? null,
                                            price: priceMap?.[assetId] || tradeItem.target_price || 100,
                                            sort_order: (simulation?.simulation_trades?.length || 0),
                                          })
                                          .then(() => {
                                            queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
                                          })
                                      }
                                    }
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
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Ideas Section - All trade queue items not in deciding */}
                        {itemsByCategory.ideas.length > 0 && (
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
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{itemsByCategory.ideas.length}</Badge>
                            </button>
                            {!collapsedGroups.has('category-ideas') && (
                              <div className="space-y-2">
                                {itemsByCategory.ideas.map((item) => (
                                  <div key={item.type === 'single' ? item.idea.id : item.type === 'pair' ? item.pairTrade.id : item.trade.id}>
                                    {renderTradeItem(item)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Manual Trades Section - Trades added directly, not from queue */}
                        {itemsByCategory.manual.length > 0 && (
                          <div>
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedGroups)
                                if (newCollapsed.has('category-manual')) {
                                  newCollapsed.delete('category-manual')
                                } else {
                                  newCollapsed.add('category-manual')
                                }
                                setCollapsedGroups(newCollapsed)
                              }}
                              className="flex items-center gap-2 w-full text-left mb-2 group"
                            >
                              <ChevronDown className={clsx(
                                "h-3 w-3 text-gray-400 transition-transform",
                                collapsedGroups.has('category-manual') && "-rotate-90"
                              )} />
                              <Edit2 className="h-3.5 w-3.5 text-gray-500" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Manual Trades</span>
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{itemsByCategory.manual.length}</Badge>
                            </button>
                            {!collapsedGroups.has('category-manual') && (
                              <div className="space-y-2">
                                {itemsByCategory.manual.map((item) => (
                                  <div key={item.type === 'manual' ? item.trade.id : ''}>
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
              </div>

              {/* Simulation Workspace */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {/* Main Content Area */}
                <div className="flex-1 overflow-hidden p-4">
                  {simulation ? (
                  <>
                  {/* View Content */}
                  <div className="h-full">
                    {impactView === 'simulation' ? (
                      /* Holdings Simulation Table */
                      <div className="h-full rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
                        <HoldingsSimulationTable
                          rows={simulationRows.rows}
                          tradedRows={simulationRows.tradedRows}
                          untradedRows={simulationRows.untradedRows}
                          newPositionRows={simulationRows.newPositionRows}
                          summary={simulationRows.summary}
                          portfolioTotalValue={simulation.baseline_total_value || 0}
                          hasBenchmark={false}
                          priceMap={priceMap || {}}
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
                              hasBenchmark: false,
                            })
                          }}
                          onDeleteVariant={(variantId) => v3DeleteVariant({ variantId })}
                          onCreateVariant={handleCreateVariantForHolding}
                          onFixConflict={(variantId, suggestedAction) => handleFixConflict(variantId, suggestedAction)}
                          onAddTrade={() => setShowQuickTrade(true)}
                          onCreateTradeSheet={() => createTradeListMutation.mutate()}
                          canCreateTradeSheet={simulation?.status === 'draft' && effectiveTradeCount > 0 && !workbenchSaving}
                          isCreatingTradeSheet={createTradeListMutation.isPending}
                        />
                      </div>
                    ) : metrics ? (
                      <div className="h-full overflow-y-auto space-y-3">
                        {impactView === 'impact' ? (
                          <div className="space-y-6">
                            {/* Key Metrics - Modern card grid */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                              {/* Positions Card */}
                              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 min-h-[120px]">
                                <div className="flex items-center justify-between mb-3">
                                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Positions</span>
                                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                                    <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                  </div>
                                </div>
                                <div className="flex items-baseline gap-2">
                                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{metrics.position_count_after}</span>
                                  {metrics.position_count_before !== metrics.position_count_after && (
                                    <span className="text-sm text-gray-400">from {metrics.position_count_before}</span>
                                  )}
                                </div>
                                <div className="mt-2 flex items-center gap-2 text-xs h-5">
                                  {metrics.positions_added > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
                                      <Plus className="h-3 w-3" />{metrics.positions_added} new
                                    </span>
                                  )}
                                  {metrics.positions_removed > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                                      <Minus className="h-3 w-3" />{metrics.positions_removed}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Top 5 Concentration Card */}
                              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 min-h-[120px]">
                                <div className="flex items-center justify-between mb-3">
                                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Top 5</span>
                                  <div className={clsx(
                                    "w-8 h-8 rounded-lg flex items-center justify-center",
                                    metrics.top_5_concentration_after > metrics.top_5_concentration_before
                                      ? "bg-amber-50 dark:bg-amber-900/20"
                                      : "bg-green-50 dark:bg-green-900/20"
                                  )}>
                                    {metrics.top_5_concentration_after > metrics.top_5_concentration_before
                                      ? <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                      : <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    }
                                  </div>
                                </div>
                                <div className="flex items-baseline gap-2">
                                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{metrics.top_5_concentration_after.toFixed(1)}%</span>
                                </div>
                                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 h-4">
                                  {metrics.top_5_concentration_after !== metrics.top_5_concentration_before && (
                                    <>
                                      <span className={clsx(
                                        "font-medium",
                                        metrics.top_5_concentration_after > metrics.top_5_concentration_before ? "text-amber-600" : "text-green-600"
                                      )}>
                                        {metrics.top_5_concentration_after > metrics.top_5_concentration_before ? '+' : ''}
                                        {(metrics.top_5_concentration_after - metrics.top_5_concentration_before).toFixed(1)}%
                                      </span>
                                      {' '}from {metrics.top_5_concentration_before.toFixed(1)}%
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Top 10 Concentration Card */}
                              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 min-h-[120px]">
                                <div className="flex items-center justify-between mb-3">
                                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Top 10</span>
                                  <div className={clsx(
                                    "w-8 h-8 rounded-lg flex items-center justify-center",
                                    metrics.top_10_concentration_after > metrics.top_10_concentration_before
                                      ? "bg-amber-50 dark:bg-amber-900/20"
                                      : "bg-green-50 dark:bg-green-900/20"
                                  )}>
                                    {metrics.top_10_concentration_after > metrics.top_10_concentration_before
                                      ? <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                      : <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    }
                                  </div>
                                </div>
                                <div className="flex items-baseline gap-2">
                                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{metrics.top_10_concentration_after.toFixed(1)}%</span>
                                </div>
                                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 h-4">
                                  {metrics.top_10_concentration_after !== metrics.top_10_concentration_before && (
                                    <>
                                      <span className={clsx(
                                        "font-medium",
                                        metrics.top_10_concentration_after > metrics.top_10_concentration_before ? "text-amber-600" : "text-green-600"
                                      )}>
                                        {metrics.top_10_concentration_after > metrics.top_10_concentration_before ? '+' : ''}
                                        {(metrics.top_10_concentration_after - metrics.top_10_concentration_before).toFixed(1)}%
                                      </span>
                                      {' '}from {metrics.top_10_concentration_before.toFixed(1)}%
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* HHI Card */}
                              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 min-h-[120px]">
                                <div className="flex items-center justify-between mb-3">
                                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">HHI Index</span>
                                  <div className={clsx(
                                    "w-8 h-8 rounded-lg flex items-center justify-center",
                                    metrics.herfindahl_index_after > metrics.herfindahl_index_before
                                      ? "bg-amber-50 dark:bg-amber-900/20"
                                      : "bg-green-50 dark:bg-green-900/20"
                                  )}>
                                    <BarChart3 className={clsx(
                                      "h-4 w-4",
                                      metrics.herfindahl_index_after > metrics.herfindahl_index_before
                                        ? "text-amber-600 dark:text-amber-400"
                                        : "text-green-600 dark:text-green-400"
                                    )} />
                                  </div>
                                </div>
                                <div className="flex items-baseline gap-2">
                                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{(metrics.herfindahl_index_after * 100).toFixed(0)}</span>
                                </div>
                                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 h-4">
                                  {metrics.herfindahl_index_after !== metrics.herfindahl_index_before && (
                                    <>from {(metrics.herfindahl_index_before * 100).toFixed(0)}</>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Charts Section */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <SectorExposureChart
                                  before={metrics.sector_exposure_before}
                                  after={metrics.sector_exposure_after}
                                />
                              </div>
                              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <ConcentrationMetrics metrics={metrics} />
                              </div>
                            </div>

                            {/* Holdings Comparison */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                              <HoldingsComparison
                                holdings={metrics.holdings_after}
                                baseline={simulation.baseline_holdings as BaselineHolding[]}
                              />
                            </div>
                          </div>
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
          onSaved={() => {
            setProposalEditorIdea(null)
            // Optionally refetch proposals or update UI
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
    </div>
  )
}

// Helper function to calculate simulation metrics
function calculateSimulationMetrics(
  baselineHoldings: BaselineHolding[],
  trades: SimulationTradeWithDetails[],
  priceMap: Record<string, number>
): SimulationMetrics {
  const holdingsMap = new Map<string, SimulatedHolding>()

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

  trades.forEach(trade => {
    const existing = holdingsMap.get(trade.asset_id)
    const price = priceMap[trade.asset_id] || trade.price || 100

    if (trade.action === 'buy' || trade.action === 'add') {
      const additionalShares = trade.shares || (trade.weight ? (trade.weight / 100 * totalValueBefore) / price : 0)
      // Only count as a trade if there's actual impact
      if (additionalShares === 0) return
      tradedAssetIds.add(trade.asset_id)

      if (existing) {
        existing.shares += additionalShares
        existing.value = existing.shares * existing.price
        positionsAdjusted++
      } else {
        holdingsMap.set(trade.asset_id, {
          asset_id: trade.asset_id,
          symbol: trade.assets?.symbol || '',
          company_name: trade.assets?.company_name || '',
          sector: trade.assets?.sector || null,
          shares: additionalShares,
          price,
          value: additionalShares * price,
          weight: 0,
          change_from_baseline: 0,
          is_new: true,
          is_removed: false,
          is_short: false,
        })
        positionsAdded++
      }
    } else if (trade.action === 'sell') {
      const sellShares = trade.shares || (trade.weight ? (trade.weight / 100 * totalValueBefore) / price : 0)
      // Only count as a trade if there's actual impact
      if (sellShares === 0) return
      tradedAssetIds.add(trade.asset_id)

      if (existing) {
        // Selling existing position - can go short (negative shares)
        existing.shares = existing.shares - sellShares
        existing.value = existing.shares * existing.price

        if (existing.shares === 0) {
          existing.is_removed = true
          existing.is_short = false
          positionsRemoved++
        } else if (existing.shares < 0) {
          // Position went short
          existing.is_short = true
          existing.is_removed = false
          positionsAdjusted++
        } else {
          existing.is_short = false
          positionsAdjusted++
        }
      } else {
        // Selling without owning = short position
        const shortShares = -sellShares // Negative shares for short
        holdingsMap.set(trade.asset_id, {
          asset_id: trade.asset_id,
          symbol: trade.assets?.symbol || '',
          company_name: trade.assets?.company_name || '',
          sector: trade.assets?.sector || null,
          shares: shortShares,
          price,
          value: shortShares * price, // Negative value (liability)
          weight: 0,
          change_from_baseline: 0,
          is_new: true,
          is_removed: false,
          is_short: true,
        })
        positionsAdded++
      }
    } else if (trade.action === 'trim') {
      if (existing) {
        const sellShares = trade.shares || existing.shares * 0.5
        // Only count as a trade if there's actual impact
        if (sellShares === 0) return
        tradedAssetIds.add(trade.asset_id)

        existing.shares = Math.max(0, existing.shares - sellShares)
        existing.value = existing.shares * existing.price
        if (existing.shares === 0) {
          existing.is_removed = true
          positionsRemoved++
        } else {
          positionsAdjusted++
        }
      }
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
