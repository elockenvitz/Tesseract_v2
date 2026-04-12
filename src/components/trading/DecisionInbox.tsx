/**
 * DecisionInbox — PM decision console for the Trade Queue.
 *
 * Grouped by trade idea, with portfolio-specific decision rows.
 * Dense, scannable, institutional.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import { formatDistanceToNow, addDays, addWeeks, endOfMonth, startOfDay, format } from 'date-fns'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Briefcase,
  Check,
  X,
  Gavel,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Minus,
  Undo2,
  Loader2,
  Bell,
  Beaker,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../common/Toast'
import {
  useAllDecisionRequests,
  useUpdateDecisionRequest,
  useAcceptFromInbox,
  useRevertDecisionAccept,
} from '../../hooks/useDecisionRequests'
import type { DecisionRequest, DecisionRequestStatus, DeferralTrigger } from '../../types/trading'

type InboxTab = 'needs_decision' | 'accepted' | 'rejected' | 'deferred'

const NEEDS_DECISION_STATUSES: DecisionRequestStatus[] = ['pending', 'under_review', 'needs_discussion']

const TAB_CONFIG: Record<InboxTab, {
  label: string
  statuses: DecisionRequestStatus[]
  icon: React.ElementType
  emptyTitle: string
  emptyDescription: string
}> = {
  needs_decision: {
    label: 'Pending',
    statuses: ['pending', 'under_review', 'needs_discussion'],
    icon: Inbox,
    emptyTitle: 'No pending decisions',
    emptyDescription: 'Analyst recommendations awaiting PM review will appear here.',
  },
  accepted: {
    label: 'Accepted',
    statuses: ['accepted'],
    icon: CheckCircle2,
    emptyTitle: 'No accepted decisions',
    emptyDescription: 'Approved recommendations will appear here.',
  },
  rejected: {
    label: 'Rejected',
    statuses: ['rejected'],
    icon: XCircle,
    emptyTitle: 'No rejected decisions',
    emptyDescription: 'Declined recommendations will appear here.',
  },
  deferred: {
    label: 'Deferred',
    statuses: ['deferred'],
    icon: Clock,
    emptyTitle: 'No deferred decisions',
    emptyDescription: 'Recommendations deferred for later will appear here.',
  },
}

interface DecisionInboxProps {
  portfolioId?: string
  onIdeaClick?: (tradeId: string) => void
  panelMode?: boolean
  searchQuery?: string
  actionFilter?: string
  urgencyFilter?: string
  createdByFilter?: string
  /** Callback to report the permission-filtered pending count to the parent */
  onPendingCountChange?: (count: number) => void
}

interface IdeaGroup {
  tradeId: string
  symbol: string
  companyName: string
  action: string
  rationale: string | null
  conviction: string | null
  urgency: string | null
  isPairTrade: boolean
  pairBuySymbols: string[]
  pairSellSymbols: string[]
  requests: DecisionRequest[]
}

// ── Helpers ──────────────────────────────────────────────────────

function formatFullName(user: DecisionRequest['requester']): string {
  if (!user) return 'Unknown'
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return name || user.email?.split('@')[0] || 'Unknown'
}

function fmtDelta(val: number): string {
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`
}

function fmtTime(dateStr: string): string {
  const d = formatDistanceToNow(new Date(dateStr), { addSuffix: false })
  // Compress: "about 4 hours" → "4h", "2 days" → "2d", "less than a minute" → "<1m"
  return d
    .replace(/^about\s+/, '')
    .replace(/less than a minute/, '<1m')
    .replace(/(\d+)\s*seconds?/, '$1s')
    .replace(/(\d+)\s*minutes?/, '$1m')
    .replace(/(\d+)\s*hours?/, '$1h')
    .replace(/(\d+)\s*days?/, '$1d')
    .replace(/(\d+)\s*months?/, '$1mo')
    .replace(/(\d+)\s*years?/, '$1y')
    .trim()
}

type TradeClass = { label: string; color: string; icon: React.ElementType }

function classifyTrade(current: number, target: number): TradeClass {
  // Close position
  if (target === 0 && current !== 0) return { label: 'Close', color: 'text-red-600 dark:text-red-400', icon: Minus }

  // New position from zero
  if (current === 0 || Math.abs(current) < 0.005) {
    if (target > 0) return { label: 'New Long', color: 'text-emerald-600 dark:text-emerald-400', icon: Plus }
    if (target < 0) return { label: 'New Short', color: 'text-red-600 dark:text-red-400', icon: Plus }
  }

  // Flip direction
  if (current > 0 && target < 0) return { label: 'Flip to Short', color: 'text-red-600 dark:text-red-400', icon: ArrowDownRight }
  if (current < 0 && target > 0) return { label: 'Flip to Long', color: 'text-emerald-600 dark:text-emerald-400', icon: ArrowUpRight }

  // Long position: increase or reduce
  if (current > 0) {
    if (target > current) return { label: 'Add', color: 'text-green-600 dark:text-green-400', icon: ArrowUpRight }
    if (target < current) return { label: 'Reduce', color: 'text-amber-600 dark:text-amber-400', icon: ArrowDownRight }
  }

  // Short position: add (more short) or reduce (cover)
  if (current < 0) {
    if (target < current) return { label: 'Add', color: 'text-red-600 dark:text-red-400', icon: ArrowDownRight }
    if (target > current) return { label: 'Reduce', color: 'text-amber-600 dark:text-amber-400', icon: ArrowUpRight }
  }

  return { label: 'Hold', color: 'text-gray-400', icon: Minus }
}

const URGENCY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: 'Urgent', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' },
  high: { label: 'High Urgency', color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  medium: { label: '', color: '', bg: '' }, // don't show for medium
  low: { label: '', color: '', bg: '' },
}

const CONVICTION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'High Conviction', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  medium: { label: '', color: '', bg: '' }, // don't show for medium
  low: { label: 'Low Conviction', color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-700/50' },
}

// ── Main Component ──────────────────────────────────────────────

export function DecisionInbox({ portfolioId, onIdeaClick, panelMode, searchQuery, actionFilter, urgencyFilter, createdByFilter, onPendingCountChange }: DecisionInboxProps) {
  const [activeTab, setActiveTab] = useState<InboxTab>('needs_decision')
  const [waitingFilter, setWaitingFilter] = useState<'all' | 'for_me' | 'for_others'>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [nudgingRequestId, setNudgingRequestId] = useState<string | null>(null)

  const { user } = useAuth()
  const toast = useToast()
  const { data: allRequests = [], isLoading } = useAllDecisionRequests(portfolioId)
  const updateMutation = useUpdateDecisionRequest()
  const acceptMutation = useAcceptFromInbox()
  const revertMutation = useRevertDecisionAccept()

  // Nudge PM mutation
  const nudgeMutation = useMutation({
    mutationFn: async ({ request, portfolioName }: { request: DecisionRequest; portfolioName?: string }) => {
      if (!user?.id) throw new Error('Not authenticated')
      // Find PMs on this portfolio
      const { data: teamMembers } = await supabase
        .from('portfolio_team')
        .select('user_id, role')
        .eq('portfolio_id', request.portfolio_id)
      const pmIds = (teamMembers || [])
        .filter(m => m.role?.toLowerCase().includes('manager') || m.role?.toLowerCase().includes('pm'))
        .map(m => m.user_id)
        .filter(id => id !== user.id) // Don't nudge yourself
      // If no PMs found, nudge all team members except self
      const targetIds = pmIds.length > 0 ? pmIds : (teamMembers || []).map(m => m.user_id).filter(id => id !== user.id)
      if (targetIds.length === 0) throw new Error('No team members to nudge')

      const symbol = request.trade_queue_item?.assets?.symbol || 'a trade idea'
      const senderName = (user as any).first_name || user.email || 'A team member'

      const notifications = targetIds.map(userId => ({
        user_id: userId,
        type: 'decision_nudge' as const,
        title: 'Decision needed',
        message: `${senderName} is waiting for a decision on ${symbol} (${portfolioName || 'portfolio'})`,
        context_type: 'decision_request',
        context_id: request.id,
        context_data: {
          trade_queue_item_id: request.trade_queue_item_id,
          portfolio_id: request.portfolio_id,
          symbol,
          nudged_by: user.id,
        },
      }))

      const { error } = await supabase.from('notifications').insert(notifications)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Follow-up sent')
      setNudgingRequestId(null)
    },
    onError: (err: any) => {
      toast.error('Follow-up failed', err?.message || 'Unknown error')
      setNudgingRequestId(null)
    },
  })

  // Fetch current user's portfolio roles: { portfolioId → role }
  const { data: userPortfolioRoles } = useQuery({
    queryKey: ['user-portfolio-roles', user?.id],
    queryFn: async () => {
      if (!user?.id) return new Map<string, string>()
      const { data, error } = await supabase
        .from('portfolio_team')
        .select('portfolio_id, role')
        .eq('user_id', user.id)
      if (error) return new Map<string, string>()
      const m = new Map<string, string>()
      data?.forEach(r => m.set(r.portfolio_id, r.role))
      return m
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  })

  // Apply search + filters
  const filteredRequests = useMemo(() => {
    return allRequests.filter(req => {
      if (actionFilter && actionFilter !== 'all' && req.trade_queue_item?.action !== actionFilter) return false
      if (urgencyFilter && urgencyFilter !== 'all' && req.urgency !== urgencyFilter) return false
      if (createdByFilter && createdByFilter !== 'all' && req.requested_by !== createdByFilter) return false
      if (searchQuery?.trim()) {
        const q = searchQuery.toLowerCase()
        const sym = req.trade_queue_item?.assets?.symbol?.toLowerCase() || ''
        const co = req.trade_queue_item?.assets?.company_name?.toLowerCase() || ''
        const who = formatFullName(req.requester).toLowerCase()
        const port = req.portfolio?.name?.toLowerCase() || ''
        if (!sym.includes(q) && !co.includes(q) && !who.includes(q) && !port.includes(q)) return false
      }
      return true
    })
  }, [allRequests, searchQuery, actionFilter, urgencyFilter, createdByFilter])

  // Permission filter: only show decisions relevant to current user's role
  // - PM sees analyst recommendations for portfolios they manage
  // - Analyst sees PM-initiated recommendations for ideas they cover
  // - Admin sees everything
  const permissionedRequests = useMemo(() => {
    if (!user?.id || !userPortfolioRoles || userPortfolioRoles.size === 0) return filteredRequests
    if (user.role === 'admin') return filteredRequests

    return filteredRequests.filter(req => {
      const myRole = userPortfolioRoles.get(req.portfolio_id)
      if (!myRole) return false // not on this portfolio at all

      // Always show my own recommendations (so I can see their status)
      if (req.requested_by === user.id) return true

      const isPM = myRole.toLowerCase().includes('manager') || myRole.toLowerCase().includes('pm')

      if (isPM) {
        // PM sees recommendations from others
        return true
      }

      // Analyst sees others' recommendations for ideas they cover
      const tradeItem = req.trade_queue_item
      const isCoveredByMe = tradeItem?.created_by === user.id || tradeItem?.assigned_to === user.id
      return isCoveredByMe
    })
  }, [filteredRequests, user?.id, user?.role, userPortfolioRoles])

  // Bucket
  const buckets = useMemo(() => {
    const r: Record<InboxTab, DecisionRequest[]> = { needs_decision: [], accepted: [], rejected: [], deferred: [] }
    permissionedRequests.forEach(req => {
      if (NEEDS_DECISION_STATUSES.includes(req.status)) r.needs_decision.push(req)
      else if (req.status === 'accepted' || req.status === 'accepted_with_modification') r.accepted.push(req)
      else if (req.status === 'rejected') r.rejected.push(req)
      else if (req.status === 'deferred') r.deferred.push(req)
    })
    return r
  }, [permissionedRequests])

  // Report permission-filtered pending count to parent
  useEffect(() => {
    onPendingCountChange?.(buckets.needs_decision.length)
  }, [buckets.needs_decision.length, onPendingCountChange])

  // Classify: "for_me" = I can act (PM or not my rec), "sent_by_me" = I submitted, waiting for PM
  const classifyWaiting = (req: DecisionRequest): 'for_me' | 'sent_by_me' | 'other' => {
    if (!user?.id || !userPortfolioRoles) return 'other'
    const isMyRec = req.requested_by === user.id
    const myRole = userPortfolioRoles.get(req.portfolio_id)
    if (!myRole) return 'other'
    const isPM = myRole.toLowerCase().includes('manager') || myRole.toLowerCase().includes('pm')

    // PM can always act — even on own recs
    if (isPM) return 'for_me'
    // Not PM, but I submitted → waiting for PM
    if (isMyRec) return 'sent_by_me'
    // Not PM, not my rec, but I can see it → for me (analyst action)
    return 'for_me'
  }

  // Apply waiting filter to needs_decision tab
  const filteredBucket = useMemo(() => {
    const items = buckets[activeTab]
    if (activeTab !== 'needs_decision' || waitingFilter === 'all' || !user?.id || !userPortfolioRoles) return items

    return items.filter(req => {
      const cls = classifyWaiting(req)
      if (waitingFilter === 'for_me') return cls === 'for_me'
      if (waitingFilter === 'for_others') return cls === 'sent_by_me'
      return true
    })
  }, [buckets, activeTab, waitingFilter, user?.id, userPortfolioRoles])

  // Counts for the waiting filter
  const waitingCounts = useMemo(() => {
    if (!user?.id || !userPortfolioRoles) return { for_me: 0, sent_by_me: 0 }
    const items = buckets.needs_decision
    let forMe = 0, sentByMe = 0
    items.forEach(req => {
      const cls = classifyWaiting(req)
      if (cls === 'for_me') forMe++
      else if (cls === 'sent_by_me') sentByMe++
    })
    return { for_me: forMe, sent_by_me: sentByMe }
  }, [buckets.needs_decision, user?.id, userPortfolioRoles])

  // Group by idea — pair trades group by pair_trade_id
  const grouped = useMemo((): IdeaGroup[] => {
    const map = new Map<string, IdeaGroup>()
    filteredBucket.forEach(req => {
      const pairId = (req.trade_queue_item as any)?.pair_trade_id as string | null
      const snapshot = req.submission_snapshot as any
      const isPair = !!(pairId || snapshot?.sizing_context?.isPairTrade)
      const groupId = pairId || req.trade_queue_item_id

      if (!map.has(groupId)) {
        map.set(groupId, {
          tradeId: groupId,
          symbol: req.trade_queue_item?.assets?.symbol || '?',
          companyName: req.trade_queue_item?.assets?.company_name || '',
          action: isPair ? 'pair' : (req.trade_queue_item?.action || 'buy'),
          rationale: req.trade_queue_item?.rationale || null,
          conviction: req.trade_queue_item?.conviction || null,
          urgency: req.trade_queue_item?.urgency || req.urgency || null,
          isPairTrade: isPair,
          pairBuySymbols: [],
          pairSellSymbols: [],
          requests: [],
        })
      }
      const group = map.get(groupId)!
      group.requests.push(req)

      // For pair trades, collect leg symbols by direction from the request's leg
      if (isPair && req.trade_queue_item?.assets?.symbol) {
        const sym = req.trade_queue_item.assets.symbol
        const legAction = req.trade_queue_item.action
        if ((legAction === 'buy' || legAction === 'add') && !group.pairBuySymbols.includes(sym)) {
          group.pairBuySymbols.push(sym)
        } else if ((legAction === 'sell' || legAction === 'reduce') && !group.pairSellSymbols.includes(sym)) {
          group.pairSellSymbols.push(sym)
        }
      }
    })

    // Also extract pair symbols from snapshot legs (more reliable)
    map.forEach(group => {
      if (group.isPairTrade && group.requests.length > 0) {
        const snapshot = group.requests[0].submission_snapshot as any
        const legs = snapshot?.sizing_context?.legs as Array<{ symbol?: string; action?: string }> | undefined
        if (legs && legs.length > 0) {
          const buySyms = legs.filter(l => l.action === 'buy' || l.action === 'add').map(l => l.symbol).filter(Boolean) as string[]
          const sellSyms = legs.filter(l => l.action === 'sell' || l.action === 'reduce').map(l => l.symbol).filter(Boolean) as string[]
          if (buySyms.length > 0) group.pairBuySymbols = buySyms
          if (sellSyms.length > 0) group.pairSellSymbols = sellSyms
        }
      }
    })

    return Array.from(map.values())
  }, [filteredBucket])

  const toggleGroup = (id: string) => setCollapsedGroups(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const handleAction = (id: string, status: DecisionRequestStatus) => {
    updateMutation.mutate({ requestId: id, input: { status } })
  }

  const handleUndo = useCallback(async (request: DecisionRequest) => {
    if (!user) return
    revertMutation.mutate({
      decisionRequestId: request.id,
      context: {
        actorId: user.id,
        actorName: (user as any).first_name || user.email || 'PM',
        actorRole: 'pm',
        requestId: `undo-${request.id}-${Date.now()}`,
      },
    })
  }, [user, revertMutation])

  const tabConfig = TAB_CONFIG[activeTab]
  const TabIcon = tabConfig.icon

  return (
    <div className={clsx(panelMode ? "flex flex-col h-full" : "border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800/50")}>
      {/* Header — omitted in panel mode */}
      {!panelMode && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Gavel className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Decision Inbox</h3>
            {buckets.needs_decision.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full">
                {buckets.needs_decision.length}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tabs + waiting filter on same line */}
      <div className="flex items-center border-b border-gray-200 dark:border-gray-700 px-1 gap-0.5 flex-shrink-0">
        {(Object.entries(TAB_CONFIG) as [InboxTab, typeof TAB_CONFIG[InboxTab]][]).map(([key, config]) => {
          const count = buckets[key].length
          const isActive = activeTab === key
          return (
            <button
              key={key}
              onClick={() => { setActiveTab(key); if (key !== 'needs_decision') setWaitingFilter('all') }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px',
                isActive
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              {config.label}
              {count > 0 && (
                <span className={clsx(
                  'px-1.5 py-0.5 rounded-full text-xs font-semibold',
                  isActive && key === 'needs_decision' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : isActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}

        {/* Waiting filter — right-aligned, only on needs_decision tab */}
        {activeTab === 'needs_decision' && buckets.needs_decision.length > 0 && (
          <div className="flex items-center ml-auto bg-gray-100 dark:bg-gray-700/50 rounded-lg p-0.5 gap-0.5">
            {([
              { key: 'all' as const, label: 'All', count: buckets.needs_decision.length },
              { key: 'for_me' as const, label: 'For Me', count: waitingCounts.for_me },
              { key: 'for_others' as const, label: 'Sent by Me', count: waitingCounts.sent_by_me },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setWaitingFilter(f.key)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
                  waitingFilter === f.key
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                )}
              >
                {f.label}
                {f.count > 0 && (
                  <span className={clsx(
                    'ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold min-w-[18px] inline-block text-center',
                    waitingFilter === f.key
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-400'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400'
                  )}>
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className={clsx("overflow-y-auto", panelMode ? "flex-1 min-h-0" : "max-h-[600px]")}>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading decisions...</div>
        ) : grouped.length === 0 ? (
          <div className="py-10 text-center px-6">
            <TabIcon className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{tabConfig.emptyTitle}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-xs mx-auto">{tabConfig.emptyDescription}</p>
          </div>
        ) : (
          <div className="py-1">
            {grouped.map((group, gi) => {
              const isExpanded = !collapsedGroups.has(group.tradeId)
              const isBuy = group.action === 'buy' || group.action === 'add'
              const isPair = group.isPairTrade
              const urg = URGENCY_CONFIG[group.urgency || '']
              const showUrgency = urg?.label

              return (
                <div key={group.tradeId} className={clsx("mx-2 mb-3 rounded-lg border overflow-hidden", "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60")}>
                  {/* ── Idea Header ─────────────────────────────── */}
                  <div
                    className="px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                    onClick={() => toggleGroup(group.tradeId)}
                  >
                    {/* Line 1: chevron + action/pair badge + symbol + company + urgency + count */}
                    <div className="flex items-center gap-2">
                      <ChevronRight className={clsx('h-4 w-4 text-gray-400 transition-transform shrink-0', isExpanded && 'rotate-90')} />

                      {isPair ? (
                        <>
                          <span className="text-[11px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 leading-none bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                            Pair
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); onIdeaClick?.(group.tradeId) }}
                            className="flex items-center gap-1.5 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                          >
                            <span className="text-[11px] font-bold uppercase text-green-600 dark:text-green-400">BUY</span>
                            <span className="font-bold text-[15px] text-gray-900 dark:text-white">{group.pairBuySymbols.join(', ') || '?'}</span>
                            <span className="text-gray-300 dark:text-gray-600">–</span>
                            <span className="text-[11px] font-bold uppercase text-red-600 dark:text-red-400">SELL</span>
                            <span className="font-bold text-[15px] text-gray-900 dark:text-white">{group.pairSellSymbols.join(', ') || '?'}</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={clsx(
                            'text-[11px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 leading-none',
                            isBuy ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          )}>
                            {group.action}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); onIdeaClick?.(group.tradeId) }}
                            className="font-bold text-[15px] text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                          >
                            {group.symbol}
                          </button>
                          {group.companyName && (
                            <span className="text-[13px] text-gray-400 dark:text-gray-500">{group.companyName}</span>
                          )}
                          {group.rationale && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                              <span className="text-xs text-gray-400 dark:text-gray-500 italic truncate">{group.rationale}</span>
                            </>
                          )}
                        </>
                      )}

                      {showUrgency && (
                        <span className={clsx('text-[11px] font-bold uppercase px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0', urg.color, urg.bg)}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {urg.label}
                        </span>
                      )}

                      {(() => {
                        const conv = CONVICTION_CONFIG[group.conviction || '']
                        return conv?.label ? (
                          <span className={clsx('text-[11px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0', conv.color, conv.bg)}>
                            {conv.label}
                          </span>
                        ) : null
                      })()}

                      {!isExpanded && (
                        <span className="text-xs text-gray-400 ml-auto shrink-0">
                          {group.requests.length} {group.requests.length === 1 ? 'portfolio' : 'portfolios'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Portfolio Decision Tiles ─────────────── */}
                  {isExpanded && (
                    <div className="px-3 py-2 space-y-2 border-t border-gray-100 dark:border-gray-700/50">
                      {group.requests.map((req) => (
                        <PortfolioRow
                          key={req.id}
                          request={req}
                          isNeedsDecision={activeTab === 'needs_decision'}
                          isAcceptedTab={activeTab === 'accepted'}
                          onAcceptWithSizing={(sizingInput, note) => {
                            if (!user) return
                            acceptMutation.mutate({
                              decisionRequest: req,
                              sizingInput,
                              decisionNote: note,
                              context: {
                                actorId: user.id,
                                actorName: (user as any).first_name || user.email || 'PM',
                                actorRole: 'pm',
                                requestId: `accept-${req.id}-${Date.now()}`,
                              },
                            }, {
                              onSuccess: () => {
                                const label = group.isPairTrade
                                  ? `Pair trade ${group.pairBuySymbols.join('/')} / ${group.pairSellSymbols.join('/')} accepted`
                                  : `${req.trade_queue_item?.assets?.symbol || 'Trade'} accepted`
                                toast.success(label)
                              },
                              onError: (err: any) => {
                                toast.error('Accept failed', err?.message || 'Unknown error')
                              },
                            })
                          }}
                          onRejectWithReason={(reason) => {
                            updateMutation.mutate({ requestId: req.id, input: { status: 'rejected', decisionNote: reason } })
                          }}
                          onDeferWithConfig={(deferredUntil, trigger, note) => {
                            updateMutation.mutate({
                              requestId: req.id,
                              input: {
                                status: 'deferred',
                                deferredUntil: deferredUntil || null,
                                deferredTrigger: trigger || null,
                                decisionNote: note || null,
                              },
                            })
                          }}
                          onNudge={() => { setNudgingRequestId(req.id); nudgeMutation.mutate({ request: req }) }}
                          isNudging={nudgingRequestId === req.id && nudgeMutation.isPending}
                          onUndo={() => handleUndo(req)}
                          isResolvedTab={activeTab === 'accepted' || activeTab === 'rejected' || activeTab === 'deferred'}
                          isPending={updateMutation.isPending || acceptMutation.isPending}
                          isRevertPending={revertMutation.isPending}
                          isLast={false}
                          currentUserId={user?.id}
                          userPortfolioRoles={userPortfolioRoles}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Portfolio Decision Tile ─────────────────────────────────────

function PortfolioRow({
  request,
  isNeedsDecision,
  isAcceptedTab,
  onAcceptWithSizing,
  onRejectWithReason,
  onDeferWithConfig,
  onNudge,
  isNudging,
  onUndo,
  isResolvedTab,
  isPending,
  isRevertPending,
  currentUserId,
  userPortfolioRoles,
}: {
  request: DecisionRequest
  isNeedsDecision: boolean
  isAcceptedTab?: boolean
  onAcceptWithSizing: (sizingInput: string, note?: string) => void
  onRejectWithReason: (reason: string) => void
  onDeferWithConfig: (deferredUntil: string | null, trigger: DeferralTrigger | null, note?: string) => void
  onNudge?: () => void
  isNudging?: boolean
  onUndo: () => void
  isResolvedTab?: boolean
  isPending: boolean
  isRevertPending?: boolean
  isLast: boolean
  currentUserId?: string
  userPortfolioRoles?: Map<string, string>
}) {
  const [acceptMode, setAcceptMode] = useState(false)
  const [rejectMode, setRejectMode] = useState(false)
  const [deferMode, setDeferMode] = useState(false)
  const [deferOption, setDeferOption] = useState<string | null>(null)
  const [editingSizing, setEditingSizing] = useState(false)
  const [sizingValue, setSizingValue] = useState('')
  const [noteValue, setNoteValue] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [deferCustomDate, setDeferCustomDate] = useState('')
  const [deferPriceCondition, setDeferPriceCondition] = useState<'above' | 'below'>('above')
  const [deferPriceValue, setDeferPriceValue] = useState('')
  const [deferEventDescription, setDeferEventDescription] = useState('')
  const [deferNote, setDeferNote] = useState('')
  const snapshot = request.submission_snapshot as any
  const analystWeight = snapshot?.weight ?? request.sizing_weight ?? null
  const [overrideWeight, setOverrideWeight] = useState<string | null>(null)
  const effectiveWeight = overrideWeight != null ? parseFloat(overrideWeight) : analystWeight
  const targetWeight = effectiveWeight != null && !isNaN(effectiveWeight) ? effectiveWeight : analystWeight
  const currentWeight = (snapshot?.baseline_weight as number) ?? 0
  const sizingCtx = snapshot?.sizing_context as any
  const legs = sizingCtx?.legs as Array<{ symbol?: string; action?: string; weight?: number | null; baselineWeight?: number | null; enteredValue?: string; sizingMode?: string }> | null
  const conviction = request.trade_queue_item?.conviction || null
  const analyst = formatFullName(request.requester)
  const timeAgo = fmtTime(request.created_at)

  const buyLegs = legs?.filter(l => l.action === 'buy' || l.action === 'add') || []
  const sellLegs = legs?.filter(l => l.action === 'sell' || l.action === 'reduce') || []
  const isPairTrade = legs && legs.length > 0

  const delta = targetWeight != null ? targetWeight - currentWeight : null
  const tc = targetWeight != null ? classifyTrade(currentWeight, targetWeight) : null
  const TcIcon = tc?.icon || Minus

  // Role-aware action logic
  const isMyRec = !!(currentUserId && request.requested_by === currentUserId)
  const myRole = userPortfolioRoles?.get(request.portfolio_id)
  const isPM = myRole?.toLowerCase().includes('manager') || myRole?.toLowerCase().includes('pm')
  const showActions = isNeedsDecision && (isPM || !isMyRec)
  const isAwaiting = isMyRec && isNeedsDecision && !isPM

  // Status badge
  const statusBadge = (() => {
    if (request.status === 'accepted_with_modification') return { label: 'Modified', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
    if (request.status === 'accepted') return { label: 'Accepted', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' }
    if (request.status === 'rejected') return { label: 'Rejected', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    if (request.status === 'deferred') return { label: 'Deferred', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' }
    if (isAwaiting) return { label: 'Awaiting PM decision', color: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' }
    if (isNeedsDecision) return { label: 'Pending', color: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' }
    return null
  })()

  const showUndo = isResolvedTab && (request.status === 'accepted' || request.status === 'accepted_with_modification' || request.status === 'rejected' || request.status === 'deferred')

  const undoBtn = showUndo ? (
    <button
      onClick={onUndo}
      disabled={isRevertPending}
      className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
    >
      {isRevertPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Undo
    </button>
  ) : null

  const statusWithUndo = (badgeClassName?: string) => statusBadge ? (
    <div className="flex items-center gap-1.5 shrink-0">
      {isAwaiting && onNudge ? (
        <button
          onClick={(e) => { e.stopPropagation(); onNudge() }}
          disabled={isNudging}
          className={clsx(
            'text-xs font-medium px-2 py-1 rounded flex items-center gap-1 transition-colors disabled:opacity-50',
            'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/40'
          )}
        >
          <Bell className="w-3 h-3" />
          {isNudging ? 'Sending...' : 'Awaiting PM — Request Follow-up'}
        </button>
      ) : (
        <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded', statusBadge.color, badgeClassName)}>
          {statusBadge.label}
        </span>
      )}
      {undoBtn}
    </div>
  ) : undoBtn

  const portfolioName = request.portfolio?.name || 'Unknown'
  const actionLabel = tc?.label?.toLowerCase() || request.trade_queue_item?.action || 'trade'

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
      {/* Line 1: Natural language sentence — "Add to Vision Fund 10K from 0.50% → 2.00%" */}
      <div className="flex items-center justify-between gap-2">
        {!isPairTrade && tc && targetWeight != null ? (
          <p className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <span className={clsx('font-bold', tc.color)}>{tc.label}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="font-semibold text-gray-900 dark:text-white">{portfolioName}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-gray-400 tabular-nums">
              {currentWeight.toFixed(2)}% →{' '}
              {showActions && editingSizing ? (
                <input
                  type="text"
                  value={sizingValue}
                  onChange={e => setSizingValue(e.target.value)}
                  onBlur={() => {
                    const parsed = parseFloat(sizingValue)
                    if (!isNaN(parsed)) setOverrideWeight(sizingValue)
                    setEditingSizing(false)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const parsed = parseFloat(sizingValue)
                      if (!isNaN(parsed)) setOverrideWeight(sizingValue)
                      setEditingSizing(false)
                    }
                    if (e.key === 'Escape') { setSizingValue(String(targetWeight)); setEditingSizing(false) }
                  }}
                  autoFocus
                  className="w-16 px-1 py-0 text-xs font-semibold rounded border border-primary-300 dark:border-primary-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-400 tabular-nums inline"
                />
              ) : (
                <button
                  onClick={() => { if (showActions) { setSizingValue(String(targetWeight)); setEditingSizing(true) } }}
                  className={clsx(
                    'font-semibold text-gray-900 dark:text-white tabular-nums',
                    showActions && 'cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 border-b border-dashed border-gray-300 dark:border-gray-600'
                  )}
                  disabled={!showActions}
                >
                  {targetWeight.toFixed(2)}%
                </button>
              )}
            </span>
            {overrideWeight != null && analystWeight != null && parseFloat(overrideWeight) !== analystWeight && (
              <span className="text-[10px] text-amber-500 ml-1">(was {analystWeight.toFixed(2)}%)</span>
            )}
            {request.portfolio_id && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  window.dispatchEvent(new CustomEvent('openTradeLab', {
                    detail: { portfolioId: request.portfolio_id },
                  }))
                }}
                className="flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors flex-shrink-0"
              >
                <Beaker className="h-3 w-3" />
                Trade Lab
              </button>
            )}
          </p>
        ) : isPairTrade ? (
          <div className="space-y-0.5">
            {[...buyLegs, ...sellLegs].map((l, i) => {
              const legWeight = l.weight ?? 0
              const baseWeight = l.baselineWeight ?? 0
              const absWeight = Math.abs(legWeight)
              const isAbsolute = l.sizingMode === 'absolute'
              const targetWt = isAbsolute ? legWeight : baseWeight + legWeight
              const legTc = classifyTrade(baseWeight, targetWt)
              const displayDelta = isAbsolute ? `→ ${absWeight.toFixed(2)}%` : `${legWeight > 0 ? '+' : ''}${legWeight.toFixed(2)}%`
              return (
                <p key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <span className={clsx('font-bold', legTc.color)}>
                    {legTc.label}
                  </span>
                  <span className="font-semibold text-gray-900 dark:text-white">{l.symbol}</span>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="font-medium">{portfolioName}</span>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-gray-400 tabular-nums">
                    {baseWeight.toFixed(2)}% {displayDelta}
                  </span>
                  {i === 0 && request.portfolio_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        window.dispatchEvent(new CustomEvent('openTradeLab', {
                          detail: { portfolioId: request.portfolio_id },
                        }))
                      }}
                      className="flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors flex-shrink-0"
                    >
                      <Beaker className="h-3 w-3" />
                      Trade Lab
                    </button>
                  )}
                </p>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic flex items-center gap-1.5">
            <span>{actionLabel}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span>{portfolioName}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span>no sizing</span>
            {request.portfolio_id && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  window.dispatchEvent(new CustomEvent('openTradeLab', {
                    detail: { portfolioId: request.portfolio_id },
                  }))
                }}
                className="flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors flex-shrink-0"
              >
                <Beaker className="h-3 w-3" />
                Trade Lab
              </button>
            )}
          </p>
        )}
        {statusWithUndo()}
      </div>

      {/* Line 2: Recommendation note (analyst's reasoning for this specific action) */}
      {request.context_note && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-snug italic">{request.context_note}</p>
      )}

      {/* Line 3: Who recommended + when */}
      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-400 dark:text-gray-500">
        <span className="font-medium text-gray-500 dark:text-gray-400">{analyst}</span>
        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
        <span>{timeAgo}</span>
      </div>

      {/* 5. Actions — pending tab (default state) */}
      {showActions && !acceptMode && !rejectMode && !deferMode && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50">
          <button
            onClick={() => { setNoteValue(''); setAcceptMode(true) }}
            disabled={isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> Accept
          </button>
          <button
            onClick={() => { setRejectReason(''); setRejectMode(true) }}
            disabled={isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
          >
            <X className="h-3 w-3" /> Reject
          </button>
          <button
            onClick={() => { setDeferOption(null); setDeferCustomDate(''); setDeferPriceCondition('above'); setDeferPriceValue(''); setDeferEventDescription(''); setDeferNote(''); setDeferMode(true) }}
            disabled={isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <Clock className="h-3 w-3" /> Defer
          </button>
        </div>
      )}

      {/* 5a. Accept confirmation strip */}
      {showActions && acceptMode && (
        <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-900/40 bg-green-50/50 dark:bg-green-900/10 -mx-3 -mb-3 px-3 pb-3 rounded-b-md">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5 text-xs">
              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              <span className="font-semibold text-green-700 dark:text-green-400">
                Accept at {targetWeight != null ? `${targetWeight.toFixed(2)}%` : 'analyst sizing'}
              </span>
              {overrideWeight != null && analystWeight != null && parseFloat(overrideWeight) !== analystWeight && (
                <span className="text-[10px] text-amber-500">(modified)</span>
              )}
            </div>
          </div>
          <input
            type="text"
            value={noteValue}
            onChange={e => setNoteValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const sizing = overrideWeight ?? (analystWeight != null ? String(analystWeight) : (isPairTrade ? 'pair' : ''))
                if (sizing || isPairTrade) {
                  onAcceptWithSizing(sizing || 'pair', noteValue.trim() || undefined)
                  setAcceptMode(false)
                }
              }
              if (e.key === 'Escape') setAcceptMode(false)
            }}
            autoFocus
            placeholder="Add a note (optional)"
            className="w-full px-2 py-1 text-xs rounded border border-green-200 dark:border-green-800 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-green-400 mb-2"
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const sizing = overrideWeight ?? (analystWeight != null ? String(analystWeight) : (isPairTrade ? 'pair' : ''))
                if (sizing || isPairTrade) {
                  onAcceptWithSizing(sizing || 'pair', noteValue.trim() || undefined)
                  setAcceptMode(false)
                }
              }}
              disabled={isPending || (!isPairTrade && analystWeight == null && overrideWeight == null)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Confirm
            </button>
            <button
              onClick={() => setAcceptMode(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-500 hover:bg-white/80 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 5b. Reject reason prompt */}
      {showActions && rejectMode && (
        <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10 -mx-3 -mb-3 px-3 pb-3 rounded-b-md">
          <div className="flex items-center gap-1.5 text-xs mb-1.5">
            <X className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            <span className="font-semibold text-red-700 dark:text-red-400">Reason for rejection</span>
          </div>
          <input
            type="text"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && rejectReason.trim()) {
                onRejectWithReason(rejectReason.trim())
                setRejectMode(false)
              }
              if (e.key === 'Escape') setRejectMode(false)
            }}
            autoFocus
            placeholder="e.g. Insufficient conviction, timing not right..."
            className="w-full px-2 py-1 text-xs rounded border border-red-200 dark:border-red-800 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-red-400 mb-2"
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                if (rejectReason.trim()) {
                  onRejectWithReason(rejectReason.trim())
                  setRejectMode(false)
                }
              }}
              disabled={isPending || !rejectReason.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              Reject
            </button>
            <button
              onClick={() => setRejectMode(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-500 hover:bg-white/80 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 5c. Defer configuration */}
      {showActions && deferMode && (() => {
        const sym = request.trade_queue_item?.assets?.symbol || '?'
        const assetId = request.trade_queue_item?.assets?.id
        const now = new Date()
        const timeOptions = [
          { key: '1d', label: 'Tomorrow', date: format(addDays(now, 1), 'MMM d') },
          { key: '1w', label: '1 week', date: format(addWeeks(now, 1), 'MMM d') },
          { key: '2w', label: '2 weeks', date: format(addWeeks(now, 2), 'MMM d') },
          { key: 'eom', label: 'End of month', date: format(endOfMonth(now), 'MMM d') },
        ]

        const canSubmit = (() => {
          if (!deferOption) return false
          if (deferOption === 'custom_date') return !!deferCustomDate
          if (deferOption === 'price') return !!deferPriceValue && parseFloat(deferPriceValue) > 0
          if (deferOption === 'event') return !!deferEventDescription.trim()
          return true // time presets + earnings are always ready
        })()

        const handleDeferSubmit = () => {
          if (!canSubmit) return
          let deferredUntil: string | null = null
          let trigger: DeferralTrigger | null = null

          if (deferOption === '1d') deferredUntil = startOfDay(addDays(now, 1)).toISOString()
          else if (deferOption === '1w') deferredUntil = startOfDay(addWeeks(now, 1)).toISOString()
          else if (deferOption === '2w') deferredUntil = startOfDay(addWeeks(now, 2)).toISOString()
          else if (deferOption === 'eom') deferredUntil = endOfMonth(now).toISOString()
          else if (deferOption === 'custom_date' && deferCustomDate) deferredUntil = startOfDay(new Date(deferCustomDate)).toISOString()
          else if (deferOption === 'price') {
            trigger = { type: 'price_level', symbol: sym, asset_id: assetId, condition: deferPriceCondition, price: parseFloat(deferPriceValue) }
          } else if (deferOption === 'earnings') {
            trigger = { type: 'earnings', symbol: sym, asset_id: assetId }
          } else if (deferOption === 'event') {
            trigger = { type: 'custom', description: deferEventDescription.trim() }
          }

          onDeferWithConfig(deferredUntil, trigger, deferNote.trim() || undefined)
          setDeferMode(false)
        }

        return (
          <div className="mt-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 -mx-3 -mb-3 px-3 pb-3 pt-2.5 rounded-b-md">
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Revisit</span>
              <button
                onClick={() => setDeferMode(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Options grid */}
            <div className="grid grid-cols-2 gap-1 mb-2">
              {timeOptions.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setDeferOption(opt.key)}
                  className={clsx(
                    'flex items-center justify-between px-2.5 py-1.5 rounded-md border text-left transition-all',
                    deferOption === opt.key
                      ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20 ring-1 ring-primary-400/30'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
                  )}
                >
                  <span className={clsx('text-[11px] font-medium', deferOption === opt.key ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300')}>
                    {opt.label}
                  </span>
                  <span className={clsx('text-[10px] tabular-nums', deferOption === opt.key ? 'text-primary-500 dark:text-primary-500' : 'text-gray-400')}>
                    {opt.date}
                  </span>
                </button>
              ))}
            </div>

            {/* Custom date row */}
            <button
              onClick={() => setDeferOption('custom_date')}
              className={clsx(
                'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-all mb-1',
                deferOption === 'custom_date'
                  ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20 ring-1 ring-primary-400/30'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
              )}
            >
              <Clock className={clsx('h-3 w-3 shrink-0', deferOption === 'custom_date' ? 'text-primary-500' : 'text-gray-400')} />
              <span className={clsx('text-[11px] font-medium shrink-0', deferOption === 'custom_date' ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300')}>
                Pick a date
              </span>
              {deferOption === 'custom_date' && (
                <input
                  type="date"
                  value={deferCustomDate}
                  onChange={e => setDeferCustomDate(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  min={format(addDays(now, 1), 'yyyy-MM-dd')}
                  autoFocus
                  className="ml-auto px-1.5 py-0.5 text-[11px] rounded border border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
                />
              )}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-2 my-2">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              <span className="text-[9px] font-medium text-gray-400 uppercase tracking-wider">or trigger</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>

            {/* Event triggers */}
            <div className="space-y-1">
              {/* Price level */}
              <button
                onClick={() => setDeferOption('price')}
                className={clsx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-all',
                  deferOption === 'price'
                    ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20 ring-1 ring-primary-400/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
                )}
              >
                <ArrowUpRight className={clsx('h-3 w-3 shrink-0', deferOption === 'price' ? 'text-primary-500' : 'text-gray-400')} />
                <span className={clsx('text-[11px] font-medium', deferOption === 'price' ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300')}>
                  {sym} hits a price
                </span>
              </button>
              {deferOption === 'price' && (
                <div className="flex items-center gap-1.5 pl-7 pb-0.5">
                  <select
                    value={deferPriceCondition}
                    onChange={e => setDeferPriceCondition(e.target.value as 'above' | 'below')}
                    className="px-1.5 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  >
                    <option value="above">above</option>
                    <option value="below">below</option>
                  </select>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">$</span>
                    <input
                      type="number"
                      value={deferPriceValue}
                      onChange={e => setDeferPriceValue(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      autoFocus
                      className="w-24 pl-5 pr-2 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 tabular-nums"
                    />
                  </div>
                </div>
              )}

              {/* Earnings */}
              <button
                onClick={() => setDeferOption('earnings')}
                className={clsx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-all',
                  deferOption === 'earnings'
                    ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20 ring-1 ring-primary-400/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
                )}
              >
                <Briefcase className={clsx('h-3 w-3 shrink-0', deferOption === 'earnings' ? 'text-primary-500' : 'text-gray-400')} />
                <span className={clsx('text-[11px] font-medium', deferOption === 'earnings' ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300')}>
                  After {sym} earnings
                </span>
              </button>

              {/* Custom event */}
              <button
                onClick={() => setDeferOption('event')}
                className={clsx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left transition-all',
                  deferOption === 'event'
                    ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20 ring-1 ring-primary-400/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800'
                )}
              >
                <AlertTriangle className={clsx('h-3 w-3 shrink-0', deferOption === 'event' ? 'text-primary-500' : 'text-gray-400')} />
                <span className={clsx('text-[11px] font-medium', deferOption === 'event' ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300')}>
                  Custom trigger
                </span>
              </button>
              {deferOption === 'event' && (
                <div className="pl-7 pb-0.5">
                  <input
                    type="text"
                    value={deferEventDescription}
                    onChange={e => setDeferEventDescription(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleDeferSubmit() }}
                    placeholder="e.g. After Fed meeting, When vol subsides..."
                    autoFocus
                    className="w-full px-2 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </div>
              )}
            </div>

            {/* Note + submit */}
            <div className="mt-2.5 pt-2 border-t border-gray-200 dark:border-gray-700">
              <input
                type="text"
                value={deferNote}
                onChange={e => setDeferNote(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && canSubmit) handleDeferSubmit()
                  if (e.key === 'Escape') setDeferMode(false)
                }}
                placeholder="Add a note (optional)"
                className="w-full px-2 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400 mb-2"
              />
              <button
                onClick={handleDeferSubmit}
                disabled={isPending || !canSubmit}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-gray-800 text-white hover:bg-gray-900 dark:bg-gray-600 dark:hover:bg-gray-500 transition-colors disabled:opacity-40"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
                Defer
              </button>
            </div>
          </div>
        )
      })()}

      {/* PM decision note */}
      {request.decision_note && (
        <p className="text-[10px] text-gray-400 italic mt-1">PM: {request.decision_note}</p>
      )}


      {/* Deferral info on deferred tab */}
      {request.status === 'deferred' && (request.deferred_until || request.deferred_trigger) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {request.deferred_until && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60 text-[10px] text-gray-500 dark:text-gray-400">
              <Clock className="h-2.5 w-2.5" />
              {format(new Date(request.deferred_until), 'MMM d, yyyy')}
            </span>
          )}
          {request.deferred_trigger && (() => {
            const t = request.deferred_trigger
            if (t.type === 'price_level') return (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-[10px] text-blue-600 dark:text-blue-400">
                <ArrowUpRight className="h-2.5 w-2.5" />
                {t.symbol} {t.condition === 'above' ? '>' : '<'} ${t.price}
              </span>
            )
            if (t.type === 'earnings') return (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/20 text-[10px] text-purple-600 dark:text-purple-400">
                <Briefcase className="h-2.5 w-2.5" />
                {t.symbol} earnings
              </span>
            )
            if (t.type === 'custom') return (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-[10px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-2.5 w-2.5" />
                {t.description}
              </span>
            )
            return null
          })()}
        </div>
      )}
    </div>
  )
}
