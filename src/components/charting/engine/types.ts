// Chart data types
export interface OHLC {
  time: number // Unix timestamp in seconds
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface ViewState {
  // Visible time range (unix timestamps)
  startTime: number
  endTime: number
  // Visible price range
  minPrice: number
  maxPrice: number
  // Auto-scale price to visible data
  autoScalePrice: boolean
}

export interface ChartTheme {
  background: string
  text: string
  textSecondary: string
  gridLines: string
  crosshair: string
  upColor: string
  downColor: string
  upWick: string
  downWick: string
  lineColor: string
  areaFill: string
  areaBorder: string
  volumeUp: string
  volumeDown: string
  axisLine: string
}

export const defaultLightTheme: ChartTheme = {
  background: '#ffffff',
  text: '#333333',
  textSecondary: '#666666',
  gridLines: '#e5e7eb',
  crosshair: '#9ca3af',
  upColor: '#22c55e',
  downColor: '#ef4444',
  upWick: '#22c55e',
  downWick: '#ef4444',
  lineColor: '#2563eb',
  areaFill: 'rgba(37, 99, 235, 0.1)',
  areaBorder: '#2563eb',
  volumeUp: 'rgba(34, 197, 94, 0.5)',
  volumeDown: 'rgba(239, 68, 68, 0.5)',
  axisLine: '#d1d5db'
}

export const defaultDarkTheme: ChartTheme = {
  background: '#1a1a2e',
  text: '#e5e7eb',
  textSecondary: '#9ca3af',
  gridLines: '#2d2d44',
  crosshair: '#6b7280',
  upColor: '#22c55e',
  downColor: '#ef4444',
  upWick: '#22c55e',
  downWick: '#ef4444',
  lineColor: '#3b82f6',
  areaFill: 'rgba(59, 130, 246, 0.1)',
  areaBorder: '#3b82f6',
  volumeUp: 'rgba(34, 197, 94, 0.5)',
  volumeDown: 'rgba(239, 68, 68, 0.5)',
  axisLine: '#374151'
}

export type ChartType = 'candlestick' | 'line' | 'area' | 'bar'
export type TimeFrame = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'

export interface ChartDimensions {
  width: number
  height: number
  marginTop: number
  marginRight: number // For price axis
  marginBottom: number // For time axis
  marginLeft: number
}

export const defaultDimensions: ChartDimensions = {
  width: 800,
  height: 600,
  marginTop: 10,
  marginRight: 80,
  marginBottom: 30,
  marginLeft: 10
}
