import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { AttentionItem } from '../../types/attention'

export interface DecisionContext {
  /** Who put this in front of the user. */
  recommendedBy: string | null
  action: string | null
  /** Weight the recommendation is asking for, in percent. */
  proposedWeight: number | null
  /** What the portfolio holds today, in percent. */
  currentWeight: number | null
  targetPrice: number | null
  rationale: string | null
}

/**
 * The context a decision cannot reasonably be made without: who recommended
 * it, and what it does to the position.
 *
 * "Sell DASH" alone is not a decision — the same instruction means something
 * different at a 30bp position than a 4% one, and different again depending on
 * who is asking. The attention item carries neither, so they are fetched here
 * for the trade-queue-backed items where they exist.
 *
 * Returns nulls rather than failing for other source types (list suggestions,
 * project deliverables); the card renders what it has.
 */
export function useDecisionContext(item: AttentionItem | null) {
  const isTradeQueue = item?.source_type === 'trade_queue_item'
  const sourceId = item?.source_id
  const portfolioId = item?.context?.portfolio_id
  const assetId = item?.context?.asset_id

  return useQuery<DecisionContext>({
    queryKey: ['decision-context', sourceId, portfolioId, assetId],
    queryFn: async () => {
      const empty: DecisionContext = {
        recommendedBy: null,
        action: null,
        proposedWeight: null,
        currentWeight: null,
        targetPrice: null,
        rationale: null,
      }
      if (!sourceId) return empty

      const { data: queueItem } = await supabase
        .from('trade_queue_items')
        .select('action, proposed_weight, target_price, rationale, created_by, portfolio_id, asset_id')
        .eq('id', sourceId)
        .maybeSingle()

      if (!queueItem) return empty
      const row = queueItem as any

      // Recommender name and current weight are independent; fetch together so
      // the card is not staged in twice.
      const [{ data: author }, { data: position }] = await Promise.all([
        row.created_by
          ? supabase
              .from('users')
              .select('first_name, last_name, full_name, email')
              .eq('id', row.created_by)
              .maybeSingle()
          : Promise.resolve({ data: null } as any),
        row.portfolio_id && row.asset_id
          ? supabase
              .from('portfolio_holdings_positions')
              .select('weight_pct')
              .eq('portfolio_id', row.portfolio_id)
              .eq('asset_id', row.asset_id)
              .maybeSingle()
          : Promise.resolve({ data: null } as any),
      ])

      const a = author as any
      const name =
        a?.full_name ||
        [a?.first_name, a?.last_name].filter(Boolean).join(' ') ||
        a?.email?.split('@')[0] ||
        null

      return {
        recommendedBy: name,
        action: row.action ?? null,
        proposedWeight: row.proposed_weight != null ? Number(row.proposed_weight) : null,
        currentWeight: (position as any)?.weight_pct != null ? Number((position as any).weight_pct) : null,
        targetPrice: row.target_price != null ? Number(row.target_price) : null,
        rationale: row.rationale ?? null,
      }
    },
    enabled: !!isTradeQueue && !!sourceId,
    staleTime: 60_000,
  })
}
