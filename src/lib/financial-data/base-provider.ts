import {
  Quote,
  HistoricalPrice,
  CompanyProfile,
  Dividend,
  Split,
  Earnings,
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
  FinancialDataError,
  RateLimitError,
  ProviderUnavailableError
} from './types'

// Main interface that all providers must implement
export interface IFinancialDataProvider {
  readonly name: string
  readonly capabilities: ProviderCapabilities
  readonly config: ProviderConfig

  // Core data methods
  getQuotes(request: QuoteRequest): Promise<ProviderResponse<Quote[]>>
  getHistoricalData(request: HistoricalDataRequest): Promise<ProviderResponse<HistoricalPrice[]>>
  getCompanyProfile(request: CompanyProfileRequest): Promise<ProviderResponse<CompanyProfile>>

  // Optional methods (providers can choose to implement based on capabilities)
  getDividends?(symbol: string, limit?: number): Promise<ProviderResponse<Dividend[]>>
  getSplits?(symbol: string, limit?: number): Promise<ProviderResponse<Split[]>>
  getEarnings?(symbol: string, limit?: number): Promise<ProviderResponse<Earnings[]>>
  getNews?(request: NewsRequest): Promise<ProviderResponse<NewsItem[]>>
  search?(request: SearchRequest): Promise<ProviderResponse<SearchResult[]>>

  // Provider management
  isHealthy(): Promise<boolean>
  getRateLimit(): Promise<{ remaining: number; reset: Date } | null>
}

// Abstract base class with common functionality
export abstract class BaseFinancialDataProvider implements IFinancialDataProvider {
  public abstract readonly name: string
  public abstract readonly capabilities: ProviderCapabilities

  constructor(public readonly config: ProviderConfig) {}

  // Abstract methods that must be implemented
  public abstract getQuotes(request: QuoteRequest): Promise<ProviderResponse<Quote[]>>
  public abstract getHistoricalData(request: HistoricalDataRequest): Promise<ProviderResponse<HistoricalPrice[]>>
  public abstract getCompanyProfile(request: CompanyProfileRequest): Promise<ProviderResponse<CompanyProfile>>

  // Default implementation for health check
  public async isHealthy(): Promise<boolean> {
    try {
      // Try a simple quote request for a common symbol
      await this.getQuotes({ symbols: ['AAPL'] })
      return true
    } catch (error) {
      if (error instanceof RateLimitError) {
        return true // Rate limit doesn't mean unhealthy
      }
      return false
    }
  }

  // Default implementation returns null (no rate limit info)
  public async getRateLimit(): Promise<{ remaining: number; reset: Date } | null> {
    return null
  }

  // Utility methods for subclasses
  protected createResponse<T>(
    data: T,
    rateLimit?: { remaining: number; reset: Date },
    cached: boolean = false
  ): ProviderResponse<T> {
    return {
      data,
      rateLimit,
      source: this.name,
      timestamp: new Date(),
      cached
    }
  }

  protected handleError(error: any, context: string): never {
    if (error instanceof FinancialDataError) {
      throw error
    }

    // Handle common HTTP errors
    if (error.response) {
      const status = error.response.status
      const message = error.response.data?.message || error.message || 'Unknown error'

      if (status === 429) {
        const resetTime = error.response.headers['x-ratelimit-reset']
          ? new Date(parseInt(error.response.headers['x-ratelimit-reset']) * 1000)
          : undefined
        throw new RateLimitError(this.name, resetTime)
      }

      if (status === 401 || status === 403) {
        throw new FinancialDataError(
          `Authentication failed for ${this.name}`,
          'AUTHENTICATION_FAILED',
          this.name,
          error
        )
      }

      if (status === 404) {
        throw new FinancialDataError(
          `Resource not found: ${context}`,
          'NOT_FOUND',
          this.name,
          error
        )
      }

      if (status >= 500) {
        throw new ProviderUnavailableError(this.name, error)
      }
    }

    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new ProviderUnavailableError(this.name, error)
    }

    // Generic error
    throw new FinancialDataError(
      `${this.name} error in ${context}: ${error.message}`,
      'PROVIDER_ERROR',
      this.name,
      error
    )
  }

  protected async makeHttpRequest<T>(
    url: string,
    options: RequestInit = {},
    retries: number = this.config.retries || 3
  ): Promise<T> {
    const timeout = this.config.timeout || 30000

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          throw {
            response: {
              status: response.status,
              data: await response.json().catch(() => ({}))
            },
            message: `HTTP ${response.status}: ${response.statusText}`
          }
        }

        return await response.json()
      } catch (error) {
        if (attempt === retries) {
          throw error
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }

    throw new Error('Max retries exceeded')
  }

  protected normalizeSymbol(symbol: string): string {
    return symbol.toUpperCase().trim()
  }

  protected parseDate(dateString: string): Date {
    return new Date(dateString)
  }

  protected formatDateForApi(date: Date): string {
    return date.toISOString().split('T')[0]
  }

  // Helper method to check if provider supports a feature
  protected requiresCapability(capability: keyof ProviderCapabilities, method: string): void {
    if (!this.capabilities[capability]) {
      throw new FinancialDataError(
        `${this.name} does not support ${method}`,
        'CAPABILITY_NOT_SUPPORTED',
        this.name
      )
    }
  }
}

// Utility function to validate provider configuration
export function validateProviderConfig(config: ProviderConfig): void {
  if (!config.name) {
    throw new Error('Provider config must include a name')
  }

  if (config.rateLimit) {
    if (!config.rateLimit.requestsPerMinute || config.rateLimit.requestsPerMinute <= 0) {
      throw new Error('Rate limit requestsPerMinute must be a positive number')
    }
  }

  if (config.timeout && config.timeout <= 0) {
    throw new Error('Timeout must be a positive number')
  }

  if (config.retries && config.retries < 0) {
    throw new Error('Retries must be non-negative')
  }

  if (config.priority && config.priority < 0) {
    throw new Error('Priority must be non-negative')
  }
}