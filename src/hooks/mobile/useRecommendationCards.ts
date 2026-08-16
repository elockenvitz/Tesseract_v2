import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { buildRecommendationCard } from '../../lib/signals/builders/recommendation'
import type { CardResult } from '../../lib/signals/contract'

/**
 * Recommendations awaiting a decision, as contract cards.
 *
 * Sourced from `trade_queue_items` directly rather than from attention items.
 * The attention row carries neither the proposed size nor the current one, and
 * `useDecisionContext` fetches them one item at a time — fine for a detail
 * view, a query per card in a feed.
 *
 * The current weight comes from `portfolio_holdings_positions`, and its date
 * matters: the builder stamps the delta with the snapshot date rather than the
 * recommendation's own, because a number mixing a stated weight with a
 * snapshot one is only as fresh as the snapshot.
 */
export function useRecommendationCards(options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery<CardResult[]>({
    queryKey: ['recommendation-cards', currentOrgId],
    enabled: (options?.enabled ?? true) && !!currentOrgId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from('trade_queue_items')
        .select(`
          id, action, proposed_weight, target_price, rationale, created_by,
          created_at, portfolio_id, asset_id, status,
          assets!inner(id, symbol, company_name),
          portfolios!inner(id, name, organization_id)
        `)
        .eq('portfolios.organization_id', currentOrgId!)
        .in('status', ['pending', 'proposed', 'awaiting_review'])
        .order('created_at', { ascending: false })
        .limit(40)

      const items = (rows ?? []) as any[]
      if (!items.length) return []

      // Author names and current weights, both in one round trip each rather
      // than one per card.
      const authorIds = [...new Set(items.map(r => r.created_by).filter(Boolean))]
      const pairs = items.filter(r => r.portfolio_id && r.asset_id)

      const [{ data: authors }, { data: positions }] = await Promise.all([
        authorIds.length
          ? supabase.from('users').select('id, first_name, last_name, full_name, email').in('id', authorIds)
          : Promise.resolve({ data: [] } as any),
        pairs.length
          ? supabase
              .from('portfolio_holdings_positions')
              // The portfolio ids already came from an org-filtered query, so
              // this is transitively scoped — and transitive scoping is
              // exactly what produced the asset_lists leak. The org filter is
              // stated, not inferred.
              .select('portfolio_id, asset_id, weight_pct, date, portfolios!inner(organization_id)')
              .eq('portfolios.organization_id', currentOrgId!)
              .in('portfolio_id', [...new Set(pairs.map(r => r.portfolio_id))])
              .in('asset_id', [...new Set(pairs.map(r => r.asset_id))])
          : Promise.resolve({ data: [] } as any),
      ])

      const nameOf = new Map<string, string>()
      for (const a of (authors ?? []) as any[]) {
        const n = a.full_name
          || [a.first_name, a.last_name].filter(Boolean).join(' ')
          || a.email?.split('@')[0]
        if (n) nameOf.set(a.id, n)
      }

      // Newest snapshot per (portfolio, asset). The table is dated, so an older
      // row is a previous position rather than a second opinion.
      const posOf = new Map<string, { weight: number; date: string | null }>()
      for (const p of (positions ?? []) as any[]) {
        const key = `${p.portfolio_id}:${p.asset_id}`
        const prev = posOf.get(key)
        if (prev && prev.date && p.date && prev.date >= p.date) continue
        if (p.weight_pct == null) continue
        posOf.set(key, { weight: Number(p.weight_pct), date: p.date ?? null })
      }

      return items.map(r => {
        const pos = posOf.get(`${r.portfolio_id}:${r.asset_id}`)
        return buildRecommendationCard({
          id: r.id,
          assetId: r.asset_id,
          symbol: r.assets?.symbol ?? '',
          companyName: r.assets?.company_name ?? null,
          action: r.action ?? null,
          proposedWeightPct: r.proposed_weight != null ? Number(r.proposed_weight) : null,
          // Explicitly null when there is no row, never 0 — the builder treats
          // 0 as "we hold none of it" and null as "we could not look it up",
          // and conflating them either hides every new buy or invents a 0%
          // position for every failed join.
          currentWeightPct: pos ? pos.weight : null,
          currentWeightAsOf: pos?.date ?? null,
          rationale: r.rationale ?? null,
          recommendedBy: nameOf.get(r.created_by) ?? null,
          portfolioId: r.portfolio_id,
          portfolioName: r.portfolios?.name ?? 'Portfolio',
          createdAt: r.created_at,
        })
      })
    },
  })
}
