import React, { useState, useCallback, useEffect, useRef } from 'react'
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, RefreshCw, Zap, ZapOff, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { financialDataService } from '../../../../lib/financial-data/browser-client'
import type { DataType } from '../DataValueExtension'

// Data type configuration - outline style with light shading
const DATA_TYPE_CONFIG: Record<DataType, { label: string }> = {
  price: { label: 'price' },
  volume: { label: 'volume' },
  marketcap: { label: 'mkt cap' },
  change: { label: 'change' },
  pe: { label: 'P/E' },
  dividend: { label: 'div yield' }
}

interface DataValueViewProps extends NodeViewProps {}

export function DataValueView({ node, updateAttributes, selected }: DataValueViewProps) {
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLSpanElement>(null)

  const {
    dataType,
    symbol,
    snapshotValue,
    snapshotAt,
    isLive,
    showSymbol
  } = node.attrs

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMenu])

  // Fetch live data
  const { data: quoteData, isLoading, error, refetch } = useQuery({
    queryKey: ['data-value', symbol, dataType],
    queryFn: async () => {
      if (!symbol) return null
      try {
        const quote = await financialDataService.getQuote(symbol)
        return quote
      } catch (err) {
        console.error('Failed to fetch quote:', err)
        throw err
      }
    },
    enabled: !!symbol,
    refetchInterval: isLive ? 30000 : false,
    staleTime: 15000,
    retry: 2
  })

  // Extract the value based on data type
  // Note: The browser-client normalizes field names to: price, volume, change, changePercent, marketCap
  const extractValue = useCallback((quote: any): number | null => {
    if (!quote) return null
    switch (dataType) {
      case 'price':
        return quote.price ?? null
      case 'volume':
        return quote.volume ?? null
      case 'marketcap':
        return quote.marketCap ?? null
      case 'change':
        return quote.changePercent ?? null
      case 'pe':
        // PE ratio not available in basic quote - would need separate API
        return quote.pe ?? quote.trailingPE ?? null
      case 'dividend':
        // Dividend not available in basic quote - would need separate API
        return quote.dividendYield ?? null
      default:
        return null
    }
  }, [dataType])

  // Save snapshot value when data is first fetched
  useEffect(() => {
    if (quoteData && snapshotValue === null) {
      const value = extractValue(quoteData)
      if (value !== null) {
        updateAttributes({
          snapshotValue: value,
          snapshotAt: new Date().toISOString()
        })
      }
    }
  }, [quoteData, snapshotValue, extractValue, updateAttributes])

  // Get display value - use live data if in live mode, otherwise use snapshot
  const liveValue = extractValue(quoteData)
  const displayValue = isLive ? liveValue : (snapshotValue ?? liveValue)

  // Format the value based on data type
  const formatValue = (value: number | null): string => {
    if (value === null) return '...'
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

  // Toggle live mode
  const toggleLive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    updateAttributes({ isLive: !isLive })
  }, [isLive, updateAttributes])

  // Handle refresh
  const handleRefresh = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    refetch()
  }, [refetch])

  const config = DATA_TYPE_CONFIG[dataType as DataType] || DATA_TYPE_CONFIG.price
  const isPositiveChange = dataType === 'change' && displayValue !== null && displayValue >= 0
  const isNegativeChange = dataType === 'change' && displayValue !== null && displayValue < 0

  return (
    <NodeViewWrapper
      as="span"
      ref={wrapperRef}
      className="relative inline-block"
    >
      <span
        onClick={() => setShowMenu(!showMenu)}
        className={clsx(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-sm transition-all cursor-pointer select-none',
          'bg-gray-50/50 border-gray-300 text-gray-700',
          selected && 'ring-2 ring-primary-300',
          'hover:bg-gray-100 hover:border-gray-400'
        )}
        contentEditable={false}
      >
        {/* Symbol + Label: "AAPL price" */}
        {showSymbol && (
          <span className="font-semibold text-gray-900">{symbol}</span>
        )}
        <span className="text-gray-500">{config.label}</span>

        {/* Loading indicator */}
        {isLoading && displayValue === null && (
          <RefreshCw className="h-3 w-3 animate-spin text-gray-400" />
        )}

        {/* Error indicator */}
        {error && displayValue === null && (
          <AlertCircle className="h-3 w-3 text-red-500" />
        )}

        {/* Value with change indicator */}
        {displayValue !== null && (
          <span className={clsx(
            'flex items-center gap-0.5 font-medium',
            dataType === 'change' && isPositiveChange && 'text-emerald-600',
            dataType === 'change' && isNegativeChange && 'text-red-600',
            dataType !== 'change' && 'text-gray-900'
          )}>
            {dataType === 'change' && (
              displayValue >= 0
                ? <TrendingUp className="h-3 w-3" />
                : <TrendingDown className="h-3 w-3" />
            )}
            {formatValue(displayValue)}
          </span>
        )}

        {/* Live indicator */}
        {isLive && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" title="Live" />
        )}
      </span>

      {/* Dropdown menu */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute z-50 top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-sm select-none"
          onClick={(e) => e.stopPropagation()}
          contentEditable={false}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="font-semibold text-gray-900">{symbol} {config.label}</div>
            {!isLive && snapshotAt && (
              <div className="text-xs text-gray-500 mt-0.5">
                as of {format(new Date(snapshotAt), 'MMM d, h:mm a')}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="py-1">
            <button
              onClick={toggleLive}
              className={clsx(
                'w-full px-3 py-2 text-left flex items-center gap-2 transition-colors',
                isLive ? 'bg-green-50 text-green-700' : 'hover:bg-gray-50 text-gray-700'
              )}
            >
              {isLive ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
              <span>{isLive ? 'Live' : 'Static'}</span>
            </button>

            <button
              onClick={handleRefresh}
              className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-50 text-gray-700"
            >
              <RefreshCw className={clsx('h-4 w-4', isLoading && 'animate-spin')} />
              <span>Refresh now</span>
            </button>
          </div>

          {/* Current value info */}
          {quoteData && !isLive && liveValue !== snapshotValue && (
            <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
              Current: {formatValue(liveValue)}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="border-t border-gray-100 px-3 py-2 text-xs text-red-600">
              Failed to fetch data. Click refresh to retry.
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default DataValueView
