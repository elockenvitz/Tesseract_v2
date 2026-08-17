/**
 * Browser-safe financial data client
 * This avoids the server-side configuration issues
 */

// Simple client that works in the browser
export interface Quote {
  symbol: string
  price: number
  change: number
  changePercent: number
  open: number
  high: number
  low: number
  previousClose: number
  volume: number
  marketCap?: number
  timestamp: string
  dayHigh: number
  dayLow: number
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
  private alphaVantageKey: string | null = null
  private cache: Map<string, { data: Quote; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes to reduce API calls
  private lastApiCall = 0
  private readonly API_CALL_DELAY = 1000 // 1 second between API calls to respect rate limits
  private dailyCallCount = 0
  private lastResetDate = new Date().getDate()
  private rateLimitHit = false

  constructor() {
    // Get API key from environment
    this.alphaVantageKey = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY || null
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

      // Try Alpha Vantage first if we have an API key
      if (this.alphaVantageKey) {
        const quote = await this.fetchFromAlphaVantage(upperSymbol)
        if (quote) {
          // Cache successful result
          this.cache.set(upperSymbol, { data: quote, timestamp: Date.now() })
          return quote
        }
      } else {
      }

      // Fallback to Yahoo Finance
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
      // Try Alpha Vantage news if we have an API key
      if (this.alphaVantageKey && symbols && symbols.length > 0) {
        const news = await this.fetchNewsFromAlphaVantage(symbols[0])
        if (news && news.length > 0) return news.slice(0, limit)
      }

      // Fallback to mock news
      return this.createMockNews(symbols, limit)
    } catch (error) {
      console.warn('Failed to fetch news', error)
      return this.createMockNews(symbols, limit)
    }
  }

  private async fetchFromAlphaVantage(symbol: string): Promise<Quote | null> {
    try {
      // Reset daily counter if new day
      const today = new Date().getDate()
      if (today !== this.lastResetDate) {
        this.dailyCallCount = 0
        this.lastResetDate = today
      }

      // Check daily limit (Alpha Vantage free tier: 25 calls/day for demo key)
      if (this.dailyCallCount >= 20 || this.rateLimitHit) { // Stay safely under limit
        console.warn(`Daily API limit reached (${this.dailyCallCount} calls) or rate limit hit. Using fallback providers.`)
        this.rateLimitHit = true
        return null
      }

      // Respect rate limiting (but much more reasonable)
      const now = Date.now()
      const timeSinceLastCall = now - this.lastApiCall
      if (timeSinceLastCall < this.API_CALL_DELAY) {
        const waitTime = this.API_CALL_DELAY - timeSinceLastCall
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }

      this.lastApiCall = Date.now()
      this.dailyCallCount++

      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this.alphaVantageKey}`
      const response = await fetch(url)
      const data = await response.json()
      // Check for API error responses
      if (data['Error Message']) {
        console.warn('Alpha Vantage API error:', data['Error Message'])
        return null
      }

      if (data['Note']) {
        console.warn('Alpha Vantage rate limit hit:', data['Note'])
        return null
      }

      // Check for Information message (rate limit)
      if (data['Information']) {
        console.warn('Alpha Vantage rate limit hit:', data['Information'])
        this.rateLimitHit = true
        return null
      }

      const quote = data['Global Quote']
      if (!quote || !quote['01. symbol']) {
        console.warn('No quote data returned for', symbol)
        return null
      }

      // The same lie as the placeholder, in miniature: falling back to
      // `new Date()` here stamped an undated quote as current. If Alpha
      // Vantage will not say when the price was true, we do not know, and the
      // next provider in the chain gets a turn.
      if (!quote['07. latest trading day']) {
        console.warn('Alpha Vantage quote has no trading day for', symbol)
        return null
      }

      const result = {
        symbol: quote['01. symbol'] || symbol,
        price: parseFloat(quote['05. price'] || '0'),
        change: parseFloat(quote['09. change'] || '0'),
        changePercent: parseFloat(quote['10. change percent']?.replace('%', '') || '0'),
        open: parseFloat(quote['02. open'] || '0'),
        high: parseFloat(quote['03. high'] || '0'),
        low: parseFloat(quote['04. low'] || '0'),
        previousClose: parseFloat(quote['08. previous close'] || '0'),
        volume: parseInt(quote['06. volume'] || '0'),
        timestamp: quote['07. latest trading day'],
        dayHigh: parseFloat(quote['03. high'] || '0'),
        dayLow: parseFloat(quote['04. low'] || '0')
      }

      return result
    } catch (error) {
      console.warn('Alpha Vantage request failed:', error)
      return null
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

    const latestIndex = prices.length - 1
    if (latestIndex < 0) return null

    const currentPrice = prices[latestIndex]
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null
    if (!Number.isFinite(meta.regularMarketTime)) return null

    const previousClose = meta.previousClose || currentPrice
    const change = currentPrice - previousClose
    const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0

    return {
      symbol: meta.symbol || symbol.toUpperCase(),
      price: currentPrice,
      change,
      changePercent,
      open: opens[latestIndex] || currentPrice,
      high: highs[latestIndex] || currentPrice,
      low: lows[latestIndex] || currentPrice,
      previousClose,
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
     * `yahoo-chart-proxy` is deployed and ACTIVE and returns 502 on every call:
     * Yahoo refuses Supabase's datacenter egress at the connection level, the
     * same refusal that moved the article reader to Netlify. The effect was not
     * a degraded feed but an empty one — every quote came back null, so every
     * scenario card suppressed with `quote_unavailable` and no signal content
     * rendered at all.
     *
     * The edge function is kept as a fallback rather than deleted: if Netlify
     * is the one being blocked on some future day, having two independent
     * egress paths is worth more than a tidy call site. Both failing still
     * returns null, and null still means "we do not know" — never a fabricated
     * price.
     */
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&range=5d&interval=1d`)
      if (res.ok) {
        const data = await res.json()
        const quote = this.quoteFromChart(symbol, data)
        if (quote) return quote
      } else {
        console.warn('[browser-client] /api/quote returned', res.status, 'for', symbol)
      }
    } catch (e) {
      console.warn('[browser-client] /api/quote unreachable:', e)
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
      // Use demo token or from environment
      const finnhubToken = import.meta.env.VITE_FINNHUB_API_KEY || 'demo'

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
      const previousClose = quoteData.pc || currentPrice
      const change = currentPrice - previousClose
      const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0

      const result = {
        symbol: symbol.toUpperCase(),
        price: currentPrice,
        change: change,
        changePercent: changePercent,
        open: quoteData.o || currentPrice,
        high: quoteData.h || currentPrice,
        low: quoteData.l || currentPrice,
        previousClose: previousClose,
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

  private async fetchNewsFromAlphaVantage(symbol: string): Promise<NewsItem[]> {
    try {
      const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&apikey=${this.alphaVantageKey}&limit=50`
      const response = await fetch(url)
      const data = await response.json()

      const feed = data.feed
      if (!Array.isArray(feed)) return []

      return feed.map((item: any, index: number) => ({
        id: `${symbol}-${index}`,
        headline: item.title || 'No headline',
        summary: item.summary || '',
        url: item.url || '#',
        source: item.source || 'Unknown',
        publishedAt: item.time_published || new Date().toISOString(),
        symbols: [symbol]
      }))
    } catch (error) {
      console.warn('Alpha Vantage news request failed:', error)
      return []
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