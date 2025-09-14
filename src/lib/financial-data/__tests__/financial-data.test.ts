/**
 * Tests for the Financial Data API abstraction layer
 */
import {
  createFinancialDataClient,
  getDefaultFinancialDataClient,
  resetDefaultClient,
  AlphaVantageProvider,
  YahooFinanceProvider,
  ProviderManager,
  FinancialDataError,
  RateLimitError,
  InvalidSymbolError
} from '../index'

describe('Financial Data API Abstraction', () => {
  beforeEach(() => {
    resetDefaultClient()
  })

  describe('Factory Functions', () => {
    test('createFinancialDataClient creates a ProviderManager', () => {
      // Mock environment variables for testing
      const originalEnv = process.env
      process.env = {
        ...originalEnv,
        ALPHA_VANTAGE_API_KEY: 'test_key'
      }

      const client = createFinancialDataClient()
      expect(client).toBeInstanceOf(ProviderManager)

      process.env = originalEnv
    })

    test('getDefaultFinancialDataClient returns singleton', () => {
      const originalEnv = process.env
      process.env = {
        ...originalEnv,
        ALPHA_VANTAGE_API_KEY: 'test_key'
      }

      const client1 = getDefaultFinancialDataClient()
      const client2 = getDefaultFinancialDataClient()
      expect(client1).toBe(client2)

      process.env = originalEnv
    })
  })

  describe('Alpha Vantage Provider', () => {
    let provider: AlphaVantageProvider

    beforeEach(() => {
      provider = new AlphaVantageProvider({
        name: 'Test Alpha Vantage',
        apiKey: 'test_key'
      })
    })

    test('provider has correct capabilities', () => {
      expect(provider.capabilities.quotes).toBe(true)
      expect(provider.capabilities.historicalData).toBe(true)
      expect(provider.capabilities.companyProfile).toBe(true)
      expect(provider.capabilities.news).toBe(true)
      expect(provider.capabilities.search).toBe(true)
      expect(provider.capabilities.internationalMarkets).toBe(true)
      expect(provider.capabilities.cryptoCurrency).toBe(true)
      expect(provider.capabilities.forex).toBe(true)
    })

    test('provider normalizes symbols correctly', () => {
      // Access private method for testing
      const normalizedSymbol = (provider as any).normalizeSymbol('  aapl  ')
      expect(normalizedSymbol).toBe('AAPL')
    })

    test('provider builds URLs correctly', () => {
      const url = (provider as any).buildUrl('GLOBAL_QUOTE', { symbol: 'AAPL' })
      expect(url).toContain('alphavantage.co')
      expect(url).toContain('apikey=test_key')
      expect(url).toContain('function=GLOBAL_QUOTE')
    })
  })

  describe('Yahoo Finance Provider', () => {
    let provider: YahooFinanceProvider

    beforeEach(() => {
      provider = new YahooFinanceProvider({
        name: 'Test Yahoo Finance'
      })
    })

    test('provider has correct capabilities', () => {
      expect(provider.capabilities.quotes).toBe(true)
      expect(provider.capabilities.historicalData).toBe(true)
      expect(provider.capabilities.companyProfile).toBe(true)
      expect(provider.capabilities.news).toBe(true)
      expect(provider.capabilities.search).toBe(true)
      expect(provider.capabilities.realtime).toBe(true)
      expect(provider.capabilities.internationalMarkets).toBe(true)
    })

    test('provider normalizes symbols correctly', () => {
      // Access private method for testing
      const normalizedSymbol = (provider as any).normalizeSymbol('  aapl  ')
      expect(normalizedSymbol).toBe('AAPL')
    })
  })

  describe('Error Handling', () => {
    test('FinancialDataError has correct properties', () => {
      const error = new FinancialDataError('Test message', 'TEST_CODE', 'TestProvider')
      expect(error.name).toBe('FinancialDataError')
      expect(error.message).toBe('Test message')
      expect(error.code).toBe('TEST_CODE')
      expect(error.provider).toBe('TestProvider')
    })

    test('RateLimitError includes reset time', () => {
      const resetTime = new Date()
      const error = new RateLimitError('TestProvider', resetTime)
      expect(error.name).toBe('RateLimitError')
      expect(error.message).toContain('TestProvider')
      expect(error.message).toContain(resetTime.toString())
    })

    test('InvalidSymbolError has correct format', () => {
      const error = new InvalidSymbolError('INVALID', 'TestProvider')
      expect(error.name).toBe('InvalidSymbolError')
      expect(error.message).toBe('Invalid symbol: INVALID')
    })
  })

  describe('Provider Manager', () => {
    test('throws error with no providers configured', () => {
      expect(() => {
        createFinancialDataClient({
          primaryProvider: 'iex',
          providers: {}
        })
      }).toThrow('No financial data providers configured')
    })

    test('validates primary provider configuration', () => {
      expect(() => {
        createFinancialDataClient({
          primaryProvider: 'alphavantage',
          providers: {
            alphavantage: {
              apiKey: 'test_key'
            }
          }
        })
      }).not.toThrow()
    })

    test('works with Yahoo Finance as fallback', () => {
      expect(() => {
        createFinancialDataClient({
          primaryProvider: 'yahoo',
          providers: {
            yahoo: {
              userAgent: 'test-app/1.0'
            }
          }
        })
      }).not.toThrow()
    })
  })

  describe('Configuration', () => {
    test('loads configuration from environment', () => {
      const originalEnv = process.env
      process.env = {
        ...originalEnv,
        FINANCIAL_DATA_PRIMARY_PROVIDER: 'alphavantage',
        ALPHA_VANTAGE_API_KEY: 'test_key_123',
        ALPHA_VANTAGE_PREMIUM: 'true',
        FINANCIAL_DATA_ENABLE_CACHING: 'false'
      }

      const client = createFinancialDataClient()
      expect(client).toBeInstanceOf(ProviderManager)

      process.env = originalEnv
    })
  })
})

// Mock fetch for HTTP requests in tests
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    status: 200,
    statusText: 'OK'
  })
) as jest.Mock