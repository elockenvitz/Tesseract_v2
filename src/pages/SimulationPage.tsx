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
  FileText
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
      return {
        selectedSimulationId: savedState.selectedSimulationId || propSimulationId || null,
        showIdeasPanel: savedState.showIdeasPanel ?? true,
        impactView: savedState.impactView || 'summary',
      }
    }
  }
  return {
    selectedSimulationId: propSimulationId || null,
    showIdeasPanel: true,
    impactView: 'summary' as const,
  }
}

// Simplified sizing mode options - delta is auto-detected from +/- prefix
type SimpleSizingMode = 'weight' | 'shares' | 'vs_benchmark'
const SIZING_MODE_OPTIONS: { value: SimpleSizingMode; label: string; unit: string; placeholder: string; disabled?: boolean }[] = [
  { value: 'weight', label: 'Weight', unit: '%', placeholder: '' },
  { value: 'shares', label: 'Shares', unit: 'sh', placeholder: '' },
  { value: 'vs_benchmark', label: '± Bench', unit: '%', placeholder: '', disabled: true },
]

// Parse value to detect if it's a delta (starts with + or -)
const parseEditingValue = (value: string, baseMode: SimpleSizingMode): { mode: TradeSizingMode; numValue: number | null } => {
  if (baseMode === 'vs_benchmark') return { mode: 'delta_benchmark', numValue: null }
  if (!value || value.trim() === '') return { mode: baseMode === 'weight' ? 'weight' : 'shares', numValue: null }
  const trimmed = value.trim()
  const isDelta = trimmed.startsWith('+') || (trimmed.startsWith('-') && trimmed !== '-')
  const numValue = parseFloat(trimmed)
  if (isNaN(numValue)) return { mode: baseMode === 'weight' ? 'weight' : 'shares', numValue: null }

  if (isDelta) {
    return { mode: baseMode === 'weight' ? 'delta_weight' : 'delta_shares', numValue }
  }
  return { mode: baseMode === 'weight' ? 'weight' : 'shares', numValue }
}

// Get current sizing mode option
const getSizingModeOption = (mode: SimpleSizingMode) =>
  SIZING_MODE_OPTIONS.find(opt => opt.value === mode) || SIZING_MODE_OPTIONS[0]

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
  const [impactView, setImpactView] = useState<'summary' | 'holdings' | 'trades'>(initialState.current.impactView)

  // New: Portfolio-first workflow state
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(initialPortfolioId || null)
  const [selectedViewType, setSelectedViewType] = useState<'private' | 'shared' | 'portfolio' | 'lists'>('private')
  const [portfolioDropdownOpen, setPortfolioDropdownOpen] = useState(false)
  const [portfolioSearchQuery, setPortfolioSearchQuery] = useState('')
  const portfolioDropdownRef = useRef<HTMLDivElement>(null)
  const portfolioSearchInputRef = useRef<HTMLInputElement>(null)

  // New simulation form state
  const [newSimName, setNewSimName] = useState('')
  const [newSimPortfolioId, setNewSimPortfolioId] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showAddTradeIdeaModal, setShowAddTradeIdeaModal] = useState(false)
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
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name),
          pair_trades (id, name, description, rationale, urgency, status)
        `)
        .in('status', ['idea', 'discussing', 'simulating', 'approved'])
        .or(`portfolio_id.eq.${selectedPortfolioId}${linkedIdeaIds.length > 0 ? `,id.in.(${linkedIdeaIds.join(',')})` : ''}`)
        .order('priority', { ascending: false })

      if (error) throw error
      return data as TradeQueueItemWithDetails[]
    },
    enabled: !!selectedPortfolioId,
    staleTime: 30000, // Consider data stale after 30 seconds
    refetchOnWindowFocus: true, // Refetch when user comes back to tab
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

      // Use priceMap price if available (keyed by asset_id), otherwise target_price
      const price = priceMap?.[tradeIdea.asset_id] || tradeIdea.target_price || 100

      console.log('📥 Importing trade idea:', tradeIdea.id, tradeIdea.assets?.symbol)

      const { data, error } = await supabase
        .from('simulation_trades')
        .insert({
          simulation_id: simulation.id,
          trade_queue_item_id: tradeIdea.id,
          asset_id: tradeIdea.asset_id,
          action: tradeIdea.action,
          shares: tradeIdea.proposed_shares,
          weight: tradeIdea.proposed_weight,
          price,
          sort_order: (simulation.simulation_trades?.length || 0),
        })
        .select()
        .single()

      if (error) {
        console.error('❌ Import trade error:', error)
        throw error
      }
      console.log('✅ Import trade success:', data)
      return data
    },
    onMutate: async (tradeIdea) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['simulation', selectedSimulationId] })

      // Snapshot previous value
      const previousSimulation = queryClient.getQueryData(['simulation', selectedSimulationId])

      // Optimistically update - add a temporary trade
      queryClient.setQueryData(['simulation', selectedSimulationId], (old: any) => {
        if (!old) return old
        const tempTrade = {
          id: `temp-${tradeIdea.id}`,
          simulation_id: simulation?.id,
          trade_queue_item_id: tradeIdea.id,
          asset_id: tradeIdea.asset_id,
          action: tradeIdea.action,
          shares: tradeIdea.proposed_shares,
          weight: tradeIdea.proposed_weight,
          price: tradeIdea.target_price,
          sort_order: (old.simulation_trades?.length || 0),
          assets: tradeIdea.assets,
        }
        return {
          ...old,
          simulation_trades: [...(old.simulation_trades || []), tempTrade],
        }
      })

      return { previousSimulation }
    },
    onError: (_err, _tradeIdea, context) => {
      // Rollback on error
      if (context?.previousSimulation) {
        queryClient.setQueryData(['simulation', selectedSimulationId], context.previousSimulation)
      }
    },
    onSettled: () => {
      // Always refetch after mutation settles
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      refetchPrices()
    },
  })

  // Import entire pair trade (all legs) to simulation
  const importPairTradeMutation = useMutation({
    mutationFn: async (pairTradeLegs: TradeQueueItemWithDetails[]) => {
      if (!simulation) throw new Error('No simulation selected')

      console.log('📥 Importing pair trade with', pairTradeLegs.length, 'legs')

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
        .insert(inserts)
        .select()

      if (error) {
        console.error('❌ Import pair trade error:', error)
        throw error
      }
      console.log('✅ Import pair trade success:', data)
      return data
    },
    onMutate: async (pairTradeLegs) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['simulation', selectedSimulationId] })

      // Snapshot previous value
      const previousSimulation = queryClient.getQueryData(['simulation', selectedSimulationId])

      // Optimistically update - add temporary trades for all legs
      queryClient.setQueryData(['simulation', selectedSimulationId], (old: any) => {
        if (!old) return old
        const tempTrades = pairTradeLegs.map((leg, index) => ({
          id: `temp-${leg.id}`,
          simulation_id: simulation?.id,
          trade_queue_item_id: leg.id,
          asset_id: leg.asset_id,
          action: leg.action,
          shares: leg.proposed_shares,
          weight: leg.proposed_weight,
          price: leg.target_price,
          sort_order: (old.simulation_trades?.length || 0) + index,
          assets: leg.assets,
        }))
        return {
          ...old,
          simulation_trades: [...(old.simulation_trades || []), ...tempTrades],
        }
      })

      return { previousSimulation }
    },
    onError: (_err, _pairTradeLegs, context) => {
      // Rollback on error
      if (context?.previousSimulation) {
        queryClient.setQueryData(['simulation', selectedSimulationId], context.previousSimulation)
      }
    },
    onSettled: () => {
      // Always refetch after mutation settles
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      refetchPrices()
    },
  })

  // Update trade in simulation (sandbox edit - doesn't affect original idea)
  const updateTradeMutation = useMutation({
    mutationFn: async ({ tradeId, shares, weight }: { tradeId: string; shares?: number; weight?: number }) => {
      const { error } = await supabase
        .from('simulation_trades')
        .update({
          shares: shares ?? null,
          weight: weight ?? null,
        })
        .eq('id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
      setEditingTradeId(null)
    },
  })

  // Remove trade from simulation
  const removeTradeMutation = useMutation({
    mutationFn: async (tradeId: string) => {
      const { error } = await supabase
        .from('simulation_trades')
        .delete()
        .eq('id', tradeId)

      if (error) throw error
    },
    onMutate: async (tradeId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['simulation', selectedSimulationId] })

      // Snapshot previous value
      const previousSimulation = queryClient.getQueryData(['simulation', selectedSimulationId])

      // Optimistically remove the trade
      queryClient.setQueryData(['simulation', selectedSimulationId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          simulation_trades: (old.simulation_trades || []).filter((t: any) => t.id !== tradeId),
        }
      })

      return { previousSimulation }
    },
    onError: (_err, _tradeId, context) => {
      // Rollback on error
      if (context?.previousSimulation) {
        queryClient.setQueryData(['simulation', selectedSimulationId], context.previousSimulation)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['simulation', selectedSimulationId] })
    },
  })

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
  // isAdded = has a simulation_trade row (expressed as trade with sizing)
  const tradeIdeasWithStatus = useMemo(() => {
    if (!tradeIdeas) return []
    const expressedAssetIds = new Set(simulation?.simulation_trades?.map(t => t.asset_id) || [])
    return tradeIdeas.map(idea => ({
      ...idea,
      isIncluded: includedIdeaIds?.has(idea.id) || false,
      isAdded: expressedAssetIds.has(idea.asset_id)
    }))
  }, [tradeIdeas, simulation?.simulation_trades, includedIdeaIds])

  // Show all trade ideas for the portfolio (not just included ones)
  // This lets users see all available ideas and add them to the workbench
  const includedIdeasWithStatus = tradeIdeasWithStatus

  // Group pair trades and check their added status (for included ideas only)
  const pairTradesGrouped = useMemo(() => {
    if (!includedIdeasWithStatus.length) return { pairTrades: new Map<string, { pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>(), standalone: includedIdeasWithStatus }

    const pairTradesMap = new Map<string, { pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>()
    const standalone: typeof includedIdeasWithStatus = []

    includedIdeasWithStatus.forEach(idea => {
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
      } else {
        standalone.push(idea)
      }
    })

    return { pairTrades: pairTradesMap, standalone }
  }, [includedIdeasWithStatus])

  // Group trade ideas by status (including pair trades)
  const tradeIdeasByStatus = useMemo(() => {
    const groups = {
      idea: [] as typeof includedIdeasWithStatus,
      discussing: [] as typeof includedIdeasWithStatus,
      simulating: [] as typeof includedIdeasWithStatus,
      approved: [] as typeof includedIdeasWithStatus
    }
    // Only include standalone ideas in the status groups
    pairTradesGrouped.standalone.forEach(idea => {
      if (idea.status === 'idea') groups.idea.push(idea)
      else if (idea.status === 'discussing') groups.discussing.push(idea)
      else if (idea.status === 'simulating') groups.simulating.push(idea)
      else if (idea.status === 'approved') groups.approved.push(idea)
    })
    return groups
  }, [pairTradesGrouped.standalone])

  // Group pair trades by their parent pair trade status
  const pairTradesByStatus = useMemo(() => {
    const groups = {
      idea: [] as Array<{ pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>,
      discussing: [] as Array<{ pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>,
      simulating: [] as Array<{ pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>,
      approved: [] as Array<{ pairTrade: PairTrade; legs: typeof includedIdeasWithStatus; allAdded: boolean; someAdded: boolean }>
    }
    pairTradesGrouped.pairTrades.forEach(entry => {
      const status = entry.pairTrade.status
      if (status === 'idea') groups.idea.push(entry)
      else if (status === 'discussing') groups.discussing.push(entry)
      else if (status === 'simulating') groups.simulating.push(entry)
      else if (status === 'approved') groups.approved.push(entry)
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
  const queueTradeChange = useCallback((baseMode: SimpleSizingMode, value: string) => {
    if (!editingTradeId || !simulation?.simulation_trades) return
    const trade = simulation.simulation_trades.find(t => t.id === editingTradeId)
    if (!trade) return

    // Parse value to detect delta mode from +/- prefix
    const { mode, numValue } = parseEditingValue(value, baseMode)

    // Get baseline and current holding for delta calculations
    const baseline = (simulation.baseline_holdings as BaselineHolding[])
      ?.find(b => b.asset_id === trade.asset_id)
    const currentHolding = metrics?.holdings_after
      ?.find(h => h.asset_id === trade.asset_id)

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

    // Parse value to detect delta mode from +/- prefix
    const { mode, numValue } = parseEditingValue(editingValue, editingSizingMode)

    // Get baseline and current holding for delta calculations
    const baseline = (simulation.baseline_holdings as BaselineHolding[])
      ?.find(b => b.asset_id === trade.asset_id)
    const currentHolding = metrics?.holdings_after
      ?.find(h => h.asset_id === trade.asset_id)

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
    updateTradeMutation.mutate({
      tradeId: editingTradeId,
      shares: resolved.shares ?? undefined,
      weight: resolved.weight ?? undefined,
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

    return (
      <div
        key={idea.id}
        className={clsx(
          "bg-white dark:bg-gray-800 rounded-lg p-3 border transition-colors",
          idea.isAdded
            ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10"
            : "border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600"
        )}
      >
        <div className="flex items-start gap-2">
          {/* Checkbox for added status */}
          <button
            onClick={() => {
              console.log('🔘 Checkbox clicked for:', idea.assets?.symbol, 'isAdded:', idea.isAdded)
              if (idea.isAdded) {
                // Find and remove the trade
                const trade = simulation?.simulation_trades?.find(t => t.asset_id === idea.asset_id)
                console.log('🗑️ Removing trade:', trade?.id)
                if (trade) removeTradeMutation.mutate(trade.id)
              } else {
                console.log('➕ Adding trade idea:', idea.id)
                importTradeMutation.mutate(idea)
              }
            }}
            disabled={importTradeMutation.isPending || removeTradeMutation.isPending}
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

            {/* Non-editing: show size display */}
            {idea.isAdded && sandboxTrade && !isEditingThis ? (
              <div className="mt-1">
                <button
                  onClick={() => sandboxTrade && startEditingTrade(sandboxTrade)}
                  className="text-xs text-gray-500 dark:text-gray-400 truncate hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-1 group"
                >
                  <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  {sandboxTrade.weight != null && `${sandboxTrade.weight}%`}
                  {sandboxTrade.weight != null && sandboxTrade.shares != null && ' · '}
                  {sandboxTrade.shares != null && `${sandboxTrade.shares.toLocaleString()} shares`}
                  {sandboxTrade.weight == null && sandboxTrade.shares == null && (
                    <span className="italic">Set size</span>
                  )}
                </button>
              </div>
            ) : !idea.isAdded ? (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                {idea.proposed_weight ? `${idea.proposed_weight}%` : ''}
                {idea.proposed_weight && idea.proposed_shares ? ' · ' : ''}
                {idea.proposed_shares ? `${idea.proposed_shares} shares` : ''}
              </div>
            ) : null}

          </div>
          {/* Expand button */}
          <button
            onClick={toggleExpand}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <ChevronDown className={clsx("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
          </button>
        </div>

        {/* Editing UI - full width below the header row */}
        {idea.isAdded && sandboxTrade && isEditingThis && (() => {
          const baseline = (simulation?.baseline_holdings as BaselineHolding[])
            ?.find(b => b.asset_id === sandboxTrade.asset_id)
          const currentHolding = metrics?.holdings_after
            ?.find(h => h.asset_id === sandboxTrade.asset_id)
          const modeOption = getSizingModeOption(editingSizingMode)

          // Parse to detect delta and calculate preview
          const { mode: resolvedMode, numValue } = parseEditingValue(editingValue, editingSizingMode)
          const isDelta = resolvedMode.startsWith('delta_')
          const getPreview = () => {
            if (numValue === null) return null
            if (resolvedMode === 'delta_weight') {
              const current = currentHolding?.weight ?? baseline?.weight ?? 0
              return { type: 'weight', to: current + numValue }
            }
            if (resolvedMode === 'delta_shares') {
              const current = currentHolding?.shares ?? baseline?.shares ?? 0
              return { type: 'shares', to: current + numValue }
            }
            return null
          }
          const preview = isDelta ? getPreview() : null

          return (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1">
                <select
                  value={editingSizingMode}
                  onChange={(e) => handleSizingModeChange(e.target.value as SimpleSizingMode)}
                  className="text-xs h-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                >
                  {SIZING_MODE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                      {opt.label}{opt.disabled ? ' (N/A)' : ''}
                    </option>
                  ))}
                </select>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editingValue}
                    onChange={(e) => handleEditingValueChange(e.target.value)}
                    className="w-14 text-xs h-6 pl-1.5 pr-5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                    autoFocus
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 dark:text-gray-500 pointer-events-none">
                    {modeOption.unit}
                  </span>
                </div>
                <button
                  onClick={saveTradeEdit}
                  className="h-6 w-6 bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors flex items-center justify-center"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setEditingTradeId(null)}
                  className="h-6 w-6 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                {baseline ? (
                  <span>Current: {baseline.shares.toLocaleString()} sh ({baseline.weight.toFixed(2)}%)</span>
                ) : (
                  <span className="italic">New position</span>
                )}
                {preview && (
                  <span className="text-primary-600 dark:text-primary-400 ml-1">
                    → {preview.type === 'weight'
                      ? `${preview.to.toFixed(2)}%`
                      : `${preview.to.toLocaleString()} sh`
                    }
                  </span>
                )}
              </div>
            </div>
          )
        })()}

        {/* Expanded content - rationale */}
        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            {idea.rationale ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">{idea.rationale}</p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No rationale provided</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // Render a pair trade card (grouped unit with all legs)
  const renderPairTradeCard = (entry: { pairTrade: PairTrade; legs: typeof tradeIdeasWithStatus; allAdded: boolean; someAdded: boolean }) => {
    const { pairTrade, legs, allAdded, someAdded } = entry

    // Get long and short legs for display
    const longLegs = legs.filter(l => l.pair_leg_type === 'long')
    const shortLegs = legs.filter(l => l.pair_leg_type === 'short')

    const handleTogglePairTrade = () => {
      if (allAdded) {
        // Remove all legs from simulation
        legs.forEach(leg => {
          const trade = simulation?.simulation_trades?.find(t => t.asset_id === leg.asset_id)
          if (trade) removeTradeMutation.mutate(trade.id)
        })
      } else {
        // Add all legs that aren't already added
        const legsToAdd = legs.filter(l => !l.isAdded)
        if (legsToAdd.length > 0) {
          importPairTradeMutation.mutate(legsToAdd)
        }
      }
    }

    return (
      <div
        key={pairTrade.id}
        className={clsx(
          "bg-white dark:bg-gray-800 rounded-lg p-3 border transition-colors relative",
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

        <div className="flex items-start gap-2">
          {/* Checkbox for added status */}
          <button
            onClick={handleTogglePairTrade}
            disabled={importPairTradeMutation.isPending || removeTradeMutation.isPending}
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
            {/* Pairs Trade Header */}
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
              <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                {pairTrade.name || 'Pairs Trade'}
              </span>
            </div>

            {/* Legs display */}
            <div className="space-y-1.5">
              {/* Long legs */}
              {longLegs.map(leg => (
                <div key={leg.id} className="flex items-center gap-2 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium uppercase">
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
                  {leg.isAdded && <Check className="h-3 w-3 text-green-500 ml-auto" />}
                </div>
              ))}

              {/* Short legs */}
              {shortLegs.map(leg => (
                <div key={leg.id} className="flex items-center gap-2 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium uppercase">
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
                  {leg.isAdded && <Check className="h-3 w-3 text-green-500 ml-auto" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
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
                {simulation?.simulation_trades?.length || 0} trades
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
            {/* Create Trade List Button - only show for draft simulations with trades */}
            {simulation?.status === 'draft' && simulation.simulation_trades && simulation.simulation_trades.length > 0 && (
              <Button
                size="sm"
                onClick={() => createTradeListMutation.mutate()}
                disabled={createTradeListMutation.isPending || workbenchSaving}
                loading={createTradeListMutation.isPending}
                title="Create trade list for approval"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Create Trade List
              </Button>
            )}
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
                onClick={() => setSelectedViewType('portfolio')}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  selectedViewType === 'portfolio'
                    ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                )}
              >
                <Users className="h-4 w-4" />
                Portfolio
                {selectedViewType === 'portfolio' && (
                  <span className="ml-1 text-xs text-gray-500 dark:text-gray-400 font-normal">Team</span>
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

            {/* Right: Impact View Toggle (only show for workbench views, not Trade Sheets) */}
            {selectedViewType !== 'lists' && simulation && (
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <button
                    onClick={() => setImpactView('summary')}
                    className={clsx(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      impactView === 'summary'
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    Summary
                  </button>
                  <button
                    onClick={() => setImpactView('holdings')}
                    className={clsx(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      impactView === 'holdings'
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    Holdings
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
                      {metrics?.holdings_after?.filter(h => !h.is_removed).length || 0}
                    </span>
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
                    {(simulation?.simulation_trades?.length || 0) > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
                        {simulation?.simulation_trades?.length || 0}
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
          /* Workbench View - always show for Workspace/Collaborate/Portfolio tabs */
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
                  <div className="flex-1 overflow-y-auto p-3">
                    {(tradeIdeasLoading || tradeIdeasFetching) ? (
                      <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 text-gray-400 animate-spin" />
                      </div>
                    ) : tradeIdeasWithStatus.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        <p className="text-sm">No trade ideas available</p>
                        <p className="text-xs mt-1">Add ideas from the Trade Queue</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Pair Trades Section */}
                        {pairTradesGrouped.pairTrades.size > 0 && (
                          <div>
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedGroups)
                                if (newCollapsed.has('ideas-pairs')) {
                                  newCollapsed.delete('ideas-pairs')
                                } else {
                                  newCollapsed.add('ideas-pairs')
                                }
                                setCollapsedGroups(newCollapsed)
                              }}
                              className="flex items-center gap-2 w-full text-left mb-2 group"
                            >
                              <ChevronDown className={clsx(
                                "h-3 w-3 text-gray-400 transition-transform",
                                collapsedGroups.has('ideas-pairs') && "-rotate-90"
                              )} />
                              <Link2 className="h-3.5 w-3.5 text-purple-500" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Pairs Trades</span>
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{pairTradesGrouped.pairTrades.size}</Badge>
                            </button>
                            {!collapsedGroups.has('ideas-pairs') && (
                              <div className="space-y-2 ml-5">
                                {pairTradesByStatus.approved.map(entry => renderPairTradeCard(entry))}
                                {pairTradesByStatus.discussing.map(entry => renderPairTradeCard(entry))}
                                {pairTradesByStatus.idea.map(entry => renderPairTradeCard(entry))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Approved Section */}
                        {tradeIdeasByStatus.approved.length > 0 && (
                          <div>
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedGroups)
                                if (newCollapsed.has('ideas-approved')) {
                                  newCollapsed.delete('ideas-approved')
                                } else {
                                  newCollapsed.add('ideas-approved')
                                }
                                setCollapsedGroups(newCollapsed)
                              }}
                              className="flex items-center gap-2 w-full text-left mb-2 group"
                            >
                              <ChevronDown className={clsx(
                                "h-3 w-3 text-gray-400 transition-transform",
                                collapsedGroups.has('ideas-approved') && "-rotate-90"
                              )} />
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Approved</span>
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{tradeIdeasByStatus.approved.length}</Badge>
                            </button>
                            {!collapsedGroups.has('ideas-approved') && (
                              <div className="space-y-2 ml-5">
                                {tradeIdeasByStatus.approved.map(idea => renderTradeIdeaCard(idea))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Simulating Section */}
                        {tradeIdeasByStatus.simulating.length > 0 && (
                          <div>
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedGroups)
                                if (newCollapsed.has('ideas-simulating')) {
                                  newCollapsed.delete('ideas-simulating')
                                } else {
                                  newCollapsed.add('ideas-simulating')
                                }
                                setCollapsedGroups(newCollapsed)
                              }}
                              className="flex items-center gap-2 w-full text-left mb-2 group"
                            >
                              <ChevronDown className={clsx(
                                "h-3 w-3 text-gray-400 transition-transform",
                                collapsedGroups.has('ideas-simulating') && "-rotate-90"
                              )} />
                              <Beaker className="h-3.5 w-3.5 text-purple-500" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Simulating</span>
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{tradeIdeasByStatus.simulating.length}</Badge>
                            </button>
                            {!collapsedGroups.has('ideas-simulating') && (
                              <div className="space-y-2 ml-5">
                                {tradeIdeasByStatus.simulating.map(idea => renderTradeIdeaCard(idea))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Discussing Section */}
                        {tradeIdeasByStatus.discussing.length > 0 && (
                          <div>
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedGroups)
                                if (newCollapsed.has('ideas-discussing')) {
                                  newCollapsed.delete('ideas-discussing')
                                } else {
                                  newCollapsed.add('ideas-discussing')
                                }
                                setCollapsedGroups(newCollapsed)
                              }}
                              className="flex items-center gap-2 w-full text-left mb-2 group"
                            >
                              <ChevronDown className={clsx(
                                "h-3 w-3 text-gray-400 transition-transform",
                                collapsedGroups.has('ideas-discussing') && "-rotate-90"
                              )} />
                              <MessageSquare className="h-3.5 w-3.5 text-yellow-500" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Discussing</span>
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{tradeIdeasByStatus.discussing.length}</Badge>
                            </button>
                            {!collapsedGroups.has('ideas-discussing') && (
                              <div className="space-y-2 ml-5">
                                {tradeIdeasByStatus.discussing.map(idea => renderTradeIdeaCard(idea))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Ideas Section */}
                        {tradeIdeasByStatus.idea.length > 0 && (
                          <div>
                            <button
                              onClick={() => {
                                const newCollapsed = new Set(collapsedGroups)
                                if (newCollapsed.has('ideas-idea')) {
                                  newCollapsed.delete('ideas-idea')
                                } else {
                                  newCollapsed.add('ideas-idea')
                                }
                                setCollapsedGroups(newCollapsed)
                              }}
                              className="flex items-center gap-2 w-full text-left mb-2 group"
                            >
                              <ChevronDown className={clsx(
                                "h-3 w-3 text-gray-400 transition-transform",
                                collapsedGroups.has('ideas-idea') && "-rotate-90"
                              )} />
                              <AlertCircle className="h-3.5 w-3.5 text-blue-500" />
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Ideas</span>
                              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{tradeIdeasByStatus.idea.length}</Badge>
                            </button>
                            {!collapsedGroups.has('ideas-idea') && (
                              <div className="space-y-2 ml-5">
                                {tradeIdeasByStatus.idea.map(idea => renderTradeIdeaCard(idea))}
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
                {/* Impact Results Area */}
                <div className="flex-1 overflow-y-auto p-4">
                  {simulation ? (
                  <>
                  {/* Results Content - show immediately, prices load in background */}
                  <div className="space-y-3">
                    {metrics ? (
                      <>
                        {impactView === 'summary' ? (
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
                        ) : impactView === 'holdings' ? (
                          /* Full Holdings Table View with Sandbox Trades */
                          <>
                            {/* Quick Add Trade Form (shown when expanded) */}
                            {showQuickTrade && (
                              <div className="mb-2">
                                <Card className="p-4">
                                  <div className="flex items-center justify-between mb-3">
                                    <span className="text-sm font-medium text-gray-900 dark:text-white">Quick Trade</span>
                                    <button
                                      onClick={() => {
                                        setShowQuickTrade(false)
                                        setQuickTradeSearch('')
                                        setQuickTradeAsset(null)
                                        setQuickTradeShares('')
                                        setQuickTradeWeight('')
                                      }}
                                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                    >
                                      <X className="h-4 w-4 text-gray-500" />
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap items-end gap-3">
                                    {/* Asset Search */}
                                    <div className="relative flex-1 min-w-[200px]">
                                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Asset</label>
                                      {quickTradeAsset ? (
                                        <div className="flex items-center justify-between px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700">
                                          <div>
                                            <span className="font-medium text-gray-900 dark:text-white">{quickTradeAsset.symbol}</span>
                                            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2 truncate">{quickTradeAsset.company_name}</span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setQuickTradeAsset(null)
                                              setQuickTradeSearch('')
                                            }}
                                            className="text-xs text-primary-600 hover:text-primary-700"
                                          >
                                            Change
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="relative">
                                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                          <Input
                                            placeholder="Search symbol..."
                                            value={quickTradeSearch}
                                            onChange={(e) => setQuickTradeSearch(e.target.value)}
                                            className="pl-9"
                                          />
                                          {quickTradeAssets && quickTradeAssets.length > 0 && quickTradeSearch && (
                                            <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                              {quickTradeAssets.map(asset => (
                                                <button
                                                  key={asset.id}
                                                  type="button"
                                                  onClick={() => {
                                                    setQuickTradeAsset(asset)
                                                    setQuickTradeSearch('')
                                                  }}
                                                  className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
                                                >
                                                  <span className="font-medium text-gray-900 dark:text-white">{asset.symbol}</span>
                                                  <span className="text-gray-500 dark:text-gray-400 ml-2">{asset.company_name}</span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    {/* Action */}
                                    <div className="w-32">
                                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Action</label>
                                      <div className="flex gap-1">
                                        {(['buy', 'sell'] as TradeAction[]).map(a => (
                                          <button
                                            key={a}
                                            type="button"
                                            onClick={() => setQuickTradeAction(a)}
                                            className={clsx(
                                              "flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg border transition-colors capitalize text-sm",
                                              quickTradeAction === a
                                                ? a === 'buy'
                                                  ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                                  : "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                                                : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                                            )}
                                          >
                                            {a === 'buy' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                                            {a}
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    {/* Shares or Weight */}
                                    <div className="w-24">
                                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Shares</label>
                                      <Input
                                        type="number"
                                        placeholder="1000"
                                        value={quickTradeShares}
                                        onChange={(e) => setQuickTradeShares(e.target.value)}
                                      />
                                    </div>
                                    <div className="w-20">
                                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Weight %</label>
                                      <Input
                                        type="number"
                                        step="0.1"
                                        placeholder="2.5"
                                        value={quickTradeWeight}
                                        onChange={(e) => setQuickTradeWeight(e.target.value)}
                                      />
                                    </div>

                                    {/* Add Button */}
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        if (!quickTradeAsset) return
                                        addQuickTradeMutation.mutate({
                                          asset: quickTradeAsset,
                                          action: quickTradeAction,
                                          shares: quickTradeShares ? parseFloat(quickTradeShares) : undefined,
                                          weight: quickTradeWeight ? parseFloat(quickTradeWeight) : undefined,
                                        })
                                      }}
                                      disabled={!quickTradeAsset || addQuickTradeMutation.isPending}
                                      loading={addQuickTradeMutation.isPending}
                                    >
                                      Add
                                    </Button>
                                  </div>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                    This adds a sandbox-only trade. It won't create a trade idea.
                                  </p>
                                </Card>
                              </div>
                            )}

                          <Card className="overflow-hidden">
                            {/* Sandbox Trade Summary Header */}
                            {tradeStats.total > 0 && (
                              <div className="px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-b border-amber-200 dark:border-amber-800">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                      <Beaker className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                      <span className="font-medium text-amber-900 dark:text-amber-100">
                                        Sandbox Trades
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm">
                                      <span className="text-gray-600 dark:text-gray-400">
                                        {tradeStats.total} changes
                                      </span>
                                      {tradeStats.buys > 0 && (
                                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                          <ArrowUpRight className="h-3.5 w-3.5" />
                                          {tradeStats.buys} buy{tradeStats.buys !== 1 ? 's' : ''}
                                        </span>
                                      )}
                                      {tradeStats.sells > 0 && (
                                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                                          <ArrowDownRight className="h-3.5 w-3.5" />
                                          {tradeStats.sells} sell{tradeStats.sells !== 1 ? 's' : ''}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <span className="text-xs text-amber-700 dark:text-amber-300">
                                    Click action badges to edit
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Grouping Options */}
                            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/30 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <FolderOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                                <span className="text-sm text-gray-600 dark:text-gray-400">Group by:</span>
                                <select
                                  value={holdingsGroupBy}
                                  onChange={(e) => {
                                    setHoldingsGroupBy(e.target.value as 'none' | 'sector' | 'action' | 'change')
                                    setCollapsedGroups(new Set())
                                  }}
                                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                                >
                                  <option value="none">None</option>
                                  <option value="sector">Sector</option>
                                  <option value="action">Trade Action</option>
                                  <option value="change">Weight Change</option>
                                </select>
                              </div>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {metrics.holdings_after.filter(h => !h.is_removed).length} active positions
                              </span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50 dark:bg-gray-700/50">
                                  <tr>
                                    <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Symbol</th>
                                    <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Company</th>
                                    <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Sector</th>
                                    <th className="px-4 py-3 text-center font-medium text-gray-700 dark:text-gray-300">Trade</th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">Shares</th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">Price</th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">Value</th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">Base Wt%</th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">New Wt%</th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">Change</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                  {groupedHoldings ? (
                                    // Grouped view
                                    groupedHoldings.map((group) => {
                                      const isCollapsed = collapsedGroups.has(group.name)
                                      return (
                                        <React.Fragment key={`group-${group.name}`}>
                                          {/* Group Header */}
                                          <tr
                                            className="bg-gray-100 dark:bg-gray-700/50 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
                                            onClick={() => toggleGroupCollapse(group.name)}
                                          >
                                            <td colSpan={10} className="px-4 py-2">
                                              <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                  <ChevronDown className={clsx(
                                                    "h-4 w-4 text-gray-500 transition-transform",
                                                    isCollapsed && "-rotate-90"
                                                  )} />
                                                  <span className="font-medium text-gray-900 dark:text-white">{group.name}</span>
                                                  <span className="text-sm text-gray-500 dark:text-gray-400">
                                                    ({group.count} position{group.count !== 1 ? 's' : ''})
                                                  </span>
                                                </div>
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                  {group.totalWeight.toFixed(1)}% weight
                                                </span>
                                              </div>
                                            </td>
                                          </tr>
                                          {/* Group Holdings */}
                                          {!isCollapsed && group.holdings.map((holding) => {
                                            const baseline = (simulation.baseline_holdings as BaselineHolding[]).find(
                                              b => b.asset_id === holding.asset_id
                                            )
                                            const baseWeight = baseline?.weight || 0
                                            const weightChange = holding.weight - baseWeight
                                            const trade = simulation.simulation_trades?.find(t => t.asset_id === holding.asset_id)
                                            const isEditing = editingTradeId === trade?.id

                                            return (
                                              <tr
                                                key={holding.asset_id}
                                                className={clsx(
                                                  "hover:bg-gray-50 dark:hover:bg-gray-700/30 group",
                                                  holding.is_new && !holding.is_short && "bg-green-50 dark:bg-green-900/10",
                                                  holding.is_short && "bg-purple-50 dark:bg-purple-900/10",
                                                  holding.is_removed && "bg-red-50 dark:bg-red-900/10 opacity-60"
                                                )}
                                              >
                                                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white pl-8">
                                                  <div className="flex items-center gap-2">
                                                    {holding.symbol}
                                                    {holding.is_short && (
                                                      <span className="text-xs font-medium px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded">
                                                        SHORT
                                                      </span>
                                                    )}
                                                  </div>
                                                </td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">
                                                  {holding.company_name}
                                                </td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                                                  {holding.sector || '—'}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                  {trade ? (
                                                    isEditing ? (
                                                      <div className="flex items-center gap-1 justify-center">
                                                        <select
                                                          value={editingSizingMode}
                                                          onChange={(e) => handleSizingModeChange(e.target.value as SimpleSizingMode)}
                                                          className="text-[10px] h-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-0.5"
                                                        >
                                                          {SIZING_MODE_OPTIONS.map(opt => (
                                                            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                                                              {opt.label}{opt.disabled ? ' (N/A)' : ''}
                                                            </option>
                                                          ))}
                                                        </select>
                                                        <div className="relative">
                                                          <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            value={editingValue}
                                                            onChange={(e) => handleEditingValueChange(e.target.value)}
                                                            className="w-12 text-xs h-6 pl-1 pr-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                                                            autoFocus
                                                          />
                                                          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-gray-400">
                                                            {getSizingModeOption(editingSizingMode).unit}
                                                          </span>
                                                        </div>
                                                        <button
                                                          onClick={saveTradeEdit}
                                                          className="p-1 bg-primary-500 text-white rounded hover:bg-primary-600"
                                                        >
                                                          <Check className="h-3 w-3" />
                                                        </button>
                                                        <button
                                                          onClick={() => setEditingTradeId(null)}
                                                          className="p-1 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
                                                        >
                                                          <X className="h-3 w-3" />
                                                        </button>
                                                      </div>
                                                    ) : (
                                                      <div className="flex items-center gap-1 justify-center">
                                                        <button
                                                          onClick={() => canEdit && startEditingTrade(trade)}
                                                          className={clsx(
                                                            "text-xs font-medium uppercase px-2 py-1 rounded flex items-center gap-1",
                                                            trade.action === 'buy' || trade.action === 'add'
                                                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                                                            canEdit && "hover:ring-2 hover:ring-offset-1 hover:ring-primary-400 cursor-pointer"
                                                          )}
                                                          title={canEdit ? "Click to edit" : undefined}
                                                        >
                                                          {trade.action}
                                                          {trade.shares && <span className="font-normal">({trade.shares.toLocaleString()})</span>}
                                                        </button>
                                                        {canEdit && (
                                                          <button
                                                            onClick={() => removeTradeMutation.mutate(trade.id)}
                                                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-opacity"
                                                            title="Remove trade"
                                                          >
                                                            <X className="h-3 w-3 text-red-500" />
                                                          </button>
                                                        )}
                                                      </div>
                                                    )
                                                  ) : (
                                                    <span className="text-gray-400 text-xs">—</span>
                                                  )}
                                                </td>
                                                <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono">
                                                  {holding.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono">
                                                  ${holding.price.toFixed(2)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono">
                                                  ${holding.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                                                  {baseWeight.toFixed(2)}%
                                                </td>
                                                <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono font-medium">
                                                  {holding.weight.toFixed(2)}%
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono">
                                                  <span className={clsx(
                                                    "inline-flex items-center gap-0.5",
                                                    weightChange > 0.01 ? "text-green-600 dark:text-green-400" :
                                                    weightChange < -0.01 ? "text-red-600 dark:text-red-400" :
                                                    "text-gray-500"
                                                  )}>
                                                    {weightChange > 0.01 ? (
                                                      <ArrowUpRight className="h-3 w-3" />
                                                    ) : weightChange < -0.01 ? (
                                                      <ArrowDownRight className="h-3 w-3" />
                                                    ) : (
                                                      <Minus className="h-3 w-3" />
                                                    )}
                                                    {weightChange > 0 ? '+' : ''}{weightChange.toFixed(2)}%
                                                  </span>
                                                </td>
                                              </tr>
                                            )
                                          })}
                                        </React.Fragment>
                                      )
                                    })
                                  ) : (
                                    // Ungrouped view
                                    metrics.holdings_after.map((holding) => {
                                      const baseline = (simulation.baseline_holdings as BaselineHolding[]).find(
                                        b => b.asset_id === holding.asset_id
                                      )
                                      const baseWeight = baseline?.weight || 0
                                      const weightChange = holding.weight - baseWeight
                                      const trade = simulation.simulation_trades?.find(t => t.asset_id === holding.asset_id)
                                      const isEditing = editingTradeId === trade?.id

                                      return (
                                        <tr
                                          key={holding.asset_id}
                                          className={clsx(
                                            "hover:bg-gray-50 dark:hover:bg-gray-700/30 group",
                                            holding.is_new && !holding.is_short && "bg-green-50 dark:bg-green-900/10",
                                            holding.is_short && "bg-purple-50 dark:bg-purple-900/10",
                                            holding.is_removed && "bg-red-50 dark:bg-red-900/10 opacity-60"
                                          )}
                                        >
                                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                                            <div className="flex items-center gap-2">
                                              {holding.symbol}
                                              {holding.is_short && (
                                                <span className="text-xs font-medium px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded">
                                                  SHORT
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">
                                            {holding.company_name}
                                          </td>
                                          <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                                            {holding.sector || '—'}
                                          </td>
                                          <td className="px-4 py-3 text-center">
                                            {trade ? (
                                              isEditing ? (
                                                <div className="flex items-center gap-1 justify-center">
                                                  <select
                                                    value={editingSizingMode}
                                                    onChange={(e) => handleSizingModeChange(e.target.value as SimpleSizingMode)}
                                                    className="text-[10px] h-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-0.5"
                                                  >
                                                    {SIZING_MODE_OPTIONS.map(opt => (
                                                      <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                      </option>
                                                    ))}
                                                  </select>
                                                  <div className="relative">
                                                    <input
                                                      type="text"
                                                      inputMode="numeric"
                                                      value={editingValue}
                                                      onChange={(e) => handleEditingValueChange(e.target.value)}
                                                      className="w-16 text-xs h-6 pl-1.5 pr-5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                                                      placeholder={getSizingModeOption(editingSizingMode).placeholder}
                                                      autoFocus
                                                    />
                                                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-gray-400">
                                                      {getSizingModeOption(editingSizingMode).unit}
                                                    </span>
                                                  </div>
                                                  <button
                                                    onClick={saveTradeEdit}
                                                    className="p-1 bg-primary-500 text-white rounded hover:bg-primary-600"
                                                  >
                                                    <Check className="h-3 w-3" />
                                                  </button>
                                                  <button
                                                    onClick={() => setEditingTradeId(null)}
                                                    className="p-1 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
                                                  >
                                                    <X className="h-3 w-3" />
                                                  </button>
                                                </div>
                                              ) : (
                                                <div className="flex items-center gap-1 justify-center">
                                                  <button
                                                    onClick={() => canEdit && startEditingTrade(trade)}
                                                    className={clsx(
                                                      "text-xs font-medium uppercase px-2 py-1 rounded flex items-center gap-1",
                                                      trade.action === 'buy' || trade.action === 'add'
                                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                                                      canEdit && "hover:ring-2 hover:ring-offset-1 hover:ring-primary-400 cursor-pointer"
                                                    )}
                                                    title={canEdit ? "Click to edit" : undefined}
                                                  >
                                                    {trade.action}
                                                    {trade.shares && <span className="font-normal">({trade.shares.toLocaleString()})</span>}
                                                  </button>
                                                  {canEdit && (
                                                    <button
                                                      onClick={() => removeTradeMutation.mutate(trade.id)}
                                                      className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-opacity"
                                                      title="Remove trade"
                                                    >
                                                      <X className="h-3 w-3 text-red-500" />
                                                    </button>
                                                  )}
                                                </div>
                                              )
                                            ) : (
                                              <span className="text-gray-400 text-xs">—</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono">
                                            {holding.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                          </td>
                                          <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono">
                                            ${holding.price.toFixed(2)}
                                          </td>
                                          <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono">
                                            ${holding.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                          </td>
                                          <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                                            {baseWeight.toFixed(2)}%
                                          </td>
                                          <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono font-medium">
                                            {holding.weight.toFixed(2)}%
                                          </td>
                                          <td className="px-4 py-3 text-right font-mono">
                                            <span className={clsx(
                                              "inline-flex items-center gap-0.5",
                                              weightChange > 0.01 ? "text-green-600 dark:text-green-400" :
                                              weightChange < -0.01 ? "text-red-600 dark:text-red-400" :
                                              "text-gray-500"
                                            )}>
                                              {weightChange > 0.01 ? (
                                                <ArrowUpRight className="h-3 w-3" />
                                              ) : weightChange < -0.01 ? (
                                                <ArrowDownRight className="h-3 w-3" />
                                              ) : (
                                                <Minus className="h-3 w-3" />
                                              )}
                                              {weightChange > 0 ? '+' : ''}{weightChange.toFixed(2)}%
                                            </span>
                                          </td>
                                        </tr>
                                      )
                                    })
                                  )}
                                </tbody>
                                <tfoot className="bg-gray-100 dark:bg-gray-700 font-medium">
                                  <tr>
                                    <td className="px-4 py-3 text-gray-900 dark:text-white" colSpan={4}>
                                      Total ({metrics.holdings_after.length} positions)
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono" colSpan={2}>
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono">
                                      ${metrics.total_value_after.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                                      100.00%
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-mono">
                                      100.00%
                                    </td>
                                    <td className="px-4 py-3"></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </Card>
                          </>
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
                      </>
                    ) : (
                      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
                        <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-primary-50 dark:from-primary-900/30 dark:to-primary-900/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                          <Layers className="h-10 w-10 text-primary-600 dark:text-primary-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                          Add Trades to See Impact
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                          Import trade ideas from the left panel or add custom trades.
                          Results will update automatically as you make changes.
                        </p>
                        <button
                          onClick={() => setShowQuickTrade(true)}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Add Quick Trade
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
