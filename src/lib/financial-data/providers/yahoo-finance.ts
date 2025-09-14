import {
  Quote,
  HistoricalPrice,
  CompanyProfile,
  NewsItem,
  SearchResult,
  QuoteRequest,
  HistoricalDataRequest,
  CompanyProfileRequest,
  NewsRequest,
  SearchRequest,
  ProviderResponse,
  ProviderConfig,
  ProviderCapabilities,
  InvalidSymbolError,
  AssetType,
  TimePeriod
} from '../types'
import { BaseFinancialDataProvider } from '../base-provider'

interface YahooQuoteResponse {
  quoteResponse: {
    result: Array<{
      symbol: string
      longName?: string
      regularMarketPrice: number
      regularMarketChange: number
      regularMarketChangePercent: number
      regularMarketDayHigh: number
      regularMarketDayLow: number
      regularMarketVolume: number
      regularMarketPreviousClose: number
      regularMarketOpen: number
      regularMarketTime: number
      marketCap?: number
      currency: string
      exchangeName: string
      fiftyTwoWeekHigh?: number
      fiftyTwoWeekLow?: number
      trailingPE?: number
      forwardPE?: number
      dividendYield?: number
      beta?: number
    }>
    error: null | any
  }
}

interface YahooHistoricalResponse {
  chart: {
    result: Array<{
      meta: {
        currency: string
        symbol: string
        exchangeName: string
        instrumentType: string
        firstTradeDate: number
        regularMarketTime: number
        gmtoffset: number
        timezone: string
        exchangeTimezoneName: string
        regularMarketPrice: number
        chartPreviousClose: number
        previousClose: number
        scale: number
        priceHint: number
        currentTradingPeriod: any
        tradingPeriods: any
        dataGranularity: string
        range: string
        validRanges: string[]
      }
      timestamp: number[]
      indicators: {
        quote: Array<{
          open: number[]
          high: number[]
          low: number[]
          close: number[]
          volume: number[]
        }>
        adjclose?: Array<{
          adjclose: number[]
        }>
      }
    }>
    error: null | any
  }
}

interface YahooSearchResponse {
  quotes: Array<{
    symbol: string
    shortname?: string
    longname?: string
    exchDisp: string
    typeDisp: string
    exchange: string
    sector?: string
    industry?: string
    quoteType: string
  }>
}

interface YahooNewsResponse {
  items: {
    result: Array<{
      uuid: string
      title: string
      publisher: string
      link: string
      providerPublishTime: number
      type: string
      thumbnail?: {
        resolutions: Array<{
          url: string
          width: number
          height: number
        }>
      }
      relatedTickers?: string[]
    }>
  }
}

export class YahooFinanceProvider extends BaseFinancialDataProvider {
  public readonly name = 'Yahoo Finance'
  public readonly capabilities: ProviderCapabilities = {
    quotes: true,
    historicalData: true,
    companyProfile: true,
    dividends: false,
    splits: false,
    earnings: false,
    news: true,
    search: true,
    realtime: true,
    extendedHours: true,
    internationalMarkets: true,
    cryptoCurrency: true,
    forex: true,
    commodities: true
  }

  private readonly baseUrl: string

  constructor(config: ProviderConfig) {
    super({
      ...config,
      name: 'Yahoo Finance',
      rateLimit: undefined, // No official rate limits
      ...config
    })

    // Yahoo Finance doesn't require API key
    this.baseUrl = config.baseUrl || 'https://query1.finance.yahoo.com'
  }

  public async getQuotes(request: QuoteRequest): Promise<ProviderResponse<Quote[]>> {
    this.requiresCapability('quotes', 'getQuotes')

    const symbols = request.symbols.map(s => this.normalizeSymbol(s))
    const symbolsParam = symbols.join(',')

    const url = `${this.baseUrl}/v7/finance/quote?symbols=${symbolsParam}`

    try {
      const response = await this.makeHttpRequest<YahooQuoteResponse>(url)

      if (!response.quoteResponse.result || response.quoteResponse.result.length === 0) {
        throw new InvalidSymbolError(symbols.join(', '), this.name)
      }

      const quotes = response.quoteResponse.result.map(item => this.transformQuote(item))
      return this.createResponse(quotes)
    } catch (error) {
      this.handleError(error, `getQuotes for ${symbols.join(', ')}`)
    }
  }

  public async getHistoricalData(request: HistoricalDataRequest): Promise<ProviderResponse<HistoricalPrice[]>> {
    this.requiresCapability('historicalData', 'getHistoricalData')

    const normalizedSymbol = this.normalizeSymbol(request.symbol)
    const period1 = this.getPeriodTimestamp(request.period || '1y')
    const period2 = Math.floor(Date.now() / 1000)

    const url = `${this.baseUrl}/v8/finance/chart/${normalizedSymbol}?period1=${period1}&period2=${period2}&interval=1d`

    try {
      const response = await this.makeHttpRequest<YahooHistoricalResponse>(url)

      if (!response.chart.result || response.chart.result.length === 0) {
        throw new InvalidSymbolError(request.symbol, this.name)
      }

      const result = response.chart.result[0]
      const timestamps = result.timestamp
      const quote = result.indicators.quote[0]
      const adjClose = result.indicators.adjclose?.[0]

      const historicalData: HistoricalPrice[] = []

      for (let i = 0; i < timestamps.length; i++) {
        if (quote.close[i] !== null && quote.close[i] !== undefined) {
          historicalData.push({
            date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
            open: quote.open[i] || 0,
            high: quote.high[i] || 0,
            low: quote.low[i] || 0,
            close: quote.close[i],
            volume: quote.volume[i] || 0,
            adjustedClose: adjClose?.adjclose[i] || quote.close[i]
          })
        }
      }

      // Apply date filtering if specified
      let filteredData = historicalData
      if (request.startDate || request.endDate) {
        filteredData = this.filterByDateRange(historicalData, request.startDate, request.endDate)
      }

      return this.createResponse(filteredData)
    } catch (error) {
      this.handleError(error, `getHistoricalData for ${request.symbol}`)
    }
  }

  public async getCompanyProfile(request: CompanyProfileRequest): Promise<ProviderResponse<CompanyProfile>> {
    this.requiresCapability('companyProfile', 'getCompanyProfile')

    const normalizedSymbol = this.normalizeSymbol(request.symbol)
    const url = `${this.baseUrl}/v7/finance/quote?symbols=${normalizedSymbol}`

    try {
      const response = await this.makeHttpRequest<YahooQuoteResponse>(url)

      if (!response.quoteResponse.result || response.quoteResponse.result.length === 0) {
        throw new InvalidSymbolError(request.symbol, this.name)
      }

      const data = response.quoteResponse.result[0]
      const profile = this.transformCompanyProfile(data)
      return this.createResponse(profile)
    } catch (error) {
      this.handleError(error, `getCompanyProfile for ${request.symbol}`)
    }
  }

  public async getNews(request: NewsRequest): Promise<ProviderResponse<NewsItem[]>> {
    this.requiresCapability('news', 'getNews')

    let url: string
    if (request.symbols && request.symbols.length > 0) {
      const symbol = this.normalizeSymbol(request.symbols[0])
      url = `${this.baseUrl}/v1/finance/search?q=${symbol}&newsCount=${request.limit || 10}`
    } else {
      url = `${this.baseUrl}/v1/finance/search?q=market&newsCount=${request.limit || 10}`
    }

    try {
      const response = await this.makeHttpRequest<YahooNewsResponse>(url)
      const news = response.items.result.map(item => this.transformNewsItem(item, request.symbols))
      return this.createResponse(news)
    } catch (error) {
      this.handleError(error, 'getNews')
    }
  }

  public async search(request: SearchRequest): Promise<ProviderResponse<SearchResult[]>> {
    this.requiresCapability('search', 'search')

    const url = `${this.baseUrl}/v1/finance/search?q=${encodeURIComponent(request.query)}`

    try {
      const response = await this.makeHttpRequest<YahooSearchResponse>(url)

      let results = response.quotes.map(item => this.transformSearchResult(item, request.query))

      // Sort by relevance (exact matches first)
      results.sort((a, b) => {
        const aExact = a.symbol.toLowerCase() === request.query.toLowerCase() ? 0 : 1
        const bExact = b.symbol.toLowerCase() === request.query.toLowerCase() ? 0 : 1
        return aExact - bExact
      })

      if (request.limit) {
        results = results.slice(0, request.limit)
      }

      return this.createResponse(results)
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  private transformQuote(data: YahooQuoteResponse['quoteResponse']['result'][0]): Quote {
    return {
      symbol: data.symbol,
      price: data.regularMarketPrice,
      change: data.regularMarketChange,
      changePercent: data.regularMarketChangePercent,
      dayHigh: data.regularMarketDayHigh,
      dayLow: data.regularMarketDayLow,
      volume: data.regularMarketVolume,
      marketCap: data.marketCap,
      previousClose: data.regularMarketPreviousClose,
      open: data.regularMarketOpen,
      timestamp: new Date(data.regularMarketTime * 1000),
      exchange: data.exchangeName,
      currency: data.currency
    }
  }

  private transformCompanyProfile(data: YahooQuoteResponse['quoteResponse']['result'][0]): CompanyProfile {
    return {
      symbol: data.symbol,
      name: data.longName || data.symbol,
      description: undefined, // Yahoo Finance quote doesn't include description
      sector: undefined,
      industry: undefined,
      exchange: data.exchangeName,
      currency: data.currency,
      marketCap: data.marketCap,
      website: undefined
    }
  }

  private transformNewsItem(item: YahooNewsResponse['items']['result'][0], symbols?: string[]): NewsItem {
    return {
      id: item.uuid,
      headline: item.title,
      summary: undefined, // Yahoo Finance doesn't provide summary in search results
      url: item.link,
      publishedAt: new Date(item.providerPublishTime * 1000),
      source: item.publisher,
      symbols: symbols || item.relatedTickers || []
    }
  }

  private transformSearchResult(match: YahooSearchResponse['quotes'][0], query: string): SearchResult {
    const typeMap: Record<string, AssetType> = {
      'EQUITY': 'stock',
      'ETF': 'etf',
      'MUTUALFUND': 'mutual_fund',
      'CRYPTOCURRENCY': 'crypto',
      'CURRENCY': 'forex',
      'INDEX': 'index'
    }

    // Calculate match score
    const symbolMatch = match.symbol.toLowerCase() === query.toLowerCase() ? 1.0 :
                       match.symbol.toLowerCase().includes(query.toLowerCase()) ? 0.8 : 0.0
    const nameMatch = (match.longname || match.shortname || '').toLowerCase().includes(query.toLowerCase()) ? 0.6 : 0.0
    const matchScore = Math.max(symbolMatch, nameMatch)

    return {
      symbol: match.symbol,
      name: match.longname || match.shortname || match.symbol,
      exchange: match.exchDisp,
      assetType: typeMap[match.quoteType] || 'stock',
      currency: undefined, // Not provided in search
      country: undefined, // Not provided in search
      matchScore
    }
  }

  private getPeriodTimestamp(period: TimePeriod): number {
    const now = Math.floor(Date.now() / 1000)
    const dayInSeconds = 24 * 60 * 60

    switch (period) {
      case '1d':
        return now - (1 * dayInSeconds)
      case '5d':
        return now - (5 * dayInSeconds)
      case '1mo':
        return now - (30 * dayInSeconds)
      case '3mo':
        return now - (90 * dayInSeconds)
      case '6mo':
        return now - (180 * dayInSeconds)
      case '1y':
        return now - (365 * dayInSeconds)
      case '2y':
        return now - (2 * 365 * dayInSeconds)
      case '5y':
        return now - (5 * 365 * dayInSeconds)
      case '10y':
        return now - (10 * 365 * dayInSeconds)
      case 'max':
      default:
        return 0 // Start from beginning of time
    }
  }

  private filterByDateRange(
    data: HistoricalPrice[],
    startDate?: Date,
    endDate?: Date
  ): HistoricalPrice[] {
    return data.filter(item => {
      const date = new Date(item.date)
      if (startDate && date < startDate) return false
      if (endDate && date > endDate) return false
      return true
    })
  }
}