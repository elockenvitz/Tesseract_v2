import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

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
  // Sorted and truncated so the query key is stable regardless of the order
  // the caller happened to collect symbols in — otherwise the same request
  // re-fires whenever an upstream list reshuffles.
  const key = Array.from(new Set(symbols.filter(Boolean).map(s => s.toUpperCase())))
    .sort()
    .slice(0, MAX_SYMBOLS)

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
      const { data, error } = await supabase.functions.invoke('market-news', {
        body: { symbols: key, limit: options?.limit ?? 30, lookbackDays: 7 },
      })
      if (error) throw error
      return (data ?? { items: [], sources: [] }) as MarketNewsResponse
    },
  })
}
