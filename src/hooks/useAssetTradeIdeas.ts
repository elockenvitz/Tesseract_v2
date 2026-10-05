/**
 * useAssetTradeIdeas — the active trade ideas on one asset.
 *
 * Returns up to `limit` active ideas, most recently updated first. RLS on
 * `trade_queue_items` ensures the user only sees ideas they have access to.
 *
 * ── Why this uses the canonical predicate ────────────────────────────────
 *
 * This asked `outcome IS NULL` and nothing else, which is one clause of a
 * four-clause question. `AssetTab` renders the result as `openItems` and the
 * Asset Page presents it as the open work on the name, so it is asking
 * exactly what the Ideas Pipeline asks — and was getting a different answer.
 * A row with `outcome` still NULL but `status` already `rejected`,
 * `cancelled` or `approved` counted as open, as did every untouched pilot
 * seed and every snoozed idea.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import {
  activeIdeaWork,
  type ActiveWorkRow,
} from '../lib/ideas/active-work'
import { useActiveWorkContext } from './useActiveWorkContext'
import type { TradeStage, TradeAction } from '../types/trading'

export interface AssetTradeIdea {
  id: string
  rationale: string
  action: TradeAction
  stage: TradeStage
  urgency: string
  proposed_weight: number | null
  proposed_shares: number | null
  /** The price the idea is argued to, distinct from any analyst price target. */
  target_price: number | null
  conviction: string | null
  time_horizon: string | null
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
  const { hasGraduated } = useActiveWorkContext()
  const { data, isLoading } = useQuery({
    queryKey: ['asset-trade-ideas', assetId, limit, hasGraduated],
    queryFn: async () => {
      /*
       * Fetch headroom, because the predicate runs client-side.
       *
       * Three of its four clauses need data Postgres cannot express in a
       * `.filter()` here — the pilot-seed rule reads embedded evidence rows,
       * and the deferred-resurface rule needs the reader's local calendar
       * date. So the filter happens after the fetch, which means a bare
       * `limit + 1` could come back entirely full of rejected rows and report
       * "no open ideas" while leaving real ones unread.
       *
       * The window is wide enough that only a name with a very long tail of
       * closed ideas could still truncate, and that case under-reports `+`
       * rather than hiding the ideas themselves.
       */
      const FETCH_WINDOW = Math.min(Math.max((limit + 1) * 4, 40), 200)
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(`
          id,
          rationale,
          action,
          stage,
          status,
          outcome,
          visibility_tier,
          revisit_at,
          deferred_until,
          origin_metadata,
          urgency,
          proposed_weight,
          proposed_shares,
          target_price,
          conviction,
          time_horizon,
          created_by,
          updated_at,
          portfolios:portfolio_id (id, name),
          users:created_by (id, first_name, last_name),
          accepted_trades (id, is_active, reverted_at),
          decision_requests (id, status, created_at)
        `)
        .eq('asset_id', assetId)
        .eq('visibility_tier', 'active')
        .order('updated_at', { ascending: false })
        .limit(FETCH_WINDOW)

      if (error) throw error

      const active = activeIdeaWork(
        (data || []) as unknown as ActiveWorkRow[], { hasGraduated },
      )

      return active.map((row: any) => ({
        id: row.id,
        rationale: row.rationale || '',
        action: row.action,
        stage: row.stage,
        urgency: row.urgency,
        proposed_weight: row.proposed_weight,
        proposed_shares: row.proposed_shares,
        target_price: row.target_price,
        conviction: row.conviction,
        time_horizon: row.time_horizon,
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
