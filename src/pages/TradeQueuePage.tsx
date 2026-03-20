import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Plus,
  Search,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Clock,
  Check,
  CheckCircle2,
  XCircle,
  AlertCircle,
  PlayCircle,
  GripVertical,
  Archive,
  Lightbulb,
  FlaskConical,
  History,
  ExternalLink,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  User,
  Briefcase,
  Link2,
  Scale,
  Gavel,
  Wrench,
  Trash2,
  Circle,
  MoreVertical,
  Lock,
  Users,
  Eye,
  SearchCode,
  Microscope,
  BrainCircuit,
  FileCheck,
  Timer,
  AlertTriangle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/common/EmptyState'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { AddTradeIdeaModal } from '../components/trading/AddTradeIdeaModal'
import { TradeIdeaDetailModal } from '../components/trading/TradeIdeaDetailModal'
import { DebateIndicatorBadge } from '../components/trading/DebateIndicatorBadge'
import { DecisionInboxPanel } from '../components/trading/DecisionInboxPanel'
import { getTradeActionLabel } from '../lib/trade-status-labels'
import { MultiSelectFilter } from '../components/ui/MultiSelectFilter'
import { useAllDecisionRequests } from '../hooks/useDecisionRequests'
import type {
  TradeQueueItemWithDetails,
  TradeQueueStatus,
  TradeAction,
  TradeQueueFilters,
  PairTradeWithDetails
} from '../types/trading'
import { getDerivedUrgency, getUrgencySeverity, DERIVED_URGENCY_CONFIG, type DerivedUrgency } from '../lib/derived-urgency'
import { clsx } from 'clsx'
import { useTradeExpressionCounts, getExpressionStatus } from '../hooks/useTradeExpressionCounts'
import { useTradeIdeaService } from '../hooks/useTradeIdeaService'
import { submitRecommendation } from '../lib/services/recommendation-service'
import { isCreatorOrCoAnalyst, getUserPortfolioRole, isPMForPortfolio } from '../lib/permissions/trade-idea-permissions'
import { RESEARCH_STAGES, RESEARCH_STAGE_CONFIG, toResearchStage } from '../lib/trade-status-semantics'
import type { ActionContext, TradeSizingMode, ResearchStage } from '../types/trading'

const STATUS_CONFIG: Record<TradeQueueStatus, { label: string; color: string; icon: React.ElementType }> = {
  idea: { label: 'Ideas', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', icon: Lightbulb },
  // New workflow stages
  working_on: { label: 'Working On', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', icon: Wrench },
  modeling: { label: 'Modeling', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', icon: FlaskConical },
  // Legacy stages (kept for backwards compat)
  discussing: { label: 'Working On', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', icon: Wrench },
  simulating: { label: 'Modeling', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', icon: FlaskConical },
  deciding: { label: 'Deciding', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', icon: Gavel },
  approved: { label: 'Committed', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', icon: XCircle },
  cancelled: { label: 'Deferred', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300', icon: XCircle },
  executed: { label: 'Executed', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
  deleted: { label: 'Deleted', color: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400', icon: Archive },
}

const STAGE_ICON: Record<ResearchStage, React.ElementType> = {
  aware: Eye,
  investigate: SearchCode,
  deep_research: Microscope,
  thesis_forming: BrainCircuit,
  ready_for_decision: Gavel,
}

const ACTION_CONFIG: Record<TradeAction, { label: string; color: string; icon: React.ElementType }> = {
  buy: { label: 'Buy', color: 'text-green-600 dark:text-green-400', icon: TrendingUp },
  sell: { label: 'Sell', color: 'text-red-600 dark:text-red-400', icon: TrendingDown },
  add: { label: 'Add', color: 'text-green-600 dark:text-green-400', icon: TrendingUp },
  trim: { label: 'Reduce', color: 'text-orange-600 dark:text-orange-400', icon: TrendingDown },
}

const CONVICTION_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  low: { label: 'Low', color: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400' },
  medium: { label: 'Med', color: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
  high: { label: 'High', color: 'text-green-600 dark:text-green-400', dot: 'bg-green-500' },
}

export function TradeQueuePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Trade service for audited mutations
  const { moveTrade, movePairTrade, isMoving, isMovingPairTrade } = useTradeIdeaService()

  // UI State — multi-select filters bridge to the legacy single-value TradeQueueFilters
  const [multiFilters, setMultiFilters] = useState<{
    actions: string[]
    derivedUrgencies: string[]
    portfolios: string[]
    owners: string[]
    search: string
  }>({ actions: [], derivedUrgencies: [], portfolios: [], owners: [], search: '' })

  // Bridge multi-select to legacy filter format (first selected value or 'all')
  const filters: TradeQueueFilters = {
    status: 'all',
    action: multiFilters.actions.length === 1 ? multiFilters.actions[0] as any : 'all',
    urgency: 'all',
    portfolio_id: multiFilters.portfolios.length === 1 ? multiFilters.portfolios[0] : 'all',
    created_by: multiFilters.owners.length === 1 ? multiFilters.owners[0] : 'all',
    search: multiFilters.search,
  }
  // For multi-value filtering, we override in the filter function below
  const setFilters = (updater: (prev: TradeQueueFilters) => TradeQueueFilters) => {
    const next = updater(filters)
    setMultiFilters(prev => ({ ...prev, search: next.search || '' }))
  }
  const [sortBy, setSortBy] = useState<'created_at' | 'urgency' | 'priority'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [selectedTradeInitialTab, setSelectedTradeInitialTab] = useState<'details' | 'debate' | 'decisions' | 'activity'>('details')
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  // Note: Post Trade section removed - outcomes are now discoverable via Outcomes page
  const [fourthColumnView, setFourthColumnView] = useState<'deciding' | 'executed' | 'rejected' | 'deferred' | 'archived' | 'deleted'>('deciding')
  const [fullscreenColumn, setFullscreenColumn] = useState<ResearchStage | TradeQueueStatus | 'archived' | null>(null)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)

  // Listen for openTradeIdeaModal event to open a specific idea's modal
  useEffect(() => {
    const handleOpenIdea = (e: Event) => {
      const { tradeId } = (e as CustomEvent).detail || {}
      if (tradeId) {
        setSelectedTradeId(tradeId)
        setSelectedTradeInitialTab('details')
      }
    }
    window.addEventListener('openTradeIdeaModal', handleOpenIdea as EventListener)
    return () => window.removeEventListener('openTradeIdeaModal', handleOpenIdea as EventListener)
  }, [])
  const [decisionPanelCollapsed, setDecisionPanelCollapsed] = useState(true)

  // Proposal modal state (for moving to deciding)
  const [showProposalModal, setShowProposalModal] = useState(false)
  const [proposalTradeId, setProposalTradeId] = useState<string | null>(null)
  const [proposalTrade, setProposalTrade] = useState<TradeQueueItemWithDetails | null>(null)
  const [proposalPairTrade, setProposalPairTrade] = useState<{ pairTradeId: string; pairTrade: any; legs: TradeQueueItemWithDetails[] } | null>(null)
  const [proposalWeight, setProposalWeight] = useState<string>('')
  const [proposalShares, setProposalShares] = useState<string>('')
  const [proposalNotes, setProposalNotes] = useState<string>('')
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false)
  // Sizing mode options for proposals
  type ProposalSizingMode = 'weight' | 'delta_weight' | 'active_weight' | 'delta_benchmark'

  // Multi-portfolio proposal state with sizing mode
  interface PortfolioProposalState {
    sizingMode: ProposalSizingMode
    value: string
    notes: string
  }
  const [portfolioProposals, setPortfolioProposals] = useState<Record<string, PortfolioProposalState>>({})

  // Linked portfolios with holding context
  interface LinkedPortfolioWithContext {
    id: string
    name: string
    benchmark: string | null
    // Current holding info for the asset
    currentShares: number
    currentPrice: number
    currentValue: number
    currentWeight: number
    // Benchmark info (if available)
    benchmarkWeight: number | null
    activeWeight: number | null
    // Portfolio totals for weight calculation
    portfolioTotalValue: number
  }
  const [linkedPortfolios, setLinkedPortfolios] = useState<LinkedPortfolioWithContext[]>([])
  // Per-leg holdings context for pair trades (keyed by legId:portfolioId)
  interface LegHoldingContext {
    currentShares: number
    currentWeight: number
    benchmarkWeight: number | null
    activeWeight: number | null
  }
  const [legHoldingsContext, setLegHoldingsContext] = useState<Record<string, LegHoldingContext>>({})
  // Track which portfolio proposal inputs are expanded in the modal
  const [expandedProposalInputs, setExpandedProposalInputs] = useState<Set<string>>(new Set())

  // Track which proposal groups are expanded in Deciding column
  const [expandedProposalGroups, setExpandedProposalGroups] = useState<Set<string>>(new Set())

  const toggleProposalGroup = (tradeId: string) => {
    setExpandedProposalGroups(prev => {
      const next = new Set(prev)
      if (next.has(tradeId)) {
        next.delete(tradeId)
      } else {
        next.add(tradeId)
      }
      return next
    })
  }

  // Fetch trade queue items
  const { data: tradeItems, isLoading, error } = useQuery({
    queryKey: ['trade-queue-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          *,
          assets (id, symbol, company_name, sector),
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          trade_queue_comments (id),
          trade_queue_votes (id, vote),
          pair_trades (id, name, description, rationale, urgency, status)
        `)
        .eq('visibility_tier', 'active')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error

      // Calculate vote summaries
      return (data || []).map(item => ({
        ...item,
        vote_summary: {
          approve: item.trade_queue_votes?.filter((v: any) => v.vote === 'approve').length || 0,
          reject: item.trade_queue_votes?.filter((v: any) => v.vote === 'reject').length || 0,
          needs_discussion: item.trade_queue_votes?.filter((v: any) => v.vote === 'needs_discussion').length || 0,
        }
      })) as TradeQueueItemWithDetails[]
    },
  })

  // Fetch pair trades with their legs
  const { data: pairTrades } = useQuery({
    queryKey: ['pair-trades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pair_trades')
        .select(`
          *,
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          trade_queue_items (
            id, asset_id, action, proposed_shares, proposed_weight, target_price,
            pair_leg_type, status, visibility_tier,
            assets (id, symbol, company_name, sector)
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      // Filter out trashed legs from pair trades
      return (data || []).filter(pt => pt != null).map(pairTrade => ({
        ...pairTrade,
        trade_queue_items: (pairTrade?.trade_queue_items || []).filter(
          (leg: any) => leg?.visibility_tier === 'active'
        )
      })) as PairTradeWithDetails[]
    },
  })

  // Fetch portfolios for filter dropdown
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

  // Build map of trade_queue_item_id → Set<portfolio_id> for committed trades.
  // Used to show green check on portfolio dropdown items in idea cards.
  const { data: committedTradeMap } = useQuery({
    queryKey: ['committed-trade-portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accepted_trades')
        .select('trade_queue_item_id, portfolio_id')
        .eq('is_active', true)
        .not('trade_queue_item_id', 'is', null)
      if (error) return new Map<string, Set<string>>()
      const map = new Map<string, Set<string>>()
      data?.forEach(at => {
        if (!at.trade_queue_item_id) return
        if (!map.has(at.trade_queue_item_id)) map.set(at.trade_queue_item_id, new Set())
        map.get(at.trade_queue_item_id)!.add(at.portfolio_id)
      })
      return map
    },
    staleTime: 30_000,
  })

  // Fetch team members from portfolios the current user is on (for "Created by" filter)
  const { data: teamMembers } = useQuery({
    queryKey: ['portfolio-team-members', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // First get the portfolios the current user is on
      const { data: userPortfolios, error: portfolioError } = await supabase
        .from('portfolio_team')
        .select('portfolio_id')
        .eq('user_id', user.id)

      if (portfolioError) throw portfolioError
      if (!userPortfolios?.length) return []

      const portfolioIds = userPortfolios.map(p => p.portfolio_id)

      // Then get all team members from those portfolios
      const { data: members, error: membersError } = await supabase
        .from('portfolio_team')
        .select(`
          user_id,
          user:users!inner (
            id,
            email,
            first_name,
            last_name
          )
        `)
        .in('portfolio_id', portfolioIds)

      if (membersError) throw membersError

      // Deduplicate users (they might be on multiple portfolios)
      const uniqueUsers = new Map<string, { id: string; email: string; first_name: string | null; last_name: string | null }>()
      members?.forEach((m: any) => {
        if (m.user && !uniqueUsers.has(m.user.id)) {
          uniqueUsers.set(m.user.id, m.user)
        }
      })

      return Array.from(uniqueUsers.values()).sort((a, b) => {
        const nameA = a.first_name || a.email || ''
        const nameB = b.first_name || b.email || ''
        return nameA.localeCompare(nameB)
      })
    },
    enabled: !!user?.id,
  })

  // Fetch expression counts for trade ideas (how many labs each idea is in)
  const { data: expressionCounts, isLoading: isExpressionCountsLoading } = useTradeExpressionCounts()

  // Compute selected portfolio name for portfolio-aware displays
  const selectedPortfolioName = useMemo(() => {
    if (!filters.portfolio_id || filters.portfolio_id === 'all' || !portfolios) {
      return null
    }
    const portfolio = portfolios.find(p => p.id === filters.portfolio_id)
    return portfolio?.name || null
  }, [filters.portfolio_id, portfolios])

  // Fetch decision requests for pending count (used by right-side Decision Inbox panel badge)
  const decisionPortfolioId = filters.portfolio_id !== 'all' ? filters.portfolio_id : undefined
  const { data: allDecisionRequests = [] } = useAllDecisionRequests(decisionPortfolioId)
  const needsDecisionCount = useMemo(
    () => allDecisionRequests.filter(r => ['pending', 'under_review', 'needs_discussion'].includes(r.status)).length,
    [allDecisionRequests]
  )

  // Fetch ALL active proposals for the Deciding column
  // Proposals appear in Deciding regardless of the trade idea's stage
  const { data: decidingProposals } = useQuery({
    queryKey: ['deciding-proposals', filters.portfolio_id],
    queryFn: async () => {
      // Fetch all active proposals with portfolio and trade item joins
      let query = supabase
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
          analyst_input_requested,
          analyst_input_requested_at,
          portfolios:portfolio_id (id, name),
          trade_queue_items:trade_queue_item_id (
            id,
            action,
            rationale,
            created_by,
            assigned_to,
            pair_trade_id,
            assets:asset_id (id, symbol, company_name)
          )
        `)
        .eq('is_active', true)

      // Filter by portfolio when specific one selected
      if (filters.portfolio_id && filters.portfolio_id !== 'all') {
        query = query.eq('portfolio_id', filters.portfolio_id)
      }

      const { data, error } = await query.order('updated_at', { ascending: false })

      if (error) throw error
      if (!data || data.length === 0) return []

      // Fetch user data separately from public.users (can't join to auth.users)
      const userIds = [...new Set(data.map((p: any) => p.user_id).filter(Boolean))]
      let userMap: Record<string, any> = {}

      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, email, first_name, last_name')
          .in('id', userIds)

        if (users) {
          userMap = Object.fromEntries(users.map(u => [u.id, u]))
        }
      }

      // Merge user data into proposals
      return data.map((proposal: any) => ({
        ...proposal,
        users: userMap[proposal.user_id] || null,
      }))
    },
    staleTime: 30000, // 30 seconds
  })

  // Group proposals by trade_queue_item_id for quick lookup
  const proposalsByTradeId = useMemo(() => {
    const map = new Map<string, ProposalData[]>()
    if (!decidingProposals) return map

    decidingProposals.forEach(proposal => {
      const existing = map.get(proposal.trade_queue_item_id) || []
      existing.push(proposal as ProposalData)
      map.set(proposal.trade_queue_item_id, existing)
    })

    return map
  }, [decidingProposals])

  // Group proposals by trade idea for Deciding column rendering
  // Separate single trade proposals from pair trade proposals
  const { nonPairTradeProposals, pairTradeProposalGroups } = useMemo(() => {
    if (!decidingProposals) return { nonPairTradeProposals: [], pairTradeProposalGroups: [] as Array<{ pairTradeId: string; proposals: ProposalData[] }> }

    const singleProposals: ProposalData[] = []
    const pairProposalsMap = new Map<string, ProposalData[]>()

    decidingProposals.forEach((p: any) => {
      // Check if this proposal has pair trade info in sizing_context
      let sizingContext = p.sizing_context
      if (typeof sizingContext === 'string') {
        try { sizingContext = JSON.parse(sizingContext) } catch { sizingContext = null }
      }

      if (sizingContext?.isPairTrade && sizingContext?.pairTradeId) {
        // This is a pair trade proposal - group by pairTradeId
        const pairId = sizingContext.pairTradeId
        if (!pairProposalsMap.has(pairId)) {
          pairProposalsMap.set(pairId, [])
        }
        pairProposalsMap.get(pairId)!.push(p as ProposalData)
      } else {
        // Check if the trade item is part of a pair trade (legacy check)
        const tradeItem = p.trade_queue_items
        if (tradeItem?.pair_trade_id) {
          // This is an old-format pair trade leg proposal - skip it for now
          // (it will show in the pair trade card if the pair trade is in Deciding)
        } else {
          // Single trade proposal
          singleProposals.push(p as ProposalData)
        }
      }
    })

    // Convert map to array
    const pairGroups = Array.from(pairProposalsMap.entries()).map(([pairTradeId, proposals]) => ({
      pairTradeId,
      proposals
    }))

    return { nonPairTradeProposals: singleProposals, pairTradeProposalGroups: pairGroups }
  }, [decidingProposals])

  // Set of pair trade IDs that already have proposals — used to dedup
  // pair trade idea cards from the deciding section when a proposal exists.
  const pairIdsWithProposals = useMemo(
    () => new Set(pairTradeProposalGroups.map(g => g.pairTradeId)),
    [pairTradeProposalGroups]
  )

  // Fetch portfolios where current user is PM (for portfolio-specific decision permissions)
  const { data: userPMPortfolios } = useQuery({
    queryKey: ['user-pm-portfolios', user?.id],
    queryFn: async () => {
      if (!user?.id) return new Set<string>()

      const { data, error } = await supabase
        .from('portfolio_team')
        .select('portfolio_id')
        .eq('user_id', user.id)
        .eq('role', 'Portfolio Manager')

      if (error) {
        console.error('Failed to fetch user PM portfolios:', error)
        return new Set<string>()
      }

      return new Set(data?.map(d => d.portfolio_id) || [])
    },
    enabled: !!user?.id,
    staleTime: 60000, // 1 minute cache
  })

  // Helper to check if user is PM for a specific portfolio
  const isPMForPortfolioId = useCallback((portfolioId: string) => {
    // Admin always has PM access
    if (user?.role === 'admin') return true
    // Check portfolio-specific PM role
    return userPMPortfolios?.has(portfolioId) || false
  }, [userPMPortfolios, user?.role])

  // Get unique trade IDs from active proposals for track status lookup
  const proposalTradeIds = useMemo(() => {
    if (!decidingProposals) return []
    return [...new Set(decidingProposals.map((p: any) => p.trade_queue_item_id))]
  }, [decidingProposals])

  // Fetch portfolio track statuses for proposals (to show accepted/rejected/deferred)
  const { data: portfolioTrackStatuses } = useQuery({
    queryKey: ['portfolio-track-statuses', proposalTradeIds],
    queryFn: async () => {
      if (proposalTradeIds.length === 0) return new Map()

      const { data, error } = await supabase
        .from('trade_idea_portfolios')
        .select('trade_queue_item_id, portfolio_id, decision_outcome, deferred_until')
        .in('trade_queue_item_id', proposalTradeIds)

      if (error) throw error

      // Create a map: `${tradeId}-${portfolioId}` -> status
      const statusMap = new Map<string, { decision_outcome: string | null; deferred_until: string | null }>()
      data?.forEach(track => {
        const key = `${track.trade_queue_item_id}-${track.portfolio_id}`
        statusMap.set(key, {
          decision_outcome: track.decision_outcome,
          deferred_until: track.deferred_until,
        })
      })

      return statusMap
    },
    enabled: proposalTradeIds.length > 0,
    staleTime: 30000,
  })

  // Split proposals into pending (deciding) vs committed based on track status
  const groupedDecidingProposals = useMemo(() => {
    const pending = portfolioTrackStatuses
      ? nonPairTradeProposals.filter((p: any) => {
          const key = `${p.trade_queue_item_id}-${p.portfolio_id}`
          const track = portfolioTrackStatuses.get(key)
          return !track?.decision_outcome || track.decision_outcome === null
        })
      : nonPairTradeProposals
    return groupProposalsByTradeIdea(pending as ProposalData[])
  }, [nonPairTradeProposals, portfolioTrackStatuses])

  // Fetch committed proposals — proposals on ideas where the portfolio track decision is 'accepted'
  const { data: committedProposalsRaw } = useQuery({
    queryKey: ['committed-proposals', filters.portfolio_id],
    queryFn: async () => {
      // Step 1: Get accepted portfolio tracks
      let trackQuery = supabase
        .from('trade_idea_portfolios')
        .select('trade_queue_item_id, portfolio_id')
        .eq('decision_outcome', 'accepted')
      if (filters.portfolio_id && filters.portfolio_id !== 'all') {
        trackQuery = trackQuery.eq('portfolio_id', filters.portfolio_id)
      }
      const { data: tracks } = await trackQuery
      if (!tracks || tracks.length === 0) return []

      // Step 2: Fetch proposals for those trade/portfolio combos
      const tradeIds = [...new Set(tracks.map(t => t.trade_queue_item_id))]
      const { data: proposals, error } = await supabase
        .from('trade_proposals')
        .select(`
          id, trade_queue_item_id, user_id, portfolio_id, weight, shares, notes,
          is_active, created_at, updated_at, sizing_context, proposal_type,
          portfolios:portfolio_id (id, name),
          trade_queue_items:trade_queue_item_id (
            id, action, rationale, created_by, assigned_to, pair_trade_id,
            assets:asset_id (id, symbol, company_name)
          )
        `)
        .in('trade_queue_item_id', tradeIds)

      if (error || !proposals?.length) return []

      // Step 3: Attach user data
      const userIds = [...new Set(proposals.map((p: any) => p.user_id).filter(Boolean))]
      let userMap: Record<string, any> = {}
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, email, first_name, last_name')
          .in('id', userIds)
        users?.forEach(u => { userMap[u.id] = u })
      }

      return proposals.map((p: any) => ({ ...p, users: userMap[p.user_id] || null }))
    },
    staleTime: 30000,
  })

  const groupedCommittedProposals = useMemo(() => {
    if (!committedProposalsRaw) return []
    return groupProposalsByTradeIdea(committedProposalsRaw as ProposalData[])
  }, [committedProposalsRaw])

  // Fetch simulations with their linked trade queue items (for pretrade section)
  const { data: simulations } = useQuery({
    queryKey: ['simulations-with-trades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('simulations')
        .select(`
          *,
          portfolios (id, name, portfolio_id),
          users:created_by (id, email, first_name, last_name),
          simulation_trades (
            id,
            trade_queue_item_id,
            asset_id,
            action,
            shares,
            weight,
            price,
            assets (id, symbol, company_name, sector)
          )
        `)
        .in('status', ['draft', 'running'])
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
  })

  // Update trade item priority mutation
  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: number }) => {
      const { error } = await supabase
        .from('trade_queue_items')
        .update({ priority })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
    },
  })

  // Acknowledge resurfaced item mutation (restore to original status)
  const acknowledgeResurfacedMutation = useMutation({
    mutationFn: async (item: TradeQueueItemWithDetails) => {
      // Get the original status from previous_state, default to 'idea'
      const previousState = item.previous_state as { status?: string } | null
      const originalStatus = previousState?.status || 'idea'

      const { error } = await supabase
        .from('trade_queue_items')
        .update({
          status: originalStatus,
          stage: originalStatus,
          outcome: null,
          deferred_until: null,
          previous_state: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)

      if (error) throw error
      return item.id
    },
    onSuccess: (itemId) => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-detail', itemId] })
      queryClient.invalidateQueries({ queryKey: ['trade-detail'] })
    },
  })

  // Withdraw proposal mutation - for proposal owners to cancel their proposal
  const withdrawProposalMutation = useMutation({
    mutationFn: async (proposalId: string) => {
      // Set is_active = false to withdraw the proposal
      const { error } = await supabase
        .from('trade_proposals')
        .update({ is_active: false })
        .eq('id', proposalId)
        .eq('user_id', user?.id) // Only allow owner to withdraw

      if (error) throw error
      return proposalId
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deciding-proposals'] })
      queryClient.invalidateQueries({ queryKey: ['trade-proposals'] })
    },
  })

  // Archived statuses (excluding cancelled/deferred which has its own view)
  const archivedStatuses: TradeQueueStatus[] = ['executed', 'rejected', 'approved', 'archived']
  // Deferred status (cancelled = deferred in legacy mapping)
  const deferredStatuses: TradeQueueStatus[] = ['cancelled']

  // Helper to check if a deferred item is ready to resurface
  const isDeferredAndReady = (item: TradeQueueItemWithDetails): boolean => {
    if (!deferredStatuses.includes(item.status)) return false
    if (!item.deferred_until) return false // No resurface date = stays deferred

    // Get the intended deferred date (stored as UTC midnight)
    const deferredUntil = new Date(item.deferred_until)
    const now = new Date()

    // Extract the intended date from UTC (what the user picked)
    const deferredYear = deferredUntil.getUTCFullYear()
    const deferredMonth = deferredUntil.getUTCMonth()
    const deferredDay = deferredUntil.getUTCDate()

    // Get user's local date
    const nowYear = now.getFullYear()
    const nowMonth = now.getMonth()
    const nowDay = now.getDate()

    // Compare: resurface when local date >= intended deferred date
    const deferredDateValue = new Date(deferredYear, deferredMonth, deferredDay).getTime()
    const nowDateValue = new Date(nowYear, nowMonth, nowDay).getTime()

    return nowDateValue >= deferredDateValue
  }

  // Get the stage a resurfaced item should return to
  const getResurfaceStage = (item: TradeQueueItemWithDetails): TradeQueueStatus => {
    // Check if previous_state has the original status
    const previousState = item.previous_state as { status?: TradeQueueStatus } | null
    if (previousState?.status && !deferredStatuses.includes(previousState.status)) {
      return previousState.status
    }
    // Default to 'idea' as a safe starting point
    return 'idea'
  }

  // Filter and sort items (excluding archived)
  const filteredItems = useMemo(() => {
    if (!tradeItems || !Array.isArray(tradeItems)) return []

    return tradeItems
      .filter(item => item != null)
      .filter(item => {
        // Exclude archived, deferred, and deleted items from main view
        // BUT include deferred items whose deferred_until date has passed
        if (archivedStatuses.includes(item.status)) return false
        if (deferredStatuses.includes(item.status) && !isDeferredAndReady(item)) return false
        if (item.status === 'deleted') return false
        if (filters.status && filters.status !== 'all' && item.status !== filters.status) return false
        // Multi-select: urgency
        if (multiFilters.derivedUrgencies.length > 0) {
          const du = getDerivedUrgency(item.stage || item.status, item.updated_at || item.created_at)
          if (!du || !multiFilters.derivedUrgencies.includes(du)) return false
        }
        // Multi-select: action
        if (multiFilters.actions.length > 0 && !multiFilters.actions.includes(item.action)) return false

        // Multi-select: portfolio filtering with track awareness
        if (multiFilters.portfolios.length > 0) {
          const labInfo = expressionCounts?.get(item.id)
          const isLinkedToAnySelected = multiFilters.portfolios.some(pid =>
            item.portfolio_id === pid || labInfo?.portfolioIds?.includes(pid)
          )
          if (!isLinkedToAnySelected) return false
        } else if (filters.portfolio_id && filters.portfolio_id !== 'all') {
          // Legacy single-portfolio path (for decision inbox pass-through)
          const labInfo = expressionCounts?.get(item.id)
          const isLinkedToPortfolio = item.portfolio_id === filters.portfolio_id ||
            labInfo?.portfolioIds?.includes(filters.portfolio_id)
          if (!isLinkedToPortfolio) return false
          const portfolioTrackStatus = labInfo?.portfolioTrackStatus?.get(filters.portfolio_id)
          if (portfolioTrackStatus) {
            if (portfolioTrackStatus.decisionOutcome === 'accepted' ||
                portfolioTrackStatus.decisionOutcome === 'deferred' ||
                portfolioTrackStatus.decisionOutcome === 'rejected') {
              return false
            }
          }
        }

        // Multi-select: owner
        if (multiFilters.owners.length > 0 && !multiFilters.owners.includes(item.created_by || '')) return false
        if (filters.search) {
          const search = filters.search.toLowerCase()
          const matchesSymbol = item.assets?.symbol?.toLowerCase().includes(search)
          const matchesCompany = item.assets?.company_name?.toLowerCase().includes(search)
          const matchesRationale = item.rationale?.toLowerCase().includes(search)
          if (!matchesSymbol && !matchesCompany && !matchesRationale) return false
        }
        return true
      })
      .sort((a, b) => {
        const order = sortOrder === 'asc' ? 1 : -1
        if (sortBy === 'created_at') {
          return order * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        }
        if (sortBy === 'urgency') {
          const aU = getUrgencySeverity(getDerivedUrgency(a.stage || a.status, a.updated_at || a.created_at))
          const bU = getUrgencySeverity(getDerivedUrgency(b.stage || b.status, b.updated_at || b.created_at))
          return order * (aU - bU)
        }
        if (sortBy === 'priority') {
          return order * (a.priority - b.priority)
        }
        return 0
      })
  }, [tradeItems, filters, multiFilters, sortBy, sortOrder])

  // Archived items (separate from active, excludes deferred)
  const archivedItems = useMemo(() => {
    if (!tradeItems) return []
    return tradeItems.filter(item => archivedStatuses.includes(item.status))
  }, [tradeItems])

  // Deferred items (cancelled status in legacy mapping)
  // Exclude items that are past their deferred_until date (they resurface in Deciding)
  const deferredItems = useMemo(() => {
    if (!tradeItems) return []
    return tradeItems.filter(item =>
      deferredStatuses.includes(item.status) && !isDeferredAndReady(item)
    )
  }, [tradeItems])

  // Deleted items (soft-deleted trade ideas)
  const deletedItems = useMemo(() => {
    if (!tradeItems) return []
    return tradeItems.filter(item => item.status === 'deleted')
  }, [tradeItems])

  // Pretrade items - approved items that are linked to simulations
  const pretradeItems = useMemo(() => {
    if (!tradeItems || !simulations) return []

    // Get all trade_queue_item_ids that are in simulations
    const tradeIdsInSimulations = new Set<string>()
    simulations.forEach(sim => {
      sim.simulation_trades?.forEach((trade: any) => {
        if (trade.trade_queue_item_id) {
          tradeIdsInSimulations.add(trade.trade_queue_item_id)
        }
      })
    })

    // Return approved items that are in simulations
    return tradeItems.filter(item =>
      item.status === 'approved' && tradeIdsInSimulations.has(item.id)
    )
  }, [tradeItems, simulations])

  // Get simulation info for a trade queue item
  const getSimulationForTrade = useCallback((tradeId: string) => {
    if (!simulations) return null
    return simulations.find(sim =>
      sim.simulation_trades?.some((trade: any) => trade.trade_queue_item_id === tradeId)
    )
  }, [simulations])

  // Group pair trade items by pair_id (or pair_trade_id for legacy data)
  const pairTradeGroups = useMemo(() => {
    if (!filteredItems || !Array.isArray(filteredItems)) return new Map<string, { pairTrade: any; legs: TradeQueueItemWithDetails[] }>()

    const groups = new Map<string, { pairTrade: any; legs: TradeQueueItemWithDetails[] }>()

    filteredItems.filter(item => item != null).forEach(item => {
      // Support both pair_id (new) and pair_trade_id (legacy)
      const pairId = item?.pair_id || item?.pair_trade_id
      if (pairId) {
        if (!groups.has(pairId)) {
          // Generate pairTrade metadata from the first leg if no pair_trades join exists
          const pairTradeData = item?.pair_trades || {
            id: pairId,
            name: 'Pair Trade',
            description: null,
            rationale: item?.rationale || null,
            urgency: item?.urgency || 'medium',
            status: item?.status
          }
          groups.set(pairId, {
            pairTrade: pairTradeData,
            legs: []
          })
        }
        groups.get(pairId)!.legs.push(item)
      }
    })

    return groups
  }, [filteredItems])

  // Get IDs of items that are part of pair trades (to exclude from individual display)
  const pairTradeItemIds = useMemo(() => {
    const ids = new Set<string>()
    pairTradeGroups.forEach(group => {
      group.legs.forEach(leg => ids.add(leg.id))
    })
    return ids
  }, [pairTradeGroups])

  // Group items by research stage for kanban view (excluding individual pair trade legs)
  const itemsByStage = useMemo(() => {
    const groups: Record<ResearchStage, TradeQueueItemWithDetails[]> = {
      aware: [],
      investigate: [],
      deep_research: [],
      thesis_forming: [],
      ready_for_decision: [],
    }

    filteredItems.forEach(item => {
      // Skip items that are part of pair trades - they'll be shown as grouped cards
      if (pairTradeItemIds.has(item.id)) return

      // Resurfaced deferred items go back to their original stage (or Aware if unknown)
      let researchStage: ResearchStage
      if (isDeferredAndReady(item)) {
        const returnStage = getResurfaceStage(item)
        researchStage = toResearchStage(returnStage) || 'aware'
      } else {
        researchStage = toResearchStage(item.stage) || 'aware'
      }
      groups[researchStage].push(item)
    })

    return groups
  }, [filteredItems, pairTradeItemIds])

  // Legacy itemsByStatus kept for backward compat (fourth column views)
  const itemsByStatus = useMemo(() => {
    const groups: Record<string, TradeQueueItemWithDetails[]> = {
      deciding: [],
      approved: [],
      rejected: [],
      cancelled: [],
      deleted: [],
    }
    filteredItems.forEach(item => {
      if (pairTradeItemIds.has(item.id)) return
      if (groups[item.status]) groups[item.status].push(item)
    })
    return groups
  }, [filteredItems, pairTradeItemIds])

  // Group pair trades by research stage
  const pairTradesByStage = useMemo(() => {
    const groups: Record<ResearchStage, Array<{ pairTradeId: string; pairTrade: any; legs: TradeQueueItemWithDetails[] }>> = {
      aware: [],
      investigate: [],
      deep_research: [],
      thesis_forming: [],
      ready_for_decision: [],
    }

    pairTradeGroups.forEach((group, pairTradeId) => {
      if (!group?.pairTrade) return
      const stage = toResearchStage(group.pairTrade.status as string) || 'aware'
      groups[stage].push({ pairTradeId, ...group })
    })

    return groups
  }, [pairTradeGroups])

  // Legacy pairTradesByStatus for fourth column
  const pairTradesByStatus = useMemo(() => {
    const groups: Record<string, Array<{ pairTradeId: string; pairTrade: any; legs: TradeQueueItemWithDetails[] }>> = {
      deciding: [],
      approved: [],
      rejected: [],
      cancelled: [],
      deleted: [],
    }

    pairTradeGroups.forEach((group, pairTradeId) => {
      if (!group?.pairTrade) return
      const status = group.pairTrade.status as string
      if (groups[status]) groups[status].push({ pairTradeId, ...group })
    })

    return groups
  }, [pairTradeGroups])

  // Drag handlers - use dataTransfer to pass the item ID reliably
  // Permission check: can this user move this item through stages?
  const canUserMoveItem = useCallback((item: { created_by: string | null; assigned_to: string | null; collaborators?: string[] | null }) => {
    if (!user?.id) return false
    return isCreatorOrCoAnalyst(user.id, item)
  }, [user?.id])

  const handleDragStart = useCallback((e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('text/plain', itemId)
    e.dataTransfer.setData('type', 'item')
    e.dataTransfer.effectAllowed = 'move'
    setDraggedItem(itemId)
  }, [])

  // Drag handler for pair trade cards
  const handlePairTradeDragStart = useCallback((e: React.DragEvent, pairTradeId: string) => {
    e.dataTransfer.setData('text/plain', pairTradeId)
    e.dataTransfer.setData('type', 'pair-trade')
    e.dataTransfer.effectAllowed = 'move'
    setDraggedItem(pairTradeId)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetStatus: TradeQueueStatus | ResearchStage) => {
    e.preventDefault()

    // Get the item ID and type from dataTransfer
    const itemId = e.dataTransfer.getData('text/plain')
    const dragType = e.dataTransfer.getData('type')

    if (!itemId) {
      console.error('No item ID found in dataTransfer')
      setDraggedItem(null)
      return
    }

    // Research stages + legacy global stages that only creator/assigned/co-analysts can move
    const globalStages: string[] = ['idea', 'discussing', 'working_on', 'simulating', 'modeling', ...RESEARCH_STAGES]
    const isGlobalStageMove = globalStages.includes(targetStatus)

    // Handle pair trade drag - uses audited service
    if (dragType === 'pair-trade') {
      const pairTradeGroup = pairTradeGroups.get(itemId)
      if (!pairTradeGroup) {
        console.error('Pair trade group not found')
        setDraggedItem(null)
        return
      }

      if (pairTradeGroup.pairTrade.status === targetStatus) {
        setDraggedItem(null)
        return
      }

      // Permission check for global stage movement
      // Only creator, assigned analyst, or co-analysts can move through global stages
      if (isGlobalStageMove) {
        const firstLeg = pairTradeGroup.legs[0]
        if (firstLeg && user?.id) {
          const canMove = isCreatorOrCoAnalyst(user.id, {
            created_by: firstLeg.created_by,
            assigned_to: firstLeg.assigned_to,
            collaborators: firstLeg.collaborators,
          })
          if (!canMove) {
            console.warn('Permission denied: Only creator, assigned analyst, or co-analysts can move trade ideas through global stages')
            setDraggedItem(null)
            return
          }
        }
      }

      // When moving to deciding/ready_for_decision, show proposal modal first
      if (targetStatus === 'deciding' || targetStatus === 'ready_for_decision') {
        setProposalPairTrade({ pairTradeId: itemId, pairTrade: pairTradeGroup.pairTrade, legs: pairTradeGroup.legs })
        setProposalTradeId(itemId)
        setShowProposalModal(true)
        setDraggedItem(null)
        return
      }

      // Use audited service for pair trade move
      movePairTrade({ pairTradeId: itemId, targetStatus, uiSource: 'drag_drop' })
      setDraggedItem(null)
      return
    }

    // Handle individual item drag
    const item = tradeItems?.find(i => i.id === itemId)

    if (!item) {
      console.error('Item not found in tradeItems')
      setDraggedItem(null)
      return
    }

    // No-op check: compare against item's resolved research stage
    const itemResearchStage = toResearchStage(item.stage)
    if (itemResearchStage === targetStatus || item.status === targetStatus) {
      setDraggedItem(null)
      return
    }

    // Permission check for global stage movement
    // Only creator, assigned analyst, or co-analysts can move through global stages
    if (isGlobalStageMove && user?.id) {
      const canMove = isCreatorOrCoAnalyst(user.id, {
        created_by: item.created_by,
        assigned_to: item.assigned_to,
        collaborators: item.collaborators,
      })
      if (!canMove) {
        console.warn('Permission denied: Only creator, assigned analyst, or co-analysts can move trade ideas through global stages')
        setDraggedItem(null)
        return
      }
    }

    // When moving to deciding/ready_for_decision, show proposal modal first
    if (targetStatus === 'deciding' || targetStatus === 'ready_for_decision') {
      setProposalTradeId(itemId)
      setProposalTrade(item)
      setShowProposalModal(true)
      setDraggedItem(null)
      return
    }

    // Use audited service for trade move — pass research stage directly
    moveTrade({ tradeId: itemId, targetStatus: targetStatus as TradeQueueStatus, uiSource: 'drag_drop' })
    setDraggedItem(null)
  }, [tradeItems, pairTradeGroups, moveTrade, movePairTrade, user?.id])

  const handleSort = useCallback((field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }, [sortBy])

  // Handle lab click - navigate to trade lab
  const handleLabClick = useCallback((labId: string, labName: string, portfolioId: string) => {
    window.dispatchEvent(new CustomEvent('openTradeLab', {
      detail: { labId, labName, portfolioId }
    }))
  }, [])

  // ESC key handler for fullscreen mode
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && fullscreenColumn) {
        setFullscreenColumn(null)
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => document.removeEventListener('keydown', handleEscKey)
  }, [fullscreenColumn])

  // Fetch linked portfolios with holding context when proposal modal opens
  useEffect(() => {
    if (!proposalTradeId || !showProposalModal || (!proposalTrade && !proposalPairTrade)) {
      setLinkedPortfolios([])
      setPortfolioProposals({})
      setExpandedProposalInputs(new Set())
      setLegHoldingsContext({})
      return
    }

    const fetchLinkedPortfoliosWithContext = async () => {
      // For pair trades, use first leg's asset_id for holdings lookup
      const assetId = proposalTrade?.asset_id || proposalPairTrade?.legs[0]?.asset_id
      // For pair trades, use first leg's id for link lookup
      const linkLookupId = proposalTrade ? proposalTradeId : proposalPairTrade?.legs[0]?.id

      // Get portfolios via trade_lab_idea_links -> trade_labs -> portfolios
      const { data: links, error } = await supabase
        .from('trade_lab_idea_links')
        .select(`
          trade_labs!inner (
            portfolio_id,
            portfolios!inner (id, name, benchmark)
          )
        `)
        .eq('trade_queue_item_id', linkLookupId)

      let portfolioMap = new Map<string, { id: string; name: string; benchmark: string | null }>()

      if (!error && links) {
        links.forEach((link: any) => {
          const portfolio = link.trade_labs?.portfolios
          if (portfolio) {
            portfolioMap.set(portfolio.id, { id: portfolio.id, name: portfolio.name, benchmark: portfolio.benchmark })
          }
        })
      }

      // If no linked portfolios, fall back to trade's own portfolio
      if (portfolioMap.size === 0 && proposalTrade?.portfolio_id) {
        const { data: portfolio } = await supabase
          .from('portfolios')
          .select('id, name, benchmark')
          .eq('id', proposalTrade.portfolio_id)
          .single()
        if (portfolio) {
          portfolioMap.set(portfolio.id, { id: portfolio.id, name: portfolio.name, benchmark: portfolio.benchmark })
        }
      }

      const portfolioIds = Array.from(portfolioMap.keys())
      if (portfolioIds.length === 0) {
        setLinkedPortfolios([])
        setExpandedProposalInputs(new Set())
        setLegHoldingsContext({})
        return
      }

      // Fetch all holdings for these portfolios to calculate total values and current positions
      const { data: allHoldings } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, asset_id, shares, price')
        .in('portfolio_id', portfolioIds)

      // Calculate portfolio totals
      const portfolioTotals = new Map<string, number>()
      // For pair trades, track holdings per asset per portfolio
      const allAssetHoldings = new Map<string, { shares: number; price: number; value: number }>() // key: portfolioId:assetId

      allHoldings?.forEach((h: any) => {
        const value = (h.shares || 0) * (h.price || 0)
        portfolioTotals.set(h.portfolio_id, (portfolioTotals.get(h.portfolio_id) || 0) + value)

        // Store by portfolioId:assetId
        allAssetHoldings.set(`${h.portfolio_id}:${h.asset_id}`, {
          shares: h.shares || 0,
          price: h.price || 0,
          value
        })
      })

      // Build per-leg holdings context for pair trades
      if (proposalPairTrade) {
        const legContext: Record<string, LegHoldingContext> = {}
        for (const leg of proposalPairTrade.legs) {
          for (const [portfolioId] of portfolioMap) {
            const totalValue = portfolioTotals.get(portfolioId) || 0
            const holding = allAssetHoldings.get(`${portfolioId}:${leg.asset_id}`)
            const currentWeight = totalValue > 0 && holding ? (holding.value / totalValue) * 100 : 0
            // TODO: Fetch benchmark weights when benchmark_holdings table is available
            const benchmarkWeight = null
            const activeWeight = benchmarkWeight !== null ? currentWeight - benchmarkWeight : null

            legContext[`${leg.id}:${portfolioId}`] = {
              currentShares: holding?.shares || 0,
              currentWeight,
              benchmarkWeight,
              activeWeight
            }
          }
        }
        setLegHoldingsContext(legContext)
      }

      // Build linked portfolios with context (for single trade, use first asset)
      const allPortfoliosWithContext: LinkedPortfolioWithContext[] = Array.from(portfolioMap.values()).map(p => {
        const totalValue = portfolioTotals.get(p.id) || 0
        const holding = allAssetHoldings.get(`${p.id}:${assetId}`)
        const currentWeight = totalValue > 0 && holding ? (holding.value / totalValue) * 100 : 0

        // TODO: Fetch benchmark weights when benchmark_holdings table is available
        const benchmarkWeight = null
        const activeWeight = benchmarkWeight !== null ? currentWeight - benchmarkWeight : null

        return {
          id: p.id,
          name: p.name,
          benchmark: p.benchmark,
          currentShares: holding?.shares || 0,
          currentPrice: holding?.price || 0,
          currentValue: holding?.value || 0,
          currentWeight,
          benchmarkWeight,
          activeWeight,
          portfolioTotalValue: totalValue
        }
      })

      // Filter portfolios based on user visibility
      // - Creator, assigned analyst, co-analysts see ALL linked portfolios
      // - PMs only see portfolios they manage
      let portfoliosWithContext = allPortfoliosWithContext
      if (user?.id) {
        const tradeIdea = proposalTrade || proposalPairTrade?.legs[0]
        if (tradeIdea) {
          const isCreatorOrAnalyst = isCreatorOrCoAnalyst(user.id, {
            created_by: tradeIdea.created_by,
            assigned_to: tradeIdea.assigned_to,
            collaborators: tradeIdea.collaborators,
          })

          // If user is not creator/assigned/co-analyst, filter to only their PM portfolios
          if (!isCreatorOrAnalyst) {
            const visiblePortfolios: LinkedPortfolioWithContext[] = []
            for (const portfolio of allPortfoliosWithContext) {
              const isPM = await isPMForPortfolio(user.id, portfolio.id)
              if (isPM) {
                visiblePortfolios.push(portfolio)
              }
            }
            portfoliosWithContext = visiblePortfolios
          }
        }
      }

      setLinkedPortfolios(portfoliosWithContext)

      // Initialize proposal state for each portfolio (or each leg+portfolio for pair trades)
      const initialProposals: Record<string, PortfolioProposalState> = {}
      if (proposalPairTrade) {
        // For pair trades, key by legId:portfolioId
        proposalPairTrade.legs.forEach(leg => {
          portfoliosWithContext.forEach(p => {
            initialProposals[`${leg.id}:${p.id}`] = { sizingMode: 'weight', value: '', notes: '' }
          })
        })
      } else {
        portfoliosWithContext.forEach(p => {
          initialProposals[p.id] = { sizingMode: 'weight', value: '', notes: '' }
        })
      }
      setPortfolioProposals(initialProposals)
    }

    fetchLinkedPortfoliosWithContext()
  }, [proposalTradeId, showProposalModal, proposalTrade, proposalPairTrade])

  if (isLoading) {
    return (
      <div className="p-6">
        <ListSkeleton count={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="p-6">
          <p className="text-red-600 dark:text-red-400">Error loading trade queue: {(error as Error).message}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trade Queue</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Collaborate on trade ideas and run simulations
            </p>
          </div>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Trade Idea
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {/* Search */}
          <div className="relative min-w-[180px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder="Search trades..."
              value={multiFilters.search}
              onChange={(e) => setMultiFilters(prev => ({ ...prev, search: e.target.value }))}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 hidden sm:inline">Filters</span>

          {/* Group 1: Portfolio + Owner */}
          <div className="flex items-center gap-1.5">
            <MultiSelectFilter
              label="Portfolio"
              options={portfolios?.map(p => ({ value: p.id, label: p.name })) || []}
              selected={multiFilters.portfolios}
              onChange={v => setMultiFilters(prev => ({ ...prev, portfolios: v }))}
            />
            <MultiSelectFilter
              label="Owner"
              options={[
                ...(user ? [{ value: user.id, label: 'My Ideas' }] : []),
                ...(teamMembers?.filter(m => m.id !== user?.id).map(m => ({
                  value: m.id,
                  label: m.first_name ? `${m.first_name}${m.last_name ? ' ' + m.last_name : ''}` : m.email?.split('@')[0] || 'Unknown',
                })) || []),
              ]}
              selected={multiFilters.owners}
              onChange={v => setMultiFilters(prev => ({ ...prev, owners: v }))}
            />
          </div>

          <span className="hidden sm:inline text-gray-200 dark:text-gray-600 select-none">|</span>

          {/* Group 2: Action + Urgency */}
          <div className="flex items-center gap-1.5">
            <MultiSelectFilter
              label="Action"
              options={Object.entries(ACTION_CONFIG).map(([key, config]) => ({ value: key, label: config.label }))}
              selected={multiFilters.actions}
              onChange={v => setMultiFilters(prev => ({ ...prev, actions: v }))}
            />
            <MultiSelectFilter
              label="Status"
              options={Object.entries(DERIVED_URGENCY_CONFIG).map(([key, config]) => ({ value: key, label: config.label }))}
              selected={multiFilters.derivedUrgencies}
              onChange={v => setMultiFilters(prev => ({ ...prev, derivedUrgencies: v }))}
            />
          </div>

          <span className="hidden sm:inline text-gray-200 dark:text-gray-600 select-none">|</span>

          {/* Group 3: Sort */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Sort</span>
            <div className="flex items-center bg-gray-100 dark:bg-gray-700/50 rounded-md p-0.5">
              <button
                onClick={() => handleSort('created_at')}
                className={clsx(
                  "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors",
                  sortBy === 'created_at'
                    ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                Date
                {sortBy === 'created_at' && <ArrowUpDown className="h-3 w-3" />}
              </button>
              <button
                onClick={() => handleSort('urgency')}
                className={clsx(
                  "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors",
                  sortBy === 'urgency'
                    ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                Staleness
                {sortBy === 'urgency' && <ArrowUpDown className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content — kanban fills area, Decision Inbox overlays from bottom */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-auto px-6 pb-14 flex flex-col">
        {filteredItems.length === 0 && deletedItems.length === 0 && archivedItems.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No trade ideas yet"
                description="Add your first trade idea to start collaborating with your team"
                action={
                  <Button onClick={() => setShowAddModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Trade Idea
                  </Button>
                }
              />
            ) : (
              <div className="flex-1 flex flex-col pt-6 min-h-0 overflow-hidden">
                {/* Fixed column headers */}
                <div className={clsx(
                  "gap-3 flex-shrink-0 pb-2",
                  fullscreenColumn
                    ? "grid grid-cols-1"
                    : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
                )}>
                  {RESEARCH_STAGES.map((stage) => {
                    const stageConfig = RESEARCH_STAGE_CONFIG[stage]
                    const StageIcon = STAGE_ICON[stage]
                    const items = itemsByStage[stage]
                    const pairs = pairTradesByStage[stage]

                    if (fullscreenColumn && fullscreenColumn !== stage) return null

                    return (
                      <div key={stage} className="flex items-center gap-2 px-2 pb-1 border-b border-gray-100 dark:border-gray-700/50">
                        <StageIcon className={clsx("h-4.5 w-4.5", stageConfig.iconColor)} />
                        <h2 className="font-semibold text-gray-900 dark:text-white text-sm truncate" title={stageConfig.label}>
                          {stageConfig.shortLabel}
                        </h2>
                        {(items.length + pairs.length) > 0 ? (
                          <span className="ml-auto shrink-0 flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
                            {items.length + pairs.length}
                          </span>
                        ) : (
                          <span className="ml-auto shrink-0 flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-xs font-medium text-gray-400 dark:text-gray-500 tabular-nums">
                            0
                          </span>
                        )}
                        <button
                          onClick={() => setFullscreenColumn(fullscreenColumn === stage ? null : stage)}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors shrink-0"
                          title={fullscreenColumn === stage ? "Exit fullscreen" : "Fullscreen"}
                        >
                          {fullscreenColumn === stage ? (
                            <Minimize2 className="h-4 w-4 text-gray-400" />
                          ) : (
                            <Maximize2 className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>

                {/* Scrollable card columns */}
                <div className={clsx(
                  "gap-3 flex-1 min-h-0 overflow-y-auto pt-2",
                  fullscreenColumn
                    ? "grid grid-cols-1"
                    : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
                )}>
                  {RESEARCH_STAGES.map((stage, stageIdx) => {
                    const stageConfig = RESEARCH_STAGE_CONFIG[stage]
                    const StageIcon = STAGE_ICON[stage]
                    const items = itemsByStage[stage]
                    const pairs = pairTradesByStage[stage]
                    const prevStage = stageIdx > 0 ? RESEARCH_STAGES[stageIdx - 1] : null
                    const nextStage = stageIdx < RESEARCH_STAGES.length - 1 ? RESEARCH_STAGES[stageIdx + 1] : null

                    if (fullscreenColumn && fullscreenColumn !== stage) return null

                    return (
                      <div
                        key={stage}
                        className="flex flex-col"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, stage)}
                      >
                        <div className={clsx(
                          "flex-1 rounded-lg border-2 border-dashed border-b-0 rounded-b-none p-2 transition-colors",
                          draggedItem
                            ? "border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10"
                            : "border-gray-200 dark:border-gray-700"
                        )}>
                          <div className={clsx(
                            "gap-2",
                            fullscreenColumn === stage
                              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                              : "space-y-2"
                          )}>
                            {/* Pair Trade Cards */}
                            {pairs.map(({ pairTradeId, pairTrade, legs }) => (
                              <PairTradeCard
                                key={pairTradeId}
                                pairTradeId={pairTradeId}
                                pairTrade={pairTrade}
                                legs={legs}
                                isDragging={draggedItem === pairTradeId}
                                onDragStart={(e) => handlePairTradeDragStart(e, pairTradeId)}
                                onDragEnd={handleDragEnd}
                                expressionCounts={expressionCounts}
                                onPairClick={(pairId) => { setSelectedTradeId(pairId); setSelectedTradeInitialTab('details') }}
                                onRecommendationClick={() => { setSelectedTradeId(pairTradeId); setSelectedTradeInitialTab('decisions') }}
                                onLabClick={handleLabClick}
                                canMoveLeft={!!prevStage}
                                canMoveRight={!!nextStage}
                                onMoveLeft={prevStage ? () => movePairTrade({ pairTradeId, targetStatus: prevStage as any, uiSource: 'arrow_button' }) : undefined}
                                onMoveRight={nextStage ? () => movePairTrade({ pairTradeId, targetStatus: nextStage as any, uiSource: 'arrow_button' }) : undefined}
                                currentUserId={user?.id}
                                onProposalClick={stage === 'ready_for_decision' ? () => {
                                  setSelectedTradeId(pairTradeId)
                                  setSelectedTradeInitialTab('decisions')
                                } : undefined}
                                recStateLoading={isExpressionCountsLoading}
                                committedTradeMap={committedTradeMap}
                              />
                            ))}
                            {/* Individual Trade Cards */}
                            {items.map(item => (
                              <TradeQueueCard
                                key={item.id}
                                item={item}
                                isDragging={draggedItem === item.id}
                                expressionCounts={expressionCounts}
                                onDragStart={(e) => handleDragStart(e, item.id)}
                                onDragEnd={handleDragEnd}
                                onClick={() => { setSelectedTradeId(item.id); setSelectedTradeInitialTab('details') }}
                                onDebateClick={() => { setSelectedTradeId(item.id); setSelectedTradeInitialTab('debate') }}
                                onRecommendationClick={() => { setSelectedTradeId(item.id); setSelectedTradeInitialTab('decisions') }}
                                onLabClick={handleLabClick}
                                onAcknowledgeResurfaced={() => acknowledgeResurfacedMutation.mutate(item)}
                                canMoveLeft={!!prevStage && canUserMoveItem(item)}
                                canMoveRight={!!nextStage && canUserMoveItem(item)}
                                onMoveLeft={prevStage ? () => moveTrade({ tradeId: item.id, targetStatus: prevStage as any, uiSource: 'arrow_button' }) : undefined}
                                onMoveRight={nextStage ? () => moveTrade({ tradeId: item.id, targetStatus: nextStage as any, uiSource: 'arrow_button' }) : undefined}
                                onProposalClick={stage === 'ready_for_decision' ? () => {
                                  setProposalTradeId(item.id)
                                  setProposalTrade(item)
                                  setShowProposalModal(true)
                                } : undefined}
                                recStateLoading={isExpressionCountsLoading}
                                committedTradeMap={committedTradeMap}
                              />
                            ))}
                            {/* Empty state */}
                            {items.length === 0 && pairs.length === 0 && (
                              <div className="flex flex-col items-center justify-center py-8 text-center px-3">
                                <StageIcon className="h-8 w-8 text-gray-300 dark:text-gray-600 mb-3" />
                                {stage === 'thesis_forming' ? (
                                  <>
                                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">Refine before recommending</p>
                                    <ul className="text-[11px] text-gray-500 dark:text-gray-400 text-left space-y-1 list-none">
                                      <li className="flex items-start gap-1.5"><span className="text-indigo-400 mt-px">•</span> Clear bull / bear thesis defined</li>
                                      <li className="flex items-start gap-1.5"><span className="text-indigo-400 mt-px">•</span> Catalysts and timing identified</li>
                                      <li className="flex items-start gap-1.5"><span className="text-indigo-400 mt-px">•</span> Key risks pressure-tested</li>
                                    </ul>
                                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">Move here when ready to structure a recommendation.</p>
                                  </>
                                ) : stage === 'ready_for_decision' ? (
                                  <>
                                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Research complete</p>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Ideas here are mature enough for a formal recommendation and PM review.</p>
                                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">Drag ideas here or use the arrow buttons.</p>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{stageConfig.description}</p>
                                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Drag ideas here</p>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                </div>

              </div>
            )}
        </div>

        {/* Bottom drawer: Decision Inbox — overlays upward over kanban */}
        <DecisionInboxPanel
          portfolioId={decisionPortfolioId}
          onIdeaClick={(tradeId) => { setSelectedTradeId(tradeId); setSelectedTradeInitialTab('details') }}
          collapsed={decisionPanelCollapsed}
          onToggleCollapsed={() => setDecisionPanelCollapsed(prev => !prev)}
          pendingCount={needsDecisionCount}
          searchQuery={filters.search || ''}
          actionFilter={filters.action || 'all'}
          urgencyFilter={filters.urgency || 'all'}
          createdByFilter={filters.created_by || 'all'}
        />
      </div>

      {/* Modals */}
      <AddTradeIdeaModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => {
          setShowAddModal(false)
          queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
        }}
      />


      {selectedTradeId && (
        <TradeIdeaDetailModal
          isOpen={!!selectedTradeId}
          tradeId={selectedTradeId}
          initialTab={selectedTradeInitialTab}
          onClose={() => {
            setSelectedTradeId(null)
            setSelectedTradeInitialTab('details')
          }}
          onNavigateToIdea={(ideaId) => {
            setSelectedTradeId(ideaId)
            setSelectedTradeInitialTab('details')
          }}
        />
      )}

      {/* Proposal Modal - shown when moving to Deciding */}
      {showProposalModal && (proposalTrade || proposalPairTrade) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setShowProposalModal(false)
              setProposalTradeId(null)
              setProposalTrade(null)
              setProposalPairTrade(null)
              setPortfolioProposals({})
              setLinkedPortfolios([])
              setExpandedProposalInputs(new Set())
            }}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 p-6 h-[70vh] flex flex-col">
            {/* Fixed Header */}
            <div className="flex-shrink-0">
              {proposalPairTrade ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                      <Link2 className="h-4 w-4" />
                      <span className="text-sm">Pair Trade</span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Submit Decision Request
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <span className="text-green-600 dark:text-green-400 font-medium">
                      BUY: {proposalPairTrade.legs.filter(l => l.pair_leg_type === 'long' || (l.pair_leg_type === null && l.action === 'buy')).map(l => l.assets?.symbol).join(', ') || '—'}
                    </span>
                    <span className="text-gray-400">/</span>
                    <span className="text-red-600 dark:text-red-400 font-medium">
                      SELL: {proposalPairTrade.legs.filter(l => l.pair_leg_type === 'short' || (l.pair_leg_type === null && l.action === 'sell')).map(l => l.assets?.symbol).join(', ') || '—'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Moving this pair trade to Deciding. Add sizing recommendations for each leg.
                  </p>
                </>
              ) : proposalTrade ? (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Submit Decision Request for {proposalTrade.assets?.symbol}
                    {proposalTrade.assets?.company_name && (
                      <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                        {proposalTrade.assets.company_name}
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {linkedPortfolios.length > 1
                      ? `This trade idea is linked to ${linkedPortfolios.length} portfolios. Review current positions and enter your sizing recommendation for each.`
                      : 'Review the current position and enter your sizing recommendation.'}
                  </p>
                </>
              ) : null}
            </div>

            {/* Scrollable Content */}
            {proposalPairTrade ? (
              /* Pair Trade Proposal Content - show portfolio sizing for each leg */
              linkedPortfolios.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
                  <div className="animate-pulse">Loading portfolios...</div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1">
                  {/* Organize by portfolio, showing legs within each */}
                  {linkedPortfolios.map((portfolio) => {
                    const longLegs = proposalPairTrade.legs.filter(l => l.pair_leg_type === 'long' || (l.pair_leg_type === null && l.action === 'buy'))
                    const shortLegs = proposalPairTrade.legs.filter(l => l.pair_leg_type === 'short' || (l.pair_leg_type === null && l.action === 'sell'))

                    // Check if any leg in this portfolio has a proposal
                    const hasAnyProposal = proposalPairTrade.legs.some(leg => {
                      const proposal = portfolioProposals[`${leg.id}:${portfolio.id}`]
                      return proposal?.value
                    })

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
                          </div>
                          {hasAnyProposal && (
                            <span className="text-xs text-green-600 dark:text-green-400 font-medium">✓</span>
                          )}
                        </div>

                        {/* Legs Grid - Buy and Sell side by side */}
                        <div className="grid grid-cols-2 gap-3">
                          {/* Buy Side */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 mb-2">
                              <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                              <span className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase">Buy</span>
                            </div>
                            {longLegs.map((leg) => {
                              const proposalKey = `${leg.id}:${portfolio.id}`
                              const proposal = portfolioProposals[proposalKey]
                              const sizingMode = proposal?.sizingMode || 'weight'
                              const legContext = legHoldingsContext[proposalKey]

                              return (
                                <div key={leg.id} className="p-2 rounded border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                                      {leg.assets?.symbol}
                                    </span>
                                    {proposal?.value && (
                                      <span className="text-xs text-green-600 dark:text-green-400">
                                        {proposal.value}%
                                      </span>
                                    )}
                                  </div>
                                  {/* Current Position Context */}
                                  <div className="grid grid-cols-3 gap-1 mb-1.5 text-[10px]">
                                    <div>
                                      <span className="text-gray-500 dark:text-gray-400">Port: </span>
                                      <span className="font-medium text-gray-700 dark:text-gray-300">
                                        {legContext?.currentWeight?.toFixed(2) ?? '0.00'}%
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500 dark:text-gray-400">Bench: </span>
                                      <span className="font-medium text-gray-700 dark:text-gray-300">
                                        {legContext?.benchmarkWeight !== null ? `${legContext.benchmarkWeight.toFixed(2)}%` : '—'}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500 dark:text-gray-400">Active: </span>
                                      <span className={clsx(
                                        "font-medium",
                                        legContext?.activeWeight === null ? "text-gray-700 dark:text-gray-300" :
                                        legContext.activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                        legContext.activeWeight < 0 ? "text-red-600 dark:text-red-400" :
                                        "text-gray-700 dark:text-gray-300"
                                      )}>
                                        {legContext?.activeWeight !== null
                                          ? `${legContext.activeWeight >= 0 ? '+' : ''}${legContext.activeWeight.toFixed(2)}%`
                                          : '—'}
                                      </span>
                                    </div>
                                  </div>
                                  {/* Sizing Mode Selector */}
                                  <div className="grid grid-cols-4 gap-0.5 mb-1.5">
                                    {sizingModes.map((mode) => {
                                      const isDisabled = (mode.value === 'active_weight' || mode.value === 'delta_benchmark') && legContext?.benchmarkWeight === null
                                      return (
                                        <button
                                          key={mode.value}
                                          type="button"
                                          disabled={isDisabled}
                                          onClick={() => setPortfolioProposals(prev => ({
                                            ...prev,
                                            [proposalKey]: { ...prev[proposalKey], sizingMode: mode.value, value: '' }
                                          }))}
                                          className={clsx(
                                            "px-0.5 py-0.5 text-[10px] rounded border transition-colors truncate",
                                            sizingMode === mode.value
                                              ? "bg-green-100 dark:bg-green-900/30 border-green-500 text-green-700 dark:text-green-300"
                                              : isDisabled
                                              ? "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 cursor-not-allowed"
                                              : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-green-400"
                                          )}
                                          title={isDisabled ? 'No benchmark data' : mode.label}
                                        >
                                          {mode.label}
                                        </button>
                                      )
                                    })}
                                  </div>
                                  <input
                                    type="text"
                                    value={proposal?.value || ''}
                                    onChange={(e) => setPortfolioProposals(prev => ({
                                      ...prev,
                                      [proposalKey]: { ...prev[proposalKey], sizingMode: sizingMode, value: e.target.value }
                                    }))}
                                    placeholder={sizingModes.find(m => m.value === sizingMode)?.placeholder || ''}
                                    className="w-full h-6 px-2 text-xs border border-green-300 dark:border-green-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-green-500 focus:border-green-500"
                                  />
                                </div>
                              )
                            })}
                            {longLegs.length === 0 && (
                              <div className="text-xs text-gray-400 italic p-2">No long positions</div>
                            )}
                          </div>

                          {/* Sell Side */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 mb-2">
                              <TrendingDown className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                              <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase">Sell</span>
                            </div>
                            {shortLegs.map((leg) => {
                              const proposalKey = `${leg.id}:${portfolio.id}`
                              const proposal = portfolioProposals[proposalKey]
                              const sizingMode = proposal?.sizingMode || 'weight'
                              const legContext = legHoldingsContext[proposalKey]

                              return (
                                <div key={leg.id} className="p-2 rounded border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                                      {leg.assets?.symbol}
                                    </span>
                                    {proposal?.value && (
                                      <span className="text-xs text-red-600 dark:text-red-400">
                                        {proposal.value}%
                                      </span>
                                    )}
                                  </div>
                                  {/* Current Position Context */}
                                  <div className="grid grid-cols-3 gap-1 mb-1.5 text-[10px]">
                                    <div>
                                      <span className="text-gray-500 dark:text-gray-400">Port: </span>
                                      <span className="font-medium text-gray-700 dark:text-gray-300">
                                        {legContext?.currentWeight?.toFixed(2) ?? '0.00'}%
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500 dark:text-gray-400">Bench: </span>
                                      <span className="font-medium text-gray-700 dark:text-gray-300">
                                        {legContext?.benchmarkWeight !== null ? `${legContext.benchmarkWeight.toFixed(2)}%` : '—'}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500 dark:text-gray-400">Active: </span>
                                      <span className={clsx(
                                        "font-medium",
                                        legContext?.activeWeight === null ? "text-gray-700 dark:text-gray-300" :
                                        legContext.activeWeight > 0 ? "text-green-600 dark:text-green-400" :
                                        legContext.activeWeight < 0 ? "text-red-600 dark:text-red-400" :
                                        "text-gray-700 dark:text-gray-300"
                                      )}>
                                        {legContext?.activeWeight !== null
                                          ? `${legContext.activeWeight >= 0 ? '+' : ''}${legContext.activeWeight.toFixed(2)}%`
                                          : '—'}
                                      </span>
                                    </div>
                                  </div>
                                  {/* Sizing Mode Selector */}
                                  <div className="grid grid-cols-4 gap-0.5 mb-1.5">
                                    {sizingModes.map((mode) => {
                                      const isDisabled = (mode.value === 'active_weight' || mode.value === 'delta_benchmark') && legContext?.benchmarkWeight === null
                                      return (
                                        <button
                                          key={mode.value}
                                          type="button"
                                          disabled={isDisabled}
                                          onClick={() => setPortfolioProposals(prev => ({
                                            ...prev,
                                            [proposalKey]: { ...prev[proposalKey], sizingMode: mode.value, value: '' }
                                          }))}
                                          className={clsx(
                                            "px-0.5 py-0.5 text-[10px] rounded border transition-colors truncate",
                                            sizingMode === mode.value
                                              ? "bg-red-100 dark:bg-red-900/30 border-red-500 text-red-700 dark:text-red-300"
                                              : isDisabled
                                              ? "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 cursor-not-allowed"
                                              : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-red-400"
                                          )}
                                          title={isDisabled ? 'No benchmark data' : mode.label}
                                        >
                                          {mode.label}
                                        </button>
                                      )
                                    })}
                                  </div>
                                  <input
                                    type="text"
                                    value={proposal?.value || ''}
                                    onChange={(e) => setPortfolioProposals(prev => ({
                                      ...prev,
                                      [proposalKey]: { ...prev[proposalKey], sizingMode: sizingMode, value: e.target.value }
                                    }))}
                                    placeholder={sizingModes.find(m => m.value === sizingMode)?.placeholder || ''}
                                    className="w-full h-6 px-2 text-xs border border-red-300 dark:border-red-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-red-500 focus:border-red-500"
                                  />
                                </div>
                              )
                            })}
                            {shortLegs.length === 0 && (
                              <div className="text-xs text-gray-400 italic p-2">No short positions</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Enter sizing proposals for each leg within each portfolio. Leave empty to skip.
                  </p>
                </div>
              )
            ) : linkedPortfolios.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
                <div className="animate-pulse">Loading portfolios...</div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1">
                {linkedPortfolios.map((portfolio) => {
                  const proposal = portfolioProposals[portfolio.id]
                  const sizingMode = proposal?.sizingMode || 'weight'
                  const hasPosition = portfolio.currentShares > 0

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

                      {/* Expandable Proposal Section */}
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
                          {expandedProposalInputs.has(portfolio.id) ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          {proposal?.value ? (
                            <span className="text-primary-600 dark:text-primary-400">
                              Rec: {proposal.value}% ({sizingModes.find(m => m.value === sizingMode)?.label})
                            </span>
                          ) : (
                            'Add Recommendation'
                          )}
                        </span>
                        {proposal?.value && (
                          <span className="text-green-600 dark:text-green-400">✓</span>
                        )}
                      </button>

                      {/* Collapsible Proposal Input Section */}
                      {expandedProposalInputs.has(portfolio.id) && (
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
                                    onClick={() => setPortfolioProposals(prev => ({
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
                              value={proposal?.value || ''}
                              onChange={(e) => setPortfolioProposals(prev => ({
                                ...prev,
                                [portfolio.id]: { ...prev[portfolio.id], value: e.target.value }
                              }))}
                              placeholder={sizingModes.find(m => m.value === sizingMode)?.placeholder || ''}
                              className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                            {/* Helper text showing what the value means */}
                            {proposal?.value && (
                              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {sizingMode === 'weight' && `Target weight: ${proposal.value}%`}
                                {sizingMode === 'delta_weight' && (
                                  parseFloat(proposal.value) > 0
                                    ? `Increase weight by ${proposal.value}% → ${(portfolio.currentWeight + parseFloat(proposal.value)).toFixed(2)}%`
                                    : parseFloat(proposal.value) < 0
                                    ? `Decrease weight by ${Math.abs(parseFloat(proposal.value))}% → ${(portfolio.currentWeight + parseFloat(proposal.value)).toFixed(2)}%`
                                    : `No change from current ${portfolio.currentWeight.toFixed(2)}%`
                                )}
                                {sizingMode === 'active_weight' && portfolio.benchmarkWeight !== null &&
                                  `Target active: ${proposal.value}% (weight: ${(portfolio.benchmarkWeight + parseFloat(proposal.value || '0')).toFixed(2)}%)`
                                }
                                {sizingMode === 'delta_benchmark' && portfolio.benchmarkWeight !== null && (
                                  `Change vs bench by ${proposal.value}%`
                                )}
                              </div>
                            )}
                          </div>

                          {/* Notes */}
                          <div>
                            <input
                              type="text"
                              value={proposal?.notes || ''}
                              onChange={(e) => setPortfolioProposals(prev => ({
                                ...prev,
                                [portfolio.id]: { ...prev[portfolio.id], notes: e.target.value }
                              }))}
                              placeholder="Notes (optional)"
                              className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Select a proposal type and enter your sizing recommendation. Leave empty to skip a portfolio.
                </p>
              </div>
            )}

            {/* Fixed Footer */}
            <div className="flex-shrink-0 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowProposalModal(false)
                  setProposalTradeId(null)
                  setProposalTrade(null)
                  setProposalPairTrade(null)
                  setPortfolioProposals({})
                  setLinkedPortfolios([])
                }}
              >
                Cancel
              </Button>
              {/* Regular trade submit button */}
              {!proposalPairTrade && (
              <Button
                onClick={async () => {
                  if (!user || !proposalTradeId) return
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

                    // Create proposals for each portfolio that has data
                    for (const portfolio of linkedPortfolios) {
                      const proposal = portfolioProposals[portfolio.id]
                      if (proposal && proposal.value) {
                        const numValue = parseFloat(proposal.value)
                        if (isNaN(numValue)) continue

                        // Determine proposal_type based on user's role for this portfolio
                        const userRole = await getUserPortfolioRole(user.id, portfolio.id)
                        const proposalType = userRole === 'pm' ? 'pm_initiated' : 'analyst'

                        // Convert sizing mode to database format and calculate weight
                        let weight: number | null = null
                        let sizingMode: TradeSizingMode = 'weight'

                        switch (proposal.sizingMode) {
                          case 'weight':
                            weight = numValue
                            sizingMode = 'weight'
                            break
                          case 'delta_weight':
                            // Store the delta, calculate target weight for display
                            weight = portfolio.currentWeight + numValue
                            sizingMode = 'delta_weight'
                            break
                          case 'active_weight':
                            // Active weight = target weight - benchmark weight
                            // So target weight = active weight + benchmark weight
                            if (portfolio.benchmarkWeight !== null) {
                              weight = portfolio.benchmarkWeight + numValue
                            }
                            sizingMode = 'delta_benchmark'
                            break
                          case 'delta_benchmark':
                            // Change vs benchmark
                            if (portfolio.benchmarkWeight !== null && portfolio.activeWeight !== null) {
                              // New active = current active + delta
                              const newActive = portfolio.activeWeight + numValue
                              weight = portfolio.benchmarkWeight + newActive
                            }
                            sizingMode = 'delta_benchmark'
                            break
                        }

                        // Store sizing context for reference
                        const sizingContext = {
                          proposalType: proposal.sizingMode,
                          inputValue: numValue,
                          currentWeight: portfolio.currentWeight,
                          currentShares: portfolio.currentShares,
                          benchmarkWeight: portfolio.benchmarkWeight,
                          activeWeight: portfolio.activeWeight,
                        }

                        await submitRecommendation({
                          tradeQueueItemId: proposalTradeId,
                          portfolioId: portfolio.id,
                          weight,
                          shares: null,
                          sizingMode: sizingMode,
                          sizingContext: sizingContext,
                          notes: proposal.notes || null,
                          proposalType: proposalType,
                          requestedAction: proposalTrade?.action || null,
                          assetSymbol: proposalTrade?.assets?.symbol || null,
                          assetCompanyName: proposalTrade?.assets?.company_name || null,
                          portfolioName: portfolio.name || null,
                        }, context)
                      }
                    }

                    // Don't move trade idea - it stays in its current stage (e.g., modeling)
                    // Only the proposal cards appear in the Deciding column

                    // Invalidate proposals and decision inbox
                    queryClient.invalidateQueries({ queryKey: ['trade-proposals', proposalTradeId] })
                    queryClient.invalidateQueries({ queryKey: ['deciding-proposals'] })
                    queryClient.invalidateQueries({ queryKey: ['decision-requests'] })

                    // Close modal and reset
                    setShowProposalModal(false)
                    setProposalTradeId(null)
                    setProposalTrade(null)
                    setProposalPairTrade(null)
                    setPortfolioProposals({})
                    setLinkedPortfolios([])
                  } catch (error) {
                    console.error('Failed to submit proposals:', error)
                  } finally {
                    setIsSubmittingProposal(false)
                  }
                }}
                disabled={isSubmittingProposal || linkedPortfolios.length === 0}
                loading={isSubmittingProposal}
              >
                <Scale className="h-4 w-4 mr-1.5" />
                Submit Proposal
              </Button>
              )}
              {/* Pair Trade Submit - creates ONE proposal per portfolio for the pair trade */}
              {proposalPairTrade && (
                <Button
                  onClick={async () => {
                    if (!user) return
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

                      // Create ONE proposal per portfolio for the entire pair trade
                      for (const portfolio of linkedPortfolios) {
                        // First, delete any old per-leg proposals for this portfolio
                        // This ensures we have a clean state for the new unified proposal
                        const legIds = proposalPairTrade.legs.map(l => l.id)
                        await supabase
                          .from('trade_proposals')
                          .delete()
                          .in('trade_queue_item_id', legIds)
                          .eq('portfolio_id', portfolio.id)
                          .eq('user_id', user.id)

                        // Determine proposal_type based on user's role for this portfolio
                        const userRole = await getUserPortfolioRole(user.id, portfolio.id)
                        const proposalType = userRole === 'pm' ? 'pm_initiated' : 'analyst'

                        // Collect sizing for ALL legs in this portfolio
                        const legSizing: Array<{
                          legId: string
                          symbol: string
                          action: 'buy' | 'sell'
                          weight: number | null
                          sizingMode: string
                          inputValue: number | null
                        }> = []

                        let hasAnySizing = false

                        for (const leg of proposalPairTrade.legs) {
                          const proposalKey = `${leg.id}:${portfolio.id}`
                          const proposal = portfolioProposals[proposalKey]
                          const legContext = legHoldingsContext[proposalKey]
                          const isLong = leg.pair_leg_type === 'long' || (leg.pair_leg_type === null && leg.action === 'buy')

                          if (proposal && proposal.value) {
                            const numValue = parseFloat(proposal.value)
                            if (!isNaN(numValue)) {
                              hasAnySizing = true

                              const currentWeight = legContext?.currentWeight ?? 0
                              const benchmarkWeight = legContext?.benchmarkWeight ?? null
                              const activeWeight = legContext?.activeWeight ?? null

                              let weight: number | null = null
                              let sizingMode = proposal.sizingMode

                              switch (proposal.sizingMode) {
                                case 'weight':
                                  weight = numValue
                                  break
                                case 'delta_weight':
                                  weight = currentWeight + numValue
                                  break
                                case 'active_weight':
                                  if (benchmarkWeight !== null) {
                                    weight = benchmarkWeight + numValue
                                  }
                                  break
                                case 'delta_benchmark':
                                  if (benchmarkWeight !== null && activeWeight !== null) {
                                    weight = benchmarkWeight + (activeWeight + numValue)
                                  }
                                  break
                              }

                              legSizing.push({
                                legId: leg.id,
                                symbol: leg.assets?.symbol || '?',
                                action: isLong ? 'buy' : 'sell',
                                weight,
                                sizingMode,
                                inputValue: numValue,
                              })
                            }
                          } else {
                            // Include leg even without sizing so it shows in display
                            legSizing.push({
                              legId: leg.id,
                              symbol: leg.assets?.symbol || '?',
                              action: isLong ? 'buy' : 'sell',
                              weight: null,
                              sizingMode: 'weight',
                              inputValue: null,
                            })
                          }
                        }

                        // Only create proposal if we have at least one leg with sizing
                        if (hasAnySizing) {
                          // Use first leg as the reference trade_queue_item_id
                          const firstLeg = proposalPairTrade.legs[0]

                          // Store all leg sizing in the sizing_context
                          const sizingContext = {
                            isPairTrade: true,
                            pairTradeId: proposalPairTrade.pairTradeId,
                            legs: legSizing,
                          }

                          await submitRecommendation({
                            tradeQueueItemId: firstLeg.id,
                            portfolioId: portfolio.id,
                            weight: null,
                            shares: null,
                            sizingMode: 'weight' as TradeSizingMode,
                            sizingContext: sizingContext,
                            notes: null,
                            proposalType: proposalType,
                            requestedAction: firstLeg.action || null,
                            assetSymbol: firstLeg.assets?.symbol || null,
                            assetCompanyName: firstLeg.assets?.company_name || null,
                            portfolioName: portfolio.name || null,
                          }, context)
                        }
                      }

                      // Don't move the pair trade - it stays in its current stage
                      // The proposal cards will appear in the Deciding column

                      // Invalidate caches
                      queryClient.invalidateQueries({ queryKey: ['pair-trades'] })
                      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
                      queryClient.invalidateQueries({ queryKey: ['deciding-proposals'] })
                      queryClient.invalidateQueries({ queryKey: ['trade-proposals', proposalPairTrade.legs[0]?.id] })

                      // Close modal and reset
                      setShowProposalModal(false)
                      setProposalTradeId(null)
                      setProposalTrade(null)
                      setProposalPairTrade(null)
                      setPortfolioProposals({})
                      setLinkedPortfolios([])
                    } catch (error) {
                      console.error('Failed to submit pair trade proposals:', error)
                    } finally {
                      setIsSubmittingProposal(false)
                    }
                  }}
                  disabled={isSubmittingProposal || linkedPortfolios.length === 0}
                  loading={isSubmittingProposal}
                >
                  <Scale className="h-4 w-4 mr-1.5" />
                  Submit Proposal
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// Pair Trade Card Component - displays grouped pair trade as a single card
interface PairTradeCardProps {
  pairTradeId: string
  pairTrade: any
  legs: TradeQueueItemWithDetails[]
  isDragging: boolean
  expressionCounts?: Map<string, { count: number; labNames: string[]; labIds: string[]; portfolioIds: string[]; portfolioNames: string[]; recommendationCount?: number; portfolioRecommendationCounts?: Map<string, number>; trackCounts?: { total: number; committed: number }; hasCurrentUserRecommendation?: boolean }>
  proposals?: Map<string, ProposalData[]>  // Proposals by leg ID
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onPairClick: (pairId: string) => void
  onLabClick?: (labId: string, labName: string, portfolioId: string) => void
  canMoveLeft?: boolean
  canMoveRight?: boolean
  onMoveLeft?: () => void
  onMoveRight?: () => void
  onRecommendationClick?: () => void
  onProposalClick?: () => void
  currentUserId?: string
  recStateLoading?: boolean
  committedTradeMap?: Map<string, Set<string>>
}

function PairTradeCard({
  pairTradeId,
  pairTrade,
  legs,
  isDragging,
  proposals,
  expressionCounts,
  onDragStart,
  onDragEnd,
  onPairClick,
  onLabClick,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  onRecommendationClick,
  onProposalClick,
  currentUserId,
  recStateLoading,
  committedTradeMap,
}: PairTradeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showLabsDropdown, setShowLabsDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Helper to determine if a leg is long (buy) or short (sell)
  const isLongLeg = (leg: TradeQueueItemWithDetails) =>
    leg.pair_leg_type === 'long' || (leg.pair_leg_type === null && leg.action === 'buy')
  const isShortLeg = (leg: TradeQueueItemWithDetails) =>
    leg.pair_leg_type === 'short' || (leg.pair_leg_type === null && leg.action === 'sell')

  // Separate long and short legs
  const longLegs = legs.filter(isLongLeg)
  const shortLegs = legs.filter(isShortLeg)

  const longSymbols = longLegs.map(l => l.assets?.symbol).filter(Boolean).join(', ') || '?'
  const shortSymbols = shortLegs.map(l => l.assets?.symbol).filter(Boolean).join(', ') || '?'

  // Get info from first leg for author, time, visibility
  const firstLeg = legs[0]
  const creatorName = firstLeg?.users?.first_name
    ? `${firstLeg.users.first_name}${firstLeg.users.last_name ? ' ' + firstLeg.users.last_name[0] + '.' : ''}`
    : firstLeg?.users?.email?.split('@')[0] || 'Unknown'

  // Aggregate comments and votes from all legs
  const totalComments = legs.reduce((sum, leg) => sum + (leg.trade_queue_comments?.length || 0), 0)
  const totalApproves = legs.reduce((sum, leg) => sum + (leg.vote_summary?.approve || 0), 0)
  const totalRejects = legs.reduce((sum, leg) => sum + (leg.vote_summary?.reject || 0), 0)

  // Get lab info from first leg (all legs should be in same labs)
  const labInfo = firstLeg ? expressionCounts?.get(firstLeg.id) : undefined
  const labCount = labInfo?.count || 0
  const hasMultipleLabs = labCount > 1

  // Collect all proposals for this pair trade's legs
  const pairTradeProposals = useMemo(() => {
    if (!proposals) return []
    const allProposals: ProposalData[] = []
    for (const leg of legs) {
      const legProposals = proposals.get(leg.id) || []
      allProposals.push(...legProposals)
    }
    return allProposals
  }, [proposals, legs])

  // Group proposals by portfolio for display
  const proposalsByPortfolio = useMemo(() => {
    const map = new Map<string, { portfolioName: string; proposals: ProposalData[] }>()
    for (const p of pairTradeProposals) {
      const portfolioId = p.portfolio_id
      const portfolioName = (p as any).portfolios?.name || 'Unknown'
      if (!map.has(portfolioId)) {
        map.set(portfolioId, { portfolioName, proposals: [] })
      }
      map.get(portfolioId)!.proposals.push(p)
    }
    return map
  }, [pairTradeProposals])

  const hasRecs = pairTradeProposals.length > 0

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowLabsDropdown(false)
      }
    }
    if (showLabsDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showLabsDropdown])

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onPairClick(pairTradeId)}
      className={clsx(
        "relative group bg-white dark:bg-gray-800 rounded-lg border shadow-sm transition-all cursor-pointer",
        isDragging && "opacity-50 rotate-2 scale-105",
        "border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600"
      )}
    >
      {/* Left arrow - move to previous status */}
      {canMoveLeft && onMoveLeft && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onMoveLeft()
          }}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full p-1 shadow-md hover:bg-gray-50 dark:hover:bg-gray-600"
          title="Move to previous stage"
        >
          <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </button>
      )}

      {/* Right arrow - move to next status */}
      {canMoveRight && onMoveRight && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onMoveRight()
          }}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full p-1 shadow-md hover:bg-gray-50 dark:hover:bg-gray-600"
          title="Move to next stage"
        >
          <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </button>
      )}

      <div className="p-3">
        {/* Line 1: Chain link icon + BUY tickers / SELL tickers */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 text-sm flex-1 min-w-0">
            <Link2 className="h-4 w-4 text-purple-500 dark:text-purple-400 flex-shrink-0" />
            <span className="font-semibold text-green-600 dark:text-green-400">BUY</span>
            <span className="font-semibold text-gray-900 dark:text-white truncate">
              {longLegs.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ', '}
                  <button
                    className="hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      const assetId = l.assets?.id || l.asset_id
                      if (!assetId) return
                      window.dispatchEvent(new CustomEvent('decision-engine-action', {
                        detail: { type: 'asset', id: assetId, title: l.assets?.symbol, data: { id: assetId, symbol: l.assets?.symbol, researchViewFilter: l.created_by } }
                      }))
                    }}
                  >
                    {l.assets?.symbol}
                  </button>
                </span>
              ))}
            </span>
            <span className="text-gray-400 dark:text-gray-500">/</span>
            <span className="font-semibold text-red-600 dark:text-red-400">SELL</span>
            <span className="font-semibold text-gray-900 dark:text-white truncate">
              {shortLegs.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ', '}
                  <button
                    className="hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      const assetId = l.assets?.id || l.asset_id
                      if (!assetId) return
                      window.dispatchEvent(new CustomEvent('decision-engine-action', {
                        detail: { type: 'asset', id: assetId, title: l.assets?.symbol, data: { id: assetId, symbol: l.assets?.symbol, researchViewFilter: l.created_by } }
                      }))
                    }}
                  >
                    {l.assets?.symbol}
                  </button>
                </span>
              ))}
            </span>
          </div>
        </div>

        {/* Line 2: Portfolio + Urgency (like TradeQueueCard) */}
        <div className="flex items-center gap-2 mb-2 relative" ref={dropdownRef}>
          {labCount > 0 ? (
            // In trade labs
            hasMultipleLabs ? (
              // Multiple labs - dropdown with progress
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowLabsDropdown(!showLabsDropdown)
                }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-1"
              >
                <span className="text-primary-600 dark:text-primary-400 font-medium">{labInfo?.trackCounts?.total || labCount} portfolios</span>
                <ChevronDown className={clsx("h-3 w-3 transition-transform", showLabsDropdown && "rotate-180")} />
              </button>
            ) : (
              // Single lab - link directly
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (labInfo && onLabClick) {
                    onLabClick(labInfo.labIds[0], labInfo.labNames[0], labInfo.portfolioIds[0])
                  }
                }}
                className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"
              >
                <span className="text-primary-600 dark:text-primary-400 font-medium hover:underline">{labInfo?.portfolioNames?.[0] || labInfo?.labNames[0]}</span>
              </button>
            )
          ) : firstLeg?.portfolios?.name ? (
            // Not in labs but has portfolio
            <span className="text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium">{firstLeg.portfolios.name}</span>
            </span>
          ) : null}

          {/* Conviction indicator */}
          {firstLeg?.conviction && CONVICTION_CONFIG[firstLeg.conviction] && (
            <span className={clsx("text-[11px] font-medium flex items-center gap-1", CONVICTION_CONFIG[firstLeg.conviction].color)}>
              {CONVICTION_CONFIG[firstLeg.conviction].label}
              <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", CONVICTION_CONFIG[firstLeg.conviction].dot)} />
            </span>
          )}

          {/* Missing requirement alert */}
          {(() => {
            const stage = firstLeg?.stage || firstLeg?.status
            const hasThesis = legs.some(l => !!(l as any).thesis_text)
            const hasRationale = !!pairTrade.rationale
            const pairRecCount = legs.reduce((sum, leg) => sum + (expressionCounts?.get(leg.id)?.recommendationCount || 0), 0) || pairTradeProposals.length
            const missing: string[] = []
            if (!hasRationale) missing.push('Why now')
            if (['thesis_forming', 'ready_for_decision', 'deciding'].includes(stage) && !hasThesis) missing.push('Trade thesis')
            if (['ready_for_decision', 'deciding'].includes(stage) && pairRecCount === 0) missing.push('Recommendation')
            if (missing.length === 0) return null
            return <MissingReqAlert missing={missing} />
          })()}

          {/* Labs dropdown */}
          {showLabsDropdown && labInfo && labCount > 0 && (
            <div
              className="absolute left-0 top-full mt-0.5 z-50 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-200 dark:border-gray-700 py-0.5 min-w-[160px]"
              onClick={(e) => e.stopPropagation()}
            >
              {labInfo.portfolioNames?.map((portfolioName, idx) => {
                  const pid = labInfo.portfolioIds[idx]
                  // Any leg committed to this portfolio counts
                  const isCommitted = legs.some(leg => committedTradeMap?.get(leg.id)?.has(pid))
                  return (
                    <button
                      key={labInfo.labIds[idx]}
                      onClick={() => {
                        onLabClick?.(labInfo.labIds[idx], labInfo.labNames[idx], pid)
                        setShowLabsDropdown(false)
                      }}
                      className={clsx(
                        "w-full flex items-center gap-1.5 px-2 py-1 text-xs text-left transition-colors",
                        isCommitted
                          ? "text-gray-400 dark:text-gray-500"
                          : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                      )}
                    >
                      <Briefcase className={clsx("h-3 w-3 flex-shrink-0", isCommitted ? "text-gray-300" : "text-gray-400")} />
                      <span className="truncate flex-1">{portfolioName}</span>
                      {isCommitted && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" title="Committed to Trade Book" />
                      )}
                    </button>
                  )
              })}
            </div>
          )}
        </div>

        {/* Recommendation state — single derived state, single row */}
        {(() => {
          if (recStateLoading && !!onProposalClick) {
            return <div className="mb-2"><div className="h-7 w-full rounded-md bg-gray-100 dark:bg-gray-700/50 animate-pulse" /></div>
          }
          const recCount = legs.reduce((sum, leg) => sum + (expressionCounts?.get(leg.id)?.recommendationCount || 0), 0) || pairTradeProposals.length
          const hasMyRec = legs.some(leg => expressionCounts?.get(leg.id)?.hasCurrentUserRecommendation)
          const isReadyForDecision = !!onProposalClick

          return (
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {recCount > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRecommendationClick?.() }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400 border border-teal-200 dark:border-teal-800/40 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors"
                >
                  <FileCheck className="h-2.5 w-2.5" />
                  {recCount} {recCount === 1 ? 'recommendation' : 'recommendations'}
                </button>
              )}
              {isReadyForDecision && recCount === 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onProposalClick!() }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                >
                  <Gavel className="h-2.5 w-2.5" />
                  Submit rec
                </button>
              )}
            </div>
          )
        })()}

        {/* Derived urgency alert */}
        {(() => {
          const du = firstLeg ? getDerivedUrgency(firstLeg.stage || firstLeg.status, firstLeg.updated_at || firstLeg.created_at) : null
          if (!du) return null
          const cfg = DERIVED_URGENCY_CONFIG[du]
          return (
            <p className={clsx("text-[11px] font-medium mb-1.5", cfg.color)}>
              {cfg.icon} {cfg.label}
            </p>
          )
        })()}

        {/* Rationale - prominent like TradeQueueCard */}
        {pairTrade.rationale && (
          <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3 mb-2 leading-relaxed">
            {pairTrade.rationale}
          </p>
        )}

        {/* Collapsible Legs Display */}
        {isExpanded && (
          <div className="space-y-2 mb-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            {/* Buy Legs */}
            {longLegs.map(leg => (
              <div key={leg.id} className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-md">
                <span className="text-xs font-medium text-green-700 dark:text-green-300 uppercase">Buy</span>
                <button
                  className="font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    const assetId = leg.assets?.id || leg.asset_id
                    if (!assetId) return
                    window.dispatchEvent(new CustomEvent('decision-engine-action', {
                      detail: { type: 'asset', id: assetId, title: leg.assets?.symbol, data: { id: assetId, symbol: leg.assets?.symbol, researchViewFilter: leg.created_by } }
                    }))
                  }}
                >
                  {leg.assets?.symbol}
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400 truncate flex-1">{leg.assets?.company_name}</span>
                {leg.proposed_weight && (
                  <span className="text-xs font-medium text-green-600 dark:text-green-400">+{leg.proposed_weight.toFixed(1)}%</span>
                )}
                {leg.proposed_shares && !leg.proposed_weight && (
                  <span className="text-xs font-medium text-green-600 dark:text-green-400">+{leg.proposed_shares.toLocaleString()}</span>
                )}
              </div>
            ))}

            {/* Sell Legs */}
            {shortLegs.map(leg => (
              <div key={leg.id} className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-md">
                <span className="text-xs font-medium text-red-700 dark:text-red-300 uppercase">Sell</span>
                <button
                  className="font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    const assetId = leg.assets?.id || leg.asset_id
                    if (!assetId) return
                    window.dispatchEvent(new CustomEvent('decision-engine-action', {
                      detail: { type: 'asset', id: assetId, title: leg.assets?.symbol, data: { id: assetId, symbol: leg.assets?.symbol, researchViewFilter: leg.created_by } }
                    }))
                  }}
                >
                  {leg.assets?.symbol}
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400 truncate flex-1">{leg.assets?.company_name}</span>
                {leg.proposed_weight && (
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">-{leg.proposed_weight.toFixed(1)}%</span>
                )}
                {leg.proposed_shares && !leg.proposed_weight && (
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">-{leg.proposed_shares.toLocaleString()}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Proposals Section - shown when pair trade has proposals (in Deciding) */}
        {hasRecs && (
          <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 -mx-3 px-3 pb-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Gavel className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                {pairTradeProposals.length} Portfolio {pairTradeProposals.length !== 1 ? 'Recommendations' : 'Recommendation'}
              </span>
            </div>
            <div className="space-y-2">
              {Array.from(proposalsByPortfolio.entries()).map(([portfolioId, { portfolioName, proposals: portfolioProposals }]) => (
                <div key={portfolioId} className="text-xs bg-white dark:bg-gray-800 rounded p-2 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Briefcase className="h-3 w-3 text-gray-400" />
                    <span className="font-medium text-gray-700 dark:text-gray-300">{portfolioName}</span>
                  </div>
                  {/* Show all legs from sizing_context */}
                  {portfolioProposals.map(p => {
                    // sizing_context may be a string (from DB) or object
                    let sizingContext = p.sizing_context
                    if (typeof sizingContext === 'string') {
                      try {
                        sizingContext = JSON.parse(sizingContext)
                      } catch {
                        sizingContext = null
                      }
                    }
                    const isPairTrade = sizingContext?.isPairTrade
                    const contextLegs = sizingContext?.legs

                    if (isPairTrade && contextLegs && contextLegs.length > 0) {
                      // Pair trade proposal - show all legs
                      return (
                        <div key={p.id} className="flex flex-wrap gap-x-3 gap-y-1">
                          {contextLegs.map((leg, idx) => (
                            <span key={idx} className={clsx(
                              "font-medium",
                              leg.action === 'buy' ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                            )}>
                              {leg.action === 'buy' ? 'BUY' : 'SELL'} {leg.symbol}: {leg.weight != null ? `${leg.weight.toFixed(1)}%` : '—'}
                            </span>
                          ))}
                        </div>
                      )
                    } else {
                      // Single trade proposal fallback
                      const tradeItem = p.trade_queue_items
                      const symbol = tradeItem?.assets?.symbol || '?'
                      const weight = p.weight
                      return (
                        <span key={p.id} className="text-gray-600 dark:text-gray-400">
                          {symbol}: {weight?.toFixed(1) ?? '?'}%
                        </span>
                      )
                    }
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer: Author + Pipeline Age + Comments/Votes */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1.5">
            <User className="h-3 w-3" />
            <span>{creatorName}</span>
            {firstLeg && (() => {
              const hasUpdate = firstLeg.updated_at && firstLeg.updated_at !== firstLeg.created_at
              const stalenessDate = hasUpdate ? firstLeg.updated_at : firstLeg.created_at
              const staleColor = getStalenessColor(stalenessDate, firstLeg.stage || firstLeg.status)
              return (
                <>
                  <span className="text-gray-300 dark:text-gray-600">•</span>
                  <span className={clsx("flex items-center gap-0.5", !hasUpdate && staleColor)} title={`In pipeline since ${new Date(firstLeg.created_at).toLocaleDateString()}`}>
                    <Timer className="h-3 w-3" />
                    Pipeline {getPipelineAge(firstLeg.created_at)}
                  </span>
                  {hasUpdate && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">•</span>
                      <span className={staleColor} title={`Last updated ${new Date(firstLeg.updated_at).toLocaleString()}`}>
                        Updated {getPipelineAge(firstLeg.updated_at)}
                      </span>
                    </>
                  )}
                </>
              )
            })()}
          </div>

          <div className="flex items-center gap-2">
            {totalComments > 0 && (
              <span className="flex items-center gap-0.5">
                <MessageSquare className="h-3 w-3" />
                {totalComments}
              </span>
            )}
            {totalApproves > 0 && (
              <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                <ThumbsUp className="h-3 w-3" />
                {totalApproves}
              </span>
            )}
            {totalRejects > 0 && (
              <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                <ThumbsDown className="h-3 w-3" />
                {totalRejects}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Proposal Summary Types and Component
// ============================================

interface ProposalData {
  id: string
  trade_queue_item_id: string
  user_id: string
  portfolio_id: string
  weight: number | null
  shares: number | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  // Proposal type fields
  proposal_type?: 'analyst' | 'pm_initiated'
  analyst_input_requested?: boolean
  analyst_input_requested_at?: string | null
  sizing_context?: {
    isPairTrade?: boolean
    pairTradeId?: string
    legs?: Array<{
      legId: string
      symbol: string
      action: 'buy' | 'sell'
      weight: number | null
      sizingMode?: string
      inputValue?: number | null
    }>
    [key: string]: unknown
  } | null
  // Joined data from Supabase
  portfolios?: { id: string; name: string } | null
  users?: { id: string; email: string; first_name: string | null; last_name: string | null } | null
  trade_queue_items?: {
    id: string
    action: TradeAction
    rationale: string | null
    created_by: string | null
    assigned_to: string | null
    pair_trade_id?: string | null
    assets: { id: string; symbol: string; company_name: string } | null
  } | null
  // Aliases for backward compatibility
  portfolio?: { id: string; name: string } | null
  user?: { id: string; email: string; first_name: string | null; last_name: string | null } | null
  trade_queue_item?: {
    id: string
    action: TradeAction
    rationale: string | null
    created_by: string | null
    assigned_to: string | null
    assets: { id: string; symbol: string; company_name: string } | null
  } | null
}

interface RecommendationSummaryData {
  recommendationCount: number
  latestUpdatedAt: Date | null
  ownerProposal: ProposalData | null
  myProposal: ProposalData | null
  // Portfolio context for summary display
  portfolioCount: number
  portfolioNames: string[]
}

// Helper to compute proposal summary for a trade idea
function computeRecommendationSummary(
  proposals: ProposalData[] | undefined,
  ownerId: string | null,
  currentUserId: string | undefined
): RecommendationSummaryData {
  if (!proposals || proposals.length === 0) {
    return {
      recommendationCount: 0,
      latestUpdatedAt: null,
      ownerProposal: null,
      myProposal: null,
      portfolioCount: 0,
      portfolioNames: [],
    }
  }

  const ownerProposal = ownerId ? proposals.find(p => p.user_id === ownerId) || null : null
  const myProposal = currentUserId ? proposals.find(p => p.user_id === currentUserId) || null : null

  // Find the latest updated_at across all proposals
  const latestUpdatedAt = proposals.reduce((latest, p) => {
    const proposalDate = new Date(p.updated_at || p.created_at)
    return latest === null || proposalDate > latest ? proposalDate : latest
  }, null as Date | null)

  // Count unique portfolios and collect names
  const portfolioMap = new Map<string, string>()
  proposals.forEach(p => {
    if (p.portfolio_id && !portfolioMap.has(p.portfolio_id)) {
      const portfolioData = p.portfolios || p.portfolio
      portfolioMap.set(p.portfolio_id, portfolioData?.name || 'Unknown')
    }
  })

  return {
    recommendationCount: proposals.length,
    latestUpdatedAt,
    ownerProposal,
    myProposal,
    portfolioCount: portfolioMap.size,
    portfolioNames: Array.from(portfolioMap.values()),
  }
}

// Format relative time for proposal summary
function formatProposalTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Compact pipeline age label from created_at.
 * Uses creation date as the "time in pipeline" proxy.
 */
function getPipelineAge(createdAt: string): string {
  const now = Date.now()
  const created = new Date(createdAt).getTime()
  const diffMs = now - created
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)

  if (diffHours < 1) return '<1h'
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 14) return `${diffDays}d`
  return `${diffWeeks}w`
}

function getStalenessColor(updatedAt: string, stage: string): string {
  const du = getDerivedUrgency(stage, updatedAt)
  if (!du) return ''
  return DERIVED_URGENCY_CONFIG[du].color
}

interface DecidingRecommendationSummaryProps {
  summary: RecommendationSummaryData
  ownerName: string
  showMyProposal?: boolean
  // Portfolio context - when set, we're viewing a specific portfolio
  selectedPortfolioName?: string | null
}

function DecidingRecommendationSummary({ summary, ownerName, showMyProposal = true, selectedPortfolioName }: DecidingRecommendationSummaryProps) {
  const { recommendationCount, latestUpdatedAt, ownerProposal, myProposal, portfolioCount, portfolioNames } = summary

  // No recommendations — handled by the main recommendation state block on the card
  if (recommendationCount === 0) {
    return null
  }

  const recLabel = recommendationCount === 1 ? 'recommendation' : 'recommendations'
  const timeStr = latestUpdatedAt ? formatProposalTime(latestUpdatedAt) : ''

  // Portfolio context for display
  // - If selectedPortfolioName is set, we're viewing a single portfolio (proposals already filtered)
  // - If not set but portfolioCount > 1, show "X portfolios with recommendations"
  const portfolioContext = selectedPortfolioName
    ? ` (${selectedPortfolioName})`
    : portfolioCount > 1
      ? null // Will show portfolio count separately
      : portfolioNames[0]
        ? ` (${portfolioNames[0]})`
        : ''
  const showPortfolioCount = !selectedPortfolioName && portfolioCount > 1

  // Build the display parts
  let mainText: React.ReactNode
  let hasWarning = false

  if (ownerProposal) {
    // Case A or B: Owner proposal exists
    if (ownerProposal.weight != null) {
      // Case A: Owner has weight
      mainText = (
        <>
          <span className="font-semibold text-primary-700 dark:text-primary-400">
            {ownerName} recommends: {Number(ownerProposal.weight).toFixed(1)}%{portfolioContext}
          </span>
          <span className="mx-1.5 text-gray-400">·</span>
          {showPortfolioCount ? (
            <span>{portfolioCount} portfolios with recommendations</span>
          ) : (
            <span>{recommendationCount} {recLabel}</span>
          )}
          {timeStr && (
            <>
              <span className="mx-1.5 text-gray-400">·</span>
              <span>Updated {timeStr}</span>
            </>
          )}
        </>
      )
    } else if (ownerProposal.shares != null) {
      // Owner has shares instead of weight
      mainText = (
        <>
          <span className="font-semibold text-primary-700 dark:text-primary-400">
            {ownerName} recommends: {Number(ownerProposal.shares).toLocaleString()} shares{portfolioContext}
          </span>
          <span className="mx-1.5 text-gray-400">·</span>
          {showPortfolioCount ? (
            <span>{portfolioCount} portfolios with recommendations</span>
          ) : (
            <span>{recommendationCount} {recLabel}</span>
          )}
          {timeStr && (
            <>
              <span className="mx-1.5 text-gray-400">·</span>
              <span>Updated {timeStr}</span>
            </>
          )}
        </>
      )
    } else {
      // Case B: Owner proposed but no sizing
      hasWarning = true
      mainText = (
        <>
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {ownerName} recommends{portfolioContext}
          </span>
          <span className="mx-1.5 text-gray-400">·</span>
          {showPortfolioCount ? (
            <span>{portfolioCount} portfolios with recommendations</span>
          ) : (
            <span>{recommendationCount} {recLabel}</span>
          )}
          {timeStr && (
            <>
              <span className="mx-1.5 text-gray-400">·</span>
              <span>Updated {timeStr}</span>
            </>
          )}
        </>
      )
    }
  } else {
    // Case C: No owner proposal but there are proposals
    mainText = (
      <>
        {showPortfolioCount ? (
          <span>{portfolioCount} portfolios with recommendations</span>
        ) : (
          <span>{recommendationCount} {recLabel}</span>
        )}
        <span className="mx-1.5 text-gray-400">·</span>
        <span className="text-amber-600 dark:text-amber-400 font-medium">Awaiting owner sizing</span>
        {timeStr && (
          <>
            <span className="mx-1.5 text-gray-400">·</span>
            <span>Updated {timeStr}</span>
          </>
        )}
      </>
    )
  }

  // Optional: Show my proposal if viewer has one (and it's not the owner proposal)
  const showMy = showMyProposal && myProposal && (!ownerProposal || myProposal.id !== ownerProposal.id)
  const myProposalText = showMy ? (
    myProposal.weight != null
      ? `My: ${myProposal.weight.toFixed(1)}%`
      : myProposal.shares != null
        ? `My: ${myProposal.shares.toLocaleString()} sh`
        : null
  ) : null

  return (
    <div className={clsx(
      "mt-2 mb-1 px-2 py-1.5 rounded border text-xs",
      hasWarning
        ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
        : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
    )}>
      <p className={clsx(
        "leading-relaxed",
        hasWarning ? "text-amber-800 dark:text-amber-200" : "text-gray-700 dark:text-gray-300"
      )}>
        {mainText}
        {hasWarning && (
          <span className="ml-2 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-3 w-3" />
            <span className="font-medium">Set size</span>
          </span>
        )}
      </p>
      {myProposalText && (
        <p className="mt-0.5 text-primary-600 dark:text-primary-400 font-medium">
          {myProposalText}
        </p>
      )}
    </div>
  )
}

// ============================================
// Proposal Card Component (for Deciding column)
// ============================================
interface ProposalCardProps {
  proposal: ProposalData
  isMyProposal: boolean
  isPM: boolean
  portfolioTrackStatus?: { decision_outcome: string | null; deferred_until: string | null } | null
  onAccept: (proposalId: string, overrideWeight?: number) => void
  onReject: (proposalId: string, reason?: string) => void
  onDefer: (proposalId: string, deferUntil: string) => void
  onWithdraw?: (proposalId: string) => void
  onRequestAnalystInput?: (proposalId: string) => void
  onClick: () => void
}

function ProposalCard({
  proposal,
  isMyProposal,
  isPM,
  portfolioTrackStatus,
  onAccept,
  onReject,
  onDefer,
  onWithdraw,
  onRequestAnalystInput,
  onClick,
}: ProposalCardProps) {
  const [showOverrideInput, setShowOverrideInput] = useState(false)
  const [overrideWeight, setOverrideWeight] = useState('')
  const [showDeferPicker, setShowDeferPicker] = useState(false)
  const [deferDate, setDeferDate] = useState('')

  // Use plural Supabase join names, fall back to singular aliases
  const tradeItem = proposal?.trade_queue_items || proposal?.trade_queue_item
  const asset = tradeItem?.assets
  const userData = proposal?.users || proposal?.user
  const proposerName = userData?.first_name && userData?.last_name
    ? `${userData.first_name} ${userData.last_name}`
    : userData?.email?.split('@')[0] || 'Unknown'
  const portfolioData = proposal.portfolios || proposal.portfolio
  const portfolioName = portfolioData?.name || 'Unknown Portfolio'

  // Check if this portfolio track has already been decided
  const isAlreadyDecided = portfolioTrackStatus?.decision_outcome !== null && portfolioTrackStatus?.decision_outcome !== undefined
  const decisionOutcome = portfolioTrackStatus?.decision_outcome

  const handleAccept = () => {
    if (showOverrideInput && overrideWeight) {
      onAccept(proposal.id, parseFloat(overrideWeight))
    } else {
      onAccept(proposal.id)
    }
    setShowOverrideInput(false)
    setOverrideWeight('')
  }

  const handleDefer = () => {
    if (deferDate) {
      onDefer(proposal.id, deferDate)
      setShowDeferPicker(false)
      setDeferDate('')
    }
  }

  return (
    <div
      className={clsx(
        "bg-white dark:bg-gray-800 rounded-lg border p-3 transition-all cursor-pointer",
        isMyProposal
          ? "border-primary-300 dark:border-primary-700 ring-1 ring-primary-200 dark:ring-primary-800"
          : "border-gray-200 dark:border-gray-700",
        "hover:shadow-md"
      )}
      onClick={onClick}
    >
      {/* Header: BUY COIN for Large Cap Growth at 1% */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-sm">
          <span className={clsx(
            "font-bold uppercase",
            tradeItem?.action === 'buy' || tradeItem?.action === 'add'
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          )}>
            {tradeItem?.action || 'BUY'}
          </span>
          <button
            className="font-bold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              if (!asset?.id) return
              window.dispatchEvent(new CustomEvent('decision-engine-action', {
                detail: { type: 'asset', id: asset.id, title: asset.symbol, data: { id: asset.id, symbol: asset.symbol, researchViewFilter: proposal.user_id } }
              }))
            }}
          >
            {asset?.symbol || '???'}
          </button>
          <span className="text-gray-400 dark:text-gray-500">for</span>
          <span className="text-gray-600 dark:text-gray-300">{portfolioName}</span>
          {(proposal.weight != null || proposal.shares != null) && (
            <>
              <span className="text-gray-400 dark:text-gray-500">at</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                {proposal.weight != null
                  ? `${Number(proposal.weight).toFixed(1)}%`
                  : `${proposal.shares?.toLocaleString()} sh`}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Decision status badge */}
          {decisionOutcome === 'accepted' && (
            <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <CheckCircle2 className="h-3 w-3" />
              Accepted
            </span>
          )}
          {decisionOutcome === 'rejected' && (
            <span className="text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <XCircle className="h-3 w-3" />
              Rejected
            </span>
          )}
          {decisionOutcome === 'deferred' && (
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              Deferred
            </span>
          )}
        </div>
      </div>

      {/* Proposer + Waiting Status */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-2 flex-wrap">
        <User className="h-3 w-3" />
        <span className="font-medium text-gray-700 dark:text-gray-300">{proposerName}</span>
        {/* PM-initiated proposal badge */}
        {proposal.proposal_type === 'pm_initiated' && (
          <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded">
            PM Decision
          </span>
        )}
        {/* Analyst input requested indicator */}
        {proposal.analyst_input_requested && (
          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded flex items-center gap-0.5">
            <Users className="h-2.5 w-2.5" />
            Awaiting Analyst
          </span>
        )}
        {isMyProposal && !isPM && !isAlreadyDecided && proposal.proposal_type !== 'pm_initiated' && (
          <span className="ml-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
            Waiting for PM
          </span>
        )}
      </div>

      {/* Notes (if any) */}
      {proposal.notes && (
        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-2 bg-gray-50 dark:bg-gray-700/50 rounded px-2 py-1">
          {proposal.notes}
        </p>
      )}

      {/* PM Decision Actions - only show if not already decided */}
      {isPM && !isAlreadyDecided && (
        <div onClick={(e) => e.stopPropagation()}>
          {/* Request Analyst Input button for PM-initiated proposals */}
          {isMyProposal && proposal.proposal_type === 'pm_initiated' && !proposal.analyst_input_requested && onRequestAnalystInput && (
            <button
              onClick={() => onRequestAnalystInput(proposal.id)}
              className="w-full mb-2 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-900/50 transition-colors"
            >
              <Users className="h-3 w-3" />
              Request Analyst Input
            </button>
          )}
          {/* Call to action banner */}
          <div className="flex items-center gap-1.5 mt-2 mb-2 px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
            <Gavel className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Decision required</span>
          </div>
          {!showOverrideInput && !showDeferPicker ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleAccept}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
              >
                <Check className="h-3 w-3" />
                Accept
              </button>
              <button
                onClick={() => setShowOverrideInput(true)}
                className="px-2 py-1.5 text-xs font-medium rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50 transition-colors"
                title="Accept with different sizing"
              >
                Override
              </button>
              <button
                onClick={() => setShowDeferPicker(true)}
                className="px-2 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors"
              >
                <Clock className="h-3 w-3" />
              </button>
              <button
                onClick={() => onReject(proposal.id)}
                className="px-2 py-1.5 text-xs font-medium rounded-md bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
              >
                <XCircle className="h-3 w-3" />
              </button>
            </div>
          ) : showOverrideInput ? (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={overrideWeight}
                  onChange={(e) => setOverrideWeight(e.target.value)}
                  placeholder="Override weight %"
                  className="flex-1 h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="text-xs text-gray-500">%</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAccept}
                  disabled={!overrideWeight}
                  className="flex-1 px-2 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Accept with {overrideWeight || '?'}%
                </button>
                <button
                  onClick={() => { setShowOverrideInput(false); setOverrideWeight('') }}
                  className="px-2 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <input
                type="date"
                value={deferDate}
                onChange={(e) => setDeferDate(e.target.value)}
                min={format(new Date(), 'yyyy-MM-dd')}
                className="w-full h-8 px-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDefer}
                  disabled={!deferDate}
                  className="flex-1 px-2 py-1.5 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Defer until {deferDate || '...'}
                </button>
                <button
                  onClick={() => { setShowDeferPicker(false); setDeferDate('') }}
                  className="px-2 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Withdraw option for proposal owner - only if not already decided */}
      {isMyProposal && !isAlreadyDecided && onWithdraw && (
        <div onClick={(e) => e.stopPropagation()} className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={() => onWithdraw(proposal.id)}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Withdraw Recommendation
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Grouped Proposals by Trade Idea
// ============================================
interface GroupedProposals {
  tradeId: string
  ticker: string
  companyName: string
  assetId: string | null
  action: TradeAction
  proposals: ProposalData[]
}

function groupProposalsByTradeIdea(proposals: ProposalData[]): GroupedProposals[] {
  const grouped = new Map<string, GroupedProposals>()

  proposals.forEach(proposal => {
    if (!proposal) return // Skip null proposals

    const tradeId = proposal.trade_queue_item_id
    const existing = grouped.get(tradeId)
    // Use plural Supabase join names, fall back to singular aliases
    const tradeItem = proposal?.trade_queue_items || proposal?.trade_queue_item

    if (existing) {
      existing.proposals.push(proposal)
    } else {
      grouped.set(tradeId, {
        tradeId,
        ticker: tradeItem?.assets?.symbol || '???',
        companyName: tradeItem?.assets?.company_name || 'Unknown',
        assetId: tradeItem?.assets?.id || tradeItem?.asset_id || null,
        action: tradeItem?.action || 'buy',
        proposals: [proposal],
      })
    }
  })

  // Sort groups by ticker, then sort proposals within each group
  return Array.from(grouped.values())
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .map(group => ({
      ...group,
      proposals: group.proposals.filter(p => p != null).sort((a, b) => {
        // Owner proposals first, then by updated_at
        const aTradeItem = a?.trade_queue_items || a?.trade_queue_item
        const bTradeItem = b?.trade_queue_items || b?.trade_queue_item
        const aIsOwner = a?.user_id === aTradeItem?.created_by
        const bIsOwner = b?.user_id === bTradeItem?.created_by
        if (aIsOwner && !bIsOwner) return -1
        if (!aIsOwner && bIsOwner) return 1
        return new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime()
      }),
    }))
}

// ============================================
// Trade Queue Card Component
// ============================================
interface TradeQueueCardProps {
  item: TradeQueueItemWithDetails
  isDragging: boolean
  isArchived?: boolean
  expressionCounts?: Map<string, { count: number; labNames: string[]; labIds: string[]; portfolioIds: string[]; portfolioNames: string[]; recommendationCount?: number; portfolioRecommendationCounts?: Map<string, number>; hasCurrentUserRecommendation?: boolean }>
  proposals?: ProposalData[]
  currentUserId?: string
  selectedPortfolioName?: string | null  // For portfolio-aware proposal summary
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onClick: () => void
  onLabClick?: (labId: string, labName: string, portfolioId: string) => void
  onAcknowledgeResurfaced?: () => void  // Callback to acknowledge a resurfaced deferred item
  onMoveLeft?: () => void
  onMoveRight?: () => void
  canMoveLeft?: boolean
  canMoveRight?: boolean
  onProposalClick?: () => void
  onRecommendationClick?: () => void
  onDebateClick?: () => void
  recStateLoading?: boolean
  committedTradeMap?: Map<string, Set<string>>
}

function MissingReqAlert({ missing }: { missing: string[] }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setShow(!show) }}
        className="p-0.5 text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
        title="Missing requirements"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
      </button>
      {show && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShow(false) }} />
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[160px] py-1.5 px-3">
            <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Needs</div>
            {missing.map(m => (
              <div key={m} className="text-xs text-gray-600 dark:text-gray-300 py-0.5">{m}</div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TradeQueueCard({
  item,
  isDragging,
  isArchived,
  expressionCounts,
  proposals,
  currentUserId,
  selectedPortfolioName,
  onDragStart,
  onDragEnd,
  onClick,
  onLabClick,
  onAcknowledgeResurfaced,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
  onProposalClick,
  onRecommendationClick,
  onDebateClick,
  recStateLoading,
  committedTradeMap,
}: TradeQueueCardProps) {
  const [showLabsDropdown, setShowLabsDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const dragOccurredRef = useRef(false)

  const isBuy = item.action === 'buy' || item.action === 'add'
  // Derive display label from proposed weight when available
  const actionLabel = (() => {
    const pw = item.proposed_weight
    if (pw != null) {
      // If proposed weight is negative and action is sell/trim → New Short
      if (pw < 0 && (item.action === 'sell' || item.action === 'trim')) return 'NEW SHORT'
      // If proposed weight is positive and action is buy → could be New Long
      if (pw > 0 && item.action === 'buy') return 'NEW LONG'
    }
    return getTradeActionLabel(item.action).toUpperCase()
  })()

  // Get lab inclusion info
  const labInfo = expressionCounts?.get(item.id)
  const labCount = labInfo?.count || 0
  const hasMultipleLabs = labCount > 1
  const recCount = labInfo?.recommendationCount || 0

  // Get user display name
  const creatorName = item.users?.first_name
    ? `${item.users.first_name}${item.users.last_name ? ' ' + item.users.last_name[0] + '.' : ''}`
    : item.users?.email?.split('@')[0] || 'Unknown'

  // Compute proposal summary for deciding items
  const isDeciding = item.status === 'deciding'
  const proposalSummary = useMemo(() => {
    if (!isDeciding) return null
    return computeRecommendationSummary(proposals, item.created_by, currentUserId)
  }, [isDeciding, proposals, item.created_by, currentUserId])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowLabsDropdown(false)
      }
    }
    if (showLabsDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showLabsDropdown])

  return (
    <div
      draggable={!isArchived}
      onDragStart={(e) => {
        dragOccurredRef.current = true
        onDragStart(e)
      }}
      onDragEnd={() => {
        // Keep dragOccurredRef true briefly to prevent click events that fire after drag
        setTimeout(() => { dragOccurredRef.current = false }, 100)
        onDragEnd()
      }}
      onClick={onClick}
      className={clsx(
        "relative group bg-white dark:bg-gray-800 rounded-lg border shadow-sm transition-all cursor-pointer",
        isDragging && "opacity-50 rotate-2 scale-105",
        isArchived
          ? "border-gray-200 dark:border-gray-700 opacity-75"
          : "border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600"
      )}
    >
      {/* Left arrow - move to previous status */}
      {canMoveLeft && onMoveLeft && !isArchived && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onMoveLeft()
          }}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full p-1 shadow-md hover:bg-gray-50 dark:hover:bg-gray-600"
          title="Move to previous stage"
        >
          <ChevronLeft className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        </button>
      )}

      {/* Right arrow - move to next status */}
      {canMoveRight && onMoveRight && !isArchived && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onMoveRight()
          }}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full p-1 shadow-md hover:bg-gray-50 dark:hover:bg-gray-600"
          title="Move to next stage"
        >
          <ChevronRight className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        </button>
      )}

      <div className="p-3 relative">
        {/* Debate tilt bar — upper right */}
        <div className="absolute top-2 right-2">
          <DebateIndicatorBadge tradeIdeaId={item.id} onClick={onDebateClick} />
        </div>
        {/* Pair Trade Indicator */}
        {item.pair_trade_id && item.pair_trades && (
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-purple-50 dark:bg-purple-900/20 rounded-md border border-purple-200 dark:border-purple-800">
            <Link2 className="h-3 w-3 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-medium text-purple-700 dark:text-purple-300 truncate">
              {item.pair_trades.name || 'Pair Trade'}
            </span>
            {item.pair_leg_type && (
              <span className={clsx(
                "text-xs px-1.5 py-0.5 rounded-full ml-auto",
                item.pair_leg_type === 'long'
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              )}>
                {item.pair_leg_type}
              </span>
            )}
          </div>
        )}

        {/* Line 1: BUY COIN Coinbase Global */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex items-center gap-2 text-sm">
            <span className={clsx(
              "font-semibold",
              isBuy ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
            )}>
              {actionLabel}
            </span>
            <button
              className="font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 hover:underline"
              onClick={(e) => {
                e.stopPropagation()
                const assetId = item.assets?.id || item.asset_id
                if (!assetId) return
                window.dispatchEvent(new CustomEvent('decision-engine-action', {
                  detail: { type: 'asset', id: assetId, title: item.assets?.symbol, data: { id: assetId, symbol: item.assets?.symbol, researchViewFilter: item.created_by } }
                }))
              }}
            >
              {item.assets?.symbol}
            </button>
            <span className="text-gray-500 dark:text-gray-400">{item.assets?.company_name}</span>
          </div>
        </div>

        {/* Line 2: for [portfolio] + urgency badge */}
        <div className="flex items-center gap-2 mb-2 relative" ref={dropdownRef}>
          {labCount > 0 ? (
            // In trade labs
            hasMultipleLabs ? (
              // Multiple labs - dropdown with progress
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowLabsDropdown(!showLabsDropdown)
                }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-1"
              >
                <span className="text-primary-600 dark:text-primary-400 font-medium">{labInfo?.trackCounts?.total || labCount} portfolios</span>
                {labInfo?.trackCounts && labInfo.trackCounts.committed > 0 && (
                  <>
                    <span className="text-gray-400 dark:text-gray-500">·</span>
                    <span className="text-green-600 dark:text-green-400">{labInfo.trackCounts.committed} committed</span>
                  </>
                )}
                <ChevronDown className={clsx("h-3 w-3 transition-transform", showLabsDropdown && "rotate-180")} />
              </button>
            ) : (
              // Single lab - link directly, show portfolio name with progress
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (labInfo && onLabClick) {
                    onLabClick(labInfo.labIds[0], labInfo.labNames[0], labInfo.portfolioIds[0])
                  }
                }}
                className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"
              >
                <span className="text-primary-600 dark:text-primary-400 font-medium hover:underline">{labInfo?.portfolioNames?.[0] || labInfo?.labNames[0]}</span>
                {labInfo?.trackCounts?.committed === 1 && (
                  <>
                    <span className="text-gray-400 dark:text-gray-500">·</span>
                    <span className="text-green-600 dark:text-green-400">committed</span>
                  </>
                )}
              </button>
            )
          ) : item.portfolios?.name ? (
            // Not in labs but has portfolio — link to portfolio tab
            <button
              onClick={(e) => {
                e.stopPropagation()
                const pid = item.portfolios?.id || item.portfolios?.portfolio_id || item.portfolio_id
                if (pid) {
                  window.dispatchEvent(new CustomEvent('open-portfolio', {
                    detail: { id: pid, name: item.portfolios.name }
                  }))
                }
              }}
              className="text-xs text-primary-600 dark:text-primary-400 font-medium hover:underline"
            >
              {item.portfolios.name}
            </button>
          ) : null}

          {/* Urgency badge OR Restored badge (restored takes precedence) */}
          {(() => {
            // Check if deferred item is ready to resurface (when local date >= intended deferred date)
            let isResurfaced = false
            if (item.status === 'cancelled' && item.deferred_until) {
              const deferredUntil = new Date(item.deferred_until)
              const now = new Date()
              // Extract intended date from UTC, compare with local date
              const deferredDateValue = new Date(deferredUntil.getUTCFullYear(), deferredUntil.getUTCMonth(), deferredUntil.getUTCDate()).getTime()
              const nowDateValue = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
              isResurfaced = nowDateValue >= deferredDateValue
            }

            if (isResurfaced) {
              return (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragOccurredRef.current) return
                    onAcknowledgeResurfaced?.()
                  }}
                  className="text-xs font-semibold flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors cursor-pointer bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-green-100 dark:hover:bg-green-900/30 hover:text-green-700 dark:hover:text-green-400 [&:hover_.clock-icon]:hidden [&:hover_.check-icon]:block"
                  title="Click to acknowledge and restore"
                >
                  <Clock className="clock-icon h-3 w-3" />
                  <Check className="check-icon h-3 w-3 hidden" />
                  Restored
                </button>
              )
            }

            // Show deferred until date for non-resurfaced deferred items
            if (item.status === 'cancelled' && item.deferred_until) {
              // Parse date as UTC to display the intended date regardless of timezone
              const deferDate = new Date(item.deferred_until)
              const utcDate = new Date(deferDate.getTime() + deferDate.getTimezoneOffset() * 60000)
              return (
                <span className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Until {format(utcDate, 'MMM d')}
                </span>
              )
            }

            // Default: show conviction if set
            if (item.conviction && CONVICTION_CONFIG[item.conviction]) {
              const cc = CONVICTION_CONFIG[item.conviction]
              return (
                <span className={clsx("text-[11px] font-medium flex items-center gap-1", cc.color)}>
                  {cc.label}
                  <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", cc.dot)} />
                </span>
              )
            }
            return null
          })()}

          {/* Missing requirement alert */}
          {(() => {
            const stage = item.stage || item.status
            const hasThesis = !!(item as any).thesis_text
            const hasRationale = !!item.rationale
            const missing: string[] = []
            if (!hasRationale) missing.push('Why now')
            if (['thesis_forming', 'ready_for_decision', 'deciding'].includes(stage) && !hasThesis) missing.push('Trade thesis')
            if (['ready_for_decision', 'deciding'].includes(stage) && recCount === 0) missing.push('Recommendation')
            if (missing.length === 0) return null
            return (
              <MissingReqAlert missing={missing} />
            )
          })()}

          {/* Research depth indicator (1-5 dots) */}
          {item.research_depth != null && item.research_depth > 0 && (
            <span className="flex items-center gap-0.5 ml-1" title={`Research depth: ${item.research_depth}/5`}>
              {[1, 2, 3, 4, 5].map(i => (
                <span
                  key={i}
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    i <= item.research_depth!
                      ? "bg-indigo-500 dark:bg-indigo-400"
                      : "bg-gray-200 dark:bg-gray-600"
                  )}
                />
              ))}
            </span>
          )}

          {/* Catalyst clarity indicator */}
          {item.catalyst_clarity != null && item.catalyst_clarity > 0 && (
            <span className={clsx(
              "text-[10px] px-1.5 py-0.5 rounded font-medium",
              item.catalyst_clarity >= 4 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
              item.catalyst_clarity >= 2 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' :
              'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
            )} title={`Catalyst clarity: ${item.catalyst_clarity}/5`}>
              Cat {item.catalyst_clarity}/5
            </span>
          )}

          {/* Labs dropdown - show portfolio names with committed check */}
          {showLabsDropdown && labInfo && labCount > 0 && (
            <div
              className="absolute left-0 top-full mt-0.5 z-50 bg-white dark:bg-gray-800 rounded-md shadow-md border border-gray-200 dark:border-gray-700 py-0.5 min-w-[160px]"
              onClick={(e) => e.stopPropagation()}
            >
              {labInfo.portfolioNames?.map((portfolioName, idx) => {
                  const pid = labInfo.portfolioIds[idx]
                  const isCommitted = committedTradeMap?.get(item.id)?.has(pid)
                  return (
                    <button
                      key={labInfo.labIds[idx]}
                      onClick={() => {
                        onLabClick?.(labInfo.labIds[idx], labInfo.labNames[idx], pid)
                        setShowLabsDropdown(false)
                      }}
                      className={clsx(
                        "w-full flex items-center gap-1.5 px-2 py-1 text-xs text-left transition-colors",
                        isCommitted
                          ? "text-gray-400 dark:text-gray-500"
                          : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                      )}
                    >
                      <Briefcase className={clsx("h-3 w-3 flex-shrink-0", isCommitted ? "text-gray-300" : "text-gray-400")} />
                      <span className="truncate flex-1">{portfolioName}</span>
                      {isCommitted && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" title="Committed to Trade Book" />
                      )}
                    </button>
                  )
              })}
            </div>
          )}
        </div>

        {/* Proposal Summary Strip - only for Deciding column */}
        {isDeciding && proposalSummary && (
          <DecidingRecommendationSummary
            summary={proposalSummary}
            ownerName={creatorName}
            selectedPortfolioName={selectedPortfolioName}
          />
        )}

        {/* Recommendation badge — inline, not full-width */}
        {recCount > 0 && (
          <div className="mb-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onRecommendationClick?.() }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400 border border-teal-200 dark:border-teal-800/40 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors"
            >
              <FileCheck className="h-2.5 w-2.5" />
              {recCount} {recCount === 1 ? 'recommendation' : 'recommendations'}
            </button>
          </div>
        )}

        {/* Derived urgency alert */}
        {(() => {
          const du = getDerivedUrgency(item.stage || item.status, item.updated_at || item.created_at)
          if (!du) return null
          const cfg = DERIVED_URGENCY_CONFIG[du]
          return (
            <p className={clsx("text-[11px] font-medium mb-1.5", cfg.color)}>
              {cfg.icon} {cfg.label}
            </p>
          )
        })()}

        {/* Rationale */}
        {item.rationale && (
          <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3 mb-2 leading-relaxed">
            {item.rationale}
          </p>
        )}

        {/* Footer: Author + Pipeline Age + Comments/Votes */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1.5">
            <User className="h-3 w-3" />
            <span>{creatorName}</span>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            {(() => {
              const hasUpdate = item.updated_at && item.updated_at !== item.created_at
              const stalenessDate = hasUpdate ? item.updated_at : item.created_at
              const staleColor = getStalenessColor(stalenessDate, item.stage || item.status)
              return (
                <>
                  <span className={clsx("flex items-center gap-0.5", !hasUpdate && staleColor)} title={`In pipeline since ${new Date(item.created_at).toLocaleDateString()}`}>
                    <Timer className="h-3 w-3" />
                    Pipeline {getPipelineAge(item.created_at)}
                  </span>
                  {hasUpdate && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">•</span>
                      <span className={staleColor} title={`Last updated ${new Date(item.updated_at).toLocaleString()}`}>
                        Updated {getPipelineAge(item.updated_at)}
                      </span>
                    </>
                  )}
                </>
              )
            })()}
          </div>

          <div className="flex items-center gap-2">
            {item.trade_queue_comments && item.trade_queue_comments.length > 0 && (
              <span className="flex items-center gap-0.5">
                <MessageSquare className="h-3 w-3" />
                {item.trade_queue_comments.length}
              </span>
            )}
            {item.vote_summary && (
              <>
                {item.vote_summary.approve > 0 && (
                  <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                    <ThumbsUp className="h-3 w-3" />
                    {item.vote_summary.approve}
                  </span>
                )}
                {item.vote_summary.reject > 0 && (
                  <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                    <ThumbsDown className="h-3 w-3" />
                    {item.vote_summary.reject}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
