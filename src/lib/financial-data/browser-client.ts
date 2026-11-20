/**
 * Browser-safe financial data client
 * This avoids the server-side configuration issues
 */

// Simple client that works in the browser
export interface Quote {
  symbol: string
  /** Always known. A quote without a price is not a quote; `getQuote` refuses. */
  price: number
  /**
   * Today's move, or null when the previous close is not known.
   *
   * ── Why these three are nullable and `price` is not ───────────────────────
   *
   * A change is a DERIVED figure: it needs two observations, and a provider
   * that gives us one is common. The old type required a number, so every
   * construction site invented one — `previousClose || currentPrice`, which
   * makes the change exactly 0. That is not a flat tape, it is a missing
   * previous close wearing the costume of a measurement, and nothing
   * downstream could tell the two apart because the type did not let them.
   *
   * Measured consequence: `PositionsTab` and `OverviewTab` compute
   * `dailyPnl = shares * (q?.change ?? 0)` and sum it, so a book whose quotes
   * all lacked a previous close reported a confident session P&L of exactly
   * $0.00 — a fabricated aggregate, not a blank cell.
   *
   * null means "not known". A genuine 0 — the price did close unchanged, and
   * we have both observations to prove it — is still a 0 and is still shown.
   */
  change: number | null
  changePercent: number | null
  open: number
  high: number
  low: number
  /** Null when the provider did not supply one. Never the current price. */
  previousClose: number | null
  volume: number
  marketCap?: number
  timestamp: string
  dayHigh: number
  dayLow: number
}

/**
 * The one place a change is derived, so the three providers cannot disagree.
 *
 * Returns nulls rather than zeros when the previous close is absent or
 * unusable. A previous close of 0 is unusable: it is not a price, and
 * dividing by it is how a provider gap becomes an infinite return.
 */
export function deriveChange(
  currentPrice: number,
  rawPreviousClose: unknown,
): Pick<Quote, 'change' | 'changePercent' | 'previousClose'> {
  const prev = rawPreviousClose == null ? NaN : Number(rawPreviousClose)
  if (!Number.isFinite(prev) || prev <= 0) {
    return { change: null, changePercent: null, previousClose: null }
  }
  const change = currentPrice - prev
  return { change, changePercent: (change / prev) * 100, previousClose: prev }
}

export interface NewsItem {
  id: string
  headline: string
  summary?: string
  url: string
  source: string
  publishedAt: string
  symbols?: string[]
}

// Simple service class for browser use
export class BrowserFinancialService {
  private cache: Map<string, { data: Quote; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes to reduce API calls
  /* Reported by `getCacheStatus()`. The counters that fed the retired Alpha
   * Vantage rate limiter (`API_CALL_DELAY`, `dailyCallCount`'s increment,
   * `lastResetDate`, `rateLimitHit`) went with it; these two remain because
   * the debug surface reads them. */
  private lastApiCall = 0
  private dailyCallCount = 0

  constructor() {
    /*
      No provider key is read here, and none may be.

      This class runs in the browser. Vite inlines every `VITE_*` variable into
      the bundle as a string literal at build time, so reading one here does
      not configure a secret — it publishes one. The deployed bundle carried a
      working Alpha Vantage key as plain text in
      `dist/assets/index-*.js`, readable by anyone who loaded the app.

      That key must be treated as compromised regardless of this change:
      removing the read stops the NEXT build shipping it and does nothing about
      the builds already served. Rotation is the fix; this is the thing that
      stops it happening again.

      There is nothing to design here — the server-side seam already exists and
      is already used. `supabase/functions/market-news` and
      `market-events` read `ALPHAVANTAGE_API_KEY` and `FINNHUB_API_KEY` through
      `Deno.env.get`, with no VITE prefix, which is what a provider credential
      is supposed to look like.

      The field and both Alpha Vantage paths are now GONE, not merely null.

      They were kept as a permanent null so the Yahoo fallbacks stayed
      exercised. That reasoning expired once Alpha Vantage was retired
      outright: measured live on 2026-11-20, `NEWS_SENTIMENT` is a premium
      endpoint this subscription does not include, and the provider had
      contributed zero articles across all 73 cached news payloads. Keeping an
      unreachable credential path and a `connect-src` allowance for a provider
      we do not use is standing permission for the exact pattern that leaked
      the key.

      So: no Alpha Vantage, no key field, and `alphavantage.co` removed from
      the CSP in `index.html`. If a provider credential is ever wanted here
      again, the answer is still not this file -- it is a server-side function
      reading `Deno.env.get`, as `market-news` does.
    */
  }

  // Debug method to clear cache
  clearCache() {
    this.cache.clear()
  }

  // Debug method to get cache status
  getCacheStatus() {
    return {
      cacheSize: this.cache.size,
      dailyCalls: this.dailyCallCount,
      lastApiCall: new Date(this.lastApiCall).toLocaleTimeString()
    }
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    try {
      const upperSymbol = symbol.toUpperCase()
      // Check cache first
      const cached = this.cache.get(upperSymbol)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data
      }

      // Yahoo Finance first, then Finnhub. An Alpha Vantage branch sat above
      // this, guarded by a key field that was permanently null, so Yahoo has
      // always been the first provider actually called. See the constructor.
      const yahooQuote = await this.fetchFromYahooFinance(upperSymbol)
      if (yahooQuote) {
        // Cache successful result
        this.cache.set(upperSymbol, { data: yahooQuote, timestamp: Date.now() })
        return yahooQuote
      }
      // Fallback to Finnhub (free tier)
      const finnhubQuote = await this.fetchFromFinnhub(upperSymbol)
      if (finnhubQuote) {
        // Cache successful result
        this.cache.set(upperSymbol, { data: finnhubQuote, timestamp: Date.now() })
        return finnhubQuote
      }
      // Expired cache is still a real price with a real time on it. Returning
      // it is honest because `timestamp` is the moment the price was true, not
      // the moment we fetched it — so anything downstream can tell how old it
      // is and decide for itself. That is the whole difference between this
      // and the placeholder that used to sit below it.
      if (cached) {
        return cached.data
      }

      // Every provider failed and there is nothing cached. Say so.
      return null
    } catch (error) {
      console.warn('Failed to fetch quote for', symbol, error)

      const cached = this.cache.get(symbol.toUpperCase())
      if (cached) return cached.data

      return null
    }
  }

  async getNews(symbols?: string[], limit: number = 5): Promise<NewsItem[]> {
    try {
      /*
       * Mock news is all this has ever returned.
       *
       * An Alpha Vantage branch sat above this, guarded by a key field that
       * was permanently null, so it never ran. Real company news comes from
       * `supabase/functions/market-news`, which is server-side and keyed; this
       * method is not on that path.
       */
      return this.createMockNews(symbols, limit)
    } catch (error) {
      console.warn('Failed to fetch news', error)
      return this.createMockNews(symbols, limit)
    }
  }

  /**
   * One parser for both egress paths.
   *
   * The Netlify function and the Supabase edge function return the identical
   * Yahoo chart payload, so the parsing must not be duplicated — two copies
   * drift, and the copy that drifts is the fallback nobody exercises until the
   * primary is already down.
   *
   * `timestamp` is `regularMarketTime`, the moment the price was true, never
   * the moment we fetched it. Every freshness check downstream rests on that
   * distinction.
   */
  private quoteFromChart(symbol: string, data: any): Quote | null {
    const chart = data?.chart?.result?.[0]
    if (!chart) return null

    const meta = chart.meta
    const quote = chart.indicators?.quote?.[0]
    if (!meta || !quote) return null

    const prices = quote.close || []
    const opens = quote.open || []
    const highs = quote.high || []
    const lows = quote.low || []

    /**
     * The live price is `meta.regularMarketPrice`. The bar array is history.
     *
     * ── The bug this fixes, observed ──────────────────────────────────────
     *
     * This read `prices[prices.length - 1]`, and Yahoo pads the IN-PROGRESS
     * trading day with a null close until the session settles. Captured from
     * the running app during market hours:
     *
     *   close: [262.07, 261.06, 260.28, 256.26, null]
     *   meta.regularMarketPrice: 266.43
     *
     * So the last element was `null`, `Number.isFinite(null)` is false, and
     * this returned null for a payload that states the current price on the
     * line above. Every symbol that reached the Yahoo path during an open
     * market got no quote.
     *
     * That is why Case vs Price came and went. `getQuote` tries Alpha Vantage
     * first, whose free tier answers a couple of symbols before rate-limiting
     * the rest; whichever names won that race got a card, and every name that
     * fell through to Yahoo — the path that is supposed to be reliable — was
     * rejected here. Traced end to end:
     *
     *   AMZN  av-try -> av-null -> yahoo-try -> Y-http200
     *         -> price=266.43 time=1787947201 ind=true
     *         -> Y-parsed-NULL -> ALL-NULL
     *         -> suppress('quote_unavailable', 'price: 0')
     *
     * Review Cases kept working throughout because it needs no quote, which is
     * exactly the asymmetry that made this look like a feed problem.
     *
     * `regularMarketPrice` is the number `regularMarketTime` timestamps, so
     * taking both keeps the price and its age consistent. The last FINITE
     * close is the fallback for a payload that omits it — never a blind index
     * into an array whose tail is padding.
     */
    let latestIndex = -1
    for (let i = prices.length - 1; i >= 0; i--) {
      if (Number.isFinite(prices[i]) && prices[i] > 0) { latestIndex = i; break }
    }

    const live = Number(meta.regularMarketPrice)
    const currentPrice = Number.isFinite(live) && live > 0
      ? live
      : latestIndex >= 0 ? prices[latestIndex] : NaN

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null
    if (!Number.isFinite(meta.regularMarketTime)) return null
    // Bar-level fields index the last SETTLED bar; a padded tail has none.
    if (latestIndex < 0) latestIndex = prices.length - 1

    /**
     * `chartPreviousClose` FIRST, because that is what a daily range sends.
     *
     * ── The bug this fixes, observed on every row ─────────────────────────
     *
     * This read `meta.previousClose || currentPrice`. The request one method
     * below asks for `range=5d&interval=1d`, and on a DAILY interval Yahoo's
     * chart meta carries `chartPreviousClose`, not `previousClose`. So the
     * field was permanently undefined, the fallback made the previous close
     * equal to the current price, and the derived change was exactly 0 — on a
     * successful parse, with a real price and an honest timestamp.
     *
     * That is why the whole product showed `+0.00%`. It was never the
     * provider-failure path — `getQuote` has returned null correctly since
     * `createPlaceholderQuote` was deleted (see its note below). It was this
     * line, reading a field name that payload never contains.
     *
     * The repo already knew the right name in another lane:
     * `usePriceHistory.ts:210` parses the SAME payload and reads
     * `meta.chartPreviousClose`, and `providers/yahoo-finance.ts` types it.
     *
     * `??` not `||`, both here and in `deriveChange`: a previous close of 0 is
     * a bad observation that must be refused, not silently replaced by a
     * number that makes the change look measured.
     */
    const rawPrev = meta.chartPreviousClose ?? meta.previousClose
    const derived = deriveChange(currentPrice, rawPrev)

    return {
      symbol: meta.symbol || symbol.toUpperCase(),
      price: currentPrice,
      ...derived,
      open: opens[latestIndex] || currentPrice,
      high: highs[latestIndex] || currentPrice,
      low: lows[latestIndex] || currentPrice,
      volume: meta.regularMarketVolume || 0,
      marketCap: meta.marketCap,
      timestamp: new Date(meta.regularMarketTime * 1000).toISOString(),
      dayHigh: meta.regularMarketDayHigh || highs[latestIndex] || currentPrice,
      dayLow: meta.regularMarketDayLow || lows[latestIndex] || currentPrice,
    }
  }

  private async fetchFromYahooFinance(symbol: string): Promise<Quote | null> {
    /**
     * Netlify first, Supabase edge second.
     *
     * CORRECTED 2026-11-16 from production edge logs.
     *
     * This comment used to say `yahoo-chart-proxy` "returns 502 on every call"
     * and that every quote therefore came back null. That is not what the
     * deployment does. Measured over 24 hours: 26,368 proxy requests, 2,725 of
     * them 502 — a 10.3% failure rate, steady every hour, not a total outage.
     * Yahoo throttles Supabase's datacenter egress; it does not refuse it at
     * the connection level.
     *
     * The ordering below is unchanged and still right, because Netlify is the
     * more reliable of the two paths. But the reason is reliability, not the
     * edge path being dead, and anything written on the assumption that the
     * Supabase path always fails is wrong: it succeeds about nine times in ten.
     *
     * The edge function is kept as a fallback rather than deleted: if Netlify
     * is the one being blocked on some future day, having two independent
     * egress paths is worth more than a tidy call site. Both failing still
     * returns null, and null still means "we do not know" — never a fabricated
     * price.
     */
    try {
      const res = await fetch(`/.netlify/functions/quote?symbol=${encodeURIComponent(symbol)}&range=5d&interval=1d`)
      if (res.ok) {
        const data = await res.json()
        const quote = this.quoteFromChart(symbol, data)
        if (quote) return quote
      } else {
        console.warn('[browser-client] quote function returned', res.status, 'for', symbol)
      }
    } catch (e) {
      console.warn('[browser-client] quote function unreachable:', e)
    }

    // Fallback: the Supabase edge proxy.
    try {
      const { supabase } = await import('../supabase')
      const { data, error } = await supabase.functions.invoke('yahoo-chart-proxy', {
        body: { symbol, interval: '1d', range: '5d' },
      })
      if (error) {
        console.warn('[browser-client] yahoo-chart-proxy error:', error.message || error)
        return null
      }
      if (data?.error) {
        console.warn('[browser-client] yahoo-chart-proxy returned error:', data.error)
        return null
      }

      return this.quoteFromChart(symbol, data)
    } catch (e) {
      console.warn('[browser-client] yahoo-chart-proxy invoke threw:', e)
      return null
    }
  }

  private async fetchFromFinnhub(symbol: string): Promise<Quote | null> {
    try {
      /*
        Finnhub's public demo token, and only ever that.

        This read a Finnhub credential from the build environment first, which
        put a second provider key into the bundle whenever that variable was
        set. `demo` is
        published by Finnhub for exactly this purpose, so it is the honest
        thing for a browser to hold: heavily rate limited, worth nothing if
        copied, and it makes the tier the code is actually running on visible
        rather than dependent on a build variable. A real Finnhub key belongs
        in the market-events function, where one already lives.
      */
      const finnhubToken = 'demo'

      // Try to get both quote and volume data from Finnhub
      const [quoteResponse, volumeResponse] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubToken}`),
        // Try to get volume from candle data (last trading day)
        fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&count=1&token=${finnhubToken}`)
      ])

      if (!quoteResponse.ok) {
        console.warn(`Finnhub quote API error: ${quoteResponse.status} ${quoteResponse.statusText}`)
        return null
      }

      const quoteData = await quoteResponse.json()
      // Finnhub returns: {c: current, h: high, l: low, o: open, pc: previous close, t: timestamp}
      if (!quoteData.c || quoteData.c === 0) {
        console.warn('No price data available from Finnhub')
        return null
      }

      let volume = 0

      // Try to get volume from candle data
      if (volumeResponse.ok) {
        const volumeData = await volumeResponse.json()
        if (volumeData.v && volumeData.v.length > 0) {
          // Get the most recent volume
          volume = volumeData.v[volumeData.v.length - 1] || 0
        }
      }

      const currentPrice = quoteData.c
      // `pc` is Finnhub's previous close. It was `|| currentPrice`, the same
      // defect as the Yahoo path: an absent previous close became a measured
      // zero change. Absent is now absent. See `deriveChange`.
      const derived = deriveChange(currentPrice, quoteData.pc)

      const result = {
        symbol: symbol.toUpperCase(),
        price: currentPrice,
        ...derived,
        open: quoteData.o || currentPrice,
        high: quoteData.h || currentPrice,
        low: quoteData.l || currentPrice,
        volume: volume,
        timestamp: new Date(quoteData.t * 1000).toISOString(),
        dayHigh: quoteData.h || currentPrice,
        dayLow: quoteData.l || currentPrice
      }

      return result
    } catch (error) {
      console.warn('Finnhub request failed:', error)
      return null
    }
  }

  /*
   * createPlaceholderQuote was here.
   *
   * It returned price/change/changePercent as 0 with
   * `timestamp: new Date().toISOString()` whenever every provider failed, so
   * that "the UI doesn't break". Two things followed from that, and the second
   * is the one that matters:
   *
   *   1. A fabricated zero rendered as a real price. `getQuote` was already
   *      typed `Promise<Quote | null>`, so the type had always been willing to
   *      say "I don't know" — the implementation simply never used it.
   *
   *   2. The fabricated quote stamped itself with the current time, which made
   *      it the *freshest* quote in the system. Any downstream freshness check
   *      passed on it by construction. A staleness guard cannot catch a lie
   *      about staleness; it can only catch honest old data.
   *
   * getQuote now returns null when it does not know. Every caller already
   * handled null because the signature always said it could happen.
   */

  private createMockNews(symbols?: string[], limit: number = 5): NewsItem[] {
    const mockHeadlines = [
      'Company Reports Strong Quarterly Earnings',
      'New Product Launch Expected to Drive Growth',
      'Market Analysts Raise Price Target',
      'Strategic Partnership Announced',
      'Expansion into New Markets Planned'
    ]

    const symbol = symbols?.[0] || 'STOCK'

    return Array.from({ length: limit }, (_, i) => ({
      id: `mock-${symbol}-${i}`,
      headline: mockHeadlines[i % mockHeadlines.length],
      summary: `Recent developments for ${symbol} show promising trends in the market.`,
      url: '#',
      source: 'Financial News',
      publishedAt: new Date(Date.now() - i * 3600000).toISOString(), // Each news item 1 hour apart
      symbols: [symbol]
    }))
  }
}

// Export singleton instance
export const financialDataService = new BrowserFinancialService()