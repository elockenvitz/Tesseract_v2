import { OHLC, ViewState, ChartDimensions, Bounds } from './types'

/**
 * Chart coordinate transformation utilities
 * Handles conversion between data coordinates (price/time) and pixel coordinates
 */
export class ChartTransform {
  private dimensions: ChartDimensions
  private view: ViewState

  constructor(dimensions: ChartDimensions, view: ViewState) {
    this.dimensions = dimensions
    this.view = view
  }

  // Get the drawable area (excluding margins)
  get chartArea(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.dimensions.marginLeft,
      y: this.dimensions.marginTop,
      width: this.dimensions.width - this.dimensions.marginLeft - this.dimensions.marginRight,
      height: this.dimensions.height - this.dimensions.marginTop - this.dimensions.marginBottom
    }
  }

  // Time to X pixel coordinate
  timeToX(time: number): number {
    const { x, width } = this.chartArea
    const timeRange = this.view.endTime - this.view.startTime
    if (timeRange === 0) return x
    return x + ((time - this.view.startTime) / timeRange) * width
  }

  // X pixel to time coordinate
  xToTime(pixelX: number): number {
    const { x, width } = this.chartArea
    const timeRange = this.view.endTime - this.view.startTime
    return this.view.startTime + ((pixelX - x) / width) * timeRange
  }

  // Price to Y pixel coordinate (inverted - higher price = lower Y)
  priceToY(price: number): number {
    const { y, height } = this.chartArea
    const priceRange = this.view.maxPrice - this.view.minPrice
    if (priceRange === 0) return y + height / 2
    return y + height - ((price - this.view.minPrice) / priceRange) * height
  }

  // Y pixel to price coordinate
  yToPrice(pixelY: number): number {
    const { y, height } = this.chartArea
    const priceRange = this.view.maxPrice - this.view.minPrice
    return this.view.minPrice + ((y + height - pixelY) / height) * priceRange
  }

  // Get pixel bounds for a data point
  getPixelBounds(data: OHLC): { x: number; yOpen: number; yClose: number; yHigh: number; yLow: number } {
    return {
      x: this.timeToX(data.time),
      yOpen: this.priceToY(data.open),
      yClose: this.priceToY(data.close),
      yHigh: this.priceToY(data.high),
      yLow: this.priceToY(data.low)
    }
  }

  // Calculate bar width based on data density
  getBarWidth(dataLength: number): number {
    const { width } = this.chartArea
    const visibleBars = dataLength
    if (visibleBars <= 0) return 10
    // Leave some space between bars (80% bar, 20% gap)
    const rawWidth = (width / visibleBars) * 0.8
    return Math.max(1, Math.min(rawWidth, 20)) // Clamp between 1 and 20 pixels
  }

  // Calculate price range from data with padding
  static calculatePriceRange(data: OHLC[], paddingPercent: number = 0.1): { min: number; max: number } {
    if (data.length === 0) return { min: 0, max: 100 }

    let min = Infinity
    let max = -Infinity

    for (const bar of data) {
      if (bar.low < min) min = bar.low
      if (bar.high > max) max = bar.high
    }

    // Add padding
    const range = max - min
    const padding = range * paddingPercent

    return {
      min: min - padding,
      max: max + padding
    }
  }

  // Calculate time range from data
  static calculateTimeRange(data: OHLC[]): { start: number; end: number } {
    if (data.length === 0) {
      const now = Date.now() / 1000
      return { start: now - 86400 * 30, end: now }
    }

    return {
      start: data[0].time,
      end: data[data.length - 1].time
    }
  }

  // Get nice tick values for an axis
  static getNiceTicks(min: number, max: number, targetCount: number = 5): number[] {
    const range = max - min
    if (range === 0) return [min]

    // Find a nice step size
    const roughStep = range / targetCount
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
    const residual = roughStep / magnitude

    let niceStep: number
    if (residual <= 1.5) niceStep = magnitude
    else if (residual <= 3) niceStep = 2 * magnitude
    else if (residual <= 7) niceStep = 5 * magnitude
    else niceStep = 10 * magnitude

    const ticks: number[] = []
    const start = Math.ceil(min / niceStep) * niceStep

    for (let tick = start; tick <= max; tick += niceStep) {
      ticks.push(tick)
    }

    return ticks
  }

  // Format price for display
  static formatPrice(price: number): string {
    if (price >= 1000) {
      return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } else if (price >= 1) {
      return price.toFixed(2)
    } else {
      return price.toFixed(4)
    }
  }

  // Format time for display based on timeframe
  static formatTime(timestamp: number, detailed: boolean = false): string {
    const date = new Date(timestamp * 1000)

    if (detailed) {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }

  // Format time for axis labels
  static formatTimeAxis(timestamp: number, timeRange: number): string {
    const date = new Date(timestamp * 1000)
    const dayInSeconds = 86400

    // Less than 2 days - show time
    if (timeRange < dayInSeconds * 2) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    // Less than 60 days - show month/day
    else if (timeRange < dayInSeconds * 60) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
    // Less than 2 years - show month/year
    else if (timeRange < dayInSeconds * 730) {
      return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    }
    // More than 2 years - show year
    else {
      return date.getFullYear().toString()
    }
  }

  // Update dimensions
  setDimensions(dimensions: ChartDimensions) {
    this.dimensions = dimensions
  }

  // Update view
  setView(view: ViewState) {
    this.view = view
  }

  // Get current view
  getView(): ViewState {
    return { ...this.view }
  }

  // Get current dimensions
  getDimensions(): ChartDimensions {
    return { ...this.dimensions }
  }
}

// Calculate appropriate time interval for grid lines
export function getTimeGridInterval(timeRange: number): number {
  const dayInSeconds = 86400
  const hourInSeconds = 3600

  if (timeRange < hourInSeconds * 6) return hourInSeconds / 2 // 30 min
  if (timeRange < dayInSeconds) return hourInSeconds * 2 // 2 hours
  if (timeRange < dayInSeconds * 7) return dayInSeconds // 1 day
  if (timeRange < dayInSeconds * 30) return dayInSeconds * 7 // 1 week
  if (timeRange < dayInSeconds * 180) return dayInSeconds * 30 // 1 month
  if (timeRange < dayInSeconds * 365 * 2) return dayInSeconds * 90 // 3 months
  return dayInSeconds * 365 // 1 year
}

// Generate future time points for grid extension
export function generateFutureTimePoints(lastTime: number, interval: number, count: number): number[] {
  const points: number[] = []
  for (let i = 1; i <= count; i++) {
    points.push(lastTime + interval * i)
  }
  return points
}
