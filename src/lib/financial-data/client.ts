/**
 * Frontend client configuration for the Financial Data API
 * This adapts the server-side abstraction for browser usage
 */
import {
  createFinancialDataClient,
  type FinancialDataConfig,
  type Quote,
  type HistoricalPrice,
  type CompanyProfile,
  type NewsItem,
  type SearchResult,
  type QuoteRequest,
  type HistoricalDataRequest,
  type CompanyProfileRequest,
  type NewsRequest,
  type SearchRequest
} from './index'

// Frontend configuration that reads from Vite environment variables
function createFrontendConfig(): Partial<FinancialDataConfig> {
  const config: Partial<FinancialDataConfig> = {
    primaryProvider: (import.meta.env.VITE_FINANCIAL_DATA_PRIMARY_PROVIDER as any) || 'alphavantage',
    providers: {},
    manager: {
      enableFallback: import.meta.env.VITE_FINANCIAL_DATA_ENABLE_FALLBACK !== 'false',
      enableCaching: import.meta.env.VITE_FINANCIAL_DATA_ENABLE_CACHING !== 'false',
      cacheTtlSeconds: import.meta.env.VITE_FINANCIAL_DATA_CACHE_TTL
        ? parseInt(import.meta.env.VITE_FINANCIAL_DATA_CACHE_TTL)
        : 300,
      maxRetries: 3
    }
  }

  /*
    Alpha Vantage is deliberately not configured from the browser.

    This block read an Alpha Vantage credential from the build environment.
    Vite inlines such a variable into the bundle as a string literal — the same
    mistake that put a working key in the deployed JavaScript through
    browser-client.ts. It did no harm only because
    this module currently has no importers at all, so it is tree-shaken out
    before the bundle is written. "Unreachable" is not a security control: the
    first import of this file would have shipped the key.

    A provider credential belongs in an edge function, read through
    `Deno.env.get`. supabase/functions/market-news already does exactly that.
  */

  // Always configure Yahoo Finance as fallback (no API key needed)
  config.providers!.yahoo = {
    userAgent: 'Tesseract-Financial-App/1.0'
  }

  return config
}

// Create the singleton client instance
let financialDataClient: ReturnType<typeof createFinancialDataClient> | null = null

export function getFinancialDataClient() {
  if (!financialDataClient) {
    const config = createFrontendConfig()

    // Import these directly to avoid server-side config issues
    import('./provider-manager').then(({ ProviderManager }) => {
      import('./providers/alpha-vantage').then(({ AlphaVantageProvider }) => {
        import('./providers/yahoo-finance').then(({ YahooFinanceProvider }) => {
          // Create providers directly
          const providers = []

          // Add Alpha Vantage if API key exists
          if (config.providers?.alphavantage?.apiKey) {
            const alphaVantageProvider = new AlphaVantageProvider({
              name: 'Alpha Vantage',
              apiKey: config.providers.alphavantage.apiKey,
              priority: config.primaryProvider === 'alphavantage' ? 0 : 1
            })
            providers.push(alphaVantageProvider)
          }

          // Always add Yahoo Finance as fallback
          const yahooProvider = new YahooFinanceProvider({
            name: 'Yahoo Finance',
            priority: config.primaryProvider === 'yahoo' ? 0 : 2
          })
          providers.push(yahooProvider)

          // Create manager
          const manager = new ProviderManager({
            primaryProvider: config.primaryProvider === 'alphavantage' ? 'Alpha Vantage' : 'Yahoo Finance',
            fallbackProviders: ['Yahoo Finance'],
            ...config.manager
          })

          // Register providers
          providers.forEach(provider => manager.registerProvider(provider))

          financialDataClient = manager
        })
      })
    })
  }
  return financialDataClient
}

// Export types and interfaces for frontend use
export type {
  Quote,
  HistoricalPrice,
  CompanyProfile,
  NewsItem,
  SearchResult,
  QuoteRequest,
  HistoricalDataRequest,
  CompanyProfileRequest,
  NewsRequest,
  SearchRequest
}

// Convenience functions for common operations
export class FinancialDataService {
  private client = getFinancialDataClient()

  async getQuote(symbol: string): Promise<Quote | null> {
    try {
      const response = await this.client.getQuotes({ symbols: [symbol] })
      return response.data[0] || null
    } catch (error) {
      console.error('Failed to get quote:', error)
      return null
    }
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    try {
      const response = await this.client.getQuotes({ symbols })
      return response.data
    } catch (error) {
      console.error('Failed to get quotes:', error)
      return []
    }
  }

  async getHistoricalData(
    symbol: string,
    period: string = '1y'
  ): Promise<HistoricalPrice[]> {
    try {
      const response = await this.client.getHistoricalData({
        symbol,
        period: period as any
      })
      return response.data
    } catch (error) {
      console.error('Failed to get historical data:', error)
      return []
    }
  }

  async getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
    try {
      const response = await this.client.getCompanyProfile({ symbol })
      return response.data
    } catch (error) {
      console.error('Failed to get company profile:', error)
      return null
    }
  }

  async getNews(symbols?: string[], limit: number = 10): Promise<NewsItem[]> {
    try {
      const response = await this.client.getNews({
        symbols,
        limit
      })
      return response.data
    } catch (error) {
      console.error('Failed to get news:', error)
      return []
    }
  }

  async searchSymbols(query: string, limit: number = 10): Promise<SearchResult[]> {
    try {
      const response = await this.client.search({
        query,
        limit
      })
      return response.data
    } catch (error) {
      console.error('Failed to search symbols:', error)
      return []
    }
  }
}

// Export singleton service instance
export const financialDataService = new FinancialDataService()