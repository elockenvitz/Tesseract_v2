import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ChartView } from './chart/ChartView'

/**
 * ChartExtension - TipTap node for embedded financial charts
 *
 * Supports chart types:
 * - price: Price chart (line/candlestick)
 * - volume: Volume chart
 * - performance: Percentage performance chart
 * - comparison: Multi-asset comparison
 * - technicals: Chart with technical indicators
 */

export type ChartType = 'price' | 'volume' | 'performance' | 'comparison' | 'technicals'
export type ChartStyle = 'line' | 'area' | 'candlestick' | 'bar'
export type ChartTimeframe = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'ALL'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chart: {
      insertChart: (attrs: Partial<ChartNodeAttrs>) => ReturnType
    }
  }
}

export interface ChartNodeAttrs {
  chartId: string | null
  chartType: ChartType
  chartStyle: ChartStyle

  // Asset reference
  symbol: string
  assetId: string | null
  assetName: string

  // Comparison assets (for comparison charts)
  comparisonSymbols: string[]

  // Time settings
  timeframe: ChartTimeframe
  startDate: string | null
  endDate: string | null

  // Technical indicators
  indicators: string[] // e.g., ['sma20', 'sma50', 'rsi', 'macd']

  // Display settings
  height: number
  showVolume: boolean
  showGrid: boolean
  showLegend: boolean
  showTooltip: boolean

  // Title/label
  title: string

  // Snapshot data for offline/static display
  snapshotData: Record<string, any> | null
  snapshotAt: string | null
  isLive: boolean

  // Embedding timestamp - for showing reference line on live charts
  embeddedAt: string | null
}

export const ChartExtension = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      chartId: {
        default: null,
        parseHTML: element => element.getAttribute('data-chart-id'),
        renderHTML: attributes => attributes.chartId ? { 'data-chart-id': attributes.chartId } : {}
      },
      chartType: {
        default: 'price',
        parseHTML: element => element.getAttribute('data-chart-type') || 'price',
        renderHTML: attributes => ({ 'data-chart-type': attributes.chartType })
      },
      chartStyle: {
        default: 'line',
        parseHTML: element => element.getAttribute('data-chart-style') || 'line',
        renderHTML: attributes => ({ 'data-chart-style': attributes.chartStyle })
      },

      // Asset reference
      symbol: {
        default: '',
        parseHTML: element => element.getAttribute('data-symbol') || '',
        renderHTML: attributes => attributes.symbol ? { 'data-symbol': attributes.symbol } : {}
      },
      assetId: {
        default: null,
        parseHTML: element => element.getAttribute('data-asset-id'),
        renderHTML: attributes => attributes.assetId ? { 'data-asset-id': attributes.assetId } : {}
      },
      assetName: {
        default: '',
        parseHTML: element => element.getAttribute('data-asset-name') || '',
        renderHTML: attributes => attributes.assetName ? { 'data-asset-name': attributes.assetName } : {}
      },

      // Comparison
      comparisonSymbols: {
        default: [],
        parseHTML: element => {
          const data = element.getAttribute('data-comparison-symbols')
          return data ? JSON.parse(data) : []
        },
        renderHTML: attributes => attributes.comparisonSymbols?.length ? { 'data-comparison-symbols': JSON.stringify(attributes.comparisonSymbols) } : {}
      },

      // Time settings
      timeframe: {
        default: '1M',
        parseHTML: element => element.getAttribute('data-timeframe') || '1M',
        renderHTML: attributes => ({ 'data-timeframe': attributes.timeframe })
      },
      startDate: {
        default: null,
        parseHTML: element => element.getAttribute('data-start-date'),
        renderHTML: attributes => attributes.startDate ? { 'data-start-date': attributes.startDate } : {}
      },
      endDate: {
        default: null,
        parseHTML: element => element.getAttribute('data-end-date'),
        renderHTML: attributes => attributes.endDate ? { 'data-end-date': attributes.endDate } : {}
      },

      // Indicators
      indicators: {
        default: [],
        parseHTML: element => {
          const data = element.getAttribute('data-indicators')
          return data ? JSON.parse(data) : []
        },
        renderHTML: attributes => attributes.indicators?.length ? { 'data-indicators': JSON.stringify(attributes.indicators) } : {}
      },

      // Display settings
      height: {
        default: 300,
        parseHTML: element => parseInt(element.getAttribute('data-height') || '300', 10),
        renderHTML: attributes => ({ 'data-height': String(attributes.height) })
      },
      showVolume: {
        default: false,
        parseHTML: element => element.getAttribute('data-show-volume') === 'true',
        renderHTML: attributes => attributes.showVolume ? { 'data-show-volume': 'true' } : {}
      },
      showGrid: {
        default: true,
        parseHTML: element => element.getAttribute('data-show-grid') !== 'false',
        renderHTML: attributes => !attributes.showGrid ? { 'data-show-grid': 'false' } : {}
      },
      showLegend: {
        default: true,
        parseHTML: element => element.getAttribute('data-show-legend') !== 'false',
        renderHTML: attributes => !attributes.showLegend ? { 'data-show-legend': 'false' } : {}
      },
      showTooltip: {
        default: true,
        parseHTML: element => element.getAttribute('data-show-tooltip') !== 'false',
        renderHTML: attributes => !attributes.showTooltip ? { 'data-show-tooltip': 'false' } : {}
      },

      // Title
      title: {
        default: '',
        parseHTML: element => element.getAttribute('data-title') || '',
        renderHTML: attributes => attributes.title ? { 'data-title': attributes.title } : {}
      },

      // Snapshot
      snapshotData: {
        default: null,
        parseHTML: element => {
          const data = element.getAttribute('data-snapshot-data')
          return data ? JSON.parse(data) : null
        },
        renderHTML: attributes => attributes.snapshotData ? { 'data-snapshot-data': JSON.stringify(attributes.snapshotData) } : {}
      },
      snapshotAt: {
        default: null,
        parseHTML: element => element.getAttribute('data-snapshot-at'),
        renderHTML: attributes => attributes.snapshotAt ? { 'data-snapshot-at': attributes.snapshotAt } : {}
      },
      isLive: {
        default: true,
        parseHTML: element => element.getAttribute('data-is-live') !== 'false',
        renderHTML: attributes => !attributes.isLive ? { 'data-is-live': 'false' } : {}
      },
      embeddedAt: {
        default: null,
        parseHTML: element => element.getAttribute('data-embedded-at'),
        renderHTML: attributes => attributes.embeddedAt ? { 'data-embedded-at': attributes.embeddedAt } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="chart"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = node.attrs.title || `${node.attrs.symbol} ${node.attrs.chartType} Chart`
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chart' }), title]
  },

  renderText({ node }) {
    const symbol = node.attrs.symbol || 'Unknown'
    const type = node.attrs.chartType
    return `[Chart: ${symbol} ${type}]`
  },

  addCommands() {
    return {
      insertChart:
        (attrs: Partial<ChartNodeAttrs>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs
          })
        }
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartView)
  }
})

export default ChartExtension
