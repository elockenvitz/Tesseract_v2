import { scaleLinear, scaleTime } from 'd3-scale'
import { timeFormat } from 'd3-time-format'
import { extent, bisector } from 'd3-array'
import type { ChartDataPoint, Annotation } from '../types'

export class ChartUtils {
  /**
   * Format timestamp for display
   */
  static formatDate(timestamp: number | string | Date, format: string = '%Y-%m-%d'): string {
    const formatter = timeFormat(format)
    const date = new Date(timestamp)
    return formatter(date)
  }

  /**
   * Format price for display
   */
  static formatPrice(value: number, decimals: number = 2): string {
    if (value >= 1e9) {
      return `$${(value / 1e9).toFixed(1)}B`
    }
    if (value >= 1e6) {
      return `$${(value / 1e6).toFixed(1)}M`
    }
    if (value >= 1e3) {
      return `$${(value / 1e3).toFixed(1)}K`
    }
    return `$${value.toFixed(decimals)}`
  }

  /**
   * Format volume for display
   */
  static formatVolume(volume: number): string {
    if (volume >= 1e9) {
      return `${(volume / 1e9).toFixed(1)}B`
    }
    if (volume >= 1e6) {
      return `${(volume / 1e6).toFixed(1)}M`
    }
    if (volume >= 1e3) {
      return `${(volume / 1e3).toFixed(1)}K`
    }
    return volume.toString()
  }

  /**
   * Format percentage for display
   */
  static formatPercentage(value: number, decimals: number = 2): string {
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(decimals)}%`
  }

  /**
   * Find nearest data point to mouse position
   */
  static findNearestDataPoint(
    data: ChartDataPoint[],
    mouseX: number,
    xScale: any
  ): { point: ChartDataPoint; index: number } | null {
    if (!data.length) return null

    const bisect = bisector((d: ChartDataPoint) => new Date(d.timestamp)).left
    const x0 = xScale.invert(mouseX)
    const index = bisect(data, x0, 1)

    if (index >= data.length) return { point: data[data.length - 1], index: data.length - 1 }
    if (index === 0) return { point: data[0], index: 0 }

    const d0 = data[index - 1]
    const d1 = data[index]
    const point = x0.getTime() - new Date(d0.timestamp).getTime() > new Date(d1.timestamp).getTime() - x0.getTime() ? d1 : d0
    const pointIndex = point === d1 ? index : index - 1

    return { point, index: pointIndex }
  }

  /**
   * Calculate zoom bounds
   */
  static calculateZoomBounds(
    data: ChartDataPoint[],
    startIndex: number,
    endIndex: number,
    field: string = 'value'
  ): { xDomain: [Date, Date]; yDomain: [number, number] } {
    const slicedData = data.slice(startIndex, endIndex + 1)

    if (slicedData.length === 0) {
      return {
        xDomain: [new Date(), new Date()],
        yDomain: [0, 100]
      }
    }

    const xExtent = extent(slicedData, d => new Date(d.timestamp)) as [Date, Date]
    let yExtent: [number, number]

    // For OHLC data, consider all price fields
    if (slicedData[0].high !== undefined && slicedData[0].low !== undefined) {
      const allPrices = slicedData.flatMap(d => [
        d.high as number,
        d.low as number,
        d.open as number,
        d.close as number
      ].filter(p => p !== undefined))
      yExtent = extent(allPrices) as [number, number]
    } else {
      yExtent = extent(slicedData, d => d[field] as number) as [number, number]
    }

    // Add 5% padding to y-axis
    const yPadding = (yExtent[1] - yExtent[0]) * 0.05
    yExtent[0] -= yPadding
    yExtent[1] += yPadding

    return {
      xDomain: xExtent,
      yDomain: yExtent
    }
  }

  /**
   * Generate annotation ID
   */
  static generateAnnotationId(): string {
    return `annotation_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Calculate percentage change annotation
   */
  static createPercentageAnnotation(
    startPoint: ChartDataPoint,
    endPoint: ChartDataPoint,
    xScale: any,
    yScale: any
  ): Annotation {
    const startValue = startPoint.close || startPoint.value
    const endValue = endPoint.close || endPoint.value
    const percentageChange = ((endValue - startValue) / startValue) * 100

    const startX = xScale(new Date(startPoint.timestamp))
    const startY = yScale(startValue)
    const endX = xScale(new Date(endPoint.timestamp))
    const endY = yScale(endValue)

    return {
      id: this.generateAnnotationId(),
      type: 'percentage',
      startX,
      startY,
      endX,
      endY,
      text: `${this.formatPercentage(percentageChange)} (${this.formatPrice(startValue)} → ${this.formatPrice(endValue)})`,
      color: percentageChange >= 0 ? '#10b981' : '#ef4444'
    }
  }

  /**
   * Create trend line annotation
   */
  static createTrendLineAnnotation(
    startPoint: ChartDataPoint,
    endPoint: ChartDataPoint,
    xScale: any,
    yScale: any
  ): Annotation {
    const startValue = startPoint.close || startPoint.value
    const endValue = endPoint.close || endPoint.value

    const startX = xScale(new Date(startPoint.timestamp))
    const startY = yScale(startValue)
    const endX = xScale(new Date(endPoint.timestamp))
    const endY = yScale(endValue)

    return {
      id: this.generateAnnotationId(),
      type: 'trend',
      startX,
      startY,
      endX,
      endY,
      color: '#6366f1',
      strokeWidth: 2
    }
  }

  /**
   * Create horizontal line annotation
   */
  static createHorizontalLineAnnotation(
    value: number,
    xDomain: [Date, Date],
    xScale: any,
    yScale: any,
    label?: string
  ): Annotation {
    return {
      id: this.generateAnnotationId(),
      type: 'line',
      startX: xScale(xDomain[0]),
      startY: yScale(value),
      endX: xScale(xDomain[1]),
      endY: yScale(value),
      text: label || this.formatPrice(value),
      color: '#8b5cf6',
      strokeWidth: 1,
      dashArray: '5,5'
    }
  }

  /**
   * Convert screen coordinates to data coordinates
   */
  static screenToData(
    screenX: number,
    screenY: number,
    xScale: any,
    yScale: any
  ): { x: Date; y: number } {
    return {
      x: xScale.invert(screenX),
      y: yScale.invert(screenY)
    }
  }

  /**
   * Convert data coordinates to screen coordinates
   */
  static dataToScreen(
    dataX: Date,
    dataY: number,
    xScale: any,
    yScale: any
  ): { x: number; y: number } {
    return {
      x: xScale(dataX),
      y: yScale(dataY)
    }
  }

  /**
   * Debounce function for performance optimization
   */
  static debounce<T extends (...args: any[]) => void>(func: T, wait: number): T {
    let timeout: NodeJS.Timeout | null = null
    return ((...args: any[]) => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => func(...args), wait)
    }) as T
  }

  /**
   * Throttle function for performance optimization
   */
  static throttle<T extends (...args: any[]) => void>(func: T, limit: number): T {
    let inThrottle: boolean = false
    return ((...args: any[]) => {
      if (!inThrottle) {
        func(...args)
        inThrottle = true
        setTimeout(() => inThrottle = false, limit)
      }
    }) as T
  }
}