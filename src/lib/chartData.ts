/**
 * Chart data fetching utilities for the charting system
 * Provides historical OHLC data for different timeframes.
 *
 * Historically fetched Yahoo Finance via public CORS proxies
 * (corsproxy.io / allorigins / codetabs). Those proxies have been
 * paywalled or rate-limited to uselessness, silently breaking every
 * chart in the app simultaneously. We now proxy Yahoo through the
 * `yahoo-chart-proxy` Supabase edge function which runs server-side
 * and has no CORS constraints.
 */
import { supabase } from './supabase'

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
  '2Y': { interval: '1d', range: '2y' },
  '5Y': { interval: '1wk', range: '5y' },
  '10Y': { interval: '1wk', range: 'max' },
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

/**
 * Call the yahoo-chart-proxy edge function and return the raw Yahoo
 * response body (shape: `{ chart: { result: [...], error: ... } }`).
 * Returns null on any error — callers should treat null as "no data".
 */
async function fetchYahooChart(params: {
  symbol: string
  interval: string
  range?: string
  period1?: number
  period2?: number
}): Promise<any | null> {
  try {
    const { data, error } = await supabase.functions.invoke('yahoo-chart-proxy', {
      body: params,
    })
    if (error) {
      console.warn('[chartData] yahoo-chart-proxy error:', error.message || error)
      return null
    }
    if (data?.error) {
      console.warn('[chartData] yahoo-chart-proxy returned error:', data.error, data.detail)
      return null
    }
    return data
  } catch (e: any) {
    console.warn('[chartData] yahoo-chart-proxy invoke threw:', e?.message || e)
    return null
  }
}

/**
 * Parse a Yahoo chart JSON response into CandlestickData[]. Null values
 * from Yahoo (holidays, gaps) are skipped. Daily/weekly/monthly bars are
 * emitted as YYYY-MM-DD; intraday bars as unix-seconds strings, matching
 * what `lightweight-charts` expects.
 */
function parseYahooChart(
  data: any,
  interval: string,
): CandlestickData[] {
  const chart = data?.chart?.result?.[0]
  if (!chart) return []

  const timestamps: number[] = chart.timestamp || []
  const quote = chart.indicators?.quote?.[0]
  if (!quote) return []

  const opens = quote.open || []
  const highs = quote.high || []
  const lows = quote.low || []
  const closes = quote.close || []
  const volumes = quote.volume || []

  const dailyIntervals = new Set(['1d', '1wk', '1mo'])
  const result: CandlestickData[] = []

  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null || opens[i] == null || highs[i] == null || lows[i] == null) {
      continue
    }
    const timestamp = timestamps[i]
    const date = new Date(timestamp * 1000)

    const time = dailyIntervals.has(interval)
      ? date.toISOString().split('T')[0]
      : String(timestamp)

    result.push({
      time,
      open: opens[i],
      high: highs[i],
      low: lows[i],
      close: closes[i],
      volume: volumes[i] || 0,
    })
  }

  return result
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

    const data = await fetchYahooChart({ symbol: request.symbol, interval, range })
    if (!data) return []
    return parseYahooChart(data, interval)
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

    const data = await fetchYahooChart({ symbol, interval: intervalParam, period1, period2 })
    if (!data) return []
    return parseYahooChart(data, intervalParam)
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
      adjustedStartDate = new Date(endDate.getTime() - maxDays * 24 * 60 * 60 * 1000)
      days = maxDays
    }

    const period1 = Math.floor(adjustedStartDate.getTime() / 1000)
    const period2 = Math.floor(endDate.getTime() / 1000)
    const rangeParam = daysToRange(days)


    // Try range-based first (more reliable for standard ranges), then
    // fall back to period-based for exact date windows.
    if (rangeParam) {
      const rangeData = await fetchYahooChart({ symbol, interval: intervalParam, range: rangeParam })
      const rangeParsed = rangeData ? parseYahooChart(rangeData, intervalParam) : []
      if (rangeParsed.length > 0) return rangeParsed
    }

    const periodData = await fetchYahooChart({ symbol, interval: intervalParam, period1, period2 })
    return periodData ? parseYahooChart(periodData, intervalParam) : []
  }
}

export const chartDataService = new ChartDataService()
