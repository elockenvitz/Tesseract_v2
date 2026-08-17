import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { buildScenarioGapCard, type ScenarioCase } from '../../lib/signals/builders/scenarioGap'
import type { CardResult } from '../../lib/signals/contract'

/**
 * Scenario ladders against the live tape.
 *
 * Reads `analyst_price_targets` as what it actually is — one row per scenario,
 * each with a probability — rather than collapsing it to a single "official,
 * most recent" number the way every other surface does. That collapse is why
 * nobody has noticed TSLA trading below its own bear case.
 *
 * Quotes come from `getQuote`, which now returns null when it does not know.
 * That matters here more than anywhere: the entire card is a comparison
 * against the tape, so a fabricated price would produce a confident claim
 * about a number nobody measured. Only 68 of 911 assets carry a stored
 * `current_price`, so most names will simply have no card, which is correct.
 */
export function useScenarioCards(options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery<CardResult[]>({
    queryKey: ['scenario-cards', currentOrgId],
    enabled: (options?.enabled ?? true) && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from('analyst_price_targets')
        .select(`
          asset_id, price, probability, timeframe, reasoning, is_official, created_at, updated_at,
          scenarios(name),
          assets!inner(id, symbol, company_name)
        `)
        .eq('organization_id', currentOrgId!)
        .limit(500)

      const targets = (rows ?? []) as any[]
      if (!targets.length) return []

      // Which of these do we hold, and where. The stake is what turns a
      // valuation observation into something with consequences.
      const assetIds = [...new Set(targets.map(t => t.asset_id).filter(Boolean))]
      const { data: holdings } = await supabase
        .from('portfolio_holdings')
        .select('asset_id, portfolios!inner(name, organization_id)')
        .eq('portfolios.organization_id', currentOrgId!)
        .in('asset_id', assetIds)

      const heldIn = new Map<string, Set<string>>()
      for (const h of (holdings ?? []) as any[]) {
        if (!h.asset_id) continue
        const set = heldIn.get(h.asset_id) ?? new Set<string>()
        if (h.portfolios?.name) set.add(h.portfolios.name)
        heldIn.set(h.asset_id, set)
      }

      // Group the ladder per asset.
      interface Group {
        assetId: string
        symbol: string
        companyName: string | null
        cases: ScenarioCase[]
        statedAt: string
      }
      const byAsset = new Map<string, Group>()
      for (const t of targets) {
        const symbol = t.assets?.symbol
        if (!t.asset_id || !symbol) continue
        const g: Group = byAsset.get(t.asset_id) ?? {
          assetId: t.asset_id,
          symbol,
          companyName: t.assets?.company_name ?? null,
          cases: [],
          statedAt: t.updated_at || t.created_at,
        }
        const price = Number(t.price)
        if (Number.isFinite(price) && price > 0) {
          g.cases.push({
            // The scenario name is the analyst's own word — "Uber Bull" is a
            // real one in this database. Never normalise it to bear/base/bull.
            name: t.scenarios?.name || 'Case',
            price,
            probability: t.probability != null ? Number(t.probability) : null,
            timeframe: t.timeframe ?? null,
            reasoning: t.reasoning ?? null,
          })
        }
        const stamp = t.updated_at || t.created_at
        if (stamp && stamp > g.statedAt) g.statedAt = stamp
        byAsset.set(t.asset_id, g)
      }

      // A ladder needs at least two rungs, so anything smaller is not worth a
      // quote request. Quotes are the expensive part.
      const candidates = [...byAsset.values()].filter(g => g.cases.length >= 2)
      if (!candidates.length) return []

      const quotes = await Promise.all(
        candidates.map(async g => {
          try {
            return { g, quote: await financialDataService.getQuote(g.symbol) }
          } catch {
            return { g, quote: null }
          }
        }),
      )

      return quotes.map(({ g, quote }) =>
        buildScenarioGapCard({
          assetId: g.assetId,
          symbol: g.symbol,
          companyName: g.companyName,
          // Null quote flows straight through as an unusable price and is
          // suppressed as quote_unavailable, with the entity logged. It is
          // never replaced with a stored current_price: that column is not
          // dated, so a claim resting on it could not be checked for
          // freshness.
          price: quote?.price ?? 0,
          priceAsOf: quote?.timestamp ?? '',
          cases: g.cases,
          heldIn: [...(heldIn.get(g.assetId) ?? [])],
          statedAt: g.statedAt,
        }),
      )
    },
  })
}
