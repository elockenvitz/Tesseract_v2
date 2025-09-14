// Core financial data types
export interface Quote {
  symbol: string
  price: number
  change: number
  changePercent: number
  dayHigh: number
  dayLow: number
  volume: number
  marketCap?: number
  previousClose: number
  open: number
  timestamp: Date
  exchange?: string
  currency?: string
}

export interface HistoricalPrice {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  adjustedClose?: number
}

export interface CompanyProfile {
  symbol: string
  name: string
  description?: string
  sector?: string
  industry?: string
  exchange?: string
  country?: string
  currency?: string
  marketCap?: number
  employees?: number
  founded?: string
  headquarters?: string
  website?: string
  logo?: string
}

export interface Dividend {
  exDate: string
  paymentDate: string
  recordDate: string
  declaredDate: string
  amount: number
  currency?: string
}

export interface Split {
  date: string
  ratio: number // e.g., 2 for 2:1 split
  description?: string
}

export interface Earnings {
  fiscalYear: number
  fiscalQuarter: number
  reportedDate: string
  estimatedEps?: number
  actualEps?: number
  surprise?: number
  surprisePercent?: number
}

export interface NewsItem {
  id: string
  headline: string
  summary?: string
  content?: string
  url: string
  publishedAt: Date
  source: string
  symbols?: string[]
  sentiment?: 'positive' | 'negative' | 'neutral'
  relevanceScore?: number
}

// Time period types
export type TimePeriod = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'max'
export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo'

// Request/Response types
export interface QuoteRequest {
  symbols: string[]
  extended?: boolean // Include extended hours data
}

export interface HistoricalDataRequest {
  symbol: string
  period?: TimePeriod
  interval?: Interval
  startDate?: Date
  endDate?: Date
  adjustedClose?: boolean
}

export interface CompanyProfileRequest {
  symbol: string
}

export interface NewsRequest {
  symbols?: string[]
  limit?: number
  from?: Date
  to?: Date
  sources?: string[]
  language?: string
}

export interface SearchRequest {
  query: string
  limit?: number
  exchanges?: string[]
  assetTypes?: AssetType[]
}

export interface SearchResult {
  symbol: string
  name: string
  exchange?: string
  assetType: AssetType
  currency?: string
  country?: string
  matchScore?: number
}

export type AssetType = 'stock' | 'etf' | 'mutual_fund' | 'crypto' | 'forex' | 'commodity' | 'index'

// Provider response types
export interface ProviderResponse<T> {
  data: T
  rateLimit?: RateLimitInfo
  source: string
  timestamp: Date
  cached?: boolean
}

export interface RateLimitInfo {
  remaining: number
  reset: Date
  limit: number
}

// Error types
export class FinancialDataError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider: string,
    public originalError?: any
  ) {
    super(message)
    this.name = 'FinancialDataError'
  }
}

export class RateLimitError extends FinancialDataError {
  constructor(provider: string, resetTime?: Date) {
    super(
      `Rate limit exceeded for ${provider}${resetTime ? `. Resets at ${resetTime}` : ''}`,
      'RATE_LIMIT_EXCEEDED',
      provider
    )
    this.name = 'RateLimitError'
  }
}

export class InvalidSymbolError extends FinancialDataError {
  constructor(symbol: string, provider: string) {
    super(`Invalid symbol: ${symbol}`, 'INVALID_SYMBOL', provider)
    this.name = 'InvalidSymbolError'
  }
}

export class ProviderUnavailableError extends FinancialDataError {
  constructor(provider: string, originalError?: any) {
    super(`Provider ${provider} is unavailable`, 'PROVIDER_UNAVAILABLE', provider, originalError)
    this.name = 'ProviderUnavailableError'
  }
}

// Provider configuration
export interface ProviderConfig {
  name: string
  apiKey?: string
  baseUrl?: string
  rateLimit?: {
    requestsPerMinute: number
    requestsPerDay?: number
  }
  timeout?: number
  retries?: number
  priority?: number // Lower numbers = higher priority for fallback
}

export interface ProviderCapabilities {
  quotes: boolean
  historicalData: boolean
  companyProfile: boolean
  dividends: boolean
  splits: boolean
  earnings: boolean
  news: boolean
  search: boolean
  realtime: boolean
  extendedHours: boolean
  internationalMarkets: boolean
  cryptoCurrency: boolean
  forex: boolean
  commodities: boolean
}