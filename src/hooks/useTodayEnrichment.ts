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
 *   portfolio_holdings       weight and market value
 *   asset_notes              linked research count
 *
 * No new table, no migration, no change to useDecisionEngine.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { selectCurrentLadders, type TargetRow } from '../lib/signals/current-ladder'
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

  const { data } = useQuery<EnrichmentMap>({
    queryKey: ['today-enrichment', key],
    enabled: assets.length > 0,
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
          .in('asset_id', ids),
        supabase.from('portfolio_holdings')
          .select('asset_id, weight, market_value, portfolios(name)')
          .in('asset_id', ids),
        supabase.from('asset_notes')
          .select('asset_id')
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

      // Exposure. Weights are stored as fractions in some rows and percents in
      // others; anything at or below 1 is read as a fraction.
      for (const row of (holdings.data ?? []) as any[]) {
        const raw = Number(row.weight)
        if (Number.isFinite(raw) && raw > 0) {
          const e = ensure(row.asset_id)
          e.weightPct = raw <= 1 ? raw * 100 : raw
          const mv = Number(row.market_value)
          if (Number.isFinite(mv)) e.marketValue = mv
          if (row.portfolios?.name) e.portfolioName = row.portfolios.name
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
