import { useQuery } from '@tanstack/react-query'
import { invokeEdgeFunction } from '../lib/supabase'

/**
 * Company news for a set of symbols, merged across providers.
 *
 * The fan-out, key handling, de-duplication and ranking all happen in the
 * `market-news` edge function — see that file for why. This hook is only the
 * client half: it decides *which* symbols are worth asking about and keeps the
 * result cached long enough that scrolling the feed does not re-request.
 */

export interface MarketNewsItem {
  id: string
  headline: string
  summary?: string
  url: string
  publishedAt: string
  source: string
  /** Every ticker the story touches, most relevant first. */
  symbols: string[]
  /** The ticker the story is *about*, as opposed to ones it merely mentions. */
  primarySymbol?: string
  sentiment?: 'positive' | 'negative' | 'neutral'
  relevanceScore?: number
  imageUrl?: string
}

interface MarketNewsResponse {
  items: MarketNewsItem[]
  sources: { name: string; ok: boolean; count: number }[]
}

/**
 * Symbols per request, and a HARD cap: anything past it is dropped here.
 *
 * ── What it actually costs, counted in the edge function ──────────────────
 *
 * `market-news` fans out to four sources, and three of them loop the symbol
 * list one name at a time -- `fromFinnhub`, `fromYahoo` and `fromYahooRss`
 * each `for (const symbol of symbols)` an HTTP call. Only
 * `fromAlphaVantage` batches, by joining them into one `tickers=` parameter.
 * So a name costs three upstream requests, not a longer query string, and
 * twelve names is already thirty-six calls behind one client request.
 *
 * ── Why it is exported ────────────────────────────────────────────────────
 *
 * Because a caller cannot see the cap and one was budgeting against a
 * different number. `MobileDashboard` passed 24 names on a comment reading
 * "the marginal cost of a name is a longer query string", which described
 * AlphaVantage alone; twelve of those 24 were silently discarded on this
 * line. The caller now slices to this constant, so the list it builds is the
 * list that gets asked about.
 */
export const MAX_NEWS_SYMBOLS = 12
const MAX_SYMBOLS = MAX_NEWS_SYMBOLS

export function useMarketNews(symbols: string[], options?: { enabled?: boolean; limit?: number }) {
  /*
   * Truncated in the CALLER's order, then sorted for the key.
   *
   * ── The order used to be thrown away before the cap applied ─────────────
   *
   * This sorted and then sliced, on a comment about query-key stability. The
   * stability was real; the cost was not visible from here. Sorting first
   * means the twelve names that survive the cap are the twelve that come
   * first in the ALPHABET, so a caller that ranked its list -- which both
   * callers do, by what the reader is most likely to be looking at -- had
   * that ranking silently replaced by A-to-L. Names from M onwards could not
   * get a story however important they were.
   *
   * Dedupe and cap first, so the cap spends the budget on what the caller
   * asked for; sort after, so the key is still the same string for the same
   * set. A caller whose order is stable across renders -- a memo, in both
   * cases -- gets a stable key exactly as before.
   */
  const key = Array.from(new Set(symbols.filter(Boolean).map(s => s.toUpperCase())))
    .slice(0, MAX_SYMBOLS)
    .sort()

  return useQuery<MarketNewsResponse>({
    queryKey: ['market-news', key],
    enabled: (options?.enabled ?? true) && key.length > 0,
    // News moves slowly relative to a feed session. Long stale time keeps the
    // scroll from re-requesting; the edge function caches for five minutes on
    // top of this.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      /*
       * Not `functions.invoke`, which sends the publishable key as the bearer
       * token and gets a flat 401 from the gateway. See `invokeEdgeFunction`.
       */
      const data = await invokeEdgeFunction<MarketNewsResponse>('market-news', {
        symbols: key, limit: options?.limit ?? 30, lookbackDays: 7,
      })
      return data ?? { items: [], sources: [] }
    },
  })
}
