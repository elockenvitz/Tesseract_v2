import {
  IFinancialDataProvider,
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
  FinancialDataError,
  RateLimitError,
  ProviderUnavailableError
} from './types'
import { validateProviderConfig } from './base-provider'

export interface ProviderManagerConfig {
  primaryProvider: string
  fallbackProviders?: string[]
  enableFallback?: boolean
  enableCaching?: boolean
  cacheTtlSeconds?: number
  healthCheckIntervalMs?: number
  maxRetries?: number
}

export class ProviderManager {
  private providers = new Map<string, IFinancialDataProvider>()
  private providerHealth = new Map<string, { healthy: boolean; lastCheck: Date }>()
  private cache = new Map<string, { data: any; expires: Date }>()
  private healthCheckInterval?: NodeJS.Timeout

  constructor(private config: ProviderManagerConfig) {
    if (!config.primaryProvider) {
      throw new Error('Primary provider must be specified')
    }

    // Set default config values
    this.config = {
      enableFallback: true,
      enableCaching: true,
      cacheTtlSeconds: 300, // 5 minutes
      healthCheckIntervalMs: 60000, // 1 minute
      maxRetries: 3,
      ...config
    }

    // Start health checking if enabled
    if (this.config.healthCheckIntervalMs && this.config.healthCheckIntervalMs > 0) {
      this.startHealthChecking()
    }
  }

  /**
   * Register a financial data provider
   */
  public registerProvider(provider: IFinancialDataProvider): void {
    validateProviderConfig(provider.config)

    this.providers.set(provider.name, provider)
    this.providerHealth.set(provider.name, {
      healthy: true,
      lastCheck: new Date()
    })

    console.log(`Registered financial data provider: ${provider.name}`)
  }

  /**
   * Remove a provider
   */
  public unregisterProvider(providerName: string): void {
    this.providers.delete(providerName)
    this.providerHealth.delete(providerName)
    console.log(`Unregistered financial data provider: ${providerName}`)
  }

  /**
   * Get quotes with automatic fallback
   */
  public async getQuotes(request: QuoteRequest): Promise<ProviderResponse<Quote[]>> {
    return this.executeWithFallback('getQuotes', request)
  }

  /**
   * Get historical data with automatic fallback
   */
  public async getHistoricalData(request: HistoricalDataRequest): Promise<ProviderResponse<HistoricalPrice[]>> {
    return this.executeWithFallback('getHistoricalData', request)
  }

  /**
   * Get company profile with automatic fallback
   */
  public async getCompanyProfile(request: CompanyProfileRequest): Promise<ProviderResponse<CompanyProfile>> {
    return this.executeWithFallback('getCompanyProfile', request)
  }

  /**
   * Get news with automatic fallback
   */
  public async getNews(request: NewsRequest): Promise<ProviderResponse<NewsItem[]>> {
    return this.executeWithFallback('getNews', request)
  }

  /**
   * Search with automatic fallback
   */
  public async search(request: SearchRequest): Promise<ProviderResponse<SearchResult[]>> {
    return this.executeWithFallback('search', request)
  }

  /**
   * Get provider health status
   */
  public getProviderHealth(): Record<string, { healthy: boolean; lastCheck: Date }> {
    return Object.fromEntries(this.providerHealth.entries())
  }

  /**
   * Force health check on all providers
   */
  public async checkAllProvidersHealth(): Promise<void> {
    const promises = Array.from(this.providers.values()).map(provider =>
      this.checkProviderHealth(provider)
    )

    await Promise.all(promises)
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; hitRate?: number } {
    // Clean expired entries
    this.cleanExpiredCache()

    return {
      size: this.cache.size
      // Hit rate would require tracking hits/misses
    }
  }

  /**
   * Clear all cached data
   */
  public clearCache(): void {
    this.cache.clear()
  }

  /**
   * Stop the provider manager and cleanup resources
   */
  public destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }
    this.clearCache()
  }

  /**
   * Execute a method with automatic provider fallback
   */
  private async executeWithFallback<T>(
    method: keyof IFinancialDataProvider,
    request: any
  ): Promise<ProviderResponse<T>> {
    // Check cache first
    if (this.config.enableCaching) {
      const cacheKey = this.generateCacheKey(method as string, request)
      const cached = this.getFromCache<T>(cacheKey)
      if (cached) {
        return cached
      }
    }

    const providers = this.getProviderOrder()
    let lastError: Error | null = null

    for (const providerName of providers) {
      const provider = this.providers.get(providerName)
      if (!provider) continue

      // Check if provider supports this method
      if (!provider[method] || typeof provider[method] !== 'function') {
        continue
      }

      // Check provider health
      const health = this.providerHealth.get(providerName)
      if (health && !health.healthy && this.config.enableFallback) {
        continue
      }

      try {
        const result = await (provider[method] as any).call(provider, request)

        // Cache the result
        if (this.config.enableCaching) {
          const cacheKey = this.generateCacheKey(method as string, request)
          this.setCache(cacheKey, result)
        }

        return result
      } catch (error) {
        lastError = error

        // Update provider health on certain errors
        if (error instanceof ProviderUnavailableError) {
          this.markProviderUnhealthy(providerName)
        } else if (error instanceof RateLimitError) {
          // Don't mark as unhealthy for rate limits, just skip for now
          console.warn(`Rate limit hit for ${providerName}`)
        }

        // Log the error and continue to next provider
        console.error(`${providerName} failed for ${method}:`, error.message)

        // If this is the primary provider and we're not at the last provider, continue
        if (this.config.enableFallback && providers.indexOf(providerName) < providers.length - 1) {
          continue
        }
      }
    }

    // If we get here, all providers failed
    throw lastError || new FinancialDataError(
      `All providers failed for ${method}`,
      'ALL_PROVIDERS_FAILED',
      'ProviderManager'
    )
  }

  /**
   * Get the order of providers to try (primary first, then fallbacks by priority)
   */
  private getProviderOrder(): string[] {
    const order = [this.config.primaryProvider]

    if (this.config.enableFallback && this.config.fallbackProviders) {
      // Sort fallback providers by priority (lower number = higher priority)
      const sortedFallbacks = this.config.fallbackProviders
        .map(name => ({
          name,
          priority: this.providers.get(name)?.config.priority || 999
        }))
        .sort((a, b) => a.priority - b.priority)
        .map(p => p.name)

      order.push(...sortedFallbacks)
    }

    // Filter out any providers that aren't registered
    return order.filter(name => this.providers.has(name))
  }

  /**
   * Start periodic health checking
   */
  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.checkAllProvidersHealth()
      } catch (error) {
        console.error('Error during health check:', error)
      }
    }, this.config.healthCheckIntervalMs)
  }

  /**
   * Check health of a specific provider
   */
  private async checkProviderHealth(provider: IFinancialDataProvider): Promise<void> {
    try {
      const isHealthy = await provider.isHealthy()
      this.providerHealth.set(provider.name, {
        healthy: isHealthy,
        lastCheck: new Date()
      })
    } catch (error) {
      this.providerHealth.set(provider.name, {
        healthy: false,
        lastCheck: new Date()
      })
      console.error(`Health check failed for ${provider.name}:`, error)
    }
  }

  /**
   * Mark a provider as unhealthy
   */
  private markProviderUnhealthy(providerName: string): void {
    this.providerHealth.set(providerName, {
      healthy: false,
      lastCheck: new Date()
    })
  }

  /**
   * Generate cache key from method and request
   */
  private generateCacheKey(method: string, request: any): string {
    return `${method}:${JSON.stringify(request)}`
  }

  /**
   * Get data from cache if not expired
   */
  private getFromCache<T>(key: string): ProviderResponse<T> | null {
    const cached = this.cache.get(key)
    if (!cached) return null

    if (cached.expires < new Date()) {
      this.cache.delete(key)
      return null
    }

    return {
      ...cached.data,
      cached: true
    }
  }

  /**
   * Store data in cache with expiration
   */
  private setCache(key: string, data: any): void {
    const expires = new Date()
    expires.setSeconds(expires.getSeconds() + (this.config.cacheTtlSeconds || 300))

    this.cache.set(key, {
      data: { ...data, cached: false }, // Remove cached flag before storing
      expires
    })
  }

  /**
   * Remove expired cache entries
   */
  private cleanExpiredCache(): void {
    const now = new Date()
    for (const [key, cached] of this.cache.entries()) {
      if (cached.expires < now) {
        this.cache.delete(key)
      }
    }
  }
}

// Factory function to create and configure provider manager
export function createProviderManager(
  config: ProviderManagerConfig,
  providers: IFinancialDataProvider[]
): ProviderManager {
  const manager = new ProviderManager(config)

  providers.forEach(provider => {
    manager.registerProvider(provider)
  })

  return manager
}