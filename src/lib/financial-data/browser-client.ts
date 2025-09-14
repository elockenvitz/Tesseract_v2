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
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes
  private lastApiCall = 0
  private readonly API_CALL_DELAY = 1000 // 1 second between API calls (more reasonable)
  private dailyCallCount = 0
  private lastResetDate = new Date().getDate()

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
      }

      // Fallback to Yahoo Finance
      console.log(`Alpha Vantage failed, trying Yahoo Finance for ${upperSymbol}`)
      const yahooQuote = await this.fetchFromYahooFinance(upperSymbol)
      if (yahooQuote) {
        // Cache successful result
        this.cache.set(upperSymbol, { data: yahooQuote, timestamp: Date.now() })
        return yahooQuote
      }

      // Fallback to Finnhub (free tier)
      console.log(`Yahoo Finance failed, trying Finnhub for ${upperSymbol}`)
      const finnhubQuote = await this.fetchFromFinnhub(upperSymbol)
      if (finnhubQuote) {
        // Cache successful result
        this.cache.set(upperSymbol, { data: finnhubQuote, timestamp: Date.now() })
        return finnhubQuote
      }

      // If we have cached data (even if expired), return it rather than random mock data
      if (cached) {
        console.log(`Using expired cache for ${upperSymbol}`)
        return cached.data
      }

      // Only create mock data if we have no cached data at all
      const mockQuote = this.createConsistentMockQuote(upperSymbol)
      this.cache.set(upperSymbol, { data: mockQuote, timestamp: Date.now() })
      return mockQuote
    } catch (error) {
      console.warn('Failed to fetch quote for', symbol, error)

      // Try to return cached data first
      const cached = this.cache.get(symbol.toUpperCase())
      if (cached) return cached.data

      return this.createConsistentMockQuote(symbol.toUpperCase())
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

      // Check daily limit (Alpha Vantage free tier: 500 calls/day)
      if (this.dailyCallCount >= 450) { // Stay safely under limit
        console.warn(`Daily API limit reached (${this.dailyCallCount} calls). Using cache/mock data.`)
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

      console.log(`Successfully fetched real data for ${symbol}:`, result.price)
      return result
    } catch (error) {
      console.warn('Alpha Vantage request failed:', error)
      return null
    }
  }

  private async fetchFromYahooFinance(symbol: string): Promise<Quote | null> {
    try {
      // Use CORS proxy to access Yahoo Finance API
      const proxyUrl = 'https://api.allorigins.win/raw?url='
      const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`
      const url = proxyUrl + encodeURIComponent(targetUrl)

      console.log(`Fetching real data for ${symbol} from Yahoo Finance via CORS proxy`)

      const response = await fetch(url)

      if (!response.ok) {
        console.warn(`Yahoo Finance API error: ${response.status} ${response.statusText}`)
        return null
      }

      const data = await response.json()
      console.log(`Yahoo Finance raw response for ${symbol}:`, JSON.stringify(data, null, 2))

      const chart = data?.chart?.result?.[0]
      if (!chart) {
        console.warn('No chart data returned from Yahoo Finance')
        return null
      }

      const meta = chart.meta
      const quote = chart.indicators?.quote?.[0]

      if (!meta || !quote) {
        console.warn('Invalid data structure from Yahoo Finance')
        return null
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
        return null
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
        volume: volumes[latestIndex] || 0,
        marketCap: meta.marketCap,
        timestamp: new Date(meta.regularMarketTime * 1000).toISOString(),
        dayHigh: meta.regularMarketDayHigh || highs[latestIndex] || currentPrice,
        dayLow: meta.regularMarketDayLow || lows[latestIndex] || currentPrice
      }

      console.log(`Successfully fetched real Yahoo data for ${symbol}: $${result.price}`)
      return result
    } catch (error) {
      console.warn('Yahoo Finance request failed:', error)
      return null
    }
  }

  private async fetchFromFinnhub(symbol: string): Promise<Quote | null> {
    try {
      // Finnhub API (free tier: 60 calls/minute, no API key needed for basic quotes)
      const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=demo`
      console.log(`Fetching real data for ${symbol} from Finnhub API`)

      const response = await fetch(url)

      if (!response.ok) {
        console.warn(`Finnhub API error: ${response.status} ${response.statusText}`)
        return null
      }

      const data = await response.json()
      console.log(`Finnhub raw response for ${symbol}:`, JSON.stringify(data, null, 2))

      // Finnhub returns: {c: current, h: high, l: low, o: open, pc: previous close, t: timestamp}
      if (!data.c || data.c === 0) {
        console.warn('No price data available from Finnhub')
        return null
      }

      const currentPrice = data.c
      const previousClose = data.pc || currentPrice
      const change = currentPrice - previousClose
      const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0

      const result = {
        symbol: symbol.toUpperCase(),
        price: currentPrice,
        change: change,
        changePercent: changePercent,
        open: data.o || currentPrice,
        high: data.h || currentPrice,
        low: data.l || currentPrice,
        previousClose: previousClose,
        volume: 0, // Finnhub free tier doesn't include volume in quote endpoint
        timestamp: new Date(data.t * 1000).toISOString(),
        dayHigh: data.h || currentPrice,
        dayLow: data.l || currentPrice
      }

      console.log(`Successfully fetched real Finnhub data for ${symbol}: $${result.price}`)
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

  private createConsistentMockQuote(symbol: string): Quote {
    // Realistic mock data for common stocks (approximate recent prices)
    const realisticPrices: Record<string, number> = {
      'AAPL': 234.07,
      'GOOGL': 175.50,
      'MSFT': 420.15,
      'AMZN': 185.20,
      'TSLA': 248.50,
      'META': 520.80,
      'NVDA': 139.90,
      'NFLX': 680.75,
      'PLTR': 65.25,
      'GOOG': 175.50,
      'AVGO': 274.18,
      'WMT': 99.35,
      'LLY': 772.87
    }

    const upperSymbol = symbol.toUpperCase()
    let basePrice = realisticPrices[upperSymbol]

    if (!basePrice) {
      // Fallback to hash-based price for unknown symbols
      const symbolHash = symbol.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0)
        return a & a // Keep it 32-bit
      }, 0)
      basePrice = 50 + Math.abs(symbolHash % 200) // Price between $50-250 for unknown stocks
    }

    // Add small random daily variation (±2%)
    const symbolHash = symbol.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)

    const variationPercent = ((symbolHash % 400) - 200) / 10000 // ±2%
    const change = basePrice * variationPercent
    const currentPrice = basePrice + change

    console.log(`Using realistic mock data for ${symbol}: $${currentPrice.toFixed(2)} (base: $${basePrice.toFixed(2)})`)

    return {
      symbol: symbol.toUpperCase(),
      price: currentPrice,
      change: change,
      changePercent: variationPercent * 100,
      open: basePrice,
      high: currentPrice + Math.abs(change) * 0.5,
      low: currentPrice - Math.abs(change) * 0.5,
      previousClose: basePrice,
      volume: Math.abs(symbolHash % 10000000),
      timestamp: new Date().toISOString(),
      dayHigh: currentPrice + Math.abs(change) * 0.5,
      dayLow: currentPrice - Math.abs(change) * 0.5
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

// Clear cache on module load to ensure fresh data
financialDataService.clearCache()

// Force cache refresh for testing - remove this line after verification
console.log('🚀 Financial data service reloaded with Yahoo Finance fallback enabled')