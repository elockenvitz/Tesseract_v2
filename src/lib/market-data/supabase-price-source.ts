/**
 * The Supabase half of `reads.ts`. Thin by the same rule as
 * `supabase-asset-source.ts`, and not re-exported from `index.ts` for the same
 * reason — `scripts/gallery-purity.mjs` asserts the gallery entry has no path
 * to the Supabase client.
 *
 * `price_history_cache` carries no `organization_id` and is not org-scoped. A
 * closing price is a market fact keyed by symbol, not tenant data, and
 * `useSymbolHistory` records the same reasoning.
 */

import { supabase } from '../supabase'
import { createMarketDataReader, type PriceCacheRow, type PriceRowSource } from './reads'

export const supabasePriceSource: PriceRowSource = async ({ tradedSymbol, limit }) => {
  const { data, error } = await supabase
    .from('price_history_cache')
    .select('symbol, date, open, high, low, close, volume, source, fetched_at')
    .eq('symbol', tradedSymbol)
    // Newest first, so a short read keeps the RECENT end of the series.
    // Ascending would return a year-old head and no trend.
    .order('date', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`[market-data] price history read failed: ${error.message}`)
  return (data ?? []) as unknown as PriceCacheRow[]
}

export const marketDataReader = createMarketDataReader(supabasePriceSource)
