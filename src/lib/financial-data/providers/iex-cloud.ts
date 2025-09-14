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

interface IEXQuoteResponse {
  symbol: string
  companyName: string
  primaryExchange: string
  calculationPrice: string
  open: number
  openTime: number
  openSource: string
  close: number
  closeTime: number
  closeSource: string
  high: number
  highTime: number
  highSource: string
  low: number
  lowTime: number
  lowSource: string
  latestPrice: number
  latestSource: string
  latestTime: string
  latestUpdate: number
  latestVolume: number
  iexRealtimePrice: number
  iexRealtimeSize: number
  iexLastUpdated: number
  delayedPrice: number
  delayedPriceTime: number
  oddLotDelayedPrice: number
  oddLotDelayedPriceTime: number
  extendedPrice: number
  extendedChange: number
  extendedChangePercent: number
  extendedPriceTime: number
  previousClose: number
  previousVolume: number
  change: number
  changePercent: number
  volume: number
  iexMarketPercent: number
  iexVolume: number
  avgTotalVolume: number
  iexBidPrice: number
  iexBidSize: number
  iexAskPrice: number
  iexAskSize: number
  iexOpen: number
  iexOpenTime: number
  iexClose: number
  iexCloseTime: number
  marketCap: number
  peRatio: number
  week52High: number
  week52Low: number
  ytdChange: number
  lastTradeTime: number
  currency: string
  isUSMarketOpen: boolean
}

interface IEXHistoricalResponse {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  uOpen: number
  uHigh: number
  uLow: number
  uClose: number
  uVolume: number
  change: number
  changePercent: number
  label: string
  changeOverTime: number
}

interface IEXCompanyResponse {
  symbol: string
  companyName: string
  exchange: string
  industry: string
  website: string
  description: string
  CEO: string
  securityName: string
  issueType: string
  sector: string
  primarySicCode: number
  employees: number
  tags: string[]
  address: string
  address2: string
  state: string
  city: string
  zip: string
  country: string
  phone: string
}

interface IEXNewsResponse {
  datetime: number
  headline: string
  source: string
  url: string
  summary: string
  related: string
  image: string
  lang: string
  hasPaywall: boolean
}

interface IEXSearchResponse {
  symbol: string
  securityName: string
  securityType: string
  region: string
  exchange: string
  currency: string
}

export class IEXCloudProvider extends BaseFinancialDataProvider {
  public readonly name = 'IEX Cloud'
  public readonly capabilities: ProviderCapabilities = {
    quotes: true,
    historicalData: true,
    companyProfile: true,
    dividends: true,
    splits: true,
    earnings: true,
    news: true,
    search: true,
    realtime: true,
    extendedHours: true,
    internationalMarkets: false,
    cryptoCurrency: true,
    forex: false,
    commodities: false
  }

  private readonly baseUrl: string
  private readonly version: string

  constructor(config: ProviderConfig) {
    super({
      ...config,
      name: 'IEX Cloud',
      rateLimit: {
        requestsPerMinute: 100,
        requestsPerDay: 50000
      },
      ...config
    })

    if (!config.apiKey) {
      throw new Error('IEX Cloud API key is required')
    }

    // IEX Cloud supports both sandbox and production environments
    this.baseUrl = config.baseUrl || 'https://cloud.iexapis.com'
    this.version = 'v1'
  }

  public async getQuotes(request: QuoteRequest): Promise<ProviderResponse<Quote[]>> {
    this.requiresCapability('quotes', 'getQuotes')

    const symbols = request.symbols.map(s => this.normalizeSymbol(s))

    if (symbols.length === 1) {
      // Single symbol request
      const url = this.buildUrl(`stock/${symbols[0]}/quote`)

      try {
        const response = await this.makeHttpRequest<IEXQuoteResponse>(url)
        const quote = this.transformQuote(response)
        return this.createResponse([quote])
      } catch (error) {
        this.handleError(error, `getQuotes for ${symbols[0]}`)
      }
    } else {
      // Batch request for multiple symbols
      const symbolsParam = symbols.join(',')
      const url = this.buildUrl(`stock/market/batch?symbols=${symbolsParam}&types=quote`)

      try {
        const response = await this.makeHttpRequest<Record<string, { quote: IEXQuoteResponse }>>(url)

        const quotes: Quote[] = []
        for (const [symbol, data] of Object.entries(response)) {
          if (data.quote) {
            quotes.push(this.transformQuote(data.quote))
          }
        }

        return this.createResponse(quotes)
      } catch (error) {
        this.handleError(error, `getQuotes for ${symbols.join(', ')}`)
      }
    }
  }

  public async getHistoricalData(request: HistoricalDataRequest): Promise<ProviderResponse<HistoricalPrice[]>> {
    this.requiresCapability('historicalData', 'getHistoricalData')

    const normalizedSymbol = this.normalizeSymbol(request.symbol)
    const range = this.convertTimePeriodToIEXRange(request.period || '1y')

    const url = this.buildUrl(`stock/${normalizedSymbol}/chart/${range}`)

    try {
      const response = await this.makeHttpRequest<IEXHistoricalResponse[]>(url)

      if (!response || response.length === 0) {
        throw new InvalidSymbolError(request.symbol, this.name)
      }

      const historicalData = response.map(item => this.transformHistoricalData(item))

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
    const url = this.buildUrl(`stock/${normalizedSymbol}/company`)

    try {
      const response = await this.makeHttpRequest<IEXCompanyResponse>(url)

      if (!response.symbol) {
        throw new InvalidSymbolError(request.symbol, this.name)
      }

      const profile = this.transformCompanyProfile(response)
      return this.createResponse(profile)
    } catch (error) {
      this.handleError(error, `getCompanyProfile for ${request.symbol}`)
    }
  }

  public async getNews(request: NewsRequest): Promise<ProviderResponse<NewsItem[]>> {
    this.requiresCapability('news', 'getNews')

    let url: string

    if (request.symbols && request.symbols.length > 0) {
      // Get news for specific symbols
      const symbol = this.normalizeSymbol(request.symbols[0]) // IEX supports one symbol at a time for news
      const limit = Math.min(request.limit || 10, 50) // IEX max is 50
      url = this.buildUrl(`stock/${symbol}/news/last/${limit}`)
    } else {
      // Get market news
      const limit = Math.min(request.limit || 10, 50)
      url = this.buildUrl(`stock/market/news/last/${limit}`)
    }

    try {
      const response = await this.makeHttpRequest<IEXNewsResponse[]>(url)
      const news = response.map(item => this.transformNewsItem(item, request.symbols))
      return this.createResponse(news)
    } catch (error) {
      this.handleError(error, 'getNews')
    }
  }

  public async search(request: SearchRequest): Promise<ProviderResponse<SearchResult[]>> {
    this.requiresCapability('search', 'search')

    // IEX Cloud doesn't have a dedicated search endpoint, so we'll use the symbols endpoint
    // and filter based on the query
    const url = this.buildUrl('ref-data/symbols')

    try {
      const response = await this.makeHttpRequest<IEXSearchResponse[]>(url)

      const query = request.query.toLowerCase()
      let results = response.filter(item =>
        item.symbol.toLowerCase().includes(query) ||
        item.securityName.toLowerCase().includes(query)
      )

      // Sort by relevance (exact matches first, then contains)
      results.sort((a, b) => {
        const aExact = a.symbol.toLowerCase() === query ? 0 : 1
        const bExact = b.symbol.toLowerCase() === query ? 0 : 1
        return aExact - bExact
      })

      if (request.limit) {
        results = results.slice(0, request.limit)
      }

      const searchResults = results.map(item => this.transformSearchResult(item, query))
      return this.createResponse(searchResults)
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  public async getRateLimit(): Promise<{ remaining: number; reset: Date } | null> {
    // IEX Cloud includes rate limit info in headers
    // This would need to be tracked from the last request
    return null // Simplified for this example
  }

  private buildUrl(endpoint: string): string {
    const params = new URLSearchParams({
      token: this.config.apiKey!
    })

    return `${this.baseUrl}/${this.version}/${endpoint}?${params.toString()}`
  }

  private transformQuote(data: IEXQuoteResponse): Quote {
    return {
      symbol: data.symbol,
      price: data.latestPrice || data.close,
      change: data.change,
      changePercent: data.changePercent * 100, // IEX returns decimal, we want percentage
      dayHigh: data.high,
      dayLow: data.low,
      volume: data.latestVolume || data.volume,
      marketCap: data.marketCap,
      previousClose: data.previousClose,
      open: data.open || data.iexOpen,
      timestamp: new Date(data.latestUpdate || data.lastTradeTime),
      exchange: data.primaryExchange,
      currency: data.currency || 'USD'
    }
  }

  private transformHistoricalData(data: IEXHistoricalResponse): HistoricalPrice {
    return {
      date: data.date,
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
      adjustedClose: data.uClose // uAdjusted close from IEX
    }
  }

  private transformCompanyProfile(data: IEXCompanyResponse): CompanyProfile {
    const address = [data.address, data.address2, data.city, data.state, data.zip, data.country]
      .filter(Boolean)
      .join(', ')

    return {
      symbol: data.symbol,
      name: data.companyName,
      description: data.description,
      sector: data.sector,
      industry: data.industry,
      exchange: data.exchange,
      country: data.country,
      employees: data.employees,
      headquarters: address,
      website: data.website
    }
  }

  private transformNewsItem(item: IEXNewsResponse, symbols?: string[]): NewsItem {
    return {
      id: `iex_${item.datetime}_${item.headline.replace(/\s+/g, '_').substring(0, 20)}`,
      headline: item.headline,
      summary: item.summary,
      url: item.url,
      publishedAt: new Date(item.datetime),
      source: item.source,
      symbols: symbols || (item.related ? item.related.split(',') : [])
    }
  }

  private transformSearchResult(match: IEXSearchResponse, query: string): SearchResult {
    const typeMap: Record<string, AssetType> = {
      'cs': 'stock', // Common stock
      'et': 'etf',   // ETF
      'ps': 'stock', // Preferred stock
      'bo': 'stock', // Bond
      'su': 'stock', // Structured product
      'wa': 'stock', // Warrant
      'rt': 'stock'  // Right
    }

    // Calculate a simple match score
    const symbolMatch = match.symbol.toLowerCase() === query.toLowerCase() ? 1.0 :
                       match.symbol.toLowerCase().includes(query.toLowerCase()) ? 0.8 : 0.0
    const nameMatch = match.securityName.toLowerCase().includes(query.toLowerCase()) ? 0.6 : 0.0
    const matchScore = Math.max(symbolMatch, nameMatch)

    return {
      symbol: match.symbol,
      name: match.securityName,
      exchange: match.exchange,
      assetType: typeMap[match.securityType] || 'stock',
      currency: match.currency,
      country: match.region,
      matchScore
    }
  }

  private convertTimePeriodToIEXRange(period: TimePeriod): string {
    const periodMap: Record<TimePeriod, string> = {
      '1d': '1d',
      '5d': '5d',
      '1mo': '1m',
      '3mo': '3m',
      '6mo': '6m',
      '1y': '1y',
      '2y': '2y',
      '5y': '5y',
      '10y': 'max', // IEX doesn't have 10y, use max
      'max': 'max'
    }

    return periodMap[period] || '1y'
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