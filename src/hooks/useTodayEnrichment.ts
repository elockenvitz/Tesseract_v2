/**
 * Today — enrichment for the surfaced set only.
 *
 * ── Why this is scoped to four objects ────────────────────────────────────
 *
 * The candidate pool is every finding the engine produced; on a real account
 * that was 7 stale theses, 19 proposals and 4 unsimulated ideas. Fetching
 * price history and ladders for all of them to draw four charts would be a
 * large read for data nobody sees. So this hook takes the SURFACED items and
 * nothing else, and "Also watching" is never enriched because it never draws.
 *
 * ── Sources, all existing ─────────────────────────────────────────────────
 *
 *   price_history_cache      symbol, date, close  (same table mobile reads)
 *   analyst_price_targets    → selectCurrentLadders, the same selector Review
 *                              Cases uses, so Today cannot disagree with it
 *   portfolio_holdings       shares, price, date -> weight DERIVED against
 *                              the book's own NAV via lib/portfolio/holdings
 *   asset_notes              linked research count
 *
 * No new table, no migration, no change to useDecisionEngine.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { selectCurrentLadders, type TargetRow } from '../lib/signals/current-ladder'
import { buildBook, weightsByAsset, type HoldingRow } from '../lib/portfolio/holdings'
import { useOrganization } from '../contexts/OrganizationContext'
import type { EnrichmentMap, TodayEnrichment } from '../lib/today'
import type { TodayItem } from '../lib/today'

/** A year of closes is enough to reach most review anchors without paging. */
const HISTORY_DAYS = 400

export function useTodayEnrichment(items: TodayItem[]) {
  // Keyed on the surfaced asset ids so the query re-runs when the set changes
  // but not when unrelated state does.
  const assets = useMemo(() => {
    const seen = new Map<string, string | null>()
    for (const i of items) {
      const id = i.source.context.assetId
      if (id && !seen.has(id)) seen.set(id, i.ticker)
    }
    return [...seen.entries()].map(([assetId, symbol]) => ({ assetId, symbol }))
  }, [items])

  const key = assets.map(a => a.assetId).sort().join('|')
  // Targets and evidence are the organisation's, not the asset's. Filtering on
  // `asset_id` alone counted another workspace's notes and read its ladders.
  const { currentOrgId } = useOrganization()

  const { data } = useQuery<EnrichmentMap>({
    queryKey: ['today-enrichment', key, currentOrgId],
    enabled: assets.length > 0 && !!currentOrgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const ids = assets.map(a => a.assetId)
      const symbols = assets.map(a => a.symbol).filter((s): s is string => !!s)
      const floor = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10)

      const [history, targets, holdings, research] = await Promise.all([
        symbols.length
          ? supabase.from('price_history_cache')
              .select('symbol, date, close')
              .in('symbol', symbols).gte('date', floor)
              .order('date', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        supabase.from('analyst_price_targets')
          .select('id, asset_id, price, is_official, created_at, updated_at, scenarios(name), assets(id, symbol, company_name)')
          .eq('organization_id', currentOrgId!)
          .in('asset_id', ids),
        // Which books hold these names. A SET, so snapshot duplicates cannot
        // change it -- the sized read happens below, once the books are known.
        // holdings-audit: safe -- builds a Set of portfolio ids, never a sum.
        supabase.from('portfolio_holdings')
          .select('portfolio_id')
          .in('asset_id', ids),
        supabase.from('asset_notes')
          .select('asset_id')
          .eq('organization_id', currentOrgId!)
          .in('asset_id', ids).eq('is_deleted', false),
      ])

      const out: EnrichmentMap = {}
      const ensure = (id: string): TodayEnrichment => (out[id] ??= {})

      // History, grouped by symbol then mapped back onto the asset.
      const bySymbol = new Map<string, { date: string; close: number }[]>()
      for (const row of (history.data ?? []) as any[]) {
        const close = Number(row.close)
        if (!Number.isFinite(close)) continue
        const arr = bySymbol.get(row.symbol) ?? []
        arr.push({ date: row.date, close })
        bySymbol.set(row.symbol, arr)
      }
      for (const { assetId, symbol } of assets) {
        const series = symbol ? bySymbol.get(symbol) : undefined
        if (series?.length) {
          const e = ensure(assetId)
          e.history = series
          e.spot = series[series.length - 1].close
        }
      }

      // Ladders, from the one shared definition of "the current cases".
      const ladders = selectCurrentLadders((targets.data ?? []) as TargetRow[])
      for (const ladder of ladders) {
        if (ladder.valid) ensure(ladder.assetId).ladder = ladder
      }

      // Exposure, derived rather than read.
      //
      // `portfolio_holdings` has no `weight` or `market_value` column -- it
      // carries shares, price, cost and date. This asked for `weight` and
      // `market_value` and therefore returned NOTHING, silently: PostgREST
      // rejects the unknown column, `holdings.data` came back null, and every
      // Today card simply rendered without exposure. `useDesktopResearch` hit
      // the same defect and states it in its own header; this was the last
      // site still asking.
      //
      // Weight is the largest SINGLE-BOOK stake, matching Research and Ideas:
      // 25.3% of one fund plus 4.0% of another is not 29.3% of anything. The
      // whole book is needed for the denominator, so the rows come back per
      // portfolio rather than per asset, and `weightsByAsset`/`buildBook`
      // reduce to the current snapshot before any of it is summed.
      const books = [...new Set(((holdings.data ?? []) as any[]).map(h => h.portfolio_id))]
        .filter((id): id is string => !!id)

      if (books.length) {
        const { data: bookRows } = await supabase.from('portfolio_holdings')
          .select('portfolio_id, asset_id, shares, price, cost, date, portfolios(name)')
          .in('portfolio_id', books)
        const rows = (bookRows ?? []) as unknown as HoldingRow[]

        const nameOf = new Map<string, string>()
        for (const r of (bookRows ?? []) as any[]) {
          if (r.portfolio_id && r.portfolios?.name) nameOf.set(r.portfolio_id, r.portfolios.name)
        }

        const built = new Map<string, ReturnType<typeof buildBook>>()
        const bookFor = (id: string) => {
          let b = built.get(id)
          if (!b) { b = buildBook(id, rows); built.set(id, b) }
          return b
        }

        const byAsset = weightsByAsset(rows)
        for (const { assetId } of assets) {
          const perPortfolio = byAsset.get(assetId)
          if (!perPortfolio?.size) continue

          // The book this name matters most in leads, and the market value and
          // portfolio name are read from THAT book so the three numbers always
          // describe the same position.
          let bestId: string | null = null
          let best = -Infinity
          for (const [portfolioId, pct] of perPortfolio) {
            if (pct > best) { best = pct; bestId = portfolioId }
          }
          if (!bestId || !(best > 0)) continue

          const e = ensure(assetId)
          e.weightPct = best
          const pos = bookFor(bestId).positions.find(pp => pp.assetId === assetId)
          if (pos && pos.marketValue > 0) e.marketValue = pos.marketValue
          const nm = nameOf.get(bestId)
          if (nm) e.portfolioName = nm
        }
      }

      for (const row of (research.data ?? []) as any[]) {
        const e = ensure(row.asset_id)
        e.researchCount = (e.researchCount ?? 0) + 1
      }

      return out
    },
  })

  return data ?? {}
}
