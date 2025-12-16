import { ChartTheme } from './types'
import { ChartTransform } from './transform'

// Event types for chart markers
export type EventType = 'earnings' | 'dividend' | 'split' | 'news' | 'custom'

export interface ChartEvent {
  id: string
  time: number // Unix timestamp
  type: EventType
  title: string
  description?: string
  color?: string
  icon?: string
}

// Annotation types for drawing tools
export type AnnotationType =
  | 'horizontal-line'
  | 'vertical-line'
  | 'trend-line'
  | 'ray'
  | 'rectangle'
  | 'ellipse'
  | 'fibonacci'
  | 'text'
  | 'arrow'

export interface AnnotationStyle {
  color: string
  lineWidth: number
  lineStyle: 'solid' | 'dashed' | 'dotted'
  fillColor?: string
  fillOpacity?: number
  fontSize?: number
}

export interface BaseAnnotation {
  id: string
  type: AnnotationType
  style: AnnotationStyle
  locked?: boolean
  visible?: boolean
}

export interface LineAnnotation extends BaseAnnotation {
  type: 'horizontal-line' | 'vertical-line' | 'trend-line' | 'ray'
  // For horizontal-line: price level
  // For vertical-line: time
  // For trend-line/ray: start and end points
  startTime?: number
  startPrice?: number
  endTime?: number
  endPrice?: number
  price?: number // For horizontal line
  time?: number // For vertical line
  label?: string
}

export interface ShapeAnnotation extends BaseAnnotation {
  type: 'rectangle' | 'ellipse'
  startTime: number
  startPrice: number
  endTime: number
  endPrice: number
}

export interface FibonacciAnnotation extends BaseAnnotation {
  type: 'fibonacci'
  startTime: number
  startPrice: number
  endTime: number
  endPrice: number
  levels: number[] // e.g., [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text'
  time: number
  price: number
  text: string
  anchor: 'left' | 'center' | 'right'
}

export interface ArrowAnnotation extends BaseAnnotation {
  type: 'arrow'
  startTime: number
  startPrice: number
  endTime: number
  endPrice: number
}

export type Annotation =
  | LineAnnotation
  | ShapeAnnotation
  | FibonacciAnnotation
  | TextAnnotation
  | ArrowAnnotation

// Default styles
export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
  color: '#2563eb',
  lineWidth: 1.5,
  lineStyle: 'solid',
  fillOpacity: 0.1
}

export const DEFAULT_FIBONACCI_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

// Event icon mapping
const EVENT_ICONS: Record<EventType, string> = {
  earnings: 'E',
  dividend: 'D',
  split: 'S',
  news: 'N',
  custom: '•'
}

const EVENT_COLORS: Record<EventType, string> = {
  earnings: '#8b5cf6',
  dividend: '#22c55e',
  split: '#f59e0b',
  news: '#3b82f6',
  custom: '#6b7280'
}

/**
 * Renderer for chart events and annotations
 */
export class AnnotationRenderer {
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

  setTheme(theme: ChartTheme) {
    this.theme = theme
  }

  setTransform(transform: ChartTransform) {
    this.transform = transform
  }

  // Draw a single event marker
  drawEvent(event: ChartEvent) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const area = this.transform.chartArea

    const x = this.transform.timeToX(event.time) * dpr
    const y = (area.y + area.height) * dpr

    // Check if in view
    if (x < area.x * dpr || x > (area.x + area.width) * dpr) return

    const color = event.color || EVENT_COLORS[event.type]
    const icon = event.icon || EVENT_ICONS[event.type]

    ctx.save()

    // Draw marker line
    ctx.strokeStyle = color
    ctx.lineWidth = 1 * dpr
    ctx.setLineDash([2 * dpr, 2 * dpr])
    ctx.beginPath()
    ctx.moveTo(x, area.y * dpr)
    ctx.lineTo(x, y - 20 * dpr)
    ctx.stroke()
    ctx.setLineDash([])

    // Draw marker circle
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y - 10 * dpr, 8 * dpr, 0, Math.PI * 2)
    ctx.fill()

    // Draw icon
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${10 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(icon, x, y - 10 * dpr)

    ctx.restore()
  }

  // Draw all events
  drawEvents(events: ChartEvent[]) {
    const view = this.transform.getView()
    const visibleEvents = events.filter(
      e => e.time >= view.startTime && e.time <= view.endTime
    )

    for (const event of visibleEvents) {
      this.drawEvent(event)
    }
  }

  // Draw horizontal line annotation
  private drawHorizontalLine(annotation: LineAnnotation) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const area = this.transform.chartArea

    if (annotation.price === undefined) return

    const y = this.transform.priceToY(annotation.price) * dpr

    // Check if in view
    if (y < area.y * dpr || y > (area.y + area.height) * dpr) return

    ctx.save()
    ctx.strokeStyle = annotation.style.color
    ctx.lineWidth = annotation.style.lineWidth * dpr

    if (annotation.style.lineStyle === 'dashed') {
      ctx.setLineDash([6 * dpr, 4 * dpr])
    } else if (annotation.style.lineStyle === 'dotted') {
      ctx.setLineDash([2 * dpr, 2 * dpr])
    }

    ctx.beginPath()
    ctx.moveTo(area.x * dpr, y)
    ctx.lineTo((area.x + area.width) * dpr, y)
    ctx.stroke()

    // Draw label
    if (annotation.label) {
      ctx.fillStyle = annotation.style.color
      ctx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(annotation.label, (area.x + 4) * dpr, y - 2 * dpr)
    }

    ctx.restore()
  }

  // Draw vertical line annotation
  private drawVerticalLine(annotation: LineAnnotation) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const area = this.transform.chartArea
    const view = this.transform.getView()

    if (annotation.time === undefined) return

    // Check if in view
    if (annotation.time < view.startTime || annotation.time > view.endTime) return

    const x = this.transform.timeToX(annotation.time) * dpr

    ctx.save()
    ctx.strokeStyle = annotation.style.color
    ctx.lineWidth = annotation.style.lineWidth * dpr

    if (annotation.style.lineStyle === 'dashed') {
      ctx.setLineDash([6 * dpr, 4 * dpr])
    } else if (annotation.style.lineStyle === 'dotted') {
      ctx.setLineDash([2 * dpr, 2 * dpr])
    }

    ctx.beginPath()
    ctx.moveTo(x, area.y * dpr)
    ctx.lineTo(x, (area.y + area.height) * dpr)
    ctx.stroke()

    ctx.restore()
  }

  // Draw trend line or ray
  private drawTrendLine(annotation: LineAnnotation) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const area = this.transform.chartArea

    if (!annotation.startTime || !annotation.startPrice ||
        !annotation.endTime || !annotation.endPrice) return

    const x1 = this.transform.timeToX(annotation.startTime) * dpr
    const y1 = this.transform.priceToY(annotation.startPrice) * dpr
    const x2 = this.transform.timeToX(annotation.endTime) * dpr
    const y2 = this.transform.priceToY(annotation.endPrice) * dpr

    ctx.save()
    ctx.strokeStyle = annotation.style.color
    ctx.lineWidth = annotation.style.lineWidth * dpr

    if (annotation.style.lineStyle === 'dashed') {
      ctx.setLineDash([6 * dpr, 4 * dpr])
    } else if (annotation.style.lineStyle === 'dotted') {
      ctx.setLineDash([2 * dpr, 2 * dpr])
    }

    ctx.beginPath()
    ctx.moveTo(x1, y1)

    if (annotation.type === 'ray') {
      // Extend line to edge of chart
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.sqrt(dx * dx + dy * dy)
      const ux = dx / length
      const uy = dy / length

      // Extend to chart boundary
      const extendLength = Math.max(area.width, area.height) * 2 * dpr
      ctx.lineTo(x1 + ux * extendLength, y1 + uy * extendLength)
    } else {
      ctx.lineTo(x2, y2)
    }

    ctx.stroke()

    // Draw anchor points
    ctx.fillStyle = annotation.style.color
    ctx.beginPath()
    ctx.arc(x1, y1, 4 * dpr, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x2, y2, 4 * dpr, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  // Draw rectangle annotation
  private drawRectangle(annotation: ShapeAnnotation) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    const x1 = this.transform.timeToX(annotation.startTime) * dpr
    const y1 = this.transform.priceToY(annotation.startPrice) * dpr
    const x2 = this.transform.timeToX(annotation.endTime) * dpr
    const y2 = this.transform.priceToY(annotation.endPrice) * dpr

    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)

    ctx.save()

    // Fill
    if (annotation.style.fillColor) {
      ctx.fillStyle = annotation.style.fillColor
      ctx.globalAlpha = annotation.style.fillOpacity || 0.1
      ctx.fillRect(x, y, width, height)
      ctx.globalAlpha = 1
    }

    // Stroke
    ctx.strokeStyle = annotation.style.color
    ctx.lineWidth = annotation.style.lineWidth * dpr

    if (annotation.style.lineStyle === 'dashed') {
      ctx.setLineDash([6 * dpr, 4 * dpr])
    } else if (annotation.style.lineStyle === 'dotted') {
      ctx.setLineDash([2 * dpr, 2 * dpr])
    }

    ctx.strokeRect(x, y, width, height)

    ctx.restore()
  }

  // Draw ellipse annotation
  private drawEllipse(annotation: ShapeAnnotation) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    const x1 = this.transform.timeToX(annotation.startTime) * dpr
    const y1 = this.transform.priceToY(annotation.startPrice) * dpr
    const x2 = this.transform.timeToX(annotation.endTime) * dpr
    const y2 = this.transform.priceToY(annotation.endPrice) * dpr

    const cx = (x1 + x2) / 2
    const cy = (y1 + y2) / 2
    const rx = Math.abs(x2 - x1) / 2
    const ry = Math.abs(y2 - y1) / 2

    ctx.save()

    // Fill
    if (annotation.style.fillColor) {
      ctx.fillStyle = annotation.style.fillColor
      ctx.globalAlpha = annotation.style.fillOpacity || 0.1
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // Stroke
    ctx.strokeStyle = annotation.style.color
    ctx.lineWidth = annotation.style.lineWidth * dpr

    if (annotation.style.lineStyle === 'dashed') {
      ctx.setLineDash([6 * dpr, 4 * dpr])
    } else if (annotation.style.lineStyle === 'dotted') {
      ctx.setLineDash([2 * dpr, 2 * dpr])
    }

    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()

    ctx.restore()
  }

  // Draw Fibonacci retracement
  private drawFibonacci(annotation: FibonacciAnnotation) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const area = this.transform.chartArea

    const x1 = this.transform.timeToX(annotation.startTime) * dpr
    const y1 = this.transform.priceToY(annotation.startPrice) * dpr
    const x2 = this.transform.timeToX(annotation.endTime) * dpr
    const y2 = this.transform.priceToY(annotation.endPrice) * dpr

    const priceRange = annotation.endPrice - annotation.startPrice
    const levels = annotation.levels || DEFAULT_FIBONACCI_LEVELS

    ctx.save()

    for (const level of levels) {
      const price = annotation.startPrice + priceRange * level
      const y = this.transform.priceToY(price) * dpr

      // Check if in view
      if (y < area.y * dpr || y > (area.y + area.height) * dpr) continue

      // Draw level line
      ctx.strokeStyle = annotation.style.color
      ctx.lineWidth = 1 * dpr
      ctx.globalAlpha = level === 0 || level === 1 ? 1 : 0.7
      ctx.setLineDash([4 * dpr, 4 * dpr])

      ctx.beginPath()
      ctx.moveTo(Math.min(x1, x2), y)
      ctx.lineTo(Math.max(x1, x2), y)
      ctx.stroke()

      // Draw label
      ctx.fillStyle = annotation.style.color
      ctx.font = `${9 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${(level * 100).toFixed(1)}%`, Math.max(x1, x2) + 4 * dpr, y)
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }

  // Draw text annotation
  private drawText(annotation: TextAnnotation) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    const x = this.transform.timeToX(annotation.time) * dpr
    const y = this.transform.priceToY(annotation.price) * dpr

    ctx.save()
    ctx.fillStyle = annotation.style.color
    ctx.font = `${(annotation.style.fontSize || 12) * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = annotation.anchor
    ctx.textBaseline = 'middle'
    ctx.fillText(annotation.text, x, y)
    ctx.restore()
  }

  // Draw arrow annotation
  private drawArrow(annotation: ArrowAnnotation) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    const x1 = this.transform.timeToX(annotation.startTime) * dpr
    const y1 = this.transform.priceToY(annotation.startPrice) * dpr
    const x2 = this.transform.timeToX(annotation.endTime) * dpr
    const y2 = this.transform.priceToY(annotation.endPrice) * dpr

    ctx.save()
    ctx.strokeStyle = annotation.style.color
    ctx.fillStyle = annotation.style.color
    ctx.lineWidth = annotation.style.lineWidth * dpr

    // Draw line
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()

    // Draw arrowhead
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const headLength = 10 * dpr

    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    )
    ctx.lineTo(
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    )
    ctx.closePath()
    ctx.fill()

    ctx.restore()
  }

  // Draw a single annotation
  drawAnnotation(annotation: Annotation) {
    if (annotation.visible === false) return

    switch (annotation.type) {
      case 'horizontal-line':
        this.drawHorizontalLine(annotation as LineAnnotation)
        break
      case 'vertical-line':
        this.drawVerticalLine(annotation as LineAnnotation)
        break
      case 'trend-line':
      case 'ray':
        this.drawTrendLine(annotation as LineAnnotation)
        break
      case 'rectangle':
        this.drawRectangle(annotation as ShapeAnnotation)
        break
      case 'ellipse':
        this.drawEllipse(annotation as ShapeAnnotation)
        break
      case 'fibonacci':
        this.drawFibonacci(annotation as FibonacciAnnotation)
        break
      case 'text':
        this.drawText(annotation as TextAnnotation)
        break
      case 'arrow':
        this.drawArrow(annotation as ArrowAnnotation)
        break
    }
  }

  // Draw all annotations
  drawAnnotations(annotations: Annotation[]) {
    for (const annotation of annotations) {
      this.drawAnnotation(annotation)
    }
  }

  // Render events and annotations
  render(events: ChartEvent[], annotations: Annotation[]) {
    // Draw annotations first (below events)
    this.drawAnnotations(annotations)
    // Draw events on top
    this.drawEvents(events)
  }
}
