/**
 * Hook for fetching real-time market data with efficient batching
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BrowserFinancialService, Quote } from '../lib/financial-data/browser-client'

// Singleton instance of the financial service
const financialService = new BrowserFinancialService()

// Market hours (US Eastern Time)
const MARKET_OPEN_HOUR = 9.5 // 9:30 AM ET
const MARKET_CLOSE_HOUR = 16 // 4:00 PM ET

export interface MarketQuote extends Quote {
  isStale?: boolean
  lastUpdated: number
}

export interface PriceAlert {
  assetId: string
  symbol: string
  type: 'above' | 'below' | 'target_hit'
  targetPrice: number
  currentPrice: number
}

export interface MarketStatus {
  isOpen: boolean
  status: 'pre-market' | 'open' | 'after-hours' | 'closed'
  nextOpen?: Date
  nextClose?: Date
}

// Get current market status
export function getMarketStatus(): MarketStatus {
  const now = new Date()

  // Convert to ET (approximate - doesn't handle DST perfectly)
  const utcHour = now.getUTCHours()
  const utcMinutes = now.getUTCMinutes()
  const etOffset = -5 // EST (use -4 for EDT)
  let etHour = utcHour + etOffset
  if (etHour < 0) etHour += 24

  const etTime = etHour + utcMinutes / 60
  const dayOfWeek = now.getUTCDay()

  // Weekend check
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { isOpen: false, status: 'closed' }
  }

  // Market hours check
  if (etTime >= MARKET_OPEN_HOUR && etTime < MARKET_CLOSE_HOUR) {
    return { isOpen: true, status: 'open' }
  } else if (etTime < MARKET_OPEN_HOUR && etTime >= 4) {
    return { isOpen: false, status: 'pre-market' }
  } else if (etTime >= MARKET_CLOSE_HOUR && etTime < 20) {
    return { isOpen: false, status: 'after-hours' }
  } else {
    return { isOpen: false, status: 'closed' }
  }
}

// Hook to track market status
export function useMarketStatus() {
  const [status, setStatus] = useState<MarketStatus>(getMarketStatus)

  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(getMarketStatus())
    }, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [])

  return status
}

// Main hook for market data
export function useMarketData(symbols: string[], options?: {
  refreshInterval?: number
  enabled?: boolean
}) {
  const {
    refreshInterval = 60000, // 1 minute default
    enabled = true
  } = options || {}

  const queryClient = useQueryClient()
  const [quotes, setQuotes] = useState<Map<string, MarketQuote>>(new Map())
  const fetchingRef = useRef<Set<string>>(new Set())

  // Filter to valid symbols only
  const validSymbols = useMemo(() =>
    symbols.filter(s => s && typeof s === 'string' && s.length > 0),
    [symbols]
  )

  // Batch fetch quotes
  const fetchQuotes = useCallback(async (symbolsToFetch: string[]) => {
    if (!enabled || symbolsToFetch.length === 0) return

    // Filter out already fetching symbols
    const newSymbols = symbolsToFetch.filter(s => !fetchingRef.current.has(s))
    if (newSymbols.length === 0) return

    // Mark as fetching
    newSymbols.forEach(s => fetchingRef.current.add(s))

    try {
      // Batch fetch with rate limiting (max 5 concurrent)
      const batchSize = 5
      const results = new Map<string, MarketQuote>()

      for (let i = 0; i < newSymbols.length; i += batchSize) {
        const batch = newSymbols.slice(i, i + batchSize)

        const batchResults = await Promise.allSettled(
          batch.map(async (symbol) => {
            const quote = await financialService.getQuote(symbol)
            if (!quote) return null

            return {
              ...quote,
              lastUpdated: Date.now()
            } as MarketQuote
          })
        )

        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            results.set(batch[index], result.value)
          }
        })

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < newSymbols.length) {
          await new Promise(r => setTimeout(r, 200))
        }
      }

      // Update state
      setQuotes(prev => {
        const next = new Map(prev)
        results.forEach((quote, symbol) => {
          next.set(symbol, quote)
        })
        return next
      })

    } finally {
      // Clear fetching flags
      newSymbols.forEach(s => fetchingRef.current.delete(s))
    }
  }, [enabled])

  // Initial fetch
  useEffect(() => {
    if (validSymbols.length > 0) {
      fetchQuotes(validSymbols)
    }
  }, [validSymbols.join(','), fetchQuotes])

  // Refresh interval
  useEffect(() => {
    if (!enabled || validSymbols.length === 0) return

    const interval = setInterval(() => {
      fetchQuotes(validSymbols)
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [enabled, validSymbols.join(','), refreshInterval, fetchQuotes])

  // Get quote for a specific symbol
  const getQuote = useCallback((symbol: string): MarketQuote | undefined => {
    return quotes.get(symbol.toUpperCase())
  }, [quotes])

  // Refresh a specific symbol
  const refreshSymbol = useCallback((symbol: string) => {
    fetchQuotes([symbol])
  }, [fetchQuotes])

  // Refresh all
  const refreshAll = useCallback(() => {
    fetchQuotes(validSymbols)
  }, [fetchQuotes, validSymbols])

  return {
    quotes,
    getQuote,
    refreshSymbol,
    refreshAll,
    isLoading: fetchingRef.current.size > 0
  }
}

// Hook for price alerts
export function usePriceAlerts(
  assets: Array<{ id: string; symbol: string; price_targets?: Array<{ price: number; type: string }> }>,
  quotes: Map<string, MarketQuote>
): PriceAlert[] {
  return useMemo(() => {
    const alerts: PriceAlert[] = []

    assets.forEach(asset => {
      if (!asset.symbol || !asset.price_targets) return

      const quote = quotes.get(asset.symbol.toUpperCase())
      if (!quote) return

      asset.price_targets.forEach(target => {
        const targetPrice = Number(target.price)
        if (isNaN(targetPrice)) return

        // Check if price is within 5% of target
        const pctDiff = Math.abs((quote.price - targetPrice) / targetPrice) * 100

        if (pctDiff <= 5) {
          alerts.push({
            assetId: asset.id,
            symbol: asset.symbol,
            type: 'target_hit',
            targetPrice,
            currentPrice: quote.price
          })
        } else if (quote.price > targetPrice && target.type === 'bull') {
          alerts.push({
            assetId: asset.id,
            symbol: asset.symbol,
            type: 'above',
            targetPrice,
            currentPrice: quote.price
          })
        }
      })
    })

    return alerts
  }, [assets, quotes])
}

// Hook to observe visible symbols (for efficient loading)
export function useVisibleSymbols(
  containerRef: React.RefObject<HTMLElement>,
  allSymbols: string[]
): string[] {
  const [visibleSymbols, setVisibleSymbols] = useState<string[]>([])
  const observerRef = useRef<IntersectionObserver | null>(null)
  const symbolElementsRef = useRef<Map<string, HTMLElement>>(new Map())

  // Register an element for a symbol
  const registerElement = useCallback((symbol: string, element: HTMLElement | null) => {
    if (element) {
      symbolElementsRef.current.set(symbol, element)
    } else {
      symbolElementsRef.current.delete(symbol)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = new Set(visibleSymbols)

        entries.forEach(entry => {
          const symbol = entry.target.getAttribute('data-symbol')
          if (!symbol) return

          if (entry.isIntersecting) {
            visible.add(symbol)
          }
        })

        setVisibleSymbols(Array.from(visible))
      },
      {
        root: containerRef.current,
        rootMargin: '100px',
        threshold: 0
      }
    )

    // Observe all registered elements
    symbolElementsRef.current.forEach((element) => {
      observerRef.current?.observe(element)
    })

    return () => {
      observerRef.current?.disconnect()
    }
  }, [containerRef, allSymbols])

  return visibleSymbols
}
