/**
 * useAssetTradeIdeas — Fetches active (non-resolved) trade ideas for a specific asset.
 *
 * Returns up to `limit` active ideas sorted by most recently updated.
 * RLS on trade_queue_items ensures the user only sees ideas they have access to.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { TradeStage, TradeAction } from '../types/trading'

export interface AssetTradeIdea {
  id: string
  rationale: string
  action: TradeAction
  stage: TradeStage
  urgency: string
  proposed_weight: number | null
  proposed_shares: number | null
  created_by: string | null
  updated_at: string
  portfolio: { id: string; name: string } | null
  creator: { id: string; first_name: string | null; last_name: string | null } | null
}

interface UseAssetTradeIdeasOptions {
  assetId: string
  limit?: number
}

export function useAssetTradeIdeas({ assetId, limit = 5 }: UseAssetTradeIdeasOptions) {
  const { data, isLoading } = useQuery({
    queryKey: ['asset-trade-ideas', assetId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          id,
          rationale,
          action,
          stage,
          urgency,
          proposed_weight,
          proposed_shares,
          created_by,
          updated_at,
          portfolios:portfolio_id (id, name),
          users:created_by (id, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .is('outcome', null)
        .order('updated_at', { ascending: false })
        .limit(limit + 1) // +1 to detect "has more"

      if (error) throw error

      return (data || []).map((row: any) => ({
        id: row.id,
        rationale: row.rationale || '',
        action: row.action,
        stage: row.stage,
        urgency: row.urgency,
        proposed_weight: row.proposed_weight,
        proposed_shares: row.proposed_shares,
        created_by: row.created_by,
        updated_at: row.updated_at,
        portfolio: row.portfolios || null,
        creator: row.users || null,
      })) as AssetTradeIdea[]
    },
    enabled: !!assetId,
    staleTime: 30_000,
  })

  const ideas = data?.slice(0, limit) ?? []
  const hasMore = (data?.length ?? 0) > limit
  const totalHint = hasMore ? `${limit}+` : String(ideas.length)

  return { ideas, isLoading, hasMore, totalHint }
}
