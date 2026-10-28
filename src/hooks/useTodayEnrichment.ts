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
import {
  chunkFor, fetchDailyCloses, type DailyClose,
} from '../lib/market-data/daily-closes'
import { selectCurrentLadders, type TargetRow } from '../lib/signals/current-ladder'
import { buildBook, weightsByAsset, type HoldingRow } from '../lib/portfolio/holdings'
import { useOrganization } from '../contexts/OrganizationContext'
import type { EnrichmentMap, TodayEnrichment } from '../lib/today'
import type { TodayItem } from '../lib/today'

/** A year of closes is enough to reach most review anchors without paging. */
const HISTORY_DAYS = 400

/*
 * ── The row cap, and the twelve weeks it silently deleted ────────────────
 *
 * PostgREST answers at most 1000 rows. This hook asked for every surfaced
 * name's history in ONE `.in('symbol', symbols)` query ordered by date
 * ascending, so once the desk held five names the response hit the cap --
 * and because the sort was ascending, the rows it dropped were the NEWEST
 * ones.
 *
 * Measured against production on 2026-10-27: five symbols x 258 closes =
 * 1290 rows available, 1000 returned, so the last close this hook could see
 * was 2026-07-10 while the real last close was 2026-10-01.
 *
 * Nothing failed. `spot` was simply the price from twelve weeks ago, and
 * every figure derived from it was computed to that date:
 *
 *   TSLA, anchored at its thesis 220 days back
 *     close at the anchor            380.85
 *     last close under the cap       407.76   -> Today printed "+7.1%"
 *     last close in the table        354.11   -> the truth is "-7.0%"
 *
 * Today said the stock was up 7% and the asset page said it was down 7%,
 * about the same name on the same day, because the asset page queries one
 * symbol at a time and never hit the cap. The framework bands were drawn
 * against the stale mark too, so "the price is +36.3% above the bull case"
 * was a statement about July.
 *
 * The fix is to make the cap unreachable BY CONSTRUCTION rather than to
 * raise a limit and hope: ask for at most `CHUNK` symbols per request, where
 * CHUNK is sized so that even a close on every single calendar day of the
 * window cannot fill the response. `assertWhole` then checks the invariant
 * actually held, so if the cap or the window ever changes this fails loudly
 * instead of quietly shaving the recent end off every chart again.
 *
 * The query and its guard now live in `lib/market-data/daily-closes`, because
 * the Ideas gallery needed the same thing and the only alternatives were an
 * Ideas component importing a Today hook, or the query being written a second
 * time -- which is exactly how this bug would reach a third surface. The
 * WINDOW stays here, because 400 days is Today's requirement and not a
 * universal one.
 */
export { ROW_CAP } from '../lib/market-data/daily-closes'
export const CHUNK = chunkFor(HISTORY_DAYS)
export { HISTORY_DAYS }

type Close = DailyClose

export async function fetchHistory(symbols: string[], floor: string): Promise<Close[]> {
  // `floor` is retained in the signature because the call site computes it
  // from HISTORY_DAYS; the lib derives the same date from `days`.
  void floor
  return fetchDailyCloses(symbols, { days: HISTORY_DAYS, chunk: CHUNK })
}

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

  const { data, status } = useQuery<EnrichmentMap>({
    queryKey: ['today-enrichment', key, currentOrgId],
    enabled: assets.length > 0 && !!currentOrgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const ids = assets.map(a => a.assetId)
      const symbols = assets.map(a => a.symbol).filter((s): s is string => !!s)
      const floor = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10)

      const [history, targets, holdings, research] = await Promise.all([
        fetchHistory(symbols, floor),
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
      for (const row of history) {
        const close = Number(row.close)
        if (!Number.isFinite(close)) continue
        const arr = bySymbol.get(row.symbol) ?? []
        arr.push({ date: row.date, close })
        bySymbol.set(row.symbol, arr)
      }
      /*
       * Ascending by date, stated rather than inherited.
       *
       * Each symbol lives in exactly one chunk and each chunk is ordered, so
       * this is already true -- but EVERY figure on the surface is
       * `(last - first) / first`, so if the order were ever wrong the whole
       * lens would quietly change sign. One sort is cheaper than that risk.
       */
      for (const arr of bySymbol.values()) arr.sort((a, b) => a.date.localeCompare(b.date))
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

  /*
   * The map, and whether it is still coming.
   *
   * Measured on a cold load at 1920x889: the tiles painted, sat still for
   * ~6.3 seconds, and then re-arranged twice as this query answered -- the
   * aging track and the price plot appearing at once, growing the tile and
   * pushing everything under it. CLS 0.0748, and both shifts landed almost
   * seven seconds in, which is what makes it read as a hitch rather than as
   * loading.
   *
   * A tile cannot reserve the room without knowing the difference between
   * "no visual is coming" and "the visual has not arrived yet", and the bare
   * map cannot say. Hence the shape change.
   *
   * `status`, not `isFetching`: the query is gated on `currentOrgId`, which on
   * a cold load does not exist for the first several seconds. While it is
   * disabled nothing is in flight, so `isFetching` was false and the first
   * measured pass reserved nothing at all -- CLS stayed at 0.0748. `status`
   * is 'pending' for a query that has not run YET as well as one running now,
   * and turns 'error' if the fetch fails, so a failure stops reserving rather
   * than holding an empty frame forever. The `assets.length` guard keeps a
   * permanently-disabled query (nothing to enrich) from reading as pending.
   */
  return { map: data ?? {}, pending: assets.length > 0 && status === 'pending' }
}
