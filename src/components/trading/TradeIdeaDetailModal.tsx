import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import {
  X,
  TrendingUp,
  TrendingDown,
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
  TrendingDown as StopLoss,
  TrendingUp as TakeProfit,
  Gauge,
  Timer,
  Save,
  Pencil,
  Tag,
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
import { getIdeaLabLinks, updateIdeaLinkSizing, linkIdeaToLab, unlinkIdeaFromLab, getProposalsForTradeIdea, upsertProposal, getPortfolioTracksForIdea, updatePortfolioTrackDecision, type IdeaLabLink, type TradeProposalWithUser } from '../../lib/services/trade-lab-service'
import type { ActionContext, DecisionOutcome, TradeIdeaPortfolio, UpdatePortfolioTrackInput } from '../../types/trading'
import { UniversalSmartInput, SmartInputRenderer, type SmartInputMetadata } from '../smart-input'
import type { UniversalSmartInputRef } from '../smart-input'
import type {
  TradeQueueItemWithDetails,
  TradeQueueStatus
} from '../../types/trading'
import { clsx } from 'clsx'

type ModalTab = 'details' | 'proposals' | 'activity'

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
  const [discussionMetadata, setDiscussionMetadata] = useState<SmartInputMetadata>({ mentions: [], references: [], dataSnapshots: [], aiContent: [] })
  const [replyToMessage, setReplyToMessage] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeferModal, setShowDeferModal] = useState(false)
  const [deferUntilDate, setDeferUntilDate] = useState<string | null>(null)
  const [showProposalModal, setShowProposalModal] = useState(false)
  const [proposalWeight, setProposalWeight] = useState<string>('')
  const [proposalShares, setProposalShares] = useState<string>('')
  const [proposalNotes, setProposalNotes] = useState<string>('')
  const [proposalPortfolioId, setProposalPortfolioId] = useState<string>('')
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false)
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

  // Collapsible sections
  const [isSizingExpanded, setIsSizingExpanded] = useState(true)
  const [isRiskExpanded, setIsRiskExpanded] = useState(true)

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

  // Get expression counts for trade ideas
  const { data: expressionCounts } = useTradeExpressionCounts()

  // Fetch trade details - check both pair_trades and trade_queue_items
  const { data: tradeData, isLoading } = useQuery({
    queryKey: ['trade-detail', tradeId],
    queryFn: async () => {
      // First try to fetch as a pair trade
      const { data: pairTrade, error: pairError } = await supabase
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

      // Fall back to individual trade item
      const { data: tradeItem, error: tradeError } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name)
        `)
        .eq('id', tradeId)
        .maybeSingle()

      if (tradeError) throw tradeError
      if (!tradeItem) return null

      return { type: 'single' as const, data: tradeItem as TradeQueueItemWithDetails }
    },
    enabled: isOpen,
  })

  // Extract trade for backwards compatibility with existing UI
  const trade = tradeData?.type === 'single' ? tradeData.data : null
  const pairTrade = tradeData?.type === 'pair' ? tradeData.data : null

  // Fetch portfolio holdings for this asset to determine position context
  const { data: portfolioPositions } = useQuery({
    queryKey: ['portfolio-positions', trade?.asset_id],
    queryFn: async () => {
      if (!trade?.asset_id) return new Map<string, number>()

      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares')
        .eq('asset_id', trade.asset_id)

      if (error) throw error

      // Create a map of portfolio_id -> shares
      const positionMap = new Map<string, number>()
      data?.forEach((holding: any) => {
        positionMap.set(holding.portfolio_id, holding.shares || 0)
      })
      return positionMap
    },
    enabled: isOpen && !!trade?.asset_id,
  })

  // Helper to get position context label
  const getPositionContext = (portfolioId: string): string => {
    const shares = portfolioPositions?.get(portfolioId) || 0
    const isBuy = trade?.action === 'buy' || trade?.action === 'add'

    if (isBuy) {
      if (shares > 0) return 'add to position'
      if (shares < 0) return 'cover short'
      return 'new position'
    } else {
      if (shares > 0) return 'reduce position'
      if (shares < 0) return 'add to short'
      return 'new short'
    }
  }

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

  // Fetch proposals for this trade idea
  const { data: proposals = [], refetch: refetchProposals } = useQuery({
    queryKey: ['trade-proposals', tradeId],
    queryFn: () => {
      console.log('[TradeIdeaDetailModal] Fetching proposals for tradeId:', tradeId)
      return getProposalsForTradeIdea(tradeId)
    },
    enabled: isOpen && !!tradeId,
  })

  // Fetch rejected/inactive proposals for history
  const { data: rejectedProposals = [] } = useQuery({
    queryKey: ['trade-proposals-rejected', tradeId],
    queryFn: async () => {
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
    enabled: isOpen && !!tradeId,
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

  // Fetch discussion messages
  const { data: discussionMessages = [] } = useQuery({
    queryKey: ['messages', 'trade_idea', tradeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          user:users(id, email, first_name, last_name)
        `)
        .eq('context_type', 'trade_idea')
        .eq('context_id', tradeId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: isOpen,
  })

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
    mutationFn: async (data: { content: string; reply_to?: string }) => {
      const { error } = await supabase
        .from('messages')
        .insert([{
          content: data.content,
          context_type: 'trade_idea',
          context_id: tradeId,
          user_id: user?.id,
          reply_to: data.reply_to
        }])

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', 'trade_idea', tradeId] })
      setDiscussionMessage('')
      setReplyToMessage(null)
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

  // Ownership check for edit permissions
  const isOwner = trade?.created_by === user?.id

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

  const handleSendDiscussionMessage = () => {
    if (!discussionMessage.trim()) return

    sendDiscussionMessageMutation.mutate({
      content: discussionMessage.trim(),
      reply_to: replyToMessage || undefined
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
            {pairTrade && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 px-2 py-1 rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                  <Link2 className="h-4 w-4" />
                  <span className="text-sm">Pair Trade</span>
                </div>
                <div>
                  <span className="font-bold text-lg text-gray-900 dark:text-white">
                    {pairTrade.name || 'Pairs Trade'}
                  </span>
                </div>
              </div>
            )}
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
          ) : pairTrade ? (
            <>
              {/* Pair Trade Details Tab */}
              {activeTab === 'details' && (
                <div className="p-4 space-y-6">
                  {/* Status and Urgency */}
                  <div className="flex items-center gap-3">
                    <span className={clsx("px-3 py-1 rounded-full text-sm font-medium", STATUS_CONFIG[pairTrade.status as TradeQueueStatus]?.color || 'bg-gray-100 text-gray-800')}>
                      {STATUS_CONFIG[pairTrade.status as TradeQueueStatus]?.label || pairTrade.status}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      Urgency: <span className="font-medium capitalize">{pairTrade.urgency}</span>
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      Portfolio: <span className="font-medium">{pairTrade.portfolios?.name}</span>
                    </span>
                  </div>

                  {/* Pair Legs */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Trade Legs</h3>
                    {pairTrade.trade_queue_items?.filter((leg: any) => leg.pair_leg_type === 'long').map((leg: any) => (
                      <div key={leg.id} className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                          <span className="text-xs font-medium text-green-700 dark:text-green-300 uppercase">Long</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{leg.assets?.symbol}</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{leg.assets?.company_name}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {leg.proposed_weight && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">Target Weight: </span>
                              <span className="font-medium text-green-600 dark:text-green-400">+{leg.proposed_weight.toFixed(2)}%</span>
                            </div>
                          )}
                          {leg.proposed_shares && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">Shares: </span>
                              <span className="font-medium text-green-600 dark:text-green-400">+{leg.proposed_shares.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {pairTrade.trade_queue_items?.filter((leg: any) => leg.pair_leg_type === 'short').map((leg: any) => (
                      <div key={leg.id} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200 dark:border-red-800">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                          <span className="text-xs font-medium text-red-700 dark:text-red-300 uppercase">Short</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{leg.assets?.symbol}</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{leg.assets?.company_name}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {leg.proposed_weight && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">Target Weight: </span>
                              <span className="font-medium text-red-600 dark:text-red-400">-{leg.proposed_weight.toFixed(2)}%</span>
                            </div>
                          )}
                          {leg.proposed_shares && (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">Shares: </span>
                              <span className="font-medium text-red-600 dark:text-red-400">-{leg.proposed_shares.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Rationale */}
                  {pairTrade.rationale && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        Rationale
                      </h3>
                      <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{pairTrade.rationale}</p>
                    </div>
                  )}

                  {/* Status Actions */}
                  {pairTrade.status !== 'approved' && pairTrade.status !== 'cancelled' && pairTrade.status !== 'rejected' && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Actions
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {/* Move to Modeling */}
                        {(pairTrade.status === 'idea' || pairTrade.status === 'discussing' || pairTrade.status === 'working_on') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updatePairTradeStatusMutation.mutate('simulating')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            <FlaskConical className="h-4 w-4 mr-1" />
                            Start Modeling
                          </Button>
                        )}
                        {/* Move to Deciding */}
                        {(pairTrade.status === 'simulating' || pairTrade.status === 'modeling') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => updatePairTradeStatusMutation.mutate('deciding')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            <Scale className="h-4 w-4 mr-1" />
                            Move to Deciding
                          </Button>
                        )}
                        {/* Decision actions (only in deciding stage) */}
                        {pairTrade.status === 'deciding' && (
                          <>
                            <Button
                              size="sm"
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
                          </>
                        )}
                        {/* Archive (for non-deciding stages) */}
                        {pairTrade.status !== 'deciding' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updatePairTradeStatusMutation.mutate('cancelled')}
                            disabled={updatePairTradeStatusMutation.isPending}
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Restore Actions for Archived Pair Trades */}
                  {(pairTrade.status === 'approved' || pairTrade.status === 'cancelled' || pairTrade.status === 'rejected') && (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Restore Pair Trade
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        This pair trade is archived. You can restore it to an active status.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => updatePairTradeStatusMutation.mutate('idea')}
                          disabled={updatePairTradeStatusMutation.isPending}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Restore as Idea
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => updatePairTradeStatusMutation.mutate('discussing')}
                          disabled={updatePairTradeStatusMutation.isPending}
                        >
                          <MessageSquare className="h-4 w-4 mr-1" />
                          Restore as Discussing
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Created by {pairTrade.users ? getUserDisplayName(pairTrade.users) : 'Unknown'}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(pairTrade.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              )}

              {/* Discussion Tab for Pair Trade */}
              {activeTab === 'discussion' && (
                <div className="flex flex-col h-full">
                  {/* Messages List */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {discussionMessages.length > 0 ? (
                      <div className="space-y-0.5">
                        {discussionMessages.map((message, index) => {
                          const prevMessage = index > 0 ? discussionMessages[index - 1] : null
                          const isSameUser = prevMessage && prevMessage.user_id === message.user_id
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
                    <div className="flex space-x-2">
                      <div className="flex-1">
                        <UniversalSmartInput ref={discussionInputRef} value={discussionMessage} onChange={(value, metadata) => { setDiscussionMessage(value); setDiscussionMetadata(metadata) }} onKeyDown={handleDiscussionKeyDown} placeholder="Add to the discussion..." textareaClassName="text-sm" rows={2} minHeight="60px" enableMentions={true} enableHashtags={true} enableTemplates={false} enableDataFunctions={false} enableAI={false} />
                      </div>
                      <button onClick={handleSendDiscussionMessage} disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending} className={clsx("self-end p-2 rounded-lg transition-colors", discussionMessage.trim() ? "bg-primary-600 text-white hover:bg-primary-700" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed")}><Send className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              )}

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
                              onClick={() => setSizingMode(mode.value as SizingMode)}
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
                  </div>

                  {/* ========== DISCUSSION SECTION ========== */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                      Comments {discussionMessages.length > 0 && <span className="text-gray-400">· {discussionMessages.length}</span>}
                    </h3>

                    {discussionMessages.length > 0 && (
                      <div className="space-y-3 mb-4 max-h-36 overflow-y-auto">
                        {discussionMessages.map((message) => (
                          <div key={message.id} className="flex gap-2">
                            <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">{getUserInitials(message.user)}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2">
                                <span className="text-xs font-medium text-gray-900 dark:text-white">{getUserDisplayName(message.user)}</span>
                                <span className="text-[10px] text-gray-400">{formatMessageTime(message.created_at)}</span>
                              </div>
                              <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                                <SmartInputRenderer content={message.content} inline />
                              </p>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    )}

                    <div className="flex gap-2 items-center">
                      <input
                        ref={discussionInputRef as any}
                        type="text"
                        value={discussionMessage}
                        onChange={(e) => setDiscussionMessage(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendDiscussionMessage() }}}
                        placeholder="Add a comment..."
                        className="flex-1 h-9 px-3 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                      <button onClick={handleSendDiscussionMessage} disabled={!discussionMessage.trim() || sendDiscussionMessageMutation.isPending} className={clsx("h-9 w-9 rounded-lg flex items-center justify-center transition-colors", discussionMessage.trim() ? "bg-primary-600 text-white hover:bg-primary-700" : "bg-gray-100 dark:bg-gray-800 text-gray-400")}>
                        <Send className="h-4 w-4" />
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
                    <div className="flex items-center justify-between">
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
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setShowProposalModal(true)}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Proposal
                      </Button>
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

                    {/* Empty state */}
                    {proposals.length === 0 ? (
                      <div className="text-center py-12">
                        <Users className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          No proposals yet
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          Team members can submit their sizing proposals for this trade idea
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Render grouped by portfolio when multiple portfolios exist */}
                        {hasMultiplePortfolios ? (
                          sortedPortfolioEntries.map(([portfolioId, { name: portfolioName, proposals: portfolioProposals }]) => (
                            <div key={portfolioId} className="space-y-3">
                              {/* Portfolio header */}
                              <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                                <Briefcase className="h-4 w-4 text-gray-400" />
                                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                  {portfolioName}
                                </h4>
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                  ({portfolioProposals.length})
                                </span>
                              </div>
                              {/* Proposals for this portfolio */}
                              {portfolioProposals.map((proposal) => {
                                const userName = proposal.users?.first_name && proposal.users?.last_name
                                  ? `${proposal.users.first_name} ${proposal.users.last_name}`
                                  : proposal.users?.email || 'Unknown'
                                const isCurrentUser = proposal.user_id === user?.id
                                const hasShares = proposal.shares !== null && proposal.shares !== undefined

                                const handleEditProposal = () => {
                                  setProposalWeight(proposal.weight?.toString() || '')
                                  setProposalShares(proposal.shares?.toString() || '')
                                  setProposalNotes(proposal.notes || '')
                                  setShowProposalModal(true)
                                }

                                return (
                                  <div
                                    key={proposal.id}
                                    className={clsx(
                                      "p-3 rounded-lg border transition-colors",
                                      isCurrentUser
                                        ? "bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 cursor-pointer hover:border-primary-300 dark:hover:border-primary-700"
                                        : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                                    )}
                                    onClick={isCurrentUser ? handleEditProposal : undefined}
                                    role={isCurrentUser ? "button" : undefined}
                                    tabIndex={isCurrentUser ? 0 : undefined}
                                    onKeyDown={isCurrentUser ? (e) => e.key === 'Enter' && handleEditProposal() : undefined}
                                  >
                                    {/* Compact layout: User + Size on same row */}
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <div className={clsx(
                                          "h-6 w-6 rounded-full flex items-center justify-center",
                                          isCurrentUser
                                            ? "bg-primary-100 dark:bg-primary-900/30"
                                            : "bg-gray-200 dark:bg-gray-700"
                                        )}>
                                          <User className={clsx(
                                            "h-3 w-3",
                                            isCurrentUser
                                              ? "text-primary-600 dark:text-primary-400"
                                              : "text-gray-500 dark:text-gray-400"
                                          )} />
                                        </div>
                                        <div className="flex items-baseline gap-2">
                                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                                            {userName}
                                            {isCurrentUser && (
                                              <span className="ml-1 text-xs text-primary-600 dark:text-primary-400">(You)</span>
                                            )}
                                          </span>
                                          <span className="text-xs text-gray-400 dark:text-gray-500">
                                            {formatDistanceToNow(new Date(proposal.created_at), { addSuffix: true })}
                                            {proposal.updated_at !== proposal.created_at && ' (edited)'}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {/* Size display */}
                                        <div className="text-right">
                                          <span className="text-lg font-semibold text-gray-900 dark:text-white">
                                            {proposal.weight !== null ? `${proposal.weight.toFixed(2)}%` : '—'}
                                          </span>
                                          {hasShares && (
                                            <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                                              ({proposal.shares!.toLocaleString()} sh)
                                            </span>
                                          )}
                                        </div>
                                        {isCurrentUser && (
                                          <button
                                            type="button"
                                            className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleEditProposal()
                                            }}
                                            title="Edit your proposal"
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {/* Notes - only show if has value, compact */}
                                    {proposal.notes && (
                                      <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                                        {proposal.notes}
                                      </p>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ))
                        ) : (
                          /* Single portfolio - render flat list */
                          <div className="space-y-2">
                            {sortedProposals.map((proposal) => {
                              const userName = proposal.users?.first_name && proposal.users?.last_name
                                ? `${proposal.users.first_name} ${proposal.users.last_name}`
                                : proposal.users?.email || 'Unknown'
                              const isCurrentUser = proposal.user_id === user?.id
                              const hasShares = proposal.shares !== null && proposal.shares !== undefined

                              const handleEditProposal = () => {
                                setProposalWeight(proposal.weight?.toString() || '')
                                setProposalShares(proposal.shares?.toString() || '')
                                setProposalNotes(proposal.notes || '')
                                setShowProposalModal(true)
                              }

                              return (
                                <div
                                  key={proposal.id}
                                  className={clsx(
                                    "p-3 rounded-lg border transition-colors",
                                    isCurrentUser
                                      ? "bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 cursor-pointer hover:border-primary-300 dark:hover:border-primary-700"
                                      : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                                  )}
                                  onClick={isCurrentUser ? handleEditProposal : undefined}
                                  role={isCurrentUser ? "button" : undefined}
                                  tabIndex={isCurrentUser ? 0 : undefined}
                                  onKeyDown={isCurrentUser ? (e) => e.key === 'Enter' && handleEditProposal() : undefined}
                                >
                                  {/* Compact layout: User + Size on same row */}
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className={clsx(
                                        "h-6 w-6 rounded-full flex items-center justify-center",
                                        isCurrentUser
                                          ? "bg-primary-100 dark:bg-primary-900/30"
                                          : "bg-gray-200 dark:bg-gray-700"
                                      )}>
                                        <User className={clsx(
                                          "h-3 w-3",
                                          isCurrentUser
                                            ? "text-primary-600 dark:text-primary-400"
                                            : "text-gray-500 dark:text-gray-400"
                                        )} />
                                      </div>
                                      <div className="flex items-baseline gap-2">
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                                          {userName}
                                          {isCurrentUser && (
                                            <span className="ml-1 text-xs text-primary-600 dark:text-primary-400">(You)</span>
                                          )}
                                        </span>
                                        <span className="text-xs text-gray-400 dark:text-gray-500">
                                          {formatDistanceToNow(new Date(proposal.created_at), { addSuffix: true })}
                                          {proposal.updated_at !== proposal.created_at && ' (edited)'}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {/* Size display */}
                                      <div className="text-right">
                                        <span className="text-lg font-semibold text-gray-900 dark:text-white">
                                          {proposal.weight !== null ? `${proposal.weight.toFixed(2)}%` : '—'}
                                        </span>
                                        {hasShares && (
                                          <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                                            ({proposal.shares!.toLocaleString()} sh)
                                          </span>
                                        )}
                                      </div>
                                      {isCurrentUser && (
                                        <button
                                          type="button"
                                          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleEditProposal()
                                          }}
                                          title="Edit your proposal"
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Notes - only show if has value, compact */}
                                  {proposal.notes && (
                                    <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                                      {proposal.notes}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}

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
              {activeTab === 'activity' && (
                <div className="p-4">
                  <EntityTimeline
                    entityType="trade_idea"
                    entityId={tradeId}
                    showHeader={true}
                    collapsible={false}
                    excludeActions={['attach', 'detach']}
                  />
                </div>
              )}
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
