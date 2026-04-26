import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import {
  X,
  MessageSquare,
  Send,
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
  Gavel,
  FlaskConical,
  Wrench,
  Trash2,
  AlertTriangle,
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
  Briefcase,
  Search,
  SearchCode,
  Microscope,
  BrainCircuit,
  Tag,
  Globe,
  TrendingUp,
  TrendingDown,
  Copy,
  Loader2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { emitAuditEvent } from '../../lib/audit'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { DatePicker } from '../ui/DatePicker'
import { ContextTagsInput, type ContextTag, type ContextTagEntityType } from '../ui/ContextTagsInput'
import { useTradeExpressionCounts } from '../../hooks/useTradeExpressionCounts'
import { useTradeIdeaService } from '../../hooks/useTradeIdeaService'
import { EntityTimeline } from '../audit/EntityTimeline'
import { getIdeaLabLinks, updateIdeaLinkSizing, linkIdeaToLab, unlinkIdeaFromLab, getProposalsForTradeIdea, getPortfolioTracksForIdea, updatePortfolioTrackDecision, getEventsForTradeIdea } from '../../lib/services/trade-lab-service'
import { submitRecommendation } from '../../lib/services/recommendation-service'
import type { ActionContext, DecisionOutcome, UpdatePortfolioTrackInput, TradeSizingMode } from '../../types/trading'
import { UniversalSmartInput, SmartInputRenderer, type SmartInputMetadata } from '../smart-input'
import type { UniversalSmartInputRef } from '../smart-input'
import type {
  TradeQueueItemWithDetails,
  TradeQueueStatus
} from '../../types/trading'
import { clsx } from 'clsx'
import { PairTradeLegEditor } from './PairTradeLegEditor'
import { canMoveGlobalStage } from '../../lib/permissions/trade-idea-permissions'
import { toResearchStage, RESEARCH_STAGE_CONFIG } from '../../lib/trade-status-semantics'
import { ThesesDebatePanel } from './ThesesDebatePanel'
// AddThesisModal replaced by inline composers in ThesesDebatePanel
import { useThesisCounts, useTheses } from '../../hooks/useTheses'
import { LinkedResearchSection } from './LinkedResearchSection'

type ModalTab = 'details' | 'debate' | 'discussion' | 'decisions' | 'activity'

const PRIORITY_TOOLTIPS: Record<string, string> = {
  low: 'Monitor — keep on radar',
  medium: 'Normal research priority',
  high: 'Active investigation',
  urgent: 'Time-sensitive opportunity',
}

interface TradeIdeaDetailModalProps {
  isOpen: boolean
  tradeId: string
  onClose: () => void
  initialTab?: ModalTab
  /** Navigate to a different trade idea (e.g. counter-view) */
  onNavigateToIdea?: (ideaId: string) => void
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

export function TradeIdeaDetailModal({ isOpen, tradeId, onClose, initialTab = 'details', onNavigateToIdea }: TradeIdeaDetailModalProps) {
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
  const [, setDiscussionMetadata] = useState<SmartInputMetadata>({ mentions: [], references: [], dataSnapshots: [], aiGeneratedRanges: [] })
  const discussionLastSeenRef = useRef<string | null>(null)
  const [replyToMessage, setReplyToMessage] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  // Portfolio context for discussion messages
  const [discussionPortfolioFilter, setDiscussionPortfolioFilter] = useState<string | null>(null) // null = all, 'general' = no portfolio, or portfolio_id
  const [messagePortfolioContext, setMessagePortfolioContext] = useState<string | null>(null) // portfolio_id for the message being composed
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeferModal, setShowDeferModal] = useState(false)
  const [deferUntilDate, setDeferUntilDate] = useState<string | null>(null)
  const [showProposalModal, setShowProposalModal] = useState(false)
  const [debateComposerTrigger, setDebateComposerTrigger] = useState<'argument' | 'context' | null>(null)
  const [defaultThesisDirection, setDefaultThesisDirection] = useState<import('../../types/trading').ThesisDirection | undefined>()
  const [defaultThesisRationale, setDefaultThesisRationale] = useState<string | undefined>()
  const [proposalWeight, setProposalWeight] = useState<string>('')
  const [proposalShares, setProposalShares] = useState<string>('')
  const [proposalNotes, setProposalNotes] = useState<string>('')
  const [proposalPortfolioId, setProposalPortfolioId] = useState<string>('')
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false)

  // Enhanced proposal state for inline editing (mimics submit proposal modal)
  type ProposalSizingMode = 'weight' | 'delta_weight' | 'active_weight' | 'delta_benchmark'
  interface InlineProposalState {
    sizingMode: ProposalSizingMode
    direction: 'long' | 'short'
    value: string
    values: Partial<Record<ProposalSizingMode, string>> // per-mode values
    notes: string
  }
  const [inlineProposals, setInlineProposals] = useState<Record<string, InlineProposalState>>({})
  const [expandedProposalInputs, setExpandedProposalInputs] = useState<Set<string>>(new Set())
  const [confirmWithdrawId, setConfirmWithdrawId] = useState<string | null>(null) // proposal ID pending withdraw confirmation

  // Pair trade proposal editing state
  const [editingPairProposalId, setEditingPairProposalId] = useState<string | null>(null)
  const [editedPairProposalLegs, setEditedPairProposalLegs] = useState<Array<{ assetId: string; symbol: string; action: string; weight: number | null; sizingMode: string }>>([])
  const [isSavingPairProposal, setIsSavingPairProposal] = useState(false)
  // Track which field is the "source" for each leg (the field user entered, others are auto-calc)
  // Key format: `${portfolioId}-${legIdx}`, value: 'target' | 'deltaPort' | 'deltaBench'
  const [pairProposalSourceFields, setPairProposalSourceFields] = useState<Record<string, 'target' | 'deltaPort' | 'deltaBench'>>({})
  // New pair recommendation form
  const [showNewPairRec, setShowNewPairRec] = useState(false)
  const [newPairRecLegs, setNewPairRecLegs] = useState<Array<{ assetId: string; symbol: string; action: string; weight: string }>>([])
  const [newPairRecNotes, setNewPairRecNotes] = useState('')
  const [newPairRecPortfolioId, setNewPairRecPortfolioId] = useState<string>('')

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
  const [isEditingThesis, setIsEditingThesis] = useState(false)
  const [editedThesis, setEditedThesis] = useState('')
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
  const [isOwnershipExpanded, setIsOwnershipExpanded] = useState(false)
  const [isSizingExpanded, setIsSizingExpanded] = useState(false)
  const [isRiskExpanded, setIsRiskExpanded] = useState(false)
  const [pendingStageMove, setPendingStageMove] = useState<string | null>(null)

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
  const [showAddPortfolio, setShowAddPortfolio] = useState(false)

  // Portfolio decision state (for portfolio-scoped Accept/Defer/Reject)
  const [showPortfolioDecisionPicker, setShowPortfolioDecisionPicker] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<DecisionOutcome | null>(null)
  const [selectedDecisionPortfolioId, setSelectedDecisionPortfolioId] = useState<string | null>(null)

  // Assignment state
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false)
  const [showCollaboratorsDropdown, setShowCollaboratorsDropdown] = useState(false)
  // Pending (unsaved) collaborator selection — committed only on Save
  const [pendingCollaborators, setPendingCollaborators] = useState<string[] | null>(null)
  // Pending (unsaved) Lead assignee — undefined = not editing, null = unassign, string = user id
  const [pendingAssignee, setPendingAssignee] = useState<string | null | undefined>(undefined)
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
        // Build a synthetic pair trade object from the legs. rationale and
        // thesis_text are read from the first leg — the pair_id-only code
        // path writes them to every leg in unison, so any leg is authoritative.
        // IMPORTANT: thesis_summary must NOT be aliased onto a legs-sourced
        // pair; it only exists on rows in the pair_trades table. Mixing them
        // caused Trade Thesis saves to overwrite "Why Now" rationale.
        const firstLeg = pairLegs[0]
        return {
          type: 'pair_from_legs' as const,
          data: {
            id: tradeId,
            name: 'Pairs Trade',
            rationale: firstLeg.rationale,
            thesis_text: firstLeg.thesis_text,
            urgency: firstLeg.urgency,
            status: firstLeg.status,
            stage: firstLeg.stage,
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

  // Thesis debate counts
  const { data: thesisCounts } = useThesisCounts(trade?.id)
  const totalTheses = (thesisCounts?.bull ?? 0) + (thesisCounts?.bear ?? 0)

  // All theses for the Research tab (needed to map argument_id → direction)
  const { data: allThesesForResearch = [] } = useTheses(trade?.id)

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

  // Get all leg IDs for pair trades (needed for fetching lab links and proposals)
  const pairTradeLegIds = useMemo(() => {
    if (!pairTradeData) return []
    const legs = pairTradeData.trade_queue_items || pairTradeData.legs || []
    return legs.map((leg: any) => leg.id).filter(Boolean)
  }, [pairTradeData])

  // Fetch lab links with per-portfolio sizing
  const { data: labLinks = [], refetch: refetchLabLinks } = useQuery({
    queryKey: ['idea-lab-links', tradeId, pairTradeLegIds],
    queryFn: async () => {
      // Both single and pair trades go through getIdeaLabLinks — it handles
      // id-or-array and returns the normalized flat shape. For pair trades,
      // deduplicate by trade_lab_id since multiple legs typically link to
      // the same lab (we only want one row per lab in the modal).
      if (isPairTrade && pairTradeLegIds.length > 0) {
        const links = await getIdeaLabLinks(pairTradeLegIds)
        const seen = new Set<string>()
        return links.filter(link => {
          if (seen.has(link.trade_lab_id)) return false
          seen.add(link.trade_lab_id)
          return true
        })
      }
      return getIdeaLabLinks(tradeId)
    },
    enabled: isOpen && (!!trade || (isPairTrade && pairTradeLegIds.length > 0)),
  })

  // Fetch portfolio tracks for decision status per portfolio
  const { data: portfolioTracks = [], refetch: refetchPortfolioTracks } = useQuery({
    queryKey: ['portfolio-tracks', tradeId],
    queryFn: () => getPortfolioTracksForIdea(tradeId),
    enabled: isOpen && !!trade,
  })

  // Fetch proposals for this trade idea (for pair trades, fetch for all leg IDs)
  const { data: proposals = [], refetch: refetchProposals } = useQuery({
    queryKey: ['trade-proposals', tradeId, pairTradeLegIds],
    queryFn: async () => {
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

  // Fetch trade events (proposal lifecycle) for activity timeline
  const { data: tradeEventsData = [] } = useQuery({
    queryKey: ['trade-events', tradeId, pairTradeLegIds],
    queryFn: async () => {
      if (isPairTrade && pairTradeLegIds.length > 0) {
        // For pair trades, fetch events across all leg IDs
        const { data, error } = await supabase
          .from('trade_events')
          .select(`
            *,
            users:actor_id (id, email, first_name, last_name)
          `)
          .in('trade_queue_item_id', pairTradeLegIds)
          .order('created_at', { ascending: false })
          .limit(50)
        if (error) throw error
        return data || []
      }
      return getEventsForTradeIdea(tradeId, { limit: 50 })
    },
    enabled: isOpen && !!tradeId && (!isPairTrade || pairTradeLegIds.length > 0),
  })

  // Get portfolio IDs from lab links
  const linkedPortfolioIds = labLinks.map(l => l.trade_lab?.portfolio_id).filter(Boolean) as string[]

  // Include pair trade's direct portfolio_id and single trade's portfolio_id
  // so membership checks work even when there are no lab links
  const allRelevantPortfolioIds = useMemo(() => {
    const ids = new Set(linkedPortfolioIds)
    if (pairTradePortfolioId) ids.add(pairTradePortfolioId)
    if (trade?.portfolio_id) ids.add(trade.portfolio_id)
    return Array.from(ids)
  }, [linkedPortfolioIds, pairTradePortfolioId, trade?.portfolio_id])

  // Fetch members of all relevant portfolios (for stakeholder/participant display)
  const { data: linkedPortfolioMembers = [] } = useQuery({
    queryKey: ['portfolio-members', allRelevantPortfolioIds],
    queryFn: async () => {
      if (allRelevantPortfolioIds.length === 0) return []
      const { data, error } = await supabase
        .from('portfolio_memberships')
        .select('user_id, portfolio_id, is_portfolio_manager')
        .in('portfolio_id', allRelevantPortfolioIds)
      if (error) return []
      return data || []
    },
    enabled: isOpen && allRelevantPortfolioIds.length > 0,
    staleTime: 60_000,
  })

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

      // Fetch benchmark weights for all relevant portfolios
      const { data: benchmarkRows } = await supabase
        .from('portfolio_benchmark_weights')
        .select('portfolio_id, asset_id, weight')
        .in('portfolio_id', pairTradeProposalPortfolioIds)
        .in('asset_id', pairTradeLegAssetIds)

      // Build benchmark lookup: portfolioId -> assetId -> weight
      const benchmarkMap: Record<string, Record<string, number>> = {}
      benchmarkRows?.forEach(row => {
        if (!benchmarkMap[row.portfolio_id]) benchmarkMap[row.portfolio_id] = {}
        benchmarkMap[row.portfolio_id][row.asset_id] = Number(row.weight)
      })

      // Build nested map: portfolioId -> assetId -> holding data
      const result: Record<string, Record<string, { shares: number; price: number; weight: number; marketValue: number; benchmarkWeight: number | null }>> = {}

      pairTradeProposalPortfolioIds.forEach(portfolioId => {
        result[portfolioId] = {}
        const portfolioAum = portfolioTotals[portfolioId] || 0

        pairTradeLegAssetIds.forEach(assetId => {
          const holding = holdings?.find(h => h.portfolio_id === portfolioId && h.asset_id === assetId)
          const shares = holding?.shares || 0
          const price = holding?.price || 0
          const marketValue = shares * price
          const weight = portfolioAum > 0 ? (marketValue / portfolioAum) * 100 : 0
          const benchmarkWeight = benchmarkMap[portfolioId]?.[assetId] ?? null

          result[portfolioId][assetId] = { shares, price, weight, marketValue, benchmarkWeight }
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
      // Guard against a render loop: only set state when the derived targets
      // actually differ from current. Without this, a new object reference is
      // written every time labLinks ticks even if its contents are unchanged,
      // and any downstream consumer of portfolioTargets that feeds back into
      // a query key can trigger Max update depth exceeded.
      setPortfolioTargets(prev => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(targets)
        if (prevKeys.length !== nextKeys.length) return targets
        for (const k of nextKeys) {
          const p = prev[k]
          const n = targets[k]
          if (!p || p.absoluteWeight !== n.absoluteWeight || p.absoluteShares !== n.absoluteShares || p.sourceField !== n.sourceField) {
            return targets
          }
        }
        return prev
      })
    }
  }, [labLinks])

  // Build portfolio contexts from labLinks and portfolioHoldings for proposals tab.
  // Only include portfolios the current user is a member of — users should not
  // see sizing/decision sections for portfolios they don't belong to.
  const userPortfolioIds = useMemo(() => {
    if (!user?.id || !linkedPortfolioMembers) return new Set<string>()
    return new Set(linkedPortfolioMembers.filter(m => m.user_id === user.id).map(m => m.portfolio_id))
  }, [user?.id, linkedPortfolioMembers])

  useEffect(() => {
    let contexts: PortfolioContext[] = []

    if (labLinks.length > 0 && portfolioHoldings) {
      contexts = labLinks
        .filter(link => {
          const portfolioId = link.trade_lab?.portfolio_id
          // Only show portfolios the current user is a member of
          return portfolioId && userPortfolioIds.has(portfolioId)
        })
        .map(link => {
          const portfolioId = link.trade_lab?.portfolio_id
          const portfolioName = link.trade_lab?.portfolio?.name || 'Unknown Portfolio'
          const benchmark = (link.trade_lab?.portfolio as any)?.benchmark || null
          const holdingData = portfolioHoldings?.find(h => h.portfolioId === portfolioId)

          return {
            id: portfolioId || '',
            name: portfolioName,
            benchmark,
            currentShares: holdingData?.shares || 0,
            currentPrice: holdingData?.price || 0,
            currentValue: holdingData?.marketValue || 0,
            currentWeight: holdingData?.weight || 0,
            benchmarkWeight: null,
            activeWeight: null,
            portfolioTotalValue: holdingData?.totalPortfolioValue || 0,
          }
        }).filter(c => c.id)
    }

    // Fallback for pair trades with a direct portfolio_id but no lab links
    if (contexts.length === 0 && isPairTrade && pairTradePortfolioId && userPortfolioIds.has(pairTradePortfolioId)) {
      const portfolioName = pairTradeData?.portfolios?.name || 'Unknown Portfolio'
      const holdingData = portfolioHoldings?.find(h => h.portfolioId === pairTradePortfolioId)
      contexts = [{
        id: pairTradePortfolioId,
        name: portfolioName,
        benchmark: (pairTradeData?.portfolios as any)?.benchmark || null,
        currentShares: holdingData?.shares || 0,
        currentPrice: holdingData?.price || 0,
        currentValue: holdingData?.marketValue || 0,
        currentWeight: holdingData?.weight || 0,
        benchmarkWeight: null,
        activeWeight: null,
        portfolioTotalValue: holdingData?.totalPortfolioValue || 0,
      }]
    }

    // Also fallback for single trades with a direct portfolio_id but no lab links
    if (contexts.length === 0 && !isPairTrade && trade?.portfolio_id && userPortfolioIds.has(trade.portfolio_id)) {
      const portfolioName = trade?.portfolios?.name || 'Unknown Portfolio'
      const holdingData = portfolioHoldings?.find(h => h.portfolioId === trade.portfolio_id)
      contexts = [{
        id: trade.portfolio_id,
        name: portfolioName,
        benchmark: (trade?.portfolios as any)?.benchmark || null,
        currentShares: holdingData?.shares || 0,
        currentPrice: holdingData?.price || 0,
        currentValue: holdingData?.marketValue || 0,
        currentWeight: holdingData?.weight || 0,
        benchmarkWeight: null,
        activeWeight: null,
        portfolioTotalValue: holdingData?.totalPortfolioValue || 0,
      }]
    }

    if (contexts.length > 0) {
      setPortfolioContexts(contexts)

      // Initialize inline proposals for each portfolio
      const initialProposals: Record<string, InlineProposalState> = {}
      contexts.forEach(ctx => {
        // Check if user already has a proposal for this portfolio
        const existingProposal = proposals.find(p => p.portfolio_id === ctx.id && p.user_id === user?.id)
        if (existingProposal) {
          const sizingCtx = existingProposal.sizing_context as any
          const restoredMode = sizingCtx?.proposalType || existingProposal.sizing_mode || 'weight'
          const restoredValue = sizingCtx?.inputValue?.toString() ?? existingProposal.weight?.toString() ?? ''
          initialProposals[ctx.id] = {
            sizingMode: restoredMode,
            direction: 'long',
            value: restoredValue,
            values: { [restoredMode]: restoredValue },
            notes: existingProposal.notes || '',
          }
        } else {
          initialProposals[ctx.id] = { sizingMode: 'weight', direction: 'long', value: '', values: {}, notes: '' }
        }
      })
      setInlineProposals(initialProposals)
    }
  }, [labLinks, portfolioHoldings, proposals, user?.id, isPairTrade, pairTradePortfolioId, pairTradeData, trade])

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
  // Fetch trade labs the current user has portfolio membership for
  const { data: allLabs = [] } = useQuery({
    queryKey: ['user-trade-labs', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      // Get portfolios user is a member of
      const { data: memberships } = await supabase
        .from('portfolio_memberships')
        .select('portfolio_id')
        .eq('user_id', user.id)
      const memberPortfolioIds = (memberships || []).map(m => m.portfolio_id)
      if (memberPortfolioIds.length === 0) return []

      const { data, error } = await supabase
        .from('trade_labs')
        .select('id, name, portfolio_id, portfolios:portfolio_id (id, name)')
        .in('portfolio_id', memberPortfolioIds)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: isOpen && isManagingPortfolios && !!user?.id,
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

  // Auto-heal missing trade_lab_idea_links: ideas created via paths that
  // only set `trade_queue_items.portfolio_id` (legacy data, certain
  // seeders, or a failed lab-link insert in QuickTradeIdeaCapture) end
  // up with a portfolio in the trade row but no row in
  // trade_lab_idea_links — which makes the modal render "Add portfolio"
  // even though the idea has one. When we detect that state, find or
  // create the lab for the trade's portfolio and create the missing
  // link. Best-effort: any failure (RLS, network) is swallowed and the
  // visual fallback pill still shows.
  const healingFiredRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!isOpen || !trade || isPairTrade) return
    if (labLinks.length > 0) return
    const portfolioId = (trade as any).portfolio_id
    if (!portfolioId || !user?.id) return

    const key = `${tradeId}:${portfolioId}`
    if (healingFiredRef.current.has(key)) return
    healingFiredRef.current.add(key)

    void (async () => {
      try {
        // Find or create the trade_lab for this portfolio.
        let { data: lab } = await supabase
          .from('trade_labs')
          .select('id')
          .eq('portfolio_id', portfolioId)
          .maybeSingle()

        if (!lab) {
          const { data: portfolio } = await supabase
            .from('portfolios')
            .select('name')
            .eq('id', portfolioId)
            .maybeSingle()
          const { data: created, error: createErr } = await supabase
            .from('trade_labs')
            .insert({
              portfolio_id: portfolioId,
              name: `${portfolio?.name || 'Portfolio'} Trade Lab`,
              settings: {},
              created_by: user.id,
            })
            .select('id')
            .single()
          if (createErr) return
          lab = created
        }
        if (!lab) return

        await linkIdeaToLab(lab.id, tradeId, {
          actorId: user.id,
          actorRole: 'user',
          actorName: user.first_name || user.email || 'Unknown',
          actorEmail: user.email || '',
          uiSource: 'modal_heal',
          requestId: crypto.randomUUID(),
        })
        refetchLabLinks()
        queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
      } catch {
        /* best-effort; fallback pill still shows */
      }
    })()
  }, [isOpen, trade, isPairTrade, labLinks.length, tradeId, user, refetchLabLinks, queryClient])

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
  // null = All messages (default), string = portfolio-specific only
  const filteredDiscussionMessages = useMemo(() => {
    if (discussionPortfolioFilter === null) {
      return discussionMessages // Show all messages in the default view
    }
    return discussionMessages.filter((m: any) => m.portfolio_id === discussionPortfolioFilter)
  }, [discussionMessages, discussionPortfolioFilter])

  // Portfolios available for discussion scoping (from lab links, with pair trade fallback)
  const discussionPortfolios = useMemo(() => {
    const fromLinks = labLinks
      .map(l => l.trade_lab?.portfolio)
      .filter((p): p is { id: string; name: string } => !!p?.id && !!p?.name)
    if (fromLinks.length > 0) return fromLinks
    // Fallback for pair trades with a direct portfolio
    if (isPairTrade && pairTradeData?.portfolios?.id && pairTradeData?.portfolios?.name) {
      return [{ id: pairTradeData.portfolios.id, name: pairTradeData.portfolios.name }]
    }
    return fromLinks
  }, [labLinks, isPairTrade, pairTradeData])

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
      invalidateActivityCaches()
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

  // Helper: invalidate activity-related caches so the Activity tab stays fresh.
  // Trade events are written fire-and-forget so we also do a delayed refetch
  // to catch writes that haven't landed yet.
  const invalidateActivityCaches = () => {
    queryClient.invalidateQueries({ queryKey: ['trade-events', tradeId] })
    queryClient.invalidateQueries({ queryKey: ['audit-events', 'entity', 'trade_idea', tradeId] })
    queryClient.invalidateQueries({ queryKey: ['audit-events', 'entity', 'pair_trade', tradeId] })
    // Delayed refetch for fire-and-forget event writes
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['trade-events', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['audit-events', 'entity', 'trade_idea', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['audit-events', 'entity', 'pair_trade', tradeId] })
    }, 2000)
  }

  // Helper: emit audit event for direct field mutations (fire-and-forget)
  const emitFieldEdit = (changedFields: string[], entityId?: string) => {
    if (!user) return
    emitAuditEvent({
      actor: { id: user.id, type: 'user' },
      entity: { type: isPairTrade ? 'pair_trade' : 'trade_idea', id: entityId || tradeId },
      action: { type: 'update_fields', category: 'field_edit' },
      changedFields,
      metadata: { ui_source: 'modal' },
      orgId: undefined,
      actorEmail: user.email || undefined,
      actorName: [user.first_name, user.last_name].filter(Boolean).join(' ') || undefined,
    }).catch(e => console.warn('[TradeIdea] Audit failed:', e))
  }

  // Update priority mutation
  const updatePriorityMutation = useMutation({
    mutationFn: async (newPriority: string) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ urgency: newPriority })
        .eq('id', tradeId)

      if (error) throw error
      emitFieldEdit(['urgency'])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
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
      emitFieldEdit(['sharing_visibility'])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
      invalidateActivityCaches()
      setShowVisibilityDropdown(false)
    }
  })

  // Update assignee mutation
  // Helper: notify newly added users that they were assigned to this trade idea
  const notifyUsersAdded = async (
    userIds: string[],
    role: 'Lead Analyst' | 'Analyst',
  ) => {
    if (!user?.id || userIds.length === 0) return
    const assignerName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Someone'

    // Get trade context for notification
    let tradeLabel = 'a trade idea'
    let assetSymbol: string | null = null
    let assetName: string | null = null
    let assetId: string | null = null
    let notifContextType: 'asset' | 'workflow' = 'asset'
    let notifContextId: string = tradeId

    if (isPairTrade && pairTradeData) {
      const legs = pairTradeData.trade_queue_items || pairTradeData.legs || []
      const buys = legs.filter((l: any) => l.action === 'buy' || l.action === 'add').map((l: any) => l.assets?.symbol).filter(Boolean)
      const sells = legs.filter((l: any) => l.action === 'sell' || l.action === 'reduce').map((l: any) => l.assets?.symbol).filter(Boolean)
      tradeLabel = `pair trade ${buys.join(',')}/${sells.join(',')}`
      if (legs[0]?.asset_id) {
        assetId = legs[0].asset_id
        assetSymbol = legs[0].assets?.symbol || null
        assetName = legs[0].assets?.company_name || null
        notifContextId = assetId
      }
    } else if (trade) {
      assetSymbol = trade.assets?.symbol || null
      assetName = trade.assets?.company_name || null
      assetId = trade.asset_id || trade.assets?.id || null
      tradeLabel = `${trade.action?.toUpperCase() || 'trade'} ${assetSymbol || 'idea'}`
      if (assetId) notifContextId = assetId
    }

    const notifications = userIds
      .filter(uid => uid !== user.id) // don't notify yourself
      .map(uid => ({
        user_id: uid,
        type: 'task_assigned',
        title: `Added as ${role}`,
        message: `${assignerName} added you as ${role} on ${tradeLabel}`,
        context_type: notifContextType,
        context_id: notifContextId,
        context_data: {
          trade_idea_id: tradeId,
          is_pair_trade: isPairTrade,
          role,
          added_by: user.id,
          added_by_name: assignerName,
          asset_id: assetId,
          asset_symbol: assetSymbol,
          asset_name: assetName,
        },
      }))

    if (notifications.length > 0) {
      try {
        await supabase.from('notifications').insert(notifications)
      } catch (e) {
        console.error('[Assignment notify] failed:', e)
      }
    }
  }

  const updateAssigneeMutation = useMutation({
    mutationFn: async (assigneeId: string | null) => {
      const prevAssignee = trade?.assigned_to
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ assigned_to: assigneeId })
        .eq('id', tradeId)

      if (error) throw error
      emitFieldEdit(['assigned_to'])

      // Notify if a new user was assigned
      if (assigneeId && assigneeId !== prevAssignee) {
        await notifyUsersAdded([assigneeId], 'Lead Analyst')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
      setShowAssigneeDropdown(false)
    }
  })

  // Update collaborators mutation
  const updateCollaboratorsMutation = useMutation({
    mutationFn: async (collaboratorIds: string[]) => {
      const prevCollaborators: string[] = (trade as any)?.collaborators || []
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ collaborators: collaboratorIds })
        .eq('id', tradeId)

      if (error) throw error
      emitFieldEdit(['collaborators'])

      // Notify only newly added users
      const newlyAdded = collaboratorIds.filter(id => !prevCollaborators.includes(id))
      if (newlyAdded.length > 0) {
        await notifyUsersAdded(newlyAdded, 'Analyst')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
    }
  })

  // Update pair trade RATIONALE (a.k.a. "why now") mutation.
  // For pair_trades table: updates rationale on the pair row.
  // For pair_id-only trades: updates rationale on all legs.
  //
  // NOTE: There used to be a single `updatePairTradeRationaleMutation` that
  // handled BOTH rationale and thesis edits, and it hardcoded which column
  // it wrote to per branch — causing rationale edits on pair_trades to
  // clobber thesis_summary, and thesis edits on pair_id-only pairs to
  // clobber rationale. Split into two explicit mutations.
  const updatePairRationaleMutation = useMutation({
    mutationFn: async (newRationale: string | null) => {
      const isPairTradesTable = tradeData?.type === 'pair'
      if (isPairTradesTable) {
        const { error } = await supabase
          .from('pair_trades')
          .update({ rationale: newRationale, updated_at: new Date().toISOString() })
          .eq('id', tradeId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('trade_queue_items')
          .update({ rationale: newRationale, updated_at: new Date().toISOString() })
          .eq('pair_id', tradeId)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
      setIsEditingRationale(false)
      setEditedRationale('')
    }
  })

  // Update pair trade THESIS mutation.
  // For pair_trades table: updates thesis_summary on the pair row.
  // For pair_id-only trades: updates thesis_text on all legs (trade_queue_items
  // already has a thesis_text column — no need for the old "temporary"
  // write-to-rationale hack that was overwriting "why now").
  const updatePairThesisMutation = useMutation({
    mutationFn: async (newThesis: string | null) => {
      const isPairTradesTable = tradeData?.type === 'pair'
      if (isPairTradesTable) {
        const { error } = await supabase
          .from('pair_trades')
          .update({ thesis_summary: newThesis, updated_at: new Date().toISOString() })
          .eq('id', tradeId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('trade_queue_items')
          .update({ thesis_text: newThesis, updated_at: new Date().toISOString() })
          .eq('pair_id', tradeId)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
      setIsEditingThesis(false)
      setEditedThesis('')
    }
  })

  // Update pair trade urgency mutation (updates all legs)
  const updatePairTradeUrgencyMutation = useMutation({
    mutationFn: async (newUrgency: string) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ urgency: newUrgency, updated_at: new Date().toISOString() })
        .eq('pair_id', tradeId)

      if (error) throw error
      emitFieldEdit(['urgency'])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
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
      emitFieldEdit(['sharing_visibility'])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
      setShowVisibilityDropdown(false)
    }
  })

  // Update pair trade assignee mutation (updates all legs)
  const updatePairTradeAssigneeMutation = useMutation({
    mutationFn: async (assigneeId: string | null) => {
      const prevAssignee = pairTradeData?.assigned_to
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ assigned_to: assigneeId, updated_at: new Date().toISOString() })
        .eq('pair_id', tradeId)

      if (error) throw error
      emitFieldEdit(['assigned_to'])

      if (assigneeId && assigneeId !== prevAssignee) {
        await notifyUsersAdded([assigneeId], 'Lead Analyst')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
      setShowAssigneeDropdown(false)
    }
  })

  // Update pair trade collaborators mutation (updates all legs)
  const updatePairTradeCollaboratorsMutation = useMutation({
    mutationFn: async (collaboratorIds: string[]) => {
      const prevCollaborators: string[] = pairTradeData?.collaborators || []
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ collaborators: collaboratorIds, updated_at: new Date().toISOString() })
        .eq('pair_id', tradeId)

      if (error) throw error
      emitFieldEdit(['collaborators'])

      const newlyAdded = collaboratorIds.filter(id => !prevCollaborators.includes(id))
      if (newlyAdded.length > 0) {
        await notifyUsersAdded(newlyAdded, 'Analyst')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
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
      emitFieldEdit(['reference_levels'])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
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
      emitFieldEdit(['conviction', 'time_horizon'])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
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
      emitFieldEdit(['proposed_weight', 'proposed_shares'])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-detail', tradeId] })
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      invalidateActivityCaches()
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

  // Can this user move the idea through global stages (idea → working_on → modeling)?
  const canMoveStages = !!(user?.id && trade && canMoveGlobalStage(user.id, {
    created_by: trade.created_by,
    assigned_to: trade.assigned_to,
    collaborators: (trade as any).collaborators,
  }))

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

  const startEditThesis = () => {
    setEditedThesis((trade as any)?.thesis_text || '')
    setIsEditingThesis(true)
  }

  const cancelEditThesis = () => {
    setIsEditingThesis(false)
    setEditedThesis('')
  }

  const saveThesis = () => {
    updateTrade({
      tradeId,
      updates: { thesisText: editedThesis || null },
      uiSource: 'modal',
    })
    setIsEditingThesis(false)
    setEditedThesis('')
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

  const [hasUnreadDiscussion, setHasUnreadDiscussion] = useState(false)

  // Initialize the seen count when messages first load
  useEffect(() => {
    if (discussionMessages.length > 0 && discussionLastSeenRef.current === null) {
      discussionLastSeenRef.current = discussionMessages.length
    }
  }, [discussionMessages.length])

  // Reset on modal open
  useEffect(() => {
    if (isOpen) {
      discussionLastSeenRef.current = null
      setHasUnreadDiscussion(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (activeTab === 'discussion') {
      scrollToBottom()
      // Mark as seen
      discussionLastSeenRef.current = discussionMessages.length
      setHasUnreadDiscussion(false)
    } else if (discussionLastSeenRef.current !== null && discussionMessages.length > discussionLastSeenRef.current) {
      // New message arrived while on a different tab
      setHasUnreadDiscussion(true)
    }
  }, [discussionMessages.length, activeTab])

  const formatMessageTime = (createdAt: string) => {
    const messageDate = new Date(createdAt)
    const now = new Date()
    const minutesAgo = differenceInMinutes(now, messageDate)

    if (minutesAgo < 1) return 'just now'
    if (minutesAgo < 60) return `${minutesAgo}m ago`
    if (minutesAgo < 1440) return `${Math.floor(minutesAgo / 60)}h ago`
    // Same year: "Mar 14 · 9:56 PM", different year: "Mar 14, 2025 · 9:56 PM"
    const sameYear = messageDate.getFullYear() === now.getFullYear()
    const datePart = sameYear ? format(messageDate, 'MMM d') : format(messageDate, 'MMM d, yyyy')
    return `${datePart} · ${format(messageDate, 'h:mm a')}`
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

  // Pilot seed rows carry a synthetic author (the first admin in the org) so
  // that foreign-key constraints and audit trails stay valid, but surfacing
  // that person's name as the creator / recommender confuses the pilot user.
  // These helpers swap in "Pilot" whenever the row is pilot-seeded.
  const isPilotSeedTrade = (tradeRow: any): boolean =>
    !!(tradeRow?.origin_metadata as any)?.pilot_seed
  const isPilotSeedProposal = (proposalRow: any): boolean =>
    (proposalRow?.sizing_context as any)?.source === 'pilot_scenario'

  const getTradeCreatorDisplayName = (tradeRow: any): string =>
    isPilotSeedTrade(tradeRow)
      ? 'Pilot'
      : (tradeRow?.users ? getUserDisplayName(tradeRow.users) : 'Unknown')
  const getTradeCreatorInitials = (tradeRow: any): string =>
    isPilotSeedTrade(tradeRow)
      ? 'P'
      : (tradeRow?.users ? getUserInitials(tradeRow.users) : '?')

  const getProposerDisplayName = (proposalRow: any): string =>
    isPilotSeedProposal(proposalRow)
      ? 'Pilot'
      : (proposalRow?.users ? getUserDisplayName(proposalRow.users) : 'Unknown')

  // Derive discussion stakeholders: portfolio PMs + idea creator + collaborators + assignee
  const discussionParticipants = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; initials: string }>()
    // Build lookup from teamMembers for resolving user_id → name
    const teamLookup = new Map<string, { id: string; email: string; first_name?: string; last_name?: string }>()
    for (const tm of teamMembers || []) {
      teamLookup.set(tm.id, tm)
    }

    const addUser = (userData: any) => {
      if (!userData?.id || seen.has(userData.id)) return
      const name = getUserDisplayName(userData)
      const initials = getUserInitials(userData)
      seen.set(userData.id, { id: userData.id, name, initials })
    }

    // 1. Idea creator — skip for pilot-seeded trades so the synthetic admin
    // doesn't appear in the discussion avatar stack.
    if (!isPilotSeedTrade(trade)) {
      const creator = trade?.users || (trade as any)?.user
      if (creator) addUser(creator)
    }

    // 2. Assigned analyst
    const assignee = (trade as any)?.assigned_user
    if (assignee) addUser(assignee)

    // 3. Collaborators (research ownership)
    const collabs = (trade as any)?.collaborators
    if (Array.isArray(collabs)) {
      for (const c of collabs) addUser(c)
    }

    // 4. Portfolio PMs only (not all members) from linked portfolios
    for (const m of linkedPortfolioMembers) {
      if (!(m as any).is_portfolio_manager) continue
      const userId = (m as any).user_id
      if (userId && !seen.has(userId)) {
        const tm = teamLookup.get(userId)
        if (tm) addUser(tm)
      }
    }

    return Array.from(seen.values())
  }, [trade, linkedPortfolioMembers, teamMembers, discussionMessages])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-4xl w-full h-[85vh] max-h-[900px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            {/* Single Trade Header */}
            {trade && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
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
                  {trade.conviction && (
                    <span className={clsx(
                      "text-[11px] font-medium flex items-center gap-1 px-1.5 py-0.5 rounded",
                      trade.conviction === 'high' ? "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20" :
                      trade.conviction === 'medium' ? "text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20" :
                      "text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-700"
                    )}>
                      <span className={clsx(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        trade.conviction === 'high' ? "bg-green-500" :
                        trade.conviction === 'medium' ? "bg-blue-500" :
                        "bg-gray-400"
                      )} />
                      {trade.conviction === 'high' ? 'High Conviction' : trade.conviction === 'medium' ? 'Med Conviction' : 'Low Conviction'}
                    </span>
                  )}
                </div>
                {/* Portfolio pills — second line.
                    Fallback: if no lab links exist but the trade row carries
                    a `portfolio_id` (idea was created via a path that didn't
                    also write to trade_lab_idea_links, or the lab insert
                    failed), render the primary portfolio from the trade row
                    so the user sees what they actually saved. */}
                {(() => {
                  const showLegacyFallback = labLinks.length === 0 && !!trade?.portfolios?.name
                  const hasAnyPill = labLinks.length > 0 || showLegacyFallback
                  return (
                <div className="relative flex items-center gap-1.5 mt-1.5">
                  {labLinks.map((link: any) => {
                    const name = link.trade_lab?.portfolio?.name || link.trade_lab?.name || 'Unknown'
                    return (
                      <span key={link.id} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                        <Briefcase className="w-3 h-3 text-gray-400" />
                        {name}
                        {isManagingPortfolios && (
                          <button
                            onClick={(e) => { e.stopPropagation(); unlinkFromLabMutation.mutate(link.trade_lab_id) }}
                            disabled={unlinkFromLabMutation.isPending}
                            className="text-gray-400 hover:text-red-500 transition-colors ml-0.5"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </span>
                    )
                  })}
                  {showLegacyFallback && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                      <Briefcase className="w-3 h-3 text-gray-400" />
                      {trade.portfolios.name}
                    </span>
                  )}
                  <button
                    onClick={() => setIsManagingPortfolios(!isManagingPortfolios)}
                    className={clsx(
                      'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors',
                      !hasAnyPill
                        ? 'text-primary-600 bg-primary-50 hover:bg-primary-100 dark:text-primary-400 dark:bg-primary-900/20'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700',
                    )}
                  >
                    <Plus className="w-3 h-3" />
                    {!hasAnyPill ? 'Add portfolio' : 'Add'}
                  </button>
                  {isManagingPortfolios && (
                    <>
                    <div className="fixed inset-0 z-40" onClick={() => { setIsManagingPortfolios(false); setShowAddPortfolio(false) }} />
                    <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[220px] max-h-64 overflow-y-auto">
                      {allLabs.filter((lab: any) => !labLinks.some((l: any) => l.trade_lab_id === lab.id)).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400">Already in all portfolios</div>
                      ) : (
                        allLabs
                          .filter((lab: any) => !labLinks.some((l: any) => l.trade_lab_id === lab.id))
                          .map((lab: any) => (
                            <button
                              key={lab.id}
                              onClick={() => { linkToLabMutation.mutate(lab.id); setIsManagingPortfolios(false) }}
                              disabled={linkToLabMutation.isPending}
                              className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                              <Briefcase className="w-3.5 h-3.5 text-gray-400" />
                              {lab.portfolios?.name || lab.name}
                            </button>
                          ))
                      )}
                    </div>
                    </>
                  )}
                </div>
                  )
                })()}
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

              const firstLeg = legs[0]
              const conv = firstLeg?.conviction

              return (
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Pair Trade icon badge */}
                    <div className="p-1.5 rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 flex-shrink-0">
                      <Link2 className="h-4 w-4" />
                    </div>
                    {/* Trade structure */}
                    <span className="font-semibold uppercase text-base text-green-600 dark:text-green-400">BUY</span>
                    <span className="font-bold text-lg text-gray-900 dark:text-white">{buySymbols}</span>
                    <span className="text-gray-400 dark:text-gray-500">·</span>
                    <span className="font-semibold uppercase text-base text-red-600 dark:text-red-400">SELL</span>
                    <span className="font-bold text-lg text-gray-900 dark:text-white">{sellSymbols}</span>
                    {conv && (
                      <span className={clsx(
                        "text-[11px] font-medium flex items-center gap-1 px-1.5 py-0.5 rounded",
                        conv === 'high' ? "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20" :
                        conv === 'medium' ? "text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20" :
                        "text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-700"
                      )}>
                        <span className={clsx(
                          "inline-block h-1.5 w-1.5 rounded-full",
                          conv === 'high' ? "bg-green-500" :
                          conv === 'medium' ? "bg-blue-500" :
                          "bg-gray-400"
                        )} />
                        {conv === 'high' ? 'High Conviction' : conv === 'medium' ? 'Med Conviction' : 'Low Conviction'}
                      </span>
                    )}
                  </div>
                  {/* Portfolio pills — second line */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {labLinks.map((link: any) => {
                      const name = link.trade_lab?.portfolio?.name || link.trade_lab?.name || 'Unknown'
                      return (
                        <span key={link.id} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                          <Briefcase className="w-3 h-3 text-gray-400" />
                          {name}
                        </span>
                      )
                    })}
                    {pairTradePortfolioId && labLinks.length === 0 && pairTradeData.portfolios?.name && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                        <Briefcase className="w-3 h-3 text-gray-400" />
                        {pairTradeData.portfolios.name}
                      </span>
                    )}
                  </div>
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

          {/* Tabs — compact text-only to prevent overflow */}
          <div className="flex gap-0.5">
            {([
              { key: 'details' as const, label: 'Details' },
              { key: 'debate' as const, label: 'Debate', badge: totalTheses > 0 ? totalTheses : undefined },
              { key: 'discussion' as const, label: 'Discussion', dot: hasUnreadDiscussion },
              { key: 'decisions' as const, label: 'Recommend', badge: proposals.length > 0 ? proposals.length : undefined },
              { key: 'activity' as const, label: 'Activity' },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  "px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-colors whitespace-nowrap",
                  activeTab === tab.key
                    ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                    : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                )}
              >
                {tab.label}
                {'badge' in tab && tab.badge != null && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-full">
                    {tab.badge}
                  </span>
                )}
                {'dot' in tab && tab.dot && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-500 align-middle" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {isLoading ? (
            <div className="p-4 space-y-4">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          ) : isPairTrade && pairTradeData ? (
            <>
              {/* Pair Trade Details Tab */}
              {activeTab === 'details' && (
                <div className="p-4 space-y-2 flex flex-col flex-1">
                  {/* ========== STAGE JOURNEY ========== */}
                  {(() => {
                    const stageOrder = ['aware', 'investigate', 'deep_research', 'thesis_forming', 'ready_for_decision'] as const
                    const stageLabels: Record<string, string> = { aware: 'Aware', investigate: 'Investigate', deep_research: 'Deep Research', thesis_forming: 'Thesis Forming', ready_for_decision: 'Ready' }
                    const legacyMap: Record<string, number> = { idea: 0, discussing: 1, working_on: 1, simulating: 2, modeling: 2, deciding: 4, approved: 4 }
                    const currentStageIndex = stageOrder.indexOf(pairTradeData.stage as any) >= 0
                      ? stageOrder.indexOf(pairTradeData.stage as any)
                      : (legacyMap[pairTradeData.stage] ?? legacyMap[pairTradeData.status] ?? 0)
                    const isTerminal = pairTradeData.status === 'approved' || pairTradeData.status === 'cancelled' || pairTradeData.status === 'rejected' || pairTradeData.status === 'archived' || pairTradeData.status === 'deleted'
                    const currentStageLabel = stageLabels[stageOrder[currentStageIndex]] || 'Aware'
                    const stageAge = (() => {
                      const ref = pairTradeData.stage_changed_at || pairTradeData.updated_at || pairTradeData.created_at
                      const diffMs = Date.now() - new Date(ref).getTime()
                      const diffHours = Math.floor(diffMs / 3600000)
                      const diffDays = Math.floor(diffHours / 24)
                      const diffWeeks = Math.floor(diffDays / 7)
                      if (diffHours < 1) return '<1h'
                      if (diffHours < 24) return `${diffHours}h`
                      if (diffDays < 14) return `${diffDays}d`
                      return `${diffWeeks}w`
                    })()
                    return (
                      <div className="pb-3 border-b border-gray-200 dark:border-gray-700 space-y-1.5">
                        <div className="flex items-stretch gap-0.5">
                          {stageOrder.map((stage, index) => {
                            const isCompleted = index < currentStageIndex
                            const isCurrent = index === currentStageIndex
                            const isFuture = index > currentStageIndex
                            const canClick = isPairTradeOwner && !isTerminal && !isCurrent
                            return (
                              <button
                                key={stage}
                                type="button"
                                disabled={!canClick}
                                onClick={() => canClick && setPendingStageMove(stage)}
                                className={clsx(
                                  "flex-1 py-1.5 text-[11px] font-medium rounded transition-all text-center leading-tight",
                                  isCompleted && "bg-green-500 text-white",
                                  isCurrent && "bg-primary-500 text-white ring-2 ring-primary-300 dark:ring-primary-700",
                                  isFuture && "bg-gray-100 dark:bg-gray-700/60 text-gray-400 dark:text-gray-500",
                                  canClick && isFuture && "hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer",
                                  canClick && isCompleted && "hover:bg-green-600 cursor-pointer",
                                  !canClick && "cursor-default"
                                )}
                              >
                                {stageLabels[stage]}
                              </button>
                            )
                          })}
                        </div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500">
                          In stage for {stageAge}
                        </div>
                        {pendingStageMove && (
                          <div className="flex items-center justify-between bg-primary-50 dark:bg-primary-900/20 rounded-lg px-3 py-2">
                            <span className="text-xs text-primary-700 dark:text-primary-300">
                              {stageOrder.indexOf(pendingStageMove as any) < currentStageIndex ? 'Move back' : 'Move forward'} to <span className="font-semibold">{stageLabels[pendingStageMove]}</span>?
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setPendingStageMove(null)}
                                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  updatePairTradeStatusMutation.mutate(pendingStageMove as any)
                                  setPendingStageMove(null)
                                }}
                                disabled={updatePairTradeStatusMutation.isPending}
                                className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                              >
                                {updatePairTradeStatusMutation.isPending ? 'Moving...' : 'Confirm'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* ========== PAIR WHY NOW? SECTION ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Why Now?</h3>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">Why is this pair trade worth investigating now? What changed or what is the catalyst?</span>
                    </div>
                    {isEditingRationale ? (
                      <>
                        <textarea
                          autoFocus
                          value={editedRationale}
                          onChange={(e) => {
                            setEditedRationale(e.target.value.slice(0, 300))
                            e.target.style.height = 'auto'
                            e.target.style.height = e.target.scrollHeight + 'px'
                          }}
                          ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                          placeholder="Why is this pair trade worth investigating now?"
                          rows={1}
                          maxLength={300}
                          className="w-full p-2 text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 resize-none border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent leading-relaxed overflow-hidden"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setIsEditingRationale(false)
                              setEditedRationale('')
                            }
                          }}
                        />
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => {
                              setIsEditingRationale(false)
                              setEditedRationale('')
                            }}
                            disabled={updatePairRationaleMutation.isPending}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => updatePairRationaleMutation.mutate(editedRationale || null)}
                            disabled={updatePairRationaleMutation.isPending}
                            className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                          >
                            {updatePairRationaleMutation.isPending ? 'Saving...' : 'Save'}
                          </button>
                          <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{editedRationale.length}/300</span>
                        </div>
                      </>
                    ) : (
                      <div className="group">
                        {pairTradeData.rationale ? (
                          <div className="flex gap-2">
                            <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                              {pairTradeData.rationale}
                            </p>
                            {isPairTradeOwner && (
                              <button
                                onClick={() => {
                                  setEditedRationale(pairTradeData.rationale || '')
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
                            + Add catalyst or reason
                          </button>
                        ) : (
                          <p className="text-sm text-gray-400 italic">No catalyst noted</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== THESIS (unlocked at thesis_forming stage) ========== */}
                  {(() => {
                    const thesisStages = ['thesis_forming', 'ready_for_decision', 'deciding']
                    const showThesis = thesisStages.includes(pairTradeData.stage) || thesisStages.includes(pairTradeData.status)
                    if (!showThesis) return null
                    return (
                      <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-baseline gap-2 mb-1.5">
                          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Trade Thesis</h3>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">The trade thesis — your structured reasoning for this pair trade</span>
                        </div>
                        {isEditingThesis ? (
                          <>
                            <textarea
                              autoFocus
                              value={editedThesis}
                              onChange={(e) => {
                                setEditedThesis(e.target.value.slice(0, 300))
                                e.target.style.height = 'auto'
                                e.target.style.height = e.target.scrollHeight + 'px'
                              }}
                              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                              placeholder="Write the trade thesis — what is your conviction based on? What are the key drivers?"
                              rows={1}
                              maxLength={300}
                              className="w-full p-2 text-sm bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 resize-none border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent leading-relaxed overflow-hidden"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  setIsEditingThesis(false)
                                  setEditedThesis('')
                                }
                              }}
                            />
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                onClick={() => { setIsEditingThesis(false); setEditedThesis('') }}
                                disabled={updatePairThesisMutation.isPending}
                                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  // Thesis goes to pair_trades.thesis_summary or
                                  // trade_queue_items.thesis_text (per leg) — NOT rationale.
                                  updatePairThesisMutation.mutate(editedThesis || null)
                                }}
                                disabled={updatePairThesisMutation.isPending}
                                className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                              >
                                {updatePairThesisMutation.isPending ? 'Saving...' : 'Save'}
                              </button>
                              <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{editedThesis.length}/300</span>
                            </div>
                          </>
                        ) : (
                          <div className="group">
                            {(pairTradeData.thesis_summary || (pairTradeData as any).thesis_text) ? (
                              <div className="flex gap-2">
                                <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                                  {pairTradeData.thesis_summary || (pairTradeData as any).thesis_text}
                                </p>
                                {isPairTradeOwner && (
                                  <button
                                    onClick={() => {
                                      setEditedThesis(pairTradeData.thesis_summary || (pairTradeData as any).thesis_text || '')
                                      setIsEditingThesis(true)
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
                                  setEditedThesis('')
                                  setIsEditingThesis(true)
                                }}
                                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                              >
                                + Write trade thesis
                              </button>
                            ) : (
                              <p className="text-sm text-gray-400 italic">No thesis written yet</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()}

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

                  {/* Pair trade sizing is handled by PairTradeLegEditor above — no separate "Idea Expression" section needed */}

                  {/* ========== REFERENCE LEVELS ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div
                      className="flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => setIsSizingExpanded(!isSizingExpanded)}
                    >
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {isSizingExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Target className="h-3.5 w-3.5" />
                        Reference Levels
                      </div>
                      {isPairTradeOwner && !isEditingPairReferenceLevels && isSizingExpanded && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
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

                  {/* ========== CONVICTION & TIME HORIZON ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div
                      className="flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => setIsRiskExpanded(!isRiskExpanded)}
                    >
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {isRiskExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Gauge className="h-3.5 w-3.5" />
                        Conviction &amp; Time Horizon
                      </div>
                      {isPairTradeOwner && !isEditingPairConviction && isRiskExpanded && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
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
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Conviction</span>
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
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Time Horizon</span>
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

                  {/* ========== RESEARCH OWNERSHIP ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div
                      className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => setIsOwnershipExpanded(!isOwnershipExpanded)}
                    >
                      {isOwnershipExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Users className="h-3.5 w-3.5" />
                      Research Ownership
                    </div>
                    {isOwnershipExpanded && (
                      <div className="mt-3 space-y-2.5">
                        {/* Owner */}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-400 uppercase tracking-wide w-20">Owner</span>
                          <div className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                            <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[10px] font-medium">
                              {pairTradeData.users ? getUserInitials(pairTradeData.users) : '?'}
                            </div>
                            <span className="font-medium">{pairTradeData.users ? getUserDisplayName(pairTradeData.users) : 'Unknown'}</span>
                          </div>
                        </div>

                        {/* Assigned Analyst */}
                        <div className="relative" ref={assigneeDropdownRef}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wide w-20">Lead</span>
                            <div className="flex items-center gap-1.5 text-xs">
                              {isPairTradeOwner ? (
                                <button
                                  onClick={() => {
                                    if (!showAssigneeDropdown) {
                                      setPendingAssignee(pairTradeData.assigned_to ?? null)
                                    }
                                    setShowAssigneeDropdown(!showAssigneeDropdown)
                                  }}
                                  className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                >
                                  {pairTradeData.assigned_user ? (
                                    <>
                                      <div className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-[10px] font-medium">
                                        {getUserInitials(pairTradeData.assigned_user)}
                                      </div>
                                      <span className="font-medium">{getUserDisplayName(pairTradeData.assigned_user)}</span>
                                    </>
                                  ) : (
                                    <span className="text-gray-400">+ Assign</span>
                                  )}
                                  <ChevronDown className={clsx("h-3 w-3 text-gray-400 transition-transform", showAssigneeDropdown && "rotate-180")} />
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  {pairTradeData.assigned_user && (
                                    <div className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-[10px] font-medium">
                                      {getUserInitials(pairTradeData.assigned_user)}
                                    </div>
                                  )}
                                  <span className="text-gray-700 dark:text-gray-300">
                                    {pairTradeData.assigned_user ? getUserDisplayName(pairTradeData.assigned_user) : 'Not assigned'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          {showAssigneeDropdown && isPairTradeOwner && (() => {
                            const workingLead = pendingAssignee !== undefined ? pendingAssignee : (pairTradeData.assigned_to ?? null)
                            const originalLead = pairTradeData.assigned_to ?? null
                            const hasChanges = workingLead !== originalLead
                            const closeAndReset = () => {
                              setShowAssigneeDropdown(false)
                              setPendingAssignee(undefined)
                            }
                            return (
                            <>
                              <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); closeAndReset() }} />
                              <div className="absolute right-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[280px]">
                                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-700/50">
                                    <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                    <input
                                      type="text"
                                      placeholder="Search team..."
                                      className="flex-1 text-sm bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                                      onChange={(e) => {
                                        const el = e.target.closest('[data-people-list]')?.querySelectorAll('[data-person]')
                                        el?.forEach((item: any) => {
                                          const name = item.dataset.person?.toLowerCase() || ''
                                          item.style.display = name.includes(e.target.value.toLowerCase()) ? '' : 'none'
                                        })
                                      }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                </div>
                                <div className="max-h-[200px] overflow-y-auto py-1" data-people-list>
                                  <button
                                    data-person="unassign"
                                    onClick={(e) => { e.stopPropagation(); setPendingAssignee(null) }}
                                    className={clsx("w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", workingLead === null && "bg-gray-100 dark:bg-gray-700")}
                                  >
                                    <XCircle className="h-4 w-4 text-gray-400" />
                                    <span className="text-sm text-gray-500">Unassign</span>
                                  </button>
                                  {teamMembers?.filter(m => m.id !== user?.id).map(member => {
                                    const isSelected = workingLead === member.id
                                    return (
                                      <button
                                        key={member.id}
                                        data-person={getUserDisplayName(member)}
                                        onClick={(e) => { e.stopPropagation(); setPendingAssignee(member.id) }}
                                        className={clsx("w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", isSelected && "bg-primary-50 dark:bg-primary-900/20")}
                                      >
                                        <div className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold", isSelected ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300")}>
                                          {getUserInitials(member)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{getUserDisplayName(member)}</div>
                                          {member.email && <div className="text-[10px] text-gray-400 truncate">{member.email}</div>}
                                        </div>
                                        {isSelected && <Check className="h-4 w-4 text-primary-600 dark:text-primary-400 flex-shrink-0" />}
                                      </button>
                                    )
                                  })}
                                </div>
                                <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); closeAndReset() }}
                                    className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    disabled={!hasChanges || updatePairTradeAssigneeMutation.isPending}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      updatePairTradeAssigneeMutation.mutate(workingLead, {
                                        onSuccess: () => { setPendingAssignee(undefined) },
                                      })
                                    }}
                                    className="px-2.5 py-1 text-[11px] font-semibold rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  >
                                    {updatePairTradeAssigneeMutation.isPending ? 'Saving…' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            </>
                            )
                          })()}
                        </div>

                        {/* Analysts (multi-select) */}
                        <div className="relative" ref={collaboratorsDropdownRef}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wide w-20">Analysts</span>
                            <div className="flex items-center gap-1 text-xs">
                              {isPairTradeOwner ? (
                                <>
                                  {/* Show selected avatars inline */}
                                  {pairTradeData.collaborators?.length > 0 && (
                                    <div className="flex items-center -space-x-1 mr-1">
                                      {pairTradeData.collaborators.slice(0, 4).map((collabId: string) => {
                                        const member = teamMembers?.find(m => m.id === collabId)
                                        return member ? (
                                          <div key={collabId} className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-[9px] font-semibold border border-white dark:border-gray-800" title={getUserDisplayName(member)}>
                                            {getUserInitials(member)}
                                          </div>
                                        ) : null
                                      })}
                                      {pairTradeData.collaborators.length > 4 && (
                                        <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 text-gray-500 rounded-full flex items-center justify-center text-[9px] font-semibold border border-white dark:border-gray-800">
                                          +{pairTradeData.collaborators.length - 4}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <button
                                    onClick={() => {
                                      if (!showCollaboratorsDropdown) {
                                        setPendingCollaborators(pairTradeData.collaborators || [])
                                      }
                                      setShowCollaboratorsDropdown(!showCollaboratorsDropdown)
                                    }}
                                    className="flex items-center gap-1 text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                  >
                                    <span>{pairTradeData.collaborators?.length > 0 ? 'Edit' : '+ Add'}</span>
                                    <ChevronDown className={clsx("h-3 w-3 transition-transform", showCollaboratorsDropdown && "rotate-180")} />
                                  </button>
                                </>
                              ) : (
                                <div className="flex items-center gap-1">
                                  {pairTradeData.collaborators?.length > 0 ? (
                                    <div className="flex items-center -space-x-1">
                                      {pairTradeData.collaborators.slice(0, 4).map((collabId: string) => {
                                        const member = teamMembers?.find(m => m.id === collabId)
                                        return member ? (
                                          <div key={collabId} className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[9px] font-semibold border border-white dark:border-gray-800" title={getUserDisplayName(member)}>
                                            {getUserInitials(member)}
                                          </div>
                                        ) : null
                                      })}
                                      {pairTradeData.collaborators.length > 4 && (
                                        <span className="text-gray-400 ml-1">+{pairTradeData.collaborators.length - 4}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400">None</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {showCollaboratorsDropdown && isPairTradeOwner && (() => {
                            const working = pendingCollaborators ?? (pairTradeData.collaborators || [])
                            const original: string[] = pairTradeData.collaborators || []
                            const addedCount = working.filter(id => !original.includes(id)).length
                            const removedCount = original.filter(id => !working.includes(id)).length
                            const hasChanges = addedCount > 0 || removedCount > 0
                            const closeAndReset = () => {
                              setShowCollaboratorsDropdown(false)
                              setPendingCollaborators(null)
                            }
                            return (
                            <>
                              <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); closeAndReset() }} />
                              <div className="absolute right-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[280px]">
                                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-700/50">
                                    <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                    <input
                                      type="text"
                                      placeholder="Search team..."
                                      className="flex-1 text-sm bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                                      onChange={(e) => {
                                        const el = e.target.closest('[data-people-list]')?.querySelectorAll('[data-person]')
                                        el?.forEach((item: any) => {
                                          const name = item.dataset.person?.toLowerCase() || ''
                                          item.style.display = name.includes(e.target.value.toLowerCase()) ? '' : 'none'
                                        })
                                      }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                </div>
                                <div className="max-h-[200px] overflow-y-auto py-1" data-people-list>
                                  {teamMembers?.filter(m => m.id !== user?.id && m.id !== pairTradeData.assigned_to).map(member => {
                                    const isSelected = working.includes(member.id)
                                    return (
                                      <button
                                        key={member.id}
                                        data-person={getUserDisplayName(member)}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setPendingCollaborators(isSelected
                                            ? working.filter(id => id !== member.id)
                                            : [...working, member.id])
                                        }}
                                        className={clsx("w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", isSelected && "bg-primary-50 dark:bg-primary-900/20")}
                                      >
                                        <div className={clsx("w-4 h-4 border rounded flex items-center justify-center flex-shrink-0", isSelected ? "border-primary-500 bg-primary-500 text-white" : "border-gray-300 dark:border-gray-600")}>
                                          {isSelected && <Check className="h-3 w-3" />}
                                        </div>
                                        <div className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0", isSelected ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300")}>
                                          {getUserInitials(member)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{getUserDisplayName(member)}</div>
                                          {member.email && <div className="text-[10px] text-gray-400 truncate">{member.email}</div>}
                                        </div>
                                      </button>
                                    )
                                  })}
                                  {(!teamMembers || teamMembers.filter(m => m.id !== user?.id && m.id !== pairTradeData.assigned_to).length === 0) && (
                                    <div className="px-3 py-2 text-sm text-gray-500">No team members available</div>
                                  )}
                                </div>
                                <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                    {working.length} selected
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); closeAndReset() }}
                                      className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      disabled={!hasChanges || updatePairTradeCollaboratorsMutation.isPending}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        updatePairTradeCollaboratorsMutation.mutate(working, {
                                          onSuccess: () => { setPendingCollaborators(null) },
                                        })
                                      }}
                                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                      {updatePairTradeCollaboratorsMutation.isPending ? 'Saving…' : 'Save'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </>
                            )
                          })()}
                        </div>

                      </div>
                    )}
                  </div>

                  {/* ========== DEFER / ARCHIVE / DELETE ========== */}
                  {pairTradeData.status !== 'approved' && pairTradeData.status !== 'cancelled' && pairTradeData.status !== 'rejected' && pairTradeData.status !== 'archived' && pairTradeData.status !== 'deleted' && isPairTradeOwner && (
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => updatePairTradeStatusMutation.mutate('cancelled')}
                        disabled={updatePairTradeStatusMutation.isPending}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                      >
                        Defer
                      </button>
                      <button
                        onClick={() => updatePairTradeStatusMutation.mutate('cancelled')}
                        disabled={updatePairTradeStatusMutation.isPending}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                      >
                        Archive
                      </button>
                      <button
                        onClick={() => updatePairTradeStatusMutation.mutate('deleted')}
                        disabled={updatePairTradeStatusMutation.isPending}
                        className="text-xs text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
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
                          Aware
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('discussing')} disabled={updatePairTradeStatusMutation.isPending}>
                          Investigate
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updatePairTradeStatusMutation.mutate('simulating')} disabled={updatePairTradeStatusMutation.isPending}>
                          Deep Research
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

                  {/* ========== METADATA ========== */}
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Created {formatDistanceToNow(new Date(pairTradeData.created_at), { addSuffix: true })}
                    </div>

                    {/* Visibility */}
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
                        <div className="absolute left-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[200px]">
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
                  </div>

                </div>
              )}

              {/* Discussion Tab for Pair Trade */}
              {activeTab === 'discussion' && (() => {
                const ptActiveScopeLabel = discussionPortfolioFilter
                  ? discussionPortfolios.find(p => p.id === discussionPortfolioFilter)?.name
                  : null
                const ptEmptyHeading = ptActiveScopeLabel
                  ? `No discussion yet for ${ptActiveScopeLabel}`
                  : 'No discussion yet'
                const ptEmptySubtext = ptActiveScopeLabel
                  ? `Start the conversation about this pair trade in the context of ${ptActiveScopeLabel}.`
                  : 'Use this space for quick questions, working notes, and informal collaboration.'
                const ptComposerPlaceholder = ptActiveScopeLabel
                  ? `Add a note for ${ptActiveScopeLabel}...`
                  : 'Add to the discussion...'

                return (
                <div className="flex flex-col h-full">
                  {/* ── Discussion Header: Scope + Participants ── */}
                  <div className="px-4 pt-3 pb-2.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    {/* Scope Selector */}
                    {discussionPortfolios.length > 1 && (
                      <div className="mb-2">
                        <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Scope</div>
                        <div className="flex items-center gap-1 overflow-x-auto">
                          <button
                            onClick={() => { setDiscussionPortfolioFilter(null); setMessagePortfolioContext(null) }}
                            className={clsx(
                              'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                              discussionPortfolioFilter === null
                                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                            )}
                          >
                            <Globe className="h-3 w-3" />
                            All
                          </button>
                          {discussionPortfolios.map(p => (
                            <button
                              key={p.id}
                              onClick={() => { setDiscussionPortfolioFilter(p.id); setMessagePortfolioContext(p.id) }}
                              className={clsx(
                                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                                discussionPortfolioFilter === p.id
                                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                              )}
                            >
                              <Briefcase className="h-3 w-3" />
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Participants */}
                    {discussionParticipants.length > 0 && (
                      <div className="flex items-center gap-2 pt-1.5 border-t border-gray-100 dark:border-gray-700/50">
                        <div className="flex items-center -space-x-1.5">
                          {discussionParticipants.slice(0, 5).map(p => (
                            <div key={p.id} title={p.name} className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center ring-1 ring-white dark:ring-gray-800">
                              <span className="text-primary-700 dark:text-primary-300 text-[9px] font-medium">{p.initials}</span>
                            </div>
                          ))}
                          {discussionParticipants.length > 5 && (
                            <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center ring-1 ring-white dark:ring-gray-800">
                              <span className="text-gray-500 dark:text-gray-400 text-[9px] font-medium">+{discussionParticipants.length - 5}</span>
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          {discussionParticipants.map(p => p.name.split(' ')[0]).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ── Message List ── */}
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    {filteredDiscussionMessages.length > 0 ? (
                      <div className="space-y-0.5">
                        {filteredDiscussionMessages.map((message: any) => (
                          <div key={message.id} className="group flex gap-2.5 py-1.5 -mx-2 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <div className="w-6 h-6 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                              <span className="text-primary-700 dark:text-primary-300 text-[10px] font-medium">
                                {getUserInitials(message.user)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-gray-900 dark:text-white leading-none">
                                  {getUserDisplayName(message.user)}
                                </span>
                                {message.portfolio && discussionPortfolioFilter === null && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 leading-none">
                                    {message.portfolio.name}
                                  </span>
                                )}
                                <span className="text-[11px] text-gray-400 dark:text-gray-500 leading-none">
                                  {formatMessageTime(message.created_at)}
                                </span>
                                {message.is_pinned && <Pin className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />}
                              </div>
                              {message.reply_to && (
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
                                  <Reply className="h-2.5 w-2.5" />
                                  <span>replied</span>
                                </div>
                              )}
                              <div className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap leading-relaxed [&_a]:text-primary-600 [&_a]:underline">
                                <SmartInputRenderer content={message.content} />
                              </div>
                            </div>
                            <div className="flex items-start gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-0.5">
                              <button
                                onClick={() => { setReplyToMessage(message.id); discussionInputRef.current?.focus() }}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                title="Reply"
                              >
                                <Reply className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => navigator.clipboard.writeText(message.content)}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                title="Copy text"
                              >
                                <Copy className="h-3 w-3" />
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
                      <div className="flex flex-col items-center justify-center h-full text-center px-4">
                        <MessageCircle className="h-7 w-7 text-gray-300 dark:text-gray-600 mb-2" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{ptEmptyHeading}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-[260px] leading-relaxed">{ptEmptySubtext}</p>
                      </div>
                    )}
                  </div>

                  {/* ── Composer ── */}
                  <div className="px-3 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
                    {replyToMessage && replyToMessageData && (
                      <div className="mb-2 px-2 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 truncate">
                          <Reply className="h-3 w-3 flex-shrink-0" />
                          Replying to {getUserDisplayName(replyToMessageData.user)}
                        </div>
                        <button onClick={() => setReplyToMessage(null)} className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 ml-2 flex-shrink-0">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <UniversalSmartInput ref={discussionInputRef} value={discussionMessage} onChange={(value, metadata) => { setDiscussionMessage(value); setDiscussionMetadata(metadata) }} onKeyDown={handleDiscussionKeyDown} placeholder={ptComposerPlaceholder} textareaClassName="text-sm" rows={2} minHeight="60px" enableMentions={true} enableHashtags={true} enableTemplates={true} enableDataFunctions={true} enableAI={true} />
                      </div>
                      <button onClick={handleSendDiscussionMessage} disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending} className={clsx("self-end p-2 rounded-lg transition-colors", discussionMessage.trim() ? "bg-primary-600 text-white hover:bg-primary-700" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed")}><Send className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
                )
              })()}

              {/* Proposals Tab for Pair Trade - PM Review Mode */}
              {activeTab === 'decisions' && (() => {
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
                              <span className="text-xs text-gray-500">({allPortfolioProposals.length} recommendation{allPortfolioProposals.length !== 1 ? 's' : ''})</span>
                              <button
                                type="button"
                                onClick={() => {
                                  window.dispatchEvent(new CustomEvent('openTradeLab', {
                                    detail: { portfolioId }
                                  }))
                                  onClose()
                                }}
                                className="ml-auto flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                                title={`Open Trade Lab for ${portfolioName}`}
                              >
                                <FlaskConical className="h-3 w-3" />
                                Open Trade Lab
                              </button>
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

                                // Get proposer info. Pilot-seeded proposals always display as
                                // "Pilot" regardless of the synthetic author on the row.
                                const proposerName = isPilotSeedProposal(proposal)
                                  ? 'Pilot'
                                  : proposal.users?.first_name && proposal.users?.last_name
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
                                          <span className="text-gray-500 dark:text-gray-400">Net Exposure:</span>
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
                                          <span className="text-gray-500 dark:text-gray-400">Gross Exposure:</span>
                                          <span className={clsx(
                                            "font-semibold tabular-nums",
                                            hasSizingData ? "text-gray-700 dark:text-gray-200" : "text-gray-400"
                                          )}>
                                            {hasSizingData ? `${proposalGross.toFixed(2)}%` : '—'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-gray-500">
                                          <span>{proposalLegs.filter((l: any) => l.action === 'buy' || l.action === 'add').length} Long</span>
                                          <span>/</span>
                                          <span>{proposalLegs.filter((l: any) => l.action === 'sell' || l.action === 'reduce').length} Short</span>
                                        </div>
                                      </div>
                                    </button>

                            {/* Expanded Sizing Details (Edit Mode) */}
                            {isExpanded && (
                              <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-700/50 space-y-3">
                                {(() => {
                                  const legs = isEditing ? editedPairProposalLegs : proposalLegs
                                  const buyLegs = legs.filter((leg: any) => leg.action === 'buy' || leg.action === 'add')
                                  const sellLegs = legs.filter((leg: any) => leg.action === 'sell' || leg.action === 'reduce')
                                  const sizingModeLabels: Record<string, string> = { absolute: 'Abs', add_reduce: '+/−', active: 'vs Bench' }
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
                                    const benchmarkWeight: number | null = (holding as any)?.benchmarkWeight ?? null
                                    const effectiveBench = benchmarkWeight ?? 0 // treat missing benchmark as 0 for calculations
                                    const targetWeight = leg.weight
                                    const tradeSize = targetWeight != null ? targetWeight - currentWeight : null
                                    const activeWeight = targetWeight != null ? targetWeight - effectiveBench : null

                                    // Per-leg sizing mode
                                    const legMode: string = isEditing ? (leg.sizingMode || 'absolute') : (leg.sizingMode || 'absolute')
                                    const sizingInputKey = `sizing-${portfolioId}-${legIdx}`

                                    // Display value for the editable input based on THIS leg's mode
                                    const getDisplayValue = (): string => {
                                      const stored = pairProposalSourceFields[sizingInputKey]
                                      if (stored) return stored
                                      if (targetWeight == null) return ''
                                      if (legMode === 'absolute') return targetWeight.toFixed(2)
                                      if (legMode === 'add_reduce') return tradeSize != null ? (tradeSize >= 0 ? `+${tradeSize.toFixed(2)}` : tradeSize.toFixed(2)) : ''
                                      if (legMode === 'active') return activeWeight != null ? (activeWeight >= 0 ? `+${activeWeight.toFixed(2)}` : activeWeight.toFixed(2)) : ''
                                      return targetWeight.toFixed(2)
                                    }
                                    const rawInput = getDisplayValue()

                                    // Handle per-leg mode change
                                    const handleModeChange = (newMode: string) => {
                                      // Clear raw input for this leg
                                      setPairProposalSourceFields(prev => { const next = { ...prev }; delete next[sizingInputKey]; return next })
                                      setEditedPairProposalLegs(prev => prev.map((l, i) => i === legIdx ? { ...l, sizingMode: newMode } : l))
                                    }

                                    // Handle input change — interpret based on this leg's mode
                                    const handleInput = (value: string) => {
                                      setPairProposalSourceFields(prev => ({ ...prev, [sizingInputKey]: value }))
                                      const trimmed = value.trim()
                                      if (!trimmed) {
                                        setEditedPairProposalLegs(prev => prev.map((l, i) => i === legIdx ? { ...l, weight: null } : l))
                                        return
                                      }
                                      let numStr = trimmed
                                      let mult = 1
                                      if (numStr.endsWith('bp')) { numStr = numStr.slice(0, -2); mult = 0.01 }
                                      else if (numStr.endsWith('%')) { numStr = numStr.slice(0, -1) }
                                      const num = parseFloat(numStr)
                                      if (isNaN(num)) return
                                      const val = num * mult
                                      let newTarget: number | null = null
                                      if (legMode === 'absolute') newTarget = val
                                      else if (legMode === 'add_reduce') newTarget = currentWeight + val
                                      else if (legMode === 'active') newTarget = effectiveBench + val
                                      setEditedPairProposalLegs(prev => prev.map((l, i) => i === legIdx ? { ...l, weight: newTarget } : l))
                                    }

                                    // Placeholder based on mode
                                    const placeholder = legMode === 'absolute' ? '1.00' : legMode === 'add_reduce' ? '+0.50' : '+1.00'

                                    return (
                                      <tr key={idx} className={clsx("border-b last:border-0", isBuy ? "border-green-100 dark:border-green-800/20" : "border-red-100 dark:border-red-800/20")}>
                                        {/* Asset */}
                                        <td className="py-2 px-2">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-semibold text-gray-900 dark:text-white">{leg.symbol}</span>
                                            {companyName && <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[80px]">{companyName}</span>}
                                          </div>
                                        </td>
                                        {/* Bench */}
                                        <td className="text-right py-2 px-1.5 tabular-nums text-xs text-gray-400 dark:text-gray-500">
                                          {benchmarkWeight != null ? `${benchmarkWeight.toFixed(2)}%` : '—'}
                                        </td>
                                        {/* Current */}
                                        <td className="text-right py-2 px-1.5 tabular-nums text-xs text-gray-600 dark:text-gray-300">
                                          {currentWeight.toFixed(2)}%
                                        </td>
                                        {/* Mode + Input (the user-entered field) */}
                                        <td className="py-1 px-1.5 bg-primary-50/30 dark:bg-primary-900/10">
                                          {isEditing ? (
                                            <div className="flex items-center gap-1">
                                              <select
                                                value={legMode}
                                                onChange={(e) => handleModeChange(e.target.value)}
                                                className="h-7 text-[10px] font-medium px-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 focus:ring-1 focus:ring-primary-500"
                                              >
                                                <option value="absolute">Abs</option>
                                                <option value="add_reduce">+/−</option>
                                                <option value="active">vs Bench</option>
                                              </select>
                                              <input
                                                type="text"
                                                className="w-16 h-7 px-1.5 text-xs text-right border rounded bg-white dark:bg-gray-700 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-semibold border-primary-300 dark:border-primary-600 text-primary-700 dark:text-primary-300"
                                                value={rawInput}
                                                onChange={(e) => handleInput(e.target.value)}
                                                placeholder={placeholder}
                                              />
                                            </div>
                                          ) : (
                                            <div className="flex items-center justify-end gap-1.5">
                                              <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700/60 px-1 py-0.5 rounded">{sizingModeLabels[legMode] || 'Abs'}</span>
                                              <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 tabular-nums">
                                                {leg.enteredValue ? `${leg.enteredValue}%` : (targetWeight != null ? `${targetWeight.toFixed(2)}%` : '—')}
                                              </span>
                                            </div>
                                          )}
                                        </td>
                                        {/* Target (always derived/displayed) */}
                                        <td className="text-right py-2 px-1.5 tabular-nums">
                                          <span className="text-xs font-semibold text-gray-900 dark:text-white">
                                            {targetWeight != null ? `${targetWeight.toFixed(2)}%` : '—'}
                                          </span>
                                        </td>
                                        {/* Active */}
                                        <td className="text-right py-2 px-1.5 tabular-nums">
                                          <span className={clsx("text-xs",
                                            activeWeight != null && activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                            activeWeight != null && activeWeight < 0 ? "text-red-600 dark:text-red-400" :
                                            "text-gray-400"
                                          )}>
                                            {activeWeight != null ? formatDelta(activeWeight) : '—'}
                                          </span>
                                        </td>
                                        {/* Trade */}
                                        <td className="text-right py-2 px-1.5 tabular-nums">
                                          <span className={clsx("text-xs font-medium",
                                            tradeSize != null && tradeSize > 0 ? "text-green-600 dark:text-green-400" :
                                            tradeSize != null && tradeSize < 0 ? "text-red-600 dark:text-red-400" :
                                            "text-gray-400"
                                          )}>
                                            {formatDelta(tradeSize)}
                                          </span>
                                        </td>
                                      </tr>
                                    )
                                  }

                                  const renderTableHeaders = (borderColor: string, bgColor: string) => (
                                    <tr className={clsx("border-b", borderColor, bgColor)}>
                                      <th className="text-left py-1.5 px-2 font-medium text-gray-600 dark:text-gray-400">Asset</th>
                                      <th className="text-right py-1.5 px-1.5 font-medium text-gray-400 dark:text-gray-500">Bench</th>
                                      <th className="text-right py-1.5 px-1.5 font-medium text-gray-400 dark:text-gray-500">Current</th>
                                      <th className="text-center py-1.5 px-1.5 font-medium text-primary-600 dark:text-primary-400">{isEditing ? 'Sizing' : 'Entered'}</th>
                                      <th className="text-right py-1.5 px-1.5 font-medium text-gray-600 dark:text-gray-400">Target</th>
                                      <th className="text-right py-1.5 px-1.5 font-medium text-gray-400 dark:text-gray-500">Active</th>
                                      <th className="text-right py-1.5 px-1.5 font-medium text-gray-400 dark:text-gray-500">Trade</th>
                                    </tr>
                                  )

                                  return (
                                    <div className="space-y-3">
                                      {/* BUYS */}
                                      {buyLegs.length > 0 && (
                                        <div>
                                          <div className="flex items-center gap-2 mb-1">
                                            <div className="w-1 h-3 bg-green-500 rounded-full"></div>
                                            <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">Buys</span>
                                          </div>
                                          <div className="bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-800/30 overflow-hidden overflow-x-auto">
                                            <table className="w-full text-xs">
                                              <thead>{renderTableHeaders("border-green-200 dark:border-green-800/30", "bg-green-100/50 dark:bg-green-900/20")}</thead>
                                              <tbody>{buyLegs.map((leg: any, idx: number) => renderLegRow(leg, idx, true))}</tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}

                                      {/* SELLS */}
                                      {sellLegs.length > 0 && (
                                        <div>
                                          <div className="flex items-center gap-2 mb-1">
                                            <div className="w-1 h-3 bg-red-500 rounded-full"></div>
                                            <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">Sells</span>
                                          </div>
                                          <div className="bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800/30 overflow-hidden overflow-x-auto">
                                            <table className="w-full text-xs">
                                              <thead>{renderTableHeaders("border-red-200 dark:border-red-800/30", "bg-red-100/50 dark:bg-red-900/20")}</thead>
                                              <tbody>{sellLegs.map((leg: any, idx: number) => renderLegRow(leg, idx, false))}</tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })()}

                                {/* Rationale (notes) — the analyst's reasoning
                                    for this recommendation. Was missing from the
                                    pair decisions tab; now matches the singleton
                                    proposal display style. */}
                                {proposal.notes && (
                                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">Rationale</div>
                                    <div className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{proposal.notes}</div>
                                  </div>
                                )}

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
                                                // Build per-leg entered values based on each leg's own sizing mode
                                                const legsWithInput = editedPairProposalLegs.map((leg, li) => {
                                                  const pairLeg = pairLegs[li] || pairLegs.find((pl: any) => pl.assets?.symbol === leg.symbol)
                                                  const assetId = leg.assetId || pairLeg?.asset_id
                                                  const holding = pairTradePortfolioHoldings?.[proposal.portfolio_id]?.[assetId]
                                                  const currentWeight = holding?.weight || 0
                                                  const effectiveBench = (holding as any)?.benchmarkWeight ?? 0
                                                  const legMode = leg.sizingMode || 'absolute'
                                                  let enteredValue = ''
                                                  if (leg.weight != null) {
                                                    if (legMode === 'absolute') enteredValue = leg.weight.toFixed(2)
                                                    else if (legMode === 'add_reduce') { const d = leg.weight - currentWeight; enteredValue = `${d >= 0 ? '+' : ''}${d.toFixed(2)}` }
                                                    else if (legMode === 'active') { const a = leg.weight - effectiveBench; enteredValue = `${a >= 0 ? '+' : ''}${a.toFixed(2)}` }
                                                  }
                                                  return {
                                                    assetId: leg.assetId,
                                                    symbol: leg.symbol,
                                                    action: leg.action,
                                                    weight: leg.weight,
                                                    sizingMode: legMode,
                                                    enteredValue,
                                                  }
                                                })
                                                // Use first leg's mode as top-level (for backward compat), but each leg has its own
                                                const topLevelMode = legsWithInput[0]?.sizingMode || 'absolute'
                                                await submitRecommendation({
                                                  tradeQueueItemId: proposal.trade_queue_item_id,
                                                  portfolioId: proposal.portfolio_id,
                                                  weight: null,
                                                  shares: null,
                                                  sizingMode: topLevelMode as TradeSizingMode,
                                                  sizingContext: {
                                                    isPairTrade: true,
                                                    sizingMode: topLevelMode,
                                                    legs: legsWithInput,
                                                  },
                                                  notes: proposal.notes,
                                                  requestedAction: proposal.trade_queue_items?.action || null,
                                                  assetSymbol: proposal.trade_queue_items?.assets?.symbol || null,
                                                  assetCompanyName: proposal.trade_queue_items?.assets?.company_name || null,
                                                }, context)
                                                refetchProposals()
                                                queryClient.invalidateQueries({ queryKey: ['decision-requests'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
                                                invalidateActivityCaches()
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
                                              setPairProposalSourceFields({})
                                              setEditingPairProposalId(proposal.id)
                                              setEditedPairProposalLegs(proposalLegs.map((leg: any) => ({
                                                assetId: leg.assetId,
                                                symbol: leg.symbol,
                                                action: leg.action,
                                                weight: leg.weight,
                                                sizingMode: leg.sizingMode || 'absolute',
                                              })))
                                            }}
                                          >
                                            <Pencil className="h-3.5 w-3.5 mr-1" />
                                            Edit
                                          </Button>
                                          {confirmWithdrawId !== proposal.id ? (
                                            <Button size="sm" variant="secondary"
                                              className="hover:!text-red-600 hover:!border-red-400 hover:!bg-red-50 dark:hover:!text-red-400 dark:hover:!border-red-600 dark:hover:!bg-red-900/20"
                                              onClick={() => setConfirmWithdrawId(proposal.id)}
                                            >
                                              <XCircle className="h-3.5 w-3.5 mr-1" />
                                              Withdraw
                                            </Button>
                                          ) : (
                                            <div className="w-full mt-2 rounded border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10 p-2">
                                              <p className="text-xs font-medium text-red-800 dark:text-red-300 mb-1">Withdraw this recommendation?</p>
                                              <p className="text-[11px] text-red-600 dark:text-red-400 mb-2">Your recommendation will be removed and recorded in the activity history.</p>
                                              <div className="flex items-center gap-2">
                                                <button type="button" onClick={async () => {
                                                  setConfirmWithdrawId(null)
                                                  const { data: activeReqs } = await supabase.from('decision_requests').select('id').eq('proposal_id', proposal.id).in('status', ['pending', 'under_review', 'needs_discussion'])
                                                  if (activeReqs?.length) await Promise.all(activeReqs.map((r: any) => supabase.from('decision_requests').update({ status: 'withdrawn', reviewed_at: new Date().toISOString(), reviewed_by: user?.id }).eq('id', r.id)))
                                                  const { error } = await supabase.from('trade_proposals').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', proposal.id).eq('user_id', user?.id)
                                                  if (!error) {
                                                    await supabase.from('trade_events').insert({ trade_queue_item_id: proposal.trade_queue_item_id, event_type: 'proposal_withdrawn', actor_id: user?.id, proposal_id: proposal.id, metadata: { portfolio_id: proposal.portfolio_id, portfolio_name: proposal.portfolio?.name || null, weight: proposal.weight != null ? Number(proposal.weight) : null, is_pair_trade: true } })
                                                    refetchProposals(); queryClient.invalidateQueries({ queryKey: ['trade-proposals-rejected'] }); queryClient.invalidateQueries({ queryKey: ['trade-events'] }); queryClient.invalidateQueries({ queryKey: ['decision-requests'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals'] }); invalidateActivityCaches()
                                                  }
                                                }} className="px-3 py-1 text-[11px] font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors">Confirm Withdraw</button>
                                                <button type="button" onClick={() => setConfirmWithdrawId(null)} className="text-[11px] text-gray-500 hover:text-gray-700">Cancel</button>
                                              </div>
                                            </div>
                                          )}
                                        </>
                                      )
                                    )}
                                  </div>

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

                      {/* Submit New Recommendation for Pair Trade */}
                      {(() => {
                        // Check if current user already has a proposal for any portfolio
                        const userHasProposal = proposals.some(p => p.user_id === user?.id && p.is_active)
                        if (userHasProposal) return null

                        // Build available portfolios from all sources
                        const availablePortfolios: Array<{ id: string; name: string }> = []
                        const seenIds = new Set<string>()

                        // From discussion portfolios (lab links + fallback)
                        for (const p of discussionPortfolios) {
                          if (!seenIds.has(p.id)) { availablePortfolios.push(p); seenIds.add(p.id) }
                        }

                        // From pair trade's direct portfolio
                        if (pairTradePortfolioId && !seenIds.has(pairTradePortfolioId)) {
                          const name = pairTradeData?.portfolios?.name || 'Portfolio'
                          availablePortfolios.push({ id: pairTradePortfolioId, name })
                          seenIds.add(pairTradePortfolioId)
                        }

                        // From individual legs' portfolios
                        for (const leg of pairLegs) {
                          const pid = (leg as any).portfolio_id
                          const pname = (leg as any).portfolios?.name
                          if (pid && !seenIds.has(pid)) { availablePortfolios.push({ id: pid, name: pname || 'Portfolio' }); seenIds.add(pid) }
                        }

                        if (availablePortfolios.length === 0) return null

                        return (
                          <div className="p-4">
                            {!showNewPairRec ? (
                              <div className="text-center">
                                {proposals.length === 0 && (
                                  <div className="py-4 text-gray-500 dark:text-gray-400 mb-3">
                                    <Scale className="h-10 w-10 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm font-medium">No recommendations yet</p>
                                  </div>
                                )}
                                {availablePortfolios.length > 0 && (
                                  <button
                                    onClick={() => {
                                      const portfolioId = availablePortfolios[0].id
                                      setNewPairRecPortfolioId(portfolioId)
                                      setNewPairRecLegs(pairLegs.map((leg: any) => ({
                                        assetId: leg.asset_id || leg.assets?.id || '',
                                        symbol: leg.assets?.symbol || '?',
                                        action: leg.action || (leg.pair_leg_type === 'long' ? 'buy' : 'sell'),
                                        weight: '',
                                      })))
                                      setNewPairRecNotes('')
                                      setShowNewPairRec(true)
                                    }}
                                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                                  >
                                    <Plus className="h-4 w-4" />
                                    Submit Recommendation
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">New Recommendation</h4>
                                  <button
                                    onClick={() => setShowNewPairRec(false)}
                                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>

                                {/* Portfolio selector (if multiple) */}
                                {availablePortfolios.length > 1 && (
                                  <div>
                                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Portfolio</label>
                                    <select
                                      value={newPairRecPortfolioId}
                                      onChange={e => setNewPairRecPortfolioId(e.target.value)}
                                      className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-2 py-1.5"
                                    >
                                      {availablePortfolios.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                                {availablePortfolios.length === 1 && (
                                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                    <Briefcase className="h-3.5 w-3.5" />
                                    <span className="font-medium">{availablePortfolios[0].name}</span>
                                  </div>
                                )}

                                {/* Per-leg weight inputs */}
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Target weight per leg</label>
                                  {newPairRecLegs.map((leg, idx) => {
                                    const isLong = leg.action === 'buy' || leg.action === 'add'
                                    return (
                                      <div key={idx} className="flex items-center gap-2">
                                        <span className={clsx('text-[10px] font-bold uppercase w-8', isLong ? 'text-green-600' : 'text-red-600')}>
                                          {isLong ? 'BUY' : 'SELL'}
                                        </span>
                                        <span className="text-sm font-medium text-gray-900 dark:text-white w-14">{leg.symbol}</span>
                                        <input
                                          type="text"
                                          value={leg.weight}
                                          onChange={e => {
                                            const updated = [...newPairRecLegs]
                                            updated[idx] = { ...updated[idx], weight: e.target.value }
                                            setNewPairRecLegs(updated)
                                          }}
                                          placeholder="e.g. 2.5"
                                          className="flex-1 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 tabular-nums"
                                        />
                                        <span className="text-xs text-gray-400">%</span>
                                      </div>
                                    )
                                  })}
                                </div>

                                {/* Notes */}
                                <div>
                                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Rationale</label>
                                  <textarea
                                    value={newPairRecNotes}
                                    onChange={e => setNewPairRecNotes(e.target.value)}
                                    placeholder="Rationale for this recommendation..."
                                    rows={2}
                                    className="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-none"
                                  />
                                </div>

                                {/* Submit / Cancel */}
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    disabled={isSavingPairProposal || newPairRecLegs.every(l => !l.weight.trim())}
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
                                        const legsPayload = newPairRecLegs.map(leg => ({
                                          assetId: leg.assetId,
                                          symbol: leg.symbol,
                                          action: leg.action,
                                          weight: leg.weight.trim() ? parseFloat(leg.weight) : null,
                                          sizingMode: 'absolute',
                                          enteredValue: leg.weight.trim(),
                                        }))
                                        const firstLegId = pairTradeLegIds[0]
                                        // submitRecommendation signature is (input, context, options?) —
                                        // context must be the second positional arg, not nested inside input.
                                        await submitRecommendation(
                                          {
                                            tradeQueueItemId: firstLegId,
                                            portfolioId: newPairRecPortfolioId,
                                            weight: null,
                                            shares: null,
                                            sizingMode: 'absolute' as TradeSizingMode,
                                            sizingContext: {
                                              isPairTrade: true,
                                              sizingMode: 'absolute',
                                              legs: legsPayload,
                                            },
                                            notes: newPairRecNotes || null,
                                          },
                                          context,
                                        )
                                        setShowNewPairRec(false)
                                        setNewPairRecLegs([])
                                        setNewPairRecNotes('')
                                        refetchProposals()
                                        queryClient.invalidateQueries({ queryKey: ['decision-requests'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
                                        queryClient.invalidateQueries({ queryKey: ['trade-events'] })
                                      } catch (e) {
                                        console.error('[Submit pair recommendation] failed:', e)
                                      } finally {
                                        setIsSavingPairProposal(false)
                                      }
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                                  >
                                    {isSavingPairProposal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                    Submit
                                  </button>
                                  <button
                                    onClick={() => setShowNewPairRec(false)}
                                    className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}

                    </div>
                  </div>
                )
              })()}

              {/* Debate Tab for Pair Trade */}
              {activeTab === 'debate' && pairTradeLegIds.length > 0 && (
                <div className="p-4">
                  <ThesesDebatePanel
                    tradeIdeaId={pairTradeLegIds[0]}
                    readOnly={false}
                    linkedPortfolios={discussionPortfolios}
                    openComposer={debateComposerTrigger}
                    defaultDirection={defaultThesisDirection}
                    defaultRationale={defaultThesisRationale}
                    onComposerConsumed={() => { setDebateComposerTrigger(null); setDefaultThesisRationale(undefined) }}
                  />
                </div>
              )}

              {/* Activity Tab for Pair Trade */}
              {activeTab === 'activity' && (() => {
                const createdAt = new Date(pairTradeData.created_at)
                const now = new Date()
                const daysSinceCreation = Math.max(1, Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)))

                const participants = new Map<string, { name: string; roles: Set<string>; avatar: string }>()
                const addParticipant = (id: string, userData: any, role: string) => {
                  if (!userData || !id) return
                  const existing = participants.get(id)
                  if (existing) {
                    existing.roles.add(role)
                  } else {
                    participants.set(id, {
                      name: getUserDisplayName(userData),
                      roles: new Set([role]),
                      avatar: getUserInitials(userData),
                    })
                  }
                }

                // Creator — pilot-seeded trades surface as "Pilot" rather than
                // the synthetic admin the seeding RPC happened to pick.
                if (isPilotSeedTrade(pairTradeData)) {
                  addParticipant('pilot', { first_name: 'Pilot', last_name: '' } as any, 'Creator')
                } else if (pairTradeData.users) {
                  addParticipant(pairTradeData.created_by || 'creator', pairTradeData.users, 'Creator')
                }
                // Assignee
                if ((pairTradeData as any).assigned_user) addParticipant((pairTradeData as any).assigned_to, (pairTradeData as any).assigned_user, 'Assignee')
                // Recommenders — same pilot-seed treatment.
                const proposalsData = proposals || []
                proposalsData.forEach((p: any) => {
                  if (isPilotSeedProposal(p)) {
                    addParticipant('pilot', { first_name: 'Pilot', last_name: '' } as any, 'Recommender')
                    return
                  }
                  const proposerData = p.users || p.user
                  if (proposerData) addParticipant(p.user_id, proposerData, 'Recommender')
                })

                const sortedProposals = [...proposalsData].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                const firstRecommendation = sortedProposals[0]
                const lastRecommendation = sortedProposals[sortedProposals.length - 1]

                return (
                  <div className="p-3 space-y-4">
                    {/* Summary Metrics */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-center">
                        <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{daysSinceCreation}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Days Active</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-center">
                        <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{proposalsData.length}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Recommendations</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-center">
                        <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{labLinks.length}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Portfolios</div>
                      </div>
                    </div>

                    {/* Key Dates */}
                    {(() => {
                      const dates: { label: string; date: Date }[] = [
                        { label: 'Created', date: createdAt },
                      ]
                      if (firstRecommendation) {
                        dates.push({ label: 'First Rec', date: new Date(firstRecommendation.created_at) })
                      }
                      if (lastRecommendation && lastRecommendation !== firstRecommendation) {
                        dates.push({ label: 'Last Rec', date: new Date(lastRecommendation.created_at) })
                      }
                      if (pairTradeData.decided_at) {
                        dates.push({ label: 'Decision', date: new Date(pairTradeData.decided_at) })
                      }
                      if (pairTradeData.updated_at && pairTradeData.updated_at !== pairTradeData.created_at) {
                        dates.push({ label: 'Updated', date: new Date(pairTradeData.updated_at) })
                      }
                      return (
                        <div className="flex flex-wrap gap-2">
                          {dates.map((d, idx) => (
                            <div key={idx} className="bg-gray-50 dark:bg-gray-800 rounded-lg px-2.5 py-1.5 min-w-0">
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none mb-0.5">{d.label}</div>
                              <div className="text-xs font-medium text-gray-900 dark:text-white whitespace-nowrap">{format(d.date, 'MMM d, yyyy')}</div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}

                    {/* Participants */}
                    {participants.size > 0 && (
                      <div>
                        <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                          Participants · {participants.size}
                        </h4>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {Array.from(participants.values()).map((p, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[9px] font-semibold text-gray-600 dark:text-gray-300 flex-shrink-0">
                                {p.avatar}
                              </div>
                              <span className="text-xs text-gray-900 dark:text-white">{p.name}</span>
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">{Array.from(p.roles).join(', ')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Timeline */}
                    <div>
                      <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Timeline</h4>
                      <EntityTimeline
                        entityType="pair_trade"
                        entityId={tradeId}
                        showHeader={false}
                        collapsible={false}
                        excludeActions={['attach', 'detach']}
                        maxItems={25}
                        groupByDate={true}
                        tradeEvents={tradeEventsData}
                      />
                    </div>
                  </div>
                )
              })()}
            </>
          ) : trade ? (
            <>
              {/* Debate & Research Tab */}
              {activeTab === 'debate' && (
                <div className="p-4 space-y-4">
                  <ThesesDebatePanel
                    tradeIdeaId={tradeId}
                    assetId={trade?.asset_id}
                    ideaLabel={trade ? `${trade.action?.toUpperCase()} ${trade.assets?.symbol || ''}`.trim() : undefined}
                    assetSymbols={trade?.assets?.symbol ? [trade.assets.symbol] : []}
                    readOnly={false}
                    onCloseModal={onClose}
                    linkedPortfolios={labLinks
                      .map(l => l.trade_lab?.portfolio)
                      .filter((p): p is { id: string; name: string } => !!p?.id && !!p?.name)}
                    openComposer={debateComposerTrigger}
                    defaultDirection={defaultThesisDirection}
                    defaultRationale={defaultThesisRationale}
                    onComposerConsumed={() => { setDebateComposerTrigger(null); setDefaultThesisRationale(undefined) }}
                  />
                  <LinkedResearchSection
                    ideaId={tradeId}
                    assetId={trade?.asset_id}
                    ideaContext={trade ? {
                      label: `${trade.action?.toUpperCase()} ${trade.assets?.symbol || ''}`.trim(),
                      portfolioName: labLinks[0]?.trade_lab?.portfolio?.name,
                      creatorName: trade.users ? getUserDisplayName(trade.users) : undefined,
                      createdAt: trade.created_at,
                      assetSymbols: trade.assets?.symbol ? [trade.assets.symbol] : [],
                    } : undefined}
                    theses={allThesesForResearch}
                    onCloseModal={onClose}
                  />
                </div>
              )}

              {/* Single Trade Details Tab */}
              {activeTab === 'details' && (
                <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
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

                  {/* ========== STAGE JOURNEY ========== */}
                  {(() => {
                    const stageOrder = ['aware', 'investigate', 'deep_research', 'thesis_forming', 'ready_for_decision'] as const
                    const stageLabels: Record<string, string> = { aware: 'Aware', investigate: 'Investigate', deep_research: 'Deep Research', thesis_forming: 'Thesis Forming', ready_for_decision: 'Ready' }
                    const legacyMap: Record<string, number> = { idea: 0, discussing: 1, working_on: 1, simulating: 2, modeling: 2, deciding: 4, approved: 4 }
                    const currentStageIndex = stageOrder.indexOf(trade.stage as any) >= 0
                      ? stageOrder.indexOf(trade.stage as any)
                      : (legacyMap[trade.stage] ?? legacyMap[trade.status] ?? 0)
                    const isTerminal = trade.status === 'approved' || trade.status === 'cancelled' || trade.status === 'rejected' || trade.status === 'archived' || trade.status === 'deleted'
                    const currentStageLabel = stageLabels[stageOrder[currentStageIndex]] || 'Aware'
                    const stageAge = (() => {
                      const ref = trade.stage_changed_at || trade.updated_at || trade.created_at
                      const diffMs = Date.now() - new Date(ref).getTime()
                      const diffHours = Math.floor(diffMs / 3600000)
                      const diffDays = Math.floor(diffHours / 24)
                      const diffWeeks = Math.floor(diffDays / 7)
                      if (diffHours < 1) return '<1h'
                      if (diffHours < 24) return `${diffHours}h`
                      if (diffDays < 14) return `${diffDays}d`
                      return `${diffWeeks}w`
                    })()
                    return (
                      <div className="pb-3 border-b border-gray-200 dark:border-gray-700 space-y-1.5">
                        <div className="flex items-stretch gap-0.5">
                          {stageOrder.map((stage, index) => {
                            const isCompleted = index < currentStageIndex
                            const isCurrent = index === currentStageIndex
                            const isFuture = index > currentStageIndex
                            const canClick = canMoveStages && !isTerminal && !isCurrent && index !== currentStageIndex
                            return (
                              <button
                                key={stage}
                                type="button"
                                disabled={!canClick}
                                onClick={() => canClick && setPendingStageMove(stage)}
                                className={clsx(
                                  "flex-1 py-1.5 text-[11px] font-medium rounded transition-all text-center leading-tight",
                                  isCompleted && "bg-green-500 text-white",
                                  isCurrent && "bg-primary-500 text-white ring-2 ring-primary-300 dark:ring-primary-700",
                                  isFuture && "bg-gray-100 dark:bg-gray-700/60 text-gray-400 dark:text-gray-500",
                                  canClick && isFuture && "hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer",
                                  canClick && isCompleted && "hover:bg-green-600 cursor-pointer",
                                  !canClick && "cursor-default"
                                )}
                              >
                                {stageLabels[stage]}
                              </button>
                            )
                          })}
                        </div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500">
                          In stage for {stageAge}
                        </div>
                        {pendingStageMove && (
                          <div className="flex items-center justify-between bg-primary-50 dark:bg-primary-900/20 rounded-lg px-3 py-2">
                            <span className="text-xs text-primary-700 dark:text-primary-300">
                              {stageOrder.indexOf(pendingStageMove as any) < currentStageIndex ? 'Move back' : 'Move forward'} to <span className="font-semibold">{stageLabels[pendingStageMove]}</span>?
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setPendingStageMove(null)}
                                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  updateStatusMutation.mutate(pendingStageMove as any)
                                  setPendingStageMove(null)
                                }}
                                disabled={updateStatusMutation.isPending}
                                className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                              >
                                {updateStatusMutation.isPending ? 'Moving...' : 'Confirm'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* ========== CONTEXT / TAGS ========== */}
                  <div className="pb-2.5 border-b border-gray-100 dark:border-gray-700/50">
                    {isEditingTags ? (
                      <div>
                        <ContextTagsInput
                          value={editedTags}
                          onChange={setEditedTags}
                          placeholder="Search assets, portfolios, themes..."
                          maxTags={10}
                          autoFocus
                        />
                        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                          <button onClick={cancelEditTags} disabled={isUpdating} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
                          <button onClick={saveTags} disabled={isUpdating} className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium">{isUpdating ? 'Saving...' : 'Save'}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {((trade as any)?.context_tags || []).length > 0 ? (
                          <>
                            {((trade as any).context_tags as ContextTag[]).map((tag, idx) => (
                              <span
                                key={`${tag.entity_type}-${tag.entity_id}-${idx}`}
                                className={clsx(
                                  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium",
                                  tag.entity_type === 'asset' && "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
                                  tag.entity_type === 'portfolio' && "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300",
                                  tag.entity_type === 'theme' && "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
                                  tag.entity_type === 'asset_list' && "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300",
                                  tag.entity_type === 'trade_lab' && "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"
                                )}
                              >
                                <span className="opacity-40 text-[9px] uppercase">{tag.entity_type === 'asset_list' ? 'list' : tag.entity_type === 'trade_lab' ? 'lab' : tag.entity_type}</span>
                                {tag.display_name}
                              </span>
                            ))}
                            {isOwner && (
                              <button
                                onClick={startEditTags}
                                className="inline-flex items-center justify-center h-5 w-5 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-xs"
                              >
                                +
                              </button>
                            )}
                          </>
                        ) : isOwner ? (
                          <button
                            onClick={startEditTags}
                            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          >
                            <Tag className="h-3 w-3" />
                            + Add context tags
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {/* ========== WHY NOW? SECTION (was Rationale) ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Why Now?</h3>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">Why is this trade idea worth investigating now? What changed or what is the catalyst?</span>
                    </div>
                    {isEditingRationale ? (
                      <>
                        <textarea
                          autoFocus
                          value={editedRationale}
                          onChange={(e) => {
                            setEditedRationale(e.target.value.slice(0, 300))
                            e.target.style.height = 'auto'
                            e.target.style.height = e.target.scrollHeight + 'px'
                          }}
                          ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                          placeholder="Why is this trade idea worth investigating now?"
                          rows={1}
                          maxLength={300}
                          className="w-full p-0 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 resize-none border-none focus:ring-0 focus:outline-none leading-relaxed overflow-hidden"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') cancelEditRationale()
                          }}
                        />
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
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
                          <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{editedRationale.length}/300</span>
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
                            + Add catalyst or reason
                          </button>
                        ) : (
                          <p className="text-sm text-gray-400 italic">No catalyst noted</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ========== ARGUMENTS ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Arguments</h3>
                      <button
                        onClick={() => setActiveTab('debate')}
                        className="text-[11px] text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 font-medium transition-colors"
                      >
                        {totalTheses > 0 ? 'View debate →' : '+ Add argument'}
                      </button>
                    </div>
                    {totalTheses > 0 ? (
                      <div className="flex items-center gap-2 mt-1 text-[11px]">
                        <span className="font-medium text-green-600 dark:text-green-400">{thesisCounts?.bull ?? 0} bull</span>
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <span className="font-medium text-red-600 dark:text-red-400">{thesisCounts?.bear ?? 0} bear</span>
                        {(thesisCounts?.context ?? 0) > 0 && (
                          <>
                            <span className="text-gray-300 dark:text-gray-600">·</span>
                            <span className="text-gray-400">{thesisCounts?.context} context</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">No arguments yet</p>
                    )}
                  </div>

                  {/* ========== TRADE THESIS (unlocked at thesis_forming stage) ========== */}
                  {(() => {
                    const thesisStages = ['thesis_forming', 'ready_for_decision', 'deciding']
                    const showThesis = thesisStages.includes(trade.stage) || thesisStages.includes(trade.status)
                    if (!showThesis) return null
                    return (
                      <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-baseline gap-2 mb-1.5">
                          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Trade Thesis</h3>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">Your structured reasoning for why this trade should work.</span>
                        </div>
                        {isEditingThesis ? (
                          <>
                            <textarea
                              autoFocus
                              value={editedThesis}
                              onChange={(e) => {
                                setEditedThesis(e.target.value.slice(0, 300))
                                e.target.style.height = 'auto'
                                e.target.style.height = e.target.scrollHeight + 'px'
                              }}
                              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                              placeholder="Explain why this trade should work."
                              rows={1}
                              maxLength={300}
                              className="w-full p-0 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 resize-none border-none focus:ring-0 focus:outline-none leading-relaxed overflow-hidden"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') cancelEditThesis()
                              }}
                            />
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                              <button
                                onClick={cancelEditThesis}
                                disabled={isUpdating}
                                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={saveThesis}
                                disabled={isUpdating}
                                className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                              >
                                {isUpdating ? 'Saving...' : 'Save'}
                              </button>
                              <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{editedThesis.length}/300</span>
                            </div>
                          </>
                        ) : (
                          <div className="group">
                            {(trade as any).thesis_text ? (
                              <div className="flex gap-2">
                                <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                                  {(trade as any).thesis_text}
                                </p>
                                {isOwner && (
                                  <button
                                    onClick={startEditThesis}
                                    className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            ) : isOwner ? (
                              <button
                                onClick={startEditThesis}
                                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                              >
                                + Write trade thesis
                              </button>
                            ) : (
                              <p className="text-sm text-gray-400 italic">No trade thesis written yet</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* ========== REFERENCE LEVELS ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div
                      className="flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => setIsSizingExpanded(!isSizingExpanded)}
                    >
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {isSizingExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Target className="h-3.5 w-3.5" />
                        Reference Levels
                      </div>
                      {isOwner && !isEditingSizing && isSizingExpanded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditSizing() }}
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {isSizingExpanded && (
                      <div className="mt-3">
                        {isEditingSizing ? (
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
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
                            <div className="flex-1">
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
                            <div className="flex-1">
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
                            <Button size="sm" variant="ghost" onClick={cancelEditSizing} disabled={isUpdating} className="h-8">
                              Cancel
                            </Button>
                            <Button size="sm" onClick={saveSizing} disabled={isUpdating} loading={isUpdating} className="h-8">
                              <Save className="h-3.5 w-3.5 mr-1" />
                              Save
                            </Button>
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

                  {/* ========== CONVICTION & TIME HORIZON ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div
                      className="flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => setIsRiskExpanded(!isRiskExpanded)}
                    >
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {isRiskExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Gauge className="h-3.5 w-3.5" />
                        Conviction &amp; Time Horizon
                      </div>
                      {isOwner && !isEditingRisk && isRiskExpanded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditRisk() }}
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
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Conviction</span>
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
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Time Horizon</span>
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

                  {/* ========== RESEARCH OWNERSHIP ========== */}
                  <div className="pb-3 border-b border-gray-200 dark:border-gray-700">
                    <div
                      className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 py-1 rounded transition-colors"
                      onClick={() => setIsOwnershipExpanded(!isOwnershipExpanded)}
                    >
                      {isOwnershipExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Users className="h-3.5 w-3.5" />
                      Research Ownership
                    </div>
                    {isOwnershipExpanded && (
                      <div className="mt-3 space-y-2.5">
                        {/* Owner */}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-400 uppercase tracking-wide w-20">Owner</span>
                          <div className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                            <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[10px] font-medium">
                              {getTradeCreatorInitials(trade)}
                            </div>
                            <span className="font-medium">{getTradeCreatorDisplayName(trade)}</span>
                          </div>
                        </div>

                        {/* Assigned Analyst */}
                        <div className="relative" ref={assigneeDropdownRef}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wide w-20">Lead</span>
                            <div className="flex items-center gap-1.5 text-xs">
                              {isOwner ? (
                                <button
                                  onClick={() => {
                                    if (!showAssigneeDropdown) {
                                      setPendingAssignee(trade.assigned_to ?? null)
                                    }
                                    setShowAssigneeDropdown(!showAssigneeDropdown)
                                  }}
                                  className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                >
                                  {(trade as any).assigned_user ? (
                                    <>
                                      <div className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-[10px] font-medium">
                                        {getUserInitials((trade as any).assigned_user)}
                                      </div>
                                      <span className="font-medium">{getUserDisplayName((trade as any).assigned_user)}</span>
                                    </>
                                  ) : (
                                    <span className="text-gray-400">+ Assign</span>
                                  )}
                                  <ChevronDown className={clsx("h-3 w-3 text-gray-400 transition-transform", showAssigneeDropdown && "rotate-180")} />
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  {(trade as any).assigned_user && (
                                    <div className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-[10px] font-medium">
                                      {getUserInitials((trade as any).assigned_user)}
                                    </div>
                                  )}
                                  <span className="text-gray-700 dark:text-gray-300">
                                    {(trade as any).assigned_user ? getUserDisplayName((trade as any).assigned_user) : 'Not assigned'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          {showAssigneeDropdown && isOwner && (() => {
                            const workingLead = pendingAssignee !== undefined ? pendingAssignee : (trade.assigned_to ?? null)
                            const originalLead = trade.assigned_to ?? null
                            const hasChanges = workingLead !== originalLead
                            const closeAndReset = () => {
                              setShowAssigneeDropdown(false)
                              setPendingAssignee(undefined)
                            }
                            return (
                            <>
                              <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); closeAndReset() }} />
                              <div className="absolute right-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[280px]">
                                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-700/50">
                                    <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                    <input
                                      type="text"
                                      placeholder="Search team..."
                                      className="flex-1 text-sm bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                                      onChange={(e) => {
                                        const el = e.target.closest('[data-people-list]')?.querySelectorAll('[data-person]')
                                        el?.forEach((item: any) => {
                                          const name = item.dataset.person?.toLowerCase() || ''
                                          item.style.display = name.includes(e.target.value.toLowerCase()) ? '' : 'none'
                                        })
                                      }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                </div>
                                <div className="max-h-[200px] overflow-y-auto py-1" data-people-list>
                                  <button
                                    data-person="unassign"
                                    onClick={(e) => { e.stopPropagation(); setPendingAssignee(null) }}
                                    className={clsx("w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", workingLead === null && "bg-gray-100 dark:bg-gray-700")}
                                  >
                                    <XCircle className="h-4 w-4 text-gray-400" />
                                    <span className="text-sm text-gray-500">Unassign</span>
                                  </button>
                                  {teamMembers?.filter(m => m.id !== user?.id).map(member => {
                                    const isSelected = workingLead === member.id
                                    return (
                                      <button
                                        key={member.id}
                                        data-person={getUserDisplayName(member)}
                                        onClick={(e) => { e.stopPropagation(); setPendingAssignee(member.id) }}
                                        className={clsx("w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", isSelected && "bg-primary-50 dark:bg-primary-900/20")}
                                      >
                                        <div className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold", isSelected ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300")}>
                                          {getUserInitials(member)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{getUserDisplayName(member)}</div>
                                          {member.email && <div className="text-[10px] text-gray-400 truncate">{member.email}</div>}
                                        </div>
                                        {isSelected && <Check className="h-4 w-4 text-primary-600 dark:text-primary-400 flex-shrink-0" />}
                                      </button>
                                    )
                                  })}
                                </div>
                                <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); closeAndReset() }}
                                    className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    disabled={!hasChanges || updateAssigneeMutation.isPending}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      updateAssigneeMutation.mutate(workingLead, {
                                        onSuccess: () => { setPendingAssignee(undefined) },
                                      })
                                    }}
                                    className="px-2.5 py-1 text-[11px] font-semibold rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  >
                                    {updateAssigneeMutation.isPending ? 'Saving…' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            </>
                            )
                          })()}
                        </div>

                        {/* Analysts (multi-select) */}
                        <div className="relative" ref={collaboratorsDropdownRef}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wide w-20">Analysts</span>
                            <div className="flex items-center gap-1 text-xs">
                              {isOwner ? (
                                <>
                                  {(trade as any).collaborators?.length > 0 && (
                                    <div className="flex items-center -space-x-1 mr-1">
                                      {(trade as any).collaborators.slice(0, 4).map((collabId: string) => {
                                        const member = teamMembers?.find(m => m.id === collabId)
                                        return member ? (
                                          <div key={collabId} className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full flex items-center justify-center text-[9px] font-semibold border border-white dark:border-gray-800" title={getUserDisplayName(member)}>
                                            {getUserInitials(member)}
                                          </div>
                                        ) : null
                                      })}
                                      {(trade as any).collaborators.length > 4 && (
                                        <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 text-gray-500 rounded-full flex items-center justify-center text-[9px] font-semibold border border-white dark:border-gray-800">
                                          +{(trade as any).collaborators.length - 4}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <button
                                    onClick={() => {
                                      if (!showCollaboratorsDropdown) {
                                        setPendingCollaborators((trade as any).collaborators || [])
                                      }
                                      setShowCollaboratorsDropdown(!showCollaboratorsDropdown)
                                    }}
                                    className="flex items-center gap-1 text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                  >
                                    <span>{(trade as any).collaborators?.length > 0 ? 'Edit' : '+ Add'}</span>
                                    <ChevronDown className={clsx("h-3 w-3 transition-transform", showCollaboratorsDropdown && "rotate-180")} />
                                  </button>
                                </>
                              ) : (
                                <div className="flex items-center gap-1">
                                  {(trade as any).collaborators?.length > 0 ? (
                                    <div className="flex items-center -space-x-1">
                                      {(trade as any).collaborators.slice(0, 4).map((collabId: string) => {
                                        const member = teamMembers?.find(m => m.id === collabId)
                                        return member ? (
                                          <div key={collabId} className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[9px] font-semibold border border-white dark:border-gray-800" title={getUserDisplayName(member)}>
                                            {getUserInitials(member)}
                                          </div>
                                        ) : null
                                      })}
                                      {(trade as any).collaborators.length > 4 && (
                                        <span className="text-gray-400 ml-1">+{(trade as any).collaborators.length - 4}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400">None</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {showCollaboratorsDropdown && isOwner && (() => {
                            const working = pendingCollaborators ?? ((trade as any).collaborators || [])
                            const original: string[] = (trade as any).collaborators || []
                            const addedCount = working.filter((id: string) => !original.includes(id)).length
                            const removedCount = original.filter((id: string) => !working.includes(id)).length
                            const hasChanges = addedCount > 0 || removedCount > 0
                            const closeAndReset = () => {
                              setShowCollaboratorsDropdown(false)
                              setPendingCollaborators(null)
                            }
                            return (
                            <>
                              <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); closeAndReset() }} />
                              <div className="absolute right-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[280px]">
                                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-700/50">
                                    <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                    <input
                                      type="text"
                                      placeholder="Search team..."
                                      className="flex-1 text-sm bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder:text-gray-400"
                                      onChange={(e) => {
                                        const el = e.target.closest('[data-people-list]')?.querySelectorAll('[data-person]')
                                        el?.forEach((item: any) => {
                                          const name = item.dataset.person?.toLowerCase() || ''
                                          item.style.display = name.includes(e.target.value.toLowerCase()) ? '' : 'none'
                                        })
                                      }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                </div>
                                <div className="max-h-[200px] overflow-y-auto py-1" data-people-list>
                                  {teamMembers?.filter(m => m.id !== user?.id && m.id !== trade.assigned_to).map(member => {
                                    const isSelected = working.includes(member.id)
                                    return (
                                      <button
                                        key={member.id}
                                        data-person={getUserDisplayName(member)}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setPendingCollaborators(isSelected
                                            ? working.filter((id: string) => id !== member.id)
                                            : [...working, member.id])
                                        }}
                                        className={clsx("w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors", isSelected && "bg-primary-50 dark:bg-primary-900/20")}
                                      >
                                        <div className={clsx("w-4 h-4 border rounded flex items-center justify-center flex-shrink-0", isSelected ? "border-primary-500 bg-primary-500 text-white" : "border-gray-300 dark:border-gray-600")}>
                                          {isSelected && <Check className="h-3 w-3" />}
                                        </div>
                                        <div className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0", isSelected ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300")}>
                                          {getUserInitials(member)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{getUserDisplayName(member)}</div>
                                          {member.email && <div className="text-[10px] text-gray-400 truncate">{member.email}</div>}
                                        </div>
                                      </button>
                                    )
                                  })}
                                {(!teamMembers || teamMembers.filter(m => m.id !== user?.id && m.id !== trade.assigned_to).length === 0) && (
                                  <div className="px-3 py-2 text-sm text-gray-500">No team members available</div>
                                )}
                                </div>
                                <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                    {working.length} selected
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); closeAndReset() }}
                                      className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      disabled={!hasChanges || updateCollaboratorsMutation.isPending}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        updateCollaboratorsMutation.mutate(working, {
                                          onSuccess: () => { setPendingCollaborators(null) },
                                        })
                                      }}
                                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                      {updateCollaboratorsMutation.isPending ? 'Saving…' : 'Save'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </>
                            )
                          })()}
                        </div>

                      </div>
                    )}
                  </div>

                </div>{/* end scrollable area */}

                {/* ========== FIXED BOTTOM BAR ========== */}
                <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-2 bg-white dark:bg-gray-900">

                  {/* ========== ACTIONS - SEGMENTED SECTIONS ========== */}
                  {trade.status !== 'approved' && trade.status !== 'cancelled' && trade.status !== 'rejected' && trade.status !== 'archived' && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">

                      {/* SECTION 1: Quick Actions (not shown in Deciding) */}
                      {trade.stage !== 'deciding' && trade.status !== 'deciding' && (
                        <div className="flex flex-wrap gap-2">
                          {!canMoveStages && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const stageLabelMap: Record<string, string> = { aware: 'Aware', investigate: 'Investigate', deep_research: 'Deep Research', thesis_forming: 'Thesis Forming', ready_for_decision: 'Ready for Decision', idea: 'Aware', working_on: 'Investigate', modeling: 'Deep Research', deciding: 'Ready for Decision' }
                                const stageLabel = stageLabelMap[trade.stage] || trade.stage || trade.status
                                sendDiscussionMessageMutation.mutate({
                                  content: `Any update on this? Currently in ${stageLabel} — wondering if it's ready to move forward.`,
                                })
                                setActiveTab('discussion')
                              }}
                              disabled={sendDiscussionMessageMutation.isPending}
                            >
                              <MessageCircle className="h-4 w-4 mr-1" />
                              Request Update
                            </Button>
                          )}
                        </div>
                      )}

                    </div>
                  )}

                  {/* Restore Actions for Archived/Deferred Items */}
                  {(trade.status === 'approved' || trade.status === 'cancelled' || trade.status === 'rejected' || trade.status === 'archived') && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        Restore
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => updateStatusMutation.mutate('aware' as any)} disabled={updateStatusMutation.isPending}>
                          Aware
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updateStatusMutation.mutate('investigate' as any)} disabled={updateStatusMutation.isPending}>
                          Investigate
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => updateStatusMutation.mutate('deep_research' as any)} disabled={updateStatusMutation.isPending}>
                          Deep Research
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


                  {/* ========== DEFER / ARCHIVE / DELETE ========== */}
                  {trade.status !== 'approved' && trade.status !== 'cancelled' && trade.status !== 'rejected' && trade.status !== 'archived' && trade.status !== 'deleted' && isOwner && (
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => {
                          setSelectedDecisionPortfolioId(null)
                          setPendingDecision(null)
                          setShowDeferModal(true)
                        }}
                        disabled={isDefering}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                      >
                        Defer
                      </button>
                      <button
                        onClick={() => archiveTrade({ tradeId, uiSource: 'modal' })}
                        disabled={isArchiving}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                      >
                        Archive
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="text-xs text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  )}

                  {/* ========== METADATA ========== */}
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Created {formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}
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
                        <div className="absolute left-0 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[200px]">
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

                  </div>

                </div>
                </div>
              )}

              {/* Discussion Tab for Single Trade */}
              {activeTab === 'discussion' && (() => {
                const activeScopeLabel = discussionPortfolioFilter
                  ? discussionPortfolios.find(p => p.id === discussionPortfolioFilter)?.name
                  : null
                const emptyHeading = activeScopeLabel
                  ? `No discussion yet for ${activeScopeLabel}`
                  : 'No discussion yet'
                const emptySubtext = activeScopeLabel
                  ? `Start the conversation about this idea in the context of ${activeScopeLabel}.`
                  : 'Use this space for quick questions, working notes, and informal collaboration.'
                const composerPlaceholder = activeScopeLabel
                  ? `Add a note for ${activeScopeLabel}...`
                  : 'Add to the discussion...'

                return (
                <div className="flex flex-col h-full">
                  {/* ── Discussion Header: Scope + Participants ── */}
                  <div className="px-4 pt-3 pb-2.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    {/* Scope Selector */}
                    {discussionPortfolios.length > 1 && (
                      <div className="mb-2">
                        <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Scope</div>
                        <div className="flex items-center gap-1 overflow-x-auto">
                          <button
                            onClick={() => { setDiscussionPortfolioFilter(null); setMessagePortfolioContext(null) }}
                            className={clsx(
                              'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                              discussionPortfolioFilter === null
                                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                            )}
                          >
                            <Globe className="h-3 w-3" />
                            All
                          </button>
                          {discussionPortfolios.map(p => (
                            <button
                              key={p.id}
                              onClick={() => { setDiscussionPortfolioFilter(p.id); setMessagePortfolioContext(p.id) }}
                              className={clsx(
                                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                                discussionPortfolioFilter === p.id
                                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                              )}
                            >
                              <Briefcase className="h-3 w-3" />
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Participants */}
                    {discussionParticipants.length > 0 && (
                      <div className="flex items-center gap-2 pt-1.5 border-t border-gray-100 dark:border-gray-700/50">
                        <div className="flex items-center -space-x-1.5">
                          {discussionParticipants.slice(0, 5).map(p => (
                            <div
                              key={p.id}
                              title={p.name}
                              className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center ring-1 ring-white dark:ring-gray-800"
                            >
                              <span className="text-primary-700 dark:text-primary-300 text-[9px] font-medium">{p.initials}</span>
                            </div>
                          ))}
                          {discussionParticipants.length > 5 && (
                            <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center ring-1 ring-white dark:ring-gray-800">
                              <span className="text-gray-500 dark:text-gray-400 text-[9px] font-medium">+{discussionParticipants.length - 5}</span>
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          {discussionParticipants.map(p => p.name.split(' ')[0]).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ── Message List ── */}
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    {filteredDiscussionMessages.length > 0 ? (
                      <div className="space-y-0.5">
                        {filteredDiscussionMessages.map((message: any) => (
                          <div key={message.id} className="group flex gap-2.5 py-1.5 -mx-2 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <div className="w-6 h-6 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                              <span className="text-primary-700 dark:text-primary-300 text-[10px] font-medium">
                                {getUserInitials(message.user)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-gray-900 dark:text-white leading-none">
                                  {getUserDisplayName(message.user)}
                                </span>
                                {message.portfolio && discussionPortfolioFilter === null && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 leading-none">
                                    {message.portfolio.name}
                                  </span>
                                )}
                                <span className="text-[11px] text-gray-400 dark:text-gray-500 leading-none">
                                  {formatMessageTime(message.created_at)}
                                </span>
                                {message.is_pinned && <Pin className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />}
                              </div>
                              {message.reply_to && (
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
                                  <Reply className="h-2.5 w-2.5" />
                                  <span>replied</span>
                                </div>
                              )}
                              <div className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap leading-relaxed [&_a]:text-primary-600 [&_a]:underline">
                                <SmartInputRenderer content={message.content} />
                              </div>
                            </div>
                            <div className="flex items-start gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-0.5">
                              <button
                                onClick={() => { setReplyToMessage(message.id); discussionInputRef.current?.focus() }}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                title="Reply"
                              >
                                <Reply className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => navigator.clipboard.writeText(message.content)}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                title="Copy text"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => toggleDiscussionPinMutation.mutate({ messageId: message.id, isPinned: message.is_pinned })}
                                className="p-1 text-gray-400 hover:text-amber-500 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                title={message.is_pinned ? 'Unpin' : 'Pin'}
                              >
                                <Pin className="h-3 w-3" />
                              </button>
                              {/* Promote to Debate — lightweight bridge */}
                              <button
                                onClick={() => {
                                  setDefaultThesisDirection(
                                    trade?.action === 'sell' || trade?.action === 'trim' ? 'bear' : 'bull'
                                  )
                                  setDefaultThesisRationale(message.content)
                                  setDebateComposerTrigger('argument')
                                  setActiveTab('debate')
                                }}
                                className="p-1 text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                title="Promote to debate argument"
                              >
                                <TrendingUp className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-center px-4">
                        <MessageCircle className="h-7 w-7 text-gray-300 dark:text-gray-600 mb-2" />
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{emptyHeading}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-[260px] leading-relaxed">{emptySubtext}</p>
                      </div>
                    )}
                  </div>

                  {/* ── Composer ── */}
                  <div className="px-3 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
                    {replyToMessage && replyToMessageData && (
                      <div className="mb-2 px-2 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 truncate">
                          <Reply className="h-3 w-3 flex-shrink-0" />
                          Replying to {getUserDisplayName(replyToMessageData.user)}
                        </div>
                        <button onClick={() => setReplyToMessage(null)} className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 ml-2 flex-shrink-0">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <UniversalSmartInput ref={discussionInputRef} value={discussionMessage} onChange={(value, metadata) => { setDiscussionMessage(value); setDiscussionMetadata(metadata) }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendDiscussionMessage() }}} placeholder={composerPlaceholder} textareaClassName="text-sm" rows={2} minHeight="60px" enableMentions={true} enableHashtags={true} enableTemplates={true} enableDataFunctions={true} enableAI={true} />
                      </div>
                      <button
                        onClick={handleSendDiscussionMessage}
                        disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending}
                        className={clsx(
                          "h-9 px-3 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors self-end mb-1",
                          discussionMessage.trim()
                            ? "bg-primary-600 text-white hover:bg-primary-700"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed"
                        )}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                )
              })()}

              {/* Proposals Tab for Single Trade */}
              {activeTab === 'decisions' && (() => {
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

                // Recommendation state
                const totalRecs = proposals.length
                const portfolioCount = Object.keys(proposalsByPortfolio).length
                const myRec = proposals.find((p: any) => p.user_id === user?.id)

                return (
                  <div className="p-3 space-y-3">
                    {/* Header */}
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        Recommendations {totalRecs > 0 && <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">({totalRecs} active)</span>}
                      </h3>
                    </div>

                    {/* Decision status banner (informational only — decisions happen in Decision Inbox) */}
                    {canMakeDecision && (
                      <div className="flex items-center gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                        <Scale className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-amber-800 dark:text-amber-200">Ready for Decision</span>
                          <span className="text-[11px] text-amber-600 dark:text-amber-400 ml-1.5">
                            {totalRecs > 0
                              ? `· ${totalRecs} portfolio ${totalRecs === 1 ? 'recommendation' : 'recommendations'} awaiting decision`
                              : '· Awaiting recommendations'}
                          </span>
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

                      // If isPairTrade but no proposals, show empty state
                      if (pairTradeProposals.length === 0) {
                        if (isPairTrade) {
                          return (
                            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                              <Scale className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm font-medium">No portfolio recommendations yet</p>
                              <p className="text-xs mt-1">Submit a recommendation to express your sizing view for this pair trade.</p>
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
                        <div className="space-y-3">
                          {Object.entries(proposalsByPortfolio).map(([portfolioId, { name: portfolioName, myProposal, otherProposals }]) => (
                            <div key={portfolioId} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                              {/* Portfolio Header */}
                              <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                                <div className="flex items-center gap-2">
                                  <Briefcase className="h-3.5 w-3.5 text-gray-500" />
                                  <span className="font-medium text-sm text-gray-900 dark:text-white">{portfolioName}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                                    Pair Trade
                                  </span>
                                  {(myProposal || otherProposals.length > 0) && (() => {
                                    const count = (myProposal ? 1 : 0) + otherProposals.length
                                    return (
                                      <span className="ml-auto text-xs text-gray-500">
                                        {count} recommendation{count !== 1 ? 's' : ''}
                                      </span>
                                    )
                                  })()}
                                </div>
                              </div>

                              <div className="p-3 space-y-3">
                                {/* Your Recommendation - Editable */}
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
                                    <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-800 p-3">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center">
                                            <User className="h-3 w-3 text-primary-600 dark:text-primary-400" />
                                          </div>
                                          <span className="text-sm font-medium text-gray-900 dark:text-white">Your Recommendation</span>
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
                                                    await submitRecommendation({
                                                      tradeQueueItemId: tradeId,
                                                      portfolioId: myProposal.portfolio_id,
                                                      weight: null,
                                                      shares: null,
                                                      sizingMode: sizingMode as TradeSizingMode,
                                                      sizingContext: {
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
                                                      requestedAction: trade?.action || null,
                                                      assetSymbol: trade?.assets?.symbol || null,
                                                      assetCompanyName: trade?.assets?.company_name || null,
                                                    }, context)
                                                    refetchProposals()
                                                    queryClient.invalidateQueries({ queryKey: ['decision-requests'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
                                                    invalidateActivityCaches()
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
                                                  if (!error) { refetchProposals(); queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals'] }); invalidateActivityCaches() }
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

                                {/* Other Recommendations */}
                                {otherProposals.length > 0 && (
                                  <div>
                                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                                      Other Recommendations ({otherProposals.length})
                                    </div>
                                    <div className="space-y-1.5">
                                      {otherProposals.map(proposal => {
                                        const sizingCtx = proposal.sizing_context as any
                                        let legs = sizingCtx?.legs || []
                                        const sizingMode = sizingCtx?.sizingMode || sizingCtx?.proposalType || legs[0]?.sizingMode || proposal.sizing_mode || 'weight'
                                        const userName = getProposerDisplayName(proposal)

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
                                    <p className="text-sm">No recommendations yet for this portfolio</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}

                    {/* Portfolio Recommendation Cards */}
                    {portfolioContexts.length > 0 ? (
                      <div className="space-y-3">
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
                            { value: 'weight', label: 'Target', placeholder: 'e.g. 2.5 or -1.0' },
                            { value: 'delta_weight', label: 'Delta', placeholder: 'e.g. +0.5 or -0.5' },
                            { value: 'active_weight', label: 'Active', placeholder: 'e.g. +1.0' },
                            { value: 'delta_benchmark', label: 'vs Bench', placeholder: 'e.g. +0.5' },
                          ]

                          return (
                            <div
                              key={portfolio.id}
                              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 overflow-hidden"
                            >
                              {/* Portfolio Header — name + position context on one line */}
                              <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700/50">
                                <Briefcase className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">{portfolio.name}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    window.dispatchEvent(new CustomEvent('openTradeLab', {
                                      detail: { portfolioId: portfolio.id }
                                    }))
                                    onClose()
                                  }}
                                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                                  title={`Open Trade Lab for ${portfolio.name}`}
                                >
                                  <FlaskConical className="h-3 w-3" />
                                  Trade Lab
                                </button>
                                <span className="ml-auto flex items-center gap-3 text-[11px] tabular-nums">
                                  <span><span className="text-gray-400">Current</span> <span className="font-semibold text-gray-700 dark:text-gray-200">{portfolio.currentWeight.toFixed(2)}%</span></span>
                                  {portfolio.benchmarkWeight !== null && (
                                    <span><span className="text-gray-400">Bench</span> <span className="font-medium text-gray-600 dark:text-gray-300">{portfolio.benchmarkWeight.toFixed(2)}%</span></span>
                                  )}
                                  {portfolio.activeWeight !== null && (
                                    <span><span className="text-gray-400">Active</span> <span className={clsx("font-medium",
                                      portfolio.activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                      portfolio.activeWeight < 0 ? "text-red-600 dark:text-red-400" :
                                      "text-gray-600 dark:text-gray-300"
                                    )}>{portfolio.activeWeight >= 0 ? '+' : ''}{portfolio.activeWeight.toFixed(2)}%</span></span>
                                  )}
                                </span>
                              </div>

                              {(() => {
                                const currentWt = portfolio.currentWeight
                                const classifyTrade = (targetWt: number): { label: string; color: string; bg: string } => {
                                      if (currentWt === 0 && targetWt > 0) return { label: 'New Long', color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/20' }
                                      if (currentWt === 0 && targetWt < 0) return { label: 'New Short', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/20' }
                                      if (targetWt === 0 && currentWt > 0) return { label: 'Close Long', color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700' }
                                      if (targetWt === 0 && currentWt < 0) return { label: 'Close Short', color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700' }
                                      if (currentWt > 0 && targetWt < 0) return { label: 'Flip Short', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/20' }
                                      if (currentWt < 0 && targetWt > 0) return { label: 'Flip Long', color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/20' }
                                      if (currentWt > 0 && targetWt > currentWt) return { label: 'Increase', color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/20' }
                                      if (currentWt > 0 && targetWt < currentWt) return { label: 'Reduce', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/20' }
                                      if (currentWt < 0 && targetWt < currentWt) return { label: 'Increase Short', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/20' }
                                      if (currentWt < 0 && targetWt > currentWt) return { label: 'Reduce Short', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/20' }
                                      return { label: 'Hold', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700' }
                                    }

                                    // Render: current → target + classification
                                    const renderPreview = (targetWt: number) => {
                                      const tc = classifyTrade(targetWt)
                                      return (
                                        <span className="flex items-center gap-1.5">
                                          <span className="text-gray-500 dark:text-gray-400">Current</span>
                                          <span className="font-medium text-gray-700 dark:text-gray-300">{currentWt.toFixed(2)}%</span>
                                          <span className="text-gray-400">→</span>
                                          <span className="text-gray-500 dark:text-gray-400">Target</span>
                                          <span className="font-semibold text-gray-900 dark:text-white">{targetWt.toFixed(2)}%</span>
                                          <span className={clsx('text-[10px] font-semibold uppercase px-1 py-px rounded', tc.color, tc.bg)}>{tc.label}</span>
                                        </span>
                                      )
                                    }

                                // Compute live preview target
                                const getLiveTarget = (): number | null => {
                                  if (!isExpanded || !inlineProposal?.value) return null
                                  const val = parseFloat(inlineProposal.value.replace(/%/g, ''))
                                  if (isNaN(val)) return null
                                  const benchWt = portfolio.benchmarkWeight ?? 0
                                  if (sizingMode === 'weight') return val
                                  if (sizingMode === 'delta_weight') return currentWt + val
                                  if (sizingMode === 'active_weight' || sizingMode === 'delta_benchmark') return benchWt + val
                                  return val
                                }

                                const renderRecCard = (proposal: any, isMe: boolean) => {
                                  const userName = getProposerDisplayName(proposal)
                                  const propTarget = proposal.weight != null ? Number(proposal.weight) : null
                                  const tc = propTarget != null ? classifyTrade(propTarget) : null
                                  const propTime = proposal.updated_at || proposal.created_at

                                  // If this is my rec and I'm editing, skip the card (editor replaces it)
                                  if (isMe && isExpanded) return null

                                  return (
                                    <div key={proposal.id} className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
                                      <div className="px-2.5 py-1.5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                                            {userName}{isMe && <span className="text-primary-500 ml-1">(You)</span>}
                                          </span>
                                          <span className="text-[10px] text-gray-400">{propTime ? formatDistanceToNow(new Date(propTime), { addSuffix: true }) : ''}</span>
                                        </div>
                                        {propTarget != null && (
                                          <div className="flex items-center gap-1.5 mt-0.5 text-xs tabular-nums">
                                            <span className="text-gray-500">Current</span>
                                            <span className="font-medium text-gray-700 dark:text-gray-300">{currentWt.toFixed(2)}%</span>
                                            <span className="text-gray-400">→</span>
                                            <span className="text-gray-500">Target</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">{propTarget.toFixed(2)}%</span>
                                            {tc && <span className={clsx('text-[10px] font-semibold uppercase px-1 py-px rounded', tc.color, tc.bg)}>{tc.label}</span>}
                                            {(() => {
                                              if (propTarget == null) return null
                                              const delta = propTarget - currentWt
                                              if (delta === 0) return null
                                              const isSell = trade?.action === 'sell' || trade?.action === 'trim'
                                              const isBuy = trade?.action === 'buy' || trade?.action === 'add'
                                              const contradicts = (isSell && delta > 0) || (isBuy && delta < 0)
                                              if (!contradicts) return null
                                              return <span className="text-[9px] font-semibold uppercase px-1 py-px rounded text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />Contradicts Idea</span>
                                            })()}
                                          </div>
                                        )}
                                        {proposal.notes && (
                                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 italic line-clamp-2">{proposal.notes}</p>
                                        )}
                                      </div>
                                      {isMe && !isExpanded && confirmWithdrawId !== proposal.id && (
                                        <div className="flex items-center gap-1 px-2.5 py-1 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50">
                                          <button type="button" onClick={() => setExpandedProposalInputs(prev => { const next = new Set(prev); next.add(portfolio.id); return next })} className="text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:underline">Edit</button>
                                          <span className="text-gray-300 dark:text-gray-600">·</span>
                                          <button type="button" onClick={() => setConfirmWithdrawId(proposal.id)} className="text-[11px] font-medium text-red-500 dark:text-red-400 hover:underline">Withdraw</button>
                                        </div>
                                      )}
                                      {confirmWithdrawId === proposal.id && (
                                        <div className="px-2.5 py-2 border-t border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10">
                                          <p className="text-xs font-medium text-red-800 dark:text-red-300 mb-1">Withdraw this recommendation?</p>
                                          <p className="text-[11px] text-red-600 dark:text-red-400 mb-2">Your recommendation will be removed and recorded in the activity history.</p>
                                          <div className="flex items-center gap-2">
                                            <button type="button" onClick={async () => {
                                              setConfirmWithdrawId(null)
                                              queryClient.setQueryData(['trade-proposals', tradeId, pairTradeLegIds], (old: any) => old?.filter((p: any) => p.id !== proposal.id) ?? [])
                                              try {
                                                const { data: activeReqs } = await supabase.from('decision_requests').select('id').eq('proposal_id', proposal.id).in('status', ['pending', 'under_review', 'needs_discussion'])
                                                if (activeReqs?.length) await Promise.all(activeReqs.map((r: any) => supabase.from('decision_requests').update({ status: 'withdrawn', reviewed_at: new Date().toISOString(), reviewed_by: user?.id }).eq('id', r.id)))
                                                await supabase.from('trade_proposals').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', proposal.id).eq('user_id', user?.id)
                                                await supabase.from('trade_events').insert({ trade_queue_item_id: tradeId, event_type: 'proposal_withdrawn', actor_id: user?.id, proposal_id: proposal.id, metadata: { portfolio_id: portfolio.id, portfolio_name: portfolio.name, weight: proposal.weight != null ? Number(proposal.weight) : null } })
                                              } catch (e) { console.error('[Withdraw] failed:', e) }
                                              finally { refetchProposals(); queryClient.invalidateQueries({ queryKey: ['trade-proposals-rejected'] }); queryClient.invalidateQueries({ queryKey: ['trade-events'] }); queryClient.invalidateQueries({ queryKey: ['decision-requests'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals'] }); invalidateActivityCaches() }
                                            }} className="px-3 py-1 text-[11px] font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors">Confirm Withdraw</button>
                                            <button type="button" onClick={() => setConfirmWithdrawId(null)} className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                }

                                const liveTarget = getLiveTarget()

                                return (
                                  <div className="p-3 space-y-2">
                                    {/* Existing recommendations */}
                                    {portfolioProposals.map(p => renderRecCard(p, p.user_id === user?.id))}

                                    {/* Add recommendation CTA (when user hasn't submitted and not editing) */}
                                    {!userProposal && !isExpanded && (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedProposalInputs(prev => { const next = new Set(prev); next.add(portfolio.id); return next })}
                                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                      >
                                        <Scale className="h-3.5 w-3.5" />
                                        Add Your Recommendation
                                      </button>
                                    )}

                              {/* Recommendation Editor */}
                              {isExpanded && (
                                <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-800 overflow-hidden">

                                  {/* Position Change Summary Bar */}
                                  {inlineProposal?.value && (() => {
                                    const val = parseFloat(inlineProposal.value.replace(/%/g, ''))
                                    if (isNaN(val)) return null
                                    const cw = portfolio.currentWeight
                                    const bw = portfolio.benchmarkWeight ?? 0
                                    let tw: number
                                    if (sizingMode === 'weight') tw = val
                                    else if (sizingMode === 'delta_weight') tw = cw + val
                                    else if (sizingMode === 'active_weight' || sizingMode === 'delta_benchmark') tw = bw + val
                                    else tw = val
                                    const tc = classifyTrade(tw)
                                    const delta = tw - cw
                                    const isSell = trade?.action === 'sell' || trade?.action === 'trim'
                                    const isBuy = trade?.action === 'buy' || trade?.action === 'add'
                                    const summaryContradicts = delta !== 0 && ((isSell && delta > 0) || (isBuy && delta < 0))
                                    return (
                                      <div className={clsx("px-3 py-2 border-b", summaryContradicts ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800" : "bg-gray-50 dark:bg-gray-700/40 border-gray-200 dark:border-gray-700")}>
                                        <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Position Change</div>
                                        <div className="flex items-center gap-2 text-xs tabular-nums">
                                          <span className="font-medium text-gray-600 dark:text-gray-300">{cw.toFixed(2)}%</span>
                                          <span className="text-gray-400">→</span>
                                          <span className="font-bold text-gray-900 dark:text-white">{tw.toFixed(2)}%</span>
                                          <span className={clsx('text-[10px] font-semibold uppercase px-1 py-px rounded', tc.color, tc.bg)}>
                                            {tc.label}
                                          </span>
                                          {summaryContradicts && (
                                            <span className="text-[9px] font-semibold uppercase px-1 py-px rounded text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30">
                                              Contradicts Idea
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })()}

                                  <div className="p-3 space-y-3">

                                  {/* Sizing Method */}
                                  <div>
                                    <label className="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Sizing Method</label>
                                    <div className="grid grid-cols-4 gap-1">
                                      {sizingModes.map((mode) => {
                                        const isDisabled = mode.value === 'delta_benchmark' && portfolio.benchmarkWeight === null
                                        return (
                                          <button key={mode.value} type="button" disabled={isDisabled}
                                            onClick={() => setInlineProposals(prev => {
                                              const cur = prev[portfolio.id]
                                              const savedValues = { ...cur?.values, [cur?.sizingMode || 'weight']: cur?.value || '' }
                                              return { ...prev, [portfolio.id]: { ...cur, sizingMode: mode.value, value: savedValues[mode.value] || '', values: savedValues } }
                                            })}
                                            className={clsx("px-2 py-1 text-xs rounded border transition-colors",
                                              sizingMode === mode.value ? "bg-primary-100 dark:bg-primary-900/30 border-primary-500 text-primary-700 dark:text-primary-300"
                                                : isDisabled ? "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 cursor-not-allowed"
                                                : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400"
                                            )}
                                            title={isDisabled ? 'Benchmark data not available' : mode.label}
                                          >{mode.label}</button>
                                        )
                                      })}
                                    </div>
                                  </div>

                                  {/* Value Input */}
                                  <div>
                                    <label className="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                                      {sizingMode === 'weight' ? 'Target Weight %' : sizingMode === 'delta_weight' ? 'Change %' : sizingMode === 'active_weight' ? 'Active Weight %' : 'vs Benchmark %'}
                                    </label>
                                    <input type="text"
                                      value={inlineProposal?.value || ''}
                                      onChange={(e) => setInlineProposals(prev => ({ ...prev, [portfolio.id]: { ...prev[portfolio.id], value: e.target.value } }))}
                                      placeholder={sizingMode === 'weight' ? (trade?.action === 'sell' || trade?.action === 'trim' ? 'e.g. -1.0' : 'e.g. 2.5') : sizingModes.find(m => m.value === sizingMode)?.placeholder || ''}
                                      className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 tabular-nums"
                                    />
                                    {/* Contradiction warning — based on portfolio effect, not raw input */}
                                    {(() => {
                                      const val = parseFloat((inlineProposal?.value || '').replace(/%/g, ''))
                                      if (isNaN(val)) return null
                                      const cw = portfolio.currentWeight
                                      const bw = portfolio.benchmarkWeight ?? 0
                                      let tw: number
                                      if (sizingMode === 'weight') tw = val
                                      else if (sizingMode === 'delta_weight') tw = cw + val
                                      else if (sizingMode === 'active_weight' || sizingMode === 'delta_benchmark') tw = bw + val
                                      else tw = val
                                      const delta = tw - cw
                                      if (delta === 0) return null
                                      const isSell = trade?.action === 'sell' || trade?.action === 'trim'
                                      const isBuy = trade?.action === 'buy' || trade?.action === 'add'
                                      const exposureIncreases = delta > 0
                                      const contradicts = (isSell && exposureIncreases) || (isBuy && !exposureIncreases)
                                      if (!contradicts) return null
                                      return (
                                        <div className="flex items-start gap-2 mt-1.5 px-2 py-1.5 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/15">
                                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0 mt-px" />
                                          <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                            <span className="font-semibold">Contradicts idea direction.</span>{' '}
                                            {isSell ? 'SELL' : 'BUY'} idea, but this recommendation {exposureIncreases ? 'increases' : 'decreases'} exposure ({cw.toFixed(2)}% → {tw.toFixed(2)}%).
                                          </p>
                                        </div>
                                      )
                                    })()}
                                  </div>

                                  {/* Derived Math */}
                                  {inlineProposal?.value && (() => {
                                    const val = parseFloat(inlineProposal.value.replace(/%/g, ''))
                                    if (isNaN(val)) return null
                                    const currentWt = portfolio.currentWeight
                                    const benchWt = portfolio.benchmarkWeight ?? 0
                                    let targetWt: number
                                    if (sizingMode === 'weight') targetWt = val
                                    else if (sizingMode === 'delta_weight') targetWt = currentWt + val
                                    else if (sizingMode === 'active_weight' || sizingMode === 'delta_benchmark') targetWt = benchWt + val
                                    else targetWt = val

                                    const projectedActive = targetWt - benchWt
                                    const delta = targetWt - currentWt

                                      return (
                                        <div className="mt-1.5 px-2 py-1.5 rounded bg-gray-100 dark:bg-gray-700/50 text-[11px] tabular-nums space-y-0.5">
                                          <div className="flex justify-between">
                                            <span className="text-gray-500">Current</span>
                                            <span className="font-medium text-gray-700 dark:text-gray-300">{currentWt.toFixed(2)}%</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-gray-500">Target</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">{targetWt.toFixed(2)}%</span>
                                          </div>
                                          <div className="border-t border-gray-200 dark:border-gray-600 my-0.5" />
                                          <div className="flex justify-between">
                                            <span className="text-gray-500">Change</span>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">
                                              {delta >= 0 ? '+' : ''}{delta.toFixed(2)}%
                                            </span>
                                          </div>
                                          {portfolio.benchmarkWeight !== null && (
                                            <div className="flex justify-between">
                                              <span className="text-gray-500">Projected Active</span>
                                              <span className={clsx('font-medium', projectedActive > 0 ? 'text-green-600 dark:text-green-400' : projectedActive < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500')}>
                                                {projectedActive >= 0 ? '+' : ''}{projectedActive.toFixed(2)}%
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })()}

                                  {/* Notes */}
                                  <div>
                                    <label className="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Notes</label>
                                    <input type="text"
                                      value={inlineProposal?.notes || ''}
                                      onChange={(e) => setInlineProposals(prev => ({ ...prev, [portfolio.id]: { ...prev[portfolio.id], notes: e.target.value } }))}
                                      placeholder="Rationale for this recommendation..."
                                      className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                    />
                                  </div>

                                  {/* Submit/Update + Clear Buttons */}
                                  {(() => {
                                    const hasInput = !!inlineProposal?.value
                                    const hasChanged = hasInput && (
                                      !userProposal ||
                                      (() => {
                                        const ctx = userProposal.sizing_context as any
                                        const savedValue = ctx?.inputValue?.toString() ?? userProposal.weight?.toString() ?? ''
                                        const savedMode = ctx?.proposalType || userProposal.sizing_mode || 'weight'
                                        return inlineProposal.value !== savedValue ||
                                          (inlineProposal.notes || '') !== (userProposal.notes || '') ||
                                          inlineProposal.sizingMode !== savedMode
                                      })()
                                    )
                                    return (
                                  <div className="space-y-2">
                                  {/* Submit/Update button — full width */}
                                  {hasChanged && (
                                  <Button
                                    size="sm"
                                    disabled={isSubmittingProposal}
                                    onClick={async () => {
                                      if (!user || !inlineProposal?.value) return
                                      const numValue = parseFloat(inlineProposal.value)
                                      if (isNaN(numValue)) return

                                      setIsSubmittingProposal(true)

                                      // Calculate weight based on sizing mode (signed value from input)
                                      let weight: number | null = numValue
                                      let dbSizingMode: TradeSizingMode = 'weight'

                                      if (sizingMode === 'weight') {
                                        weight = numValue // User enters signed target directly
                                      } else if (sizingMode === 'delta_weight') {
                                        weight = portfolio.currentWeight + numValue
                                        dbSizingMode = 'delta_weight'
                                      } else if (sizingMode === 'active_weight' && portfolio.benchmarkWeight !== null) {
                                        weight = portfolio.benchmarkWeight + numValue
                                        dbSizingMode = 'delta_benchmark'
                                      } else if (sizingMode === 'delta_benchmark' && portfolio.benchmarkWeight !== null) {
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

                                      // Optimistic: update proposals cache immediately so the header
                                      // shows the saved recommendation without waiting for refetch
                                      const optimisticProposal = {
                                        id: userProposal?.id || `optimistic-${Date.now()}`,
                                        trade_queue_item_id: tradeId,
                                        user_id: user.id,
                                        portfolio_id: portfolio.id,
                                        weight,
                                        shares: null,
                                        sizing_mode: dbSizingMode,
                                        sizing_context: { proposalType: sizingMode, inputValue: numValue, currentWeight: portfolio.currentWeight },
                                        notes: inlineProposal.notes || null,
                                        is_active: true,
                                        created_at: userProposal?.created_at || new Date().toISOString(),
                                        updated_at: new Date().toISOString(),
                                        users: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name },
                                        portfolio: { id: portfolio.id, name: portfolio.name },
                                      }

                                      // Apply optimistic update + collapse instantly
                                      queryClient.setQueryData(
                                        ['trade-proposals', tradeId, pairTradeLegIds],
                                        (old: any[]) => {
                                          const filtered = (old || []).filter((p: any) => !(p.user_id === user.id && p.portfolio_id === portfolio.id))
                                          return [...filtered, optimisticProposal]
                                        }
                                      )
                                      setExpandedProposalInputs(prev => {
                                        const next = new Set(prev)
                                        next.delete(portfolio.id)
                                        return next
                                      })

                                      try {
                                        await submitRecommendation({
                                          tradeQueueItemId: tradeId,
                                          portfolioId: portfolio.id,
                                          weight,
                                          shares: null,
                                          sizingMode: dbSizingMode,
                                          sizingContext: {
                                            proposalType: sizingMode,
                                            inputValue: numValue,
                                            currentWeight: portfolio.currentWeight,
                                            contradicts_idea: (() => {
                                              const delta = weight! - portfolio.currentWeight
                                              if (delta === 0) return false
                                              const isSell = trade?.action === 'sell' || trade?.action === 'trim'
                                              const isBuy = trade?.action === 'buy' || trade?.action === 'add'
                                              return (isSell && delta > 0) || (isBuy && delta < 0)
                                            })(),
                                            idea_direction: trade?.action || null,
                                          },
                                          notes: inlineProposal.notes || null,
                                          requestedAction: trade?.action || null,
                                          assetSymbol: trade?.assets?.symbol || null,
                                          assetCompanyName: trade?.assets?.company_name || null,
                                          portfolioName: portfolio.name || null,
                                        }, context)

                                        // Background sync
                                        refetchProposals()
                                        queryClient.invalidateQueries({ queryKey: ['decision-requests'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
                                        queryClient.invalidateQueries({ queryKey: ['trade-events'] })
                                        invalidateActivityCaches()
                                      } catch (e) {
                                        console.error('[Submit recommendation] failed:', e)
                                        // Revert optimistic update on error
                                        refetchProposals()
                                      } finally {
                                        setIsSubmittingProposal(false)
                                      }
                                    }}
                                    className="w-full"
                                  >
                                    {isSubmittingProposal ? (
                                      <span className="flex items-center gap-1.5">
                                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                        Saving...
                                      </span>
                                    ) : (
                                      <>
                                        <Scale className="h-3.5 w-3.5 mr-1" />
                                        {userProposal ? 'Update Recommendation' : 'Submit Recommendation'}
                                      </>
                                    )}
                                  </Button>
                                  )}

                                  {/* Cancel */}
                                  <button type="button"
                                    onClick={() => setExpandedProposalInputs(prev => { const next = new Set(prev); next.delete(portfolio.id); return next })}
                                    className="w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1"
                                  >Cancel</button>

                                  {/* Withdraw */}
                                  {userProposal && confirmWithdrawId !== userProposal.id && (
                                    <button type="button" onClick={() => setConfirmWithdrawId(userProposal.id)}
                                      className="w-full text-center text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 py-1"
                                    >Withdraw Recommendation</button>
                                  )}
                                  {userProposal && confirmWithdrawId === userProposal.id && (
                                    <div className="rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10 p-2.5">
                                      <p className="text-xs font-medium text-red-800 dark:text-red-300 mb-1">Withdraw this recommendation?</p>
                                      <p className="text-[11px] text-red-600 dark:text-red-400 mb-2">Your recommendation will be removed and recorded in the activity history.</p>
                                      <div className="flex items-center gap-2">
                                        <button type="button" onClick={async () => {
                                          setConfirmWithdrawId(null)
                                          queryClient.setQueryData(['trade-proposals', tradeId, pairTradeLegIds], (old: any) => old?.filter((p: any) => p.id !== userProposal.id) ?? [])
                                          setExpandedProposalInputs(prev => { const next = new Set(prev); next.delete(portfolio.id); return next })
                                          try {
                                            const { data: activeReqs } = await supabase.from('decision_requests').select('id').eq('proposal_id', userProposal.id).in('status', ['pending', 'under_review', 'needs_discussion'])
                                            if (activeReqs?.length) await Promise.all(activeReqs.map((r: any) => supabase.from('decision_requests').update({ status: 'withdrawn', reviewed_at: new Date().toISOString(), reviewed_by: user?.id }).eq('id', r.id)))
                                            await supabase.from('trade_proposals').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', userProposal.id).eq('user_id', user?.id)
                                            await supabase.from('trade_events').insert({ trade_queue_item_id: tradeId, event_type: 'proposal_withdrawn', actor_id: user?.id, proposal_id: userProposal.id, metadata: { portfolio_id: portfolio.id, portfolio_name: portfolio.name, weight: userProposal.weight != null ? Number(userProposal.weight) : null } })
                                          } catch (e) { console.error('[Withdraw] failed:', e) }
                                          finally { refetchProposals(); queryClient.invalidateQueries({ queryKey: ['trade-proposals-rejected'] }); queryClient.invalidateQueries({ queryKey: ['trade-events'] }); queryClient.invalidateQueries({ queryKey: ['decision-requests'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-proposals'] }); invalidateActivityCaches() }
                                        }} className="px-3 py-1 text-[11px] font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors">Confirm Withdraw</button>
                                        <button type="button" onClick={() => setConfirmWithdrawId(null)} className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
                                      </div>
                                    </div>
                                  )}

                                  </div>
                                    )
                                  })()}

                                  </div>
                                </div>
                              )}

                                  </div>
                                )
                              })()}
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
                    ) : (
                      /* Proposals exist but no portfolio context cards — show a flat list */
                      <div className="space-y-2">
                        {proposals.map((proposal: any) => {
                          const userName = getProposerDisplayName(proposal)
                          const isCurrentUser = proposal.user_id === user?.id
                          const portfolioName = proposal.portfolio?.name || proposal.portfolios?.name || 'Unknown Portfolio'

                          return (
                            <div
                              key={proposal.id}
                              className={clsx(
                                "p-3 rounded-lg border",
                                isCurrentUser
                                  ? "bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800"
                                  : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                              )}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {userName}
                                    {isCurrentUser && (
                                      <span className="ml-1 text-xs text-primary-600 dark:text-primary-400">(You)</span>
                                    )}
                                  </span>
                                  <span className="text-xs text-gray-400">·</span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">{portfolioName}</span>
                                </div>
                                <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                                  {proposal.weight !== null && proposal.weight !== undefined
                                    ? `${Number(proposal.weight).toFixed(2)}%`
                                    : proposal.shares
                                    ? `${Number(proposal.shares).toLocaleString()} sh`
                                    : '—'}
                                </span>
                              </div>
                              {proposal.sizing_input && (
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  Sizing: {proposal.sizing_input}
                                  {proposal.sizing_mode && proposal.sizing_mode !== 'weight' && (
                                    <span className="ml-1 text-gray-400">({proposal.sizing_mode})</span>
                                  )}
                                </div>
                              )}
                              {proposal.notes && (
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 italic">
                                  "{proposal.notes}"
                                </p>
                              )}
                              <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                                {new Date(proposal.updated_at || proposal.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                  </div>
                )
              })()}

              {/* Activity Tab for Single Trade */}
              {activeTab === 'activity' && (() => {
                // Calculate activity insights
                const createdAt = new Date(trade.created_at)
                const now = new Date()
                const daysSinceCreation = Math.max(1, Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)))

                // Get unique participants with roles
                const participants = new Map<string, { name: string; roles: Set<string>; avatar: string }>()
                const addParticipant = (id: string, userData: any, role: string) => {
                  if (!userData || !id) return
                  const existing = participants.get(id)
                  if (existing) {
                    existing.roles.add(role)
                  } else {
                    participants.set(id, {
                      name: getUserDisplayName(userData),
                      roles: new Set([role]),
                      avatar: getUserInitials(userData),
                    })
                  }
                }

                // Creator — pilot-seeded trades surface as "Pilot" rather than
                // the synthetic admin the seeding RPC happened to pick.
                if (isPilotSeedTrade(trade)) {
                  addParticipant('pilot', { first_name: 'Pilot', last_name: '' } as any, 'Creator')
                } else if (trade.users) {
                  addParticipant(trade.created_by || 'creator', trade.users, 'Creator')
                }
                // Assignee
                if ((trade as any).assigned_user) addParticipant((trade as any).assigned_to, (trade as any).assigned_user, 'Assignee')
                // Recommenders — same pilot-seed treatment.
                const proposalsData = proposals || []
                proposalsData.forEach((p: any) => {
                  if (isPilotSeedProposal(p)) {
                    addParticipant('pilot', { first_name: 'Pilot', last_name: '' } as any, 'Recommender')
                    return
                  }
                  const proposerData = p.users || p.user
                  if (proposerData) addParticipant(p.user_id, proposerData, 'Recommender')
                })

                // Key dates from proposals
                const sortedProposals = [...proposalsData].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                const firstRecommendation = sortedProposals[0]
                const lastRecommendation = sortedProposals[sortedProposals.length - 1]

                return (
                  <div className="p-3 space-y-4">
                    {/* Summary Metrics */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-center">
                        <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{daysSinceCreation}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Days Active</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-center">
                        <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{proposalsData.length}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Recommendations</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-center">
                        <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{labLinks.length}</div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Portfolios</div>
                      </div>
                    </div>

                    {/* Key Dates — horizontal milestone chips */}
                    {(() => {
                      const dates: { label: string; date: Date }[] = [
                        { label: 'Created', date: createdAt },
                      ]
                      if (firstRecommendation) {
                        dates.push({ label: 'First Rec', date: new Date(firstRecommendation.created_at) })
                      }
                      if (lastRecommendation && lastRecommendation !== firstRecommendation) {
                        dates.push({ label: 'Last Rec', date: new Date(lastRecommendation.created_at) })
                      }
                      if (trade.decided_at) {
                        dates.push({ label: 'Decision', date: new Date(trade.decided_at) })
                      }
                      if (trade.updated_at && trade.updated_at !== trade.created_at) {
                        dates.push({ label: 'Updated', date: new Date(trade.updated_at) })
                      }
                      return (
                        <div className="flex flex-wrap gap-2">
                          {dates.map((d, idx) => (
                            <div key={idx} className="bg-gray-50 dark:bg-gray-800 rounded-lg px-2.5 py-1.5 min-w-0">
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none mb-0.5">{d.label}</div>
                              <div className="text-xs font-medium text-gray-900 dark:text-white whitespace-nowrap">{format(d.date, 'MMM d, yyyy')}</div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}

                    {/* Participants */}
                    {participants.size > 0 && (
                      <div>
                        <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                          Participants · {participants.size}
                        </h4>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {Array.from(participants.values()).map((p, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-[9px] font-semibold text-gray-600 dark:text-gray-300 flex-shrink-0">
                                {p.avatar}
                              </div>
                              <span className="text-xs text-gray-900 dark:text-white">{p.name}</span>
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">{Array.from(p.roles).join(', ')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Activity Timeline */}
                    <div>
                      <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Timeline</h4>
                      <EntityTimeline
                        entityType="trade_idea"
                        entityId={tradeId}
                        showHeader={false}
                        collapsible={false}
                        excludeActions={['attach', 'detach']}
                        maxItems={25}
                        groupByDate={true}
                        tradeEvents={tradeEventsData}
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
                Submit Your Recommendation
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {trade.stage === 'deciding'
                  ? `Add your sizing recommendation for ${trade.assets?.symbol}.`
                  : `Before moving to Deciding, please submit your sizing recommendation for ${trade.assets?.symbol}.`
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

                      // Submit recommendation — creates/updates proposal + decision request
                      await submitRecommendation({
                        tradeQueueItemId: tradeId,
                        portfolioId: effectivePortfolioId,
                        weight: proposalWeight ? parseFloat(proposalWeight) : null,
                        shares: proposalShares ? parseInt(proposalShares, 10) : null,
                        notes: proposalNotes || null,
                        requestedAction: trade?.action || null,
                        assetSymbol: trade?.assets?.symbol || null,
                        assetCompanyName: trade?.assets?.company_name || null,
                      }, context)

                      // Only move to deciding if not already there
                      if (trade.stage !== 'deciding') {
                        await updateStatusMutation.mutateAsync('deciding')
                      }

                      // Refresh proposals, decision inbox, and activity
                      queryClient.invalidateQueries({ queryKey: ['trade-proposals', tradeId] })
                      queryClient.invalidateQueries({ queryKey: ['decision-requests'] }); queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
                      invalidateActivityCaches()

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
                  {trade.stage === 'deciding' ? 'Submit Recommendation' : 'Submit & Move to Deciding'}
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
