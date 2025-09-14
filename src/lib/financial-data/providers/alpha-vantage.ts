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

interface AlphaVantageQuoteResponse {
  'Global Quote': {
    '01. symbol': string
    '02. open': string
    '03. high': string
    '04. low': string
    '05. price': string
    '06. volume': string
    '07. latest trading day': string
    '08. previous close': string
    '09. change': string
    '10. change percent': string
  }
}

interface AlphaVantageTimeSeriesResponse {
  'Meta Data': {
    '1. Information': string
    '2. Symbol': string
    '3. Last Refreshed': string
    '4. Interval': string
    '5. Output Size': string
    '6. Time Zone': string
  }
  'Time Series (Daily)': Record<string, {
    '1. open': string
    '2. high': string
    '3. low': string
    '4. close': string
    '5. volume': string
  }>
}

interface AlphaVantageCompanyResponse {
  Symbol: string
  AssetType: string
  Name: string
  Description: string
  CIK: string
  Exchange: string
  Currency: string
  Country: string
  Sector: string
  Industry: string
  Address: string
  FiscalYearEnd: string
  LatestQuarter: string
  MarketCapitalization: string
  EBITDA: string
  PERatio: string
  PEGRatio: string
  BookValue: string
  DividendPerShare: string
  DividendYield: string
  EPS: string
  RevenuePerShareTTM: string
  ProfitMargin: string
  OperatingMarginTTM: string
  ReturnOnAssetsTTM: string
  ReturnOnEquityTTM: string
  RevenueTTM: string
  GrossProfitTTM: string
  DilutedEPSTTM: string
  QuarterlyEarningsGrowthYOY: string
  QuarterlyRevenueGrowthYOY: string
  AnalystTargetPrice: string
  TrailingPE: string
  ForwardPE: string
  PriceToSalesRatioTTM: string
  PriceToBookRatio: string
  EVToRevenue: string
  EVToEBITDA: string
  Beta: string
  '52WeekHigh': string
  '52WeekLow': string
  '50DayMovingAverage': string
  '200DayMovingAverage': string
  SharesOutstanding: string
  DividendDate: string
  ExDividendDate: string
}

interface AlphaVantageNewsResponse {
  feed: Array<{
    title: string
    url: string
    time_published: string
    authors: string[]
    summary: string
    banner_image: string
    source: string
    category_within_source: string
    source_domain: string
    topics: Array<{
      topic: string
      relevance_score: string
    }>
    overall_sentiment_score: number
    overall_sentiment_label: string
    ticker_sentiment: Array<{
      ticker: string
      relevance_score: string
      ticker_sentiment_score: string
      ticker_sentiment_label: string
    }>
  }>
}

interface AlphaVantageSearchResponse {
  bestMatches: Array<{
    '1. symbol': string
    '2. name': string
    '3. type': string
    '4. region': string
    '5. marketOpen': string
    '6. marketClose': string
    '7. timezone': string
    '8. currency': string
    '9. matchScore': string
  }>
}

export class AlphaVantageProvider extends BaseFinancialDataProvider {
  public readonly name = 'Alpha Vantage'
  public readonly capabilities: ProviderCapabilities = {
    quotes: true,
    historicalData: true,
    companyProfile: true,
    dividends: true,
    splits: false,
    earnings: true,
    news: true,
    search: true,
    realtime: false, // Alpha Vantage free tier has 15-20 min delay
    extendedHours: false,
    internationalMarkets: true,
    cryptoCurrency: true,
    forex: true,
    commodities: true
  }

  private readonly baseUrl: string

  constructor(config: ProviderConfig) {
    super({
      ...config,
      name: 'Alpha Vantage',
      rateLimit: {
        requestsPerMinute: 5,
        requestsPerDay: 500
      },
      ...config
    })

    if (!config.apiKey) {
      throw new Error('Alpha Vantage API key is required')
    }

    this.baseUrl = config.baseUrl || 'https://www.alphavantage.co'
  }

  public async getQuotes(request: QuoteRequest): Promise<ProviderResponse<Quote[]>> {
    this.requiresCapability('quotes', 'getQuotes')

    const quotes: Quote[] = []

    // Alpha Vantage doesn't support batch requests, so we need to make individual calls
    for (const symbol of request.symbols) {
      try {
        const normalizedSymbol = this.normalizeSymbol(symbol)
        const url = this.buildUrl('GLOBAL_QUOTE', { symbol: normalizedSymbol })

        const response = await this.makeHttpRequest<AlphaVantageQuoteResponse>(url)

        if (!response['Global Quote'] || !response['Global Quote']['01. symbol']) {
          throw new InvalidSymbolError(symbol, this.name)
        }

        const quote = this.transformQuote(response['Global Quote'])
        quotes.push(quote)
      } catch (error) {
        this.handleError(error, `getQuotes for ${symbol}`)
      }
    }

    return this.createResponse(quotes)
  }

  public async getHistoricalData(request: HistoricalDataRequest): Promise<ProviderResponse<HistoricalPrice[]>> {
    this.requiresCapability('historicalData', 'getHistoricalData')

    const normalizedSymbol = this.normalizeSymbol(request.symbol)
    const url = this.buildUrl('TIME_SERIES_DAILY', {
      symbol: normalizedSymbol,
      outputsize: 'full'
    })

    try {
      const response = await this.makeHttpRequest<AlphaVantageTimeSeriesResponse>(url)

      if (!response['Time Series (Daily)']) {
        throw new InvalidSymbolError(request.symbol, this.name)
      }

      const timeSeries = response['Time Series (Daily)']
      const historicalData: HistoricalPrice[] = []

      for (const [date, data] of Object.entries(timeSeries)) {
        historicalData.push({
          date,
          open: parseFloat(data['1. open']),
          high: parseFloat(data['2. high']),
          low: parseFloat(data['3. low']),
          close: parseFloat(data['4. close']),
          volume: parseInt(data['5. volume']),
          adjustedClose: parseFloat(data['4. close']) // Alpha Vantage doesn't provide adjusted close in daily series
        })
      }

      // Sort by date (most recent first)
      historicalData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

      // Apply date filtering if specified
      let filteredData = historicalData
      if (request.startDate || request.endDate) {
        filteredData = this.filterByDateRange(historicalData, request.startDate, request.endDate)
      }

      // Apply period filtering
      if (request.period) {
        filteredData = this.filterByPeriod(filteredData, request.period)
      }

      return this.createResponse(filteredData)
    } catch (error) {
      this.handleError(error, `getHistoricalData for ${request.symbol}`)
    }
  }

  public async getCompanyProfile(request: CompanyProfileRequest): Promise<ProviderResponse<CompanyProfile>> {
    this.requiresCapability('companyProfile', 'getCompanyProfile')

    const normalizedSymbol = this.normalizeSymbol(request.symbol)
    const url = this.buildUrl('OVERVIEW', { symbol: normalizedSymbol })

    try {
      const response = await this.makeHttpRequest<AlphaVantageCompanyResponse>(url)

      if (!response.Symbol) {
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

    const params: Record<string, string> = {
      limit: (request.limit || 10).toString()
    }

    if (request.symbols && request.symbols.length > 0) {
      params.tickers = request.symbols.join(',')
    }

    const url = this.buildUrl('NEWS_SENTIMENT', params)

    try {
      const response = await this.makeHttpRequest<AlphaVantageNewsResponse>(url)
      const news = response.feed.map(item => this.transformNewsItem(item, request.symbols))
      return this.createResponse(news)
    } catch (error) {
      this.handleError(error, 'getNews')
    }
  }

  public async search(request: SearchRequest): Promise<ProviderResponse<SearchResult[]>> {
    this.requiresCapability('search', 'search')

    const url = this.buildUrl('SYMBOL_SEARCH', { keywords: request.query })

    try {
      const response = await this.makeHttpRequest<AlphaVantageSearchResponse>(url)

      let results = response.bestMatches.map(item => this.transformSearchResult(item, request.query))

      if (request.limit) {
        results = results.slice(0, request.limit)
      }

      return this.createResponse(results)
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  private buildUrl(function_name: string, params: Record<string, string> = {}): string {
    const urlParams = new URLSearchParams({
      function: function_name,
      apikey: this.config.apiKey!,
      ...params
    })

    return `${this.baseUrl}/query?${urlParams.toString()}`
  }

  private transformQuote(data: AlphaVantageQuoteResponse['Global Quote']): Quote {
    const changePercent = parseFloat(data['10. change percent'].replace('%', ''))

    return {
      symbol: data['01. symbol'],
      price: parseFloat(data['05. price']),
      change: parseFloat(data['09. change']),
      changePercent,
      dayHigh: parseFloat(data['03. high']),
      dayLow: parseFloat(data['04. low']),
      volume: parseInt(data['06. volume']),
      previousClose: parseFloat(data['08. previous close']),
      open: parseFloat(data['02. open']),
      timestamp: new Date(data['07. latest trading day']),
      currency: 'USD' // Alpha Vantage doesn't specify currency in quote response
    }
  }

  private transformCompanyProfile(data: AlphaVantageCompanyResponse): CompanyProfile {
    return {
      symbol: data.Symbol,
      name: data.Name,
      description: data.Description,
      sector: data.Sector,
      industry: data.Industry,
      exchange: data.Exchange,
      country: data.Country,
      currency: data.Currency,
      marketCap: data.MarketCapitalization ? parseInt(data.MarketCapitalization) : undefined,
      headquarters: data.Address,
      website: undefined // Alpha Vantage doesn't provide website
    }
  }

  private transformNewsItem(item: AlphaVantageNewsResponse['feed'][0], symbols?: string[]): NewsItem {
    return {
      id: `av_${item.time_published}_${item.title.replace(/\s+/g, '_').substring(0, 20)}`,
      headline: item.title,
      summary: item.summary,
      url: item.url,
      publishedAt: new Date(item.time_published.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')),
      source: item.source,
      symbols: symbols || item.ticker_sentiment.map(ts => ts.ticker)
    }
  }

  private transformSearchResult(match: AlphaVantageSearchResponse['bestMatches'][0], query: string): SearchResult {
    const typeMap: Record<string, AssetType> = {
      'Equity': 'stock',
      'ETF': 'etf',
      'Mutual Fund': 'mutual_fund',
      'Cryptocurrency': 'crypto'
    }

    return {
      symbol: match['1. symbol'],
      name: match['2. name'],
      exchange: match['4. region'],
      assetType: typeMap[match['3. type']] || 'stock',
      currency: match['8. currency'],
      country: match['4. region'],
      matchScore: parseFloat(match['9. matchScore'])
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

  private filterByPeriod(data: HistoricalPrice[], period: TimePeriod): HistoricalPrice[] {
    const now = new Date()
    let cutoffDate: Date

    switch (period) {
      case '1d':
        cutoffDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
        break
      case '5d':
        cutoffDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
        break
      case '1mo':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case '3mo':
        cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case '6mo':
        cutoffDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
        break
      case '1y':
        cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      case '2y':
        cutoffDate = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000)
        break
      case '5y':
        cutoffDate = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000)
        break
      case '10y':
        cutoffDate = new Date(now.getTime() - 10 * 365 * 24 * 60 * 60 * 1000)
        break
      case 'max':
      default:
        return data
    }

    return data.filter(item => new Date(item.date) >= cutoffDate)
  }
}