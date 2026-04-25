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
  useRejectFromInbox,
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
  thesisText: string | null
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
  const rejectMutation = useRejectFromInbox()
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
    if (!user?.id) return filteredRequests
    // userPortfolioRoles === undefined means the roles query hasn't
    // resolved yet. Returning the unfiltered list as a fallback makes the
    // count badge flicker from unfiltered → filtered (e.g. 8 → 7) on hard
    // refresh. Return empty during the loading window so the badge either
    // stays hidden or shows the correct number from the first paint.
    if (userPortfolioRoles === undefined) return []
    if (userPortfolioRoles.size === 0) return filteredRequests
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

  // Group by idea — pair trades group by pair_id (falling back to legacy
  // pair_trade_id). Both fields exist in the schema: pair_id is the current
  // grouping key, pair_trade_id is the legacy FK. Production data has pair_id
  // populated on all current legs and pair_trade_id NULL, so reading only
  // pair_trade_id silently fails to group multi-leg baskets.
  //
  // IMPORTANT: for pair groups, we want to display ALL legs of the pair
  // (even the ones that are already accepted/rejected/deferred) as context
  // — not just the legs that happen to be in the current tab's bucket.
  // That's the mental model: "a pair stays in the inbox as long as any
  // leg is unresolved, and already-resolved legs are shown as status rows
  // inside the pair card." To enable that, we expand pair groups from the
  // full permissionedRequests set, keyed by the same pair_id that the
  // filteredBucket leg surfaced.
  const grouped = useMemo((): IdeaGroup[] => {
    const map = new Map<string, IdeaGroup>()

    // Helper: compute grouping info for a decision request.
    // `groupKey` is the internal Map key — prefixed to avoid collisions
    // between different ID spaces (proposal / pair / trade_queue_item).
    // `tradeId` is the outward-facing ID used when opening the detail modal
    // (must be a real pair_id or trade_queue_item_id, not a prefixed key).
    //
    // Prefers proposal_id for grouping since pair trades share one proposal
    // across all legs — this is the most robust key: even if the Postgrest
    // join returns a null pair_id for some legs due to caching/shape/race,
    // 4 DRs created from the same pair recommendation all carry the same
    // proposal_id and still group together.
    const getGroupInfo = (r: DecisionRequest): { groupKey: string; tradeId: string; isPair: boolean } => {
      const tqi = (r.trade_queue_item as any)
      const pairId = (tqi?.pair_id || tqi?.pair_trade_id || null) as string | null
      const snapshot = r.submission_snapshot as any
      const hasPairHint = !!(pairId || snapshot?.sizing_context?.isPairTrade)
      if (r.proposal_id && hasPairHint) {
        // Proposal-based grouping — the tradeId should still be the pair_id
        // if we have it (so the modal opens to the pair), falling back to
        // the leg's trade_queue_item_id if we don't.
        return {
          groupKey: `proposal:${r.proposal_id}`,
          tradeId: pairId || r.trade_queue_item_id,
          isPair: true,
        }
      }
      if (pairId) {
        return {
          groupKey: `pair:${pairId}`,
          tradeId: pairId,
          isPair: true,
        }
      }
      return {
        groupKey: `tqi:${r.trade_queue_item_id}`,
        tradeId: r.trade_queue_item_id,
        isPair: false,
      }
    }

    // Pre-index ALL permissioned requests by group key so we can pull in
    // sibling DRs (resolved legs of pairs, multi-portfolio DRs of singletons)
    // alongside pending ones. We EXCLUDE withdrawn requests: withdrawn is a
    // resubmission/cleanup state, not a terminal decision.
    //
    // Singletons need this too: one trade_queue_item can have multiple
    // decision_requests when the same idea is recommended for several
    // portfolios. Each DR shares the same groupKey (`tqi:<id>`) but has a
    // different portfolio_id. Without pre-indexing singletons, only the
    // first leg of the bucket created the group and subsequent siblings
    // were dropped via the dedup early-return.
    const allLegsByGroup = new Map<string, DecisionRequest[]>()
    permissionedRequests.forEach(r => {
      if (r.status === 'withdrawn') return
      const { groupKey } = getGroupInfo(r)
      const arr = allLegsByGroup.get(groupKey) || []
      arr.push(r)
      allLegsByGroup.set(groupKey, arr)
    })

    // Build a set of DR ids in the current filtered bucket — used below to
    // restrict singleton groups to only the DRs visible in the active tab.
    const filteredBucketIds = new Set(filteredBucket.map(r => r.id))

    filteredBucket.forEach(req => {
      const { groupKey, tradeId, isPair } = getGroupInfo(req)

      if (map.has(groupKey)) return // already initialized this group from an earlier leg

      // Seed `requests` with siblings for this group from the pre-index.
      //
      //   - Pair groups: include ALL legs (pending + resolved) so the
      //     consolidated tile can show resolved legs as context next to
      //     unresolved ones (matches the "leg already accepted, others
      //     waiting" model the user wanted).
      //
      //   - Singleton groups: only include DRs that are in the current
      //     tab's bucket. Each portfolio's DR is independent — an accepted
      //     ORCL DR for Vision Fund 10K should appear in the accepted tab,
      //     not as a "context row" inside the pending tab.
      const requests: DecisionRequest[] = (() => {
        if (!allLegsByGroup.has(groupKey)) return [req]
        const all = allLegsByGroup.get(groupKey)!
        if (isPair) return [...all]
        return all.filter(r => filteredBucketIds.has(r.id))
      })()

      // Derive display metadata from any leg — prefer the first pending one
      // for rationale/thesis/etc, since that's typically freshest.
      const seedLeg = requests.find(r => ['pending', 'under_review', 'needs_discussion'].includes(r.status)) || requests[0]
      const seedTqi = (seedLeg.trade_queue_item as any)

      const group: IdeaGroup = {
        tradeId,
        symbol: seedTqi?.assets?.symbol || '?',
        companyName: seedTqi?.assets?.company_name || '',
        action: isPair ? 'pair' : (seedTqi?.action || 'buy'),
        rationale: seedTqi?.rationale || null,
        thesisText: seedTqi?.thesis_text || null,
        conviction: seedTqi?.conviction || null,
        urgency: seedTqi?.urgency || seedLeg.urgency || null,
        isPairTrade: isPair,
        pairBuySymbols: [],
        pairSellSymbols: [],
        requests,
      }

      // Collect buy/sell symbols and upgrade thesis from any leg that has one.
      requests.forEach(r => {
        const rtqi = (r.trade_queue_item as any)
        if (!group.thesisText && rtqi?.thesis_text) group.thesisText = rtqi.thesis_text
        if (!isPair) return
        const sym = rtqi?.assets?.symbol
        const legAction = rtqi?.action
        if (!sym) return
        if ((legAction === 'buy' || legAction === 'add') && !group.pairBuySymbols.includes(sym)) {
          group.pairBuySymbols.push(sym)
        } else if ((legAction === 'sell' || legAction === 'reduce') && !group.pairSellSymbols.includes(sym)) {
          group.pairSellSymbols.push(sym)
        }
      })

      map.set(groupKey, group)
    })

    // Also extract pair symbols from snapshot legs (fallback for legs whose
    // trade_queue_item.assets join didn't resolve).
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
  }, [filteredBucket, permissionedRequests])

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

                      {(() => {
                        // Shared inline context text: prefer thesis_text,
                        // fall back to rationale. Both single and pair cards
                        // use the same pattern so layouts match.
                        const contextText = group.thesisText || group.rationale
                        return isPair ? (
                          <>
                            <span className="text-[11px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 leading-none bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                              Pair
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); onIdeaClick?.(group.tradeId) }}
                              className="flex items-center gap-1.5 hover:text-primary-600 dark:hover:text-primary-400 transition-colors shrink-0"
                            >
                              <span className="text-[11px] font-bold uppercase text-green-600 dark:text-green-400">BUY</span>
                              <span className="font-bold text-[15px] text-gray-900 dark:text-white">{group.pairBuySymbols.join(', ') || '?'}</span>
                              <span className="text-gray-300 dark:text-gray-600">–</span>
                              <span className="text-[11px] font-bold uppercase text-red-600 dark:text-red-400">SELL</span>
                              <span className="font-bold text-[15px] text-gray-900 dark:text-white">{group.pairSellSymbols.join(', ') || '?'}</span>
                            </button>
                            {contextText && (
                              <>
                                <span className="text-gray-300 dark:text-gray-600">—</span>
                                <span className="text-xs text-gray-400 dark:text-gray-500 italic truncate">{contextText}</span>
                              </>
                            )}
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
                            {contextText && (
                              <>
                                <span className="text-gray-300 dark:text-gray-600">—</span>
                                <span className="text-xs text-gray-400 dark:text-gray-500 italic truncate">{contextText}</span>
                              </>
                            )}
                          </>
                        )
                      })()}

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

                      {!isExpanded && (() => {
                        // Pair trades: show "Y of Z decided" progress counter
                        // so partial-decision state is explicit in the header.
                        // Singletons: keep the existing portfolio-count indicator.
                        if (group.isPairTrade) {
                          const total = group.requests.length
                          const decided = group.requests.filter(r =>
                            r.status !== 'pending' && r.status !== 'under_review' && r.status !== 'needs_discussion'
                          ).length
                          return (
                            <span className="text-xs text-gray-400 ml-auto shrink-0 tabular-nums">
                              {decided} of {total} decided
                            </span>
                          )
                        }
                        return (
                          <span className="text-xs text-gray-400 ml-auto shrink-0">
                            {group.requests.length} {group.requests.length === 1 ? 'portfolio' : 'portfolios'}
                          </span>
                        )
                      })()}
                    </div>

                  </div>

                  {/* ── Portfolio Decision Tiles ─────────────── */}
                  {isExpanded && (
                    <div className="px-3 py-2 space-y-2 border-t border-gray-100 dark:border-gray-700/50">
                      {/* Pair groups: render ONE consolidated tile per
                          portfolio. Each tile shows shared header info
                          (rationale, requester, time) ONCE and lists all
                          legs as sub-rows with per-leg accept/reject. */}
                      {group.isPairTrade && (() => {
                        // Sub-group legs by portfolio_id so multi-portfolio
                        // pairs render one tile per portfolio.
                        const byPortfolio = new Map<string, DecisionRequest[]>()
                        for (const r of group.requests) {
                          const arr = byPortfolio.get(r.portfolio_id) || []
                          arr.push(r)
                          byPortfolio.set(r.portfolio_id, arr)
                        }
                        return Array.from(byPortfolio.entries()).map(([portfolioId, portfolioLegs]) => (
                          <PairPortfolioGroupRow
                            key={portfolioId}
                            legs={portfolioLegs}
                            currentUserId={user?.id}
                            userPortfolioRoles={userPortfolioRoles}
                            isPending={updateMutation.isPending || acceptMutation.isPending || rejectMutation.isPending}
                            isRevertPending={revertMutation.isPending}
                            onAcceptLeg={(leg) => {
                              if (!user) return
                              const sizing = leg.sizing_weight != null ? String(leg.sizing_weight) : 'pair'
                              acceptMutation.mutate({
                                decisionRequest: leg,
                                sizingInput: sizing,
                                decisionNote: undefined,
                                context: {
                                  actorId: user.id,
                                  actorName: (user as any).first_name || user.email || 'PM',
                                  actorRole: 'pm',
                                  requestId: `accept-${leg.id}-${Date.now()}`,
                                },
                              }, {
                                onSuccess: () => toast.success(`${leg.trade_queue_item?.assets?.symbol || 'Leg'} accepted`),
                                onError: (err: any) => toast.error('Accept failed', err?.message || 'Unknown error'),
                              })
                            }}
                            onRejectLeg={(leg, reason) => {
                              if (!user) return
                              rejectMutation.mutate({
                                decisionRequest: leg,
                                reason: reason || null,
                                context: {
                                  actorId: user.id,
                                  actorName: (user as any).first_name || user.email || 'PM',
                                  actorRole: 'pm',
                                  requestId: `reject-${leg.id}-${Date.now()}`,
                                },
                              })
                            }}
                            onAcceptAll={(legsToAccept) => {
                              if (!user) return
                              const ctx = {
                                actorId: user.id,
                                actorName: (user as any).first_name || user.email || 'PM',
                                actorRole: 'pm' as const,
                                requestId: `accept-all-${portfolioId}-${Date.now()}`,
                              }
                              const skipped: string[] = []
                              const accepts = legsToAccept.map(leg => {
                                if (leg.sizing_weight == null) {
                                  skipped.push(leg.trade_queue_item?.assets?.symbol || 'leg')
                                  return null
                                }
                                return acceptMutation.mutateAsync({
                                  decisionRequest: leg,
                                  sizingInput: String(leg.sizing_weight),
                                  decisionNote: null,
                                  context: { ...ctx, requestId: `accept-${leg.id}-${Date.now()}` },
                                })
                              }).filter(Boolean) as Promise<unknown>[]
                              Promise.all(accepts)
                                .then(() => {
                                  const processed = legsToAccept.length - skipped.length
                                  toast.success(
                                    `Pair: accepted ${processed} leg${processed !== 1 ? 's' : ''}` +
                                    (skipped.length > 0 ? ` (skipped ${skipped.join(', ')} — no sizing)` : '')
                                  )
                                })
                                .catch((err: any) => toast.error('Accept all failed', err?.message || 'Unknown error'))
                            }}
                            onRejectAll={(legsToReject, reason) => {
                              if (!user) return
                              const ctx = {
                                actorId: user.id,
                                actorName: (user as any).first_name || user.email || 'PM',
                                actorRole: 'pm' as const,
                                requestId: `reject-all-${portfolioId}-${Date.now()}`,
                              }
                              legsToReject.forEach(leg => {
                                rejectMutation.mutate({
                                  decisionRequest: leg,
                                  reason: reason || null,
                                  context: { ...ctx, requestId: `reject-${leg.id}-${Date.now()}` },
                                })
                              })
                              toast.success(`Pair: rejected ${legsToReject.length} leg${legsToReject.length !== 1 ? 's' : ''}`)
                            }}
                            onDeferLeg={(leg, deferredUntil) => {
                              updateMutation.mutate({
                                requestId: leg.id,
                                input: {
                                  status: 'deferred',
                                  deferredUntil,
                                  deferredTrigger: null,
                                  decisionNote: null,
                                },
                              }, {
                                onSuccess: () => toast.success(`${leg.trade_queue_item?.assets?.symbol || 'Leg'} deferred`),
                                onError: (err: any) => toast.error('Defer failed', err?.message || 'Unknown error'),
                              })
                            }}
                            onDeferAll={(legsToDefer, deferredUntil) => {
                              legsToDefer.forEach(leg => {
                                updateMutation.mutate({
                                  requestId: leg.id,
                                  input: {
                                    status: 'deferred',
                                    deferredUntil,
                                    deferredTrigger: null,
                                    decisionNote: null,
                                  },
                                })
                              })
                              toast.success(`Pair: deferred ${legsToDefer.length} leg${legsToDefer.length !== 1 ? 's' : ''}`)
                            }}
                            onUndoLeg={(leg) => handleUndo(leg)}
                            onReview={(tradeId) => onIdeaClick?.(tradeId)}
                          />
                        ))
                      })()}

                      {/* Singletons (non-pair groups): render per-DR tiles as before. */}
                      {!group.isPairTrade && group.requests.map((req) => {
                        // A leg is "resolved" when its own decision_request has
                        // a terminal status, regardless of which tab we're on.
                        // This matters for pair groups in the needs_decision
                        // tab where some legs have already been accepted/rejected
                        // — those rows should render as inert status rows, not
                        // as active Accept/Reject controls.
                        const legIsResolved = req.status === 'accepted'
                          || req.status === 'accepted_with_modification'
                          || req.status === 'rejected'
                          || req.status === 'deferred'
                          || req.status === 'withdrawn'
                        return (
                        <PortfolioRow
                          key={req.id}
                          request={req}
                          isNeedsDecision={activeTab === 'needs_decision' && !legIsResolved}
                          isAcceptedTab={activeTab === 'accepted' || req.status === 'accepted' || req.status === 'accepted_with_modification'}
                          onAcceptWithSizing={(sizingInput, note) => {
                            if (!user) return
                            // Per-leg accept: single mutation for just this
                            // leg. The pair-level "Accept all remaining"
                            // shortcut (see pair toolbar above) handles the
                            // atomic case by iterating unresolved legs and
                            // calling this same accept flow for each one.
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
                                toast.success(`${req.trade_queue_item?.assets?.symbol || 'Trade'} accepted`)
                              },
                              onError: (err: any) => {
                                toast.error('Accept failed', err?.message || 'Unknown error')
                              },
                            })
                          }}
                          onRejectWithReason={(reason) => {
                            if (!user) return
                            // Iterative reject — also deactivates the
                            // proposal and updates per-portfolio track.
                            rejectMutation.mutate({
                              decisionRequest: req,
                              reason: reason || null,
                              context: {
                                actorId: user.id,
                                actorName: (user as any).first_name || user.email || 'PM',
                                actorRole: 'pm',
                                requestId: `reject-${req.id}-${Date.now()}`,
                              },
                            })
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
                          onReview={req.trade_queue_item_id ? () => onIdeaClick?.(req.trade_queue_item_id!) : undefined}
                          isResolvedTab={activeTab === 'accepted' || activeTab === 'rejected' || activeTab === 'deferred' || legIsResolved}
                          isPending={updateMutation.isPending || acceptMutation.isPending}
                          isRevertPending={revertMutation.isPending}
                          isLast={false}
                          currentUserId={user?.id}
                          userPortfolioRoles={userPortfolioRoles}
                        />
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
    </div>
  )
}

// ── Pair Portfolio Group Tile ────────────────────────────────────
//
// Consolidated tile for a pair recommendation in ONE portfolio. Replaces
// what would otherwise be N separate PortfolioRow tiles (one per leg) with
// a single tile that:
//   - Shows the rationale / requester / time ONCE (shared across legs)
//   - Lists each leg as a sub-row with action, symbol, sizing, and either
//     per-leg accept/reject buttons (when pending) or a status badge (when
//     already resolved)
//   - Provides tile-level "Accept all remaining" / "Reject all remaining"
//     shortcuts in the header for atomic action
//   - Per-leg accept/reject only affects that leg — siblings stay actionable

interface PairPortfolioGroupRowProps {
  legs: DecisionRequest[]
  onAcceptLeg: (leg: DecisionRequest) => void
  onRejectLeg: (leg: DecisionRequest, reason: string) => void
  onDeferLeg: (leg: DecisionRequest, deferredUntil: string) => void
  onAcceptAll: (legs: DecisionRequest[]) => void
  onRejectAll: (legs: DecisionRequest[], reason: string) => void
  onDeferAll: (legs: DecisionRequest[], deferredUntil: string) => void
  onUndoLeg: (leg: DecisionRequest) => void
  onReview?: (tradeIdeaId: string) => void
  isPending: boolean
  isRevertPending: boolean
  currentUserId?: string
  userPortfolioRoles?: Map<string, string>
}

function PairPortfolioGroupRow({
  legs,
  onAcceptLeg,
  onRejectLeg,
  onDeferLeg,
  onAcceptAll,
  onRejectAll,
  onDeferAll,
  onUndoLeg,
  onReview,
  isPending,
  isRevertPending,
  currentUserId,
  userPortfolioRoles,
}: PairPortfolioGroupRowProps) {
  const [rejectingLegId, setRejectingLegId] = useState<string | null>(null)
  const [legRejectReason, setLegRejectReason] = useState('')
  const [deferringLegId, setDeferringLegId] = useState<string | null>(null)
  // 'tile' indicates the tile-level Defer all picker is open
  const [deferringTile, setDeferringTile] = useState(false)

  // Defer presets — same set as PortfolioRow for consistency
  const deferPresets = (() => {
    const now = new Date()
    return [
      { key: '1d', label: 'Tomorrow', iso: startOfDay(addDays(now, 1)).toISOString() },
      { key: '1w', label: '1 week', iso: startOfDay(addWeeks(now, 1)).toISOString() },
      { key: '2w', label: '2 weeks', iso: startOfDay(addWeeks(now, 2)).toISOString() },
      { key: 'eom', label: 'End of month', iso: endOfMonth(now).toISOString() },
    ]
  })()

  // All legs share the same portfolio, requester, and rationale. Use the
  // first leg as the "anchor" for header info — the analyst submits one
  // recommendation and all legs carry the same context_note.
  const anchor = legs[0]
  if (!anchor) return null

  const portfolioName = anchor.portfolio?.name || 'Unknown'
  const requesterName = formatFullName(anchor.requester)
  const timeAgo = fmtTime(anchor.created_at)
  const rationale = anchor.context_note

  // Permission / role
  const myRole = userPortfolioRoles?.get(anchor.portfolio_id)
  const isPM = myRole?.toLowerCase().includes('manager') || myRole?.toLowerCase().includes('pm')
  const isMyRec = !!(currentUserId && anchor.requested_by === currentUserId)
  const canAct = isPM || !isMyRec

  // Partition legs by status
  const isLegResolved = (leg: DecisionRequest) =>
    leg.status === 'accepted' ||
    leg.status === 'accepted_with_modification' ||
    leg.status === 'rejected' ||
    leg.status === 'deferred' ||
    leg.status === 'withdrawn'
  const unresolvedLegs = legs.filter(l => !isLegResolved(l))
  const decidedCount = legs.length - unresolvedLegs.length

  // Per-leg sub-row rendering
  const renderLegRow = (leg: DecisionRequest) => {
    const tqi = (leg.trade_queue_item as any)
    const symbol = tqi?.assets?.symbol || '?'
    const companyName = tqi?.assets?.company_name || tqi?.assets?.name || null
    const action = tqi?.action || leg.requested_action || ''
    const isLong = action === 'buy' || action === 'add'

    // Derive a trade-classification label (New Long / New Short / Add /
    // Reduce / Flip / Close) from the leg's baseline and target weight so
    // the row reflects the actual portfolio action rather than the raw
    // buy/sell verb. Fall back to BUY/SELL only if we can't compute it.
    const snapshot = leg.submission_snapshot as any
    const snapshotLegs = snapshot?.sizing_context?.legs as Array<{
      symbol?: string
      weight?: number | null
      baselineWeight?: number | null
      sizingMode?: string
    }> | null
    const matched = snapshotLegs?.find(l => l.symbol === symbol) || null
    const baseWeight = matched?.baselineWeight ?? (snapshot?.baseline_weight as number | null) ?? 0
    const rawWeight = matched?.weight ?? (leg.sizing_weight != null ? Number(leg.sizing_weight) : null)
    const isAbsolute = matched?.sizingMode === 'absolute'
    const targetWeight = rawWeight == null
      ? null
      : isAbsolute
        ? rawWeight
        : baseWeight + (isLong ? Math.abs(rawWeight) : -Math.abs(rawWeight))
    const legTc = targetWeight != null ? classifyTrade(baseWeight, targetWeight) : null
    const actionLabel = (legTc?.label || (isLong ? 'Buy' : 'Sell')).toUpperCase()
    const derivedIsLong = legTc
      ? /long|add$|reduce/i.test(legTc.label) && !/short/i.test(legTc.label)
      : isLong
    const actionColor = derivedIsLong
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'

    // Sizing display: current → target, matching the single-trade row
    // format. Fall back to a bare "—" if we have no target at all.
    const sizingDisplay = targetWeight != null
      ? `${baseWeight.toFixed(2)}% → ${targetWeight.toFixed(2)}%`
      : '—'

    const resolved = isLegResolved(leg)
    const isThisLegRejecting = rejectingLegId === leg.id

    // Resolved leg sub-row: status pill instead of buttons
    if (resolved) {
      const statusLabel =
        leg.status === 'accepted' ? 'Accepted' :
        leg.status === 'accepted_with_modification' ? 'Modified' :
        leg.status === 'rejected' ? 'Rejected' :
        leg.status === 'deferred' ? 'Deferred' :
        leg.status === 'withdrawn' ? 'Withdrawn' : leg.status
      const statusColor =
        leg.status === 'accepted' || leg.status === 'accepted_with_modification'
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : leg.status === 'rejected'
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'

      const showUndo = leg.status === 'accepted' || leg.status === 'accepted_with_modification' || leg.status === 'rejected' || leg.status === 'deferred'
      return (
        <div key={leg.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800/40 text-xs opacity-75">
          <span className={clsx('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0', actionColor)}>{actionLabel}</span>
          <span className="font-semibold text-gray-700 dark:text-gray-300 shrink-0">{symbol}</span>
          {companyName && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate min-w-0">{companyName}</span>
          )}
          <span className="text-gray-500 dark:text-gray-500 tabular-nums shrink-0">{sizingDisplay}</span>
          <span className={clsx('ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0', statusColor)}>{statusLabel}</span>
          {showUndo && (
            <button
              onClick={() => onUndoLeg(leg)}
              disabled={isRevertPending}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 shrink-0"
            >
              {isRevertPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
              Undo
            </button>
          )}
        </div>
      )
    }

    // Pending leg with inline reject reason input
    if (isThisLegRejecting) {
      return (
        <div key={leg.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/40 text-xs">
          <span className={clsx('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0', actionColor)}>{actionLabel}</span>
          <span className="font-semibold text-gray-900 dark:text-white shrink-0">{symbol}</span>
          {companyName && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 truncate max-w-[120px]">{companyName}</span>
          )}
          <input
            type="text"
            value={legRejectReason}
            onChange={e => setLegRejectReason(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && legRejectReason.trim()) {
                onRejectLeg(leg, legRejectReason.trim())
                setRejectingLegId(null)
                setLegRejectReason('')
              }
              if (e.key === 'Escape') {
                setRejectingLegId(null)
                setLegRejectReason('')
              }
            }}
            autoFocus
            placeholder="Reason..."
            className="flex-1 min-w-0 px-2 py-0.5 text-[11px] rounded border border-red-300 dark:border-red-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <button
            onClick={() => {
              if (legRejectReason.trim()) {
                onRejectLeg(leg, legRejectReason.trim())
                setRejectingLegId(null)
                setLegRejectReason('')
              }
            }}
            disabled={!legRejectReason.trim() || isPending}
            className="px-2 py-0.5 text-[10px] font-semibold rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0"
          >
            Reject
          </button>
          <button
            onClick={() => { setRejectingLegId(null); setLegRejectReason('') }}
            className="px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-700 shrink-0"
          >
            Cancel
          </button>
        </div>
      )
    }

    // Pending leg with inline defer preset picker
    if (deferringLegId === leg.id) {
      return (
        <div key={leg.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 text-xs flex-wrap">
          <span className={clsx('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0', actionColor)}>{actionLabel}</span>
          <span className="font-semibold text-gray-900 dark:text-white shrink-0">{symbol}</span>
          {companyName && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 truncate max-w-[120px]">{companyName}</span>
          )}
          <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">Defer until:</span>
          {deferPresets.map(preset => (
            <button
              key={preset.key}
              onClick={() => {
                onDeferLeg(leg, preset.iso)
                setDeferringLegId(null)
              }}
              disabled={isPending}
              className="px-2 py-0.5 text-[10px] font-semibold rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors shrink-0"
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={() => setDeferringLegId(null)}
            className="ml-auto px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-700 shrink-0"
          >
            Cancel
          </button>
        </div>
      )
    }

    // Pending leg default state
    return (
      <div key={leg.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/40 text-xs">
        <span className={clsx('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0', actionColor)}>{actionLabel}</span>
        <span className="font-semibold text-gray-900 dark:text-white shrink-0">{symbol}</span>
        {companyName && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate min-w-0">{companyName}</span>
        )}
        <span className="text-gray-500 dark:text-gray-400 tabular-nums shrink-0">{sizingDisplay}</span>
        {canAct && (
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onAcceptLeg(leg)}
              disabled={isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50"
              title="Accept this leg"
            >
              <Check className="h-3 w-3" />
              Accept
            </button>
            <button
              onClick={() => { setRejectingLegId(leg.id); setLegRejectReason('') }}
              disabled={isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
              title="Reject this leg"
            >
              <X className="h-3 w-3" />
              Reject
            </button>
            <button
              onClick={() => setDeferringLegId(leg.id)}
              disabled={isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
              title="Defer this leg"
            >
              <Clock className="h-3 w-3" />
              Defer
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
      {/* Header: portfolio + analyst + time + tile-level shortcuts */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-gray-900 dark:text-white">{portfolioName}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-gray-500 dark:text-gray-400">{requesterName}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-gray-400 dark:text-gray-500">{timeAgo}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent('openTradeLab', {
                  detail: { portfolioId: anchor.portfolio_id },
                }))
              }}
              className="flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors flex-shrink-0"
            >
              <Beaker className="h-3 w-3" />
              Trade Lab
            </button>
            {onReview && anchor.trade_queue_item_id && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onReview(anchor.trade_queue_item_id!)
                }}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex-shrink-0"
                title="Open trade idea to review"
              >
                <ArrowUpRight className="h-3 w-3" />
                Review
              </button>
            )}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums mt-0.5">
            {decidedCount} of {legs.length} decided · {unresolvedLegs.length} remaining
          </div>
        </div>
        {canAct && unresolvedLegs.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onAcceptAll(unresolvedLegs)}
              disabled={isPending}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              title="Accept all remaining legs"
            >
              <Check className="h-3 w-3" />
              Accept all {unresolvedLegs.length}
            </button>
            <button
              onClick={() => {
                const reason = window.prompt(
                  `Reject ${unresolvedLegs.length} remaining leg${unresolvedLegs.length !== 1 ? 's' : ''}? Enter a reason:`,
                  '',
                )
                if (reason == null) return
                onRejectAll(unresolvedLegs, reason || '')
              }}
              disabled={isPending}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-white dark:bg-gray-700 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
              title="Reject all remaining legs"
            >
              <X className="h-3 w-3" />
              Reject all {unresolvedLegs.length}
            </button>
            <button
              onClick={() => setDeferringTile(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              title="Defer all remaining legs"
            >
              <Clock className="h-3 w-3" />
              Defer all {unresolvedLegs.length}
            </button>
          </div>
        )}
      </div>

      {/* Tile-level defer preset picker */}
      {deferringTile && (
        <div className="flex items-center gap-2 px-2 py-1.5 mt-2 rounded bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 text-xs flex-wrap">
          <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300 shrink-0">
            Defer {unresolvedLegs.length} remaining leg{unresolvedLegs.length !== 1 ? 's' : ''} until:
          </span>
          {deferPresets.map(preset => (
            <button
              key={preset.key}
              onClick={() => {
                onDeferAll(unresolvedLegs, preset.iso)
                setDeferringTile(false)
              }}
              disabled={isPending}
              className="px-2 py-0.5 text-[11px] font-semibold rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors shrink-0"
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={() => setDeferringTile(false)}
            className="ml-auto px-1.5 py-0.5 text-[11px] text-gray-500 hover:text-gray-700 shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Rationale (Why Now) — shown ONCE for the whole pair recommendation */}
      {rationale && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-2 leading-snug italic">
          "{rationale}"
        </p>
      )}

      {/* Leg list */}
      <div className="mt-2 space-y-1 pt-2 border-t border-gray-100 dark:border-gray-700/50">
        {legs.map(renderLegRow)}
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
  onReview,
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
  onReview?: () => void
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
  const rawLegs = sizingCtx?.legs as Array<{ symbol?: string; action?: string; weight?: number | null; baselineWeight?: number | null; enteredValue?: string; sizingMode?: string }> | null
  const conviction = request.trade_queue_item?.conviction || null
  // Pilot recommendations are seeded against the pilot user (the
  // "requester" in DB terms), but the UI should attribute them to
  // "Pilot" so the demo doesn't expose the seed user's display
  // name. Honored when submission_snapshot.pilot_seed is true.
  const isPilotSeed = (snapshot as any)?.pilot_seed === true
  const analyst = isPilotSeed ? 'Pilot' : formatFullName(request.requester)
  const timeAgo = fmtTime(request.created_at)

  // Under the per-leg pair decision model, each DR represents ONE leg of
  // the pair and has its own PortfolioRow. The submission_snapshot still
  // carries the full legs array (useful for context / the modal), but the
  // row itself should only render THIS leg. Match by the DR's own asset
  // symbol. Fall back to rendering all legs if no match (legacy single-DR
  // pair submissions where one "representative" leg carries the whole pair).
  const thisRowSymbol = request.trade_queue_item?.assets?.symbol
  const matchedLegs = rawLegs && thisRowSymbol
    ? rawLegs.filter(l => l.symbol === thisRowSymbol)
    : null
  const legs = (matchedLegs && matchedLegs.length > 0) ? matchedLegs : rawLegs

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
  // `pendingMyDecision` is the variant rendered as a button-sized pill with
  // an icon, matching the size of the "Awaiting PM — Request Follow-up"
  // button so the two states feel symmetric. The other statuses (Accepted/
  // Rejected/Modified/Deferred) stay compact since they're terminal labels.
  const statusBadge = (() => {
    if (request.status === 'accepted_with_modification') return { label: 'Modified', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', pendingMyDecision: false }
    if (request.status === 'accepted') return { label: 'Accepted', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', pendingMyDecision: false }
    if (request.status === 'rejected') return { label: 'Rejected', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', pendingMyDecision: false }
    if (request.status === 'deferred') return { label: 'Deferred', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400', pendingMyDecision: false }
    if (isAwaiting) return { label: 'Awaiting PM decision', color: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400', pendingMyDecision: false }
    if (isNeedsDecision) return { label: 'Pending your decision', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300', pendingMyDecision: true }
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
      ) : statusBadge.pendingMyDecision ? (
        // Pending-your-decision pill: same size + format as the
        // "Awaiting PM — Request Follow-up" button so the two waiting
        // states are visually symmetric. Not a button — purely a status.
        <span
          className={clsx(
            'text-xs font-medium px-2 py-1 rounded flex items-center gap-1',
            statusBadge.color,
            badgeClassName,
          )}
        >
          <Clock className="w-3 h-3" />
          {statusBadge.label}
        </span>
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
            {onReview && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onReview()
                }}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex-shrink-0"
                title="Open trade idea to review"
              >
                <ArrowUpRight className="h-3 w-3" />
                Review
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
                    <>
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
                      {onReview && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onReview()
                          }}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex-shrink-0"
                          title="Open trade idea to review"
                        >
                          <ArrowUpRight className="h-3 w-3" />
                          Review
                        </button>
                      )}
                    </>
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
            {onReview && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onReview()
                }}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex-shrink-0"
                title="Open trade idea to review"
              >
                <ArrowUpRight className="h-3 w-3" />
                Review
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
