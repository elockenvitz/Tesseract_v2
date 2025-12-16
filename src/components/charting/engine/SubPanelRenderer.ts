import { ChartTheme } from './types'
import { ChartTransform } from './transform'
import {
  IndicatorValue,
  MACDValue,
  StochasticValue
} from './indicators'

export interface SubPanelConfig {
  id: string
  type: 'rsi' | 'macd' | 'stochastic' | 'custom'
  height: number // Height as percentage of total chart (0.15 = 15%)
  title: string
  range?: [number, number] // Fixed Y range (e.g., [0, 100] for RSI)
  referenceLines?: number[] // Horizontal reference lines (e.g., [30, 70] for RSI)
}

export interface SubPanelData {
  config: SubPanelConfig
  data: IndicatorValue[] | MACDValue[] | StochasticValue[]
}

/**
 * Renders indicator sub-panels below the main chart
 */
export class SubPanelRenderer {
  private ctx: CanvasRenderingContext2D
  private theme: ChartTheme
  private devicePixelRatio: number
  private mainChartTransform: ChartTransform

  constructor(
    ctx: CanvasRenderingContext2D,
    theme: ChartTheme,
    mainChartTransform: ChartTransform,
    devicePixelRatio: number = 1
  ) {
    this.ctx = ctx
    this.theme = theme
    this.mainChartTransform = mainChartTransform
    this.devicePixelRatio = devicePixelRatio
  }

  setTheme(theme: ChartTheme) {
    this.theme = theme
  }

  setMainTransform(transform: ChartTransform) {
    this.mainChartTransform = transform
  }

  // Calculate panel area based on position
  private getPanelArea(
    panelIndex: number,
    panelCount: number,
    totalPanelHeight: number,
    mainChartBottom: number
  ) {
    const dims = this.mainChartTransform.getDimensions()
    const panelHeight = totalPanelHeight / panelCount
    const panelGap = 8

    return {
      x: dims.paddingLeft,
      y: mainChartBottom + panelGap + panelIndex * (panelHeight + panelGap),
      width: dims.width - dims.paddingLeft - dims.paddingRight,
      height: panelHeight - panelGap
    }
  }

  // Convert value to Y coordinate within panel
  private valueToY(
    value: number,
    minValue: number,
    maxValue: number,
    panelY: number,
    panelHeight: number
  ): number {
    const range = maxValue - minValue
    const ratio = (value - minValue) / range
    return panelY + panelHeight - ratio * panelHeight
  }

  // Draw panel background and border
  private drawPanelBackground(area: { x: number; y: number; width: number; height: number }) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    ctx.save()

    // Background
    ctx.fillStyle = this.theme.background
    ctx.fillRect(area.x * dpr, area.y * dpr, area.width * dpr, area.height * dpr)

    // Border
    ctx.strokeStyle = this.theme.gridLines
    ctx.lineWidth = 1 * dpr
    ctx.strokeRect(area.x * dpr, area.y * dpr, area.width * dpr, area.height * dpr)

    ctx.restore()
  }

  // Draw panel title
  private drawPanelTitle(title: string, area: { x: number; y: number }) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    ctx.save()
    ctx.fillStyle = this.theme.textSecondary
    ctx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(title, (area.x + 4) * dpr, (area.y + 4) * dpr)
    ctx.restore()
  }

  // Draw horizontal reference lines
  private drawReferenceLines(
    lines: number[],
    minValue: number,
    maxValue: number,
    area: { x: number; y: number; width: number; height: number }
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    ctx.save()
    ctx.strokeStyle = this.theme.gridLines
    ctx.lineWidth = 1 * dpr
    ctx.setLineDash([4 * dpr, 4 * dpr])

    for (const value of lines) {
      const y = this.valueToY(value, minValue, maxValue, area.y, area.height) * dpr
      ctx.beginPath()
      ctx.moveTo(area.x * dpr, y)
      ctx.lineTo((area.x + area.width) * dpr, y)
      ctx.stroke()

      // Draw label
      ctx.fillStyle = this.theme.textSecondary
      ctx.font = `${9 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(value), (area.x + area.width - 4) * dpr, y)
    }

    ctx.setLineDash([])
    ctx.restore()
  }

  // Draw RSI panel
  drawRSIPanel(
    data: IndicatorValue[],
    area: { x: number; y: number; width: number; height: number }
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.mainChartTransform.getView()

    this.drawPanelBackground(area)
    this.drawPanelTitle('RSI (14)', area)
    this.drawReferenceLines([30, 50, 70], 0, 100, area)

    // Filter visible data
    const visibleData = data.filter(
      d => d.time >= view.startTime && d.time <= view.endTime && d.value !== null
    )

    if (visibleData.length < 2) return

    ctx.save()

    // Draw overbought/oversold zones
    ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'
    ctx.fillRect(
      area.x * dpr,
      this.valueToY(100, 0, 100, area.y, area.height) * dpr,
      area.width * dpr,
      (this.valueToY(70, 0, 100, area.y, area.height) - this.valueToY(100, 0, 100, area.y, area.height)) * dpr
    )

    ctx.fillStyle = 'rgba(34, 197, 94, 0.1)'
    ctx.fillRect(
      area.x * dpr,
      this.valueToY(30, 0, 100, area.y, area.height) * dpr,
      area.width * dpr,
      (this.valueToY(0, 0, 100, area.y, area.height) - this.valueToY(30, 0, 100, area.y, area.height)) * dpr
    )

    // Draw RSI line
    ctx.strokeStyle = '#8b5cf6'
    ctx.lineWidth = 1.5 * dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()

    for (let i = 0; i < visibleData.length; i++) {
      const point = visibleData[i]
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.value!, 0, 100, area.y, area.height) * dpr

      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }

    ctx.stroke()
    ctx.restore()
  }

  // Draw MACD panel
  drawMACDPanel(
    data: MACDValue[],
    area: { x: number; y: number; width: number; height: number }
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.mainChartTransform.getView()

    this.drawPanelBackground(area)
    this.drawPanelTitle('MACD (12, 26, 9)', area)

    // Filter visible data
    const visibleData = data.filter(
      d => d.time >= view.startTime && d.time <= view.endTime && d.macd !== null
    )

    if (visibleData.length < 2) return

    // Calculate range
    let minValue = Infinity
    let maxValue = -Infinity
    for (const d of visibleData) {
      if (d.macd !== null) {
        minValue = Math.min(minValue, d.macd)
        maxValue = Math.max(maxValue, d.macd)
      }
      if (d.signal !== null) {
        minValue = Math.min(minValue, d.signal)
        maxValue = Math.max(maxValue, d.signal)
      }
      if (d.histogram !== null) {
        minValue = Math.min(minValue, d.histogram)
        maxValue = Math.max(maxValue, d.histogram)
      }
    }

    // Add padding
    const range = maxValue - minValue
    minValue -= range * 0.1
    maxValue += range * 0.1

    // Draw zero line
    this.drawReferenceLines([0], minValue, maxValue, area)

    ctx.save()

    // Draw histogram bars
    const barWidth = Math.max(2, (area.width / visibleData.length) * 0.6)
    for (const point of visibleData) {
      if (point.histogram === null) continue

      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const zeroY = this.valueToY(0, minValue, maxValue, area.y, area.height) * dpr
      const histY = this.valueToY(point.histogram, minValue, maxValue, area.y, area.height) * dpr

      ctx.fillStyle = point.histogram >= 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)'
      ctx.fillRect(
        x - (barWidth * dpr) / 2,
        Math.min(zeroY, histY),
        barWidth * dpr,
        Math.abs(histY - zeroY)
      )
    }

    // Draw MACD line
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1.5 * dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()

    let started = false
    for (const point of visibleData) {
      if (point.macd === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.macd, minValue, maxValue, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    // Draw signal line
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()

    started = false
    for (const point of visibleData) {
      if (point.signal === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.signal, minValue, maxValue, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    ctx.restore()
  }

  // Draw Stochastic panel
  drawStochasticPanel(
    data: StochasticValue[],
    area: { x: number; y: number; width: number; height: number }
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.mainChartTransform.getView()

    this.drawPanelBackground(area)
    this.drawPanelTitle('Stochastic (14, 3)', area)
    this.drawReferenceLines([20, 50, 80], 0, 100, area)

    // Filter visible data
    const visibleData = data.filter(
      d => d.time >= view.startTime && d.time <= view.endTime
    )

    if (visibleData.length < 2) return

    ctx.save()

    // Draw overbought/oversold zones
    ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'
    ctx.fillRect(
      area.x * dpr,
      this.valueToY(100, 0, 100, area.y, area.height) * dpr,
      area.width * dpr,
      (this.valueToY(80, 0, 100, area.y, area.height) - this.valueToY(100, 0, 100, area.y, area.height)) * dpr
    )

    ctx.fillStyle = 'rgba(34, 197, 94, 0.1)'
    ctx.fillRect(
      area.x * dpr,
      this.valueToY(20, 0, 100, area.y, area.height) * dpr,
      area.width * dpr,
      (this.valueToY(0, 0, 100, area.y, area.height) - this.valueToY(20, 0, 100, area.y, area.height)) * dpr
    )

    // Draw %K line
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1.5 * dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()

    let started = false
    for (const point of visibleData) {
      if (point.k === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.k, 0, 100, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    // Draw %D line
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()

    started = false
    for (const point of visibleData) {
      if (point.d === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.d, 0, 100, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    ctx.restore()
  }

  // Draw generic line indicator panel (ATR, ADX, OBV, etc.)
  drawLinePanel(
    data: IndicatorValue[],
    title: string,
    color: string,
    area: { x: number; y: number; width: number; height: number }
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.mainChartTransform.getView()

    this.drawPanelBackground(area)
    this.drawPanelTitle(title, area)

    // Filter visible data
    const visibleData = data.filter(
      d => d.time >= view.startTime && d.time <= view.endTime && d.value !== null
    )

    if (visibleData.length < 2) return

    // Calculate range
    let minValue = Infinity
    let maxValue = -Infinity
    for (const d of visibleData) {
      if (d.value !== null) {
        minValue = Math.min(minValue, d.value)
        maxValue = Math.max(maxValue, d.value)
      }
    }

    // Add padding
    const range = maxValue - minValue
    minValue -= range * 0.1
    maxValue += range * 0.1

    ctx.save()

    // Draw line
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()

    let started = false
    for (const point of visibleData) {
      if (point.value === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.value, minValue, maxValue, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    ctx.restore()
  }

  // Render all sub-panels
  renderSubPanels(
    panels: SubPanelData[],
    mainChartBottom: number,
    totalHeight: number
  ) {
    if (panels.length === 0) return

    const totalPanelHeight = totalHeight - mainChartBottom - 30 // Leave space for time axis
    const panelCount = panels.length

    panels.forEach((panel, index) => {
      const area = this.getPanelArea(index, panelCount, totalPanelHeight, mainChartBottom)

      switch (panel.config.type) {
        case 'rsi':
          this.drawRSIPanel(panel.data as IndicatorValue[], area)
          break
        case 'macd':
          this.drawMACDPanel(panel.data as MACDValue[], area)
          break
        case 'stochastic':
          this.drawStochasticPanel(panel.data as StochasticValue[], area)
          break
        case 'custom':
          this.drawLinePanel(
            panel.data as IndicatorValue[],
            panel.config.title,
            '#2563eb',
            area
          )
          break
      }
    })
  }
}
