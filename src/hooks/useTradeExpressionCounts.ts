import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isCommittedStatus, isCommitStageStatus } from '../lib/trade-status-semantics'
import type { PortfolioTrackCounts } from '../types/trading'

// Per-portfolio track status
interface PortfolioTrackStatus {
  portfolioId: string
  decisionOutcome: 'accepted' | 'deferred' | 'rejected' | null
  stage: string
}

interface LabInclusionInfo {
  count: number
  labNames: string[]
  labIds: string[]
  portfolioIds: string[]
  portfolioNames: string[]
  // Portfolio track progress
  trackCounts: PortfolioTrackCounts
  // Per-portfolio status for filtering
  portfolioTrackStatus: Map<string, PortfolioTrackStatus>
  // Active recommendation count (from decision_requests)
  recommendationCount: number
  // Per-portfolio recommendation counts: portfolioId -> count
  portfolioRecommendationCounts: Map<string, number>
  // Whether the current user has submitted a recommendation for this trade
  hasCurrentUserRecommendation: boolean
}

/**
 * Hook to get lab inclusion counts and portfolio track progress for trade queue items.
 * Uses trade_lab_idea_links for lab/portfolio associations and trade_idea_portfolios for progress tracking.
 * Returns a map of trade_queue_item_id -> { count, labNames, labIds, trackCounts }
 */
export function useTradeExpressionCounts() {
  return useQuery({
    queryKey: ['trade-lab-inclusion-counts'],
    queryFn: async () => {
      // Query trade_lab_idea_links joined with trade_labs and portfolios
      const { data: labLinks, error: labError } = await supabase
        .from('trade_lab_idea_links')
        .select(`
          trade_queue_item_id,
          trade_lab_id,
          trade_labs (id, name, portfolio_id, portfolios (id, name))
        `)

      if (labError) throw labError

      // Query portfolio tracks for progress data
      const { data: portfolioTracks, error: trackError } = await supabase
        .from('trade_idea_portfolios')
        .select('trade_queue_item_id, portfolio_id, decision_outcome, stage')

      if (trackError) throw trackError

      // Query active recommendation counts from decision_requests
      const { data: recommendations, error: recError } = await supabase
        .from('decision_requests')
        .select('trade_queue_item_id, portfolio_id, requested_by')
        .in('status', ['pending', 'under_review', 'needs_discussion'])

      if (recError) throw recError

      // Get current user ID for hasCurrentUserRecommendation
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      const currentUserId = currentUser?.id

      // Build recommendation count maps (total and per-portfolio)
      const recCountMap = new Map<string, number>()
      const portfolioRecCountsMap = new Map<string, Map<string, number>>()
      const userRecSet = new Set<string>() // trade IDs where current user has a rec

      recommendations?.forEach((r: any) => {
        // Total count per trade
        const count = recCountMap.get(r.trade_queue_item_id) || 0
        recCountMap.set(r.trade_queue_item_id, count + 1)

        // Per-portfolio count
        if (!portfolioRecCountsMap.has(r.trade_queue_item_id)) {
          portfolioRecCountsMap.set(r.trade_queue_item_id, new Map())
        }
        const portfolioCounts = portfolioRecCountsMap.get(r.trade_queue_item_id)!
        const portfolioCount = portfolioCounts.get(r.portfolio_id) || 0
        portfolioCounts.set(r.portfolio_id, portfolioCount + 1)

        // Track current user's recommendations
        if (currentUserId && r.requested_by === currentUserId) {
          userRecSet.add(r.trade_queue_item_id)
        }
      })

      // Build portfolio track counts map and per-portfolio status map
      const trackCountsMap = new Map<string, PortfolioTrackCounts>()
      const portfolioTrackStatusMap = new Map<string, Map<string, PortfolioTrackStatus>>()

      portfolioTracks?.forEach((track: any) => {
        const id = track.trade_queue_item_id

        // Track counts
        if (!trackCountsMap.has(id)) {
          trackCountsMap.set(id, { total: 0, active: 0, committed: 0, deferred: 0, rejected: 0 })
        }
        const counts = trackCountsMap.get(id)!
        counts.total++
        if (track.decision_outcome === null) {
          counts.active++
        } else if (track.decision_outcome === 'accepted') {
          counts.committed++
        } else if (track.decision_outcome === 'deferred') {
          counts.deferred++
        } else if (track.decision_outcome === 'rejected') {
          counts.rejected++
        }

        // Per-portfolio status
        if (!portfolioTrackStatusMap.has(id)) {
          portfolioTrackStatusMap.set(id, new Map())
        }
        portfolioTrackStatusMap.get(id)!.set(track.portfolio_id, {
          portfolioId: track.portfolio_id,
          decisionOutcome: track.decision_outcome,
          stage: track.stage
        })
      })

      // Group lab links by trade_queue_item_id
      const counts = new Map<string, LabInclusionInfo>()

      labLinks?.forEach((item: any) => {
        if (!item.trade_queue_item_id) return

        const lab = item.trade_labs
        if (!lab) return

        const portfolioName = lab.portfolios?.name || 'Unknown Portfolio'
        const defaultTrackCounts = { total: 0, active: 0, committed: 0, deferred: 0, rejected: 0 }

        const existing = counts.get(item.trade_queue_item_id)
        if (existing) {
          // Avoid duplicate lab entries
          if (!existing.labIds.includes(item.trade_lab_id)) {
            existing.count++
            existing.labIds.push(item.trade_lab_id)
            if (lab.name) {
              existing.labNames.push(lab.name)
            }
            if (lab.portfolio_id) {
              existing.portfolioIds.push(lab.portfolio_id)
            }
            existing.portfolioNames.push(portfolioName)
          }
        } else {
          counts.set(item.trade_queue_item_id, {
            count: 1,
            labIds: [item.trade_lab_id],
            labNames: lab.name ? [lab.name] : [],
            portfolioIds: lab.portfolio_id ? [lab.portfolio_id] : [],
            portfolioNames: [portfolioName],
            trackCounts: trackCountsMap.get(item.trade_queue_item_id) || defaultTrackCounts,
            portfolioTrackStatus: portfolioTrackStatusMap.get(item.trade_queue_item_id) || new Map(),
            recommendationCount: recCountMap.get(item.trade_queue_item_id) || 0,
            portfolioRecommendationCounts: portfolioRecCountsMap.get(item.trade_queue_item_id) || new Map(),
            hasCurrentUserRecommendation: userRecSet.has(item.trade_queue_item_id),
          })
        }
      })

      // Also include trade ideas that have portfolio tracks but aren't in lab links
      // (e.g., ideas with direct portfolio_id assignment)
      trackCountsMap.forEach((trackCounts, tradeId) => {
        if (!counts.has(tradeId)) {
          counts.set(tradeId, {
            count: trackCounts.total,
            labIds: [],
            labNames: [],
            portfolioIds: [],
            portfolioNames: [],
            trackCounts,
            portfolioTrackStatus: portfolioTrackStatusMap.get(tradeId) || new Map(),
            recommendationCount: recCountMap.get(tradeId) || 0,
            portfolioRecommendationCounts: portfolioRecCountsMap.get(tradeId) || new Map(),
            hasCurrentUserRecommendation: userRecSet.has(tradeId),
          })
        } else {
          const existing = counts.get(tradeId)!
          existing.trackCounts = trackCounts
          existing.portfolioTrackStatus = portfolioTrackStatusMap.get(tradeId) || new Map()
          existing.recommendationCount = recCountMap.get(tradeId) || 0
          existing.portfolioRecommendationCounts = portfolioRecCountsMap.get(tradeId) || new Map()
          existing.hasCurrentUserRecommendation = existing.hasCurrentUserRecommendation || userRecSet.has(tradeId)
        }
      })

      // Also include trade ideas that have proposals but aren't in lab links or portfolio tracks
      recCountMap.forEach((recommendationCount, tradeId) => {
        if (!counts.has(tradeId)) {
          counts.set(tradeId, {
            count: 0,
            labIds: [],
            labNames: [],
            portfolioIds: [],
            portfolioNames: [],
            trackCounts: { total: 0, active: 0, committed: 0, deferred: 0, rejected: 0 },
            portfolioTrackStatus: new Map(),
            recommendationCount,
            portfolioRecommendationCounts: portfolioRecCountsMap.get(tradeId) || new Map(),
            hasCurrentUserRecommendation: userRecSet.has(tradeId),
          })
        }
      })

      return counts
    },
    staleTime: 30000, // Consider data stale after 30 seconds
  })
}

// Re-export for backwards compatibility
export type ExpressionCount = LabInclusionInfo

/**
 * Get expression status label for a trade queue item
 * Uses the new semantic helpers for committed/commit stage detection
 */
export function getExpressionStatus(
  tradeId: string,
  status: string,
  expressionCounts: Map<string, LabInclusionInfo> | undefined
): { label: string; variant: 'gray' | 'purple' | 'amber' | 'green' } {
  // Committed (approved status)
  if (isCommittedStatus(status as any)) {
    return { label: 'Committed', variant: 'green' }
  }

  // In Commit stage (deciding status)
  if (isCommitStageStatus(status as any)) {
    return { label: 'In Commit', variant: 'amber' }
  }

  // Check lab inclusion counts
  const inclusion = expressionCounts?.get(tradeId)
  if (inclusion && inclusion.count > 0) {
    const labCount = inclusion.count
    return {
      label: labCount === 1 ? 'In 1 lab' : `In ${labCount} labs`,
      variant: 'purple'
    }
  }

  // Not yet added to any lab
  return { label: 'Not in lab', variant: 'gray' }
}

/**
 * Hook to get the labs a specific trade idea is included in
 */
export function useTradeLabInclusions(tradeQueueItemId: string | null | undefined) {
  return useQuery({
    queryKey: ['trade-lab-inclusions', tradeQueueItemId],
    queryFn: async () => {
      if (!tradeQueueItemId) return []

      const { data, error } = await supabase
        .from('trade_lab_idea_links')
        .select(`
          id,
          trade_lab_id,
          created_at,
          created_by,
          trade_labs (id, name, portfolio_id)
        `)
        .eq('trade_queue_item_id', tradeQueueItemId)

      if (error) throw error

      // Return all linked labs
      return (data || [])
        .filter((item: any) => item.trade_labs)
        .map((item: any) => ({
          linkId: item.id,
          labId: item.trade_lab_id,
          labName: item.trade_labs?.name || 'Unnamed Lab',
          portfolioId: item.trade_labs?.portfolio_id,
          createdAt: item.created_at,
        }))
    },
    enabled: !!tradeQueueItemId,
  })
}
