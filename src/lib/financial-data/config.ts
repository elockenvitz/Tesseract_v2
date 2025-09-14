import { ProviderConfig } from './types'
import { IFinancialDataProvider } from './base-provider'
import { AlphaVantageProvider } from './providers/alpha-vantage'
import { YahooFinanceProvider } from './providers/yahoo-finance'
import { ProviderManager, ProviderManagerConfig } from './provider-manager'

export interface FinancialDataConfig {
  // Primary provider configuration
  primaryProvider: 'alphavantage' | 'yahoo' | 'polygon'

  // Provider-specific configurations
  providers: {
    alphavantage?: {
      apiKey: string
      premium?: boolean
      baseUrl?: string
    }
    yahoo?: {
      // Yahoo Finance doesn't require API key
      userAgent?: string
      baseUrl?: string
    }
    polygon?: {
      apiKey: string
      tier?: 'basic' | 'starter' | 'developer' | 'advanced'
      baseUrl?: string
    }
  }

  // Manager configuration
  manager?: {
    enableFallback?: boolean
    fallbackProviders?: string[]
    enableCaching?: boolean
    cacheTtlSeconds?: number
    healthCheckIntervalMs?: number
    maxRetries?: number
  }
}

/**
 * Load configuration from environment variables
 */
export function loadConfigFromEnv(): Partial<FinancialDataConfig> {
  return {
    primaryProvider: (process.env.FINANCIAL_DATA_PRIMARY_PROVIDER as any) || 'alphavantage',
    providers: {
      alphavantage: process.env.ALPHA_VANTAGE_API_KEY ? {
        apiKey: process.env.ALPHA_VANTAGE_API_KEY,
        premium: process.env.ALPHA_VANTAGE_PREMIUM === 'true',
        baseUrl: process.env.ALPHA_VANTAGE_BASE_URL
      } : undefined,
      yahoo: {
        userAgent: process.env.YAHOO_FINANCE_USER_AGENT || 'financial-data-client/1.0',
        baseUrl: process.env.YAHOO_FINANCE_BASE_URL
      },
      polygon: process.env.POLYGON_API_KEY ? {
        apiKey: process.env.POLYGON_API_KEY,
        tier: (process.env.POLYGON_TIER as any) || 'basic',
        baseUrl: process.env.POLYGON_BASE_URL
      } : undefined
    },
    manager: {
      enableFallback: process.env.FINANCIAL_DATA_ENABLE_FALLBACK !== 'false',
      enableCaching: process.env.FINANCIAL_DATA_ENABLE_CACHING !== 'false',
      cacheTtlSeconds: process.env.FINANCIAL_DATA_CACHE_TTL
        ? parseInt(process.env.FINANCIAL_DATA_CACHE_TTL)
        : 300,
      healthCheckIntervalMs: process.env.FINANCIAL_DATA_HEALTH_CHECK_INTERVAL
        ? parseInt(process.env.FINANCIAL_DATA_HEALTH_CHECK_INTERVAL)
        : 60000,
      maxRetries: process.env.FINANCIAL_DATA_MAX_RETRIES
        ? parseInt(process.env.FINANCIAL_DATA_MAX_RETRIES)
        : 3
    }
  }
}

/**
 * Create provider instances from configuration
 */
export function createProvidersFromConfig(config: FinancialDataConfig): IFinancialDataProvider[] {
  const providers: IFinancialDataProvider[] = []

  // Alpha Vantage
  if (config.providers.alphavantage?.apiKey) {
    const alphaVantageConfig: ProviderConfig = {
      name: 'Alpha Vantage',
      apiKey: config.providers.alphavantage.apiKey,
      priority: config.primaryProvider === 'alphavantage' ? 0 : 1,
      baseUrl: config.providers.alphavantage.baseUrl
    }

    providers.push(new AlphaVantageProvider(alphaVantageConfig))
  }

  // Yahoo Finance (always available as fallback)
  const yahooConfig: ProviderConfig = {
    name: 'Yahoo Finance',
    priority: config.primaryProvider === 'yahoo' ? 0 : 2,
    baseUrl: config.providers.yahoo?.baseUrl
  }

  providers.push(new YahooFinanceProvider(yahooConfig))

  // Add other providers here as they're implemented
  // if (config.providers.polygon?.apiKey) {
  //   providers.push(new PolygonProvider({
  //     name: 'Polygon',
  //     apiKey: config.providers.polygon.apiKey,
  //     priority: config.primaryProvider === 'polygon' ? 0 : 3
  //   }))
  // }

  return providers
}

/**
 * Create a fully configured ProviderManager
 */
export function createFinancialDataManager(config?: Partial<FinancialDataConfig>): ProviderManager {
  // Merge environment config with provided config
  const envConfig = loadConfigFromEnv()
  const finalConfig: FinancialDataConfig = {
    primaryProvider: 'alphavantage',
    ...envConfig,
    ...config,
    providers: {
      ...envConfig.providers,
      ...config?.providers
    },
    manager: {
      ...envConfig.manager,
      ...config?.manager
    }
  }

  // Validate configuration
  validateConfig(finalConfig)

  // Create providers
  const providers = createProvidersFromConfig(finalConfig)

  if (providers.length === 0) {
    throw new Error('No financial data providers configured. Please provide API keys.')
  }

  // Create manager configuration
  const managerConfig: ProviderManagerConfig = {
    primaryProvider: getPrimaryProviderName(finalConfig.primaryProvider, providers),
    fallbackProviders: getFallbackProviderNames(finalConfig.primaryProvider, providers),
    ...finalConfig.manager
  }

  // Create and return the manager
  const manager = new ProviderManager(managerConfig)

  providers.forEach(provider => {
    manager.registerProvider(provider)
  })

  return manager
}

/**
 * Validate the configuration
 */
function validateConfig(config: FinancialDataConfig): void {
  if (!config.primaryProvider) {
    throw new Error('Primary provider must be specified')
  }

  // Check if primary provider is configured
  const primaryProviderConfig = config.providers[config.primaryProvider]
  if (!primaryProviderConfig) {
    throw new Error(`Primary provider ${config.primaryProvider} is not configured`)
  }

  // Validate provider-specific requirements
  if (config.primaryProvider === 'alphavantage' && !config.providers.alphavantage?.apiKey) {
    throw new Error('Alpha Vantage API key is required')
  }

  if (config.primaryProvider === 'polygon' && !config.providers.polygon?.apiKey) {
    throw new Error('Polygon API key is required')
  }

  // Yahoo Finance doesn't require API key, so no validation needed
}

/**
 * Get the actual provider name for the primary provider
 */
function getPrimaryProviderName(
  primaryProvider: FinancialDataConfig['primaryProvider'],
  providers: IFinancialDataProvider[]
): string {
  const providerMap = {
    'alphavantage': 'Alpha Vantage',
    'yahoo': 'Yahoo Finance',
    'polygon': 'Polygon'
  }

  const expectedName = providerMap[primaryProvider]
  const provider = providers.find(p => p.name === expectedName)

  if (!provider) {
    throw new Error(`Primary provider ${primaryProvider} not found in available providers`)
  }

  return provider.name
}

/**
 * Get fallback provider names (all providers except primary)
 */
function getFallbackProviderNames(
  primaryProvider: FinancialDataConfig['primaryProvider'],
  providers: IFinancialDataProvider[]
): string[] {
  const providerMap = {
    'alphavantage': 'Alpha Vantage',
    'yahoo': 'Yahoo Finance',
    'polygon': 'Polygon'
  }

  const primaryName = providerMap[primaryProvider]
  return providers
    .filter(p => p.name !== primaryName)
    .map(p => p.name)
}

// Default configuration for quick setup
export const defaultConfig: FinancialDataConfig = {
  primaryProvider: 'alphavantage',
  providers: {
    alphavantage: {
      apiKey: '', // Must be provided via environment or config
      premium: false
    },
    yahoo: {
      userAgent: 'financial-data-client/1.0'
    }
  },
  manager: {
    enableFallback: true,
    enableCaching: true,
    cacheTtlSeconds: 300,
    healthCheckIntervalMs: 60000,
    maxRetries: 3
  }
}