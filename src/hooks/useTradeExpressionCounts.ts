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
  // Active proposal count
  proposalCount: number
  // Per-portfolio proposal counts: portfolioId -> count
  portfolioProposalCounts: Map<string, number>
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

      // Query active proposal counts per trade idea (with portfolio_id for per-portfolio counts)
      const { data: proposals, error: proposalError } = await supabase
        .from('trade_proposals')
        .select('trade_queue_item_id, portfolio_id')
        .eq('is_active', true)

      if (proposalError) throw proposalError

      // Build proposal count maps (total and per-portfolio)
      const proposalCountMap = new Map<string, number>()
      const portfolioProposalCountsMap = new Map<string, Map<string, number>>()

      proposals?.forEach((p: any) => {
        // Total count per trade
        const count = proposalCountMap.get(p.trade_queue_item_id) || 0
        proposalCountMap.set(p.trade_queue_item_id, count + 1)

        // Per-portfolio count
        if (!portfolioProposalCountsMap.has(p.trade_queue_item_id)) {
          portfolioProposalCountsMap.set(p.trade_queue_item_id, new Map())
        }
        const portfolioCounts = portfolioProposalCountsMap.get(p.trade_queue_item_id)!
        const portfolioCount = portfolioCounts.get(p.portfolio_id) || 0
        portfolioCounts.set(p.portfolio_id, portfolioCount + 1)
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
            proposalCount: proposalCountMap.get(item.trade_queue_item_id) || 0,
            portfolioProposalCounts: portfolioProposalCountsMap.get(item.trade_queue_item_id) || new Map()
          })
        }
      })

      // Also include trade ideas that have portfolio tracks but aren't in lab links
      // (e.g., ideas with direct portfolio_id assignment)
      trackCountsMap.forEach((trackCounts, tradeId) => {
        if (!counts.has(tradeId)) {
          counts.set(tradeId, {
            count: trackCounts.total, // Use track count as portfolio count
            labIds: [],
            labNames: [],
            portfolioIds: [],
            portfolioNames: [],
            trackCounts,
            portfolioTrackStatus: portfolioTrackStatusMap.get(tradeId) || new Map(),
            proposalCount: proposalCountMap.get(tradeId) || 0,
            portfolioProposalCounts: portfolioProposalCountsMap.get(tradeId) || new Map()
          })
        } else {
          // Update existing entry with track counts, status, and proposal count
          const existing = counts.get(tradeId)!
          existing.trackCounts = trackCounts
          existing.portfolioTrackStatus = portfolioTrackStatusMap.get(tradeId) || new Map()
          existing.proposalCount = proposalCountMap.get(tradeId) || 0
          existing.portfolioProposalCounts = portfolioProposalCountsMap.get(tradeId) || new Map()
        }
      })

      // Also include trade ideas that have proposals but aren't in lab links or portfolio tracks
      proposalCountMap.forEach((proposalCount, tradeId) => {
        if (!counts.has(tradeId)) {
          counts.set(tradeId, {
            count: 0,
            labIds: [],
            labNames: [],
            portfolioIds: [],
            portfolioNames: [],
            trackCounts: { total: 0, active: 0, committed: 0, deferred: 0, rejected: 0 },
            portfolioTrackStatus: new Map(),
            proposalCount,
            portfolioProposalCounts: portfolioProposalCountsMap.get(tradeId) || new Map()
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
