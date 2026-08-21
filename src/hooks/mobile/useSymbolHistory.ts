import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import type { PricePoint } from '../../components/signals/PriceContext'

/**
 * Daily closes for ONE symbol, fetched when a card needs them.
 *
 * ── Why this replaces the batched fetch for the feed ──────────────────────
 *
 * `usePriceHistory` asks for up to 24 symbols at once, and that cap is not
 * arbitrary: PostgREST returns at most 1,000 rows per request on this project,
 * so a batch of N symbols at 260 closes each has to be split into
 * `ceil(260N / 1000)` parallel pages. Seven round trips was judged the limit,
 * which put the ceiling at 24 names.
 *
 * The consequence was a chart that depended on where you were standing. The 24
 * were the first 24 in FEED ORDER, so the twenty-fifth card onward lost its
 * evidence band — not because the data was missing, but because the budget had
 * run out. A reader scrolling far enough saw charts stop appearing, which
 * reads as the app degrading.
 *
 * Fetching per symbol dissolves the problem rather than raising the ceiling:
 * **260 rows is comfortably inside the 1,000-row cap, so a single symbol is
 * always exactly one request with no paging at all.** The cap only ever bit
 * because the query was batched.
 *
 * ── Why this is affordable now and was not before ─────────────────────────
 *
 * Before `FeedSlot`, every entry in the feed was mounted at once, so
 * per-symbol fetching would have meant a request per card in an
 * ever-lengthening list. Windowing bounds the mounted set to about five, so
 * this is roughly five in-flight requests at any depth — fewer than the seven
 * pages the batch needed, and they are independently cached rather than
 * re-fetched as a group whenever the symbol list changes.
 *
 * That last point matters as much as the count. The batch's query key was the
 * joined symbol list, so ANY change to it invalidated the whole result; per
 * symbol, scrolling back to a card you have already seen is a cache hit.
 *
 * ── What has not changed ──────────────────────────────────────────────────
 *
 * Still a cache of closes, not a quote feed. The last close is a close, and
 * nothing here or downstream may compare one to a live quote or a target.
 * `price_history_cache` carries no `organization_id` and is not org-scoped: a
 * closing price is a market fact keyed by symbol, not tenant data.
 */

/** A full trading year, which is about what the table holds per symbol. */
const MAX_POINTS = 260

export function useSymbolHistory(symbol: string | null | undefined, options?: { enabled?: boolean }) {
  const key = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''

  return useQuery({
    queryKey: ['symbol-history', key],
    // An hour. Closes change once a day, and the nightly backfill runs at
    // 22:00 UTC — refetching more often costs requests and can return nothing
    // new by construction.
    staleTime: 60 * 60 * 1000,
    enabled: (options?.enabled ?? true) && key.length > 0,
    queryFn: async (): Promise<PricePoint[]> => {
      const { data, error } = await supabase
        .from('price_history_cache')
        .select('date, close')
        .eq('symbol', key)
        // Newest first, so a short read keeps the RECENT end of the series.
        // Ascending would return a year-old head and no trend.
        .order('date', { ascending: false })
        .limit(MAX_POINTS)
      if (error) throw error

      const out: PricePoint[] = []
      for (const r of data ?? []) {
        const close = Number((r as any).close)
        // A zero or missing close is not a price. Dropping it here keeps the
        // "0 standing in for unknown" case out of every chart downstream.
        if (!Number.isFinite(close) || close <= 0 || !(r as any).date) continue
        out.push({ date: String((r as any).date), close })
      }
      // Ascending for the chart, which draws left to right.
      return out.reverse()
    },
  })
}
