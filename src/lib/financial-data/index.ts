// Main exports for the Financial Data API abstraction layer
export type {
  // Core types
  Quote,
  HistoricalPrice,
  CompanyProfile,
  Dividend,
  Split,
  Earnings,
  NewsItem,
  SearchResult,

  // Request types
  QuoteRequest,
  HistoricalDataRequest,
  CompanyProfileRequest,
  NewsRequest,
  SearchRequest,

  // Response types
  ProviderResponse,
  RateLimitInfo,

  // Configuration types
  ProviderConfig,
  ProviderCapabilities,
  FinancialDataConfig,
  ProviderManagerConfig,

  // Utility types
  TimePeriod,
  Interval,
  AssetType
} from './types'

// Error exports
export {
  FinancialDataError,
  RateLimitError,
  InvalidSymbolError,
  ProviderUnavailableError
} from './types'

// Base provider exports
// IFinancialDataProvider is an interface, so it needs `export type` under
// isolatedModules — a value re-export of a type has nothing to emit.
export type { IFinancialDataProvider } from './base-provider'
export {
  BaseFinancialDataProvider,
  validateProviderConfig
} from './base-provider'

// Provider manager
export {
  ProviderManager,
  createProviderManager
} from './provider-manager'

// Configuration utilities
export {
  loadConfigFromEnv,
  createProvidersFromConfig,
  createFinancialDataManager,
  defaultConfig
} from './config'

// Concrete providers
export { AlphaVantageProvider } from './providers/alpha-vantage'
export { YahooFinanceProvider } from './providers/yahoo-finance'

// Convenience factory function for quick setup
export function createFinancialDataClient(config?: Partial<FinancialDataConfig>) {
  return createFinancialDataManager(config)
}

// Default singleton instance (lazy-loaded)
let defaultManager: ProviderManager | null = null

export function getDefaultFinancialDataClient(): ProviderManager {
  if (!defaultManager) {
    defaultManager = createFinancialDataManager()
  }
  return defaultManager
}

// Reset the default instance (useful for testing)
export function resetDefaultClient(): void {
  if (defaultManager) {
    defaultManager.destroy()
    defaultManager = null
  }
}