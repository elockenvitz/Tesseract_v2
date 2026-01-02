import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DataValueView } from './data-value/DataValueView'

/**
 * DataValueExtension - TipTap node for inline financial data values
 *
 * Supports data types:
 * - price: Current stock price
 * - volume: Trading volume
 * - marketcap: Market capitalization
 * - change: Price change percentage
 * - pe: P/E ratio
 * - dividend: Dividend yield
 */

export type DataType = 'price' | 'volume' | 'marketcap' | 'change' | 'pe' | 'dividend'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dataValue: {
      insertDataValue: (attrs: Partial<DataValueNodeAttrs>) => ReturnType
    }
  }
}

export interface DataValueNodeAttrs {
  dataId: string | null
  dataType: DataType
  symbol: string

  // Static snapshot value
  snapshotValue: number | null
  snapshotAt: string | null

  // Display settings
  isLive: boolean
  showSymbol: boolean

  // Formatting
  prefix: string
  suffix: string
  decimals: number
}

export const DataValueExtension = Node.create({
  name: 'dataValue',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      dataId: {
        default: null,
        parseHTML: element => element.getAttribute('data-id'),
        renderHTML: attributes => attributes.dataId ? { 'data-id': attributes.dataId } : {}
      },
      dataType: {
        default: 'price',
        parseHTML: element => element.getAttribute('data-type') || 'price',
        renderHTML: attributes => ({ 'data-type': attributes.dataType })
      },
      symbol: {
        default: '',
        parseHTML: element => element.getAttribute('data-symbol') || '',
        renderHTML: attributes => attributes.symbol ? { 'data-symbol': attributes.symbol } : {}
      },
      snapshotValue: {
        default: null,
        parseHTML: element => {
          const val = element.getAttribute('data-snapshot-value')
          return val ? parseFloat(val) : null
        },
        renderHTML: attributes => attributes.snapshotValue !== null
          ? { 'data-snapshot-value': String(attributes.snapshotValue) }
          : {}
      },
      snapshotAt: {
        default: null,
        parseHTML: element => element.getAttribute('data-snapshot-at'),
        renderHTML: attributes => attributes.snapshotAt
          ? { 'data-snapshot-at': attributes.snapshotAt }
          : {}
      },
      isLive: {
        default: false,
        parseHTML: element => element.getAttribute('data-is-live') === 'true',
        renderHTML: attributes => attributes.isLive ? { 'data-is-live': 'true' } : {}
      },
      showSymbol: {
        default: true,
        parseHTML: element => element.getAttribute('data-show-symbol') !== 'false',
        renderHTML: attributes => !attributes.showSymbol ? { 'data-show-symbol': 'false' } : {}
      },
      prefix: {
        default: '',
        parseHTML: element => element.getAttribute('data-prefix') || '',
        renderHTML: attributes => attributes.prefix ? { 'data-prefix': attributes.prefix } : {}
      },
      suffix: {
        default: '',
        parseHTML: element => element.getAttribute('data-suffix') || '',
        renderHTML: attributes => attributes.suffix ? { 'data-suffix': attributes.suffix } : {}
      },
      decimals: {
        default: 2,
        parseHTML: element => parseInt(element.getAttribute('data-decimals') || '2', 10),
        renderHTML: attributes => ({ 'data-decimals': String(attributes.decimals) })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="dataValue"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const symbol = node.attrs.symbol
    const dataType = node.attrs.dataType
    const value = node.attrs.snapshotValue
    const displayValue = value !== null ? formatValue(value, dataType) : '...'
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'dataValue' }), `${symbol} ${displayValue}`]
  },

  renderText({ node }) {
    const symbol = node.attrs.symbol
    const dataType = node.attrs.dataType
    const value = node.attrs.snapshotValue
    const displayValue = value !== null ? formatValue(value, dataType) : '...'
    return `${symbol} ${displayValue}`
  },

  addCommands() {
    return {
      insertDataValue:
        (attrs: Partial<DataValueNodeAttrs>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs
          })
        }
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(DataValueView)
  }
})

// Helper function to format values based on data type
function formatValue(value: number, dataType: DataType): string {
  switch (dataType) {
    case 'price':
      return `$${value.toFixed(2)}`
    case 'volume':
      if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`
      if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
      return value.toFixed(0)
    case 'marketcap':
      if (value >= 1000000000000) return `$${(value / 1000000000000).toFixed(2)}T`
      if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
      return `$${value.toFixed(0)}`
    case 'change':
      const sign = value >= 0 ? '+' : ''
      return `${sign}${value.toFixed(2)}%`
    case 'pe':
      return value.toFixed(2)
    case 'dividend':
      return `${value.toFixed(2)}%`
    default:
      return value.toFixed(2)
  }
}

export default DataValueExtension
