/**
 * useSparklines — one month of real daily closes per symbol.
 *
 * Deliberately not built on MiniChart / ChartDataAdapter.generateHistoricalData,
 * which produces a seeded random walk anchored to the current quote. A drawn
 * line beside a real price reads as real price history, and inventing one in a
 * finance product is a correctness problem rather than a cosmetic one.
 *
 * Each symbol is its own query so results cache independently and a symbol
 * already fetched for one list is free in the next. The caller is responsible
 * for passing a bounded list — sparklines are one request per symbol, so this
 * should be the rows actually on screen, not a whole universe.
 */

import { useQueries } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface Sparkline {
  closes: number[]
  /** Change across the window, as a fraction. Null when there is nothing to compare. */
  change: number | null
}

async function fetchSparkline(symbol: string): Promise<Sparkline | null> {
  // Routed through the edge function rather than Yahoo directly: query1 blocks
  // browser requests via CORS, which is what yahoo-chart-proxy exists for.
  const { data, error } = await supabase.functions.invoke('yahoo-chart-proxy', {
    body: { symbol, interval: '1d', range: '1mo' },
  })
  if (error) return null

  const result = (data as any)?.chart?.result?.[0]
  const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter(
    (c: unknown): c is number => typeof c === 'number' && Number.isFinite(c)
  )
  if (closes.length < 2) return null

  const first = closes[0]
  const last = closes[closes.length - 1]
  return {
    closes,
    change: first > 0 ? (last - first) / first : null,
  }
}

export function useSparklines(symbols: string[]) {
  const unique = [...new Set(symbols.filter(Boolean))]

  const results = useQueries({
    queries: unique.map(symbol => ({
      queryKey: ['sparkline', symbol],
      queryFn: () => fetchSparkline(symbol),
      // A month of daily closes does not change intraday in any way a
      // 40px-wide line would show, so this is cached hard.
      staleTime: 30 * 60_000,
      gcTime: 60 * 60_000,
      retry: 1,
    })),
  })

  const map: Record<string, Sparkline> = {}
  unique.forEach((symbol, i) => {
    const d = results[i]?.data
    if (d) map[symbol] = d
  })
  return map
}
