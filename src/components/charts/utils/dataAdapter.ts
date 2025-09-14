import type { ChartDataPoint } from '../types'
import type { Quote } from '../../../lib/financial-data/browser-client'

export class ChartDataAdapter {
  /**
   * Convert real-time quote to chart data point
   */
  static quoteToChartData(quote: Quote): ChartDataPoint {
    return {
      timestamp: new Date(quote.timestamp).getTime(),
      date: new Date(quote.timestamp),
      value: quote.price,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.price,
      volume: quote.volume,
      dayHigh: quote.dayHigh,
      dayLow: quote.dayLow,
      previousClose: quote.previousClose
    }
  }

  /**
   * Generate historical price data for demonstration with consistent seed-based randomness
   */
  static generateHistoricalData(
    symbol: string,
    currentQuote?: Quote,
    days: number = 30
  ): ChartDataPoint[] {
    const data: ChartDataPoint[] = []
    const now = new Date()
    const currentPrice = currentQuote?.price || 100

    // Create a simple seeded random number generator for consistency
    const seedRandom = (seed: number) => {
      let x = Math.sin(seed) * 10000
      return x - Math.floor(x)
    }

    // Use symbol and date as seed for consistent data
    const baseSeed = symbol.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0)

    // Generate realistic price movements
    let price = currentPrice * 0.95 // Start slightly lower
    const volatility = 0.02 // 2% daily volatility

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const daysSinceEpoch = Math.floor(date.getTime() / (24 * 60 * 60 * 1000))
      const seed = baseSeed + daysSinceEpoch

      // Generate realistic OHLC data with seeded randomness
      const openPrice = price
      const randomChange = (seedRandom(seed) - 0.5) * 2 * volatility
      const closePrice = Math.max(0.01, openPrice * (1 + randomChange)) // Ensure price stays positive

      // High and low based on intraday volatility
      const intradayVolatility = volatility * 0.5
      const high = Math.max(openPrice, closePrice) * (1 + seedRandom(seed + 1) * intradayVolatility)
      const low = Math.min(openPrice, closePrice) * (1 - seedRandom(seed + 2) * intradayVolatility)

      // Generate realistic volume (higher volume on volatile days)
      const baseVolume = 1000000
      const volumeMultiplier = 1 + Math.abs(randomChange) * 2
      const volume = Math.floor(baseVolume * volumeMultiplier * (0.5 + seedRandom(seed + 3)))

      data.push({
        timestamp: date.getTime(),
        date: date,
        value: closePrice,
        open: openPrice,
        high: high,
        low: Math.max(0.01, low), // Ensure low stays positive
        close: closePrice,
        volume: volume
      })

      price = closePrice // Next day starts with previous close
    }

    // If we have current quote, adjust the last data point
    if (currentQuote && data.length > 0) {
      const lastPoint = data[data.length - 1]
      data[data.length - 1] = {
        ...lastPoint,
        value: currentQuote.price,
        close: currentQuote.price,
        high: Math.max(lastPoint.high, currentQuote.dayHigh || currentQuote.price),
        low: Math.min(lastPoint.low, currentQuote.dayLow || currentQuote.price),
        volume: currentQuote.volume || lastPoint.volume
      }
    }

    return data
  }

  /**
   * Generate intraday price data (hourly intervals)
   */
  static generateIntradayData(
    currentQuote?: Quote,
    hours: number = 24
  ): ChartDataPoint[] {
    const data: ChartDataPoint[] = []
    const now = new Date()
    const currentPrice = currentQuote?.price || 100

    let price = currentPrice * 0.999 // Start very close to current
    const volatility = 0.001 // Lower intraday volatility

    for (let i = hours - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 60 * 60 * 1000)

      const randomChange = (Math.random() - 0.5) * 2 * volatility
      price = price * (1 + randomChange)

      // Generate realistic volume (higher during market hours)
      const hour = date.getHours()
      const isMarketHours = hour >= 9 && hour <= 16
      const baseVolume = isMarketHours ? 50000 : 10000
      const volume = Math.floor(baseVolume * (0.5 + Math.random()))

      data.push({
        timestamp: date.getTime(),
        date: date,
        value: price,
        volume: volume
      })
    }

    // Adjust last point to current quote
    if (currentQuote && data.length > 0) {
      data[data.length - 1] = {
        ...data[data.length - 1],
        value: currentQuote.price,
        volume: currentQuote.volume || data[data.length - 1].volume
      }
    }

    return data
  }

  /**
   * Convert portfolio holdings data to chart format
   */
  static portfolioHoldingsToChartData(
    holdings: Array<{
      asset: { symbol: string }
      shares: number
      cost: number
      current_value: number
      timestamp: string
    }>
  ): ChartDataPoint[] {
    return holdings.map(holding => ({
      timestamp: new Date(holding.timestamp).getTime(),
      date: new Date(holding.timestamp),
      value: holding.current_value,
      shares: holding.shares,
      costBasis: holding.cost * holding.shares,
      symbol: holding.asset.symbol
    }))
  }

  /**
   * Aggregate portfolio value over time
   */
  static aggregatePortfolioValue(
    holdingsData: ChartDataPoint[][],
    timeframe: 'daily' | 'weekly' | 'monthly' = 'daily'
  ): ChartDataPoint[] {
    if (holdingsData.length === 0) return []

    // Find common time range
    const allTimestamps = holdingsData.flat().map(d => d.timestamp)
    const minTime = Math.min(...allTimestamps)
    const maxTime = Math.max(...allTimestamps)

    const interval = timeframe === 'daily' ? 24 * 60 * 60 * 1000 :
                     timeframe === 'weekly' ? 7 * 24 * 60 * 60 * 1000 :
                     30 * 24 * 60 * 60 * 1000

    const result: ChartDataPoint[] = []

    for (let time = minTime; time <= maxTime; time += interval) {
      let totalValue = 0
      let totalCost = 0

      holdingsData.forEach(assetData => {
        // Find closest data point for this timestamp
        const closestPoint = assetData.reduce((closest, point) => {
          return Math.abs(point.timestamp - time) < Math.abs(closest.timestamp - time)
            ? point
            : closest
        })

        if (closestPoint) {
          totalValue += closestPoint.value
          totalCost += (closestPoint as any).costBasis || 0
        }
      })

      result.push({
        timestamp: time,
        date: new Date(time),
        value: totalValue,
        costBasis: totalCost,
        unrealizedPnL: totalValue - totalCost
      })
    }

    return result
  }

  /**
   * Calculate moving averages for portfolio data
   */
  static calculateMovingAverages(
    data: ChartDataPoint[],
    periods: number[] = [7, 30, 90]
  ): ChartDataPoint[] {
    const result = [...data]

    periods.forEach(period => {
      for (let i = period - 1; i < result.length; i++) {
        const slice = result.slice(i - period + 1, i + 1)
        const average = slice.reduce((sum, point) => sum + point.value, 0) / slice.length

        result[i] = {
          ...result[i],
          [`ma${period}`]: average
        }
      }
    })

    return result
  }

  /**
   * Format data for volume chart
   */
  static formatVolumeData(data: ChartDataPoint[]): ChartDataPoint[] {
    return data.map(point => ({
      ...point,
      value: point.volume || 0
    }))
  }

  /**
   * Format data for percentage change chart
   */
  static formatPercentageChangeData(
    data: ChartDataPoint[],
    baseValue?: number
  ): ChartDataPoint[] {
    if (data.length === 0) return []

    const base = baseValue || data[0].value

    return data.map(point => ({
      ...point,
      value: ((point.value - base) / base) * 100,
      absoluteValue: point.value
    }))
  }

  /**
   * Merge multiple data series with different timestamps
   */
  static mergeTimeSeries(
    series: ChartDataPoint[][],
    interpolate: boolean = true
  ): ChartDataPoint[] {
    if (series.length === 0) return []

    // Get all unique timestamps
    const allTimestamps = [...new Set(series.flat().map(d => d.timestamp))].sort()

    const result: ChartDataPoint[] = []

    allTimestamps.forEach(timestamp => {
      const mergedPoint: ChartDataPoint = {
        timestamp,
        date: new Date(timestamp),
        value: 0
      }

      series.forEach((seriesData, index) => {
        const exactMatch = seriesData.find(d => d.timestamp === timestamp)

        if (exactMatch) {
          Object.assign(mergedPoint, exactMatch)
        } else if (interpolate) {
          // Simple linear interpolation
          const before = seriesData.filter(d => d.timestamp < timestamp).pop()
          const after = seriesData.find(d => d.timestamp > timestamp)

          if (before && after) {
            const ratio = (timestamp - before.timestamp) / (after.timestamp - before.timestamp)
            const interpolatedValue = before.value + (after.value - before.value) * ratio
            mergedPoint[`series${index}`] = interpolatedValue
          }
        }
      })

      result.push(mergedPoint)
    })

    return result
  }
}