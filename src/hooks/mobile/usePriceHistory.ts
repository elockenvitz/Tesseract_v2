import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { PricePoint } from '../../components/signals/PriceContext'

/**
 * Cached daily closes for the names on screen.
 *
 * ── What is actually in this table ────────────────────────────────────────
 *
 * Measured against production 2026-08-18: 2,008 rows, exactly 251 closes each
 * for eight symbols — AAPL, CAT, CVX, GOOGL, META, MSFT, ORCL, TSLA. One
 * trading year apiece, and the windows END on different dates, from 24 Apr to
 * 10 Aug 2026. Two of the eight are within a fortnight; AAPL is four months
 * behind.
 *
 * That shape drives every decision here. It is a **snapshot series**, not a
 * feed. Nothing in this hook or its consumers may compare the last close to a
 * live quote, and `PriceContext` states the window's own end date rather than
 * drawing an axis that runs to today.
 *
 * `price_history_cache` carries no `organization_id` and is not org-scoped —
 * it is a market-data cache keyed by symbol. A closing price is not tenant
 * data, and adding a filter for a column that does not exist would be
 * cargo-culting the tenant rule rather than applying it.
 */

/** Roughly nine months of trading. Enough to show a trend, small enough that
 *  twelve symbols do not become a megabyte of JSON on a phone. */
const MAX_POINTS = 180

/** The feed shows at most a dozen names at once; beyond that this is a
 *  different screen with different needs. */
const MAX_SYMBOLS = 12

export function usePriceHistory(symbols: string[], options?: { enabled?: boolean }) {
  const wanted = Array.from(new Set(symbols.map(s => s.toUpperCase()).filter(Boolean)))
    .slice(0, MAX_SYMBOLS)
    .sort()

  return useQuery({
    // Sorted and de-duplicated above, so a re-render that reorders the feed
    // does not look like a new query.
    queryKey: ['feed-price-history', wanted.join(',')],
    enabled: (options?.enabled ?? true) && wanted.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Map<string, PricePoint[]>> => {
      const out = new Map<string, PricePoint[]>()
      if (!wanted.length) return out

      const { data, error } = await supabase
        .from('price_history_cache')
        .select('symbol, date, close')
        .in('symbol', wanted)
        // Newest first so the row cap keeps the RECENT end of each series.
        // Ascending with a limit would return a year-old head and no trend.
        .order('date', { ascending: false })
        .limit(MAX_POINTS * wanted.length)

      if (error) throw error

      for (const r of (data ?? []) as any[]) {
        const close = Number(r.close)
        // A zero or missing close is not a price. Dropping it here keeps the
        // "0 standing in for unknown" case out of every chart downstream.
        if (!Number.isFinite(close) || close <= 0 || !r.date) continue
        const sym = String(r.symbol).toUpperCase()
        const list = out.get(sym) ?? []
        if (list.length >= MAX_POINTS) continue
        list.push({ date: String(r.date), close })
        out.set(sym, list)
      }

      // Fetched descending, drawn ascending.
      for (const [, list] of out) list.reverse()

      // A single close cannot be a line. Drop those series rather than letting
      // each consumer decide, so "no chart" means the same thing everywhere.
      for (const [sym, list] of [...out]) if (list.length < 2) out.delete(sym)

      return out
    },
  })
}
