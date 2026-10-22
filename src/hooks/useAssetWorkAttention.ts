/**
 * Open decision requests on one asset, split by whose move it is.
 *
 * ── Why this fetches at all ──────────────────────────────────────────────
 *
 * Nothing on the Asset Page already holds decision requests. The timeline
 * derives EVENTS from them — "Recommendation submitted" — which is the
 * chronological record, not the open-obligation list, and an event cannot
 * tell you whether the request is still waiting or who may resolve it.
 * `ThoughtsSection` holds the right data but is a different surface with a
 * different scope (every asset, the reader's inbox).
 *
 * So: two small queries, both asset-scoped, both reusing shapes that already
 * exist elsewhere in the app rather than inventing any.
 *
 * ── Authorization is unchanged ───────────────────────────────────────────
 *
 * `portfolio_team` with `role IN ('pm','admin')` — exactly what
 * ThoughtsSection reads to decide whether to render the decide buttons. This
 * hook grants nothing; RLS still returns the rows, and the server still
 * refuses a decision this split mislabels.
 *
 * KNOWN DEBT, not addressed here: this schema has two membership tables,
 * `portfolio_team` and `portfolio_memberships`. A collaborator added through
 * the other one is invisible to the decision path — and therefore invisible
 * here too, identically. Following the decision path is the point: a Work
 * surface that disagreed with the decide buttons would be worse than one that
 * shares their blind spot. Resolving the duplication is its own change.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { splitAttention, type AttentionSplit } from '../lib/asset-work/attention'
import type { WorkAttentionItem } from '../components/asset/work/AssetWorkPane'

type Row = WorkAttentionItem & {
  portfolioId: string | null
  requestedBy: string | null
  status: string | null
}

export function useAssetWorkAttention(assetId: string, enabled = true) {
  const { user } = useAuth()

  /* The books this reader manages. Same query, same key shape and same
     staleTime as the decision path, so the two share a cache entry rather
     than racing each other to a different answer. */
  const { data: pmPortfolioIds = [], isLoading: pmLoading } = useQuery({
    queryKey: ['user-pm-portfolios', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('portfolio_team')
        .select('portfolio_id')
        .eq('user_id', user!.id)
        .in('role', ['pm', 'admin'])
      return (data || []).map((p: { portfolio_id: string }) => p.portfolio_id)
    },
    enabled: !!user?.id && enabled,
    staleTime: 5 * 60_000,
  })

  /* Requests for THIS asset only. The join is the filter: a decision request
     belongs to a trade_queue_item, and that item names the asset. */
  const { data: rows = [], isLoading: reqLoading } = useQuery({
    queryKey: ['asset-work-requests', assetId],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('decision_requests')
        .select(`
          id, status, context_note, created_at, requested_by, portfolio_id,
          portfolio:portfolios(id, name),
          requester:users!decision_requests_requested_by_fkey(id, first_name, last_name),
          trade_queue_item:trade_queue_items!inner(id, action, asset_id)
        `)
        .eq('trade_queue_item.asset_id', assetId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r: any) => ({
        id: r.id,
        portfolioId: r.portfolio_id ?? null,
        requestedBy: r.requested_by ?? null,
        status: r.status ?? null,
        action: r.trade_queue_item?.action ?? null,
        portfolioName: r.portfolio?.name ?? null,
        requesterName: r.requester
          ? [r.requester.first_name, r.requester.last_name].filter(Boolean).join(' ') || null
          : null,
        contextNote: r.context_note ?? null,
        createdAt: r.created_at ?? null,
      })) as Row[]
    },
    enabled: !!assetId && enabled,
    staleTime: 30_000,
  })

  const attention: AttentionSplit<WorkAttentionItem> = useMemo(
    () => splitAttention(rows, { userId: user?.id ?? null, pmPortfolioIds }),
    [rows, user?.id, pmPortfolioIds],
  )

  return { attention, isLoading: pmLoading || reqLoading, pmPortfolioIds }
}
