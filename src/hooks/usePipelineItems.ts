/**
 * usePipelineItems — the active pipeline, shared by the desktop board and the
 * phone.
 *
 * Extracted from TradeQueuePage so the mobile pipeline reads the same rows
 * through the same query key rather than issuing a second, slightly different
 * fetch. One key means one cache entry: a stage move made on either surface
 * invalidates both.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../contexts/OrganizationContext'
import type { TradeQueueItemWithDetails } from '../types/trading'

export function usePipelineItems() {
  const { currentOrgId } = useOrganization()

  return useQuery({
    queryKey: ['trade-queue-items', currentOrgId],
    queryFn: async () => {
      if (!currentOrgId) return [] as TradeQueueItemWithDetails[]
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
        .eq('organization_id', currentOrgId)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error

      // Calculate vote summaries
      return (data || []).map((item: any) => ({
        ...item,
        vote_summary: {
          approve: item.trade_queue_votes?.filter((v: any) => v.vote === 'approve').length || 0,
          reject: item.trade_queue_votes?.filter((v: any) => v.vote === 'reject').length || 0,
          needs_discussion: item.trade_queue_votes?.filter((v: any) => v.vote === 'needs_discussion').length || 0,
        }
      })) as TradeQueueItemWithDetails[]
    },
  })
}
