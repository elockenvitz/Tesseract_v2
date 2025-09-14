import { mean, median, deviation } from 'd3-array'
import type { ChartDataPoint } from '../types'

export class TechnicalIndicators {
  /**
   * Simple Moving Average
   */
  static sma(data: ChartDataPoint[], period: number, field: string = 'value'): ChartDataPoint[] {
    if (data.length < period) return []

    const result: ChartDataPoint[] = []

    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1)
      const average = mean(slice.map(d => d[field] as number)) || 0

      result.push({
        ...data[i],
        value: average,
        sma: average
      })
    }

    return result
  }

  /**
   * Exponential Moving Average
   */
  static ema(data: ChartDataPoint[], period: number, field: string = 'value'): ChartDataPoint[] {
    if (data.length < period) return []

    const multiplier = 2 / (period + 1)
    const result: ChartDataPoint[] = []

    // Start with SMA for first value
    const firstSMA = mean(data.slice(0, period).map(d => d[field] as number)) || 0
    result.push({
      ...data[period - 1],
      value: firstSMA,
      ema: firstSMA
    })

    // Calculate EMA for remaining values
    for (let i = period; i < data.length; i++) {
      const currentPrice = data[i][field] as number
      const previousEMA = result[result.length - 1].value
      const ema = (currentPrice * multiplier) + (previousEMA * (1 - multiplier))

      result.push({
        ...data[i],
        value: ema,
        ema: ema
      })
    }

    return result
  }

  /**
   * Relative Strength Index
   */
  static rsi(data: ChartDataPoint[], period: number = 14, field: string = 'value'): ChartDataPoint[] {
    if (data.length <= period) return []

    const gains: number[] = []
    const losses: number[] = []

    // Calculate price changes
    for (let i = 1; i < data.length; i++) {
      const change = (data[i][field] as number) - (data[i - 1][field] as number)
      gains.push(change > 0 ? change : 0)
      losses.push(change < 0 ? Math.abs(change) : 0)
    }

    const result: ChartDataPoint[] = []

    for (let i = period - 1; i < gains.length; i++) {
      const avgGain = mean(gains.slice(i - period + 1, i + 1)) || 0
      const avgLoss = mean(losses.slice(i - period + 1, i + 1)) || 0

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      const rsi = 100 - (100 / (1 + rs))

      result.push({
        ...data[i + 1],
        value: rsi,
        rsi: rsi
      })
    }

    return result
  }

  /**
   * MACD (Moving Average Convergence Divergence)
   */
  static macd(
    data: ChartDataPoint[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9,
    field: string = 'value'
  ): { macd: ChartDataPoint[], signal: ChartDataPoint[], histogram: ChartDataPoint[] } {
    const fastEMA = this.ema(data, fastPeriod, field)
    const slowEMA = this.ema(data, slowPeriod, field)

    if (fastEMA.length === 0 || slowEMA.length === 0) {
      return { macd: [], signal: [], histogram: [] }
    }

    // Calculate MACD line
    const macdLine: ChartDataPoint[] = []
    const minLength = Math.min(fastEMA.length, slowEMA.length)

    for (let i = 0; i < minLength; i++) {
      const macdValue = (fastEMA[fastEMA.length - minLength + i]?.value || 0) -
                       (slowEMA[slowEMA.length - minLength + i]?.value || 0)

      macdLine.push({
        ...data[data.length - minLength + i],
        value: macdValue,
        macd: macdValue
      })
    }

    // Calculate signal line (EMA of MACD)
    const signalLine = this.ema(macdLine, signalPeriod, 'value')

    // Calculate histogram
    const histogram: ChartDataPoint[] = []
    const histMinLength = Math.min(macdLine.length, signalLine.length)

    for (let i = 0; i < histMinLength; i++) {
      const macdValue = macdLine[macdLine.length - histMinLength + i]?.value || 0
      const signalValue = signalLine[i]?.value || 0
      const histValue = macdValue - signalValue

      histogram.push({
        ...data[data.length - histMinLength + i],
        value: histValue,
        histogram: histValue
      })
    }

    return {
      macd: macdLine,
      signal: signalLine,
      histogram: histogram
    }
  }

  /**
   * Bollinger Bands
   */
  static bollingerBands(
    data: ChartDataPoint[],
    period: number = 20,
    multiplier: number = 2,
    field: string = 'value'
  ): { upper: ChartDataPoint[], middle: ChartDataPoint[], lower: ChartDataPoint[] } {
    if (data.length < period) return { upper: [], middle: [], lower: [] }

    const middle: ChartDataPoint[] = []
    const upper: ChartDataPoint[] = []
    const lower: ChartDataPoint[] = []

    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1).map(d => d[field] as number)
      const sma = mean(slice) || 0
      const stdDev = deviation(slice) || 0

      const upperBand = sma + (multiplier * stdDev)
      const lowerBand = sma - (multiplier * stdDev)

      middle.push({ ...data[i], value: sma, sma: sma })
      upper.push({ ...data[i], value: upperBand, upper: upperBand })
      lower.push({ ...data[i], value: lowerBand, lower: lowerBand })
    }

    return { upper, middle, lower }
  }

  /**
   * Volume Weighted Average Price (VWAP)
   */
  static vwap(data: ChartDataPoint[]): ChartDataPoint[] {
    const result: ChartDataPoint[] = []
    let cumulativeVolume = 0
    let cumulativeVolumePrice = 0

    for (let i = 0; i < data.length; i++) {
      const point = data[i]
      const price = point.close || point.value
      const volume = point.volume || 0

      cumulativeVolume += volume
      cumulativeVolumePrice += price * volume

      const vwap = cumulativeVolume > 0 ? cumulativeVolumePrice / cumulativeVolume : price

      result.push({
        ...point,
        value: vwap,
        vwap: vwap
      })
    }

    return result
  }

  /**
   * Calculate percentage change between two points
   */
  static percentageChange(startValue: number, endValue: number): number {
    if (startValue === 0) return 0
    return ((endValue - startValue) / startValue) * 100
  }

  /**
   * Calculate volatility (standard deviation of returns)
   */
  static volatility(data: ChartDataPoint[], field: string = 'value'): number {
    if (data.length < 2) return 0

    const returns: number[] = []
    for (let i = 1; i < data.length; i++) {
      const currentPrice = data[i][field] as number
      const previousPrice = data[i - 1][field] as number
      if (previousPrice !== 0) {
        returns.push((currentPrice - previousPrice) / previousPrice)
      }
    }

    return deviation(returns) || 0
  }
}