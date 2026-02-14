/**
 * useAssetRecentDecisions — Fetches recently decided/executed trade ideas for an asset.
 *
 * A "decision" is a trade_queue_item that has a non-null outcome (executed, accepted,
 * rejected, deferred) or a non-null decision_outcome. We show the most recent ones.
 *
 * RLS on trade_queue_items ensures the user only sees what they have access to.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TradeAction, TradeOutcome, DecisionOutcome } from '../types/trading'

export interface AssetRecentDecision {
  id: string
  action: TradeAction
  outcome: TradeOutcome | null
  decision_outcome: DecisionOutcome | null
  outcome_at: string | null
  decided_at: string | null
  proposed_weight: number | null
  proposed_shares: number | null
  rationale: string
  portfolio: { id: string; name: string } | null
}

/** Returns a human label for the decision outcome. */
export function getDecisionLabel(
  action: TradeAction | null,
  outcome: TradeOutcome | null,
  decisionOutcome: DecisionOutcome | null
): string {
  // If there's a specific trade outcome, map to a verb
  if (outcome === 'executed') {
    switch (action) {
      case 'buy': return 'Bought'
      case 'sell': return 'Sold'
      case 'add': return 'Increased'
      case 'trim': return 'Trimmed'
      default: return 'Executed'
    }
  }
  if (outcome === 'accepted' || decisionOutcome === 'accepted') return 'Accepted'
  if (outcome === 'rejected' || decisionOutcome === 'rejected') return 'Rejected'
  if (outcome === 'deferred' || decisionOutcome === 'deferred') return 'Deferred'
  return 'Decided'
}

interface UseAssetRecentDecisionsOptions {
  assetId: string
  limit?: number
}

export function useAssetRecentDecisions({ assetId, limit = 5 }: UseAssetRecentDecisionsOptions) {
  const { data, isLoading } = useQuery({
    queryKey: ['asset-recent-decisions', assetId, limit],
    queryFn: async () => {
      // Fetch trades with an outcome or decision_outcome set (resolved items).
      // We use two queries since Supabase doesn't support OR across columns easily,
      // then merge and deduplicate.
      const { data: withOutcome, error: err1 } = await supabase
        .from('trade_queue_items')
        .select(`
          id,
          action,
          outcome,
          decision_outcome,
          outcome_at,
          decided_at,
          proposed_weight,
          proposed_shares,
          rationale,
          portfolios:portfolio_id (id, name)
        `)
        .eq('asset_id', assetId)
        .not('outcome', 'is', null)
        .order('outcome_at', { ascending: false, nullsFirst: false })
        .limit(limit + 1)

      if (err1) throw err1

      const { data: withDecision, error: err2 } = await supabase
        .from('trade_queue_items')
        .select(`
          id,
          action,
          outcome,
          decision_outcome,
          outcome_at,
          decided_at,
          proposed_weight,
          proposed_shares,
          rationale,
          portfolios:portfolio_id (id, name)
        `)
        .eq('asset_id', assetId)
        .not('decision_outcome', 'is', null)
        .order('decided_at', { ascending: false, nullsFirst: false })
        .limit(limit + 1)

      if (err2) throw err2

      // Merge + deduplicate by id, sort by most recent resolved date
      const map = new Map<string, any>()
      for (const row of [...(withOutcome || []), ...(withDecision || [])]) {
        if (!map.has(row.id)) map.set(row.id, row)
      }

      const merged = Array.from(map.values())
        .map((row: any) => ({
          id: row.id,
          action: row.action,
          outcome: row.outcome,
          decision_outcome: row.decision_outcome,
          outcome_at: row.outcome_at,
          decided_at: row.decided_at,
          proposed_weight: row.proposed_weight,
          proposed_shares: row.proposed_shares,
          rationale: row.rationale || '',
          portfolio: row.portfolios || null,
        } as AssetRecentDecision))
        .sort((a, b) => {
          const dateA = a.outcome_at || a.decided_at || ''
          const dateB = b.outcome_at || b.decided_at || ''
          return dateB.localeCompare(dateA)
        })

      return merged
    },
    enabled: !!assetId,
    staleTime: 60_000,
  })

  const decisions = data?.slice(0, limit) ?? []
  const hasMore = (data?.length ?? 0) > limit

  return { decisions, isLoading, hasMore }
}
