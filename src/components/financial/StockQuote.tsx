import React, { useState, useEffect } from 'react'
import { financialDataService, type Quote } from '../../lib/financial-data/browser-client'

interface StockQuoteProps {
  symbol: string
  showDetails?: boolean
  compact?: boolean
  className?: string
}

export function StockQuote({ symbol, showDetails = false, compact = false, className = '' }: StockQuoteProps) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!symbol) return

    const fetchQuote = async () => {
      setLoading(true)
      setError(null)

      try {
        const quoteData = await financialDataService.getQuote(symbol.toUpperCase())
        setQuote(quoteData)
      } catch (err) {
        setError('Financial data temporarily unavailable')
        console.warn('Stock quote fetch failed (non-blocking):', err)
      } finally {
        setLoading(false)
      }
    }

    // Fetch immediately for better performance
    fetchQuote()
  }, [symbol])

  if (loading) {
    if (compact) {
      return (
        <div className={`animate-pulse ${className}`}>
          <div className="flex items-start gap-6">
            <div className="flex flex-col">
              <div className="h-8 bg-primary-200 rounded w-24 mb-2"></div>
              <div className="h-4 bg-primary-200 rounded w-20 mb-1"></div>
              <div className="h-3 bg-primary-200 rounded w-16"></div>
            </div>
            <div className="flex flex-col space-y-1">
              <div className="h-3 bg-primary-200 rounded w-20"></div>
              <div className="h-3 bg-primary-200 rounded w-20"></div>
              <div className="h-3 bg-primary-200 rounded w-20"></div>
              <div className="h-3 bg-primary-200 rounded w-16"></div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-4 bg-primary-200 rounded w-24 mb-2"></div>
        <div className="h-6 bg-primary-200 rounded w-32"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`text-red-500 text-sm ${className}`}>
        {error}
      </div>
    )
  }

  if (!quote) {
    return (
      <div className={`text-gray-500 text-sm ${className}`}>
        No data available
      </div>
    )
  }

  const changeColor = quote.change >= 0 ? 'text-green-600' : 'text-red-600'
  const changeSymbol = quote.change >= 0 ? '+' : ''

  // Compact mode for header sections
  if (compact) {
    return (
      <div className={`${className}`}>
        <div className="flex items-start gap-6">
          {/* Price and Change */}
          <div className="flex flex-col">
            <div className="text-2xl font-bold text-gray-900">${quote.price.toFixed(2)}</div>
            <div className={`text-sm font-medium ${changeColor}`}>
              {changeSymbol}{quote.change.toFixed(2)} ({changeSymbol}{quote.changePercent.toFixed(2)}%)
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {new Date(quote.timestamp).toLocaleTimeString()}
            </div>
          </div>

          {/* Market Data */}
          <div className="flex flex-col text-xs text-gray-600 space-y-1">
            <div><span className="text-gray-500">Open:</span> ${quote.open.toFixed(2)}</div>
            <div><span className="text-gray-500">High:</span> ${quote.dayHigh.toFixed(2)}</div>
            <div><span className="text-gray-500">Low:</span> ${quote.dayLow.toFixed(2)}</div>
            <div><span className="text-gray-500">Vol:</span> {quote.volume > 0 ? `${(quote.volume / 1000000).toFixed(1)}M` : '--'}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${className}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-gray-800">{quote.symbol}</span>
        <span className="text-lg font-bold text-gray-900">
          ${quote.price.toFixed(2)}
        </span>
      </div>

      <div className={`flex items-center gap-2 text-sm ${changeColor}`}>
        <span>
          {changeSymbol}{quote.change.toFixed(2)}
        </span>
        <span>
          ({changeSymbol}{quote.changePercent.toFixed(2)}%)
        </span>
      </div>

      {showDetails && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
          <div>
            <span className="block font-medium">Open</span>
            <span>${quote.open.toFixed(2)}</span>
          </div>
          <div>
            <span className="block font-medium">Prev Close</span>
            <span>${quote.previousClose.toFixed(2)}</span>
          </div>
          <div>
            <span className="block font-medium">Day High</span>
            <span>${quote.dayHigh.toFixed(2)}</span>
          </div>
          <div>
            <span className="block font-medium">Day Low</span>
            <span>${quote.dayLow.toFixed(2)}</span>
          </div>
          <div>
            <span className="block font-medium">Volume</span>
            <span>{quote.volume > 0 ? quote.volume.toLocaleString() : '--'}</span>
          </div>
          {quote.marketCap && (
            <div>
              <span className="block font-medium">Market Cap</span>
              <span>${(quote.marketCap / 1e9).toFixed(2)}B</span>
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-gray-400 mt-1">
        Last updated: {new Date(quote.timestamp).toLocaleTimeString()}
      </div>
    </div>
  )
}