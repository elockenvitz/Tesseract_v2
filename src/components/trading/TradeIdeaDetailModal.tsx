import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import {
  X,
  MessageSquare,
  Send,
  Edit2,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  RotateCcw,
  Pin,
  Reply,
  MessageCircle,
  Link2,
  Scale,
  FlaskConical,
  Wrench,
  Trash2,
  AlertTriangle,
  History,
  ChevronDown,
  ChevronRight,
  Lock,
  Users,
  Target,
  Gauge,
  Save,
  Pencil,
  Plus,
  Check,
  Briefcase
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { DatePicker } from '../ui/DatePicker'
import { ContextTagsInput, type ContextTag, type ContextTagEntityType } from '../ui/ContextTagsInput'
import { useTradeExpressionCounts } from '../../hooks/useTradeExpressionCounts'
import { useTradeIdeaService } from '../../hooks/useTradeIdeaService'
import { EntityTimeline } from '../audit/EntityTimeline'
import { getIdeaLabLinks, updateIdeaLinkSizing, linkIdeaToLab, unlinkIdeaFromLab, getProposalsForTradeIdea, upsertProposal, getPortfolioTracksForIdea, updatePortfolioTrackDecision } from '../../lib/services/trade-lab-service'
import type { ActionContext, DecisionOutcome, UpdatePortfolioTrackInput, TradeSizingMode } from '../../types/trading'
import { UniversalSmartInput, SmartInputRenderer, type SmartInputMetadata } from '../smart-input'
import type { UniversalSmartInputRef } from '../smart-input'
import type {
  TradeQueueItemWithDetails,
  TradeQueueStatus
} from '../../types/trading'
import { clsx } from 'clsx'
import { PairTradeLegEditor } from './PairTradeLegEditor'

type ModalTab = 'details' | 'discussion' | 'proposals' | 'activity'

interface TradeIdeaDetailModalProps {
  isOpen: boolean
  tradeId: string
  onClose: () => void
  initialTab?: ModalTab
}

const STATUS_CONFIG: Record<TradeQueueStatus, { label: string; color: string }> = {
  idea: { label: 'Ideas', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  // New workflow stages
  working_on: { label: 'Working On', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  modeling: { label: 'Modeling', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  // Legacy stages (kept for backwards compat)
  discussing: { label: 'Working On', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  simulating: { label: 'Modeling', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  deciding: { label: 'Deciding', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  approved: { label: 'Committed', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: 'Deferred', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' },
  executed: { label: 'Executed', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  deleted: { label: 'Deleted', color: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
}

export function TradeIdeaDetailModal({ isOpen, tradeId, onClose, initialTab = 'details' }: TradeIdeaDetailModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const discussionInputRef = useRef<UniversalSmartInputRef>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [activeTab, setActiveTab] = useState<ModalTab>(initialTab)

  // Reset tab when modal opens or initialTab changes
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab)
    }
  }, [isOpen, initialTab])

  const [discussionMessage, setDiscussionMessage] = useState('')
  const [, setDiscussionMetadata] = useState<SmartInputMetadata>({ mentions: [], references: [], dataSnapshots: [], aiContent: [] })
  const [replyToMessage, setReplyToMessage] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  // Portfolio context for discussion messages
  const [discussionPortfolioFilter, setDiscussionPortfolioFilter] = useState<string | null>(null) // null = all, 'general' = no portfolio, or portfolio_id
  const [messagePortfolioContext, setMessagePortfolioContext] = useState<string | null>(null) // portfolio_id for the message being composed
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeferModal, setShowDeferModal] = useState(false)
  const [deferUntilDate, setDeferUntilDate] = useState<string | null>(null)
  const [showProposalModal, setShowProposalModal] = useState(false)
  const [proposalWeight, setProposalWeight] = useState<string>('')
  const [proposalShares, setProposalShares] = useState<string>('')
  const [proposalNotes, setProposalNotes] = useState<string>('')
  const [proposalPortfolioId, setProposalPortfolioId] = useState<string>('')
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false)

  // Enhanced proposal state for inline editing (mimics submit proposal modal)
  type ProposalSizingMode = 'weight' | 'delta_weight' | 'active_weight' | 'delta_benchmark'
  interface InlineProposalState {
    sizingMode: ProposalSizingMode
    value: string
    notes: string
  }
  const [inlineProposals, setInlineProposals] = useState<Record<string, InlineProposalState>>({})
  const [expandedProposalInputs, setExpandedProposalInputs] = useState<Set<string>>(new Set())

  // Pair trade proposal editing state
  const [editingPairProposalId, setEditingPairProposalId] = useState<string | null>(null)
  const [editedPairProposalLegs, setEditedPairProposalLegs] = useState<Array<{ assetId: string; symbol: string; action: string; weight: number | null; sizingMode: string }>>([])
  const [isSavingPairProposal, setIsSavingPairProposal] = useState(false)
  // Track which field is the "source" for each leg (the field user entered, others are auto-calc)
  // Key format: `${portfolioId}-${legIdx}`, value: 'target' | 'deltaPort' | 'deltaBench'
  const [pairProposalSourceFields, setPairProposalSourceFields] = useState<Record<string, 'target' | 'deltaPort' | 'deltaBench'>>({})

  // Portfolio context with holdings info
  interface PortfolioContext {
    id: string
    name: string
    benchmark: string | null
    currentShares: number
    currentPrice: number
    currentValue: number
    currentWeight: number
    benchmarkWeight: number | null
    activeWeight: number | null
    portfolioTotalValue: number
  }
  const [portfolioContexts, setPortfolioContexts] = useState<PortfolioContext[]>([])
  const [isLabsExpanded, setIsLabsExpanded] = useState(false)
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)
  const [showVisibilityDropdown, setShowVisibilityDropdown] = useState(false)
  const priorityDropdownRef = useRef<HTMLDivElement>(null)
  const visibilityDropdownRef = useRef<HTMLDivElement>(null)

  // Section edit states
  const [isEditingRationale, setIsEditingRationale] = useState(false)
  const [editedRationale, setEditedRationale] = useState('')
  const [isEditingSizing, setIsEditingSizing] = useState(false)
  const [editedSizing, setEditedSizing] = useState<{
    proposedWeight: string
    proposedShares: string
    targetPrice: string
    stopLoss: string
    takeProfit: string
  }>({ proposedWeight: '', proposedShares: '', targetPrice: '', stopLoss: '', takeProfit: '' })
  const [isEditingRisk, setIsEditingRisk] = useState(false)
  const [editedRisk, setEditedRisk] = useState<{
    conviction: 'low' | 'medium' | 'high' | null
    timeHorizon: 'short' | 'medium' | 'long' | null
  }>({ conviction: null, timeHorizon: null })
  const [isEditingTags, setIsEditingTags] = useState(false)
  const [editedTags, setEditedTags] = useState<ContextTag[]>([])

  // Collapsible sections - collapsed by default
  const [isSizingExpanded, setIsSizingExpanded] = useState(false)
  const [isRiskExpanded, setIsRiskExpanded] = useState(false)

  // Per-portfolio sizing state
  type SizingMode = 'absolute' | 'relative_current' | 'relative_benchmark'
  const [sizingMode, setSizingMode] = useState<SizingMode>('absolute')

  // Per-portfolio targets - stores ABSOLUTE values internally
  // Display converts based on sizingMode, input converts back to absolute
  const [portfolioTargets, setPortfolioTargets] = useState<Record<string, {
    absoluteWeight: number | null
    absoluteShares: number | null
    sourceField: 'weight' | 'shares' | null
  }>>({})
  const [activeInput, setActiveInput] = useState<{
    portfolioId: string
    field: 'weight' | 'shares'
    rawValue: string
  } | null>(null)

  // Portfolio management state
  const [isManagingPortfolios, setIsManagingPortfolios] = useState(false)

  // Portfolio decision state (for portfolio-scoped Accept/Defer/Reject)
  const [showPortfolioDecisionPicker, setShowPortfolioDecisionPicker] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<DecisionOutcome | null>(null)
  const [selectedDecisionPortfolioId, setSelectedDecisionPortfolioId] = useState<string | null>(null)

  // Assignment state
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false)
  const [showCollaboratorsDropdown, setShowCollaboratorsDropdown] = useState(false)
  const assigneeDropdownRef = useRef<HTMLDivElement>(null)
  const collaboratorsDropdownRef = useRef<HTMLDivElement>(null)

  // Pair trade specific edit states
  const [isEditingPairReferenceLevels, setIsEditingPairReferenceLevels] = useState(false)
  const [editedPairReferenceLevels, setEditedPairReferenceLevels] = useState<Record<string, {
    targetPrice: string
    stopLoss: string
    takeProfit: string
  }>>({})
  const [isEditingPairConviction, setIsEditingPairConviction] = useState(false)
  const [editedPairConviction, setEditedPairConviction] = useState<'low' | 'medium' | 'high' | null>(null)
  const [editedPairTimeHorizon, setEditedPairTimeHorizon] = useState<'short' | 'medium' | 'long' | null>(null)
  const [showTeamProposals, setShowTeamProposals] = useState(false)

  // Get expression counts for trade ideas (prefetch)
  useTradeExpressionCounts()

  // Fetch trade details - check pair_trades, trade_queue_items by id, and trade_queue_items by pair_id
  const { data: tradeData, isLoading } = useQuery({
    queryKey: ['trade-detail', tradeId],
    queryFn: async () => {
      // First try to fetch as a pair trade from pair_trades table
      const { data: pairTrade } = await supabase
        .from('pair_trades')
        .select(`
          *,
          portfolios:portfolio_id (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          trade_queue_items!trade_queue_items_pair_trade_id_fkey (
            *,
            assets:asset_id (id, symbol, company_name, sector)
          )
        `)
        .eq('id', tradeId)
        .maybeSingle()

      if (pairTrade) {
        return { type: 'pair' as const, data: pairTrade }
      }

      // Try to fetch individual trade item by id
      const { data: tradeItem, error: tradeError } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          assigned_user:assigned_to (id, email, first_name, last_name)
        `)
        .eq('id', tradeId)
        .maybeSingle()

      if (tradeError) throw tradeError
      if (tradeItem) {
        // If this trade item has a pair_id, fetch all legs of the pair trade
        if (tradeItem.pair_id) {
          const { data: pairLegs, error: pairLegsError } = await supabase
            .from('trade_queue_items')
            .select(`
              *,
              assets (id, symbol, company_name, sector),
              portfolios (id, name, portfolio_id),
              users:created_by (id, email, first_name, last_name),
              assigned_user:assigned_to (id, email, first_name, last_name)
            `)
            .eq('pair_id', tradeItem.pair_id)
            .eq('visibility_tier', 'active')

          if (!pairLegsError && pairLegs && pairLegs.length > 1) {
            // Build a synthetic pair trade object from the legs
            const firstLeg = pairLegs[0]
            return {
              type: 'pair_from_legs' as const,
              data: {
                id: tradeItem.pair_id,
                name: 'Pairs Trade',
                rationale: firstLeg.rationale,
                urgency: firstLeg.urgency,
                status: firstLeg.status,
                stage: firstLeg.stage,
                created_at: firstLeg.created_at,
                created_by: firstLeg.created_by,
                portfolios: firstLeg.portfolios,
                users: firstLeg.users,
                sharing_visibility: firstLeg.sharing_visibility,
                assigned_to: firstLeg.assigned_to,
                assigned_user: firstLeg.assigned_user,
                collaborators: firstLeg.collaborators,
                legs: pairLegs
              }
            }
          }
        }
        return { type: 'single' as const, data: tradeItem as TradeQueueItemWithDetails }
      }

      // Finally, try to fetch as a pair trade by pair_id (for pair trades without pair_trades table entry)
      const { data: pairLegs, error: pairLegsError } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          assigned_user:assigned_to (id, email, first_name, last_name)
        `)
        .eq('pair_id', tradeId)
        .eq('visibility_tier', 'active')

      if (pairLegsError) throw pairLegsError
      if (pairLegs && pairLegs.length > 0) {
        // Build a synthetic pair trade object from the legs
        const firstLeg = pairLegs[0]
        return {
          type: 'pair_from_legs' as const,
          data: {
            id: tradeId,
            name: 'Pairs Trade',
            rationale: firstLeg.rationale,
            urgency: firstLeg.urgency,
            status: firstLeg.status,
            created_at: firstLeg.created_at,
            created_by: firstLeg.created_by,
            portfolios: firstLeg.portfolios,
            users: firstLeg.users,
            sharing_visibility: firstLeg.sharing_visibility,
            legs: pairLegs
          }
        }
      }

      return null
    },
    enabled: isOpen,
  })

  // Extract trade for backwards compatibility with existing UI
  const trade = tradeData?.type === 'single' ? tradeData.data : null
  const pairTrade = tradeData?.type === 'pair' ? tradeData.data : null
  const pairFromLegs = tradeData?.type === 'pair_from_legs' ? tradeData.data : null

  // Combined pair trade data (from either source)
  const isPairTrade = !!(pairTrade || pairFromLegs)
  const pairTradeData = pairTrade || pairFromLegs

  // State for pair trade sizing mode
  const [pairTradeSizingMode, setPairTradeSizingMode] = useState<'absolute' | 'relative_current' | 'relative_benchmark'>('absolute')

  // Per-leg targets for pair trade - stores ABSOLUTE values internally
  const [pairTradeLegTargets, setPairTradeLegTargets] = useState<Record<string, {
    absoluteWeight: number | null
    absoluteShares: number | null
    sourceField: 'weight' | 'shares' | null
  }>>({})

  // Active input tracking for pair trade sizing
  const [pairTradeActiveInput, setPairTradeActiveInput] = useState<{
    legId: string
    field: 'weight' | 'shares'
    rawValue: string
  } | null>(null)

  // Fetch portfolio holdings for pair trade legs (for sizing context)
  const pairTradeLegAssetIds = isPairTrade
    ? (pairTradeData?.trade_queue_items || pairTradeData?.legs || []).map((leg: any) => leg.asset_id).filter(Boolean)
    : []
  const pairTradePortfolioId = pairTradeData?.portfolio_id || pairTradeData?.portfolios?.id || ''

  const { data: pairTradeHoldings } = useQuery({
    queryKey: ['pair-trade-holdings', pairTradeLegAssetIds, pairTradePortfolioId],
    queryFn: async () => {
      if (pairTradeLegAssetIds.length === 0) return { holdings: {}, portfolioAum: 0 }

      // Get current prices from assets table for all leg assets
      const { data: assetPrices, error: priceError } = await supabase
        .from('assets')
        .select('id, current_price')
        .in('id', pairTradeLegAssetIds)

      if (priceError) throw priceError

      // Build price map
      const priceMap: Record<string, number> = {}
      assetPrices?.forEach(a => {
        priceMap[a.id] = a.current_price || 0
      })

      // Get holdings for leg assets in the portfolio (if portfolio exists)
      let assetHoldings: { asset_id: string; shares: number; price: number }[] = []
      let portfolioAum = 0

      if (pairTradePortfolioId) {
        const { data: holdings, error: holdingsError } = await supabase
          .from('portfolio_holdings')
          .select('asset_id, shares, price')
          .eq('portfolio_id', pairTradePortfolioId)
          .in('asset_id', pairTradeLegAssetIds)

        if (holdingsError) throw holdingsError
        assetHoldings = holdings || []

        // Get total portfolio value (AUM)
        const { data: allHoldings, error: allError } = await supabase
          .from('portfolio_holdings')
          .select('shares, price')
          .eq('portfolio_id', pairTradePortfolioId)

        if (allError) throw allError

        portfolioAum = allHoldings?.reduce((sum, h) => sum + (h.shares * h.price), 0) || 0
      }

      // Build holdings map by asset_id, using asset prices as fallback
      const holdingsMap: Record<string, { shares: number; price: number; weight: number; marketValue: number }> = {}

      // First, add entries for all leg assets with prices from assets table
      pairTradeLegAssetIds.forEach(assetId => {
        const price = priceMap[assetId] || 0
        holdingsMap[assetId] = {
          shares: 0,
          price,
          marketValue: 0,
          weight: 0,
        }
      })

      // Then overlay with actual holdings data if available
      assetHoldings?.forEach(h => {
        const price = h.price || priceMap[h.asset_id] || 0
        const marketValue = h.shares * price
        holdingsMap[h.asset_id] = {
          shares: h.shares,
          price,
          marketValue,
          weight: portfolioAum > 0 ? (marketValue / portfolioAum) * 100 : 0,
        }
      })

      return { holdings: holdingsMap, portfolioAum }
    },
    enabled: isOpen && isPairTrade && pairTradeLegAssetIds.length > 0,
  })

  // Initialize pair trade leg targets from leg data
  useEffect(() => {
    if (isPairTrade && pairTradeData) {
      const legs = pairTradeData.trade_queue_items || pairTradeData.legs || []
      const targets: Record<string, { absoluteWeight: number | null; absoluteShares: number | null; sourceField: 'weight' | 'shares' | null }> = {}
      legs.forEach((leg: any) => {
        if (leg.proposed_weight !== null || leg.proposed_shares !== null) {
          targets[leg.id] = {
            absoluteWeight: leg.proposed_weight,
            absoluteShares: leg.proposed_shares,
            sourceField: leg.proposed_weight !== null ? 'weight' : (leg.proposed_shares !== null ? 'shares' : null),
          }
        }
      })
      setPairTradeLegTargets(targets)
    }
  }, [isPairTrade, pairTradeData])

  // Helper: Get display value for pair trade leg weight based on sizing mode
  const getPairTradeDisplayWeight = (legId: string, assetId: string): string => {
    const target = pairTradeLegTargets[legId]
    if (target?.absoluteWeight === null || target?.absoluteWeight === undefined) return ''

    const holding = pairTradeHoldings?.holdings?.[assetId]
    const currentWeight = holding?.weight || 0
    const benchWeight = 0 // TODO: fetch from benchmark

    switch (pairTradeSizingMode) {
      case 'absolute':
        return target.absoluteWeight.toFixed(2)
      case 'relative_current':
        return (target.absoluteWeight - currentWeight).toFixed(2)
      case 'relative_benchmark':
        return (target.absoluteWeight - benchWeight).toFixed(2)
      default:
        return target.absoluteWeight.toFixed(2)
    }
  }

  // Helper: Get display value for pair trade leg shares based on sizing mode
  const getPairTradeDisplayShares = (legId: string, assetId: string): string => {
    const target = pairTradeLegTargets[legId]
    if (target?.absoluteShares === null || target?.absoluteShares === undefined) return ''

    const holding = pairTradeHoldings?.holdings?.[assetId]
    const currentShares = holding?.shares || 0
    const price = holding?.price || 0
    const portfolioAum = pairTradeHoldings?.portfolioAum || 0
    const benchWeight = 0 // TODO: fetch from benchmark
    const benchShares = (price > 0 && portfolioAum > 0) ? Math.round((benchWeight / 100) * portfolioAum / price) : 0

    switch (pairTradeSizingMode) {
      case 'absolute':
        return Math.round(target.absoluteShares).toString()
      case 'relative_current':
        return Math.round(target.absoluteShares - currentShares).toString()
      case 'relative_benchmark':
        return Math.round(target.absoluteShares - benchShares).toString()
      default:
        return Math.round(target.absoluteShares).toString()
    }
  }

  // Helper: Update pair trade leg target with auto-calculation
  const updatePairTradeLegTarget = (legId: string, assetId: string, field: 'weight' | 'shares', value: string) => {
    const holding = pairTradeHoldings?.holdings?.[assetId]
    const price = holding?.price || 0
    const portfolioAum = pairTradeHoldings?.portfolioAum || 0
    const currentWeight = holding?.weight || 0
    const currentShares = holding?.shares || 0
    const benchWeight = 0 // TODO: fetch from benchmark

    // If clearing the value, reset both fields
    if (!value || value.trim() === '') {
      setPairTradeLegTargets(prev => ({
        ...prev,
        [legId]: { absoluteWeight: null, absoluteShares: null, sourceField: null }
      }))
      return
    }

    const numValue = parseFloat(value)
    if (isNaN(numValue)) return

    let absoluteWeight: number | null = null
    let absoluteShares: number | null = null

    if (field === 'weight') {
      // Convert input to absolute weight based on sizing mode
      switch (pairTradeSizingMode) {
        case 'absolute':
          absoluteWeight = numValue
          break
        case 'relative_current':
          absoluteWeight = currentWeight + numValue
          break
        case 'relative_benchmark':
          absoluteWeight = benchWeight + numValue
          break
      }
      // Auto-calculate shares from absolute weight
      if (absoluteWeight !== null && portfolioAum > 0 && price > 0) {
        absoluteShares = Math.round((absoluteWeight / 100) * portfolioAum / price)
      }
    } else {
      // Convert input to absolute shares based on sizing mode
      const benchShares = (price > 0 && portfolioAum > 0) ? Math.round((benchWeight / 100) * portfolioAum / price) : 0

      switch (pairTradeSizingMode) {
        case 'absolute':
          absoluteShares = numValue
          break
        case 'relative_current':
          absoluteShares = currentShares + numValue
          break
        case 'relative_benchmark':
          absoluteShares = benchShares + numValue
          break
      }
      // Auto-calculate weight from absolute shares
      if (absoluteShares !== null && portfolioAum > 0 && price > 0) {
        absoluteWeight = (absoluteShares * price / portfolioAum) * 100
      }
    }

    setPairTradeLegTargets(prev => ({
      ...prev,
      [legId]: { absoluteWeight, absoluteShares, sourceField: field }
    }))
  }

  // Helper: Compute pair trade sizing summary
  const pairTradeSizingSummary = useMemo(() => {
    const legs = pairTradeData?.trade_queue_items || pairTradeData?.legs || []
    let netWeight = 0
    let grossWeight = 0
    let longCount = 0
    let shortCount = 0

    legs.forEach((leg: any) => {
      const target = pairTradeLegTargets[leg.id]
      const weight = target?.absoluteWeight || 0
      const isLong = leg.pair_leg_type === 'long' || (leg.pair_leg_type === null && leg.action === 'buy')

      netWeight += weight
      grossWeight += Math.abs(weight)
      if (isLong) longCount++
      else shortCount++
    })

    return { netWeight, grossWeight, longCount, shortCount }
  }, [pairTradeData, pairTradeLegTargets])

  // Fetch team members for assignment dropdowns
  const { data: teamMembers } = useQuery({
    queryKey: ['team-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')

      if (error) throw error
      return data || []
    },
    enabled: isOpen,
    staleTime: 60000, // Cache for 1 minute
  })

  // Fetch lab links with per-portfolio sizing
  const { data: labLinks = [], refetch: refetchLabLinks } = useQuery({
    queryKey: ['idea-lab-links', tradeId],
    queryFn: () => getIdeaLabLinks(tradeId),
    enabled: isOpen && !!trade,
  })

  // Fetch portfolio tracks for decision status per portfolio
  const { data: portfolioTracks = [], refetch: refetchPortfolioTracks } = useQuery({
    queryKey: ['portfolio-tracks', tradeId],
    queryFn: () => getPortfolioTracksForIdea(tradeId),
    enabled: isOpen && !!trade,
  })

  // Get all leg IDs for pair trades (needed for fetching proposals)
  const pairTradeLegIds = useMemo(() => {
    if (!pairTradeData) return []
    const legs = pairTradeData.trade_queue_items || pairTradeData.legs || []
    return legs.map((leg: any) => leg.id).filter(Boolean)
  }, [pairTradeData])

  // Fetch proposals for this trade idea (for pair trades, fetch for all leg IDs)
  const { data: proposals = [], refetch: refetchProposals } = useQuery({
    queryKey: ['trade-proposals', tradeId, pairTradeLegIds],
    queryFn: async () => {
      console.log('[TradeIdeaDetailModal] Fetching proposals for tradeId:', tradeId, 'isPairTrade:', isPairTrade, 'legIds:', pairTradeLegIds)

      // For pair trades, fetch proposals for all leg IDs
      if (isPairTrade && pairTradeLegIds.length > 0) {
        const { data, error } = await supabase
          .from('trade_proposals')
          .select(`
            *,
            users:user_id (id, email, first_name, last_name),
            portfolio:portfolio_id (id, name)
          `)
          .in('trade_queue_item_id', pairTradeLegIds)
          .eq('is_active', true)
          .order('created_at')

        if (error) throw error

        // Fetch portfolio team roles for all proposers
        const proposals = data || []
        if (proposals.length > 0) {
          const userIds = [...new Set(proposals.map((p: any) => p.user_id))]
          const portfolioIds = [...new Set(proposals.map((p: any) => p.portfolio_id).filter(Boolean))]

          if (userIds.length > 0 && portfolioIds.length > 0) {
            const { data: teamMembers } = await supabase
              .from('portfolio_team')
              .select('user_id, portfolio_id, role')
              .in('user_id', userIds)
              .in('portfolio_id', portfolioIds)

            const teamRoleMap: Record<string, string> = {}
            if (teamMembers) {
              teamMembers.forEach((m: any) => {
                teamRoleMap[`${m.user_id}-${m.portfolio_id}`] = m.role
              })
            }

            // Merge portfolio_role into user data
            return proposals.map((p: any) => ({
              ...p,
              users: p.users ? { ...p.users, portfolio_role: teamRoleMap[`${p.user_id}-${p.portfolio_id}`] || null } : null
            }))
          }
        }

        return proposals
      }

      // For single trades, use the standard function
      return getProposalsForTradeIdea(tradeId)
    },
    enabled: isOpen && !!tradeId && (!isPairTrade || pairTradeLegIds.length > 0),
  })

  // Fetch rejected/inactive proposals for history (handle pair trades)
  const { data: rejectedProposals = [] } = useQuery({
    queryKey: ['trade-proposals-rejected', tradeId, pairTradeLegIds],
    queryFn: async () => {
      // For pair trades, fetch for all leg IDs
      if (isPairTrade && pairTradeLegIds.length > 0) {
        const { data, error } = await supabase
          .from('trade_proposals')
          .select(`
            *,
            users:user_id (id, email, first_name, last_name),
            portfolios:portfolio_id (id, name)
          `)
          .in('trade_queue_item_id', pairTradeLegIds)
          .eq('is_active', false)
          .order('updated_at', { ascending: false })

        if (error) throw error
        return data || []
      }

      const { data, error } = await supabase
        .from('trade_proposals')
        .select(`
          *,
          users:user_id (id, email, first_name, last_name),
          portfolios:portfolio_id (id, name)
        `)
        .eq('trade_queue_item_id', tradeId)
        .eq('is_active', false)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: isOpen && !!tradeId && (!isPairTrade || pairTradeLegIds.length > 0),
  })

  // Debug: Log proposals when they change
  console.log('[TradeIdeaDetailModal] proposals:', proposals, 'tradeId:', tradeId, 'isOpen:', isOpen)

  // Get portfolio IDs from lab links
  const linkedPortfolioIds = labLinks.map(l => l.trade_lab?.portfolio_id).filter(Boolean) as string[]

  // Fetch detailed holdings for linked portfolios (for sizing context)
  const { data: portfolioHoldings } = useQuery({
    queryKey: ['portfolio-holdings-context', trade?.asset_id, linkedPortfolioIds],
    queryFn: async () => {
      if (!trade?.asset_id || linkedPortfolioIds.length === 0) return []

      // Get holdings for the asset in all linked portfolios
      const { data: assetHoldings, error: assetError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, price')
        .eq('asset_id', trade.asset_id)
        .in('portfolio_id', linkedPortfolioIds)

      if (assetError) throw assetError

      // Get total portfolio values for weight calculation
      const { data: allHoldings, error: allError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, price')
        .in('portfolio_id', linkedPortfolioIds)

      if (allError) throw allError

      // Calculate totals per portfolio
      const portfolioTotals: Record<string, number> = {}
      allHoldings?.forEach(h => {
        portfolioTotals[h.portfolio_id] = (portfolioTotals[h.portfolio_id] || 0) + (h.shares * h.price)
      })

      // Build result with context for each portfolio
      return linkedPortfolioIds.map(portfolioId => {
        const holding = assetHoldings?.find(h => h.portfolio_id === portfolioId)
        const totalValue = portfolioTotals[portfolioId] || 0
        const marketValue = holding ? holding.shares * holding.price : 0
        const weight = totalValue > 0 ? (marketValue / totalValue) * 100 : 0

        return {
          portfolioId,
          shares: holding?.shares || 0,
          price: holding?.price || 0,
          weight,
          marketValue,
          totalPortfolioValue: totalValue,
          isOwned: (holding?.shares || 0) > 0,
        }
      })
    },
    enabled: isOpen && !!trade?.asset_id && linkedPortfolioIds.length > 0,
  })

  // For pair trades: Get unique portfolio IDs from proposals
  const pairTradeProposalPortfolioIds = useMemo(() => {
    if (!isPairTrade || !proposals.length) return []
    const uniqueIds = [...new Set(proposals.map(p => p.portfolio_id).filter(Boolean))] as string[]
    return uniqueIds
  }, [isPairTrade, proposals])

  // Fetch holdings for all pair trade leg assets across all proposal portfolios
  const { data: pairTradePortfolioHoldings } = useQuery({
    queryKey: ['pair-trade-portfolio-holdings', pairTradeLegAssetIds, pairTradeProposalPortfolioIds],
    queryFn: async () => {
      if (pairTradeLegAssetIds.length === 0 || pairTradeProposalPortfolioIds.length === 0) return {}

      // Get holdings for all leg assets in all proposal portfolios
      const { data: holdings, error: holdingsError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price')
        .in('portfolio_id', pairTradeProposalPortfolioIds)
        .in('asset_id', pairTradeLegAssetIds)

      if (holdingsError) throw holdingsError

      // Get total portfolio values for weight calculation
      const { data: allHoldings, error: allError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, price')
        .in('portfolio_id', pairTradeProposalPortfolioIds)

      if (allError) throw allError

      // Calculate totals per portfolio
      const portfolioTotals: Record<string, number> = {}
      allHoldings?.forEach(h => {
        portfolioTotals[h.portfolio_id] = (portfolioTotals[h.portfolio_id] || 0) + (h.shares * h.price)
      })

      // Build nested map: portfolioId -> assetId -> holding data
      const result: Record<string, Record<string, { shares: number; price: number; weight: number; marketValue: number }>> = {}

      pairTradeProposalPortfolioIds.forEach(portfolioId => {
        result[portfolioId] = {}
        const portfolioAum = portfolioTotals[portfolioId] || 0

        pairTradeLegAssetIds.forEach(assetId => {
          const holding = holdings?.find(h => h.portfolio_id === portfolioId && h.asset_id === assetId)
          const shares = holding?.shares || 0
          const price = holding?.price || 0
          const marketValue = shares * price
          const weight = portfolioAum > 0 ? (marketValue / portfolioAum) * 100 : 0

          result[portfolioId][assetId] = { shares, price, weight, marketValue }
        })
      })

      return result
    },
    enabled: isOpen && isPairTrade && pairTradeLegAssetIds.length > 0 && pairTradeProposalPortfolioIds.length > 0,
  })

  // Initialize portfolioTargets from labLinks when they load
  useEffect(() => {
    if (labLinks.length > 0) {
      const targets: Record<string, { absoluteWeight: number | null; absoluteShares: number | null; sourceField: 'weight' | 'shares' | null }> = {}
      labLinks.forEach(link => {
        const portfolioId = link.trade_lab?.portfolio_id
        if (portfolioId && (link.proposed_weight !== null || link.proposed_shares !== null)) {
          targets[portfolioId] = {
            absoluteWeight: link.proposed_weight,
            absoluteShares: link.proposed_shares,
            sourceField: link.proposed_weight !== null ? 'weight' : (link.proposed_shares !== null ? 'shares' : null),
          }
        }
      })
      setPortfolioTargets(targets)
    }
  }, [labLinks])

  // Build portfolio contexts from labLinks and portfolioHoldings for proposals tab
  useEffect(() => {
    if (labLinks.length > 0 && portfolioHoldings) {
      const contexts: PortfolioContext[] = labLinks.map(link => {
        const portfolioId = link.trade_lab?.portfolio_id
        const portfolioName = link.trade_lab?.portfolio?.name || 'Unknown Portfolio'
        const benchmark = (link.trade_lab?.portfolio as any)?.benchmark || null
        const holdingData = portfolioHoldings.find(h => h.portfolioId === portfolioId)

        return {
          id: portfolioId || '',
          name: portfolioName,
          benchmark,
          currentShares: holdingData?.shares || 0,
          currentPrice: holdingData?.price || 0,
          currentValue: holdingData?.marketValue || 0,
          currentWeight: holdingData?.weight || 0,
          benchmarkWeight: null, // TODO: fetch from benchmark_holdings when available
          activeWeight: null,
          portfolioTotalValue: holdingData?.totalPortfolioValue || 0,
        }
      }).filter(c => c.id)

      setPortfolioContexts(contexts)

      // Initialize inline proposals for each portfolio
      const initialProposals: Record<string, InlineProposalState> = {}
      contexts.forEach(ctx => {
        // Check if user already has a proposal for this portfolio
        const existingProposal = proposals.find(p => p.portfolio_id === ctx.id && p.user_id === user?.id)
        if (existingProposal) {
          initialProposals[ctx.id] = {
            sizingMode: 'weight',
            value: existingProposal.weight?.toString() || '',
            notes: existingProposal.notes || '',
          }
        } else {
          initialProposals[ctx.id] = { sizingMode: 'weight', value: '', notes: '' }
        }
      })
      setInlineProposals(initialProposals)
    }
  }, [labLinks, portfolioHoldings, proposals, user?.id])

  // Mutation for updating per-portfolio sizing
  const updatePortfolioSizingMutation = useMutation({
    mutationFn: async ({ labId, sizing }: { labId: string; sizing: { proposedWeight?: number | null; proposedShares?: number | null } }) => {
      return updateIdeaLinkSizing(labId, tradeId, sizing, {
        actorId: user?.id || '',
        actorRole: 'user',
        actorName: user?.first_name || user?.email || 'Unknown',
        actorEmail: user?.email || '',
        uiSource: 'modal',
        requestId: crypto.randomUUID(),
      })
    },
    onSuccess: () => {
      refetchLabLinks()
    },
  })

  // Fetch all available trade labs for portfolio management
  const { data: allLabs = [] } = useQuery({
    queryKey: ['all-trade-labs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_labs')
        .select(`
          id,
          name,
          portfolio_id,
          portfolios:portfolio_id (id, name)
        `)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: isOpen && isManagingPortfolios,
  })

  // Mutation for linking idea to a portfolio
  const linkToLabMutation = useMutation({
    mutationFn: async (labId: string) => {
      return linkIdeaToLab(labId, tradeId, {
        actorId: user?.id || '',
        actorRole: 'user',
        actorName: user?.first_name || user?.email || 'Unknown',
        actorEmail: user?.email || '',
        uiSource: 'modal',
        requestId: crypto.randomUUID(),
      })
    },
    onSuccess: () => {
      refetchLabLinks()
      queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
    },
  })

  // Mutation for unlinking idea from a portfolio
  const unlinkFromLabMutation = useMutation({
    mutationFn: async (labId: string) => {
      return unlinkIdeaFromLab(labId, tradeId, {
        actorId: user?.id || '',
        actorRole: 'user',
        actorName: user?.first_name || user?.email || 'Unknown',
        actorEmail: user?.email || '',
        uiSource: 'modal',
        requestId: crypto.randomUUID(),
      })
    },
    onSuccess: () => {
      refetchLabLinks()
      queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
    },
  })

  // Mutation for portfolio-scoped decision (Accept/Defer/Reject per portfolio)
  const portfolioDecisionMutation = useMutation({
    mutationFn: async ({ portfolioId, decisionOutcome, reason }: { portfolioId: string; decisionOutcome: DecisionOutcome; reason?: string }) => {
      const input: UpdatePortfolioTrackInput = {
        trade_queue_item_id: tradeId,
        portfolio_id: portfolioId,
        decision_outcome: decisionOutcome,
        decision_reason: reason || null,
        deferred_until: decisionOutcome === 'deferred' ? deferUntilDate : null,
      }
      return updatePortfolioTrackDecision(input, {
        actorId: user?.id || '',
        actorRole: (user?.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
        actorName: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || '',
        actorEmail: user?.email || '',
        uiSource: 'modal',
        requestId: crypto.randomUUID(),
      })
    },
    onSuccess: () => {
      refetchPortfolioTracks()
      queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      // Reset decision state
      setShowPortfolioDecisionPicker(false)
      setPendingDecision(null)
      setSelectedDecisionPortfolioId(null)
      setShowDeferModal(false)
      setDeferUntilDate(null)
    },
  })

  // Helper: Get display value for weight based on sizing mode
  const getDisplayWeight = (portfolioId: string): string => {
    const target = portfolioTargets[portfolioId]
    if (target?.absoluteWeight === null || target?.absoluteWeight === undefined) return ''

    const holding = portfolioHoldings?.find(h => h.portfolioId === portfolioId)
    const currentWeight = holding?.weight || 0
    const benchWeight = 0 // TODO: fetch from benchmark

    switch (sizingMode) {
      case 'absolute':
        return target.absoluteWeight.toFixed(2)
      case 'relative_current':
        return (target.absoluteWeight - currentWeight).toFixed(2)
      case 'relative_benchmark':
        return (target.absoluteWeight - benchWeight).toFixed(2)
      default:
        return target.absoluteWeight.toFixed(2)
    }
  }

  // Helper: Get display value for shares based on sizing mode
  const getDisplayShares = (portfolioId: string): string => {
    const target = portfolioTargets[portfolioId]
    if (target?.absoluteShares === null || target?.absoluteShares === undefined) return ''

    const holding = portfolioHoldings?.find(h => h.portfolioId === portfolioId)
    const currentShares = holding?.shares || 0
    const price = holding?.price || 0
    const totalPortfolioValue = holding?.totalPortfolioValue || 0
    const benchWeight = 0 // TODO: fetch from benchmark
    const benchShares = (price > 0 && totalPortfolioValue > 0)
      ? Math.round((benchWeight / 100) * totalPortfolioValue / price)
      : 0

    switch (sizingMode) {
      case 'absolute':
        return Math.round(target.absoluteShares).toString()
      case 'relative_current':
        const deltaFromCurrent = Math.round(target.absoluteShares - currentShares)
        return deltaFromCurrent.toString()
      case 'relative_benchmark':
        const deltaFromBench = Math.round(target.absoluteShares - benchShares)
        return deltaFromBench.toString()
      default:
        return Math.round(target.absoluteShares).toString()
    }
  }

  // Portfolio target helper with auto-calculation
  // Converts input to absolute values, calculates the other field
  const updatePortfolioTarget = (portfolioId: string, field: 'weight' | 'shares', value: string) => {
    const holding = portfolioHoldings?.find(h => h.portfolioId === portfolioId)
    const price = holding?.price || 0
    const totalPortfolioValue = holding?.totalPortfolioValue || 0
    const currentWeight = holding?.weight || 0
    const benchWeight = 0 // TODO: fetch from benchmark

    // If clearing the value, reset both fields
    if (!value || value.trim() === '') {
      setPortfolioTargets(prev => ({
        ...prev,
        [portfolioId]: {
          absoluteWeight: null,
          absoluteShares: null,
          sourceField: null,
        }
      }))
      return
    }

    const numValue = parseFloat(value)
    if (isNaN(numValue)) return // Don't update if not a valid number

    let absoluteWeight: number | null = null
    let absoluteShares: number | null = null

    if (field === 'weight') {
      // Convert input to absolute weight based on sizing mode
      switch (sizingMode) {
        case 'absolute':
          absoluteWeight = numValue
          break
        case 'relative_current':
          absoluteWeight = currentWeight + numValue
          break
        case 'relative_benchmark':
          absoluteWeight = benchWeight + numValue
          break
      }
      // Auto-calculate shares from absolute weight
      if (absoluteWeight !== null && totalPortfolioValue > 0 && price > 0) {
        absoluteShares = Math.round((absoluteWeight / 100) * totalPortfolioValue / price)
      }
    } else {
      // Convert input to absolute shares based on sizing mode
      const currentShares = holding?.shares || 0
      const benchShares = (price > 0 && totalPortfolioValue > 0)
        ? Math.round((benchWeight / 100) * totalPortfolioValue / price)
        : 0

      switch (sizingMode) {
        case 'absolute':
          absoluteShares = numValue
          break
        case 'relative_current':
          absoluteShares = currentShares + numValue
          break
        case 'relative_benchmark':
          absoluteShares = benchShares + numValue
          break
      }
      // Auto-calculate weight from absolute shares
      if (absoluteShares !== null && totalPortfolioValue > 0 && price > 0) {
        absoluteWeight = (absoluteShares * price / totalPortfolioValue) * 100
      }
    }

    setPortfolioTargets(prev => ({
      ...prev,
      [portfolioId]: {
        absoluteWeight,
        absoluteShares,
        sourceField: field,
      }
    }))
  }

  // Save portfolio sizing to database
  const savePortfolioSizing = async (portfolioId: string) => {
    const target = portfolioTargets[portfolioId]
    const link = labLinks.find(l => l.trade_lab?.portfolio_id === portfolioId)
    if (!link || !target) return

    await updatePortfolioSizingMutation.mutateAsync({
      labId: link.trade_lab_id,
      sizing: {
        proposedWeight: target.absoluteWeight,
        proposedShares: target.absoluteShares ? Math.round(target.absoluteShares) : null,
      },
    })
  }

  // Fetch discussion messages with portfolio info
  const { data: discussionMessages = [] } = useQuery({
    queryKey: ['messages', 'trade_idea', tradeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          user:users(id, email, first_name, last_name),
          portfolio:portfolios(id, name)
        `)
        .eq('context_type', 'trade_idea')
        .eq('context_id', tradeId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: isOpen,
  })

  // Filter discussion messages based on portfolio filter
  const filteredDiscussionMessages = useMemo(() => {
    if (discussionPortfolioFilter === null) return discussionMessages // Show all
    if (discussionPortfolioFilter === 'general') {
      return discussionMessages.filter((m: any) => !m.portfolio_id)
    }
    return discussionMessages.filter((m: any) => m.portfolio_id === discussionPortfolioFilter)
  }, [discussionMessages, discussionPortfolioFilter])

  // Get reply-to message data
  const replyToMessageData = discussionMessages.find(m => m.id === replyToMessage)

  // Trade service for audited mutations
  const {
    moveTrade,
    deleteTrade,
    restoreTrade,
    archiveTrade,
    deferTradeAsync,
    movePairTrade,
    updateTrade,
    isMoving,
    isDeleting,
    isRestoring,
    isArchiving,
    isDefering,
    isMovingPairTrade,
    isUpdating,
  } = useTradeIdeaService({
    onDeleteSuccess: () => {
      setShowDeleteConfirm(false)
      onClose()
    },
    onArchiveSuccess: () => {
      onClose()
    },
    onUpdateSuccess: () => {
      // Reset edit states on successful update
      setIsEditingRationale(false)
      setIsEditingSizing(false)
      setIsEditingRisk(false)
      setIsEditingTags(false)
    },
  })

  // Wrapper for single trade status updates (for backwards compatibility)
  const updateStatusMutation = {
    mutate: (status: TradeQueueStatus) => {
      moveTrade({ tradeId, targetStatus: status, uiSource: 'modal' })
    },
    isPending: isMoving,
  }

  // Wrapper for pair trade status updates (for backwards compatibility)
  const updatePairTradeStatusMutation = {
    mutate: (status: TradeQueueStatus) => {
      movePairTrade({ pairTradeId: tradeId, targetStatus: status, uiSource: 'modal' })
    },
    isPending: isMovingPairTrade,
  }

  // Wrapper for delete (for backwards compatibility)
  const deleteTradeMutation = {
    mutate: () => {
      deleteTrade({ tradeId, uiSource: 'modal' })
    },
    isPending: isDeleting,
  }

  // Wrapper for restore (for backwards compatibility with restore buttons)
  const restoreMutation = {
    mutate: (targetStatus: TradeQueueStatus) => {
      restoreTrade({ tradeId, targetStatus, uiSource: 'modal' })
    },
    isPending: isRestoring,
  }

  // Send discussion message mutation
  const sendDiscussionMessageMutation = useMutation({
    mutationFn: async (data: { content: string; reply_to?: string; portfolio_id?: string | null }) => {
      const { error } = await supabase
        .from('messages')
        .insert([{
          content: data.content,
          context_type: 'trade_idea',
          context_id: tradeId,
          user_id: user?.id,
          reply_to: data.reply_to,
          portfolio_id: data.portfolio_id || null
        }])

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'trade_idea', tradeId] })
      setDiscussionMessage('')
      setReplyToMessage(null)
      setMessagePortfolioContext(null)
      scrollToBottom()
    }
  })

  // Toggle pin mutation for discussion messages
  const toggleDiscussionPinMutation = useMutation({
    mutationFn: async ({ messageId, isPinned }: { messageId: string; isPinned: boolean }) => {
      const { error } = await supabase
        .from('messages')
        .update({ is_pinned: !isPinned })
        .eq('id', messageId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'trade_idea', tradeId] })
    }
  })

  // Update priority mutation
  const updatePriorityMutation = useMutation({
    mutationFn: async (newPriority: string) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ urgency: newPriority })
        .eq('id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setShowPriorityDropdown(false)
    }
  })

  // Update visibility mutation
  const updateVisibilityMutation = useMutation({
    mutationFn: async (newVisibility: 'private' | 'team') => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ sharing_visibility: newVisibility })
        .eq('id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
      setShowVisibilityDropdown(false)
    }
  })

  // Update assignee mutation
  const updateAssigneeMutation = useMutation({
    mutationFn: async (assigneeId: string | null) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ assigned_to: assigneeId })
        .eq('id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setShowAssigneeDropdown(false)
    }
  })

  // Update collaborators mutation
  const updateCollaboratorsMutation = useMutation({
    mutationFn: async (collaboratorIds: string[]) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ collaborators: collaboratorIds })
        .eq('id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    }
  })

  // Update pair trade thesis mutation
  // For pair_trades table: updates thesis_summary field
  // For pair_id-only trades: updates rationale on all legs (temporary until schema supports shared thesis)
  const updatePairTradeRationaleMutation = useMutation({
    mutationFn: async (newThesis: string | null) => {
      const isPairTradesTable = tradeData?.type === 'pair'

      if (isPairTradesTable) {
        // Update the pair_trades table thesis_summary field
        const { error } = await supabase
          .from('pair_trades')
          .update({ thesis_summary: newThesis, updated_at: new Date().toISOString() })
          .eq('id', tradeId)
        if (error) throw error
      } else {
        // For pair_id-only trades, update rationale on all legs
        // NOTE: This is temporary - ideally would have a shared thesis field
        const { error } = await supabase
          .from('trade_queue_items')
          .update({ rationale: newThesis, updated_at: new Date().toISOString() })
          .eq('pair_id', tradeId)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setIsEditingRationale(false)
      setEditedRationale('')
    }
  })

  // Update pair trade urgency mutation (updates all legs)
  const updatePairTradeUrgencyMutation = useMutation({
    mutationFn: async (newUrgency: string) => {
      // Update all legs with this pair_id
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ urgency: newUrgency, updated_at: new Date().toISOString() })
        .eq('pair_id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    }
  })

  // Update pair trade visibility mutation (updates all legs)
  const updatePairTradeVisibilityMutation = useMutation({
    mutationFn: async (newVisibility: 'private' | 'team') => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ sharing_visibility: newVisibility, updated_at: new Date().toISOString() })
        .eq('pair_id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setShowVisibilityDropdown(false)
    }
  })

  // Update pair trade assignee mutation (updates all legs)
  const updatePairTradeAssigneeMutation = useMutation({
    mutationFn: async (assigneeId: string | null) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ assigned_to: assigneeId, updated_at: new Date().toISOString() })
        .eq('pair_id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setShowAssigneeDropdown(false)
    }
  })

  // Update pair trade collaborators mutation (updates all legs)
  const updatePairTradeCollaboratorsMutation = useMutation({
    mutationFn: async (collaboratorIds: string[]) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ collaborators: collaboratorIds, updated_at: new Date().toISOString() })
        .eq('pair_id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setShowCollaboratorsDropdown(false)
    }
  })

  // Update pair trade reference levels per leg
  const updatePairTradeReferenceLevelsMutation = useMutation({
    mutationFn: async (levels: Record<string, { targetPrice: number | null; stopLoss: number | null; takeProfit: number | null }>) => {
      const updates = Object.entries(levels).map(([legId, legLevels]) =>
        supabase
          .from('trade_queue_items')
          .update({
            target_price: legLevels.targetPrice,
            stop_loss: legLevels.stopLoss,
            take_profit: legLevels.takeProfit,
            updated_at: new Date().toISOString()
          })
          .eq('id', legId)
      )
      const results = await Promise.all(updates)
      const errors = results.filter(r => r.error)
      if (errors.length > 0) throw new Error('Failed to update some reference levels')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setIsEditingPairReferenceLevels(false)
      setEditedPairReferenceLevels({})
    }
  })

  // Update pair trade conviction and time horizon (updates all legs to keep in sync)
  const updatePairTradeConvictionMutation = useMutation({
    mutationFn: async (params: { conviction: string | null; timeHorizon: string | null }) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({
          conviction: params.conviction,
          time_horizon: params.timeHorizon,
          updated_at: new Date().toISOString()
        })
        .eq('pair_id', tradeId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setIsEditingPairConviction(false)
      setEditedPairConviction(null)
      setEditedPairTimeHorizon(null)
    }
  })

  // Update pair trade sizing per leg
  const updatePairTradeSizingMutation = useMutation({
    mutationFn: async (sizing: Record<string, { proposedWeight: number | null; proposedShares: number | null }>) => {
      const updates = Object.entries(sizing).map(([legId, legSizing]) =>
        supabase
          .from('trade_queue_items')
          .update({
            proposed_weight: legSizing.proposedWeight,
            proposed_shares: legSizing.proposedShares,
            updated_at: new Date().toISOString()
          })
          .eq('id', legId)
      )
      const results = await Promise.all(updates)
      const errors = results.filter(r => r.error)
      if (errors.length > 0) throw new Error('Failed to update some sizing values')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      setIsEditingPairSizing(false)
      setEditedPairSizing({})
    }
  })

  // Ownership check for edit permissions
  const isOwner = trade?.created_by === user?.id
  // For pair trades, check ownership from either pair_trades table or first leg
  const isPairTradeOwner = pairTradeData?.created_by === user?.id ||
    (pairTradeData?.legs?.[0]?.created_by === user?.id) ||
    (pairTradeData?.trade_queue_items?.[0]?.created_by === user?.id)

  // Edit handlers
  const startEditRationale = () => {
    setEditedRationale(trade?.rationale || '')
    setIsEditingRationale(true)
  }

  const cancelEditRationale = () => {
    setIsEditingRationale(false)
    setEditedRationale('')
  }

  const saveRationale = () => {
    updateTrade({
      tradeId,
      updates: { rationale: editedRationale || null },
      uiSource: 'modal',
    })
  }

  const startEditSizing = () => {
    setEditedSizing({
      proposedWeight: trade?.proposed_weight?.toString() || '',
      proposedShares: trade?.proposed_shares?.toString() || '',
      targetPrice: trade?.target_price?.toString() || '',
      stopLoss: (trade as any)?.stop_loss?.toString() || '',
      takeProfit: (trade as any)?.take_profit?.toString() || '',
    })
    setIsEditingSizing(true)
  }

  const cancelEditSizing = () => {
    setIsEditingSizing(false)
    setEditedSizing({ proposedWeight: '', proposedShares: '', targetPrice: '', stopLoss: '', takeProfit: '' })
  }

  const saveSizing = () => {
    updateTrade({
      tradeId,
      updates: {
        proposedWeight: editedSizing.proposedWeight ? parseFloat(editedSizing.proposedWeight) : null,
        proposedShares: editedSizing.proposedShares ? parseInt(editedSizing.proposedShares) : null,
        targetPrice: editedSizing.targetPrice ? parseFloat(editedSizing.targetPrice) : null,
        stopLoss: editedSizing.stopLoss ? parseFloat(editedSizing.stopLoss) : null,
        takeProfit: editedSizing.takeProfit ? parseFloat(editedSizing.takeProfit) : null,
      },
      uiSource: 'modal',
    })
  }

  const startEditRisk = () => {
    setEditedRisk({
      conviction: (trade as any)?.conviction || null,
      timeHorizon: (trade as any)?.time_horizon || null,
    })
    setIsEditingRisk(true)
  }

  const cancelEditRisk = () => {
    setIsEditingRisk(false)
    setEditedRisk({ conviction: null, timeHorizon: null })
  }

  const saveRisk = () => {
    updateTrade({
      tradeId,
      updates: {
        conviction: editedRisk.conviction,
        timeHorizon: editedRisk.timeHorizon,
      },
      uiSource: 'modal',
    })
  }

  const startEditTags = () => {
    const currentTags = (trade as any)?.context_tags || []
    setEditedTags(currentTags.map((t: any) => ({
      entity_type: t.entity_type as ContextTagEntityType,
      entity_id: t.entity_id,
      display_name: t.display_name,
    })))
    setIsEditingTags(true)
  }

  const cancelEditTags = () => {
    setIsEditingTags(false)
    setEditedTags([])
  }

  const saveTags = () => {
    updateTrade({
      tradeId,
      updates: {
        contextTags: editedTags.length > 0 ? editedTags.map(t => ({
          entity_type: t.entity_type,
          entity_id: t.entity_id,
          display_name: t.display_name,
        })) : null,
      },
      uiSource: 'modal',
    })
  }

  // Close priority dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (priorityDropdownRef.current && !priorityDropdownRef.current.contains(event.target as Node)) {
        setShowPriorityDropdown(false)
      }
    }
    if (showPriorityDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPriorityDropdown])

  // Close visibility dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (visibilityDropdownRef.current && !visibilityDropdownRef.current.contains(event.target as Node)) {
        setShowVisibilityDropdown(false)
      }
    }
    if (showVisibilityDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showVisibilityDropdown])

  // Close assignee dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(event.target as Node)) {
        setShowAssigneeDropdown(false)
      }
    }
    if (showAssigneeDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAssigneeDropdown])

  // Close collaborators dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (collaboratorsDropdownRef.current && !collaboratorsDropdownRef.current.contains(event.target as Node)) {
        setShowCollaboratorsDropdown(false)
      }
    }
    if (showCollaboratorsDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showCollaboratorsDropdown])

  const handleSendDiscussionMessage = () => {
    if (!discussionMessage.trim()) return

    sendDiscussionMessageMutation.mutate({
      content: discussionMessage.trim(),
      reply_to: replyToMessage || undefined,
      portfolio_id: messagePortfolioContext
    })
  }

  const handleDiscussionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendDiscussionMessage()
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (activeTab === 'discussion') {
      scrollToBottom()
    }
  }, [discussionMessages, activeTab])

  const formatMessageTime = (createdAt: string) => {
    const messageDate = new Date(createdAt)
    const now = new Date()
    const minutesAgo = differenceInMinutes(now, messageDate)

    if (minutesAgo <= 9) {
      return formatDistanceToNow(messageDate, { addSuffix: true })
    } else {
      return format(messageDate, 'MMM d, yyyy h:mm a')
    }
  }

  const getUserInitials = (userData: any) => {
    if (userData?.first_name && userData?.last_name) {
      return `${userData.first_name[0]}${userData.last_name[0]}`.toUpperCase()
    }
    const name = getUserDisplayName(userData)
    return name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const getUserDisplayName = (userData: { first_name?: string | null; last_name?: string | null; email?: string }) => {
    if (userData.first_name || userData.last_name) {
      return `${userData.first_name || ''} ${userData.last_name || ''}`.trim()
    }
    return userData.email?.split('@')[0] || 'Unknown'
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full h-[80vh] max-h-[700px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            {/* Single Trade Header */}
            {trade && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className={clsx(
                  "font-semibold uppercase text-base",
                  trade.action === 'buy' || trade.action === 'add'
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                )}>
                  {trade.action}
                </span>
                <span className="font-bold text-lg text-gray-900 dark:text-white">
                  {trade.assets?.symbol}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {trade.assets?.company_name}
                </span>
                <div className="relative" ref={priorityDropdownRef}>
                  <button
                    onClick={() => setShowPriorityDropdown(!showPriorityDropdown)}
                    className={clsx(
                      "text-xs px-2 py-0.5 rounded-full cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all",
                      trade.urgency === 'urgent' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:ring-red-300" :
                      trade.urgency === 'high' ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 hover:ring-orange-300" :
                      trade.urgency === 'medium' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:ring-blue-300" :
                      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:ring-gray-300"
                    )}
                  >
                    {trade.urgency || 'low'}
                  </button>
                  {showPriorityDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[100px]">
                      {['low', 'medium', 'high', 'urgent'].map((priority) => (
                        <button
                          key={priority}
                          onClick={() => updatePriorityMutation.mutate(priority)}
                          disabled={updatePriorityMutation.isPending}
                          className={clsx(
                            "w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2",
                            trade.urgency === priority && "bg-gray-50 dark:bg-gray-700"
                          )}
                        >
                          <span className={clsx(
                            "w-2 h-2 rounded-full",
                            priority === 'urgent' ? "bg-red-500" :
                            priority === 'high' ? "bg-orange-500" :
                            priority === 'medium' ? "bg-blue-500" :
                            "bg-gray-400"
                          )} />
                          <span className="capitalize text-gray-700 dark:text-gray-300">{priority}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Pair Trade Header */}
            {isPairTrade && pairTradeData && (() => {
              // Calculate leg counts
              const legs = pairTradeData.trade_queue_items || pairTradeData.legs || []
              const longLegs = legs.filter((leg: any) =>
                leg.pair_leg_type === 'long' || (leg.pair_leg_type === null && leg.action === 'buy')
              )
              const shortLegs = legs.filter((leg: any) =>
                leg.pair_leg_type === 'short' || (leg.pair_leg_type === null && leg.action === 'sell')
              )
              const buySymbols = longLegs.map((l: any) => l.assets?.symbol || '?').join(', ')
              const sellSymbols = shortLegs.map((l: any) => l.assets?.symbol || '?').join(', ')

              return (
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
                  {/* Pair Trade badge */}
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 flex-shrink-0">
                    <Link2 className="h-4 w-4" />
                    <span className="text-sm">Pair Trade</span>
                  </div>
                  {/* Trade structure */}
                  <span className="font-semibold uppercase text-base text-green-600 dark:text-green-400">BUY</span>
                  <span className="font-bold text-lg text-gray-900 dark:text-white">{buySymbols}</span>
                  <span className="text-gray-400 dark:text-gray-500">·</span>
                  <span className="font-semibold uppercase text-base text-red-600 dark:text-red-400">SELL</span>
                  <span className="font-bold text-lg text-gray-900 dark:text-white">{sellSymbols}</span>
                </div>
              )
            })()}
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('details')}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeTab === 'details'
                  ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              <Edit2 className="h-4 w-4" />
              Details
            </button>
            <button
              onClick={() => setActiveTab('discussion')}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeTab === 'discussion'
                  ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              <MessageSquare className="h-4 w-4" />
              Discussion
              {discussionMessages.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-full">
                  {discussionMessages.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('proposals')}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeTab === 'proposals'
                  ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              <Users className="h-4 w-4" />
              Proposals
              {proposals.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-full">
                  {proposals.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeTab === 'activity'
                  ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              <History className="h-4 w-4" />
              Activity
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 space-y-4">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          ) : isPairTrade && pairTradeData ? (
            <>
              {/* Pair Trade Details Tab */}
              {activeTab === 'details' && (
                <div className="p-4 space-y-4">
                  {/* ========== PAIR THESIS SECTION ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Pair Thesis</h3>
                    {isEditingRationale ? (
                      <>
                        <textarea
                          autoFocus
                          value={editedRationale}
                          onChange={(e) => setEditedRationale(e.target.value)}
                          placeholder="Why this pair trade? What's the catalyst or thesis?"
                          rows={4}
                          className="w-full p-2 text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 resize-none border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent leading-relaxed"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setIsEditingRationale(false)
                              setEditedRationale('')
                            }
                          }}
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => {
                              setIsEditingRationale(false)
                              setEditedRationale('')
                            }}
                            disabled={updatePairTradeRationaleMutation.isPending}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => updatePairTradeRationaleMutation.mutate(editedRationale || null)}
                            disabled={updatePairTradeRationaleMutation.isPending}
                            className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                          >
                            {updatePairTradeRationaleMutation.isPending ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="group">
                        {(pairTradeData.thesis_summary || pairTradeData.rationale) ? (
                          <div className="flex gap-2">
                            <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                              {pairTradeData.thesis_summary || pairTradeData.rationale}
                            </p>
                            {isPairTradeOwner && (
                              <button
                                onClick={() => {
                                  setEditedRationale(pairTradeData.thesis_summary || pairTradeData.rationale || '')
                                  setIsEditingRationale(true)
                                }}
                                className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ) : isPairTradeOwner ? (
                          <button
                            onClick={() => {
                              setEditedRationale('')
                              setIsEditingRationale(true)
                            }}
                            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          >
                            + Add thesis
                          </button>
                        ) : (
                          <p className="text-sm text-gray-400 italic">No thesis</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== URGENCY SECTION ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Urgency</h3>
                    <div className="flex gap-2">
                      {(['low', 'medium', 'high', 'urgent'] as const).map((level) => (
                        <button
                          key={level}
                          onClick={() => isPairTradeOwner && updatePairTradeUrgencyMutation.mutate(level)}
                          disabled={!isPairTradeOwner || updatePairTradeUrgencyMutation.isPending}
                          className={clsx(
                            "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                            pairTradeData.urgency === level
                              ? level === 'urgent' ? "bg-red-500 text-white"
                                : level === 'high' ? "bg-orange-500 text-white"
                                : level === 'medium' ? "bg-blue-500 text-white"
                                : "bg-gray-500 text-white"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
                            isPairTradeOwner && "hover:ring-2 hover:ring-offset-1 cursor-pointer",
                            !isPairTradeOwner && "cursor-default"
                          )}
                        >
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ========== TRADE LEGS SECTION ========== */}
                  <PairTradeLegEditor
                    legs={(pairTradeData.trade_queue_items || pairTradeData.legs || []).map((leg: any) => ({
                      id: leg.id,
                      asset_id: leg.asset_id,
                      assets: leg.assets,
                      action: leg.action,
                      pair_leg_type: leg.pair_leg_type,
                      proposed_weight: leg.proposed_weight,
                      proposed_shares: leg.proposed_shares,
                      target_price: leg.target_price,
                      stop_loss: leg.stop_loss,
                      take_profit: leg.take_profit,
                    }))}
                    pairId={tradeId}
                    portfolioId={pairTradeData.portfolio_id || pairTradeData.portfolios?.id || ''}
                    userId={user?.id || ''}
                    isOwner={isPairTradeOwner}
                    onLegsChanged={() => {
                      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
                    }}
                  />

                  {/* ========== PORTFOLIO SIZING SECTION ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <button
                        onClick={() => setIsLabsExpanded(!isLabsExpanded)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300"
                      >
                        {isLabsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Scale className="h-3.5 w-3.5" />
                        Portfolio Sizing
                      </button>
                      {isLabsExpanded && (
                        <div className="flex rounded-md border border-gray-200 dark:border-gray-600 overflow-hidden">
                          {[
                            { value: 'absolute', label: 'Target %' },
                            { value: 'relative_current', label: '+/− Current' },
                            { value: 'relative_benchmark', label: '+/− Bench' },
                          ].map((mode) => (
                            <button
                              key={mode.value}
                              type="button"
                              onClick={() => {
                                setPairTradeActiveInput(null) // Clear so display recalculates with new mode
                                setPairTradeSizingMode(mode.value as 'absolute' | 'relative_current' | 'relative_benchmark')
                              }}
                              className={clsx(
                                "px-2 py-0.5 text-[10px] font-medium transition-colors border-r last:border-r-0 border-gray-200 dark:border-gray-600",
                                pairTradeSizingMode === mode.value
                                  ? "bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300"
                                  : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                              )}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {isLabsExpanded && (
                      <div className="mt-3">
                        {/* Portfolio block */}
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 border-b border-gray-200 dark:border-gray-600">
                            <span className="font-medium text-sm text-gray-800 dark:text-gray-200">
                              {pairTradeData.portfolios?.name || 'Primary Portfolio'}
                            </span>
                            {pairTradeHoldings?.portfolioAum ? (
                              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                                AUM: ${(pairTradeHoldings.portfolioAum / 1000).toFixed(0)}K
                              </span>
                            ) : null}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                                  <th className="text-left py-2 px-2 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">Leg</th>
                                  <th className="text-right py-2 px-1.5 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    <div className="flex flex-col items-end">
                                      <span>Current</span>
                                      <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                    </div>
                                  </th>
                                  <th className="text-right py-2 px-1.5 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    <div className="flex flex-col items-end">
                                      <span>Bench</span>
                                      <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                    </div>
                                  </th>
                                  <th className="text-right py-2 px-1.5 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    <div className="flex flex-col items-end">
                                      <span>Active</span>
                                      <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                    </div>
                                  </th>
                                  <th className="text-right py-2 px-1.5 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    <div className="flex flex-col items-end">
                                      <span>Current</span>
                                      <span className="text-[9px] font-normal text-gray-400">Shares</span>
                                    </div>
                                  </th>
                                  <th className="text-center py-2 px-1.5 font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap bg-primary-50/50 dark:bg-primary-900/20">
                                    <div className="flex flex-col items-center">
                                      <span>{pairTradeSizingMode === 'absolute' ? 'Target' : '+/−'}</span>
                                      <span className="text-[9px] font-normal">Weight %</span>
                                    </div>
                                  </th>
                                  <th className="text-center py-2 px-1.5 font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap bg-primary-50/50 dark:bg-primary-900/20">
                                    <div className="flex flex-col items-center">
                                      <span>Target</span>
                                      <span className="text-[9px] font-normal">Shares</span>
                                    </div>
                                  </th>
                                  <th className="w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {(pairTradeData.trade_queue_items || pairTradeData.legs)?.map((leg: any, idx: number) => {
                                  const isLong = leg.pair_leg_type === 'long' || (leg.pair_leg_type === null && leg.action === 'buy')
                                  const holding = pairTradeHoldings?.holdings?.[leg.asset_id]
                                  const currentWeight = holding?.weight || 0
                                  const benchWeight = 0 // TODO: fetch from benchmark
                                  const activeWeight = currentWeight - benchWeight
                                  const target = pairTradeLegTargets[leg.id]
                                  const hasChanges = target && (
                                    target.absoluteWeight !== leg.proposed_weight ||
                                    target.absoluteShares !== leg.proposed_shares
                                  )

                                  return (
                                    <tr
                                      key={leg.id}
                                      className={clsx(
                                        "border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 group",
                                        idx % 2 === 1 && "bg-gray-25 dark:bg-gray-800/30"
                                      )}
                                    >
                                      <td className="py-1.5 px-2">
                                        <div className="flex items-center gap-1.5">
                                          <span className={clsx(
                                            "text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded",
                                            isLong ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                          )}>
                                            {isLong ? 'BUY' : 'SELL'}
                                          </span>
                                          <span className="font-medium text-gray-800 dark:text-gray-200">{leg.assets?.symbol}</span>
                                        </div>
                                      </td>
                                      <td className="text-right py-1.5 px-1.5 tabular-nums">
                                        <span className={clsx("font-medium", currentWeight > 0 ? "text-gray-700 dark:text-gray-300" : "text-gray-400")}>
                                          {currentWeight > 0 ? currentWeight.toFixed(2) + '%' : '—'}
                                        </span>
                                      </td>
                                      <td className="text-right py-1.5 px-1.5 text-gray-400 dark:text-gray-500 tabular-nums">
                                        {benchWeight > 0 ? `${benchWeight.toFixed(2)}%` : '—'}
                                      </td>
                                      <td className="text-right py-1.5 px-1.5 tabular-nums">
                                        <span className={clsx(
                                          "font-medium",
                                          activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                          activeWeight < 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"
                                        )}>
                                          {activeWeight !== 0 ? (activeWeight > 0 ? '+' : '') + activeWeight.toFixed(2) + '%' : '—'}
                                        </span>
                                      </td>
                                      <td className="text-right py-1.5 px-1.5 tabular-nums">
                                        <span className={clsx(
                                          (holding?.shares || 0) > 0 ? "text-gray-700 dark:text-gray-300 font-medium" : "text-gray-400"
                                        )}>
                                          {(holding?.shares || 0) > 0 ? (holding?.shares || 0).toLocaleString() : '—'}
                                        </span>
                                      </td>
                                      <td className="py-1 px-1 bg-primary-50/30 dark:bg-primary-900/10">
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          placeholder={pairTradeSizingMode === 'absolute' ? (currentWeight > 0 ? currentWeight.toFixed(1) : (isLong ? '2.0' : '-2.0')) : (isLong ? '+0.5' : '-0.5')}
                                          value={
                                            pairTradeActiveInput?.legId === leg.id && pairTradeActiveInput?.field === 'weight'
                                              ? pairTradeActiveInput.rawValue
                                              : getPairTradeDisplayWeight(leg.id, leg.asset_id)
                                          }
                                          onFocus={() => setPairTradeActiveInput({
                                            legId: leg.id,
                                            field: 'weight',
                                            rawValue: getPairTradeDisplayWeight(leg.id, leg.asset_id)
                                          })}
                                          onChange={(e) => {
                                            setPairTradeActiveInput({ legId: leg.id, field: 'weight', rawValue: e.target.value })
                                            updatePairTradeLegTarget(leg.id, leg.asset_id, 'weight', e.target.value)
                                          }}
                                          onBlur={() => setPairTradeActiveInput(null)}
                                          className={clsx(
                                            "text-center text-xs h-6 w-full min-w-[50px] rounded border px-1 focus:outline-none focus:ring-1",
                                            target?.sourceField === 'weight'
                                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold focus:border-blue-500 focus:ring-blue-500"
                                              : target?.sourceField === 'shares' && target?.absoluteWeight !== null
                                                ? "border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 italic font-normal"
                                                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium focus:border-primary-500 focus:ring-primary-500"
                                          )}
                                        />
                                      </td>
                                      <td className="py-1 px-1 bg-primary-50/30 dark:bg-primary-900/10">
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          placeholder={holding?.shares ? Math.round(holding.shares).toString() : '—'}
                                          value={
                                            pairTradeActiveInput?.legId === leg.id && pairTradeActiveInput?.field === 'shares'
                                              ? pairTradeActiveInput.rawValue
                                              : getPairTradeDisplayShares(leg.id, leg.asset_id)
                                          }
                                          onFocus={() => setPairTradeActiveInput({
                                            legId: leg.id,
                                            field: 'shares',
                                            rawValue: getPairTradeDisplayShares(leg.id, leg.asset_id)
                                          })}
                                          onChange={(e) => {
                                            setPairTradeActiveInput({ legId: leg.id, field: 'shares', rawValue: e.target.value })
                                            updatePairTradeLegTarget(leg.id, leg.asset_id, 'shares', e.target.value)
                                          }}
                                          onBlur={() => setPairTradeActiveInput(null)}
                                          className={clsx(
                                            "text-center text-xs h-6 w-full min-w-[55px] rounded border px-1 focus:outline-none focus:ring-1",
                                            target?.sourceField === 'shares'
                                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold focus:border-blue-500 focus:ring-blue-500"
                                              : target?.sourceField === 'weight' && target?.absoluteShares !== null
                                                ? "border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 italic font-normal"
                                                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium focus:border-primary-500 focus:ring-primary-500"
                                          )}
                                        />
                                      </td>
                                      <td className="py-1 px-1">
                                        {hasChanges && (
                                          <button
                                            onClick={() => {
                                              const sizing: Record<string, { proposedWeight: number | null; proposedShares: number | null }> = {
                                                [leg.id]: {
                                                  proposedWeight: target?.absoluteWeight ?? null,
                                                  proposedShares: target?.absoluteShares ? Math.round(target.absoluteShares) : null,
                                                }
                                              }
                                              updatePairTradeSizingMutation.mutate(sizing)
                                            }}
                                            disabled={updatePairTradeSizingMutation.isPending}
                                            className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 transition-colors"
                                            title="Save sizing"
                                          >
                                            <Check className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                          {/* Summary row */}
                          <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 border-t border-gray-200 dark:border-gray-600 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-4">
                              <span className="text-gray-500 dark:text-gray-400">
                                {pairTradeSizingSummary.longCount} Buy · {pairTradeSizingSummary.shortCount} Sell
                              </span>
                            </div>
                            <div className="flex items-center gap-4 tabular-nums">
                              <div>
                                <span className="text-gray-400">Net: </span>
                                <span className={clsx(
                                  "font-medium",
                                  pairTradeSizingSummary.netWeight > 0 ? "text-green-600 dark:text-green-400" :
                                  pairTradeSizingSummary.netWeight < 0 ? "text-red-600 dark:text-red-400" : "text-gray-500"
                                )}>
                                  {pairTradeSizingSummary.netWeight > 0 ? '+' : ''}{pairTradeSizingSummary.netWeight.toFixed(2)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-400">Gross: </span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                  {pairTradeSizingSummary.grossWeight.toFixed(2)}%
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        {/* Helper text */}
                        <p className="text-[10px] text-gray-400 mt-2">
                          {pairTradeSizingMode === 'absolute' && 'Enter target weight % or shares — the other auto-calculates.'}
                          {pairTradeSizingMode === 'relative_current' && 'Enter +/− change from current — the other auto-calculates.'}
                          {pairTradeSizingMode === 'relative_benchmark' && 'Enter +/− vs benchmark — the other auto-calculates.'}
                          {(!pairTradeHoldings?.portfolioAum || pairTradeHoldings.portfolioAum === 0) && (
                            <span className="text-amber-500 ml-1">(Portfolio AUM needed for share calculation)</span>
                          )}
                        </p>
                        {/* Add to portfolio */}
                        <div className="mt-3">
                          <button className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-1 transition-colors">
                            <Plus className="h-3 w-3" />
                            Add to portfolio
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ========== REFERENCE LEVELS SECTION (collapsible, editable) ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setIsSizingExpanded(!isSizingExpanded)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300"
                      >
                        {isSizingExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Target className="h-3.5 w-3.5" />
                        Reference Levels
                      </button>
                      {isPairTradeOwner && !isEditingPairReferenceLevels && isSizingExpanded && (
                        <button
                          onClick={() => {
                            const legs = pairTradeData.trade_queue_items || pairTradeData.legs || []
                            const initial: Record<string, { targetPrice: string; stopLoss: string; takeProfit: string }> = {}
                            legs.forEach((leg: any) => {
                              initial[leg.id] = {
                                targetPrice: leg.target_price?.toString() || '',
                                stopLoss: leg.stop_loss?.toString() || '',
                                takeProfit: leg.take_profit?.toString() || '',
                              }
                            })
                            setEditedPairReferenceLevels(initial)
                            setIsEditingPairReferenceLevels(true)
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {isSizingExpanded && (
                      <div className="mt-2">
                        {isEditingPairReferenceLevels ? (
                          <div className="space-y-2">
                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                                    <th className="text-left py-1.5 px-2 font-semibold text-gray-600 dark:text-gray-300">Leg</th>
                                    <th className="text-center py-1.5 px-1 font-medium text-gray-500 dark:text-gray-400 w-20">Entry</th>
                                    <th className="text-center py-1.5 px-1 font-medium text-gray-500 dark:text-gray-400 w-20">Stop</th>
                                    <th className="text-center py-1.5 px-1 font-medium text-gray-500 dark:text-gray-400 w-20">Target</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(pairTradeData.trade_queue_items || pairTradeData.legs)?.map((leg: any, idx: number) => {
                                    const isLong = leg.pair_leg_type === 'long' || (leg.pair_leg_type === null && leg.action === 'buy')
                                    const edited = editedPairReferenceLevels[leg.id] || { targetPrice: '', stopLoss: '', takeProfit: '' }
                                    return (
                                      <tr key={leg.id} className={clsx("border-t border-gray-100 dark:border-gray-700/50", idx % 2 === 1 && "bg-gray-25 dark:bg-gray-800/30")}>
                                        <td className="py-1.5 px-2">
                                          <div className="flex items-center gap-1.5">
                                            <span className={clsx("text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded", isLong ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400")}>
                                              {isLong ? 'BUY' : 'SELL'}
                                            </span>
                                            <span className="font-medium text-gray-900 dark:text-white">{leg.assets?.symbol}</span>
                                          </div>
                                        </td>
                                        <td className="py-1 px-1">
                                          <input type="text" inputMode="decimal" placeholder="150.00" value={edited.targetPrice}
                                            onChange={(e) => setEditedPairReferenceLevels(prev => ({ ...prev, [leg.id]: { ...prev[leg.id], targetPrice: e.target.value } }))}
                                            className="text-center text-xs h-6 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                                          />
                                        </td>
                                        <td className="py-1 px-1">
                                          <input type="text" inputMode="decimal" placeholder="140.00" value={edited.stopLoss}
                                            onChange={(e) => setEditedPairReferenceLevels(prev => ({ ...prev, [leg.id]: { ...prev[leg.id], stopLoss: e.target.value } }))}
                                            className="text-center text-xs h-6 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                                          />
                                        </td>
                                        <td className="py-1 px-1">
                                          <input type="text" inputMode="decimal" placeholder="180.00" value={edited.takeProfit}
                                            onChange={(e) => setEditedPairReferenceLevels(prev => ({ ...prev, [leg.id]: { ...prev[leg.id], takeProfit: e.target.value } }))}
                                            className="text-center text-xs h-6 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                                          />
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="ghost" onClick={() => { setIsEditingPairReferenceLevels(false); setEditedPairReferenceLevels({}) }} disabled={updatePairTradeReferenceLevelsMutation.isPending}>
                                Cancel
                              </Button>
                              <Button size="sm" onClick={() => {
                                const levels: Record<string, { targetPrice: number | null; stopLoss: number | null; takeProfit: number | null }> = {}
                                Object.entries(editedPairReferenceLevels).forEach(([legId, vals]) => {
                                  levels[legId] = {
                                    targetPrice: vals.targetPrice ? parseFloat(vals.targetPrice) : null,
                                    stopLoss: vals.stopLoss ? parseFloat(vals.stopLoss) : null,
                                    takeProfit: vals.takeProfit ? parseFloat(vals.takeProfit) : null,
                                  }
                                })
                                updatePairTradeReferenceLevelsMutation.mutate(levels)
                              }} disabled={updatePairTradeReferenceLevelsMutation.isPending} loading={updatePairTradeReferenceLevelsMutation.isPending}>
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                                  <th className="text-left py-1.5 px-2 font-semibold text-gray-600 dark:text-gray-300">Leg</th>
                                  <th className="text-center py-1.5 px-1 font-medium text-gray-500 dark:text-gray-400 w-20">Entry</th>
                                  <th className="text-center py-1.5 px-1 font-medium text-red-500 dark:text-red-400 w-20">Stop</th>
                                  <th className="text-center py-1.5 px-1 font-medium text-green-500 dark:text-green-400 w-20">Target</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(pairTradeData.trade_queue_items || pairTradeData.legs)?.map((leg: any, idx: number) => {
                                  const isLong = leg.pair_leg_type === 'long' || (leg.pair_leg_type === null && leg.action === 'buy')
                                  return (
                                    <tr key={leg.id} className={clsx("border-t border-gray-100 dark:border-gray-700/50", idx % 2 === 1 && "bg-gray-25 dark:bg-gray-800/30")}>
                                      <td className="py-1.5 px-2">
                                        <div className="flex items-center gap-1.5">
                                          <span className={clsx("text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded", isLong ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400")}>
                                            {isLong ? 'BUY' : 'SELL'}
                                          </span>
                                          <span className="font-medium text-gray-900 dark:text-white">{leg.assets?.symbol}</span>
                                        </div>
                                      </td>
                                      <td className="text-center py-1 px-1 w-20 tabular-nums text-gray-700 dark:text-gray-300">
                                        {leg.target_price ? `$${leg.target_price.toFixed(2)}` : '—'}
                                      </td>
                                      <td className="text-center py-1 px-1 w-20 tabular-nums text-red-600 dark:text-red-400">
                                        {leg.stop_loss ? `$${leg.stop_loss.toFixed(2)}` : '—'}
                                      </td>
                                      <td className="text-center py-1 px-1 w-20 tabular-nums text-green-600 dark:text-green-400">
                                        {leg.take_profit ? `$${leg.take_profit.toFixed(2)}` : '—'}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== CONVICTION & TIME HORIZON SECTION (collapsible, editable) ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setIsRiskExpanded(!isRiskExpanded)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300"
                      >
                        {isRiskExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Gauge className="h-3.5 w-3.5" />
                        Conviction & Time Horizon
                      </button>
                      {isPairTradeOwner && !isEditingPairConviction && isRiskExpanded && (
                        <button
                          onClick={() => {
                            const firstLeg = (pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]
                            setEditedPairConviction(firstLeg?.conviction || null)
                            setEditedPairTimeHorizon(firstLeg?.time_horizon || null)
                            setIsEditingPairConviction(true)
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {isRiskExpanded && (
                      <div className="mt-3">
                        {isEditingPairConviction ? (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Conviction</label>
                              <div className="flex gap-2">
                                {(['low', 'medium', 'high'] as const).map((level) => (
                                  <button
                                    key={level}
                                    onClick={() => setEditedPairConviction(editedPairConviction === level ? null : level)}
                                    className={clsx(
                                      "flex-1 py-1.5 px-3 text-xs font-medium rounded border transition-colors",
                                      editedPairConviction === level
                                        ? level === 'low' ? "bg-gray-100 border-gray-400 text-gray-700"
                                        : level === 'medium' ? "bg-blue-100 border-blue-400 text-blue-700"
                                        : "bg-green-100 border-green-400 text-green-700"
                                        : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                                    )}
                                  >
                                    {level.charAt(0).toUpperCase() + level.slice(1)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Time Horizon</label>
                              <div className="flex gap-2">
                                {(['short', 'medium', 'long'] as const).map((horizon) => (
                                  <button
                                    key={horizon}
                                    onClick={() => setEditedPairTimeHorizon(editedPairTimeHorizon === horizon ? null : horizon)}
                                    className={clsx(
                                      "flex-1 py-1.5 px-3 text-xs font-medium rounded border transition-colors",
                                      editedPairTimeHorizon === horizon
                                        ? "bg-primary-100 border-primary-400 text-primary-700"
                                        : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                                    )}
                                  >
                                    {horizon.charAt(0).toUpperCase() + horizon.slice(1)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="ghost" onClick={() => {
                                setIsEditingPairConviction(false)
                                setEditedPairConviction(null)
                                setEditedPairTimeHorizon(null)
                              }} disabled={updatePairTradeConvictionMutation.isPending}>
                                Cancel
                              </Button>
                              <Button size="sm" onClick={() => updatePairTradeConvictionMutation.mutate({
                                conviction: editedPairConviction,
                                timeHorizon: editedPairTimeHorizon
                              })} disabled={updatePairTradeConvictionMutation.isPending} loading={updatePairTradeConvictionMutation.isPending}>
                                <Save className="h-3.5 w-3.5 mr-1" />
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400 block">Conviction</span>
                              <span className={clsx(
                                "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                                (pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]?.conviction === 'low' && "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
                                (pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]?.conviction === 'medium' && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                                (pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]?.conviction === 'high' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                                !(pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]?.conviction && "text-gray-400"
                              )}>
                                {(pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]?.conviction ? (pairTradeData.trade_queue_items || pairTradeData.legs)[0].conviction.charAt(0).toUpperCase() + (pairTradeData.trade_queue_items || pairTradeData.legs)[0].conviction.slice(1) : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400 block">Time Horizon</span>
                              <span className={clsx(
                                "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                                (pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]?.time_horizon && "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300",
                                !(pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]?.time_horizon && "text-gray-400"
                              )}>
                                {(pairTradeData.trade_queue_items || pairTradeData.legs)?.[0]?.time_horizon ? (pairTradeData.trade_queue_items || pairTradeData.legs)[0].time_horizon.charAt(0).toUpperCase() + (pairTradeData.trade_queue_items || pairTradeData.legs)[0].time_horizon.slice(1) : '—'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== ACTIONS - SEGMENTED SECTIONS ========== */}
                  {pairTradeData.status !== 'approved' && pairTradeData.status !== 'cancelled' && pairTradeData.status !== 'rejected' && pairTradeData.status !== 'archived' && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">

                      {/* SECTION 1: Move Forward (not shown in Deciding) */}
                      {pairTradeData.status !== 'deciding' && (
                        <div>
                          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                            Move Forward
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {(pairTradeData.status === 'idea') && (
                              <>
                                <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('discussing')} disabled={updatePairTradeStatusMutation.isPending}>
                                  <Wrench className="h-4 w-4 mr-1" />
                                  Working On
                                </Button>
                                <Button size="sm" onClick={() => updatePairTradeStatusMutation.mutate('simulating')} disabled={updatePairTradeStatusMutation.isPending}>
                                  <FlaskConical className="h-4 w-4 mr-1" />
                                  Modeling
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('deciding')} disabled={updatePairTradeStatusMutation.isPending}>
                                  <Scale className="h-4 w-4 mr-1" />
                                  Deciding
                                </Button>
                              </>
                            )}
                            {(pairTradeData.status === 'discussing' || pairTradeData.status === 'working_on') && (
                              <>
                                <Button size="sm" onClick={() => updatePairTradeStatusMutation.mutate('simulating')} disabled={updatePairTradeStatusMutation.isPending}>
                                  <FlaskConical className="h-4 w-4 mr-1" />
                                  Modeling
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('deciding')} disabled={updatePairTradeStatusMutation.isPending}>
                                  <Scale className="h-4 w-4 mr-1" />
                                  Deciding
                                </Button>
                              </>
                            )}
                            {(pairTradeData.status === 'simulating' || pairTradeData.status === 'modeling') && (
                              <Button size="sm" onClick={() => updatePairTradeStatusMutation.mutate('deciding')} disabled={updatePairTradeStatusMutation.isPending}>
                                <Scale className="h-4 w-4 mr-1" />
                                Deciding
                              </Button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* SECTION 2: Decision (only in Deciding stage) */}
                      {pairTradeData.status === 'deciding' && (
                        <div>
                          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                            Decision
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => updatePairTradeStatusMutation.mutate('approved')}
                              disabled={updatePairTradeStatusMutation.isPending}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => updatePairTradeStatusMutation.mutate('cancelled')}
                              disabled={updatePairTradeStatusMutation.isPending}
                            >
                              <Clock className="h-4 w-4 mr-1" />
                              Defer
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => updatePairTradeStatusMutation.mutate('rejected')}
                              disabled={updatePairTradeStatusMutation.isPending}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                          <button
                            onClick={() => updatePairTradeStatusMutation.mutate('simulating')}
                            disabled={updatePairTradeStatusMutation.isPending}
                            className="mt-2 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 flex items-center gap-1"
                          >
                            <FlaskConical className="h-3 w-3" />
                            Back to Modeling
                          </button>
                        </div>
                      )}

                      {/* SECTION 3: Remove */}
                      <div className="pt-2 border-t border-gray-100 dark:border-gray-700/50">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => updatePairTradeStatusMutation.mutate('cancelled')}
                            disabled={updatePairTradeStatusMutation.isPending}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          >
                            Defer
                          </button>
                          <button
                            onClick={() => updatePairTradeStatusMutation.mutate('cancelled')}
                            disabled={updatePairTradeStatusMutation.isPending}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          >
                            Archive
                          </button>
                          <button
                            onClick={() => updatePairTradeStatusMutation.mutate('deleted')}
                            disabled={updatePairTradeStatusMutation.isPending}
                            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Restore Actions for Archived/Deferred Pair Trades */}
                  {(pairTradeData.status === 'approved' || pairTradeData.status === 'cancelled' || pairTradeData.status === 'rejected' || pairTradeData.status === 'archived') && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        Restore
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('idea')} disabled={updatePairTradeStatusMutation.isPending}>
                          Ideas
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('discussing')} disabled={updatePairTradeStatusMutation.isPending}>
                          Working On
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('simulating')} disabled={updatePairTradeStatusMutation.isPending}>
                          Modeling
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => updatePairTradeStatusMutation.mutate('deleted')} className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Restore Actions for Deleted Pair Trades */}
                  {pairTradeData.status === 'deleted' && (
                    <div className="border-t border-red-200 dark:border-red-800/50 pt-4 bg-red-50/50 dark:bg-red-900/10 -mx-4 px-4 pb-4 rounded-b-lg">
                      <h3 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-3">Restore Deleted Pair Trade</h3>
                      <p className="text-xs text-red-600 dark:text-red-400 mb-3">This pair trade was deleted. You can restore it to an active status.</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('idea')} disabled={updatePairTradeStatusMutation.isPending}>
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Restore to Ideas
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('discussing')} disabled={updatePairTradeStatusMutation.isPending}>
                          <Wrench className="h-4 w-4 mr-1" />
                          Restore to Working On
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ========== METADATA SECTION ========== */}
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Created by {pairTradeData.users ? getUserDisplayName(pairTradeData.users) : 'Unknown'}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(pairTradeData.created_at), { addSuffix: true })}
                    </div>

                    {/* Visibility - Editable if owner */}
                    <div className="flex items-center gap-1 mt-2 relative" ref={visibilityDropdownRef}>
                      {pairTradeData.sharing_visibility && pairTradeData.sharing_visibility !== 'private' ? (
                        <Users className="h-3 w-3 text-blue-500" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                      {isPairTradeOwner ? (
                        <button onClick={() => setShowVisibilityDropdown(!showVisibilityDropdown)} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                          <span>{pairTradeData.sharing_visibility && pairTradeData.sharing_visibility !== 'private' ? 'Portfolio members can see' : 'Private - only you'}</span>
                          <ChevronDown className={clsx("h-3 w-3 transition-transform", showVisibilityDropdown && "rotate-180")} />
                        </button>
                      ) : (
                        <span>{pairTradeData.sharing_visibility && pairTradeData.sharing_visibility !== 'private' ? 'Portfolio members can see' : 'Private'}</span>
                      )}

                      {showVisibilityDropdown && isPairTradeOwner && (
                        <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[200px]">
                          <button onClick={() => updatePairTradeVisibilityMutation.mutate('private')} disabled={updatePairTradeVisibilityMutation.isPending} className={clsx("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", (!pairTradeData.sharing_visibility || pairTradeData.sharing_visibility === 'private') && "bg-gray-50 dark:bg-gray-700")}>
                            <Lock className="h-4 w-4 text-gray-500" />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">Private</div>
                              <div className="text-xs text-gray-500">Only visible to you</div>
                            </div>
                          </button>
                          <button onClick={() => updatePairTradeVisibilityMutation.mutate('team')} disabled={updatePairTradeVisibilityMutation.isPending} className={clsx("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", pairTradeData.sharing_visibility === 'team' && "bg-gray-50 dark:bg-gray-700")}>
                            <Users className="h-4 w-4 text-blue-500" />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">Portfolio</div>
                              <div className="text-xs text-gray-500">Members of selected portfolios can see</div>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Assigned To - Editable if owner */}
                    <div className="flex items-center gap-1 mt-2 relative" ref={assigneeDropdownRef}>
                      <User className="h-3 w-3" />
                      {isPairTradeOwner ? (
                        <button
                          onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                          className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          <span>
                            {pairTradeData.assigned_user
                              ? `Assigned to ${getUserDisplayName(pairTradeData.assigned_user)}`
                              : 'Assign to someone'}
                          </span>
                          <ChevronDown className={clsx("h-3 w-3 transition-transform", showAssigneeDropdown && "rotate-180")} />
                        </button>
                      ) : (
                        <span>
                          {pairTradeData.assigned_user
                            ? `Assigned to ${getUserDisplayName(pairTradeData.assigned_user)}`
                            : 'Not assigned'}
                        </span>
                      )}

                      {showAssigneeDropdown && isPairTradeOwner && (
                        <div className="absolute left-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[220px] max-h-[180px] overflow-y-auto">
                          <button
                            onClick={() => updatePairTradeAssigneeMutation.mutate(null)}
                            disabled={updatePairTradeAssigneeMutation.isPending}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors",
                              !pairTradeData.assigned_to && "bg-gray-50 dark:bg-gray-700"
                            )}
                          >
                            <XCircle className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-600 dark:text-gray-300">Unassign</span>
                          </button>
                          {teamMembers?.filter(m => m.id !== user?.id).map(member => (
                            <button
                              key={member.id}
                              onClick={() => updatePairTradeAssigneeMutation.mutate(member.id)}
                              disabled={updatePairTradeAssigneeMutation.isPending}
                              className={clsx(
                                "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors",
                                pairTradeData.assigned_to === member.id && "bg-primary-50 dark:bg-primary-900/20"
                              )}
                            >
                              <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[10px] font-medium">
                                {getUserInitials(member)}
                              </div>
                              <span className="text-sm text-gray-900 dark:text-white">{getUserDisplayName(member)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Collaborators / Co-analysts */}
                    <div className="flex items-center gap-1 mt-2 relative" ref={collaboratorsDropdownRef}>
                      <Users className="h-3 w-3" />
                      {isPairTradeOwner ? (
                        <button
                          onClick={() => setShowCollaboratorsDropdown(!showCollaboratorsDropdown)}
                          className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          <span>
                            {(pairTradeData.collaborators?.length > 0)
                              ? `${pairTradeData.collaborators.length} co-analyst${pairTradeData.collaborators.length > 1 ? 's' : ''}`
                              : 'Add co-analysts'}
                          </span>
                          <ChevronDown className={clsx("h-3 w-3 transition-transform", showCollaboratorsDropdown && "rotate-180")} />
                        </button>
                      ) : (
                        <span>
                          {(pairTradeData.collaborators?.length > 0)
                            ? `${pairTradeData.collaborators.length} co-analyst${pairTradeData.collaborators.length > 1 ? 's' : ''}`
                            : 'No co-analysts'}
                        </span>
                      )}

                      {showCollaboratorsDropdown && isPairTradeOwner && (
                        <div className="absolute left-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[220px] max-h-[180px] overflow-y-auto">
                          {teamMembers?.filter(m => m.id !== user?.id && m.id !== pairTradeData.assigned_to).map(member => {
                            const currentCollaborators: string[] = pairTradeData.collaborators || []
                            const isCollaborator = currentCollaborators.includes(member.id)
                            return (
                              <button
                                key={member.id}
                                onClick={() => {
                                  const newCollaborators = isCollaborator
                                    ? currentCollaborators.filter(id => id !== member.id)
                                    : [...currentCollaborators, member.id]
                                  updatePairTradeCollaboratorsMutation.mutate(newCollaborators)
                                }}
                                disabled={updatePairTradeCollaboratorsMutation.isPending}
                                className={clsx(
                                  "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors",
                                  isCollaborator && "bg-primary-50 dark:bg-primary-900/20"
                                )}
                              >
                                <div className={clsx(
                                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium",
                                  isCollaborator ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300" : "bg-gray-200 dark:bg-gray-700"
                                )}>
                                  {isCollaborator ? <Check className="h-3 w-3" /> : getUserInitials(member)}
                                </div>
                                <span className="text-sm text-gray-900 dark:text-white">{getUserDisplayName(member)}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Discussion Tab for Pair Trade */}
              {activeTab === 'discussion' && (
                <div className="flex flex-col h-full">
                  {/* Filter Bar */}
                  <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-500 dark:text-gray-400">View:</span>
                    <select
                      value={discussionPortfolioFilter || 'all'}
                      onChange={(e) => setDiscussionPortfolioFilter(e.target.value === 'all' ? null : e.target.value)}
                      className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    >
                      <option value="all">All Messages</option>
                      <option value="general">General Only</option>
                      {labLinks.map(link => link.trade_lab?.portfolio && (
                        <option key={link.trade_lab.portfolio.id} value={link.trade_lab.portfolio.id}>
                          {link.trade_lab.portfolio.name}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {filteredDiscussionMessages.length} {filteredDiscussionMessages.length === 1 ? 'message' : 'messages'}
                    </span>
                  </div>

                  {/* Messages List */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {filteredDiscussionMessages.length > 0 ? (
                      <div className="space-y-0.5">
                        {filteredDiscussionMessages.map((message: any, index: number) => {
                          const prevMessage = index > 0 ? filteredDiscussionMessages[index - 1] : null
                          const isSameUser = prevMessage && (prevMessage as any).user_id === message.user_id
                          const showUserInfo = !isSameUser
                          const isSelected = selectedMessageId === message.id

                          return (
                            <div key={message.id} className="group">
                              {showUserInfo ? (
                                <div
                                  className="flex items-start space-x-3 mt-3 first:mt-0 cursor-pointer"
                                  onClick={() => setSelectedMessageId(isSelected ? null : message.id)}
                                >
                                  <div className="w-6 h-6 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span className="text-primary-600 dark:text-primary-400 text-xs font-semibold">
                                      {getUserInitials(message.user)}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center space-x-2 mb-1">
                                      <span className="text-xs font-medium text-gray-900 dark:text-white">
                                        {getUserDisplayName(message.user)}
                                      </span>
                                      {message.portfolio && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                                          {message.portfolio.name}
                                        </span>
                                      )}
                                      {message.is_pinned && <Pin className="h-3 w-3 text-warning-500" />}
                                    </div>
                                    {message.reply_to && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center">
                                        <Reply className="h-3 w-3 mr-1" />
                                        Replying to message
                                      </div>
                                    )}
                                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                      <SmartInputRenderer content={message.content} inline />
                                    </div>
                                    {isSelected && (
                                      <div className="flex items-center space-x-2 mt-2">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{formatMessageTime(message.created_at)}</span>
                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                        <button onClick={(e) => { e.stopPropagation(); setReplyToMessage(message.id); discussionInputRef.current?.focus() }} className="text-xs text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors">Reply</button>
                                        <button onClick={(e) => { e.stopPropagation(); toggleDiscussionPinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned }) }} className="text-xs text-gray-500 hover:text-warning-600 dark:text-gray-400 dark:hover:text-warning-400 transition-colors">{message.is_pinned ? 'Unpin' : 'Pin'}</button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-2 px-2 py-0.5 rounded cursor-pointer" onClick={() => setSelectedMessageId(isSelected ? null : message.id)}>
                                  <div className="w-6 h-6 flex-shrink-0 mr-3"></div>
                                  <div className="flex-1 min-w-0">
                                    {message.reply_to && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center">
                                        <Reply className="h-3 w-3 mr-1" />Replying to message
                                      </div>
                                    )}
                                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                      <SmartInputRenderer content={message.content} inline />
                                    </div>
                                    {isSelected && (
                                      <div className="flex items-center space-x-2 mt-2">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{formatMessageTime(message.created_at)}</span>
                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                        <button onClick={(e) => { e.stopPropagation(); setReplyToMessage(message.id); discussionInputRef.current?.focus() }} className="text-xs text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 transition-colors">Reply</button>
                                        <button onClick={(e) => { e.stopPropagation(); toggleDiscussionPinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned }) }} className="text-xs text-gray-500 hover:text-warning-600 dark:text-gray-400 dark:hover:text-warning-400 transition-colors">{message.is_pinned ? 'Unpin' : 'Pin'}</button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                        <div ref={messagesEndRef} className="h-4" />
                      </div>
                    ) : (
                      <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                        <MessageCircle className="h-8 w-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
                        <p className="text-sm">No discussion yet</p>
                        <p className="text-xs">Start the conversation about this trade!</p>
                      </div>
                    )}
                  </div>

                  {/* Message Input */}
                  <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                    {replyToMessage && replyToMessageData && (
                      <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Reply className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                            <span className="text-xs font-medium text-blue-900 dark:text-blue-300">Replying to {getUserDisplayName(replyToMessageData.user)}</span>
                          </div>
                          <button onClick={() => setReplyToMessage(null)} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"><X className="h-3 w-3" /></button>
                        </div>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1 line-clamp-2">{replyToMessageData.content}</p>
                      </div>
                    )}
                    {/* Portfolio Context Selector */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Post to:</span>
                      <select
                        value={messagePortfolioContext || 'general'}
                        onChange={(e) => setMessagePortfolioContext(e.target.value === 'general' ? null : e.target.value)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      >
                        <option value="general">General</option>
                        {labLinks.map(link => link.trade_lab?.portfolio && (
                          <option key={link.trade_lab.portfolio.id} value={link.trade_lab.portfolio.id}>
                            {link.trade_lab.portfolio.name}
                          </option>
                        ))}
                      </select>
                      {messagePortfolioContext && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          Only visible in {labLinks.find(l => l.trade_lab?.portfolio?.id === messagePortfolioContext)?.trade_lab?.portfolio?.name} context
                        </span>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      <div className="flex-1">
                        <UniversalSmartInput ref={discussionInputRef} value={discussionMessage} onChange={(value, metadata) => { setDiscussionMessage(value); setDiscussionMetadata(metadata) }} onKeyDown={handleDiscussionKeyDown} placeholder="Add to the discussion..." textareaClassName="text-sm" rows={2} minHeight="60px" enableMentions={true} enableHashtags={true} enableTemplates={false} enableDataFunctions={false} enableAI={false} />
                      </div>
                      <button onClick={handleSendDiscussionMessage} disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending} className={clsx("self-end p-2 rounded-lg transition-colors", discussionMessage.trim() ? "bg-primary-600 text-white hover:bg-primary-700" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed")}><Send className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              )}

              {/* Proposals Tab for Pair Trade - PM Review Mode */}
              {activeTab === 'proposals' && (() => {
                // Get pair trade legs
                const pairLegs = pairTradeData?.trade_queue_items || pairTradeData?.legs || []

                // Group proposals by portfolio
                const proposalsByPortfolio = proposals.reduce((acc, proposal) => {
                  const portfolioId = proposal.portfolio_id || 'unknown'
                  if (!acc[portfolioId]) {
                    acc[portfolioId] = {
                      name: proposal.portfolio?.name || 'Unknown Portfolio',
                      myProposal: null as typeof proposal | null,
                      otherProposals: [] as typeof proposals
                    }
                  }
                  if (proposal.user_id === user?.id) {
                    acc[portfolioId].myProposal = proposal
                  } else {
                    acc[portfolioId].otherProposals.push(proposal)
                  }
                  return acc
                }, {} as Record<string, { name: string; myProposal: typeof proposals[0] | null; otherProposals: typeof proposals }>)

                // Sizing mode options (kept for edit mode)
                const pairSizingModes: { value: ProposalSizingMode; label: string }[] = [
                  { value: 'weight', label: 'Weight %' },
                  { value: 'delta_weight', label: '± Weight' },
                  { value: 'active_weight', label: 'Active Wgt' },
                  { value: 'delta_benchmark', label: '± Bench' },
                ]

                // Calculate exposure summary from pair legs
                const exposureSummary = pairLegs.reduce((acc, leg: any) => {
                  const isLong = leg.action === 'buy' || leg.action === 'add' || leg.pair_leg_type === 'long'
                  const weight = leg.proposed_weight || 0
                  if (weight > 0) acc.hasSizing = true
                  if (isLong) {
                    acc.longExposure += weight
                    acc.buySymbols.push(leg.assets?.symbol || '?')
                  } else {
                    acc.shortExposure += weight
                    acc.sellSymbols.push(leg.assets?.symbol || '?')
                  }
                  return acc
                }, { longExposure: 0, shortExposure: 0, buySymbols: [] as string[], sellSymbols: [] as string[], hasSizing: false })

                const netExposure = exposureSummary.longExposure - exposureSummary.shortExposure
                const grossExposure = exposureSummary.longExposure + exposureSummary.shortExposure
                const hasSizing = exposureSummary.hasSizing

                // Separate legs into buys and sells
                const buyLegs = pairLegs.filter((leg: any) => leg.action === 'buy' || leg.action === 'add' || leg.pair_leg_type === 'long')
                const sellLegs = pairLegs.filter((leg: any) => leg.action === 'sell' || leg.action === 'reduce' || leg.pair_leg_type === 'short')

                return (
                  <div className="flex flex-col h-full">
                    {/* Scrollable content area */}
                    <div className="flex-1 overflow-y-auto space-y-4 p-4">
                      {/* ═══════════════════════════════════════════════════════════════
                          PROPOSALS GROUPED BY PORTFOLIO
                      ═══════════════════════════════════════════════════════════════ */}
                      {Object.entries(proposalsByPortfolio).map(([portfolioId, { name: portfolioName, myProposal, otherProposals }]) => {
                        // Combine all proposals for this portfolio
                        const allPortfolioProposals = [myProposal, ...otherProposals].filter(Boolean) as typeof proposals

                        if (allPortfolioProposals.length === 0) return null

                        return (
                          <div key={portfolioId} className="space-y-2">
                            {/* Portfolio Header */}
                            <div className="flex items-center gap-2">
                              <Briefcase className="h-4 w-4 text-gray-400" />
                              <span className="font-medium text-sm text-gray-900 dark:text-white">{portfolioName}</span>
                              <span className="text-xs text-gray-500">({allPortfolioProposals.length} proposal{allPortfolioProposals.length !== 1 ? 's' : ''})</span>
                            </div>

                            {/* Proposals for this portfolio */}
                            <div className="space-y-2">
                              {allPortfolioProposals.map((proposal) => {
                                const isMyProposal = proposal.user_id === user?.id
                                const isExpanded = expandedProposalInputs.has(`pair-${portfolioId}-${proposal.id}`)
                                const isEditing = editingPairProposalId === proposal.id

                                // Get proposal legs
                                const sizingCtx = proposal.sizing_context as any
                                let proposalLegs = sizingCtx?.legs || []
                                const currentSizingMode = sizingCtx?.sizingMode || sizingCtx?.proposalType || proposalLegs[0]?.sizingMode || proposal.sizing_mode || 'weight'

                                // Build legs from pair trade data if not in sizing_context
                                if (proposalLegs.length === 0 && pairLegs.length > 0) {
                                  proposalLegs = pairLegs.map((leg: any) => ({
                                    assetId: leg.asset_id || leg.assets?.id,
                                    symbol: leg.assets?.symbol || '?',
                                    action: leg.action || 'buy',
                                    weight: proposal.weight,
                                    sizingMode: currentSizingMode,
                                  }))
                                }

                                // Get proposer info
                                const proposerName = proposal.users?.first_name && proposal.users?.last_name
                                  ? `${proposal.users.first_name} ${proposal.users.last_name.charAt(0)}.`
                                  : proposal.users?.first_name || proposal.users?.email?.split('@')[0] || 'Unknown'

                                // Get portfolio-specific role
                                const portfolioRole = (proposal.users as any)?.portfolio_role
                                const isPM = portfolioRole?.toLowerCase().includes('manager') || portfolioRole?.toLowerCase().includes('pm')
                                const roleLabel = portfolioRole || (isPM ? 'Portfolio Manager' : 'Analyst')

                                // Get proposal timestamp
                                const proposalTime = proposal.created_at
                                  ? formatDistanceToNow(new Date(proposal.created_at), { addSuffix: true })
                                  : null

                                // Calculate proposal-level Net/Gross exposure
                                const proposalExposure = proposalLegs.reduce((acc: { long: number; short: number }, leg: any) => {
                                  const weight = leg.weight || 0
                                  if (leg.action === 'buy' || leg.action === 'add') {
                                    acc.long += weight
                                  } else {
                                    acc.short += weight
                                  }
                                  return acc
                                }, { long: 0, short: 0 })
                                const proposalNet = proposalExposure.long - proposalExposure.short
                                const proposalGross = proposalExposure.long + proposalExposure.short
                                const hasSizingData = proposalLegs.some((leg: any) => leg.weight != null && leg.weight !== 0)

                                return (
                                  <div key={proposal.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                    {/* Proposal Header - Clickable to expand/collapse */}
                                    <button
                                      type="button"
                                      onClick={() => setExpandedProposalInputs(prev => {
                                        const next = new Set(prev)
                                        const key = `pair-${portfolioId}-${proposal.id}`
                                        if (next.has(key)) next.delete(key)
                                        else next.add(key)
                                        return next
                                      })}
                                      className="w-full text-left bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    >
                                      {/* Row 1: Proposer Attribution */}
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                          {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                                          <span className="font-medium text-sm text-gray-900 dark:text-white">{proposerName}</span>
                                          <span className="text-xs text-gray-500 dark:text-gray-400">·</span>
                                          <span className={clsx(
                                            "text-xs font-medium",
                                            isPM ? "text-primary-600 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"
                                          )}>
                                            {roleLabel}
                                          </span>
                                          <span className="text-xs text-gray-400">({portfolioName})</span>
                                        </div>
                                        {proposalTime && (
                                          <span className="text-xs text-gray-400">{proposalTime}</span>
                                        )}
                                      </div>

                                      {/* Row 2: Net/Gross Summary */}
                                      <div className="flex items-center gap-4 pl-6">
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className="text-gray-500 dark:text-gray-400">Net:</span>
                                          <span className={clsx(
                                            "font-semibold tabular-nums",
                                            !hasSizingData ? "text-gray-400" :
                                            proposalNet > 0 ? "text-green-600 dark:text-green-400" :
                                            proposalNet < 0 ? "text-red-600 dark:text-red-400" :
                                            "text-gray-600 dark:text-gray-300"
                                          )}>
                                            {hasSizingData ? `${proposalNet >= 0 ? '+' : ''}${proposalNet.toFixed(2)}%` : 'Not sized'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className="text-gray-500 dark:text-gray-400">Gross:</span>
                                          <span className={clsx(
                                            "font-semibold tabular-nums",
                                            hasSizingData ? "text-gray-700 dark:text-gray-200" : "text-gray-400"
                                          )}>
                                            {hasSizingData ? `${proposalGross.toFixed(2)}%` : '—'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-gray-500">
                                          <span>{proposalLegs.filter((l: any) => l.action === 'buy' || l.action === 'add').length}B</span>
                                          <span>/</span>
                                          <span>{proposalLegs.filter((l: any) => l.action === 'sell' || l.action === 'reduce').length}S</span>
                                        </div>
                                      </div>
                                    </button>

                            {/* Expanded Sizing Details (Edit Mode) */}
                            {isExpanded && (
                              <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-700/50 space-y-3">
                                {(() => {
                                  const legs = isEditing ? editedPairProposalLegs : proposalLegs
                                  const buyProposalLegs = legs.filter((leg: any) => leg.action === 'buy' || leg.action === 'add')
                                  const sellProposalLegs = legs.filter((leg: any) => leg.action === 'sell' || leg.action === 'reduce')
                                  const hasBenchmark = false // TODO: set to true when benchmark_holdings available

                                  // ═══════════════════════════════════════════════════════════════
                                  // UNIFIED SIZING INPUT PARSER
                                  // Supports: 1.5, +0.5, -0.25, @1.0, @+0.5, @-0.25, 50bp, @+25bp
                                  // ═══════════════════════════════════════════════════════════════
                                  type SizingIntent = {
                                    isValid: boolean
                                    error?: string
                                    basis: 'portfolio' | 'active'
                                    operation: 'set' | 'delta'
                                    value: number // always in percentage
                                    interpretation: string
                                  }

                                  const parseSizingInput = (input: string, currentWeight: number, benchmarkWeight: number | null, currentActiveWeight: number | null): SizingIntent => {
                                    const trimmed = input.trim()
                                    if (!trimmed) {
                                      return { isValid: false, basis: 'portfolio', operation: 'set', value: 0, interpretation: '' }
                                    }

                                    // Check for @ prefix (active weight basis)
                                    const isActiveBasis = trimmed.startsWith('@')
                                    const withoutAt = isActiveBasis ? trimmed.slice(1) : trimmed

                                    // Check for explicit sign (delta operation)
                                    const hasExplicitSign = withoutAt.startsWith('+') || withoutAt.startsWith('-')
                                    const isDelta = hasExplicitSign

                                    // Extract numeric part (handle %, bp suffixes)
                                    let numericPart = withoutAt.replace(/[+\-]/g, '')
                                    let multiplier = 1

                                    if (numericPart.endsWith('bp')) {
                                      numericPart = numericPart.slice(0, -2)
                                      multiplier = 0.01 // basis points to percent
                                    } else if (numericPart.endsWith('%')) {
                                      numericPart = numericPart.slice(0, -1)
                                    }

                                    const numValue = parseFloat(numericPart)
                                    if (isNaN(numValue)) {
                                      return { isValid: false, error: 'Invalid number', basis: 'portfolio', operation: 'set', value: 0, interpretation: '' }
                                    }

                                    // Apply sign for delta operations
                                    let finalValue = numValue * multiplier
                                    if (isDelta && withoutAt.startsWith('-')) {
                                      finalValue = -finalValue
                                    }

                                    // Validate active basis requires benchmark
                                    if (isActiveBasis && benchmarkWeight === null) {
                                      return { isValid: false, error: 'Benchmark unavailable', basis: 'active', operation: isDelta ? 'delta' : 'set', value: finalValue, interpretation: '' }
                                    }

                                    // Build interpretation string
                                    let interpretation = ''
                                    if (isActiveBasis) {
                                      if (isDelta) {
                                        interpretation = finalValue >= 0
                                          ? `Increase Active by ${Math.abs(finalValue).toFixed(2)}%`
                                          : `Decrease Active by ${Math.abs(finalValue).toFixed(2)}%`
                                      } else {
                                        interpretation = `Set Active to ${finalValue >= 0 ? '+' : ''}${finalValue.toFixed(2)}%`
                                      }
                                    } else {
                                      if (isDelta) {
                                        interpretation = finalValue >= 0
                                          ? `Add ${Math.abs(finalValue).toFixed(2)}% to position`
                                          : `Reduce position by ${Math.abs(finalValue).toFixed(2)}%`
                                      } else {
                                        interpretation = `Set weight to ${finalValue.toFixed(2)}%`
                                      }
                                    }

                                    return {
                                      isValid: true,
                                      basis: isActiveBasis ? 'active' : 'portfolio',
                                      operation: isDelta ? 'delta' : 'set',
                                      value: finalValue,
                                      interpretation,
                                    }
                                  }

                                  // Compute target weight from parsed intent
                                  const computeTargetWeight = (intent: SizingIntent, currentWeight: number, benchmarkWeight: number | null, currentActiveWeight: number | null): number | null => {
                                    if (!intent.isValid) return null

                                    if (intent.basis === 'active') {
                                      if (benchmarkWeight === null) return null
                                      if (intent.operation === 'delta') {
                                        // Δ Active: new active = current active + delta, target = bench + new active
                                        const newActive = (currentActiveWeight || 0) + intent.value
                                        return benchmarkWeight + newActive
                                      } else {
                                        // Set Active: target = bench + active
                                        return benchmarkWeight + intent.value
                                      }
                                    } else {
                                      if (intent.operation === 'delta') {
                                        // Δ Portfolio: target = current + delta
                                        return currentWeight + intent.value
                                      } else {
                                        // Set Target: target = value
                                        return intent.value
                                      }
                                    }
                                  }

                                  // Format delta with sign
                                  const formatDelta = (val: number | null) => {
                                    if (val == null) return '—'
                                    return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`
                                  }

                                  const renderLegRow = (leg: any, idx: number, isBuy: boolean) => {
                                    const legIdx = legs.findIndex((l: any) => l === leg)
                                    const pairLeg = pairLegs[legIdx] || pairLegs.find((pl: any) => pl.assets?.symbol === leg.symbol)
                                    const assetId = leg.assetId || pairLeg?.asset_id || pairLeg?.assets?.id
                                    const companyName = pairLeg?.assets?.company_name || ''
                                    const holding = pairTradePortfolioHoldings?.[portfolioId]?.[assetId]
                                    const currentWeight = holding?.weight || 0
                                    const benchmarkWeight: number | null = null // TODO: fetch from benchmark_holdings
                                    const currentActiveWeight = benchmarkWeight !== null ? currentWeight - benchmarkWeight : null
                                    const targetWeight = leg.weight

                                    // Derived values
                                    const deltaPortfolio = targetWeight != null ? targetWeight - currentWeight : null
                                    const targetActiveWeight = targetWeight != null && benchmarkWeight !== null ? targetWeight - benchmarkWeight : null

                                    // Get the raw input string for this leg (stored in sizing_input field or fall back to weight)
                                    const sizingInputKey = `sizing-${portfolioId}-${legIdx}`
                                    const rawInput = pairProposalSourceFields[sizingInputKey] || (targetWeight != null ? targetWeight.toFixed(2) : '')

                                    // Parse current input for interpretation display
                                    const parsedIntent = parseSizingInput(rawInput, currentWeight, benchmarkWeight, currentActiveWeight)

                                    // Handle sizing input change
                                    const handleSizingInput = (value: string) => {
                                      // Store raw input for display
                                      setPairProposalSourceFields(prev => ({ ...prev, [sizingInputKey]: value }))

                                      // Parse and compute target weight
                                      const intent = parseSizingInput(value, currentWeight, benchmarkWeight, currentActiveWeight)
                                      const newTargetWeight = computeTargetWeight(intent, currentWeight, benchmarkWeight, currentActiveWeight)

                                      setEditedPairProposalLegs(prev => prev.map((l, i) => i === legIdx ? { ...l, weight: newTargetWeight } : l))
                                    }

                                    return (
                                      <tr key={idx} className={clsx("border-b last:border-0", isBuy ? "border-green-100 dark:border-green-800/20" : "border-red-100 dark:border-red-800/20")}>
                                        {/* Asset: Ticker + Company Name */}
                                        <td className="py-2 px-2">
                                          <div className="flex flex-col">
                                            <span className="font-semibold text-gray-900 dark:text-white">{leg.symbol}</span>
                                            {companyName && (
                                              <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[90px]">{companyName}</span>
                                            )}
                                          </div>
                                        </td>

                                        {/* Current Weight */}
                                        <td className="text-right py-2 px-2 tabular-nums text-xs">
                                          <span className="text-gray-600 dark:text-gray-300">{currentWeight.toFixed(2)}%</span>
                                        </td>

                                        {/* Benchmark Weight */}
                                        <td className="text-right py-2 px-2 tabular-nums text-xs">
                                          <span className="text-gray-400">{benchmarkWeight !== null ? `${benchmarkWeight.toFixed(2)}%` : '—'}</span>
                                        </td>

                                        {/* Sizing Input (THE SINGLE EDITABLE FIELD) */}
                                        <td className="text-right py-1.5 px-2">
                                          {isEditing ? (
                                            <div className="flex flex-col items-end">
                                              <input
                                                type="text"
                                                className={clsx(
                                                  "w-24 h-7 px-2 text-xs text-right border rounded bg-white dark:bg-gray-700 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-medium",
                                                  parsedIntent.error
                                                    ? "border-red-400 dark:border-red-600 text-red-600 dark:text-red-400"
                                                    : "border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-400"
                                                )}
                                                value={rawInput}
                                                onChange={(e) => handleSizingInput(e.target.value)}
                                                placeholder="1.5, +0.5, @1.0"
                                              />
                                              {/* Interpretation line */}
                                              {rawInput && (
                                                <span className={clsx(
                                                  "text-[9px] mt-0.5 text-right truncate max-w-[96px]",
                                                  parsedIntent.error ? "text-red-500" : "text-gray-400 dark:text-gray-500"
                                                )}>
                                                  {parsedIntent.error || parsedIntent.interpretation}
                                                </span>
                                              )}
                                            </div>
                                          ) : (
                                            <span className="text-xs font-medium text-primary-600 dark:text-primary-400 tabular-nums">
                                              {targetWeight != null ? `${targetWeight.toFixed(2)}%` : '—'}
                                            </span>
                                          )}
                                        </td>

                                        {/* Target Weight (derived) */}
                                        <td className="text-right py-2 px-2 tabular-nums">
                                          <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                            {targetWeight != null ? `${targetWeight.toFixed(2)}%` : '—'}
                                          </span>
                                        </td>

                                        {/* Δ Portfolio (derived) */}
                                        <td className="text-right py-2 px-2 tabular-nums">
                                          <span className={clsx(
                                            "text-xs font-medium",
                                            deltaPortfolio != null && deltaPortfolio > 0 ? "text-green-600 dark:text-green-400" :
                                            deltaPortfolio != null && deltaPortfolio < 0 ? "text-red-600 dark:text-red-400" :
                                            "text-gray-400"
                                          )}>
                                            {formatDelta(deltaPortfolio)}
                                          </span>
                                        </td>

                                        {/* Active Weight (derived) */}
                                        <td className="text-right py-2 px-2 tabular-nums">
                                          <span className={clsx(
                                            "text-xs",
                                            targetActiveWeight != null && targetActiveWeight > 0 ? "text-green-600 dark:text-green-400" :
                                            targetActiveWeight != null && targetActiveWeight < 0 ? "text-red-600 dark:text-red-400" :
                                            "text-gray-400"
                                          )}>
                                            {targetActiveWeight != null ? formatDelta(targetActiveWeight) : '—'}
                                          </span>
                                        </td>
                                      </tr>
                                    )
                                  }

                                  // Calculate pair trade totals for summary
                                  const calcTotals = () => {
                                    let longTotal = 0, shortTotal = 0
                                    legs.forEach((leg: any) => {
                                      if (leg.weight != null) {
                                        if (leg.action === 'buy' || leg.action === 'add') {
                                          longTotal += leg.weight
                                        } else {
                                          shortTotal += leg.weight
                                        }
                                      }
                                    })
                                    return { longTotal, shortTotal, net: longTotal - shortTotal, gross: longTotal + shortTotal }
                                  }
                                  const totals = calcTotals()

                                  return (
                                    <div className="space-y-3">
                                      {/* Sizing hint - only when editing */}
                                      {isEditing && (
                                        <div className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1.5">
                                          <span className="font-medium">Sizing:</span>{' '}
                                          <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">1.5</code> target % ·{' '}
                                          <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">+0.5</code> add % ·{' '}
                                          <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">@1.0</code> active % ·{' '}
                                          <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">@+0.5</code> Δ active
                                        </div>
                                      )}

                                      {/* Live totals summary */}
                                      {(totals.longTotal > 0 || totals.shortTotal > 0) && (
                                        <div className="flex items-center gap-4 text-xs px-1">
                                          <span className="text-gray-500">Long: <span className="font-medium text-green-600 dark:text-green-400">{totals.longTotal.toFixed(2)}%</span></span>
                                          <span className="text-gray-500">Short: <span className="font-medium text-red-600 dark:text-red-400">{totals.shortTotal.toFixed(2)}%</span></span>
                                          <span className="text-gray-500">Net: <span className={clsx("font-medium", totals.net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>{totals.net >= 0 ? '+' : ''}{totals.net.toFixed(2)}%</span></span>
                                          <span className="text-gray-500">Gross: <span className="font-medium text-gray-700 dark:text-gray-300">{totals.gross.toFixed(2)}%</span></span>
                                        </div>
                                      )}

                                      {/* BUYS */}
                                      {buyProposalLegs.length > 0 && (
                                        <div>
                                          <div className="flex items-center gap-2 mb-1">
                                            <div className="w-1 h-3 bg-green-500 rounded-full"></div>
                                            <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">Buys</span>
                                          </div>
                                          <div className="bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-800/30 overflow-hidden overflow-x-auto">
                                            <table className="w-full text-xs">
                                              <thead>
                                                <tr className="border-b border-green-200 dark:border-green-800/30 bg-green-100/50 dark:bg-green-900/20">
                                                  <th className="text-left py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Asset</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Current</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Bench</th>
                                                  <th className="text-center py-1.5 px-2 font-medium text-primary-600 dark:text-primary-400">Sizing</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Target</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-500 dark:text-gray-500">Δ Port</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-500 dark:text-gray-500">Active</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {buyProposalLegs.map((leg: any, idx: number) => renderLegRow(leg, idx, true))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}

                                      {/* SELLS */}
                                      {sellProposalLegs.length > 0 && (
                                        <div>
                                          <div className="flex items-center gap-2 mb-1">
                                            <div className="w-1 h-3 bg-red-500 rounded-full"></div>
                                            <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">Sells</span>
                                          </div>
                                          <div className="bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800/30 overflow-hidden overflow-x-auto">
                                            <table className="w-full text-xs">
                                              <thead>
                                                <tr className="border-b border-red-200 dark:border-red-800/30 bg-red-100/50 dark:bg-red-900/20">
                                                  <th className="text-left py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Asset</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Current</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Bench</th>
                                                  <th className="text-center py-1.5 px-2 font-medium text-primary-600 dark:text-primary-400">Sizing</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Target</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-500 dark:text-gray-500">Δ Port</th>
                                                  <th className="text-right py-1.5 px-2 font-medium text-gray-500 dark:text-gray-500">Active</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {sellProposalLegs.map((leg: any, idx: number) => renderLegRow(leg, idx, false))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })()}

                                {/* Proposal Actions */}
                                <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-700/50">
                                  {/* Left: Edit/Withdraw (own proposals only) */}
                                  <div className="flex items-center gap-2">
                                    {isMyProposal && (
                                      isEditing ? (
                                        <>
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => { setEditingPairProposalId(null); setEditedPairProposalLegs([]); setPairProposalSourceFields({}) }}
                                            disabled={isSavingPairProposal}
                                          >
                                            Cancel
                                          </Button>
                                          <Button
                                            size="sm"
                                            disabled={isSavingPairProposal}
                                            onClick={async () => {
                                              setIsSavingPairProposal(true)
                                              try {
                                                const context: ActionContext = {
                                                  actorId: user!.id,
                                                  actorName: [user!.first_name, user!.last_name].filter(Boolean).join(' ') || user!.email || '',
                                                  actorEmail: user!.email || '',
                                                  actorRole: (user!.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
                                                  requestId: crypto.randomUUID(),
                                                  uiSource: 'modal',
                                                }
                                                const editSizingMode = editedPairProposalLegs[0]?.sizingMode || currentSizingMode
                                                await upsertProposal({
                                                  trade_queue_item_id: proposal.trade_queue_item_id,
                                                  portfolio_id: proposal.portfolio_id,
                                                  weight: null,
                                                  shares: null,
                                                  sizing_mode: editSizingMode as TradeSizingMode,
                                                  sizing_context: {
                                                    isPairTrade: true,
                                                    sizingMode: editSizingMode,
                                                    legs: editedPairProposalLegs.map(leg => ({
                                                      assetId: leg.assetId,
                                                      symbol: leg.symbol,
                                                      action: leg.action,
                                                      weight: leg.weight,
                                                      sizingMode: leg.sizingMode,
                                                    })),
                                                  },
                                                  notes: proposal.notes,
                                                }, context)
                                                refetchProposals()
                                                setEditingPairProposalId(null)
                                                setEditedPairProposalLegs([])
                                                setPairProposalSourceFields({})
                                              } finally {
                                                setIsSavingPairProposal(false)
                                              }
                                            }}
                                          >
                                            <Save className="h-3.5 w-3.5 mr-1" />
                                            Save
                                          </Button>
                                        </>
                                      ) : (
                                        <>
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              setEditingPairProposalId(proposal.id)
                                              setEditedPairProposalLegs(proposalLegs.map((leg: any) => ({
                                                assetId: leg.assetId,
                                                symbol: leg.symbol,
                                                action: leg.action,
                                                weight: leg.weight,
                                                sizingMode: leg.sizingMode || currentSizingMode,
                                              })))
                                            }}
                                          >
                                            <Pencil className="h-3.5 w-3.5 mr-1" />
                                            Edit
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            className="hover:!text-red-600 hover:!border-red-400 hover:!bg-red-50 dark:hover:!text-red-400 dark:hover:!border-red-600 dark:hover:!bg-red-900/20"
                                            onClick={async () => {
                                              const { error } = await supabase.from('trade_proposals').update({ is_active: false }).eq('id', proposal.id).eq('user_id', user?.id)
                                              if (!error) refetchProposals()
                                            }}
                                          >
                                            <XCircle className="h-3.5 w-3.5 mr-1" />
                                            Withdraw
                                          </Button>
                                        </>
                                      )
                                    )}
                                  </div>

                                  {/* Right: Accept/Reject (proposal-level decisions) */}
                                  {!isEditing && (
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        className="hover:!text-red-600 hover:!border-red-400 hover:!bg-red-50 dark:hover:!text-red-400 dark:hover:!border-red-600 dark:hover:!bg-red-900/20"
                                        onClick={async () => {
                                          // TODO: Implement proposal rejection
                                          console.log('Reject proposal:', proposal.id)
                                        }}
                                      >
                                        <XCircle className="h-3.5 w-3.5 mr-1" />
                                        Reject
                                      </Button>
                                      <Button
                                        size="sm"
                                        className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                                        onClick={async () => {
                                          // TODO: Implement proposal acceptance
                                          console.log('Accept proposal:', proposal.id)
                                        }}
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                        Accept
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}

                    </div>
                  </div>
                )
              })()}

              {/* Legacy support: Keep original structure for portfolios without proposals */}
              {activeTab === 'proposals' && Object.keys(proposals.reduce((acc, p) => { acc[p.portfolio_id || 'unknown'] = true; return acc }, {} as Record<string, boolean>)).length === 0 && (() => {
                const pairLegs = pairTradeData?.trade_queue_items || pairTradeData?.legs || []

                return (
                  <div className="p-4">
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      <Scale className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p className="text-sm font-medium">No proposals yet</p>
                      <p className="text-xs mt-1">Team members can submit sizing proposals for this pair trade</p>
                    </div>
                  </div>
                )
              })()}

              {/* Activity Tab for Pair Trade */}
              {activeTab === 'activity' && (
                <div className="p-4">
                  <EntityTimeline
                    entityType="pair_trade"
                    entityId={tradeId}
                    showHeader={true}
                    collapsible={false}
                    excludeActions={['attach', 'detach']}
                  />
                </div>
              )}
            </>
          ) : trade ? (
            <>
              {/* Single Trade Details Tab */}
              {activeTab === 'details' && (
                <div className="p-4 space-y-4">
                  {/* Deferred Banner - only show if not yet resurfaced */}
                  {(trade.status === 'cancelled' || trade.outcome === 'deferred') && (() => {
                    // Check if this is a resurfaced item (when local date >= intended deferred date)
                    let isResurfaced = false
                    if (trade.deferred_until) {
                      const deferredUntil = new Date(trade.deferred_until)
                      const now = new Date()
                      // Extract intended date from UTC, compare with local date
                      const deferredDateValue = new Date(deferredUntil.getUTCFullYear(), deferredUntil.getUTCMonth(), deferredUntil.getUTCDate()).getTime()
                      const nowDateValue = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
                      isResurfaced = nowDateValue >= deferredDateValue
                    }
                    if (isResurfaced) return null // Don't show deferred banner for resurfaced items

                    return (
                      <div className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <Clock className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                          <span className="font-semibold text-gray-900 dark:text-white">
                            Deferred{trade.deferred_until ? (() => {
                              // Parse date as UTC to display the intended date regardless of timezone
                              const deferDate = new Date(trade.deferred_until)
                              const utcDate = new Date(deferDate.getTime() + deferDate.getTimezoneOffset() * 60000)
                              return ` until ${format(utcDate, 'MMM d, yyyy')}`
                            })() : ' indefinitely'}
                          </span>
                        </div>
                      </div>
                    )
                  })()}

                  {/* ========== RATIONALE SECTION ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    {isEditingRationale ? (
                      <>
                        <textarea
                          autoFocus
                          value={editedRationale}
                          onChange={(e) => setEditedRationale(e.target.value)}
                          placeholder="Why this trade? What's the catalyst or thesis?"
                          rows={4}
                          className="w-full p-0 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 resize-none border-none focus:ring-0 focus:outline-none leading-relaxed"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') cancelEditRationale()
                          }}
                        />
                        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                          <button
                            onClick={cancelEditRationale}
                            disabled={isUpdating}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={saveRationale}
                            disabled={isUpdating}
                            className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                          >
                            {isUpdating ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="group">
                        {trade.rationale ? (
                          <div className="flex gap-2">
                            <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                              {trade.rationale}
                            </p>
                            {isOwner && (
                              <button
                                onClick={startEditRationale}
                                className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ) : isOwner ? (
                          <button
                            onClick={startEditRationale}
                            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          >
                            + Add rationale
                          </button>
                        ) : (
                          <p className="text-sm text-gray-400 italic">No rationale</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== CONTEXT TAGS SECTION ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    {isEditingTags ? (
                      <>
                        <ContextTagsInput
                          value={editedTags}
                          onChange={setEditedTags}
                          placeholder="Search assets, portfolios, themes..."
                          maxTags={10}
                          autoFocus
                        />
                        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                          <button
                            onClick={cancelEditTags}
                            disabled={isUpdating}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={saveTags}
                            disabled={isUpdating}
                            className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                          >
                            {isUpdating ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="group flex items-start gap-2">
                        {((trade as any)?.context_tags || []).length > 0 ? (
                          <>
                            <div className="flex-1 flex flex-wrap gap-1.5">
                              {((trade as any).context_tags as ContextTag[]).map((tag, idx) => (
                                <span
                                  key={`${tag.entity_type}-${tag.entity_id}-${idx}`}
                                  className={clsx(
                                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                                    tag.entity_type === 'asset' && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                                    tag.entity_type === 'portfolio' && "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
                                    tag.entity_type === 'theme' && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                                    tag.entity_type === 'asset_list' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                                    tag.entity_type === 'trade_lab' && "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                                  )}
                                >
                                  {tag.display_name}
                                </span>
                              ))}
                            </div>
                            {isOwner && (
                              <button
                                onClick={startEditTags}
                                className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        ) : isOwner ? (
                          <button
                            onClick={startEditTags}
                            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          >
                            + Add tags
                          </button>
                        ) : (
                          <p className="text-sm text-gray-400 italic">No tags</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== URGENCY SECTION ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Urgency</h3>
                    <div className="flex gap-2">
                      {(['low', 'medium', 'high', 'urgent'] as const).map((level) => (
                        <button
                          key={level}
                          onClick={() => isOwner && updatePriorityMutation.mutate(level)}
                          disabled={!isOwner || updatePriorityMutation.isPending}
                          className={clsx(
                            "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                            trade.urgency === level
                              ? level === 'urgent' ? "bg-red-500 text-white"
                                : level === 'high' ? "bg-orange-500 text-white"
                                : level === 'medium' ? "bg-blue-500 text-white"
                                : "bg-gray-500 text-white"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
                            isOwner && "hover:ring-2 hover:ring-offset-1 cursor-pointer",
                            !isOwner && "cursor-default"
                          )}
                        >
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ========== PORTFOLIO SIZING SECTION ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setIsLabsExpanded(!isLabsExpanded)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300"
                      >
                        {isLabsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Scale className="h-3.5 w-3.5" />
                        Portfolio Sizing
                      </button>
                      {isLabsExpanded && labLinks.length > 0 && (
                        <div className="flex rounded-md border border-gray-200 dark:border-gray-600 overflow-hidden">
                          {[
                            { value: 'absolute', label: 'Target %' },
                            { value: 'relative_current', label: '+/− Current' },
                            { value: 'relative_benchmark', label: '+/− Bench' },
                          ].map((mode) => (
                            <button
                              key={mode.value}
                              type="button"
                              onClick={() => {
                                setActiveInput(null) // Clear so display recalculates with new mode
                                setSizingMode(mode.value as SizingMode)
                              }}
                              className={clsx(
                                "px-2 py-0.5 text-[10px] font-medium transition-colors border-r last:border-r-0 border-gray-200 dark:border-gray-600",
                                sizingMode === mode.value
                                  ? "bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300"
                                  : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                              )}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {isLabsExpanded && (
                      <div className="mt-3">
                        {/* Portfolio sizing table */}
                        {labLinks.length === 0 ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 italic mb-2">
                            Not added to any portfolios yet
                          </p>
                        ) : (
                          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mb-3">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
                                    <th className="text-left py-2 px-2 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">Portfolio</th>
                                    <th className="text-right py-2 px-1.5 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                      <div className="flex flex-col items-end">
                                        <span>Current</span>
                                        <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                      </div>
                                    </th>
                                    <th className="text-right py-2 px-1.5 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                      <div className="flex flex-col items-end">
                                        <span>Bench</span>
                                        <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                      </div>
                                    </th>
                                    <th className="text-right py-2 px-1.5 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                      <div className="flex flex-col items-end">
                                        <span>Active</span>
                                        <span className="text-[9px] font-normal text-gray-400">Weight</span>
                                      </div>
                                    </th>
                                    <th className="text-right py-2 px-1.5 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                      <div className="flex flex-col items-end">
                                        <span>Current</span>
                                        <span className="text-[9px] font-normal text-gray-400">Shares</span>
                                      </div>
                                    </th>
                                    <th className="text-center py-2 px-1.5 font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap bg-primary-50/50 dark:bg-primary-900/20">
                                      <div className="flex flex-col items-center">
                                        <span>{sizingMode === 'absolute' ? 'Target' : '+/−'}</span>
                                        <span className="text-[9px] font-normal">Weight %</span>
                                      </div>
                                    </th>
                                    <th className="text-center py-2 px-1.5 font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap bg-primary-50/50 dark:bg-primary-900/20">
                                      <div className="flex flex-col items-center">
                                        <span>Target</span>
                                        <span className="text-[9px] font-normal">Shares</span>
                                      </div>
                                    </th>
                                    <th className="w-8"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {labLinks.map((link, idx) => {
                                    const portfolioName = link.trade_lab?.portfolio?.name || link.trade_lab?.name || 'Unknown'
                                    const portfolioId = link.trade_lab?.portfolio_id || ''
                                    const holding = portfolioHoldings?.find(h => h.portfolioId === portfolioId)
                                    const target = portfolioTargets[portfolioId]
                                    const benchWeight = 0 // TODO: fetch from benchmark
                                    const activeWeight = (holding?.weight || 0) - benchWeight
                                    const hasChanges = target && (
                                      target.absoluteWeight !== link.proposed_weight ||
                                      target.absoluteShares !== link.proposed_shares
                                    )

                                    return (
                                      <tr
                                        key={link.id}
                                        className={clsx(
                                          "border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 group",
                                          idx % 2 === 1 && "bg-gray-25 dark:bg-gray-800/30"
                                        )}
                                      >
                                        <td className="py-1.5 px-2">
                                          <div className="flex items-center gap-1">
                                            <button
                                              onClick={() => {
                                                window.dispatchEvent(new CustomEvent('openTradeLab', {
                                                  detail: {
                                                    labId: link.trade_lab_id,
                                                    labName: link.trade_lab?.name,
                                                    portfolioId: portfolioId
                                                  }
                                                }))
                                                onClose()
                                              }}
                                              className="font-medium text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 truncate max-w-[100px]"
                                            >
                                              {portfolioName}
                                            </button>
                                            {holding?.isOwned && (
                                              <span className="text-[8px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded font-medium flex-shrink-0">
                                                HELD
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="text-right py-1.5 px-1.5 tabular-nums">
                                          <span className={clsx(
                                            "font-medium",
                                            (holding?.weight || 0) > 0 ? "text-gray-700 dark:text-gray-300" : "text-gray-400"
                                          )}>
                                            {(holding?.weight || 0).toFixed(2)}%
                                          </span>
                                        </td>
                                        <td className="text-right py-1.5 px-1.5 text-gray-400 dark:text-gray-500 tabular-nums">
                                          {benchWeight > 0 ? `${benchWeight.toFixed(2)}%` : '—'}
                                        </td>
                                        <td className="text-right py-1.5 px-1.5 tabular-nums">
                                          <span className={clsx(
                                            "font-medium",
                                            activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                            activeWeight < 0 ? "text-red-600 dark:text-red-400" :
                                            "text-gray-400"
                                          )}>
                                            {activeWeight !== 0 ? (activeWeight > 0 ? '+' : '') + activeWeight.toFixed(2) + '%' : '—'}
                                          </span>
                                        </td>
                                        <td className="text-right py-1.5 px-1.5 tabular-nums">
                                          <span className={clsx(
                                            (holding?.shares || 0) > 0 ? "text-gray-700 dark:text-gray-300 font-medium" : "text-gray-400"
                                          )}>
                                            {(holding?.shares || 0) > 0 ? (holding?.shares || 0).toLocaleString() : '—'}
                                          </span>
                                        </td>
                                        <td className="py-1 px-1 bg-primary-50/30 dark:bg-primary-900/10">
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder={sizingMode === 'absolute' ? ((holding?.weight || 0) > 0 ? (holding?.weight || 0).toFixed(1) : '2.0') : '+0.5'}
                                            value={
                                              activeInput?.portfolioId === portfolioId && activeInput?.field === 'weight'
                                                ? activeInput.rawValue
                                                : getDisplayWeight(portfolioId)
                                            }
                                            onFocus={() => setActiveInput({
                                              portfolioId,
                                              field: 'weight',
                                              rawValue: getDisplayWeight(portfolioId)
                                            })}
                                            onChange={(e) => {
                                              setActiveInput({
                                                portfolioId,
                                                field: 'weight',
                                                rawValue: e.target.value
                                              })
                                              updatePortfolioTarget(portfolioId, 'weight', e.target.value)
                                            }}
                                            onBlur={() => setActiveInput(null)}
                                            className={clsx(
                                              "text-center text-xs h-6 w-full min-w-[50px] rounded border px-1 focus:outline-none focus:ring-1",
                                              target?.sourceField === 'weight'
                                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold focus:border-blue-500 focus:ring-blue-500"
                                                : target?.sourceField === 'shares' && target?.absoluteWeight !== null
                                                  ? "border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 italic font-normal"
                                                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium focus:border-primary-500 focus:ring-primary-500"
                                            )}
                                          />
                                        </td>
                                        <td className="py-1 px-1 bg-primary-50/30 dark:bg-primary-900/10">
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            placeholder={(holding?.shares || 0) > 0 ? Math.round(holding?.shares || 0).toString() : '—'}
                                            value={
                                              activeInput?.portfolioId === portfolioId && activeInput?.field === 'shares'
                                                ? activeInput.rawValue
                                                : getDisplayShares(portfolioId)
                                            }
                                            onFocus={() => setActiveInput({
                                              portfolioId,
                                              field: 'shares',
                                              rawValue: getDisplayShares(portfolioId)
                                            })}
                                            onChange={(e) => {
                                              setActiveInput({
                                                portfolioId,
                                                field: 'shares',
                                                rawValue: e.target.value
                                              })
                                              updatePortfolioTarget(portfolioId, 'shares', e.target.value)
                                            }}
                                            onBlur={() => setActiveInput(null)}
                                            className={clsx(
                                              "text-center text-xs h-6 w-full min-w-[55px] rounded border px-1 focus:outline-none focus:ring-1",
                                              target?.sourceField === 'shares'
                                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold focus:border-blue-500 focus:ring-blue-500"
                                                : target?.sourceField === 'weight' && target?.absoluteShares !== null
                                                  ? "border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 italic font-normal"
                                                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium focus:border-primary-500 focus:ring-primary-500"
                                            )}
                                          />
                                        </td>
                                        <td className="py-1 px-1">
                                          <div className="flex items-center gap-0.5">
                                            {hasChanges && (
                                              <button
                                                onClick={() => savePortfolioSizing(portfolioId)}
                                                disabled={updatePortfolioSizingMutation.isPending}
                                                className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 transition-colors"
                                                title="Save sizing"
                                              >
                                                <Check className="h-3.5 w-3.5" />
                                              </button>
                                            )}
                                            <button
                                              onClick={() => unlinkFromLabMutation.mutate(link.trade_lab_id)}
                                              disabled={unlinkFromLabMutation.isPending}
                                              className="p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                              title="Remove from portfolio"
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Helper text */}
                        {labLinks.length > 0 && (
                          <p className="text-[10px] text-gray-400 mb-2">
                            {sizingMode === 'absolute' && 'Enter target weight % or shares — the other auto-calculates.'}
                            {sizingMode === 'relative_current' && 'Enter +/− change from current — the other auto-calculates.'}
                            {sizingMode === 'relative_benchmark' && 'Enter +/− vs benchmark — the other auto-calculates.'}
                          </p>
                        )}

                        {/* Add to portfolio - compact dropdown */}
                        <div className="relative">
                          <button
                            onClick={() => setIsManagingPortfolios(!isManagingPortfolios)}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-1 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                            Add to portfolio
                          </button>

                          {isManagingPortfolios && (
                            <div className="absolute left-0 top-full mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1 min-w-[180px] max-h-48 overflow-y-auto">
                              {allLabs.filter((lab: any) => !labLinks.some(l => l.trade_lab_id === lab.id)).length === 0 ? (
                                <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
                                  Added to all portfolios
                                </div>
                              ) : (
                                allLabs
                                  .filter((lab: any) => !labLinks.some(l => l.trade_lab_id === lab.id))
                                  .map((lab: any) => {
                                    const portfolioName = lab.portfolios?.name || lab.name
                                    return (
                                      <button
                                        key={lab.id}
                                        onClick={() => {
                                          linkToLabMutation.mutate(lab.id)
                                          setIsManagingPortfolios(false)
                                        }}
                                        disabled={linkToLabMutation.isPending}
                                        className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                      >
                                        {portfolioName}
                                      </button>
                                    )
                                  })
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ========== REFERENCE LEVELS SECTION (collapsible, editable) ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setIsSizingExpanded(!isSizingExpanded)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300"
                      >
                        {isSizingExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Target className="h-3.5 w-3.5" />
                        Reference Levels
                      </button>
                      {isOwner && !isEditingSizing && isSizingExpanded && (
                        <button
                          onClick={startEditSizing}
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {isSizingExpanded && (
                      <div className="mt-3">
                        {isEditingSizing ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="block text-[10px] text-gray-400 mb-1">Entry Price</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editedSizing.targetPrice}
                                  onChange={(e) => setEditedSizing(s => ({ ...s, targetPrice: e.target.value }))}
                                  className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                  placeholder="e.g. 150.00"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-gray-400 mb-1">Stop Loss</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editedSizing.stopLoss}
                                  onChange={(e) => setEditedSizing(s => ({ ...s, stopLoss: e.target.value }))}
                                  className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                  placeholder="e.g. 140.00"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-gray-400 mb-1">Take Profit</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editedSizing.takeProfit}
                                  onChange={(e) => setEditedSizing(s => ({ ...s, takeProfit: e.target.value }))}
                                  className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                  placeholder="e.g. 180.00"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="ghost" onClick={cancelEditSizing} disabled={isUpdating}>
                                Cancel
                              </Button>
                              <Button size="sm" onClick={saveSizing} disabled={isUpdating} loading={isUpdating}>
                                <Save className="h-3.5 w-3.5 mr-1" />
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <span className="text-[10px] text-gray-400 block">Entry Price</span>
                              <span className="font-medium text-gray-900 dark:text-white">
                                {trade.target_price ? `$${trade.target_price.toFixed(2)}` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-400 block">Stop Loss</span>
                              <span className="font-medium text-red-600 dark:text-red-400">
                                {(trade as any).stop_loss ? `$${(trade as any).stop_loss.toFixed(2)}` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-400 block">Take Profit</span>
                              <span className="font-medium text-green-600 dark:text-green-400">
                                {(trade as any).take_profit ? `$${(trade as any).take_profit.toFixed(2)}` : '—'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== CONVICTION & TIME HORIZON SECTION (collapsible, editable) ========== */}
                  <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setIsRiskExpanded(!isRiskExpanded)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300"
                      >
                        {isRiskExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Gauge className="h-3.5 w-3.5" />
                        Conviction & Time Horizon
                      </button>
                      {isOwner && !isEditingRisk && isRiskExpanded && (
                        <button
                          onClick={startEditRisk}
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {isRiskExpanded && (
                      <div className="mt-3">
                        {isEditingRisk ? (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Conviction</label>
                              <div className="flex gap-2">
                                {(['low', 'medium', 'high'] as const).map((level) => (
                                  <button
                                    key={level}
                                    onClick={() => setEditedRisk(r => ({ ...r, conviction: r.conviction === level ? null : level }))}
                                    className={clsx(
                                      "flex-1 py-1.5 px-3 text-xs font-medium rounded border transition-colors",
                                      editedRisk.conviction === level
                                        ? level === 'low' ? "bg-gray-100 border-gray-400 text-gray-700"
                                        : level === 'medium' ? "bg-blue-100 border-blue-400 text-blue-700"
                                        : "bg-green-100 border-green-400 text-green-700"
                                        : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                                    )}
                                  >
                                    {level.charAt(0).toUpperCase() + level.slice(1)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Time Horizon</label>
                              <div className="flex gap-2">
                                {(['short', 'medium', 'long'] as const).map((horizon) => (
                                  <button
                                    key={horizon}
                                    onClick={() => setEditedRisk(r => ({ ...r, timeHorizon: r.timeHorizon === horizon ? null : horizon }))}
                                    className={clsx(
                                      "flex-1 py-1.5 px-3 text-xs font-medium rounded border transition-colors",
                                      editedRisk.timeHorizon === horizon
                                        ? "bg-primary-100 border-primary-400 text-primary-700"
                                        : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                                    )}
                                  >
                                    {horizon.charAt(0).toUpperCase() + horizon.slice(1)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="ghost" onClick={cancelEditRisk} disabled={isUpdating}>
                                Cancel
                              </Button>
                              <Button size="sm" onClick={saveRisk} disabled={isUpdating} loading={isUpdating}>
                                <Save className="h-3.5 w-3.5 mr-1" />
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400 block">Conviction</span>
                              <span className={clsx(
                                "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                                (trade as any)?.conviction === 'low' && "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
                                (trade as any)?.conviction === 'medium' && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                                (trade as any)?.conviction === 'high' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                                !(trade as any)?.conviction && "text-gray-400"
                              )}>
                                {(trade as any)?.conviction ? (trade as any).conviction.charAt(0).toUpperCase() + (trade as any).conviction.slice(1) : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-xs text-gray-500 dark:text-gray-400 block">Time Horizon</span>
                              <span className={clsx(
                                "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                                (trade as any)?.time_horizon && "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300",
                                !(trade as any)?.time_horizon && "text-gray-400"
                              )}>
                                {(trade as any)?.time_horizon ? (trade as any).time_horizon.charAt(0).toUpperCase() + (trade as any).time_horizon.slice(1) : '—'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== ACTIONS - SEGMENTED SECTIONS ========== */}
                  {trade.status !== 'approved' && trade.status !== 'cancelled' && trade.status !== 'rejected' && trade.status !== 'archived' && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">

                      {/* SECTION 1: Move Forward (not shown in Deciding) */}
                      {trade.stage !== 'deciding' && trade.status !== 'deciding' && (
                        <div>
                          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                            Move Forward
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {(trade.status === 'idea' || trade.stage === 'idea') && (
                              <>
                                <Button size="sm" variant="secondary" onClick={() => updateStatusMutation.mutate('discussing')} disabled={updateStatusMutation.isPending}>
                                  <Wrench className="h-4 w-4 mr-1" />
                                  Working On
                                </Button>
                                <Button size="sm" onClick={() => updateStatusMutation.mutate('simulating')} disabled={updateStatusMutation.isPending}>
                                  <FlaskConical className="h-4 w-4 mr-1" />
                                  Modeling
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => setShowProposalModal(true)} disabled={updateStatusMutation.isPending}>
                                  <Scale className="h-4 w-4 mr-1" />
                                  Deciding
                                </Button>
                              </>
                            )}
                            {(trade.status === 'discussing' || trade.stage === 'working_on') && (
                              <>
                                <Button size="sm" onClick={() => updateStatusMutation.mutate('simulating')} disabled={updateStatusMutation.isPending}>
                                  <FlaskConical className="h-4 w-4 mr-1" />
                                  Modeling
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => setShowProposalModal(true)} disabled={updateStatusMutation.isPending}>
                                  <Scale className="h-4 w-4 mr-1" />
                                  Deciding
                                </Button>
                              </>
                            )}
                            {(trade.status === 'simulating' || trade.stage === 'modeling') && (
                              <Button size="sm" onClick={() => setShowProposalModal(true)} disabled={updateStatusMutation.isPending}>
                                <Scale className="h-4 w-4 mr-1" />
                                Deciding
                              </Button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* SECTION 2: Decision (only in Deciding stage) */}
                      {(trade.status === 'deciding' || trade.stage === 'deciding') && (() => {
                        // Get active portfolio tracks (no decision yet)
                        const activePortfolioTracks = portfolioTracks.filter(t => t.decision_outcome === null)
                        const committedTracks = portfolioTracks.filter(t => t.decision_outcome === 'accepted')
                        const deferredTracks = portfolioTracks.filter(t => t.decision_outcome === 'deferred')
                        const rejectedTracks = portfolioTracks.filter(t => t.decision_outcome === 'rejected')

                        // Build portfolio info from lab links
                        const portfolioInfo = labLinks.reduce((acc, link) => {
                          const pid = link.trade_lab?.portfolio_id
                          const pname = link.trade_lab?.portfolio?.name || link.trade_lab?.name || 'Unknown'
                          if (pid) acc[pid] = pname
                          return acc
                        }, {} as Record<string, string>)

                        // Handler for decision button clicks
                        const handleDecision = (decision: DecisionOutcome) => {
                          if (activePortfolioTracks.length === 1) {
                            // Single portfolio - decide directly
                            if (decision === 'deferred') {
                              setPendingDecision(decision)
                              setSelectedDecisionPortfolioId(activePortfolioTracks[0].portfolio_id)
                              setShowDeferModal(true)
                            } else {
                              portfolioDecisionMutation.mutate({
                                portfolioId: activePortfolioTracks[0].portfolio_id,
                                decisionOutcome: decision
                              })
                            }
                          } else {
                            // Multiple portfolios - show picker
                            setPendingDecision(decision)
                            setShowPortfolioDecisionPicker(true)
                          }
                        }

                        // Handler for portfolio selection
                        const handlePortfolioDecision = (portfolioId: string) => {
                          if (!pendingDecision) return
                          if (pendingDecision === 'deferred') {
                            setSelectedDecisionPortfolioId(portfolioId)
                            setShowPortfolioDecisionPicker(false)
                            setShowDeferModal(true)
                          } else {
                            portfolioDecisionMutation.mutate({
                              portfolioId,
                              decisionOutcome: pendingDecision
                            })
                          }
                        }

                        return (
                          <div>
                            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                              Decision
                            </h4>

                            {/* Show portfolio track status summary */}
                            {portfolioTracks.length > 0 && (
                              <div className="mb-3 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                                {activePortfolioTracks.length > 0 && (
                                  <div className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                    <span>{activePortfolioTracks.length} portfolio{activePortfolioTracks.length !== 1 ? 's' : ''} pending decision</span>
                                  </div>
                                )}
                                {committedTracks.length > 0 && (
                                  <div className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                    <span>{committedTracks.length} committed: {committedTracks.map(t => portfolioInfo[t.portfolio_id] || 'Unknown').join(', ')}</span>
                                  </div>
                                )}
                                {deferredTracks.length > 0 && (
                                  <div className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                                    <span>{deferredTracks.length} deferred: {deferredTracks.map(t => portfolioInfo[t.portfolio_id] || 'Unknown').join(', ')}</span>
                                  </div>
                                )}
                                {rejectedTracks.length > 0 && (
                                  <div className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                    <span>{rejectedTracks.length} rejected: {rejectedTracks.map(t => portfolioInfo[t.portfolio_id] || 'Unknown').join(', ')}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Decision buttons */}
                            {activePortfolioTracks.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => handleDecision('accepted')}
                                  disabled={portfolioDecisionMutation.isPending}
                                >
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
                                  {activePortfolioTracks.length === 1 ? `Accept (${portfolioInfo[activePortfolioTracks[0].portfolio_id]})` : 'Accept...'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleDecision('deferred')}
                                  disabled={portfolioDecisionMutation.isPending}
                                >
                                  <Clock className="h-4 w-4 mr-1" />
                                  {activePortfolioTracks.length === 1 ? 'Defer' : 'Defer...'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => handleDecision('rejected')}
                                  disabled={portfolioDecisionMutation.isPending}
                                >
                                  <XCircle className="h-4 w-4 mr-1" />
                                  {activePortfolioTracks.length === 1 ? 'Reject' : 'Reject...'}
                                </Button>
                              </div>
                            )}

                            {/* Portfolio picker dropdown */}
                            {showPortfolioDecisionPicker && activePortfolioTracks.length > 1 && (
                              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                                  Select portfolio to {pendingDecision === 'accepted' ? 'accept' : pendingDecision === 'deferred' ? 'defer' : 'reject'} for:
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {activePortfolioTracks.map(track => (
                                    <button
                                      key={track.portfolio_id}
                                      onClick={() => handlePortfolioDecision(track.portfolio_id)}
                                      disabled={portfolioDecisionMutation.isPending}
                                      className={clsx(
                                        'px-3 py-1.5 text-sm rounded-md border transition-colors',
                                        pendingDecision === 'accepted' && 'border-green-300 hover:bg-green-50 dark:hover:bg-green-900/20',
                                        pendingDecision === 'deferred' && 'border-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                                        pendingDecision === 'rejected' && 'border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20',
                                      )}
                                    >
                                      {portfolioInfo[track.portfolio_id] || 'Unknown'}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => {
                                      setShowPortfolioDecisionPicker(false)
                                      setPendingDecision(null)
                                    }}
                                    className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* No active portfolios - all decisions made */}
                            {activePortfolioTracks.length === 0 && portfolioTracks.length > 0 && (
                              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                                All portfolios have been decided
                              </p>
                            )}

                            <button
                              onClick={() => updateStatusMutation.mutate('simulating')}
                              disabled={updateStatusMutation.isPending}
                              className="mt-2 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 flex items-center gap-1"
                            >
                              <FlaskConical className="h-3 w-3" />
                              Back to Modeling
                            </button>
                          </div>
                        )
                      })()}

                      {/* SECTION 3: Remove */}
                      <div className="pt-2 border-t border-gray-100 dark:border-gray-700/50">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => {
                              // Clear portfolio selection to use global defer path
                              setSelectedDecisionPortfolioId(null)
                              setPendingDecision(null)
                              setShowDeferModal(true)
                            }}
                            disabled={isDefering}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          >
                            Defer
                          </button>
                          <button
                            onClick={() => archiveTrade({ tradeId, uiSource: 'modal' })}
                            disabled={isArchiving}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          >
                            Archive
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Restore Actions for Archived/Deferred Items */}
                  {(trade.status === 'approved' || trade.status === 'cancelled' || trade.status === 'rejected' || trade.status === 'archived') && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        Restore
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => updateStatusMutation.mutate('idea')} disabled={updateStatusMutation.isPending}>
                          Ideas
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updateStatusMutation.mutate('discussing')} disabled={updateStatusMutation.isPending}>
                          Working On
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updateStatusMutation.mutate('simulating')} disabled={updateStatusMutation.isPending}>
                          Modeling
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowDeleteConfirm(true)} className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Restore Actions for Deleted Items */}
                  {trade.status === 'deleted' && (
                    <div className="border-t border-red-200 dark:border-red-800/50 pt-4 bg-red-50/50 dark:bg-red-900/10 -mx-4 px-4 pb-4 rounded-b-lg">
                      <h3 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-3">Restore Deleted Trade Idea</h3>
                      <p className="text-xs text-red-600 dark:text-red-400 mb-3">This trade idea was deleted. You can restore it to an active status.</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => restoreMutation.mutate('idea')} disabled={restoreMutation.isPending}>
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Restore to Ideas
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => restoreMutation.mutate('discussing')} disabled={restoreMutation.isPending}>
                          <Wrench className="h-4 w-4 mr-1" />
                          Restore to Working On
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ========== METADATA SECTION ========== */}
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Created by {trade.users ? getUserDisplayName(trade.users) : 'Unknown'}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}
                    </div>

                    {/* Visibility - Editable if user is creator */}
                    <div className="flex items-center gap-1 mt-2 relative" ref={visibilityDropdownRef}>
                      {trade.sharing_visibility && trade.sharing_visibility !== 'private' ? (
                        <Users className="h-3 w-3 text-blue-500" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                      {isOwner ? (
                        <button onClick={() => setShowVisibilityDropdown(!showVisibilityDropdown)} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                          <span>{trade.sharing_visibility && trade.sharing_visibility !== 'private' ? 'Portfolio members can see' : 'Private - only you'}</span>
                          <ChevronDown className={clsx("h-3 w-3 transition-transform", showVisibilityDropdown && "rotate-180")} />
                        </button>
                      ) : (
                        <span>{trade.sharing_visibility && trade.sharing_visibility !== 'private' ? 'Portfolio members can see' : 'Private'}</span>
                      )}

                      {showVisibilityDropdown && isOwner && (
                        <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[200px]">
                          <button onClick={() => updateVisibilityMutation.mutate('private')} disabled={updateVisibilityMutation.isPending} className={clsx("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", (!trade.sharing_visibility || trade.sharing_visibility === 'private') && "bg-gray-50 dark:bg-gray-700")}>
                            <Lock className="h-4 w-4 text-gray-500" />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">Private</div>
                              <div className="text-xs text-gray-500">Only visible to you</div>
                            </div>
                          </button>
                          <button onClick={() => updateVisibilityMutation.mutate('team')} disabled={updateVisibilityMutation.isPending} className={clsx("w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", trade.sharing_visibility === 'team' && "bg-gray-50 dark:bg-gray-700")}>
                            <Users className="h-4 w-4 text-blue-500" />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">Portfolio</div>
                              <div className="text-xs text-gray-500">Members of selected portfolios can see</div>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Assigned To - Editable if user is creator */}
                    <div className="flex items-center gap-1 mt-2 relative" ref={assigneeDropdownRef}>
                      <User className="h-3 w-3" />
                      {isOwner ? (
                        <button
                          onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                          className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          <span>
                            {(trade as any).assigned_user
                              ? `Assigned to ${getUserDisplayName((trade as any).assigned_user)}`
                              : 'Assign to someone'}
                          </span>
                          <ChevronDown className={clsx("h-3 w-3 transition-transform", showAssigneeDropdown && "rotate-180")} />
                        </button>
                      ) : (
                        <span>
                          {(trade as any).assigned_user
                            ? `Assigned to ${getUserDisplayName((trade as any).assigned_user)}`
                            : 'Not assigned'}
                        </span>
                      )}

                      {showAssigneeDropdown && isOwner && (
                        <div className="absolute left-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[220px] max-h-[180px] overflow-y-auto">
                          <button
                            onClick={() => updateAssigneeMutation.mutate(null)}
                            disabled={updateAssigneeMutation.isPending}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors",
                              !trade.assigned_to && "bg-gray-50 dark:bg-gray-700"
                            )}
                          >
                            <XCircle className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-600 dark:text-gray-300">Unassign</span>
                          </button>
                          {teamMembers?.filter(m => m.id !== user?.id).map(member => (
                            <button
                              key={member.id}
                              onClick={() => updateAssigneeMutation.mutate(member.id)}
                              disabled={updateAssigneeMutation.isPending}
                              className={clsx(
                                "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors",
                                trade.assigned_to === member.id && "bg-primary-50 dark:bg-primary-900/20"
                              )}
                            >
                              <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[10px] font-medium">
                                {getUserInitials(member)}
                              </div>
                              <span className="text-sm text-gray-900 dark:text-white">{getUserDisplayName(member)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Collaborators / Co-analysts */}
                    <div className="flex items-center gap-1 mt-2 relative" ref={collaboratorsDropdownRef}>
                      <Users className="h-3 w-3" />
                      {isOwner ? (
                        <button
                          onClick={() => setShowCollaboratorsDropdown(!showCollaboratorsDropdown)}
                          className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          <span>
                            {((trade as any).collaborators?.length > 0)
                              ? `${(trade as any).collaborators.length} co-analyst${(trade as any).collaborators.length > 1 ? 's' : ''}`
                              : 'Add co-analysts'}
                          </span>
                          <ChevronDown className={clsx("h-3 w-3 transition-transform", showCollaboratorsDropdown && "rotate-180")} />
                        </button>
                      ) : (
                        <span>
                          {((trade as any).collaborators?.length > 0)
                            ? `${(trade as any).collaborators.length} co-analyst${(trade as any).collaborators.length > 1 ? 's' : ''}`
                            : 'No co-analysts'}
                        </span>
                      )}

                      {showCollaboratorsDropdown && isOwner && (
                        <div className="absolute left-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[220px] max-h-[180px] overflow-y-auto">
                          {teamMembers?.filter(m => m.id !== user?.id && m.id !== trade.assigned_to).map(member => {
                            const currentCollaborators: string[] = (trade as any).collaborators || []
                            const isCollaborator = currentCollaborators.includes(member.id)
                            return (
                              <button
                                key={member.id}
                                onClick={() => {
                                  const newCollaborators = isCollaborator
                                    ? currentCollaborators.filter(id => id !== member.id)
                                    : [...currentCollaborators, member.id]
                                  updateCollaboratorsMutation.mutate(newCollaborators)
                                }}
                                disabled={updateCollaboratorsMutation.isPending}
                                className={clsx(
                                  "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors",
                                  isCollaborator && "bg-primary-50 dark:bg-primary-900/20"
                                )}
                              >
                                <div className={clsx(
                                  "w-4 h-4 border rounded flex items-center justify-center",
                                  isCollaborator
                                    ? "border-primary-500 bg-primary-500 text-white"
                                    : "border-gray-300 dark:border-gray-600"
                                )}>
                                  {isCollaborator && <Check className="h-3 w-3" />}
                                </div>
                                <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[10px] font-medium">
                                  {getUserInitials(member)}
                                </div>
                                <span className="text-sm text-gray-900 dark:text-white">{getUserDisplayName(member)}</span>
                              </button>
                            )
                          })}
                          {(!teamMembers || teamMembers.filter(m => m.id !== user?.id && m.id !== trade.assigned_to).length === 0) && (
                            <div className="px-3 py-2 text-sm text-gray-500">No team members available</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              )}

              {/* Discussion Tab for Single Trade */}
              {activeTab === 'discussion' && (
                <div className="flex flex-col h-full">
                  {/* Messages List */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {discussionMessages.length > 0 ? (
                      <div className="space-y-1">
                        {discussionMessages.map((message: any) => (
                          <div key={message.id} className="group flex gap-2 py-1 -mx-2 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <div className="w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                              <span className="text-gray-600 dark:text-gray-300 text-[10px] font-medium">
                                {getUserInitials(message.user)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="text-xs font-medium text-gray-900 dark:text-white">
                                  {getUserDisplayName(message.user)}
                                </span>
                                {message.portfolio && (
                                  <span className="text-[10px] text-primary-600 dark:text-primary-400">
                                    {message.portfolio.name}
                                  </span>
                                )}
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                  {formatMessageTime(message.created_at)}
                                </span>
                                {message.is_pinned && <Pin className="h-2.5 w-2.5 text-amber-500" />}
                              </div>
                              {message.reply_to && (
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                  <Reply className="h-2.5 w-2.5" />
                                  <span>replied</span>
                                </div>
                              )}
                              <div className="text-sm text-gray-700 dark:text-gray-300">
                                <SmartInputRenderer content={message.content} inline />
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <button
                                onClick={() => { setReplyToMessage(message.id); discussionInputRef.current?.focus() }}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                title="Reply"
                              >
                                <Reply className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => toggleDiscussionPinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned })}
                                className="p-1 text-gray-400 hover:text-amber-500 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                title={message.is_pinned ? 'Unpin' : 'Pin'}
                              >
                                <Pin className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
                        <MessageCircle className="h-8 w-8 mb-2" />
                        <p className="text-sm">No messages yet</p>
                      </div>
                    )}
                  </div>

                  {/* Message Input */}
                  <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                    {replyToMessage && replyToMessageData && (
                      <div className="mb-2 px-2 py-1.5 bg-gray-100 dark:bg-gray-700/50 rounded text-xs flex items-center justify-between">
                        <span className="text-gray-600 dark:text-gray-400 truncate">
                          Replying to {getUserDisplayName(replyToMessageData.user)}
                        </span>
                        <button onClick={() => setReplyToMessage(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-2">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    {/* Portfolio context chips */}
                    {labLinks.length > 0 && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <button
                          onClick={() => setMessagePortfolioContext(null)}
                          className={clsx(
                            "text-[10px] px-2 py-0.5 rounded-full transition-colors",
                            messagePortfolioContext === null
                              ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                          )}
                        >
                          General
                        </button>
                        {labLinks.map(link => link.trade_lab?.portfolio && (
                          <button
                            key={link.trade_lab.portfolio.id}
                            onClick={() => setMessagePortfolioContext(link.trade_lab!.portfolio!.id)}
                            className={clsx(
                              "text-[10px] px-2 py-0.5 rounded-full transition-colors",
                              messagePortfolioContext === link.trade_lab.portfolio.id
                                ? "bg-primary-600 text-white"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                            )}
                          >
                            {link.trade_lab.portfolio.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        ref={discussionInputRef as any}
                        type="text"
                        value={discussionMessage}
                        onChange={(e) => setDiscussionMessage(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendDiscussionMessage() }}}
                        placeholder="Write a message..."
                        className="flex-1 h-8 px-3 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                      />
                      <button
                        onClick={handleSendDiscussionMessage}
                        disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending}
                        className={clsx(
                          "h-8 w-8 rounded-md flex items-center justify-center transition-colors",
                          discussionMessage.trim()
                            ? "bg-primary-600 text-white hover:bg-primary-700"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-400"
                        )}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Proposals Tab for Single Trade */}
              {activeTab === 'proposals' && (() => {
                // Group proposals by portfolio
                const proposalsByPortfolio = proposals.reduce((acc, proposal) => {
                  const portfolioId = proposal.portfolio_id || 'unknown'
                  const portfolioName = proposal.portfolio?.name || 'Unknown Portfolio'
                  if (!acc[portfolioId]) {
                    acc[portfolioId] = { name: portfolioName, proposals: [] }
                  }
                  acc[portfolioId].proposals.push(proposal)
                  return acc
                }, {} as Record<string, { name: string; proposals: typeof proposals }>)

                // Sort proposals within each portfolio: current user first, then by updated_at
                Object.values(proposalsByPortfolio).forEach(group => {
                  group.proposals.sort((a, b) => {
                    const aIsCurrentUser = a.user_id === user?.id
                    const bIsCurrentUser = b.user_id === user?.id
                    if (aIsCurrentUser && !bIsCurrentUser) return -1
                    if (!aIsCurrentUser && bIsCurrentUser) return 1
                    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                  })
                })

                // Get sorted portfolio entries (by name)
                const sortedPortfolioEntries = Object.entries(proposalsByPortfolio)
                  .sort(([, a], [, b]) => a.name.localeCompare(b.name))

                // Flat sorted proposals for backward compat (when showing all)
                const sortedProposals = [...proposals].sort((a, b) => {
                  const aIsCurrentUser = a.user_id === user?.id
                  const bIsCurrentUser = b.user_id === user?.id
                  if (aIsCurrentUser && !bIsCurrentUser) return -1
                  if (!aIsCurrentUser && bIsCurrentUser) return 1
                  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                })

                // Check if we have multiple portfolios
                const hasMultiplePortfolios = Object.keys(proposalsByPortfolio).length > 1

                // Check if current user is PM/owner and trade is in deciding stage
                const isDecidingStage = trade?.status === 'deciding' || trade?.stage === 'deciding'
                const canMakeDecision = isOwner && isDecidingStage

                // Status text helper
                const getStatusText = () => {
                  if (proposals.length === 0) return 'No proposals yet'
                  if (proposals.length === 1) return '1 active proposal'
                  const portfolioCount = Object.keys(proposalsByPortfolio).length
                  if (portfolioCount > 1) {
                    return `${proposals.length} proposals across ${portfolioCount} portfolios`
                  }
                  return `${proposals.length} active proposals`
                }

                return (
                  <div className="p-4 space-y-4">
                    {/* Header with count */}
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        Team Proposals {proposals.length > 0 && `(${proposals.length})`}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {getStatusText()}
                        {proposals.length === 1 && (
                          <span className="ml-1">· Awaiting additional recommendations</span>
                        )}
                      </p>
                    </div>

                    {/* PM Decision Actions (only in deciding stage for owner) */}
                    {canMakeDecision && (
                      <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                        <div className="flex items-center gap-2">
                          <Scale className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                            Ready for decision
                          </span>
                          {proposals.length === 0 && (
                            <span className="text-xs text-amber-600 dark:text-amber-400">
                              · Awaiting recommendation(s)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => updateStatusMutation.mutate('approved')}
                            disabled={updateStatusMutation.isPending}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              // Clear portfolio selection to use global defer path
                              setSelectedDecisionPortfolioId(null)
                              setPendingDecision(null)
                              setShowDeferModal(true)
                            }}
                            disabled={updateStatusMutation.isPending}
                          >
                            <Clock className="h-3.5 w-3.5 mr-1" />
                            Defer
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => updateStatusMutation.mutate('rejected')}
                            disabled={updateStatusMutation.isPending}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Pair Trade Proposals Section - shows when modal is displaying a pair trade */}
                    {(() => {
                      // Show all proposals when viewing a pair trade modal
                      // OR proposals that have isPairTrade flag in sizing_context
                      const pairTradeProposals = isPairTrade
                        ? proposals // Show ALL proposals when modal is a pair trade
                        : proposals.filter(p => {
                            const ctx = p.sizing_context as any
                            return ctx?.isPairTrade === true && ctx?.legs?.length > 0
                          })

                      console.log('[TradeIdeaDetailModal] Pair trade proposals section:', {
                        isPairTrade,
                        proposalsCount: proposals.length,
                        pairTradeProposalsCount: pairTradeProposals.length,
                        proposals,
                        pairTradeData,
                        pairTradeLegIds,
                        userId: user?.id
                      })

                      // If isPairTrade but no proposals, show a message instead of returning null
                      if (pairTradeProposals.length === 0) {
                        if (isPairTrade) {
                          return (
                            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                              <Scale className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No proposals yet for this pair trade</p>
                              <p className="text-xs mt-1">Debug: isPairTrade={String(isPairTrade)}, proposals.length={proposals.length}</p>
                            </div>
                          )
                        }
                        return null
                      }

                      // Group by portfolio
                      const proposalsByPortfolio = pairTradeProposals.reduce((acc, proposal) => {
                        const portfolioId = proposal.portfolio_id || 'unknown'
                        if (!acc[portfolioId]) {
                          acc[portfolioId] = {
                            name: proposal.portfolio?.name || 'Unknown Portfolio',
                            myProposal: null as typeof proposal | null,
                            otherProposals: [] as typeof pairTradeProposals
                          }
                        }
                        if (proposal.user_id === user?.id) {
                          acc[portfolioId].myProposal = proposal
                        } else {
                          acc[portfolioId].otherProposals.push(proposal)
                        }
                        return acc
                      }, {} as Record<string, { name: string; myProposal: typeof pairTradeProposals[0] | null; otherProposals: typeof pairTradeProposals }>)

                      return (
                        <div className="space-y-4">
                          {Object.entries(proposalsByPortfolio).map(([portfolioId, { name: portfolioName, myProposal, otherProposals }]) => (
                            <div key={portfolioId} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                              {/* Portfolio Header */}
                              <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                                <div className="flex items-center gap-2">
                                  <Briefcase className="h-4 w-4 text-gray-500" />
                                  <span className="font-medium text-gray-900 dark:text-white">{portfolioName}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                                    Pair Trade
                                  </span>
                                  {(myProposal || otherProposals.length > 0) && (
                                    <span className="ml-auto text-xs text-gray-500">
                                      {(myProposal ? 1 : 0) + otherProposals.length} proposal{((myProposal ? 1 : 0) + otherProposals.length) !== 1 ? 's' : ''}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="p-4 space-y-4">
                                {/* Your Proposal - Editable */}
                                {myProposal && (() => {
                                  const sizingCtx = myProposal.sizing_context as any
                                  let legs = sizingCtx?.legs || []
                                  const sizingMode = sizingCtx?.sizingMode || sizingCtx?.proposalType || legs[0]?.sizingMode || myProposal.sizing_mode || 'weight'

                                  // If no legs in sizing_context but we're in a pair trade modal,
                                  // build legs from the pair trade data with proposal weight
                                  if (legs.length === 0 && isPairTrade && pairTradeData) {
                                    const pairLegs = pairTradeData.trade_queue_items || pairTradeData.legs || []
                                    legs = pairLegs.map((leg: any) => ({
                                      assetId: leg.asset_id || leg.assets?.id,
                                      symbol: leg.assets?.symbol || leg.symbol || '?',
                                      action: leg.action || 'buy',
                                      weight: myProposal.weight, // Use proposal weight for all legs (basic fallback)
                                      sizingMode: sizingMode,
                                    }))
                                  }

                                  const getSizingModeLabel = (mode: string) => {
                                    switch (mode) {
                                      case 'weight': return 'Weight %'
                                      case 'delta_weight': return '± Weight'
                                      case 'active_weight': return 'Active Wgt'
                                      case 'delta_benchmark': return '± Bench'
                                      default: return 'Weight %'
                                    }
                                  }

                                  return (
                                    <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-800 p-4">
                                      <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                          <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center">
                                            <User className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
                                          </div>
                                          <span className="text-sm font-medium text-gray-900 dark:text-white">Your Proposal</span>
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                                            {getSizingModeLabel(sizingMode)}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {editingPairProposalId === myProposal.id ? (
                                            <>
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                className="h-7 text-xs"
                                                onClick={() => {
                                                  setEditingPairProposalId(null)
                                                  setEditedPairProposalLegs([])
                                                }}
                                                disabled={isSavingPairProposal}
                                              >
                                                Cancel
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="primary"
                                                className="h-7 text-xs"
                                                disabled={isSavingPairProposal}
                                                onClick={async () => {
                                                  setIsSavingPairProposal(true)
                                                  try {
                                                    const context: ActionContext = {
                                                      actorId: user!.id,
                                                      actorName: [user!.first_name, user!.last_name].filter(Boolean).join(' ') || user!.email || '',
                                                      actorEmail: user!.email || '',
                                                      actorRole: (user!.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
                                                      requestId: crypto.randomUUID(),
                                                      uiSource: 'modal',
                                                    }
                                                    await upsertProposal({
                                                      trade_queue_item_id: tradeId,
                                                      portfolio_id: myProposal.portfolio_id,
                                                      weight: null,
                                                      shares: null,
                                                      sizing_mode: sizingMode as TradeSizingMode,
                                                      sizing_context: {
                                                        isPairTrade: true,
                                                        sizingMode,
                                                        legs: editedPairProposalLegs.map(leg => ({
                                                          assetId: leg.assetId,
                                                          symbol: leg.symbol,
                                                          action: leg.action,
                                                          weight: leg.weight,
                                                          sizingMode: leg.sizingMode,
                                                        })),
                                                      },
                                                      notes: myProposal.notes,
                                                    }, context)
                                                    refetchProposals()
                                                    setEditingPairProposalId(null)
                                                    setEditedPairProposalLegs([])
                                                  } finally {
                                                    setIsSavingPairProposal(false)
                                                  }
                                                }}
                                              >
                                                <Save className="h-3 w-3 mr-1" />
                                                Save
                                              </Button>
                                            </>
                                          ) : (
                                            <>
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                className="h-7 text-xs"
                                                onClick={() => {
                                                  setEditingPairProposalId(myProposal.id)
                                                  setEditedPairProposalLegs(legs.map((leg: any) => ({
                                                    assetId: leg.assetId,
                                                    symbol: leg.symbol,
                                                    action: leg.action,
                                                    weight: leg.weight,
                                                    sizingMode: leg.sizingMode || sizingMode,
                                                  })))
                                                }}
                                              >
                                                <Pencil className="h-3 w-3 mr-1" />
                                                Edit
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                                onClick={async () => {
                                                  const { error } = await supabase
                                                    .from('trade_proposals')
                                                    .update({ is_active: false })
                                                    .eq('id', myProposal.id)
                                                    .eq('user_id', user?.id)
                                                  if (!error) refetchProposals()
                                                }}
                                              >
                                                <XCircle className="h-3 w-3 mr-1" />
                                                Withdraw
                                              </Button>
                                            </>
                                          )}
                                        </div>
                                      </div>

                                      {/* Legs with sizing */}
                                      <div className="space-y-2">
                                        {editingPairProposalId === myProposal.id ? (
                                          // Edit mode - editable inputs
                                          editedPairProposalLegs.map((leg, idx) => (
                                            <div key={idx} className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg p-3 border-2 border-primary-300 dark:border-primary-700">
                                              <span className={clsx(
                                                "px-2 py-1 rounded text-xs font-bold uppercase min-w-[50px] text-center",
                                                leg.action === 'buy' || leg.action === 'add'
                                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                              )}>
                                                {leg.action}
                                              </span>
                                              <span className="font-bold text-gray-900 dark:text-white min-w-[60px]">
                                                {leg.symbol}
                                              </span>
                                              <div className="flex-1" />
                                              <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                                  {getSizingModeLabel(leg.sizingMode)}:
                                                </span>
                                                <input
                                                  type="number"
                                                  step="0.01"
                                                  className="w-20 h-7 px-2 text-sm font-semibold text-right rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                                  value={leg.weight ?? ''}
                                                  onChange={(e) => {
                                                    const val = e.target.value === '' ? null : parseFloat(e.target.value)
                                                    setEditedPairProposalLegs(prev => prev.map((l, i) =>
                                                      i === idx ? { ...l, weight: val } : l
                                                    ))
                                                  }}
                                                  placeholder="0.00"
                                                />
                                                <span className="text-xs text-gray-500">%</span>
                                              </div>
                                            </div>
                                          ))
                                        ) : (
                                          // View mode - display only
                                          legs.map((leg: any, idx: number) => (
                                            <div key={idx} className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                                              <span className={clsx(
                                                "px-2 py-1 rounded text-xs font-bold uppercase min-w-[50px] text-center",
                                                leg.action === 'buy' || leg.action === 'add'
                                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                              )}>
                                                {leg.action}
                                              </span>
                                              <span className="font-bold text-gray-900 dark:text-white min-w-[60px]">
                                                {leg.symbol}
                                              </span>
                                              <div className="flex-1" />
                                              <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                                  {getSizingModeLabel(leg.sizingMode || sizingMode)}:
                                                </span>
                                                <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                                                  {leg.weight != null ? `${leg.weight.toFixed(2)}%` : '—'}
                                                </span>
                                              </div>
                                            </div>
                                          ))
                                        )}
                                      </div>

                                      {/* Notes */}
                                      {myProposal.notes && (
                                        <div className="mt-3 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</div>
                                          <div className="text-sm text-gray-700 dark:text-gray-300">{myProposal.notes}</div>
                                        </div>
                                      )}

                                      {/* Timestamp */}
                                      <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                                        Submitted {new Date(myProposal.created_at).toLocaleDateString()} at {new Date(myProposal.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        {myProposal.updated_at !== myProposal.created_at && (
                                          <span className="ml-2">
                                            · Updated {new Date(myProposal.updated_at).toLocaleDateString()}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })()}

                                {/* Other Team Proposals */}
                                {otherProposals.length > 0 && (
                                  <div>
                                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                                      Team Proposals ({otherProposals.length})
                                    </div>
                                    <div className="space-y-2">
                                      {otherProposals.map(proposal => {
                                        const sizingCtx = proposal.sizing_context as any
                                        let legs = sizingCtx?.legs || []
                                        const sizingMode = sizingCtx?.sizingMode || sizingCtx?.proposalType || legs[0]?.sizingMode || proposal.sizing_mode || 'weight'
                                        const userName = proposal.users?.first_name && proposal.users?.last_name
                                          ? `${proposal.users.first_name} ${proposal.users.last_name}`
                                          : proposal.users?.email?.split('@')[0] || 'Unknown'

                                        // Build legs from pair trade data if not in sizing_context
                                        if (legs.length === 0 && isPairTrade && pairTradeData) {
                                          const pairLegs = pairTradeData.trade_queue_items || pairTradeData.legs || []
                                          legs = pairLegs.map((leg: any) => ({
                                            assetId: leg.asset_id || leg.assets?.id,
                                            symbol: leg.assets?.symbol || leg.symbol || '?',
                                            action: leg.action || 'buy',
                                            weight: proposal.weight,
                                            sizingMode: sizingMode,
                                          }))
                                        }

                                        const getSizingModeLabel = (mode: string) => {
                                          switch (mode) {
                                            case 'weight': return 'Wgt'
                                            case 'delta_weight': return '±Wgt'
                                            case 'active_weight': return 'Act'
                                            case 'delta_benchmark': return '±Bch'
                                            default: return 'Wgt'
                                          }
                                        }

                                        return (
                                          <div key={proposal.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                                            <div className="flex items-center gap-2 mb-2">
                                              <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                                                <User className="h-3 w-3 text-gray-500 dark:text-gray-400" />
                                              </div>
                                              <span className="text-sm font-medium text-gray-900 dark:text-white">{userName}</span>
                                              <span className="text-xs text-gray-400 ml-auto">
                                                {new Date(proposal.created_at).toLocaleDateString()}
                                              </span>
                                            </div>

                                            {/* Compact legs display */}
                                            <div className="grid grid-cols-2 gap-2">
                                              {legs.map((leg: any, idx: number) => (
                                                <div key={idx} className="flex items-center gap-2 text-sm">
                                                  <span className={clsx(
                                                    "text-xs font-bold uppercase",
                                                    leg.action === 'buy' || leg.action === 'add'
                                                      ? "text-green-600 dark:text-green-400"
                                                      : "text-red-600 dark:text-red-400"
                                                  )}>
                                                    {leg.action === 'buy' || leg.action === 'add' ? 'B' : 'S'}
                                                  </span>
                                                  <span className="font-medium text-gray-900 dark:text-white">{leg.symbol}</span>
                                                  <span className="text-gray-500 dark:text-gray-400 ml-auto tabular-nums">
                                                    {leg.weight != null ? `${leg.weight.toFixed(2)}%` : '—'}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>

                                            {proposal.notes && (
                                              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic truncate">
                                                "{proposal.notes}"
                                              </div>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* No proposals yet message */}
                                {!myProposal && otherProposals.length === 0 && (
                                  <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                                    <Scale className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">No proposals yet for this portfolio</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}

                    {/* Portfolio Context Cards with Inline Proposal Inputs */}
                    {portfolioContexts.length > 0 ? (
                      <div className="space-y-4">
                        {portfolioContexts.map((portfolio) => {
                          const inlineProposal = inlineProposals[portfolio.id]
                          const sizingMode = inlineProposal?.sizingMode || 'weight'
                          const hasPosition = portfolio.currentShares > 0
                          const isExpanded = expandedProposalInputs.has(portfolio.id)

                          // Get existing proposals for this portfolio
                          const portfolioProposals = proposals.filter(p => p.portfolio_id === portfolio.id)
                          const userProposal = portfolioProposals.find(p => p.user_id === user?.id)
                          const otherProposals = portfolioProposals.filter(p => p.user_id !== user?.id)

                          // Sizing mode options
                          const sizingModes: { value: ProposalSizingMode; label: string; placeholder: string }[] = [
                            { value: 'weight', label: 'Weight %', placeholder: 'e.g. 2.5' },
                            { value: 'delta_weight', label: '± Weight', placeholder: 'e.g. +0.5 or -0.5' },
                            { value: 'active_weight', label: 'Active Wgt', placeholder: 'e.g. 1.0' },
                            { value: 'delta_benchmark', label: '± Bench', placeholder: 'e.g. +0.5' },
                          ]

                          return (
                            <div
                              key={portfolio.id}
                              className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                            >
                              {/* Portfolio Header */}
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <Briefcase className="h-4 w-4 text-gray-400" />
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {portfolio.name}
                                  </span>
                                  {portfolioProposals.length > 0 && (
                                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                                      {portfolioProposals.length} {portfolioProposals.length === 1 ? 'proposal' : 'proposals'}
                                    </span>
                                  )}
                                </div>
                                {portfolio.benchmark && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    vs {portfolio.benchmark}
                                  </span>
                                )}
                              </div>

                              {/* Current Position Context */}
                              {hasPosition ? (
                                <div className="p-2 rounded bg-gray-100 dark:bg-gray-700/50">
                                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                                    Current Position
                                  </div>
                                  <div className="grid grid-cols-4 gap-2 text-xs">
                                    <div>
                                      <div className="text-gray-500 dark:text-gray-400">Weight</div>
                                      <div className="font-medium text-gray-900 dark:text-white">
                                        {portfolio.currentWeight.toFixed(2)}%
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500 dark:text-gray-400">Shares</div>
                                      <div className="font-medium text-gray-900 dark:text-white">
                                        {portfolio.currentShares.toLocaleString()}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500 dark:text-gray-400">Bench Wt</div>
                                      <div className="font-medium text-gray-900 dark:text-white">
                                        {portfolio.benchmarkWeight !== null ? `${portfolio.benchmarkWeight.toFixed(2)}%` : '—'}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-gray-500 dark:text-gray-400">Active Wgt</div>
                                      <div className={clsx(
                                        "font-medium",
                                        portfolio.activeWeight === null ? "text-gray-900 dark:text-white" :
                                        portfolio.activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                        portfolio.activeWeight < 0 ? "text-red-600 dark:text-red-400" :
                                        "text-gray-900 dark:text-white"
                                      )}>
                                        {portfolio.activeWeight !== null
                                          ? `${portfolio.activeWeight >= 0 ? '+' : ''}${portfolio.activeWeight.toFixed(2)}%`
                                          : '—'}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-gray-400 dark:text-gray-500">
                                  No current position
                                </div>
                              )}

                              {/* Your Proposal Section - Collapsible */}
                              <button
                                type="button"
                                onClick={() => setExpandedProposalInputs(prev => {
                                  const next = new Set(prev)
                                  if (next.has(portfolio.id)) {
                                    next.delete(portfolio.id)
                                  } else {
                                    next.add(portfolio.id)
                                  }
                                  return next
                                })}
                                className="w-full mt-2 flex items-center justify-between px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                              >
                                <span className="flex items-center gap-1.5">
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                  {userProposal ? (() => {
                                    // Check if this is a pair trade proposal
                                    const sizingCtx = userProposal.sizing_context as any
                                    const isPairTrade = sizingCtx?.isPairTrade === true
                                    const legs = sizingCtx?.legs || []

                                    if (isPairTrade && legs.length > 0) {
                                      return (
                                        <span className="text-primary-600 dark:text-primary-400">
                                          Your Proposal: Pair Trade ({legs.length} legs)
                                        </span>
                                      )
                                    }
                                    return (
                                      <span className="text-primary-600 dark:text-primary-400">
                                        Your Proposal: {userProposal.weight?.toFixed(2)}%
                                      </span>
                                    )
                                  })() : inlineProposal?.value ? (
                                    <span className="text-primary-600 dark:text-primary-400">
                                      Draft: {inlineProposal.value}% ({sizingModes.find(m => m.value === sizingMode)?.label})
                                    </span>
                                  ) : (
                                    'Add Your Proposal'
                                  )}
                                </span>
                              </button>

                              {/* Collapsible Proposal Input Section */}
                              {isExpanded && (
                                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600 space-y-3">
                                  {/* Sizing Mode Selector */}
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                                      Proposal Type
                                    </label>
                                    <div className="grid grid-cols-4 gap-1">
                                      {sizingModes.map((mode) => {
                                        const isDisabled = mode.value === 'delta_benchmark' && portfolio.benchmarkWeight === null
                                        return (
                                          <button
                                            key={mode.value}
                                            type="button"
                                            disabled={isDisabled}
                                            onClick={() => setInlineProposals(prev => ({
                                              ...prev,
                                              [portfolio.id]: { ...prev[portfolio.id], sizingMode: mode.value, value: '' }
                                            }))}
                                            className={clsx(
                                              "px-2 py-1.5 text-xs rounded border transition-colors",
                                              sizingMode === mode.value
                                                ? "bg-primary-100 dark:bg-primary-900/30 border-primary-500 text-primary-700 dark:text-primary-300"
                                                : isDisabled
                                                ? "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                                                : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500"
                                            )}
                                            title={isDisabled ? 'Benchmark data not available' : mode.label}
                                          >
                                            {mode.label}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>

                                  {/* Value Input */}
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                      {sizingModes.find(m => m.value === sizingMode)?.label || 'Value'}
                                    </label>
                                    <input
                                      type="text"
                                      value={inlineProposal?.value || ''}
                                      onChange={(e) => setInlineProposals(prev => ({
                                        ...prev,
                                        [portfolio.id]: { ...prev[portfolio.id], value: e.target.value }
                                      }))}
                                      placeholder={sizingModes.find(m => m.value === sizingMode)?.placeholder || ''}
                                      className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                    />
                                  </div>

                                  {/* Notes */}
                                  <div>
                                    <input
                                      type="text"
                                      value={inlineProposal?.notes || ''}
                                      onChange={(e) => setInlineProposals(prev => ({
                                        ...prev,
                                        [portfolio.id]: { ...prev[portfolio.id], notes: e.target.value }
                                      }))}
                                      placeholder="Notes (optional)"
                                      className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                    />
                                  </div>

                                  {/* Submit Button */}
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      if (!user || !inlineProposal?.value) return
                                      const numValue = parseFloat(inlineProposal.value)
                                      if (isNaN(numValue)) return

                                      // Calculate weight based on sizing mode
                                      let weight: number | null = numValue
                                      let dbSizingMode: TradeSizingMode = 'weight'

                                      if (sizingMode === 'delta_weight') {
                                        weight = portfolio.currentWeight + numValue
                                        dbSizingMode = 'delta_weight'
                                      } else if (sizingMode === 'active_weight' && portfolio.benchmarkWeight !== null) {
                                        weight = portfolio.benchmarkWeight + numValue
                                        dbSizingMode = 'delta_benchmark'
                                      }

                                      const context: ActionContext = {
                                        actorId: user.id,
                                        actorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || '',
                                        actorEmail: user.email || '',
                                        actorRole: (user.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
                                        requestId: crypto.randomUUID(),
                                        uiSource: 'modal',
                                      }

                                      await upsertProposal({
                                        trade_queue_item_id: tradeId,
                                        portfolio_id: portfolio.id,
                                        weight,
                                        shares: null,
                                        sizing_mode: dbSizingMode,
                                        sizing_context: {
                                          proposalType: sizingMode,
                                          inputValue: numValue,
                                          currentWeight: portfolio.currentWeight,
                                        },
                                        notes: inlineProposal.notes || null,
                                      }, context)

                                      refetchProposals()
                                      setExpandedProposalInputs(prev => {
                                        const next = new Set(prev)
                                        next.delete(portfolio.id)
                                        return next
                                      })
                                    }}
                                    disabled={!inlineProposal?.value}
                                    className="w-full"
                                  >
                                    <Scale className="h-3.5 w-3.5 mr-1" />
                                    {userProposal ? 'Update Proposal' : 'Submit Proposal'}
                                  </Button>
                                </div>
                              )}

                              {/* Other Team Proposals for this Portfolio */}
                              {otherProposals.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                                    Team Proposals ({otherProposals.length})
                                  </div>
                                  <div className="space-y-2">
                                    {otherProposals.map((proposal) => {
                                      const userName = proposal.users?.first_name && proposal.users?.last_name
                                        ? `${proposal.users.first_name} ${proposal.users.last_name}`
                                        : proposal.users?.email || 'Unknown'

                                      // Check if this is a pair trade proposal
                                      const sizingCtx = proposal.sizing_context as any
                                      const isPairTrade = sizingCtx?.isPairTrade === true
                                      const legs = sizingCtx?.legs || []

                                      if (isPairTrade && legs.length > 0) {
                                        return (
                                          <div
                                            key={proposal.id}
                                            className="p-2 rounded bg-gray-100 dark:bg-gray-700/50 space-y-2"
                                          >
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs text-gray-600 dark:text-gray-400">
                                                {userName}
                                              </span>
                                              <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                                                Pair Trade
                                              </span>
                                            </div>
                                            <div className="space-y-1">
                                              {legs.map((leg: any, idx: number) => (
                                                <div key={idx} className="flex items-center justify-between text-xs">
                                                  <span className="flex items-center gap-1">
                                                    <span className={clsx(
                                                      "font-bold uppercase",
                                                      leg.action === 'buy' ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                                                    )}>
                                                      {leg.action}
                                                    </span>
                                                    <span className="font-medium text-gray-900 dark:text-white">{leg.symbol}</span>
                                                  </span>
                                                  <span className="text-gray-600 dark:text-gray-400">
                                                    {leg.weight != null ? `${leg.weight.toFixed(2)}%` : '—'}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )
                                      }

                                      return (
                                        <div
                                          key={proposal.id}
                                          className="flex items-center justify-between p-2 rounded bg-gray-100 dark:bg-gray-700/50"
                                        >
                                          <span className="text-xs text-gray-600 dark:text-gray-400">
                                            {userName}
                                          </span>
                                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                                            {proposal.weight !== null ? `${proposal.weight.toFixed(2)}%` : '—'}
                                          </span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : proposals.length === 0 ? (
                      <div className="text-center py-12">
                        <Users className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          No portfolios linked
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          Link this trade idea to a portfolio to submit proposals
                        </p>
                      </div>
                    ) : null}

                    {/* Cancelled Proposals */}
                    {rejectedProposals.length > 0 && (() => {
                      // Group cancelled proposals by portfolio
                      const cancelledByPortfolio = rejectedProposals.reduce((acc: Record<string, { name: string; proposals: typeof rejectedProposals }>, proposal: any) => {
                        const portfolioId = proposal.portfolio_id || 'unknown'
                        const portfolioName = proposal.portfolios?.name || 'Unknown Portfolio'
                        if (!acc[portfolioId]) {
                          acc[portfolioId] = { name: portfolioName, proposals: [] }
                        }
                        acc[portfolioId].proposals.push(proposal)
                        return acc
                      }, {})

                      const hasMultipleCancelledPortfolios = Object.keys(cancelledByPortfolio).length > 1

                      return (
                        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                          <div className="flex items-center gap-2 mb-3">
                            <XCircle className="h-4 w-4 text-gray-400" />
                            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              Cancelled ({rejectedProposals.length})
                            </h4>
                          </div>
                          <div className="space-y-3">
                            {hasMultipleCancelledPortfolios ? (
                              Object.entries(cancelledByPortfolio).map(([portfolioId, { name: portfolioName, proposals: portfolioProposals }]) => (
                                <div key={portfolioId} className="space-y-2">
                                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                    <Briefcase className="h-3 w-3" />
                                    <span>{portfolioName}</span>
                                  </div>
                                  {portfolioProposals.map((proposal: any) => {
                                    const userName = proposal.users?.first_name && proposal.users?.last_name
                                      ? `${proposal.users.first_name} ${proposal.users.last_name}`
                                      : proposal.users?.email || 'Unknown'
                                    const isCurrentUser = proposal.user_id === user?.id

                                    return (
                                      <div
                                        key={proposal.id}
                                        className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700"
                                      >
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                              {userName}
                                              {isCurrentUser && (
                                                <span className="ml-1 text-xs text-primary-600 dark:text-primary-400">(You)</span>
                                              )}
                                            </span>
                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                              {proposal.weight !== null ? `${Number(proposal.weight).toFixed(2)}%` : proposal.shares ? `${proposal.shares.toLocaleString()} sh` : '—'}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className="inline-flex items-center px-1.5 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                              Cancelled
                                            </span>
                                            {isCurrentUser && (
                                              <button
                                                onClick={() => {
                                                  setProposalWeight(proposal.weight?.toString() || '')
                                                  setProposalShares(proposal.shares?.toString() || '')
                                                  setProposalNotes('')
                                                  setProposalPortfolioId(proposal.portfolio_id || '')
                                                  setShowProposalModal(true)
                                                }}
                                                className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                                              >
                                                Re-propose
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              ))
                            ) : (
                              rejectedProposals.map((proposal: any) => {
                                const userName = proposal.users?.first_name && proposal.users?.last_name
                                  ? `${proposal.users.first_name} ${proposal.users.last_name}`
                                  : proposal.users?.email || 'Unknown'
                                const portfolioName = proposal.portfolios?.name || 'Unknown Portfolio'
                                const isCurrentUser = proposal.user_id === user?.id

                                return (
                                  <div
                                    key={proposal.id}
                                    className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">
                                          {userName}
                                          {isCurrentUser && (
                                            <span className="ml-1 text-xs text-primary-600 dark:text-primary-400">(You)</span>
                                          )}
                                        </span>
                                        <span className="text-xs text-gray-400">·</span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{portfolioName}</span>
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                          {proposal.weight !== null ? `${Number(proposal.weight).toFixed(2)}%` : proposal.shares ? `${proposal.shares.toLocaleString()} sh` : '—'}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center px-1.5 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                          Cancelled
                                        </span>
                                        {isCurrentUser && (
                                          <button
                                            onClick={() => {
                                              setProposalWeight(proposal.weight?.toString() || '')
                                              setProposalShares(proposal.shares?.toString() || '')
                                              setProposalNotes('')
                                              setProposalPortfolioId(proposal.portfolio_id || '')
                                              setShowProposalModal(true)
                                            }}
                                            className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                                          >
                                            Re-propose
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

              {/* Activity Tab for Single Trade */}
              {activeTab === 'activity' && (() => {
                // Calculate activity insights
                const createdAt = new Date(trade.created_at)
                const now = new Date()
                const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))

                // Get unique participants
                const participants = new Map<string, { name: string; role: string; avatar: string }>()

                // Creator
                if (trade.users) {
                  participants.set(trade.created_by || 'creator', {
                    name: getUserDisplayName(trade.users),
                    role: 'Creator',
                    avatar: getUserInitials(trade.users)
                  })
                }

                // Assignee
                if ((trade as any).assigned_user) {
                  participants.set((trade as any).assigned_to, {
                    name: getUserDisplayName((trade as any).assigned_user),
                    role: 'Assignee',
                    avatar: getUserInitials((trade as any).assigned_user)
                  })
                }

                // Proposers from proposals
                const proposalsData = proposals || []
                proposalsData.forEach((p: any) => {
                  const proposerData = p.users || p.user
                  if (proposerData && !participants.has(p.user_id)) {
                    participants.set(p.user_id, {
                      name: getUserDisplayName(proposerData),
                      role: 'Proposer',
                      avatar: getUserInitials(proposerData)
                    })
                  }
                })

                // Stage journey
                const stageOrder = ['idea', 'discussing', 'simulating', 'deciding', 'approved']
                const stageLabels: Record<string, string> = {
                  idea: 'Idea',
                  discussing: 'Working On',
                  simulating: 'Modeling',
                  deciding: 'Deciding',
                  approved: 'Committed'
                }
                const currentStageIndex = stageOrder.indexOf(trade.status) >= 0 ? stageOrder.indexOf(trade.status) :
                  trade.status === 'working_on' ? 1 : trade.status === 'modeling' ? 2 : 0

                return (
                  <div className="p-4 space-y-6">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">{daysSinceCreation}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Days Active</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">{proposalsData.length}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Proposals</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">{labLinks.length}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Portfolios</div>
                      </div>
                    </div>

                    {/* Stage Journey */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Stage Journey</h4>
                      <div className="flex items-center gap-1">
                        {stageOrder.slice(0, -1).map((stage, index) => {
                          const isCompleted = index < currentStageIndex
                          const isCurrent = index === currentStageIndex
                          return (
                            <div key={stage} className="flex items-center flex-1">
                              <div className={clsx(
                                "flex-1 h-2 rounded-full transition-colors",
                                isCompleted ? "bg-green-500" : isCurrent ? "bg-primary-500" : "bg-gray-200 dark:bg-gray-700"
                              )} />
                              {index < stageOrder.length - 2 && (
                                <ChevronRight className={clsx(
                                  "h-3 w-3 flex-shrink-0",
                                  isCompleted ? "text-green-500" : "text-gray-300 dark:text-gray-600"
                                )} />
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex justify-between mt-1">
                        {stageOrder.slice(0, -1).map((stage, index) => {
                          const isCurrent = index === currentStageIndex
                          return (
                            <span key={stage} className={clsx(
                              "text-[10px]",
                              isCurrent ? "font-medium text-primary-600 dark:text-primary-400" : "text-gray-400 dark:text-gray-500"
                            )}>
                              {stageLabels[stage]}
                            </span>
                          )
                        })}
                      </div>
                    </div>

                    {/* Participants */}
                    {participants.size > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Participants</h4>
                        <div className="flex flex-wrap gap-2">
                          {Array.from(participants.values()).map((p, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-full pl-1 pr-3 py-1">
                              <div className="w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[10px] font-medium text-gray-600 dark:text-gray-300">
                                {p.avatar}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-xs font-medium text-gray-900 dark:text-white leading-tight">{p.name}</span>
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">{p.role}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Dates */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Key Dates</h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Created</span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {format(createdAt, 'MMM d, yyyy')}
                          </span>
                        </div>
                        {trade.updated_at && trade.updated_at !== trade.created_at && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Last Updated</span>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {format(new Date(trade.updated_at), 'MMM d, yyyy')}
                            </span>
                          </div>
                        )}
                        {trade.decided_at && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Decision Made</span>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {format(new Date(trade.decided_at), 'MMM d, yyyy')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Detailed Timeline */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Activity Timeline</h4>
                      <EntityTimeline
                        entityType="trade_idea"
                        entityId={tradeId}
                        showHeader={false}
                        collapsible={false}
                        excludeActions={['attach', 'detach']}
                        maxItems={20}
                      />
                    </div>
                  </div>
                )
              })()}
            </>
          ) : null}
        </div>
      </div>

      {/* Defer Modal */}
      {showDeferModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setShowDeferModal(false)
              setDeferUntilDate(null)
            }}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                <Clock className="h-6 w-6 text-gray-600 dark:text-gray-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Defer Trade Idea
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  When should this idea resurface for review?
                </p>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Resurface Date
              </label>
              <DatePicker
                value={deferUntilDate}
                onChange={setDeferUntilDate}
                placeholder="Select date (optional)"
                allowPastDates={false}
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Leave empty to defer indefinitely
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowDeferModal(false)
                  setDeferUntilDate(null)
                  setSelectedDecisionPortfolioId(null)
                  setPendingDecision(null)
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  // Use portfolio-scoped decision if a portfolio is selected
                  if (selectedDecisionPortfolioId) {
                    portfolioDecisionMutation.mutate({
                      portfolioId: selectedDecisionPortfolioId,
                      decisionOutcome: 'deferred',
                    })
                    // Note: mutation onSuccess will handle cleanup
                  } else {
                    // Global defer - wait for mutation to complete before closing
                    await deferTradeAsync({
                      tradeId,
                      deferredUntil: deferUntilDate,
                      uiSource: 'modal',
                    })
                    // Force immediate refetch to ensure UI updates
                    await queryClient.invalidateQueries({
                      queryKey: ['trade-queue-items'],
                      refetchType: 'all'
                    })
                    await queryClient.refetchQueries({
                      queryKey: ['trade-queue-items'],
                      type: 'active'
                    })
                    setShowDeferModal(false)
                    setDeferUntilDate(null)
                    onClose()
                  }
                }}
                disabled={isDefering || portfolioDecisionMutation.isPending}
                loading={isDefering || portfolioDecisionMutation.isPending}
              >
                <Clock className="h-4 w-4 mr-1.5" />
                Defer{selectedDecisionPortfolioId && labLinks.length > 0
                  ? ` for ${labLinks.find(l => l.trade_lab?.portfolio_id === selectedDecisionPortfolioId)?.trade_lab?.portfolio?.name || 'portfolio'}`
                  : ''}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Proposal Modal - shown when moving to Deciding */}
      {showProposalModal && trade && (() => {
        // Get available portfolios from lab links
        const availablePortfolios = labLinks
          .map(link => link.trade_lab?.portfolio)
          .filter((p): p is { id: string; name: string } => !!p?.id)
          .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i) // dedupe

        // If no linked portfolios, use trade's direct portfolio
        if (availablePortfolios.length === 0 && trade.portfolio_id) {
          // We'd need to fetch the portfolio name, for now use placeholder
          availablePortfolios.push({ id: trade.portfolio_id, name: 'Portfolio' })
        }

        // Default to first portfolio if not selected
        const effectivePortfolioId = proposalPortfolioId || availablePortfolios[0]?.id || ''
        const showPortfolioSelector = availablePortfolios.length > 1

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => {
                setShowProposalModal(false)
                setProposalWeight('')
                setProposalShares('')
                setProposalNotes('')
                setProposalPortfolioId('')
              }}
            />
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Submit Your Proposal
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {trade.stage === 'deciding'
                  ? `Add your sizing proposal for ${trade.assets?.symbol}.`
                  : `Before moving to Deciding, please submit your sizing proposal for ${trade.assets?.symbol}.`
                }
              </p>

              <div className="space-y-4">
                {/* Portfolio selector - show when multiple portfolios */}
                {showPortfolioSelector && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Portfolio
                    </label>
                    <select
                      value={effectivePortfolioId}
                      onChange={(e) => setProposalPortfolioId(e.target.value)}
                      className="w-full h-9 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      {availablePortfolios.map(portfolio => (
                        <option key={portfolio.id} value={portfolio.id}>
                          {portfolio.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Select which portfolio this proposal is for
                    </p>
                  </div>
                )}

                {/* Single portfolio context display */}
                {!showPortfolioSelector && availablePortfolios.length === 1 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                    <Briefcase className="h-3.5 w-3.5" />
                    <span>Portfolio: <span className="font-medium text-gray-700 dark:text-gray-300">{availablePortfolios[0].name}</span></span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Target Weight %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={proposalWeight}
                      onChange={(e) => setProposalWeight(e.target.value)}
                      placeholder="e.g. 5.0"
                      className="w-full h-9 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Target Shares
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={proposalShares}
                      onChange={(e) => setProposalShares(e.target.value)}
                      placeholder="e.g. 1000"
                      className="w-full h-9 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Notes (optional)
                  </label>
                  <textarea
                    value={proposalNotes}
                    onChange={(e) => setProposalNotes(e.target.value)}
                    placeholder="Add any notes about your sizing rationale..."
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400">
                  You can enter weight, shares, or both. At least one is recommended.
                </p>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowProposalModal(false)
                    setProposalWeight('')
                    setProposalShares('')
                    setProposalNotes('')
                    setProposalPortfolioId('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    if (!user) return
                    if (!effectivePortfolioId) {
                      alert('Please select a portfolio')
                      return
                    }
                    setIsSubmittingProposal(true)
                    try {
                      // Build action context
                      const context: ActionContext = {
                        actorId: user.id,
                        actorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || '',
                        actorEmail: user.email,
                        actorRole: (user.role as 'analyst' | 'pm' | 'admin' | 'system') || 'analyst',
                        requestId: crypto.randomUUID(),
                        uiSource: 'modal',
                      }

                      // Upsert proposal with selected portfolio
                      await upsertProposal({
                        trade_queue_item_id: tradeId,
                        portfolio_id: effectivePortfolioId,
                        weight: proposalWeight ? parseFloat(proposalWeight) : null,
                        shares: proposalShares ? parseInt(proposalShares, 10) : null,
                        notes: proposalNotes || null,
                      }, context)

                      // Only move to deciding if not already there
                      if (trade.stage !== 'deciding') {
                        await updateStatusMutation.mutateAsync('deciding')
                      }

                      // Refresh proposals
                      queryClient.invalidateQueries({ queryKey: ['trade-proposals', tradeId] })

                      // Close modal and reset
                      setShowProposalModal(false)
                      setProposalWeight('')
                      setProposalShares('')
                      setProposalNotes('')
                      setProposalPortfolioId('')
                    } catch (error) {
                      console.error('Failed to submit proposal:', error)
                    } finally {
                      setIsSubmittingProposal(false)
                    }
                  }}
                  disabled={isSubmittingProposal || !effectivePortfolioId}
                  loading={isSubmittingProposal}
                >
                  <Scale className="h-4 w-4 mr-1.5" />
                  {trade.stage === 'deciding' ? 'Submit Proposal' : 'Submit & Move to Deciding'}
                </Button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Delete Trade Idea?
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  Are you sure you want to delete this trade idea? It will be moved to the deleted section and can be restored later if needed.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => deleteTradeMutation.mutate()}
                disabled={deleteTradeMutation.isPending}
                loading={deleteTradeMutation.isPending}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
