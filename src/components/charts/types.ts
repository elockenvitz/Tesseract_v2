export interface ChartDataPoint {
  timestamp: number | string
  date?: Date
  value: number
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
  [key: string]: any
}

export interface Annotation {
  id: string
  type: 'line' | 'rect' | 'text' | 'percentage' | 'trend'
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  x?: number
  y?: number
  text?: string
  color?: string
  strokeWidth?: number
  dashArray?: string
}

export interface TechnicalIndicator {
  id: string
  name: string
  type: 'sma' | 'ema' | 'rsi' | 'macd' | 'bollinger' | 'custom'
  period?: number
  color?: string
  visible: boolean
  data?: ChartDataPoint[]
}

export interface ChartConfig {
  width?: number
  height?: number
  margin?: {
    top: number
    right: number
    bottom: number
    left: number
  }
  theme?: 'light' | 'dark'
  showGrid?: boolean
  showLegend?: boolean
  showTooltip?: boolean
  enableZoom?: boolean
  enablePan?: boolean
  enableCrosshair?: boolean
  enableAnnotations?: boolean
}

export interface ChartProps {
  data: ChartDataPoint[]
  type?: 'line' | 'candlestick' | 'area' | 'bar'
  config?: ChartConfig
  indicators?: TechnicalIndicator[]
  annotations?: Annotation[]
  onDataPointClick?: (point: ChartDataPoint, index: number) => void
  onAnnotationCreate?: (annotation: Annotation) => void
  onAnnotationUpdate?: (annotation: Annotation) => void
  onAnnotationDelete?: (annotationId: string) => void
  className?: string
}

export interface FinancialMetrics {
  percentageChange: number
  volatility: number
  sma20?: number
  sma50?: number
  sma200?: number
  rsi?: number
  volume?: number
}