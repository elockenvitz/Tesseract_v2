import { OHLC, ChartTheme, ChartType, ChartDimensions } from './types'
import { ChartTransform, getTimeGridInterval, generateFutureTimePoints } from './transform'
import {
  IndicatorValue,
  MACDValue,
  BollingerValue,
  StochasticValue,
  IndicatorConfig
} from './indicators'

// Line style type
export type LineStyle = 'solid' | 'dashed' | 'dotted'

// Indicator rendering configuration
export interface IndicatorRenderConfig {
  type: 'line' | 'macd' | 'bollinger' | 'stochastic'
  data: IndicatorValue[] | MACDValue[] | BollingerValue[] | StochasticValue[]
  color?: string
  secondaryColor?: string
  lineWidth?: number
  lineStyle?: LineStyle
  label?: string
}

/**
 * Chart renderer - handles all canvas drawing operations
 */
export class ChartRenderer {
  private ctx: CanvasRenderingContext2D
  private theme: ChartTheme
  private transform: ChartTransform
  private devicePixelRatio: number

  constructor(
    ctx: CanvasRenderingContext2D,
    theme: ChartTheme,
    transform: ChartTransform,
    devicePixelRatio: number = 1
  ) {
    this.ctx = ctx
    this.theme = theme
    this.transform = transform
    this.devicePixelRatio = devicePixelRatio
  }

  // Clear the entire canvas
  clear() {
    const dims = this.transform.getDimensions()
    this.ctx.fillStyle = this.theme.background
    this.ctx.fillRect(0, 0, dims.width * this.devicePixelRatio, dims.height * this.devicePixelRatio)
  }

  // Draw grid lines
  drawGrid(data: OHLC[]) {
    const ctx = this.ctx
    const view = this.transform.getView()
    const area = this.transform.chartArea
    const dpr = this.devicePixelRatio

    ctx.save()
    ctx.strokeStyle = this.theme.gridLines
    ctx.lineWidth = 1 * dpr

    // Horizontal grid lines (price levels)
    const priceTicks = ChartTransform.getNiceTicks(view.minPrice, view.maxPrice, 6)
    for (const price of priceTicks) {
      const y = this.transform.priceToY(price) * dpr
      ctx.beginPath()
      ctx.moveTo(area.x * dpr, y)
      ctx.lineTo((area.x + area.width) * dpr, y)
      ctx.stroke()
    }

    // Vertical grid lines (time intervals)
    const timeRange = view.endTime - view.startTime
    const timeInterval = getTimeGridInterval(timeRange)

    // Find first grid line time
    const firstGridTime = Math.ceil(view.startTime / timeInterval) * timeInterval

    // Draw time grid lines including future
    for (let time = firstGridTime; time <= view.endTime; time += timeInterval) {
      const x = this.transform.timeToX(time) * dpr
      if (x >= area.x * dpr && x <= (area.x + area.width) * dpr) {
        ctx.beginPath()
        ctx.moveTo(x, area.y * dpr)
        ctx.lineTo(x, (area.y + area.height) * dpr)
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  // Draw price axis (right side)
  drawPriceAxis() {
    const ctx = this.ctx
    const view = this.transform.getView()
    const dims = this.transform.getDimensions()
    const area = this.transform.chartArea
    const dpr = this.devicePixelRatio

    ctx.save()

    // Draw axis line
    ctx.strokeStyle = this.theme.axisLine
    ctx.lineWidth = 1 * dpr
    ctx.beginPath()
    ctx.moveTo((area.x + area.width) * dpr, area.y * dpr)
    ctx.lineTo((area.x + area.width) * dpr, (area.y + area.height) * dpr)
    ctx.stroke()

    // Draw price labels
    ctx.fillStyle = this.theme.text
    ctx.font = `${11 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    const priceTicks = ChartTransform.getNiceTicks(view.minPrice, view.maxPrice, 6)
    for (const price of priceTicks) {
      const y = this.transform.priceToY(price) * dpr
      const label = ChartTransform.formatPrice(price)
      ctx.fillText(label, (area.x + area.width + 8) * dpr, y)
    }

    ctx.restore()
  }

  // Draw time axis (bottom)
  drawTimeAxis(data: OHLC[]) {
    const ctx = this.ctx
    const view = this.transform.getView()
    const dims = this.transform.getDimensions()
    const area = this.transform.chartArea
    const dpr = this.devicePixelRatio

    ctx.save()

    // Draw axis line
    ctx.strokeStyle = this.theme.axisLine
    ctx.lineWidth = 1 * dpr
    ctx.beginPath()
    ctx.moveTo(area.x * dpr, (area.y + area.height) * dpr)
    ctx.lineTo((area.x + area.width) * dpr, (area.y + area.height) * dpr)
    ctx.stroke()

    // Draw time labels
    ctx.fillStyle = this.theme.textSecondary
    ctx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    const timeRange = view.endTime - view.startTime
    const dayInSeconds = 86400

    // Generate calendar-aligned time labels
    const gridTimes = this.getCalendarAlignedGridTimes(view.startTime, view.endTime, timeRange)

    for (const time of gridTimes) {
      const x = this.transform.timeToX(time) * dpr
      if (x >= area.x * dpr && x <= (area.x + area.width) * dpr) {
        const label = ChartTransform.formatTimeAxis(time, timeRange)
        ctx.fillText(label, x, (area.y + area.height + 8) * dpr)
      }
    }

    ctx.restore()
  }

  // Get calendar-aligned grid times (years align to Jan 1, months to 1st, etc.)
  private getCalendarAlignedGridTimes(startTime: number, endTime: number, timeRange: number): number[] {
    const times: number[] = []
    const dayInSeconds = 86400
    const startDate = new Date(startTime * 1000)
    const endDate = new Date(endTime * 1000)

    // More than 2 years - show year boundaries
    if (timeRange >= dayInSeconds * 730) {
      let year = startDate.getFullYear()
      while (true) {
        const yearStart = new Date(year, 0, 1).getTime() / 1000 // Jan 1st
        if (yearStart > endTime) break
        if (yearStart >= startTime) {
          times.push(yearStart)
        }
        year++
      }
    }
    // 6 months to 2 years - show quarter or month boundaries
    else if (timeRange >= dayInSeconds * 180) {
      let date = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
      const monthInterval = timeRange >= dayInSeconds * 365 ? 3 : 1 // Quarterly or monthly
      while (date.getTime() / 1000 <= endTime) {
        const time = date.getTime() / 1000
        if (time >= startTime) {
          times.push(time)
        }
        date.setMonth(date.getMonth() + monthInterval)
      }
    }
    // 1-6 months - show month boundaries
    else if (timeRange >= dayInSeconds * 30) {
      let date = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
      while (date.getTime() / 1000 <= endTime) {
        const time = date.getTime() / 1000
        if (time >= startTime) {
          times.push(time)
        }
        date.setMonth(date.getMonth() + 1)
      }
    }
    // Less than 1 month - use regular interval-based approach
    else {
      const timeInterval = getTimeGridInterval(timeRange)
      let time = Math.ceil(startTime / timeInterval) * timeInterval
      while (time <= endTime) {
        times.push(time)
        time += timeInterval
      }
    }

    return times
  }

  // Draw candlestick chart
  drawCandlesticks(data: OHLC[]) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const barWidth = this.transform.getBarWidth(data.length) * dpr

    ctx.save()

    for (const bar of data) {
      const { x, yOpen, yClose, yHigh, yLow } = this.transform.getPixelBounds(bar)
      const pixelX = x * dpr
      const isUp = bar.close >= bar.open

      // Draw wick
      ctx.strokeStyle = isUp ? this.theme.upWick : this.theme.downWick
      ctx.lineWidth = 1 * dpr
      ctx.beginPath()
      ctx.moveTo(pixelX, yHigh * dpr)
      ctx.lineTo(pixelX, yLow * dpr)
      ctx.stroke()

      // Draw body
      ctx.fillStyle = isUp ? this.theme.upColor : this.theme.downColor
      const bodyTop = Math.min(yOpen, yClose) * dpr
      const bodyHeight = Math.abs(yClose - yOpen) * dpr || 1 * dpr
      ctx.fillRect(
        pixelX - barWidth / 2,
        bodyTop,
        barWidth,
        bodyHeight
      )
    }

    ctx.restore()
  }

  // Draw OHLC bar chart
  drawBars(data: OHLC[]) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const barWidth = this.transform.getBarWidth(data.length) * dpr

    ctx.save()
    ctx.lineWidth = 1.5 * dpr

    for (const bar of data) {
      const { x, yOpen, yClose, yHigh, yLow } = this.transform.getPixelBounds(bar)
      const pixelX = x * dpr
      const isUp = bar.close >= bar.open

      ctx.strokeStyle = isUp ? this.theme.upColor : this.theme.downColor

      // Vertical line (high to low)
      ctx.beginPath()
      ctx.moveTo(pixelX, yHigh * dpr)
      ctx.lineTo(pixelX, yLow * dpr)
      ctx.stroke()

      // Open tick (left)
      ctx.beginPath()
      ctx.moveTo(pixelX - barWidth / 2, yOpen * dpr)
      ctx.lineTo(pixelX, yOpen * dpr)
      ctx.stroke()

      // Close tick (right)
      ctx.beginPath()
      ctx.moveTo(pixelX, yClose * dpr)
      ctx.lineTo(pixelX + barWidth / 2, yClose * dpr)
      ctx.stroke()
    }

    ctx.restore()
  }

  // Draw line chart
  drawLine(data: OHLC[], color?: string, lineWidth?: number, lineStyle?: LineStyle) {
    if (data.length < 2) return

    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    ctx.save()
    ctx.strokeStyle = color || this.theme.lineColor
    ctx.lineWidth = (lineWidth || 2) * dpr
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Apply line style
    if (lineStyle === 'dashed') {
      ctx.setLineDash([6 * dpr, 4 * dpr])
    } else if (lineStyle === 'dotted') {
      ctx.setLineDash([2 * dpr, 3 * dpr])
    }

    ctx.beginPath()
    const first = data[0]
    ctx.moveTo(this.transform.timeToX(first.time) * dpr, this.transform.priceToY(first.close) * dpr)

    for (let i = 1; i < data.length; i++) {
      const bar = data[i]
      ctx.lineTo(this.transform.timeToX(bar.time) * dpr, this.transform.priceToY(bar.close) * dpr)
    }

    ctx.stroke()
    ctx.restore()
  }

  // Draw area chart
  drawArea(data: OHLC[], color?: string, lineWidth?: number, lineStyle?: LineStyle) {
    if (data.length < 2) return

    const ctx = this.ctx
    const area = this.transform.chartArea
    const dpr = this.devicePixelRatio
    const strokeColor = color || this.theme.areaBorder

    ctx.save()

    // Draw filled area
    ctx.beginPath()
    const first = data[0]
    ctx.moveTo(this.transform.timeToX(first.time) * dpr, (area.y + area.height) * dpr)
    ctx.lineTo(this.transform.timeToX(first.time) * dpr, this.transform.priceToY(first.close) * dpr)

    for (let i = 1; i < data.length; i++) {
      const bar = data[i]
      ctx.lineTo(this.transform.timeToX(bar.time) * dpr, this.transform.priceToY(bar.close) * dpr)
    }

    const last = data[data.length - 1]
    ctx.lineTo(this.transform.timeToX(last.time) * dpr, (area.y + area.height) * dpr)
    ctx.closePath()

    // Use a semi-transparent version of the stroke color for fill
    ctx.fillStyle = color ? `${color}20` : this.theme.areaFill
    ctx.fill()

    // Draw line on top
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = (lineWidth || 2) * dpr
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Apply line style
    if (lineStyle === 'dashed') {
      ctx.setLineDash([6 * dpr, 4 * dpr])
    } else if (lineStyle === 'dotted') {
      ctx.setLineDash([2 * dpr, 3 * dpr])
    }

    ctx.beginPath()
    ctx.moveTo(this.transform.timeToX(first.time) * dpr, this.transform.priceToY(first.close) * dpr)

    for (let i = 1; i < data.length; i++) {
      const bar = data[i]
      ctx.lineTo(this.transform.timeToX(bar.time) * dpr, this.transform.priceToY(bar.close) * dpr)
    }

    ctx.stroke()
    ctx.restore()
  }

  // Draw volume bars
  drawVolume(data: OHLC[], volumeHeight: number = 0.15) {
    const ctx = this.ctx
    const area = this.transform.chartArea
    const dpr = this.devicePixelRatio
    const barWidth = this.transform.getBarWidth(data.length) * dpr

    // Find max volume
    let maxVolume = 0
    for (const bar of data) {
      if (bar.volume && bar.volume > maxVolume) {
        maxVolume = bar.volume
      }
    }
    if (maxVolume === 0) return

    ctx.save()

    const volumeAreaHeight = area.height * volumeHeight
    const volumeAreaTop = area.y + area.height - volumeAreaHeight

    for (const bar of data) {
      if (!bar.volume) continue

      const x = this.transform.timeToX(bar.time) * dpr
      const isUp = bar.close >= bar.open
      const height = (bar.volume / maxVolume) * volumeAreaHeight * dpr
      const y = (volumeAreaTop + volumeAreaHeight) * dpr - height

      ctx.fillStyle = isUp ? this.theme.volumeUp : this.theme.volumeDown
      ctx.fillRect(x - barWidth / 2, y, barWidth, height)
    }

    ctx.restore()
  }

  // Draw crosshair
  drawCrosshair(mouseX: number, mouseY: number, currentPrice: number | null) {
    const ctx = this.ctx
    const area = this.transform.chartArea
    const dims = this.transform.getDimensions()
    const dpr = this.devicePixelRatio

    // Check if mouse is in chart area
    if (mouseX < area.x || mouseX > area.x + area.width ||
        mouseY < area.y || mouseY > area.y + area.height) {
      return
    }

    ctx.save()

    // Draw crosshair lines
    ctx.strokeStyle = this.theme.crosshair
    ctx.lineWidth = 1 * dpr
    ctx.setLineDash([4 * dpr, 4 * dpr])

    // Vertical line
    ctx.beginPath()
    ctx.moveTo(mouseX * dpr, area.y * dpr)
    ctx.lineTo(mouseX * dpr, (area.y + area.height) * dpr)
    ctx.stroke()

    // Horizontal line
    ctx.beginPath()
    ctx.moveTo(area.x * dpr, mouseY * dpr)
    ctx.lineTo((area.x + area.width) * dpr, mouseY * dpr)
    ctx.stroke()

    ctx.setLineDash([])

    // Draw price label on Y axis
    const price = this.transform.yToPrice(mouseY)
    const priceLabel = ChartTransform.formatPrice(price)

    ctx.fillStyle = '#6b7280'
    const labelWidth = 70 * dpr
    const labelHeight = 20 * dpr
    const labelX = (area.x + area.width) * dpr
    const labelY = mouseY * dpr - labelHeight / 2

    ctx.fillRect(labelX, labelY, labelWidth, labelHeight)
    ctx.fillStyle = '#ffffff'
    ctx.font = `${11 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(priceLabel, labelX + labelWidth / 2, mouseY * dpr)

    // Draw time label on X axis
    const time = this.transform.xToTime(mouseX)
    const timeLabel = ChartTransform.formatTime(time, true)

    ctx.fillStyle = '#6b7280'
    const timeLabelWidth = ctx.measureText(timeLabel).width + 16 * dpr
    const timeLabelHeight = 18 * dpr
    const timeLabelX = mouseX * dpr - timeLabelWidth / 2
    const timeLabelY = (area.y + area.height) * dpr

    ctx.fillRect(timeLabelX, timeLabelY, timeLabelWidth, timeLabelHeight)
    ctx.fillStyle = '#ffffff'
    ctx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(timeLabel, mouseX * dpr, timeLabelY + timeLabelHeight / 2)

    ctx.restore()
  }

  // Main render function
  render(data: OHLC[], chartType: ChartType, showVolume: boolean = false, crosshair?: { x: number; y: number }) {
    this.clear()
    this.drawGrid(data)

    // Draw chart based on type
    switch (chartType) {
      case 'candlestick':
        this.drawCandlesticks(data)
        break
      case 'bar':
        this.drawBars(data)
        break
      case 'line':
        this.drawLine(data)
        break
      case 'area':
        this.drawArea(data)
        break
    }

    // Draw volume if enabled
    if (showVolume) {
      this.drawVolume(data)
    }

    // Draw axes
    this.drawPriceAxis()
    this.drawTimeAxis(data)

    // Draw crosshair if provided
    if (crosshair) {
      this.drawCrosshair(crosshair.x, crosshair.y, null)
    }
  }

  // Update theme
  setTheme(theme: ChartTheme) {
    this.theme = theme
  }

  // Update transform
  setTransform(transform: ChartTransform) {
    this.transform = transform
  }

  // Draw a simple indicator line (SMA, EMA, VWAP, etc.)
  drawIndicatorLine(
    data: IndicatorValue[],
    color: string = '#2563eb',
    lineWidth: number = 1.5,
    lineStyle: LineStyle = 'solid'
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const validPoints = data.filter(d => d.value !== null)

    if (validPoints.length < 2) return

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth * dpr
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Apply line style
    if (lineStyle === 'dashed') {
      ctx.setLineDash([6 * dpr, 4 * dpr])
    } else if (lineStyle === 'dotted') {
      ctx.setLineDash([2 * dpr, 3 * dpr])
    }

    ctx.beginPath()
    let started = false

    for (const point of validPoints) {
      const x = this.transform.timeToX(point.time) * dpr
      const y = this.transform.priceToY(point.value!) * dpr

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

  // Draw Bollinger Bands (upper, middle, lower with fill)
  drawBollingerBands(
    data: BollingerValue[],
    upperColor: string = '#9333ea',
    middleColor: string = '#7c3aed',
    lowerColor: string = '#9333ea',
    fillColor: string = 'rgba(147, 51, 234, 0.1)'
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const validPoints = data.filter(d => d.upper !== null && d.middle !== null && d.lower !== null)

    if (validPoints.length < 2) return

    ctx.save()

    // Draw fill between upper and lower bands
    ctx.beginPath()
    ctx.fillStyle = fillColor

    // Upper band forward
    for (let i = 0; i < validPoints.length; i++) {
      const point = validPoints[i]
      const x = this.transform.timeToX(point.time) * dpr
      const y = this.transform.priceToY(point.upper!) * dpr

      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }

    // Lower band backward
    for (let i = validPoints.length - 1; i >= 0; i--) {
      const point = validPoints[i]
      const x = this.transform.timeToX(point.time) * dpr
      const y = this.transform.priceToY(point.lower!) * dpr
      ctx.lineTo(x, y)
    }

    ctx.closePath()
    ctx.fill()

    // Draw upper band line
    ctx.strokeStyle = upperColor
    ctx.lineWidth = 1 * dpr
    ctx.beginPath()
    for (let i = 0; i < validPoints.length; i++) {
      const point = validPoints[i]
      const x = this.transform.timeToX(point.time) * dpr
      const y = this.transform.priceToY(point.upper!) * dpr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Draw middle band line
    ctx.strokeStyle = middleColor
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()
    for (let i = 0; i < validPoints.length; i++) {
      const point = validPoints[i]
      const x = this.transform.timeToX(point.time) * dpr
      const y = this.transform.priceToY(point.middle!) * dpr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Draw lower band line
    ctx.strokeStyle = lowerColor
    ctx.lineWidth = 1 * dpr
    ctx.beginPath()
    for (let i = 0; i < validPoints.length; i++) {
      const point = validPoints[i]
      const x = this.transform.timeToX(point.time) * dpr
      const y = this.transform.priceToY(point.lower!) * dpr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    ctx.restore()
  }

  // Draw indicators on main chart
  drawMainChartIndicators(indicators: IndicatorRenderConfig[]) {
    for (const indicator of indicators) {
      switch (indicator.type) {
        case 'line':
          this.drawIndicatorLine(
            indicator.data as IndicatorValue[],
            indicator.color || '#2563eb',
            indicator.lineWidth || 1.5,
            indicator.lineStyle || 'solid'
          )
          break
        case 'bollinger':
          this.drawBollingerBands(indicator.data as BollingerValue[])
          break
      }
    }
  }

  // Draw selection dots along a line to indicate it's selected
  drawSelectionDots(data: OHLC[], color: string = '#3b82f6') {
    if (data.length === 0) return

    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.transform.getView()

    // Filter to visible data
    const visibleData = data.filter(d => d.time >= view.startTime && d.time <= view.endTime)
    if (visibleData.length === 0) return

    // Determine dot spacing - show roughly 15-25 dots max
    const targetDots = 20
    const step = Math.max(1, Math.floor(visibleData.length / targetDots))

    ctx.save()
    ctx.fillStyle = color
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5 * dpr

    for (let i = 0; i < visibleData.length; i += step) {
      const d = visibleData[i]
      const x = this.transform.timeToX(d.time) * dpr
      const y = this.transform.priceToY(d.close) * dpr
      const radius = 4 * dpr

      // Draw dot with white outline for visibility
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // Always draw dots at start and end
    const first = visibleData[0]
    const last = visibleData[visibleData.length - 1]

    for (const d of [first, last]) {
      const x = this.transform.timeToX(d.time) * dpr
      const y = this.transform.priceToY(d.close) * dpr
      const radius = 4 * dpr

      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    ctx.restore()
  }

  // Render with indicators
  renderWithIndicators(
    data: OHLC[],
    chartType: ChartType,
    showVolume: boolean = false,
    mainIndicators: IndicatorRenderConfig[] = [],
    crosshair?: { x: number; y: number },
    mainSymbolStyle?: { color?: string; lineWidth?: number; lineStyle?: LineStyle }
  ) {
    this.clear()
    this.drawGrid(data)

    // Draw chart based on type
    switch (chartType) {
      case 'candlestick':
        this.drawCandlesticks(data)
        break
      case 'bar':
        this.drawBars(data)
        break
      case 'line':
        this.drawLine(data, mainSymbolStyle?.color, mainSymbolStyle?.lineWidth, mainSymbolStyle?.lineStyle)
        break
      case 'area':
        this.drawArea(data, mainSymbolStyle?.color, mainSymbolStyle?.lineWidth, mainSymbolStyle?.lineStyle)
        break
    }

    // Draw main chart indicators (overlays)
    this.drawMainChartIndicators(mainIndicators)

    // Draw volume if enabled
    if (showVolume) {
      this.drawVolume(data)
    }

    // Draw axes
    this.drawPriceAxis()
    this.drawTimeAxis(data)

    // Draw crosshair if provided
    if (crosshair) {
      this.drawCrosshair(crosshair.x, crosshair.y, null)
    }
  }
}
