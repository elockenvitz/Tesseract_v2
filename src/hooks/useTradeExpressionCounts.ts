import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isCommittedStatus, isCommitStageStatus } from '../lib/trade-status-semantics'

interface LabInclusionInfo {
  count: number
  labNames: string[]
  labIds: string[]
  portfolioIds: string[]
  portfolioNames: string[]
}

/**
 * Hook to get lab inclusion counts for trade queue items.
 * Uses the trade_lab_idea_links table to count which labs each idea is included in.
 * Returns a map of trade_queue_item_id -> { count, labNames, labIds }
 */
export function useTradeExpressionCounts() {
  return useQuery({
    queryKey: ['trade-lab-inclusion-counts'],
    queryFn: async () => {
      // Query trade_lab_idea_links joined with trade_labs and portfolios
      const { data, error } = await supabase
        .from('trade_lab_idea_links')
        .select(`
          trade_queue_item_id,
          trade_lab_id,
          trade_labs (id, name, portfolio_id, portfolios (id, name))
        `)

      if (error) throw error

      // Group by trade_queue_item_id
      const counts = new Map<string, LabInclusionInfo>()

      data?.forEach((item: any) => {
        if (!item.trade_queue_item_id) return

        const lab = item.trade_labs
        if (!lab) return

        const portfolioName = lab.portfolios?.name || 'Unknown Portfolio'

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
            portfolioNames: [portfolioName]
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
