/**
 * Chart data fetching utilities for the charting system
 * Provides historical OHLC data for different timeframes
 */

export interface CandlestickData {
  time: string // YYYY-MM-DD format for daily, or unix timestamp
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface ChartDataRequest {
  symbol: string
  interval: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo'
  range: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max'
}

// Map our timeframes to Yahoo Finance parameters
const intervalMap: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '60m': '60m',
  '1h': '60m',
  '1d': '1d',
  '1wk': '1wk',
  '1mo': '1mo'
}

const rangeMap: Record<string, string> = {
  '1d': '1d',
  '5d': '5d',
  '1mo': '1mo',
  '3mo': '3mo',
  '6mo': '6mo',
  '1y': '1y',
  '2y': '2y',
  '5y': '5y',
  'max': 'max'
}

// UI timeframe to data parameters mapping
export const timeframeToParams: Record<string, { interval: string; range: string }> = {
  '1D': { interval: '5m', range: '1d' },
  '1W': { interval: '15m', range: '5d' },
  '1M': { interval: '1d', range: '1mo' },
  '3M': { interval: '1d', range: '3mo' },
  '6M': { interval: '1d', range: '6mo' },
  '1Y': { interval: '1d', range: '1y' },
  '5Y': { interval: '1wk', range: '5y' },
  'ALL': { interval: '1mo', range: 'max' }
}

// Map days to Yahoo Finance range parameter (for fallback)
function daysToRange(days: number): string | null {
  if (days <= 1) return '1d'
  if (days <= 5) return '5d'
  if (days <= 30) return '1mo'
  if (days <= 90) return '3mo'
  if (days <= 180) return '6mo'
  if (days <= 365) return '1y'
  if (days <= 730) return '2y'
  if (days <= 1825) return '5y'
  if (days <= 3650) return '10y'
  return 'max'
}

// Yahoo Finance intraday data limitations (approximate max days)
const intradayMaxDays: Record<string, number> = {
  '1m': 7,      // 1-minute data available for ~7 days
  '5m': 60,     // 5-minute data available for ~60 days
  '15m': 60,    // 15-minute data available for ~60 days
  '30m': 60,    // 30-minute data available for ~60 days
  '60m': 730,   // Hourly data available for ~2 years
  '1h': 730,
}

class ChartDataService {
  private cache: Map<string, { data: CandlestickData[]; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 60 * 1000 // 1 minute cache for chart data

  async getChartData(request: ChartDataRequest): Promise<CandlestickData[]> {
    const cacheKey = `${request.symbol}-${request.interval}-${request.range}`

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data
    }

    try {
      const data = await this.fetchFromYahooFinance(request)
      if (data.length > 0) {
        this.cache.set(cacheKey, { data, timestamp: Date.now() })
      }
      return data
    } catch (error) {
      console.error('Failed to fetch chart data:', error)
      // Return cached data even if expired
      if (cached) {
        return cached.data
      }
      return []
    }
  }

  private async fetchFromYahooFinance(request: ChartDataRequest): Promise<CandlestickData[]> {
    const interval = intervalMap[request.interval] || '1d'
    const range = rangeMap[request.range] || '1mo'

    // Multiple CORS proxies for redundancy - order matters (most reliable first)
    const corsProxies = [
      'https://corsproxy.io/?',
      'https://api.allorigins.win/raw?url=',
      'https://api.codetabs.com/v1/proxy?quest='
    ]

    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${request.symbol}?interval=${interval}&range=${range}`

    for (const proxyUrl of corsProxies) {
      try {
        const url = proxyUrl + encodeURIComponent(targetUrl)

        // Add timeout to prevent hanging
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000)

        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!response.ok) continue

        const data = await response.json()
        const chart = data?.chart?.result?.[0]

        if (!chart) continue

        const timestamps = chart.timestamp || []
        const quote = chart.indicators?.quote?.[0]

        if (!quote) continue

        const opens = quote.open || []
        const highs = quote.high || []
        const lows = quote.low || []
        const closes = quote.close || []
        const volumes = quote.volume || []

        const result: CandlestickData[] = []

        for (let i = 0; i < timestamps.length; i++) {
          // Skip null/undefined values
          if (closes[i] == null || opens[i] == null || highs[i] == null || lows[i] == null) {
            continue
          }

          const timestamp = timestamps[i]
          const date = new Date(timestamp * 1000)

          // For daily/weekly/monthly data, use YYYY-MM-DD format
          // For intraday, use the unix timestamp
          let time: string
          if (['1d', '1wk', '1mo'].includes(interval)) {
            time = date.toISOString().split('T')[0]
          } else {
            // For intraday, lightweight-charts expects unix timestamp in seconds
            time = String(timestamp)
          }

          result.push({
            time,
            open: opens[i],
            high: highs[i],
            low: lows[i],
            close: closes[i],
            volume: volumes[i] || 0
          })
        }

        return result
      } catch (error) {
        console.warn(`Proxy ${proxyUrl} failed:`, error)
        continue
      }
    }

    return []
  }

  clearCache() {
    this.cache.clear()
  }

  // Fetch historical data by specific time period (for loading more data when panning)
  async getHistoricalData(
    symbol: string,
    interval: string,
    endTime: number, // Unix timestamp in seconds
    durationSeconds: number // How far back to fetch
  ): Promise<CandlestickData[]> {
    const period1 = Math.floor(endTime - durationSeconds)
    const period2 = Math.floor(endTime)
    const intervalParam = intervalMap[interval] || '1d'

    // Multiple CORS proxies for redundancy - order matters (most reliable first)
    const corsProxies = [
      'https://corsproxy.io/?',
      'https://api.allorigins.win/raw?url=',
      'https://api.codetabs.com/v1/proxy?quest='
    ]

    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${intervalParam}&period1=${period1}&period2=${period2}`

    for (const proxyUrl of corsProxies) {
      try {
        const url = proxyUrl + encodeURIComponent(targetUrl)

        // Add timeout to prevent hanging
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000)

        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!response.ok) continue

        const data = await response.json()
        const chart = data?.chart?.result?.[0]

        if (!chart) continue

        const timestamps = chart.timestamp || []
        const quote = chart.indicators?.quote?.[0]

        if (!quote) continue

        const opens = quote.open || []
        const highs = quote.high || []
        const lows = quote.low || []
        const closes = quote.close || []
        const volumes = quote.volume || []

        const result: CandlestickData[] = []

        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] == null || opens[i] == null || highs[i] == null || lows[i] == null) {
            continue
          }

          const timestamp = timestamps[i]
          const date = new Date(timestamp * 1000)

          let time: string
          if (['1d', '1wk', '1mo'].includes(intervalParam)) {
            time = date.toISOString().split('T')[0]
          } else {
            time = String(timestamp)
          }

          result.push({
            time,
            open: opens[i],
            high: highs[i],
            low: lows[i],
            close: closes[i],
            volume: volumes[i] || 0
          })
        }

        return result
      } catch (error) {
        console.warn(`Proxy ${proxyUrl} failed for historical data:`, error)
        continue
      }
    }

    return []
  }

  // Fetch data for a custom date range
  async getCustomRangeData(
    symbol: string,
    startDate: Date,
    endDate: Date,
    interval: string
  ): Promise<CandlestickData[]> {
    const intervalParam = intervalMap[interval] || '1d'

    // Calculate days
    let days = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

    // Check if intraday interval exceeds Yahoo's data limits
    const maxDays = intradayMaxDays[intervalParam]
    let adjustedStartDate = startDate
    if (maxDays && days > maxDays) {
      console.log(`Intraday interval ${intervalParam} limited to ${maxDays} days, adjusting from ${days} days`)
      adjustedStartDate = new Date(endDate.getTime() - maxDays * 24 * 60 * 60 * 1000)
      days = maxDays
    }

    const period1 = Math.floor(adjustedStartDate.getTime() / 1000)
    const period2 = Math.floor(endDate.getTime() / 1000)
    const rangeParam = daysToRange(days)

    console.log('getCustomRangeData:', {
      symbol,
      originalStart: startDate.toISOString(),
      adjustedStart: adjustedStartDate.toISOString(),
      endDate: endDate.toISOString(),
      interval,
      intervalParam,
      days,
      rangeParam
    })

    // Multiple CORS proxies for redundancy - order matters (most reliable first)
    const corsProxies = [
      'https://corsproxy.io/?',
      'https://api.allorigins.win/raw?url=',
      'https://api.codetabs.com/v1/proxy?quest='
    ]

    // Try range-based URL first (more reliable), then period-based as fallback
    const targetUrls = [
      // Range-based is more reliable for standard ranges
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${intervalParam}&range=${rangeParam}`,
      // Period-based for exact dates
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${intervalParam}&period1=${period1}&period2=${period2}`
    ]

    for (const targetUrl of targetUrls) {
      console.log('Trying URL:', targetUrl)

      for (const proxyUrl of corsProxies) {
        try {
          const url = proxyUrl + encodeURIComponent(targetUrl)
          console.log('With proxy:', proxyUrl.substring(0, 30) + '...')

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

          const response = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
          })
          clearTimeout(timeoutId)

          if (!response.ok) {
            console.log('Response not ok:', response.status)
            continue
          }

          const data = await response.json()

          // Check for API errors
          if (data?.chart?.error) {
            console.warn('Yahoo API error:', data.chart.error?.description || data.chart.error)
            continue
          }

          const chart = data?.chart?.result?.[0]
          if (!chart) {
            console.log('No chart result in response')
            continue
          }

          const timestamps = chart.timestamp || []
          const quote = chart.indicators?.quote?.[0]

          if (!quote || timestamps.length === 0) {
            console.log('No quote data or timestamps')
            continue
          }

          const opens = quote.open || []
          const highs = quote.high || []
          const lows = quote.low || []
          const closes = quote.close || []
          const volumes = quote.volume || []

          const result: CandlestickData[] = []

          for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] == null || opens[i] == null || highs[i] == null || lows[i] == null) {
              continue
            }

            const timestamp = timestamps[i]
            const date = new Date(timestamp * 1000)

            let time: string
            if (['1d', '1wk', '1mo'].includes(intervalParam)) {
              time = date.toISOString().split('T')[0]
            } else {
              time = String(timestamp)
            }

            result.push({
              time,
              open: opens[i],
              high: highs[i],
              low: lows[i],
              close: closes[i],
              volume: volumes[i] || 0
            })
          }

          if (result.length > 0) {
            console.log('Success! Got', result.length, 'data points')
            return result
          }
        } catch (error: any) {
          if (error.name === 'AbortError') {
            console.warn(`Timeout for proxy ${proxyUrl.substring(0, 25)}...`)
          } else {
            console.warn(`Proxy failed:`, error.message || error)
          }
          continue
        }
      }
    }

    console.log('All attempts failed for custom range')
    return []
  }
}

export const chartDataService = new ChartDataService()
