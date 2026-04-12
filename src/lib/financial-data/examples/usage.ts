/**
 * Usage examples for the Financial Data API abstraction layer
 */
import {
  createFinancialDataClient,
  getDefaultFinancialDataClient,
  AlphaVantageProvider,
  YahooFinanceProvider,
  ProviderManager,
  type QuoteRequest,
  type HistoricalDataRequest,
  type FinancialDataConfig
} from '../index'

// Example 1: Quick setup with environment variables
async function quickSetupExample() {
  // Assumes ALPHA_VANTAGE_API_KEY is set in environment
  const client = getDefaultFinancialDataClient()

  try {
    const quotes = await client.getQuotes({
      symbols: ['AAPL', 'GOOGL', 'MSFT']
    })

  } catch (error) {
    console.error('Failed to get quotes:', error)
  }
}

// Example 2: Custom configuration with Alpha Vantage + Yahoo Finance fallback
async function customConfigExample() {
  const config: FinancialDataConfig = {
    primaryProvider: 'alphavantage',
    providers: {
      alphavantage: {
        apiKey: 'your_alpha_vantage_api_key_here',
        premium: false // Set to true if you have a premium plan
      },
      yahoo: {
        userAgent: 'MyFinancialApp/1.0'
      }
    },
    manager: {
      enableFallback: true,
      enableCaching: true,
      cacheTtlSeconds: 300, // 5 minutes
      maxRetries: 3
    }
  }

  const client = createFinancialDataClient(config)

  try {
    // Get historical data
    const historicalData = await client.getHistoricalData({
      symbol: 'AAPL',
      period: '1y'
    })

    // Get company profile
    const profile = await client.getCompanyProfile({
      symbol: 'AAPL'
    })

  } catch (error) {
    console.error('Failed to get data:', error)
  }
}

// Example 3: Direct provider usage with Alpha Vantage
async function directAlphaVantageExample() {
  const provider = new AlphaVantageProvider({
    name: 'My Alpha Vantage Provider',
    apiKey: 'your_alpha_vantage_api_key'
  })

  try {
    const quotes = await provider.getQuotes({
      symbols: ['TSLA']
    })

  } catch (error) {
    console.error('Alpha Vantage error:', error)
  }
}

// Example 4: Yahoo Finance for unlimited requests
async function yahooFinanceExample() {
  const provider = new YahooFinanceProvider({
    name: 'Yahoo Finance Provider'
  })

  try {
    const quotes = await provider.getQuotes({
      symbols: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN'] // No rate limits!
    })

    quotes.data.forEach(quote => {
    })
  } catch (error) {
    console.error('Yahoo Finance error:', error)
  }
}

// Example 4: News and search
async function newsAndSearchExample() {
  const client = getDefaultFinancialDataClient()

  try {
    // Search for companies
    const searchResults = await client.search({
      query: 'Apple',
      limit: 5
    })

    searchResults.data.forEach(result => {
    })

    // Get news for specific symbols
    const news = await client.getNews({
      symbols: ['AAPL'],
      limit: 10
    })

    news.data.forEach(item => {
    })
  } catch (error) {
    console.error('News/search error:', error)
  }
}

// Example 5: Error handling and rate limits
async function errorHandlingExample() {
  const client = getDefaultFinancialDataClient()

  try {
    // This might hit rate limits or fail
    const quotes = await client.getQuotes({
      symbols: ['INVALID_SYMBOL']
    })

  } catch (error) {
    if (error instanceof RateLimitError) {
    } else if (error instanceof InvalidSymbolError) {
    } else {
    }
  }
}

// Example 6: Health monitoring with fallback system
async function healthMonitoringExample() {
  const client = createFinancialDataClient({
    primaryProvider: 'alphavantage',
    providers: {
      alphavantage: {
        apiKey: 'your_alpha_vantage_key_here'
      },
      yahoo: {
        userAgent: 'MyApp/1.0'
      }
    },
    manager: {
      enableFallback: true,
      healthCheckIntervalMs: 30000 // Check every 30 seconds
    }
  })

  // Check provider health
  await client.checkAllProvidersHealth()
  const health = client.getProviderHealth()

  Object.entries(health).forEach(([name, status]) => {
  })

  // Check cache stats
  const cacheStats = client.getCacheStats()
  // Clean up when done
  client.destroy()
}

// Export examples for use
export {
  quickSetupExample,
  customConfigExample,
  directAlphaVantageExample,
  yahooFinanceExample,
  newsAndSearchExample,
  errorHandlingExample,
  healthMonitoringExample
}