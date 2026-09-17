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
import { usePilotProgress } from './usePilotProgress'
import { operationalAfterPilot, judgeIdeaRow } from '../lib/pilot/seed-visibility'
import type { TradeQueueItemWithDetails } from '../types/trading'

/** The shape the seed rule needs, over rows PostgREST types loosely. */
type SeedJudgedRow = Record<string, unknown> & {
  origin_metadata?: unknown
  decided_at?: string | null
  decision_outcome?: string | null
  outcome?: string | null
}

export function usePipelineItems() {
  const { currentOrgId } = useOrganization()
  /*
   * After graduation the tour's untouched ideas stop being pipeline work.
   *
   * Unlike the decision engine, this query already selected everything it
   * needed -- `select('*')` carries `origin_metadata` and all three acted-on
   * fields. The columns were there; the rule was simply never applied, so a
   * graduated reader's board still showed five seeded ideas spread across its
   * stages as though someone were working them.
   *
   * `cachedHasGraduated` covers the window before the live read resolves, so
   * the tour does not flash back onto the board on a refresh.
   */
  const { hasGraduated: liveGraduated, cachedHasGraduated } = usePilotProgress()
  const hasGraduated = liveGraduated || cachedHasGraduated

  return useQuery({
    // Graduation is part of the key: it changes what this list contains, so
    // it has to refetch rather than serve the pre-graduation cache entry.
    queryKey: ['trade-queue-items', currentOrgId, hasGraduated],
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

      // Judged before vote summaries and before any caller groups by stage,
      // so a suppressed seed never reaches a column count.
      const visible = operationalAfterPilot(
        ((data || []) as SeedJudgedRow[]).map(item => ({ ...item, ...judgeIdeaRow(item) })),
        { hasGraduated },
      )

      // Calculate vote summaries
      return visible.map((item: any) => ({
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
