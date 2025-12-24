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
    console.log('Financial data cache cleared')
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
      console.log(`🎯 Getting quote for ${upperSymbol}`)

      // Check cache first
      const cached = this.cache.get(upperSymbol)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log(`📋 Using cached data for ${upperSymbol}, volume: ${cached.data.volume}`)
        return cached.data
      }

      // Try Alpha Vantage first if we have an API key
      if (this.alphaVantageKey) {
        console.log(`🔄 Trying Alpha Vantage for ${upperSymbol}`)
        const quote = await this.fetchFromAlphaVantage(upperSymbol)
        if (quote) {
          // Cache successful result
          this.cache.set(upperSymbol, { data: quote, timestamp: Date.now() })
          console.log(`✅ Alpha Vantage successful for ${upperSymbol}, volume: ${quote.volume}`)
          return quote
        }
        console.log(`❌ Alpha Vantage failed for ${upperSymbol}`)
      } else {
        console.log(`⚠️ No Alpha Vantage API key, skipping`)
      }

      // Fallback to Yahoo Finance
      console.log(`🔄 Trying Yahoo Finance for ${upperSymbol}`)
      const yahooQuote = await this.fetchFromYahooFinance(upperSymbol)
      if (yahooQuote) {
        // Cache successful result
        this.cache.set(upperSymbol, { data: yahooQuote, timestamp: Date.now() })
        console.log(`✅ Yahoo Finance successful for ${upperSymbol}, volume: ${yahooQuote.volume}`)
        return yahooQuote
      }
      console.log(`❌ Yahoo Finance failed for ${upperSymbol}`)

      // Fallback to Finnhub (free tier)
      console.log(`🔄 Trying Finnhub for ${upperSymbol}`)
      const finnhubQuote = await this.fetchFromFinnhub(upperSymbol)
      if (finnhubQuote) {
        // Cache successful result
        this.cache.set(upperSymbol, { data: finnhubQuote, timestamp: Date.now() })
        console.log(`✅ Finnhub successful for ${upperSymbol}, volume: ${finnhubQuote.volume}`)
        return finnhubQuote
      }
      console.log(`❌ Finnhub failed for ${upperSymbol}`)

      // If we have cached data (even if expired), return it rather than null
      if (cached) {
        console.log(`Using expired cache for ${upperSymbol}`)
        return cached.data
      }

      // As last resort, provide a placeholder quote so UI doesn't break
      console.log(`No real data available for ${upperSymbol} from any API provider, providing placeholder`)
      return this.createPlaceholderQuote(upperSymbol)
    } catch (error) {
      console.warn('Failed to fetch quote for', symbol, error)

      // Try to return cached data first
      const cached = this.cache.get(symbol.toUpperCase())
      if (cached) return cached.data

      // As fallback, provide a placeholder quote so UI doesn't break
      return this.createPlaceholderQuote(symbol.toUpperCase())
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
        console.log(`Rate limiting: waiting ${waitTime}ms before API call for ${symbol}`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }

      this.lastApiCall = Date.now()
      this.dailyCallCount++

      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this.alphaVantageKey}`
      console.log(`Fetching real data for ${symbol} from Alpha Vantage`)

      const response = await fetch(url)
      const data = await response.json()
      console.log(`Alpha Vantage raw response for ${symbol}:`, JSON.stringify(data, null, 2))

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
        timestamp: quote['07. latest trading day'] || new Date().toISOString(),
        dayHigh: parseFloat(quote['03. high'] || '0'),
        dayLow: parseFloat(quote['04. low'] || '0')
      }

      console.log(`Successfully fetched real Alpha Vantage data for ${symbol}: $${result.price}, volume: ${result.volume}`)
      console.log(`🔍 Alpha Vantage raw volume field for ${symbol}:`, quote['06. volume'])
      return result
    } catch (error) {
      console.warn('Alpha Vantage request failed:', error)
      return null
    }
  }

  private async fetchFromYahooFinance(symbol: string): Promise<Quote | null> {
    try {
      // Multiple CORS proxies for redundancy - order matters (most reliable first)
      const corsProxies = [
        'https://corsproxy.io/?',
        'https://api.allorigins.win/raw?url=',
        'https://api.codetabs.com/v1/proxy?quest='
      ]

      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`

      // Try each proxy until one works
      for (const proxyUrl of corsProxies) {
        try {
          const url = proxyUrl + encodeURIComponent(targetUrl)
          console.log(`Trying Yahoo Finance for ${symbol} via proxy: ${proxyUrl.substring(0, 30)}...`)

          // Add timeout to prevent hanging
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 8000)

          const response = await fetch(url, { signal: controller.signal })
          clearTimeout(timeoutId)

          if (!response.ok) {
            console.warn(`Proxy ${proxyUrl.substring(0, 25)}... failed: ${response.status}`)
            continue // Try next proxy
          }

          const data = await response.json()
          console.log(`Yahoo Finance success for ${symbol} via ${proxyUrl}`)

          const chart = data?.chart?.result?.[0]
          if (!chart) {
            console.warn('No chart data returned from Yahoo Finance')
            continue // Try next proxy
          }

          const meta = chart.meta
          const quote = chart.indicators?.quote?.[0]

          if (!meta || !quote) {
            console.warn('Invalid data structure from Yahoo Finance')
            continue // Try next proxy
          }

          // Get the latest data points
          const prices = quote.close || []
          const volumes = quote.volume || []
          const opens = quote.open || []
          const highs = quote.high || []
          const lows = quote.low || []

          const latestIndex = prices.length - 1
          if (latestIndex < 0) {
            console.warn('No price data available from Yahoo Finance')
            continue // Try next proxy
          }

          const currentPrice = prices[latestIndex]
          const previousClose = meta.previousClose || currentPrice
          const change = currentPrice - previousClose
          const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0

          const result = {
            symbol: meta.symbol || symbol.toUpperCase(),
            price: currentPrice,
            change: change,
            changePercent: changePercent,
            open: opens[latestIndex] || currentPrice,
            high: highs[latestIndex] || currentPrice,
            low: lows[latestIndex] || currentPrice,
            previousClose: previousClose,
            volume: meta.regularMarketVolume || 0,
            marketCap: meta.marketCap,
            timestamp: new Date(meta.regularMarketTime * 1000).toISOString(),
            dayHigh: meta.regularMarketDayHigh || highs[latestIndex] || currentPrice,
            dayLow: meta.regularMarketDayLow || lows[latestIndex] || currentPrice
          }

          console.log(`Successfully fetched real Yahoo data for ${symbol}: $${result.price}, volume: ${result.volume}`)
          console.log(`🔍 Yahoo Finance volume for ${symbol}: regularMarketVolume=${meta.regularMarketVolume}, volumes[latest]=${volumes[latestIndex]}`)
          return result

        } catch (proxyError: any) {
          if (proxyError.name === 'AbortError') {
            console.warn(`Proxy ${proxyUrl.substring(0, 25)}... timed out`)
          } else {
            console.warn(`Proxy ${proxyUrl.substring(0, 25)}... failed:`, proxyError.message || proxyError)
          }
          continue // Try next proxy
        }
      }

      // All proxies failed
      console.warn('All Yahoo Finance proxies failed for', symbol)
      return null
    } catch (error) {
      console.warn('Yahoo Finance request failed:', error)
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
      console.log(`Finnhub quote response for ${symbol}:`, JSON.stringify(quoteData, null, 2))

      // Finnhub returns: {c: current, h: high, l: low, o: open, pc: previous close, t: timestamp}
      if (!quoteData.c || quoteData.c === 0) {
        console.warn('No price data available from Finnhub')
        return null
      }

      let volume = 0

      // Try to get volume from candle data
      if (volumeResponse.ok) {
        const volumeData = await volumeResponse.json()
        console.log(`Finnhub volume response for ${symbol}:`, JSON.stringify(volumeData, null, 2))

        if (volumeData.v && volumeData.v.length > 0) {
          // Get the most recent volume
          volume = volumeData.v[volumeData.v.length - 1] || 0
          console.log(`Got volume from Finnhub candle data: ${volume}`)
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

      console.log(`Successfully fetched real Finnhub data for ${symbol}: $${result.price}, volume: ${result.volume}`)
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


  private createPlaceholderQuote(symbol: string): Quote {
    // Create a basic placeholder quote that won't break the UI
    return {
      symbol: symbol,
      price: 0,
      change: 0,
      changePercent: 0,
      open: 0,
      high: 0,
      low: 0,
      previousClose: 0,
      volume: 0,
      timestamp: new Date().toISOString(),
      dayHigh: 0,
      dayLow: 0
    }
  }

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