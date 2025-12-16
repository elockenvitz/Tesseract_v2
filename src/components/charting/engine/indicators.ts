import { OHLC } from './types'

/**
 * Technical indicator calculations
 * All functions return arrays aligned with input data (null for insufficient data points)
 */

export interface IndicatorValue {
  time: number
  value: number | null
}

export interface MACDValue {
  time: number
  macd: number | null
  signal: number | null
  histogram: number | null
}

export interface BollingerValue {
  time: number
  upper: number | null
  middle: number | null
  lower: number | null
}

export interface StochasticValue {
  time: number
  k: number | null
  d: number | null
}

// Simple Moving Average
export function calculateSMA(data: OHLC[], period: number): IndicatorValue[] {
  const result: IndicatorValue[] = []

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ time: data[i].time, value: null })
    } else {
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close
      }
      result.push({ time: data[i].time, value: sum / period })
    }
  }

  return result
}

// Exponential Moving Average
export function calculateEMA(data: OHLC[], period: number): IndicatorValue[] {
  const result: IndicatorValue[] = []
  const multiplier = 2 / (period + 1)

  // Start with SMA for first EMA value
  let ema: number | null = null

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ time: data[i].time, value: null })
    } else if (i === period - 1) {
      // First EMA is SMA
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close
      }
      ema = sum / period
      result.push({ time: data[i].time, value: ema })
    } else {
      ema = (data[i].close - ema!) * multiplier + ema!
      result.push({ time: data[i].time, value: ema })
    }
  }

  return result
}

// Relative Strength Index
export function calculateRSI(data: OHLC[], period: number = 14): IndicatorValue[] {
  const result: IndicatorValue[] = []
  const gains: number[] = []
  const losses: number[] = []

  // Calculate price changes
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)
  }

  // First value is null
  result.push({ time: data[0].time, value: null })

  let avgGain = 0
  let avgLoss = 0

  for (let i = 0; i < gains.length; i++) {
    if (i < period - 1) {
      result.push({ time: data[i + 1].time, value: null })
    } else if (i === period - 1) {
      // First RSI calculation - simple average
      let sumGain = 0, sumLoss = 0
      for (let j = 0; j < period; j++) {
        sumGain += gains[i - j]
        sumLoss += losses[i - j]
      }
      avgGain = sumGain / period
      avgLoss = sumLoss / period

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      const rsi = 100 - (100 / (1 + rs))
      result.push({ time: data[i + 1].time, value: rsi })
    } else {
      // Smoothed average
      avgGain = (avgGain * (period - 1) + gains[i]) / period
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      const rsi = 100 - (100 / (1 + rs))
      result.push({ time: data[i + 1].time, value: rsi })
    }
  }

  return result
}

// MACD (Moving Average Convergence Divergence)
export function calculateMACD(
  data: OHLC[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDValue[] {
  const fastEMA = calculateEMA(data, fastPeriod)
  const slowEMA = calculateEMA(data, slowPeriod)

  // Calculate MACD line
  const macdLine: IndicatorValue[] = data.map((d, i) => ({
    time: d.time,
    value: fastEMA[i].value !== null && slowEMA[i].value !== null
      ? fastEMA[i].value! - slowEMA[i].value!
      : null
  }))

  // Calculate signal line (EMA of MACD)
  const macdData: OHLC[] = macdLine
    .filter(m => m.value !== null)
    .map(m => ({
      time: m.time,
      open: m.value!,
      high: m.value!,
      low: m.value!,
      close: m.value!
    }))

  const signalEMA = calculateEMA(macdData, signalPeriod)

  // Build result with histogram
  const result: MACDValue[] = []
  let signalIndex = 0

  for (let i = 0; i < data.length; i++) {
    const macdValue = macdLine[i].value

    if (macdValue === null) {
      result.push({ time: data[i].time, macd: null, signal: null, histogram: null })
    } else {
      const signalValue = signalIndex < signalEMA.length ? signalEMA[signalIndex].value : null
      signalIndex++

      result.push({
        time: data[i].time,
        macd: macdValue,
        signal: signalValue,
        histogram: macdValue !== null && signalValue !== null ? macdValue - signalValue : null
      })
    }
  }

  return result
}

// Bollinger Bands
export function calculateBollingerBands(
  data: OHLC[],
  period: number = 20,
  stdDev: number = 2
): BollingerValue[] {
  const sma = calculateSMA(data, period)
  const result: BollingerValue[] = []

  for (let i = 0; i < data.length; i++) {
    if (sma[i].value === null) {
      result.push({ time: data[i].time, upper: null, middle: null, lower: null })
    } else {
      // Calculate standard deviation
      let sumSquares = 0
      for (let j = 0; j < period; j++) {
        const diff = data[i - j].close - sma[i].value!
        sumSquares += diff * diff
      }
      const std = Math.sqrt(sumSquares / period)

      result.push({
        time: data[i].time,
        upper: sma[i].value! + stdDev * std,
        middle: sma[i].value!,
        lower: sma[i].value! - stdDev * std
      })
    }
  }

  return result
}

// Stochastic Oscillator
export function calculateStochastic(
  data: OHLC[],
  kPeriod: number = 14,
  dPeriod: number = 3
): StochasticValue[] {
  const kValues: IndicatorValue[] = []

  // Calculate %K
  for (let i = 0; i < data.length; i++) {
    if (i < kPeriod - 1) {
      kValues.push({ time: data[i].time, value: null })
    } else {
      let highestHigh = -Infinity
      let lowestLow = Infinity

      for (let j = 0; j < kPeriod; j++) {
        if (data[i - j].high > highestHigh) highestHigh = data[i - j].high
        if (data[i - j].low < lowestLow) lowestLow = data[i - j].low
      }

      const k = highestHigh === lowestLow
        ? 50
        : ((data[i].close - lowestLow) / (highestHigh - lowestLow)) * 100

      kValues.push({ time: data[i].time, value: k })
    }
  }

  // Calculate %D (SMA of %K)
  const result: StochasticValue[] = []

  for (let i = 0; i < data.length; i++) {
    if (kValues[i].value === null || i < kPeriod - 1 + dPeriod - 1) {
      result.push({ time: data[i].time, k: kValues[i].value, d: null })
    } else {
      let sum = 0
      for (let j = 0; j < dPeriod; j++) {
        sum += kValues[i - j].value!
      }
      result.push({ time: data[i].time, k: kValues[i].value, d: sum / dPeriod })
    }
  }

  return result
}

// Average True Range
export function calculateATR(data: OHLC[], period: number = 14): IndicatorValue[] {
  const trueRanges: number[] = []

  // Calculate true ranges
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      trueRanges.push(data[i].high - data[i].low)
    } else {
      const tr = Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close)
      )
      trueRanges.push(tr)
    }
  }

  // Calculate ATR using smoothed moving average
  const result: IndicatorValue[] = []
  let atr: number | null = null

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ time: data[i].time, value: null })
    } else if (i === period - 1) {
      // First ATR is simple average
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += trueRanges[i - j]
      }
      atr = sum / period
      result.push({ time: data[i].time, value: atr })
    } else {
      // Smoothed ATR
      atr = (atr! * (period - 1) + trueRanges[i]) / period
      result.push({ time: data[i].time, value: atr })
    }
  }

  return result
}

// Volume Weighted Average Price
export function calculateVWAP(data: OHLC[]): IndicatorValue[] {
  const result: IndicatorValue[] = []
  let cumulativeTPV = 0 // Typical Price * Volume
  let cumulativeVolume = 0

  for (const bar of data) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3
    const volume = bar.volume || 0

    cumulativeTPV += typicalPrice * volume
    cumulativeVolume += volume

    result.push({
      time: bar.time,
      value: cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null
    })
  }

  return result
}

// On-Balance Volume
export function calculateOBV(data: OHLC[]): IndicatorValue[] {
  const result: IndicatorValue[] = []
  let obv = 0

  for (let i = 0; i < data.length; i++) {
    const volume = data[i].volume || 0

    if (i === 0) {
      obv = volume
    } else if (data[i].close > data[i - 1].close) {
      obv += volume
    } else if (data[i].close < data[i - 1].close) {
      obv -= volume
    }
    // If close equals previous close, OBV stays the same

    result.push({ time: data[i].time, value: obv })
  }

  return result
}

// ADX (Average Directional Index)
export function calculateADX(data: OHLC[], period: number = 14): IndicatorValue[] {
  if (data.length < period + 1) {
    return data.map(d => ({ time: d.time, value: null }))
  }

  const plusDM: number[] = []
  const minusDM: number[] = []
  const tr: number[] = []

  // Calculate +DM, -DM, and TR
  for (let i = 1; i < data.length; i++) {
    const highDiff = data[i].high - data[i - 1].high
    const lowDiff = data[i - 1].low - data[i].low

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0)
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0)

    tr.push(Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    ))
  }

  // Smooth the values
  const smoothedPlusDM: number[] = []
  const smoothedMinusDM: number[] = []
  const smoothedTR: number[] = []

  for (let i = 0; i < plusDM.length; i++) {
    if (i < period - 1) {
      smoothedPlusDM.push(0)
      smoothedMinusDM.push(0)
      smoothedTR.push(0)
    } else if (i === period - 1) {
      let sumPlus = 0, sumMinus = 0, sumTR = 0
      for (let j = 0; j < period; j++) {
        sumPlus += plusDM[i - j]
        sumMinus += minusDM[i - j]
        sumTR += tr[i - j]
      }
      smoothedPlusDM.push(sumPlus)
      smoothedMinusDM.push(sumMinus)
      smoothedTR.push(sumTR)
    } else {
      smoothedPlusDM.push(smoothedPlusDM[i - 1] - smoothedPlusDM[i - 1] / period + plusDM[i])
      smoothedMinusDM.push(smoothedMinusDM[i - 1] - smoothedMinusDM[i - 1] / period + minusDM[i])
      smoothedTR.push(smoothedTR[i - 1] - smoothedTR[i - 1] / period + tr[i])
    }
  }

  // Calculate DX and ADX
  const dx: number[] = []

  for (let i = 0; i < smoothedTR.length; i++) {
    if (smoothedTR[i] === 0) {
      dx.push(0)
    } else {
      const plusDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100
      const minusDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100
      const sumDI = plusDI + minusDI
      dx.push(sumDI === 0 ? 0 : Math.abs(plusDI - minusDI) / sumDI * 100)
    }
  }

  // Build result
  const result: IndicatorValue[] = [{ time: data[0].time, value: null }]
  let adx: number | null = null

  for (let i = 0; i < dx.length; i++) {
    if (i < period * 2 - 2) {
      result.push({ time: data[i + 1].time, value: null })
    } else if (i === period * 2 - 2) {
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += dx[i - j]
      }
      adx = sum / period
      result.push({ time: data[i + 1].time, value: adx })
    } else {
      adx = (adx! * (period - 1) + dx[i]) / period
      result.push({ time: data[i + 1].time, value: adx })
    }
  }

  return result
}

// Indicator configuration type
export interface IndicatorConfig {
  type: 'sma' | 'ema' | 'rsi' | 'macd' | 'bollinger' | 'stochastic' | 'atr' | 'vwap' | 'obv' | 'adx'
  params?: Record<string, number>
  color?: string
  lineWidth?: number
  panel?: 'main' | 'separate' // Whether to overlay on main chart or separate panel
}

// Calculate any indicator based on config
export function calculateIndicator(data: OHLC[], config: IndicatorConfig) {
  const params = config.params || {}

  switch (config.type) {
    case 'sma':
      return { type: 'line', data: calculateSMA(data, params.period || 20) }
    case 'ema':
      return { type: 'line', data: calculateEMA(data, params.period || 20) }
    case 'rsi':
      return { type: 'line', data: calculateRSI(data, params.period || 14), panel: 'separate', range: [0, 100] }
    case 'macd':
      return { type: 'macd', data: calculateMACD(data, params.fast || 12, params.slow || 26, params.signal || 9), panel: 'separate' }
    case 'bollinger':
      return { type: 'bollinger', data: calculateBollingerBands(data, params.period || 20, params.stdDev || 2) }
    case 'stochastic':
      return { type: 'stochastic', data: calculateStochastic(data, params.k || 14, params.d || 3), panel: 'separate', range: [0, 100] }
    case 'atr':
      return { type: 'line', data: calculateATR(data, params.period || 14), panel: 'separate' }
    case 'vwap':
      return { type: 'line', data: calculateVWAP(data) }
    case 'obv':
      return { type: 'line', data: calculateOBV(data), panel: 'separate' }
    case 'adx':
      return { type: 'line', data: calculateADX(data, params.period || 14), panel: 'separate', range: [0, 100] }
    default:
      return null
  }
}
