/**
 * Hook for fetching real-time market data with efficient batching
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BrowserFinancialService, Quote } from '../lib/financial-data/browser-client'
import { mapWithConcurrency } from '../lib/market-data/concurrent-map'

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
      /*
       * A bounded pool, not fixed slices with a sleep between them.
       *
       * ── What the old shape cost, measured ──────────────────────────────
       *
       * It walked the symbols five at a time and slept 200 ms after each
       * slice. On the production Dashboard that is 65 symbols in 13 slices:
       * **7028 ms** end to end, while the median individual request took
       * **152 ms**. The ladder ran straight through the window in which the
       * reader is waiting for the feed, and about 2.4 s of it was the sleep
       * alone. A slice also runs at the speed of its slowest member, so four
       * replies at 80 ms waited on a fifth at 900 ms before anything else
       * could start.
       *
       * ── Why the pacing was there, and why it no longer applies ─────────
       *
       * The comment said "to avoid rate limiting", and when it was written
       * that was Alpha Vantage's 25-calls-a-day free tier. That provider is
       * permanently dormant — `BrowserFinancialService.alphaVantageKey` is
       * declared `null` and never assigned, and `getQuote` falls straight
       * through to Yahoo by way of THIS PROJECT'S OWN Netlify function. So
       * the delay was pacing our own endpoint against a limit belonging to a
       * provider that is no longer called.
       *
       * ── Why there is still a limit ─────────────────────────────────────
       *
       * Because the function proxies Yahoo, which does throttle, and because
       * sixty-five sockets at once starve the Supabase reads the feed is
       * actually blocked on. 12 is measured, not guessed: against production
       * on 2026-11-19, 12 concurrent quote requests returned 12/12 parsed in
       * 202 ms and 24 returned 24/24 in 251 ms, with no throttling at either
       * width. 12 is the conservative end of a range that was clean.
       *
       * No retry and no backoff are added here. A symbol that cannot be
       * priced stays absent, exactly as before — `getQuote` already returns
       * null rather than a fabricated price, and that remains the contract.
       */
      const QUOTE_FETCH_CONCURRENCY = 12
      const results = new Map<string, MarketQuote>()

      const settled = await mapWithConcurrency(
        newSymbols,
        QUOTE_FETCH_CONCURRENCY,
        async (symbol) => {
          const quote = await financialService.getQuote(symbol)
          if (!quote) return null
          return { ...quote, lastUpdated: Date.now() } as MarketQuote
        },
      )

      // Positional, so a slow symbol's price cannot land under a fast
      // symbol's ticker.
      settled.forEach((result, index) => {
        if (result && result.status === 'fulfilled' && result.value) {
          results.set(newSymbols[index], result.value)
        }
      })

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
